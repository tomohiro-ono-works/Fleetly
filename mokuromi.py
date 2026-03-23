import json
import os
import subprocess
from datetime import datetime

from prompt_toolkit.application import Application
from prompt_toolkit import PromptSession
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit, Layout, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import D
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.styles import Style
from rich.console import Console
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

from main import list_workflows_local, run_cli

console = Console()
MAIN_COLOR = "#6b4eff"
SUCCESS_COLOR = "#009faa"
ERROR_COLOR = "#ec3691"

COMMANDS = [
    "workflow",
    "execute",
    "step",
    "step data",
    "step info",
    "exit",
    "quit",
]

mokuromi_completer = WordCompleter(COMMANDS, ignore_case=True, sentence=True)

style = Style.from_dict({
    "prompt": f"bold {MAIN_COLOR}",
})


class MokuromiSessionState:
    def __init__(self):
        self.last_report = None
        self.recent_workflow_paths = []

    def remember_workflow(self, workflow_path):
        normalized = os.path.abspath(str(workflow_path))
        self.recent_workflow_paths = [
            path for path in self.recent_workflow_paths
            if path != normalized
        ]
        self.recent_workflow_paths.insert(0, normalized)


def show_banner():
    logo = "\n".join([
        "███╗ ███╗  ██████╗  ██╗  ██╗ ██╗   ██╗ ██████╗   ██████╗  ███╗ ███╗ ██╗",
        "████████║ ██╔═══██╗ ██║ ██╔╝ ██║   ██║ ██╔══██╗ ██╔═══██╗ ████████║ ██║",
        "██╔██╔██║ ██║   ██║ █████╔╝  ██║   ██║ ██████╔╝ ██║   ██║ ██╔██╔██║ ██║",
        "██║╚═╝██║ ██║   ██║ ██╔═██╗  ██║   ██║ ██╔══██╗ ██║   ██║ ██║╚═╝██║ ██║",
        "██║   ██║ ╚██████╔╝ ██║  ██╗ ╚██████╔╝ ██║  ██║ ╚██████╔╝ ██║   ██║ ██║",
        "╚═╝   ╚═╝  ╚═════╝  ╚═╝  ╚═╝  ╚═════╝  ╚═╝  ╚═╝  ╚═════╝  ╚═╝   ╚═╝ ╚═╝",
    ])
    commands = "\n".join([
        "workflow",
        "execute <file_path>",
        "step",
        "step data <step_id>",
        "step info <step_id>",
        "exit | quit",
    ])
    console.print(
        Panel.fit(
            f"[bold {MAIN_COLOR}]{logo}[/bold {MAIN_COLOR}]\n"
            "[dim]workflow execution via main.py[/dim]\n\n"
            f"{commands}",
            border_style=MAIN_COLOR,
        )
    )


def copy_to_clipboard(text):
    subprocess.run(["cmd", "/c", "clip"], input=f"\"{text}\"", text=True, check=True)


def workflow_sort_key(item, recent_paths):
    try:
        recent_index = recent_paths.index(item["path"])
    except ValueError:
        recent_index = len(recent_paths)
    return (recent_index, -float(item.get("modified_at", 0)), item["filename"].lower(), item["path"].lower())


def run_workflow_selector(workflows):
    selected_index = 0
    result = {"path": None}

    def get_text():
        fragments = [
            ("class:instruction", "workflow list\n"),
            ("class:hint", "Up/Down: move  Enter: copy path  Esc/q: cancel\n\n"),
        ]
        for index, item in enumerate(workflows, start=1):
            is_selected = (index - 1) == selected_index
            prefix = "❯" if is_selected else " "
            style_name = "class:selected" if is_selected else "class:item"
            modified_text = datetime.fromtimestamp(
                float(item.get("modified_at", 0))
            ).strftime("%Y/%m/%d %H:%M")
            line = f"{prefix} {index}:({modified_text}) {item['filename']} ({item['directory']})\n"
            fragments.append((style_name, line))
        return fragments

    control = FormattedTextControl(get_text)
    bindings = KeyBindings()

    @bindings.add("up")
    def _move_up(event):
        nonlocal selected_index
        selected_index = (selected_index - 1) % len(workflows)
        event.app.invalidate()

    @bindings.add("down")
    def _move_down(event):
        nonlocal selected_index
        selected_index = (selected_index + 1) % len(workflows)
        event.app.invalidate()

    @bindings.add("enter")
    def _select(event):
        result["path"] = workflows[selected_index]["path"]
        event.app.exit(result=result["path"])

    @bindings.add("escape")
    @bindings.add("q")
    @bindings.add("c-c")
    def _cancel(event):
        event.app.exit(result=None)

    app = Application(
        layout=Layout(
            HSplit([
                Window(content=control, always_hide_cursor=True, height=D(preferred=len(workflows) + 3)),
            ])
        ),
        key_bindings=bindings,
        full_screen=False,
        mouse_support=False,
        style=Style.from_dict({
            "selected": f"bg:{MAIN_COLOR} #ffffff bold",
            "instruction": f"bold {MAIN_COLOR}",
            "hint": f"italic {SUCCESS_COLOR}",
            "item": "",
        }),
    )
    return app.run()


def select_workflow(state):
    workflows = sorted(
        list_workflows_local(),
        key=lambda item: workflow_sort_key(item, state.recent_workflow_paths),
    )
    if not workflows:
        console.print(f"[{ERROR_COLOR}]workflows フォルダに .mkm ファイルがありません。[/{ERROR_COLOR}]")
        return

    selected_path = run_workflow_selector(workflows)
    console.print()
    if not selected_path:
        console.print("[dim]workflow selection cancelled[/dim]")
        return

    state.remember_workflow(selected_path)
    try:
        copy_to_clipboard(selected_path)
        console.print(f"[{SUCCESS_COLOR}]copied:[/{SUCCESS_COLOR}] \"{selected_path}\"")
    except Exception as e:
        console.print(f"[{ERROR_COLOR}]クリップボードへのコピーに失敗しました: {e}[/{ERROR_COLOR}]")
        console.print(f"\"{selected_path}\"")


def split_command(text):
    stripped = text.strip()
    if not stripped:
        return "", None

    parts = stripped.split(None, 2)
    command = parts[0].lower()

    if command == "execute":
        argument = stripped[len(parts[0]):].strip() if len(parts) > 1 else None
        return "execute", argument or None

    if command == "step":
        if len(parts) == 1:
            return "step", None
        subcommand = parts[1].lower()
        if subcommand in {"data", "info"}:
            argument = parts[2].strip() if len(parts) > 2 else None
            return f"step {subcommand}", argument or None
        return "unknown", stripped

    if command in {"workflow", "exit", "quit"}:
        return command, None

    return "unknown", stripped


def get_last_report(state):
    report = state.last_report
    if not report:
        console.print(f"[{ERROR_COLOR}]直前実行がありません。先に execute を実行してください。[/{ERROR_COLOR}]")
        return None
    return report


def render_execution_summary(report):
    step_count = len(report.get("steps", []))
    status = report.get("status", "error")
    border_style = SUCCESS_COLOR if status == "success" else ERROR_COLOR
    error = report.get("error")
    summary = [
        f"workflow: {report.get('workflow_name', 'Untitled')}",
        f"path: {report.get('workflow_path', '-')}",
        f"status: {status}",
        f"steps: {step_count}",
    ]
    if error:
        summary.append(f"error: {error}")
    console.print(Panel("\n".join(summary), title="execute", border_style=border_style))


def render_steps(report):
    steps = report.get("steps", [])
    if not steps:
        console.print(f"[{ERROR_COLOR}]ステップ情報がありません。[/{ERROR_COLOR}]")
        return

    table = Table(title="steps")
    table.add_column("#", justify="right")
    table.add_column("step_id")
    table.add_column("status")
    for index, step in enumerate(steps, start=1):
        table.add_row(str(index), str(step.get("step_id")), str(step.get("status")))
    console.print(table)


def find_step(report, step_id):
    for step in report.get("steps", []):
        if str(step.get("step_id")) == str(step_id):
            return step
    return None


def is_dataframe_like(value):
    return all(hasattr(value, attr) for attr in ("head", "shape", "columns", "itertuples"))


def stringify_cell(value):
    text = "" if value is None else str(value)
    if len(text) > 80:
        return text[:77] + "..."
    return text


def render_dataframe(value):
    preview = value.head(20)
    table = Table(title="data preview")
    for column in preview.columns:
        table.add_column(str(column), overflow="fold")
    for row in preview.itertuples(index=False, name=None):
        table.add_row(*[stringify_cell(cell) for cell in row])
    console.print(table)
    rows, columns = value.shape
    console.print(f"[dim]rows={rows} columns={columns} preview={min(rows, 20)}[/dim]")


def json_default(value):
    if is_dataframe_like(value):
        rows, columns = value.shape
        return {
            "type": "DataFrame",
            "rows": rows,
            "columns": list(value.columns),
        }
    return str(value)


def render_structured(value, lexer):
    text = json.dumps(value, ensure_ascii=False, indent=2, default=json_default)
    console.print(Syntax(text, lexer, word_wrap=True))


def render_step_data(step):
    if step.get("status") == "error":
        console.print(f"[{ERROR_COLOR}]step error:[/{ERROR_COLOR}] {step.get('error')}")
        return

    result = step.get("result")
    if is_dataframe_like(result):
        render_dataframe(result)
        return
    if isinstance(result, (dict, list)):
        render_structured(result, "json")
        return
    if result is None:
        console.print("[dim]null[/dim]")
        return
    console.print(result)


def render_step_info(step):
    info = {
        "step_id": step.get("step_id"),
        "connector": step.get("connector"),
        "action": step.get("action"),
        "params": step.get("params", {}),
        "output_variable": step.get("output_variable"),
        "status": step.get("status"),
        "error": step.get("error"),
    }
    render_structured(info, "json")


def execute_workflow(file_path, state):
    if not file_path:
        console.print(f"[{ERROR_COLOR}]usage: execute <file_path>[/{ERROR_COLOR}]")
        return

    report = run_cli(file_path)
    state.last_report = report
    workflow_path = report.get("workflow_path")
    if workflow_path and os.path.exists(workflow_path):
        state.remember_workflow(workflow_path)
    render_execution_summary(report)


def handle_step_data(state, step_id):
    if not step_id:
        console.print(f"[{ERROR_COLOR}]usage: step data <step_id>[/{ERROR_COLOR}]")
        return

    report = get_last_report(state)
    if not report:
        return

    step = find_step(report, step_id)
    if not step:
        console.print(f"[{ERROR_COLOR}]step_id '{step_id}' が見つかりません。[/{ERROR_COLOR}]")
        return
    render_step_data(step)


def handle_step_info(state, step_id):
    if not step_id:
        console.print(f"[{ERROR_COLOR}]usage: step info <step_id>[/{ERROR_COLOR}]")
        return

    report = get_last_report(state)
    if not report:
        return

    step = find_step(report, step_id)
    if not step:
        console.print(f"[{ERROR_COLOR}]step_id '{step_id}' が見つかりません。[/{ERROR_COLOR}]")
        return
    render_step_info(step)


def main():
    show_banner()
    session = PromptSession(completer=mokuromi_completer, style=style)
    state = MokuromiSessionState()

    while True:
        try:
            text = session.prompt([("class:prompt", "mokuromi ❯ ")])
            command, argument = split_command(text)

            if not command:
                continue
            if command in {"exit", "quit"}:
                break
            if command == "workflow":
                select_workflow(state)
                continue
            if command == "execute":
                execute_workflow(argument, state)
                continue
            if command == "step":
                report = get_last_report(state)
                if report:
                    render_steps(report)
                continue
            if command == "step data":
                handle_step_data(state, argument)
                continue
            if command == "step info":
                handle_step_info(state, argument)
                continue

            console.print(f"[{ERROR_COLOR}]unknown command[/{ERROR_COLOR}]")
        except KeyboardInterrupt:
            console.print()
            continue
        except EOFError:
            console.print()
            break


if __name__ == "__main__":
    main()
