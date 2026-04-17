(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const uiPkg = packages.ui || {};
  const bridgeApi = corePkg.bridge || null;
  const dialogApi = corePkg.dialog || null;
  const codeEditors = corePkg.codeEditors || null;
  const { el } = (corePkg.utils || {});
  const { wrapWithVarSuggest } = (uiPkg.suggest || {});

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

    const fromForm = toSchemaText(sourceNode?.form?.schema || "");
    if (fromForm) return fromForm;

    if (!bridgeApi?.available?.()) return "";
    try {
      const schemaDto = await bridgeApi.call("result.getSchema", {
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

  async function applyBqLoadSchemaFromInputData({ node, state }) {
    if (String(node?.connector || "") !== "BQConnector") return false;
    if (String(node?.action || "") !== "load_data") return false;

    const schemaText = await resolveSchemaTextFromInputData({ node, state });
    if (!schemaText) return false;
    if (String(node?.form?.schema || "") === String(schemaText)) return false;

    node.form.schema = schemaText;
    return true;
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
      ziz_datatype: String(item?.ziz_datatype || "STRING").trim().toUpperCase() || "STRING"
    }));
  }

  function stringifySchemaItems(items) {
    return JSON.stringify(normalizeSimpleSchemaItems(items), null, 2);
  }

  const FILTER_OPERATOR_OPTIONS = [
    { value: "exact", label: "完全一致" },
    { value: "prefix", label: "前方一致" },
    { value: "suffix", label: "後方一致" },
    { value: "contains", label: "部分一致" },
    { value: "range", label: "範囲一致" }
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
      value: String(item?.value || ""),
      value_to: String(item?.value_to || "")
    }));
  }

  function stringifyFilterConditions(items) {
    return JSON.stringify(normalizeFilterConditions(items), null, 2);
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

    if (!bridgeApi?.available?.()) return [];

    try {
      const schemaDto = await bridgeApi.call("result.getSchema", {
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

  function renderFilterBuilder({ node, field, current, state, onInputChanged, onCommitChanged }) {
    const parsed = parseFilterConditionText(current);
    const wrapper = el("div", { class: "filter-builder" }, []);
    const toolbar = el("div", { class: "filter-builder-toolbar" }, []);
    const addRowBtn = el("button", { type: "button", class: "filter-add-row-btn" }, [document.createTextNode("+ 条件追加")]);
    const hint = el("div", { class: "filter-builder-hint" }, []);
    const header = el("div", { class: "filter-builder-header" }, [
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("対象フィールド")]),
      el("div", { class: "filter-builder-header__cell" }, [document.createTextNode("演算子")]),
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
      const endInput = row.querySelector("[data-filter-key='value_to']");
      if (!endInput) return;
      const isRange = operator === "range";
      endInput.disabled = !isRange;
      row.classList.toggle("is-range", isRange);
      if (!isRange) {
        endInput.value = "";
      }
    }

    function renderConditionRows() {
      rowsHost.innerHTML = "";
      if (!conditions.length) {
        conditions.push({ field: "", operator: "exact", value: "", value_to: "" });
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
      conditions.push({ field: "", operator: "exact", value: "", value_to: "" });
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

  function renderSchemaEditor({ node, field, current, onInputChanged, onCommitChanged }) {
    const parsed = parseSchemaText(current);
    const initialMode = canUseSchemaFormMode(parsed) ? "form" : "json";
    const wrapper = el("div", { class: "schema-editor" }, []);
    const toolbar = el("div", { class: "schema-editor-toolbar" }, []);
    const toolbarMain = el("div", { class: "schema-editor-toolbar-main" }, []);
    const modeSwitch = el("div", { class: "schema-editor-mode" }, []);
    const formBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("フォーム")]);
    const jsonBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("JSON")]);
    const hint = el("div", { class: "schema-editor-hint" }, []);
    const body = el("div", { class: "schema-editor-body" }, []);
    const formPane = el("div", { class: "schema-form-pane" }, []);
    const jsonPane = el("div", { class: "schema-json-pane" }, []);
    const addRowBtn = el("button", { type: "button", class: "schema-add-row-btn" }, [document.createTextNode("+ カラム追加")]);
    const headerRow = el("div", { class: "schema-form-header" }, [
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("元フィールド名")]),
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("新フィールド名")]),
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("説明")]),
      el("div", { class: "schema-form-header__cell" }, [document.createTextNode("データ型")]),
      el("div", { class: "schema-form-header__cell schema-form-header__cell--action" }, [document.createTextNode("")])
    ]);
    const rowsHost = el("div", { class: "schema-form-rows" }, []);
    const textarea = el("textarea", {
      class: "schema-json-input",
      placeholder: '[\n  {\n    "origin_name": "受注日",\n    "new_name": "order_date",\n    "description": "受注日",\n    "ziz_datatype": "DATE"\n  }\n]',
      oninput: (e) => {
        node.form[field.key] = e.target.value;
        if (onInputChanged) onInputChanged();
        syncHint();
      },
      onchange: (e) => {
        node.form[field.key] = e.target.value;
        if (onCommitChanged) onCommitChanged();
        syncHint();
      }
    });
    textarea.value = parsed.raw;

    let mode = initialMode;
    let formItems = normalizeSimpleSchemaItems(parsed.items);

    function syncNodeForm(value, committed) {
      textarea.value = value;
      node.form[field.key] = value;
      if (committed) {
        if (onCommitChanged) onCommitChanged();
      } else if (onInputChanged) {
        onInputChanged();
      }
    }

    function collectFormItems() {
      return Array.from(rowsHost.querySelectorAll(".schema-form-row")).map((row) => ({
        origin_name: row.querySelector("[data-schema-key='origin_name']")?.value || "",
        new_name: row.querySelector("[data-schema-key='new_name']")?.value || "",
        description: row.querySelector("[data-schema-key='description']")?.value || "",
        ziz_datatype: row.querySelector("[data-schema-key='ziz_datatype']")?.value || "STRING"
      }));
    }

    function renderFormRows() {
      rowsHost.innerHTML = "";
      if (!formItems.length) {
        formItems.push({ origin_name: "", new_name: "", description: "", ziz_datatype: "STRING" });
      }
      formItems.forEach((item, index) => {
        const row = el("div", { class: "schema-form-row" }, []);
        const originInput = el("input", {
          type: "text",
          value: item.origin_name,
          "data-schema-key": "origin_name",
          placeholder: "元フィールド名",
          oninput: () => {
            formItems = collectFormItems();
            syncNodeForm(stringifySchemaItems(formItems), false);
          },
          onchange: () => {
            formItems = collectFormItems();
            syncNodeForm(stringifySchemaItems(formItems), true);
          }
        });
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
        const descInput = el("input", {
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
        });
        const typeSelect = el("select", {
          "data-schema-key": "ziz_datatype",
          onchange: () => {
            formItems = collectFormItems();
            syncNodeForm(stringifySchemaItems(formItems), true);
          }
        });
        SIMPLE_SCHEMA_TYPES.forEach((type) => {
          const opt = el("option", { value: type }, [document.createTextNode(type)]);
          if (type === item.ziz_datatype) opt.selected = true;
          typeSelect.appendChild(opt);
        });
        const removeBtn = el("button", {
          type: "button",
          class: "schema-remove-row-btn",
          onclick: () => {
            formItems.splice(index, 1);
            renderFormRows();
            syncNodeForm(stringifySchemaItems(formItems), true);
          }
        }, [document.createTextNode("削除")]);
        row.appendChild(originInput);
        row.appendChild(newNameInput);
        row.appendChild(descInput);
        row.appendChild(typeSelect);
        row.appendChild(removeBtn);
        rowsHost.appendChild(row);
      });
    }

    function syncHint() {
      const currentParsed = parseSchemaText(textarea.value);
      if (mode === "json") {
        if (currentParsed.invalid) {
          hint.textContent = "JSON が不正です。フォームへ切り替えるには配列JSONを整形してください。";
          hint.className = "schema-editor-hint is-warning";
          return;
        }
        if (!canUseSchemaFormMode(currentParsed)) {
          hint.textContent = "ARRAY / STRUCT などの複雑型を含むため、JSON モード推奨です。";
          hint.className = "schema-editor-hint";
          return;
        }
        hint.textContent = "単純列のみです。フォームモードへ切り替えられます。";
        hint.className = "schema-editor-hint";
        return;
      }
      hint.textContent = "単純列はフォームで編集できます。複雑型は JSON モードで編集してください。";
      hint.className = "schema-editor-hint";
    }

    function setMode(nextMode) {
      if (nextMode === "form") {
        const currentParsed = parseSchemaText(textarea.value);
        if (!canUseSchemaFormMode(currentParsed)) {
          syncHint();
          return;
        }
        formItems = normalizeSimpleSchemaItems(currentParsed.items);
        renderFormRows();
      }
      mode = nextMode;
      wrapper.dataset.mode = mode;
      formBtn.classList.toggle("is-active", mode === "form");
      jsonBtn.classList.toggle("is-active", mode === "json");
      formPane.classList.toggle("is-hidden", mode !== "form");
      jsonPane.classList.toggle("is-hidden", mode !== "json");
      addRowBtn.classList.toggle("is-hidden", mode !== "form");
      syncHint();
    }

    addRowBtn.addEventListener("click", () => {
      formItems.push({ origin_name: "", new_name: "", description: "", ziz_datatype: "STRING" });
      renderFormRows();
      syncNodeForm(stringifySchemaItems(formItems), true);
    });

    formBtn.addEventListener("click", () => setMode("form"));
    jsonBtn.addEventListener("click", () => setMode("json"));

    modeSwitch.appendChild(formBtn);
    modeSwitch.appendChild(jsonBtn);
    toolbarMain.appendChild(modeSwitch);
    toolbarMain.appendChild(addRowBtn);
    toolbar.appendChild(toolbarMain);
    formPane.appendChild(headerRow);
    formPane.appendChild(rowsHost);
    jsonPane.appendChild(textarea);
    body.appendChild(formPane);
    body.appendChild(jsonPane);
    wrapper.appendChild(toolbar);
    wrapper.appendChild(hint);
    wrapper.appendChild(body);

    renderFormRows();
    setMode(mode);
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

    if (codeEditors && typeof codeEditors.mountCodeEditor === "function" && language) {
      codeEditors
        .mountCodeEditor({
          input: textarea,
          value: textarea.value,
          language,
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
        })
        .then(() => {
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
    return node.form[field.key] !== undefined
      ? node.form[field.key]
      : field.default !== undefined
        ? field.default
        : "";
  }

  function extractReferencedVariableNames(value) {
    const text = String(value || "");
    const refs = new Set();
    const patterns = [
      /\{\{\s*([a-zA-Z0-9_\.]+)\s*\}\}/g,
      /\$\{([a-zA-Z0-9_\.]+)(?:[^}]*)\}/g
    ];
    patterns.forEach((re) => {
      let match = re.exec(text);
      while (match) {
        refs.add(match[1]);
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
    const validNamePattern = /^[a-zA-Z0-9_\.]+$/;
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

  function normalizeInputDataReference(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const doubleBraceMatch = text.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    if (doubleBraceMatch) return doubleBraceMatch[1];
    const braceMatch = text.match(/^\$?\{([a-zA-Z0-9_]+)(?:[^}]*)\}$/);
    if (braceMatch) return braceMatch[1];
    return text;
  }

  function isWriteOutputConnector(node) {
    const connector = String(node?.connector || "");
    const action = String(node?.action || "");
    return (connector === "CSVConnector" && action === "write_csv")
      || (connector === "ExcelConnector" && action === "write_excel");
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
    const value = getFieldCurrentValue(node, field);
    const normalizedUpstream = Array.from(new Set((upstreamSteps || []).filter(Boolean)));
    const upstreamSet = new Set(normalizedUpstream);
    const variableSet = new Set((availableVariableNames || []).filter(Boolean));
    const supportsVars = !!field.allowVars || field.kind === "combo";
    if (value === undefined || value === null || String(value).trim() === "") return [];

    if (field.key === "input_data") {
      const ref = normalizeInputDataReference(value);
      if (!ref) return [];
      if (!/^[a-zA-Z0-9_]+$/.test(ref)) {
        return [`変数名には英数字と _ のみ使用できます。日本語や記号は使えません。`];
      }
      if (upstreamSet.has(ref)) return [];
      return [`参照先 ${ref} は上流に存在しません。`];
    }

    if (!supportsVars) return [];

    const invalidRefs = extractInvalidTemplateReferenceNames(value)
      .map((ref) => `変数名 ${ref} は無効です。英数字、_、. のみ使用できます。`);
    const missingRefs = extractReferencedVariableNames(value)
      .filter((ref) => !variableSet.has(ref))
      .map((ref) => `変数 ${ref} は定義されていません。`);
    return [...invalidRefs, ...missingRefs];
  }

  function renderField({ node, field, upstreamSteps, availableVariableNames, hiddenBindings, state, config, onStateChanged }) {
    const row = el("div", { class: "row" }, []);
    row.appendChild(el("label", {}, [document.createTextNode(field.label)]));

    const current = getFieldCurrentValue(node, field);

    let inputEl = null;
    let wrapper = null;
    const warningEl = el("div", { class: "field-warning", hidden: "hidden" }, []);
    const hiddenMetaEl = el("div", { class: "sub field-secret-meta", hidden: "hidden" }, []);

    function updateRequiredState() {
      if (!field.required || !inputEl) {
        row.classList.remove("required-empty");
        return;
      }
      const hasExplicitValue = node.form && Object.prototype.hasOwnProperty.call(node.form, field.key);
      const useDefaultWhenUnset = field.key !== "input_data";
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
      updateHiddenBindingMeta();
    }

    function notifyCommitted() {
      updateRequiredState();
      updateReferenceWarning();
      updateHiddenBindingMeta();
      if (onStateChanged) onStateChanged();
    }

    function updateHiddenBindingMeta() {
      hiddenMetaEl.hidden = true;
      hiddenMetaEl.textContent = "";
    }

    if (field.kind === "textarea" && field.key === "schema") {
      const rendered = renderSchemaEditor({
        node,
        field,
        current,
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
    } else if (field.key === "input_data") {
      const r = renderInputDataSelect({
        node,
        field,
        current,
        upstreamSteps,
        onValueChanged: async () => {
          await applyBqLoadSchemaFromInputData({ node, state });
          notifyCommitted();
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
        if (bridgeApi?.available?.()) {
          try {
            const type = field.kind === "dir" ? "file.pickFolder" : "file.pickFile";
            const currentValue = getFieldCurrentValue(node, field);
            const payload = {
              title: field.kind === "dir" ? `${field.label || "フォルダ"}を選択` : `${field.label || "ファイル"}を選択`,
              step_name: String(node.stepName || "global"),
              field_key: String(field.key || ""),
              current_ref: isHiddenBindingRef(currentValue) ? currentValue : "",
              current_value: isHiddenBindingRef(currentValue) ? "" : String(currentValue || "")
            };
            if (field.kind !== "dir") {
              payload.filters = buildFileDialogFilters(field);
            }
            const result = await bridgeApi.call(type, payload);
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
          if (!bridgeApi?.available?.()) return;
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
      wrapper = wrapWithVarSuggest(inputEl, availableVariableNames || [], onStateChanged, wrapper);
    }
    delete field.__skipVarSuggest;

    const right = el("div", {}, [wrapper]);
    if (field.required) {
      right.appendChild(el("div", { class: "sub" }, [document.createTextNode("必須")]));
    }
    right.appendChild(hiddenMetaEl);
    right.appendChild(warningEl);
    row.appendChild(right);
    updateRequiredState();
    updateReferenceWarning();
    updateHiddenBindingMeta();
    return row;
  }

  const uiFields = { renderField, getFieldReferenceWarnings };
  window.uiFields = uiFields;
})();
