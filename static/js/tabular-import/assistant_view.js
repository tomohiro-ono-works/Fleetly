(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};

  function createAssistantView(config) {
    const {
      refs,
      state,
      dom,
      labels,
      viewRoot,
      currentFormat,
      hasSourceProvider,
      onFormatOptionsChange,
      onSelectionChange
    } = config;
    let rowClickTimer = null;

    function clearRowClickTimer() {
      if (!rowClickTimer) return;
      viewRoot.clearTimeout(rowClickTimer);
      rowClickTimer = null;
    }

    function titleForFormat() {
      return labels.title.replace("{format}", currentFormat()?.label || state.formatId);
    }

    function sourceDisplayText() {
      if (!state.sourceInfo) return labels.noSource;
      return state.sourceInfo.display_name || state.sourceInfo.display_hint || labels.noSource;
    }

    function renderFormatControls() {
      currentFormat().renderControls({
        root: refs.formatControls,
        options: { ...state.options },
        preview: state.preview,
        disabled: state.disabled || state.loading,
        onChange(patch) {
          if (state.disabled || state.loading) return;
          onFormatOptionsChange(patch || {});
        }
      });
    }

    function renderStatus() {
      if (state.loading) {
        refs.status.textContent = labels.loading;
      } else if (state.error) {
        refs.status.textContent = state.error;
      } else if (state.preview) {
        refs.status.textContent = `${state.preview.rows.length}${labels.rows}`;
      } else {
        refs.status.textContent = "";
      }
    }

    function renderSelectionOnly() {
      dom.paintSelection(refs, state);
      renderStatus();
    }

    function render() {
      refs.root.classList.toggle("is-open", state.open);
      refs.root.setAttribute("aria-hidden", state.open ? "false" : "true");
      refs.title.textContent = titleForFormat();
      refs.sourceText.textContent = sourceDisplayText();
      refs.sourceText.title = state.sourceInfo?.display_hint || state.sourceInfo?.display_name || "";
      refs.sourceButton.disabled = state.disabled || state.loading || !hasSourceProvider;
      refs.confirmButton.disabled = state.disabled
        || state.loading
        || !state.sourceInfo
        || !state.preview
        || !state.preview.rows.length;
      renderFormatControls();
      dom.renderSelectionControls(refs, state, { onSelectionChange });
      dom.renderPreview(refs, state, {
        onRowClick(rowNumber) {
          clearRowClickTimer();
          rowClickTimer = viewRoot.setTimeout(() => {
            rowClickTimer = null;
            onSelectionChange({ header_row: rowNumber });
          }, 220);
        },
        onRowDoubleClick(rowNumber) {
          clearRowClickTimer();
          onSelectionChange({ data_start_row: rowNumber });
        },
        onRowKeyboardSelect(rowNumber, target) {
          onSelectionChange(target === "data"
            ? { data_start_row: rowNumber }
            : { header_row: rowNumber });
        }
      });
      renderStatus();
    }

    return Object.freeze({
      render,
      renderSelectionOnly,
      clearRowClickTimer
    });
  }

  modules.createAssistantView = createAssistantView;
})(window);
