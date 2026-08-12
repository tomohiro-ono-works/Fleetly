(function (root) {
  "use strict";

  const REQUEST_EVENT = "zizai:tabular-import-request";
  const RESPONSE_EVENT = "zizai:tabular-import-response";
  const HIDDEN_REF_PATTERN = /^\{\{hidden\.[^}]+\}\}$/;
  const packages = root.zizPackages = root.zizPackages || {};
  const library = packages.tabularImportAssistant;

  if (!library) {
    throw new Error("TabularImportAssistant library is not loaded");
  }

  const host = document.createElement("div");
  host.dataset.zizaiTabularImportHost = "";
  document.body.appendChild(host);

  const schemaRowsByPreview = new Map();
  const sourceIds = new WeakMap();
  let nextSourceId = 1;
  let activeRequest = null;

  function safeParentBridge() {
    try {
      if (!root.parent || root.parent === root) return null;
      return root.parent.zizPackages?.core?.bridge || null;
    } catch (_) {
      return null;
    }
  }

  function resolveBridge() {
    const local = root.zizPackages?.core?.bridge || null;
    if (local?.available?.()) return local;
    const parent = safeParentBridge();
    if (parent?.available?.()) return parent;
    return local || parent;
  }

  function resolveWorkspaceTabId() {
    return String(
      root.zizEmbeddedApi?.getWorkspaceTabId?.()
      || root.__zizWorkspaceTabId?.()
      || "__standalone__"
    ).trim();
  }

  function sanitizeError(error, fallback) {
    const firstLine = String(error?.message || error || "")
      .split(/\r?\n/, 1)[0]
      .trim()
      .slice(0, 500);
    const sanitized = new Error(firstLine || fallback);
    sanitized.code = String(error?.code || "E_TABULAR_IMPORT");
    return sanitized;
  }

  async function callBridge(command, payload, fallback) {
    const bridge = resolveBridge();
    if (!bridge?.available?.() || typeof bridge.call !== "function") {
      throw new Error("アプリケーションbridgeが利用できません。");
    }
    try {
      return await bridge.call(command, payload);
    } catch (error) {
      throw sanitizeError(error, fallback);
    }
  }

  function isHiddenRef(value) {
    return HIDDEN_REF_PATTERN.test(String(value || "").trim());
  }

  function fileNameFromValue(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.split(/[\\/]/).pop() || text;
  }

  function appSource(ref, value) {
    return {
      ref: String(ref || ""),
      value: String(value || "")
    };
  }

  function normalizeAppSource(source) {
    if (!source || typeof source !== "object") return appSource("", String(source || ""));
    return appSource(source.ref, source.value);
  }

  function sourceInfoFromRequest(context) {
    const currentValue = String(context.currentValue || "").trim();
    if (!currentValue) return null;
    const ref = isHiddenRef(currentValue) ? currentValue : "";
    const value = ref ? "" : currentValue;
    const metadata = ref && context.hiddenBindings
      ? context.hiddenBindings[ref] || {}
      : {};
    return {
      source: appSource(ref, value),
      display_name: String(metadata.display_name || fileNameFromValue(currentValue)),
      display_hint: String(metadata.display_hint || value)
    };
  }

  function sourceIdentity(source) {
    if (source && typeof source === "object") {
      if (!sourceIds.has(source)) {
        sourceIds.set(source, nextSourceId);
        nextSourceId += 1;
      }
      return `object:${sourceIds.get(source)}`;
    }
    return `${typeof source}:${String(source)}`;
  }

  function previewCacheKey(request) {
    const optionEntries = Object.entries(request.options || {})
      .sort(([left], [right]) => left.localeCompare(right));
    return `${request.format_id}|${sourceIdentity(request.source)}|${JSON.stringify(optionEntries)}`;
  }

  function rememberHiddenBinding(context, ref, payload) {
    const normalizedRef = String(ref || "").trim();
    if (!normalizedRef || !context.hiddenBindings) return;
    context.hiddenBindings[normalizedRef] = {
      display_name: String(payload?.display_name || payload?.file_name || ""),
      display_hint: String(payload?.display_hint || "")
    };
  }

  function pickerFilters(formatId, accept) {
    const patterns = (Array.isArray(accept) ? accept : [])
      .map((extension) => String(extension || "").trim())
      .filter(Boolean)
      .map((extension) => extension.startsWith("*.") ? extension : `*${extension}`);
    return [{
      label: formatId === "excel" ? "Excel" : "CSV/TSV/TXT",
      patterns
    }];
  }

  async function requestSource(request) {
    const context = activeRequest;
    if (!context) return null;
    const current = normalizeAppSource(request.current_source);
    const picked = await callBridge("file.pickFile", {
      title: request.format_id === "excel" ? "Excelファイルを選択" : "CSVファイルを選択",
      step_name: context.stepName,
      field_key: context.fieldKey,
      current_ref: current.ref,
      current_value: current.ref ? "" : current.value,
      filters: pickerFilters(request.format_id, request.accept),
      workspace_tab_id: context.workspaceTabId
    }, "ファイルを選択できませんでした。");
    if (context !== activeRequest || !picked || picked.selected === false || !picked.ref) {
      return null;
    }
    rememberHiddenBinding(context, picked.ref, picked);
    return {
      source: appSource(picked.ref, ""),
      display_name: String(picked.display_name || ""),
      display_hint: String(picked.display_hint || "")
    };
  }

  function previewRequestPayload(request, context) {
    const source = normalizeAppSource(request.source);
    const payload = {
      current_ref: source.ref,
      current_value: source.ref ? "" : source.value,
      field_key: context.fieldKey,
      workspace_tab_id: context.workspaceTabId
    };
    if (request.format_id === "excel") {
      payload.sheet_name = String(request.options?.sheet_name || "");
    } else {
      payload.encoding = String(request.options?.encoding || "utf-8");
      payload.delimiter = String(request.options?.delimiter ?? ",");
    }
    return payload;
  }

  function commonPreview(payload, formatId) {
    const metadata = formatId === "excel"
      ? {
          sheet_names: Array.isArray(payload.sheet_names) ? payload.sheet_names.map(String) : [],
          sheet_name: String(payload.sheet_name || "")
        }
      : {
          encoding: String(payload.encoding || "utf-8"),
          delimiter: String(payload.delimiter ?? ",")
        };
    return {
      columns: Array.isArray(payload.columns) ? payload.columns : [],
      rows: Array.isArray(payload.rows2d) ? payload.rows2d : [],
      base_row: Number(payload.base_row || 0),
      row_count: payload.row_count ?? null,
      truncated: payload.truncated === true,
      metadata
    };
  }

  async function requestPreview(request) {
    const context = activeRequest;
    if (!context) throw new Error("取込要求が終了しています。");
    const command = request.format_id === "excel" ? "preview.readExcel" : "preview.readCsv";
    const payload = (await callBridge(
      command,
      previewRequestPayload(request, context),
      "プレビューを読み込めませんでした。"
    )) || {};
    if (context !== activeRequest) throw new Error("取込要求が終了しています。");
    const source = normalizeAppSource(request.source);
    rememberHiddenBinding(context, source.ref || payload.ref, payload);
    schemaRowsByPreview.set(
      previewCacheKey(request),
      Array.isArray(payload.schema_rows2d)
        ? payload.schema_rows2d
        : (Array.isArray(payload.rows2d) ? payload.rows2d : [])
    );
    return commonPreview(payload || {}, request.format_id);
  }

  function normalizeDateLikeText(value) {
    if (value === null || value === undefined) return "";
    let text = String(value).trim();
    if (!text) return "";
    text = text.replace("年", "-").replace("月", "-").replace("日", "");
    text = text.replace(/\//g, "-").replace(/\s+/g, " ");
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : text;
  }

  function looksLikeDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
    const text = normalizeDateLikeText(value);
    if (!text) return false;
    const parts = text.split(" ")[0].split("-");
    return parts.length === 3 && parts.every((part) => /^\d+$/.test(part));
  }

  function looksLikeIntegerValue(value) {
    if (typeof value === "number") return Number.isFinite(value) && Number.isInteger(value);
    const text = String(value ?? "").trim();
    return !!text && /^[-+]?\d+$/.test(text.replace(/,/g, ""));
  }

  function inferDatatype(values) {
    const nonEmpty = values
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
      .slice(0, 100);
    if (!nonEmpty.length) return "STRING";
    if (nonEmpty.every(looksLikeIntegerValue)) return "INT64";
    if (nonEmpty.every(looksLikeDateValue)) return "DATE";
    return "STRING";
  }

  function buildZizaiSchema(rows, headerIndex, dataStartIndex) {
    const headerRow = rows[headerIndex] || [];
    return headerRow.map((rawName, columnIndex) => {
      const originName = String(rawName ?? "").trim() || `col_${columnIndex}`;
      const values = [];
      for (
        let rowIndex = dataStartIndex;
        rowIndex < rows.length && values.length < 100;
        rowIndex += 1
      ) {
        values.push(rows[rowIndex]?.[columnIndex]);
      }
      return {
        origin_name: originName,
        ziz_datatype: inferDatatype(values)
      };
    });
  }

  async function deriveSchema(request) {
    const cacheRequest = {
      format_id: request.format_id,
      source: request.source,
      options: request.options
    };
    const rows = schemaRowsByPreview.get(previewCacheKey(cacheRequest))
      || request.preview?.rows
      || [];
    const baseRow = Number(request.preview?.base_row || 0);
    const headerIndex = Math.max(0, Number(request.selection?.header_row || 1) - baseRow - 1);
    const dataStartIndex = Math.max(0, Number(request.selection?.data_start_row || 1) - baseRow - 1);
    return buildZizaiSchema(rows, headerIndex, dataStartIndex);
  }

  const assistant = library.createTabularImportAssistant({
    root: host,
    formats: [
      library.createExcelFormat(),
      library.createDelimitedTextFormat({ id: "csv", label: "CSV" })
    ],
    requestSource,
    requestPreview,
    deriveSchema
  });

  function dispatchResponse(context, status, detail = {}) {
    root.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: {
        requestId: context.requestId,
        status,
        ...detail
      }
    }));
  }

  function connectorResult(result) {
    const source = normalizeAppSource(result.source);
    const common = {
      fileName: source.ref || source.value || result.display_name,
      headerRow: result.selection.header_row,
      dataStartRow: result.selection.data_start_row,
      schema: JSON.stringify(result.schema || [], null, 2)
    };
    if (result.format_id === "excel") {
      return {
        ...common,
        sheetName: String(result.options.sheet_name || "") || null
      };
    }
    return {
      ...common,
      encoding: String(result.options.encoding || "utf-8"),
      delimiter: result.options.delimiter === "\t" ? "\\t" : String(result.options.delimiter || ",")
    };
  }

  assistant.on("confirm", (result) => {
    const context = activeRequest;
    if (!context) return;
    activeRequest = null;
    dispatchResponse(context, "confirmed", { result: connectorResult(result) });
  });

  assistant.on("cancel", (payload) => {
    const context = activeRequest;
    if (!context) return;
    activeRequest = null;
    dispatchResponse(context, "cancelled", { reason: String(payload?.reason || "cancel") });
  });

  function handleRequest(event) {
    const detail = event?.detail;
    if (!detail || typeof detail !== "object") return;
    detail.handled = true;
    const formatId = String(detail.formatId || "").trim();
    if (formatId !== "excel" && formatId !== "csv") {
      const context = { requestId: String(detail.requestId || "") };
      dispatchResponse(context, "error", { message: `未対応の取込形式です: ${formatId}` });
      return;
    }

    if (activeRequest) assistant.close("replaced");
    schemaRowsByPreview.clear();
    const context = {
      requestId: String(detail.requestId || ""),
      formatId,
      stepName: String(detail.stepName || "global"),
      fieldKey: String(detail.fieldKey || "file_path"),
      currentValue: String(detail.currentValue || ""),
      hiddenBindings: detail.hiddenBindings && typeof detail.hiddenBindings === "object"
        ? detail.hiddenBindings
        : {},
      workspaceTabId: String(
        detail.workspaceTabId || resolveWorkspaceTabId()
      ).trim()
    };
    activeRequest = context;
    const sourceInfo = sourceInfoFromRequest(context);
    try {
      assistant.open({
        format_id: formatId,
        source: sourceInfo?.source ?? null,
        display_name: sourceInfo?.display_name || "",
        display_hint: sourceInfo?.display_hint || ""
      });
    } catch (error) {
      activeRequest = null;
      dispatchResponse(context, "error", {
        message: sanitizeError(error, "取込画面を開けませんでした。").message
      });
    }
  }

  function destroy() {
    root.removeEventListener(REQUEST_EVENT, handleRequest);
    assistant.destroy();
    host.remove();
    activeRequest = null;
    schemaRowsByPreview.clear();
  }

  root.addEventListener(REQUEST_EVENT, handleRequest);
  packages.app = packages.app || {};
  packages.app.tabularImport = Object.freeze({ destroy });
})(window);
