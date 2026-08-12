(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};

  function createAssistantRequests(config) {
    const {
      state,
      types,
      currentFormat,
      render,
      emit,
      isDestroyed,
      requestSourceProvider,
      requestPreviewProvider,
      deriveSchema,
      previewLimit,
      onConfirmResult
    } = config;
    let generation = 0;
    let sourceSequence = 0;
    let previewSequence = 0;
    let confirmSequence = 0;

    function invalidateAll() {
      generation += 1;
      sourceSequence += 1;
      previewSequence += 1;
      confirmSequence += 1;
    }

    function normalizedFormatOptions(format, rawOptions) {
      return format.normalizeOptions?.(rawOptions || {}) || { ...(rawOptions || {}) };
    }

    function applyPreview(previewInput, { emitEvent = true, selection = null } = {}) {
      previewSequence += 1;
      state.loading = false;
      state.error = "";
      state.preview = types.normalizePreview(previewInput);
      const format = currentFormat();
      state.options = normalizedFormatOptions(
        format,
        format.applyPreview?.(state.options, state.preview) || state.options
      );
      state.selection = types.normalizeSelection(
        selection || types.defaultSelection(state.preview),
        state.preview
      );
      render();
      if (emitEvent) {
        emit("preview:change", {
          format_id: state.formatId,
          preview: types.publicStateSnapshot(state).preview
        });
      }
    }

    function replaceSource(sourceContract, { emitEvent = true, loadPreview = true } = {}) {
      const normalized = types.normalizeSource(sourceContract);
      sourceSequence += 1;
      previewSequence += 1;
      state.sourceInfo = normalized;
      state.preview = null;
      state.error = "";
      state.loading = false;
      state.selection = { header_row: 1, data_start_row: 1 };
      render();
      if (emitEvent) {
        emit("source:change", normalized
          ? {
              source: normalized.source,
              display_name: normalized.display_name,
              display_hint: normalized.display_hint
            }
          : null);
      }
      if (loadPreview && state.open && normalized) requestPreview();
    }

    function errorMessage(error, fallback) {
      const message = String(error?.message || error || "").trim();
      return message || fallback;
    }

    function applyError(error, phase, fallback) {
      state.loading = false;
      state.error = errorMessage(error, fallback);
      render();
      emit("error", { phase, message: state.error });
    }

    async function requestSource() {
      if (!requestSourceProvider || state.disabled || state.loading) return null;
      const requestId = ++sourceSequence;
      const requestGeneration = generation;
      const format = currentFormat();
      const request = {
        format_id: state.formatId,
        accept: Array.from(format.accept || []),
        current_source: state.sourceInfo?.source ?? null
      };
      state.loading = true;
      state.error = "";
      render();
      emit("source:request", request);
      try {
        const sourceResult = await requestSourceProvider(request);
        if (
          isDestroyed()
          || !state.open
          || requestGeneration !== generation
          || requestId !== sourceSequence
        ) return null;
        state.loading = false;
        if (sourceResult === null || sourceResult === undefined) {
          render();
          return null;
        }
        replaceSource(sourceResult, { emitEvent: true, loadPreview: true });
        return sourceResult;
      } catch (error) {
        if (
          isDestroyed()
          || requestGeneration !== generation
          || requestId !== sourceSequence
        ) return null;
        applyError(error, "source", "ファイルを選択できませんでした。");
        return null;
      }
    }

    async function requestPreview() {
      if (!state.sourceInfo || state.disabled) return null;
      if (!requestPreviewProvider) {
        applyError(null, "preview", "プレビューproviderが設定されていません。");
        return null;
      }
      const requestId = ++previewSequence;
      const requestGeneration = generation;
      const format = currentFormat();
      const request = {
        format_id: state.formatId,
        source: state.sourceInfo.source,
        options: format.getPreviewOptions?.(state.options) || { ...state.options },
        limit: { ...previewLimit }
      };
      state.loading = true;
      state.error = "";
      state.preview = null;
      render();
      emit("preview:request", request);
      try {
        const previewResult = await requestPreviewProvider(request);
        if (
          isDestroyed()
          || !state.open
          || requestGeneration !== generation
          || requestId !== previewSequence
        ) return null;
        applyPreview(previewResult);
        return previewResult;
      } catch (error) {
        if (
          isDestroyed()
          || requestGeneration !== generation
          || requestId !== previewSequence
        ) return null;
        applyError(error, "preview", "プレビューを読み込めませんでした。");
        return null;
      }
    }

    async function confirm() {
      if (
        state.disabled
        || state.loading
        || !state.sourceInfo
        || !state.preview?.rows?.length
      ) return null;
      const requestId = ++confirmSequence;
      const requestGeneration = generation;
      const previewSnapshot = types.publicStateSnapshot(state).preview;
      const baseResult = {
        format_id: state.formatId,
        source: state.sourceInfo.source,
        display_name: state.sourceInfo.display_name,
        options: { ...state.options },
        selection: { ...state.selection }
      };
      state.loading = true;
      state.error = "";
      render();
      try {
        const schema = deriveSchema
          ? await deriveSchema({ ...baseResult, preview: previewSnapshot })
          : undefined;
        if (
          isDestroyed()
          || !state.open
          || requestGeneration !== generation
          || requestId !== confirmSequence
        ) return null;
        const result = { ...baseResult };
        if (schema !== undefined) result.schema = schema;
        onConfirmResult(result);
        return result;
      } catch (error) {
        if (
          isDestroyed()
          || requestGeneration !== generation
          || requestId !== confirmSequence
        ) return null;
        applyError(error, "schema", "schemaを生成できませんでした。");
        return null;
      }
    }

    return Object.freeze({
      invalidateAll,
      replaceSource,
      applyPreview,
      requestSource,
      requestPreview,
      confirm
    });
  }

  modules.createAssistantRequests = createAssistantRequests;
})(window);
