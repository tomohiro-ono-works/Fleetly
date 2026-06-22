from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = BASE_DIR / "workflows"
TEMPLATE_DIR = BASE_DIR / "template"
CONFIG_DIR = BASE_DIR / "config"
RECENT_FLOWS_FILE = CONFIG_DIR / "recent_flows.json"
FLOW_EXTENSIONS = (".zizd",)


def has_flow_extension(path: str) -> bool:
    return str(path or "").lower().endswith(FLOW_EXTENSIONS)


def list_flows_local():
    items = []
    for entry in load_recent_flows():
        path = str(entry.get("path") or "").strip()
        if not path:
            continue
        if not has_flow_extension(path):
            continue
        normalized = os.path.abspath(path)
        items.append({
            "filename": os.path.basename(normalized),
            "path": normalized,
            "directory": os.path.dirname(normalized),
            "modified_at": float(entry.get("opened_at_ts") or 0),
        })
    return items


def list_templates_local():
    if not TEMPLATE_DIR.exists():
        return []

    items = []
    for path in TEMPLATE_DIR.rglob("*"):
        if not path.is_file() or not has_flow_extension(path.name):
            continue
        items.append({
            "filename": path.name,
            "path": str(path.resolve()),
            "directory": str(path.parent.resolve()),
            "modified_at": path.stat().st_mtime,
        })

    return sorted(
        items,
        key=lambda item: (item["filename"].lower(), item["path"].lower()),
    )


def list_workflows_local():
    return list_flows_local()


def load_recent_flows():
    if not RECENT_FLOWS_FILE.exists():
        return []
    try:
        data = json.loads(RECENT_FLOWS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    items = data.get("items") if isinstance(data, dict) else []
    if not isinstance(items, list):
        return []
    normalized_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        path = str(item.get("path") or "").strip()
        if not path:
            continue
        normalized_items.append({
            "path": os.path.abspath(path),
            "opened_at": str(item.get("opened_at") or ""),
            "opened_at_ts": float(item.get("opened_at_ts") or 0),
        })
    return normalized_items


def save_recent_flows(items):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    payload = {"items": items}
    RECENT_FLOWS_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def register_recent_flow(path: str, *, opened_at_iso: str | None = None, max_items: int = 10):
    normalized = os.path.abspath(str(path or "").strip())
    if not normalized:
        return
    existing = [item for item in load_recent_flows() if os.path.abspath(str(item.get("path") or "")) != normalized]
    opened_at = str(opened_at_iso or "")
    timestamp = 0.0
    if opened_at:
        try:
            from datetime import datetime
            timestamp = datetime.fromisoformat(opened_at.replace("Z", "+00:00")).timestamp()
        except ValueError:
            timestamp = 0.0
    existing.insert(0, {
        "path": normalized,
        "opened_at": opened_at,
        "opened_at_ts": timestamp,
    })
    save_recent_flows(existing[: max(1, int(max_items or 10))])


def discover_flow_paths():
    discovered_paths = []

    if WORKFLOW_DIR.exists():
        for name in os.listdir(WORKFLOW_DIR):
            if has_flow_extension(name):
                discovered_paths.append(str(WORKFLOW_DIR / name))

    for item in _discover_flow_paths_from_powershell():
        path = item.get("path")
        if path:
            discovered_paths.append(path)

    unique_paths = []
    seen = set()
    for path in discovered_paths:
        normalized = os.path.abspath(path)
        if normalized in seen:
            continue
        seen.add(normalized)
        unique_paths.append(normalized)
    return unique_paths


def _discover_flow_paths_from_powershell():
    if os.name != "nt":
        return []

    powershell_script = r"""
$sh = New-Object -ComObject WScript.Shell
$threshold = (Get-Date).AddDays(-20)
$targetFolders = @()

$recentFolders = Get-ChildItem "$env:APPDATA\Microsoft\Windows\Recent\*.lnk" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -gt $threshold } |
    ForEach-Object {
        try {
            $link = $sh.CreateShortcut($_.FullName)
            if ($link.TargetPath -and (Test-Path $link.TargetPath -PathType Container)) { $link.TargetPath }
        } catch {}
    }

$targetFolders += $recentFolders
$targetFolders += "$HOME\Downloads"
$targetFolders += "$HOME\Documents"
$targetFolders += "%s"
$targetFolders = $targetFolders | Where-Object { $_ } | Select-Object -Unique

$results = foreach ($folder in $targetFolders) {
    if (Test-Path $folder) {
        Get-ChildItem -Path $folder -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Extension -in @('.zizd') } |
            ForEach-Object {
                [PSCustomObject]@{
                    path = $_.FullName
                }
            }
    }
}

$results | ConvertTo-Json -Depth 2 -Compress
""" % str(WORKFLOW_DIR).replace("\\", "\\\\")

    try:
        process = subprocess.run(
            ["powershell", "-NoProfile", "-Command", powershell_script],
            capture_output=True,
            text=True,
            encoding="cp932",
            errors="replace",
            check=False,
        )
    except OSError:
        return []

    stdout = (process.stdout or "").strip()
    if process.returncode != 0 or not stdout:
        return []

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return []

    if isinstance(data, dict):
        return [data]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def resolve_flow_path(flow_path: str):
    raw_path = str(flow_path or "").strip()
    if not raw_path:
        return None
    if len(raw_path) >= 2 and raw_path[0] == raw_path[-1] and raw_path[0] in {"\"", "'"}:
        raw_path = raw_path[1:-1].strip()
    if not raw_path:
        return None

    candidates = []
    if os.path.isabs(raw_path):
        candidates.append(raw_path)
    else:
        candidates.append(os.path.abspath(raw_path))
        candidates.append(os.path.abspath(str(BASE_DIR / raw_path)))
        if not os.path.dirname(raw_path):
            candidates.append(os.path.abspath(str(WORKFLOW_DIR / raw_path)))

    seen = set()
    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        if os.path.exists(normalized):
            return normalized
    return os.path.abspath(str(BASE_DIR / raw_path))
