(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  function element(tagName, className, attributes = {}) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    Object.entries(attributes).forEach(([name, value]) => {
      if (value === null || value === undefined) return;
      node.setAttribute(name, String(value));
    });
    return node;
  }

  function toolButton(command, label, text) {
    const button = element("button", "zcwd-tool", {
      type: "button",
      "data-zcwd-command": command,
      "aria-label": label,
      title: label
    });
    button.textContent = text;
    return button;
  }

  function createClassicShell(rootElement, labels = {}) {
    if (!(rootElement instanceof HTMLElement)) {
      throw new TypeError("ClassicWorkflowDesigner root must be an HTMLElement");
    }
    rootElement.innerHTML = "";

    const shell = element("div", "zcwd", {
      tabindex: "0",
      role: "application",
      "data-classic-workflow-designer": "",
      "aria-label": labels.designer || "Workflow designer"
    });
    const canvas = element("canvas", "zcwd-canvas", {
      tabindex: "0",
      "aria-label": labels.designer || "Workflow designer canvas"
    });
    const toolbar = element("div", "zcwd-toolbar", {
      role: "toolbar",
      "aria-label": labels.canvasTools || "Canvas tools"
    });
    toolbar.appendChild(toolButton(
      "viewport.zoom-out",
      labels.zoomOut || "Zoom out",
      "-"
    ));
    toolbar.appendChild(toolButton(
      "viewport.zoom-in",
      labels.zoomIn || "Zoom in",
      "+"
    ));
    toolbar.appendChild(toolButton(
      "viewport.fit",
      labels.fitView || "Fit view",
      "[]"
    ));
    toolbar.appendChild(toolButton(
      "annotation.add",
      labels.addNote || "Add note",
      "N"
    ));

    const noteColor = element("input", "zcwd-note-color", {
      type: "color",
      "data-zcwd-note-color": "",
      "aria-label": labels.noteColor || "Note color",
      title: labels.noteColor || "Note color"
    });
    noteColor.hidden = true;
    toolbar.appendChild(noteColor);

    const contextMenu = element("div", "zcwd-context-menu", {
      role: "menu",
      hidden: "hidden"
    });
    const message = element("div", "zcwd-message", {
      role: "status",
      "aria-live": "polite",
      hidden: "hidden"
    });
    const noteEditor = element("textarea", "zcwd-note-editor", {
      "aria-label": labels.noteEditor || "Edit note"
    });
    noteEditor.hidden = true;

    shell.appendChild(canvas);
    shell.appendChild(toolbar);
    shell.appendChild(contextMenu);
    shell.appendChild(message);
    shell.appendChild(noteEditor);
    rootElement.appendChild(shell);
    return {
      rootElement,
      shell,
      canvas,
      toolbar,
      noteColor,
      contextMenu,
      message,
      noteEditor
    };
  }

  modules.createClassicShell = createClassicShell;
  modules.classicElement = element;
})(window);
