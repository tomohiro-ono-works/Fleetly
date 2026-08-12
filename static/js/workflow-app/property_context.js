(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

  function text(value) {
    return String(value || "").trim();
  }

  function clone(value) {
    if (typeof root.structuredClone === "function") {
      return root.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function stepEntries(document) {
    return (Array.isArray(document?.steps) ? document.steps : [])
      .filter((step) => step && typeof step === "object");
  }

  function flowForStep(document, step) {
    return document?.flows?.[text(step?.flow_id)] || null;
  }

  function edgesForStep(document, step) {
    const ownerId = text(step?.loop_owner_id);
    if (ownerId) {
      return document?.loop?.flows?.[ownerId]?.edges || [];
    }
    return flowForStep(document, step)?.edges || [];
  }

  function ancestorStepIds(document, step) {
    const edges = Array.isArray(edgesForStep(document, step))
      ? edgesForStep(document, step)
      : [];
    const parents = new Map();
    edges.forEach((edge) => {
      const from = text(edge?.from);
      const to = text(edge?.to);
      if (!from || !to || from === "START") return;
      if (!parents.has(to)) parents.set(to, []);
      parents.get(to).push(from);
    });
    const output = [];
    const seen = new Set();
    const queue = [...(parents.get(text(step?.step_id)) || [])];
    while (queue.length) {
      const stepId = queue.shift();
      if (!stepId || seen.has(stepId)) continue;
      seen.add(stepId);
      output.push(stepId);
      queue.push(...(parents.get(stepId) || []));
    }
    return output;
  }

  function parseDefineValues(value) {
    if (Array.isArray(value)) return value;
    const source = text(value);
    if (!source) return [];
    try {
      const parsed = JSON.parse(source);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function variableNames(document, step, upstreamIds) {
    const names = [];
    const flow = flowForStep(document, step);
    (Array.isArray(flow?.start?.variables) ? flow.start.variables : [])
      .forEach((item) => {
        const name = text(item?.name);
        if (name) names.push(name);
      });
    const upstream = new Set(upstreamIds);
    stepEntries(document).forEach((candidate) => {
      if (
        !upstream.has(text(candidate.step_id)) ||
        text(candidate.action_id) !== "define_values"
      ) return;
      parseDefineValues(candidate?.params?.define_values).forEach((item) => {
        const name = text(item?.name);
        if (name) names.push(name);
      });
    });
    return Array.from(new Set(names));
  }

  function stateNodes(document) {
    return stepEntries(document).map((step) => ({
      id: text(step.step_id),
      stepName: text(step.step_id),
      connector: text(step.connector_id),
      action: text(step.action_id),
      form: {
        ...(clone(step.params || {})),
        schema: JSON.stringify(step?.schema?.columns || [], null, 2)
      }
    }));
  }

  function modeConnectors(catalog, modeId) {
    const allowed = new Set(catalog?.modes?.[modeId]?.connectorIds || []);
    return (catalog?.connectors || []).filter(
      (connector) => !allowed.size || allowed.has(connector.id)
    );
  }

  function createWorkflowPropertyContext(options = {}) {
    const session = options.session;
    const catalog = options.catalog;

    function getContext() {
      const snapshot = session.getSnapshot();
      const document = snapshot.document;
      const selection = session.adapter.getSelection();
      const nodeRefs = Array.isArray(selection?.nodes) ? selection.nodes : [];
      const common = {
        doc_session_id: snapshot.metadata.doc_session_id,
        running: session.isRunning(),
        selection: clone(selection),
        hidden_bindings: clone(options.getHiddenBindings?.() || {})
      };
      if (nodeRefs.length !== 1) return { ...common, kind: "empty" };
      const nodeRef = nodeRefs[0] || {};
      const nodeId = text(nodeRef.node_id);
      const flowId = text(nodeRef.flow_id);
      if (nodeId === "START" || nodeId === "END") {
        const flow = document?.flows?.[flowId] || null;
        return {
          ...common,
          kind: nodeId === "START" ? "start" : "end",
          node_ref: clone(nodeRef),
          flow_id: flowId,
          flow: clone(flow)
        };
      }
      const step = stepEntries(document).find(
        (candidate) => text(candidate.step_id) === nodeId
      );
      if (!step) return { ...common, kind: "empty" };
      const connectorId = text(step.connector_id);
      const actionId = text(step.action_id);
      const action = (catalog?.actions?.[connectorId] || [])
        .find((item) => item.id === actionId) || null;
      const upstreamIds = ancestorStepIds(document, step);
      return {
        ...common,
        kind: "step",
        node_ref: clone(nodeRef),
        step: clone(step),
        connectors: clone(modeConnectors(
          catalog,
          text(document?.metadata?.mode) || "dataflow"
        )),
        actions: clone(catalog?.actions?.[connectorId] || []),
        form_fields: clone(catalog?.forms?.[action?.formSchemaId] || []),
        action: clone(action),
        data_area_policy: clone(
          catalog?.dataAreaPolicies?.[action?.dataAreaPolicyId] || null
        ),
        execution_metadata_columns: clone(
          catalog?.executionMetadataColumns || []
        ),
        upstream_step_ids: upstreamIds,
        available_variable_names: variableNames(
          document,
          step,
          upstreamIds
        ),
        state_nodes: stateNodes(document),
        can_run: !text(step.loop_owner_id)
      };
    }

    async function applyInvalidation(result) {
      const stepIds = result?.invalidated_step_ids || [];
      if (stepIds.length) await options.onInvalidation?.(stepIds);
      return result;
    }

    async function updateStep(value = {}) {
      return applyInvalidation(
        session.commands.updateStep(value.step_id, value.changes || {})
      );
    }

    async function updateFlow(value = {}) {
      return applyInvalidation(
        session.commands.updateFlow(value.flow_id, value.changes || {})
      );
    }

    return Object.freeze({
      getContext,
      updateStep,
      updateFlow,
      runStep: (stepId) => session.startRun({ step_id: stepId }),
      updateSchema(stepId, columns) {
        return updateStep({
          step_id: stepId,
          changes: {
            schema: columns.length ? { columns: clone(columns) } : null
          }
        });
      }
    });
  }

  modules.createWorkflowPropertyContext = createWorkflowPropertyContext;
})(window);
