from pathlib import Path

from cli.commands import (
    handle_datavolume,
    handle_result,
    handle_schema,
    open_gui,
    run_flow,
    select_and_run_flow,
    select_flow,
    split_command,
)
from cli.state import ZizSessionState
from cli.ui import ERROR_COLOR, console, create_session, get_completer, get_prompt_fragments, show_banner

BASE_DIR = Path(__file__).resolve().parent
FORM_HTML_PATH = BASE_DIR / "static" / "form.html"

def main():
    show_banner()
    session = create_session()
    state = ZizSessionState()

    while True:
        try:
            text = session.prompt(get_prompt_fragments(state), completer=get_completer(state))
            command, argument = split_command(text, in_flow_mode=state.in_flow_mode)

            if not command:
                continue
            if state.in_flow_mode and command == "exit":
                state.clear_current_flow()
                continue
            if command in {"exit", "quit"}:
                break
            if command == "flow":
                select_flow(state)
                continue
            if command == "flow run":
                select_and_run_flow(state)
                continue
            if command == "run":
                run_flow(argument, state)
                continue
            if command == "result":
                handle_result(state)
                continue
            if command == "datavolume":
                handle_datavolume(state)
                continue
            if command == "schema":
                handle_schema(state)
                continue
            if command == "gui":
                open_gui(FORM_HTML_PATH)
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
