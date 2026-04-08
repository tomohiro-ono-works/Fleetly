from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


DEV_TEST_PACKAGES = {
    "debugpy",
    "iniconfig",
    "playwright",
    "pluggy",
    "pytest",
    "pytest-timeout",
}

NOTEBOOK_PACKAGES = {
    "asttokens",
    "comm",
    "executing",
    "ipykernel",
    "ipython",
    "ipython-pygments-lexers",
    "jedi",
    "jupyter-client",
    "jupyter-core",
    "matplotlib-inline",
    "nest-asyncio",
    "parso",
    "pure-eval",
    "pyzmq",
    "stack-data",
    "tornado",
    "traitlets",
}


NAME_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)")


def normalize_name(name: str) -> str:
    return name.strip().lower().replace("_", "-")


def extract_package_name(line: str) -> str | None:
    text = line.strip()
    if not text or text.startswith("#"):
        return None
    if text.startswith("-e ") and "#egg=" in text:
        return normalize_name(text.split("#egg=", 1)[1])
    match = NAME_RE.match(text)
    if not match:
        return None
    return normalize_name(match.group(1))


def load_freeze_lines(freeze_file: Path | None) -> list[str]:
    if freeze_file:
        return freeze_file.read_text(encoding="utf-8").splitlines()

    completed = subprocess.run(
        [sys.executable, "-m", "pip", "freeze"],
        check=True,
        text=True,
        capture_output=True,
    )
    return completed.stdout.splitlines()


def split_requirements(lines: list[str]) -> tuple[list[str], dict[str, list[str]], dict[str, str]]:
    app_requirements: list[str] = []
    excluded: dict[str, list[str]] = defaultdict(list)
    reasons: dict[str, str] = {}

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("#"):
            continue

        package_name = extract_package_name(line)
        if not package_name:
            app_requirements.append(line)
            continue

        if package_name in DEV_TEST_PACKAGES:
            excluded["dev_test"].append(line)
            reasons[line] = "dev/test"
            continue
        if package_name in NOTEBOOK_PACKAGES:
            excluded["notebook"].append(line)
            reasons[line] = "notebook"
            continue

        app_requirements.append(line)

    app_requirements.sort(key=lambda item: normalize_name(extract_package_name(item) or item))
    for key in excluded:
        excluded[key].sort(key=lambda item: normalize_name(extract_package_name(item) or item))
    return app_requirements, excluded, reasons


def render_requirements_txt(lines: list[str]) -> str:
    body = "\n".join(lines).rstrip()
    return f"{body}\n" if body else ""


def render_requirements_dev_txt(excluded: dict[str, list[str]]) -> str:
    sections: list[str] = ["-r requirements.txt", ""]

    if excluded.get("dev_test"):
        sections.append("# development / test")
        sections.extend(excluded["dev_test"])
        sections.append("")

    if excluded.get("notebook"):
        sections.append("# notebook / interactive")
        sections.extend(excluded["notebook"])
        sections.append("")

    return "\n".join(sections).rstrip() + "\n"


def print_summary(app_requirements: list[str], excluded: dict[str, list[str]]) -> None:
    print("requirements split summary")
    print(f"  app: {len(app_requirements)}")
    print(f"  dev/test: {len(excluded.get('dev_test', []))}")
    print(f"  notebook: {len(excluded.get('notebook', []))}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Split `pip freeze` output into app requirements and dev/notebook requirements.",
    )
    parser.add_argument(
        "--freeze-file",
        type=Path,
        help="Optional existing freeze output file. If omitted, the script runs `python -m pip freeze`.",
    )
    parser.add_argument(
        "--requirements",
        type=Path,
        default=Path("requirements.txt"),
        help="Output path for app requirements. Default: requirements.txt",
    )
    parser.add_argument(
        "--requirements-dev",
        type=Path,
        default=Path("requirements-dev.txt"),
        help="Output path for development requirements. Default: requirements-dev.txt",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write requirements.txt and requirements-dev.txt. Without this flag, only summary is shown.",
    )
    args = parser.parse_args()

    freeze_lines = load_freeze_lines(args.freeze_file)
    app_requirements, excluded, _ = split_requirements(freeze_lines)
    print_summary(app_requirements, excluded)

    if not args.write:
        return 0

    args.requirements.write_text(render_requirements_txt(app_requirements), encoding="utf-8")
    args.requirements_dev.write_text(render_requirements_dev_txt(excluded), encoding="utf-8")
    print(f"  wrote: {args.requirements}")
    print(f"  wrote: {args.requirements_dev}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
