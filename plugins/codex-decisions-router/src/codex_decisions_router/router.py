"""Bounded recommendations. Never launch work or infer authorization from a route."""

import asyncio
import hashlib
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any

from .decisions import PROMPT_VERSION, Provider, ProviderError, build_request, canonical, parse_response
from .models import Policy, ReasonCode, RouteRequest, RouteResult
from .policy import BY_ID, Preset, eligible, fallback, warnings

CACHE_MAX_ENTRIES = 256
CACHE_TTL_SECONDS = 300.0
MAX_PENDING_CALLS = 4


@dataclass(frozen=True)
class CachedSelection:
    expires: float
    preset_id: str
    confidence: float
    fixture: bool


class Router:
    def __init__(self, policy: Policy | None = None, provider: Provider | None = None,
                 *, clock: Any = time.monotonic):
        self._policy = (policy or Policy()).model_copy(deep=True)
        if self._policy.mode == "live" and provider is not None and provider.is_fixture:
            raise ValueError("fixture_provider_live_forbidden")
        if self._policy.mode == "offline" and provider is not None and not provider.is_fixture:
            raise ValueError("offline_external_provider_forbidden")
        self.provider = provider
        self.clock = clock
        self.api_calls = 0
        self.cache: OrderedDict[str, CachedSelection] = OrderedDict()
        self.pending: set[asyncio.Task[Any]] = set()

    @property
    def mode(self) -> str:
        return self._policy.mode

    def cache_key(self, request: RouteRequest, candidates: tuple[Preset, ...]) -> str:
        # Catalog/access fingerprints stay local; every route rechecks hard constraints.
        value = {"request": request.model_dump(), "candidates": [item.id for item in candidates],
                 "policy": self._policy.model_dump(), "prompt_version": PROMPT_VERSION}
        return hashlib.sha256(canonical(value).encode()).hexdigest()

    def prune_cache(self) -> None:
        now = self.clock()
        for key in list(self.cache):
            if self.cache[key].expires <= now:
                del self.cache[key]

    async def route(self, request: RouteRequest) -> RouteResult:
        started = time.perf_counter()
        simulated = request.host.catalog_source == "fixture" or bool(
            self.provider and self.provider.is_fixture)

        def result(status: str, source: str, reason: str, selected: Preset | None = None,
                   confidence: float | None = None, api_called: bool = False) -> RouteResult:
            return RouteResult(
                status=status, source="fixture" if simulated else source,
                mode=self._policy.mode, selected=selected.selection() if selected else None,
                reason_code=reason, confidence=confidence,
                latency_ms=(time.perf_counter() - started) * 1000,
                api_called=api_called, warnings=warnings(request, selected),
            )

        if self.mode == "live" and request.host.catalog_source == "fixture":
            return result("blocked", "none", "fixture_catalog_blocked")
        if not request.host.native_spawn_available or not request.host.model_effort_overrides_available:
            return result("unsupported", "none", "host_unsupported")
        if not request.host.environment_ready or request.features.prior_failure == "environment_blocker":
            return result("blocked", "none", "environment_blocked")
        if request.attempt == 1 and (request.features.prior_failure != "quality_failure" or
                                    request.previous_preset is None):
            return result("blocked", "none", "attempt_limit")
        if request.attempt == 0 and (request.previous_preset is not None or
                                    request.features.prior_failure == "quality_failure"):
            return result("blocked", "none", "attempt_limit")
        candidates = eligible(request, self._policy)
        if not candidates:
            denied = bool(request.host.models) and all(item.access == "denied" for item in request.host.models)
            return result("blocked", "none", "access_denied" if denied else "no_eligible_candidate")
        local = fallback(request, candidates)
        if request.privacy != "non_sensitive":
            return result("fallback" if local else "blocked", "local_policy", "privacy_blocked", local)
        if len(candidates) == 1:
            return result("recommended", "single_candidate", "single_candidate", candidates[0])
        if self.mode == "offline" and self.provider is None:
            return result("fallback", "local_policy", "offline_mode", local)
        if self.provider is None:
            return result("fallback", "local_policy", "api_auth", local)
        self.prune_cache()
        key = self.cache_key(request, candidates)
        cached = self.cache.get(key)
        if cached and cached.preset_id in {candidate.id for candidate in candidates}:
            self.cache.move_to_end(key)
            return result("recommended", "cache", "selected", BY_ID[cached.preset_id], cached.confidence)
        if self.mode == "live" and self.api_calls >= (self._policy.max_api_calls_per_process or 0):
            return result("fallback", "local_policy", "api_call_limit", local)
        if len(self.pending) >= MAX_PENDING_CALLS:
            return result("fallback", "local_policy", "api_unavailable", local)
        api_called = False
        if self.mode == "live":
            self.api_calls += 1  # Reserve synchronously before await, including timed-out requests.

        async def operation() -> Any:
            nonlocal api_called
            body = build_request(request, candidates)
            api_called = self.mode == "live"  # Attempted provider call, not merely a reserved slot.
            response = await self.provider.decide(body)
            return parse_response(response, candidates)

        task = asyncio.create_task(operation())
        self.pending.add(task)

        def consume(completed: asyncio.Task[Any]) -> None:
            self.pending.discard(completed)
            if not completed.cancelled():
                completed.exception()  # Consume errors without printing provider text.

        task.add_done_callback(consume)
        remaining = max(0.0, self._policy.deadline_ms / 1000 - (time.perf_counter() - started))
        try:
            done, _ = await asyncio.wait({task}, timeout=remaining)
        except asyncio.CancelledError:
            task.cancel()
            raise
        if not done or (time.perf_counter() - started) * 1000 >= self._policy.deadline_ms:
            task.cancel()  # Do not wait for a cancellation-resistant response; it cannot replace this result.
            return result("fallback", "local_policy", "timeout", local, api_called=api_called)
        try:
            answer = task.result()
        except asyncio.CancelledError:
            raise
        except ProviderError as error:
            reason: ReasonCode = error.reason if error.reason in {
                "api_auth", "access_denied", "api_unavailable", "timeout", "invalid_response"
            } else "api_unavailable"
            if reason == "access_denied":
                return result("blocked", "none", reason, api_called=api_called)
            return result("fallback", "local_policy", reason, local, api_called=api_called)
        except Exception:
            return result("fallback", "local_policy", "invalid_response", local, api_called=api_called)
        if answer.kind == "refusal":
            return result("blocked", "none", "refusal", api_called=api_called)
        if answer.choice == "abstain":
            return result("fallback", "local_policy", "abstain", local, answer.confidence, api_called)
        if answer.confidence < self._policy.min_confidence:
            return result("fallback", "local_policy", "low_confidence", local, answer.confidence, api_called)
        selected = BY_ID[answer.choice]
        self.cache[key] = CachedSelection(self.clock() + CACHE_TTL_SECONDS, selected.id,
                                         answer.confidence, simulated)
        self.cache.move_to_end(key)
        while len(self.cache) > CACHE_MAX_ENTRIES:
            self.cache.popitem(last=False)
        return result("recommended", "decisions", "selected", selected, answer.confidence, api_called)

    async def aclose(self) -> None:
        for task in tuple(self.pending):
            task.cancel()
        if self.provider is not None:
            await self.provider.aclose()
