(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};
  let nextImportRequestId = 1;

  function text(value) {
    return String(value ?? "").trim();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function element(tag, className, content = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content) node.textContent = content;
    return node;
  }

  function fieldRow(label, control) {
    const row = element("div", "workflow-property-row");
    row.append(element("label", "workflow-property-label", label), control);
    return row;
  }

  function iconButton(icon, label) {
    const button = element("button", "workflow-property-icon-button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    button.appendChild(image);
    return button;
  }

  function requestTabularImport(value = {}) {
    const requestId = `workflow-property-import:${nextImportRequestId++}`;
    return new Promise((resolve, reject) => {
      function cleanup() {
        root.removeEventListener("zizai:tabular-import-response", onResponse);
      }
      function onResponse(event) {
        const detail = event?.detail || {};
        if (text(detail.requestId) !== requestId) return;
        cleanup();
        if (detail.status === "confirmed") resolve(detail.result || {});
        else if (detail.status === "cancelled") resolve(null);
        else reject(new Error(text(detail.message) || "取込に失敗しました。"));
      }
      root.addEventListener("zizai:tabular-import-response", onResponse);
      const detail = { ...value, requestId, handled: false };
      root.dispatchEvent(new CustomEvent(
        "zizai:tabular-import-request",
        { detail }
      ));
      if (!detail.handled) {
        cleanup();
        reject(new Error("表データ取込adapterを利用できません。"));
      }
    });
  }

  function renderWorkflowStepProperty(options = {}) {
    const mount = options.root;
    const context = options.context;
    const api = options.api;
    const step = context.step || {};
    const uiFields = packages.ui?.fields || null;
    const draft = {
      id: text(step.step_id),
      stepName: text(step.step_id),
      connector: text(step.connector_id),
      action: text(step.action_id),
      form: clone(step.params || {}),
      docSessionId: text(context.doc_session_id)
    };
    const hiddenBindings = clone(context.hidden_bindings || {});
    let committing = false;
    let commitQueued = false;

    async function updateStep(changes) {
      try {
        await api.updateStep({
          step_id: text(step.step_id),
          changes
        });
        options.onRefresh?.();
      } catch (error) {
        options.onError?.(error);
      }
    }

    async function commitParams() {
      if (committing) {
        commitQueued = true;
        return;
      }
      committing = true;
      try {
        do {
          commitQueued = false;
          api.mergeHiddenBindings?.(hiddenBindings);
          await api.updateStep({
            step_id: text(step.step_id),
            changes: { params: clone(draft.form) }
          });
        } while (commitQueued);
        options.onRefresh?.();
      } catch (error) {
        options.onError?.(error);
      } finally {
        committing = false;
      }
    }

    const header = element("div", "workflow-property-header");
    const heading = element("div", "workflow-property-heading");
    heading.append(
      element("strong", "", text(step.label) || `step ${step.step_id}`),
      element("span", "workflow-property-id", `ID ${step.step_id}`)
    );
    const actions = element("div", "workflow-property-actions");
    const runButton = iconButton("./icons/run.svg", "このステップを実行");
    runButton.disabled = context.running || !context.can_run;
    runButton.addEventListener("click", async () => {
      try {
        await api.runStep(text(step.step_id));
      } catch (error) {
        options.onError?.(error);
      }
    });
    actions.appendChild(runButton);

    const detailModal = context.action?.detailModal;
    if (detailModal?.type) {
      const importButton = iconButton("./icons/import.svg", detailModal.label || "取込");
      importButton.disabled = context.running;
      importButton.addEventListener("click", async () => {
        const fieldMap = detailModal.resultFieldMap || {};
        const pathKey = fieldMap.fileName || "file_path";
        try {
          const result = await requestTabularImport({
            formatId: text(detailModal.type),
            stepName: text(step.step_id),
            fieldKey: pathKey,
            currentValue: text(draft.form[pathKey]),
            hiddenBindings,
            workspaceTabId: text(context.doc_session_id)
          });
          if (!result) return;
          let importedSchema = null;
          Object.entries(fieldMap).forEach(([resultKey, formKey]) => {
            if (!formKey ||
              !Object.prototype.hasOwnProperty.call(result, resultKey)) return;
            if (formKey === "schema") {
              const parsed = JSON.parse(String(result[resultKey] || "[]"));
              importedSchema = Array.isArray(parsed) ? parsed : [];
              return;
            }
            draft.form[formKey] = result[resultKey];
          });
          const changes = { params: clone(draft.form) };
          api.mergeHiddenBindings?.(hiddenBindings);
          if (importedSchema !== null) {
            changes.schema = importedSchema.length
              ? { columns: importedSchema }
              : null;
          }
          await api.updateStep({
            step_id: text(step.step_id),
            changes
          });
          options.onRefresh?.();
        } catch (error) {
          options.onError?.(error);
        }
      });
      actions.appendChild(importButton);
    }
    header.append(heading, actions);

    const form = element("div", "workflow-property-form");
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = text(step.label);
    labelInput.disabled = context.running;
    labelInput.addEventListener("change", () => {
      void updateStep({ label: text(labelInput.value) });
    });
    form.appendChild(fieldRow("表示名", labelInput));

    const description = document.createElement("textarea");
    description.value = String(step.description || "");
    description.disabled = context.running;
    description.addEventListener("change", () => {
      void updateStep({ description: description.value || null });
    });
    form.appendChild(fieldRow("説明", description));

    const connectorSelect = document.createElement("select");
    (context.connectors || []).forEach((connector) => {
      const option = document.createElement("option");
      option.value = connector.id;
      option.textContent = connector.label;
      option.selected = connector.id === step.connector_id;
      connectorSelect.appendChild(option);
    });
    connectorSelect.disabled = context.running;
    connectorSelect.addEventListener("change", () => {
      const connector = (context.connectors || [])
        .find((item) => item.id === connectorSelect.value);
      void updateStep({
        connector_id: connectorSelect.value,
        action_id: connector?.actionIds?.[0] || "",
        params: null
      });
    });
    form.appendChild(fieldRow("コネクタ", connectorSelect));

    const actionSelect = document.createElement("select");
    (context.actions || []).forEach((action) => {
      const option = document.createElement("option");
      option.value = action.id;
      option.textContent = action.label;
      option.selected = action.id === step.action_id;
      actionSelect.appendChild(option);
    });
    actionSelect.disabled = context.running;
    actionSelect.addEventListener("change", () => {
      void updateStep({ action_id: actionSelect.value, params: null });
    });
    form.appendChild(fieldRow("アクション", actionSelect));

    const fieldHost = element("div", "workflow-property-fields");
    const state = {
      nodes: clone(context.state_nodes || []),
      __runAllRunning: context.running
    };
    (context.form_fields || [])
      .filter((field) => !["schema", "schema_add_description"].includes(field.key))
      .forEach((field) => {
        if (!uiFields?.renderField) return;
        fieldHost.appendChild(uiFields.renderField({
          node: draft,
          field: clone(field),
          upstreamSteps: context.upstream_step_ids || [],
          availableVariableNames: context.available_variable_names || [],
          hiddenBindings,
          state,
          config: {},
          onStateChanged: commitParams
        }));
      });
    form.appendChild(fieldHost);
    mount.replaceChildren(header, form);
  }

  modules.renderWorkflowStepProperty = renderWorkflowStepProperty;
})(window);
