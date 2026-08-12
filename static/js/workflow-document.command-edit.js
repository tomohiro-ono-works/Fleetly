(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDocumentCommandModules =
    packages.__workflowDocumentCommandModules || {};

  function sameValue(left, right) {
    if (Object.is(left, right)) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object") {
      return false;
    }
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => (
      Object.prototype.hasOwnProperty.call(right, key) &&
      sameValue(left[key], right[key])
    ));
  }

  function requireChanges(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw modules.createError("E_PROPERTY_INVALID", "changesは辞書で指定してください。");
    }
    const unknown = Object.keys(value).filter((key) => !allowed.has(key));
    if (unknown.length) {
      throw modules.createError(
        "E_PROPERTY_INVALID",
        `変更できないpropertyです: ${unknown.join(", ")}`
      );
    }
  }

  function fieldPatch(patch, target, path, key, nextValue) {
    const exists = Object.prototype.hasOwnProperty.call(target, key);
    if (nextValue === null) {
      if (exists) patch.push({ op: "remove", path });
      return;
    }
    if (sameValue(target[key], nextValue)) return;
    patch.push({
      op: exists ? "replace" : "add",
      path,
      value: modules.cloneValue(nextValue)
    });
  }

  function assertOptionalMap(value, name) {
    if (
      value !== null &&
      (!value || typeof value !== "object" || Array.isArray(value))
    ) {
      throw modules.createError(
        "E_PROPERTY_INVALID",
        `${name}は辞書またはnullで指定してください。`
      );
    }
  }

  function planUpdateStep(document, catalog, stepId, changes) {
    const allowed = new Set([
      "label",
      "description",
      "connector_id",
      "action_id",
      "params",
      "schema"
    ]);
    requireChanges(changes, allowed);
    const entry = modules.requireStep(document, stepId);
    const step = entry.step;
    const patch = [];
    if (Object.prototype.hasOwnProperty.call(changes, "label")) {
      const label = modules.text(changes.label);
      if (!label) {
        throw modules.createError("E_PROPERTY_INVALID", "labelは空にできません。");
      }
      fieldPatch(patch, step, ["steps", entry.index, "label"], "label", label);
    }
    if (Object.prototype.hasOwnProperty.call(changes, "description")) {
      const description = changes.description === null
        ? null
        : String(changes.description);
      fieldPatch(
        patch,
        step,
        ["steps", entry.index, "description"],
        "description",
        description
      );
    }
    ["params", "schema"].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(changes, field)) return;
      assertOptionalMap(changes[field], field);
      fieldPatch(
        patch,
        step,
        ["steps", entry.index, field],
        field,
        changes[field]
      );
    });

    const connectorChanged = Object.prototype.hasOwnProperty.call(
      changes,
      "connector_id"
    );
    const actionChanged = Object.prototype.hasOwnProperty.call(
      changes,
      "action_id"
    );
    if (connectorChanged || actionChanged) {
      const connectorId = modules.text(
        connectorChanged ? changes.connector_id : step.connector_id
      );
      const actionId = modules.text(
        actionChanged ? changes.action_id : step.action_id
      );
      if (!connectorId || !actionId) {
        throw modules.createError(
          "E_PROPERTY_INVALID",
          "connector_idとaction_idは空にできません。"
        );
      }
      const action = modules.requireAction(catalog, connectorId, actionId);
      const nextNodeType = modules.text(action.nodeType) || "task";
      const currentNodeType = modules.text(step.node_type) || "task";
      if (currentNodeType === "loop" && nextNodeType !== "loop") {
        const children = modules.stepEntries(document)
          .filter((item) => modules.text(item.step?.loop_owner_id) === entry.id);
        if (children.length) {
          throw modules.createError(
            "E_PROPERTY_LOOP_CHILDREN",
            "loop内部stepを削除してからactionを変更してください。"
          );
        }
        if (document?.loop?.flows?.[entry.id]) {
          patch.push({
            op: "remove",
            path: ["loop", "flows", entry.id]
          });
        }
      }
      if (
        currentNodeType !== "loop" &&
        nextNodeType === "loop" &&
        !document?.loop?.flows?.[entry.id]
      ) {
        if (!document?.loop) {
          patch.push({
            op: "add",
            path: ["loop"],
            value: { flows: { [entry.id]: { edges: [] } } }
          });
        } else if (!document.loop?.flows) {
          patch.push({
            op: "add",
            path: ["loop", "flows"],
            value: { [entry.id]: { edges: [] } }
          });
        } else {
          patch.push({
            op: "add",
            path: ["loop", "flows", entry.id],
            value: { edges: [] }
          });
        }
      }
      fieldPatch(
        patch,
        step,
        ["steps", entry.index, "connector_id"],
        "connector_id",
        connectorId
      );
      fieldPatch(
        patch,
        step,
        ["steps", entry.index, "action_id"],
        "action_id",
        actionId
      );
      fieldPatch(
        patch,
        step,
        ["steps", entry.index, "node_type"],
        "node_type",
        nextNodeType === "task" ? null : nextNodeType
      );
    }
    const impacting = connectorChanged || actionChanged ||
      Object.prototype.hasOwnProperty.call(changes, "params") ||
      Object.prototype.hasOwnProperty.call(changes, "schema");
    return {
      patch,
      invalidated_step_ids: impacting
        ? modules.invalidationForStep(document, entry.id)
        : []
    };
  }

  function planUpdateFlow(document, flowId, changes) {
    requireChanges(changes, new Set(["label", "start_variables"]));
    const id = modules.text(flowId);
    const flow = modules.asMap(document?.flows)[id];
    if (!flow) {
      throw modules.createError("E_FLOW_NOT_FOUND", `flow '${id}'が存在しません。`);
    }
    const patch = [];
    if (Object.prototype.hasOwnProperty.call(changes, "label")) {
      const label = modules.text(changes.label);
      if (!label) {
        throw modules.createError("E_PROPERTY_INVALID", "labelは空にできません。");
      }
      fieldPatch(patch, flow, ["flows", id, "label"], "label", label);
    }
    let invalidated = [];
    if (Object.prototype.hasOwnProperty.call(changes, "start_variables")) {
      if (!Array.isArray(changes.start_variables)) {
        throw modules.createError(
          "E_PROPERTY_INVALID",
          "start_variablesは配列で指定してください。"
        );
      }
      const start = flow.start || {};
      if (!flow.start) {
        patch.push({
          op: "add",
          path: ["flows", id, "start"],
          value: { variables: modules.cloneValue(changes.start_variables) }
        });
      } else {
        fieldPatch(
          patch,
          start,
          ["flows", id, "start", "variables"],
          "variables",
          changes.start_variables
        );
      }
      invalidated = modules.stepEntries(document)
        .filter((entry) => modules.text(entry.step?.flow_id) === id)
        .map((entry) => entry.id);
    }
    return { patch, invalidated_step_ids: invalidated };
  }

  function planUpdateMetadata(document, changes) {
    requireChanges(changes, new Set(["name", "default_flow_id"]));
    const metadata = document?.metadata && typeof document.metadata === "object"
      ? document.metadata
      : null;
    const patch = [];
    Object.entries(changes).forEach(([key, value]) => {
      const normalized = modules.text(value);
      if (
        key === "default_flow_id" &&
        normalized &&
        !Object.prototype.hasOwnProperty.call(
          modules.asMap(document?.flows),
          normalized
        )
      ) {
        throw modules.createError(
          "E_FLOW_NOT_FOUND",
          `flow '${normalized}'が存在しません。`
        );
      }
      if (!metadata) {
        patch.push({
          op: "add",
          path: ["metadata"],
          value: { mode: "dataflow", [key]: normalized }
        });
        return;
      }
      fieldPatch(
        patch,
        metadata,
        ["metadata", key],
        key,
        normalized
      );
    });
    return { patch, invalidated_step_ids: [] };
  }

  Object.assign(modules, {
    planUpdateWorkflowFlow: planUpdateFlow,
    planUpdateWorkflowMetadata: planUpdateMetadata,
    planUpdateWorkflowStep: planUpdateStep
  });
})(window);
