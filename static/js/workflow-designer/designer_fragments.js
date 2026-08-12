(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function selectedStepIds(document, selection) {
    const existing = new Set(
      (Array.isArray(document?.steps) ? document.steps : [])
        .map((step) => String(step?.step_id || "").trim())
        .filter(Boolean)
    );
    return new Set(
      modules.normalizeSelection(selection).nodes
        .map((ref) => String(ref.node_id || "").trim())
        .filter((id) => existing.has(id))
    );
  }

  function selectedFullFlowId(document, selection, stepIds) {
    const normalized = modules.normalizeSelection(selection);
    const terminalByFlow = new Map();
    normalized.nodes.forEach((ref) => {
      if (!ref.flow_id || !["START", "END"].includes(ref.node_id)) return;
      const nodes = terminalByFlow.get(ref.flow_id) || new Set();
      nodes.add(ref.node_id);
      terminalByFlow.set(ref.flow_id, nodes);
    });
    const candidates = Array.from(terminalByFlow.entries())
      .filter(([, terminals]) => terminals.has("START") && terminals.has("END"));
    if (candidates.length !== 1) return "";
    const flowId = candidates[0][0];
    const flowSteps = (Array.isArray(document?.steps) ? document.steps : [])
      .filter((step) => String(step?.flow_id || "") === flowId)
      .map((step) => String(step.step_id));
    return flowSteps.every((stepId) => stepIds.has(stepId)) ? flowId : "";
  }

  function edgeInside(edge, selectedIds) {
    const from = String(edge?.from || "").trim();
    const to = String(edge?.to || "").trim();
    return selectedIds.has(from) && selectedIds.has(to);
  }

  function collectPartialEdges(document, stepIds) {
    const edges = [];
    Object.entries(document?.flows || {}).forEach(([flowId, flow]) => {
      (Array.isArray(flow?.edges) ? flow.edges : []).forEach((edge) => {
        if (!edgeInside(edge, stepIds)) return;
        edges.push({
          scope: { flow_id: flowId },
          edge: modules.cloneValue(edge)
        });
      });
    });
    (Array.isArray(document?.unassigned?.edges)
      ? document.unassigned.edges
      : []
    ).forEach((edge) => {
      if (!edgeInside(edge, stepIds)) return;
      edges.push({
        scope: { graph_scope: "unassigned" },
        edge: modules.cloneValue(edge)
      });
    });
    return edges;
  }

  function collectLoopFlows(document, stepIds) {
    const output = {};
    Object.entries(document?.loop?.flows || {}).forEach(([ownerId, graph]) => {
      if (!stepIds.has(ownerId)) return;
      const edges = (Array.isArray(graph?.edges) ? graph.edges : [])
        .filter((edge) => {
          const from = String(edge?.from || "").trim();
          const to = String(edge?.to || "").trim();
          const fromIncluded = from === "START" || stepIds.has(from);
          const toIncluded = to === "END" || stepIds.has(to);
          return fromIncluded && toIncluded;
        })
        .map((edge) => modules.cloneValue(edge));
      output[ownerId] = {
        ...modules.cloneValue(graph),
        edges
      };
    });
    return output;
  }

  function collectNotes(document, selection) {
    const ids = new Set(modules.normalizeSelection(selection).annotation_ids);
    return (Array.isArray(document?.notes) ? document.notes : [])
      .filter((note) => ids.has(String(note?.note_id || "")))
      .map((note) => modules.cloneValue(note));
  }

  function copySelection(document, selection) {
    modules.assertWorkflowDocument(document);
    const stepIds = selectedStepIds(document, selection);
    const flowId = selectedFullFlowId(document, selection, stepIds);
    const notes = collectNotes(document, selection);

    if (flowId) {
      const steps = document.steps
        .filter((step) => String(step?.flow_id || "") === flowId)
        .map((step) => modules.cloneValue(step));
      return {
        fragment_version: 1,
        kind: "flow",
        source_document: modules.cloneValue(document),
        source_flow_id: flowId,
        flow: modules.cloneValue(document.flows[flowId]),
        steps,
        loop_flows: collectLoopFlows(document, new Set(
          steps.map((step) => String(step.step_id))
        )),
        notes
      };
    }

    const steps = (Array.isArray(document?.steps) ? document.steps : [])
      .filter((step) => stepIds.has(String(step?.step_id || "")))
      .map((step) => modules.cloneValue(step));
    return {
      fragment_version: 1,
      kind: "partial",
      source_document: modules.cloneValue(document),
      steps,
      edges: collectPartialEdges(document, stepIds),
      loop_flows: collectLoopFlows(document, stepIds),
      notes
    };
  }

  function assertFragment(value) {
    if (!value || typeof value !== "object") {
      throw new TypeError("graph fragment must be an object");
    }
    if (value.fragment_version !== 1) {
      throw new Error("unsupported graph fragment version");
    }
    if (!["flow", "partial"].includes(value.kind)) {
      throw new Error("unsupported graph fragment kind");
    }
    if (!Array.isArray(value.steps) || !Array.isArray(value.notes || [])) {
      throw new Error("graph fragment collections are invalid");
    }
    if (value.kind === "flow" && (!value.flow || typeof value.flow !== "object")) {
      throw new Error("flow fragment is missing its flow definition");
    }
  }

  modules.copyWorkflowSelection = copySelection;
  modules.assertWorkflowFragment = assertFragment;
})(window);
