(function () {
  const TERMINAL_EVENTS = new Set([
    "run.completed",
    "run.failed",
    "run.cancelled"
  ]);

  function text(value) {
    return String(value ?? "").trim();
  }

  function createError(message, code = "E_VALIDATION") {
    const error = new Error(String(message || "入力内容が不正です。"));
    error.code = code;
    return error;
  }

  function actionKey(action) {
    return `${action.connectorId}::${action.id}`;
  }

  function createOption(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  function createIconButton({ action, title, icon, label = "" }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "standalone-toolbar-button";
    button.dataset.action = action;
    button.title = title;
    button.setAttribute("aria-label", title);
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    image.setAttribute("aria-hidden", "true");
    button.appendChild(image);
    if (label) {
      const span = document.createElement("span");
      span.textContent = label;
      button.appendChild(span);
    }
    return button;
  }

  function create(options = {}) {
    const toolbarHost = options.toolbarHost;
    const panelHost = options.panelHost;
    const resultHost = options.resultHost;
    const catalog = window.zizPackages?.app?.catalog || null;
    const runs = window.zizPackages?.app?.runs || null;
    const workspace = window.zizPackages?.app?.workspace || null;
    const formFactory = window.zizPackages?.app?.standaloneForm || null;
    const resultFactory = window.zizPackages?.app?.standaloneResultView || null;
    if (
      !(toolbarHost instanceof HTMLElement)
      || !(panelHost instanceof HTMLElement)
      || !(resultHost instanceof HTMLElement)
      || !catalog
      || !runs
      || !workspace
      || !formFactory
      || !resultFactory
    ) {
      throw new Error("standalone UIの依存関係が初期化されていません。");
    }

    const docSessionId = text(options.docSessionId);
    const extension = text(options.extension).toLowerCase().replace(/^\./, "");
    const hiddenBindings = options.hiddenBindings || {};
    const state = {
      destroyed: false,
      ready: false,
      starting: false,
      activeRunId: "",
      status: "idle",
      actions: [],
      exportActions: [],
      selectedConnectorId: "",
      selectedActionKey: "",
      selectedExportKey: "",
      exportEnabled: false,
      paramsOpen: true,
      actionValues: new Map(),
      exportValues: new Map(),
      actionForm: null,
      exportForm: null,
      pendingEvents: [],
      terminalWaiters: []
    };

    const controls = document.createElement("div");
    controls.className = "standalone-controls";
    const connectorSelect = document.createElement("select");
    connectorSelect.className = "standalone-connector-select";
    connectorSelect.title = "connector";
    connectorSelect.setAttribute("aria-label", "connector");
    const actionSelect = document.createElement("select");
    actionSelect.className = "standalone-action-select";
    actionSelect.title = "action";
    actionSelect.setAttribute("aria-label", "action");

    const exportLabel = document.createElement("label");
    exportLabel.className = "standalone-export-toggle";
    const exportCheckbox = document.createElement("input");
    exportCheckbox.type = "checkbox";
    const exportText = document.createElement("span");
    exportText.textContent = "Excel出力";
    exportLabel.append(exportCheckbox, exportText);

    const settingsButton = createIconButton({
      action: "settings",
      title: "実行設定",
      icon: "./icons/form.svg"
    });
    const dryRunButton = createIconButton({
      action: "dry-run",
      title: "ドライラン (Ctrl+Shift+Enter)",
      icon: "./icons/healthcheck.svg",
      label: "検証"
    });
    const runButton = createIconButton({
      action: "run",
      title: "実行 (Ctrl+Enter)",
      icon: "./icons/run.svg",
      label: "実行"
    });
    const cancelButton = createIconButton({
      action: "cancel",
      title: "キャンセル",
      icon: "./icons/closel.svg",
      label: "停止"
    });
    cancelButton.hidden = true;
    const statusLabel = document.createElement("span");
    statusLabel.className = "standalone-toolbar-status";
    controls.append(
      connectorSelect,
      actionSelect,
      exportLabel,
      settingsButton,
      dryRunButton,
      runButton,
      cancelButton,
      statusLabel
    );
    toolbarHost.prepend(controls);

    panelHost.className = "standalone-params-panel";
    const sourceFormSection = document.createElement("section");
    const sourceFormTitle = document.createElement("h3");
    sourceFormTitle.textContent = "実行パラメータ";
    const sourceFormHost = document.createElement("div");
    sourceFormSection.append(sourceFormTitle, sourceFormHost);
    const exportFormSection = document.createElement("section");
    exportFormSection.hidden = true;
    const exportFormTitle = document.createElement("h3");
    exportFormTitle.textContent = "Excel出力";
    const exportActionSelect = document.createElement("select");
    exportActionSelect.className = "standalone-export-action-select";
    exportActionSelect.title = "Excel出力action";
    exportActionSelect.setAttribute("aria-label", "Excel出力action");
    const exportFormHost = document.createElement("div");
    exportFormSection.append(exportFormTitle, exportActionSelect, exportFormHost);
    panelHost.append(sourceFormSection, exportFormSection);

    const resultView = resultFactory.create({
      host: resultHost
    });

    function notifyRunningChange() {
      if (typeof options.onRunningChange === "function") {
        options.onRunningChange(isRunning());
      }
    }

    function getConfig() {
      return catalog.getConfig() || {};
    }

    function getSelectedAction() {
      return state.actions.find(
        (action) => actionKey(action) === state.selectedActionKey
      ) || null;
    }

    function getSelectedExportAction() {
      return state.exportActions.find(
        (action) => actionKey(action) === state.selectedExportKey
      ) || null;
    }

    function getValuesStore(map, key) {
      if (!map.has(key)) map.set(key, {});
      return map.get(key);
    }

    function buildAvailableActions(config) {
      return Object.values(config.actions || {})
        .flat()
        .filter((action) => (
          action.standaloneAllowed === true
          && action.standaloneDocument
          && action.standaloneDocument.extensions.includes(extension)
        ));
    }

    function buildExportActions(config) {
      return Object.values(config.actions || {})
        .flat()
        .filter((action) => (
          action.exportAllowed === true
          && action.standaloneExportModes.includes("excel")
        ));
    }

    function connectorLabel(connectorId) {
      return getConfig().connectors?.find(
        (connector) => connector.id === connectorId
      )?.label || connectorId;
    }

    function refreshConnectorOptions() {
      const connectorIds = [...new Set(
        state.actions.map((action) => action.connectorId)
      )];
      connectorSelect.replaceChildren();
      connectorIds.forEach((connectorId) => {
        connectorSelect.appendChild(createOption(
          connectorId,
          connectorLabel(connectorId)
        ));
      });
      if (!connectorIds.includes(state.selectedConnectorId)) {
        state.selectedConnectorId = connectorIds[0] || "";
      }
      connectorSelect.value = state.selectedConnectorId;
      connectorSelect.hidden = connectorIds.length <= 1;
    }

    function refreshActionOptions() {
      const candidates = state.actions.filter(
        (action) => action.connectorId === state.selectedConnectorId
      );
      actionSelect.replaceChildren();
      candidates.forEach((action) => {
        actionSelect.appendChild(createOption(actionKey(action), action.label));
      });
      if (!candidates.some(
        (action) => actionKey(action) === state.selectedActionKey
      )) {
        state.selectedActionKey = candidates.length
          ? actionKey(candidates[0])
          : "";
      }
      actionSelect.value = state.selectedActionKey;
      actionSelect.hidden = candidates.length <= 1;
    }

    function destroyForms() {
      state.actionForm?.destroy?.();
      state.exportForm?.destroy?.();
      state.actionForm = null;
      state.exportForm = null;
    }

    function renderExportForm(config) {
      state.exportForm?.destroy?.();
      state.exportForm = null;
      const sourceAction = getSelectedAction();
      const canExport = (
        sourceAction?.standaloneResultModes?.includes("excel")
        && state.exportActions.length > 0
      );
      exportLabel.hidden = !canExport;
      if (!canExport) {
        state.exportEnabled = false;
        exportCheckbox.checked = false;
      }
      exportFormSection.hidden = !state.exportEnabled;
      if (!state.exportEnabled) {
        exportFormHost.replaceChildren();
        return;
      }

      exportActionSelect.replaceChildren();
      state.exportActions.forEach((action) => {
        exportActionSelect.appendChild(createOption(
          actionKey(action),
          `${connectorLabel(action.connectorId)} / ${action.label}`
        ));
      });
      if (!state.exportActions.some(
        (action) => actionKey(action) === state.selectedExportKey
      )) {
        state.selectedExportKey = actionKey(state.exportActions[0]);
      }
      exportActionSelect.value = state.selectedExportKey;
      exportActionSelect.hidden = state.exportActions.length <= 1;
      const exportAction = getSelectedExportAction();
      if (!exportAction) return;
      state.exportForm = formFactory.create({
        host: exportFormHost,
        connectorId: exportAction.connectorId,
        actionId: exportAction.id,
        docSessionId,
        fields: config.forms?.[exportAction.formSchemaId] || [],
        values: getValuesStore(
          state.exportValues,
          actionKey(exportAction)
        ),
        excludeKeys: ["input_data"],
        hiddenBindings,
        config
      });
    }

    function renderActionForm() {
      const config = getConfig();
      const action = getSelectedAction();
      destroyForms();
      if (!action) {
        sourceFormHost.replaceChildren();
        panelHost.hidden = true;
        return;
      }
      const sourceParam = action.standaloneDocument?.sourceParam || "";
      state.actionForm = formFactory.create({
        host: sourceFormHost,
        connectorId: action.connectorId,
        actionId: action.id,
        docSessionId,
        fields: config.forms?.[action.formSchemaId] || [],
        values: getValuesStore(state.actionValues, actionKey(action)),
        excludeKeys: sourceParam ? [sourceParam] : [],
        hiddenBindings,
        config
      });
      renderExportForm(config);
      const fieldCount = (
        state.actionForm.getFieldCount()
        + (state.exportForm?.getFieldCount?.() || 0)
      );
      settingsButton.hidden = fieldCount === 0;
      panelHost.hidden = fieldCount === 0 || !state.paramsOpen;
      updateControls();
    }

    function updateControls() {
      const action = getSelectedAction();
      const running = isRunning();
      const dryRunSupported = action?.dryRun?.supported === true;
      connectorSelect.disabled = running;
      actionSelect.disabled = running;
      exportCheckbox.disabled = running;
      exportActionSelect.disabled = running;
      settingsButton.disabled = running;
      state.actionForm?.setDisabled?.(running);
      state.exportForm?.setDisabled?.(running);
      runButton.disabled = !state.ready || running || !action;
      dryRunButton.hidden = !dryRunSupported || state.exportEnabled;
      dryRunButton.disabled = !state.ready || running || !action;
      cancelButton.hidden = !running;
      cancelButton.disabled = !state.activeRunId;
      if (state.starting) {
        statusLabel.textContent = "開始中";
      } else if (state.status === "queued") {
        statusLabel.textContent = "実行待ち";
      } else if (state.status === "running") {
        statusLabel.textContent = "実行中";
      } else if (state.status === "cancel_requested") {
        statusLabel.textContent = "キャンセル中";
      } else {
        statusLabel.textContent = "";
      }
    }

    connectorSelect.addEventListener("change", () => {
      state.selectedConnectorId = connectorSelect.value;
      state.selectedActionKey = "";
      refreshActionOptions();
      renderActionForm();
    });
    actionSelect.addEventListener("change", () => {
      state.selectedActionKey = actionSelect.value;
      renderActionForm();
    });
    exportCheckbox.addEventListener("change", () => {
      state.exportEnabled = exportCheckbox.checked;
      renderExportForm(getConfig());
      const fieldCount = (
        state.actionForm?.getFieldCount?.() || 0
      ) + (
        state.exportForm?.getFieldCount?.() || 0
      );
      settingsButton.hidden = fieldCount === 0;
      panelHost.hidden = fieldCount === 0 || !state.paramsOpen;
      updateControls();
    });
    exportActionSelect.addEventListener("change", () => {
      state.selectedExportKey = exportActionSelect.value;
      renderExportForm(getConfig());
      updateControls();
    });

    controls.addEventListener("click", (event) => {
      const button = event.target?.closest?.("button[data-action]");
      if (!button) return;
      const command = button.dataset.action;
      if (command === "settings") {
        state.paramsOpen = !state.paramsOpen;
        panelHost.hidden = !state.paramsOpen;
        settingsButton.classList.toggle("is-active", state.paramsOpen);
      } else if (command === "run") {
        void start(false);
      } else if (command === "dry-run") {
        void start(true);
      } else if (command === "cancel") {
        void cancel().catch(() => {});
      }
    });

    async function buildSourceParams(action) {
      const binding = action.standaloneDocument || {};
      if (binding.sourceKind === "none") return {};
      const snapshot = typeof options.getDocument === "function"
        ? options.getDocument()
        : {};
      if (binding.sourceKind === "editor_content") {
        return { [binding.sourceParam]: String(snapshot.content || "") };
      }
      if (binding.sourceKind === "saved_file") {
        if (snapshot.dirty) {
          throw createError(
            "ファイル実行は保存済みの内容だけを対象にします。先に保存してください。"
          );
        }
        await workspace.stat({
          scope: snapshot.scope,
          rel_path: snapshot.relPath
        });
        const absolutePath = text(snapshot.absolutePath);
        if (!absolutePath) {
          throw createError("保存済みファイルのpathを解決できません。");
        }
        return { [binding.sourceParam]: absolutePath };
      }
      throw createError("standalone source bindingが不正です。");
    }

    async function buildRequest(dryRun) {
      const action = getSelectedAction();
      if (!action) throw createError("実行actionを選択してください。");
      if (dryRun && action.dryRun?.supported !== true) {
        throw createError("このactionはドライランに対応していません。");
      }
      if (dryRun && state.exportEnabled) {
        throw createError("Excel出力ではドライランを使用できません。");
      }
      const params = {
        ...(state.actionForm?.getValues?.() || {}),
        ...(await buildSourceParams(action))
      };
      const nonExportMode = action.standaloneResultModes.find(
        (mode) => mode !== "excel"
      );
      const request = {
        doc_session_id: docSessionId,
        connector_id: action.connectorId,
        action_id: action.id,
        result_mode: state.exportEnabled ? "excel" : nonExportMode,
        dry_run: dryRun === true,
        params
      };
      if (!request.result_mode) {
        throw createError("actionのresult modeがcatalogにありません。");
      }
      if (state.exportEnabled) {
        const exportAction = getSelectedExportAction();
        if (!exportAction || !state.exportForm) {
          throw createError("Excel出力actionを選択してください。");
        }
        request.result_export = {
          connector_id: exportAction.connectorId,
          action_id: exportAction.id,
          params: state.exportForm.getValues()
        };
      }
      return request;
    }

    function setRunningState(statusName) {
      state.status = statusName;
      updateControls();
      notifyRunningChange();
    }

    function queueEarlyEvent(type, payload) {
      state.pendingEvents.push({ type, payload });
      while (state.pendingEvents.length > 50) state.pendingEvents.shift();
    }

    function settleTerminalWaiters(payload) {
      const waiters = state.terminalWaiters.splice(0);
      waiters.forEach((resolve) => resolve(payload));
    }

    function finish(type, payload) {
      if (type === "run.completed") {
        resultView.renderCompleted(payload);
      } else if (type === "run.failed") {
        resultView.renderFailed(payload);
      } else {
        resultView.renderCancelled();
      }
      state.starting = false;
      state.activeRunId = "";
      state.status = type === "run.completed"
        ? "success"
        : (type === "run.failed" ? "error" : "cancelled");
      updateControls();
      notifyRunningChange();
      settleTerminalWaiters(payload);
    }

    function applyEvent(type, payload) {
      if (text(payload?.run_id) !== state.activeRunId) return false;
      if (type === "run.log") {
        resultView.appendLog(payload);
        return true;
      }
      if (type === "run.progress") {
        const stage = text(payload.stage);
        if (stage === "queued" || stage === "running") {
          setRunningState(stage);
          resultView.setStatus(
            stage === "queued" ? "実行待ち" : "実行中",
            stage
          );
        }
        return true;
      }
      if (TERMINAL_EVENTS.has(type)) {
        finish(type, payload);
        return true;
      }
      return false;
    }

    function handleBridgeEvent(event) {
      const message = event?.detail || {};
      const type = text(message.type);
      const payload = (
        message.payload
        && typeof message.payload === "object"
      ) ? message.payload : {};
      if (
        !type.startsWith("run.")
        || !text(payload.run_id)
      ) {
        return;
      }
      if (state.activeRunId) {
        applyEvent(type, payload);
      } else if (state.starting) {
        queueEarlyEvent(type, payload);
      }
    }
    window.addEventListener("ziz:evt", handleBridgeEvent);

    async function start(dryRun = false) {
      if (!state.ready || isRunning()) return null;
      state.starting = true;
      state.status = "starting";
      resultView.clear();
      resultView.setStatus("開始中", "running");
      resultView.renderMessage(
        dryRun ? "検証を開始しています。" : "実行を開始しています。"
      );
      updateControls();
      notifyRunningChange();
      try {
        const request = await buildRequest(dryRun);
        const response = await runs.startStandalone(request);
        state.activeRunId = text(response?.run_id);
        if (!state.activeRunId) {
          throw createError(
            "run.start responseにrun_idがありません。",
            "E_INVALID_RESPONSE"
          );
        }
        state.starting = false;
        setRunningState(text(response?.status) || "queued");
        const queued = state.pendingEvents.splice(0);
        queued.forEach((item) => applyEvent(item.type, item.payload));
        return response;
      } catch (error) {
        state.starting = false;
        state.activeRunId = "";
        state.status = "error";
        state.pendingEvents.length = 0;
        updateControls();
        notifyRunningChange();
        resultView.renderFailed({
          error: error?.message || String(error || "実行を開始できませんでした。")
        });
        settleTerminalWaiters({ status: "error" });
        return null;
      }
    }

    async function cancel() {
      if (!state.activeRunId) return false;
      try {
        const response = await runs.cancel({ run_id: state.activeRunId });
        if (response?.accepted === false) {
          state.activeRunId = "";
          state.status = text(response.status) || "cancelled";
          updateControls();
          notifyRunningChange();
          settleTerminalWaiters(response);
          return false;
        }
        setRunningState("cancel_requested");
        resultView.setStatus("キャンセル中", "cancelled");
        return true;
      } catch (error) {
        resultView.renderMessage(
          `キャンセル要求に失敗しました。${error?.message || error}`,
          "is-error"
        );
        throw error;
      }
    }

    async function cancelAndWait() {
      if (!isRunning()) return true;
      await cancel();
      if (!isRunning()) return true;
      await new Promise((resolve) => {
        state.terminalWaiters.push(resolve);
      });
      return true;
    }

    function isRunning() {
      return state.starting || !!state.activeRunId;
    }

    async function restoreActiveRun() {
      try {
        const response = await runs.getStatus();
        const active = (response?.run_index?.standalone || []).find(
          (item) => text(item.doc_session_id) === docSessionId
        );
        if (!active || state.destroyed || isRunning()) return;
        state.activeRunId = text(active.run_id);
        setRunningState(text(active.status) || "running");
        resultView.setStatus("実行中", "running");
        resultView.renderMessage(
          "実行状態を復元しました。完了結果はこの接続中のeventで表示します。"
        );
      } catch (_) {
        // Bridge再接続時にも同じ処理を再試行できるため、初回失敗は表示しない。
      }
    }

    function invoke(command) {
      if (command === "run") return start(false);
      if (command === "dry-run") return start(true);
      if (command === "cancel") return cancel();
      return Promise.resolve(false);
    }

    function destroy() {
      state.destroyed = true;
      window.removeEventListener("ziz:evt", handleBridgeEvent);
      destroyForms();
      resultView.destroy();
      controls.remove();
      panelHost.replaceChildren();
      state.pendingEvents.length = 0;
      settleTerminalWaiters({ status: "destroyed" });
    }

    catalog.initialize()
      .then((config) => {
        if (state.destroyed) return;
        state.actions = buildAvailableActions(config);
        state.exportActions = buildExportActions(config);
        if (!state.actions.length) {
          controls.remove();
          panelHost.hidden = true;
          return;
        }
        state.ready = true;
        state.selectedConnectorId = state.actions[0].connectorId;
        state.selectedActionKey = actionKey(state.actions[0]);
        refreshConnectorOptions();
        refreshActionOptions();
        renderActionForm();
        settingsButton.classList.toggle("is-active", state.paramsOpen);
        updateControls();
        void restoreActiveRun();
      })
      .catch((error) => {
        resultView.renderFailed({
          error: error?.message || String(error || "catalogを取得できませんでした。")
        });
      });

    return Object.freeze({
      invoke,
      start,
      cancel,
      cancelAndWait,
      isRunning,
      destroy,
      getState: () => ({
        ready: state.ready,
        activeRunId: state.activeRunId,
        status: state.status,
        selectedActionKey: state.selectedActionKey,
        exportEnabled: state.exportEnabled
      })
    });
  }

  const packages = window.zizPackages = window.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.standaloneDocuments = Object.freeze({ create });
})();
