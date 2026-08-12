(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};
  const SIMPLE_TYPES = Object.freeze([
    "STRING",
    "INT64",
    "FLOAT64",
    "NUMERIC",
    "BOOL",
    "DATE",
    "DATETIME",
    "TIMESTAMP",
    "TIME",
    "BYTES"
  ]);

  function text(value) {
    return String(value ?? "").trim();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeColumn(value, policy) {
    const originName = text(value?.origin_name);
    return {
      origin_name: originName,
      new_name: policy === "no_rename"
        ? originName
        : text(value?.new_name) || originName,
      ziz_datatype: text(value?.ziz_datatype).toUpperCase() || "STRING"
    };
  }

  function columnKey(value) {
    return text(value?.origin_name) || text(value?.new_name);
  }

  function mergeRows(savedColumns, runtimeColumns, policy) {
    if (policy === "readonly") {
      return (runtimeColumns.length ? runtimeColumns : savedColumns)
        .map((column) => ({
          ...normalizeColumn(column, policy),
          selected: true,
          runtime: runtimeColumns.length > 0
        }));
    }
    const savedByKey = new Map(
      savedColumns.map((column) => [columnKey(column), column])
    );
    const rows = runtimeColumns.map((column) => {
      const saved = savedByKey.get(columnKey(column));
      if (saved) savedByKey.delete(columnKey(column));
      return {
        ...normalizeColumn(saved || column, policy),
        selected: !!saved,
        runtime: true
      };
    });
    savedByKey.forEach((column) => rows.push({
      ...normalizeColumn(column, policy),
      selected: true,
      runtime: false
    }));
    return rows;
  }

  function canonicalColumns(rows, policy) {
    return rows
      .filter((row) => row.selected)
      .map((row) => {
        const column = normalizeColumn(row, policy);
        if (policy === "no_rename") {
          return {
            origin_name: column.origin_name,
            ziz_datatype: column.ziz_datatype
          };
        }
        return {
          origin_name: column.origin_name,
          new_name: column.new_name,
          ziz_datatype: column.ziz_datatype
        };
      })
      .filter((column) => column.origin_name);
  }

  modules.workflowSchemaModel = Object.freeze({
    SIMPLE_TYPES,
    canonicalColumns,
    clone,
    mergeRows,
    normalizeColumn
  });
})(window);
