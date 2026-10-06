import copy
import json
from pathlib import Path

from codex_decisions_router.models import Policy, RouteRequest
from codex_decisions_router.policy import PRESETS

ROOT = Path(__file__).resolve().parents[1]


def request_dict(**overrides):
    value = json.loads((ROOT / "fixtures/request.json").read_text())
    value["host"]["catalog_source"] = "native_tool_schema"
    value.update(overrides)
    return value


def request(**overrides):
    return RouteRequest.model_validate(request_dict(**overrides))


def answer(choice="sol_balanced", confidence=0.9, candidates=PRESETS):
    data = json.loads((ROOT / "fixtures/decision.mock.json").read_text())
    data["answers"][0].update(choice=choice, confidence=confidence, probabilities=[
        {"value": item.id, "probability": 1.0 if item.id == choice else 0.0}
        for item in candidates] + [{"value": "abstain", "probability": 1.0 if choice == "abstain" else 0.0}])
    return data


def refusal():
    return json.loads((ROOT / "fixtures/refusal.mock.json").read_text())


def live_policy(**overrides):
    data = {"mode": "live", "allowed_presets": [item.id for item in PRESETS],
            "live_requests_authorized": True, "max_api_calls_per_process": 100}
    data.update(overrides)
    return Policy.model_validate(data)


def clone(value):
    return copy.deepcopy(value)
