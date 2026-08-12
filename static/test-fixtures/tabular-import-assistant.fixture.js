(function () {
  "use strict";

  const library = window.zizPackages.tabularImportAssistant;
  const events = [];
  const previewRequests = [];
  const sourceRequests = [];
  const schemaRequests = [];
  const sources = {
    excel: new Proxy({}, {
      get() {
        throw new Error("opaque Excel source was inspected");
      },
      getOwnPropertyDescriptor() {
        throw new Error("opaque Excel source shape was inspected");
      },
      ownKeys() {
        throw new Error("opaque Excel source keys were inspected");
      }
    }),
    csv: Object.freeze({ fixture: "csv-source" }),
    staleA: Object.freeze({ fixture: "stale-a" }),
    staleB: Object.freeze({ fixture: "stale-b" }),
    closePending: Object.freeze({ fixture: "close-pending" })
  };
  let staleResolve = null;
  let closeResolve = null;

  function record(type, payload) {
    events.push({ type, payload });
  }

  function excelPreview(sheetName) {
    const secondSheet = sheetName === "Sheet2";
    return {
      columns: ["A", "B", "C"],
      rows: secondSheet
        ? [["code", "amount", "date"], ["B-1", 200, "2026-07-02"], ["B-2", 300, "2026-07-03"]]
        : [["code", "amount", "date"], ["A-1", 100, "2026-07-01"], ["A-2", 150, "2026-07-02"]],
      base_row: 0,
      row_count: 3,
      truncated: false,
      metadata: {
        sheet_names: ["Sheet1", "Sheet2"],
        sheet_name: secondSheet ? "Sheet2" : "Sheet1"
      }
    };
  }

  function csvPreview(delimiter) {
    return {
      columns: ["A", "B"],
      rows: [["name", "value"], ["alpha", delimiter === "\t" ? "tab" : "comma"]],
      base_row: 0,
      row_count: 2,
      truncated: false,
      metadata: {
        encoding: "utf-8",
        delimiter
      }
    };
  }

  async function requestSource(request) {
    sourceRequests.push(request);
    return request.format_id === "excel"
      ? { source: sources.excel, display_name: "sales.xlsx", display_hint: "fixture Excel" }
      : { source: sources.csv, display_name: "sales.csv", display_hint: "fixture CSV" };
  }

  async function requestPreview(request) {
    previewRequests.push(request);
    if (request.source === sources.staleA) {
      return new Promise((resolve) => {
        staleResolve = resolve;
      });
    }
    if (request.source === sources.closePending) {
      return new Promise((resolve) => {
        closeResolve = resolve;
      });
    }
    if (request.source === sources.staleB) {
      return {
        columns: ["A"],
        rows: [["new"], ["result"]],
        base_row: 0,
        metadata: {}
      };
    }
    if (request.format_id === "excel") {
      return excelPreview(request.options.sheet_name);
    }
    return csvPreview(request.options.delimiter);
  }

  async function deriveSchema(request) {
    schemaRequests.push(request);
    return request.preview.columns.map((column) => ({
      origin_name: column,
      ziz_datatype: "STRING"
    }));
  }

  const assistant = library.createTabularImportAssistant({
    root: document.getElementById("primaryAssistant"),
    formats: [
      library.createExcelFormat(),
      library.createDelimitedTextFormat({ id: "csv", label: "CSV" })
    ],
    requestSource,
    requestPreview,
    deriveSchema
  });

  [
    "source:request",
    "source:change",
    "preview:request",
    "preview:change",
    "selection:change",
    "confirm",
    "cancel",
    "error"
  ].forEach((eventName) => assistant.on(eventName, (payload) => record(eventName, payload)));

  const secondary = library.createTabularImportAssistant({
    root: document.getElementById("secondaryAssistant"),
    presentation: "panel",
    formats: [library.createDelimitedTextFormat({ id: "csv", label: "CSV" })],
    requestPreview: async () => csvPreview(",")
  });
  secondary.open({
    format_id: "csv",
    source: sources.csv,
    display_name: "secondary.csv",
    preview: csvPreview(",")
  });

  document.getElementById("fixtureTrigger").addEventListener("click", () => {
    assistant.open({ format_id: "excel" });
  });

  window.tabularImportFixture = {
    assistant,
    secondary,
    events,
    previewRequests,
    sourceRequests,
    schemaRequests,
    sources,
    openExcel() {
      assistant.open({ format_id: "excel" });
    },
    openCsv() {
      assistant.open({
        format_id: "csv",
        source: sources.csv,
        display_name: "sales.csv",
        display_hint: "fixture CSV"
      });
    },
    startStalePreview() {
      assistant.open({
        format_id: "excel",
        source: sources.staleA,
        display_name: "old.xlsx"
      });
      assistant.setSource({ source: sources.staleB, display_name: "new.xlsx" });
    },
    resolveStalePreview() {
      staleResolve?.(excelPreview("Sheet1"));
    },
    startClosePending() {
      assistant.open({
        format_id: "excel",
        source: sources.closePending,
        display_name: "pending.xlsx"
      });
    },
    resolveClosePending() {
      closeResolve?.(excelPreview("Sheet1"));
    },
    async verifyDestroyIgnoresPending() {
      const destroyHost = document.createElement("div");
      document.body.appendChild(destroyHost);
      let resolvePreview;
      let previewChangeCount = 0;
      const pending = library.createTabularImportAssistant({
        root: destroyHost,
        formats: [library.createExcelFormat()],
        requestPreview: () => new Promise((resolve) => {
          resolvePreview = resolve;
        })
      });
      pending.on("preview:change", () => {
        previewChangeCount += 1;
      });
      pending.open({
        format_id: "excel",
        source: sources.closePending,
        display_name: "destroy.xlsx"
      });
      pending.destroy();
      resolvePreview(excelPreview("Sheet1"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const result = {
        childCount: destroyHost.childElementCount,
        previewChangeCount
      };
      destroyHost.remove();
      return result;
    }
  };
})();
