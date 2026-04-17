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
    canDropDraggedNodeOnControl,
    applyDraggedNodeDrop,
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
    hitControl,
    getControlTooltip,
    createImmediateTooltip
  } = parts;
  const { NODE_W, NODE_H } = parts.constants || {};

  let copiedNodeSnapshot = null;

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
      requestDraw: null
    };
    root.__flowView = view;

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
      if (view.hasRunningAnimation) scheduleAnimation();
      else stopAnimation();
    }

    view.requestDraw = requestDraw;

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
      if (view.dragState || pendingDrag || isPanning) return;
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      view.hoverControl = hitControl(runtime.model, x, y);
      view.dropControl = null;
      showTooltip(view.hoverControl, e.clientX, e.clientY);
      const hoverNode = hitSelectableNode(runtime.model, x, y);
      canvas.style.cursor = view.hoverControl || hoverNode ? "pointer" : "default";
      requestDraw();
    });

    canvas.addEventListener("mouseleave", () => {
      if (view.dragState || pendingDrag) return;
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
      hideContextMenu();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      if (e.button === 2) {
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
      if (task && isDraggableNode(task.nodeRef)) {
        pendingDrag = { nodeId: task.id, startClientX: e.clientX, startClientY: e.clientY };
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
        if (!view.dragState && Math.hypot(moveDx, moveDy) < 5) return;

        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hoveredControl = hitControl(runtime.model, x, y, { expanded: true });
        const dropControl = canDropDraggedNodeOnControl(runtime.state, pendingDrag.nodeId, hoveredControl)
          ? hoveredControl
          : null;

        view.dragState = {
          nodeId: pendingDrag.nodeId,
          started: true,
          canvasX: x,
          canvasY: y
        };
        view.hoverControl = dropControl;
        view.dropControl = dropControl;
        canvas.style.cursor = dropControl ? "copy" : "grabbing";
        if (dropControl) showTooltip(dropControl, e.clientX, e.clientY);
        else hideTooltip();
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
        const dropControl = view.dropControl;
        const didDrag = !!view.dragState;

        pendingDrag = null;
        document.body.style.userSelect = "";
        hideTooltip();
        canvas.style.cursor = "default";
        view.dragState = null;
        view.hoverControl = null;
        view.dropControl = null;

        if (didDrag) {
          lastPanAt = Date.now();
          const moved = runtime ? applyDraggedNodeDrop(runtime.state, draggingNodeId, dropControl) : false;
          if (moved && runtime) {
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

    window.addEventListener("pointerdown", (e) => {
      if (!menuEl.classList.contains("is-open")) return;
      if (menuEl.contains(e.target)) return;
      hideContextMenu();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideContextMenu();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (isEditingShortcutTarget(e.target)) return;

      const key = String(e.key || "").toLowerCase();
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
