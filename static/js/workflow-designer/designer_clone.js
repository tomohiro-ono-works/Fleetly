(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  const DEFAULT_OFFSET = Object.freeze({ x: 48, y: 48 });

  function offsetPosition(value, offset) {
    const point = modules.normalizePosition(value, { x: 280, y: 160 });
    return { x: point.x + offset.x, y: point.y + offset.y };
  }

  function mapEdge(edge, stepIdMap) {
    const copy = modules.cloneValue(edge);
    const from = String(copy?.from || "").trim();
    const to = String(copy?.to || "").trim();
    if (stepIdMap[from]) copy.from = stepIdMap[from];
    if (stepIdMap[to]) copy.to = stepIdMap[to];
    return copy;
  }

  function mapToObject(map) {
    return Object.fromEntries(map.entries());
  }

  function cloneSteps(document, fragment, context) {
    const sourceSteps = fragment.steps || [];
    const allocated = sourceSteps.length
      ? context.idManager.allocate("step", sourceSteps.length, document)
      : [];
    const stepIdMap = new Map();
    sourceSteps.forEach((step, index) => {
      stepIdMap.set(String(step.step_id), allocated[index]);
    });
    const flowIdMap = new Map();
    if (context.targetFlowId && fragment.source_flow_id) {
      flowIdMap.set(String(fragment.source_flow_id), context.targetFlowId);
    }

    const steps = sourceSteps.map((sourceStep) => {
      const oldStepId = String(sourceStep.step_id);
      let clonedStep = modules.cloneValue(sourceStep);
      clonedStep.step_id = stepIdMap.get(oldStepId);
      clonedStep.ui_position = offsetPosition(sourceStep.ui_position, context.offset);
      if (context.mode === "paste-partial") {
        delete clonedStep.flow_id;
      } else if (context.targetFlowId) {
        clonedStep.flow_id = context.targetFlowId;
      }
      const ownerId = String(sourceStep.loop_owner_id || "").trim();
      if (ownerId && stepIdMap.has(ownerId)) {
        clonedStep.loop_owner_id = stepIdMap.get(ownerId);
      } else if (ownerId && context.mode === "paste-partial") {
        delete clonedStep.loop_owner_id;
      }

      if (typeof context.referenceRewriter === "function") {
        const rewritten = context.referenceRewriter({
          clonedStep: modules.cloneValue(clonedStep),
          stepIdMap: mapToObject(stepIdMap),
          flowIdMap: mapToObject(flowIdMap),
          sourceDocument: modules.cloneValue(context.sourceDocument)
        });
        if (
          !rewritten ||
          typeof rewritten !== "object" ||
          Array.isArray(rewritten)
        ) {
          throw new Error("referenceRewriter must return a step object");
        }
        clonedStep = modules.cloneValue(rewritten);
        if (String(clonedStep.step_id || "") !== stepIdMap.get(oldStepId)) {
          throw new Error("referenceRewriter must preserve the allocated step_id");
        }
      }
      return clonedStep;
    });
    return { steps, stepIdMap, flowIdMap };
  }

  function cloneNotes(document, notes, idManager, offset) {
    if (!notes.length) return { notes: [], noteIds: [] };
    const noteIds = idManager.allocate("note", notes.length, document);
    return {
      noteIds,
      notes: notes.map((note, index) => ({
        ...modules.cloneValue(note),
        note_id: noteIds[index],
        ui_position: offsetPosition(note.ui_position, offset)
      }))
    };
  }

  function appendNotes(next, clonedNotes) {
    if (!clonedNotes.notes.length) return;
    const existing = Array.isArray(next.notes) ? next.notes : [];
    next.notes = [...existing, ...clonedNotes.notes];
  }

  function appendLoopFlows(next, loopFlows, stepIdMap) {
    const entries = Object.entries(loopFlows || {});
    if (!entries.length) return;
    next.loop = next.loop && typeof next.loop === "object" ? next.loop : {};
    next.loop.flows = next.loop.flows && typeof next.loop.flows === "object"
      ? next.loop.flows
      : {};
    entries.forEach(([ownerId, graph]) => {
      const newOwnerId = stepIdMap.get(String(ownerId));
      if (!newOwnerId) return;
      next.loop.flows[newOwnerId] = {
        ...modules.cloneValue(graph),
        edges: (Array.isArray(graph?.edges) ? graph.edges : [])
          .map((edge) => mapEdge(edge, mapToObject(stepIdMap)))
      };
    });
  }

  function pasteFlow(document, fragment, context) {
    const next = modules.cloneValue(document);
    const flowId = context.idManager.allocate("flow", 1, document)[0];
    const cloned = cloneSteps(document, fragment, {
      ...context,
      mode: "paste-flow",
      targetFlowId: flowId
    });
    const flow = modules.cloneValue(fragment.flow);
    flow.start = flow.start && typeof flow.start === "object" ? flow.start : {};
    flow.end = flow.end && typeof flow.end === "object" ? flow.end : {};
    flow.start.ui_position = offsetPosition(flow.start.ui_position, context.offset);
    flow.end.ui_position = offsetPosition(flow.end.ui_position, context.offset);
    flow.edges = (Array.isArray(flow.edges) ? flow.edges : [])
      .map((edge) => mapEdge(edge, mapToObject(cloned.stepIdMap)));

    next.steps = [...(Array.isArray(next.steps) ? next.steps : []), ...cloned.steps];
    next.flows = next.flows && typeof next.flows === "object" ? next.flows : {};
    next.flows[flowId] = flow;
    appendLoopFlows(next, fragment.loop_flows, cloned.stepIdMap);
    const notes = cloneNotes(document, fragment.notes || [], context.idManager, context.offset);
    appendNotes(next, notes);
    return {
      document: next,
      stepIdMap: cloned.stepIdMap,
      flowIdMap: new Map([[String(fragment.source_flow_id), flowId]]),
      selection: {
        nodes: [
          { node_id: "START", flow_id: flowId },
          { node_id: "END", flow_id: flowId },
          ...cloned.steps.map((step) => ({ node_id: step.step_id }))
        ],
        edges: [],
        annotation_ids: notes.noteIds
      }
    };
  }

  function ensureUnassigned(next, clonedSteps, offset) {
    const existing = next.unassigned && typeof next.unassigned === "object"
      ? next.unassigned
      : null;
    if (existing) return existing;
    const minX = Math.min(...clonedSteps.map((step) => step.ui_position.x), 280);
    const minY = Math.min(...clonedSteps.map((step) => step.ui_position.y), 160);
    next.unassigned = {
      start: {
        ui_position: {
          x: Math.max(24, minX - 184 + offset.x),
          y: minY
        }
      },
      step_ids: [],
      edges: []
    };
    return next.unassigned;
  }

  function pastePartial(document, fragment, context) {
    const next = modules.cloneValue(document);
    const cloned = cloneSteps(document, fragment, {
      ...context,
      mode: "paste-partial",
      targetFlowId: ""
    });
    next.steps = [...(Array.isArray(next.steps) ? next.steps : []), ...cloned.steps];
    if (cloned.steps.length) {
      const unassigned = ensureUnassigned(next, cloned.steps, context.offset);
      const ids = cloned.steps.map((step) => step.step_id);
      unassigned.step_ids = [
        ...(Array.isArray(unassigned.step_ids) ? unassigned.step_ids : []),
        ...ids
      ];
      const mappedEdges = (fragment.edges || [])
        .map((item) => mapEdge(item.edge, mapToObject(cloned.stepIdMap)));
      unassigned.edges = [
        ...(Array.isArray(unassigned.edges) ? unassigned.edges : []),
        ...mappedEdges
      ];
    }
    appendLoopFlows(next, fragment.loop_flows, cloned.stepIdMap);
    const notes = cloneNotes(document, fragment.notes || [], context.idManager, context.offset);
    appendNotes(next, notes);
    return {
      document: next,
      stepIdMap: cloned.stepIdMap,
      flowIdMap: new Map(),
      selection: {
        nodes: cloned.steps.map((step) => ({ node_id: step.step_id })),
        edges: [],
        annotation_ids: notes.noteIds
      }
    };
  }

  function duplicatePartial(document, fragment, context) {
    const next = modules.cloneValue(document);
    const cloned = cloneSteps(document, fragment, {
      ...context,
      mode: "duplicate",
      targetFlowId: ""
    });
    next.steps = [...(Array.isArray(next.steps) ? next.steps : []), ...cloned.steps];
    const idMap = mapToObject(cloned.stepIdMap);
    (fragment.edges || []).forEach((item) => {
      const mapped = mapEdge(item.edge, idMap);
      if (item.scope?.flow_id && next.flows?.[item.scope.flow_id]) {
        const target = next.flows[item.scope.flow_id];
        target.edges = [...(Array.isArray(target.edges) ? target.edges : []), mapped];
      } else if (item.scope?.graph_scope === "unassigned") {
        const unassigned = ensureUnassigned(next, cloned.steps, context.offset);
        unassigned.edges = [...(unassigned.edges || []), mapped];
      }
    });
    cloned.steps.forEach((step) => {
      if (step.flow_id) return;
      const unassigned = ensureUnassigned(next, cloned.steps, context.offset);
      unassigned.step_ids = [...(unassigned.step_ids || []), step.step_id];
    });
    appendLoopFlows(next, fragment.loop_flows, cloned.stepIdMap);
    const notes = cloneNotes(document, fragment.notes || [], context.idManager, context.offset);
    appendNotes(next, notes);
    return {
      document: next,
      stepIdMap: cloned.stepIdMap,
      flowIdMap: new Map(),
      selection: {
        nodes: cloned.steps.map((step) => ({ node_id: step.step_id })),
        edges: [],
        annotation_ids: notes.noteIds
      }
    };
  }

  function cloneFragment(document, fragment, options = {}) {
    modules.assertWorkflowFragment(fragment);
    const context = {
      sourceDocument: options.sourceDocument || document,
      idManager: options.idManager,
      referenceRewriter: options.referenceRewriter,
      offset: modules.normalizePosition(options.offset, DEFAULT_OFFSET)
    };
    if (!context.idManager) throw new Error("id manager is required");
    if (fragment.kind === "flow") return pasteFlow(document, fragment, context);
    if (options.mode === "duplicate") {
      return duplicatePartial(document, fragment, context);
    }
    return pastePartial(document, fragment, context);
  }

  modules.cloneWorkflowFragment = cloneFragment;
})(window);
