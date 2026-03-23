(function () {
  const { el } = window.utils;
  const { wrapWithVarSuggest } = window.uiSuggest;

  /* =========================================================
     combo input (free input + full dropdown list)
  ========================================================= */

  function renderComboInput({ node, field, current, onInputChanged, onCommitChanged }) {
    const input = el("input", {
      type: "text",
      class: "combo-input",
      placeholder: field.placeholder || "",
      oninput: (e) => {
        node.form[field.key] = e.target.value;
        if (onInputChanged) onInputChanged();
      },
      onchange: (e) => {
        node.form[field.key] = e.target.value;
        if (onCommitChanged) onCommitChanged();
      }
    });
    input.value = current || "";

    const options = Array.from(new Set(field.options || []));
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

    function chooseOption(value) {
      input.value = value;
      node.form[field.key] = value;
      if (onCommitChanged) onCommitChanged();
      closeMenu();
      input.focus();
      input.setSelectionRange?.(input.value.length, input.value.length);
    }

    options.forEach((optValue) => {
      menu.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "combo-item",
            onmousedown: (ev) => {
              ev.preventDefault();
              chooseOption(optValue);
            }
          },
          [document.createTextNode(optValue)]
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

  function renderCodeTextarea({ node, field, current, onInputChanged, onCommitChanged }) {
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

    return { input: textarea, wrapper, skipVarSuggest: true };
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

  function extractReferencedStepNames(value) {
    const text = String(value || "");
    const refs = new Set();
    const re = /\$\{([a-zA-Z0-9_]+)(?:[^}]*)\}/g;
    let match = re.exec(text);
    while (match) {
      refs.add(match[1]);
      match = re.exec(text);
    }
    return Array.from(refs);
  }

  function normalizeInputDataReference(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const braceMatch = text.match(/^\$?\{([a-zA-Z0-9_]+)(?:[^}]*)\}$/);
    if (braceMatch) return braceMatch[1];
    return text;
  }

  function getFieldReferenceWarnings({ node, field, upstreamSteps }) {
    const value = getFieldCurrentValue(node, field);
    const normalizedUpstream = Array.from(new Set((upstreamSteps || []).filter(Boolean)));
    const upstreamSet = new Set(normalizedUpstream);
    if (value === undefined || value === null || String(value).trim() === "") return [];

    if (field.key === "input_data") {
      const ref = normalizeInputDataReference(value);
      if (!ref || upstreamSet.has(ref)) return [];
      return [`参照先 ${ref} は上流に存在しません。`];
    }

    if (!field.allowVars) return [];

    return extractReferencedStepNames(value)
      .filter((ref) => !upstreamSet.has(ref))
      .map((ref) => `参照先 ${ref} は上流に存在しません。`);
  }

  function renderField({ node, field, upstreamSteps, onStateChanged }) {
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
      const warnings = getFieldReferenceWarnings({ node, field, upstreamSteps });
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

    if (field.kind === "textarea") {
      if (getCodeLanguageClass(field)) {
        const rendered = renderCodeTextarea({
          node,
          field,
          current,
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

    if (field.allowVars && inputEl && inputEl.tagName !== "SELECT" && !field.__skipVarSuggest) {
      wrapper = wrapWithVarSuggest(inputEl, upstreamSteps, onStateChanged, wrapper);
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
