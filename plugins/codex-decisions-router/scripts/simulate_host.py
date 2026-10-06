"""Explicitly fake host; no native child/tool process is launched here."""

import asyncio
import copy
import json
from pathlib import Path

from codex_decisions_router.decisions import FixtureProvider
from codex_decisions_router.models import RouteRequest, RouteResult
from codex_decisions_router.router import Router

ROOT = Path(__file__).resolve().parents[1]


def simulated_apply(result: RouteResult, task: dict, *, simulation: bool = False) -> dict:
    if not simulation or result.selected is None or result.status in ("blocked", "unsupported"):
        raise ValueError("real_execution_not_supported")
    original = copy.deepcopy(task)
    requested = {"model": result.selected.model, "reasoning_effort": result.selected.reasoning_effort}
    return {"application": "simulated", "requested": requested, "effective": dict(requested),
            "task": original, "task_preserved": original == task, "actual_child_created": False}


async def demo() -> dict:
    router = Router(provider=FixtureProvider(json.loads((ROOT / "fixtures/decision.mock.json").read_text())))
    request = RouteRequest.model_validate(json.loads((ROOT / "fixtures/request.json").read_text()))
    recommendation = await router.route(request)
    task = {"task": "synthetic acceptance test only", "sandbox": "unchanged", "approval": "unchanged"}
    return {"simulation_only": True, "router_applied": recommendation.applied,
            "host": simulated_apply(recommendation, task, simulation=True)}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(demo()), indent=2))
