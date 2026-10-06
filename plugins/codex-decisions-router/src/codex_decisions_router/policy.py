"""Hand-authored workload priors, not empirically established rankings."""

from dataclasses import dataclass

from .models import Effort, ModelId, Policy, PresetId, RouteRequest, Selection, WarningCode


@dataclass(frozen=True)
class Preset:
    id: PresetId
    model: ModelId
    effort: Effort
    description: str

    def selection(self) -> Selection:
        return Selection(preset_id=self.id, model=self.model, reasoning_effort=self.effort)


PRESETS = (
    Preset("luna_fast", "gpt-6-luna", "low", "Small mechanical or inspection tasks with clear acceptance; low reasoning."),
    Preset("luna_careful", "gpt-6-luna", "high", "Focused bounded work with checking; high reasoning."),
    Preset("sol_balanced", "gpt-6.1-sol", "medium", "General implementation and reproducible debugging; medium reasoning."),
    Preset("sol_deep", "gpt-6.1-sol", "xhigh", "Coupled changes, ambiguous investigations and demanding reviews; extra-high reasoning."),
    Preset("astra_balanced", "gpt-6-astra", "medium", "Ambiguous architecture and broader reasoning; medium reasoning."),
    Preset("astra_deep", "gpt-6-astra", "xhigh", "Most demanding eligible cross-system problems; extra-high reasoning."),
)
BY_ID = {preset.id: preset for preset in PRESETS}
TIER = {preset.id: index for index, preset in enumerate(PRESETS)}
FALLBACK_ORDER = ("sol_balanced", "sol_deep", "astra_balanced", "astra_deep", "luna_careful", "luna_fast")
DEEP_ORDER = ("sol_deep", "astra_balanced", "astra_deep")


def eligible(request: RouteRequest, policy: Policy) -> tuple[Preset, ...]:
    hosts = {item.model: item for item in request.host.models}
    critical = request.features.consequence == "critical"
    failed = request.features.prior_failure == "quality_failure"
    minimum = TIER[request.previous_preset] + 1 if request.attempt and request.previous_preset else 0
    results = []
    for preset in PRESETS:
        host = hosts.get(preset.model)
        if preset.id not in policy.allowed_presets or host is None:
            continue
        if preset.effort not in host.supported_efforts or host.access == "denied":
            continue
        if host.context_fit == "exceeds" or host.tools_compatible == "no":
            continue
        if not set(request.host.required_modalities).issubset(host.modalities):
            continue
        if (critical or failed) and preset.id not in DEEP_ORDER:
            continue
        if TIER[preset.id] < minimum:
            continue
        results.append(preset)
    return tuple(results)


def fallback(request: RouteRequest, candidates: tuple[Preset, ...]) -> Preset | None:
    order = DEEP_ORDER if (request.features.consequence == "critical" or
                           request.features.prior_failure == "quality_failure") else FALLBACK_ORDER
    choices = {candidate.id: candidate for candidate in candidates}
    return next((choices[value] for value in order if value in choices), None)


def warnings(request: RouteRequest, selected: Preset | None) -> list[WarningCode]:
    if selected is None:
        return []
    host = next(item for item in request.host.models if item.model == selected.model)
    values: list[WarningCode] = []
    if host.access == "advertised":
        values.append("access_unverified")
    if host.context_fit == "unknown":
        values.append("context_unverified")
    if host.tools_compatible == "unknown":
        values.append("tools_unverified")
    return values
