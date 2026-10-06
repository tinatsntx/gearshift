import math
import unittest

from pydantic import ValidationError

from codex_decisions_router.models import Policy, RouteRequest
from codex_decisions_router.policy import BY_ID, PRESETS, eligible, fallback, warnings
from helpers import clone, live_policy, request, request_dict


class InputTests(unittest.TestCase):
    def reject(self, data):
        with self.assertRaises(ValidationError) as caught:
            RouteRequest.model_validate(data)
        self.assertNotIn("NEVER_ECHO", str(caught.exception))

    def test_defaults_and_unknown(self):
        value = request()
        self.assertEqual(value.optimization_goal, "balanced")
        self.assertEqual(value.attempt, 0)
        data = request_dict()
        data["features"] = {key: "unknown" for key in data["features"]}
        self.assertEqual(RouteRequest.model_validate(data).features.scope, "unknown")

    def test_missing_each_field(self):
        data = request_dict()
        for key in data["features"]:
            changed = clone(data)
            del changed["features"][key]
            self.reject(changed)
        for key in ("features", "host", "privacy"):
            changed = clone(data)
            del changed[key]
            self.reject(changed)

    def test_extra_fields_at_every_boundary(self):
        for level in ("root", "features", "host", "models"):
            data = request_dict()
            target = data if level == "root" else data[level] if level != "models" else data["host"]["models"][0]
            target["secret"] = "NEVER_ECHO"
            self.reject(data)
        for key in ("code", "path", "prompt", "phi", "endpoint", "api_key", "timeout", "policy"):
            self.reject(request_dict(**{key: "NEVER_ECHO"}))

    def test_wrong_types_and_prompt_like_enum(self):
        for value in (True, False, 1.0, "1", -1, 2):
            self.reject(request_dict(attempt=value))
        for value in (1, "true", None):
            data = request_dict()
            data["host"]["native_spawn_available"] = value
            self.reject(data)
        data = request_dict()
        data["features"]["task_kind"] = "inspect; NEVER_ECHO"
        self.reject(data)

    def test_duplicates_and_limits(self):
        for field in ("supported_efforts", "modalities"):
            data = request_dict()
            values = data["host"]["models"][0][field]
            values.append(values[0])
            self.reject(data)
        data = request_dict()
        data["host"]["models"].append(clone(data["host"]["models"][0]))
        self.reject(data)
        data = request_dict()
        data["host"]["required_modalities"] = ["text", "text"]
        self.reject(data)
        data["host"]["required_modalities"] = []
        self.reject(data)

    def test_policy_live_gates(self):
        for data in ({"mode": "live"}, {"mode": "live", "live_requests_authorized": True},
                     {"mode": "live", "live_requests_authorized": True, "max_api_calls_per_process": 1},
                     {"live_requests_authorized": True}, {"deadline_ms": 1001},
                     {"deadline_ms": True}, {"min_confidence": math.nan},
                     {"allowed_presets": ["sol_balanced", "sol_balanced"]},
                     {"api_key": "NEVER_ECHO"}):
            with self.assertRaises(ValidationError):
                Policy.model_validate(data)
        self.assertEqual(live_policy().mode, "live")
        with self.assertRaises(ValidationError):
            live_policy(allowed_presets=[])

    def test_every_input_object_forbids_extras(self):
        schema = RouteRequest.model_json_schema()
        self.assertFalse(schema["additionalProperties"])
        for definition in schema["$defs"].values():
            if definition.get("type") == "object":
                self.assertFalse(definition["additionalProperties"])


class PolicyTests(unittest.TestCase):
    def test_each_preset_intersects_constraints(self):
        for preset in PRESETS:
            for constraint in ("missing_model", "missing_effort", "modality", "context", "tool", "access", "allowlist"):
                data = request_dict()
                model = next(item for item in data["host"]["models"] if item["model"] == preset.model)
                policy = Policy()
                if constraint == "missing_model":
                    data["host"]["models"].remove(model)
                elif constraint == "missing_effort":
                    model["supported_efforts"].remove(preset.effort)
                elif constraint == "modality":
                    data["host"]["required_modalities"] = ["image"]
                    model["modalities"] = ["text"]
                elif constraint == "context":
                    model["context_fit"] = "exceeds"
                elif constraint == "tool":
                    model["tools_compatible"] = "no"
                elif constraint == "access":
                    model["access"] = "denied"
                else:
                    policy = Policy(allowed_presets=[item.id for item in PRESETS if item.id != preset.id])
                with self.subTest(preset=preset.id, constraint=constraint):
                    self.assertNotIn(preset, eligible(RouteRequest.model_validate(data), policy))

    def test_critical_floor_and_fallback(self):
        data = request_dict()
        data["features"]["consequence"] = "critical"
        value = RouteRequest.model_validate(data)
        candidates = eligible(value, Policy())
        self.assertEqual([item.id for item in candidates], ["sol_deep", "astra_balanced", "astra_deep"])
        self.assertEqual(fallback(value, candidates).id, "sol_deep")
        self.assertEqual(fallback(request(), eligible(request(), Policy())).id, "sol_balanced")

    def test_quality_escalation_and_warnings(self):
        data = request_dict(attempt=1, previous_preset="sol_deep")
        data["features"]["prior_failure"] = "quality_failure"
        value = RouteRequest.model_validate(data)
        self.assertEqual([item.id for item in eligible(value, Policy())], ["astra_balanced", "astra_deep"])
        data["host"]["models"][1].update(context_fit="unknown", tools_compatible="unknown")
        self.assertEqual(warnings(RouteRequest.model_validate(data), BY_ID["sol_deep"]),
                         ["access_unverified", "context_unverified", "tools_unverified"])
