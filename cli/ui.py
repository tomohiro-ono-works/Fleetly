import json
from datetime import datetime

from prompt_toolkit import PromptSession
from prompt_toolkit.application import Application
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import HSplit, Layout, Window
from prompt_toolkit.layout.controls import FormattedTextControl
from prompt_toolkit.layout.dimension import D
from prompt_toolkit.styles import Style
from rich.console import Console, Group
from rich.padding import Padding
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table
from rich.text import Text

console = Console()
MAIN_COLOR = "#6b4eff"
SUCCESS_COLOR = "#009faa"
ERROR_COLOR = "#ec3691"

COMMANDS = [
    "flow",
    "flow run",
    "gui",
    "exit",
]

FLOW_MODE_COMMANDS = [
    "run",
    "result",
    "datavolume",
    "schema",
    "exit",
]

CLI_COMPLETER = WordCompleter(COMMANDS, ignore_case=True, sentence=True)
FLOW_MODE_COMPLETER = WordCompleter(FLOW_MODE_COMMANDS, ignore_case=True, sentence=True)
PROMPT_STYLE = Style.from_dict({
    "prompt": f"bold {MAIN_COLOR}",
})


def create_session():
    return PromptSession(style=PROMPT_STYLE)


def get_completer(state):
    if getattr(state, "in_flow_mode", False):
        return FLOW_MODE_COMPLETER
    return CLI_COMPLETER


def get_prompt_fragments(state):
    if getattr(state, "in_flow_mode", False):
        return [("class:prompt", "    flow ❯ ")]
    return [("class:prompt", "ziz ❯ ")]


def show_banner():
    commands = "\n".join([
        "flow",
        "flow run",
        "gui",
        "exit",
    ])
    logo_block = render_cli_logo()
    subtitle = Text("flow execution via main.py", style="dim")
    command_text = Text(commands)
    console.print(
        Panel.fit(
            Group(logo_block, subtitle, Text(""), command_text),
            border_style=MAIN_COLOR,
        )
    )


def show_flow_selector_intro():
    console.print("フローリストを表示します。")
    console.print(" * [Up/Down]keyで移動  * [Esc]keyでキャンセルできます。")
    console.print()


def render_cli_logo():
    logo_lines = [
        "███████╗ ██╗ ███████╗    █████╗  ██╗                             ",
        "╚══███╔╝ ╚═╝ ╚══███╔╝   ██╔══██╗ ╚═╝                             ",
        "  ███╔╝  ██║   ███╔╝    ███████║ ██║                             ",
        " ███╔╝   ██║  ███╔╝     ██╔══██║ ██║                             ",
        "███████╗ ██║ ███████╗   ██║  ██║ ██║                             ",
        "╚══════╝ ╚═╝ ╚══════╝   ╚═╝  ╚═╝ ╚═╝                             ",
    ]
    return Text("\n".join(logo_lines), style=f"bold {MAIN_COLOR}")


def sort_flow_key(item, recent_paths):
    try:
        recent_index = recent_paths.index(item["path"])
    except ValueError:
        recent_index = len(recent_paths)
    return (recent_index, -float(item.get("modified_at", 0)), item["filename"].lower(), item["path"].lower())


def run_flow_selector(flows):
    selected_index = 0
    result = {"path": None}

    def get_text():
        fragments = []
        for index, item in enumerate(flows, start=1):
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
        selected_index = (selected_index - 1) % len(flows)
        event.app.invalidate()

    @bindings.add("down")
    def _move_down(event):
        nonlocal selected_index
        selected_index = (selected_index + 1) % len(flows)
        event.app.invalidate()

    @bindings.add("enter")
    def _select(event):
        result["path"] = flows[selected_index]["path"]
        event.app.exit(result=result["path"])

    @bindings.add("escape")
    @bindings.add("q")
    @bindings.add("c-c")
    def _cancel(event):
        event.app.exit(result=None)

    app = Application(
        layout=Layout(
            HSplit([
                Window(content=control, always_hide_cursor=True, height=D(preferred=len(flows))),
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


def run_result_selector(steps):
    selected_index = 0
    result = {"step": None}
    indent = " " * 8

    def step_summary(step):
        step_id = str(step.get("step_id") or "-")
        connector = str(step.get("connector") or "-")
        action = str(step.get("action") or "-")
        return f"{step_id}: {connector} / {action}"

    def get_text():
        fragments = []
        for index, step in enumerate(steps):
            is_selected = index == selected_index
            prefix = "❯" if is_selected else " "
            style_name = "class:selected" if is_selected else "class:item"
            fragments.append((style_name, f"{indent}{prefix} {step_summary(step)}\n"))
        return fragments

    control = FormattedTextControl(get_text)
    bindings = KeyBindings()

    @bindings.add("up")
    def _move_up(event):
        nonlocal selected_index
        selected_index = (selected_index - 1) % len(steps)
        event.app.invalidate()

    @bindings.add("down")
    def _move_down(event):
        nonlocal selected_index
        selected_index = (selected_index + 1) % len(steps)
        event.app.invalidate()

    @bindings.add("enter")
    def _select(event):
        result["step"] = steps[selected_index]
        event.app.exit(result=result["step"])

    @bindings.add("escape")
    @bindings.add("q")
    @bindings.add("c-c")
    def _cancel(event):
        event.app.exit(result=None)

    app = Application(
        layout=Layout(
            HSplit([
                Window(content=control, always_hide_cursor=True, height=D(preferred=len(steps) + 1)),
            ])
        ),
        key_bindings=bindings,
        full_screen=False,
        mouse_support=False,
        style=Style.from_dict({
            "selected": f"bg:{MAIN_COLOR} #ffffff bold",
            "item": "",
        }),
    )
    return app.run()


def render_selected_flow(flow_name, flow_path):
    body = "\n".join([
        f"flow: {flow_name}",
        f"path: {flow_path}",
    ])
    console.print(Panel(body, title="selected", border_style=MAIN_COLOR))


def render_execution_summary(report, indent=0):
    step_count = len(report.get("steps", []))
    status = report.get("status", "error")
    border_style = SUCCESS_COLOR if status == "success" else ERROR_COLOR
    error = report.get("error")
    summary = [
        f"flow: {report.get('flow_name', 'Untitled')}",
        f"path: {report.get('flow_path', '-')}",
        f"status: {status}",
        f"steps: {step_count}",
    ]
    if error:
        summary.append(f"error: {error}")
    console.print(Padding(Panel("\n".join(summary), title="result", border_style=border_style), (0, 0, 0, indent)))


def render_result(report, indent=0):
    render_execution_summary(report, indent=indent)
    render_steps(report, indent=indent)


def render_steps(report, indent=0):
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
    console.print(Padding(table, (0, 0, 0, indent)))


def is_dataframe_like(value):
    return all(hasattr(value, attr) for attr in ("head", "shape", "columns", "itertuples"))


def stringify_cell(value):
    text = "" if value is None else str(value)
    if len(text) > 80:
        return text[:77] + "..."
    return text


def render_dataframe(value, indent=0):
    preview = value.head(100)
    preview_text = preview.fillna("").astype(str).to_string(index=False)
    console.print(Padding("[bold]データプレビュー[/bold]", (0, 0, 0, indent)))
    console.print(Padding(preview_text, (0, 0, 0, indent)))
    rows, columns = value.shape
    console.print(Padding(f"[dim]rows={rows} columns={columns} preview={min(rows, 100)}[/dim]", (0, 0, 0, indent)))


def json_default(value):
    if is_dataframe_like(value):
        rows, columns = value.shape
        return {
            "type": "DataFrame",
            "rows": rows,
            "columns": list(value.columns),
        }
    return str(value)


def render_structured(value, lexer, indent=0):
    text = json.dumps(value, ensure_ascii=False, indent=2, default=json_default)
    console.print(Padding(Syntax(text, lexer, word_wrap=True), (0, 0, 0, indent)))


def render_step_data(step, indent=0):
    if step.get("status") == "error":
        console.print(Padding(f"[{ERROR_COLOR}]step error:[/{ERROR_COLOR}] {step.get('error')}", (0, 0, 0, indent)))
        return

    result = step.get("result")
    if is_dataframe_like(result):
        render_dataframe(result, indent=indent)
        return
    if isinstance(result, (dict, list)):
        render_structured(result, "json", indent=indent)
        return
    if result is None:
        console.print(Padding("[dim]null[/dim]", (0, 0, 0, indent)))
        return
    console.print(Padding(str(result), (0, 0, 0, indent)))


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


def render_indented_log_block(log_text, indent=10):
    prefix = " " * indent
    lines = [line for line in str(log_text or "").splitlines() if line.strip()]
    for line in lines:
        console.print(f"{prefix}{line}")


def render_dataframe_schema(value, indent=0, top_n=5):
    total_rows = len(value.index)
    console.print(Padding("[bold]スキーマ[/bold]", (0, 0, 0, indent)))
    if total_rows == 0:
        console.print(Padding("[dim]rows=0[/dim]", (0, 0, 0, indent)))
        return

    for column in value.columns:
        series = value[column]
        dtype_name = str(series.dtype)
        console.print(Padding(f"[bold]{column}[/bold]（{dtype_name}）", (0, 0, 0, indent)))

        normalized = series.fillna("NULL").astype(str)
        counts = normalized.value_counts(dropna=False).head(top_n)
        for item_value, item_count in counts.items():
            ratio = (item_count / total_rows) * 100 if total_rows else 0
            console.print(
                Padding(
                    f"- {item_value} ({item_count}件 {ratio:.1f}%)",
                    (0, 0, 0, indent + 2),
                )
            )
        console.print()


def render_schema_json(items, indent=0):
    text = json.dumps(items, ensure_ascii=False, indent=2, default=json_default)
    console.print(Padding("[bold]schema[/bold]", (0, 0, 0, indent)))
    console.print(Padding(text, (0, 0, 0, indent)))
