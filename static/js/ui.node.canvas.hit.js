(function () {
  const packages = window.zizPackages = window.zizPackages || {};
  const uiPkg = packages.ui = packages.ui || {};
  const nodeCanvasParts = uiPkg.nodeCanvasParts = uiPkg.nodeCanvasParts || window.uiNodeCanvasParts || {};
  window.uiNodeCanvasParts = nodeCanvasParts;
  const constants = nodeCanvasParts.constants || {};
  const { NODE_W, NODE_H, BTN_HIT_SLOP, BTN_HIT_BIAS_Y } = constants;

  function hitTask(model, x, y) {
    for (let i = model.taskViews.length - 1; i >= 0; i--) {
      const n = model.taskViews[i];
      if (x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H) return n;
    }
    return null;
  }

  function hitSelectableNode(model, x, y) {
    const task = hitTask(model, x, y);
    if (task) return task;
    const start = model.start;
    if (start && x >= start.x && x <= start.x + NODE_W && y >= start.y && y <= start.y + NODE_H) return start;
    return null;
  }

  function hitStickyNote(model, x, y, options = {}) {
    const notes = Array.isArray(model?.stickyNotes) ? model.stickyNotes : [];
    const handleSize = Math.max(8, Number(options.handleSize) || 14);
    for (let i = notes.length - 1; i >= 0; i -= 1) {
      const note = notes[i];
      if (!note) continue;
      const withinX = x >= note.x && x <= note.x + note.w;
      const withinY = y >= note.y && y <= note.y + note.h;
      if (!withinX || !withinY) continue;
      const onResizeHandle = x >= (note.x + note.w - handleSize) && y >= (note.y + note.h - handleSize);
      return { note, onResizeHandle };
    }
    return null;
  }

  function hasSiblingControlPair(model, control) {
    return model.controls.some((candidate) =>
      candidate !== control &&
      candidate.anchorId === control.anchorId &&
      candidate.rightId === control.rightId &&
      candidate.mode === control.mode &&
      candidate.loopRootId === control.loopRootId &&
      candidate.kind !== control.kind
    );
  }

  function hitControl(model, x, y, options = {}) {
    const expanded = !!options.expanded;
    for (let i = model.controls.length - 1; i >= 0; i--) {
      const c = model.controls[i];
      const hasPair = hasSiblingControlPair(model, c);
      const hitCenterY = hasPair
        ? c.y + (c.kind === "insert" ? -BTN_HIT_BIAS_Y : BTN_HIT_BIAS_Y)
        : c.y;
      if (expanded) {
        const halfW = c.r + BTN_HIT_SLOP;
        const halfH = c.r + BTN_HIT_SLOP;
        const insideX = x >= c.x - halfW && x <= c.x + halfW;
        const insideY = y >= hitCenterY - halfH && y <= hitCenterY + halfH;
        if (insideX && insideY) return c;
        continue;
      }
      if (Math.hypot(x - c.x, y - c.y) <= c.r + 2) return c;
    }
    return null;
  }

  function getControlTooltip(ctrl, dragState) {
    if (!ctrl) return "";
    if (dragState?.started) {
      if (ctrl.kind === "insert") return "挿入する";
      if (ctrl.kind === "parallel") return "並行フローを挿入する";
    }
    if (ctrl.label === "I" || ctrl.kind === "insert") return "ステップを挿入";
    if (ctrl.label === "P" || ctrl.kind === "parallel") return "ステップを並列で挿入";
    return "";
  }

  function createImmediateTooltip() {
    const rootStyles = getComputedStyle(document.documentElement);
    const tip = document.createElement("div");
    tip.style.position = "fixed";
    tip.style.left = "-9999px";
    tip.style.top = "-9999px";
    tip.style.pointerEvents = "none";
    tip.style.zIndex = "9999";
    tip.style.padding = "4px 8px";
    tip.style.borderRadius = "6px";
    tip.style.background = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    tip.style.color = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    tip.style.font = "12px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    tip.style.whiteSpace = "nowrap";
    tip.style.opacity = "0";
    tip.style.transition = "opacity 80ms linear";
    document.body.appendChild(tip);
    return tip;
  }

  nodeCanvasParts.hitTask = hitTask;
  nodeCanvasParts.hitSelectableNode = hitSelectableNode;
  nodeCanvasParts.hitStickyNote = hitStickyNote;
  nodeCanvasParts.hitControl = hitControl;
  nodeCanvasParts.getControlTooltip = getControlTooltip;
  nodeCanvasParts.createImmediateTooltip = createImmediateTooltip;
})();
