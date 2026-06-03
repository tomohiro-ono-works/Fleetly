from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any
import uuid

from connectors.base_connector import BaseConnector

SESSION_STORE: dict[str, dict] = {}
LAST_SESSION_KEY: str = ""
DEFAULT_SESSION_KEY = "__default__"


def clear_session_runtime(session_key: str | None) -> None:
    key = str(session_key or "").strip()
    if not key:
        return
    runtime = SESSION_STORE.pop(key, None)
    if not isinstance(runtime, dict):
        return
    driver = runtime.get("driver")
    if driver is not None:
        try:
            driver.quit()
        except Exception:
            pass


try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.support.ui import Select, WebDriverWait
except ImportError:  # pragma: no cover
    webdriver = None
    By = None
    Keys = None
    EC = None
    Select = None
    WebDriverWait = None


class WebConnector(BaseConnector):
    RUNTIME_KEY = "__web_runtime__"
    SESSION_ID_COLUMN = "web_session_id"

    DEFAULT_WINDOW_ID = "main"
    DEFAULT_TAB_ID = "current"
    DEFAULT_TIMEOUT_MS = 10_000

    def execute(self, action: str, params: dict | None, context: dict) -> Any:
        params = params or {}
        if action == "navigate":
            return self.navigate(params, context)
        if action == "dom_action":
            return self.dom_action(params, context)
        if action == "dom_get":
            return self.dom_get(params, context)
        if action == "wait":
            return self.wait(params, context)
        if action == "screenshot":
            return self.screenshot(params, context)
        raise ValueError(f"Unknown action: {action}")

    def navigate(self, params: dict, context: dict) -> Any:
        self._require(params, ["url"])
        runtime = self._ensure_runtime(params, context)
        driver = runtime["driver"]

        window_id = str(params.get("window_id") or self.DEFAULT_WINDOW_ID)
        tab_id = str(params.get("tab_id") or self.DEFAULT_TAB_ID)
        tab_mode = str(params.get("tab_mode") or "reuse_or_new").strip()
        wait_until = str(params.get("wait_until") or "none").strip().lower()
        timeout_ms = int(params.get("timeout_ms") or self.DEFAULT_TIMEOUT_MS)
        url = str(params["url"])

        page_key = f"{window_id}:{tab_id}"
        tabs = runtime["tabs"]
        handle = tabs.get(page_key)

        if tab_mode == "new":
            handle = self._open_new_tab(runtime)
            tabs[page_key] = handle
        elif tab_mode in {"reuse", "current"}:
            if not handle:
                raise ValueError(f"指定されたタブが存在しません: {page_key}")
        elif tab_mode == "reuse_or_new":
            if not handle:
                handle = self._open_new_tab(runtime)
                tabs[page_key] = handle
        else:
            raise ValueError(f"tab_mode が不正です: {tab_mode}")

        self._switch_to_handle(runtime, handle)
        driver.set_page_load_timeout(max(1, int(timeout_ms / 1000)))
        driver.get(url)
        if wait_until != "none":
            self._wait_after_navigate(driver, wait_until, timeout_ms)
        session_key = self._store_runtime(context, runtime)

        rows = [{
            "status": "success",
            "action": "navigate",
            "window_id": window_id,
            "tab_id": tab_id,
            "url": driver.current_url,
            "title": driver.title,
            self.SESSION_ID_COLUMN: session_key,
        }]
        df = self.to_dataframe(rows)
        return self._save_output(params, context, df)

    def dom_action(self, params: dict, context: dict) -> Any:
        self._require(params, ["operation"])
        runtime = context.get(self.RUNTIME_KEY)
        driver = self._get_page(params, context)
        timeout_ms = int(params.get("timeout_ms") or self.DEFAULT_TIMEOUT_MS)
        operation = str(params["operation"]).strip().lower()

        if operation == "click":
            locator = self._resolve_element(driver, params)
            locator.click()

        elif operation == "input":
            locator = self._resolve_element(driver, params)
            value = params.get("value")
            value_ref = str(params.get("value_ref") or "").strip()
            if value_ref:
                value = context.get(value_ref)
                try:
                    if hasattr(value, "columns") and "value" in value.columns and len(value.index) > 0:
                        value = value.iloc[0]["value"]
                except Exception:
                    pass
            if value is None:
                value = ""
            clear_first = bool(params.get("clear", True))
            if clear_first:
                locator.clear()
                locator.send_keys(str(value))
            else:
                locator.send_keys(str(value))

        elif operation == "select":
            locator = self._resolve_element(driver, params)
            select = Select(locator)
            if params.get("value") is not None and str(params.get("value")).strip() != "":
                select.select_by_value(str(params["value"]))
            elif params.get("label") is not None and str(params.get("label")).strip() != "":
                select.select_by_visible_text(str(params["label"]))
            elif params.get("index") is not None and str(params.get("index")).strip() != "":
                select.select_by_index(int(params["index"]))
            else:
                raise ValueError("select では value / label / index のいずれかが必要です。")

        elif operation == "check":
            locator = self._resolve_element(driver, params)
            if not locator.is_selected():
                locator.click()

        elif operation == "uncheck":
            locator = self._resolve_element(driver, params)
            if locator.is_selected():
                locator.click()

        elif operation == "key":
            key_value = str(params.get("key") or "").strip()
            if not key_value:
                raise ValueError("key は必須です。")
            if params.get("selector"):
                self._resolve_element(driver, params).click()
            key_token = getattr(Keys, key_value.upper(), None)
            if key_token is None:
                key_token = key_value
            runtime["driver"].switch_to.active_element.send_keys(key_token)

        elif operation == "scroll":
            to = str(params.get("to") or "").strip().lower()
            direction = str(params.get("direction") or "down").strip().lower()
            amount = int(params.get("amount") or 800)
            if params.get("selector"):
                locator = self._resolve_element(driver, params)
                if to == "element":
                    runtime["driver"].execute_script("arguments[0].scrollIntoView({block:'center'});", locator)
                else:
                    x_val = amount if direction == "right" else -amount if direction == "left" else 0
                    y_val = amount if direction == "down" else -amount if direction == "up" else 0
                    runtime["driver"].execute_script("arguments[0].scrollBy(arguments[1], arguments[2]);", locator, x_val, y_val)
            else:
                if to == "top":
                    runtime["driver"].execute_script("window.scrollTo(0, 0);")
                elif to == "bottom":
                    runtime["driver"].execute_script("window.scrollTo(0, document.body.scrollHeight);")
                else:
                    x_val = amount if direction == "right" else -amount if direction == "left" else 0
                    y_val = amount if direction == "down" else -amount if direction == "up" else 0
                    runtime["driver"].execute_script("window.scrollBy(arguments[0], arguments[1]);", x_val, y_val)

        else:
            raise ValueError(f"Unknown dom_action operation: {operation}")

        rows = [{
            "status": "success",
            "action": "dom_action",
            "operation": operation,
            "selector": params.get("selector", ""),
            "timeout_ms": timeout_ms,
            self.SESSION_ID_COLUMN: self._current_session_id(context),
        }]
        df = self.to_dataframe(rows)
        return self._save_output(params, context, df)

    def dom_get(self, params: dict, context: dict) -> Any:
        self._require(params, ["get_type", "selector"])
        driver = self._get_page(params, context)
        get_type = str(params["get_type"]).strip().lower()
        selector = str(params["selector"])
        get_all = bool(params.get("all", False))

        if get_type == "count":
            by, query = self._to_locator(params)
            elements = driver.find_elements(by, query)
            rows = [{
                "selector": selector,
                "get_type": get_type,
                "index": None,
                "value": len(elements),
                self.SESSION_ID_COLUMN: self._current_session_id(context),
            }]
            df = self.to_dataframe(rows)
            return self._save_output(params, context, df)

        if get_all:
            by, query = self._to_locator(params)
            elements = driver.find_elements(by, query)
        else:
            elements = [self._resolve_element(driver, params)]

        rows = []
        for index, element in enumerate(elements):
            if get_type == "html":
                if bool(params.get("outer", False)):
                    value = element.get_attribute("outerHTML")
                else:
                    value = element.get_attribute("innerHTML")
            elif get_type == "text":
                value = element.text
            elif get_type == "value":
                value = element.get_attribute("value")
            elif get_type == "attribute":
                self._require(params, ["attribute"])
                value = element.get_attribute(str(params["attribute"]))
            else:
                raise ValueError(f"Unknown dom_get get_type: {get_type}")

            rows.append({
                "selector": selector,
                "get_type": get_type,
                "index": index,
                "value": value,
                self.SESSION_ID_COLUMN: self._current_session_id(context),
            })

        df = self.to_dataframe(rows)
        return self._save_output(params, context, df)

    def wait(self, params: dict, context: dict) -> Any:
        self._require(params, ["until"])
        driver = self._get_page(params, context)
        until = str(params["until"]).strip()
        timeout_ms = int(params.get("timeout_ms") or self.DEFAULT_TIMEOUT_MS)
        wait = WebDriverWait(driver, max(1, timeout_ms / 1000))

        if until.startswith("selector_"):
            self._require(params, ["selector"])
            by, query = self._to_locator(params)
            state = until.replace("selector_", "", 1)
            if state == "visible":
                wait.until(EC.visibility_of_element_located((by, query)))
            elif state == "hidden":
                wait.until(EC.invisibility_of_element_located((by, query)))
            elif state == "attached":
                wait.until(EC.presence_of_element_located((by, query)))
            elif state == "detached":
                wait.until(EC.invisibility_of_element_located((by, query)))
            else:
                raise ValueError(f"Unknown wait selector state: {state}")

        elif until == "url_contains":
            self._require(params, ["value"])
            wait.until(EC.url_contains(str(params["value"])))

        elif until == "url_equals":
            self._require(params, ["value"])
            wait.until(EC.url_to_be(str(params["value"])))

        elif until == "url_regex":
            self._require(params, ["value"])
            pattern = re.compile(str(params["value"]))
            wait.until(lambda d: bool(pattern.search(str(d.current_url))))

        elif until == "load":
            target_state = str(params.get("state") or "domcontentloaded").strip().lower()
            wait.until(self._document_ready_condition(target_state))

        elif until == "sleep":
            ms = int(params.get("ms") or 1000)
            time.sleep(max(0, ms) / 1000)

        else:
            raise ValueError(f"Unknown wait until: {until}")

        rows = [{
            "status": "success",
            "action": "wait",
            "until": until,
            "selector": params.get("selector"),
            "value": params.get("value"),
            self.SESSION_ID_COLUMN: self._current_session_id(context),
        }]
        df = self.to_dataframe(rows)
        return self._save_output(params, context, df)

    def screenshot(self, params: dict, context: dict) -> Any:
        self._require(params, ["path"])
        driver = self._get_page(params, context)
        target = str(params.get("target") or "page").strip().lower()
        path = Path(str(params["path"])).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)

        if target == "page":
            driver.save_screenshot(str(path))
        elif target == "element":
            element = self._resolve_element(driver, params)
            element.screenshot(str(path))
        else:
            raise ValueError(f"Unknown screenshot target: {target}")

        rows = [{
            "status": "success",
            "action": "screenshot",
            "target": target,
            "path": str(path),
            self.SESSION_ID_COLUMN: self._current_session_id(context),
        }]
        df = self.to_dataframe(rows)
        return self._save_output(params, context, df)

    def _ensure_runtime(self, params: dict, context: dict) -> dict:
        if webdriver is None:
            raise ImportError(
                "selenium がインストールされていません。"
                " `pip install selenium` を実行してください。"
            )

        runtime = context.get(self.RUNTIME_KEY)
        if runtime is None:
            runtime = {
                "driver": None,
                "tabs": {},
            }
            context[self.RUNTIME_KEY] = runtime

        if runtime["driver"] is None:
            options = webdriver.ChromeOptions()
            options.page_load_strategy = "none"
            if bool(params.get("headless", False)):
                options.add_argument("--headless=new")
            options.add_argument("--disable-gpu")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            driver = webdriver.Chrome(options=options)
            runtime["driver"] = driver
            first_handle = driver.current_window_handle
            runtime["tabs"][f"{self.DEFAULT_WINDOW_ID}:{self.DEFAULT_TAB_ID}"] = first_handle
        self._store_runtime(context, runtime)
        return runtime

    def _get_page(self, params: dict, context: dict):
        source_session_key = self._resolve_source_session_key(params, context)
        if source_session_key:
            runtime = SESSION_STORE.get(source_session_key)
            if runtime is None:
                raise ValueError(
                    f"source_step_id から参照した Webセッションが見つかりません: {source_session_key}"
                )
            context[self.RUNTIME_KEY] = runtime
        else:
            runtime = context.get(self.RUNTIME_KEY)
            if runtime is None:
                runtime = self._restore_runtime(context)
        if runtime is None or runtime.get("driver") is None:
            raise ValueError("Webランタイムが存在しません。先に navigate を実行してください。")

        window_id = str(params.get("window_id") or self.DEFAULT_WINDOW_ID)
        tab_id = str(params.get("tab_id") or self.DEFAULT_TAB_ID)
        page_key = f"{window_id}:{tab_id}"
        handle = runtime["tabs"].get(page_key)
        if handle is None:
            raise ValueError(f"操作対象ページが存在しません。先に navigate を実行してください: {page_key}")
        self._switch_to_handle(runtime, handle)
        return runtime["driver"]

    def _store_runtime(self, context: dict, runtime: dict) -> str:
        global LAST_SESSION_KEY
        context[self.RUNTIME_KEY] = runtime
        session_key = self._get_session_key(context)
        if not session_key:
            session_key = str(runtime.get("session_id") or "").strip()
        if not session_key:
            session_key = f"{DEFAULT_SESSION_KEY}:{uuid.uuid4().hex}"
        runtime["session_id"] = session_key
        SESSION_STORE[session_key] = runtime
        LAST_SESSION_KEY = session_key
        return session_key

    def _restore_runtime(self, context: dict):
        session_key = self._get_session_key(context)
        runtime = SESSION_STORE.get(session_key) if session_key else None
        if runtime is None and LAST_SESSION_KEY:
            runtime = SESSION_STORE.get(LAST_SESSION_KEY)
        if runtime is None:
            runtime = SESSION_STORE.get(DEFAULT_SESSION_KEY)
        if runtime is not None:
            context[self.RUNTIME_KEY] = runtime
        return runtime

    def _resolve_source_session_key(self, params: dict, context: dict) -> str:
        source_ref = str(params.get("source_step_id") or "").strip()
        if not source_ref:
            return ""
        source_val = context.get(source_ref)
        if source_val is None:
            raise ValueError(f"source_step_id が context に存在しません: {source_ref}")
        try:
            df = self.to_dataframe(source_val)
        except Exception:
            return str(source_val or "").strip()
        if self.SESSION_ID_COLUMN not in df.columns or len(df.index) == 0:
            raise ValueError(
                f"source_step_id の出力に {self.SESSION_ID_COLUMN} がありません: {source_ref}"
            )
        return str(df.iloc[0][self.SESSION_ID_COLUMN] or "").strip()

    def _current_session_id(self, context: dict) -> str:
        runtime = context.get(self.RUNTIME_KEY) if isinstance(context, dict) else None
        sid = str((runtime or {}).get("session_id") or "").strip()
        if sid:
            return sid
        return self._get_session_key(context) or ""

    @staticmethod
    def _get_session_key(context: dict) -> str:
        if not isinstance(context, dict):
            return ""
        workspace_root = str(context.get("__workspace_root") or "").strip()
        flow_dir = str(context.get("__flow_dir") or "").strip()
        if workspace_root or flow_dir:
            return f"{workspace_root}|{flow_dir}"
        run_id = str(context.get("__run_id") or "").strip()
        workspace_tab_id = str(context.get("__workspace_tab_id") or "").strip()
        if run_id and workspace_tab_id:
            return f"{workspace_tab_id}:{run_id}"
        return ""

    def _resolve_element(self, page, params: dict):
        self._require(params, ["selector"])
        timeout_ms = int(params.get("timeout_ms") or self.DEFAULT_TIMEOUT_MS)
        by, query = self._to_locator(params)
        wait = WebDriverWait(page, max(1, timeout_ms / 1000))
        return wait.until(EC.presence_of_element_located((by, query)))

    def _require(self, params: dict, keys: list[str]) -> None:
        missing = [key for key in keys if params.get(key) is None or params.get(key) == ""]
        if missing:
            raise ValueError(f"必須パラメータが不足しています: {', '.join(missing)}")

    def _save_output(self, params: dict, context: dict, df):
        output_var = params.get("output_var")
        if output_var:
            context[output_var] = df
        return df

    def _to_locator(self, params: dict):
        selector = str(params.get("selector") or "")
        selector_type = str(params.get("selector_type") or "css").strip().lower()
        if selector_type == "css":
            return By.CSS_SELECTOR, selector
        if selector_type == "xpath":
            return By.XPATH, selector
        if selector_type == "text":
            return By.XPATH, f"//*[normalize-space(.)={self._xpath_literal(selector)}]"
        raise ValueError(f"selector_type が不正です: {selector_type}")

    def _open_new_tab(self, runtime: dict) -> str:
        driver = runtime["driver"]
        driver.switch_to.new_window("tab")
        return driver.current_window_handle

    def _switch_to_handle(self, runtime: dict, handle: str) -> None:
        driver = runtime["driver"]
        handles = set(driver.window_handles)
        if handle not in handles:
            raise ValueError("操作対象タブが閉じられています。再度 navigate を実行してください。")
        driver.switch_to.window(handle)

    def _wait_after_navigate(self, driver, wait_until: str, timeout_ms: int) -> None:
        state = "complete" if wait_until in {"load", "networkidle"} else "interactive"
        wait = WebDriverWait(driver, max(1, timeout_ms / 1000))
        wait.until(self._document_ready_condition(state))

    def _document_ready_condition(self, state: str):
        expected = str(state or "interactive").strip().lower()
        if expected == "networkidle":
            expected = "complete"

        def _cond(driver):
            try:
                ready = str(driver.execute_script("return document.readyState") or "").lower()
            except Exception:
                return False
            if expected == "interactive":
                return ready in {"interactive", "complete"}
            return ready == "complete"

        return _cond

    @staticmethod
    def _xpath_literal(value: str) -> str:
        text = str(value or "")
        if "'" not in text:
            return f"'{text}'"
        if '"' not in text:
            return f'"{text}"'
        parts = text.split("'")
        return "concat(" + ", \"'\", ".join(f"'{part}'" for part in parts) + ")"
