(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const dialogApi = corePkg.dialog || null;
  const { el } = corePkg.utils || {};
  const {
    addNodeAfter,
    addParallelAfter,
    duplicateNodeAfter,
    insertNodeAt,
    addMergeParent,
    clearPendingMergeSource,
    removeMergeParent,
    setPendingMergeSource,
    setSelectedNode
  } = corePkg.stateOps || {};
  const shared = (packages.ui && packages.ui.nodeShared) || window.uiNodeShared || {};
  const {
    buildNodeClipboardSnapshot,
    isEditingShortcutTarget,
    getMergeParentIds,
    ensureNodeDefaults,
    isMergeableNode,
    getMergeErrorMessage,
    isLoopRootNode,
    isDraggableNode,
    insertLoopInternalAtAnchor,
    insertAfterLoopEnd,
    addParallelAfterLoopEnd,
    requestNodeRunById,
    removeNodeById
  } = shared;
  const parts = (packages.ui && packages.ui.nodeCanvasParts) || window.uiNodeCanvasParts || {};
  const {
    buildFlowModel,
    drawFlowCanvas,
    hitTask,
    hitSelectableNode,
    hitStickyNote,
    hitControl,
    getControlTooltip,
    createImmediateTooltip
  } = parts;
  const {
    NODE_W = 60,
    NODE_H = 60,
    START_X = 44,
    START_Y = 40,
    GRID_SIZE = 64
  } = parts.constants || {};

  let copiedNodeSnapshot = null;
  const DRAG_THRESHOLD = 5;
  const STICKY_NOTE_MIN_W = 120;
  const STICKY_NOTE_MIN_H = 72;
  const STICKY_NOTE_DEFAULT_W = 224;
  const STICKY_NOTE_DEFAULT_H = 128;
  const STICKY_NOTE_GRID_SIZE = 32;
  const STICKY_NOTE_COLORS = ["#fff2a8", "#ffd7a8", "#ffd0d8", "#c9f7d1", "#cfe4ff", "#e0d4ff"];
  const STICKY_NOTE_HANDLE_SIZE = 14;

  function snapToGrid(value, origin, gridSize) {
    const size = Math.max(1, Number(gridSize) || 20);
    const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
    return base + Math.round((value - base) / size) * size;
  }

  function clampCanvasCoordinate(value) {
    return Math.max(8, Math.round(Number(value) || 0));
  }

  function createStickyNoteId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `note_${window.crypto.randomUUID()}`;
    }
    return `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function normalizeStickyNote(value) {
    if (!value || typeof value !== "object") return null;
    const id = String(value.id || "").trim();
    const x = Number(value.x);
    const y = Number(value.y);
    const w = Number(value.w);
    const h = Number(value.h);
    if (!id) return null;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
    return {
      id,
      x: clampCanvasCoordinate(x),
      y: clampCanvasCoordinate(y),
      w: Math.max(STICKY_NOTE_MIN_W, Math.round(w)),
      h: Math.max(STICKY_NOTE_MIN_H, Math.round(h)),
      text: String(value.text || ""),
      color: String(value.color || STICKY_NOTE_COLORS[0]),
      anchorNodeId: value.anchorNodeId ? String(value.anchorNodeId) : null
    };
  }

  function getStickyNotes(state) {
    if (!state || typeof state !== "object") return [];
    return (Array.isArray(state.stickyNotes) ? state.stickyNotes : [])
      .map((note) => normalizeStickyNote(note))
      .filter(Boolean);
  }

  function setStickyNotes(state, notes) {
    if (!state || typeof state !== "object") return;
    state.stickyNotes = (Array.isArray(notes) ? notes : [])
      .map((note) => normalizeStickyNote(note))
      .filter(Boolean);
  }

  function withSelectedStickyNote(state, selectedId) {
    const notes = getStickyNotes(state);
    const selected = String(selectedId || "");
    if (!selected) return { notes, selectedNote: null };
    const selectedNote = notes.find((note) => note.id === selected) || null;
    return { notes, selectedNote };
  }

  function findStickyNoteById(state, noteId) {
    return getStickyNotes(state).find((note) => note.id === noteId) || null;
  }

  function toGridCoordinate(value, origin, gridSize) {
    const size = Math.max(1, Number(gridSize) || 64);
    const base = Number.isFinite(Number(origin)) ? Number(origin) : 0;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 0;
    return Math.round(((raw - base) / size) * 1000) / 1000;
  }

  function snapStickyCoordinate(value, origin) {
    return clampCanvasCoordinate(snapToGrid(value, origin, STICKY_NOTE_GRID_SIZE));
  }

  function buildCenteredStickyNote(root, color = STICKY_NOTE_COLORS[0]) {
    const viewportLeft = Number(root?.scrollLeft || 0);
    const viewportTop = Number(root?.scrollTop || 0);
    const viewportWidth = Number(root?.clientWidth || 0);
    const viewportHeight = Number(root?.clientHeight || 0);
    const centerX = viewportLeft + viewportWidth / 2 - STICKY_NOTE_DEFAULT_W / 2;
    const centerY = viewportTop + viewportHeight / 2 - STICKY_NOTE_DEFAULT_H / 2;
    return {
      id: createStickyNoteId(),
      x: clampCanvasCoordinate(centerX),
      y: clampCanvasCoordinate(centerY),
      w: STICKY_NOTE_DEFAULT_W,
      h: STICKY_NOTE_DEFAULT_H,
      text: "",
      color,
      anchorNodeId: null
    };
  }

  function getNodeMergeMenuState(state, nodeId) {
    const node = state.nodes.find((item) => item.id === nodeId);
    const incomingSources = node ? getMergeParentIds(node) : [];
    const outgoingTargets = state.nodes
      .filter((item) => getMergeParentIds(item).includes(nodeId))
      .map((item) => item.id);
    return { incomingSources, outgoingTargets };
  }

  function destroyFlowCanvas(root) {
    const view = root?.__flowView;
    if (!view) return;
    if (view.animationFrameId) {
      try { window.cancelAnimationFrame(view.animationFrameId); } catch (_) {}
    }
    try { view.menuEl?.remove?.(); } catch (_) {}
    try { view.tooltipEl?.remove?.(); } catch (_) {}
    try { view.stickyToolbar?.remove?.(); } catch (_) {}
    try { view.stickyEditorEl?.remove?.(); } catch (_) {}
    try { view.canvas?.remove?.(); } catch (_) {}
    delete root.__flowView;
    delete root.__flowRuntime;
  }

  function ensureFlowCanvas(root) {
    if (root.__flowView) {
      const existingView = root.__flowView;
      if (existingView.canvas?.parentElement === root) return existingView;
      destroyFlowCanvas(root);
    }

    root.innerHTML = "";
    root.style.overflowX = "auto";
    root.style.overflowY = "auto";
    const canvas = document.createElement("canvas");
    canvas.className = "flow-canvas";
    canvas.title = "";
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "フローチャートキャンバス");
    root.appendChild(canvas);
    const menuEl = document.createElement("div");
    menuEl.className = "flow-context-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(menuEl);
    const ctx = canvas.getContext("2d");
    const tooltipEl = createImmediateTooltip();
    const view = {
      root,
      canvas,
      ctx,
      hoverControl: null,
      dropControl: null,
      dragState: null,
      pendingMergeDrag: null,
      mergeDragState: null,
      suppressContextMenuOnce: false,
      tooltipEl,
      menuEl,
      menuNodeId: null,
      animationFrameId: null,
      animationNow: 0,
      hasRunningAnimation: false,
      requestDraw: null,
      stickyNoteMode: false,
      stickyNoteSelectedId: "",
      stickyNotePreview: null,
      stickyNoteDragState: null,
      stickyToolbar: null,
      stickyEditorEl: null,
      stickyEditorNoteId: ""
    };
    root.__flowView = view;

    const computedRootPosition = window.getComputedStyle(root).position;
    if (computedRootPosition === "static" || !computedRootPosition) {
      root.style.position = "relative";
    }

    const stickyToolbar = document.createElement("div");
    stickyToolbar.className = "flow-sticky-toolbar";
    stickyToolbar.innerHTML = `
      <button class="flow-sticky-toolbar__icon-btn" type="button" data-role="sticky-enter" title="メモモードに切り替える">
        <img src="./icons/stickynote.svg" alt="" aria-hidden="true" />
      </button>
      <div class="flow-sticky-toolbar__panel" data-role="sticky-panel" hidden>
        <button class="flow-sticky-toolbar__btn" type="button" data-role="sticky-exit">メモモードを終了する</button>
        <button class="flow-sticky-toolbar__btn" type="button" data-role="sticky-add">メモを追加する</button>
        <button class="flow-sticky-toolbar__btn is-danger" type="button" data-role="sticky-delete">メモを削除する</button>
        <div class="flow-sticky-toolbar__colors" data-role="sticky-colors"></div>
      </div>
    `;
    root.appendChild(stickyToolbar);
    view.stickyToolbar = stickyToolbar;
    const stickyEditor = document.createElement("textarea");
    stickyEditor.className = "flow-sticky-note-editor";
    stickyEditor.setAttribute("aria-label", "メモ編集");
    stickyEditor.hidden = true;
    root.appendChild(stickyEditor);
    view.stickyEditorEl = stickyEditor;

    const stickyControls = {
      enterBtn: stickyToolbar.querySelector('[data-role="sticky-enter"]'),
      panel: stickyToolbar.querySelector('[data-role="sticky-panel"]'),
      exitBtn: stickyToolbar.querySelector('[data-role="sticky-exit"]'),
      addBtn: stickyToolbar.querySelector('[data-role="sticky-add"]'),
      deleteBtn: stickyToolbar.querySelector('[data-role="sticky-delete"]'),
      colors: stickyToolbar.querySelector('[data-role="sticky-colors"]'),
    };

    if (stickyControls.colors) {
      stickyControls.colors.innerHTML = STICKY_NOTE_COLORS.map((color) => (
        `<button class="flow-sticky-toolbar__color" type="button" data-role="sticky-color" data-color="${color}" title="${color}" style="--sticky-color:${color}"></button>`
      )).join("");
    }

    function scheduleAnimation() {
      if (view.animationFrameId || !view.hasRunningAnimation) return;
      view.animationFrameId = window.requestAnimationFrame((timestamp) => {
        view.animationFrameId = null;
        view.animationNow = timestamp;
        if (root.__flowView !== view) return;
        drawFlowCanvas(view);
        if (view.hasRunningAnimation) scheduleAnimation();
      });
    }

    function stopAnimation() {
      if (!view.animationFrameId) return;
      window.cancelAnimationFrame(view.animationFrameId);
      view.animationFrameId = null;
    }

    function requestDraw() {
      drawFlowCanvas(view);
      syncStickyInlineEditor();
      if (view.hasRunningAnimation) scheduleAnimation();
      else stopAnimation();
    }

    view.requestDraw = requestDraw;

    function getRuntime() {
      return root.__flowRuntime || null;
    }

    function resolveEditableStickyNote(noteId = "") {
      const runtime = getRuntime();
      if (!runtime) return null;
      const targetId = String(noteId || "").trim();
      if (!targetId) return null;
      const fromModel = (Array.isArray(runtime.model?.stickyNotes) ? runtime.model.stickyNotes : [])
        .find((note) => note?.id === targetId);
      if (fromModel) return normalizeStickyNote(fromModel);
      return findStickyNoteById(runtime.state, targetId);
    }

    function applyStickyEditorGeometry(note) {
      const editor = view.stickyEditorEl;
      if (!editor || !note) return;
      editor.style.left = `${Math.round(note.x)}px`;
      editor.style.top = `${Math.round(note.y)}px`;
      editor.style.width = `${Math.max(STICKY_NOTE_MIN_W, Math.round(note.w))}px`;
      editor.style.height = `${Math.max(STICKY_NOTE_MIN_H, Math.round(note.h))}px`;
      editor.style.backgroundColor = String(note.color || STICKY_NOTE_COLORS[0]);
    }

    function closeStickyInlineEditor(options = {}) {
      const editor = view.stickyEditorEl;
      if (!editor || editor.hidden) return false;
      const commit = options.commit !== false;
      const editingId = String(view.stickyEditorNoteId || "");
      const nextText = String(editor.value || "").replace(/\r\n?/g, "\n");
      editor.hidden = true;
      view.stickyEditorNoteId = "";
      const runtime = getRuntime();
      if (!commit || !editingId || !runtime) return false;
      const current = findStickyNoteById(runtime.state, editingId);
      if (!current || String(current.text || "") === nextText) return false;
      mutateStickyNotes((notes, context) => {
        const target = notes.find((note) => note.id === editingId);
        if (!target) return false;
        target.text = nextText;
        context.selectedId = editingId;
      });
      return true;
    }

    function openStickyInlineEditor(noteId) {
      const editor = view.stickyEditorEl;
      if (!editor || !view.stickyNoteMode) return;
      closeStickyInlineEditor({ commit: true });
      const note = resolveEditableStickyNote(noteId);
      if (!note) return;
      view.stickyEditorNoteId = note.id;
      view.stickyNoteSelectedId = note.id;
      editor.value = String(note.text || "");
      applyStickyEditorGeometry(note);
      editor.hidden = false;
      window.requestAnimationFrame(() => {
        if (editor.hidden) return;
        editor.focus();
        const end = editor.value.length;
        try { editor.setSelectionRange(end, end); } catch (_) {}
      });
    }

    function syncStickyInlineEditor() {
      const editor = view.stickyEditorEl;
      if (!editor || editor.hidden) return;
      const note = resolveEditableStickyNote(view.stickyEditorNoteId);
      if (!note) {
        closeStickyInlineEditor({ commit: true });
        return;
      }
      applyStickyEditorGeometry(note);
    }

    function syncStickyToolbar() {
      const runtime = getRuntime();
      const state = runtime?.state;
      const { selectedNote } = withSelectedStickyNote(state, view.stickyNoteSelectedId);
      const hasSelection = !!selectedNote;

      stickyToolbar.classList.toggle("is-active", !!view.stickyNoteMode);
      if (stickyControls.panel) stickyControls.panel.hidden = !view.stickyNoteMode;
      if (stickyControls.enterBtn) {
        stickyControls.enterBtn.title = view.stickyNoteMode ? "メモモード中" : "メモモードに切り替える";
      }
      if (stickyControls.deleteBtn) stickyControls.deleteBtn.disabled = !hasSelection;
      if (stickyControls.colors) {
        stickyControls.colors.querySelectorAll('[data-role="sticky-color"]').forEach((button) => {
          const color = String(button.getAttribute("data-color") || "");
          button.classList.toggle("is-active", !!selectedNote && color === selectedNote.color);
          button.disabled = !hasSelection;
        });
      }
    }

    function setStickyMode(enabled) {
      const next = !!enabled;
      if (view.stickyNoteMode === next) {
        syncStickyToolbar();
        requestDraw();
        return;
      }
      view.stickyNoteMode = next;
      if (!next) {
        closeStickyInlineEditor({ commit: true });
        view.stickyNotePreview = null;
        view.stickyNoteDragState = null;
      }
      syncStickyToolbar();
      requestDraw();
    }

    function mutateStickyNotes(mutator) {
      const runtime = getRuntime();
      if (!runtime || typeof mutator !== "function") return false;
      const notes = getStickyNotes(runtime.state);
      const context = { selectedId: view.stickyNoteSelectedId };
      const shouldCommit = mutator(notes, context);
      if (shouldCommit === false) return false;
      setStickyNotes(runtime.state, notes);
      view.stickyNoteSelectedId = String(context.selectedId || "");
      view.stickyNotePreview = null;
      runtime.onStateChanged();
      return true;
    }

    function ensureStickySelection() {
      const runtime = getRuntime();
      if (!runtime) return;
      const selected = findStickyNoteById(runtime.state, view.stickyNoteSelectedId);
      if (selected) return;
      view.stickyNoteSelectedId = "";
    }

    function createStickyNoteAtCenter() {
      const runtime = getRuntime();
      if (!runtime) return;
      const note = buildCenteredStickyNote(root, STICKY_NOTE_COLORS[0]);
      mutateStickyNotes((notes, context) => {
        notes.push(note);
        context.selectedId = note.id;
      });
    }

    function deleteSelectedStickyNote() {
      const selectedId = String(view.stickyNoteSelectedId || "");
      if (!selectedId) return;
      if (String(view.stickyEditorNoteId || "") === selectedId) {
        closeStickyInlineEditor({ commit: true });
      }
      mutateStickyNotes((notes, context) => {
        const index = notes.findIndex((note) => note.id === selectedId);
        if (index < 0) return false;
        notes.splice(index, 1);
        context.selectedId = "";
      });
    }

    function updateSelectedStickyNoteColor(color) {
      const selectedId = String(view.stickyNoteSelectedId || "");
      if (!selectedId) return;
      const nextColor = String(color || "").trim();
      if (!nextColor) return;
      mutateStickyNotes((notes) => {
        const note = notes.find((item) => item.id === selectedId);
        if (!note || note.color === nextColor) return false;
        note.color = nextColor;
      });
    }

    function editSelectedStickyNoteText(targetNoteId = "") {
      const selectedId = String(targetNoteId || view.stickyNoteSelectedId || "");
      if (!selectedId) return;
      openStickyInlineEditor(selectedId);
    }

    stickyToolbar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-role]");
      if (!button) return;
      const role = String(button.getAttribute("data-role") || "");
      if (role === "sticky-enter") {
        if (!view.stickyNoteMode) setStickyMode(true);
        syncStickyToolbar();
        return;
      }
      if (role === "sticky-exit") {
        setStickyMode(false);
        syncStickyToolbar();
        return;
      }
      if (role === "sticky-add") {
        if (!view.stickyNoteMode) setStickyMode(true);
        createStickyNoteAtCenter();
        syncStickyToolbar();
        return;
      }
      if (role === "sticky-delete") {
        deleteSelectedStickyNote();
        syncStickyToolbar();
        return;
      }
      if (role === "sticky-color") {
        const color = button.getAttribute("data-color");
        updateSelectedStickyNoteColor(color);
        syncStickyToolbar();
      }
    });

    stickyEditor.addEventListener("blur", () => {
      closeStickyInlineEditor({ commit: true });
    });

    stickyEditor.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        closeStickyInlineEditor({ commit: true });
        stickyEditor.blur();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeStickyInlineEditor({ commit: true });
        stickyEditor.blur();
      }
    });

    view.syncStickyToolbar = syncStickyToolbar;
    view.ensureStickySelection = ensureStickySelection;
    view.syncStickyInlineEditor = syncStickyInlineEditor;
    syncStickyToolbar();

    function hideTooltip() {
      tooltipEl.style.opacity = "0";
      tooltipEl.style.left = "-9999px";
      tooltipEl.style.top = "-9999px";
      tooltipEl.textContent = "";
    }

    function showTooltip(ctrl, clientX, clientY) {
      const text = getControlTooltip(ctrl, view.dragState);
      if (!text) {
        hideTooltip();
        return;
      }
      tooltipEl.textContent = text;
      tooltipEl.style.left = `${clientX + 12}px`;
      tooltipEl.style.top = `${clientY + 12}px`;
      tooltipEl.style.opacity = "1";
    }

    function hideContextMenu() {
      view.menuNodeId = null;
      menuEl.classList.remove("is-open");
      menuEl.style.left = "-9999px";
      menuEl.style.top = "-9999px";
      menuEl.setAttribute("aria-hidden", "true");
    }

    function showContextMenu(target, clientX, clientY) {
      view.menuNodeId = target?.nodeId || null;
      const runtime = root.__flowRuntime;
      const items = [];
      if (runtime && view.menuNodeId) {
        const mergeMenuState = getNodeMergeMenuState(runtime.state, view.menuNodeId);
        if (mergeMenuState.incomingSources.length) {
          items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="remove-merge-incoming" role="menuitem">合流を解除</button>');
        }
        if (mergeMenuState.outgoingTargets.length) {
          items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="remove-merge-outgoing" role="menuitem">合流を解除</button>');
        }
      }
      items.push('<button class="flow-context-menu__item" type="button" data-action="run" role="menuitem">実行</button>');
      items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="delete" role="menuitem">削除</button>');
      menuEl.innerHTML = items.join("");
      menuEl.style.left = `${clientX}px`;
      menuEl.style.top = `${clientY}px`;
      menuEl.classList.add("is-open");
      menuEl.setAttribute("aria-hidden", "false");
    }

    let pendingDrag = null;
    let isPanning = false;
    let panMoved = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;
    let lastPanAt = 0;

    canvas.addEventListener("mousemove", (e) => {
      if (view.dragState || pendingDrag || isPanning || view.stickyNoteDragState) return;
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (view.stickyNoteMode) {
        const hitNote = hitStickyNote(runtime.model, x, y, { handleSize: STICKY_NOTE_HANDLE_SIZE });
        view.hoverControl = null;
        view.dropControl = null;
        hideTooltip();
        if (hitNote?.onResizeHandle) canvas.style.cursor = "nwse-resize";
        else if (hitNote?.note) canvas.style.cursor = "move";
        else canvas.style.cursor = "default";
        return;
      }
      view.hoverControl = hitControl(runtime.model, x, y);
      view.dropControl = null;
      showTooltip(view.hoverControl, e.clientX, e.clientY);
      const hoverNode = hitSelectableNode(runtime.model, x, y);
      canvas.style.cursor = view.hoverControl || hoverNode ? "pointer" : "default";
      requestDraw();
    });

    canvas.addEventListener("mouseleave", () => {
      if (view.dragState || pendingDrag || view.stickyNoteDragState) return;
      view.hoverControl = null;
      view.dropControl = null;
      hideTooltip();
      canvas.style.cursor = "default";
      requestDraw();
    });

    root.addEventListener("wheel", (e) => {
      const horizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontalIntent) return;
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      root.scrollLeft += delta;
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("contextmenu", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      if (view.stickyNoteMode) {
        e.preventDefault();
        hideContextMenu();
        return;
      }
      if (view.suppressContextMenuOnce) {
        view.suppressContextMenuOnce = false;
        e.preventDefault();
        hideContextMenu();
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      if (!task) {
        hideContextMenu();
        return;
      }
      e.preventDefault();
      hideTooltip();
      setSelectedNode(runtime.state, task.id);
      runtime.onStateChanged();
      showContextMenu({ nodeId: task.id }, e.clientX, e.clientY);
    });

    canvas.addEventListener("mousedown", (e) => {
      try {
        if (document.activeElement !== canvas) canvas.focus({ preventScroll: true });
      } catch (_) {
        try { canvas.focus(); } catch (_) {}
      }
      hideContextMenu();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      const stickyHit = view.stickyNoteMode
        ? hitStickyNote(runtime.model, x, y, { handleSize: STICKY_NOTE_HANDLE_SIZE })
        : null;
      if (e.button === 2) {
        if (view.stickyNoteMode) return;
        if (!task || !isMergeableNode(task.nodeRef)) return;
        view.pendingMergeDrag = {
          sourceId: task.id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          canvasX: x,
          canvasY: y,
          started: false
        };
        return;
      }
      if (e.button !== 0) return;
      if (view.stickyNoteMode && stickyHit?.note) {
        view.stickyNoteSelectedId = stickyHit.note.id;
        view.stickyNotePreview = null;
        view.stickyNoteDragState = {
          noteId: stickyHit.note.id,
          mode: stickyHit.onResizeHandle ? "resize" : "move",
          startClientX: e.clientX,
          startClientY: e.clientY,
          originX: stickyHit.note.x,
          originY: stickyHit.note.y,
          originW: stickyHit.note.w,
          originH: stickyHit.note.h,
          moved: false
        };
        view.hoverControl = null;
        view.dropControl = null;
        hideTooltip();
        canvas.style.cursor = stickyHit.onResizeHandle ? "nwse-resize" : "move";
        document.body.style.userSelect = "none";
        syncStickyToolbar();
        requestDraw();
        e.preventDefault();
        return;
      }
      if (view.stickyNoteMode) {
        isPanning = true;
        panMoved = false;
        hideTooltip();
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartScrollLeft = root.scrollLeft;
        panStartScrollTop = root.scrollTop;
        canvas.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        e.preventDefault();
        return;
      }
      if (task && isDraggableNode(task.nodeRef)) {
        pendingDrag = {
          nodeId: task.id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          pointerOffsetX: x - task.x,
          pointerOffsetY: y - task.y
        };
        view.hoverControl = null;
        view.dropControl = null;
        hideTooltip();
        document.body.style.userSelect = "none";
        e.preventDefault();
        return;
      }
      isPanning = true;
      panMoved = false;
      hideTooltip();
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartScrollLeft = root.scrollLeft;
      panStartScrollTop = root.scrollTop;
      canvas.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (view.stickyNoteDragState) {
        const runtime = root.__flowRuntime;
        const drag = view.stickyNoteDragState;
        if (!runtime || !drag) return;
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) drag.moved = true;
        if (drag.mode === "move") {
          const rawX = drag.originX + dx;
          const rawY = drag.originY + dy;
          view.stickyNotePreview = {
            id: drag.noteId,
            x: snapStickyCoordinate(rawX, START_X),
            y: snapStickyCoordinate(rawY, START_Y),
            w: drag.originW,
            h: drag.originH
          };
        } else {
          const rawW = drag.originW + dx;
          const rawH = drag.originH + dy;
          const nextW = Math.max(STICKY_NOTE_MIN_W, Math.round(snapToGrid(rawW, 0, STICKY_NOTE_GRID_SIZE)));
          const nextH = Math.max(STICKY_NOTE_MIN_H, Math.round(snapToGrid(rawH, 0, STICKY_NOTE_GRID_SIZE)));
          view.stickyNotePreview = {
            id: drag.noteId,
            x: drag.originX,
            y: drag.originY,
            w: nextW,
            h: nextH
          };
        }
        requestDraw();
        return;
      }
      if (view.pendingMergeDrag && !view.mergeDragState) {
        const moveDx = e.clientX - view.pendingMergeDrag.startClientX;
        const moveDy = e.clientY - view.pendingMergeDrag.startClientY;
        if (Math.hypot(moveDx, moveDy) >= 5) {
          const runtime = root.__flowRuntime;
          if (!runtime) return;
          setSelectedNode(runtime.state, view.pendingMergeDrag.sourceId);
          setPendingMergeSource(runtime.state, view.pendingMergeDrag.sourceId);
          view.mergeDragState = {
            sourceId: view.pendingMergeDrag.sourceId,
            targetNodeId: null,
            canvasX: view.pendingMergeDrag.canvasX,
            canvasY: view.pendingMergeDrag.canvasY
          };
          view.pendingMergeDrag = null;
          view.suppressContextMenuOnce = true;
          canvas.style.cursor = "crosshair";
          document.body.style.userSelect = "none";
          runtime.onStateChanged();
        }
      }
      if (view.mergeDragState) {
        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hoveredTask = hitTask(runtime.model, x, y);
        view.mergeDragState.canvasX = x;
        view.mergeDragState.canvasY = y;
        view.mergeDragState.targetNodeId = hoveredTask && isMergeableNode(hoveredTask.nodeRef) && hoveredTask.id !== view.mergeDragState.sourceId
          ? hoveredTask.id
          : null;
        canvas.style.cursor = view.mergeDragState.targetNodeId ? "copy" : "crosshair";
        requestDraw();
        return;
      }
      if (pendingDrag) {
        const moveDx = e.clientX - pendingDrag.startClientX;
        const moveDy = e.clientY - pendingDrag.startClientY;
        if (!view.dragState && Math.hypot(moveDx, moveDy) < DRAG_THRESHOLD) return;

        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = canvas.getBoundingClientRect();
        const pointerX = e.clientX - rect.left;
        const pointerY = e.clientY - rect.top;
        const rawNodeX = pointerX - pendingDrag.pointerOffsetX;
        const rawNodeY = pointerY - pendingDrag.pointerOffsetY;
        const snappedX = clampCanvasCoordinate(snapToGrid(rawNodeX, START_X, GRID_SIZE));
        const snappedY = clampCanvasCoordinate(snapToGrid(rawNodeY, START_Y, GRID_SIZE));

        view.dragState = {
          nodeId: pendingDrag.nodeId,
          started: true,
          canvasX: snappedX + NODE_W / 2,
          canvasY: snappedY + NODE_H / 2,
          snappedX,
          snappedY
        };
        view.hoverControl = null;
        view.dropControl = null;
        canvas.style.cursor = "grabbing";
        hideTooltip();
        requestDraw();
        return;
      }
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
      root.scrollLeft = panStartScrollLeft - dx;
      root.scrollTop = panStartScrollTop - dy;
    });

    window.addEventListener("mouseup", () => {
      if (view.stickyNoteDragState) {
        const runtime = root.__flowRuntime;
        const drag = view.stickyNoteDragState;
        const preview = view.stickyNotePreview;
        const didMove = !!drag?.moved;
        view.stickyNoteDragState = null;
        view.stickyNotePreview = null;
        canvas.style.cursor = "default";
        document.body.style.userSelect = "";
        if (!runtime || !preview?.id) {
          requestDraw();
          return;
        }
        const notes = getStickyNotes(runtime.state);
        const index = notes.findIndex((note) => note.id === preview.id);
        if (index < 0) {
          requestDraw();
          return;
        }
        const current = notes[index];
        const next = normalizeStickyNote({
          ...current,
          ...preview,
          x: drag?.mode === "move"
            ? snapStickyCoordinate(preview.x, START_X)
            : current.x,
          y: drag?.mode === "move"
            ? snapStickyCoordinate(preview.y, START_Y)
            : current.y,
          w: Math.max(STICKY_NOTE_MIN_W, Math.round(preview.w ?? current.w)),
          h: Math.max(STICKY_NOTE_MIN_H, Math.round(preview.h ?? current.h))
        });
        if (!next) {
          requestDraw();
          return;
        }
        const changed =
          current.x !== next.x ||
          current.y !== next.y ||
          current.w !== next.w ||
          current.h !== next.h;
        if (changed) {
          notes[index] = next;
          setStickyNotes(runtime.state, notes);
          if (didMove) lastPanAt = Date.now();
          runtime.onStateChanged();
          syncStickyToolbar();
          return;
        }
        requestDraw();
        return;
      }
      if (view.pendingMergeDrag) {
        view.pendingMergeDrag = null;
        return;
      }
      if (view.mergeDragState) {
        const runtime = root.__flowRuntime;
        const sourceId = view.mergeDragState.sourceId;
        const targetNodeId = view.mergeDragState.targetNodeId;
        view.mergeDragState = null;
        canvas.style.cursor = "default";
        document.body.style.userSelect = "";
        if (runtime) {
          if (sourceId && targetNodeId) {
            const result = addMergeParent(runtime.state, sourceId, targetNodeId);
            if (!result?.ok) {
              if (dialogApi?.show) dialogApi.show(getMergeErrorMessage(result), { kind: "warning", title: "合流" });
              else alert(getMergeErrorMessage(result));
            }
          }
          clearPendingMergeSource(runtime.state);
          runtime.onStateChanged();
        } else {
          requestDraw();
        }
        return;
      }
      if (pendingDrag) {
        const runtime = root.__flowRuntime;
        const draggingNodeId = pendingDrag.nodeId;
        const activeDragState = view.dragState;
        const didDrag = !!activeDragState;

        pendingDrag = null;
        document.body.style.userSelect = "";
        hideTooltip();
        canvas.style.cursor = "default";
        view.dragState = null;
        view.hoverControl = null;
        view.dropControl = null;

        if (didDrag) {
          lastPanAt = Date.now();
          if (runtime) {
            const targetNode = runtime.state.nodes.find((node) => node.id === draggingNodeId);
            if (targetNode) {
              targetNode.canvasPosition = {
                x: clampCanvasCoordinate(activeDragState?.snappedX),
                y: clampCanvasCoordinate(activeDragState?.snappedY)
              };
              targetNode.canvasGridPosition = {
                x: toGridCoordinate(targetNode.canvasPosition.x, START_X, GRID_SIZE),
                y: toGridCoordinate(targetNode.canvasPosition.y, START_Y, GRID_SIZE)
              };
              setSelectedNode(runtime.state, draggingNodeId);
              runtime.onStateChanged();
              return;
            }
          }
          if (runtime) {
            runtime.onStateChanged();
            return;
          }
          requestDraw();
        }
        return;
      }
      if (!isPanning) return;
      if (panMoved) lastPanAt = Date.now();
      isPanning = false;
      panMoved = false;
      canvas.style.cursor = "default";
      document.body.style.userSelect = "";
    });

    menuEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const runtime = root.__flowRuntime;
      const nodeId = view.menuNodeId;
      hideContextMenu();
      if (!runtime || !nodeId) return;
      if (btn.dataset.action === "remove-merge-incoming") {
        const node = runtime.state.nodes.find((item) => item.id === nodeId);
        const incomingSources = node ? getMergeParentIds(node) : [];
        const changed = incomingSources.some((sourceId) => removeMergeParent(runtime.state, sourceId, nodeId));
        if (changed) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "remove-merge-outgoing") {
        const changed = runtime.state.nodes.some((item) =>
          getMergeParentIds(item).includes(nodeId) && removeMergeParent(runtime.state, nodeId, item.id)
        );
        if (changed) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "run") {
        requestNodeRunById(runtime.state, nodeId, "single", runtime.onStateChanged);
        return;
      }
      if (btn.dataset.action === "delete") {
        removeNodeById(runtime.state, nodeId, runtime.onStateChanged);
      }
    });

    canvas.addEventListener("click", (e) => {
      hideContextMenu();
      if (Date.now() - lastPanAt < 180) return;
      hideTooltip();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (view.stickyNoteMode) {
        const stickyHit = hitStickyNote(runtime.model, x, y, { handleSize: STICKY_NOTE_HANDLE_SIZE });
        if (stickyHit?.note) {
          view.stickyNoteSelectedId = stickyHit.note.id;
          syncStickyToolbar();
          requestDraw();
          return;
        }
        if (view.stickyNoteSelectedId) {
          view.stickyNoteSelectedId = "";
          syncStickyToolbar();
          requestDraw();
        }
        return;
      }

      const control = hitControl(runtime.model, x, y);
      if (control) {
        if (control.mode === "loop-root" || control.mode === "loop-internal") {
          if (control.kind === "insert") {
            const created = insertLoopInternalAtAnchor(
              runtime.state,
              control.loopRootId || control.anchorId,
              control.anchorId
            );
            if (created) runtime.onStateChanged();
          }
          return;
        }

        if (control.mode === "loop-end") {
          if (control.kind === "insert") {
            const created = insertAfterLoopEnd(runtime.state, control.loopRootId, control.rightId || null);
            if (created) runtime.onStateChanged();
            return;
          }
          if (control.kind === "parallel") {
            const created = addParallelAfterLoopEnd(runtime.state, control.loopRootId, control.rightId || null);
            if (created) runtime.onStateChanged();
            return;
          }
        }

        const rightIndex = control.rightId
          ? runtime.state.nodes.findIndex((n) => n.id === control.rightId)
          : -1;
        const anchorIndex = control.anchorId && control.anchorId !== "__start__"
          ? runtime.state.nodes.findIndex((n) => n.id === control.anchorId)
          : -1;

        if (control.kind === "insert") {
          if (control.rightId === null) {
            if (anchorIndex >= 0) addNodeAfter(runtime.state, anchorIndex);
            else insertNodeAt(runtime.state, 0);
          } else if (anchorIndex >= 0) {
            addNodeAfter(runtime.state, anchorIndex);
          } else if (rightIndex >= 0) {
            insertNodeAt(runtime.state, rightIndex);
          }
          runtime.onStateChanged();
          return;
        }

        if (control.kind === "parallel" && rightIndex >= 0) {
          addParallelAfter(runtime.state, rightIndex, { parentId: control.anchorId });
          runtime.onStateChanged();
          return;
        }
      }

      const targetNode = hitSelectableNode(runtime.model, x, y);
      if (targetNode) {
        setSelectedNode(runtime.state, targetNode.id);
        runtime.onStateChanged();
      }
    });

    canvas.addEventListener("dblclick", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime || !view.stickyNoteMode) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const stickyHit = hitStickyNote(runtime.model, x, y, { handleSize: STICKY_NOTE_HANDLE_SIZE });
      if (!stickyHit?.note) return;
      view.stickyNoteSelectedId = stickyHit.note.id;
      syncStickyToolbar();
      editSelectedStickyNoteText(stickyHit.note.id);
      e.preventDefault();
    });

    window.addEventListener("pointerdown", (e) => {
      if (!menuEl.classList.contains("is-open")) return;
      if (menuEl.contains(e.target)) return;
      hideContextMenu();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideContextMenu();
        if (view.stickyNoteMode) {
          setStickyMode(false);
          e.preventDefault();
          return;
        }
      }
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      if (document.activeElement !== canvas) return;
      if (e.target !== canvas) return;
      if (!isEditingShortcutTarget(e.target) && view.stickyNoteMode) {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (view.stickyNoteSelectedId) {
            deleteSelectedStickyNote();
            syncStickyToolbar();
            e.preventDefault();
          }
          return;
        }
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditingShortcutTarget(e.target)) return;

      const key = String(e.key || "").toLowerCase();
      if (view.stickyNoteMode) return;
      if (key === "c") {
        const selectedNode = runtime.state.nodes.find((node) => node.id === runtime.state.selectedNodeId);
        copiedNodeSnapshot = buildNodeClipboardSnapshot(selectedNode);
        if (copiedNodeSnapshot) e.preventDefault();
        return;
      }
      if (key === "v") {
        if (!copiedNodeSnapshot) return;
        const selectedNode = runtime.state.nodes.find((node) => node.id === runtime.state.selectedNodeId);
        if (!selectedNode || isLoopRootNode(selectedNode) || selectedNode.loopOwnerId) return;
        const duplicated = duplicateNodeAfter?.(runtime.state, selectedNode.id, copiedNodeSnapshot);
        if (duplicated) {
          e.preventDefault();
          runtime.onStateChanged();
        }
      }
    });

    window.addEventListener("resize", () => {
      hideContextMenu();
      requestDraw();
    });

    return view;
  }

  function renderFlowChart({ root, state, config, onStateChanged }) {
    try {
      state.nodes.forEach((node) => ensureNodeDefaults(config, node));
      const model = buildFlowModel(state, config);
      const view = ensureFlowCanvas(root);
      root.__flowRuntime = { state, config, model, onStateChanged };
      view.ensureStickySelection?.();
      view.syncStickyToolbar?.();
      view.requestDraw();
    } catch (err) {
      console.error("flowchart render failed", err);
      root.innerHTML = "";
      const msg = el("div", { class: "flow-fallback" }, [
        document.createTextNode("フローチャート描画に失敗しました。状態を確認してください。")
      ]);
      root.appendChild(msg);
    }
  }

  function refreshFlowStatus({ root, state }) {
    try {
      const view = root?.__flowView;
      const runtime = root?.__flowRuntime;
      if (!view || !runtime || !state) return false;
      runtime.state = state;
      view.ensureStickySelection?.();
      view.syncStickyToolbar?.();
      view.requestDraw?.();
      return true;
    } catch (error) {
      console.error("flow status refresh failed", error);
      return false;
    }
  }

  const nodeCanvas = { renderFlowChart, destroyFlowCanvas, refreshFlowStatus };
  window.uiNodeCanvas = nodeCanvas;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.nodeCanvas = nodeCanvas;
})();
