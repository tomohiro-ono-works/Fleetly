// excel_modal.js
(function () {
  "use strict";

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

  function loadTop30As2D(ws) {
    const ref = ws["!ref"];
    if (!ref) return { columns: [], rows2d: [], baseRow: 0, colCount: 0 };

    const rng = XLSX.utils.decode_range(ref);

    // 列ズレ対策：開始列を必ずAに固定
    rng.s.c = 0;

    // 上から30行のみ（0..29）
    rng.s.r = 0;
    rng.e.r = Math.min(rng.e.r, 29);

    const colCount = rng.e.c - rng.s.c + 1;
    const columns = Array.from({ length: colCount }, (_, i) => colIndexToLetters(i));

    const rows2dRaw = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: null,
      range: rng
    });

    // 30行固定（空行も保持）
    const wantRows = 30;
    const rows2d = [];
    for (let r = 0; r < wantRows; r++) {
      const row = rows2dRaw[r] || [];
      const fixed = Array.from({ length: colCount }, (_, c) => (c < row.length ? (row[c] ?? null) : null));
      rows2d.push(fixed);
    }

    return { columns, rows2d, baseRow: 0, colCount };
  }

  function paintRowMarks(tbody, headerRowInView, dataStartRowInView) {
    tbody.querySelectorAll("tr").forEach((tr) => {
      const r = Number(tr.dataset.r);
      tr.classList.toggle("header-row", r === headerRowInView);
      tr.classList.toggle("data-start-row", r === dataStartRowInView);
    });
  }

  async function readWorkbook(file) {
    const buf = await file.arrayBuffer();
    return XLSX.read(buf, { type: "array" });
  }

  function createExcelModal(modalId = "excelModal") {
    if (!window.ModalCore) throw new Error("ModalCore is not loaded.");
    if (!window.XLSX) throw new Error("XLSX is not loaded.");

    const root = document.getElementById(modalId);
    if (!root) throw new Error(`Modal DOM not found: #${modalId}`);

    const core = window.ModalCore.create(root);
    const $file = core.q("#xFile");
    const $sheet = core.q("#xSheet");
    const $status = core.q("#xStatus");
    const $picked = core.q("#xPicked");
    const $wrap = core.q("#xTableWrap");
    const $ok = core.q("#xOk");

    let workbook = null;
    let fileName = null;

    let view = { columns: [], rows2d: [], baseRow: 0, colCount: 0 };
    let headerRowInView = 0;
    let dataStartRowInView = 1;

    let onOk = null;
    let clickTimer = null;

    function setStatus(msg) { $status.textContent = msg || ""; }

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
      setPickedText();
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

    // events
    $file.addEventListener("change", async () => {
      try {
        clearTable();
        const file = $file.files && $file.files[0];
        if (!file) return;

        setStatus("Excelを読み込み中…");
        workbook = await readWorkbook(file);
        fileName = file.name;

        buildSheetSelect($sheet, workbook);

        const initialSheet = workbook.SheetNames[0];
        if (!initialSheet) { setStatus("シートがありません。"); return; }

        $sheet.value = initialSheet;
        view = loadTop30As2D(workbook.Sheets[initialSheet]);

        headerRowInView = 0;
        dataStartRowInView = 1;

        renderTable();
        setStatus(`読み込み完了: ${file.name} / ${initialSheet}`);
      } catch (err) {
        setStatus(`ERROR: ${err.message || err}`);
        clearTable();
      }
    });

    $sheet.addEventListener("change", () => {
      try {
        if (!workbook) return;
        const name = $sheet.value;

        view = loadTop30As2D(workbook.Sheets[name]);
        headerRowInView = 0;
        dataStartRowInView = 1;

        renderTable();
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
        fileName,
        sheetName: $sheet.value || null,
        headerRow,
        dataStartRow
      };

      if (onOk) onOk(result);
      core.close();
    });

    function open(opts = {}) {
      onOk = typeof opts.onOk === "function" ? opts.onOk : null;
      core.open();
      setPickedText();
    }

    return { open, close: core.close };
  }

  // グローバルAPI（1行呼び出し）
  let _instance = null;

  window.ExcelModal = {
    open: (opts) => {
      if (!_instance) _instance = createExcelModal("excelModal");
      _instance.open(opts);
    },
    close: () => { if (_instance) _instance.close(); }
  };
})();
