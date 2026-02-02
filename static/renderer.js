(function () {
  const { el } = window.utils;
  const { getAvailableVars } = window.varsOps;
  const { addNodeAfter, removeNode } = window.stateOps;

  function getFormSchema(config, connector, action) {
    return config.forms[`${connector}.${action}`] || [];
  }

  /* =========================
     Connector / Action (select only)
  ========================= */

  function renderConnectorSelect({ config, node, onStateChanged }) {
    const s = el("select", {
      onchange: (e) => {
        node.connector = e.target.value;

        const actions = config.actions[node.connector] || [];
        node.action = actions[0]?.id || "";
        node.form = {};
        onStateChanged();
      }
    });

    for (const c of (config.connectors || [])) {
      const opt = el("option", { value: c.id }, [document.createTextNode(c.label)]);
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

    const actions = config.actions[node.connector] || [];
    for (const a of actions) {
      const opt = el("option", { value: a.id }, [document.createTextNode(a.label)]);
      if (a.id === node.action) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }

  /* =========================
     ${var} suggest for text/textarea
  ========================= */

  function wrapWithVarSuggest(inputEl, availableVars, onStateChanged) {
    const box = el("div", { class: "suggest" }, []);
    const list = el("div", { class: "suggest-list" }, []);
    box.appendChild(inputEl);
    box.appendChild(list);

    function hide() { list.style.display = "none"; list.innerHTML = ""; }
    function show(items, onPick) {
      list.innerHTML = "";
      if (!items.length) return hide();
      for (const v of items) {
        list.appendChild(el("div", {
          class: "suggest-item",
          onclick: () => onPick(v)
        }, [document.createTextNode(`\${${v}}`)]));
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
      const items = availableVars.filter(x => x.startsWith(prefix));

      show(items, (chosen) => {
        const before = v.slice(0, caret - prefix.length);
        const after  = v.slice(caret);
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

  /* =========================
     Combo (free input + suggestions)
  ========================= */

  function renderComboInput({ node, field, current, onStateChanged }) {
    const listId = `combo_${node.id}_${field.key}`;

    const input = el("input", {
      type: "text",
      list: listId,
      placeholder: field.placeholder || "",
      oninput: (e) => {
        node.form[field.key] = e.target.value;
        onStateChanged(); // 見た目上の必須判定などが将来必要なら
      }
    });
    input.value = current;

    const datalist = el("datalist", { id: listId }, []);
    for (const opt of (field.options || [])) {
      datalist.appendChild(el("option", { value: opt }));
    }

    return { input, wrapper: el("div", {}, [input, datalist]) };
  }

  /* =========================
     Field render
  ========================= */

  function renderField({ node, field, availableVars, onStateChanged }) {
    const row = el("div", { class: "row" }, []);
    row.appendChild(el("label", {}, [document.createTextNode(field.label)]));

    const current =
      (node.form[field.key] !== undefined) ? node.form[field.key] :
      (field.default !== undefined) ? field.default : "";

    let inputEl = null;
    let wrapper = null;

    if (field.kind === "textarea") {
      inputEl = el("textarea", {
        placeholder: field.placeholder || "",
        oninput: (e) => { node.form[field.key] = e.target.value; }
      });
      inputEl.value = current;
      wrapper = inputEl;

    } else if (field.kind === "number") {
      inputEl = el("input", {
        type: "number",
        placeholder: field.placeholder || "",
        oninput: (e) => { node.form[field.key] = e.target.value; }
      });
      inputEl.value = current;
      wrapper = inputEl;

    } else if (field.kind === "combo") {
      const r = renderComboInput({ node, field, current, onStateChanged });
      inputEl = r.input;
      wrapper = r.wrapper;

    } else {
      // text / file は両方 text として扱う（file://運用前提）
      inputEl = el("input", {
        type: "text",
        placeholder: field.placeholder || "",
        oninput: (e) => { node.form[field.key] = e.target.value; }
      });
      inputEl.value = current;
      wrapper = inputEl;
    }

    // allowVars: text / textarea / combo でも ${} 補完したい場合は inputEl に付与
    if (field.allowVars && inputEl) {
      wrapper = wrapWithVarSuggest(inputEl, availableVars, onStateChanged);
    }

    const right = el("div", {}, [wrapper]);

    if (field.required) {
      right.appendChild(el("div", { class: "sub" }, [document.createTextNode("必須")]));
    }

    row.appendChild(right);
    return row;
  }

  /* =========================
     Outputs: combo (free input + suggestions from upstream vars)
  ========================= */

  function renderOutputsEditor({ state, node, idx, onStateChanged }) {
    const upstream = getAvailableVars(state, idx);
    const listId = `outputs_${node.id}`;

    const input = el("input", {
      type: "text",
      list: listId,
      placeholder: "例: step1, result_table",
      oninput: (e) => {
        const raw = e.target.value.trim();
        node.outputs = raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
        onStateChanged();
      }
    });
    input.value = (node.outputs || []).join(", ");

    // outputsは「新規変数名」なので upstream を候補に出すかは悩ましいが、
    // ユーザー要件に合わせ「候補として出す」実装にしている
    const datalist = el("datalist", { id: listId }, []);
    for (const v of upstream) datalist.appendChild(el("option", { value: v }));

    return el("div", { class: "row" }, [
      el("label", {}, [document.createTextNode("出力変数")]),
      el("div", {}, [
        el("div", {}, [input, datalist]),
        el("div", { class: "sub" }, [document.createTextNode("カンマ区切り。下流で ${var} として参照可能")])
      ])
    ]);
  }

  /* =========================
     Node
  ========================= */

  function renderNode({ state, config, node, idx, onStateChanged }) {
    // 初期値の保険（古いstateが残っていても壊れにくくする）
    if (!node.connector) node.connector = "BQConnector";
    if (!node.action) {
      const actions = config.actions[node.connector] || [];
      node.action = actions[0]?.id || "";
    }
    if (!node.form) node.form = {};
    if (!node.outputs) node.outputs = [];

    const availableVars = getAvailableVars(state, idx);
    const schema = getFormSchema(config, node.connector, node.action);

    const headLeft = el("div", { class: "left" }, [
      el("div", { class: "badge" }, [document.createTextNode(`#${idx + 1}`)]),
      el("div", { style: "min-width:420px; max-width:560px;" }, [
        el("div", { class: "node-title" }, [document.createTextNode("Connector / Action")]),
        el("div", { class: "head-selects" }, [
          el("div", { class: "head-select" }, [
            el("div", { class: "head-label" }, [document.createTextNode("Connector")]),
            renderConnectorSelect({ config, node, onStateChanged })
          ]),
          el("div", { class: "head-select" }, [
            el("div", { class: "head-label" }, [document.createTextNode("Action")]),
            renderActionSelect({ config, node, onStateChanged })
          ])
        ])
      ])
    ]);

    const headRight = el("div", {}, [
      el("button", {
        class: "danger",
        onclick: () => { removeNode(state, idx); onStateChanged(); }
      }, [document.createTextNode("削除")])
    ]);

    const head = el("div", { class: "node-head" }, [headLeft, headRight]);

    const body = el("div", { class: "node-body" }, []);
    if (!schema.length) {
      body.appendChild(el("div", { class: "small" }, [
        document.createTextNode("フォーム定義がありません（config.forms のキー不一致の可能性）")
      ]));
    } else {
      for (const field of schema) {
        body.appendChild(renderField({ node, field, availableVars, onStateChanged }));
      }
    }

    body.appendChild(el("div", { class: "divider" }));
    body.appendChild(renderOutputsEditor({ state, node, idx, onStateChanged }));

    const foot = el("div", { class: "node-foot" }, [
      el("div", { class: "variables" }, [
        ...availableVars.map(v => el("span", { class: "var-chip" }, [document.createTextNode(`\${${v}}`)]))
      ]),
      el("button", {
        class: "success",
        onclick: () => { addNodeAfter(state, idx); onStateChanged(); }
      }, [document.createTextNode("この下にノード追加")])
    ]);

    return el("section", { class: "node" }, [head, body, foot]);
  }

  /* =========================
     App render
  ========================= */

  function renderApp({ root, state, config, onStateChanged }) {
    root.innerHTML = "";
    state.nodes.forEach((node, idx) => {
      root.appendChild(renderNode({ state, config, node, idx, onStateChanged }));
    });
  }

  window.renderer = { renderApp };
})();
