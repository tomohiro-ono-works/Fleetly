(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const dialogApi = corePkg.dialog || null;
  const { el } = corePkg.utils || {};
  const {
    addMergeParent,
    clearPendingMergeSource,
    createNodeAtAnchor,
    createLoopNodeAtAnchor,
    createParallelNodeAtAnchor,
    duplicateNodesByIds,
    getSelectedNodeIds,
    hasDirectedEdge,
    hasSuccessorNode,
    removeDirectedEdge,
    removeNodesByIds,
    removeMergeParent,
    setSelectedNodes,
    setPendingMergeSource,
    setSelectedNode
  } = corePkg.stateOps || {};
  const shared = (packages.ui && packages.ui.nodeShared) || window.uiNodeShared || {};
  const {
    isEditingShortcutTarget,
    getMergeParentIds,
    ensureNodeDefaults,
    isLoopRootNode,
    insertAfterLoopEnd,
    insertLoopInternalAtAnchor,
    isMergeableNode,
    getMergeErrorMessage,
    isDraggableNode,
    requestNodeRunById,
    removeNodeById
  } = shared;
  const parts = (packages.ui && packages.ui.nodeCanvasParts) || window.uiNodeCanvasParts || {};
  const {
    buildFlowModel,
    drawFlowCanvas,
    hitEdge,
    hitTask,
    hitSelectableNode,
    hitStickyNote,
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
  const STICKY_NOTE_COLORS = ["#ebebf2", "#fce672", "#ff1665", "#a220b6", "#5e1ef6", "#1a807d"];
  const STICKY_NOTE_HANDLE_SIZE = 14;
  const STICKY_TOOLBAR_MARGIN = 10;

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

  function findStickyLinkHitAt(view, x, y) {
    const areas = Array.isArray(view?.stickyLinkHitAreas) ? view.stickyLinkHitAreas : [];
    for (let i = areas.length - 1; i >= 0; i -= 1) {
      const area = areas[i];
      const ax = Number(area?.x);
      const ay = Number(area?.y);
      const aw = Number(area?.w);
      const ah = Number(area?.h);
      if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(aw) || !Number.isFinite(ah)) continue;
      if (x >= ax && x <= ax + aw && y >= ay && y <= ay + ah) {
        const href = String(area?.href || "").trim();
        if (href) return { href };
      }
    }
    return null;
  }

  function resolveBridgeApi() {
    const localBridge = window?.zizBridge || window?.zizPackages?.core?.bridge || null;
    const parentBridge = (window.parent && window.parent !== window)
      ? (window.parent?.zizBridge || window.parent?.zizPackages?.core?.bridge || null)
      : null;
    const isCallable = (candidate) => !!candidate && typeof candidate.call === "function";
    const isAvailable = (candidate) => isCallable(candidate) && !!candidate.available?.();
    if (isAvailable(localBridge)) return localBridge;
    if (isAvailable(parentBridge)) return parentBridge;
    if (isCallable(localBridge)) return localBridge;
    if (isCallable(parentBridge)) return parentBridge;
    return null;
  }

  function openStickyLinkInExternalBrowser(url) {
    const href = String(url || "").trim();
    if (!href) return;
    const bridge = resolveBridgeApi();
    if (bridge?.available?.()) {
      bridge.call("app.openExternal", { url: href, prefer: "chrome" }).catch(async (error) => {
        try { console.warn("[sticky-link] app.openExternal failed", error); } catch (_) {}
        let restartHint = "";
        try {
          const status = await bridge.call("app.getStatus", {});
          const capabilities = Array.isArray(status?.capabilities) ? status.capabilities : [];
          if (!capabilities.includes("app.openExternal")) {
            restartHint = "\nアプリを再起動してください（bridge機能が古い可能性があります）。";
          }
        } catch (_) {}
        const message = `外部ブラウザ起動に失敗しました。${error?.message ? `\n${error.message}` : ""}${restartHint}`;
        if (dialogApi?.show) dialogApi.show(message, { kind: "warning", title: "外部リンク" });
        else alert(message);
        try {
          window.open(href, "_blank", "noopener,noreferrer");
        } catch (_) {}
      });
      return;
    }
    if (bridge) {
      try { console.warn("[sticky-link] bridge resolved but not available", bridge.status?.()); } catch (_) {}
      const message = "外部ブラウザ起動に失敗しました。\nネイティブブリッジ未接続です。";
      if (dialogApi?.show) dialogApi.show(message, { kind: "warning", title: "外部リンク" });
      else alert(message);
    }
    try {
      window.open(href, "_blank", "noopener,noreferrer");
    } catch (_) {}
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
    if (view.drawFrameId) {
      try { window.cancelAnimationFrame(view.drawFrameId); } catch (_) {}
    }
    if (view.animationFrameId) {
      try { window.cancelAnimationFrame(view.animationFrameId); } catch (_) {}
    }
    try { view.menuEl?.remove?.(); } catch (_) {}
    try { view.tooltipEl?.remove?.(); } catch (_) {}
    try { view.stickyToolbar?.remove?.(); } catch (_) {}
    try { view.stickyToolbarResizeObserver?.disconnect?.(); } catch (_) {}
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
      dragState: null,
      pendingMergeDrag: null,
      mergeDragState: null,
      suppressContextMenuOnce: false,
      tooltipEl,
      menuEl,
      menuNodeId: null,
      menuEdge: null,
      drawFrameId: null,
      animationFrameId: null,
      animationNow: 0,
      hasRunningAnimation: false,
      requestDraw: null,
      canvasRect: null,
      stickyNoteMode: false,
      stickyNoteSelectedId: "",
      stickyNotePreview: null,
      stickyNoteDragState: null,
      stickyLinkHitAreas: [],
      stickyToolbar: null,
      stickyEditorEl: null,
      stickyEditorNoteId: "",
      rangeSelectionRect: null,
      pendingRangeSelection: null,
      menuSelectionIds: null,
      stickyToolbarResizeObserver: null,
      stickyToolbarFrameId: 0,
      stickyToolbarLastX: null,
      stickyToolbarLastY: null,
      stickyToolbarLastVisible: null
    };
    root.__flowView = view;

    const computedRootPosition = window.getComputedStyle(root).position;
    if (computedRootPosition === "static" || !computedRootPosition) {
      root.style.position = "relative";
    }

    const stickyToolbar = document.createElement("div");
    stickyToolbar.className = "flow-sticky-toolbar";
    stickyToolbar.innerHTML = `
      <div class="flow-sticky-toolbar__pane-actions" data-role="pane-actions">
        <button class="flow-sticky-toolbar__pane-action-btn" type="button" data-role="pane-undo" title="戻る" aria-label="戻る">
          <img src="./icons/undo.svg" alt="" aria-hidden="true" class="flow-sticky-toolbar__pane-action-icon" />
        </button>
        <button class="flow-sticky-toolbar__pane-action-btn" type="button" data-role="pane-redo" title="進む" aria-label="進む">
          <img src="./icons/redo.svg" alt="" aria-hidden="true" class="flow-sticky-toolbar__pane-action-icon" />
        </button>
        <button class="flow-sticky-toolbar__pane-action-btn is-run" type="button" data-role="pane-run" title="実行" aria-label="実行">
          <img src="./icons/run.svg" alt="" aria-hidden="true" class="flow-sticky-toolbar__pane-action-icon" />
        </button>
      </div>
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
    document.body.appendChild(stickyToolbar);
    view.stickyToolbar = stickyToolbar;
    const stickyEditor = document.createElement("textarea");
    stickyEditor.className = "flow-sticky-note-editor";
    stickyEditor.setAttribute("aria-label", "メモ編集");
    stickyEditor.hidden = true;
    root.appendChild(stickyEditor);
    view.stickyEditorEl = stickyEditor;

    const stickyControls = {
      paneUndoBtn: stickyToolbar.querySelector('[data-role="pane-undo"]'),
      paneRedoBtn: stickyToolbar.querySelector('[data-role="pane-redo"]'),
      paneRunBtn: stickyToolbar.querySelector('[data-role="pane-run"]'),
      enterBtn: stickyToolbar.querySelector('[data-role="sticky-enter"]'),
      panel: stickyToolbar.querySelector('[data-role="sticky-panel"]'),
      exitBtn: stickyToolbar.querySelector('[data-role="sticky-exit"]'),
      addBtn: stickyToolbar.querySelector('[data-role="sticky-add"]'),
      deleteBtn: stickyToolbar.querySelector('[data-role="sticky-delete"]'),
      colors: stickyToolbar.querySelector('[data-role="sticky-colors"]'),
    };

    function isElementVisible(element) {
      if (!element) return false;
      if (element.hidden) return false;
      if (!element.isConnected) return false;
      if (element.getClientRects().length === 0) return false;
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    }

    function positionStickyToolbar() {
      if (root.__flowView !== view) return;
      if (!view.stickyToolbar || !view.stickyToolbar.isConnected) return;
      const rootRect = root.getBoundingClientRect();
      const toolbarRect = view.stickyToolbar.getBoundingClientRect();
      const toolbarWidth = Math.max(36, Math.round(toolbarRect.width || view.stickyToolbar.offsetWidth || 36));
      const toolbarHeight = Math.max(36, Math.round(toolbarRect.height || view.stickyToolbar.offsetHeight || 36));
      const rootVisible = rootRect.width > 0 && rootRect.height > 0;

      const rightSidebar = document.getElementById("rightSidebar");
      const anchorRect = isElementVisible(rightSidebar)
        ? rightSidebar.getBoundingClientRect()
        : null;

      const minX = Math.round(rootRect.left + STICKY_TOOLBAR_MARGIN);
      const maxX = Math.max(minX, Math.round(rootRect.right - toolbarWidth - STICKY_TOOLBAR_MARGIN));
      let nextX = anchorRect
        ? Math.round(anchorRect.left - toolbarWidth - STICKY_TOOLBAR_MARGIN)
        : maxX;
      if (!Number.isFinite(nextX)) nextX = maxX;
      nextX = Math.max(minX, Math.min(maxX, nextX));

      const minY = Math.max(6, Math.round(rootRect.top + STICKY_TOOLBAR_MARGIN));
      const maxY = Math.max(minY, Math.round(rootRect.bottom - toolbarHeight - STICKY_TOOLBAR_MARGIN));
      let nextY = minY;
      if (!Number.isFinite(nextY)) nextY = minY;
      nextY = Math.max(minY, Math.min(maxY, nextY));

      const nextVisible = rootVisible ? "visible" : "hidden";
      view.stickyToolbar.style.position = "fixed";
      if (view.stickyToolbarLastX !== nextX) {
        view.stickyToolbar.style.left = `${nextX}px`;
        view.stickyToolbarLastX = nextX;
      }
      if (view.stickyToolbarLastY !== nextY) {
        view.stickyToolbar.style.top = `${nextY}px`;
        view.stickyToolbarLastY = nextY;
      }
      if (view.stickyToolbarLastVisible !== nextVisible) {
        view.stickyToolbar.style.visibility = nextVisible;
        view.stickyToolbarLastVisible = nextVisible;
      }
    }

    function scheduleStickyToolbarPosition() {
      if (view.stickyToolbarFrameId) return;
      view.stickyToolbarFrameId = window.requestAnimationFrame(() => {
        view.stickyToolbarFrameId = 0;
        if (root.__flowView !== view) return;
        positionStickyToolbar();
      });
    }

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

    function invalidateCanvasRect() {
      view.canvasRect = null;
    }

    function getCanvasRect() {
      if (view.canvasRect) return view.canvasRect;
      view.canvasRect = canvas.getBoundingClientRect();
      return view.canvasRect;
    }

    function flushDraw() {
      if (root.__flowView !== view) return;
      drawFlowCanvas(view);
      syncStickyInlineEditor();
      invalidateCanvasRect();
      if (view.hasRunningAnimation) scheduleAnimation();
      else stopAnimation();
    }

    function requestDraw() {
      if (view.drawFrameId) return;
      view.drawFrameId = window.requestAnimationFrame(() => {
        view.drawFrameId = null;
        flushDraw();
      });
    }

    view.requestDraw = requestDraw;

    function getRuntime() {
      return root.__flowRuntime || null;
    }

    function notifySelectionGesture(kind) {
      const value = String(kind || "").trim();
      if (!value) return;
      window.dispatchEvent(new CustomEvent("ziz:flow-selection-gesture", {
        detail: { kind: value }
      }));
    }

    function getNormalizedSelectedNodeIds(state, options = {}) {
      if (!state || typeof state !== "object") return [];
      const allowEmpty = options.allowEmpty !== false;
      if (typeof getSelectedNodeIds === "function") {
        return getSelectedNodeIds(state, { allowEmpty });
      }
      const nodeIdSet = new Set((Array.isArray(state.nodes) ? state.nodes : []).map((node) => String(node?.id || "")));
      const selected = Array.isArray(state.selectedNodeIds)
        ? state.selectedNodeIds.map((nodeId) => String(nodeId || "").trim()).filter(Boolean)
        : (state.selectedNodeId ? [String(state.selectedNodeId)] : []);
      const deduped = [];
      const seen = new Set();
      selected.forEach((nodeId) => {
        if (!nodeId || seen.has(nodeId) || !nodeIdSet.has(nodeId)) return;
        seen.add(nodeId);
        deduped.push(nodeId);
      });
      if (!allowEmpty && !deduped.length && Array.isArray(state.nodes) && state.nodes.length) {
        const fallbackId = String(state.nodes[0]?.id || "");
        if (fallbackId) deduped.push(fallbackId);
      }
      state.selectedNodeIds = deduped;
      state.selectedNodeId = deduped[0] || null;
      return deduped;
    }

    function applySelectedNodeIds(state, nodeIds, options = {}) {
      if (!state || typeof state !== "object") return [];
      const allowEmpty = options.allowEmpty !== false;
      if (typeof setSelectedNodes === "function") {
        setSelectedNodes(state, nodeIds, { allowEmpty });
        return getNormalizedSelectedNodeIds(state, { allowEmpty });
      }
      const deduped = Array.from(new Set((Array.isArray(nodeIds) ? nodeIds : []).map((nodeId) => String(nodeId || "").trim()).filter(Boolean)));
      state.selectedNodeIds = deduped;
      state.selectedNodeId = deduped[0] || null;
      return getNormalizedSelectedNodeIds(state, { allowEmpty });
    }

    function getSelectedDraggableNodeIds(state) {
      return getNormalizedSelectedNodeIds(state)
        .map((nodeId) => state.nodes.find((node) => node.id === nodeId))
        .filter((node) => !!node && isDraggableNode(node))
        .map((node) => node.id);
    }

    function getCopiedNodeIds() {
      return Array.isArray(copiedNodeSnapshot?.nodeIds)
        ? copiedNodeSnapshot.nodeIds.map((nodeId) => String(nodeId || "").trim()).filter(Boolean)
        : [];
    }

    function setCopiedNodeIds(state, nodeIds) {
      const sourceIds = Array.isArray(nodeIds) ? nodeIds : [];
      const deduped = [];
      const seen = new Set();
      sourceIds.forEach((nodeId) => {
        const normalized = String(nodeId || "").trim();
        if (!normalized || seen.has(normalized)) return;
        const node = state?.nodes?.find?.((item) => item?.id === normalized);
        if (!node || !isDraggableNode(node)) return;
        seen.add(normalized);
        deduped.push(normalized);
      });
      copiedNodeSnapshot = deduped.length ? { nodeIds: deduped } : null;
      return deduped;
    }

    function pasteCopiedNodes(runtime, options = {}) {
      const copiedIds = getCopiedNodeIds();
      if (!copiedIds.length) return [];
      const requestedAnchorId = String(options.anchorId || "").trim();
      const anchorId = requestedAnchorId && !copiedIds.includes(requestedAnchorId)
        ? requestedAnchorId
        : null;
      return duplicateNodesByIds?.(runtime.state, copiedIds, {
        offsetX: 64,
        offsetY: 64,
        anchorId
      }) || [];
    }

    function getNodeById(state, nodeId) {
      return (Array.isArray(state?.nodes) ? state.nodes : []).find((node) => String(node?.id || "") === String(nodeId || "")) || null;
    }

    function getNodeRectById(model, nodeId) {
      const target = model?.nodeMap?.get?.(String(nodeId || ""));
      if (!target) return null;
      return {
        x: Number(target.x) || 0,
        y: Number(target.y) || 0,
        w: NODE_W,
        h: NODE_H
      };
    }

    function collectNodeIdsInRect(model, rect, state) {
      const x1 = Math.min(rect.startX, rect.endX);
      const y1 = Math.min(rect.startY, rect.endY);
      const x2 = Math.max(rect.startX, rect.endX);
      const y2 = Math.max(rect.startY, rect.endY);
      if ((x2 - x1) < 2 || (y2 - y1) < 2) return [];
      return (Array.isArray(model?.taskViews) ? model.taskViews : [])
        .filter((viewNode) => {
          const node = getNodeById(state, viewNode.id);
          return !!node && isDraggableNode(node);
        })
        .filter((viewNode) => {
          const nx1 = viewNode.x;
          const ny1 = viewNode.y;
          const nx2 = viewNode.x + NODE_W;
          const ny2 = viewNode.y + NODE_H;
          return !(nx2 < x1 || nx1 > x2 || ny2 < y1 || ny1 > y2);
        })
        .map((viewNode) => viewNode.id);
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
      scheduleStickyToolbarPosition();
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

    function triggerPaneShortcut(action) {
      const normalized = String(action || "").trim();
      if (!normalized) return;
      const embedded = new URLSearchParams(window.location.search).get("embedded") === "1";
      if (embedded && window.parent && window.parent !== window) {
        window.parent.postMessage({
          source: "ziz-embedded",
          type: "shortcut",
          detail: { action: normalized }
        }, window.location.origin);
        return;
      }
      const api = window.zizEmbeddedApi || null;
      if (!api) return;
      if (normalized === "undo") {
        void api.undo?.();
        return;
      }
      if (normalized === "redo") {
        void api.redo?.();
        return;
      }
      if (normalized === "run") {
        void api.runFlow?.();
      }
    }

    stickyToolbar.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-role]");
      if (!button) return;
      const role = String(button.getAttribute("data-role") || "");
      if (role === "pane-undo") {
        triggerPaneShortcut("undo");
        return;
      }
      if (role === "pane-redo") {
        triggerPaneShortcut("redo");
        return;
      }
      if (role === "pane-run") {
        triggerPaneShortcut("run");
        return;
      }
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
    if (typeof window.ResizeObserver === "function") {
      const resizeObserver = new window.ResizeObserver(() => {
        scheduleStickyToolbarPosition();
      });
      try { resizeObserver.observe(root); } catch (_) {}
      try {
        const rightSidebar = document.getElementById("rightSidebar");
        if (rightSidebar) resizeObserver.observe(rightSidebar);
      } catch (_) {}
      view.stickyToolbarResizeObserver = resizeObserver;
    }
    syncStickyToolbar();

    function hideTooltip() {
      tooltipEl.style.opacity = "0";
      tooltipEl.style.left = "-9999px";
      tooltipEl.style.top = "-9999px";
      tooltipEl.textContent = "";
    }

    function hideContextMenu() {
      view.menuNodeId = null;
      view.menuEdge = null;
      view.menuSelectionIds = null;
      menuEl.classList.remove("is-open");
      menuEl.style.left = "-9999px";
      menuEl.style.top = "-9999px";
      menuEl.setAttribute("aria-hidden", "true");
    }

    function showContextMenu(target, clientX, clientY, options = {}) {
      view.menuNodeId = target?.nodeId || null;
      view.menuEdge = options.edge || null;
      view.menuSelectionIds = Array.isArray(options.selectionIds) ? options.selectionIds.slice() : null;
      const runtime = root.__flowRuntime;
      const items = [];
      const hasCopiedNodes = getCopiedNodeIds().length > 0;
      if (runtime && view.menuEdge && view.menuEdge.from && view.menuEdge.to) {
        items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="delete-edge" role="menuitem">フローリレーションを削除</button>');
      }
      if (runtime && Array.isArray(view.menuSelectionIds) && view.menuSelectionIds.length > 1) {
        items.push('<button class="flow-context-menu__item" type="button" data-action="copy-selected" role="menuitem">コピー</button>');
        if (hasCopiedNodes) {
          items.push('<button class="flow-context-menu__item" type="button" data-action="paste" role="menuitem">貼り付け</button>');
        }
        items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="delete-selected" role="menuitem">削除</button>');
      } else {
        view.menuSelectionIds = null;
      }
      if (!items.length) {
        if (runtime && view.menuNodeId) {
          const targetNode = runtime.state.nodes.find((item) => item.id === view.menuNodeId) || null;
          const loopRootSelected = isLoopRootNode(targetNode);
          const loopInternalSelected = !!targetNode?.loopOwnerId;
          if (loopInternalSelected) {
            items.push('<button class="flow-context-menu__item" type="button" data-action="add-loop-inner" role="menuitem">ループ内に追加</button>');
          } else if (loopRootSelected) {
            items.push('<button class="flow-context-menu__item" type="button" data-action="add-loop-inner" role="menuitem">ループ内に追加</button>');
            items.push('<button class="flow-context-menu__item" type="button" data-action="add-after-loop" role="menuitem">ループの後に追加</button>');
          } else {
            items.push('<button class="flow-context-menu__item" type="button" data-action="add-after" role="menuitem">後に追加</button>');
            items.push('<button class="flow-context-menu__item" type="button" data-action="add-loop" role="menuitem">後にループ追加</button>');
          }
          items.push('<button class="flow-context-menu__item" type="button" data-action="copy-node" role="menuitem">コピー</button>');
          if (hasCopiedNodes) {
            items.push('<button class="flow-context-menu__item" type="button" data-action="paste" role="menuitem">貼り付け</button>');
          }
          const mergeMenuState = getNodeMergeMenuState(runtime.state, view.menuNodeId);
          if (mergeMenuState.incomingSources.length) {
            items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="remove-merge-incoming" role="menuitem">合流を解除</button>');
          }
          if (mergeMenuState.outgoingTargets.length) {
            items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="remove-merge-outgoing" role="menuitem">合流を解除</button>');
          }
        } else if (runtime) {
          items.push('<button class="flow-context-menu__item" type="button" data-action="add-root" role="menuitem">ノードを追加</button>');
          items.push('<button class="flow-context-menu__item" type="button" data-action="add-root-loop" role="menuitem">ループノードを追加</button>');
          if (hasCopiedNodes) {
            items.push('<button class="flow-context-menu__item" type="button" data-action="paste" role="menuitem">貼り付け</button>');
          }
        }
        if (runtime && view.menuNodeId) {
          items.push('<button class="flow-context-menu__item" type="button" data-action="run" role="menuitem">実行</button>');
          items.push('<button class="flow-context-menu__item is-danger" type="button" data-action="delete" role="menuitem">削除</button>');
        }
      }
      if (!items.length) return;
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
      if (view.dragState || pendingDrag || isPanning || view.stickyNoteDragState || view.pendingRangeSelection || view.mergeDragState || view.pendingMergeDrag) return;
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = getCanvasRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (view.stickyNoteMode) {
        const hitNote = hitStickyNote(runtime.model, x, y, { handleSize: STICKY_NOTE_HANDLE_SIZE });
        const nextCursor = hitNote?.onResizeHandle ? "nwse-resize" : hitNote?.note ? "move" : "default";
        const currentCursor = canvas.style.cursor || "default";
        const cursorChanged = currentCursor !== nextCursor;
        hideTooltip();
        if (cursorChanged) canvas.style.cursor = nextCursor;
        return;
      }
      const hoverNode = hitSelectableNode(runtime.model, x, y);
      const nextCursor = hoverNode ? "pointer" : "default";
      const currentCursor = canvas.style.cursor || "default";
      const cursorChanged = currentCursor !== nextCursor;
      if (!cursorChanged) return;
      if (cursorChanged) canvas.style.cursor = nextCursor;
    });

    canvas.addEventListener("mouseleave", () => {
      if (view.dragState || pendingDrag || view.stickyNoteDragState) return;
      hideTooltip();
      canvas.style.cursor = "default";
    });

    root.addEventListener("wheel", (e) => {
      const horizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontalIntent) return;
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      root.scrollLeft += delta;
      invalidateCanvasRect();
      e.preventDefault();
    }, { passive: false });
    root.addEventListener("scroll", () => {
      invalidateCanvasRect();
      scheduleStickyToolbarPosition();
    }, { passive: true });

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
      const rect = getCanvasRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      const selectedIds = getNormalizedSelectedNodeIds(runtime.state);
      if (task) {
        e.preventDefault();
        hideTooltip();
        if (runtime.state.selectedNodeId !== task.id) {
          setSelectedNode(runtime.state, task.id);
          runtime.onStateChanged({ history: false });
        }
        showContextMenu({ nodeId: task.id }, e.clientX, e.clientY);
        return;
      }
      const edge = hitEdge(runtime.model, x, y, { threshold: 8 });
      if (edge) {
        e.preventDefault();
        hideTooltip();
        showContextMenu(null, e.clientX, e.clientY, { edge: { from: edge.from, to: edge.to, kind: edge.kind } });
        return;
      }
      if (selectedIds.length > 1) {
        e.preventDefault();
        hideTooltip();
        showContextMenu(null, e.clientX, e.clientY, { selectionIds: selectedIds });
        return;
      }
      if (getCopiedNodeIds().length) {
        e.preventDefault();
        hideTooltip();
        showContextMenu(null, e.clientX, e.clientY);
        return;
      }
      e.preventDefault();
      hideTooltip();
      showContextMenu(null, e.clientX, e.clientY);
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
      const rect = getCanvasRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      const stickyHit = view.stickyNoteMode
        ? hitStickyNote(runtime.model, x, y, { handleSize: STICKY_NOTE_HANDLE_SIZE })
        : null;
      if (e.button === 2) {
        if (view.stickyNoteMode) return;
        if (task && isMergeableNode(task.nodeRef)) {
          view.pendingMergeDrag = {
            sourceId: task.id,
            startClientX: e.clientX,
            startClientY: e.clientY,
            canvasX: x,
            canvasY: y,
            started: false
          };
        } else {
          view.pendingRangeSelection = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            startX: x,
            startY: y
          };
          view.rangeSelectionRect = null;
        }
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
        const selectedIds = getNormalizedSelectedNodeIds(runtime.state);
        const selectedIdSet = new Set(selectedIds);
        const dragNodeIds = selectedIdSet.has(task.id) && selectedIds.length > 1
          ? getSelectedDraggableNodeIds(runtime.state)
          : [task.id];
        const originById = {};
        dragNodeIds.forEach((nodeId) => {
          const rectInfo = getNodeRectById(runtime.model, nodeId);
          if (!rectInfo) return;
          originById[nodeId] = { x: rectInfo.x, y: rectInfo.y };
        });
        if (!Object.keys(originById).length) return;
        pendingDrag = {
          nodeId: task.id,
          nodeIds: dragNodeIds,
          originById,
          primaryOriginX: task.x,
          primaryOriginY: task.y,
          startClientX: e.clientX,
          startClientY: e.clientY,
          pointerOffsetX: x - task.x,
          pointerOffsetY: y - task.y
        };
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
      if (
        !view.stickyNoteMode &&
        !view.stickyNoteDragState &&
        !view.pendingRangeSelection &&
        !view.pendingMergeDrag &&
        !view.mergeDragState &&
        !pendingDrag &&
        !isPanning
      ) {
        const rect = getCanvasRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const stickyLinkHit = findStickyLinkHitAt(view, x, y);
        if (stickyLinkHit?.href) {
          canvas.style.cursor = "pointer";
        } else if (canvas.style.cursor === "pointer") {
          canvas.style.cursor = "default";
        }
      }
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
      if (view.pendingRangeSelection) {
        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const dx = e.clientX - view.pendingRangeSelection.startClientX;
        const dy = e.clientY - view.pendingRangeSelection.startClientY;
        const rect = getCanvasRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        if (!view.rangeSelectionRect && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (!view.rangeSelectionRect) {
          view.suppressContextMenuOnce = true;
        }
        view.rangeSelectionRect = view.rangeSelectionRect || {
          startX: view.pendingRangeSelection.startX,
          startY: view.pendingRangeSelection.startY,
          endX: x,
          endY: y
        };
        view.rangeSelectionRect.endX = x;
        view.rangeSelectionRect.endY = y;
        canvas.style.cursor = "crosshair";
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
          runtime.onStateChanged({ history: false });
        }
      }
      if (view.mergeDragState) {
        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = getCanvasRect();
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
        const rect = getCanvasRect();
        const pointerX = e.clientX - rect.left;
        const pointerY = e.clientY - rect.top;
        const rawNodeX = pointerX - pendingDrag.pointerOffsetX;
        const rawNodeY = pointerY - pendingDrag.pointerOffsetY;
        const snappedPrimaryX = clampCanvasCoordinate(snapToGrid(rawNodeX, START_X, GRID_SIZE));
        const snappedPrimaryY = clampCanvasCoordinate(snapToGrid(rawNodeY, START_Y, GRID_SIZE));
        const deltaX = snappedPrimaryX - (Number(pendingDrag.primaryOriginX) || 0);
        const deltaY = snappedPrimaryY - (Number(pendingDrag.primaryOriginY) || 0);
        const previewNodes = (Array.isArray(pendingDrag.nodeIds) ? pendingDrag.nodeIds : [pendingDrag.nodeId])
          .map((nodeId) => {
            const origin = pendingDrag.originById?.[nodeId];
            if (!origin) return null;
            return {
              nodeId,
              x: clampCanvasCoordinate(origin.x + deltaX),
              y: clampCanvasCoordinate(origin.y + deltaY)
            };
          })
          .filter(Boolean);
        if (!previewNodes.length) return;
        const primaryPreview = previewNodes.find((node) => node.nodeId === pendingDrag.nodeId) || previewNodes[0];

        view.dragState = {
          nodeId: pendingDrag.nodeId,
          nodeIds: previewNodes.map((node) => node.nodeId),
          started: true,
          canvasX: primaryPreview.x + NODE_W / 2,
          canvasY: primaryPreview.y + NODE_H / 2,
          snappedX: primaryPreview.x,
          snappedY: primaryPreview.y,
          previewNodes
        };
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
      invalidateCanvasRect();
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
      if (view.pendingRangeSelection) {
        const runtime = root.__flowRuntime;
        const selectionRect = view.rangeSelectionRect;
        view.pendingRangeSelection = null;
        view.rangeSelectionRect = null;
        canvas.style.cursor = "default";
        if (runtime && selectionRect) {
          const selectedIds = collectNodeIdsInRect(runtime.model, selectionRect, runtime.state);
          if (selectedIds.length) {
            applySelectedNodeIds(runtime.state, selectedIds);
            notifySelectionGesture(selectedIds.length > 1 ? "multi" : "single");
            runtime.onStateChanged({ history: false });
            return;
          }
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
        const dropPosition = {
          x: view.mergeDragState.canvasX,
          y: view.mergeDragState.canvasY
        };
        view.mergeDragState = null;
        canvas.style.cursor = "default";
        document.body.style.userSelect = "";
        if (runtime) {
          let changed = false;
          if (sourceId && targetNodeId) {
            if (hasDirectedEdge?.(runtime.state, sourceId, targetNodeId)) {
              const targetNode = getNodeById(runtime.state, targetNodeId);
              const isPrimaryEdge = !!targetNode && (targetNode.parentId ?? null) === sourceId;
              if (isPrimaryEdge) {
                const created = createNodeAtAnchor?.(runtime.state, sourceId, { rightId: targetNodeId, position: dropPosition });
                changed = !!created;
              } else {
                removeDirectedEdge?.(runtime.state, sourceId, targetNodeId);
                let created = null;
                if (hasSuccessorNode?.(runtime.state, sourceId)) {
                  created = createParallelNodeAtAnchor?.(runtime.state, sourceId, { position: dropPosition })
                    || createNodeAtAnchor?.(runtime.state, sourceId, { position: dropPosition });
                } else {
                  created = createNodeAtAnchor?.(runtime.state, sourceId, { position: dropPosition });
                }
                if (created?.id) {
                  const result = addMergeParent(runtime.state, created.id, targetNodeId);
                  if (!result?.ok) {
                    addMergeParent(runtime.state, sourceId, targetNodeId);
                    if (dialogApi?.show) dialogApi.show(getMergeErrorMessage(result), { kind: "warning", title: "合流" });
                    else alert(getMergeErrorMessage(result));
                  } else {
                    changed = true;
                  }
                }
              }
            } else {
              const result = addMergeParent(runtime.state, sourceId, targetNodeId);
              if (!result?.ok) {
                if (dialogApi?.show) dialogApi.show(getMergeErrorMessage(result), { kind: "warning", title: "合流" });
                else alert(getMergeErrorMessage(result));
              } else {
                changed = true;
              }
            }
          } else if (sourceId) {
            const shouldCreateParallel = !!hasSuccessorNode?.(runtime.state, sourceId);
            let created = null;
            if (shouldCreateParallel) {
              created = createParallelNodeAtAnchor?.(runtime.state, sourceId, { position: dropPosition })
                || createNodeAtAnchor?.(runtime.state, sourceId, { position: dropPosition });
            } else {
              created = createNodeAtAnchor?.(runtime.state, sourceId, { position: dropPosition });
            }
            changed = !!created;
          }
          clearPendingMergeSource(runtime.state);
          if (changed) {
            runtime.onStateChanged();
          } else {
            runtime.onStateChanged({ history: false });
          }
        } else {
          requestDraw();
        }
        return;
      }
      if (pendingDrag) {
        const runtime = root.__flowRuntime;
        const activeDragState = view.dragState;
        const didDrag = !!activeDragState;

        pendingDrag = null;
        document.body.style.userSelect = "";
        hideTooltip();
        canvas.style.cursor = "default";
        view.dragState = null;

        if (didDrag) {
          lastPanAt = Date.now();
          if (runtime) {
            const previewNodes = Array.isArray(activeDragState?.previewNodes) ? activeDragState.previewNodes : [];
            let applied = false;
            previewNodes.forEach((preview) => {
              const targetNode = runtime.state.nodes.find((node) => node.id === preview.nodeId);
              if (!targetNode) return;
              targetNode.canvasPosition = {
                x: clampCanvasCoordinate(preview.x),
                y: clampCanvasCoordinate(preview.y)
              };
              targetNode.canvasGridPosition = {
                x: toGridCoordinate(targetNode.canvasPosition.x, START_X, GRID_SIZE),
                y: toGridCoordinate(targetNode.canvasPosition.y, START_Y, GRID_SIZE)
              };
              applied = true;
            });
            if (applied) {
              const nodeIds = Array.isArray(activeDragState?.nodeIds) ? activeDragState.nodeIds : [activeDragState?.nodeId].filter(Boolean);
              applySelectedNodeIds(runtime.state, nodeIds);
              runtime.onStateChanged();
              return;
            }
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
      const menuEdge = view.menuEdge ? { ...view.menuEdge } : null;
      const selectionIds = Array.isArray(view.menuSelectionIds) ? view.menuSelectionIds.slice() : [];
      hideContextMenu();
      if (!runtime) return;
      if (btn.dataset.action === "copy-node") {
        setCopiedNodeIds(runtime.state, nodeId ? [nodeId] : []);
        return;
      }
      if (btn.dataset.action === "copy-selected") {
        setCopiedNodeIds(runtime.state, selectionIds);
        return;
      }
      if (btn.dataset.action === "paste") {
        const anchorId = nodeId || (selectionIds.length === 1 ? selectionIds[0] : null);
        const duplicatedIds = pasteCopiedNodes(runtime, { anchorId });
        if (duplicatedIds.length) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "add-root") {
        const created = createNodeAtAnchor?.(runtime.state, null);
        if (created) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "add-root-loop") {
        const created = createLoopNodeAtAnchor?.(runtime.state, null);
        if (created) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "delete-edge") {
        const result = (menuEdge?.from && menuEdge?.to)
          ? removeDirectedEdge?.(runtime.state, menuEdge.from, menuEdge.to)
          : null;
        const changed = !!(result && (result.removedPrimary || result.removedMerge));
        if (changed) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "delete-selected") {
        const changed = removeNodesByIds?.(runtime.state, selectionIds);
        if (changed) runtime.onStateChanged();
        return;
      }
      if (!nodeId) return;
      if (btn.dataset.action === "add-after") {
        const created = createNodeAtAnchor?.(runtime.state, nodeId);
        if (created) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "add-loop") {
        const created = createLoopNodeAtAnchor?.(runtime.state, nodeId);
        if (created) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "add-loop-inner") {
        const targetNode = runtime.state.nodes.find((item) => item.id === nodeId) || null;
        const loopRootId = isLoopRootNode(targetNode) ? String(nodeId || "") : String(targetNode?.loopOwnerId || "");
        if (!loopRootId) return;
        const created = insertLoopInternalAtAnchor?.(runtime.state, loopRootId, nodeId);
        if (created) runtime.onStateChanged();
        return;
      }
      if (btn.dataset.action === "add-after-loop") {
        const created = insertAfterLoopEnd?.(runtime.state, nodeId, null);
        if (created) runtime.onStateChanged();
        return;
      }
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
      const rect = getCanvasRect();
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

      const stickyLinkHit = findStickyLinkHitAt(view, x, y);
      if (stickyLinkHit?.href) {
        openStickyLinkInExternalBrowser(stickyLinkHit.href);
        return;
      }

      const targetNode = hitSelectableNode(runtime.model, x, y);
      if (targetNode) {
        applySelectedNodeIds(runtime.state, [targetNode.id]);
        notifySelectionGesture("single");
        runtime.onStateChanged({ history: false });
        return;
      }
      applySelectedNodeIds(runtime.state, [], { allowEmpty: true });
      notifySelectionGesture("clear");
      runtime.onStateChanged({ history: false });
    });

    canvas.addEventListener("dblclick", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime || !view.stickyNoteMode) return;
      const rect = getCanvasRect();
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
      if (!view.stickyNoteMode && !isEditingShortcutTarget(e.target) && (e.key === "Delete" || e.key === "Backspace")) {
        const selectedIds = getSelectedDraggableNodeIds(runtime.state);
        if (selectedIds.length > 1) {
          const changed = removeNodesByIds?.(runtime.state, selectedIds);
          if (changed) {
            e.preventDefault();
            runtime.onStateChanged();
          }
        }
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditingShortcutTarget(e.target)) return;

      const key = String(e.key || "").toLowerCase();
      if (view.stickyNoteMode) return;
      if (key === "c") {
        const selectedNodeIds = getSelectedDraggableNodeIds(runtime.state);
        const copiedIds = setCopiedNodeIds(runtime.state, selectedNodeIds);
        if (copiedIds.length) e.preventDefault();
        return;
      }
      if (key === "v") {
        const copiedIds = getCopiedNodeIds();
        if (!copiedIds.length) return;
        const pasteTargetIds = getSelectedDraggableNodeIds(runtime.state);
        const pasteAnchorId = (pasteTargetIds.length === 1 && !copiedIds.includes(pasteTargetIds[0]))
          ? pasteTargetIds[0]
          : null;
        const duplicatedIds = pasteCopiedNodes(runtime, { anchorId: pasteAnchorId });
        if (duplicatedIds.length) {
          e.preventDefault();
          runtime.onStateChanged();
        }
      }
    });

    window.addEventListener("resize", () => {
      invalidateCanvasRect();
      hideContextMenu();
      scheduleStickyToolbarPosition();
      requestDraw();
    });

    window.addEventListener("scroll", () => {
      scheduleStickyToolbarPosition();
    }, { passive: true, capture: true });

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
