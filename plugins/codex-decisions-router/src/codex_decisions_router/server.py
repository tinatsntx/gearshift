"""Official FastMCP stdio transport with a redacted, exact input-schema boundary."""

from contextlib import asynccontextmanager
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent, Tool, ToolAnnotations
from pydantic import ValidationError

from .models import RouteRequest, RouteResult
from .router import Router
from .privacy_logging import configure_redacted_logging

DESCRIPTION = (
    "Recommend compatible model and reasoning settings only; never execute or authorize tasks. "
    "Explicitly authorized live mode may make one paid external Decisions classification call. "
    "Offline fixture results are simulation only."
)


class RouterMCP(FastMCP):
    """Use SDK protocol machinery; avoid FastMCP's coercion and value-bearing errors."""

    def __init__(self, router: Router):
        configure_redacted_logging()
        self.router = router
        @asynccontextmanager
        async def lifespan(server):
            try:
                yield router
            finally:
                await router.aclose()

        super().__init__(name="codex-decisions-router", log_level="WARNING", lifespan=lifespan)

    def _setup_handlers(self) -> None:
        # Register only the requested tool surface. Unused FastMCP resource/prompt
        # handlers can otherwise reflect arbitrary unknown URI/name values.
        self._mcp_server.list_tools()(self.list_tools)
        self._mcp_server.call_tool(validate_input=False)(self.call_tool)

    async def list_tools(self) -> list[Tool]:
        return [Tool(
            name="route_task", description=DESCRIPTION,
            inputSchema=RouteRequest.model_json_schema(),
            outputSchema=RouteResult.model_json_schema(),
            annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False,
                                        idempotentHint=False, openWorldHint=True),
        )]

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        if name != "route_task":
            return CallToolResult(isError=True, content=[TextContent(type="text", text="unknown_tool")])
        try:
            request = RouteRequest.model_validate(arguments)
        except (ValidationError, ValueError, TypeError):
            return CallToolResult(isError=True, content=[TextContent(type="text", text="invalid_input")])
        try:
            value = await self.router.route(request)
        except Exception:
            return CallToolResult(isError=True, content=[TextContent(type="text", text="routing_error")])
        summary = f"{value.status}: {value.reason_code}; settings not applied"
        if value.source == "fixture":
            summary += "; simulation only"
        return CallToolResult(content=[TextContent(type="text", text=summary)],
                              structuredContent=value.model_dump(mode="json"), isError=False)
