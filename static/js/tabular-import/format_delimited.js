(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};

  function normalizeChoiceList(items, fallback) {
    const source = Array.isArray(items) && items.length ? items : fallback;
    return source.map((item) => ({
      value: String(item?.value ?? ""),
      label: String(item?.label ?? item?.value ?? "")
    }));
  }

  function appendSelect(documentRef, host, config) {
    const label = documentRef.createElement("label");
    label.className = "ztia-field";
    const text = documentRef.createElement("span");
    text.className = "ztia-field__label";
    text.textContent = config.label;
    const select = documentRef.createElement("select");
    select.className = "ztia-select";
    select.setAttribute("aria-label", config.label);
    config.items.forEach((item) => {
      const option = documentRef.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    });
    if (config.items.some((item) => item.value === config.value)) {
      select.value = config.value;
    }
    select.disabled = config.disabled;
    select.addEventListener("change", () => config.onChange(select.value));
    label.append(text, select);
    host.appendChild(label);
  }

  function createDelimitedTextFormat(options = {}) {
    const id = String(options.id || "delimited").trim();
    const label = String(options.label || "Delimited text");
    const accept = Array.isArray(options.accept)
      ? options.accept.map(String)
      : [".csv", ".tsv", ".txt"];
    const labels = {
      encoding: "文字コード",
      delimiter: "区切り文字",
      ...(options.labels || {})
    };
    const encodings = normalizeChoiceList(options.encodings, [
      { value: "utf-8", label: "UTF-8" },
      { value: "shift_jis", label: "Shift_JIS" },
      { value: "cp932", label: "CP932" }
    ]);
    const delimiters = normalizeChoiceList(options.delimiters, [
      { value: ",", label: "カンマ (,)" },
      { value: "\t", label: "タブ" },
      { value: ";", label: "セミコロン (;)" },
      { value: "|", label: "パイプ (|)" }
    ]);

    function normalizeOptions(value = {}) {
      const encoding = String(value.encoding || encodings[0]?.value || "utf-8");
      const rawDelimiter = String(value.delimiter ?? delimiters[0]?.value ?? ",");
      return {
        encoding: encodings.some((item) => item.value === encoding)
          ? encoding
          : (encodings[0]?.value || "utf-8"),
        delimiter: rawDelimiter === "\\t" ? "\t" : rawDelimiter
      };
    }

    function applyPreview(currentOptions, preview) {
      const normalized = normalizeOptions(currentOptions);
      const metadata = preview?.metadata || {};
      return normalizeOptions({
        encoding: metadata.encoding || normalized.encoding,
        delimiter: metadata.delimiter ?? normalized.delimiter
      });
    }

    function renderControls(context) {
      const documentRef = context.root.ownerDocument;
      const fragment = documentRef.createDocumentFragment();
      appendSelect(documentRef, fragment, {
        label: labels.encoding,
        items: encodings,
        value: context.options.encoding,
        disabled: context.disabled,
        onChange(value) {
          context.onChange({ encoding: value });
        }
      });
      appendSelect(documentRef, fragment, {
        label: labels.delimiter,
        items: delimiters,
        value: context.options.delimiter,
        disabled: context.disabled,
        onChange(value) {
          context.onChange({ delimiter: value });
        }
      });
      context.root.replaceChildren(fragment);
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

  modules.createDelimitedTextFormat = createDelimitedTextFormat;
})(window);
