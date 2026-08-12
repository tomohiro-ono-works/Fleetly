(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};
  let nextAssistantId = 1;

  function element(documentRef, tagName, className, text) {
    const node = documentRef.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function buildAssistantDom(documentRef, labels, presentation) {
    const instanceId = nextAssistantId;
    nextAssistantId += 1;
    const titleId = `ztia-title-${instanceId}`;
    const assistant = element(documentRef, "div", "ztia");
    assistant.dataset.presentation = presentation;
    assistant.setAttribute("aria-hidden", "true");

    const backdrop = element(documentRef, "button", "ztia__backdrop");
    backdrop.type = "button";
    backdrop.tabIndex = -1;
    backdrop.setAttribute("aria-label", labels.cancel);

    const panel = element(documentRef, "section", "ztia__panel");
    panel.setAttribute("role", presentation === "panel" ? "region" : "dialog");
    panel.setAttribute("aria-modal", presentation === "panel" ? "false" : "true");
    panel.setAttribute("aria-labelledby", titleId);
    panel.tabIndex = -1;

    const header = element(documentRef, "header", "ztia__header");
    const title = element(documentRef, "h2", "ztia__title", labels.title);
    title.id = titleId;
    const closeButton = element(documentRef, "button", "ztia-icon-button", "\u00d7");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", labels.close);
    header.append(title, closeButton);

    const toolbar = element(documentRef, "div", "ztia__toolbar");
    const sourceButton = element(documentRef, "button", "ztia-button", labels.selectSource);
    sourceButton.type = "button";
    const sourceText = element(documentRef, "span", "ztia__source-name", labels.noSource);
    sourceText.title = "";
    const formatControls = element(documentRef, "div", "ztia__format-controls");
    toolbar.append(sourceButton, sourceText, formatControls);

    const selectionBar = element(documentRef, "div", "ztia__selection-bar");
    const headerField = element(documentRef, "label", "ztia-field");
    const headerLabel = element(documentRef, "span", "ztia-field__label", labels.headerRow);
    const headerSelect = element(documentRef, "select", "ztia-select");
    headerSelect.setAttribute("aria-label", labels.headerRow);
    headerField.append(headerLabel, headerSelect);
    const dataField = element(documentRef, "label", "ztia-field");
    const dataLabel = element(documentRef, "span", "ztia-field__label", labels.dataStartRow);
    const dataSelect = element(documentRef, "select", "ztia-select");
    dataSelect.setAttribute("aria-label", labels.dataStartRow);
    dataField.append(dataLabel, dataSelect);
    const status = element(documentRef, "span", "ztia__status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    selectionBar.append(headerField, dataField, status);

    const preview = element(documentRef, "div", "ztia__preview");
    preview.setAttribute("role", "region");
    preview.setAttribute("aria-label", labels.preview);
    preview.tabIndex = 0;

    const footer = element(documentRef, "footer", "ztia__footer");
    const summary = element(documentRef, "span", "ztia__summary");
    const actions = element(documentRef, "div", "ztia__actions");
    const cancelButton = element(documentRef, "button", "ztia-button", labels.cancel);
    cancelButton.type = "button";
    const confirmButton = element(documentRef, "button", "ztia-button ztia-button--primary", labels.confirm);
    confirmButton.type = "button";
    actions.append(cancelButton, confirmButton);
    footer.append(summary, actions);

    panel.append(header, toolbar, selectionBar, preview, footer);
    assistant.append(backdrop, panel);

    return {
      root: assistant,
      backdrop,
      panel,
      title,
      closeButton,
      sourceButton,
      sourceText,
      formatControls,
      headerSelect,
      dataSelect,
      status,
      preview,
      summary,
      cancelButton,
      confirmButton
    };
  }

  function appendRowOptions(select, preview) {
    const documentRef = select.ownerDocument;
    select.replaceChildren();
    (preview?.rows || []).forEach((_, index) => {
      const rowNumber = Number(preview.base_row || 0) + index + 1;
      const option = documentRef.createElement("option");
      option.value = String(rowNumber);
      option.textContent = String(rowNumber);
      select.appendChild(option);
    });
  }

  function renderSelectionControls(refs, state, handlers) {
    appendRowOptions(refs.headerSelect, state.preview);
    appendRowOptions(refs.dataSelect, state.preview);
    refs.headerSelect.value = String(state.selection.header_row);
    refs.dataSelect.value = String(state.selection.data_start_row);
    const disabled = state.disabled || state.loading || !(state.preview?.rows?.length);
    refs.headerSelect.disabled = disabled;
    refs.dataSelect.disabled = disabled;
    refs.headerSelect.onchange = () => {
      handlers.onSelectionChange({ header_row: Number(refs.headerSelect.value) });
    };
    refs.dataSelect.onchange = () => {
      handlers.onSelectionChange({ data_start_row: Number(refs.dataSelect.value) });
    };
  }

  function paintSelection(refs, state) {
    refs.headerSelect.value = String(state.selection.header_row);
    refs.dataSelect.value = String(state.selection.data_start_row);
    refs.preview.querySelectorAll("tbody tr").forEach((row) => {
      const rowNumber = Number(row.dataset.sourceRow);
      const isHeader = rowNumber === state.selection.header_row;
      const isDataStart = rowNumber === state.selection.data_start_row;
      row.classList.toggle("is-header-row", isHeader);
      row.classList.toggle("is-data-start-row", isDataStart);
      row.setAttribute(
        "aria-label",
        `${rowNumber}${isHeader ? `, ${state.labels.headerRow}` : ""}${isDataStart ? `, ${state.labels.dataStartRow}` : ""}`
      );
    });
    refs.summary.textContent = state.preview?.rows?.length
      ? `${state.labels.headerRow}: ${state.selection.header_row} / ${state.labels.dataStartRow}: ${state.selection.data_start_row}`
      : "";
  }

  function focusRelativeRow(row, direction) {
    const rows = Array.from(row.parentElement?.querySelectorAll("tr") || []);
    const index = rows.indexOf(row);
    const targetIndex = Math.min(rows.length - 1, Math.max(0, index + direction));
    rows[targetIndex]?.focus();
  }

  function renderPreview(refs, state, handlers) {
    refs.preview.replaceChildren();
    if (state.loading && !state.preview) {
      const loading = element(refs.preview.ownerDocument, "div", "ztia__message", state.labels.loading);
      loading.setAttribute("role", "status");
      refs.preview.appendChild(loading);
      return;
    }
    if (state.error) {
      const error = element(refs.preview.ownerDocument, "div", "ztia__message ztia__message--error", state.error);
      error.setAttribute("role", "alert");
      refs.preview.appendChild(error);
      return;
    }
    if (!state.sourceInfo) {
      refs.preview.appendChild(element(refs.preview.ownerDocument, "div", "ztia__message", state.labels.noSource));
      return;
    }
    if (!state.preview?.rows?.length) {
      refs.preview.appendChild(element(refs.preview.ownerDocument, "div", "ztia__message", state.labels.empty));
      return;
    }

    const documentRef = refs.preview.ownerDocument;
    const table = element(documentRef, "table", "ztia-table");
    const head = documentRef.createElement("thead");
    const headerRow = documentRef.createElement("tr");
    const rowNumberHeader = element(documentRef, "th", "ztia-table__row-number", "#");
    rowNumberHeader.scope = "col";
    headerRow.appendChild(rowNumberHeader);
    state.preview.columns.forEach((column) => {
      const cell = documentRef.createElement("th");
      cell.scope = "col";
      cell.textContent = column;
      headerRow.appendChild(cell);
    });
    head.appendChild(headerRow);
    table.appendChild(head);

    const body = documentRef.createElement("tbody");
    state.preview.rows.forEach((values, rowIndex) => {
      const rowNumber = Number(state.preview.base_row || 0) + rowIndex + 1;
      const row = documentRef.createElement("tr");
      row.dataset.sourceRow = String(rowNumber);
      row.tabIndex = 0;
      const numberCell = element(documentRef, "th", "ztia-table__row-number", String(rowNumber));
      numberCell.scope = "row";
      row.appendChild(numberCell);
      values.forEach((value) => {
        const cell = documentRef.createElement("td");
        cell.textContent = value === null || value === undefined ? "" : String(value);
        row.appendChild(cell);
      });
      row.addEventListener("click", () => handlers.onRowClick(rowNumber));
      row.addEventListener("dblclick", (event) => {
        event.preventDefault();
        handlers.onRowDoubleClick(rowNumber);
      });
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handlers.onRowKeyboardSelect(rowNumber, event.shiftKey ? "data" : "header");
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          focusRelativeRow(row, 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          focusRelativeRow(row, -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          focusRelativeRow(row, -Number.MAX_SAFE_INTEGER);
        } else if (event.key === "End") {
          event.preventDefault();
          focusRelativeRow(row, Number.MAX_SAFE_INTEGER);
        }
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    refs.preview.appendChild(table);
    paintSelection(refs, state);
  }

  function focusableElements(panel) {
    return Array.from(panel.querySelectorAll(
      "button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )).filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
  }

  modules.assistantDom = Object.freeze({
    buildAssistantDom,
    renderSelectionControls,
    renderPreview,
    paintSelection,
    focusableElements
  });
})(window);
