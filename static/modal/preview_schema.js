(function () {
  "use strict";

  function normalizeDateLikeText(value) {
    if (value === null || value === undefined) return "";
    let text = String(value).trim();
    if (!text) return "";
    text = text.replace("年", "-").replace("月", "-").replace("日", "");
    text = text.replace(/\//g, "-");
    text = text.replace(/\s+/g, " ");
    const compact = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) {
      return `${compact[1]}-${compact[2]}-${compact[3]}`;
    }
    return text;
  }

  function looksLikeDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
    const text = normalizeDateLikeText(value);
    if (!text) return false;
    const parts = text.split(" ")[0].split("-");
    if (parts.length !== 3) return false;
    return parts.every((part) => /^\d+$/.test(part));
  }

  function looksLikeIntegerValue(value) {
    if (typeof value === "number") return Number.isFinite(value) && Number.isInteger(value);
    const text = String(value ?? "").trim();
    if (!text) return false;
    return /^[-+]?\d+$/.test(text.replace(/,/g, ""));
  }

  function inferPreviewDatatype(values) {
    const nonEmpty = values
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
      .slice(0, 100);
    if (!nonEmpty.length) return "STRING";
    if (nonEmpty.every((value) => looksLikeIntegerValue(value))) return "INT64";
    if (nonEmpty.every((value) => looksLikeDateValue(value))) return "DATE";
    return "STRING";
  }

  function buildPreviewSchema(rows2d, headerRowInView, dataStartRowInView) {
    const headerRow = rows2d[headerRowInView] || [];
    return headerRow.map((rawName, colIdx) => {
      const originName = String(rawName ?? "").trim() || `col_${colIdx}`;
      const sampleValues = [];
      for (let rowIdx = dataStartRowInView; rowIdx < rows2d.length && sampleValues.length < 100; rowIdx += 1) {
        sampleValues.push(rows2d[rowIdx]?.[colIdx]);
      }
      return {
        origin_name: originName,
        new_name: originName,
        description: originName,
        ziz_datatype: inferPreviewDatatype(sampleValues)
      };
    });
  }

  const previewSchema = {
    normalizeDateLikeText,
    looksLikeDateValue,
    looksLikeIntegerValue,
    inferPreviewDatatype,
    buildPreviewSchema
  };
  window.PreviewSchema = previewSchema;
})();
