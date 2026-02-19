(function () {
  const { el } = window.utils;
  const { wrapWithVarSuggest } = window.uiSuggest;

  /* =========================================================
     combo input (datalist, free input)
  ========================================================= */

  function renderComboInput({ node, field, current, onValueChanged }) {
    const listId = `combo_${node.id}_${field.key}`;

    const input = el("input", {
      type: "text",
      list: listId,
      placeholder: field.placeholder || "",
      oninput: (e) => {
        node.form[field.key] = e.target.value;
        if (onValueChanged) onValueChanged();
      }
    });
    input.value = current;

    const datalist = el("datalist", { id: listId }, []);
    for (const opt of field.options || []) {
      datalist.appendChild(el("option", { value: opt }));
    }

    return { input, wrapper: el("div", {}, [input, datalist]) };
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

  /* =========================================================
     field renderer
  ========================================================= */

  function renderField({ node, field, upstreamSteps, onStateChanged }) {
    const row = el("div", { class: "row" }, []);
    row.appendChild(el("label", {}, [document.createTextNode(field.label)]));

    const current =
      node.form[field.key] !== undefined
        ? node.form[field.key]
        : field.default !== undefined
          ? field.default
          : "";

    let inputEl = null;
    let wrapper = null;

    function updateRequiredState() {
      if (!field.required || !inputEl) {
        row.classList.remove("required-empty");
        return;
      }
      const hasExplicitValue = node.form && Object.prototype.hasOwnProperty.call(node.form, field.key);
      const v = hasExplicitValue ? node.form[field.key] : field.default;
      const empty = v === undefined || v === null || String(v).trim() === "";
      row.classList.toggle("required-empty", empty);
    }

    if (field.kind === "textarea") {
      inputEl = el("textarea", {
        placeholder: field.placeholder || "",
        oninput: (e) => {
          node.form[field.key] = e.target.value;
          updateRequiredState();
        }
      });
      inputEl.value = current;
      wrapper = inputEl;
    } else if (field.kind === "number") {
      inputEl = el("input", {
        type: "number",
        placeholder: field.placeholder || "",
        oninput: (e) => {
          node.form[field.key] = e.target.value;
          updateRequiredState();
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
        onValueChanged: updateRequiredState
      });
      inputEl = r.input;
      wrapper = r.wrapper;
    } else if (field.kind === "combo") {
      const r = renderComboInput({ node, field, current, onValueChanged: updateRequiredState });
      inputEl = r.input;
      wrapper = r.wrapper;
    } else if (field.kind === "file" || field.kind === "dir") {
      const text = el("input", {
        type: "text",
        placeholder:
          field.placeholder || (field.kind === "dir" ? "フォルダを選択" : "ファイルを選択"),
        oninput: (e) => {
          node.form[field.key] = e.target.value;
          updateRequiredState();
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
        updateRequiredState();
        onStateChanged();
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
          updateRequiredState();
        }
      });
      inputEl.value = current;
      wrapper = inputEl;
    }

    if (field.allowVars && inputEl && inputEl.tagName !== "SELECT") {
      wrapper = wrapWithVarSuggest(inputEl, upstreamSteps, onStateChanged);
    }

    const right = el("div", {}, [wrapper]);
    if (field.required) {
      right.appendChild(el("div", { class: "sub" }, [document.createTextNode("必須")]));
    }
    row.appendChild(right);
    updateRequiredState();
    return row;
  }

  window.uiFields = { renderField };
})();
