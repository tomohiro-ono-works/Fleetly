(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentCommandModules =
    packages.__workflowDocumentCommandModules || {};

  function edgeScope(value) {
    const flowId = modules.text(value?.flow_id);
    const ownerId = modules.text(value?.loop_owner_id);
    const graphScope = modules.text(value?.graph_scope);
    if (flowId) return { kind: "flow", id: flowId };
    if (ownerId) return { kind: "loop", id: ownerId };
    if (graphScope === "unassigned") return { kind: "unassigned" };
    throw modules.createError(
      "E_EDGE_REF_INVALID",
      "edge参照にはgraph scopeが必要です。"
    );
  }

  function scopeMatches(left, right) {
    return left.kind === right.kind && left.id === right.id;
  }

  function selectedEdgeSet(selection) {
    return modules.asArray(selection?.edges).map((edge) => {
      const from = modules.text(edge?.from);
      const to = modules.text(edge?.to);
      if (!from || !to) {
        throw modules.createError(
          "E_EDGE_REF_INVALID",
          "edgeのfrom／toは必須です。"
        );
      }
      return { scope: edgeScope(edge), from, to };
    });
  }

  function isSelectedEdge(selected, scope, edge) {
    const from = modules.text(edge?.from);
    const to = modules.text(edge?.to);
    return selected.some((item) => (
      scopeMatches(item.scope, scope) &&
      item.from === from &&
      item.to === to
    ));
  }

  function sameEdges(left, right) {
    if (left.length !== right.length) return false;
    return left.every((edge, index) => (
      modules.text(edge?.from) === modules.text(right[index]?.from) &&
      modules.text(edge?.to) === modules.text(right[index]?.to) &&
      Number(edge?.order || 0) === Number(right[index]?.order || 0)
    ));
  }

  function expandDeletedSteps(document, initialIds) {
    const deleted = new Set(initialIds);
    let expanded = true;
    while (expanded) {
      expanded = false;
      modules.stepEntries(document).forEach((entry) => {
        const ownerId = modules.text(entry.step?.loop_owner_id);
        if (ownerId && deleted.has(ownerId) && !deleted.has(entry.id)) {
          deleted.add(entry.id);
          expanded = true;
        }
      });
    }
    return deleted;
  }

  function collectNodeSelection(document, selection) {
    const ids = new Set();
    modules.asArray(selection?.nodes).forEach((nodeRef) => {
      const node = modules.resolveNode(document, nodeRef);
      if (node.kind !== "step") {
        throw modules.createError(
          "E_DELETE_TERMINAL",
          "START／END／未所属仮STARTは削除できません。"
        );
      }
      ids.add(node.id);
    });
    return expandDeletedSteps(document, ids);
  }

  function addInvalidation(target, values) {
    values.forEach((id) => target.add(id));
  }

  function planDeleteSelection(document, selection = {}) {
    const deletedIds = collectNodeSelection(document, selection);
    const selectedEdges = selectedEdgeSet(selection);
    const noteIds = new Set(
      modules.asArray(selection?.annotation_ids).map(modules.text)
    );
    const invalidated = new Set(deletedIds);
    deletedIds.forEach((id) => {
      addInvalidation(
        invalidated,
        modules.invalidationForStep(document, id)
      );
    });
    selectedEdges.forEach((edge) => {
      addInvalidation(
        invalidated,
        modules.invalidationForNode(document, edge.scope, edge.to)
      );
    });

    const patch = [];
    if (deletedIds.size) {
      patch.push({
        op: "replace",
        path: ["steps"],
        value: modules.stepEntries(document)
          .filter((entry) => !deletedIds.has(entry.id))
          .map((entry) => modules.cloneValue(entry.step))
      });
    }

    Object.entries(modules.asMap(document?.flows)).forEach(([flowId, flow]) => {
      const scope = { kind: "flow", id: flowId };
      const before = modules.asArray(flow?.edges);
      const after = before.filter((edge) => (
        !deletedIds.has(modules.text(edge?.from)) &&
        !deletedIds.has(modules.text(edge?.to)) &&
        !isSelectedEdge(selectedEdges, scope, edge)
      ));
      if (!sameEdges(before, after)) {
        patch.push(...modules.graphEdgePatch(document, scope, after));
      }
    });

    Object.entries(modules.asMap(document?.loop?.flows))
      .forEach(([ownerId, graph]) => {
        if (deletedIds.has(ownerId)) {
          patch.push({
            op: "remove",
            path: ["loop", "flows", ownerId]
          });
          return;
        }
        const scope = { kind: "loop", id: ownerId };
        const before = modules.asArray(graph?.edges);
        const after = before.filter((edge) => (
          !deletedIds.has(modules.text(edge?.from)) &&
          !deletedIds.has(modules.text(edge?.to)) &&
          !isSelectedEdge(selectedEdges, scope, edge)
        ));
        if (!sameEdges(before, after)) {
          patch.push(...modules.graphEdgePatch(document, scope, after));
        }
      });

    if (document?.unassigned) {
      const scope = { kind: "unassigned" };
      const remainingIds = modules.asArray(document.unassigned.step_ids)
        .map(modules.text)
        .filter((id) => !deletedIds.has(id));
      const before = modules.asArray(document.unassigned.edges);
      const after = before.filter((edge) => (
        !deletedIds.has(modules.text(edge?.from)) &&
        !deletedIds.has(modules.text(edge?.to)) &&
        !isSelectedEdge(selectedEdges, scope, edge)
      ));
      if (!remainingIds.length && deletedIds.size) {
        patch.push({ op: "remove", path: ["unassigned"] });
      } else {
        if (remainingIds.length !== modules.asArray(
          document.unassigned.step_ids
        ).length) {
          patch.push({
            op: "replace",
            path: ["unassigned", "step_ids"],
            value: remainingIds
          });
        }
        if (!sameEdges(before, after)) {
          patch.push(...modules.graphEdgePatch(document, scope, after));
        }
      }
    }

    if (noteIds.size) {
      const notes = modules.asArray(document?.notes);
      const remaining = notes.filter(
        (note) => !noteIds.has(modules.text(note?.note_id))
      );
      if (remaining.length !== notes.length) {
        patch.push({
          op: "replace",
          path: ["notes"],
          value: modules.cloneValue(remaining)
        });
      }
    }

    const orderedInvalidation = modules.stepEntries(document)
      .map((entry) => entry.id)
      .filter((id) => invalidated.has(id));
    return {
      patch,
      invalidated_step_ids: orderedInvalidation,
      deleted_step_ids: modules.stepEntries(document)
        .map((entry) => entry.id)
        .filter((id) => deletedIds.has(id)),
      deleted_note_ids: [...noteIds]
    };
  }

  modules.planDeleteWorkflowSelection = planDeleteSelection;
})(window);
