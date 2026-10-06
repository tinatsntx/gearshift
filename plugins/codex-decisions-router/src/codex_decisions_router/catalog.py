"""Read-only app-server discovery. No login, credential-file reads, threads or turns."""

import asyncio
import contextlib
import json
import os
import tempfile
from typing import Any

from .decisions import InvalidResponse, strict_json
from .models import Effort, HostModel, Modality, ModelId

MODEL_IDS: tuple[ModelId, ...] = ("gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra")
EFFORTS: tuple[Effort, ...] = ("low", "medium", "high", "xhigh", "max", "ultra")
MODALITIES: tuple[Modality, ...] = ("text", "image")
MAX_PAGES = 10
MAX_LINE_BYTES = 1024 * 1024


class CatalogError(Exception):
    def __init__(self):
        super().__init__("catalog_unavailable")


def sanitize_models(data: list[Any]) -> list[HostModel]:
    results = {}
    for item in data:
        if not isinstance(item, dict) or item.get("model") not in MODEL_IDS:
            continue
        model = item["model"]
        raw_efforts = item.get("supportedReasoningEfforts", [])
        efforts = [effort for effort in EFFORTS if any(
            isinstance(option, dict) and option.get("reasoningEffort") == effort
            for option in raw_efforts)] if isinstance(raw_efforts, list) else []
        raw_modalities = item.get("inputModalities", [])
        modalities = [value for value in MODALITIES if value in raw_modalities] if isinstance(raw_modalities, list) else []
        entry = HostModel(model=model, supported_efforts=efforts, modalities=modalities,
                          context_fit="unknown", tools_compatible="unknown", access="advertised")
        if model in results and results[model] != entry:
            raise CatalogError()  # Ambiguous provider aliases must not silently broaden eligibility.
        results[model] = entry
    return list(results.values())


async def discover_catalog(command: list[str], *, isolated: bool = False) -> dict[str, Any]:
    """Command is a trusted CLI-only parameter, never an MCP/model-controlled input."""
    process = None
    temporary = tempfile.TemporaryDirectory(prefix="router-catalog-") if isolated else None
    try:
        environment = None
        if temporary:
            # Empty profile also excludes inherited API/provider credential variables.
            environment = {"PATH": os.environ.get("PATH", os.defpath), "LANG": "C.UTF-8",
                           "HOME": temporary.name, "CODEX_HOME": temporary.name}
        process = await asyncio.create_subprocess_exec(
            *command, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL, env=environment, limit=MAX_LINE_BYTES,
        )
        assert process.stdin is not None and process.stdout is not None
        sequence = 0

        async def write(value: dict[str, Any]) -> None:
            process.stdin.write((json.dumps(value, separators=(",", ":")) + "\n").encode())
            await process.stdin.drain()

        async def rpc(method: str, params: dict[str, Any]) -> Any:
            nonlocal sequence
            sequence += 1
            await write({"jsonrpc": "2.0", "id": sequence, "method": method, "params": params})
            for _ in range(100):
                line = await process.stdout.readline()
                if not line or len(line) > MAX_LINE_BYTES:
                    raise CatalogError()
                response = strict_json(line)
                if not isinstance(response, dict):
                    raise CatalogError()
                if "method" in response and "id" in response:
                    raise CatalogError()  # Never grant an unsolicited approval/auth request.
                if response.get("id") == sequence:
                    if "error" in response or "result" not in response:
                        raise CatalogError()
                    return response["result"]
            raise CatalogError()

        async with asyncio.timeout(10):
            await rpc("initialize", {
                "clientInfo": {"name": "decisions-router-catalog", "version": "0.1.0"},
                "capabilities": {"explicitGatewayOauth": True},
            })
            await write({"jsonrpc": "2.0", "method": "initialized"})
            cursor = None
            cursors = set()
            entries = []
            for _ in range(MAX_PAGES):
                page = await rpc("model/list", {"cursor": cursor, "limit": 100, "includeHidden": False})
                if not isinstance(page, dict) or not isinstance(page.get("data"), list):
                    raise CatalogError()
                entries.extend(page["data"])
                if len(entries) > 1000:
                    raise CatalogError()
                cursor = page.get("nextCursor")
                if cursor is None:
                    break
                if type(cursor) is not str or len(cursor) > 4096 or cursor in cursors:
                    raise CatalogError()
                cursors.add(cursor)
            else:
                raise CatalogError()
        return {
            "catalog_source": "app_server", "read_only": True,
            "entitlement_verified": False, "isolated_profile": isolated,
            "models": [item.model_dump() for item in sanitize_models(entries)],
            "native_spawn_capability_verified": False,
        }
    except (OSError, ValueError, TimeoutError, CatalogError, InvalidResponse):
        raise CatalogError() from None
    finally:
        if process:
            if process.stdin:
                process.stdin.close()
            if process.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 1.0)
                except TimeoutError:
                    with contextlib.suppress(ProcessLookupError):
                        process.kill()
                    await process.wait()
        if temporary:
            temporary.cleanup()
