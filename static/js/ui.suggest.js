(function () {
  const { el } = window.utils;

  /* =========================================================
     ${var} suggest (text/textarea/combo)
  ========================================================= */

  function wrapWithVarSuggest(inputEl, upstreamSteps, onStateChanged, contentEl = inputEl) {
    const box = el("div", { class: "suggest" }, []);
    const list = el("div", { class: "suggest-list" }, []);
    box.appendChild(contentEl);
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

  window.uiSuggest = { wrapWithVarSuggest };
})();
