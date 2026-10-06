"""Offline schema and semantic checks; not an installation/discovery claim."""

import json
from pathlib import Path

import jsonschema

ROOT = Path(__file__).resolve().parents[1]


def validate_package(root: Path = ROOT) -> dict:
    for stem in ("plugin", "mcp"):
        schema = json.loads((root / "docs/schemas" / (stem + ".schema.json")).read_text())
        jsonschema.Draft202012Validator.check_schema(schema)
        jsonschema.Draft202012Validator(schema).validate(json.loads((root / (stem + ".json")).read_text()))
    plugin = json.loads((root / "plugin.json").read_text())
    mcp = json.loads((root / "mcp.json").read_text())
    legacy = json.loads((root / ".codex-plugin/plugin.json").read_text())
    expected = {key: value for key, value in plugin.items() if key != "$schema"}
    expected.update(skills="./skills/", mcpServers="./.mcp.json")
    assert legacy == expected, "compatibility identity mismatch"
    for component in (legacy["skills"], legacy["mcpServers"]):
        path = (root / component).resolve()
        assert path.is_relative_to(root.resolve()) and path.exists(), "unsafe component path"
    legacy_mcp = json.loads((root / ".mcp.json").read_text())
    expected_servers = {name: {key: value for key, value in spec.items() if key != "type"}
                        for name, spec in mcp["mcpServers"].items()}
    assert legacy_mcp == {"mcpServers": expected_servers}, "compatibility MCP mismatch"
    assert not any(path.is_symlink() for path in root.rglob("*")), "symlink not allowed in bundle"
    assert (root / "skills/route-delegated-task/SKILL.md").is_file(), "skill missing"
    skill = (root / "skills/route-delegated-task/SKILL.md").read_text()
    assert skill.startswith("---\nname: route-delegated-task\n"), "invalid skill identity"
    assert "source=fixture" in skill and "application is unverified" in skill, "host safety guidance missing"
    return {"portable_schema_validation": "passed", "local_semantic_validation": "passed",
            "legacy_validation": "derived-equivalence, not independent official schema",
            "installed": False, "host_discovery_verified": False}


if __name__ == "__main__":
    print(json.dumps(validate_package(), indent=2))
