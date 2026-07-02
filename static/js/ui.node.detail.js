(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const bridgeApi = corePkg.bridge || null;
  const embeddedMode = new URLSearchParams(window.location.search).get("embedded") === "1";
  const { el, getFormSchema } = (corePkg.utils || {});
  const shared = (packages.ui && packages.ui.nodeShared) || window.uiNodeShared || {};
  const {
    getFieldReferenceWarningsSafe,
    ensureStartParameters,
    createUiId,
    getSelectedNodeIndex,
    isLoopRootNode,
    ensureNodeDefaults,
    getUpstreamSteps,
    getAvailableVariables,
    getActionConfig,
    getMissingRequiredFieldLabels,
    renderFieldSafe,
    openConfiguredDetailModal,
    requestNodeRun,
    removeNodeById,
    dumpYamlSafe,
    buildNodeYamlSettings,
    isDataConnector,
    getConnectorLabel,
    getNodeDescriptionSeed,
    renderConnectorSelect,
    getConnectorImageSrc,
    NOIMAGE_SRC
  } = shared;
  const VARIABLE_NAME_PATTERN = /^[a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\u3005]+$/;
  const ALL_DETAIL_TABS = ["detail", "yaml", "data", "variables"];

  function resolveActiveBridgeApi() {
    const localBridge = window.zizBridge || (window.zizPackages || {})?.core?.bridge || bridgeApi || null;
    if (localBridge?.available?.()) return localBridge;
    if (!embeddedMode) return localBridge;
    const parentBridge = window.parent?.zizBridge || (window.parent?.zizPackages || {})?.core?.bridge || null;
    if (parentBridge?.available?.()) return parentBridge;
    return localBridge || parentBridge;
  }
  function getBridgeUnavailableMessage(activeBridge) {
    const message = activeBridge?.unavailableMessage?.();
    return String(message || "ブリッジ未接続です。再読み込みしてください。");
  }

  function normalizeTabKeys(tabKeys) {
    if (!Array.isArray(tabKeys) || !tabKeys.length) return [...ALL_DETAIL_TABS];
    const normalized = tabKeys
      .map((key) => String(key || "").trim())
      .filter((key, index, self) => ALL_DETAIL_TABS.includes(key) && self.indexOf(key) === index);
    return normalized.length ? normalized : [...ALL_DETAIL_TABS];
  }

  function getInvalidVariableNameMessage(name) {
    const text = String(name || "").trim();
    if (!text) return "";
    if (VARIABLE_NAME_PATTERN.test(text)) return "";
    return "変数名には ひらがな / カタカナ / 漢字 / 英数字 / _ のみ使用できます。";
  }

  function renderStartNodeDetail({ state, root, onStateChanged }) {
    root.innerHTML = "";
    const startParameters = ensureStartParameters(state);
    const body = el("div", { class: "node-body" }, []);
    body.appendChild(
      el("div", { class: "node-detail-meta" }, [
        el("div", { class: "badge" }, [document.createTextNode("{START}")])
      ])
    );
    body.appendChild(
      el("div", { class: "start-node-note" }, [
        document.createTextNode("開始ノードで使う初期変数を設定します。変数名と値をペアで追加してください。")
      ])
    );

    const paramsList = el("div", { class: "start-param-list" }, []);
    startParameters.forEach((item) => {
      const nameInput = el("input", {
        type: "text",
        value: item.name,
        placeholder: "変数名",
        "aria-label": "変数名",
        oninput: (e) => {
          item.name = e.target.value;
          updateNameWarning();
        },
        onchange: (e) => {
          item.name = e.target.value;
          updateNameWarning();
          onStateChanged();
        }
      });
      const nameWarning = el("div", { class: "field-warning", hidden: "hidden" }, []);
      const updateNameWarning = () => {
        const message = getInvalidVariableNameMessage(item.name);
        nameWarning.textContent = message;
        nameWarning.hidden = !message;
      };
      updateNameWarning();
      const valueInput = el("input", {
        type: "text",
        value: item.value,
        placeholder: "値",
        "aria-label": "値",
        oninput: (e) => {
          item.value = e.target.value;
        },
        onchange: (e) => {
          item.value = e.target.value;
          onStateChanged();
        }
      });
      const removeBtn = el(
        "button",
        {
          type: "button",
          class: "start-param-remove",
          onclick: () => {
            state.startParameters = startParameters.filter((param) => param.id !== item.id);
            onStateChanged();
          }
        },
        [document.createTextNode("削除")]
      );
      paramsList.appendChild(
        el("div", { class: "start-param-fields" }, [nameInput, valueInput, removeBtn, nameWarning])
      );
    });

    const addBtn = el(
      "button",
      {
        type: "button",
        class: "start-param-add",
        onclick: () => {
          state.startParameters = [...startParameters, { id: createUiId("start_param"), name: "", value: "" }];
          onStateChanged();
        }
      },
      [document.createTextNode("+ 変数を追加")]
    );

    body.appendChild(
      el("div", { class: "row" }, [
        el("label", {}, [document.createTextNode("パラメータ")]),
        el("div", { class: "start-param-editor" }, [paramsList, addBtn])
      ])
    );

    root.appendChild(el("section", { class: "node detail-node" }, [body]));
  }

  function renderNodeDetail({ state, config, root, onStateChanged, tabKeys, defaultTab, includePanelRunAction, forcedActiveTab, hideTabs, topbarConnectorFirst }) {
    root.innerHTML = "";
    const enabledTabs = normalizeTabKeys(tabKeys);
    const enabledTabSet = new Set(enabledTabs);
    const defaultTabKey = enabledTabSet.has(String(defaultTab || "")) ? String(defaultTab || "") : enabledTabs[0];
    const hideTabHeader = !!hideTabs;
    if (!state.nodes.length) return;
    if (state.selectedNodeId === "__start__" && enabledTabSet.has("detail")) {
      renderStartNodeDetail({ state, root, onStateChanged });
      return;
    }

    let idx = getSelectedNodeIndex(state);
    let node = state.nodes[idx];
    if (!node) return;
    const loopRootSelected = isLoopRootNode(node);
    ensureNodeDefaults(config, node);

    const upstreamSteps = getUpstreamSteps(state, node.id);
    const availableVariables = getAvailableVariables(state, node);
    const schema = getFormSchema(config, node.connector, node.action);
    const schemaField = schema.find((field) => ["schema", "schema_add_description"].includes(String(field?.key || ""))) || null;
    const detailFields = schema.filter((field) => !["schema", "schema_add_description"].includes(String(field?.key || "")));
    const hasSchemaField = !!schemaField;
    const runAllLocked = !!state?.__runAllRunning;
    const dataViewNodeKey = [
      String(node?.id || "").trim(),
      String(node?.stepName || "").trim(),
      String(node?.connector || "").trim(),
      String(node?.action || "").trim()
    ].join("|");
    if (root.__nodeDetailDataViewNodeKey !== dataViewNodeKey) {
      root.__nodeDetailDataViewNodeKey = dataViewNodeKey;
      root.__nodeDetailDataView = hasSchemaField ? "schema" : "preview";
    } else if (hasSchemaField && root.__nodeDetailDataView !== "schema") {
      // 下部データエリアは schema 編集を主表示とする（preview は schema editor 内で表示）
      root.__nodeDetailDataView = "schema";
    }
    const actionConfig = getActionConfig(config, node.connector, node.action);
    const detailModal = actionConfig && actionConfig.detailModal;
    const missingRequiredLabels = getMissingRequiredFieldLabels(config, node);
    const referenceWarnings = Array.from(new Set(
      schema.flatMap((field) =>
        getFieldReferenceWarningsSafe({
          node,
          field,
          upstreamSteps,
          availableVariableNames: availableVariables.suggestNames
        })
      )
    ));

    const inlineDetailModal = detailModal && (detailModal.type === "excel" || detailModal.type === "csv") ? detailModal : null;
    const headDetailModal = detailModal && detailModal.type !== "excel" && detailModal.type !== "csv" ? detailModal : null;

    function buildHeadActions(options = {}) {
      const includeSupport = options.includeSupport !== false;
      const includeRun = options.includeRun !== false;
      const includeDelete = options.includeDelete !== false;
      const className = String(options.className || "node-head-actions");
      const headActionItems = [];
      if (includeSupport && headDetailModal && headDetailModal.label) {
        headActionItems.push(
          el(
            "button",
            {
              class: "support-btn node-head-icon-btn",
              type: "button",
              title: headDetailModal.label,
              "aria-label": headDetailModal.label,
              onclick: () => openConfiguredDetailModal({ node, detailModal: headDetailModal, onStateChanged })
            },
            [
              el("img", {
                src: "./icons/support_agent.svg",
                alt: "",
                class: "node-head-icon-btn__icon"
              })
            ]
          )
        );
      }
      if (includeRun) {
        headActionItems.push(
          el(
            "button",
            {
              class: "run-btn node-head-icon-btn",
              type: "button",
              title: "ステップ実行",
              "aria-label": "ステップ実行",
              onclick: () => {
                if (runAllLocked) return;
                requestNodeRun(node, "single", onStateChanged);
              }
            },
            [
              el("img", {
                src: "./icons/run.svg",
                alt: "",
                class: "node-head-icon-btn__icon"
              })
            ]
          )
        );
      }
      if (includeDelete) {
        headActionItems.push(
          el(
            "button",
            {
              class: "danger node-head-icon-btn",
              type: "button",
              title: "削除",
              "aria-label": "削除",
              onclick: () => {
                if (runAllLocked) return;
                removeNodeById(state, node.id, onStateChanged);
              }
            },
            [
              el("img", {
                src: "./icons/delete.svg",
                alt: "",
                class: "node-head-icon-btn__icon"
              })
            ]
          )
        );
      }
      const actionsRoot = el("div", { class: className }, headActionItems);
      if (runAllLocked) {
        const lockButtons = actionsRoot.querySelectorAll(".run-btn, .danger");
        lockButtons.forEach((button) => {
          if (button instanceof HTMLButtonElement) {
            button.disabled = true;
            button.setAttribute("aria-disabled", "true");
          }
        });
      }
      return actionsRoot;
    }

    const body = el("div", { class: "node-body" }, []);
    const tabBar = hideTabHeader ? null : el("div", { class: "node-tabs", role: "tablist", "aria-label": "ノード詳細タブ" }, []);
    const TAB_LABEL_MAP = {
      detail: "ノード詳細",
      yaml: "YAML設定",
      data: "データ",
      variables: "変数"
    };
    const TAB_ICON_MAP = {
      detail: "./icons/workflow.svg",
      yaml: "./icons/yaml.svg",
      data: "./icons/database.svg",
      variables: "./icons/val.svg"
    };
    function applyIconTabStyle(button, key) {
      if (!(button instanceof HTMLElement)) return;
      const label = TAB_LABEL_MAP[key] || String(key || "");
      const iconSrc = TAB_ICON_MAP[key] || "./icons/block.svg";
      button.classList.add("node-tab-btn--icon");
      button.removeAttribute("role");
      button.removeAttribute("aria-selected");
      button.setAttribute("title", label);
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", "false");
      button.textContent = "";
      button.appendChild(el("img", {
        src: iconSrc,
        alt: "",
        class: "node-tab-btn__icon"
      }));
    }
    const detailTabBtn = el(
      "button",
      { type: "button", class: "node-tab-btn", role: "tab", "data-tab-key": "detail" },
      [document.createTextNode("ノード詳細")]
    );
    const yamlTabBtn = el(
      "button",
      { type: "button", class: "node-tab-btn", role: "tab", "data-tab-key": "yaml" },
      [document.createTextNode("YAML設定")]
    );
    const dataTabBtn = el(
      "button",
      { type: "button", class: "node-tab-btn", role: "tab", "data-tab-key": "data" },
      [document.createTextNode("データ")]
    );
    const variablesTabBtn = el(
      "button",
      { type: "button", class: "node-tab-btn", role: "tab", "data-tab-key": "variables" },
      [document.createTextNode("変数")]
    );
    const tabButtonMap = {
      detail: detailTabBtn,
      yaml: yamlTabBtn,
      data: dataTabBtn,
      variables: variablesTabBtn,
    };
    enabledTabs.forEach((tabKey) => {
      const button = tabButtonMap[tabKey];
      if (button && tabBar) tabBar.appendChild(button);
    });
    const compactTopRow = enabledTabSet.has("detail") && enabledTabSet.has("yaml") && !includePanelRunAction;
    const preferTopbarConnectorIcon = !!topbarConnectorFirst;
    const tabsHeadChildren = [];
    if (tabBar) tabsHeadChildren.push(tabBar);
    if (includePanelRunAction) {
      tabsHeadChildren.push(
        el("div", { class: "node-tabs-actions" }, [
          el(
            "button",
            {
              type: "button",
              class: "node-tab-run-btn",
              title: "ステップ実行",
              "aria-label": "ステップ実行",
              onclick: () => {
                if (runAllLocked) return;
                requestNodeRun(node, "single", onStateChanged);
              }
            },
            [
              el("img", {
                src: "./icons/run.svg",
                alt: ""
              })
            ]
          )
        ])
      );
    }
    const tabsHeadClass = compactTopRow ? "node-tabs-head node-tabs-head--compact" : "node-tabs-head";
    const tabsHead = el("div", { class: tabsHeadClass }, tabsHeadChildren);
    if (runAllLocked) {
      const runButton = tabsHead.querySelector(".node-tab-run-btn");
      if (runButton instanceof HTMLButtonElement) {
        runButton.disabled = true;
        runButton.setAttribute("aria-disabled", "true");
      }
    }

    const detailPane = el("div", { class: "node-tab-pane", "data-tab-key": "detail" }, [body]);
    const yamlText = el("textarea", {
      class: "node-yaml-editor",
      readonly: "readonly",
      spellcheck: "false",
      "aria-label": "ノード設定YAML"
    });
    const yamlPane = el("div", { class: "node-tab-pane", "data-tab-key": "yaml" }, [yamlText]);
    const dataStatusNote = el("div", { class: "node-data-note" }, []);
    const dataStatusSlot = el("div", { class: "node-data-status-slot" }, [dataStatusNote]);
    const dataSchemaEditorHost = el("div", { class: "node-data-schema-editor" }, []);
    const dataSchemaWrap = el("div", { class: "node-data-wrap node-data-wrap--schema-editor" }, [dataSchemaEditorHost]);
    const dataPreviewHead = el("thead", {}, []);
    const dataPreviewBody = el("tbody", {}, []);
    const dataPreviewTable = el("table", { class: "node-data-table" }, [
      dataPreviewHead,
      dataPreviewBody
    ]);
    const dataPreviewWrap = el("div", { class: "node-data-wrap is-preview" }, [dataPreviewTable]);
    const dataUnsupportedNote = el("div", { class: "node-data-note" }, [
      document.createTextNode("データコネクタではないため対応していません。")
    ]);
    const dataPane = el("div", { class: "node-tab-pane", "data-tab-key": "data" }, [
      dataUnsupportedNote,
      dataStatusSlot,
      dataSchemaWrap,
      dataPreviewWrap
    ]);
    const variablesPaneBody = el("div", { class: "variable-pane-body" }, []);
    const variablesPane = el("div", { class: "node-tab-pane", "data-tab-key": "variables" }, [variablesPaneBody]);
    const tabPaneMap = {
      detail: detailPane,
      yaml: yamlPane,
      data: dataPane,
      variables: variablesPane,
    };

    const connectorSelect = renderConnectorSelect({
      config,
      state,
      node,
      onStateChanged,
      disabled: loopRootSelected
    });
    const connectorLabelFor = (connectorId) => (
      typeof getConnectorLabel === "function"
        ? (getConnectorLabel(config, connectorId) || String(connectorId || ""))
        : String(connectorId || "")
    );
    const connectorIconSrcFor = (connectorId) => (
      typeof getConnectorImageSrc === "function"
        ? getConnectorImageSrc(connectorId, config)
        : "./img/noimage.jpg"
    );
    connectorSelect.classList.add("node-topbar-connector-flyout");
    if (runAllLocked) {
      connectorSelect.classList.add("is-disabled");
      const selectorControls = connectorSelect.querySelectorAll("button, input, select, textarea");
      selectorControls.forEach((control) => {
        if (!(control instanceof HTMLElement)) return;
        if (control.tagName === "TEXTAREA") {
          control.readOnly = true;
          return;
        }
        if (control.tagName === "INPUT") {
          const input = control;
          input.readOnly = true;
        }
        control.disabled = true;
      });
    }
    const connectorFlyoutTrigger = connectorSelect.querySelector(".connector-flyout-trigger");
    const connectorFlyoutController = connectorSelect.__connectorFlyoutController || null;
    const openConnectorFlyoutFromIcon = () => {
      if (connectorFlyoutController && typeof connectorFlyoutController.toggle === "function") {
        connectorFlyoutController.toggle();
        return;
      }
      if (!connectorFlyoutTrigger || connectorFlyoutTrigger.disabled) return;
      connectorFlyoutTrigger.click();
    };
    const connectorIconImage = el("img", {
      src: connectorIconSrcFor(node.connector),
      alt: "",
      class: "node-topbar-connector-icon__img"
    });
    if (NOIMAGE_SRC) {
      connectorIconImage.addEventListener("error", () => {
        if (connectorIconImage.getAttribute("src") !== NOIMAGE_SRC) {
          connectorIconImage.setAttribute("src", NOIMAGE_SRC);
        }
      });
    }
    const connectorIcon = el("button", {
      type: "button",
      class: "node-topbar-connector-icon",
      title: connectorLabelFor(node.connector) || "コネクタ",
      "aria-label": connectorLabelFor(node.connector) || "コネクタ",
      onclick: (event) => {
        if (runAllLocked) return;
        event.preventDefault();
        event.stopPropagation();
        openConnectorFlyoutFromIcon();
      },
      onkeydown: (event) => {
        if (runAllLocked) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openConnectorFlyoutFromIcon();
      }
    }, [connectorIconImage]);
    if (runAllLocked) {
      connectorIcon.disabled = true;
      connectorIcon.setAttribute("aria-disabled", "true");
    }
    if ((!connectorFlyoutController && !connectorFlyoutTrigger) || connectorFlyoutTrigger?.disabled) {
      connectorIcon.classList.add("is-disabled");
      connectorIcon.setAttribute("aria-disabled", "true");
    }
    const connectorHost = el("div", { class: "node-topbar-connector-host" }, [connectorIcon, connectorSelect]);
    const descriptionInput = el("input", {
      type: "text",
      value: String(node.description || ""),
      placeholder: getNodeDescriptionSeed(config, node.connector, node.action),
      "aria-label": "ノード説明",
      oninput: (e) => {
        if (runAllLocked) return;
        node.description = e.target.value;
        node.descriptionAuto = false;
      },
      onchange: (e) => {
        if (runAllLocked) return;
        node.description = e.target.value;
        node.descriptionAuto = false;
        onStateChanged();
      }
    });
    if (runAllLocked) {
      descriptionInput.readOnly = true;
      descriptionInput.disabled = true;
    }
    const isRightSidebarTopRow = compactTopRow && (hideTabHeader || preferTopbarConnectorIcon);
    let headSelects = null;
    if (!isRightSidebarTopRow) {
      headSelects = el("div", { class: compactTopRow ? "head-selects node-topbar-selects" : "head-selects" }, [
        el("div", { class: "head-select" }, [connectorSelect])
      ]);
    }
    if (compactTopRow) {
      const stepBadge = el("div", { class: "badge node-topbar-badge node-topbar-step" }, [document.createTextNode(String(node.stepName || ""))]);
      if (isRightSidebarTopRow) {
        const topbarActions = buildHeadActions({ includeSupport: false, className: "node-head-actions node-topbar-actions" });
        const nameHost = el("div", { class: "head-description node-topbar-name" }, [descriptionInput]);
        if (tabBar && tabBar.parentElement === tabsHead) {
          tabsHead.removeChild(tabBar);
        }
        tabsHead.classList.add("node-tabs-head--icon-layout", "node-tabs-head--two-rows");
        const topRow = el("div", { class: "node-topbar-row node-topbar-row--main" }, []);
        const bottomRow = el("div", { class: "node-topbar-row node-topbar-row--controls" }, []);
        topRow.appendChild(connectorHost);
        topRow.appendChild(nameHost);
        bottomRow.appendChild(stepBadge);
        bottomRow.appendChild(topbarActions);
        if (tabBar) {
          tabBar.removeAttribute("role");
          tabBar.setAttribute("aria-label", "表示切替ボタン");
          tabBar.classList.add("node-tabs--icon");
          ["detail", "yaml", "variables"].forEach((tabKey) => {
            const button = tabButtonMap[tabKey];
            if (!button || !enabledTabSet.has(tabKey)) return;
            applyIconTabStyle(button, tabKey);
          });
          bottomRow.appendChild(tabBar);
        }
        tabsHead.appendChild(topRow);
        tabsHead.appendChild(bottomRow);
      } else {
        tabsHead.insertBefore(stepBadge, tabsHead.firstChild);
        tabsHead.appendChild(buildHeadActions({ includeSupport: false, className: "node-head-actions node-topbar-actions" }));
        if (headSelects) tabsHead.appendChild(headSelects);
      }
    }
    const detailMetaChildren = [];
    if (!compactTopRow) {
      detailMetaChildren.push(el("div", { class: "badge" }, [document.createTextNode(`{${node.stepName}}`)]));
      detailMetaChildren.push(buildHeadActions());
      if (headSelects) detailMetaChildren.push(headSelects);
    }
    if (!(compactTopRow && isRightSidebarTopRow)) {
      detailMetaChildren.push(el("div", { class: "head-description" }, [descriptionInput]));
    }
    const detailMeta = detailMetaChildren.length
      ? el("div", { class: compactTopRow ? "node-detail-meta node-detail-meta--description-only" : "node-detail-meta" }, detailMetaChildren)
      : null;
    const showDetailMeta = !!detailMeta && (enabledTabSet.has("detail") || enabledTabSet.has("yaml"));
    if (loopRootSelected) {
      body.appendChild(
        el("div", { class: "small" }, [
          document.createTextNode("ループ開始ノードです。構造維持のため、コネクタ/アクション変更は未対応です。削除時はループ内部もまとめて削除します。")
        ])
      );
    }

    const nodeWarnings = [];
    if (missingRequiredLabels.length) {
      nodeWarnings.push(`必須項目が未入力です。${missingRequiredLabels.join(" / ")}`);
    }
    if (referenceWarnings.length) {
      nodeWarnings.push(`未定義の変数参照があります。${referenceWarnings.join(" / ")}`);
    }

    if (nodeWarnings.length) {
      body.appendChild(
        el("div", { class: "node-warning-banner" }, [
          document.createTextNode(nodeWarnings.join(" "))
        ])
      );
    }

    if (inlineDetailModal) {
      body.appendChild(
        el("div", { class: "row row-inline-action" }, [
          el("label", {}, [document.createTextNode(inlineDetailModal.label || "Excelアシスタント")]),
          el("div", { class: "row-inline-action-body" }, [
            el(
              "button",
              {
                class: "node-inline-preview-btn",
                type: "button",
                title: "プレビュー表示",
                "aria-label": "プレビュー表示",
                onclick: () => openConfiguredDetailModal({ node, detailModal: inlineDetailModal, hiddenBindings: state.hiddenBindings, onStateChanged })
              },
              [document.createTextNode("プレビュー表示")]
            )
          ])
        ])
      );
    }

    if (!detailFields.length && !hasSchemaField) {
      body.appendChild(
        el("div", { class: "small" }, [
          document.createTextNode("フォーム定義がありません（設定のキー不一致の可能性）")
        ])
      );
    } else {
      for (const field of detailFields) {
        body.appendChild(renderFieldSafe({
          node,
          field,
          upstreamSteps,
          availableVariableNames: availableVariables.suggestNames,
          hiddenBindings: state.hiddenBindings,
          state,
          config,
          onStateChanged
        }));
      }
    }

    if (schemaField) {
      const schemaRow = renderFieldSafe({
        node,
        field: schemaField,
        upstreamSteps,
        availableVariableNames: availableVariables.suggestNames,
        hiddenBindings: state.hiddenBindings,
        state,
        config,
        onStateChanged
      });
      if (schemaRow && schemaRow.classList) {
        schemaRow.classList.add("row--schema-inline");
        const schemaLabel = schemaRow.querySelector(":scope > label");
        if (schemaLabel) schemaLabel.remove();
      }
      dataSchemaEditorHost.appendChild(schemaRow);
      const schemaToolbarMain = dataSchemaEditorHost.querySelector(".schema-editor-toolbar-main");
      if (schemaToolbarMain) {
        schemaToolbarMain.appendChild(dataStatusSlot);
        dataStatusSlot.classList.add("is-inline");
      }
    }

    function syncYamlView() {
      yamlText.value = dumpYamlSafe(buildNodeYamlSettings(node)).trimEnd();
    }

    let dataRequestSeq = 0;
    const dataCacheState = root.__nodeDetailDataCacheState = root.__nodeDetailDataCacheState || {
      scopeSignature: "",
      store: {}
    };
    function buildDataCacheScopeSignature() {
      const nodes = Array.isArray(state?.nodes) ? state.nodes.map((item) => ({
        stepName: String(item?.stepName || ""),
        connector: String(item?.connector || ""),
        action: String(item?.action || ""),
        form: item?.form || {}
      })) : [];
      const startParameters = Array.isArray(state?.startParameters) ? state.startParameters.map((item) => ({
        name: String(item?.name || ""),
        value: item?.value ?? ""
      })) : [];
      return JSON.stringify({
        appMode: String(state?.appMode || ""),
        fileName: String(state?.fileName || ""),
        flowName: String(state?.flowName || ""),
        startParameters,
        nodes
      });
    }
    const dataCacheScopeSignature = buildDataCacheScopeSignature();
    if (dataCacheState.scopeSignature !== dataCacheScopeSignature) {
      dataCacheState.scopeSignature = dataCacheScopeSignature;
      dataCacheState.store = {};
    }
    const dataCacheStore = dataCacheState.store;
    const flowScopeKey = [
      String(state?.appMode || "").trim(),
      String(state?.fileName || "").trim(),
      String(state?.flowName || "").trim()
    ].join("|");

    function getDataCacheKey() {
      const stepId = String(node.stepName || "").trim();
      if (!stepId) return "";
      return `${flowScopeKey}::${stepId}`;
    }

    function writeDataCache(cacheKey, payload) {
      if (!cacheKey || !payload) return;
      dataCacheStore[cacheKey] = payload;
      const keys = Object.keys(dataCacheStore);
      if (keys.length <= 24) return;
      const dropCount = keys.length - 24;
      for (let i = 0; i < dropCount; i += 1) {
        delete dataCacheStore[keys[i]];
      }
    }

    function isNumericZizDatatype(zizDatatype) {
      const normalized = String(zizDatatype || "").trim().toUpperCase();
      return normalized === "INT64" || normalized === "FLOAT64" || normalized === "NUMERIC";
    }

    function formatDatePreviewValue(value) {
      const text = String(value ?? "").trim();
      if (!text) return "";
      const datePrefix = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
      if (datePrefix) return datePrefix[1];
      return text;
    }

    function formatPreviewValueBySchema(value, schemaItem) {
      const datatype = String(schemaItem?.ziz_datatype || "").trim().toUpperCase();
      if (datatype === "DATE") return formatDatePreviewValue(value);
      return String(value ?? "");
    }

    function setDataStatus(message = "") {
      const text = String(message || "");
      const visible = !!text.trim();
      dataStatusNote.textContent = text;
      dataStatusNote.hidden = !visible;
      dataStatusSlot.hidden = !visible;
    }

    function buildStepStatusLabel() {
      const stepId = String(node.stepName || "");
      const raw = String(state?.stepStatuses?.[stepId] || "").trim().toLowerCase();
      if (!raw) return "";
      if (raw === "success") return "実行状態: 成功";
      if (raw === "error") return "実行状態: エラー";
      if (raw === "running") return "実行状態: 実行中";
      if (raw === "cancelled") return "実行状態: キャンセル";
      return `実行状態: ${raw}`;
    }

    function buildDataStatusMessage(baseMessage) {
      const messages = [];
      const base = String(baseMessage || "").trim();
      const statusLabel = buildStepStatusLabel();
      if (base) messages.push(base);
      if (statusLabel) messages.push(statusLabel);
      return messages.join(" / ");
    }

    let currentDataConnector = false;
    function getSupportedDataViews() {
      const views = [];
      if (hasSchemaField) views.push("schema");
      if (currentDataConnector) {
        views.push("preview");
      }
      return views;
    }

    function setActiveDataView(viewKey) {
      const supportedViews = getSupportedDataViews();
      if (!supportedViews.length) {
        root.__nodeDetailDataView = "";
        dataSchemaWrap.hidden = true;
        dataPreviewWrap.hidden = true;
        dataUnsupportedNote.hidden = false;
        return;
      }
      const fallbackView = hasSchemaField ? "schema" : supportedViews[0];
      const activeView = supportedViews.includes(viewKey)
        ? viewKey
        : (supportedViews.includes(fallbackView) ? fallbackView : supportedViews[0]);
      root.__nodeDetailDataView = activeView;

      const showSchema = hasSchemaField && activeView === "schema";
      const showPreview = currentDataConnector && activeView === "preview";
      dataSchemaWrap.hidden = !showSchema || !hasSchemaField;
      dataPreviewWrap.hidden = !showPreview || (!dataPreviewHead.children.length && !dataPreviewBody.children.length);
      dataUnsupportedNote.hidden = showSchema || currentDataConnector;
    }

    function buildSchemaByName(schemaDto) {
      const columns = Array.isArray(schemaDto?.columns) ? schemaDto.columns : [];
      const schemaByName = {};
      columns.forEach((column) => {
        const newName = String(column?.new_name || column?.origin_name || "");
        if (newName) schemaByName[newName] = column;
      });
      return schemaByName;
    }

    function renderPreviewRows(previewDto, schemaByName) {
      const columns = Array.isArray(previewDto?.columns) ? previewDto.columns : [];
      const rows = Array.isArray(previewDto?.rows) ? previewDto.rows : [];
      dataPreviewHead.innerHTML = "";
      dataPreviewBody.innerHTML = "";
      if (!columns.length) {
        dataPreviewWrap.hidden = true;
        return;
      }
      const headerCells = columns.map((column) => el("th", {}, [document.createTextNode(String(column || ""))]));
      headerCells.push(el("th", { class: "node-data-spacer", "aria-hidden": "true" }, []));
      dataPreviewHead.appendChild(el("tr", {}, headerCells));
      if (!rows.length) {
        dataPreviewBody.appendChild(
          el("tr", {}, [
            el(
              "td",
              { class: "node-data-value", colspan: String(Math.max(columns.length + 1, 1)) },
              [document.createTextNode("データがないです。")]
            )
          ])
        );
      } else {
        rows.forEach((row) => {
          const values = Array.isArray(row) ? row : [];
          const rowCells = columns.map((column, index) => {
            const schemaItem = schemaByName[String(column || "")] || null;
            const value = index < values.length ? values[index] : "";
            return el(
              "td",
              { class: `node-data-value${isNumericZizDatatype(schemaItem?.ziz_datatype) ? " is-numeric" : ""}` },
              [document.createTextNode(formatPreviewValueBySchema(value, schemaItem))]
            );
          });
          rowCells.push(el("td", { class: "node-data-spacer", "aria-hidden": "true" }, []));
          dataPreviewBody.appendChild(
            el("tr", {}, rowCells)
          );
        });
      }
      dataPreviewWrap.hidden = false;
    }

    function applyDataPayload(schemaDto, previewDto) {
      const schemaByName = buildSchemaByName(schemaDto);
      renderPreviewRows(previewDto, schemaByName);
      const previewRowCount = Number(previewDto?.row_count || 0);
      const truncated = !!previewDto?.truncated;
      const previewLabel = truncated ? `プレビュー ${previewRowCount} 行（先頭のみ）` : `プレビュー ${previewRowCount} 行`;
      setDataStatus(buildDataStatusMessage(previewLabel));
      setActiveDataView(root.__nodeDetailDataView || (hasSchemaField ? "schema" : "preview"));
    }

    async function syncDataView() {
      currentDataConnector = isDataConnector(node.connector, config);
      dataUnsupportedNote.hidden = true;
      dataSchemaWrap.hidden = true;
      dataPreviewWrap.hidden = true;
      dataPreviewHead.innerHTML = "";
      dataPreviewBody.innerHTML = "";
      if (!currentDataConnector) {
        setDataStatus(hasSchemaField ? "" : buildDataStatusMessage("データコネクタではないため対応していません。"));
        setActiveDataView(root.__nodeDetailDataView || (hasSchemaField ? "schema" : ""));
        return;
      }
      const activeBridge = resolveActiveBridgeApi();
      if (!activeBridge?.available?.()) {
        setDataStatus(buildDataStatusMessage(getBridgeUnavailableMessage(activeBridge)));
        setActiveDataView(root.__nodeDetailDataView || (hasSchemaField ? "schema" : "preview"));
        return;
      }
      const cacheKey = getDataCacheKey();
      const cached = cacheKey ? dataCacheStore[cacheKey] : null;
      if (cached) {
        applyDataPayload(cached.schemaDto, cached.previewDto);
        return;
      }
      const requestSeq = ++dataRequestSeq;
      setDataStatus(buildDataStatusMessage("データを取得しています..."));
      try {
        const [schemaDto, previewDto] = await Promise.all([
          activeBridge.call("result.getSchema", { mode: String(state?.appMode || ""), step_id: node.stepName }),
          activeBridge.call("result.getPreview", { mode: String(state?.appMode || ""), step_id: node.stepName })
        ]);
        if (requestSeq !== dataRequestSeq) return;
        writeDataCache(cacheKey, { schemaDto, previewDto });
        applyDataPayload(schemaDto, previewDto);
      } catch (error) {
        if (requestSeq !== dataRequestSeq) return;
        const code = String(error?.code || "").trim();
        if (code === "E_NOT_FOUND") {
          setDataStatus(hasSchemaField ? "" : buildDataStatusMessage("未実行の為、データなし"));
          setActiveDataView(root.__nodeDetailDataView || (hasSchemaField ? "schema" : "preview"));
          return;
        }
        setDataStatus(buildDataStatusMessage(`データ取得に失敗しました。${error?.message ? ` ${error.message}` : ""}`));
        setActiveDataView(root.__nodeDetailDataView || (hasSchemaField ? "schema" : "preview"));
      }
    }

    function buildDataSyncKey() {
      const latestRunId = String((window.__zizLastRunSummary && window.__zizLastRunSummary.run_id) || "").trim();
      return [
        String(node?.id || "").trim(),
        String(node?.stepName || "").trim(),
        String(node?.connector || "").trim(),
        String(node?.action || "").trim(),
        String(node?.form?.input_data || "").trim(),
        flowScopeKey,
        latestRunId
      ].join("|");
    }

    function ensureDataViewSynced(options = {}) {
      const force = !!options.force;
      const nextKey = buildDataSyncKey();
      if (!force && root.__nodeDetailLastDataSyncKey === nextKey) return;
      root.__nodeDetailLastDataSyncKey = nextKey;
      syncDataView().catch((error) => {
        console.error("data view sync failed", error);
      });
    }

    function buildVariableGroup(title, items, toneClass = "", options = {}) {
      const showValue = !!options.showValue;
      const normalizedItems = showValue
        ? (items || []).map((item) => ({
          name: String(item?.name || "").trim(),
          value: String(item?.value ?? "")
        })).filter((item) => item.name)
        : Array.from(new Set((items || []).filter(Boolean))).map((name) => ({ name: String(name), value: "" }));
      const group = el("section", { class: `variable-group${toneClass ? ` ${toneClass}` : ""}` }, [
        el("div", { class: "variable-group-title" }, [document.createTextNode(title)])
      ]);
      if (!normalizedItems.length) {
        group.appendChild(
          el("div", { class: "variable-empty" }, [document.createTextNode("利用できる変数はありません。")])
        );
        return group;
      }
      const tableBody = el("tbody", {}, []);
      normalizedItems.forEach((item) => {
        tableBody.appendChild(
          el("tr", {}, [
            el("td", { class: "variable-table-name" }, [document.createTextNode(item.name)]),
            el("td", { class: "variable-table-value" }, [document.createTextNode(showValue ? (item.value || "-") : "-")]),
            el("td", { class: "variable-table-token" }, [document.createTextNode(`{{${item.name}}}`)])
          ])
        );
      });
      group.appendChild(
        el("div", { class: "variable-table-wrap" }, [
          el("table", { class: "variable-table" }, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", {}, [document.createTextNode("変数名")]),
                el("th", {}, [document.createTextNode("変数値")]),
                el("th", {}, [document.createTextNode("参照方法")])
              ])
            ]),
            tableBody
          ])
        ])
      );
      return group;
    }

    function syncVariablesView() {
      variablesPaneBody.innerHTML = "";
      variablesPaneBody.appendChild(
        el("div", { class: "variable-help" }, [
          document.createTextNode("テキスト入力欄では "),
          el("code", {}, [document.createTextNode("{{変数名}}")]),
          document.createTextNode(" の形式で参照できます。")
        ])
      );
      variablesPaneBody.appendChild(
        buildVariableGroup("開始変数", ensureStartParameters(state), "is-start", { showValue: true })
      );
      variablesPaneBody.appendChild(buildVariableGroup("システム変数", availableVariables.systemVariables));
      variablesPaneBody.appendChild(buildVariableGroup("上流ステップ出力", availableVariables.upstreamVariables));
    }

    const forcedTabKey = enabledTabSet.has(String(forcedActiveTab || ""))
      ? String(forcedActiveTab || "")
      : "";
    const activeTabByRoot = forcedTabKey || (enabledTabSet.has(root.__nodeDetailActiveTab)
      ? root.__nodeDetailActiveTab
      : defaultTabKey);
    function setActiveTab(tabKey) {
      const prevTab = String(root.__nodeDetailActiveTab || "");
      const activeTab = enabledTabSet.has(tabKey) ? tabKey : defaultTabKey;
      root.__nodeDetailActiveTab = activeTab;
      ALL_DETAIL_TABS.forEach((key) => {
        const button = tabButtonMap[key];
        const pane = tabPaneMap[key];
        if (!pane) return;
        if (!enabledTabSet.has(key)) {
          if (button) button.hidden = true;
          pane.hidden = true;
          pane.classList.remove("is-active");
          return;
        }
        const isActive = key === activeTab;
        if (button) {
          button.hidden = hideTabHeader;
          button.classList.toggle("is-active", isActive);
          if (button.classList.contains("node-tab-btn--icon")) {
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
          } else {
            button.setAttribute("aria-selected", isActive ? "true" : "false");
          }
        }
        pane.classList.toggle("is-active", isActive);
        pane.hidden = !isActive;
      });

      if (activeTab === "yaml") syncYamlView();
      if (activeTab === "data") {
        // data タブ表示時のみ同期し、同一キーでは再取得しない
        ensureDataViewSynced({ force: prevTab !== "data" });
      }
      if (activeTab === "variables") syncVariablesView();
      const changeDetail = { tab: activeTab };
      root.dispatchEvent(new CustomEvent("ziz:node-detail-tab-change", {
        detail: changeDetail,
        bubbles: true
      }));
      window.dispatchEvent(new CustomEvent("ziz:node-detail-tab-change", {
        detail: changeDetail
      }));
    }

    if (enabledTabSet.has("detail")) detailTabBtn.addEventListener("click", () => setActiveTab("detail"));
    if (enabledTabSet.has("yaml")) yamlTabBtn.addEventListener("click", () => setActiveTab("yaml"));
    if (enabledTabSet.has("data")) dataTabBtn.addEventListener("click", () => setActiveTab("data"));
    if (enabledTabSet.has("variables")) variablesTabBtn.addEventListener("click", () => setActiveTab("variables"));

    if (enabledTabSet.has("yaml")) {
      body.addEventListener("input", syncYamlView);
      body.addEventListener("change", syncYamlView);
      syncYamlView();
    }
    if (enabledTabSet.has("variables")) {
      body.addEventListener("input", syncVariablesView);
      body.addEventListener("change", syncVariablesView);
      syncVariablesView();
    }
    setActiveTab(activeTabByRoot);

    const placeDetailMetaAboveTabs = compactTopRow && hideTabHeader && showDetailMeta;
    const sectionChildren = [];
    if (placeDetailMetaAboveTabs) {
      const topUnifiedFrame = el("div", { class: "node-top-unified-frame" }, []);
      if (detailMeta) topUnifiedFrame.appendChild(detailMeta);
      topUnifiedFrame.appendChild(tabsHead);
      sectionChildren.push(topUnifiedFrame);
    } else {
      sectionChildren.push(tabsHead);
      if (showDetailMeta) sectionChildren.push(detailMeta);
    }
    enabledTabs.forEach((tabKey) => {
      const pane = tabPaneMap[tabKey];
      if (pane) sectionChildren.push(pane);
    });
    root.appendChild(el("section", { class: "node detail-node" }, sectionChildren));
  }
  const nodeDetail = { renderNodeDetail };
  window.uiNodeDetail = nodeDetail;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.nodeDetail = nodeDetail;
})();

