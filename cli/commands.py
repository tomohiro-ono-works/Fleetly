import subprocess
import os

from rich.padding import Padding

from cli.ui import ERROR_COLOR, SUCCESS_COLOR, console, render_dataframe_schema, render_execution_summary, render_schema_json, render_step_data, run_flow_selector, sort_flow_key
from cli.ui import render_selected_flow, run_result_selector, show_flow_selector_intro
from core.flow_locator import list_flows_local
from core.type_registry import build_dataframe_schema
from app.gui.host import run_webview_app
from app.main import logger as app_logger, run_cli


class IndentedConsoleStream:
    def __init__(self, indent=10):
        self.indent = " " * indent
        self._buffer = ""

    def write(self, text):
        if not text:
            return 0
        self._buffer += str(text)
        while "\n" in self._buffer:
            line, self._buffer = self._buffer.split("\n", 1)
            if line.strip():
                console.print(f"{self.indent}{line}", markup=False, highlight=False)
        return len(text)

    def flush(self):
        if self._buffer.strip():
            console.print(f"{self.indent}{self._buffer}", markup=False, highlight=False)
        self._buffer = ""


def copy_to_clipboard(text):
    subprocess.run(["cmd", "/c", "clip"], input=f"\"{text}\"", text=True, check=True)


def _select_flow_path(state):
    flows = sorted(
        list_flows_local(),
        key=lambda item: sort_flow_key(item, state.recent_flow_paths),
    )
    if not flows:
        console.print(f"[{ERROR_COLOR}]flows フォルダに .zizw / .zizd / .zizq ファイルがありません。[/{ERROR_COLOR}]")
        return

    show_flow_selector_intro()
    selected_path = run_flow_selector(flows)
    console.print()
    if not selected_path:
        console.print("[dim]flow selection cancelled[/dim]")
        return None

    state.select_flow(selected_path)
    render_selected_flow(state.current_flow_name.rsplit(".", 1)[0], state.current_flow_path)
    return selected_path


def select_flow(state):
    _select_flow_path(state)


def select_and_run_flow(state):
    selected_path = _select_flow_path(state)
    if selected_path:
        run_flow(selected_path, state)


def split_command(text, in_flow_mode=False):
    stripped = text.strip()
    if not stripped:
        return "", None

    parts = stripped.split(None, 2)
    command = parts[0].lower()

    if in_flow_mode:
        if command in {"run", "result", "datavolume", "schema", "exit"}:
            return command, None
        return "unknown", stripped

    if command == "flow":
        if len(parts) == 1:
            return "flow", None
        if len(parts) == 2 and parts[1].lower() == "run":
            return "flow run", None
        return "unknown", stripped

    if command == "gui":
        if len(parts) == 1:
            return "gui", {"debug": False}
        if len(parts) == 2 and parts[1].lower() in {"--debug", "debug"}:
            return "gui", {"debug": True}
        return "unknown", stripped

    if command == "exit":
        return command, None

    return "unknown", stripped


def get_last_report(state):
    report = state.last_report
    if not report:
        console.print(f"[{ERROR_COLOR}]直前実行がありません。先に run を実行してください。[/{ERROR_COLOR}]")
        return None
    return report


def run_flow(file_path, state):
    target_path = file_path or state.current_flow_path
    if not target_path:
        console.print(f"[{ERROR_COLOR}]usage: run <file_path>[/{ERROR_COLOR}]")
        return

    live_stream = IndentedConsoleStream(indent=10)
    replaced_streams = []
    for handler in getattr(app_logger, "handlers", []):
        if hasattr(handler, "stream") and hasattr(handler, "setStream"):
            replaced_streams.append((handler, handler.stream))
            handler.setStream(live_stream)
    try:
        report = run_cli(target_path)
    finally:
        live_stream.flush()
        for handler, stream in replaced_streams:
            handler.setStream(stream)

    state.last_report = report
    flow_path = report.get("flow_path")
    if flow_path and os.path.exists(flow_path):
        state.select_flow(flow_path)
    render_execution_summary(report, indent=10)

def open_gui(form_html_path, *, debug=False):
    try:
        run_webview_app(form_html_path, debug=debug)
    except Exception as error:
        console.print(f"[{ERROR_COLOR}]GUI の起動に失敗しました: {error}[/{ERROR_COLOR}]")


def handle_result(state):
    report = get_last_report(state)
    if not report:
        return
    steps = report.get("steps", [])
    if not steps:
        console.print(f"[{ERROR_COLOR}]result がありません。[/{ERROR_COLOR}]")
        return
    selected_step = run_result_selector(steps)
    console.print()
    if not selected_step:
        console.print("[dim]result selection cancelled[/dim]")
        return
    render_step_data(selected_step, indent=8)


def handle_datavolume(state):
    report = get_last_report(state)
    if not report:
        return
    steps = report.get("steps", [])
    if not steps:
        console.print(f"[{ERROR_COLOR}]datavolume を表示できる実行結果がありません。[/{ERROR_COLOR}]")
        return

    selected_step = run_result_selector(steps)
    console.print()
    if not selected_step:
        console.print("[dim]datavolume selection cancelled[/dim]")
        return

    result = selected_step.get("result")
    if result is None:
        console.print(Padding("[dim]null[/dim]", (0, 0, 0, 8)))
        return
    if not hasattr(result, "columns") or not hasattr(result, "head") or not hasattr(result, "index"):
        console.print(Padding(f"[{ERROR_COLOR}]DataFrame ではないため schema 表示できません。[/{ERROR_COLOR}]", (0, 0, 0, 8)))
        return
    render_dataframe_schema(result, indent=8, top_n=5)


def _build_dataframe_schema_payload(dataframe):
    existing_schema = dataframe.attrs.get("ziz_schema")
    if isinstance(existing_schema, list) and existing_schema:
        return [_to_editable_schema_item(item) for item in existing_schema]
    return [_to_editable_schema_item(item) for item in build_dataframe_schema(dataframe)]


def _to_editable_schema_item(item):
    return {
        "origin_name": str(item.get("origin_name") or item.get("name_ja") or item.get("name_en") or ""),
        "new_name": str(item.get("new_name") or item.get("name_en") or item.get("name_ja") or ""),
        "description": str(item.get("description") or item.get("name_ja") or item.get("origin_name") or ""),
        "ziz_datatype": str(item.get("ziz_datatype") or ""),
    }


def handle_schema(state):
    report = get_last_report(state)
    if not report:
        return
    steps = report.get("steps", [])
    if not steps:
        console.print(f"[{ERROR_COLOR}]schema を表示できる実行結果がありません。[/{ERROR_COLOR}]")
        return

    selected_step = run_result_selector(steps)
    console.print()
    if not selected_step:
        console.print("[dim]schema selection cancelled[/dim]")
        return

    result = selected_step.get("result")
    if result is None:
        console.print(Padding("[dim]null[/dim]", (0, 0, 0, 8)))
        return
    if not hasattr(result, "columns") or not hasattr(result, "head") or not hasattr(result, "index"):
        console.print(Padding(f"[{ERROR_COLOR}]DataFrame ではないため schema 表示できません。[/{ERROR_COLOR}]", (0, 0, 0, 8)))
        return

    render_schema_json(_build_dataframe_schema_payload(result), indent=8)
