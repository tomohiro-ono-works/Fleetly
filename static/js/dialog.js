(function () {
  function getDialogElements() {
    return {
      root: document.getElementById("appDialog"),
      title: document.getElementById("appDialogTitle"),
      message: document.getElementById("appDialogMessage"),
      icon: document.getElementById("appDialogIcon"),
      cancel: document.getElementById("appDialogCancel"),
      ok: document.getElementById("appDialogOk"),
    };
  }

  const dialogState = {
    resolver: null,
    mode: "alert",
    lastActiveElement: null,
  };

  function closeDialog() {
    const els = getDialogElements();
    if (!els.root) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && els.root.contains(active)) {
      active.blur();
    }
    els.root.classList.remove("is-open", "app-dialog--error", "app-dialog--warning", "app-dialog--success");
    els.root.setAttribute("aria-hidden", "true");
    if (els.cancel) els.cancel.hidden = true;
    dialogState.mode = "alert";
    const restoreTarget = dialogState.lastActiveElement;
    dialogState.lastActiveElement = null;
    if (restoreTarget instanceof HTMLElement) {
      window.requestAnimationFrame(() => restoreTarget.focus());
    }
  }

  function renderMessage(container, text, options) {
    container.innerHTML = "";
    if (options?.format === "kv") {
      const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const rows = lines
        .map((line) => {
          const idx = line.indexOf(":");
          if (idx < 0) return null;
          return {
            key: line.slice(0, idx + 1).trim(),
            value: line.slice(idx + 1).trim(),
          };
        })
        .filter(Boolean);
      if (rows.length) {
        container.classList.add("app-dialog__message--kv");
        rows.forEach((row) => {
          const item = document.createElement("div");
          item.className = "app-dialog__kv-row";
          const key = document.createElement("span");
          key.className = "app-dialog__kv-key";
          key.textContent = row.key;
          const value = document.createElement("span");
          value.className = "app-dialog__kv-value";
          value.textContent = row.value;
          item.appendChild(key);
          item.appendChild(value);
          container.appendChild(item);
        });
        return;
      }
    }
    container.classList.remove("app-dialog__message--kv");
    container.textContent = text;
  }

  function showDialog(message, options) {
    const els = getDialogElements();
    if (!els.root) {
      window.console?.warn?.("dialog root not found");
      return;
    }
    const kind = String(options?.kind || "info");
    const title = String(options?.title || "お知らせ");
    const text = String(message ?? "");
    const iconMap = {
      info: "i",
      error: "!",
      warning: "!",
      success: "✓",
    };
    dialogState.lastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    els.root.classList.remove("app-dialog--error", "app-dialog--warning", "app-dialog--success");
    if (kind === "error") els.root.classList.add("app-dialog--error");
    if (kind === "warning") els.root.classList.add("app-dialog--warning");
    if (kind === "success") els.root.classList.add("app-dialog--success");
    els.title.textContent = title;
    renderMessage(els.message, text, options);
    els.icon.textContent = iconMap[kind] || "i";
    if (els.cancel) els.cancel.hidden = true;
    dialogState.mode = "alert";
    els.root.classList.add("is-open");
    els.root.setAttribute("aria-hidden", "false");
    els.ok?.focus?.();
  }

  function confirmDialog(message, options) {
    const els = getDialogElements();
    if (!els.root) {
      return Promise.resolve(window.confirm(String(message ?? "")));
    }
    dialogState.mode = "confirm";
    return new Promise((resolve) => {
      dialogState.resolver = resolve;
      showDialog(message, { ...options, kind: options?.kind || "warning" });
      if (els.cancel) els.cancel.hidden = false;
      els.cancel?.focus?.();
    });
  }

  function settleConfirm(result) {
    if (typeof dialogState.resolver === "function") {
      const resolve = dialogState.resolver;
      dialogState.resolver = null;
      resolve(!!result);
    }
    closeDialog();
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "appDialogOk") {
      if (dialogState.mode === "confirm") {
        settleConfirm(true);
        return;
      }
      closeDialog();
      return;
    }
    if (target.id === "appDialogCancel") {
      settleConfirm(false);
      return;
    }
    if (target.hasAttribute("data-app-dialog-close")) {
      if (dialogState.mode === "confirm") {
        settleConfirm(false);
        return;
      }
      closeDialog();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDialog();
    }
  });

  const dialogApi = {
    show: showDialog,
    confirm: confirmDialog,
    close: closeDialog,
  };
  window.zizDialog = dialogApi;
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.dialog = dialogApi;
})();
