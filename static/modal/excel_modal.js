// excel_modal.js
(function () {
  "use strict";

  const packages = window.zizPackages || {};
  const modalPkg = packages.modal || {};
  const corePkg = packages.core || {};
  const modalCoreApi = modalPkg.modalCore || null;
  const previewSchemaApi = modalPkg.previewSchema || null;
  function safeResolveParentBridge() {
    try {
      if (!(window.parent && window.parent !== window)) return null;
      return window.parent?.zizBridge || (window.parent?.zizPackages || {})?.core?.bridge || null;
    } catch (_) {
      return null;
    }
  }
  function resolveBridgeApi() {
    const localBridge = window.zizBridge || corePkg.bridge || (window.zizPackages || {})?.core?.bridge || null;
    if (localBridge?.available?.()) return localBridge;
    const parentBridge = safeResolveParentBridge();
    if (parentBridge?.available?.()) return parentBridge;
    return localBridge || parentBridge;
  }
  function resolveWorkspaceTabId() {
    return String(
      window.zizEmbeddedApi?.getWorkspaceTabId?.()
      || window.__zizWorkspaceTabId?.()
      || "__standalone__"
    ).trim();
  }

  function buildSheetSelect($sheet, wb) {
    $sheet.innerHTML = "";
    for (const name of wb.SheetNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      $sheet.appendChild(opt);
    }
    $sheet.disabled = wb.SheetNames.length === 0;
  }

  function paintRowMarks(tbody, headerRowInView, dataStartRowInView) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      const r = Number(tr.dataset.r);
      tr.classList.toggle("header-row", r === headerRowInView);
      tr.classList.toggle("data-start-row", r === dataStartRowInView);
    });
  }

  function createExcelModal(modalId = "excelModal") {
    if (!modalCoreApi) throw new Error("ModalCore is not loaded.");
    if (!previewSchemaApi) throw new Error("PreviewSchema is not loaded.");

    const root = document.getElementById(modalId);
    if (!root) throw new Error(`Modal DOM not found: #${modalId}`);

    const core = modalCoreApi.create(root);
    const $pick = core.q("#xPick");
    const $fileLabel = core.q("#xFileLabel");
    const $sheet = core.q("#xSheet");
    const $status = core.q("#xStatus");
    const $picked = core.q("#xPicked");
    const $wrap = core.q("#xTableWrap");
    const $ok = core.q("#xOk");

    let fileName = null;

    let view = { columns: [], rows2d: [], baseRow: 0, colCount: 0 };
    let headerRowInView = 0;
    let dataStartRowInView = 1;

    let onOk = null;
    let currentRef = "";
    let currentValue = "";
    let currentStepName = "global";
    let currentFieldKey = "file_path";
    let currentHiddenBindings = {};
    let clickTimer = null;

    function setStatus(msg) { $status.textContent = msg || ""; }
    function setFileLabel(text) { if ($fileLabel) $fileLabel.textContent = text || "未選択"; }
    function getDisplayPath(payload) {
      if (payload && typeof payload === "object") {
        const hint = String(payload.display_hint || "").trim();
        if (hint) return hint;
      }
      if (currentRef && currentHiddenBindings && currentHiddenBindings[currentRef]) {
        const hint = String(currentHiddenBindings[currentRef].display_hint || "").trim();
        if (hint) return hint;
      }
      if (currentValue && !currentRef) return String(currentValue || "").trim();
      return "";
    }

    function setPickedText() {
      const headerExcelRow = view.baseRow + headerRowInView + 1;
      const dataExcelRow = view.baseRow + dataStartRowInView + 1;
      $picked.textContent =
        `ファイル: ${fileName || "-"} / シート: ${$sheet.value || "-"} / ヘッダー行: ${headerExcelRow} / データ開始行: ${dataExcelRow}`;
    }

    function clearTable() {
      $wrap.innerHTML = "";
      view = { columns: [], rows2d: [], baseRow: 0, colCount: 0 };
      headerRowInView = 0;
      dataStartRowInView = 1;
      setFileLabel(fileName || "");
      setPickedText();
    }

    function applyBridgePreview(payload) {
      fileName = payload.file_name || payload.display_name || null;
      currentRef = payload.ref || currentRef || "";
      if (currentRef && currentHiddenBindings) {
        currentHiddenBindings[currentRef] = {
          display_name: String(payload.display_name || fileName || ""),
          display_hint: String(payload.display_hint || "")
        };
      }
      setFileLabel(getDisplayPath(payload) || payload.display_name || fileName || "未選択");
      buildSheetSelect($sheet, { SheetNames: payload.sheet_names || [] });
      $sheet.value = payload.sheet_name || (payload.sheet_names && payload.sheet_names[0]) || "";
      view = {
        columns: payload.columns || [],
        rows2d: payload.rows2d || [],
        baseRow: Number(payload.base_row || 0),
        colCount: Number(payload.col_count || 0)
      };
      headerRowInView = 0;
      dataStartRowInView = 1;
      renderTable();
    }

    async function loadBridgePreview(sheetName) {
      const bridgeApi = resolveBridgeApi();
      if (!bridgeApi?.available?.()) return false;
      if (!currentRef && !currentValue) return false;
      const payload = await bridgeApi.call("preview.readExcel", {
        current_ref: currentRef || "",
        current_value: currentRef ? "" : String(currentValue || ""),
        field_key: currentFieldKey,
        sheet_name: sheetName || "",
        workspace_tab_id: resolveWorkspaceTabId(),
      });
      applyBridgePreview(payload || {});
      return true;
    }

    async function pickBridgeFile() {
      const bridgeApi = resolveBridgeApi();
      if (!bridgeApi?.available?.()) return false;
      const picked = await bridgeApi.call("file.pickFile", {
        title: "Excelファイルを選択",
        step_name: currentStepName,
        field_key: currentFieldKey,
        current_ref: currentRef || "",
        current_value: currentRef ? "" : String(currentValue || ""),
        filters: [{ label: "Excel", patterns: ["*.xlsx", "*.xlsm", "*.xls"] }],
        workspace_tab_id: resolveWorkspaceTabId(),
      });
      if (!picked || picked.selected === false || !picked.ref) return true;
      currentRef = picked.ref;
      currentValue = "";
      await loadBridgePreview("");
      setStatus(`読み込み完了: ${fileName || "-"} / ${$sheet.value || "-"}`);
      return true;
    }

    function renderTable() {
      $wrap.innerHTML = "";

      const table = document.createElement("table");

      // thead
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");

      const thRowNo = document.createElement("th");
      thRowNo.textContent = "#";
      thRowNo.className = "rowno";
      trh.appendChild(thRowNo);

      view.columns.forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col;
        trh.appendChild(th);
      });

      thead.appendChild(trh);
      table.appendChild(thead);

      // tbody
      const tbody = document.createElement("tbody");

      view.rows2d.forEach((rowArr, rIdx) => {
        const tr = document.createElement("tr");
        tr.dataset.r = String(rIdx);

        const tdNo = document.createElement("td");
        tdNo.textContent = String(view.baseRow + rIdx + 1);
        tdNo.className = "rowno";
        tr.appendChild(tdNo);

        for (let c = 0; c < view.colCount; c++) {
          const td = document.createElement("td");
          const v = rowArr[c];
          td.textContent = (v === null || v === undefined) ? "" : String(v);
          tr.appendChild(td);
        }

        // click: header row
        tr.addEventListener("click", () => {
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            headerRowInView = rIdx;
            paintRowMarks(tbody, headerRowInView, dataStartRowInView);
            setPickedText();
          }, 220);
        });

        // dblclick: data start row
        tr.addEventListener("dblclick", (e) => {
          e.preventDefault();
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = null;

          dataStartRowInView = rIdx;
          paintRowMarks(tbody, headerRowInView, dataStartRowInView);
          setPickedText();
        });

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      $wrap.appendChild(table);

      paintRowMarks(tbody, headerRowInView, dataStartRowInView);
      setPickedText();
    }

    if ($pick) {
      $pick.addEventListener("click", async () => {
        try {
          await pickBridgeFile();
        } catch (err) {
          setStatus(`ERROR: ${err.message || err}`);
          clearTable();
        }
      });
    }

    $sheet.addEventListener("change", async () => {
      try {
        const bridgeApi = resolveBridgeApi();
        const name = $sheet.value;
        if (!bridgeApi?.available?.() || (!currentRef && !currentValue)) return;
        await loadBridgePreview(name);
        setStatus(`表示中: ${name}`);
      } catch (err) {
        setStatus(`ERROR: ${err.message || err}`);
        clearTable();
      }
    });

    $ok.addEventListener("click", () => {
      const headerRow = view.baseRow + headerRowInView + 1;
      const dataStartRow = view.baseRow + dataStartRowInView + 1;

      const result = {
        fileName: currentRef || fileName,
        sheetName: $sheet.value || null,
        headerRow,
        dataStartRow,
         schema: JSON.stringify(previewSchemaApi.buildPreviewSchema(view.rows2d, headerRowInView, dataStartRowInView), null, 2)
       };

      if (onOk) onOk(result);
      core.close();
    });

    function open(opts = {}) {
      try { console.info("[excel-modal] open start"); } catch (_) {}
      onOk = typeof opts.onOk === "function" ? opts.onOk : null;
      currentStepName = String(opts.stepName || "global");
      currentFieldKey = String(opts.fieldKey || "file_path");
      currentValue = String(opts.currentValue || "");
      currentHiddenBindings = (opts.hiddenBindings && typeof opts.hiddenBindings === "object") ? opts.hiddenBindings : {};
      currentRef = (typeof currentValue === "string" && /^\{\{hidden\.[^}]+\}\}$/.test(currentValue.trim())) ? currentValue.trim() : "";
      fileName = null;
      clearTable();
      if (currentRef && currentHiddenBindings[currentRef]) {
        setFileLabel(getDisplayPath() || String(currentHiddenBindings[currentRef].display_name || currentRef));
      } else if (currentValue) {
        setFileLabel(getDisplayPath() || String(currentValue).split(/[\\/]/).pop());
      } else {
        setFileLabel("未選択");
      }
      core.open();
      setPickedText();
      const bridgeApi = resolveBridgeApi();
      try { console.info("[excel-modal] bridge resolved", !!bridgeApi, bridgeApi?.status?.()); } catch (_) {}
      if (bridgeApi?.available?.() && (currentRef || currentValue)) {
        loadBridgePreview("").then(() => {
          setStatus(`読み込み完了: ${fileName || "-"} / ${$sheet.value || "-"}`);
        }).catch((err) => {
          setStatus(`ERROR: ${err.message || err}`);
        });
      } else {
        setStatus("WebView モードでのみ利用できます。");
      }
    }

    return { open, close: core.close };
  }

  // グローバルAPI（1行呼び出し）
  let _instance = null;

  const excelModalApi = {
    open: (opts) => {
      if (!_instance) _instance = createExcelModal("excelModal");
      _instance.open(opts);
    },
    close: () => { if (_instance) _instance.close(); }
  };
  window.ExcelModal = excelModalApi;
})();
