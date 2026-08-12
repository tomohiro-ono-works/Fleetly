(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__workflowDesignerModules =
    packages.__workflowDesignerModules || {};

  function createFeedback(shell) {
    let messageTimer = 0;

    function showMessage(text, level = "info") {
      window.clearTimeout(messageTimer);
      shell.message.textContent = String(text || "");
      shell.message.dataset.level = String(level || "info");
      shell.message.hidden = !shell.message.textContent;
      if (!shell.message.hidden) {
        messageTimer = window.setTimeout(() => {
          shell.message.hidden = true;
        }, 3200);
      }
    }

    function showContextMenu(items, point) {
      shell.menu.innerHTML = "";
      (Array.isArray(items) ? items : []).forEach((item) => {
        const button = modules.createWorkflowElement(
          "button",
          "zwd-context-menu__item",
          {
            type: "button",
            role: "menuitem",
            "data-context-command": item.commandId
          }
        );
        button.textContent = String(item.label || item.commandId);
        shell.menu.appendChild(button);
      });
      shell.menu.style.left = `${point.x}px`;
      shell.menu.style.top = `${point.y}px`;
      shell.menu.hidden = !shell.menu.childElementCount;
    }

    function hideContextMenu() {
      shell.menu.hidden = true;
    }

    function destroy() {
      window.clearTimeout(messageTimer);
      shell.menu.innerHTML = "";
      shell.message.hidden = true;
    }

    return Object.freeze({
      showMessage,
      showContextMenu,
      hideContextMenu,
      destroy
    });
  }

  modules.createWorkflowFeedback = createFeedback;
})(window);
