(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const uiPkg = packages.ui || {};
  const bridgeApi = corePkg.bridge || null;
  const embeddedMode = new URLSearchParams(window.location.search).get("embedded") === "1";
  const dialogApi = corePkg.dialog || null;
  const { el } = (corePkg.utils || {});
  const VARIABLE_NAME_CHAR_CLASS = "a-zA-Z0-9_\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\u3005";
  const VARIABLE_NAME_PATTERN = new RegExp(`^[${VARIABLE_NAME_CHAR_CLASS}]+$`);
  const FUNCTION_REF_NAME_PATTERN = new RegExp(`^[${VARIABLE_NAME_CHAR_CLASS}]+(?:\\.[${VARIABLE_NAME_CHAR_CLASS}]+)*(?:\\(\\))?$`);
  const DEFINE_VALUE_SYSTEM_DEFAULTS = Object.freeze([
    { name: "current_date" },
    { name: "user_name" }
  ]);
  const DEFINE_VALUE_SYSTEM_DEFAULT_MAP = Object.freeze(
    DEFINE_VALUE_SYSTEM_DEFAULTS.reduce((acc, item) => {
      acc[item.name] = item;
      return acc;
    }, {})
  );
  let runtimeContextDefaultsCache = null;
  let runtimeContextDefaultsPromise = null;

  function resolveActiveBridgeApi() {
    const localBridge = window.zizBridge || (window.zizPackages || {})?.core?.bridge || bridgeApi || null;
    if (localBridge?.available?.()) return localBridge;
    if (!embeddedMode) return localBridge;
    const parentBridge = window.parent?.zizBridge || (window.parent?.zizPackages || {})?.core?.bridge || null;
    if (parentBridge?.available?.()) return parentBridge;
    return localBridge || parentBridge;
  }
  function getBridgeUnavailableMessage(activeBridge) {
    const message = activeBridge?.unavailableMessage?.();
    return String(message || "ブリッジ未接続です。再読み込みしてください。");
  }

  function getShellApi() {
    return window.zizShell || {};
  }

  function getCodeEditorsApi() {
    const core = (window.zizPackages && window.zizPackages.core) || {};
    return core.codeEditors || window.codeEditors || null;
  }

  function getUiSuggestApi() {
    const ui = (window.zizPackages && window.zizPackages.ui) || {};
    return ui.suggest || uiPkg.suggest || window.uiSuggest || null;
  }

  async function ensureCodeEditorsApi() {
    const existing = getCodeEditorsApi();
    if (existing && typeof existing.mountCodeEditor === "function") return existing;
    const shellApi = getShellApi();
    if (typeof shellApi.loadScriptOnce === "function") {
      await shellApi.loadScriptOnce("./js/code.editor.js");
    }
    return getCodeEditorsApi();
  }

  async function ensureUiSuggestApi() {
    const existing = getUiSuggestApi();
    if (existing && typeof existing.wrapWithVarSuggest === "function") return existing;
    const shellApi = getShellApi();
    if (typeof shellApi.loadScriptOnce === "function") {
      await shellApi.loadScriptOnce("./js/ui.suggest.js");
    }
    return getUiSuggestApi();
  }

  function toYmdDateText(dateLike) {
    const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const y = String(date.getFullYear()).padStart(4, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getFallbackRuntimeContextDefaults() {
    return {
      current_date: toYmdDateText(new Date()) || "",
      user_name: "unknown"
    };
  }

  function normalizeRuntimeContextDefaults(value) {
    if (!value || typeof value !== "object") return null;
    const currentDate = String(value.current_date || value.currentDate || "").trim();
    const userName = String(value.user_name || value.userName || "").trim();
    return {
      current_date: currentDate || "",
      user_name: userName || ""
    };
  }

  function getRuntimeContextDefaults(defaults) {
    const fallback = getFallbackRuntimeContextDefaults();
    const explicit = normalizeRuntimeContextDefaults(defaults);
    const cached = normalizeRuntimeContextDefaults(runtimeContextDefaultsCache);
    return {
      ...fallback,
      ...(cached || {}),
      ...(explicit || {})
    };
  }

  async function ensureRuntimeContextDefaults() {
    if (runtimeContextDefaultsCache) return getRuntimeContextDefaults();
    const statusDefaults = normalizeRuntimeContextDefaults(window.__zizBridgeStatus?.runtime_context_defaults);
    if (statusDefaults) {
      runtimeContextDefaultsCache = statusDefaults;
      return getRuntimeContextDefaults();
    }
    const activeBridge = resolveActiveBridgeApi();
    if (!activeBridge?.available?.()) return getRuntimeContextDefaults();
    if (runtimeContextDefaultsPromise) return runtimeContextDefaultsPromise;
    runtimeContextDefaultsPromise = activeBridge.call("app.getStatus", {})
      .then((status) => {
        const nextDefaults = normalizeRuntimeContextDefaults(status?.runtime_context_defaults);
        if (nextDefaults) runtimeContextDefaultsCache = nextDefaults;
        if (status) window.__zizBridgeStatus = status;
        return getRuntimeContextDefaults();
      })
      .catch(() => getRuntimeContextDefaults())
      .finally(() => {
        runtimeContextDefaultsPromise = null;
      });
    return runtimeContextDefaultsPromise;
  }

  /* =========================================================
     combo input (free input + full dropdown list)
  ========================================================= */

  function renderComboInput({ node, field, current, onInputChanged, onCommitChanged }) {
    const rawOptions = Array.isArray(field.options) ? field.options : [];
    const optionItems = rawOptions.map((option) => {
      if (option && typeof option === "object") {
        return {
          value: String(option.value ?? option.id ?? ""),
          label: String(option.label ?? option.value ?? option.id ?? ""),
          image: option.image ? String(option.image) : "",
          keywords: String(option.keywords ?? "")
        };
      }
      return {
        value: String(option ?? ""),
        label: String(option ?? ""),
        image: "",
        keywords: ""
      };
    });
    const optionMap = new Map(optionItems.map((item) => [item.value, item]));
    const allowCustom = field.allowCustom !== false;
    const currentOption = optionMap.get(String(current || ""));
    const initialDisplayValue = currentOption ? currentOption.label : String(current || "");

    const inputAttrs = {
      type: "text",
      class: "combo-input",
      placeholder: field.placeholder || "",
      oninput: (e) => {
        if (!allowCustom) return;
        node.form[field.key] = e.target.value;
        if (onInputChanged) onInputChanged();
      },
      onchange: (e) => {
        if (!allowCustom) return;
        node.form[field.key] = e.target.value;
        if (onCommitChanged) onCommitChanged();
      }
    };
    if (!allowCustom) inputAttrs.readonly = "readonly";
    const input = el("input", inputAttrs);
    input.value = initialDisplayValue;

    const menu = el("div", { class: "combo-menu" }, []);
    const wrapper = el("div", { class: "combo-field" }, []);
    const trigger = el(
      "button",
      {
        type: "button",
        class: "combo-trigger",
        "aria-label": `${field.label || field.key} の候補を開く`
      },
      [document.createTextNode("▼")]
    );

    let open = false;
    let outsideHandler = null;

    function closeMenu() {
      if (!open) return;
      open = false;
      wrapper.classList.remove("is-open");
      if (outsideHandler) {
        document.removeEventListener("pointerdown", outsideHandler);
        outsideHandler = null;
      }
    }

    function openMenu() {
      if (open) return;
      open = true;
      wrapper.classList.add("is-open");
      outsideHandler = (ev) => {
        if (!wrapper.contains(ev.target)) closeMenu();
      };
      document.addEventListener("pointerdown", outsideHandler);
    }

    wrapper.__comboController = {
      closeMenu,
      openMenu,
      isOpen: () => open
    };

    function chooseOption(option) {
      input.value = option.label;
      node.form[field.key] = option.value;
      if (onCommitChanged) onCommitChanged();
      closeMenu();
      input.focus();
      input.setSelectionRange?.(input.value.length, input.value.length);
    }

    optionItems.forEach((option) => {
      const itemChildren = [];
      if (option.image) {
        itemChildren.push(
          el("span", { class: "combo-item-icon" }, [
            el("img", { src: option.image, alt: "", loading: "lazy" })
          ])
        );
      }
      itemChildren.push(
        el("span", { class: "combo-item-label" }, [document.createTextNode(option.label)])
      );
      menu.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "combo-item",
            onmousedown: (ev) => {
              ev.preventDefault();
              chooseOption(option);
            }
          },
          itemChildren
        )
      );
    });

    input.addEventListener("focus", openMenu);
    input.addEventListener("click", openMenu);
    input.addEventListener("blur", () => setTimeout(closeMenu, 120));
    trigger.addEventListener("click", () => {
      if (open) closeMenu();
      else {
        openMenu();
        input.focus();
      }
    });

    wrapper.appendChild(input);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);
    return { input, wrapper };
  }

  function renderInputDataSelect({ node, field, current, upstreamSteps, onValueChanged }) {
    const select = el("select", {
      onchange: async (e) => {
        node.form[field.key] = e.target.value;
        if (onValueChanged) await onValueChanged();
      }
    });

    const options = Array.from(new Set(upstreamSteps || []));
    if (current && !options.includes(current)) options.push(current);

    select.appendChild(el("option", { value: "" }, [document.createTextNode("選択してください")]));
    options.forEach((step) => {
      const opt = el("option", { value: step }, [document.createTextNode(step)]);
      if (step === current) opt.selected = true;
      select.appendChild(opt);
    });

    if (!current) select.value = "";
    return { input: select, wrapper: select };
  }

  async function resolveSchemaTextFromInputData({ node, state }) {
    const stepRef = normalizeInputDataReference(node?.form?.input_data || "");
    if (!stepRef) return "";
    const sourceNode = findNodeByStepName(state, stepRef);
    if (!sourceNode) return "";

    const sourceSchema = sourceNode?.form?.schema_add_description ?? sourceNode?.form?.schema ?? "";
    const fromForm = toSchemaText(sourceSchema);
    if (fromForm) return fromForm;

    const activeBridge = resolveActiveBridgeApi();
    if (!activeBridge?.call) return "";
    try {
      const schemaDto = await activeBridge.call("result.getSchema", {
        mode: String(state?.appMode || ""),
        step_id: String(sourceNode.stepName || "")
      });
      const columns = Array.isArray(schemaDto?.columns) ? schemaDto.columns : [];
      if (!columns.length) return "";
      return JSON.stringify(columns, null, 2);
    } catch (error) {
      console.warn("schema resolve from input_data failed", error);
      return "";
    }
  }

  function resolveSchemaAutoloadTargetField(inputField) {
    if (!inputField || typeof inputField !== "object") return "";
    if (typeof inputField.schema_autoload === "object") {
      const fromObject = String(
        inputField.schema_autoload.target
        || inputField.schema_autoload.target_field_key
        || inputField.schema_autoload.field
        || ""
      ).trim();
      if (fromObject) return fromObject;
    }
    return String(inputField.schema_autoload_target || "").trim();
  }

  function shouldApplySchemaAutoload(inputField) {
    if (!inputField || typeof inputField !== "object") return false;
    if (typeof inputField.schema_autoload === "object") return true;
    if (inputField.schema_autoload === true) return true;
    return false;
  }

  async function applySchemaAutoloadFromInputData({ node, state, inputField }) {
    if (!shouldApplySchemaAutoload(inputField)) return false;
    const targetFieldKey = resolveSchemaAutoloadTargetField(inputField);
    if (!targetFieldKey) return false;

    const schemaText = await resolveSchemaTextFromInputData({ node, state });
    if (!schemaText) return false;
    const currentText = String(node?.form?.[targetFieldKey] || "");
    if (currentText === String(schemaText)) return false;

    node.form[targetFieldKey] = schemaText;
    return true;
  }

  function shouldApplySchemaAutoextract(schemaField) {
    if (!schemaField || typeof schemaField !== "object") return false;
    if (typeof schemaField.schema_autoextract === "object") return true;
    return schemaField.schema_autoextract === true;
  }

  function buildSchemaMergeKey(item) {
    const origin = String(item?.origin_name || "").trim();
    if (origin) return `origin:${origin}`;
    const next = String(item?.new_name || "").trim();
    if (next) return `new:${next}`;
    return "";
  }

  function mergeSchemaItemsKeepingLocalState(currentItems, detectedItems) {
    const current = normalizeSimpleSchemaItems(currentItems);
    const detected = normalizeSimpleSchemaItems(detectedItems);
    const merged = current.map((item) => ({ ...item }));
    const seen = new Set();
    merged.forEach((item) => {
      const key = buildSchemaMergeKey(item);
      if (key) seen.add(key);
    });
    detected.forEach((item) => {
      const key = buildSchemaMergeKey(item);
      if (!key || seen.has(key)) return;
      merged.push({
        ...item,
        is_disabled: false
      });
      seen.add(key);
    });
    return merged;
  }

  function getCodeLanguageClass(field) {
    const raw = String(field.codeLanguage || "").trim().toLowerCase();
    if (raw === "sql" || raw === "python") return raw;
    return "";
  }

  const SIMPLE_SCHEMA_TYPES = [
    "INT64",
    "FLOAT64",
    "NUMERIC",
    "STRING",
    "BYTES",
    "DATE",
    "DATETIME",
    "TIMESTAMP",
    "TIME",
    "INTERVAL",
    "BOOL"
  ];

  function parseSchemaText(value) {
    const text = String(value || "").trim();
    if (!text) return { items: [], invalid: false, raw: "[]" };
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("schema must be an array");
      return {
        items: parsed,
        invalid: false,
        raw: JSON.stringify(parsed, null, 2)
      };
    } catch (error) {
      return {
        items: [],
        invalid: true,
        raw: text,
        error
      };
    }
  }

  function isSimpleSchemaItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const type = String(item.ziz_datatype || "").trim().toUpperCase();
    return !!type && SIMPLE_SCHEMA_TYPES.includes(type);
  }

  function canUseSchemaFormMode(parsed) {
    return !parsed.invalid && parsed.items.every(isSimpleSchemaItem);
  }

  function normalizeSimpleSchemaItems(items) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      origin_name: String(item?.origin_name || item?.name_ja || item?.name_en || ""),
      new_name: String(item?.new_name || item?.name_en || item?.name_ja || ""),
      description: String(item?.description || item?.name_ja || item?.origin_name || ""),
      ziz_datatype: String(item?.ziz_datatype || "STRING").trim().toUpperCase() || "STRING",
      is_disabled: !!(item?.is_disabled || item?.disabled)
    }));
  }

  function stringifySchemaItems(items) {
    return JSON.stringify(normalizeSimpleSchemaItems(items), null, 2);
  }

  function findDuplicateSchemaNames(values) {
    const counts = new Map();
    (Array.isArray(values) ? values : []).forEach((value) => {
      const name = String(value || "").trim();
      if (!name) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries())
      .filter(([, count]) => count > 1)
      .map(([name]) => name);
  }

  function collectSchemaDuplicateMessages(items) {
    const normalizedItems = normalizeSimpleSchemaItems(items).filter((item) => !item.is_disabled);
    const originDuplicates = findDuplicateSchemaNames(normalizedItems.map((item) => item.origin_name));
    const newNameDuplicates = findDuplicateSchemaNames(normalizedItems.map((item) => item.new_name));
    const messages = [];
    if (originDuplicates.length) {
      messages.push(`元フィールド名が重複しています: ${originDuplicates.join(", ")}`);
    }
    if (newNameDuplicates.length) {
      messages.push(`新フィールド名が重複しています: ${newNameDuplicates.join(", ")}`);
    }
    return messages;
  }

  function normalizeChecklistValues(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }
    if (value && typeof value === "object") {
      return Object.keys(value).filter((key) => !!value[key]).map((key) => String(key || "").trim()).filter(Boolean);
    }
    const text = String(value || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch (_) {}
    return text.split(",").map((item) => item.trim()).filter(Boolean);
  }

  const FILTER_OPERATOR_OPTIONS = [
    { value: "exact", label: "完全一致" },
    { value: "prefix", label: "前方一致" },
    { value: "suffix", label: "後方一致" },
    { value: "contains", label: "部分一致" },
    { value: "regex", label: "正規表現" },
    { value: "range", label: "範囲一致" },
    { value: "is_null", label: "空(null)" }
  ];
  const FILTER_APPLY_OPTIONS = [
    { value: "include", label: "対象" },
    { value: "exclude", label: "除外" }
  ];

  function parseFilterConditionText(value) {
    const text = String(value || "").trim();
    if (!text) return { items: [], invalid: false, raw: "[]" };
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("conditions must be an array");
      return {
        items: parsed,
        invalid: false,
        raw: JSON.stringify(parsed, null, 2)
      };
    } catch (error) {
      return {
        items: [],
        invalid: true,
        raw: text,
        error
      };
    }
  }

  function normalizeFilterConditions(items) {
    return (Array.isArray(items) ? items : []).map((item) => ({
      field: String(item?.field || ""),
      operator: String(item?.operator || "exact").trim().toLowerCase() || "exact",
      apply: String(item?.apply || item?.target || "include").trim().toLowerCase() === "exclude" ? "exclude" : "include",
      value: String(item?.value || ""),
      value_to: String(item?.value_to || "")
    }));
  }

  function stringifyFilterConditions(items) {
    return JSON.stringify(normalizeFilterConditions(items), null, 2);
  }

  function getInvalidVariableNameMessage(name) {
    const text = String(name || "").trim();
    if (!text) return "";
    if (VARIABLE_NAME_PATTERN.test(text)) return "";
    return "変数名には ひらがな / カタカナ / 漢字 / 英数字 / _ のみ使用できます。";
  }

  function normalizeDefineValueRows(value) {
    const normalizeRow = (item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      return {
        name: String(item.name || item.key || ""),
        value: String(item.value ?? item.val ?? "")
      };
    };

    if (Array.isArray(value)) {
      return value
        .map((item) => normalizeRow(item))
        .filter(Boolean);
    }

    if (value && typeof value === "object") {
      return Object.entries(value).map(([name, rawValue]) => ({
        name: String(name || ""),
        value: String(rawValue ?? "")
      }));
    }

    const text = String(value || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return normalizeDefineValueRows(parsed);
    } catch (_) {
      return [];
    }
  }

  function isDefineValueSystemDefaultName(name) {
    return Object.prototype.hasOwnProperty.call(DEFINE_VALUE_SYSTEM_DEFAULT_MAP, String(name || "").trim());
  }

  function withDefineValueSystemDefaults(rows, defaults = null) {
    const resolvedDefaults = getRuntimeContextDefaults(defaults);
    const normalizedRows = normalizeDefineValueRows(rows);
    const customRows = normalizedRows
      .filter((item) => !isDefineValueSystemDefaultName(item?.name))
      .map((item) => ({ name: String(item?.name || ""), value: String(item?.value ?? "") }));
    const fixedRows = DEFINE_VALUE_SYSTEM_DEFAULTS.map((item) => ({
      name: item.name,
      value: String(resolvedDefaults[item.name] ?? ""),
      fixed: true
    }));
    return [...fixedRows, ...customRows];
  }

  function stringifyDefineValueRows(rows) {
    const normalized = normalizeDefineValueRows(rows).map((item) => ({
      name: String(item?.name || ""),
      value: String(item?.value ?? "")
    }));
    return JSON.stringify(normalized, null, 2);
  }

  function extractSchemaFieldNames(schemaValue) {
    const parsed = Array.isArray(schemaValue)
      ? { items: schemaValue, invalid: false }
      : parseSchemaText(schemaValue);
    if (parsed.invalid) return [];
    const names = [];
    parsed.items.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const name = String(item.new_name || item.origin_name || item.name_en || item.name_ja || "").trim();
      if (name && !names.includes(name)) names.push(name);
    });
    return names;
  }

  async function resolveFilterFieldOptions({ node, state }) {
    const stepRef = normalizeInputDataReference(node?.form?.input_data || "");
    if (!stepRef) return [];
    const sourceNode = findNodeByStepName(state, stepRef);
    if (!sourceNode) return [];

    const fromForm = extractSchemaFieldNames(sourceNode?.form?.schema || "");
    if (fromForm.length) return fromForm;

    const activeBridge = resolveActiveBridgeApi();
    if (!activeBridge?.call) return [];

    try {
      const schemaDto = await activeBridge.call("result.getSchema", {
        mode: String(state?.appMode || ""),
        step_id: String(sourceNode.stepName || "")
      });
      const columns = Array.isArray(schemaDto?.columns) ? schemaDto.columns : [];
      return columns
        .map((item) => String(item?.new_name || item?.origin_name || "").trim())
        .filter((name, index, list) => !!name && list.indexOf(name) === index);
    } catch (error) {
      console.warn("filter field options resolve failed", error);
      return [];
    }
  }

  function renderDefineValuesEditor({ node, field, current, onInputChanged, onCommitChanged }) {
    const wrapper = el("div", { class: "start-param-editor" }, []);
    const paramsList = el("div", { class: "start-param-list" }, []);
    const addBtn = el("button", { type: "button", class: "start-param-add" }, [document.createTextNode("+ 変数を追加")]);
    const hiddenValue = el("textarea", {
      class: "start-param-value",
      hidden: "hidden",
      tabindex: "-1",
      "aria-hidden": "true"
    });

    let rows = withDefineValueSystemDefaults(current);

    function syncNodeForm(committed) {
      const value = stringifyDefineValueRows(rows);
      hiddenValue.value = value;
      node.form[field.key] = value;
      if (committed) {
        if (onCommitChanged) onCommitChanged();
      } else if (onInputChanged) {
        onInputChanged();
      }
    }

    function renderRows() {
      paramsList.innerHTML = "";
      rows.forEach((item, index) => {
        const isSystemDefault = !!item.fixed || isDefineValueSystemDefaultName(item?.name);
        const nameWarning = el("div", { class: "field-warning", hidden: "hidden" }, []);
        const nameInput = el("input", {
          type: "text",
          value: item.name,
          placeholder: "変数名",
          "aria-label": "変数名",
          oninput: (e) => {
            if (isSystemDefault) return;
            rows[index].name = e.target.value;
            updateNameWarning();
            syncNodeForm(false);
          },
          onchange: (e) => {
            if (isSystemDefault) return;
            rows[index].name = e.target.value;
            updateNameWarning();
            syncNodeForm(true);
          }
        });
        if (isSystemDefault) {
          nameInput.readOnly = true;
          nameInput.classList.add("start-param-input--readonly");
        }
        const updateNameWarning = () => {
          if (isSystemDefault) {
            nameWarning.textContent = "";
            nameWarning.hidden = true;
            return;
          }
          const message = getInvalidVariableNameMessage(rows[index]?.name);
          nameWarning.textContent = message;
          nameWarning.hidden = !message;
        };
        updateNameWarning();
        const valueInput = el("input", {
          type: "text",
          value: item.value,
          placeholder: "値",
          "aria-label": "値",
          oninput: (e) => {
            if (isSystemDefault) return;
            rows[index].value = e.target.value;
            syncNodeForm(false);
          },
          onchange: (e) => {
            if (isSystemDefault) return;
            rows[index].value = e.target.value;
            syncNodeForm(true);
          }
        });
        if (isSystemDefault) {
          valueInput.readOnly = true;
          valueInput.classList.add("start-param-input--readonly");
        }
        const removeBtn = el(
          "button",
          {
            type: "button",
            class: "start-param-remove",
            onclick: () => {
              if (isSystemDefault) return;
              rows = rows.filter((_, rowIndex) => rowIndex !== index);
              renderRows();
              syncNodeForm(true);
            }
          },
          [document.createTextNode("削除")]
        );
        if (isSystemDefault) {
          removeBtn.disabled = true;
        }

        paramsList.appendChild(
          el("div", { class: "start-param-fields define-values-fields" }, [nameInput, valueInput, removeBtn, nameWarning])
        );
      });
    }

    addBtn.addEventListener("click", () => {
      rows.push({ name: "", value: "" });
      renderRows();
      syncNodeForm(true);
    });

    rows = withDefineValueSystemDefaults(rows);
    hiddenValue.value = stringifyDefineValueRows(rows);
    wrapper.appendChild(paramsList);
    wrapper.appendChild(addBtn);
    wrapper.appendChild(hiddenValue);
    renderRows();
    void ensureRuntimeContextDefaults().then((defaults) => {
      const before = stringifyDefineValueRows(rows);
      rows = withDefineValueSystemDefaults(rows, defaults);
      const after = stringifyDefineValueRows(rows);
      if (before === after) return;
      hiddenValue.value = after;
      node.form[field.key] = after;
      renderRows();
      if (onCommitChanged) onCommitChanged();
    });

    return { input: hiddenValue, wrapper, skipVarSuggest: true };
  }

  function renderFilterBuilder({ node, field, current, state, onInputChanged, onCommitChanged }) {
    const parsed = parseFilterConditionText(current);
    const wrapper = el("div", { class: "filter-builder" }, []);
    const toolbar = el("div", { class: "filter-builder-toolbar" }, []);
    const addRowBtn = el("button", { type: "button", class: "filter-add-row-btn" }, [document.createTextNode("+ 条件追加")]);
    const hint = el("div", { class: "filter-builder-hint" }, []);
    const header = el("div", { class: "filter-builder-header" }, [
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("対象フィールド")]),
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("演算子")]),
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("対象/除外")]),
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("値")]),
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("範囲終点")]),
      el("div", { class: "filter-builder-header__cell filter-builder-header__cell--action" }, [document.createTextNode("")])
    ]);
    const rowsHost = el("div", { class: "filter-builder-rows" }, []);
    const hiddenValue = el("textarea", {
      class: "filter-builder-value",
      hidden: "hidden",
      tabindex: "-1",
      "aria-hidden": "true"
    });

    let conditions = normalizeFilterConditions(parsed.items);
    let fieldOptions = [];

    function syncNodeForm(value, committed) {
      hiddenValue.value = value;
      node.form[field.key] = value;
      if (committed) {
        if (onCommitChanged) onCommitChanged();
      } else if (onInputChanged) {
        onInputChanged();
      }
    }

    function collectConditions() {
      return Array.from(rowsHost.querySelectorAll(".filter-builder-row")).map((row) => ({
        field: row.querySelector("[data-filter-key='field']")?.value || "",
        operator: row.querySelector("[data-filter-key='operator']")?.value || "exact",
        apply: row.querySelector("[data-filter-key='apply']")?.value || "include",
        value: row.querySelector("[data-filter-key='value']")?.value || "",
        value_to: row.querySelector("[data-filter-key='value_to']")?.value || ""
      }));
    }

    function updateHint() {
      if (!String(node?.form?.input_data || "").trim()) {
        hint.textContent = "先に入力データを選択すると、対象フィールド候補を表示できます。";
        return;
      }
      if (!fieldOptions.length) {
        hint.textContent = "参照元のスキーマが未取得のため、対象フィールド候補を表示できません。";
        return;
      }
      hint.textContent = "条件はすべて AND で結合されます。";
    }

    function createFieldSelect(currentField) {
      const select = el("select", { "data-filter-key": "field" }, []);
      select.appendChild(el("option", { value: "" }, [document.createTextNode("選択してください")]));
      const options = fieldOptions.slice();
      if (currentField && !options.includes(currentField)) options.unshift(currentField);
      options.forEach((name) => {
        const opt = el("option", { value: name }, [document.createTextNode(name)]);
        if (name === currentField) opt.selected = true;
        select.appendChild(opt);
      });
      return select;
    }

    function updateRangeState(row, operator) {
      const valueInput = row.querySelector("[data-filter-key='value']");
      const endInput = row.querySelector("[data-filter-key='value_to']");
      if (!valueInput || !endInput) return;
      const isRange = operator === "range";
      const isNull = operator === "is_null";
      valueInput.disabled = isNull;
      endInput.disabled = !isRange;
      row.classList.toggle("is-range", isRange);
      if (isNull) {
        valueInput.value = "";
        endInput.value = "";
      } else if (!isRange) {
        endInput.value = "";
      }
    }

    function renderConditionRows() {
      rowsHost.innerHTML = "";
      if (!conditions.length) {
        conditions.push({ field: "", operator: "exact", apply: "include", value: "", value_to: "" });
      }

      conditions.forEach((item, index) => {
        const row = el("div", { class: "filter-builder-row" }, []);
        const fieldSelect = createFieldSelect(item.field);
        fieldSelect.dataset.filterKey = "field";
        fieldSelect.onchange = () => {
          conditions = collectConditions();
          syncNodeForm(stringifyFilterConditions(conditions), true);
        };

        const operatorSelect = el("select", {
          "data-filter-key": "operator",
          onchange: () => {
            updateRangeState(row, operatorSelect.value);
            conditions = collectConditions();
            syncNodeForm(stringifyFilterConditions(conditions), true);
          }
        });
        FILTER_OPERATOR_OPTIONS.forEach((option) => {
          const opt = el("option", { value: option.value }, [document.createTextNode(option.label)]);
          if (option.value === item.operator) opt.selected = true;
          operatorSelect.appendChild(opt);
        });

        const applySelect = el("select", {
          "data-filter-key": "apply",
          onchange: () => {
            conditions = collectConditions();
            syncNodeForm(stringifyFilterConditions(conditions), true);
          }
        });
        FILTER_APPLY_OPTIONS.forEach((option) => {
          const opt = el("option", { value: option.value }, [document.createTextNode(option.label)]);
          if (option.value === item.apply) opt.selected = true;
          applySelect.appendChild(opt);
        });

        const valueInput = el("input", {
          type: "text",
          value: item.value,
          "data-filter-key": "value",
          placeholder: "値",
          oninput: () => {
            conditions = collectConditions();
            syncNodeForm(stringifyFilterConditions(conditions), false);
          },
          onchange: () => {
            conditions = collectConditions();
            syncNodeForm(stringifyFilterConditions(conditions), true);
          }
        });

        const valueToInput = el("input", {
          type: "text",
          value: item.value_to,
          "data-filter-key": "value_to",
          placeholder: "範囲終点",
          oninput: () => {
            conditions = collectConditions();
            syncNodeForm(stringifyFilterConditions(conditions), false);
          },
          onchange: () => {
            conditions = collectConditions();
            syncNodeForm(stringifyFilterConditions(conditions), true);
          }
        });

        const removeBtn = el("button", {
          type: "button",
          class: "filter-remove-row-btn",
          onclick: () => {
            conditions.splice(index, 1);
            renderConditionRows();
            syncNodeForm(stringifyFilterConditions(conditions), true);
          }
        }, [document.createTextNode("削除")]);

        row.appendChild(fieldSelect);
        row.appendChild(operatorSelect);
        row.appendChild(applySelect);
        row.appendChild(valueInput);
        row.appendChild(valueToInput);
        row.appendChild(removeBtn);
        rowsHost.appendChild(row);
        updateRangeState(row, item.operator);
      });
      updateHint();
    }

    async function refreshFieldOptions() {
      fieldOptions = await resolveFilterFieldOptions({ node, state });
      renderConditionRows();
    }

    addRowBtn.addEventListener("click", () => {
      conditions.push({ field: "", operator: "exact", apply: "include", value: "", value_to: "" });
      renderConditionRows();
      syncNodeForm(stringifyFilterConditions(conditions), true);
    });

    toolbar.appendChild(addRowBtn);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(hint);
    wrapper.appendChild(header);
    wrapper.appendChild(rowsHost);
    wrapper.appendChild(hiddenValue);

    hiddenValue.value = parsed.raw;
    renderConditionRows();
    void refreshFieldOptions();
    return { input: hiddenValue, wrapper, skipVarSuggest: true };
  }

  function renderSchemaEditor({ node, field, current, state, onInputChanged, onCommitChanged }) {
    const parsed = parseSchemaText(current);
    const canUseInputMode = canUseSchemaFormMode(parsed);
    const preferredModeRaw = String(node?.__schemaEditorMode || "").trim();
    const preferredMode = ["input", "json", "output", "log"].includes(preferredModeRaw) ? preferredModeRaw : "";
    const initialMode = preferredMode === "input"
      ? (canUseInputMode ? "input" : "json")
      : (preferredMode || (canUseInputMode ? "input" : "json"));
    const wrapper = el("div", { class: "schema-editor" }, []);
    const toolbar = el("div", { class: "schema-editor-toolbar" }, []);
    const toolbarMain = el("div", { class: "schema-editor-toolbar-main" }, []);
    const modeSwitch = el("div", { class: "schema-editor-mode" }, []);
    const inputBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("スキーマ定義")]);
    const jsonBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("スキーマ定義（JSON）")]);
    const outputBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("データ出力")]);
    const logBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("ログ")]);
    const hint = el("div", { class: "schema-editor-hint" }, []);
    const body = el("div", { class: "schema-editor-body" }, []);
    const formPane = el("div", { class: "schema-form-pane" }, []);
    const jsonPane = el("div", { class: "schema-json-pane" }, []);
    const outputPane = el("div", { class: "schema-output-pane" }, []);
    const logPane = el("div", { class: "schema-log-pane" }, []);
    const addRowBtn = el("button", { type: "button", class: "schema-add-row-btn" }, [document.createTextNode("+ カラム追加")]);
    const outputStatusNote = el("div", { class: "schema-output-note node-data-note" }, []);
    const validationNote = el("div", { class: "schema-validation-note node-data-note", hidden: "hidden" }, []);
    const outputPreviewHead = el("thead", {}, []);
    const outputPreviewBody = el("tbody", {}, []);
    const outputPreviewTable = el("table", { class: "node-data-table" }, [outputPreviewHead, outputPreviewBody]);
    const outputPreviewWrap = el("div", { class: "schema-output-wrap node-data-wrap is-preview" }, [outputPreviewTable]);
    const logText = el("textarea", {
      class: "node-log-view",
      readonly: "readonly",
      spellcheck: "false",
      "aria-label": "処理ログ"
    });
    const addRowRow = el("div", { class: "schema-form-add-row" }, [addRowBtn]);
    const headerCells = [
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("元フィールド名")]),
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("新フィールド名")]),
    ];
    const isSchemaSddDescription = String(field?.key || "") === "schema_add_description";
    if (isSchemaSddDescription) {
      headerCells.push(el("div", { class: "schema-form-header__cell" }, [document.createTextNode("説明")]));
    }
    headerCells.push(
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("データ型")]),
      el("div", { class: "schema-form-header__cell schema-form-header__cell--action" }, [document.createTextNode("")])
    );
    const headerRow = el("div", { class: "schema-form-header" }, headerCells);
    const rowsHost = el("div", { class: "schema-form-rows" }, []);
    if (!isSchemaSddDescription) {
      headerRow.classList.add("is-compact");
      addRowRow.classList.add("is-compact");
    }
    const textarea = el("textarea", {
      class: "schema-json-input",
      placeholder: '[\n  {\n    "origin_name": "受注日",\n    "new_name": "order_date",\n    "description": "受注日",\n    "ziz_datatype": "DATE"\n  }\n]',
      oninput: (e) => {
        writeSchemaFormValue(e.target.value);
        if (onInputChanged) onInputChanged();
        syncHint();
      },
      onchange: (e) => {
        writeSchemaFormValue(e.target.value);
        if (onCommitChanged) onCommitChanged();
        syncHint();
      }
    });
    textarea.value = parsed.raw;

    let mode = initialMode;
    let formItems = normalizeSimpleSchemaItems(parsed.items);

    function writeSchemaFormValue(value) {
      node.form[field.key] = value;
    }

    function syncNodeForm(value, committed) {
      textarea.value = value;
      writeSchemaFormValue(value);
      syncSchemaValidation();
      if (committed) {
        if (onCommitChanged) onCommitChanged();
      } else if (onInputChanged) {
        onInputChanged();
      }
    }

    function collectFormItems() {
      return Array.from(rowsHost.querySelectorAll(".schema-form-row")).map((row, rowIndex) => ({
        origin_name: row.querySelector("[data-schema-key='origin_name']")?.value || "",
        new_name: row.querySelector("[data-schema-key='new_name']")?.value || "",
        description: isSchemaSddDescription
          ? (row.querySelector("[data-schema-key='description']")?.value || "")
          : String(formItems[rowIndex]?.description || ""),
        ziz_datatype: row.querySelector("[data-schema-key='ziz_datatype']")?.value || "STRING",
        is_disabled: String(row.getAttribute("data-schema-disabled") || "").toLowerCase() === "true"
      }));
    }

    let outputRequestSeq = 0;
    let autoextractRequestSeq = 0;

    async function syncSchemaAutoextractFromResult() {
      if (!shouldApplySchemaAutoextract(field)) return;
      const activeBridge = resolveActiveBridgeApi();
      if (!activeBridge?.call) return;
      const stepId = String(node?.stepName || "").trim();
      if (!stepId) return;
      const requestSeq = ++autoextractRequestSeq;
      try {
        const schemaDto = await activeBridge.call("result.getSchema", {
          mode: String(state?.appMode || ""),
          step_id: stepId
        });
        if (requestSeq !== autoextractRequestSeq) return;
        const columns = Array.isArray(schemaDto?.columns) ? schemaDto.columns : [];
        if (!columns.length) return;
        const mergedItems = mergeSchemaItemsKeepingLocalState(formItems, columns);
        const before = JSON.stringify(normalizeSimpleSchemaItems(formItems));
        const after = JSON.stringify(normalizeSimpleSchemaItems(mergedItems));
        if (before === after) return;
        formItems = mergedItems;
        renderFormRows();
        syncNodeForm(stringifySchemaItems(formItems), true);
      } catch (error) {
        if (requestSeq !== autoextractRequestSeq) return;
        const code = String(error?.code || "").trim();
        if (code === "E_NOT_FOUND") return;
        console.warn("schema autoextract failed", error);
      }
    }

    function setOutputStatus(message = "") {
      const text = String(message || "").trim();
      outputStatusNote.textContent = text;
      outputStatusNote.hidden = !text;
    }

    function clearOutputTable() {
      outputPreviewHead.innerHTML = "";
      outputPreviewBody.innerHTML = "";
      outputPreviewWrap.hidden = true;
    }

    function buildSchemaByNameFromFormItems(items) {
      const schemaByName = {};
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (!item || item.is_disabled) return;
        const normalized = String(item.ziz_datatype || "").trim().toUpperCase();
        const originName = String(item.origin_name || "").trim();
        const newName = String(item.new_name || "").trim();
        if (originName) schemaByName[originName] = normalized;
        if (newName) schemaByName[newName] = normalized;
      });
      return schemaByName;
    }

    function formatDatePreviewValue(value) {
      const text = String(value ?? "").trim();
      if (!text) return "";
      const datePrefix = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
      if (datePrefix) return datePrefix[1];
      return text;
    }

    function formatOutputValue(value, datatype) {
      if (String(datatype || "").toUpperCase() === "DATE") return formatDatePreviewValue(value);
      return String(value ?? "");
    }

    function renderOutputPreview(previewDto) {
      const columns = Array.isArray(previewDto?.columns) ? previewDto.columns : [];
      const sourceRows = Array.isArray(previewDto?.rows) ? previewDto.rows : [];
      const rows = sourceRows.slice(0, 200);
      const schemaByName = buildSchemaByNameFromFormItems(formItems);
      outputPreviewHead.innerHTML = "";
      outputPreviewBody.innerHTML = "";

      if (!columns.length) {
        clearOutputTable();
        setOutputStatus("実行結果がありません。");
        return;
      }

      const headerCells = columns.map((column) => el("th", {}, [document.createTextNode(String(column || ""))]));
      headerCells.push(el("th", { class: "node-data-spacer", "aria-hidden": "true" }, []));
      outputPreviewHead.appendChild(el("tr", {}, headerCells));

      if (!rows.length) {
        outputPreviewBody.appendChild(
          el("tr", {}, [
            el(
              "td",
              { class: "node-data-value", colspan: String(Math.max(columns.length + 1, 1)) },
              [document.createTextNode("データがありません。")]
            )
          ])
        );
      } else {
        rows.forEach((row) => {
          const values = Array.isArray(row) ? row : [];
          const rowCells = columns.map((_, index) =>
            el(
              "td",
              { class: "node-data-value" },
              [document.createTextNode(formatOutputValue(values[index], schemaByName[String(columns[index] || "")]))]
            )
          );
          rowCells.push(el("td", { class: "node-data-spacer", "aria-hidden": "true" }, []));
          outputPreviewBody.appendChild(
            el("tr", {}, rowCells)
          );
        });
      }

      const rowCount = Number(previewDto?.row_count || sourceRows.length || 0);
      const truncated = !!previewDto?.truncated || sourceRows.length > 200;
      setOutputStatus(truncated ? `実行結果（先頭 ${Math.min(rows.length, 200)} / 全 ${rowCount} 行）` : `実行結果（${rowCount} 行）`);
      outputPreviewWrap.hidden = false;
    }

    async function syncOutputPreview() {
      clearOutputTable();
      const activeBridge = resolveActiveBridgeApi();
      if (!activeBridge?.available?.()) {
        setOutputStatus(getBridgeUnavailableMessage(activeBridge));
        return;
      }
      const stepId = String(node?.stepName || "").trim();
      if (!stepId) {
        setOutputStatus("ステップIDがありません。");
        return;
      }
      const requestSeq = ++outputRequestSeq;
      setOutputStatus("実行結果を取得しています...");
      try {
        const previewDto = await activeBridge.call("result.getPreview", {
          mode: String(state?.appMode || ""),
          step_id: stepId
        });
        if (requestSeq !== outputRequestSeq) return;
        renderOutputPreview(previewDto);
      } catch (error) {
        if (requestSeq !== outputRequestSeq) return;
        const code = String(error?.code || "").trim();
        if (code === "E_NOT_FOUND") {
          setOutputStatus("データ取得エラー: 実行結果が見つかりません。");
          return;
        }
        setOutputStatus(`データ取得に失敗しました。${error?.message ? ` ${error.message}` : ""}`);
      }
    }

    function syncRuntimeLog() {
      const lines = Array.isArray(node?.runtimeLogs) ? node.runtimeLogs : [];
      if (!lines.length) {
        logText.value = "ログがないです。";
        return;
      }
      logText.value = lines.join("\n");
    }

    function renderFormRows() {
      rowsHost.innerHTML = "";
      if (!formItems.length) {
        formItems.push({ origin_name: "", new_name: "", description: "", ziz_datatype: "STRING", is_disabled: false });
      }
      formItems.forEach((item, index) => {
        const isDisabled = !!item.is_disabled;
        const row = el("div", { class: `schema-form-row${isDisabled ? " is-disabled" : ""}${!isSchemaSddDescription ? " is-compact" : ""}` }, []);
        row.setAttribute("data-schema-disabled", isDisabled ? "true" : "false");
        const originInput = el("input", {
          type: "text",
          value: item.origin_name,
          "data-schema-key": "origin_name",
          placeholder: "元フィールド名",
          readonly: "readonly"
        });
        if (isDisabled) originInput.disabled = true;
        const newNameInput = el("input", {
          type: "text",
          value: item.new_name,
          "data-schema-key": "new_name",
          placeholder: "新フィールド名",
          oninput: () => {
            formItems = collectFormItems();
            syncNodeForm(stringifySchemaItems(formItems), false);
          },
          onchange: () => {
            formItems = collectFormItems();
            syncNodeForm(stringifySchemaItems(formItems), true);
          }
        });
        if (isDisabled) newNameInput.disabled = true;
        const descInput = isSchemaSddDescription
          ? el("input", {
            type: "text",
            value: item.description,
            "data-schema-key": "description",
            placeholder: "説明・日本語名",
            oninput: () => {
              formItems = collectFormItems();
              syncNodeForm(stringifySchemaItems(formItems), false);
            },
            onchange: () => {
              formItems = collectFormItems();
              syncNodeForm(stringifySchemaItems(formItems), true);
            }
          })
          : null;
        if (descInput && isDisabled) descInput.disabled = true;
        const typeSelect = el("select", {
          "data-schema-key": "ziz_datatype",
          onchange: () => {
            formItems = collectFormItems();
            syncNodeForm(stringifySchemaItems(formItems), true);
          }
        });
        if (isDisabled) typeSelect.disabled = true;
        SIMPLE_SCHEMA_TYPES.forEach((type) => {
          const opt = el("option", { value: type }, [document.createTextNode(type)]);
          if (type === item.ziz_datatype) opt.selected = true;
          typeSelect.appendChild(opt);
        });
        const removeBtn = el("button", {
          type: "button",
          class: `schema-remove-row-btn${isDisabled ? " is-restore" : ""}`,
          title: isDisabled ? "復元" : "削除",
          "aria-label": isDisabled ? "復元" : "削除",
          onclick: () => {
            formItems[index].is_disabled = !isDisabled;
            renderFormRows();
            syncNodeForm(stringifySchemaItems(formItems), true);
          }
        }, isDisabled
          ? [document.createTextNode("復元")]
          : [el("img", {
              src: "./icons/delete.svg",
              alt: "",
              class: "schema-remove-row-btn__icon"
            })]);
        row.appendChild(originInput);
        row.appendChild(newNameInput);
        if (descInput) row.appendChild(descInput);
        row.appendChild(typeSelect);
        row.appendChild(removeBtn);
        rowsHost.appendChild(row);
      });
    }

    function syncHint() {
      const BASE_HINT = "※複雑型はスキーマ定義（JSON）で編集してください。";
      const currentParsed = parseSchemaText(textarea.value);
      if (mode === "output") {
        hint.textContent = "※実行結果を表形式で最大200件表示します。";
        hint.className = "schema-editor-hint";
        return;
      }
      if (mode === "log") {
        hint.textContent = "※このノードの実行ログを表示します。";
        hint.className = "schema-editor-hint";
        return;
      }
      if (!isSchemaSddDescription) {
        hint.textContent = "";
        hint.className = "schema-editor-hint";
        return;
      }
      if (mode === "json") {
        if (currentParsed.invalid) {
          hint.textContent = `${BASE_HINT} JSON が不正です。`;
          hint.className = "schema-editor-hint is-warning";
          return;
        }
        hint.textContent = BASE_HINT;
        hint.className = "schema-editor-hint";
        return;
      }
      hint.textContent = BASE_HINT;
      hint.className = "schema-editor-hint";
    }

    function syncSchemaValidation() {
      const parsedSchema = parseSchemaText(textarea.value);
      if (parsedSchema.invalid) {
        validationNote.textContent = "";
        validationNote.hidden = true;
        return;
      }
      const messages = collectSchemaDuplicateMessages(parsedSchema.items);
      if (!messages.length) {
        validationNote.textContent = "";
        validationNote.hidden = true;
        return;
      }
      validationNote.textContent = messages.join("\n");
      validationNote.hidden = false;
    }

    function setMode(nextMode) {
      if (nextMode === "input") {
        const currentParsed = parseSchemaText(textarea.value);
        if (!canUseSchemaFormMode(currentParsed)) {
          syncHint();
          return;
        }
        formItems = normalizeSimpleSchemaItems(currentParsed.items);
        renderFormRows();
      }
      mode = nextMode;
      node.__schemaEditorMode = mode;
      wrapper.dataset.mode = mode;
      inputBtn.classList.toggle("is-active", mode === "input");
      jsonBtn.classList.toggle("is-active", mode === "json");
      outputBtn.classList.toggle("is-active", mode === "output");
      logBtn.classList.toggle("is-active", mode === "log");
      formPane.classList.toggle("is-hidden", mode !== "input");
      jsonPane.classList.toggle("is-hidden", mode !== "json");
      outputPane.classList.toggle("is-hidden", mode !== "output");
      logPane.classList.toggle("is-hidden", mode !== "log");
      addRowRow.classList.toggle("is-hidden", mode !== "input");
      if (mode === "output") {
        void syncOutputPreview();
        void syncSchemaAutoextractFromResult();
      }
      if (mode === "log") {
        syncRuntimeLog();
      }
      syncHint();
    }

    addRowBtn.addEventListener("click", () => {
      formItems.push({ origin_name: "", new_name: "", description: "", ziz_datatype: "STRING", is_disabled: false });
      renderFormRows();
      syncNodeForm(stringifySchemaItems(formItems), true);
    });

    inputBtn.addEventListener("click", () => {
      setMode("input");
    });
    jsonBtn.addEventListener("click", () => {
      setMode("json");
    });
    outputBtn.addEventListener("click", () => {
      setMode("output");
    });
    logBtn.addEventListener("click", () => {
      setMode("log");
    });

    modeSwitch.appendChild(inputBtn);
    modeSwitch.appendChild(jsonBtn);
    modeSwitch.appendChild(outputBtn);
    modeSwitch.appendChild(logBtn);
    toolbarMain.appendChild(modeSwitch);
    toolbar.appendChild(toolbarMain);
    formPane.appendChild(headerRow);
    formPane.appendChild(rowsHost);
    formPane.appendChild(addRowRow);
    jsonPane.appendChild(textarea);
    outputPane.appendChild(outputStatusNote);
    outputPane.appendChild(outputPreviewWrap);
    logPane.appendChild(el("div", { class: "node-log-wrap" }, [logText]));
    outputPreviewWrap.hidden = true;
    body.appendChild(jsonPane);
    body.appendChild(formPane);
    body.appendChild(outputPane);
    body.appendChild(logPane);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(hint);
    wrapper.appendChild(validationNote);
    wrapper.appendChild(body);

    renderFormRows();
    setMode(mode);
    syncSchemaValidation();
    void syncSchemaAutoextractFromResult();
    return { input: textarea, wrapper, skipVarSuggest: true };
  }

  function renderCodeTextarea({ node, field, current, availableVariableNames, onInputChanged, onCommitChanged }) {
    const language = getCodeLanguageClass(field);
    const textarea = el("textarea", {
      class: "code-editor-fallback",
      placeholder: field.placeholder || "",
      spellcheck: "false",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
      "aria-autocomplete": "none",
      "data-gramm": "false",
      "data-gramm_editor": "false",
      "data-enable-grammarly": "false",
      oninput: (e) => {
        node.form[field.key] = e.target.value;
        if (onInputChanged) onInputChanged();
      },
      onchange: (e) => {
        node.form[field.key] = e.target.value;
        if (onCommitChanged) onCommitChanged();
      }
    });
    textarea.value = current || "";
    const wrapper = el("div", { class: "code-editor" }, [textarea]);

    if (language) {
      ensureCodeEditorsApi()
        .then((codeEditorsApi) => {
          if (!codeEditorsApi || typeof codeEditorsApi.mountCodeEditor !== "function") return;
          return codeEditorsApi.mountCodeEditor({
          input: textarea,
          value: textarea.value,
          language,
          connectorId: String(node?.connector || ""),
          variableNames: availableVariableNames || [],
          suggestionHost: wrapper,
          onInputChanged: (value) => {
            node.form[field.key] = value;
            textarea.value = value;
            if (onInputChanged) onInputChanged();
          },
          onCommitChanged: (value) => {
            node.form[field.key] = value;
            textarea.value = value;
            if (onCommitChanged) onCommitChanged();
          }
          });
        })
        .then((mounted) => {
          if (!mounted) return;
          wrapper.classList.add("is-code-editor-ready");
        })
        .catch((err) => {
          console.warn("Code editor mount failed, fallback to textarea", err);
        });
    }

    return { input: textarea, wrapper, skipVarSuggest: !!language };
  }

  /* =========================================================
     field renderer
  ========================================================= */

  function getFieldCurrentValue(node, field) {
    if (field?.key === "schema_add_description") {
      if (node.form.schema_add_description !== undefined) return node.form.schema_add_description;
      if (node.form.schema !== undefined) return node.form.schema;
    }
    if (field?.key === "schema" && node.form.schema !== undefined) return node.form.schema;
    return node.form[field.key] !== undefined
      ? node.form[field.key]
      : field.default !== undefined
        ? field.default
        : "";
  }

  function isFieldVisibleForNode(node, field) {
    const rule = field?.visible_if;
    if (!rule || typeof rule !== "object") return true;
    const targetKey = String(rule.key || "").trim();
    if (!targetKey) return true;
    const rawValue = (node && node.form && Object.prototype.hasOwnProperty.call(node.form, targetKey))
      ? node.form[targetKey]
      : undefined;
    const current = rawValue === undefined || rawValue === null ? "" : String(rawValue).trim();
    if (Object.prototype.hasOwnProperty.call(rule, "equals")) {
      return current === String(rule.equals ?? "").trim();
    }
    if (Array.isArray(rule.in)) {
      const candidates = rule.in.map((item) => String(item ?? "").trim());
      return candidates.includes(current);
    }
    return true;
  }

  function extractReferencedVariableNames(value) {
    const text = String(value || "");
    const refs = new Set();
    const patterns = [
      /\{\{\s*([^}]+?)\s*\}\}/g,
      /\$\{([^}]+?)\}/g
    ];
    patterns.forEach((re) => {
      let match = re.exec(text);
      while (match) {
        const name = String(match[1] || "").trim();
        if (name) refs.add(name);
        match = re.exec(text);
      }
    });
    return Array.from(refs);
  }

  function extractInvalidTemplateReferenceNames(value) {
    const text = String(value || "");
    const refs = new Set();
    const patterns = [
      /\{\{\s*([^}]+?)\s*\}\}/g,
      /\$\{([^}]+?)\}/g
    ];
    const validNamePattern = FUNCTION_REF_NAME_PATTERN;
    patterns.forEach((re) => {
      let match = re.exec(text);
      while (match) {
        const name = String(match[1] || "").trim();
        if (name && !validNamePattern.test(name)) {
          refs.add(name);
        }
        match = re.exec(text);
      }
    });
    return Array.from(refs);
  }

  function normalizeFunctionReferenceName(ref) {
    const text = String(ref || "").trim();
    if (text.endsWith("()")) return text.slice(0, -2);
    return text;
  }

  function getDefineValuesValidationErrors(value) {
    const rows = normalizeDefineValueRows(value);
    const errors = [];
    rows.forEach((row) => {
      const name = String(row?.name || "").trim();
      if (!name) return;
      if (!VARIABLE_NAME_PATTERN.test(name)) {
        errors.push(`変数名 ${name} は無効です。ひらがな / カタカナ / 漢字 / 英数字 / _ のみ使用できます。`);
      }
    });
    return errors;
  }

  function normalizeInputDataReference(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const doubleBraceMatch = text.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    if (doubleBraceMatch) return doubleBraceMatch[1];
    const braceMatch = text.match(/^\$?\{([a-zA-Z0-9_]+)(?:[^}]*)\}$/);
    if (braceMatch) return braceMatch[1];
    return text;
  }

  function findNodeByStepName(state, stepName) {
    if (!state || !Array.isArray(state.nodes)) return null;
    return state.nodes.find((node) => String(node?.stepName || "") === String(stepName || "")) || null;
  }

  function toSchemaText(schemaValue) {
    if (Array.isArray(schemaValue)) {
      return stringifySchemaItems(schemaValue);
    }
    const text = String(schemaValue || "").trim();
    if (!text) return "";
    const parsed = parseSchemaText(text);
    if (parsed.invalid) return "";
    return JSON.stringify(parsed.items, null, 2);
  }

  function isHiddenBindingRef(value) {
    return typeof value === "string" && /^\{\{hidden\.[^}]+\}\}$/.test(value.trim());
  }

  function getHiddenBindingMeta(value, hiddenBindings) {
    if (!isHiddenBindingRef(value)) return null;
    if (!hiddenBindings || typeof hiddenBindings !== "object") return null;
    const meta = hiddenBindings[value];
    return meta && typeof meta === "object" ? meta : null;
  }

  function buildFileDialogFilters(field) {
    const accept = String(field?.accept || "").trim();
    if (!accept) return [];
    const patterns = accept
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.startsWith(".") ? `*${item}` : item);
    if (!patterns.length) return [];
    return [{
      label: field.label || "ファイル",
      patterns
    }];
  }

  function getFieldReferenceWarnings({ node, field, upstreamSteps, availableVariableNames }) {
    if (!isFieldVisibleForNode(node, field)) return [];
    const value = getFieldCurrentValue(node, field);
    const normalizedUpstream = Array.from(new Set((upstreamSteps || []).filter(Boolean)));
    const upstreamSet = new Set(normalizedUpstream);
    const variableSet = new Set((availableVariableNames || []).filter(Boolean));
    const supportsVars = !!field.allowVars || field.kind === "combo";
    if (value === undefined || value === null || String(value).trim() === "") return [];

    if (field.kind === "define-values-editor") {
      return getDefineValuesValidationErrors(value);
    }

    if (field.key === "input_data" || field.key === "source_step_id") {
      const ref = normalizeInputDataReference(value);
      if (!ref) return [];
      if (!/^[a-zA-Z0-9_]+$/.test(ref)) {
        return [`参照先は step 名（英数字と _）で指定してください。`];
      }
      if (upstreamSet.has(ref)) return [];
      return [`参照先 ${ref} は上流に存在しません。`];
    }

    if (!supportsVars) return [];

    const isHiddenRefName = (ref) => String(ref || "").startsWith("hidden.");
    const isLoopRuntimeRefName = (ref) => {
      const text = String(ref || "").trim();
      return text === "current_item" || text === "current_index" || text.startsWith("current_item.");
    };
    const resolveStepRootName = (ref) => {
      const text = String(ref || "").trim();
      if (!text) return "";
      const dotIndex = text.indexOf(".");
      return dotIndex >= 0 ? text.slice(0, dotIndex) : text;
    };
    const isResolvableReference = (ref) => {
      const normalized = normalizeFunctionReferenceName(ref);
      if (!normalized) return true;
      if (variableSet.has(normalized)) return true;
      if (upstreamSet.has(normalized)) return true;
      if (isLoopRuntimeRefName(normalized)) return true;
      const stepRoot = resolveStepRootName(normalized);
      if (stepRoot && upstreamSet.has(stepRoot)) return true;
      return false;
    };
    const invalidRefs = extractInvalidTemplateReferenceNames(value)
      .map((ref) => `変数名 ${ref} は無効です。ひらがな / カタカナ / 漢字 / 英数字 / _ と .（末尾の ()）のみ使用できます。`);
    const missingRefs = extractReferencedVariableNames(value)
      .filter((ref) => !isHiddenRefName(ref))
      .map((ref) => normalizeFunctionReferenceName(ref))
      .filter((ref) => !isResolvableReference(ref))
      .map((ref) => `変数 ${ref} は定義されていません。`);
    return [...invalidRefs, ...missingRefs];
  }

  function renderField({ node, field, upstreamSteps, availableVariableNames, hiddenBindings, state, config, onStateChanged }) {
    if (!isFieldVisibleForNode(node, field)) {
      return el("div", { class: "row", hidden: "hidden" }, []);
    }
    const row = el("div", { class: "row" }, []);
    if (field.kind === "textarea") {
      row.classList.add("row--textarea");
      if (getCodeLanguageClass(field)) {
        row.classList.add("row--code-editor");
      }
    }
    const hideFieldLabel = field.kind === "define-values-editor";
    if (!hideFieldLabel) {
      const labelChildren = [document.createTextNode(field.label)];
      if (field.required) {
        labelChildren.push(el("span", { class: "label-required" }, [document.createTextNode("（必須）")]));
      }
      row.appendChild(el("label", {}, labelChildren));
    } else {
      row.classList.add("row--label-hidden");
    }

    const current = getFieldCurrentValue(node, field);

    let inputEl = null;
    let wrapper = null;
    const warningEl = el("div", { class: "field-warning", hidden: "hidden" }, []);

    function updateRequiredState() {
      if (!field.required || !inputEl) {
        row.classList.remove("required-empty");
        return;
      }
      const hasExplicitValue = node.form && Object.prototype.hasOwnProperty.call(node.form, field.key);
      const useDefaultWhenUnset = field.key !== "input_data" && field.key !== "source_step_id";
      const v = hasExplicitValue ? node.form[field.key] : (useDefaultWhenUnset ? field.default : "");
      const empty = v === undefined || v === null || String(v).trim() === "";
      row.classList.toggle("required-empty", empty);
    }

    function updateReferenceWarning() {
      const warnings = getFieldReferenceWarnings({ node, field, upstreamSteps, availableVariableNames });
      const hasWarning = warnings.length > 0;
      row.classList.toggle("reference-invalid", hasWarning);
      warningEl.hidden = !hasWarning;
      warningEl.textContent = hasWarning ? warnings.join(" / ") : "";
    }

    function notifyLocalChanged() {
      updateRequiredState();
      updateReferenceWarning();
    }

    function notifyCommitted() {
      updateRequiredState();
      updateReferenceWarning();
      if (onStateChanged) onStateChanged();
    }

    if (field.kind === "define-values-editor") {
      const rendered = renderDefineValuesEditor({
        node,
        field,
        current,
        onInputChanged: notifyLocalChanged,
        onCommitChanged: notifyCommitted
      });
      inputEl = rendered.input;
      wrapper = rendered.wrapper;
      field.__skipVarSuggest = !!rendered.skipVarSuggest;
    } else if (field.kind === "textarea" && (field.key === "schema" || field.key === "schema_add_description")) {
      const rendered = renderSchemaEditor({
        node,
        field,
        current,
        state,
        onInputChanged: notifyLocalChanged,
        onCommitChanged: notifyCommitted
      });
      inputEl = rendered.input;
      wrapper = rendered.wrapper;
      field.__skipVarSuggest = !!rendered.skipVarSuggest;
    } else if (field.kind === "filter-builder") {
      const rendered = renderFilterBuilder({
        node,
        field,
        current,
        state,
        onInputChanged: notifyLocalChanged,
        onCommitChanged: notifyCommitted
      });
      inputEl = rendered.input;
      wrapper = rendered.wrapper;
      field.__skipVarSuggest = !!rendered.skipVarSuggest;
    } else if (field.kind === "textarea") {
      if (getCodeLanguageClass(field)) {
        const rendered = renderCodeTextarea({
          node,
          field,
          current,
          availableVariableNames,
          onInputChanged: notifyLocalChanged,
          onCommitChanged: notifyCommitted
        });
        inputEl = rendered.input;
        wrapper = rendered.wrapper;
        field.__skipVarSuggest = !!rendered.skipVarSuggest;
      } else {
        inputEl = el("textarea", {
          placeholder: field.placeholder || "",
          oninput: (e) => {
            node.form[field.key] = e.target.value;
            notifyLocalChanged();
          },
          onchange: (e) => {
            node.form[field.key] = e.target.value;
            notifyCommitted();
          }
        });
        inputEl.value = current;
        wrapper = inputEl;
      }
    } else if (field.kind === "number") {
      inputEl = el("input", {
        type: "number",
        min: field.min !== undefined ? String(field.min) : undefined,
        max: field.max !== undefined ? String(field.max) : undefined,
        placeholder: field.placeholder || "",
        oninput: (e) => {
          node.form[field.key] = e.target.value;
          notifyLocalChanged();
        },
        onchange: (e) => {
          node.form[field.key] = e.target.value;
          notifyCommitted();
        }
      });
      inputEl.value = current;
      wrapper = inputEl;
    } else if (field.kind === "google-auth-login") {
      row.classList.add("row-inline-action");
      const authBtn = el(
        "button",
        {
          type: "button",
          class: "node-inline-preview-btn",
          title: String(field.buttonLabel || "Googleログイン"),
          "aria-label": String(field.buttonLabel || "Googleログイン"),
          onclick: async () => {
            const activeBridge = resolveActiveBridgeApi();
            if (!activeBridge?.available?.()) {
              const message = getBridgeUnavailableMessage(activeBridge);
              if (dialogApi?.show) dialogApi.show(message, { kind: "warning", title: "認証" });
              else window.alert(message);
              return;
            }
            try {
              await activeBridge.call("app.googleAuthLogin", { mode: "application-default" });
              if (dialogApi?.show) {
                dialogApi.show("Googleログインを起動しました。開いたターミナルで認証を完了してください。", {
                  kind: "info",
                  title: "認証"
                });
              }
            } catch (error) {
              if (dialogApi?.show) dialogApi.show(`認証起動に失敗しました。\n${error?.message || error}`, { kind: "error", title: "認証エラー" });
              else window.alert(`認証起動に失敗しました。\n${error?.message || error}`);
            }
          }
        },
        [document.createTextNode(String(field.buttonLabel || "Googleログイン"))]
      );
      inputEl = null;
      wrapper = el("div", { class: "row-inline-action-body" }, [authBtn]);
    } else if (field.kind === "checklist") {
      const optionItems = (Array.isArray(field.options) ? field.options : []).map((option) => {
        if (option && typeof option === "object") {
          return {
            value: String(option.value ?? option.id ?? ""),
            label: String(option.label ?? option.value ?? option.id ?? "")
          };
        }
        const value = String(option ?? "");
        return { value, label: value };
      }).filter((item) => item.value);
      const selectedSet = new Set(normalizeChecklistValues(current));
      const checklist = el("div", { class: "checklist-field" }, []);
      function syncChecklist(committed) {
        const nextValues = Array.from(checklist.querySelectorAll("input[data-checklist-value]"))
          .filter((checkbox) => !!checkbox.checked)
          .map((checkbox) => String(checkbox.getAttribute("data-checklist-value") || "").trim())
          .filter(Boolean);
        node.form[field.key] = nextValues;
        if (committed) notifyCommitted();
        else notifyLocalChanged();
      }
      optionItems.forEach((item) => {
        const checkbox = el("input", {
          type: "checkbox",
          "data-checklist-value": item.value,
          onchange: () => syncChecklist(true)
        });
        checkbox.checked = selectedSet.has(item.value);
        const optionLabel = el("label", { class: "checklist-option" }, [
          checkbox,
          el("span", { class: "checklist-option__text" }, [document.createTextNode(item.label)])
        ]);
        checklist.appendChild(optionLabel);
      });
      inputEl = null;
      wrapper = checklist;
    } else if (field.kind === "checkbox") {
      inputEl = el("input", {
        type: "checkbox",
        onchange: (e) => {
          node.form[field.key] = !!e.target.checked;
          notifyCommitted();
        }
      });
      inputEl.checked = !!current;
      const checkboxLabel = el("label", { class: "checkbox-field" }, [
        inputEl,
        el("span", { class: "checkbox-field__text" }, [document.createTextNode(field.label || field.key)])
      ]);
      wrapper = checkboxLabel;
    } else if (field.key === "input_data" || field.key === "source_step_id") {
      const r = renderInputDataSelect({
        node,
        field,
        current,
        upstreamSteps,
        onValueChanged: () => {
          // 選択反映は先に行い、重い schema 解決は後追いで適用する
          notifyCommitted();
          if (field.key === "input_data") {
            applySchemaAutoloadFromInputData({ node, state, inputField: field })
              .then((applied) => {
                if (applied) notifyCommitted();
              })
              .catch((error) => {
                console.warn("input_data schema sync failed", error);
              });
          }
        }
      });
      inputEl = r.input;
      wrapper = r.wrapper;
    } else if (field.kind === "combo") {
      const comboCurrent =
        node.form && Object.prototype.hasOwnProperty.call(node.form, field.key)
          ? node.form[field.key]
          : (field.default !== undefined ? field.default : "");
      const r = renderComboInput({
        node,
        field,
        current: comboCurrent,
        onInputChanged: notifyLocalChanged,
        onCommitChanged: notifyCommitted
      });
      inputEl = r.input;
      wrapper = r.wrapper;
    } else if (field.kind === "file" || field.kind === "dir") {
      async function openNativePicker() {
        const activeBridge = resolveActiveBridgeApi();
        if (activeBridge?.available?.()) {
          try {
            const type = field.kind === "dir" ? "file.pickFolder" : "file.pickFile";
            const currentValue = getFieldCurrentValue(node, field);
            const workspaceTabId = String(
              window.zizEmbeddedApi?.getWorkspaceTabId?.()
              || window.__zizWorkspaceTabId?.()
              || "__standalone__"
            ).trim();
            const payload = {
              title: field.kind === "dir" ? `${field.label || "フォルダ"}を選択` : `${field.label || "ファイル"}を選択`,
              step_name: String(node.stepName || "global"),
              field_key: String(field.key || ""),
              current_ref: isHiddenBindingRef(currentValue) ? currentValue : "",
              current_value: isHiddenBindingRef(currentValue) ? "" : String(currentValue || ""),
              workspace_tab_id: workspaceTabId,
            };
            if (field.kind !== "dir") {
              payload.filters = buildFileDialogFilters(field);
            }
            const result = await activeBridge.call(type, payload);
            if (!result || result.selected === false || !result.ref) return true;
            node.form[field.key] = result.ref;
            if (hiddenBindings && typeof hiddenBindings === "object") {
              hiddenBindings[result.ref] = {
                display_name: String(result.display_name || ""),
                display_hint: String(result.display_hint || "")
              };
            }
            text.value = node.form[field.key];
            notifyCommitted();
            return true;
          } catch (error) {
            if (dialogApi?.show) dialogApi.show(`選択に失敗しました。\n${error?.message || error}`, { kind: "error", title: "選択エラー" });
            else window.alert(`選択に失敗しました。\n${error?.message || error}`);
            return true;
          }
        }
        return false;
      }

      const text = el("input", {
        type: "text",
        placeholder:
          field.placeholder || (field.kind === "dir" ? "フォルダを選択" : "ファイルを選択"),
        oninput: (e) => {
          node.form[field.key] = e.target.value;
          notifyLocalChanged();
        },
        onchange: (e) => {
          node.form[field.key] = e.target.value;
          notifyCommitted();
        },
        onclick: async (e) => {
          const activeBridge = resolveActiveBridgeApi();
          if (!activeBridge?.available?.()) return;
          const currentValue = getFieldCurrentValue(node, field);
          if (!isHiddenBindingRef(currentValue)) return;
          e.preventDefault();
          await openNativePicker();
        }
      });
      text.value = current;

      const picker = el("input", { type: "file", style: "display:none" });

      if (field.kind === "dir") {
        picker.setAttribute("webkitdirectory", "");
        picker.setAttribute("directory", "");
        picker.multiple = true;
      } else {
        picker.multiple = false;
        if (field.accept) picker.setAttribute("accept", String(field.accept));
      }

      const btn = el(
        "button",
        {
          type: "button",
          onclick: async () => {
            if (await openNativePicker()) return;
            picker.click();
          }
        },
        [document.createTextNode(field.kind === "dir" ? "フォルダ選択" : "ファイル選択")]
      );

      picker.addEventListener("change", () => {
        const files = Array.from(picker.files || []);
        if (!files.length) return;

        if (field.kind === "file") {
          node.form[field.key] = files[0].name;
          text.value = node.form[field.key];
        } else {
          const first = files[0].webkitRelativePath || files[0].name;
          const top = first.split("/")[0];
          node.form[field.key] = top;
          text.value = node.form[field.key];
        }
        notifyCommitted();
      });

      inputEl = text;
      wrapper = el("div", { style: "display:flex; gap:10px; align-items:center;" }, [
        el("div", { style: "flex:1;" }, [text]),
        btn,
        picker
      ]);
    } else {
        inputEl = el("input", {
          type: "text",
          placeholder: field.placeholder || "",
          oninput: (e) => {
            node.form[field.key] = e.target.value;
            notifyLocalChanged();
          },
          onchange: (e) => {
            node.form[field.key] = e.target.value;
            notifyCommitted();
          }
        });
      inputEl.value = current;
      wrapper = inputEl;
    }

    const supportsVars = !!field.allowVars || field.kind === "combo";
    if (supportsVars && inputEl && inputEl.tagName !== "SELECT" && !field.__skipVarSuggest) {
      const suggestApi = getUiSuggestApi();
      if (suggestApi && typeof suggestApi.wrapWithVarSuggest === "function") {
        wrapper = suggestApi.wrapWithVarSuggest(inputEl, availableVariableNames || [], onStateChanged, wrapper);
      } else {
        ensureUiSuggestApi()
          .then((lazySuggestApi) => {
            if (!lazySuggestApi || typeof lazySuggestApi.wrapWithVarSuggest !== "function") return;
            if (!inputEl.isConnected) return;
            if (inputEl.closest(".suggest")) return;
            if (typeof onStateChanged === "function") onStateChanged({ history: false });
          })
          .catch((err) => {
            console.warn("ui.suggest lazy load failed", err);
          });
      }
    }
    delete field.__skipVarSuggest;

    const runAllLocked = !!state?.__runAllRunning;
    if (runAllLocked) {
      row.classList.add("row--runall-locked");
      const controls = row.querySelectorAll("input, select, textarea, button");
      controls.forEach((control) => {
        if (!(control instanceof HTMLElement)) return;
        if (control.tagName === "BUTTON") {
          if (control.classList.contains("schema-mode-btn")) return;
          control.disabled = true;
          control.setAttribute("aria-disabled", "true");
          return;
        }
        if (control.tagName === "TEXTAREA") {
          control.readOnly = true;
          return;
        }
        if (control.tagName === "SELECT") {
          control.disabled = true;
          return;
        }
        if (control.tagName === "INPUT") {
          const input = control;
          const type = String(input.type || "").toLowerCase();
          if (type === "checkbox" || type === "radio" || type === "file" || type === "range") {
            input.disabled = true;
            return;
          }
          if (type !== "hidden") {
            input.readOnly = true;
          }
          input.disabled = true;
        }
      });
      const editableNodes = row.querySelectorAll("[contenteditable='true'], [contenteditable='plaintext-only']");
      editableNodes.forEach((editable) => {
        editable.setAttribute("contenteditable", "false");
      });
    }

    const right = el("div", {}, [wrapper]);
    right.appendChild(warningEl);
    row.appendChild(right);
    updateRequiredState();
    updateReferenceWarning();
    return row;
  }

  const uiFields = { renderField, getFieldReferenceWarnings, isFieldVisibleForNode };
  window.uiFields = uiFields;
})();

