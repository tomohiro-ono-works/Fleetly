(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};
  const schemaModel = modules.workflowSchemaModel;
  const { SIMPLE_TYPES, clone, mergeRows, normalizeColumn } =
    schemaModel;

  function createElement(tag, className, textContent = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (textContent) element.textContent = textContent;
    return element;
  }

  function createWorkflowSchemaPane(options = {}) {
    const tableRoot = options.tableRoot;
    const jsonRoot = options.jsonRoot;
    let policy = "readonly";
    let rows = [];
    let runtimeCount = 0;

    const toolbar = createElement("div", "workflow-schema-toolbar");
    const importButton = createElement(
      "button",
      "workflow-schema-command",
      "スキーマ取り込み"
    );
    importButton.type = "button";
    const addButton = createElement(
      "button",
      "workflow-schema-command",
      "カラム追加"
    );
    addButton.type = "button";
    const message = createElement("div", "workflow-schema-message");
    const tableWrap = createElement("div", "workflow-data-scroll");
    const table = createElement("table", "workflow-data-table workflow-schema-table");
    const head = document.createElement("thead");
    const body = document.createElement("tbody");
    table.append(head, body);
    tableWrap.appendChild(table);
    toolbar.append(importButton, addButton);
    tableRoot.replaceChildren(toolbar, message, tableWrap);

    const jsonMessage = createElement("div", "workflow-schema-message");
    const jsonInput = createElement("textarea", "workflow-schema-json");
    jsonInput.spellcheck = false;
    jsonInput.setAttribute("aria-label", "スキーマ定義 JSON");
    jsonRoot.replaceChildren(jsonMessage, jsonInput);

    function canonicalColumns() {
      return schemaModel.canonicalColumns(rows, policy);
    }

    function notifyCommit() {
      jsonInput.value = JSON.stringify(canonicalColumns(), null, 2);
      options.onCommit?.(canonicalColumns());
    }

    function typeSelect(row) {
      const select = document.createElement("select");
      const types = SIMPLE_TYPES.includes(row.ziz_datatype)
        ? SIMPLE_TYPES
        : [row.ziz_datatype, ...SIMPLE_TYPES];
      types.forEach((type) => {
        const option = document.createElement("option");
        option.value = type;
        option.textContent = type;
        option.selected = type === row.ziz_datatype;
        select.appendChild(option);
      });
      select.disabled = policy === "readonly" || !row.selected;
      select.addEventListener("change", () => {
        row.ziz_datatype = select.value;
        notifyCommit();
      });
      return select;
    }

    function input(value, label, readOnly, onChange) {
      const field = document.createElement("input");
      field.type = "text";
      field.value = value;
      field.setAttribute("aria-label", label);
      field.readOnly = readOnly;
      field.addEventListener("change", () => onChange(field.value));
      return field;
    }

    function renderRows() {
      const editable = policy !== "readonly";
      const allowRename = policy === "editable";
      head.innerHTML = "";
      body.innerHTML = "";
      const headings = editable
        ? ["対象", "元フィールド名"]
        : ["元フィールド名"];
      if (allowRename) headings.push("新フィールド名");
      headings.push("データ型");
      if (editable) headings.push("");
      const headerRow = document.createElement("tr");
      headings.forEach((heading) => {
        const cell = document.createElement("th");
        cell.textContent = heading;
        headerRow.appendChild(cell);
      });
      head.appendChild(headerRow);

      rows.forEach((row, index) => {
        const line = document.createElement("tr");
        line.classList.toggle("is-unselected", !row.selected);
        if (editable) {
          const checkCell = document.createElement("td");
          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = row.selected;
          checkbox.setAttribute("aria-label", `${row.origin_name || "カラム"}を対象にする`);
          checkbox.addEventListener("change", () => {
            row.selected = checkbox.checked;
            renderRows();
            notifyCommit();
          });
          checkCell.appendChild(checkbox);
          line.appendChild(checkCell);
        }
        const originCell = document.createElement("td");
        originCell.appendChild(input(
          row.origin_name,
          "元フィールド名",
          policy !== "editable" || row.runtime,
          (value) => {
            row.origin_name = String(value ?? "").trim();
            if (!row.new_name) row.new_name = row.origin_name;
            notifyCommit();
          }
        ));
        line.appendChild(originCell);
        if (allowRename) {
          const nameCell = document.createElement("td");
          nameCell.appendChild(input(
            row.new_name,
            "新フィールド名",
            !row.selected,
            (value) => {
              row.new_name = String(value ?? "").trim();
              notifyCommit();
            }
          ));
          line.appendChild(nameCell);
        }
        const typeCell = document.createElement("td");
        typeCell.appendChild(typeSelect(row));
        line.appendChild(typeCell);
        if (editable) {
          const actionCell = document.createElement("td");
          if (policy === "editable" && !row.runtime) {
            const remove = createElement("button", "workflow-schema-remove");
            remove.type = "button";
            remove.title = "削除";
            remove.setAttribute("aria-label", "削除");
            const icon = document.createElement("img");
            icon.src = "./icons/delete.svg";
            icon.alt = "";
            remove.appendChild(icon);
            remove.addEventListener("click", () => {
              rows.splice(index, 1);
              renderRows();
              notifyCommit();
            });
            actionCell.appendChild(remove);
          }
          line.appendChild(actionCell);
        }
        body.appendChild(line);
      });
      message.textContent = rows.length
        ? ""
        : "表示できるschemaがありません。";
      importButton.hidden = policy === "readonly" || runtimeCount === 0;
      addButton.hidden = policy !== "editable";
    }

    importButton.addEventListener("click", () => {
      rows.forEach((row) => {
        row.selected = true;
      });
      renderRows();
      notifyCommit();
    });

    addButton.addEventListener("click", () => {
      rows.push({
        origin_name: "",
        new_name: "",
        ziz_datatype: "STRING",
        selected: true,
        runtime: false
      });
      renderRows();
    });

    jsonInput.addEventListener("change", () => {
      if (policy === "readonly") return;
      try {
        const parsed = JSON.parse(jsonInput.value || "[]");
        if (!Array.isArray(parsed)) throw new Error("JSON配列で指定してください。");
        rows = parsed.map((column) => ({
          ...normalizeColumn(column, policy),
          selected: true,
          runtime: false
        }));
        jsonMessage.textContent = "";
        renderRows();
        notifyCommit();
      } catch (error) {
        jsonMessage.textContent = String(error?.message || error);
      }
    });

    return Object.freeze({
      setData(value = {}) {
        policy = ["no_rename", "editable"].includes(value.policy)
          ? value.policy
          : "readonly";
        const saved = clone(value.saved_columns || []);
        const runtime = clone(value.runtime_columns || []);
        runtimeCount = runtime.length;
        rows = mergeRows(saved, runtime, policy);
        jsonInput.readOnly = policy === "readonly";
        jsonInput.value = JSON.stringify(canonicalColumns(), null, 2);
        jsonMessage.textContent = "";
        renderRows();
      },
      getColumns: canonicalColumns
    });
  }

  modules.createWorkflowSchemaPane = createWorkflowSchemaPane;
})(window);
