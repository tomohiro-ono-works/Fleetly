(function () {
  function getDialogElements() {
    return {
      root: document.getElementById("appDialog"),
      title: document.getElementById("appDialogTitle"),
      message: document.getElementById("appDialogMessage"),
      icon: document.getElementById("appDialogIcon"),
      actions: document.querySelector("#appDialog .app-dialog__actions"),
      cancel: document.getElementById("appDialogCancel"),
      ok: document.getElementById("appDialogOk"),
      extra: document.getElementById("appDialogExtra"),
    };
  }

  const dialogState = {
    resolver: null,
    choiceResolver: null,
    choiceValues: null,
    choiceCancelValue: "cancel",
    mode: "alert",
    lastActiveElement: null,
  };

  function ensureExtraButton() {
    const els = getDialogElements();
    if (!els.actions) return null;
    if (els.extra) return els.extra;
    const extra = document.createElement("button");
    extra.id = "appDialogExtra";
    extra.className = "app-dialog__button app-dialog__button--secondary";
    extra.type = "button";
    extra.hidden = true;
    extra.textContent = "追加";
    els.actions.insertBefore(extra, els.ok || null);
    return extra;
  }

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
    if (els.extra) els.extra.hidden = true;
    dialogState.resolver = null;
    dialogState.choiceResolver = null;
    dialogState.choiceValues = null;
    dialogState.choiceCancelValue = "cancel";
    dialogState.mode = "alert";
    const restoreTarget = dialogState.lastActiveElement;
    dialogState.lastActiveElement = null;
    if (restoreTarget instanceof HTMLElement) {
      window.requestAnimationFrame(() => restoreTarget.focus());
    }
  }

  function renderMessage(container, text, options) {
    container.innerHTML = "";
    container.classList.remove("app-dialog__message--kv");
    container.classList.remove("app-dialog__message--runlog");
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
    if (options?.format === "runlog") {
      const rows = Array.isArray(options?.logRows) ? options.logRows : [];
      container.classList.add("app-dialog__message--runlog");
      const table = document.createElement("div");
      table.className = "app-dialog__runlog";
      const head = document.createElement("div");
      head.className = "app-dialog__runlog-row app-dialog__runlog-row--head";
      ["日時", "ステータス", "内容"].forEach((label) => {
        const cell = document.createElement("span");
        cell.className = "app-dialog__runlog-cell";
        cell.textContent = label;
        head.appendChild(cell);
      });
      table.appendChild(head);
      rows.forEach((row) => {
        const line = document.createElement("div");
        line.className = "app-dialog__runlog-row";
        const at = document.createElement("span");
        at.className = "app-dialog__runlog-cell";
        at.textContent = String(row?.at || "");
        const status = document.createElement("span");
        const normalized = String(row?.status || "");
        status.className = `app-dialog__runlog-cell app-dialog__runlog-status app-dialog__runlog-status--${normalized === "失敗" ? "fail" : "ok"}`;
        status.textContent = normalized || "成功";
        const message = document.createElement("span");
        message.className = "app-dialog__runlog-cell";
        message.textContent = String(row?.message || "");
        line.appendChild(at);
        line.appendChild(status);
        line.appendChild(message);
        table.appendChild(line);
      });
      container.appendChild(table);
      return;
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
    if (els.ok) els.ok.textContent = "OK";
    if (els.cancel) els.cancel.textContent = "キャンセル";
    if (els.extra) els.extra.textContent = "追加";
    if (els.cancel) els.cancel.hidden = true;
    if (els.extra) els.extra.hidden = true;
    dialogState.mode = String(options?.mode || "alert");
    els.root.classList.add("is-open");
    els.root.setAttribute("aria-hidden", "false");
    els.ok?.focus?.();
  }

  function confirmDialog(message, options) {
    const els = getDialogElements();
    if (!els.root) {
      return Promise.resolve(window.confirm(String(message ?? "")));
    }
    return new Promise((resolve) => {
      dialogState.resolver = resolve;
      showDialog(message, { ...options, kind: options?.kind || "warning", mode: "confirm" });
      if (els.ok && options?.labels?.ok) {
        els.ok.textContent = String(options.labels.ok);
      }
      if (els.cancel) {
        els.cancel.textContent = String(options?.labels?.cancel || "キャンセル");
        els.cancel.hidden = false;
      }
      els.cancel?.focus?.();
    });
  }

  function chooseDialog(message, options = {}) {
    const els = getDialogElements();
    if (!els.root) {
      return Promise.resolve("cancel");
    }
    const values = options?.values && typeof options.values === "object"
      ? options.values
      : { ok: "save", cancel: "discard", extra: "cancel" };
    const labels = options?.labels && typeof options.labels === "object"
      ? options.labels
      : { ok: "保存", cancel: "保存しない", extra: "キャンセル" };
    const extraBtn = ensureExtraButton();
    return new Promise((resolve) => {
      dialogState.choiceResolver = resolve;
      dialogState.choiceValues = {
        ok: values.ok ?? "save",
        cancel: values.cancel ?? "discard",
        extra: values.extra ?? "cancel",
      };
      dialogState.choiceCancelValue = String(values.extra ?? "cancel");
      showDialog(message, { ...options, kind: options?.kind || "warning", mode: "choice" });
      if (els.ok) {
        els.ok.textContent = String(labels.ok || "OK");
        els.ok.hidden = false;
      }
      if (els.cancel) {
        els.cancel.textContent = String(labels.cancel || "キャンセル");
        els.cancel.hidden = false;
      }
      if (extraBtn) {
        extraBtn.textContent = String(labels.extra || "閉じる");
        extraBtn.hidden = false;
      }
      extraBtn?.focus?.();
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

  function settleChoice(result) {
    if (typeof dialogState.choiceResolver === "function") {
      const resolve = dialogState.choiceResolver;
      dialogState.choiceResolver = null;
      resolve(result);
    }
    closeDialog();
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.id === "appDialogOk") {
      if (dialogState.mode === "choice") {
        settleChoice(dialogState.choiceValues?.ok ?? "save");
        return;
      }
      if (dialogState.mode === "confirm") {
        settleConfirm(true);
        return;
      }
      closeDialog();
      return;
    }
    if (target.id === "appDialogCancel") {
      if (dialogState.mode === "choice") {
        settleChoice(dialogState.choiceValues?.cancel ?? "discard");
        return;
      }
      settleConfirm(false);
      return;
    }
    if (target.id === "appDialogExtra") {
      if (dialogState.mode === "choice") {
        settleChoice(dialogState.choiceValues?.extra ?? "cancel");
        return;
      }
      closeDialog();
      return;
    }
    if (target.hasAttribute("data-app-dialog-close")) {
      if (dialogState.mode === "choice") {
        settleChoice(dialogState.choiceCancelValue || "cancel");
        return;
      }
      if (dialogState.mode === "confirm") {
        settleConfirm(false);
        return;
      }
      closeDialog();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (dialogState.mode === "choice") {
        settleChoice(dialogState.choiceCancelValue || "cancel");
        return;
      }
      closeDialog();
    }
  });

  const dialogApi = {
    show: showDialog,
    confirm: confirmDialog,
    choose: chooseDialog,
    close: closeDialog,
  };
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.dialog = dialogApi;
})();
