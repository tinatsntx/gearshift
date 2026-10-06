"""Minimal offline syntax/style lint, not a replacement for Ruff or static typing."""

import ast
import json
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    files = [*ROOT.glob("src/**/*.py"), *ROOT.glob("scripts/*.py"), *ROOT.glob("tests/*.py")]
    for path in files:
        with tokenize.open(path) as stream:
            source = stream.read()
        ast.parse(source, filename=str(path), feature_version=(3, 11))
        assert source.endswith("\n"), "missing final newline"
        assert all(line.rstrip() == line and "\t" not in line for line in source.splitlines()), "whitespace lint failure"
        for node in ast.walk(ast.parse(source)):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                assert node.func.id not in ("eval", "exec"), "dynamic execution forbidden"
    print(json.dumps({"syntax_and_basic_style_lint": "passed", "python_files": len(files),
                      "static_type_checker": "not run; no installed checker"}, indent=2))


if __name__ == "__main__":
    main()
