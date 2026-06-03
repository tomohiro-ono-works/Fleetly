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

  function colIndexToLetters(idx0) {
    let n = idx0 + 1;
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function normalizeEncoding(value) {
    const raw = String(value || "utf-8").trim().toLowerCase();
    if (raw === "utf8") return "utf-8";
    if (raw === "cp932") return "shift_jis";
    return raw || "utf-8";
  }

  function normalizeDelimiter(value) {
    const raw = String(value || ",");
    if (raw === "\\t" || raw.toLowerCase() === "tab") return "\t";
    return raw;
  }

  function parseDelimitedText(text, delimiter) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const sep = normalizeDelimiter(delimiter);

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === "\"") {
        if (inQuotes && next === "\"") {
          cell += "\"";
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (!inQuotes && ch === sep) {
        row.push(cell);
        cell = "";
        continue;
      }

      if (!inQuotes && (ch === "\n" || ch === "\r")) {
        if (ch === "\r" && next === "\n") i += 1;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      cell += ch;
    }

    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }

    return rows;
  }

  async function readDelimitedRows(file, encoding, delimiter) {
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder(normalizeEncoding(encoding));
    const text = decoder.decode(buffer);
    return parseDelimitedText(text, delimiter);
  }

  function normalizeRows(rows) {
    const limitedRows = rows.slice(0, 100);
    const colCount = limitedRows.reduce((max, row) => Math.max(max, row.length), 0);
    const columns = Array.from({ length: colCount }, (_, i) => colIndexToLetters(i));
    const previewRows = [];
    for (let r = 0; r < Math.min(limitedRows.length, 30); r += 1) {
      const row = limitedRows[r] || [];
      previewRows.push(Array.from({ length: colCount }, (_, c) => {
        const value = c < row.length ? row[c] : "";
        return value === "" ? null : value;
      }));
    }
    return { columns, rows2d: previewRows, schemaRows2d: limitedRows, baseRow: 0, colCount };
  }

  function paintRowMarks(tbody, headerRowInView, dataStartRowInView) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      const r = Number(tr.dataset.r);
      tr.classList.toggle("header-row", r === headerRowInView);
      tr.classList.toggle("data-start-row", r === dataStartRowInView);
    });
  }

  function createCsvModal(modalId = "csvModal") {
    if (!modalCoreApi) throw new Error("ModalCore is not loaded.");
    if (!previewSchemaApi) throw new Error("PreviewSchema is not loaded.");

    const root = document.getElementById(modalId);
    if (!root) throw new Error(`Modal DOM not found: #${modalId}`);

    const core = modalCoreApi.create(root);
    const $file = core.q("#cFile");
    const $pick = core.q("#cPick");
    const $fileLabel = core.q("#cFileLabel");
    const $encoding = core.q("#cEncoding");
    const $delimiter = core.q("#cDelimiter");
    const $status = core.q("#cStatus");
    const $picked = core.q("#cPicked");
    const $wrap = core.q("#cTableWrap");
    const $ok = core.q("#cOk");

    let fileName = null;
    let preview = { columns: [], rows2d: [], schemaRows2d: [], baseRow: 0, colCount: 0 };
    let headerRowInView = 0;
    let dataStartRowInView = 1;
    let onOk = null;
    let currentRef = "";
    let currentValue = "";
    let currentStepName = "global";
    let currentFieldKey = "file_path";
    let currentHiddenBindings = {};
    let clickTimer = null;

    function setStatus(msg) {
      $status.textContent = msg || "";
    }
    function setFileLabel(text) {
      if ($fileLabel) $fileLabel.textContent = text || "未選択";
    }
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

    function clearTable() {
      $wrap.innerHTML = "";
      preview = { columns: [], rows2d: [], schemaRows2d: [], baseRow: 0, colCount: 0 };
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
      preview = {
        columns: payload.columns || [],
        rows2d: payload.rows2d || [],
        schemaRows2d: payload.schema_rows2d || payload.rows2d || [],
        baseRow: Number(payload.base_row || 0),
        colCount: Number(payload.col_count || 0)
      };
      if (payload.encoding) $encoding.value = payload.encoding;
      if (payload.delimiter) $delimiter.value = payload.delimiter === "\t" ? "\\t" : payload.delimiter;
      headerRowInView = 0;
      dataStartRowInView = Math.min(1, Math.max(preview.rows2d.length - 1, 0));
      renderTable();
    }

    function setPickedText() {
      const headerRow = preview.baseRow + headerRowInView + 1;
      const dataStartRow = preview.baseRow + dataStartRowInView + 1;
      $picked.textContent =
        `ファイル: ${fileName || "-"} / 文字コード: ${$encoding.value || "-"} / 区切り文字: ${$delimiter.value || "-"} / ヘッダー行: ${headerRow} / データ開始行: ${dataStartRow}`;
    }

    function renderTable() {
      $wrap.innerHTML = "";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      const thRowNo = document.createElement("th");
      thRowNo.textContent = "#";
      thRowNo.className = "rowno";
      trh.appendChild(thRowNo);
      preview.columns.forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col;
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      preview.rows2d.forEach((rowArr, rIdx) => {
        const tr = document.createElement("tr");
        tr.dataset.r = String(rIdx);

        const tdNo = document.createElement("td");
        tdNo.textContent = String(preview.baseRow + rIdx + 1);
        tdNo.className = "rowno";
        tr.appendChild(tdNo);

        for (let c = 0; c < preview.colCount; c += 1) {
          const td = document.createElement("td");
          const v = rowArr[c];
          td.textContent = v === null || v === undefined ? "" : String(v);
          tr.appendChild(td);
        }

        tr.addEventListener("click", () => {
          if (clickTimer) clearTimeout(clickTimer);
          clickTimer = setTimeout(() => {
            headerRowInView = rIdx;
            paintRowMarks(tbody, headerRowInView, dataStartRowInView);
            setPickedText();
          }, 220);
        });

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

    async function reloadPreview() {
      const file = $file.files && $file.files[0];
      if (!file) {
        clearTable();
        return;
      }
      try {
        setStatus("CSVを読み込み中…");
        const rows = await readDelimitedRows(file, $encoding.value, $delimiter.value);
        fileName = file.name;
        preview = normalizeRows(rows);
        headerRowInView = 0;
        dataStartRowInView = Math.min(1, Math.max(preview.rows2d.length - 1, 0));
        renderTable();
        setStatus(`読み込み完了: ${file.name}`);
      } catch (err) {
        setStatus(`ERROR: ${err.message || err}`);
        clearTable();
      }
    }

    async function loadBridgePreview() {
      const bridgeApi = resolveBridgeApi();
      if (!bridgeApi?.available?.()) return false;
      if (!currentRef && !currentValue) return false;
      const payload = await bridgeApi.call("preview.readCsv", {
        current_ref: currentRef || "",
        current_value: currentRef ? "" : String(currentValue || ""),
        field_key: currentFieldKey,
        encoding: $encoding.value,
        delimiter: $delimiter.value,
        workspace_tab_id: resolveWorkspaceTabId(),
      });
      applyBridgePreview(payload || {});
      return true;
    }

    async function pickBridgeFile() {
      const bridgeApi = resolveBridgeApi();
      if (!bridgeApi?.available?.()) return false;
      const picked = await bridgeApi.call("file.pickFile", {
        title: "CSVファイルを選択",
        step_name: currentStepName,
        field_key: currentFieldKey,
        current_ref: currentRef || "",
        current_value: currentRef ? "" : String(currentValue || ""),
        filters: [{ label: "CSV/TSV/TXT", patterns: ["*.csv", "*.tsv", "*.txt"] }],
        workspace_tab_id: resolveWorkspaceTabId(),
      });
      if (!picked || picked.selected === false || !picked.ref) return true;
      currentRef = picked.ref;
      currentValue = "";
      await loadBridgePreview();
      setStatus(`読み込み完了: ${fileName || "-"}`);
      return true;
    }

    $file.addEventListener("change", reloadPreview);
    $encoding.addEventListener("change", async () => {
      const bridgeApi = resolveBridgeApi();
      if (bridgeApi?.available?.() && (currentRef || currentValue)) {
        try {
          await loadBridgePreview();
          setStatus(`読み込み完了: ${fileName || "-"}`);
        } catch (err) {
          setStatus(`ERROR: ${err.message || err}`);
          clearTable();
        }
        return;
      }
      reloadPreview();
    });
    $delimiter.addEventListener("change", async () => {
      const bridgeApi = resolveBridgeApi();
      if (bridgeApi?.available?.() && (currentRef || currentValue)) {
        try {
          await loadBridgePreview();
          setStatus(`読み込み完了: ${fileName || "-"}`);
        } catch (err) {
          setStatus(`ERROR: ${err.message || err}`);
          clearTable();
        }
        return;
      }
      reloadPreview();
    });

    if ($pick) {
      $pick.addEventListener("click", async () => {
        try {
          if (await pickBridgeFile()) return;
          $file.click();
        } catch (err) {
          setStatus(`ERROR: ${err.message || err}`);
          clearTable();
        }
      });
    }

    $ok.addEventListener("click", () => {
      const headerRow = preview.baseRow + headerRowInView + 1;
      const dataStartRow = preview.baseRow + dataStartRowInView + 1;
      const schema = previewSchemaApi.buildPreviewSchema(preview.schemaRows2d, headerRowInView, dataStartRowInView);
      const result = {
        fileName: currentRef || fileName,
        encoding: $encoding.value,
        delimiter: $delimiter.value,
        headerRow,
        dataStartRow,
        schema: JSON.stringify(schema, null, 2)
      };
      if (onOk) onOk(result);
      core.close();
    });

    function open(opts = {}) {
      try { console.info("[csv-modal] open start"); } catch (_) {}
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
      try { console.info("[csv-modal] bridge resolved", !!bridgeApi, bridgeApi?.status?.()); } catch (_) {}
      if (bridgeApi?.available?.() && (currentRef || currentValue)) {
        loadBridgePreview().then(() => {
          setStatus(`読み込み完了: ${fileName || "-"}`);
        }).catch((err) => {
          setStatus(`ERROR: ${err.message || err}`);
        });
      }
    }

    return { open, close: core.close };
  }

  let _instance = null;

  const csvModalApi = {
    open: (opts) => {
      if (!_instance) _instance = createCsvModal("csvModal");
      _instance.open(opts);
    },
    close: () => {
      if (_instance) _instance.close();
    }
  };
  window.CsvModal = csvModalApi;
})();
