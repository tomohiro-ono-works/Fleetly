(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  const NODE_WIDTH = 184;
  const NODE_HEIGHT = 76;
  const TERMINAL_WIDTH = 96;
  const TERMINAL_HEIGHT = 48;
  const DEFAULT_GAP_X = 252;
  const DEFAULT_GAP_Y = 180;

  function position(value, fallback) {
    return modules.normalizePosition(value, fallback);
  }

  function stepKey(stepId) {
    return `step:${String(stepId)}`;
  }

  function flowNodeKey(flowId, nodeId) {
    return `flow:${String(flowId)}:node:${nodeId}`;
  }

  function unassignedNodeKey(nodeId) {
    return `unassigned:node:${nodeId}`;
  }

  function createStepNode(step, index) {
    const stepId = String(step?.step_id || "").trim();
    if (!stepId) return null;
    const fallback = {
      x: 280 + (index % 4) * DEFAULT_GAP_X,
      y: 120 + Math.floor(index / 4) * DEFAULT_GAP_Y
    };
    return {
      key: stepKey(stepId),
      kind: "step",
      nodeType: String(step?.node_type || "task").trim() || "task",
      label: String(step?.label || stepId),
      ref: { node_id: stepId },
      step,
      x: position(step?.ui_position, fallback).x,
      y: position(step?.ui_position, fallback).y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      documentPath: ["steps", index, "ui_position"]
    };
  }

  function createTerminalNode(flowId, flow, nodeId, flowIndex) {
    const isStart = nodeId === "START";
    const fallback = {
      x: isStart ? 72 : 900,
      y: 96 + flowIndex * 360
    };
    const source = isStart ? flow?.start : flow?.end;
    const point = position(source?.ui_position, fallback);
    const field = isStart ? "start" : "end";
    return {
      key: flowNodeKey(flowId, nodeId),
      kind: isStart ? "start" : "end",
      nodeType: isStart ? "start" : "end",
      label: nodeId,
      ref: { node_id: nodeId, flow_id: flowId },
      x: point.x,
      y: point.y,
      width: TERMINAL_WIDTH,
      height: TERMINAL_HEIGHT,
      documentPath: ["flows", flowId, field, "ui_position"]
    };
  }

  function createEdge(ref, sourceKey, targetKey, edge, kind = "main") {
    return {
      key: modules.edgeRefKey(ref),
      ref,
      sourceKey,
      targetKey,
      order: Number.isFinite(Number(edge?.order)) ? Number(edge.order) : 0,
      kind
    };
  }

  function buildMainEdges(document, nodeByKey) {
    const edges = [];
    Object.entries(document?.flows || {}).forEach(([flowId, flow]) => {
      (Array.isArray(flow?.edges) ? flow.edges : []).forEach((edge) => {
        const from = String(edge?.from || "").trim();
        const to = String(edge?.to || "").trim();
        if (!from || !to) return;
        const sourceKey = from === "START" || from === "END"
          ? flowNodeKey(flowId, from)
          : stepKey(from);
        const targetKey = to === "START" || to === "END"
          ? flowNodeKey(flowId, to)
          : stepKey(to);
        if (!nodeByKey.has(sourceKey) || !nodeByKey.has(targetKey)) return;
        edges.push(createEdge(
          { flow_id: flowId, from, to },
          sourceKey,
          targetKey,
          edge
        ));
      });
    });
    return edges;
  }

  function buildLoopEdges(document, nodeByKey) {
    const edges = [];
    Object.entries(document?.loop?.flows || {}).forEach(([ownerId, graph]) => {
      const ownerKey = stepKey(ownerId);
      if (!nodeByKey.has(ownerKey)) return;
      (Array.isArray(graph?.edges) ? graph.edges : []).forEach((edge) => {
        const from = String(edge?.from || "").trim();
        const to = String(edge?.to || "").trim();
        if (!from || !to) return;
        const sourceKey = from === "START" || from === "END"
          ? ownerKey
          : stepKey(from);
        const targetKey = to === "START" || to === "END"
          ? ownerKey
          : stepKey(to);
        if (!nodeByKey.has(sourceKey) || !nodeByKey.has(targetKey)) return;
        edges.push(createEdge(
          { loop_owner_id: ownerId, from, to },
          sourceKey,
          targetKey,
          edge,
          to === "END" ? "loop-back" : "loop"
        ));
      });
    });
    return edges;
  }

  function buildUnassigned(document, nodes, nodeByKey) {
    const unassigned = document?.unassigned;
    if (!unassigned || typeof unassigned !== "object") return [];
    const fallback = { x: 72, y: 720 };
    const point = position(unassigned.start?.ui_position, fallback);
    const start = {
      key: unassignedNodeKey("START"),
      kind: "unassigned-start",
      nodeType: "start",
      label: "UNASSIGNED",
      ref: { node_id: "START", graph_scope: "unassigned" },
      x: point.x,
      y: point.y,
      width: 136,
      height: TERMINAL_HEIGHT,
      documentPath: ["unassigned", "start", "ui_position"]
    };
    nodes.push(start);
    nodeByKey.set(start.key, start);
    const edges = [];
    (Array.isArray(unassigned.edges) ? unassigned.edges : []).forEach((edge) => {
      const from = String(edge?.from || "").trim();
      const to = String(edge?.to || "").trim();
      if (!from || !to) return;
      const sourceKey = from === "START" ? start.key : stepKey(from);
      const targetKey = to === "START" ? start.key : stepKey(to);
      if (!nodeByKey.has(sourceKey) || !nodeByKey.has(targetKey)) return;
      edges.push(createEdge(
        { graph_scope: "unassigned", from, to },
        sourceKey,
        targetKey,
        edge,
        "unassigned"
      ));
    });
    return edges;
  }

  function buildLoopFrames(document, nodeByKey) {
    return Object.keys(document?.loop?.flows || {}).map((ownerId) => {
      const owner = nodeByKey.get(stepKey(ownerId));
      if (!owner) return null;
      const children = (Array.isArray(document?.steps) ? document.steps : [])
        .filter((step) => String(step?.loop_owner_id || "") === ownerId)
        .map((step) => nodeByKey.get(stepKey(step.step_id)))
        .filter(Boolean);
      const members = [owner, ...children];
      const minX = Math.min(...members.map((node) => node.x)) - 28;
      const minY = Math.min(...members.map((node) => node.y)) - 42;
      const maxX = Math.max(...members.map((node) => node.x + node.width)) + 28;
      const maxY = Math.max(...members.map((node) => node.y + node.height)) + 28;
      return {
        ownerId,
        label: owner.label,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };
    }).filter(Boolean);
  }

  function normalizeNotes(document) {
    return (Array.isArray(document?.notes) ? document.notes : [])
      .map((note, index) => {
        const noteId = String(note?.note_id || "").trim();
        if (!noteId) return null;
        const point = position(note.ui_position, {
          x: 320 + index * 24,
          y: 560 + index * 24
        });
        const width = Math.max(160, modules.asFiniteNumber(note.size?.width, 240));
        const height = Math.max(96, modules.asFiniteNumber(note.size?.height, 144));
        return {
          note,
          noteId,
          key: `note:${noteId}`,
          x: point.x,
          y: point.y,
          width,
          height,
          positionPath: ["notes", index, "ui_position"],
          sizePath: ["notes", index, "size"],
          textPath: ["notes", index, "text"],
          colorPath: ["notes", index, "color"]
        };
      })
      .filter(Boolean);
  }

  function buildBounds(nodes, frames, notes) {
    const items = [
      ...nodes.map((item) => ({
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height
      })),
      ...frames,
      ...notes
    ];
    if (!items.length) return { x: 0, y: 0, width: 960, height: 640 };
    const minX = Math.min(...items.map((item) => item.x));
    const minY = Math.min(...items.map((item) => item.y));
    const maxX = Math.max(...items.map((item) => item.x + item.width));
    const maxY = Math.max(...items.map((item) => item.y + item.height));
    return {
      x: minX,
      y: minY,
      width: Math.max(320, maxX - minX),
      height: Math.max(240, maxY - minY)
    };
  }

  function buildGraphModel(document) {
    const nodes = [];
    const nodeByKey = new Map();
    Object.entries(document?.flows || {}).forEach(([flowId, flow], index) => {
      ["START", "END"].forEach((nodeId) => {
        const node = createTerminalNode(flowId, flow, nodeId, index);
        nodes.push(node);
        nodeByKey.set(node.key, node);
      });
    });
    (Array.isArray(document?.steps) ? document.steps : []).forEach((step, index) => {
      const node = createStepNode(step, index);
      if (!node) return;
      nodes.push(node);
      nodeByKey.set(node.key, node);
    });
    const edges = [
      ...buildMainEdges(document, nodeByKey),
      ...buildLoopEdges(document, nodeByKey),
      ...buildUnassigned(document, nodes, nodeByKey)
    ];
    const loopFrames = buildLoopFrames(document, nodeByKey);
    const notes = normalizeNotes(document);
    return {
      nodes,
      edges,
      loopFrames,
      notes,
      nodeByKey,
      bounds: buildBounds(nodes, loopFrames, notes)
    };
  }

  modules.buildWorkflowGraphModel = buildGraphModel;
  modules.workflowStepKey = stepKey;
  modules.workflowFlowNodeKey = flowNodeKey;
})(window);
