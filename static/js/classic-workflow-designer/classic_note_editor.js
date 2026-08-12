(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  function createClassicNoteEditor(shell, renderer, controller) {
    let editingNote = null;
    let closing = false;

    function positionEditor() {
      if (!editingNote) return;
      const rect = renderer.getNoteScreenRect(editingNote.noteId);
      if (!rect) return;
      shell.noteEditor.style.left = `${Math.round(rect.left)}px`;
      shell.noteEditor.style.top = `${Math.round(rect.top)}px`;
      shell.noteEditor.style.width = `${Math.max(160, Math.round(rect.width))}px`;
      shell.noteEditor.style.height =
        `${Math.max(96, Math.round(rect.height))}px`;
    }

    function close(commit = true) {
      if (!editingNote || closing) return;
      closing = true;
      const current = editingNote;
      editingNote = null;
      shell.noteEditor.hidden = true;
      if (
        commit &&
        shell.noteEditor.value !== String(current.note.note?.text || "")
      ) {
        controller.commit([{
          op: "replace",
          path: current.note.textPath,
          value: shell.noteEditor.value
        }], "annotation.edit");
      }
      closing = false;
    }

    function begin(note) {
      if (controller.isReadonly() || !note) return;
      close(true);
      editingNote = {
        noteId: note.noteId,
        note
      };
      shell.noteEditor.value = String(note.note?.text || "");
      shell.noteEditor.style.background = String(
        note.note?.color || "#fff4bf"
      );
      positionEditor();
      shell.noteEditor.hidden = false;
      shell.noteEditor.focus();
      shell.noteEditor.select();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        close(true);
      }
    }

    shell.noteEditor.addEventListener("blur", () => close(true));
    shell.noteEditor.addEventListener("keydown", onKeyDown);

    return Object.freeze({
      begin,
      close,
      sync: positionEditor,
      destroy() {
        close(false);
        shell.noteEditor.removeEventListener("keydown", onKeyDown);
      }
    });
  }

  modules.createClassicNoteEditor = createClassicNoteEditor;
})(window);
