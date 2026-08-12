(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules || {};
  const types = modules.assistantTypes;
  const dom = modules.assistantDom;
  const CALLBACK_EVENTS = Object.freeze({
    onSourceRequest: "source:request",
    onSourceChange: "source:change",
    onPreviewRequest: "preview:request",
    onPreviewChange: "preview:change",
    onSelectionChange: "selection:change",
    onConfirm: "confirm",
    onCancel: "cancel",
    onError: "error"
  });

  function createTabularImportAssistant(options = {}) {
    const mountRoot = options.root;
    if (!mountRoot || mountRoot.nodeType !== 1) {
      throw new TypeError("createTabularImportAssistant requires an HTMLElement root");
    }
    if (
      !types
      || !dom
      || typeof modules.createEmitter !== "function"
      || typeof modules.createAssistantView !== "function"
      || typeof modules.createAssistantRequests !== "function"
    ) {
      throw new Error("TabularImportAssistant modules are not loaded");
    }

    const formats = types.normalizeFormats(options.formats);
    if (!formats.length) throw new TypeError("at least one format is required");
    const formatsById = new Map(formats.map((format) => [format.id, format]));
    const documentRef = mountRoot.ownerDocument;
    const viewRoot = documentRef.defaultView || root;
    const emitter = modules.createEmitter();
    const requestSourceProvider = typeof options.requestSource === "function" ? options.requestSource : null;
    const requestPreviewProvider = typeof options.requestPreview === "function" ? options.requestPreview : null;
    const deriveSchema = typeof options.deriveSchema === "function" ? options.deriveSchema : null;
    const labels = {
      title: "{format} 取込設定",
      close: "閉じる",
      selectSource: "ファイルを選択",
      noSource: "ファイルが選択されていません。",
      headerRow: "ヘッダー行",
      dataStartRow: "データ開始行",
      preview: "データプレビュー",
      loading: "プレビューを読み込んでいます。",
      empty: "表示できるデータがありません。",
      cancel: "キャンセル",
      confirm: "確定",
      rows: "行を表示",
      ...(options.labels || {})
    };
    const presentation = options.presentation === "panel" ? "panel" : "modal";
    const refs = dom.buildAssistantDom(documentRef, labels, presentation);
    mountRoot.appendChild(refs.root);

    const initialFormat = formats[0];
    const state = {
      open: false,
      loading: false,
      disabled: false,
      formatId: initialFormat.id,
      sourceInfo: null,
      options: initialFormat.normalizeOptions?.({}) || {},
      preview: null,
      selection: { header_row: 1, data_start_row: 1 },
      error: "",
      labels
    };
    let destroyed = false;
    let lastActiveElement = null;
    let requests = null;
    function ensureActive() {
      if (destroyed) throw new Error("TabularImportAssistant instance has been destroyed");
    }
    function currentFormat() {
      return formatsById.get(state.formatId);
    }
    function emit(eventName, payload) {
      emitter.emit(eventName, payload);
    }

    Object.entries(CALLBACK_EVENTS).forEach(([callbackName, eventName]) => {
      if (typeof options[callbackName] === "function") {
        emitter.on(eventName, options[callbackName]);
      }
    });

    function setFormat(formatId, rawOptions) {
      const id = String(formatId || "").trim();
      const format = formatsById.get(id);
      if (!format) throw new RangeError(`unknown tabular import format: ${id}`);
      state.formatId = id;
      state.options = format.normalizeOptions?.(rawOptions || {}) || { ...(rawOptions || {}) };
    }

    function updateSelection(patch = {}) {
      if (state.disabled || state.loading || !state.preview?.rows?.length) return;
      state.selection = types.normalizeSelection({ ...state.selection, ...patch }, state.preview);
      view.renderSelectionOnly();
      emit("selection:change", {
        format_id: state.formatId,
        selection: { ...state.selection }
      });
    }

    const view = modules.createAssistantView({
      refs,
      state,
      dom,
      labels,
      viewRoot,
      currentFormat,
      hasSourceProvider: !!requestSourceProvider,
      onFormatOptionsChange(patch) {
        const format = currentFormat();
        state.options = format.normalizeOptions?.({ ...state.options, ...patch })
          || { ...state.options, ...patch };
        state.error = "";
        if (state.sourceInfo) requests.requestPreview();
        else view.render();
      },
      onSelectionChange: updateSelection
    });

    function restoreFocus() {
      const target = lastActiveElement;
      lastActiveElement = null;
      if (!target || typeof target.focus !== "function" || !target.isConnected) return;
      target.focus({ preventScroll: true });
    }

    function closeInternal(reason, emitCancel) {
      if (!state.open) return;
      view.clearRowClickTimer();
      requests.invalidateAll();
      state.open = false;
      state.loading = false;
      view.render();
      restoreFocus();
      if (emitCancel) emit("cancel", { reason: String(reason || "close") });
    }

    requests = modules.createAssistantRequests({
      state,
      types,
      currentFormat,
      render: view.render,
      emit,
      isDestroyed: () => destroyed,
      requestSourceProvider,
      requestPreviewProvider,
      deriveSchema,
      previewLimit: {
        max_rows: Math.max(1, Number(options.previewLimit?.max_rows || 100))
      },
      onConfirmResult(result) {
        closeInternal("confirm", false);
        emit("confirm", result);
      }
    });

    function open(initialState = {}) {
      ensureActive();
      requests.invalidateAll();
      view.clearRowClickTimer();
      if (!state.open) lastActiveElement = documentRef.activeElement;
      setFormat(initialState.format_id || formats[0].id, initialState.options || {});
      state.open = true;
      state.loading = false;
      state.disabled = initialState.disabled === true;
      state.error = "";
      state.preview = null;
      state.selection = { header_row: 1, data_start_row: 1 };
      state.sourceInfo = types.hasOwn(initialState, "source")
        ? types.normalizeSource({
            source: initialState.source,
            display_name: initialState.display_name,
            display_hint: initialState.display_hint
          })
        : null;

      if (initialState.preview) {
        requests.applyPreview(initialState.preview, {
          emitEvent: false,
          selection: initialState.selection
        });
      } else {
        view.render();
        if (state.sourceInfo) requests.requestPreview();
      }
      viewRoot.setTimeout(() => {
        if (!destroyed && state.open) {
          const firstFocusable = dom.focusableElements(refs.panel)[0] || refs.panel;
          firstFocusable.focus({ preventScroll: true });
        }
      }, 0);
      return api;
    }

    function close(reason = "api") {
      ensureActive();
      closeInternal(reason, true);
      return api;
    }

    function setSource(sourceContract) {
      ensureActive();
      requests.replaceSource(sourceContract, { emitEvent: true, loadPreview: true });
      return api;
    }

    function setPreview(preview) {
      ensureActive();
      requests.applyPreview(preview);
      return api;
    }

    function setDisabled(disabled) {
      ensureActive();
      state.disabled = !!disabled;
      view.render();
      return api;
    }

    function getState() {
      ensureActive();
      return types.publicStateSnapshot(state);
    }

    function handleDocumentKeydown(event) {
      if (destroyed || !state.open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close("escape");
        return;
      }
      if (event.key !== "Tab" || presentation === "panel") return;
      const focusable = dom.focusableElements(refs.panel);
      if (!focusable.length) {
        event.preventDefault();
        refs.panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && documentRef.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && documentRef.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function destroy() {
      if (destroyed) return;
      view.clearRowClickTimer();
      requests.invalidateAll();
      documentRef.removeEventListener("keydown", handleDocumentKeydown);
      restoreFocus();
      refs.root.remove();
      emitter.clear();
      destroyed = true;
    }

    refs.sourceButton.addEventListener("click", requests.requestSource);
    refs.closeButton.addEventListener("click", () => close("close-button"));
    refs.cancelButton.addEventListener("click", () => close("cancel-button"));
    refs.confirmButton.addEventListener("click", requests.confirm);
    refs.backdrop.addEventListener("click", () => close("backdrop"));
    documentRef.addEventListener("keydown", handleDocumentKeydown);

    const api = Object.freeze({
      open,
      close,
      setSource,
      setPreview,
      setDisabled,
      getState,
      on: emitter.on,
      destroy
    });
    view.render();
    return api;
  }

  packages.tabularImportAssistant = Object.freeze({
    createTabularImportAssistant,
    createExcelFormat: modules.createExcelFormat,
    createDelimitedTextFormat: modules.createDelimitedTextFormat
  });
  delete packages.__tabularImportModules;
})(window);
