(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const app = packages.app = packages.app || {};
  const modules = packages.__workflowAppModules =
    packages.__workflowAppModules || {};

  const COMMANDS = Object.freeze([
    {
      id: "flow.add",
      label: "フローを追加",
      icon: "./icons/workflow.svg",
      region: "topbar"
    },
    {
      id: "document.undo",
      label: "元に戻す",
      icon: "./icons/undo.svg",
      region: "topbar"
    },
    {
      id: "document.redo",
      label: "やり直す",
      icon: "./icons/redo.svg",
      region: "topbar"
    },
    {
      id: "run.start",
      label: "実行",
      icon: "./icons/run.svg",
      region: "topbar"
    },
    {
      id: "run.cancel",
      label: "キャンセル",
      icon: "./icons/closel.svg",
      region: "topbar"
    },
    {
      id: "document.save",
      label: "保存",
      icon: "./icons/save.svg",
      region: "topbar"
    }
  ]);

  function createTitleControl() {
    const wrapper = document.createElement("label");
    wrapper.className = "workflow-document-title";
    wrapper.setAttribute("aria-label", "document名");
    const input = document.createElement("input");
    input.id = "flowName";
    input.className = "workflow-document-title__input";
    input.type = "text";
    input.placeholder = "document名";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.addEventListener("change", () => {
      root.dispatchEvent(new CustomEvent("ziz:workflow-title-change", {
        detail: { name: String(input.value || "").trim() }
      }));
    });
    wrapper.appendChild(input);
    return wrapper;
  }

  function configureWorkflowWorkspaceShell() {
    const shell = app.shell?.instance;
    if (!shell || typeof shell.setCommands !== "function") return null;
    const titleControl = createTitleControl();
    shell.setRegion("topbar", titleControl);
    shell.setCommands(COMMANDS);
    const unsubscribe = shell.on("command:execute", (payload) => {
      root.dispatchEvent(new CustomEvent("ziz:workflow-shell-command", {
        detail: payload
      }));
    });
    return Object.freeze({
      setTitle(value) {
        const input = titleControl.querySelector("input");
        if (input && document.activeElement !== input) {
          input.value = String(value || "");
        }
      },
      destroy() {
        unsubscribe();
        shell.setCommands([]);
        shell.setRegion("topbar", null);
      }
    });
  }

  modules.configureWorkflowWorkspaceShell =
    configureWorkflowWorkspaceShell;
})(window);
