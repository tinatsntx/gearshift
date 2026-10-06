import asyncio
import json
import time
import unittest
from unittest.mock import patch

import httpx

from codex_decisions_router.decisions import DecisionsHTTPProvider, FixtureProvider, InvalidResponse, ProviderError
from codex_decisions_router.models import Policy, RouteRequest
from codex_decisions_router.policy import PRESETS
from codex_decisions_router.router import CACHE_MAX_ENTRIES, Router
from helpers import answer, clone, live_policy, refusal, request, request_dict


class SlowFixture(FixtureProvider):
    def __init__(self, delay, ignore_cancel=False):
        super().__init__(answer())
        self.delay = delay
        self.ignore_cancel = ignore_cancel
        self.completed = False

    async def decide(self, body):
        self.calls += 1
        try:
            await asyncio.sleep(self.delay)
        except asyncio.CancelledError:
            if not self.ignore_cancel:
                raise
            await asyncio.sleep(0.05)
        self.completed = True
        return self.response


class RouterTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_offline_has_zero_network_and_no_credential_lookup(self):
        with patch("httpx.AsyncClient", side_effect=AssertionError("network forbidden")), \
                patch("os.environ.get", side_effect=AssertionError("credential lookup forbidden")):
            value = await Router().route(request())
        self.assertEqual((value.status, value.reason_code, value.selected.preset_id),
                         ("fallback", "offline_mode", "sol_balanced"))
        self.assertFalse(value.api_called)
        self.assertFalse(value.applied)
        self.assertIsNone(value.confidence)

    async def test_fixture_is_always_labeled(self):
        router = Router(provider=FixtureProvider(answer()))
        first = await router.route(request())
        second = await router.route(request())
        self.assertEqual(first.source, "fixture")
        self.assertEqual(second.source, "fixture")
        self.assertFalse(first.api_called)
        self.assertEqual(router.provider.calls, 1)
        data = request_dict()
        data["host"]["catalog_source"] = "fixture"
        self.assertEqual((await Router().route(RouteRequest.model_validate(data))).source, "fixture")
        with self.assertRaises(ValueError):
            Router(live_policy(), FixtureProvider(answer()))

    async def test_empty_singleton_host_environment_privacy_and_attempt(self):
        data = request_dict()
        data["host"]["models"] = []
        self.assertEqual((await Router().route(RouteRequest.model_validate(data))).reason_code, "no_eligible_candidate")
        router = Router(Policy(allowed_presets=["sol_deep"]), FixtureProvider(answer()))
        value = await router.route(request())
        self.assertEqual(value.selected.preset_id, "sol_deep")
        self.assertEqual(value.reason_code, "single_candidate")
        self.assertEqual(router.provider.calls, 0)
        for field in ("native_spawn_available", "model_effort_overrides_available"):
            data = request_dict()
            data["host"][field] = False
            self.assertEqual((await Router().route(RouteRequest.model_validate(data))).status, "unsupported")
        data = request_dict()
        data["host"]["environment_ready"] = False
        self.assertEqual((await Router().route(RouteRequest.model_validate(data))).reason_code, "environment_blocked")
        for privacy in ("phi", "sensitive", "unknown"):
            value = await router.route(request(privacy=privacy))
            self.assertEqual(value.reason_code, "privacy_blocked")
            self.assertFalse(value.api_called)
        for data in (request_dict(attempt=1), request_dict(previous_preset="luna_fast")):
            self.assertEqual((await Router().route(RouteRequest.model_validate(data))).reason_code, "attempt_limit")
        data = request_dict()
        data["features"]["prior_failure"] = "environment_blocker"
        self.assertEqual((await Router().route(RouteRequest.model_validate(data))).reason_code, "environment_blocked")

    async def test_critical_and_quality_never_underroute(self):
        data = request_dict()
        data["features"]["consequence"] = "critical"
        value = await Router(Policy(allowed_presets=["luna_fast", "sol_balanced"])).route(RouteRequest.model_validate(data))
        self.assertEqual(value.status, "blocked")
        data = request_dict(attempt=1, previous_preset="astra_deep")
        data["features"]["prior_failure"] = "quality_failure"
        self.assertEqual((await Router().route(RouteRequest.model_validate(data))).status, "blocked")
        data["previous_preset"] = "sol_balanced"
        value = await Router().route(RouteRequest.model_validate(data))
        self.assertEqual(value.selected.preset_id, "sol_deep")
        data["features"]["prior_failure"] = "access_or_transport"
        self.assertEqual((await Router().route(RouteRequest.model_validate(data))).reason_code, "attempt_limit")

    async def test_refusal_abstain_low_confidence_bad_response(self):
        for data, reason, status in ((refusal(), "refusal", "blocked"),
                                     (answer("abstain"), "abstain", "fallback"),
                                     (answer(confidence=0.1), "low_confidence", "fallback"),
                                     ({"error": "NEVER_ECHO"}, "invalid_response", "fallback")):
            router = Router(provider=FixtureProvider(data))
            value = await router.route(request())
            self.assertEqual((value.reason_code, value.status), (reason, status))
            self.assertEqual(router.provider.calls, 1)
            self.assertEqual(len(router.cache), 0)
            self.assertNotIn("NEVER_ECHO", value.model_dump_json())
            if status == "blocked":
                self.assertIsNone(value.selected)

    async def test_deadline_and_ignored_late_success(self):
        provider = SlowFixture(2, ignore_cancel=True)
        router = Router(Policy(deadline_ms=100), provider)
        started = time.perf_counter()
        value = await router.route(request())
        elapsed = time.perf_counter() - started
        self.assertEqual(value.reason_code, "timeout")
        self.assertGreaterEqual(elapsed, 0.09)
        self.assertLess(elapsed, 0.3)
        snapshot = value.model_dump()
        await asyncio.sleep(0.1)
        self.assertTrue(provider.completed)
        self.assertEqual(value.model_dump(), snapshot)
        self.assertEqual(len(router.cache), 0)
        self.assertEqual(len(router.pending), 0)
        self.assertEqual(provider.calls, 1)

    async def test_cancellation_cancels_provider(self):
        provider = SlowFixture(2)
        router = Router(provider=provider)
        task = asyncio.create_task(router.route(request()))
        await asyncio.sleep(0.01)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        await asyncio.sleep(0)
        self.assertFalse(provider.completed)
        self.assertEqual(len(router.cache), 0)

    async def test_cache_ttl_catalog_access_and_policy_invalidation(self):
        now = [0.0]
        provider = FixtureProvider(answer())
        router = Router(provider=provider, clock=lambda: now[0])
        await router.route(request())
        await router.route(request())
        self.assertEqual(provider.calls, 1)
        now[0] = 301
        await router.route(request())
        self.assertEqual(provider.calls, 2)
        data = request_dict()
        data["host"]["models"][1]["access"] = "denied"
        value = await router.route(RouteRequest.model_validate(data))
        self.assertNotEqual(value.selected.model, "gpt-6.1-sol")
        self.assertEqual(value.reason_code, "invalid_response")
        other = Router(Policy(allowed_presets=["luna_fast"]), provider)
        self.assertEqual((await other.route(request())).selected.preset_id, "luna_fast")

    async def test_cache_is_bounded(self):
        router = Router(provider=FixtureProvider(answer()))
        for index in range(CACHE_MAX_ENTRIES + 10):
            data = request_dict()
            # There are many finite feature vectors; no free text is introduced.
            fields = ["task_kind", "scope", "uncertainty", "verification", "urgency"]
            values = [["inspect", "mechanical_edit", "implement", "debug", "review", "design", "unknown"],
                      ["localized", "multi_component", "cross_system", "unknown"],
                      ["specified_solution", "reproducible_problem", "open_investigation", "unknown"],
                      ["executable_acceptance", "partial_checks", "human_only", "unknown"],
                      ["interactive", "standard", "background", "unknown"]]
            number = index
            for field, options in zip(fields, values):
                data["features"][field] = options[number % len(options)]
                number //= len(options)
            await router.route(RouteRequest.model_validate(data))
        self.assertEqual(len(router.cache), CACHE_MAX_ENTRIES)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def make_router(self, handler, policy=None):
        provider = DecisionsHTTPProvider("synthetic-test-only", transport=httpx.MockTransport(handler))
        router = Router(policy or live_policy(), provider)
        self.addAsyncCleanup(router.aclose)
        return router

    async def test_mock_http_one_request_exact_endpoint_and_body(self):
        calls = []

        def handler(req):
            calls.append(req)
            self.assertEqual(str(req.url), "https://api.openai.com/v1/decisions")
            body = json.loads(req.content)
            self.assertEqual(set(body), {"model", "input", "questions"})
            return httpx.Response(200, json=answer())

        router = await self.make_router(handler)
        value = await router.route(request())
        cached = await router.route(request())
        self.assertEqual(value.source, "decisions")  # Transport boundary simulated; no real API call.
        self.assertTrue(value.api_called)
        self.assertEqual(cached.source, "cache")
        self.assertFalse(cached.api_called)
        self.assertEqual(len(calls), 1)

    async def test_status_errors_zero_retries_and_redaction(self):
        for code, reason, status in ((401, "api_auth", "fallback"), (403, "access_denied", "blocked"),
                                     (429, "api_unavailable", "fallback"), (500, "api_unavailable", "fallback"),
                                     (503, "api_unavailable", "fallback"), (302, "api_unavailable", "fallback")):
            calls = []

            def handler(req):
                calls.append(req)
                return httpx.Response(code, text="NEVER_ECHO", headers={"Retry-After": "10", "Location": "https://invalid.example/"})

            router = await self.make_router(handler)
            value = await router.route(request())
            with self.subTest(status=code):
                self.assertEqual((value.reason_code, value.status), (reason, status))
                self.assertEqual(len(calls), 1)
                self.assertNotIn("NEVER_ECHO", value.model_dump_json())

    async def test_network_malformed_oversize_and_auth_absence(self):
        for failure in ("connect", "timeout", "malformed", "oversize"):
            def handler(req):
                if failure == "connect":
                    raise httpx.ConnectError("NEVER_ECHO", request=req)
                if failure == "timeout":
                    raise httpx.ReadTimeout("NEVER_ECHO", request=req)
                if failure == "malformed":
                    return httpx.Response(200, text="NEVER_ECHO")
                return httpx.Response(200, content=b"x" * 20000)

            router = await self.make_router(handler)
            value = await router.route(request())
            self.assertEqual(value.status, "fallback")
            self.assertNotIn("NEVER_ECHO", value.model_dump_json())
        value = await Router(live_policy()).route(request())
        self.assertFalse(value.api_called)
        self.assertEqual(value.reason_code, "api_auth")

    async def test_live_fixture_catalog_and_cap_enforced(self):
        calls = []

        def handler(req):
            calls.append(req)
            return httpx.Response(429)

        router = await self.make_router(handler, live_policy(max_api_calls_per_process=1))
        data = request_dict()
        data["host"]["catalog_source"] = "fixture"
        self.assertEqual((await router.route(RouteRequest.model_validate(data))).reason_code, "fixture_catalog_blocked")
        self.assertEqual(len(calls), 0)
        await router.route(request())
        value = await router.route(request())
        self.assertEqual(value.reason_code, "api_call_limit")
        self.assertFalse(value.api_called)
        self.assertEqual(len(calls), 1)
        with self.assertRaises(ValueError):
            Router(Policy(), router.provider)

    async def test_concurrent_call_cap_is_atomic(self):
        calls = []

        async def handler(req):
            calls.append(req)
            await asyncio.sleep(0.01)
            return httpx.Response(429)

        router = await self.make_router(handler, live_policy(max_api_calls_per_process=1))
        values = await asyncio.gather(*(router.route(request()) for _ in range(5)))
        self.assertEqual(len(calls), 1)
        self.assertEqual(sum(value.api_called for value in values), 1)


class StreamDeadlineTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_body_is_covered_by_total_deadline(self):
        class SlowBody(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b'{"model":'
                await asyncio.sleep(2)
                yield b'"gpt-6-luna"}'

        calls = []

        def handler(req):
            calls.append(req)
            return httpx.Response(200, stream=SlowBody())

        provider = DecisionsHTTPProvider("synthetic-test-only", transport=httpx.MockTransport(handler))
        router = Router(live_policy(deadline_ms=100), provider)
        self.addAsyncCleanup(router.aclose)
        started = time.perf_counter()
        result = await router.route(request())
        self.assertEqual(result.reason_code, "timeout")
        self.assertLess(time.perf_counter() - started, 0.3)
        self.assertEqual(len(calls), 1)
        self.assertTrue(result.api_called)

    async def test_stalled_request_does_not_exceed_pending_memory_bound(self):
        class Stalled(FixtureProvider):
            async def decide(self, body):
                self.calls += 1
                await asyncio.sleep(2)
                return self.response

        provider = Stalled(answer())
        router = Router(Policy(deadline_ms=100), provider)
        results = await asyncio.gather(*(router.route(request()) for _ in range(10)))
        self.assertEqual(provider.calls, 4)
        self.assertEqual(sum(result.reason_code == "api_unavailable" for result in results), 6)
        self.assertEqual(sum(result.reason_code == "timeout" for result in results), 4)
        await asyncio.sleep(0)
        self.assertEqual(len(router.pending), 0)


class RefusalRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_named_refusal_stays_terminal_with_malformed_or_extended_metadata(self):
        for mutation in ("extra_reason", "missing_usage", "wrong_model", "conflicting_answer", "union_shape"):
            data = refusal()
            if mutation == "extra_reason":
                data["answers"][0]["reason"] = "NEVER_ECHO"
            elif mutation == "missing_usage":
                del data["usage"]
            elif mutation == "wrong_model":
                data["model"] = "unexpected"
            elif mutation == "conflicting_answer":
                data["answers"].append(answer()["answers"][0])
            else:
                data["answers"][0].update(choice="sol_deep", probabilities=[])
            provider = FixtureProvider(data)
            router = Router(provider=provider)
            result = await router.route(request())
            with self.subTest(mutation=mutation):
                self.assertEqual((result.status, result.reason_code), ("blocked", "refusal"))
                self.assertIsNone(result.selected)
                self.assertEqual(provider.calls, 1)
                self.assertEqual(len(router.cache), 0)
                self.assertNotIn("NEVER_ECHO", result.model_dump_json())

    async def test_pre_transport_failure_does_not_claim_api_called(self):
        calls = []

        def handler(req):
            calls.append(req)
            return httpx.Response(200, json=answer())

        provider = DecisionsHTTPProvider("synthetic-test-only", transport=httpx.MockTransport(handler))
        router = Router(live_policy(max_api_calls_per_process=1), provider)
        self.addAsyncCleanup(router.aclose)
        with patch("codex_decisions_router.router.build_request", side_effect=InvalidResponse()):
            result = await router.route(request())
        self.assertEqual(result.reason_code, "invalid_response")
        self.assertFalse(result.api_called)
        self.assertEqual(calls, [])
        self.assertEqual(router.api_calls, 1)  # Conservative slot reservation remains bounded.
