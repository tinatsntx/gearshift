import importlib.util
import json
import unittest

from codex_decisions_router.decisions import FixtureProvider
from codex_decisions_router.router import Router
from helpers import ROOT, answer, request


def script(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PackageTests(unittest.TestCase):
    def test_official_portable_schemas_and_derived_compatibility(self):
        result = script("validate_package").validate_package()
        self.assertEqual(result["portable_schema_validation"], "passed")
        self.assertFalse(result["installed"])


class HostSimulationTests(unittest.IsolatedAsyncioTestCase):
    async def test_fake_host_exact_pair_original_task_and_permissions(self):
        result = await Router(provider=FixtureProvider(answer())).route(request())
        task = {"task": "synthetic", "sandbox": "read-only", "approval": "required"}
        module = script("simulate_host")
        with self.assertRaises(ValueError):
            module.simulated_apply(result, task)
        simulated = module.simulated_apply(result, task, simulation=True)
        self.assertEqual(simulated["requested"], {"model": result.selected.model,
                                                "reasoning_effort": result.selected.reasoning_effort})
        self.assertEqual(simulated["task"], task)
        self.assertEqual(simulated["effective"], simulated["requested"])
        self.assertEqual(simulated["application"], "simulated")
        self.assertFalse(simulated["actual_child_created"])
        self.assertFalse(result.applied)

    async def test_explicit_pin_bypasses_tool_in_documented_host_flow(self):
        # Contract check of the host guidance, not a claim that the host invokes it.
        skill = (ROOT / "skills/route-delegated-task/SKILL.md").read_text()
        self.assertIn("explicit pin bypasses classification", skill)
        self.assertIn("max/ultra", skill)
        self.assertIn("rather than substituting", skill)
        self.assertIn("explicit full-history requirement", skill)


class EvaluationFixtureTests(unittest.IsolatedAsyncioTestCase):
    async def test_offline_policy_fixtures_not_coding_quality_evidence(self):
        matrix = json.loads((ROOT / "fixtures/evaluation.json").read_text())
        self.assertTrue(matrix["simulation_only"])
        self.assertFalse(matrix["quality_evidence"])
        for case in matrix["cases"]:
            data = json.loads((ROOT / "fixtures/request.json").read_text())
            data["features"] = case["features"]
            from codex_decisions_router.models import RouteRequest
            result = await Router().route(RouteRequest.model_validate(data))
            self.assertEqual(result.selected.preset_id, case["expected_local"])
            self.assertEqual(result.source, "fixture")
            self.assertFalse(result.api_called)
