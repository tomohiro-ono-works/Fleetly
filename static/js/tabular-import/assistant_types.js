(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};

  function hasOwn(value, key) {
    return !!value && Object.prototype.hasOwnProperty.call(value, key);
  }

  function toInteger(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.trunc(number) : fallback;
  }

  function columnLabel(index) {
    let number = index + 1;
    let text = "";
    while (number > 0) {
      const remainder = (number - 1) % 26;
      text = String.fromCharCode(65 + remainder) + text;
      number = Math.floor((number - 1) / 26);
    }
    return text;
  }

  function normalizeFormats(formats) {
    const seen = new Set();
    return (Array.isArray(formats) ? formats : []).map((format) => {
      const id = String(format?.id || "").trim();
      if (!id) throw new TypeError("format.id is required");
      if (seen.has(id)) throw new TypeError(`duplicate format.id: ${id}`);
      seen.add(id);
      if (typeof format.renderControls !== "function") {
        throw new TypeError(`format.renderControls is required: ${id}`);
      }
      return format;
    });
  }

  function normalizeSource(sourceContract) {
    if (sourceContract === null || sourceContract === undefined) return null;
    if (typeof sourceContract !== "object" || !hasOwn(sourceContract, "source")) {
      throw new TypeError("source contract requires a source property");
    }
    if (sourceContract.source === null || sourceContract.source === undefined) return null;
    return {
      source: sourceContract.source,
      display_name: String(sourceContract.display_name || ""),
      display_hint: String(sourceContract.display_hint || "")
    };
  }

  function normalizePreview(previewInput) {
    const input = previewInput && typeof previewInput === "object" ? previewInput : {};
    const sourceRows = Array.isArray(input.rows) ? input.rows : [];
    const sourceColumns = Array.isArray(input.columns) ? input.columns : [];
    const columnCount = Math.max(
      sourceColumns.length,
      sourceRows.reduce((maximum, row) => Math.max(maximum, Array.isArray(row) ? row.length : 0), 0)
    );
    const columns = Array.from({ length: columnCount }, (_, index) => {
      const value = sourceColumns[index];
      return value === null || value === undefined || String(value) === ""
        ? columnLabel(index)
        : String(value);
    });
    const rows = sourceRows.map((row) => {
      const values = Array.isArray(row) ? row : [];
      return Array.from({ length: columnCount }, (_, index) => (
        index < values.length ? values[index] : null
      ));
    });
    const baseRow = Math.max(0, toInteger(input.base_row, 0));
    const rowCount = input.row_count === null || input.row_count === undefined
      ? null
      : Math.max(0, toInteger(input.row_count, rows.length));
    return {
      columns,
      rows,
      base_row: baseRow,
      row_count: rowCount,
      truncated: input.truncated === true,
      metadata: input.metadata && typeof input.metadata === "object"
        ? { ...input.metadata }
        : {}
    };
  }

  function defaultSelection(preview) {
    const firstRow = Number(preview?.base_row || 0) + 1;
    const hasSecondRow = Array.isArray(preview?.rows) && preview.rows.length > 1;
    return {
      header_row: firstRow,
      data_start_row: hasSecondRow ? firstRow + 1 : firstRow
    };
  }

  function normalizeSelection(selection, preview) {
    const fallback = defaultSelection(preview);
    const rowLength = Array.isArray(preview?.rows) ? preview.rows.length : 0;
    if (!rowLength) return fallback;
    const minimum = Number(preview.base_row || 0) + 1;
    const maximum = minimum + rowLength - 1;
    const clamp = (value, fallbackValue) => Math.min(
      maximum,
      Math.max(minimum, toInteger(value, fallbackValue))
    );
    return {
      header_row: clamp(selection?.header_row, fallback.header_row),
      data_start_row: clamp(selection?.data_start_row, fallback.data_start_row)
    };
  }

  function clonePreview(preview) {
    if (!preview) return null;
    return {
      columns: preview.columns.slice(),
      rows: preview.rows.map((row) => row.slice()),
      base_row: preview.base_row,
      row_count: preview.row_count,
      truncated: preview.truncated,
      metadata: { ...preview.metadata }
    };
  }

  function publicStateSnapshot(state) {
    return {
      open: !!state.open,
      loading: !!state.loading,
      disabled: !!state.disabled,
      format_id: state.formatId,
      source: state.sourceInfo?.source ?? null,
      display_name: state.sourceInfo?.display_name || "",
      display_hint: state.sourceInfo?.display_hint || "",
      options: { ...state.options },
      preview: clonePreview(state.preview),
      selection: { ...state.selection },
      error: state.error || ""
    };
  }

  modules.assistantTypes = Object.freeze({
    hasOwn,
    normalizeFormats,
    normalizeSource,
    normalizePreview,
    defaultSelection,
    normalizeSelection,
    publicStateSnapshot
  });
})(window);
