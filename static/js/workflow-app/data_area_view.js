(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};
  const TABS = Object.freeze([
    ["schema", "スキーマ定義"],
    ["schema-json", "スキーマ定義（JSON）"],
    ["output", "データ出力"],
    ["logs", "ログ"]
  ]);

  function element(tag, className, text = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function createWorkflowDataAreaView(options = {}) {
    const mount = options.root;
    const panel = mount?.closest(".detail-panel");
    let activeTab = "schema";
    let hasMoreLogs = false;
    const tabButtons = new Map();
    const panes = new Map();

    mount.classList.add("workflow-data-area");
    const header = element("div", "workflow-data-area__header");
    const tabs = element("div", "workflow-data-tabs");
    tabs.setAttribute("role", "tablist");
    const status = element("div", "workflow-data-status");
    header.append(tabs, status);
    const body = element("div", "workflow-data-area__body");
    TABS.forEach(([id, label]) => {
      const button = element("button", "workflow-data-tab", label);
      button.type = "button";
      button.dataset.tab = id;
      button.setAttribute("role", "tab");
      button.addEventListener("click", () => setActiveTab(id, true));
      tabButtons.set(id, button);
      tabs.appendChild(button);

      const pane = element("section", "workflow-data-pane");
      pane.dataset.pane = id;
      pane.setAttribute("role", "tabpanel");
      panes.set(id, pane);
      body.appendChild(pane);
    });
    mount.replaceChildren(header, body);

    const schemaPane = modules.createWorkflowSchemaPane({
      tableRoot: panes.get("schema"),
      jsonRoot: panes.get("schema-json"),
      onCommit: options.onSchemaCommit
    });

    const outputStatus = element("div", "workflow-data-message");
    const outputScroll = element("div", "workflow-data-scroll");
    const outputTable = element("table", "workflow-data-table");
    const outputHead = document.createElement("thead");
    const outputBody = document.createElement("tbody");
    outputTable.append(outputHead, outputBody);
    outputScroll.appendChild(outputTable);
    panes.get("output").append(outputStatus, outputScroll);

    const logToolbar = element("div", "workflow-log-toolbar");
    const olderLogs = element("button", "workflow-log-more", "以前のログ");
    olderLogs.type = "button";
    olderLogs.addEventListener("click", () => options.onLoadOlderLogs?.());
    logToolbar.appendChild(olderLogs);
    const logList = element("div", "workflow-log-list");
    panes.get("logs").append(logToolbar, logList);

    function setActiveTab(tabId, notify = false) {
      activeTab = panes.has(tabId) ? tabId : "schema";
      tabButtons.forEach((button, id) => {
        const selected = id === activeTab;
        button.classList.toggle("is-active", selected);
        button.setAttribute("aria-selected", selected ? "true" : "false");
      });
      panes.forEach((pane, id) => {
        pane.hidden = id !== activeTab;
      });
      if (notify) options.onTabChange?.(activeTab);
    }

    function renderPreview(value = {}) {
      const columns = Array.isArray(value.columns) ? value.columns : [];
      const rows = Array.isArray(value.rows) ? value.rows : [];
      outputHead.innerHTML = "";
      outputBody.innerHTML = "";
      if (!columns.length) {
        outputScroll.hidden = true;
        outputStatus.textContent = value.message || "表示できる実行結果がありません。";
        return;
      }
      const headerRow = document.createElement("tr");
      columns.forEach((column) => {
        const cell = document.createElement("th");
        cell.textContent = String(column ?? "");
        headerRow.appendChild(cell);
      });
      outputHead.appendChild(headerRow);
      rows.forEach((row) => {
        const line = document.createElement("tr");
        columns.forEach((_, index) => {
          const cell = document.createElement("td");
          cell.textContent = String((row || [])[index] ?? "");
          line.appendChild(cell);
        });
        outputBody.appendChild(line);
      });
      const count = Number(value.row_count || 0);
      outputStatus.textContent = value.truncated
        ? `先頭 ${rows.length} / 全 ${count} 行`
        : `${count} 行`;
      outputScroll.hidden = false;
    }

    function formatLog(item) {
      const time = String(item?.ts || "").replace("T", " ").replace("Z", "");
      const level = String(item?.level || "INFO");
      const step = item?.step_id ? ` [step ${item.step_id}]` : "";
      const iteration = item?.iteration_no
        ? ` [${item.iteration_no}回目]`
        : "";
      return `${time} ${level}${step}${iteration} ${String(item?.message || "")}`;
    }

    function renderLogs(items) {
      logList.innerHTML = "";
      const logs = Array.isArray(items) ? items : [];
      if (!logs.length) {
        logList.appendChild(element(
          "div",
          "workflow-data-message",
          "表示できるログがありません。"
        ));
      } else {
        logs.forEach((item) => {
          const line = element("div", "workflow-log-line", formatLog(item));
          line.dataset.level = String(item?.level || "INFO").toLowerCase();
          logList.appendChild(line);
        });
      }
      olderLogs.hidden = !hasMoreLogs;
      logList.scrollTop = logList.scrollHeight;
    }

    function bindResizer() {
      const resizer = panel?.querySelector(".detail-panel-resizer");
      if (!resizer) return;
      let dragging = false;
      let hostBottom = 0;
      let currentHeight = 0;
      resizer.addEventListener("pointerdown", (event) => {
        const host = panel.parentElement?.getBoundingClientRect();
        if (!host) return;
        dragging = true;
        hostBottom = host.bottom;
        currentHeight = Math.round(panel.getBoundingClientRect().height);
        resizer.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });
      resizer.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        const height = Math.max(
          180,
          Math.min(460, Math.round(hostBottom - event.clientY))
        );
        if (height === currentHeight) return;
        currentHeight = height;
        panel.style.setProperty("--workflow-data-area-height", `${height}px`);
      });
      const finish = () => {
        dragging = false;
        hostBottom = 0;
      };
      resizer.addEventListener("pointerup", finish);
      resizer.addEventListener("pointercancel", finish);
    }

    setActiveTab(activeTab);
    bindResizer();
    renderPreview();
    renderLogs([]);

    return Object.freeze({
      setVisible(visible) {
        if (panel) panel.hidden = !visible;
      },
      setStatus(message, kind = "") {
        status.textContent = String(message || "");
        status.dataset.kind = String(kind || "");
      },
      setSchema(value) {
        schemaPane.setData(value);
      },
      setPreview: renderPreview,
      setLogs(items, value = {}) {
        hasMoreLogs = !!value.has_more_before;
        renderLogs(items);
      },
      setActiveTab,
      getActiveTab: () => activeTab
    });
  }

  modules.createWorkflowDataAreaView = createWorkflowDataAreaView;
})(window);
