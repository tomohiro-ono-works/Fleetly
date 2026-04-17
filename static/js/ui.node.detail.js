(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const bridgeApi = corePkg.bridge || null;
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
    getNodeLogLines,
    getNodeDescriptionSeed,
    renderConnectorSelect
  } = shared;
  const VARIABLE_NAME_PATTERN = /^[a-zA-Z0-9_]+$/;

  function getInvalidVariableNameMessage(name) {
    const text = String(name || "").trim();
    if (!text) return "";
    if (VARIABLE_NAME_PATTERN.test(text)) return "";
    return "変数名には英数字と _ のみ使用できます。日本語や記号は使えません。";
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

  function renderNodeDetail({ state, config, root, onStateChanged }) {
    root.innerHTML = "";
    if (!state.nodes.length) return;
    if (state.selectedNodeId === "__start__") {
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

    function buildHeadActions() {
      const headActionItems = [];
      if (headDetailModal && headDetailModal.label) {
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
      headActionItems.push(
        el(
          "button",
          {
            class: "run-btn node-head-icon-btn",
            type: "button",
            title: "ステップ実行",
            "aria-label": "ステップ実行",
            onclick: () => requestNodeRun(node, "single", onStateChanged)
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
      headActionItems.push(
        el(
          "button",
          {
            class: "danger node-head-icon-btn",
            type: "button",
            title: "削除",
            "aria-label": "削除",
            onclick: () => removeNodeById(state, node.id, onStateChanged)
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
      return el("div", { class: "node-head-actions" }, headActionItems);
    }

    const body = el("div", { class: "node-body" }, []);
    const tabBar = el("div", { class: "node-tabs", role: "tablist", "aria-label": "ノード詳細タブ" }, []);
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
    const logTabBtn = el(
      "button",
      { type: "button", class: "node-tab-btn", role: "tab", "data-tab-key": "log" },
      [document.createTextNode("ログ")]
    );
    tabBar.appendChild(detailTabBtn);
    tabBar.appendChild(yamlTabBtn);
    tabBar.appendChild(dataTabBtn);
    tabBar.appendChild(variablesTabBtn);
    tabBar.appendChild(logTabBtn);
    const tabsHead = el("div", { class: "node-tabs-head" }, [tabBar]);

    const detailPane = el("div", { class: "node-tab-pane", "data-tab-key": "detail" }, [body]);
    const yamlText = el("textarea", {
      class: "node-yaml-editor",
      readonly: "readonly",
      spellcheck: "false",
      "aria-label": "ノード設定YAML"
    });
    const yamlPane = el("div", { class: "node-tab-pane", "data-tab-key": "yaml" }, [yamlText]);
    const dataStatusNote = el("div", { class: "node-data-note" }, []);
    const dataViewToggle = el("div", { class: "schema-editor-mode node-data-mode", role: "tablist", "aria-label": "データ表示切替" }, []);
    const dataSchemaBtn = el(
      "button",
      { type: "button", class: "schema-mode-btn", role: "tab", "data-data-view": "schema" },
      [document.createTextNode("スキーマ")]
    );
    const dataPreviewBtn = el(
      "button",
      { type: "button", class: "schema-mode-btn", role: "tab", "data-data-view": "preview" },
      [document.createTextNode("データ")]
    );
    const dataSummaryBtn = el(
      "button",
      { type: "button", class: "schema-mode-btn", role: "tab", "data-data-view": "summary" },
      [document.createTextNode("サマリ")]
    );
    dataViewToggle.appendChild(dataSchemaBtn);
    dataViewToggle.appendChild(dataPreviewBtn);
    dataViewToggle.appendChild(dataSummaryBtn);
    const dataSchemaBody = el("tbody", {}, []);
    const dataSchemaTable = el("table", { class: "node-data-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, [document.createTextNode("項目")]),
          el("th", {}, [document.createTextNode("説明")]),
          el("th", {}, [document.createTextNode("型")])
        ])
      ]),
      dataSchemaBody
    ]);
    const dataSchemaWrap = el("div", { class: "node-data-wrap" }, [dataSchemaTable]);
    const dataPreviewHead = el("thead", {}, []);
    const dataPreviewBody = el("tbody", {}, []);
    const dataPreviewTable = el("table", { class: "node-data-table" }, [
      dataPreviewHead,
      dataPreviewBody
    ]);
    const dataPreviewWrap = el("div", { class: "node-data-wrap is-preview" }, [dataPreviewTable]);
    const dataVolumeList = el("div", { class: "node-data-volume-list" }, []);
    const dataVolumeWrap = el("div", { class: "node-data-wrap" }, [dataVolumeList]);
    const dataUnsupportedNote = el("div", { class: "node-data-note" }, [
      document.createTextNode("データコネクタではないため対応していません。")
    ]);
    const dataPane = el("div", { class: "node-tab-pane", "data-tab-key": "data" }, [
      dataUnsupportedNote,
      dataStatusNote,
      dataViewToggle,
      dataSchemaWrap,
      dataPreviewWrap,
      dataVolumeWrap
    ]);
    const variablesPaneBody = el("div", { class: "variable-pane-body" }, []);
    const variablesPane = el("div", { class: "node-tab-pane", "data-tab-key": "variables" }, [variablesPaneBody]);
    const logText = el("textarea", {
      class: "node-log-view",
      readonly: "readonly",
      spellcheck: "false",
      "aria-label": "処理ログ"
    });
    const logPane = el("div", { class: "node-tab-pane", "data-tab-key": "log" }, [el("div", { class: "node-log-wrap" }, [logText])]);

    const connectorSelect = renderConnectorSelect({
      config,
      node,
      onStateChanged,
      disabled: loopRootSelected
    });
    const descriptionInput = el("input", {
      type: "text",
      value: String(node.description || ""),
      placeholder: getNodeDescriptionSeed(config, node.connector, node.action),
      "aria-label": "ノード説明",
      oninput: (e) => {
        node.description = e.target.value;
        node.descriptionAuto = false;
      },
      onchange: (e) => {
        node.description = e.target.value;
        node.descriptionAuto = false;
        onStateChanged();
      }
    });
    const detailMeta = el("div", { class: "node-detail-meta" }, [
      el("div", { class: "badge" }, [document.createTextNode(`{${node.stepName}}`)]),
      buildHeadActions(),
      el("div", { class: "head-selects" }, [
        el("div", { class: "head-select" }, [connectorSelect])
      ]),
      el("div", { class: "head-description" }, [descriptionInput])
    ]);
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

    if (!schema.length) {
      body.appendChild(
        el("div", { class: "small" }, [
          document.createTextNode("フォーム定義がありません（設定のキー不一致の可能性）")
        ])
      );
    } else {
      for (const field of schema) {
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

    function setDataStatus(message = "") {
      dataStatusNote.textContent = String(message || "");
      dataStatusNote.hidden = !String(message || "").trim();
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

    function setActiveDataView(viewKey) {
      const activeView = ["schema", "preview", "summary"].includes(viewKey) ? viewKey : "preview";
      root.__nodeDetailDataView = activeView;

      const showSchema = activeView === "schema";
      const showPreview = activeView === "preview";
      const showSummary = activeView === "summary";

      dataSchemaBtn.classList.toggle("is-active", showSchema);
      dataSchemaBtn.setAttribute("aria-selected", showSchema ? "true" : "false");
      dataPreviewBtn.classList.toggle("is-active", showPreview);
      dataPreviewBtn.setAttribute("aria-selected", showPreview ? "true" : "false");
      dataSummaryBtn.classList.toggle("is-active", showSummary);
      dataSummaryBtn.setAttribute("aria-selected", showSummary ? "true" : "false");

      dataSchemaWrap.hidden = !showSchema || !dataSchemaBody.children.length;
      dataPreviewWrap.hidden = !showPreview || (!dataPreviewHead.children.length && !dataPreviewBody.children.length);
      dataVolumeWrap.hidden = !showSummary || !dataVolumeList.children.length;
    }

    function renderSchemaRows(schemaDto) {
      const columns = Array.isArray(schemaDto?.columns) ? schemaDto.columns : [];
      dataSchemaBody.innerHTML = "";
      if (!columns.length) {
        dataSchemaWrap.hidden = true;
        return {};
      }
      const schemaByName = {};
      columns.forEach((column) => {
        const newName = String(column?.new_name || column?.origin_name || "");
        const description = String(column?.description || "");
        const zizDatatype = String(column?.ziz_datatype || "");
        if (newName) schemaByName[newName] = column;
        dataSchemaBody.appendChild(
          el("tr", {}, [
            el("td", {}, [document.createTextNode(newName || "-")]),
            el("td", { class: "node-data-value" }, [document.createTextNode(description || "-")]),
            el("td", {}, [document.createTextNode(zizDatatype || "-")])
          ])
        );
      });
      dataSchemaWrap.hidden = false;
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
      dataPreviewHead.appendChild(
        el("tr", {}, columns.map((column) => el("th", {}, [document.createTextNode(String(column || ""))])))
      );
      if (!rows.length) {
        dataPreviewBody.appendChild(
          el("tr", {}, [
            el(
              "td",
              { class: "node-data-value", colspan: String(Math.max(columns.length, 1)) },
              [document.createTextNode("データがないです。")]
            )
          ])
        );
      } else {
        rows.forEach((row) => {
          const values = Array.isArray(row) ? row : [];
          dataPreviewBody.appendChild(
            el("tr", {}, columns.map((column, index) => {
              const schemaItem = schemaByName[String(column || "")] || null;
              const value = index < values.length ? values[index] : "";
              return el(
                "td",
                { class: `node-data-value${isNumericZizDatatype(schemaItem?.ziz_datatype) ? " is-numeric" : ""}` },
                [document.createTextNode(String(value ?? ""))]
              );
            }))
          );
        });
      }
      dataPreviewWrap.hidden = false;
    }

    function renderDatavolume(datavolumeDto) {
      const columns = Array.isArray(datavolumeDto?.columns) ? datavolumeDto.columns : [];
      dataVolumeList.innerHTML = "";
      if (!columns.length) {
        dataVolumeWrap.hidden = true;
        return;
      }
      columns.forEach((column) => {
        const name = String(column?.name || "");
        const items = Array.isArray(column?.items) ? column.items : [];
        const itemList = el("ul", { class: "node-data-volume-items" }, []);
        if (!items.length) {
          itemList.appendChild(
            el("li", { class: "node-data-volume-item is-empty" }, [document.createTextNode("値がないです。")])
          );
        } else {
          items.forEach((item) => {
            const value = String(item?.value ?? "");
            const count = Number(item?.count || 0);
            const ratio = Number(item?.ratio || 0);
            const barWidth = Math.max(4, Math.min(100, ratio));
            const barLabel = `${value || "NULL"} / ${count}件`;
            itemList.appendChild(
              el("li", { class: "node-data-volume-item" }, [
                el("div", { class: "node-data-volume-item-head" }, [
                  el("span", { class: "node-data-volume-item-meta" }, [document.createTextNode(`${count}件 ${ratio.toFixed(1)}%`)])
                ]),
                el("div", { class: "node-data-volume-bar-track" }, [
                  el("div", { class: "node-data-volume-bar-fill", style: `width:${barWidth}%` }, [
                    el("span", { class: "node-data-volume-bar-label", title: barLabel }, [document.createTextNode(barLabel)])
                  ])
                ])
              ])
            );
          });
        }
        dataVolumeList.appendChild(
          el("section", { class: "node-data-volume-block" }, [
            el("div", { class: "node-data-volume-title" }, [
              document.createTextNode(name || "-")
            ]),
            itemList
          ])
        );
      });
      dataVolumeWrap.hidden = false;
    }

    function applyDataPayload(schemaDto, previewDto, datavolumeDto) {
      const schemaByName = renderSchemaRows(schemaDto);
      renderPreviewRows(previewDto, schemaByName);
      renderDatavolume(datavolumeDto);
      dataViewToggle.hidden = false;
      const previewRowCount = Number(previewDto?.row_count || 0);
      const truncated = !!previewDto?.truncated;
      const previewLabel = truncated ? `プレビュー ${previewRowCount} 行（先頭のみ）` : `プレビュー ${previewRowCount} 行`;
      setDataStatus(buildDataStatusMessage(previewLabel));
      setActiveDataView(root.__nodeDetailDataView || "preview");
    }

    async function syncDataView() {
      const dataConnector = isDataConnector(node.connector, config);
      dataUnsupportedNote.hidden = dataConnector;
      dataSchemaWrap.hidden = true;
      dataPreviewWrap.hidden = true;
      dataVolumeWrap.hidden = true;
      dataViewToggle.hidden = true;
      dataSchemaBody.innerHTML = "";
      dataPreviewHead.innerHTML = "";
      dataPreviewBody.innerHTML = "";
      dataVolumeList.innerHTML = "";
      if (!dataConnector) return;
      if (!bridgeApi?.available?.()) {
        setDataStatus(buildDataStatusMessage("WebView モードでのみ利用できます。"));
        return;
      }
      const cacheKey = getDataCacheKey();
      const cached = cacheKey ? dataCacheStore[cacheKey] : null;
      if (cached) {
        applyDataPayload(cached.schemaDto, cached.previewDto, cached.datavolumeDto);
        return;
      }
      const requestSeq = ++dataRequestSeq;
      setDataStatus(buildDataStatusMessage("データを取得しています..."));
      try {
        const [schemaDto, previewDto, datavolumeDto] = await Promise.all([
          bridgeApi.call("result.getSchema", { mode: String(state?.appMode || ""), step_id: node.stepName }),
          bridgeApi.call("result.getPreview", { mode: String(state?.appMode || ""), step_id: node.stepName }),
          bridgeApi.call("result.getDatavolume", { mode: String(state?.appMode || ""), step_id: node.stepName, top_n: 5 })
        ]);
        if (requestSeq !== dataRequestSeq) return;
        writeDataCache(cacheKey, { schemaDto, previewDto, datavolumeDto });
        applyDataPayload(schemaDto, previewDto, datavolumeDto);
      } catch (error) {
        if (requestSeq !== dataRequestSeq) return;
        const code = String(error?.code || "").trim();
        if (code === "E_NOT_FOUND") {
          setDataStatus(buildDataStatusMessage("まだ実行結果がありません。"));
          return;
        }
        setDataStatus(buildDataStatusMessage(`データ取得に失敗しました。${error?.message ? ` ${error.message}` : ""}`));
      }
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
      variablesPaneBody.appendChild(buildVariableGroup("上流ステップ出力", availableVariables.upstreamVariables));
    }

    function syncLogView() {
      const lines = getNodeLogLines(node);
      if (!lines.length) {
        logText.value = "ログがないです。";
        return;
      }
      logText.value = lines.join("\n");
    }

    const activeTabByRoot = ["detail", "yaml", "data", "variables", "log"].includes(root.__nodeDetailActiveTab)
      ? root.__nodeDetailActiveTab
      : "detail";
    function setActiveTab(tabKey) {
      const activeTab = ["yaml", "data", "variables", "log"].includes(tabKey) ? tabKey : "detail";
      root.__nodeDetailActiveTab = activeTab;
      const showDetail = activeTab === "detail";
      const showYaml = activeTab === "yaml";
      const showData = activeTab === "data";
      const showVariables = activeTab === "variables";
      const showLog = activeTab === "log";

      detailTabBtn.classList.toggle("is-active", showDetail);
      detailTabBtn.setAttribute("aria-selected", showDetail ? "true" : "false");

      yamlTabBtn.classList.toggle("is-active", showYaml);
      yamlTabBtn.setAttribute("aria-selected", showYaml ? "true" : "false");

      dataTabBtn.classList.toggle("is-active", showData);
      dataTabBtn.setAttribute("aria-selected", showData ? "true" : "false");

      variablesTabBtn.classList.toggle("is-active", showVariables);
      variablesTabBtn.setAttribute("aria-selected", showVariables ? "true" : "false");

      logTabBtn.classList.toggle("is-active", showLog);
      logTabBtn.setAttribute("aria-selected", showLog ? "true" : "false");

      detailPane.classList.toggle("is-active", showDetail);
      yamlPane.classList.toggle("is-active", showYaml);
      dataPane.classList.toggle("is-active", showData);
      variablesPane.classList.toggle("is-active", showVariables);
      logPane.classList.toggle("is-active", showLog);
      detailPane.hidden = !showDetail;
      yamlPane.hidden = !showYaml;
      dataPane.hidden = !showData;
      variablesPane.hidden = !showVariables;
      logPane.hidden = !showLog;

      if (showYaml) syncYamlView();
      if (showData) {
        syncDataView().catch((error) => {
          console.error("data view sync failed", error);
        });
      }
      if (showVariables) syncVariablesView();
      if (showLog) syncLogView();
    }

    detailTabBtn.addEventListener("click", () => setActiveTab("detail"));
    yamlTabBtn.addEventListener("click", () => setActiveTab("yaml"));
    dataTabBtn.addEventListener("click", () => setActiveTab("data"));
    dataSchemaBtn.addEventListener("click", () => setActiveDataView("schema"));
    dataPreviewBtn.addEventListener("click", () => setActiveDataView("preview"));
    dataSummaryBtn.addEventListener("click", () => setActiveDataView("summary"));
    variablesTabBtn.addEventListener("click", () => setActiveTab("variables"));
    logTabBtn.addEventListener("click", () => setActiveTab("log"));

    body.addEventListener("input", syncYamlView);
    body.addEventListener("change", syncYamlView);
    body.addEventListener("input", syncVariablesView);
    body.addEventListener("change", syncVariablesView);
    body.addEventListener("input", syncLogView);
    body.addEventListener("change", syncLogView);
    syncYamlView();
    syncVariablesView();
    syncLogView();
    setActiveTab(activeTabByRoot);

    root.appendChild(el("section", { class: "node detail-node" }, [tabsHead, detailMeta, detailPane, yamlPane, dataPane, variablesPane, logPane]));
  }
  const nodeDetail = { renderNodeDetail };
  window.uiNodeDetail = nodeDetail;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.nodeDetail = nodeDetail;
})();
