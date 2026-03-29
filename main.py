import json
import os
import subprocess
import sys

from core.logger import setup_logger
from core.workflow_engine import WorkflowEngine

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKFLOW_DIR = os.path.join(BASE_DIR, "workflows")
FLOW_EXTENSIONS = (".zizw", ".zizd", ".zizq")

logger = setup_logger()
engine = WorkflowEngine(logger)

if not os.path.exists(WORKFLOW_DIR):
    os.makedirs(WORKFLOW_DIR)


def has_flow_extension(path: str) -> bool:
    return str(path or "").lower().endswith(FLOW_EXTENSIONS)


def list_flows_local():
    flows_by_path = {}

    for full_path in _discover_flow_paths():
        if not os.path.exists(full_path):
            continue
        normalized = os.path.abspath(full_path)
        flows_by_path[normalized] = {
            "filename": os.path.basename(normalized),
            "path": normalized,
            "directory": os.path.dirname(normalized),
            "modified_at": os.path.getmtime(normalized),
        }

    return sorted(
        flows_by_path.values(),
        key=lambda item: (-item["modified_at"], item["filename"].lower(), item["path"].lower()),
    )


def list_workflows_local():
    return list_flows_local()


def _discover_flow_paths():
    discovered_paths = []

    if os.path.exists(WORKFLOW_DIR):
        for name in os.listdir(WORKFLOW_DIR):
            if has_flow_extension(name):
                discovered_paths.append(os.path.join(WORKFLOW_DIR, name))

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
            Where-Object { $_.Extension -in @('.zizw', '.zizd', '.zizq') } |
            ForEach-Object {
                [PSCustomObject]@{
                    path = $_.FullName
                }
            }
    }
}

$results | ConvertTo-Json -Depth 2 -Compress
""" % WORKFLOW_DIR.replace("\\", "\\\\")

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


def resolve_flow_path(yaml_path: str):
    raw_path = str(yaml_path or "").strip()
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
        candidates.append(os.path.abspath(os.path.join(BASE_DIR, raw_path)))
        if not os.path.dirname(raw_path):
            candidates.append(os.path.abspath(os.path.join(WORKFLOW_DIR, raw_path)))

    seen = set()
    for candidate in candidates:
        normalized = os.path.abspath(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        if os.path.exists(normalized):
            return normalized
    return os.path.abspath(os.path.join(BASE_DIR, raw_path))


def run_cli(yaml_path):
    resolved_path = resolve_flow_path(yaml_path)
    if not resolved_path or not os.path.exists(resolved_path):
        display_path = str(yaml_path or "").strip()
        if len(display_path) >= 2 and display_path[0] == display_path[-1] and display_path[0] in {"\"", "'"}:
            display_path = display_path[1:-1].strip()
        message = f"ファイルが見つかりません: {display_path}"
        logger.error(message)
        return {
            "flow_path": os.path.abspath(display_path) if display_path else "",
            "flow_name": "Untitled",
            "workflow_path": os.path.abspath(display_path) if display_path else "",
            "workflow_name": "Untitled",
            "status": "error",
            "steps": [],
            "error": message,
        }

    logger.info(f"CLIモードで実行開始: {resolved_path}")
    report = engine.run_flow(resolved_path)
    if report.get("status") == "success":
        logger.info("CLI実行が正常に完了しました。")
    else:
        logger.error(f"CLI実行中にエラーが発生しました: {report.get('error')}")
    return report


def main():
    if len(sys.argv) < 2:
        print("usage: python main.py <flow_path>")
        return 1

    report = run_cli(sys.argv[1])
    return 0 if report.get("status") == "success" else 1


if __name__ == "__main__":
    raise SystemExit(main())
