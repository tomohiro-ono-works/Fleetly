(function () {
  const MAX_LOG_ROWS = 500;

  function text(value) {
    return String(value ?? "");
  }

  function createElement(tagName, className, value) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = text(value);
    return element;
  }

  function displayValue(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return text(value);
      }
    }
    return text(value);
  }

  function collectColumns(rows) {
    const columns = [];
    const seen = new Set();
    rows.forEach((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return;
      Object.keys(row).forEach((key) => {
        if (seen.has(key)) return;
        seen.add(key);
        columns.push(key);
      });
    });
    return columns;
  }

  function createTable(columns, rows) {
    const scroll = createElement("div", "standalone-result-table-scroll");
    const table = createElement("table", "standalone-result-table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    columns.forEach((column) => {
      headRow.appendChild(createElement("th", "", column));
    });
    head.appendChild(headRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((_, index) => {
        tr.appendChild(createElement("td", "", displayValue(row[index])));
      });
      body.appendChild(tr);
    });
    table.appendChild(body);
    scroll.appendChild(table);
    return scroll;
  }

  function renderStructured(host, value) {
    if (Array.isArray(value)) {
      const columns = collectColumns(value);
      if (columns.length) {
        const rows = value.map((item) => (
          columns.map((column) => displayValue(item?.[column]))
        ));
        host.appendChild(createTable(columns, rows));
        return;
      }
      host.appendChild(createElement(
        "pre",
        "standalone-result-text",
        displayValue(value)
      ));
      return;
    }
    if (value && typeof value === "object") {
      const rows = Object.entries(value).map(([key, item]) => [
        key,
        displayValue(item)
      ]);
      host.appendChild(createTable(["項目", "値"], rows));
      return;
    }
    host.appendChild(createElement(
      "pre",
      "standalone-result-text",
      displayValue(value)
    ));
  }

  function create(options = {}) {
    const host = options.host;
    if (!(host instanceof HTMLElement)) {
      throw new Error("standalone result viewのhostが不正です。");
    }

    const root = createElement("section", "standalone-result-panel");
    root.hidden = true;
    host.hidden = true;
    const header = createElement("header", "standalone-result-header");
    const tabs = createElement("div", "standalone-result-tabs");
    const resultTab = createElement("button", "is-active", "結果");
    resultTab.type = "button";
    resultTab.dataset.view = "result";
    const logTab = createElement("button", "", "ログ");
    logTab.type = "button";
    logTab.dataset.view = "log";
    tabs.append(resultTab, logTab);

    const status = createElement("span", "standalone-result-status", "");
    const close = createElement("button", "standalone-result-close", "×");
    close.type = "button";
    close.title = "結果を閉じる";
    close.setAttribute("aria-label", "結果を閉じる");
    header.append(tabs, status, close);

    const resultBody = createElement("div", "standalone-result-body");
    resultBody.dataset.view = "result";
    const logBody = createElement("div", "standalone-log-body");
    logBody.dataset.view = "log";
    logBody.hidden = true;
    const logTable = createElement("table", "standalone-log-table");
    const logHead = document.createElement("thead");
    const logHeadRow = document.createElement("tr");
    ["時刻", "level", "category", "message"].forEach((label) => {
      logHeadRow.appendChild(createElement("th", "", label));
    });
    logHead.appendChild(logHeadRow);
    const logRows = document.createElement("tbody");
    logTable.append(logHead, logRows);
    logBody.appendChild(logTable);
    root.append(header, resultBody, logBody);
    host.appendChild(root);

    let activeView = "result";

    function show() {
      host.hidden = false;
      root.hidden = false;
    }

    function selectView(viewName) {
      activeView = viewName === "log" ? "log" : "result";
      resultBody.hidden = activeView !== "result";
      logBody.hidden = activeView !== "log";
      resultTab.classList.toggle("is-active", activeView === "result");
      logTab.classList.toggle("is-active", activeView === "log");
    }

    tabs.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button[data-view]");
      if (button) selectView(button.dataset.view);
    });

    function clear() {
      resultBody.replaceChildren();
      logRows.replaceChildren();
      status.textContent = "";
      selectView("result");
      root.hidden = true;
      host.hidden = true;
    }

    close.addEventListener("click", () => {
      clear();
      if (typeof options.onClear === "function") options.onClear();
    });

    function setStatus(label, tone = "") {
      show();
      status.textContent = text(label);
      status.dataset.tone = text(tone);
    }

    function renderMessage(message, tone = "") {
      resultBody.replaceChildren(
        createElement("div", `standalone-result-message ${tone}`.trim(), message)
      );
      selectView("result");
      show();
    }

    function renderPreview(preview) {
      const columns = Array.isArray(preview?.columns)
        ? preview.columns.map(text)
        : [];
      const rows = Array.isArray(preview?.rows)
        ? preview.rows.map((row) => (
            columns.map((_, index) => displayValue(row?.[index]))
          ))
        : [];
      resultBody.replaceChildren();
      const summary = createElement(
        "div",
        "standalone-result-summary",
        `${Number(preview?.row_count || 0).toLocaleString()} 行`
          + (preview?.truncated ? "（preview上限まで表示）" : "")
      );
      resultBody.append(summary, createTable(columns, rows));
    }

    function renderCompleted(payload = {}) {
      setStatus("完了", "success");
      if (payload.preview) {
        renderPreview(payload.preview);
      } else if (Object.prototype.hasOwnProperty.call(payload, "text")) {
        resultBody.replaceChildren(createElement(
          "pre",
          "standalone-result-text",
          payload.text
        ));
      } else {
        resultBody.replaceChildren();
        if (Object.prototype.hasOwnProperty.call(payload, "dry_run")) {
          renderStructured(resultBody, payload.dry_run);
        } else if (Object.prototype.hasOwnProperty.call(payload, "metadata")) {
          renderStructured(resultBody, payload.metadata);
        } else if (Object.prototype.hasOwnProperty.call(payload, "export")) {
          renderStructured(resultBody, payload.export);
        } else {
          renderMessage("実行が完了しました。", "is-success");
        }
      }
      selectView("result");
      show();
    }

    function renderFailed(payload = {}) {
      const rawError = payload.error;
      const message = (
        rawError && typeof rawError === "object"
          ? rawError.message
          : rawError
      ) || "実行に失敗しました。ログを確認してください。";
      setStatus("エラー", "error");
      renderMessage(message, "is-error");
    }

    function renderCancelled() {
      setStatus("キャンセル", "cancelled");
      renderMessage("実行をキャンセルしました。", "is-cancelled");
    }

    function appendLog(item = {}) {
      const tr = document.createElement("tr");
      const date = new Date(item.ts || "");
      const timeLabel = Number.isNaN(date.getTime())
        ? text(item.ts)
        : date.toLocaleTimeString("ja-JP", { hour12: false });
      [
        timeLabel,
        text(item.level || "INFO"),
        text(item.category || ""),
        text(item.message || "")
      ].forEach((value) => {
        tr.appendChild(createElement("td", "", value));
      });
      tr.dataset.level = text(item.level || "INFO").toLowerCase();
      logRows.appendChild(tr);
      while (logRows.children.length > MAX_LOG_ROWS) {
        logRows.firstElementChild?.remove();
      }
      show();
    }

    function destroy() {
      root.remove();
      host.hidden = true;
    }

    return Object.freeze({
      clear,
      show,
      selectView,
      setStatus,
      renderMessage,
      renderCompleted,
      renderFailed,
      renderCancelled,
      appendLog,
      destroy
    });
  }

  const packages = window.zizPackages = window.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.standaloneResultView = Object.freeze({ create });
})();
