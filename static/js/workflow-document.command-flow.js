(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentCommandModules =
    packages.__workflowDocumentCommandModules || {};

  function positionY(document) {
    const values = [];
    Object.values(modules.asMap(document?.flows)).forEach((flow) => {
      values.push(Number(flow?.start?.ui_position?.y));
      values.push(Number(flow?.end?.ui_position?.y));
    });
    modules.stepEntries(document).forEach((entry) => {
      values.push(Number(entry.step?.ui_position?.y));
    });
    const finite = values.filter(Number.isFinite);
    return finite.length ? Math.max(120, Math.max(...finite) + 280) : 120;
  }

  function planAddFlow(document, catalog, allocateIds, value = {}) {
    const modeId = modules.text(
      value.modeId || document?.metadata?.mode || "dataflow"
    );
    const mode = catalog?.modes?.[modeId];
    if (!mode) {
      throw modules.createError(
        "E_CATALOG_MODE_NOT_FOUND",
        `mode '${modeId}'がcatalogに存在しません。`
      );
    }
    const connectorId = modules.text(
      mode.nodeDefaults?.initialConnectorId
    );
    const actionId = modules.text(mode.nodeDefaults?.initialActionId);
    const action = modules.requireAction(catalog, connectorId, actionId);
    const flowId = allocateIds({
      idKind: "flow",
      document,
      count: 1
    })[0];
    const stepId = allocateIds({
      idKind: "step",
      document,
      count: 1
    })[0];
    const y = positionY(document);
    const step = {
      step_id: stepId,
      flow_id: flowId,
      label: modules.text(action.label || actionId),
      connector_id: connectorId,
      action_id: actionId,
      ui_position: { x: 320, y }
    };
    const nodeType = modules.text(action.nodeType);
    if (nodeType && nodeType !== "task") step.node_type = nodeType;
    const flow = {
      label: modules.text(value.label) || `フロー ${flowId}`,
      start: {
        ui_position: { x: 80, y },
        variables: []
      },
      end: {
        ui_position: { x: 660, y }
      },
      edges: [
        { from: "START", to: stepId, order: 1 },
        { from: stepId, to: "END", order: 1 }
      ]
    };
    const patch = [];
    if (Array.isArray(document?.steps)) {
      patch.push({
        op: "add",
        path: ["steps", document.steps.length],
        value: step
      });
    } else {
      patch.push({ op: "add", path: ["steps"], value: [step] });
    }
    if (document?.flows && typeof document.flows === "object") {
      patch.push({ op: "add", path: ["flows", flowId], value: flow });
    } else {
      patch.push({ op: "add", path: ["flows"], value: { [flowId]: flow } });
    }
    if (!document?.metadata) {
      patch.push({
        op: "add",
        path: ["metadata"],
        value: { mode: modeId, default_flow_id: flowId }
      });
    } else if (!modules.text(document.metadata.default_flow_id)) {
      patch.push({
        op: Object.prototype.hasOwnProperty.call(
          document.metadata,
          "default_flow_id"
        ) ? "replace" : "add",
        path: ["metadata", "default_flow_id"],
        value: flowId
      });
    }
    return {
      patch,
      invalidated_step_ids: [],
      created: { flow_id: flowId, step_id: stepId }
    };
  }

  modules.planAddWorkflowFlow = planAddFlow;
})(window);
