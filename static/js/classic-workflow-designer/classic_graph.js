(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const core = packages.workflowDesignerCore;
  const modules = packages.__classicWorkflowDesignerModules =
    packages.__classicWorkflowDesignerModules || {};

  const NODE_SIZE = 64;
  const NOTE_MIN_WIDTH = 160;
  const NOTE_MIN_HEIGHT = 96;

  function sampleCubic(p0, p1, p2, p3, count = 24) {
    const points = [p0];
    for (let index = 1; index <= count; index += 1) {
      const t = index / count;
      const mt = 1 - t;
      points.push({
        x: mt ** 3 * p0.x +
          3 * mt ** 2 * t * p1.x +
          3 * mt * t ** 2 * p2.x +
          t ** 3 * p3.x,
        y: mt ** 3 * p0.y +
          3 * mt ** 2 * t * p1.y +
          3 * mt * t ** 2 * p2.y +
          t ** 3 * p3.y
      });
    }
    return points;
  }

  function orthogonalPoints(source, target, edge) {
    const start = {
      x: source.x + source.width,
      y: source.y + source.height / 2
    };
    const end = {
      x: target.x,
      y: target.y + target.height / 2
    };
    if (edge.kind === "loop-back") {
      const laneY = Math.max(
        source.y + source.height,
        target.y + target.height
      ) + 76;
      return [
        start,
        { x: start.x + 40, y: start.y },
        { x: start.x + 40, y: laneY },
        { x: end.x - 28, y: laneY },
        { x: end.x - 28, y: end.y },
        end
      ];
    }
    if (end.x <= start.x + 16) {
      const laneX = Math.max(
        source.x + source.width,
        target.x + target.width
      ) + 72;
      const laneY = end.y >= start.y
        ? Math.max(start.y, end.y) + 72
        : Math.min(start.y, end.y) - 72;
      return [
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: laneY },
        { x: end.x - 24, y: laneY },
        { x: end.x - 24, y: end.y },
        end
      ];
    }
    const distance = Math.max(36, (end.x - start.x) * 0.46);
    return sampleCubic(
      start,
      { x: start.x + distance, y: start.y },
      { x: end.x - distance, y: end.y },
      end
    );
  }

  function classicNode(node, document) {
    const flowLabel = node.ref?.flow_id
      ? String(
        document?.flows?.[node.ref.flow_id]?.label ||
        node.ref.flow_id
      )
      : "";
    return {
      ...node,
      flowLabel,
      width: NODE_SIZE,
      height: NODE_SIZE
    };
  }

  function buildLoopFrames(document, nodeByKey) {
    return Object.keys(document?.loop?.flows || {}).map((ownerId) => {
      const owner = nodeByKey.get(`step:${ownerId}`);
      if (!owner) return null;
      const children = (Array.isArray(document?.steps) ? document.steps : [])
        .filter((step) => String(step?.loop_owner_id || "") === ownerId)
        .map((step) => nodeByKey.get(`step:${step.step_id}`))
        .filter(Boolean);
      const members = [owner, ...children];
      const minX = Math.min(...members.map((node) => node.x)) - 24;
      const minY = Math.min(...members.map((node) => node.y)) - 34;
      const maxX = Math.max(
        ...members.map((node) => node.x + node.width)
      ) + 24;
      const maxY = Math.max(
        ...members.map((node) => node.y + node.height)
      ) + 48;
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

  function boundsFor(items) {
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

  function buildClassicGraphModel(document) {
    const source = core.buildWorkflowGraphModel(document);
    const nodes = source.nodes.map((node) => classicNode(node, document));
    const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
    const edges = source.edges.map((edge) => {
      const from = nodeByKey.get(edge.sourceKey);
      const to = nodeByKey.get(edge.targetKey);
      return {
        ...edge,
        points: from && to ? orthogonalPoints(from, to, edge) : []
      };
    });
    const notes = source.notes.map((note) => ({
      ...note,
      width: Math.max(NOTE_MIN_WIDTH, note.width),
      height: Math.max(NOTE_MIN_HEIGHT, note.height)
    }));
    const loopFrames = buildLoopFrames(document, nodeByKey);
    const bounds = boundsFor([
      ...nodes.map((node) => ({
        x: node.x - 18,
        y: node.y - 20,
        width: node.width + 36,
        height: node.height + 78
      })),
      ...loopFrames,
      ...notes
    ]);
    return {
      nodes,
      edges,
      notes,
      loopFrames,
      nodeByKey,
      bounds
    };
  }

  function distanceToSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(
      point.x - start.x,
      point.y - start.y
    );
    const ratio = Math.max(0, Math.min(1, (
      (point.x - start.x) * dx + (point.y - start.y) * dy
    ) / lengthSquared));
    return Math.hypot(
      point.x - (start.x + ratio * dx),
      point.y - (start.y + ratio * dy)
    );
  }

  function hitNode(model, point) {
    for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
      const node = model.nodes[index];
      if (
        point.x >= node.x &&
        point.x <= node.x + node.width &&
        point.y >= node.y &&
        point.y <= node.y + node.height
      ) return node;
    }
    return null;
  }

  function hitNote(model, point, handleSize = 14) {
    for (let index = model.notes.length - 1; index >= 0; index -= 1) {
      const note = model.notes[index];
      if (
        point.x < note.x ||
        point.x > note.x + note.width ||
        point.y < note.y ||
        point.y > note.y + note.height
      ) continue;
      return {
        note,
        resize: point.x >= note.x + note.width - handleSize &&
          point.y >= note.y + note.height - handleSize
      };
    }
    return null;
  }

  function hitEdge(model, point, threshold = 8) {
    for (let index = model.edges.length - 1; index >= 0; index -= 1) {
      const edge = model.edges[index];
      for (let part = 1; part < edge.points.length; part += 1) {
        if (distanceToSegment(
          point,
          edge.points[part - 1],
          edge.points[part]
        ) <= threshold) return edge;
      }
    }
    return null;
  }

  function hitPort(model, point, direction, radius = 10) {
    for (let index = model.nodes.length - 1; index >= 0; index -= 1) {
      const node = model.nodes[index];
      if (direction === "in" && ["start", "unassigned-start"].includes(
        node.kind
      )) continue;
      if (direction === "out" && node.kind === "end") continue;
      const center = {
        x: direction === "in" ? node.x : node.x + node.width,
        y: node.y + node.height / 2
      };
      if (Math.hypot(point.x - center.x, point.y - center.y) <= radius) {
        return { node, center };
      }
    }
    return null;
  }

  function nodesInRect(model, rect) {
    const left = Math.min(rect.start.x, rect.end.x);
    const top = Math.min(rect.start.y, rect.end.y);
    const right = Math.max(rect.start.x, rect.end.x);
    const bottom = Math.max(rect.start.y, rect.end.y);
    return model.nodes.filter((node) => (
      node.x >= left &&
      node.y >= top &&
      node.x + node.width <= right &&
      node.y + node.height <= bottom
    ));
  }

  modules.CLASSIC_NODE_SIZE = NODE_SIZE;
  modules.buildClassicGraphModel = buildClassicGraphModel;
  modules.hitClassicNode = hitNode;
  modules.hitClassicNote = hitNote;
  modules.hitClassicEdge = hitEdge;
  modules.hitClassicPort = hitPort;
  modules.classicNodesInRect = nodesInRect;
})(window);
