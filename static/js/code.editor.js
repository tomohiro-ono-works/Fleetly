(function () {
  const CODE_EDITOR_VISIBLE_LINES = 15;
  const CODE_EDITOR_LINE_HEIGHT = 20;
  const CODE_EDITOR_VERTICAL_PADDING = 20;

  function getMode(language) {
    if (language === "sql") return "text/x-sql";
    if (language === "python") return "python";
    return "text/plain";
  }

  function applyEditorHeight(editor) {
    const height = CODE_EDITOR_LINE_HEIGHT * CODE_EDITOR_VISIBLE_LINES + CODE_EDITOR_VERTICAL_PADDING;
    editor.setSize(null, `${height}px`);
  }

  function mountCodeEditor({ host, value, language, onInputChanged, onCommitChanged }) {
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

    setTimeout(() => {
      applyEditorHeight(editor);
      editor.refresh();
    }, 0);
    return Promise.resolve(editor);
  }

  window.codeEditors = { mountCodeEditor };
})();
