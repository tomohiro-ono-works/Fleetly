(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentCommandModules =
    packages.__workflowDocumentCommandModules || {};

  function sameScope(left, right) {
    return left.kind === right.kind && left.id === right.id;
  }

  function isLoopParent(node) {
    return node.kind === "step" &&
      modules.text(node.entry.step?.node_type) === "loop";
  }

  function directConnection(source, target) {
    if (source.id === "END" || target.id === "START") {
      throw modules.createError(
        "E_CONNECT_INVALID",
        "ENDからの出力またはSTARTへの入力は作成できません。"
      );
    }
    if (
      source.kind === "step" &&
      target.kind === "step" &&
      isLoopParent(source) &&
      modules.text(target.entry.step?.loop_owner_id) === source.id
    ) {
      return {
        scope: { kind: "loop", id: source.id },
        from: "START",
        to: target.id,
        linear: true
      };
    }
    if (
      source.kind === "step" &&
      target.kind === "step" &&
      modules.text(source.entry.step?.loop_owner_id) === target.id &&
      isLoopParent(target)
    ) {
      return {
        scope: { kind: "loop", id: target.id },
        from: source.id,
        to: "END",
        linear: true
      };
    }
    const sourceOwner = source.kind === "step"
      ? modules.text(source.entry.step?.loop_owner_id)
      : "";
    const targetOwner = target.kind === "step"
      ? modules.text(target.entry.step?.loop_owner_id)
      : "";
    if (sourceOwner || targetOwner) {
      if (
        sourceOwner &&
        sourceOwner === targetOwner &&
        sameScope(source.scope, target.scope)
      ) {
        return {
          scope: { kind: "loop", id: sourceOwner },
          from: source.id,
          to: target.id,
          linear: true
        };
      }
      throw modules.createError(
        "E_CONNECT_LOOP_BOUNDARY",
        "loop内部stepは同じloop内部またはloop親とのみ接続できます。"
      );
    }
    if (!sameScope(source.scope, target.scope)) {
      return null;
    }
    return {
      scope: source.scope,
      from: source.id,
      to: target.id,
      linear: source.scope.kind === "loop"
    };
  }

  function expandUnassignedComponent(document, startId) {
    const ids = new Set(modules.asArray(document?.unassigned?.step_ids)
      .map(modules.text));
    if (!ids.has(startId)) {
      throw modules.createError(
        "E_CONNECT_UNASSIGNED",
        "接続先が未所属graphに存在しません。"
      );
    }
    const component = new Set([startId]);
    const pending = [startId];
    const edges = modules.getEdges(document, { kind: "unassigned" });
    while (pending.length) {
      const current = pending.pop();
      edges.forEach((edge) => {
        const from = modules.text(edge?.from);
        const to = modules.text(edge?.to);
        if (from === "START" || to === "START") return;
        let next = "";
        if (from === current) next = to;
        if (to === current) next = from;
        if (next && ids.has(next) && !component.has(next)) {
          component.add(next);
          pending.push(next);
        }
      });
    }
    let expanded = true;
    while (expanded) {
      expanded = false;
      modules.stepEntries(document)
        .filter((entry) => ids.has(entry.id))
        .forEach((entry) => {
          const ownerId = modules.text(entry.step?.loop_owner_id);
          if (component.has(entry.id) && ownerId && !component.has(ownerId)) {
            if (!ids.has(ownerId)) {
              throw modules.createError(
                "E_CONNECT_UNASSIGNED",
                `loop親 '${ownerId}'も同じ未所属領域に必要です。`
              );
            }
            component.add(ownerId);
            expanded = true;
          }
          if (component.has(ownerId) && !component.has(entry.id)) {
            component.add(entry.id);
            expanded = true;
          }
        });
    }
    return component;
  }

  function moveUnassigned(document, source, target) {
    if (
      source.scope.kind !== "flow" ||
      target.scope.kind !== "unassigned" ||
      target.kind !== "step"
    ) {
      throw modules.createError(
        "E_CONNECT_CROSS_SCOPE",
        "異なるflow／graph間は接続できません。"
      );
    }
    if (modules.text(target.entry.step?.loop_owner_id)) {
      throw modules.createError(
        "E_CONNECT_UNASSIGNED",
        "未所属loopはloop親nodeへ接続してください。"
      );
    }
    const component = expandUnassignedComponent(document, target.id);
    const entries = modules.stepEntries(document)
      .filter((entry) => component.has(entry.id));
    if (entries.some((entry) => modules.text(entry.step?.flow_id))) {
      throw modules.createError(
        "E_CONNECT_UNASSIGNED",
        "未所属stepに既存flow_idが設定されています。"
      );
    }
    const childIds = new Set(entries
      .filter((entry) => modules.text(entry.step?.loop_owner_id))
      .map((entry) => entry.id));
    const unassignedEdges = modules.getEdges(
      document,
      { kind: "unassigned" }
    );
    const movedEdges = [];
    const remainingEdges = [];
    unassignedEdges.forEach((edge) => {
      const from = modules.text(edge?.from);
      const to = modules.text(edge?.to);
      const touches = component.has(from) || component.has(to);
      if (!touches) {
        remainingEdges.push(modules.cloneValue(edge));
        return;
      }
      if (from === "START" || to === "START") return;
      if (!component.has(from) || !component.has(to)) {
        throw modules.createError(
          "E_CONNECT_UNASSIGNED",
          "未所属component外へのedgeが存在します。"
        );
      }
      if (childIds.has(from) || childIds.has(to)) {
        throw modules.createError(
          "E_CONNECT_UNASSIGNED",
          "loop内部edgeはloop.flowsへ保存してください。"
        );
      }
      movedEdges.push(modules.cloneValue(edge));
    });

    const scope = { kind: "flow", id: source.scope.id };
    let nextEdges = modules.cloneValue(modules.getEdges(document, scope));
    movedEdges.forEach((edge) => {
      const appended = modules.appendEdge(
        nextEdges,
        modules.text(edge?.from),
        modules.text(edge?.to),
        false
      );
      const preservedOrder = Number(edge?.order);
      if (Number.isFinite(preservedOrder)) {
        appended[appended.length - 1].order = preservedOrder;
      }
      nextEdges = appended;
    });
    nextEdges = modules.appendEdge(nextEdges, source.id, target.id, false);

    const patch = entries.map((entry) => ({
      op: "add",
      path: ["steps", entry.index, "flow_id"],
      value: source.scope.id
    }));
    patch.push(...modules.graphEdgePatch(document, scope, nextEdges));
    const remainingIds = modules.asArray(document.unassigned.step_ids)
      .map(modules.text)
      .filter((id) => !component.has(id));
    if (!remainingIds.length) {
      patch.push({ op: "remove", path: ["unassigned"] });
    } else {
      patch.push({
        op: "replace",
        path: ["unassigned", "step_ids"],
        value: remainingIds
      });
      patch.push({
        op: Object.prototype.hasOwnProperty.call(
          document.unassigned,
          "edges"
        ) ? "replace" : "add",
        path: ["unassigned", "edges"],
        value: remainingEdges
      });
    }

    const next = modules.cloneValue(document);
    entries.forEach((entry) => {
      next.steps[entry.index].flow_id = source.scope.id;
    });
    modules.setGraphEdges(next, scope, nextEdges);
    if (!remainingIds.length) delete next.unassigned;
    else {
      next.unassigned.step_ids = remainingIds;
      next.unassigned.edges = remainingEdges;
    }
    return {
      patch,
      invalidated_step_ids: modules.invalidationForNode(
        next,
        scope,
        target.id
      ),
      edge: { flow_id: scope.id, from: source.id, to: target.id },
      assigned_step_ids: entries.map((entry) => entry.id)
    };
  }

  function planConnection(document, sourceRef, targetRef) {
    const source = modules.resolveNode(document, sourceRef);
    const target = modules.resolveNode(document, targetRef);
    const direct = directConnection(source, target);
    if (!direct) return moveUnassigned(document, source, target);
    const edges = modules.getEdges(document, direct.scope);
    const nextEdges = modules.appendEdge(
      edges,
      direct.from,
      direct.to,
      direct.linear
    );
    const next = modules.cloneValue(document);
    modules.setGraphEdges(next, direct.scope, nextEdges);
    const edge = {
      from: direct.from,
      to: direct.to
    };
    if (direct.scope.kind === "flow") edge.flow_id = direct.scope.id;
    if (direct.scope.kind === "loop") edge.loop_owner_id = direct.scope.id;
    if (direct.scope.kind === "unassigned") edge.graph_scope = "unassigned";
    return {
      patch: modules.graphEdgePatch(document, direct.scope, nextEdges),
      invalidated_step_ids: modules.invalidationForNode(
        next,
        direct.scope,
        direct.to
      ),
      edge,
      assigned_step_ids: []
    };
  }

  modules.planWorkflowConnection = planConnection;
})(window);
