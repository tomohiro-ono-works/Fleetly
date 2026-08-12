(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function appendTextWithLinks(container, text) {
    const value = String(text || "");
    const pattern = /https:\/\/[^\s<>"']+/g;
    let cursor = 0;
    let match = pattern.exec(value);
    while (match) {
      if (match.index > cursor) {
        container.appendChild(document.createTextNode(value.slice(cursor, match.index)));
      }
      const link = modules.createWorkflowElement("a", "zwd-note__link", {
        href: match[0],
        "data-external-url": match[0]
      });
      link.textContent = match[0];
      container.appendChild(link);
      cursor = match.index + match[0].length;
      match = pattern.exec(value);
    }
    if (cursor < value.length) {
      container.appendChild(document.createTextNode(value.slice(cursor)));
    }
  }

  function createNoteElement(note, readonly) {
    const element = modules.createWorkflowElement;
    const wrapper = element("article", "zwd-note", {
      tabindex: "0",
      "data-note-id": note.noteId,
      "data-readonly": readonly ? "true" : "false",
      "aria-label": `Note ${note.noteId}`
    });
    wrapper.style.left = `${note.x}px`;
    wrapper.style.top = `${note.y}px`;
    wrapper.style.width = `${note.width}px`;
    wrapper.style.height = `${note.height}px`;
    const noteColor = String(note.note.color || "").trim();
    if (noteColor) wrapper.style.setProperty("--zwd-note-color", noteColor);

    const header = element("div", "zwd-note__header", {
      "data-note-drag-handle": ""
    });
    const id = element("span", "zwd-note__id");
    id.textContent = String(note.noteId);
    const colorAttributes = {
      type: "color",
      "data-note-color": note.noteId,
      "aria-label": "Note color"
    };
    if (/^#[0-9a-f]{6}$/i.test(noteColor)) colorAttributes.value = noteColor;
    if (readonly) colorAttributes.disabled = "";
    const color = element("input", "zwd-note__color", colorAttributes);
    header.appendChild(id);
    header.appendChild(color);

    const body = element("div", "zwd-note__body", {
      tabindex: "0",
      "data-note-body": note.noteId
    });
    appendTextWithLinks(body, note.note.text);
    const resize = element("button", "zwd-note__resize", {
      type: "button",
      tabindex: "-1",
      "data-note-resize": note.noteId,
      "aria-label": "Resize note"
    });
    if (readonly) resize.disabled = true;
    wrapper.appendChild(header);
    wrapper.appendChild(body);
    wrapper.appendChild(resize);
    return wrapper;
  }

  modules.createWorkflowNoteElement = createNoteElement;
  modules.appendWorkflowTextWithLinks = appendTextWithLinks;
})(window);
