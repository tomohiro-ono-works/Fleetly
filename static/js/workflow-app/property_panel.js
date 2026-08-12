(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

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

  function emptyState(rootElement, message) {
    rootElement.replaceChildren(
      element("div", "workflow-property-empty", message)
    );
  }

  function createWorkflowPropertyPanel(options = {}) {
    const mount = options.root;
    let refreshSequence = 0;

    function showError(error) {
      options.onError?.(error);
    }

    async function updateFlow(api, flowId, changes) {
      try {
        await api.updateFlow({ flow_id: flowId, changes });
        refresh();
      } catch (error) {
        showError(error);
      }
    }

    function renderVariables(api, context, host) {
      const flowId = text(context.flow_id);
      const variables = clone(context.flow?.start?.variables || []);
      const list = element("div", "workflow-start-variables");

      function commit() {
        void updateFlow(api, flowId, { start_variables: clone(variables) });
      }

      function renderRows() {
        list.innerHTML = "";
        variables.forEach((item, index) => {
          const row = element("div", "workflow-start-variable");
          const name = document.createElement("input");
          name.type = "text";
          name.value = text(item?.name);
          name.placeholder = "変数名";
          name.setAttribute("aria-label", "変数名");
          name.disabled = context.running;
          name.addEventListener("change", () => {
            variables[index] = {
              ...variables[index],
              name: text(name.value)
            };
            commit();
          });
          const value = document.createElement("input");
          value.type = "text";
          value.value = String(item?.value ?? "");
          value.placeholder = "値";
          value.setAttribute("aria-label", "値");
          value.disabled = context.running;
          value.addEventListener("change", () => {
            variables[index] = {
              ...variables[index],
              value: value.value
            };
            commit();
          });
          const remove = element("button", "workflow-property-icon-button");
          remove.type = "button";
          remove.title = "削除";
          remove.setAttribute("aria-label", "削除");
          remove.disabled = context.running;
          const icon = document.createElement("img");
          icon.src = "./icons/delete.svg";
          icon.alt = "";
          remove.appendChild(icon);
          remove.addEventListener("click", () => {
            variables.splice(index, 1);
            renderRows();
            commit();
          });
          row.append(name, value, remove);
          list.appendChild(row);
        });
      }

      const add = element("button", "workflow-property-command", "変数を追加");
      add.type = "button";
      add.disabled = context.running;
      add.addEventListener("click", () => {
        variables.push({ name: "", value: "" });
        renderRows();
      });
      renderRows();
      host.append(list, add);
    }

    function renderStart(api, context) {
      const header = element("div", "workflow-property-header");
      const heading = element("div", "workflow-property-heading");
      heading.append(
        element("strong", "", "開始"),
        element("span", "workflow-property-id", `flow ${context.flow_id}`)
      );
      header.appendChild(heading);
      const form = element("div", "workflow-property-form");
      const label = document.createElement("input");
      label.type = "text";
      label.value = text(context.flow?.label);
      label.disabled = context.running;
      label.addEventListener("change", () => {
        void updateFlow(api, context.flow_id, { label: text(label.value) });
      });
      const labelRow = element("div", "workflow-property-row");
      labelRow.append(element("label", "workflow-property-label", "フロー名"), label);
      const variables = element("section", "workflow-property-section");
      variables.appendChild(
        element("h3", "workflow-property-section-title", "開始変数")
      );
      renderVariables(api, context, variables);
      form.append(labelRow, variables);
      mount.replaceChildren(header, form);
    }

    function renderEnd(context) {
      const header = element("div", "workflow-property-header");
      const heading = element("div", "workflow-property-heading");
      heading.append(
        element("strong", "", "終了"),
        element("span", "workflow-property-id", `flow ${context.flow_id}`)
      );
      header.appendChild(heading);
      const body = element("div", "workflow-property-summary");
      body.append(
        element("span", "workflow-property-label", "フロー名"),
        element("strong", "", text(context.flow?.label))
      );
      mount.replaceChildren(header, body);
    }

    async function refresh() {
      const sequence = ++refreshSequence;
      const api = options.getActiveApi?.();
      if (!api?.getPropertyContext) {
        options.setCollapsed?.(true);
        emptyState(mount, "ワークフローを選択してください。");
        return;
      }
      try {
        const context = await api.getPropertyContext();
        if (sequence !== refreshSequence) return;
        if (!context || context.kind === "empty") {
          options.setCollapsed?.(true);
          emptyState(mount, "ノードを選択してください。");
          return;
        }
        options.setCollapsed?.(false);
        if (context.kind === "step") {
          modules.renderWorkflowStepProperty({
            root: mount,
            context,
            api,
            onRefresh: refresh,
            onError: showError
          });
        } else if (context.kind === "start") {
          renderStart(api, context);
        } else {
          renderEnd(context);
        }
      } catch (error) {
        if (sequence !== refreshSequence) return;
        showError(error);
        emptyState(mount, "詳細を表示できません。");
      }
    }

    emptyState(mount, "ノードを選択してください。");
    return Object.freeze({ refresh });
  }

  modules.createWorkflowPropertyPanel = createWorkflowPropertyPanel;
})(window);
