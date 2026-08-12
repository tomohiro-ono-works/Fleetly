(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentCommandModules =
    packages.__workflowDocumentCommandModules || {};

  function getGraph(document, scope) {
    if (scope.kind === "flow") {
      return modules.asMap(document?.flows)[scope.id] || null;
    }
    if (scope.kind === "loop") {
      return modules.asMap(document?.loop?.flows)[scope.id] || null;
    }
    return scope.kind === "unassigned" ? document?.unassigned || null : null;
  }

  function getEdges(document, scope) {
    return modules.asArray(getGraph(document, scope)?.edges);
  }

  function graphEdgePatch(document, scope, edges) {
    const value = modules.cloneValue(edges);
    const graph = getGraph(document, scope);
    if (scope.kind === "flow") {
      return [{
        op: Object.prototype.hasOwnProperty.call(graph || {}, "edges")
          ? "replace"
          : "add",
        path: ["flows", scope.id, "edges"],
        value
      }];
    }
    if (scope.kind === "unassigned") {
      return [{
        op: Object.prototype.hasOwnProperty.call(graph || {}, "edges")
          ? "replace"
          : "add",
        path: ["unassigned", "edges"],
        value
      }];
    }
    if (!document?.loop) {
      return [{ op: "add", path: ["loop"], value: { flows: {
        [scope.id]: { edges: value }
      } } }];
    }
    if (!document.loop?.flows) {
      return [{ op: "add", path: ["loop", "flows"], value: {
        [scope.id]: { edges: value }
      } }];
    }
    if (!graph) {
      return [{
        op: "add",
        path: ["loop", "flows", scope.id],
        value: { edges: value }
      }];
    }
    return [{
      op: Object.prototype.hasOwnProperty.call(graph, "edges") ? "replace" : "add",
      path: ["loop", "flows", scope.id, "edges"],
      value
    }];
  }

  function hasPath(edges, start, target) {
    const adjacency = new Map();
    edges.forEach((edge) => {
      const from = modules.text(edge?.from);
      const to = modules.text(edge?.to);
      if (!adjacency.has(from)) adjacency.set(from, []);
      adjacency.get(from).push(to);
    });
    const pending = [start];
    const visited = new Set();
    while (pending.length) {
      const current = pending.pop();
      if (current === target) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(adjacency.get(current) || []));
    }
    return false;
  }

  function appendEdge(edges, from, to, linear) {
    if (from === to || from === "END" || to === "START") {
      throw modules.createError(
        "E_CONNECT_INVALID",
        "この向きでは接続できません。"
      );
    }
    if (edges.some((edge) => (
      modules.text(edge?.from) === from && modules.text(edge?.to) === to
    ))) {
      throw modules.createError(
        "E_CONNECT_DUPLICATE",
        "同じedgeは既に存在します。"
      );
    }
    if (linear && (
      edges.some((edge) => modules.text(edge?.from) === from) ||
      edges.some((edge) => modules.text(edge?.to) === to)
    )) {
      throw modules.createError(
        "E_LOOP_BRANCH_MERGE",
        "loop内部では並列分岐と合流を作成できません。"
      );
    }
    if (hasPath(edges, to, from)) {
      throw modules.createError(
        "E_CONNECT_CYCLE",
        "cycleを作成するedgeは追加できません。"
      );
    }
    const order = Math.max(
      0,
      ...edges
        .filter((edge) => modules.text(edge?.from) === from)
        .map((edge) => Number(edge?.order) || 0)
    ) + 1;
    return [...modules.cloneValue(edges), { from, to, order }];
  }

  function setGraphEdges(document, scope, edges) {
    if (scope.kind === "flow") {
      document.flows[scope.id].edges = modules.cloneValue(edges);
      return;
    }
    if (scope.kind === "unassigned") {
      document.unassigned.edges = modules.cloneValue(edges);
      return;
    }
    document.loop = document.loop || {};
    document.loop.flows = document.loop.flows || {};
    document.loop.flows[scope.id] = document.loop.flows[scope.id] || {};
    document.loop.flows[scope.id].edges = modules.cloneValue(edges);
  }

  function loopFamily(document, ownerId, result = new Set()) {
    if (result.has(ownerId)) return result;
    result.add(ownerId);
    modules.stepEntries(document)
      .filter((entry) => modules.text(entry.step?.loop_owner_id) === ownerId)
      .forEach((entry) => loopFamily(document, entry.id, result));
    return result;
  }

  function mainInvalidation(document, flowId, startId) {
    if (!flowId || startId === "END") return [];
    const edges = getEdges(document, { kind: "flow", id: flowId });
    const reachable = new Set([startId]);
    const pending = [startId];
    while (pending.length) {
      const current = pending.pop();
      edges
        .filter((edge) => modules.text(edge?.from) === current)
        .forEach((edge) => {
          const target = modules.text(edge?.to);
          if (!reachable.has(target)) {
            reachable.add(target);
            pending.push(target);
          }
        });
    }
    const invalid = new Set();
    modules.stepEntries(document).forEach((entry) => {
      if (
        modules.text(entry.step?.flow_id) === flowId &&
        !modules.text(entry.step?.loop_owner_id) &&
        reachable.has(entry.id)
      ) {
        loopFamily(document, entry.id).forEach((id) => invalid.add(id));
      }
    });
    return modules.stepEntries(document)
      .map((entry) => entry.id)
      .filter((id) => invalid.has(id));
  }

  function invalidationForNode(document, scope, nodeId) {
    if (scope.kind === "unassigned") return [];
    if (scope.kind === "flow") {
      return mainInvalidation(document, scope.id, nodeId);
    }
    const owner = modules.requireStep(document, scope.id).step;
    return mainInvalidation(
      document,
      modules.text(owner?.flow_id),
      scope.id
    );
  }

  function invalidationForStep(document, stepId) {
    const entry = modules.requireStep(document, stepId);
    const ownerId = modules.text(entry.step?.loop_owner_id);
    if (ownerId) {
      const owner = modules.requireStep(document, ownerId).step;
      return mainInvalidation(
        document,
        modules.text(owner?.flow_id),
        ownerId
      );
    }
    return mainInvalidation(
      document,
      modules.text(entry.step?.flow_id),
      entry.id
    );
  }

  Object.assign(modules, {
    appendEdge,
    getEdges,
    graphEdgePatch,
    invalidationForNode,
    invalidationForStep,
    loopFamily,
    setGraphEdges
  });
})(window);
