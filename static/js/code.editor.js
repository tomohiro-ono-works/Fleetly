(function () {
  const CODE_EDITOR_VISIBLE_LINES = 15;
  const CODE_EDITOR_LINE_HEIGHT = 20;
  const CODE_EDITOR_VERTICAL_PADDING = 20;
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
    "SUM() AS ", "AVG() AS ", "MIN() AS ", "MAX() AS ","CREATE OR REPALACE TABLE ","CREATE TEMP TABLE ","CREATE TEMP FUNCTION "
  ];

  function getMode(language) {
    if (language === "sql") return "text/x-sql";
    if (language === "python") return "python";
    return "text/plain";
  }

  function applyEditorHeight(editor) {
    const height = CODE_EDITOR_LINE_HEIGHT * CODE_EDITOR_VISIBLE_LINES + CODE_EDITOR_VERTICAL_PADDING;
    editor.setSize(null, `${height}px`);
  }

  function getLanguageHintWords(language) {
    const helperWords = window.CodeMirror?.helpers?.hintWords?.[language];
    if (Array.isArray(helperWords) && helperWords.length) return helperWords;
    if (language === "python") return PYTHON_FALLBACK_HINTS;
    if (language === "sql") return SQL_FALLBACK_HINTS;
    return [];
  }

  function createCompletionController({ editor, language, variableNames }) {
    const list = document.createElement("div");
    list.className = "suggest-list is-code-editor is-floating";
    document.body.appendChild(list);

    const languageHints = Array.from(new Set(getLanguageHintWords(language).filter(Boolean)));
    const variableHints = Array.from(new Set((variableNames || []).filter(Boolean)));
    let currentItems = [];
    let activeIndex = 0;
    let currentContext = null;

    function hide() {
      currentItems = [];
      activeIndex = 0;
      currentContext = null;
      list.style.display = "none";
      list.innerHTML = "";
    }

    function positionList() {
      if (list.style.display !== "block") return;
      const cursor = editor.cursorCoords(null, "window");
      list.style.left = `${Math.max(12, cursor.left)}px`;
      list.style.top = `${cursor.bottom + 6}px`;
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

    function setItems(items, context) {
      currentItems = items;
      activeIndex = 0;
      currentContext = context;
      renderItems();
    }

    function collectContext() {
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line) || "";
      const left = line.slice(0, cursor.ch);

      const varMatch = left.match(/\{\{\s*([a-zA-Z0-9_]*)$/);
      if (varMatch) {
        const prefix = varMatch[1] || "";
        const items = variableHints
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ label: `{{${name}}}`, insertText: `{{${name}}}` }));
        return {
          type: "variable",
          items,
          from: { line: cursor.line, ch: varMatch.index },
          to: cursor,
          prefix
        };
      }

      const wordMatch = left.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
      if (wordMatch) {
        const prefix = wordMatch[1] || "";
        const loweredPrefix = prefix.toLowerCase();
        const items = languageHints
          .filter((word) => String(word).toLowerCase().startsWith(loweredPrefix))
          .map((word) => ({ label: String(word), insertText: String(word) }));
        return {
          type: "keyword",
          items,
          from: { line: cursor.line, ch: cursor.ch - prefix.length },
          to: cursor,
          prefix
        };
      }

      return null;
    }

    function refresh() {
      const context = collectContext();
      if (!context || !context.items.length) {
        hide();
        return false;
      }
      setItems(context.items, context);
      return true;
    }

    function applyItem(index = activeIndex) {
      if (!currentContext || !currentItems.length) return false;
      const item = currentItems[index];
      if (!item) return false;
      editor.replaceRange(item.insertText, currentContext.from, currentContext.to);
      editor.focus();
      hide();
      return true;
    }

    function moveActive(delta) {
      if (!currentItems.length) return;
      activeIndex = (activeIndex + delta + currentItems.length) % currentItems.length;
      renderItems();
    }

    function handleTab() {
      if (currentItems.length) return applyItem();
      return refresh();
    }

    editor.on("changes", () => {
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line) || "";
      const left = line.slice(0, cursor.ch);
      if (/\{\{\s*[a-zA-Z0-9_]*$/.test(left)) refresh();
      else hide();
    });
    editor.on("cursorActivity", positionList);
    editor.on("scroll", hide);
    editor.on("blur", () => setTimeout(hide, 150));
    editor.on("keydown", (_, event) => {
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
      if (event.key === "Tab") {
        const opened = handleTab();
        if (opened) event.preventDefault();
        return;
      }
      if (event.key === "Escape" && currentItems.length) {
        event.preventDefault();
        hide();
      }
    });

    return { hide };
  }

  function mountCodeEditor({ host, value, language, variableNames, onInputChanged, onCommitChanged }) {
    if (!window.CodeMirror) {
      return Promise.reject(new Error("CodeMirror is not loaded"));
    }

    host.innerHTML = "";
    const editor = window.CodeMirror(host, {
      value: value || "",
      mode: getMode(language),
      lineNumbers: true,
      lineWrapping: true,
      indentUnit: 2,
      tabSize: 2
      });

    editor.on("change", (instance) => {
      if (onInputChanged) onInputChanged(instance.getValue());
    });

    editor.on("blur", (instance) => {
      if (onCommitChanged) onCommitChanged(instance.getValue());
    });

    createCompletionController({
      editor,
      language,
      variableNames
    });

    setTimeout(() => {
      applyEditorHeight(editor);
      editor.refresh();
    }, 0);
    return Promise.resolve(editor);
  }

  const codeEditors = { mountCodeEditor };
  window.codeEditors = codeEditors;
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.codeEditors = codeEditors;
})();
