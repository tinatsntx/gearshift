"""Produce a contained local marketplace ZIP and content-addressed review snapshot."""

import hashlib
import json
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT.parent / "codex-router-artifacts"
EXCLUDED = {"__pycache__", "build", "dist", ".git", ".venv"}


def sources():
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if any(part in EXCLUDED or part.endswith(".egg-info") for part in relative.parts):
            continue
        if path.is_file():
            assert not path.is_symlink(), "symlink not allowed"
            yield path, relative


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    ARTIFACTS.mkdir(exist_ok=True)
    manifest = {str(relative): checksum(path) for path, relative in sources()}
    digest = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    snapshot = ARTIFACTS / ("review-" + digest[:16] + ".tar.gz")
    if not snapshot.exists():
        with tarfile.open(snapshot, "w:gz") as archive:
            for path, relative in sources():
                archive.add(path, arcname=str(Path("codex-decisions-router") / relative), recursive=False)
    manifest_path = snapshot.with_suffix("").with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps({"source_manifest_sha256": digest, "files": manifest}, indent=2) + "\n")
    marketplace = {"name": "decisions-router-local", "plugins": [{
        "name": "codex-decisions-router", "source": {"source": "local", "path": "./plugins/codex-decisions-router"},
        "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Productivity",
    }]}
    bundle = ARTIFACTS / ("codex-decisions-router-0.1.0-" + digest[:16] + ".zip")
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(".agents/plugins/marketplace.json", json.dumps(marketplace, indent=2) + "\n")
        for path, relative in sources():
            archive.write(path, str(Path("plugins/codex-decisions-router") / relative))
        for path in sorted((ROOT / "dist").glob("*")):
            if path.is_file():
                archive.write(path, str(Path("packages") / path.name))
    for path in (snapshot, manifest_path, bundle):
        path.chmod(0o444)
    report = {"source_digest": digest, "review_snapshot": str(snapshot), "review_snapshot_sha256": checksum(snapshot),
              "source_manifest": str(manifest_path), "installable_bundle": str(bundle),
              "installable_bundle_sha256": checksum(bundle), "installed": False}
    (ARTIFACTS / "latest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
