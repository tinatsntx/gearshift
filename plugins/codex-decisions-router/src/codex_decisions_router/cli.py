"""Offline by default. Live policy and process opt-in are independent gates."""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from pydantic import ValidationError

from .catalog import CatalogError, discover_catalog
from .decisions import DecisionsHTTPProvider, InvalidResponse, strict_json
from .models import Policy, RouteRequest, RouteResult
from .router import Router
from .privacy_logging import configure_redacted_logging

MAX_LOCAL_FILE_BYTES = 16384


def load_object(path: str) -> dict:
    # CLI-local only; no tool takes a path. Bound reads before JSON parsing.
    with Path(path).open("rb") as stream:
        data = stream.read(MAX_LOCAL_FILE_BYTES + 1)
    if len(data) > MAX_LOCAL_FILE_BYTES:
        raise ValueError("local_file_too_large")
    value = strict_json(data)
    if not isinstance(value, dict):
        raise ValueError("invalid_local_object")
    return value


def configured_router(policy_path: str | None, enable_live: bool = False) -> Router:
    policy = Policy.model_validate(load_object(policy_path)) if policy_path else Policy()
    if policy.mode == "live":
        if not policy_path or not enable_live:
            raise ValueError("explicit_live_start_required")
        # This branch alone reads a later-authorized process key; never Codex token files.
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise ValueError("live_auth_missing")
        return Router(policy, DecisionsHTTPProvider(key))
    if enable_live:
        raise ValueError("live_policy_required")
    return Router(policy)


def main() -> int:
    parser = argparse.ArgumentParser(description="Recommendation-only Codex routing; offline by default")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="Official MCP stdio server; no task execution")
    serve.add_argument("--policy", help="Explicit trusted policy file; never auto-loaded")
    serve.add_argument("--enable-live", action="store_true", help="Later-authorized live process opt-in")
    route = sub.add_parser("route", help="Offline recommendation from an explicit enum-only request file")
    route.add_argument("--request", required=True)
    route.add_argument("--policy")
    sub.add_parser("schemas", help="Print exact tool input, output and policy JSON Schemas")
    catalog = sub.add_parser("catalog", help="Read-only Codex app-server model catalog, not an entitlement test")
    catalog.add_argument("--isolated", action="store_true", help="Use an empty temporary CODEX_HOME; no credentials")
    args = parser.parse_args()
    configure_redacted_logging()
    try:
        if args.command == "schemas":
            print(json.dumps({"input": RouteRequest.model_json_schema(),
                              "output": RouteResult.model_json_schema(),
                              "policy": Policy.model_json_schema()}, indent=2))
        elif args.command == "catalog":
            print(json.dumps(asyncio.run(discover_catalog(["codex", "app-server"], isolated=args.isolated)), indent=2))
        elif args.command == "serve":
            from .server import RouterMCP

            router = configured_router(args.policy, args.enable_live)
            RouterMCP(router).run(transport="stdio")
        else:
            router = configured_router(args.policy)
            if router.mode != "offline":
                raise ValueError("route_cli_offline_only")
            request = RouteRequest.model_validate(load_object(args.request))
            print(asyncio.run(router.route(request)).model_dump_json(indent=2))
    except (OSError, ValidationError, ValueError, InvalidResponse, CatalogError):
        print("configuration_or_input_invalid", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
