"""Synthetic offline measurements only; no inference, credential reads or installation."""

import asyncio
import json
import math
import os
import platform
import subprocess
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from codex_decisions_router.decisions import FixtureProvider, build_request, canonical
from codex_decisions_router.models import Policy, RouteRequest
from codex_decisions_router.policy import PRESETS
from codex_decisions_router.router import Router

ROOT = Path(__file__).resolve().parents[1]


def stats(values):
    ordered = sorted(values)
    return {"n": len(values), "p50_ms": round(ordered[math.ceil(len(values) * 0.5) - 1], 4),
            "p95_ms": round(ordered[math.ceil(len(values) * 0.95) - 1], 4),
            "max_ms": round(ordered[-1], 4)}


class SlowFixture(FixtureProvider):
    async def decide(self, body):
        self.calls += 1
        await asyncio.sleep(2)
        return self.response


async def benchmark():
    data = json.loads((ROOT / "fixtures/request.json").read_text())
    request = RouteRequest.model_validate(data)
    response = json.loads((ROOT / "fixtures/decision.mock.json").read_text())
    local = Router()
    cached = Router(provider=FixtureProvider(response))
    await cached.route(request)
    groups = {}
    for name, router in (("warm_core_offline_fallback", local), ("warm_core_fixture_cache", cached)):
        values = []
        for _ in range(1000):
            started = time.perf_counter()
            result = await router.route(RouteRequest.model_validate(data))
            values.append((time.perf_counter() - started) * 1000)
            assert result.api_called is False and result.applied is False
        groups[name] = stats(values)
    cold = []
    environment = {"PATH": os.environ.get("PATH", os.defpath), "PYTHONPATH": str(ROOT / "src"),
                   "LANG": "C.UTF-8"}
    for _ in range(20):
        started = time.perf_counter()
        result = subprocess.run([sys.executable, "-m", "codex_decisions_router", "route", "--request",
                                 str(ROOT / "fixtures/request.json")], cwd=ROOT, env=environment,
                                capture_output=True, check=True, timeout=10)
        cold.append((time.perf_counter() - started) * 1000)
        assert json.loads(result.stdout)["api_called"] is False
    groups["process_cold_cli_offline_including_startup_and_file_read"] = stats(cold)
    timeout_values = []
    for _ in range(5):
        provider = SlowFixture(response)
        router = Router(Policy(deadline_ms=1000), provider)
        started = time.perf_counter()
        result = await router.route(request)
        timeout_values.append((time.perf_counter() - started) * 1000)
        assert result.reason_code == "timeout" and provider.calls == 1
        assert not result.api_called and not result.applied
        await router.aclose()
        await asyncio.sleep(0)
    groups["synthetic_stall_default_1000ms_deadline"] = stats(timeout_values)
    params = StdioServerParameters(command=sys.executable, args=["-m", "codex_decisions_router", "serve"],
                                   env={"PYTHONPATH": str(ROOT / "src")}, cwd=str(ROOT))
    with tempfile.TemporaryFile(mode="w+") as errors:
        cold_start = time.perf_counter()
        async with stdio_client(params, errlog=errors) as (read, write):
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=5)) as session:
                await session.initialize()
                await session.list_tools()
                await session.call_tool("route_task", data)
                groups["mcp_process_cold_first_route_single_sample_ms"] = round((time.perf_counter() - cold_start) * 1000, 4)
                warm = []
                for _ in range(100):
                    started = time.perf_counter()
                    result = await session.call_tool("route_task", data)
                    warm.append((time.perf_counter() - started) * 1000)
                    assert result.structuredContent["api_called"] is False
                groups["warm_mcp_sdk_roundtrip_offline_fallback"] = stats(warm)
    return {"measurement_date_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "simulation_only": True, "real_api_measurements": False, "coding_quality_evaluated": False,
            "machine": {"python": platform.python_version(), "system": platform.system(),
                        "machine": platform.machine(), "processor": platform.processor() or "unknown"},
            "quantile_method": "empirical nearest rank; no tail confidence intervals",
            "scope": "local core includes strict validation; MCP includes SDK roundtrip; cold includes startup; excludes host LLM scheduling, executor launch and coding",
            "synthetic_timeout_rate": 1.0, "fixture_cache_external_api_calls": 0,
            "request_bytes_six_presets": len(canonical(build_request(request, PRESETS)).encode()),
            "input_tokens": None, "measurements": groups}


if __name__ == "__main__":
    print(json.dumps(asyncio.run(benchmark()), indent=2))
