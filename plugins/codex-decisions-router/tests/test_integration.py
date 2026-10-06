import asyncio
import json
import os
import sys
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path

import jsonschema
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from codex_decisions_router.catalog import CatalogError, discover_catalog, sanitize_models
from codex_decisions_router.models import RouteResult
from helpers import ROOT, request_dict


class MCPIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_sdk_stdio_initialize_list_call_and_redacted_errors(self):
        params = StdioServerParameters(command=sys.executable,
                                       args=["-m", "codex_decisions_router", "serve"],
                                       env={"PYTHONPATH": str(ROOT / "src")}, cwd=str(ROOT))
        with tempfile.TemporaryFile(mode="w+") as errors:
            async with stdio_client(params, errlog=errors) as (read, write):
                async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=5)) as session:
                    initialized = await session.initialize()
                    self.assertEqual(initialized.serverInfo.name, "codex-decisions-router")
                    self.assertIsNone(initialized.capabilities.resources)
                    self.assertIsNone(initialized.capabilities.prompts)
                    listed = await session.list_tools()
                    self.assertEqual(len(listed.tools), 1)
                    tool = listed.tools[0]
                    self.assertEqual(tool.name, "route_task")
                    self.assertFalse(tool.inputSchema["additionalProperties"])
                    self.assertTrue(tool.annotations.openWorldHint)
                    self.assertFalse(tool.annotations.idempotentHint)
                    called = await session.call_tool("route_task", request_dict())
                    self.assertFalse(called.isError)
                    result = RouteResult.model_validate(called.structuredContent)
                    self.assertFalse(result.api_called)
                    self.assertFalse(result.applied)
                    jsonschema.validate(result.model_dump(), tool.outputSchema)
                    self.assertIn("settings not applied", called.content[0].text)
                    for data in (request_dict(secret="NEVER_ECHO"), request_dict(attempt=True)):
                        rejected = await session.call_tool("route_task", data)
                        self.assertTrue(rejected.isError)
                        self.assertEqual(rejected.content[0].text, "invalid_input")
                    data = request_dict()
                    data["features"]["task_kind"] = "inspect; NEVER_ECHO"
                    rejected = await session.call_tool("route_task", data)
                    self.assertEqual(rejected.content[0].text, "invalid_input")
                    self.assertTrue((await session.call_tool("unknown", {})).isError)
            errors.seek(0)
            self.assertNotIn("NEVER_ECHO", errors.read())


class CatalogIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_fake_process_handshake_paging_no_threads_or_turns(self):
        with tempfile.TemporaryDirectory() as directory:
            script = Path(directory) / "fake.py"
            log = Path(directory) / "methods.json"
            script.write_text('''import json,sys
from pathlib import Path
methods=[]
for line in sys.stdin:
    req=json.loads(line); methods.append(req['method'])
    Path(sys.argv[1]).write_text(json.dumps(methods))
    if req['method']=='initialized': continue
    if req['method']=='initialize': result={'userAgent':'fake'}
    elif req['method']=='model/list':
        model='gpt-6.1-sol' if req['params']['cursor'] is None else 'gpt-6-astra'
        result={'data':[{'model':model,'supportedReasoningEfforts':[{'reasoningEffort':'medium','description':'unused'},{'reasoningEffort':'future-effort','description':'unused'}],'inputModalities':['text','audio']}], 'nextCursor':'page2' if req['params']['cursor'] is None else None}
    else: raise AssertionError('unapproved method')
    print(json.dumps({'jsonrpc':'2.0','id':req['id'],'result':result}),flush=True)
''')
            value = await discover_catalog([sys.executable, str(script), str(log)], isolated=True)
            self.assertFalse(value["entitlement_verified"])
            self.assertTrue(value["read_only"])
            self.assertEqual(len(value["models"]), 2)
            self.assertEqual(value["models"][0]["supported_efforts"], ["medium"])
            self.assertEqual(value["models"][0]["modalities"], ["text"])
            self.assertEqual(json.loads(log.read_text()), ["initialize", "initialized", "model/list", "model/list"])

    async def test_bad_process_redacts_error(self):
        with self.assertRaises(CatalogError) as caught:
            await discover_catalog([sys.executable, "-c", "print('NEVER_ECHO')"], isolated=True)
        self.assertEqual(str(caught.exception), "catalog_unavailable")

    async def test_catalog_does_not_guess_modalities_or_entitlement(self):
        result = sanitize_models([{"model": "gpt-6.1-sol", "supportedReasoningEfforts": [{"reasoningEffort": "max"}]}])
        self.assertEqual(result[0].supported_efforts, ["max"])
        self.assertEqual(result[0].modalities, [])
        self.assertEqual(result[0].access, "advertised")
        self.assertEqual(result[0].tools_compatible, "unknown")


class RawProtocolPrivacyTests(unittest.IsolatedAsyncioTestCase):
    async def test_malformed_envelopes_notifications_and_json_never_echo_values(self):
        marker = "SYNTHETIC_SENSITIVE_MARKER"
        process = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "codex_decisions_router", "serve",
            env={"PYTHONPATH": str(ROOT / "src")}, cwd=ROOT,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        responses = []

        async def send(value):
            process.stdin.write((json.dumps(value) + "\n").encode())
            await process.stdin.drain()

        async def receive_id(expected):
            for _ in range(20):
                raw = await asyncio.wait_for(process.stdout.readline(), 5)
                self.assertTrue(raw)
                responses.append(raw.decode())
                value = json.loads(raw)
                if value.get("id") == expected:
                    return value
            self.fail("missing protocol response")

        try:
            await send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                "protocolVersion": "2025-11-25", "capabilities": {},
                "clientInfo": {"name": "raw-safety-test", "version": "1"}}})
            await receive_id(1)
            await send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            for identifier, params in ((2, {"name": "route_task", "arguments": marker}),
                                       (3, {"name": 7, "arguments": {"secret": marker}})):
                await send({"jsonrpc": "2.0", "id": identifier, "method": "tools/call", "params": params})
                value = await receive_id(identifier)
                self.assertEqual(value["error"]["code"], -32602)
            await send({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"secret": marker}})
            process.stdin.write(('invalid-json-' + marker + "\n").encode())
            await process.stdin.drain()
            await send({"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                        "params": {"name": "route_task", "arguments": request_dict()}})
            value = await receive_id(4)
            self.assertFalse(value["result"].get("isError", False))
            self.assertFalse(value["result"]["structuredContent"]["api_called"])
            for identifier, method, params in ((5, "resources/read", {"uri": "secret://" + marker}),
                                               (6, "prompts/get", {"name": marker})):
                await send({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params})
                value = await receive_id(identifier)
                self.assertEqual(value["error"]["code"], -32601)
            process.stdin.close()
            await asyncio.wait_for(process.wait(), 5)
            remaining = await process.stdout.read()
            errors = await process.stderr.read()
            self.assertNotIn(marker, "".join(responses) + remaining.decode())
            self.assertNotIn(marker, errors.decode())
            self.assertIn("protocol_diagnostic_redacted", errors.decode())
            self.assertEqual(process.returncode, 0)
        finally:
            if process.returncode is None:
                process.kill()
                await process.wait()
