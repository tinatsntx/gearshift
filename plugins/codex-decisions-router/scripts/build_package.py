"""Build distributable artifacts with the installed backend; no package installation."""

from pathlib import Path

from setuptools.build_meta import build_sdist, build_wheel

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    print(build_wheel(str(destination)))
    print(build_sdist(str(destination)))
