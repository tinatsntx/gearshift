"""Finite input boundary. No task text, paths, provider knobs, or credentials."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator, model_validator

ModelId = Literal["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra"]
Effort = Literal["low", "medium", "high", "xhigh", "max", "ultra"]
Modality = Literal["text", "image"]
PresetId = Literal[
    "luna_fast", "luna_careful", "sol_balanced", "sol_deep",
    "astra_balanced", "astra_deep",
]
ALL_PRESETS: tuple[PresetId, ...] = (
    "luna_fast", "luna_careful", "sol_balanced", "sol_deep",
    "astra_balanced", "astra_deep",
)
ReasonCode = Literal[
    "selected", "offline_mode", "single_candidate", "timeout", "low_confidence",
    "abstain", "refusal", "invalid_response", "no_eligible_candidate",
    "host_unsupported", "environment_blocked", "privacy_blocked", "access_denied",
    "api_auth", "api_unavailable", "attempt_limit", "api_call_limit",
    "fixture_catalog_blocked",
]
WarningCode = Literal["access_unverified", "context_unverified", "tools_unverified"]


class StrictObject(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True,
                              frozen=True, allow_inf_nan=False)


class Features(StrictObject):
    task_kind: Literal["inspect", "mechanical_edit", "implement", "debug", "review", "design", "unknown"]
    scope: Literal["localized", "multi_component", "cross_system", "unknown"]
    uncertainty: Literal["specified_solution", "reproducible_problem", "open_investigation", "unknown"]
    consequence: Literal["low_reversible", "consequential", "critical", "unknown"]
    verification: Literal["executable_acceptance", "partial_checks", "human_only", "unknown"]
    urgency: Literal["interactive", "standard", "background", "unknown"]
    prior_failure: Literal["none", "quality_failure", "environment_blocker", "access_or_transport", "unknown"]


class HostModel(StrictObject):
    model: ModelId
    supported_efforts: Annotated[list[Effort], Field(max_length=6, json_schema_extra={"uniqueItems": True})]
    modalities: Annotated[list[Modality], Field(max_length=2, json_schema_extra={"uniqueItems": True})]
    context_fit: Literal["fits", "exceeds", "unknown"]
    tools_compatible: Literal["yes", "no", "unknown"]
    access: Literal["advertised", "recently_succeeded", "denied"]

    @model_validator(mode="after")
    def unique_values(self) -> "HostModel":
        if len(set(self.supported_efforts)) != len(self.supported_efforts):
            raise ValueError("duplicate_efforts")
        if len(set(self.modalities)) != len(self.modalities):
            raise ValueError("duplicate_modalities")
        return self


class Host(StrictObject):
    native_spawn_available: StrictBool
    model_effort_overrides_available: StrictBool
    catalog_source: Literal["native_tool_schema", "app_server", "fixture"]
    models: Annotated[list[HostModel], Field(max_length=3)]
    required_modalities: Annotated[list[Modality], Field(min_length=1, max_length=2, json_schema_extra={"uniqueItems": True})]
    environment_ready: StrictBool

    @model_validator(mode="after")
    def unique_values(self) -> "Host":
        if len({entry.model for entry in self.models}) != len(self.models):
            raise ValueError("duplicate_models")
        if len(set(self.required_modalities)) != len(self.required_modalities):
            raise ValueError("duplicate_modalities")
        return self


class RouteRequest(StrictObject):
    features: Features
    host: Host
    privacy: Literal["non_sensitive", "sensitive", "phi", "unknown"]
    optimization_goal: Literal["balanced", "quality", "economy"] = "balanced"
    attempt: Annotated[StrictInt, Field(ge=0, le=1)] = 0
    previous_preset: PresetId | None = None


class Policy(StrictObject):
    schema_version: Literal[1] = 1
    mode: Literal["offline", "live"] = "offline"
    allowed_presets: Annotated[list[PresetId], Field(max_length=6, json_schema_extra={"uniqueItems": True})] = Field(
        default_factory=lambda: list(ALL_PRESETS))
    live_requests_authorized: StrictBool = False
    max_api_calls_per_process: Annotated[StrictInt, Field(ge=1, le=100)] | None = None
    deadline_ms: Annotated[StrictInt, Field(ge=100, le=1000)] = 1000
    min_confidence: Annotated[float, Field(ge=0, le=1)] = 0.80

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value):
        if type(value) is not int or value != 1:
            raise ValueError("invalid_schema_version")
        return value

    @model_validator(mode="after")
    def coherent(self) -> "Policy":
        if len(set(self.allowed_presets)) != len(self.allowed_presets):
            raise ValueError("duplicate_presets")
        if self.mode == "live":
            if not self.live_requests_authorized or not self.allowed_presets:
                raise ValueError("live_authorization_required")
            if "allowed_presets" not in self.model_fields_set:
                raise ValueError("explicit_live_allowlist_required")
            if self.max_api_calls_per_process is None:
                raise ValueError("live_call_limit_required")
        elif self.live_requests_authorized:
            raise ValueError("offline_live_authorization_conflict")
        return self


class Selection(StrictObject):
    preset_id: PresetId
    model: ModelId
    reasoning_effort: Effort


class RouteResult(StrictObject):
    schema_version: Literal[1] = 1
    status: Literal["recommended", "fallback", "blocked", "unsupported"]
    source: Literal["decisions", "cache", "local_policy", "single_candidate", "fixture", "none"]
    mode: Literal["offline", "live"]
    selected: Selection | None
    reason_code: ReasonCode
    confidence: Annotated[float, Field(ge=0, le=1)] | None = None
    latency_ms: Annotated[float, Field(ge=0)]
    api_called: StrictBool
    applied: Literal[False] = False
    warnings: list[WarningCode] = Field(default_factory=list)
