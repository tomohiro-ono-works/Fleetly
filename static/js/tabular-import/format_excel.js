(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};

  function createExcelFormat(options = {}) {
    const id = String(options.id || "excel").trim();
    const label = String(options.label || "Excel");
    const accept = Array.isArray(options.accept)
      ? options.accept.map(String)
      : [".xlsx", ".xlsm", ".xls"];
    const labels = {
      sheet: "シート",
      noSheets: "シートなし",
      ...(options.labels || {})
    };

    function normalizeOptions(value = {}) {
      return { sheet_name: String(value.sheet_name || "") };
    }

    function applyPreview(currentOptions, preview) {
      const normalized = normalizeOptions(currentOptions);
      const metadata = preview?.metadata || {};
      const sheetNames = Array.isArray(metadata.sheet_names)
        ? metadata.sheet_names.map(String).filter(Boolean)
        : [];
      const selected = String(metadata.sheet_name || normalized.sheet_name || sheetNames[0] || "");
      return { sheet_name: selected };
    }

    function renderControls(context) {
      const documentRef = context.root.ownerDocument;
      const labelElement = documentRef.createElement("label");
      labelElement.className = "ztia-field";
      const text = documentRef.createElement("span");
      text.className = "ztia-field__label";
      text.textContent = labels.sheet;
      const select = documentRef.createElement("select");
      select.className = "ztia-select";
      select.setAttribute("aria-label", labels.sheet);

      const metadata = context.preview?.metadata || {};
      const sheetNames = Array.isArray(metadata.sheet_names)
        ? metadata.sheet_names.map(String).filter(Boolean)
        : [];
      const selected = String(context.options.sheet_name || "");
      const values = sheetNames.slice();
      if (selected && !values.includes(selected)) values.unshift(selected);

      if (!values.length) {
        const option = documentRef.createElement("option");
        option.value = "";
        option.textContent = labels.noSheets;
        select.appendChild(option);
      } else {
        values.forEach((sheetName) => {
          const option = documentRef.createElement("option");
          option.value = sheetName;
          option.textContent = sheetName;
          select.appendChild(option);
        });
        select.value = selected || values[0];
      }

      select.disabled = context.disabled || !values.length;
      select.addEventListener("change", () => {
        context.onChange({ sheet_name: select.value });
      });
      labelElement.append(text, select);
      context.root.replaceChildren(labelElement);
    }

    return Object.freeze({
      id,
      label,
      accept: Object.freeze(accept),
      normalizeOptions,
      applyPreview,
      getPreviewOptions: normalizeOptions,
      renderControls
    });
  }

  modules.createExcelFormat = createExcelFormat;
})(window);
