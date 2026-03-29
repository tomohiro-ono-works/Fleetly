(function () {
  const { el } = window.utils;
  const { wrapWithVarSuggest } = window.uiSuggest;

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
      onchange: (e) => {
        node.form[field.key] = e.target.value;
        if (onValueChanged) onValueChanged();
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

  function renderSchemaEditor({ node, field, current, onInputChanged, onCommitChanged }) {
    const parsed = parseSchemaText(current);
    const initialMode = canUseSchemaFormMode(parsed) ? "form" : "json";
    const wrapper = el("div", { class: "schema-editor" }, []);
    const toolbar = el("div", { class: "schema-editor-toolbar" }, []);
    const modeSwitch = el("div", { class: "schema-editor-mode" }, []);
    const formBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("フォーム")]);
    const jsonBtn = el("button", { type: "button", class: "schema-mode-btn" }, [document.createTextNode("JSON")]);
    const hint = el("div", { class: "schema-editor-hint" }, []);
    const body = el("div", { class: "schema-editor-body" }, []);
    const formPane = el("div", { class: "schema-form-pane" }, []);
    const jsonPane = el("div", { class: "schema-json-pane" }, []);
    const addRowBtn = el("button", { type: "button", class: "schema-add-row-btn" }, [document.createTextNode("+ カラム追加")]);
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
    toolbar.appendChild(modeSwitch);
    formPane.appendChild(addRowBtn);
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
    const host = el("div", { class: "code-editor-host", "data-language": language }, []);
    const wrapper = el("div", { class: "code-editor" }, [host, textarea]);

    if (window.codeEditors && typeof window.codeEditors.mountCodeEditor === "function" && language) {
      window.codeEditors
        .mountCodeEditor({
          host,
          value: textarea.value,
          language,
          variableNames: availableVariableNames || [],
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
          wrapper.classList.add("is-codemirror-ready");
        })
        .catch((err) => {
          console.warn("CodeMirror mount failed, fallback to textarea", err);
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
      /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
      /\$\{([a-zA-Z0-9_]+)(?:[^}]*)\}/g
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

  function normalizeInputDataReference(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const doubleBraceMatch = text.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
    if (doubleBraceMatch) return doubleBraceMatch[1];
    const braceMatch = text.match(/^\$?\{([a-zA-Z0-9_]+)(?:[^}]*)\}$/);
    if (braceMatch) return braceMatch[1];
    return text;
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
      if (!ref || upstreamSet.has(ref)) return [];
      return [`参照先 ${ref} は上流に存在しません。`];
    }

    if (!supportsVars) return [];

    return extractReferencedVariableNames(value)
      .filter((ref) => !variableSet.has(ref))
      .map((ref) => `変数 ${ref} は定義されていません。`);
  }

  function renderField({ node, field, upstreamSteps, availableVariableNames, onStateChanged }) {
    const row = el("div", { class: "row" }, []);
    row.appendChild(el("label", {}, [document.createTextNode(field.label)]));

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
    }

    function notifyCommitted() {
      updateRequiredState();
      updateReferenceWarning();
      if (onStateChanged) onStateChanged();
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
    } else if (field.key === "input_data") {
      const r = renderInputDataSelect({
        node,
        field,
        current,
        upstreamSteps,
        onValueChanged: notifyCommitted
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
      }

      const btn = el(
        "button",
        {
          type: "button",
          onclick: () => picker.click()
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
    right.appendChild(warningEl);
    row.appendChild(right);
    updateRequiredState();
    updateReferenceWarning();
    return row;
  }

  window.uiFields = { renderField, getFieldReferenceWarnings };
})();
