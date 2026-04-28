(function () {
  const CODE_EDITOR_VISIBLE_LINES = 15;
  const CODE_EDITOR_LINE_HEIGHT = 20;
  const CODE_EDITOR_VERTICAL_PADDING = 20;
  const CODE_EDITOR_GUTTER_DIGITS = 3;
  const INDENT_TEXT = "  ";
  const PYTHON_FALLBACK_HINTS = [
    "and", "as", "assert", "break", "class", "continue", "def", "del", "elif", "else", "except",
    "False", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "None",
    "not", "or", "pass", "raise", "return", "True", "try", "while", "with", "yield", "print",
    "len", "range", "str", "int", "float", "dict", "list", "set", "tuple", "open", "input"
  ];
  const SQL_FALLBACK_HINTS = [
    "SELECT\nFROM\nWHERE\nGROUP BY ALL\nHAVING\nORDER BY 1,2", "HAVING", "LIMIT", "WITH RD AS (\n\n),", "INSERT",
    "UPDATE", "DELETE FROM WHERE", "JOIN", "LEFT JOIN ON t1. = t2.", "RIGHT JOIN ON t1. = t2.", "INNER JOIN ON t1. = t2.", "AS", "AND",
    "OR", "NOT", "IN", "LIKE", "IS NULL", "CASE\nWHEN THEN\nELSE\nEND AS ", "COUNT() AS ",
    "SUM() AS ", "AVG() AS ", "MIN() AS ", "MAX() AS ", "CREATE OR REPALACE TABLE ", "CREATE TEMP TABLE ", "CREATE TEMP FUNCTION "
  ];

  function getCodeHighlightApi() {
    return (window.zizPackages && window.zizPackages.core && window.zizPackages.core.codeHighlight)
      || window.codeHighlight
      || {};
  }

  function applyEditorHeight(input, surface, highlight, host) {
    const basis = host || input;
    const shouldStretchInRightSidebar = !!basis?.closest?.(
      ".right-sidebar-content .node-tab-pane[data-tab-key='detail'] .row.row--code-editor"
    );
    if (shouldStretchInRightSidebar) {
      [input, surface, highlight].forEach((node) => {
        if (!node) return;
        node.style.height = "100%";
        node.style.minHeight = "100%";
        node.style.maxHeight = "none";
      });
      return;
    }
    const height = CODE_EDITOR_LINE_HEIGHT * CODE_EDITOR_VISIBLE_LINES + CODE_EDITOR_VERTICAL_PADDING;
    [input, surface, highlight].forEach((node) => {
      if (!node) return;
      node.style.height = `${height}px`;
      node.style.minHeight = `${height}px`;
      node.style.maxHeight = `${height}px`;
    });
  }

  function getLanguageHintWords(language) {
    if (language === "python") return PYTHON_FALLBACK_HINTS;
    if (language === "sql") return SQL_FALLBACK_HINTS;
    return [];
  }

  function replaceRange(input, start, end, nextText) {
    const text = String(input.value || "");
    input.value = `${text.slice(0, start)}${nextText}${text.slice(end)}`;
    const cursor = start + nextText.length;
    input.selectionStart = cursor;
    input.selectionEnd = cursor;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getCompletionContext(input, language, variableNames) {
    const text = String(input.value || "");
    const caret = input.selectionStart || 0;
    const left = text.slice(0, caret);

    const variableMatch = left.match(/\{\{\s*([a-zA-Z0-9_]*)$/);
    if (variableMatch) {
      const prefix = variableMatch[1] || "";
      const items = Array.from(new Set((variableNames || []).filter(Boolean)))
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ label: `{{${name}}}`, insertText: `{{${name}}}` }));
      return {
        from: variableMatch.index,
        to: caret,
        items
      };
    }

    const wordMatch = left.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!wordMatch) return null;

    const prefix = wordMatch[1] || "";
    const loweredPrefix = prefix.toLowerCase();
    const items = getLanguageHintWords(language)
      .filter((word) => String(word).toLowerCase().startsWith(loweredPrefix))
      .map((word) => ({ label: String(word), insertText: String(word) }));
    if (!items.length) return null;
    return {
      from: caret - prefix.length,
      to: caret,
      items
    };
  }

  function createCompletionController({ input, host, language, variableNames }) {
    const list = document.createElement("div");
    list.className = "suggest-list is-code-editor is-floating";
    document.body.appendChild(list);

    let currentContext = null;
    let currentItems = [];
    let activeIndex = 0;
    let positionFrameId = 0;

    function hide() {
      if (positionFrameId) {
        window.cancelAnimationFrame(positionFrameId);
        positionFrameId = 0;
      }
      currentContext = null;
      currentItems = [];
      activeIndex = 0;
      list.style.display = "none";
      list.innerHTML = "";
    }

    function positionListNow() {
      if (list.style.display !== "block") return;
      const rect = host.getBoundingClientRect();
      list.style.left = `${Math.max(12, rect.left + 8)}px`;
      list.style.top = `${Math.max(12, rect.bottom - 8)}px`;
    }

    function positionList() {
      if (positionFrameId) return;
      positionFrameId = window.requestAnimationFrame(() => {
        positionFrameId = 0;
        positionListNow();
      });
    }

    function applyItem(index = activeIndex) {
      const item = currentItems[index];
      if (!item || !currentContext) return false;
      replaceRange(input, currentContext.from, currentContext.to, item.insertText);
      hide();
      return true;
    }

    function renderItems() {
      list.innerHTML = "";
      currentItems.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = `suggest-item${index === activeIndex ? " is-active" : ""}`;
        row.textContent = item.label;
        row.onmousedown = (event) => event.preventDefault();
        row.onclick = () => applyItem(index);
        list.appendChild(row);
      });
      list.style.display = currentItems.length ? "block" : "none";
      positionList();
    }

    function refresh() {
      const nextContext = getCompletionContext(input, language, variableNames);
      if (!nextContext || !Array.isArray(nextContext.items) || !nextContext.items.length) {
        hide();
        return false;
      }
      currentContext = nextContext;
      currentItems = nextContext.items;
      activeIndex = 0;
      renderItems();
      return true;
    }

    function moveActive(delta) {
      if (!currentItems.length) return;
      activeIndex = (activeIndex + delta + currentItems.length) % currentItems.length;
      renderItems();
    }

    function scheduleRefresh() {
      if (!currentItems.length) return;
      window.requestAnimationFrame(() => {
        refresh();
      });
    }

    function handleTabCompletion() {
      if (currentItems.length) {
        return applyItem();
      }
      return refresh();
    }

    input.addEventListener("input", scheduleRefresh);
    input.addEventListener("scroll", positionList);
    window.addEventListener("resize", positionList);
    input.addEventListener("blur", () => setTimeout(hide, 150));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && currentItems.length) {
        event.preventDefault();
        moveActive(1);
        return;
      }
      if (event.key === "ArrowUp" && currentItems.length) {
        event.preventDefault();
        moveActive(-1);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && currentItems.length) {
        event.preventDefault();
        applyItem();
        return;
      }
      if (event.key === "Escape" && currentItems.length) {
        event.preventDefault();
        hide();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (!handleTabCompletion()) {
          const start = input.selectionStart || 0;
          const end = input.selectionEnd || 0;
          replaceRange(input, start, end, INDENT_TEXT);
        }
      }
    });

    return { hide };
  }

  function createHighlightController({ input, wrapper, language }) {
    const surface = document.createElement("div");
    surface.className = "code-editor-surface";
    const highlight = document.createElement("pre");
    highlight.className = "code-editor-highlight";
    surface.appendChild(highlight);
    wrapper.insertBefore(surface, input);

    function render() {
      const api = getCodeHighlightApi();
      if (typeof api.renderHighlightedHtml === "function") {
        surface.hidden = false;
        highlight.innerHTML = api.renderHighlightedHtml(input.value, language);
        wrapper.classList.add("is-code-editor-ready");
        return;
      }
      surface.hidden = true;
      wrapper.classList.remove("is-code-editor-ready");
    }

    function syncScroll() {
      surface.scrollTop = input.scrollTop;
      surface.scrollLeft = input.scrollLeft;
    }

    input.addEventListener("input", render);
    input.addEventListener("scroll", syncScroll);
    render();
    syncScroll();

    return { surface, highlight, render, syncScroll };
  }

  function createLineNumberController({ input, wrapper }) {
    const gutter = document.createElement("div");
    gutter.className = "code-editor-gutter";
    gutter.style.setProperty("--code-editor-gutter-digits", String(CODE_EDITOR_GUTTER_DIGITS));
    const inner = document.createElement("pre");
    inner.className = "code-editor-gutter-lines";
    gutter.appendChild(inner);
    wrapper.insertBefore(gutter, wrapper.firstChild || null);

    function render() {
      const text = String(input.value || "");
      const lineCount = Math.max(1, text.split(/\r\n|\r|\n/).length);
      const lines = [];
      for (let i = 1; i <= lineCount; i += 1) {
        lines.push(String(i).padStart(CODE_EDITOR_GUTTER_DIGITS, " "));
      }
      inner.textContent = lines.join("\n");
    }

    function syncScroll() {
      inner.style.transform = `translateY(${-input.scrollTop}px)`;
    }

    input.addEventListener("input", render);
    input.addEventListener("scroll", syncScroll);
    render();
    syncScroll();
    return { gutter, inner, render, syncScroll };
  }

  function mountCodeEditor({ input, value, language, variableNames, suggestionHost, onCommitChanged }) {
    if (!input || !suggestionHost) {
      return Promise.reject(new Error("Textarea host is not available"));
    }

    input.value = value || "";
    input.dataset.language = String(language || "");
    input.spellcheck = false;
    input.setAttribute("spellcheck", "false");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("aria-autocomplete", "none");
    input.setAttribute("data-gramm", "false");
    input.setAttribute("data-gramm_editor", "false");
    input.setAttribute("data-enable-grammarly", "false");
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.classList.add("is-enhanced-code-editor");

    const { surface, highlight } = createHighlightController({
      input,
      wrapper: suggestionHost,
      language
    });
    const lineNumbers = createLineNumberController({
      input,
      wrapper: suggestionHost
    });
    const syncEditorHeight = () => applyEditorHeight(input, surface, highlight, suggestionHost);
    syncEditorHeight();
    window.requestAnimationFrame(syncEditorHeight);
    window.setTimeout(syncEditorHeight, 0);
    window.addEventListener("resize", syncEditorHeight);

    createCompletionController({
      input,
      host: suggestionHost,
      language,
      variableNames
    });

    if (typeof onCommitChanged === "function") {
      input.addEventListener("blur", () => {
        onCommitChanged(String(input.value || ""));
      });
    }

    return Promise.resolve({ input, surface, highlight, lineNumbers });
  }

  const codeEditors = { mountCodeEditor };
  window.codeEditors = codeEditors;
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.codeEditors = codeEditors;
})();
