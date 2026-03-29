(function () {
  const { el } = window.utils;

  /* =========================================================
     {{var}} suggest (text/textarea/combo)
  ========================================================= */

  function wrapWithVarSuggest(inputEl, variableNames, onStateChanged, contentEl = inputEl) {
    const box = el("div", { class: "suggest" }, []);
    const list = el("div", { class: "suggest-list" }, []);
    box.appendChild(contentEl);
    box.appendChild(list);
    const comboController =
      contentEl && contentEl.__comboController
        ? contentEl.__comboController
        : inputEl.closest?.(".combo-field")?.__comboController || null;

    function hide() {
      list.style.display = "none";
      list.innerHTML = "";
    }

    function show(items, onPick) {
      comboController?.closeMenu?.();
      list.innerHTML = "";
      if (!items.length) {
        list.appendChild(
          el("div", { class: "suggest-empty" }, [document.createTextNode("候補がありません")])
        );
        list.style.display = "block";
        return;
      }

      for (const v of items) {
        list.appendChild(
          el(
            "div",
            {
              class: "suggest-item",
              onmousedown: (e) => e.preventDefault(),
              onclick: () => onPick(v)
            },
            [document.createTextNode(`{{${v}}}`)]
          )
        );
      }
      list.style.display = "block";
    }

    function handler() {
      const v = inputEl.value || "";
      const caret = inputEl.selectionStart || 0;
      const left = v.slice(0, caret);

      const m = left.match(/\{\{\s*([a-zA-Z0-9_]*)$/);
      if (!m) return hide();

      const prefix = m[1] || "";
      const items = Array.from(new Set(variableNames.filter((x) => x.startsWith(prefix))));

      show(items, (chosen) => {
        const before = v.slice(0, caret - prefix.length);
        const after = v.slice(caret);
        inputEl.value = before + chosen + "}}" + after;

        const pos = before.length + chosen.length + 2;
        inputEl.selectionStart = inputEl.selectionEnd = pos;

        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        onStateChanged();
        hide();
      });
    }

    function scheduleHandler() {
      window.requestAnimationFrame(handler);
    }

    inputEl.addEventListener("input", scheduleHandler);
    inputEl.addEventListener("focus", scheduleHandler);
    inputEl.addEventListener("keyup", scheduleHandler);
    inputEl.addEventListener("click", scheduleHandler);
    inputEl.addEventListener("mouseup", scheduleHandler);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "{") scheduleHandler();
    });
    inputEl.addEventListener("blur", () => setTimeout(hide, 150));

    return box;
  }

  function attachCodeEditorVarSuggest(editor, contentEl, variableNames, onStateChanged) {
    if (!editor || !contentEl) return;
    const list = el("div", { class: "suggest-list" }, []);
    contentEl.appendChild(list);

    function hide() {
      list.style.display = "none";
      list.innerHTML = "";
    }

    function show(items, onPick) {
      list.innerHTML = "";
      if (!items.length) {
        list.appendChild(
          el("div", { class: "suggest-empty" }, [document.createTextNode("候補がありません")])
        );
        list.style.display = "block";
        return;
      }

      items.forEach((name) => {
        list.appendChild(
          el(
            "div",
            {
              class: "suggest-item",
              onmousedown: (e) => e.preventDefault(),
              onclick: () => onPick(name)
            },
            [document.createTextNode(`{{${name}}}`)]
          )
        );
      });
      list.style.display = "block";
    }

    function handler() {
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line) || "";
      const left = line.slice(0, cursor.ch);
      const match = left.match(/\{\{\s*([a-zA-Z0-9_]*)$/);
      if (!match) return hide();

      const prefix = match[1] || "";
      const items = Array.from(new Set((variableNames || []).filter((name) => name.startsWith(prefix))));
      show(items, (chosen) => {
        const from = { line: cursor.line, ch: cursor.ch - prefix.length };
        const to = { line: cursor.line, ch: cursor.ch };
        editor.replaceRange(`${chosen}}}`, from, to);
        editor.focus();
        editor.setCursor({ line: cursor.line, ch: from.ch + chosen.length + 2 });
        if (onStateChanged) onStateChanged();
        hide();
      });
    }

    function scheduleHandler() {
      window.requestAnimationFrame(handler);
    }

    editor.on("changes", scheduleHandler);
    editor.on("cursorActivity", scheduleHandler);
    editor.on("focus", scheduleHandler);
    editor.on("blur", () => setTimeout(hide, 150));
  }

  window.uiSuggest = { wrapWithVarSuggest, attachCodeEditorVarSuggest };
})();
