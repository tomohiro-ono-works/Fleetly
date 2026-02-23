(function () {
  const { el } = window.utils;
  const { addNodeAfter, removeNode } = window.stateOps;

  /* =========================================================
     Helpers
  ========================================================= */

  function jpLabel(x) {
    return (x && (x.label_jp || x.label)) || (x && x.id) || "";
  }

  // step採番を必ず上から順に揃える（追加/削除/読み込み後も崩れない）
  function normalizeSteps(state) {
    state.nodes.forEach((node, i) => {
      node.stepName = `step${i + 1}`; // 内部保持（英名）
    });
  }

  // 上流ステップ（自分より上）の stepName を返す
  function getUpstreamSteps(state, idx) {
    const out = [];
    for (let i = 0; i < idx; i++) out.push(state.nodes[i].stepName);
    return out;
  }

  // config.forms の key: "ConnectorId.ActionId"
  function getFormSchema(config, connector, action) {
    return (config.forms && config.forms[`${connector}.${action}`]) || [];
  }

  /* =========================================================
     Connector / Action (select only)
  ========================================================= */

  function renderConnectorSelect({ config, node, onStateChanged }) {
    const s = el("select", {
      onchange: (e) => {
        node.connector = e.target.value;
        const actions = (config.actions && config.actions[node.connector]) || [];
        node.action = actions[0]?.id || "";
        node.form = {};
        onStateChanged();
      }
    });

    const connectors = config.connectors || [];
    for (const c of connectors) {
      const opt = el("option", { value: c.id }, [document.createTextNode(jpLabel(c))]);
      if (c.id === node.connector) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }

  function renderActionSelect({ config, node, onStateChanged }) {
    const s = el("select", {
      onchange: (e) => {
        node.action = e.target.value;
        node.form = {};
        onStateChanged();
      }
    });

    const actions = (config.actions && config.actions[node.connector]) || [];
    for (const a of actions) {
      const opt = el("option", { value: a.id }, [document.createTextNode(jpLabel(a))]);
      if (a.id === node.action) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }

  /* =========================================================
     ${var} suggest (text/textarea/combo)
  ========================================================= */

  function wrapWithVarSuggest(inputEl, upstreamSteps, onStateChanged) {
    const box = el("div", { class: "suggest" }, []);
    const list = el("div", { class: "suggest-list" }, []);
    box.appendChild(inputEl);
    box.appendChild(list);

    function hide() {
      list.style.display = "none";
      list.innerHTML = "";
    }

    function show(items, onPick) {
      list.innerHTML = "";
      if (!items.length) return hide();

      for (const v of items) {
        list.appendChild(
          el(
            "div",
            {
              class: "suggest-item",
              onclick: () => onPick(v)
            },
            [document.createTextNode(`\${${v}}`)]
          )
        );
      }
      list.style.display = "block";
    }

    function handler() {
      const v = inputEl.value || "";
      const caret = inputEl.selectionStart || 0;
      const left = v.slice(0, caret);

      const m = left.match(/\$\{([a-zA-Z0-9_]*)$/);
      if (!m) return hide();

      const prefix = m[1] || "";
      const items = upstreamSteps.filter((x) => x.startsWith(prefix));

      show(items, (chosen) => {
        const before = v.slice(0, caret - prefix.length);
        const after = v.slice(caret);
        inputEl.value = before + chosen + "}" + after;

        const pos = before.length + chosen.length + 1;
        inputEl.selectionStart = inputEl.selectionEnd = pos;

        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        onStateChanged();
        hide();
      });
    }

    inputEl.addEventListener("input", handler);
    inputEl.addEventListener("click", handler);
    inputEl.addEventListener("blur", () => setTimeout(hide, 150));

    return box;
  }

  /* =========================================================
     combo input (datalist, free input)
  ========================================================= */

  function renderComboInput({ node, field, current }) {
    const listId = `combo_${node.id}_${field.key}`;

    const input = el("input", {
      type: "text",
      list: listId,
      placeholder: field.placeholder || "",
      oninput: (e) => {
        node.form[field.key] = e.target.value;
      }
    });
    input.value = current;

    const datalist = el("datalist", { id: listId }, []);
    for (const opt of field.options || []) {
      datalist.appendChild(el("option", { value: opt }));
    }

    return { input, wrapper: el("div", {}, [input, datalist]) };
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

    if (field.kind === "textarea") {
      inputEl = el("textarea", {
        placeholder: field.placeholder || "",
        oninput: (e) => (node.form[field.key] = e.target.value)
      });
      inputEl.value = current;
      wrapper = inputEl;
    } else if (field.kind === "number") {
      inputEl = el("input", {
        type: "number",
        placeholder: field.placeholder || "",
        oninput: (e) => (node.form[field.key] = e.target.value)
      });
      inputEl.value = current;
      wrapper = inputEl;
    } else if (field.kind === "combo") {
      const r = renderComboInput({ node, field, current });
      inputEl = r.input;
      wrapper = r.wrapper;
    } else if (field.kind === "file" || field.kind === "dir") {
      const text = el("input", {
        type: "text",
        placeholder:
          field.placeholder || (field.kind === "dir" ? "フォルダを選択" : "ファイルを選択"),
        oninput: (e) => (node.form[field.key] = e.target.value)
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
        oninput: (e) => (node.form[field.key] = e.target.value)
      });
      inputEl.value = current;
      wrapper = inputEl;
    }

    if (field.allowVars && inputEl) {
      wrapper = wrapWithVarSuggest(inputEl, upstreamSteps, onStateChanged);
    }

    const right = el("div", {}, [wrapper]);
    if (field.required) {
      right.appendChild(el("div", { class: "sub" }, [document.createTextNode("必須")]));
    }
    row.appendChild(right);
    return row;
  }

  /* =========================================================
     node renderer
  ========================================================= */

  function ensureNodeDefaults(config, node) {
    if (!node.connector) node.connector = config.connectors?.[0]?.id || "";
    if (!node.action) {
      const actions = config.actions?.[node.connector] || [];
      node.action = actions[0]?.id || "";
    }
    if (!node.form) node.form = {};
  }

  function renderNode({ state, config, node, idx, onStateChanged }) {
    ensureNodeDefaults(config, node);

    const upstreamSteps = getUpstreamSteps(state, idx);
    const schema = getFormSchema(config, node.connector, node.action);

    const headLeft = el("div", { class: "left" }, [
      el("div", { class: "badge" }, [document.createTextNode(`{${node.stepName}}`)]),
      el("div", { style: "" }, [
        el("div", { class: "head-selects" }, [
          el("div", { class: "head-select" }, [
            renderConnectorSelect({ config, node, onStateChanged })
          ]),
          el("div", { class: "head-select" }, [
            renderActionSelect({ config, node, onStateChanged })
          ])
        ])
      ])
    ]);

    // 上部アクション（右側）
    const headActions = el("div", { class: "node-head-actions" }, [
      el(
        "button",
        {
          class: "danger",
          onclick: () => {
            removeNode(state, idx);
            onStateChanged();
          }
        },
        [document.createTextNode("削除")]
      ),
      el(
        "button",
        {
          class: "success",
          onclick: () => {
            addNodeAfter(state, idx);
            onStateChanged();
          }
        },
        [document.createTextNode("追加")]
      )
    ]);

    const head = el("div", { class: "node-head" }, [headLeft, headActions]);

    const body = el("div", { class: "node-body" }, []);
    if (!schema.length) {
      body.appendChild(
        el("div", { class: "small" }, [
          document.createTextNode("フォーム定義がありません（設定のキー不一致の可能性）")
        ])
      );
    } else {
      for (const field of schema) {
        body.appendChild(renderField({ node, field, upstreamSteps, onStateChanged }));
      }
    }

    body.appendChild(el("div", { class: "divider" }));

    const vars = el("div", { class: "variables" }, [
      ...upstreamSteps.map((v) => el("span", { class: "var-chip" }, [document.createTextNode(`\${${v}}`)]))
    ]);

    const foot = el("div", { class: "node-foot" }, [vars]);

    return el("section", { class: "node" }, [head, body, foot]);
  }

  /* =========================================================
     app renderer
  ========================================================= */

  function renderApp({ root, state, config, onStateChanged }) {
    normalizeSteps(state);

    root.innerHTML = "";
    state.nodes.forEach((node, idx) => {
      root.appendChild(renderNode({ state, config, node, idx, onStateChanged }));
    });
  }

  window.renderer = { renderApp };
})();
