(function () {
  const { el } = window.utils;
  const { addNodeAfter, addParallelAfter, insertNodeAt, removeNode, setSelectedNode } = window.stateOps;
  const { renderField } = window.uiFields;

  const NODE_W = 90;
  const NODE_H = 80;
  const LEVEL_MARGIN = 130;
  const MIN_SIBLING_GAP = 14;
  const START_X = 44;
  const START_Y = 40;
  const BTN_X_OFFSET = 12;
  const BTN_GAP = 20;
  const BTN_R = 8;
  const EDGE_CURVE = 42;

  function jpLabel(x) {
    return (x && (x.label_jp || x.label)) || (x && x.id) || "";
  }

  function normalizeSteps(state) {
    state.nodes.forEach((node, i) => {
      node.stepName = `step${i + 1}`;
    });

    if (!state.selectedNodeId && state.nodes.length) {
      state.selectedNodeId = state.nodes[0].id;
    }
  }

  function getUpstreamSteps(state, idx) {
    const out = [];
    for (let i = 0; i < idx; i++) out.push(state.nodes[i].stepName);
    return out;
  }

  function getFormSchema(config, connector, action) {
    return (config.forms && config.forms[`${connector}.${action}`]) || [];
  }

  function ensureNodeDefaults(config, node) {
    if (!node.connector) node.connector = config.connectors?.[0]?.id || "";
    if (!node.action) {
      const actions = config.actions?.[node.connector] || [];
      node.action = actions[0]?.id || "";
    }
    if (!node.form) node.form = {};
  }

  function getSelectedNodeIndex(state) {
    const idx = state.nodes.findIndex((n) => n.id === state.selectedNodeId);
    return idx >= 0 ? idx : 0;
  }

  function getActionLabel(config, connectorId, actionId) {
    const actions = config.actions?.[connectorId] || [];
    const action = actions.find((a) => a.id === actionId);
    return jpLabel(action || { id: actionId });
  }

  function renderConnectorSelect({ config, node, onStateChanged }) {
    const s = el("select", {
      onchange: (e) => {
        node.connector = e.target.value;
        const actions = (config.actions && config.actions[node.connector]) || [];
        node.action = actions[0]?.id || "";
        node.form = {};
        onStateChanged();
      }
    });

    const connectors = config.connectors || [];
    for (const c of connectors) {
      const opt = el("option", { value: c.id }, [document.createTextNode(jpLabel(c))]);
      if (c.id === node.connector) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }

  function renderActionSelect({ config, node, onStateChanged }) {
    const s = el("select", {
      onchange: (e) => {
        node.action = e.target.value;
        node.form = {};
        onStateChanged();
      }
    });

    const actions = (config.actions && config.actions[node.connector]) || [];
    for (const a of actions) {
      const opt = el("option", { value: a.id }, [document.createTextNode(jpLabel(a))]);
      if (a.id === node.action) opt.selected = true;
      s.appendChild(opt);
    }
    return s;
  }

  function createPseudoNode(id, text, kind) {
    return {
      id,
      text,
      kind,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: []
    };
  }

  function createTaskView(node, config) {
    const connectorLabel = jpLabel(config.connectors.find((c) => c.id === node.connector) || { id: node.connector });
    const actionLabel = getActionLabel(config, node.connector, node.action);
    const subtitle = actionLabel;
    return {
      id: node.id,
      kind: "task",
      nodeRef: node,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: [],
      title: connectorLabel,
      subtitle
    };
  }

  function buildFlowModel(state, config) {
    const start = createPseudoNode("__start__", "START", "start");
    const end = createPseudoNode("__end__", "END", "end");
    const rawById = new Map();
    state.nodes.forEach((node) => {
      ensureNodeDefaults(config, node);
      rawById.set(node.id, node);
    });

    const normalizedNodes = state.nodes.map((node, idx) => {
      let parentId = node.parentId || null;
      if (parentId && !rawById.has(parentId)) parentId = null;

      const parallelOrder = Number(node.parallelOrder) || idx + 1;
      return { ...node, parentId, parallelOrder };
    });

    const childrenByParent = new Map();
    function pushChild(parentId, node) {
      const key = parentId || start.id;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(node);
    }
    normalizedNodes.forEach((node) => pushChild(node.parentId, node));
    childrenByParent.forEach((arr) => {
      arr.sort((a, b) => {
        const ao = Number(a.parallelOrder) || 1;
        const bo = Number(b.parallelOrder) || 1;
        if (ao !== bo) return ao - bo;
        return 0;
      });
    });

    const viewById = new Map();
    normalizedNodes.forEach((node) => viewById.set(node.id, createTaskView(node, config)));

    start.x = START_X;
    start.y = START_Y;

    const depthById = new Map();
    const yById = new Map();

    function layoutChildren(parentId, parentDepth, startY) {
      const key = parentId || start.id;
      const children = childrenByParent.get(key) || [];
      let yCursor = startY;
      children.forEach((child, idx) => {
        const view = viewById.get(child.id);
        if (!view) return;

        const depth = parentDepth + 1;
        depthById.set(child.id, depth);
        yById.set(child.id, yCursor);
        view.x = START_X + LEVEL_MARGIN * depth;
        view.y = yCursor;
        view.children = [];

        // Next sibling goes one row down. Descendants are always further right.
        yCursor += NODE_H + MIN_SIBLING_GAP;

        // Child subtree starts from the same Y as the child itself.
        layoutChildren(child.id, depth, view.y);

        // Option 11=3: keep global stacking by using the furthest used Y so far.
        yCursor = Math.max(yCursor, getMaxBottom(childrenByParent, yById, child.id));

        // When parent has no right node, only I should be visible (handled in controls).
        if (idx === 0 && parentId === null) {
          start.children = [child.id];
        }
      });
    }

    function getMaxBottom(childrenMap, yMap, rootId) {
      let max = (yMap.get(rootId) || START_Y) + NODE_H + MIN_SIBLING_GAP;
      const queue = [rootId];
      while (queue.length) {
        const id = queue.shift();
        const y = yMap.get(id);
        if (y !== undefined) max = Math.max(max, y + NODE_H + MIN_SIBLING_GAP);
        const children = childrenMap.get(id) || [];
        children.forEach((n) => queue.push(n.id));
      }
      return max;
    }

    layoutChildren(null, 0, START_Y);

    const taskViews = normalizedNodes
      .map((node) => viewById.get(node.id))
      .filter(Boolean);

    const nodeMap = new Map([[start.id, start], ...taskViews.map((v) => [v.id, v]), [end.id, end]]);
    const edges = [];
    const edgeKeys = new Set();
    const pushEdge = (from, to, kind) => {
      if (!from || !to) return;
      const key = `${from}->${to}:${kind}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from, to, kind });
    };

    // Parent->child edges only (parentId based).
    normalizedNodes.forEach((node) => {
      const fromId = node.parentId || start.id;
      const siblings = childrenByParent.get(node.parentId || start.id) || [];
      const firstSibling = siblings[0];
      const edgeKind = firstSibling && firstSibling.id === node.id ? "tree" : "parallel";
      pushEdge(fromId, node.id, edgeKind);
    });

    // Leaves -> end
    const hasChildren = new Set();
    normalizedNodes.forEach((n) => hasChildren.add(n.parentId || start.id));
    const leaves = normalizedNodes.filter((n) => !hasChildren.has(n.id));
    leaves.forEach((leaf) => pushEdge(leaf.id, end.id, "to-end"));
    if (!leaves.length) pushEdge(start.id, end.id, "to-end");

    const maxDepth = Math.max(1, ...Array.from(depthById.values()));
    end.x = START_X + LEVEL_MARGIN * (maxDepth + 1);
    end.y = START_Y; // fixed to top

    const controls = [];
    function addControls(anchorId, anchorView) {
      const children = childrenByParent.get(anchorId || start.id) || [];
      const right = children.length ? children[0] : null;
      const centerY = anchorView.y + NODE_H / 2;
      const cx = anchorView.x + NODE_W + BTN_X_OFFSET;

      if (right) {
        controls.push({
          kind: "insert",
          anchorId: anchorId || start.id,
          rightId: right.id,
          x: cx,
          y: centerY - BTN_GAP / 2,
          r: BTN_R,
          label: "I"
        });
        controls.push({
          kind: "parallel",
          anchorId: anchorId || start.id,
          rightId: right.id,
          x: cx,
          y: centerY + BTN_GAP / 2,
          r: BTN_R,
          label: "P"
        });
      } else {
        controls.push({
          kind: "insert",
          anchorId: anchorId || start.id,
          rightId: null,
          x: cx,
          y: centerY,
          r: BTN_R,
          label: "I"
        });
      }
    }

    addControls(null, start);
    taskViews.forEach((view) => addControls(view.id, view));

    const maxTaskY = Math.max(START_Y, ...taskViews.map((n) => n.y), end.y);
    const width = Math.max(end.x + NODE_W + 36, START_X + NODE_W + LEVEL_MARGIN + 100);
    const height = Math.max(220, maxTaskY + NODE_H + 40);

    return { start, end, taskViews, nodeMap, edges, controls, width, height };
  }

  function wrapText(ctx, text, maxWidth) {
    const chars = String(text || "").split("");
    let line = "";
    let lines = [];
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        lines.push(line);
        line = chars[i];
      } else {
        line = testLine;
      }
    }
    lines.push(line);
    if (lines.length > 2) {
      lines = [lines[0], `${lines[1].slice(0, Math.max(0, lines[1].length - 1))}…`];
    }
    return lines;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function drawOneSideRoundedRect(ctx, x, y, w, h, side) {
    const r = Math.min(h / 2, w / 2);
    const cy = y + h / 2;

    ctx.beginPath();
    if (side === "left") {
      const cx = x + r;
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x + w, y + h);
    } else {
      const cx = x + w - r;
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
  }

  function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function normalizedSigmoid(t, k, center) {
    const s = (x) => 1 / (1 + Math.exp(-x));
    const min = s((0 - center) * k);
    const max = s((1 - center) * k);
    const cur = s((t - center) * k);
    const denom = max - min || 1;
    return (cur - min) / denom;
  }

  function drawEdge(ctx, from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const k = style.sigmoidK || 12;
    const center = style.sigmoidBias || 0.82; // right-biased bend
    const steps = Math.max(18, Math.min(64, Math.floor(Math.abs(tx - sx) / 8)));
    let prevX = sx;
    let prevY = sy;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = sx + (tx - sx) * t;
      const eased = normalizedSigmoid(t, k, center);
      const y = sy + (ty - sy) * eased;
      ctx.lineTo(x, y);
      if (i === steps - 1) {
        prevX = x;
        prevY = y;
      }
    }

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (style.arrow) {
      const angle = Math.atan2(ty - prevY, tx - prevX);
      drawArrowHead(ctx, tx, ty, angle, style.arrowSize || 6, style.color);
    }
  }

  function drawFlowCanvas(view) {
    const runtime = view.root.__flowRuntime;
    if (!runtime) return;

    const { model, state } = runtime;
    const { canvas, ctx } = view;
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = Math.max(1, Math.ceil(rawDpr));
    canvas.width = Math.floor(model.width * dpr);
    canvas.height = Math.floor(model.height * dpr);
    canvas.style.width = `${model.width}px`;
    canvas.style.height = `${model.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.clearRect(0, 0, model.width, model.height);

    model.edges.forEach((edge) => {
      const from = model.nodeMap.get(edge.from);
      const to = model.nodeMap.get(edge.to);
      if (!from || !to) return;
      drawEdge(ctx, from, to, {
        color:
          edge.kind === "to-end-main" ? "#6f7f94" :
          edge.kind === "to-end" ? "#8d99aa" :
          edge.kind === "parallel" ? "#90a3b8" : "#6f7f94",
        width:
          edge.kind === "to-end-main" ? 2 :
          edge.kind === "to-end" ? 1 :
          edge.kind === "parallel" ? 1 : 2,
        dash:
          edge.kind === "to-end-main" ? [] :
          edge.kind === "to-end" ? [4, 3] :
          edge.kind === "parallel" ? [3, 3] : [],
        mode: edge.kind === "parallel" ? "parallel_branch" : "horizontal",
        sigmoidBias: edge.kind === "parallel" ? 0.88 : 0.92,
        sigmoidK: edge.kind === "parallel" ? 10 : 12,
        arrow: true,
        arrowSize: edge.kind === "parallel" ? 5 : edge.kind === "to-end" ? 5 : 6
      });
    });

    const nodesToDraw = [model.start, ...model.taskViews, model.end];
    nodesToDraw.forEach((node) => {
      const isStart = node.kind === "start";
      const isEnd = node.kind === "end";
      const isTask = node.kind === "task";
      const isSelected = isTask && state.selectedNodeId === node.id;
      const isParallel = isTask && !!node.nodeRef.parallelOf;

      if (isParallel) ctx.setLineDash([4, 2]);
      else ctx.setLineDash([]);

      if (isStart) ctx.fillStyle = "#2f77c9";
      else if (isEnd) ctx.fillStyle = "#374151";
      else ctx.fillStyle = "#ffffff";

      ctx.strokeStyle = isSelected ? "#037a76" : "#cbd5e0";
      ctx.lineWidth = isSelected ? 2 : 1;
      if (isStart) {
        drawOneSideRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, "left");
      } else if (isEnd) {
        drawOneSideRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, "right");
      } else {
        drawRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, 8);
      }
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = isStart || isEnd ? "#ffffff" : "#2d3748";
      ctx.font = "700 15px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      if (isStart || isEnd) {
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, node.x + NODE_W / 2, node.y + NODE_H / 2);
        ctx.textBaseline = "alphabetic";
      } else {
        ctx.fillText(node.nodeRef.stepName, node.x + NODE_W / 2, node.y + 26);
      }

      if (isTask) {
        ctx.font = "14px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const titleLines = wrapText(ctx, node.title, NODE_W - 16);
        const subtitleLines = wrapText(ctx, node.subtitle, NODE_W - 16);
        const lines = [...titleLines, ...subtitleLines].slice(0, 2);
        lines.forEach((line, idx) => {
          ctx.fillText(line, node.x + NODE_W / 2, node.y + 56 + idx * 18);
        });
      }
    });

    model.controls.forEach((ctrl) => {
      const isHover = view.hoverControl === ctrl;
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = isHover ? "#037a76" : "#8ea1b5";
      ctx.lineWidth = isHover ? 2 : 1;
      ctx.beginPath();
      ctx.arc(ctrl.x, ctrl.y, ctrl.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isHover ? "#037a76" : "#41556b";
      ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ctrl.label, ctrl.x, ctrl.y + 3);
    });
  }

  function hitTask(model, x, y) {
    for (let i = model.taskViews.length - 1; i >= 0; i--) {
      const n = model.taskViews[i];
      if (x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H) return n;
    }
    return null;
  }

  function hitControl(model, x, y) {
    for (let i = model.controls.length - 1; i >= 0; i--) {
      const c = model.controls[i];
      if (Math.hypot(x - c.x, y - c.y) <= c.r + 2) return c;
    }
    return null;
  }

  function ensureFlowCanvas(root) {
    if (root.__flowView) return root.__flowView;

    root.innerHTML = "";
    const canvas = document.createElement("canvas");
    canvas.className = "flow-canvas";
    root.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const view = { root, canvas, ctx, hoverControl: null };
    root.__flowView = view;

    canvas.addEventListener("mousemove", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      view.hoverControl = hitControl(runtime.model, x, y);
      canvas.style.cursor = view.hoverControl || hitTask(runtime.model, x, y) ? "pointer" : "default";
      drawFlowCanvas(view);
    });

    canvas.addEventListener("mouseleave", () => {
      view.hoverControl = null;
      canvas.style.cursor = "default";
      drawFlowCanvas(view);
    });

    canvas.addEventListener("click", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const control = hitControl(runtime.model, x, y);
      if (control) {
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

      const task = hitTask(runtime.model, x, y);
      if (task) {
        setSelectedNode(runtime.state, task.id);
        runtime.onStateChanged();
      }
    });

    window.addEventListener("resize", () => drawFlowCanvas(view));

    return view;
  }

  function renderFlowChart({ root, state, config, onStateChanged }) {
    try {
      state.nodes.forEach((node) => ensureNodeDefaults(config, node));
      const model = buildFlowModel(state, config);
      const view = ensureFlowCanvas(root);
      root.__flowRuntime = { state, model, onStateChanged };
      drawFlowCanvas(view);
    } catch (err) {
      console.error("flowchart render failed", err);
      root.innerHTML = "";
      const msg = el("div", { class: "flow-fallback" }, [
        document.createTextNode("フローチャート描画に失敗しました。状態を確認してください。")
      ]);
      root.appendChild(msg);
    }
  }

  function renderNodeDetail({ state, config, root, onStateChanged }) {
    root.innerHTML = "";
    if (!state.nodes.length) return;

    const idx = getSelectedNodeIndex(state);
    const node = state.nodes[idx];
    ensureNodeDefaults(config, node);

    const upstreamSteps = getUpstreamSteps(state, idx);
    const schema = getFormSchema(config, node.connector, node.action);

    const headLeft = el("div", { class: "left" }, [
      el("div", { class: "badge" }, [document.createTextNode(`{${node.stepName}}`)]),
      el("div", {}, [
        el("div", { class: "head-selects" }, [
          el("div", { class: "head-select" }, [
            renderConnectorSelect({ config, node, onStateChanged })
          ]),
          el("div", { class: "head-select" }, [
            renderActionSelect({ config, node, onStateChanged })
          ])
        ])
      ])
    ]);

    const headActions = el("div", { class: "node-head-actions" }, [
      el(
        "button",
        {
          class: "danger",
          type: "button",
          onclick: () => {
            removeNode(state, idx);
            onStateChanged();
          }
        },
        [document.createTextNode("削除")]
      ),
      el(
        "button",
        {
          class: "success",
          type: "button",
          onclick: () => {
            addNodeAfter(state, idx);
            onStateChanged();
          }
        },
        [document.createTextNode("右に追加")]
      )
    ]);

    const head = el("div", { class: "node-head" }, [headLeft, headActions]);
    const body = el("div", { class: "node-body" }, []);

    if (!schema.length) {
      body.appendChild(
        el("div", { class: "small" }, [
          document.createTextNode("フォーム定義がありません（設定のキー不一致の可能性）")
        ])
      );
    } else {
      for (const field of schema) {
        body.appendChild(renderField({ node, field, upstreamSteps, onStateChanged }));
      }
    }

    const vars = el("div", { class: "variables" }, [
      ...upstreamSteps.map((v) => el("span", { class: "var-chip" }, [document.createTextNode(`\${${v}}`)]))
    ]);

    const foot = el("div", { class: "node-foot" }, [vars]);
    root.appendChild(el("section", { class: "node detail-node" }, [head, body, foot]));
  }

  window.uiNode = { normalizeSteps, renderFlowChart, renderNodeDetail };
})();
