(function () {
  function createSqlbilderPageApi() {
    const packages = window.zizPackages || {};
    const sqlbilder = packages.sqlbilder || {};

    function getTabsForPane(state, pane = "primary") {
      return pane === "secondary"
        ? (Array.isArray(state?.secondaryTabs) ? state.secondaryTabs : [])
        : (Array.isArray(state?.primaryTabs) ? state.primaryTabs : []);
    }

    function getSelectedTabIdForPane(state, pane = "primary") {
      return pane === "secondary"
        ? String(state?.editor?.secondaryTabId || "")
        : String(state?.editor?.primaryTabId || "");
    }

    function getPrimaryTab(state) {
      const primaryTabId = getSelectedTabIdForPane(state, "primary");
      return getTabsForPane(state, "primary").find((tab) => String(tab?.id || "") === primaryTabId);
    }

    function getTabById(state, tabId, pane = "primary") {
      return getTabsForPane(state, pane).find((tab) => String(tab?.id || "") === String(tabId || ""));
    }

    function getSecondaryTab(state) {
      const secondaryTabId = getSelectedTabIdForPane(state, "secondary");
      if (!secondaryTabId) return null;
      const tab = getTabById(state, secondaryTabId, "secondary");
      if (!tab) return null;
      return tab;
    }

    function getFlowSourcePane(state) {
      return String(state?.editor?.flowSourcePane || "primary") === "secondary" ? "secondary" : "primary";
    }

    function getPaneTab(state, pane = "primary") {
      return pane === "secondary" ? getSecondaryTab(state) : getPrimaryTab(state);
    }

    function getPaneSelectedNodeId(state, pane = "primary") {
      const tab = getPaneTab(state, pane);
      return String(tab?.selectedNodeId || tab?.ctes?.[0]?.id || "");
    }

    function cloneCtes(ctes) {
      return (Array.isArray(ctes) ? ctes : []).map((cte, index) => ({
        id: String(cte?.id || `cte_${index + 1}`),
        kind: String(cte?.kind || "cte"),
        label: String(cte?.label || `CTE ${index + 1}`),
        body: String(cte?.body || "")
      }));
    }

    function getCodeEditors() {
      return window.zizPackages?.core?.codeEditors || {};
    }

    function ensureSqlbilderState(appState) {
      if (!appState.sqlbilderState && sqlbilder.state && typeof sqlbilder.state.createInitialSqlbilderState === "function") {
        appState.sqlbilderState = sqlbilder.state.createInitialSqlbilderState();
      }
      const state = appState.sqlbilderState || {};
      const flowApi = sqlbilder.flowlist || {};
      const sqlCatalogApi = sqlbilder.sqlCatalog || {};
      const dataCatalogApi = sqlbilder.dataCatalog || {};
      const editorApi = sqlbilder.editor || {};
      const createDefaultCtes = typeof flowApi.createDefaultCtes === "function"
        ? flowApi.createDefaultCtes
        : (() => [{ id: "cte_1", label: "CTE 1", body: "" }]);
      const parseCtes = typeof flowApi.parseSqlDocumentToCtes === "function"
        ? flowApi.parseSqlDocumentToCtes
        : (() => createDefaultCtes());
      const buildNodes = typeof flowApi.buildFlowNodesFromCtes === "function"
        ? flowApi.buildFlowNodesFromCtes
        : ((ctes) => Array.isArray(ctes) ? ctes : []);
      const buildFullSql = typeof flowApi.buildSqlDocumentFromCtes === "function"
        ? flowApi.buildSqlDocumentFromCtes
        : (() => "");
      const normalizeSqlCatalogItems = typeof sqlCatalogApi.normalizeSqlCatalogItems === "function"
        ? sqlCatalogApi.normalizeSqlCatalogItems
        : ((value) => Array.isArray(value) ? value : []);
      const normalizeDataCatalogTree = typeof dataCatalogApi.normalizeDataCatalogTree === "function"
        ? dataCatalogApi.normalizeDataCatalogTree
        : ((value) => Array.isArray(value) ? value : []);
      state.editor = state.editor || {};
      state.primaryTabs = Array.isArray(state.primaryTabs) && state.primaryTabs.length
        ? state.primaryTabs
        : [{
            id: "sql_tab_1",
            title: "SQL 1",
            ctes: cloneCtes(createDefaultCtes()),
            selectedNodeId: "cte_1"
          }];
      state.secondaryTabs = Array.isArray(state.secondaryTabs) && state.secondaryTabs.length
        ? state.secondaryTabs
        : [{
            id: "sql_tab_1",
            title: "SQL 1",
            ctes: cloneCtes(createDefaultCtes()),
            selectedNodeId: "cte_1"
          }];
      state.editor.primaryTabId = String(state.editor.primaryTabId || state.primaryTabs[0]?.id || "sql_tab_1");
      state.editor.secondaryTabId = String(state.editor.secondaryTabId || state.secondaryTabs[0]?.id || "sql_tab_1");
      state.editor.flowSourcePane = getFlowSourcePane(state);
      state.layout = state.layout || {};
      state.layout.leftHeights = Array.isArray(state.layout.leftHeights) && state.layout.leftHeights.length === 2
        ? state.layout.leftHeights
        : [0.5, 0.5];
      state.layout.mainHeights = Array.isArray(state.layout.mainHeights) && state.layout.mainHeights.length === 2
        ? state.layout.mainHeights
        : [0.68, 0.32];
      state.layout.leftWidth = Math.max(240, Math.min(520, Number(state.layout.leftWidth || 320)));
      state.editor.primaryViewMode = String(state.editor.primaryViewMode || "cte") === "full" ? "full" : "cte";
      state.editor.secondaryViewMode = String(state.editor.secondaryViewMode || "cte") === "full" ? "full" : "cte";
      state.catalogView = String(state.catalogView || "data") === "sql" ? "sql" : "data";
      const activeTab = getPrimaryTab(state) || state.primaryTabs[0];
      if (activeTab) {
        state.editor.primaryTabId = String(activeTab.id || state.editor.primaryTabId || "sql_tab_1");
        activeTab.ctes = Array.isArray(activeTab.ctes) && activeTab.ctes.length
          ? cloneCtes(activeTab.ctes)
          : cloneCtes(createDefaultCtes());
      }
      const secondaryTab = getSecondaryTab(state) || state.secondaryTabs[0];
      if (secondaryTab) {
        state.editor.secondaryTabId = String(secondaryTab.id || state.editor.secondaryTabId || "sql_tab_1");
        secondaryTab.ctes = Array.isArray(secondaryTab.ctes) && secondaryTab.ctes.length
          ? cloneCtes(secondaryTab.ctes)
          : cloneCtes(createDefaultCtes());
      }
      state.dataCatalog = state.dataCatalog || {};
      state.dataCatalog.expandedIds = Array.isArray(state.dataCatalog.expandedIds) ? state.dataCatalog.expandedIds : [];
      state.sqlCatalog = state.sqlCatalog || {};
      state.flow = state.flow || {};
      state.dataCatalog.tree = normalizeDataCatalogTree(state.dataCatalog.tree);
      if (!Array.isArray(state.dataCatalog.expandedIds)) {
        state.dataCatalog.expandedIds = [];
      }
      state.sqlCatalog.items = normalizeSqlCatalogItems(state.sqlCatalog.items);
      const flowSourcePane = getFlowSourcePane(state);
      const flowTab = flowSourcePane === "secondary"
        ? (getSecondaryTab(state) || state.secondaryTabs[0])
        : (getPrimaryTab(state) || state.primaryTabs[0]);
      if (flowTab) {
        flowTab.ctes = Array.isArray(flowTab.ctes) && flowTab.ctes.length
          ? cloneCtes(flowTab.ctes)
          : cloneCtes(createDefaultCtes());
        state.ctes = cloneCtes(flowTab.ctes);
        state.currentTabId = String(flowTab.id || "");
        state.flow.selectedNodeId = String(flowTab.selectedNodeId || state.flow.selectedNodeId || "");
      } else {
        state.ctes = cloneCtes(createDefaultCtes());
      }
      state.flow.nodes = buildNodes(state.ctes);
      if (!state.flow.nodes.length) {
        state.ctes = createDefaultCtes();
        state.flow.nodes = buildNodes(state.ctes);
      }
      state.editor.fullSql = buildFullSql(state.ctes);
      const hasSelected = state.flow.nodes.some((node) => String(node?.id || "") === String(state.flow.selectedNodeId || ""));
      if (!hasSelected) {
        state.flow.selectedNodeId = String(state.flow.nodes[0]?.id || "");
      }
      flowTab.selectedNodeId = String(state.flow.selectedNodeId || flowTab.selectedNodeId || "");
      state.editor.selectedCteBody = typeof editorApi.extractSelectedCteBody === "function"
        ? editorApi.extractSelectedCteBody(state.ctes, state.flow.selectedNodeId)
        : "";
      return state;
    }

    function syncPaneTab(state, pane = "primary", nextCtes = null, selectedNodeId = null) {
      const tabId = getSelectedTabIdForPane(state, pane);
      const tab = getTabById(state, tabId, pane);
      if (!tab) return;
      if (Array.isArray(nextCtes)) {
        tab.ctes = cloneCtes(nextCtes);
      } else if (pane === getFlowSourcePane(state)) {
        tab.ctes = cloneCtes(state.ctes);
      }
      if (selectedNodeId != null) {
        tab.selectedNodeId = String(selectedNodeId || tab.selectedNodeId || "");
      } else if (pane === getFlowSourcePane(state)) {
        tab.selectedNodeId = String(state?.flow?.selectedNodeId || tab.selectedNodeId || "");
      }
    }

    function renderFlowList(flowListRoot, state, render, appState) {
      if (!flowListRoot) return;
      const flowApi = sqlbilder.flowlist || {};
      const moveCteById = typeof flowApi.moveCteById === "function"
        ? flowApi.moveCteById
        : null;
      let dragSourceId = "";
      flowListRoot.innerHTML = "";
      (state.flow.nodes || []).forEach((node) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sqlbilder-flow-node";
        button.draggable = true;
        button.dataset.nodeId = String(node.id || "");
        if (String(node.id) === String(state.flow.selectedNodeId || "")) {
          button.classList.add("is-active");
        }
        button.innerHTML = `
          <span class="sqlbilder-flow-node__dot" aria-hidden="true"></span>
          <span class="sqlbilder-flow-node__label">${String(node.label || "")}</span>
        `;
        button.addEventListener("click", () => {
          state.flow.selectedNodeId = String(node.id || "");
          syncPaneTab(state, getFlowSourcePane(state), state.ctes, state.flow.selectedNodeId);
          render();
        });
        button.addEventListener("dragstart", (event) => {
          dragSourceId = String(node.id || "");
          button.classList.add("is-dragging");
          event.dataTransfer?.setData("text/plain", dragSourceId);
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
          }
        });
        button.addEventListener("dragend", () => {
          dragSourceId = "";
          flowListRoot.querySelectorAll(".sqlbilder-flow-node").forEach((item) => {
            item.classList.remove("is-dragging", "is-drop-target");
          });
        });
        button.addEventListener("dragover", (event) => {
          if (!dragSourceId || dragSourceId === String(node.id || "")) return;
          event.preventDefault();
          button.classList.add("is-drop-target");
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
        });
        button.addEventListener("dragleave", () => {
          button.classList.remove("is-drop-target");
        });
        button.addEventListener("drop", (event) => {
          if (!dragSourceId || dragSourceId === String(node.id || "") || !moveCteById) return;
          event.preventDefault();
          const selectedLabel = String((state.flow.nodes || []).find((item) => String(item.id || "") === String(state.flow.selectedNodeId || ""))?.label || "");
          state.ctes = moveCteById(state.ctes || [], dragSourceId, String(node.id || ""));
          syncPaneTab(state, getFlowSourcePane(state), state.ctes, state.flow.selectedNodeId);
          flowListRoot.querySelectorAll(".sqlbilder-flow-node").forEach((item) => {
            item.classList.remove("is-dragging", "is-drop-target");
          });
          ensureSqlbilderState(appState);
          if (selectedLabel) {
            const nextSelected = (state.flow.nodes || []).find((item) => String(item.label || "") === selectedLabel);
            state.flow.selectedNodeId = String(nextSelected?.id || state.flow.nodes[0]?.id || "");
          }
          render();
        });
        flowListRoot.appendChild(button);
      });
    }

    function renderCatalogTree(catalogListRoot, tree, expandedIds, setExpandedIds, render, appState, emptyMessage) {
      if (!catalogListRoot) return;
      catalogListRoot.innerHTML = "";
      if (!tree.length) {
        const empty = document.createElement("div");
        empty.className = "sqlbilder-empty";
        empty.textContent = emptyMessage;
        catalogListRoot.appendChild(empty);
        return;
      }
      const isExpanded = (nodeId) => {
        return (Array.isArray(expandedIds) ? expandedIds : []).includes(String(nodeId || ""));
      };
      const toggleExpanded = (nodeId) => {
        const key = String(nodeId || "");
        const currentIds = Array.isArray(expandedIds) ? expandedIds.slice() : [];
        const next = currentIds.includes(key)
          ? currentIds.filter((id) => id !== key)
          : currentIds.concat([key]);
        setExpandedIds(next);
        render();
      };
      const insertCatalogText = (text) => {
        const editor = appState.__sqlbilderLastFocusedPane === "secondary"
          ? appState.__sqlbilderSecondaryEditorInstance || appState.__sqlbilderPrimaryEditorInstance
          : appState.__sqlbilderPrimaryEditorInstance || appState.__sqlbilderSecondaryEditorInstance;
        if (!editor || !text) return;
        editor.replaceSelection(String(text), "around");
        editor.focus();
      };
      const createNode = (node, depth = 0) => {
        const wrap = document.createElement("div");
        wrap.className = "sqlbilder-tree-node";
        wrap.style.setProperty("--sqlbilder-tree-depth", String(depth));

        const itemButton = document.createElement("button");
        itemButton.type = "button";
        itemButton.className = "sqlbilder-catalog-item sqlbilder-tree-node__item";
        itemButton.dataset.nodeId = String(node?.id || "");
        itemButton.dataset.nodeType = String(node?.type || "");
        const hasChildren = Array.isArray(node?.children) && node.children.length > 0;
        const expanded = hasChildren ? isExpanded(node.id) : false;
        itemButton.innerHTML = `
          <span class="sqlbilder-tree-node__indent" aria-hidden="true"></span>
          <span class="sqlbilder-tree-node__chevron" aria-hidden="true">${hasChildren ? (expanded ? "▾" : "▸") : ""}</span>
          <span class="sqlbilder-catalog-item__label">${String(node?.label || "")}</span>
        `;
        itemButton.addEventListener("click", () => {
          if (hasChildren) {
            toggleExpanded(node.id);
            return;
          }
          insertCatalogText(String(node?.insertText || ""));
        });
        if (!hasChildren) {
          itemButton.draggable = true;
          itemButton.addEventListener("dragstart", (event) => {
            event.dataTransfer?.setData("text/plain", String(node?.insertText || ""));
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = "copy";
            }
          });
        }
        wrap.appendChild(itemButton);

        if (hasChildren && expanded) {
          const childrenWrap = document.createElement("div");
          childrenWrap.className = "sqlbilder-tree-node__children";
          node.children.forEach((child) => {
            childrenWrap.appendChild(createNode(child, depth + 1));
          });
          wrap.appendChild(childrenWrap);
        }
        return wrap;
      };

      tree.forEach((node) => {
        catalogListRoot.appendChild(createNode(node, 0));
      });
    }

    function renderDataCatalog(dataCatalogListRoot, state, render, appState) {
      renderCatalogTree(
        dataCatalogListRoot,
        Array.isArray(state.dataCatalog?.tree) ? state.dataCatalog.tree : [],
        Array.isArray(state.dataCatalog?.expandedIds) ? state.dataCatalog.expandedIds : [],
        (next) => {
          state.dataCatalog.expandedIds = next;
        },
        render,
        appState,
        "データカタログは未登録です。"
      );
    }

    function syncCatalogVisibility(parts, state) {
      const isData = String(state.catalogView || "data") === "data";
      if (parts.dataCatalogListRoot) {
        parts.dataCatalogListRoot.hidden = !isData;
        parts.dataCatalogListRoot.style.display = isData ? "grid" : "none";
      }
      if (parts.sqlCatalogListRoot) {
        parts.sqlCatalogListRoot.hidden = isData;
        parts.sqlCatalogListRoot.style.display = isData ? "none" : "grid";
      }
    }

    function renderSqlCatalog(sqlCatalogListRoot, state, _render, appState) {
      if (!sqlCatalogListRoot) return;
      sqlCatalogListRoot.innerHTML = "";
      const items = Array.isArray(state.sqlCatalog?.items) ? state.sqlCatalog.items : [];
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "sqlbilder-empty";
        empty.textContent = "SQLカタログは未登録です。";
        sqlCatalogListRoot.appendChild(empty);
        return;
      }
      const insertCatalogText = (text) => {
        const editor = appState.__sqlbilderLastFocusedPane === "secondary"
          ? appState.__sqlbilderSecondaryEditorInstance || appState.__sqlbilderPrimaryEditorInstance
          : appState.__sqlbilderPrimaryEditorInstance || appState.__sqlbilderSecondaryEditorInstance;
        if (!editor || !text) return;
        editor.replaceSelection(String(text), "around");
        editor.focus();
      };
      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sqlbilder-catalog-item";
        button.dataset.nodeId = String(item?.id || "");
        button.innerHTML = `<span class="sqlbilder-catalog-item__label">・${String(item?.label || "")}</span>`;
        button.addEventListener("click", () => {
          insertCatalogText(String(item?.insertText || ""));
        });
        button.draggable = true;
        button.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", String(item?.insertText || ""));
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "copy";
          }
        });
        sqlCatalogListRoot.appendChild(button);
      });
    }

    function renderEditorTabs(editorTabsRoot, state, render, appState, pane = "primary") {
      if (!editorTabsRoot) return;
      editorTabsRoot.innerHTML = "";
      const isPrimary = pane !== "secondary";
      const selectedTabId = getSelectedTabIdForPane(state, isPrimary ? "primary" : "secondary");
      const paneTabs = getTabsForPane(state, isPrimary ? "primary" : "secondary");
      paneTabs.forEach((tab) => {
        const wrap = document.createElement("div");
        wrap.className = "sqlbilder-editor-tab-wrap";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sqlbilder-editor-tab";
        if (String(tab.id || "") === selectedTabId) {
          button.classList.add("is-active");
        }
        button.textContent = String(tab.title || "SQL");
        button.addEventListener("click", () => {
          state.editor.flowSourcePane = isPrimary ? "primary" : "secondary";
          appState.__sqlbilderLastFocusedPane = state.editor.flowSourcePane;
          if (isPrimary) {
            state.editor.primaryTabId = String(tab.id || "");
          } else {
            state.editor.secondaryTabId = String(tab.id || "");
          }
          render();
        });
        wrap.appendChild(button);
        editorTabsRoot.appendChild(wrap);
      });
      const spacer = document.createElement("div");
      spacer.className = "sqlbilder-editor-tabs__spacer";
      editorTabsRoot.appendChild(spacer);
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "sqlbilder-editor-tab sqlbilder-editor-tab--add";
      addButton.textContent = "+";
      addButton.addEventListener("click", () => {
        state.editor.flowSourcePane = isPrimary ? "primary" : "secondary";
        appState.__sqlbilderLastFocusedPane = state.editor.flowSourcePane;
        const nextIndex = paneTabs.length + 1;
        const newTab = {
          id: `sql_tab_${nextIndex}`,
          title: `SQL ${nextIndex}`,
          ctes: cloneCtes(createSqlbilderStateDefaults()),
          selectedNodeId: "cte_1"
        };
        if (isPrimary) {
          state.primaryTabs = paneTabs.concat([newTab]);
          state.editor.primaryTabId = newTab.id;
        } else {
          state.secondaryTabs = paneTabs.concat([newTab]);
          state.editor.secondaryTabId = newTab.id;
        }
        render();
      });
      editorTabsRoot.appendChild(addButton);
    }

    function renderResultsPane(resultsBodyRoot, state) {
      if (!resultsBodyRoot) return;
      resultsBodyRoot.innerHTML = "";
      const mode = String(state?.editor?.resultViewMode || "data");
      const wrap = document.createElement("div");
      wrap.className = "sqlbilder-results-view";

      if (mode === "schema") {
        const table = document.createElement("table");
        table.className = "sqlbilder-results-table";
        table.innerHTML = `
          <thead>
            <tr>
              <th>カラム名</th>
              <th>型</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>まだ実行結果がありません。</td>
              <td>-</td>
              <td>Ctrl+Enter で SQL 全文を実行するとスキーマを表示します。</td>
            </tr>
          </tbody>
        `;
        wrap.appendChild(table);
      } else if (mode === "summary") {
        const summary = document.createElement("div");
        summary.className = "sqlbilder-results-summary";
        summary.innerHTML = `
          <div class="sqlbilder-results-summary-card">
            <div class="sqlbilder-results-summary-card__title">rows</div>
            <div class="sqlbilder-results-summary-card__value">-</div>
          </div>
          <div class="sqlbilder-results-summary-card">
            <div class="sqlbilder-results-summary-card__title">columns</div>
            <div class="sqlbilder-results-summary-card__value">-</div>
          </div>
        `;
        wrap.appendChild(summary);
        const empty = document.createElement("div");
        empty.className = "sqlbilder-results-empty";
        empty.textContent = "まだ実行結果がありません。";
        wrap.appendChild(empty);
      } else {
        const empty = document.createElement("div");
        empty.className = "sqlbilder-results-empty";
        empty.textContent = "まだ実行結果がありません。";
        wrap.appendChild(empty);
      }

      resultsBodyRoot.appendChild(wrap);
    }

    function renderCatalogToggle(toggleRoot, state, render) {
      if (!toggleRoot) return;
      toggleRoot.innerHTML = "";
      [
        { id: "data", label: "データカタログ" },
        { id: "sql", label: "SQLカタログ" }
      ].forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sqlbilder-pane__switcher-btn${String(state.catalogView || "data") === item.id ? " is-active" : ""}`;
        button.textContent = item.label;
        button.addEventListener("click", () => {
          state.catalogView = item.id;
          render();
        });
        toggleRoot.appendChild(button);
      });
    }

    function createSqlbilderStateDefaults() {
      return [{
        id: "cte_1",
        kind: "cte",
        label: "CTE 1",
        body: ""
      }];
    }

    function applyLeftPaneHeights(left, heights) {
      if (!left || !Array.isArray(heights) || heights.length !== 2) return;
      const safe = heights.map((value) => Math.max(0.15, Math.min(0.7, Number(value || 0))));
      const sum = safe.reduce((acc, value) => acc + value, 0) || 1;
      const normalized = safe.map((value) => value / sum);
      left.style.gridTemplateRows = `${normalized[0]}fr 8px ${normalized[1]}fr`;
    }

    function applyMainPaneHeights(main, heights) {
      if (!main || !Array.isArray(heights) || heights.length !== 2) return;
      const safe = heights.map((value) => Math.max(0.18, Math.min(0.82, Number(value || 0))));
      const sum = safe.reduce((acc, value) => acc + value, 0) || 1;
      const normalized = safe.map((value) => value / sum);
      main.style.gridTemplateRows = `${normalized[0]}fr 8px ${normalized[1]}fr`;
    }

    function applyLeftPaneWidth(root, width) {
      if (!root) return;
      const safeWidth = Math.max(240, Math.min(520, Number(width || 320)));
      root.style.gridTemplateColumns = `${safeWidth}px 8px minmax(0, 1fr)`;
    }

    function installLeftSplitters(parts, state, render) {
      const left = parts.left;
      const splitters = parts.splitters || [];
      if (!left || !splitters.length) return;
      applyLeftPaneHeights(left, state.layout?.leftHeights || [0.5, 0.5]);
      splitters.forEach((splitter, index) => {
        splitter.onmousedown = (event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startHeights = (state.layout?.leftHeights || [0.5, 0.5]).slice();
          const leftRect = left.getBoundingClientRect();
          const totalHeight = Math.max(leftRect.height - 8, 1);
          const onMove = (moveEvent) => {
            const delta = (moveEvent.clientY - startY) / totalHeight;
            const next = startHeights.slice();
            next[index] += delta;
            next[index + 1] -= delta;
            state.layout.leftHeights = next;
            applyLeftPaneHeights(left, next);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            render();
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        };
      });
      if (parts.verticalSplitter && parts.root) {
        parts.verticalSplitter.onmousedown = (event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = Number(state.layout?.leftWidth || 320);
          const onMove = (moveEvent) => {
            const delta = moveEvent.clientX - startX;
            const nextWidth = Math.max(240, Math.min(520, startWidth + delta));
            state.layout.leftWidth = nextWidth;
            applyLeftPaneWidth(parts.root, nextWidth);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            render();
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        };
      }
      if (parts.mainSplitter && parts.main) {
        applyMainPaneHeights(parts.main, state.layout?.mainHeights || [0.68, 0.32]);
        parts.mainSplitter.onmousedown = (event) => {
          event.preventDefault();
          const startY = event.clientY;
          const startHeights = (state.layout?.mainHeights || [0.68, 0.32]).slice();
          const mainRect = parts.main.getBoundingClientRect();
          const totalHeight = Math.max(mainRect.height - 8, 1);
          const onMove = (moveEvent) => {
            const delta = (moveEvent.clientY - startY) / totalHeight;
            const next = startHeights.slice();
            next[0] += delta;
            next[1] -= delta;
            state.layout.mainHeights = next;
            applyMainPaneHeights(parts.main, next);
          };
          const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            render();
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        };
      }
    }

    function buildEditorPaneState(state, tab, selectedNodeId, viewMode = "cte") {
      const flowApi = sqlbilder.flowlist || {};
      const buildNodes = typeof flowApi.buildFlowNodesFromCtes === "function"
        ? flowApi.buildFlowNodesFromCtes
        : ((ctes) => Array.isArray(ctes) ? ctes : []);
      const buildFullSql = typeof flowApi.buildSqlDocumentFromCtes === "function"
        ? flowApi.buildSqlDocumentFromCtes
        : (() => "");
      const ctes = cloneCtes(tab?.ctes || []);
      const nodes = buildNodes(ctes);
      const safeSelectedNodeId = nodes.some((node) => String(node?.id || "") === String(selectedNodeId || ""))
        ? String(selectedNodeId || "")
        : String(nodes[0]?.id || "");
      const selectedNode = nodes.find((node) => String(node?.id || "") === safeSelectedNodeId);
      return {
        tabId: String(tab?.id || ""),
        tabTitle: String(tab?.title || "SQL"),
        selectedNodeId: safeSelectedNodeId,
        selectedLabel: String(selectedNode?.label || "-"),
        viewMode: viewMode === "full" ? "full" : "cte",
        value: viewMode === "full"
          ? String(buildFullSql(ctes) || "")
          : getSelectedBodyForTab(state, { ...tab, ctes, selectedNodeId: safeSelectedNodeId }, safeSelectedNodeId)
      };
    }

    function getSelectedBodyForTab(state, tab, selectedNodeId) {
      const editorApi = sqlbilder.editor || {};
      const ctes = cloneCtes(tab?.ctes || []);
      const safeSelectedNodeId = String(selectedNodeId || tab?.selectedNodeId || ctes[0]?.id || "");
      return typeof editorApi.extractSelectedCteBody === "function"
        ? String(editorApi.extractSelectedCteBody(ctes, safeSelectedNodeId) || "")
        : "";
    }

    function updateEditorPane(editorMeta, editorInstance, paneState, options = {}) {
      if (editorMeta) {
        const tabTitle = String(paneState?.tabTitle || "-");
        const currentLabel = String(paneState?.selectedLabel || "-");
        editorMeta.textContent = `${tabTitle} / 選択中: ${currentLabel}`;
      }
      if (editorInstance) {
        const nextValue = String(paneState?.value || "");
        if (editorInstance.getValue() !== nextValue) {
          const cursor = options.cursor || editorInstance.getCursor();
          editorInstance.setValue(nextValue);
          if (cursor && typeof editorInstance.setCursor === "function") {
            editorInstance.setCursor(cursor);
          }
        }
      }
    }

    function getSelectedCte(state, selectedNodeId) {
      return (state?.ctes || []).find((cte) => String(cte?.id || "") === String(selectedNodeId || ""));
    }

    function addNewCte(state, appState, editorInstance, pane = "primary", options = {}) {
      const editorApi = sqlbilder.editor || {};
      const flowApi = sqlbilder.flowlist || {};
      const parseCtes = typeof flowApi.parseSqlDocumentToCtes === "function"
        ? flowApi.parseSqlDocumentToCtes
        : (() => []);
      const buildMarkerLine = typeof flowApi.buildMarkerLine === "function"
        ? flowApi.buildMarkerLine
        : ((kind, label) => String(kind || "").toLowerCase() === "test" ? `--@test ${label}` : `--@cte: ${label}`);
      const blockKind = String(options.kind || "cte").trim().toLowerCase() === "test" ? "test" : "cte";
      const currentIndex = (state.ctes || []).findIndex((cte) => String(cte?.id || "") === String(state.flow.selectedNodeId || ""));
      if (currentIndex < 0 || !editorApi.replaceSelectedCteBlock || !editorApi.parseCteBlock) {
        return null;
      }

      const labels = new Set((state.ctes || []).map((cte) => String(cte?.label || "").trim()).filter(Boolean));
      let nextNumber = ((state.ctes || []).length || 0) + 1;
      let nextLabel = blockKind === "test" ? "新しいCTE" : `CTE ${nextNumber}`;
      while (labels.has(nextLabel)) {
        nextNumber += 1;
        nextLabel = blockKind === "test" ? `新しいCTE ${nextNumber}` : `CTE ${nextNumber}`;
      }

      const currentText = String(editorInstance?.getValue?.() || state.editor?.selectedCteBody || "");
      const cursor = editorInstance?.getCursor?.() || appState.__sqlbilderEditorCursor || { line: 0, ch: currentText.length };
      const lines = currentText.split("\n");
      const safeLine = Math.max(0, Math.min(Number(cursor.line || 0), Math.max(lines.length - 1, 0)));
      const lineOffsets = [];
      let offset = 0;
      lines.forEach((line, index) => {
        lineOffsets[index] = offset;
        offset += String(line || "").length;
        if (index < lines.length - 1) {
          offset += 1;
        }
      });
      const baseOffset = lineOffsets[safeLine] || 0;
      const currentLine = String(lines[safeLine] || "");
      const safeCh = Math.max(0, Math.min(Number(cursor.ch || 0), currentLine.length));
      const cursorOffset = baseOffset + safeCh;
      const beforeText = currentText.slice(0, cursorOffset);
      const afterText = currentText.slice(cursorOffset);
      const needsLeadingNewline = beforeText.length > 0 && !beforeText.endsWith("\n");
      const needsTrailingNewline = afterText.length > 0 && !afterText.startsWith("\n");
      const insertion = `${needsLeadingNewline ? "\n" : ""}${buildMarkerLine(blockKind, nextLabel)}\n${needsTrailingNewline ? "\n" : ""}`;
      const nextBlockText = `${beforeText}${insertion}${afterText}`;

      const splitBlocks = parseCtes(nextBlockText);
      const beforeCtes = (state.ctes || []).slice(0, currentIndex);
      const afterCtes = (state.ctes || []).slice(currentIndex + 1);
          state.ctes = beforeCtes
        .concat(splitBlocks)
        .concat(afterCtes)
        .map((cte, index) => ({
          id: `cte_${index + 1}`,
          kind: String(cte?.kind || "cte"),
          label: String(cte?.label || `CTE ${index + 1}`),
          body: String(cte?.body || "")
        }));
      state.editor.flowSourcePane = pane === "secondary" ? "secondary" : "primary";
      appState.__sqlbilderLastFocusedPane = state.editor.flowSourcePane;
      syncPaneTab(state, state.editor.flowSourcePane, state.ctes, state.flow.selectedNodeId);
      ensureSqlbilderState(appState);
      const insertedNode = (state.flow.nodes || []).find((node) => String(node?.label || "") === nextLabel);
      state.flow.selectedNodeId = String(insertedNode?.id || state.flow.selectedNodeId || "");
      syncPaneTab(state, state.editor.flowSourcePane, state.ctes, state.flow.selectedNodeId);
      return {
        label: nextLabel
      };
    }

    function wrapSelectedAsCte(editorInstance) {
      if (!editorInstance) return;
      const selectedText = String(editorInstance.getSelection() || "");
      const replacement = `, CTE? AS (\n${selectedText}\n)`;
      editorInstance.replaceSelection(replacement, "around");
      editorInstance.focus();
    }

    function replaceSelectionOrCurrentLine(editorInstance, buildReplacement) {
      if (!editorInstance || typeof buildReplacement !== "function") return false;
      const doc = editorInstance.getDoc?.();
      if (!doc) return false;
      const selectedText = String(editorInstance.getSelection() || "");
      if (selectedText) {
        const replacement = buildReplacement(selectedText, { mode: "selection" });
        if (typeof replacement === "string") {
          editorInstance.replaceSelection(replacement, "around");
          editorInstance.focus();
          return true;
        }
        return false;
      }
      const cursor = doc.getCursor();
      const lineNumber = Number(cursor?.line || 0);
      const currentLine = String(doc.getLine(lineNumber) || "");
      const replacement = buildReplacement(currentLine, { mode: "line", lineNumber });
      if (typeof replacement !== "string") return false;
      doc.replaceRange(
        replacement,
        { line: lineNumber, ch: 0 },
        { line: lineNumber, ch: currentLine.length }
      );
      editorInstance.focus();
      return true;
    }

    async function wrapSelectedAsMeasure(editorInstance, type) {
      if (!editorInstance) return false;
      const bridge = window.zizBridge;
      const doc = editorInstance.getDoc?.();
      if (!doc) return false;
      const selections = typeof doc.listSelections === "function" ? doc.listSelections() : [];
      const primarySelection = selections[0] || null;
      const from = primarySelection ? primarySelection.from() : doc.getCursor();
      const to = primarySelection ? primarySelection.to() : doc.getCursor();
      const selectedText = String(editorInstance.getSelection() || "");

      if (bridge?.available?.()) {
        try {
          const response = await bridge.call("sqlbilder.applyMeasure", {
            measure_type: type,
            sql_text: editorInstance.getValue(),
            selection_start_line: Number(from?.line || 0),
            selection_end_line: Number(to?.line || from?.line || 0),
          });
          const replacement = String(response?.replacement || "");
          if (!replacement) return false;
          editorInstance.setValue(replacement);
          editorInstance.focus();
          return true;
        } catch (_) {
          // browser-only では fallback を使う
        }
      }

      const fnName = type === "count" ? "COUNT(DISTINCT " : "SUM(";
      return replaceSelectionOrCurrentLine(editorInstance, (text) => {
        const target = String(text || "").trim();
        if (!target) return null;
        return `${fnName}${target}) AS 名称 --@measure`;
      });
    }

    function insertCaseSample(editorInstance) {
      if (!editorInstance) return;
      const selectedText = String(editorInstance.getSelection() || "").trim();
      const subject = selectedText || "対象フィールド";
      const snippet = [
        "CASE",
        `  WHEN ${subject} = '条件1' THEN '結果1'`,
        `  WHEN ${subject} = '条件2' THEN '結果2'`,
        "  ELSE 'その他'",
        "END AS 名称"
      ].join("\n");
      if (selectedText) {
        editorInstance.replaceSelection(snippet, "around");
      } else {
        const doc = editorInstance.getDoc?.();
        const cursor = doc?.getCursor?.();
        if (doc && cursor) {
          doc.replaceRange(snippet, cursor, cursor);
        }
      }
      editorInstance.focus();
    }

    function addJoinKeyTag(editorInstance) {
      if (!editorInstance) return;
      replaceSelectionOrCurrentLine(editorInstance, (text) => {
        const source = String(text || "");
        if (!source.trim()) return null;
        if (source.includes("--@key")) {
          return source;
        }
        const trimmedEnd = source.replace(/\s+$/, "");
        const trailingWhitespace = source.slice(trimmedEnd.length);
        return `${trimmedEnd} --@key${trailingWhitespace}`;
      });
    }

    function normalizeAlias(rawAlias, rawTable) {
      const alias = String(rawAlias || "").trim();
      if (alias) return alias;
      const table = String(rawTable || "").trim();
      if (!table) return "";
      const compact = table.replace(/[`"\[\]]/g, "");
      const parts = compact.split(".");
      return String(parts[parts.length - 1] || compact);
    }

    function parseJoinSources(sqlText) {
      const lines = String(sqlText || "").split(/\r?\n/);
      const sources = [];
      lines.forEach((line, index) => {
        const match = line.match(/^\s*(FROM|JOIN)\s+([^\s,()]+)(?:\s+(?:AS\s+)?([A-Za-z_][\w$]*))?/i);
        if (!match) return;
        sources.push({
          kind: String(match[1] || "").toUpperCase(),
          table: String(match[2] || ""),
          alias: normalizeAlias(match[3], match[2]),
          lineIndex: index
        });
      });
      return sources;
    }

    function parseTaggedJoinKeys(sqlText) {
      const keyMap = new Map();
      const lines = String(sqlText || "").split(/\r?\n/);
      lines.forEach((line) => {
        if (!line.includes("--@key")) return;
        const beforeComment = String(line.split("--@key")[0] || "").replace(/,\s*$/, "").trim();
        if (!beforeComment) return;
        const aliasMatch = beforeComment.match(/([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)/);
        if (!aliasMatch) return;
        const sourceAlias = String(aliasMatch[1] || "");
        const sourceColumn = String(aliasMatch[2] || "");
        const asMatch = beforeComment.match(/\bAS\s+([A-Za-z_][\w$]*)\s*$/i);
        const joinKey = String(asMatch?.[1] || sourceColumn);
        const keys = keyMap.get(sourceAlias) || [];
        keys.push({
          alias: sourceAlias,
          column: sourceColumn,
          keyName: joinKey
        });
        keyMap.set(sourceAlias, keys);
      });
      return keyMap;
    }

    function findExistingOnClause(lines, joinLineIndex) {
      for (let index = joinLineIndex + 1; index < lines.length; index += 1) {
        const current = String(lines[index] || "");
        if (!current.trim()) continue;
        if (/^\s*ON\b/i.test(current)) return true;
        if (/^\s*(JOIN|WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|QUALIFY|HAVING|UNION)\b/i.test(current)) {
          return false;
        }
      }
      return false;
    }

    function buildJoinConditions(sqlText) {
      const lines = String(sqlText || "").split(/\r?\n/);
      const sources = parseJoinSources(sqlText);
      if (sources.length < 2) return null;
      const keyMap = parseTaggedJoinKeys(sqlText);
      const base = sources[0];
      const baseKeys = keyMap.get(base.alias) || [];
      if (!baseKeys.length) return null;
      const joinSources = sources.slice(1);
      const insertions = [];
      joinSources.forEach((source) => {
        if (!source.alias) return;
        if (findExistingOnClause(lines, source.lineIndex)) return;
        const sourceKeys = keyMap.get(source.alias) || [];
        const matchingPairs = sourceKeys
          .map((item) => {
            const baseKey = baseKeys.find((candidate) => candidate.keyName === item.keyName);
            if (!baseKey) return null;
            return `${baseKey.alias}.${baseKey.column} = ${item.alias}.${item.column}`;
          })
          .filter(Boolean);
        if (!matchingPairs.length) return;
        insertions.push({
          lineIndex: source.lineIndex,
          clause: `  ON ${matchingPairs.join("\n  AND ")}`
        });
      });
      if (!insertions.length) return null;
      const rendered = [];
      lines.forEach((line, index) => {
        rendered.push(line);
        insertions
          .filter((item) => item.lineIndex === index)
          .forEach((item) => rendered.push(item.clause));
      });
      return rendered.join("\n");
    }

    function applyJoinCommand(editorInstance) {
      if (!editorInstance) return;
      const nextSql = buildJoinConditions(editorInstance.getValue());
      if (!nextSql) return;
      editorInstance.setValue(nextSql);
      editorInstance.focus();
    }

    return {
      mount(root, appState) {
          const state = ensureSqlbilderState(appState);
        if (!(sqlbilder.layout && typeof sqlbilder.layout.renderSqlbilderLayout === "function")) {
          return state;
        }
        sqlbilder.layout.renderSqlbilderLayout(root, {
          state,
          async onRendered(parts) {
            const editorApi = sqlbilder.editor || {};
            appState.__sqlbilderLastFocusedPane = appState.__sqlbilderLastFocusedPane || getFlowSourcePane(state);
            let primaryEditorComposing = false;
            let secondaryEditorComposing = false;
            let suppressPrimarySync = false;
            let suppressSecondarySync = false;
            let primaryEditorInstance = null;
            let secondaryEditorInstance = null;
            let inlineSuggestMode = "";
            let commandSuggestActiveIndex = 0;
            let commandSuggestItems = [];
            let commandSuggestQuery = "";
            let keyboardAreaId = "";
            let keyboardAreaIndex = 0;

            const getLastFocusedPane = () => appState.__sqlbilderLastFocusedPane === "secondary" ? "secondary" : "primary";
            const getEditorInstanceForPane = (pane) => pane === "secondary" ? secondaryEditorInstance : primaryEditorInstance;
            const getActiveEditorInstance = () => getEditorInstanceForPane(getLastFocusedPane());
            const setFocusedPane = (pane, options = {}) => {
              const nextPane = pane === "secondary" ? "secondary" : "primary";
              const previousPane = getFlowSourcePane(state);
              state.editor.flowSourcePane = nextPane;
              appState.__sqlbilderLastFocusedPane = nextPane;
              if (!options.silent && previousPane !== nextPane) {
                rerender();
              }
            };
            const applyEditorChangeForPane = (pane, value) => {
              return pane === "secondary"
                ? (applySecondaryEditorChange(value) || {})
                : (applyPrimaryEditorChange(value) || {});
            };
            const rerenderForPane = (pane) => {
              const editor = getEditorInstanceForPane(pane);
              const cursor = editor?.getCursor?.();
              rerender(cursor ? { cursor } : {});
            };
            const insertTextIntoPane = (pane, text) => {
              const editor = getEditorInstanceForPane(pane);
              if (!editor || !text) return false;
              setFocusedPane(pane, { silent: true });
              editor.replaceSelection(String(text), "around");
              editor.focus();
              applyEditorChangeForPane(pane, editor.getValue());
              rerenderForPane(pane);
              return true;
            };

            const commandDefinitions = [
              {
                id: "add-cte",
                label: "CTEを追加",
                run() {
                  const pane = getLastFocusedPane();
                  const inserted = addNewCte(state, appState, getEditorInstanceForPane(pane), pane);
                  if (inserted) {
                    rerender({
                      cursor: {
                        line: 0,
                        ch: String(inserted.label || "").length + "--@cte: ".length
                      }
                    });
                  }
                }
              },
              {
                id: "add-test",
                label: "テスト",
                run() {
                  const pane = getLastFocusedPane();
                  const inserted = addNewCte(state, appState, getEditorInstanceForPane(pane), pane, { kind: "test" });
                  if (inserted) {
                    rerender({
                      cursor: {
                        line: 0,
                        ch: String(inserted.label || "").length + "--@test ".length
                      }
                    });
                  }
                }
              },
              {
                id: "wrap-cte",
                label: "cteで囲む",
                run() {
                  const pane = getLastFocusedPane();
                  const editor = getEditorInstanceForPane(pane);
                  wrapSelectedAsCte(editor);
                  if (editor) {
                    applyEditorChangeForPane(pane, editor.getValue());
                    rerenderForPane(pane);
                  }
                }
              },
              {
                id: "measure-sum",
                label: "集計（合計）",
                async run() {
                  const pane = getLastFocusedPane();
                  const editor = getEditorInstanceForPane(pane);
                  const applied = await wrapSelectedAsMeasure(editor, "sum");
                  if (applied && editor) {
                    applyEditorChangeForPane(pane, editor.getValue());
                    rerenderForPane(pane);
                  }
                }
              },
              {
                id: "measure-count",
                label: "集計（カウント）",
                async run() {
                  const pane = getLastFocusedPane();
                  const editor = getEditorInstanceForPane(pane);
                  const applied = await wrapSelectedAsMeasure(editor, "count");
                  if (applied && editor) {
                    applyEditorChangeForPane(pane, editor.getValue());
                    rerenderForPane(pane);
                  }
                }
              },
              {
                id: "insert-case",
                label: "条件分岐",
                run() {
                  const pane = getLastFocusedPane();
                  const editor = getEditorInstanceForPane(pane);
                  insertCaseSample(editor);
                  if (editor) {
                    applyEditorChangeForPane(pane, editor.getValue());
                    rerenderForPane(pane);
                  }
                }
              },
              {
                id: "tag-join-key",
                label: "結合キーのタグ指定",
                run() {
                  const pane = getLastFocusedPane();
                  const editor = getEditorInstanceForPane(pane);
                  addJoinKeyTag(editor);
                  if (editor) {
                    applyEditorChangeForPane(pane, editor.getValue());
                    rerenderForPane(pane);
                  }
                }
              },
              {
                id: "build-join",
                label: "結合",
                run() {
                  const pane = getLastFocusedPane();
                  const editor = getEditorInstanceForPane(pane);
                  applyJoinCommand(editor);
                  if (editor) {
                    applyEditorChangeForPane(pane, editor.getValue());
                    rerenderForPane(pane);
                  }
                }
              }
            ];

            const hideInlineSuggest = () => {
              inlineSuggestMode = "";
              commandSuggestItems = [];
              commandSuggestActiveIndex = 0;
              commandSuggestQuery = "";
              if (parts.inlineCommandSuggest) {
                parts.inlineCommandSuggest.hidden = true;
              }
              if (parts.inlineCommandQuery) {
                parts.inlineCommandQuery.textContent = "";
              }
              if (parts.inlineCommandList) {
                parts.inlineCommandList.innerHTML = "";
              }
            };

            const hideInlineSuggestIfOpen = () => {
              if (!commandSuggestItems.length) return;
              hideInlineSuggest();
            };

            const clearKeyboardAreaHighlight = () => {
              [
                ...parts.root.querySelectorAll(".sqlbilder-catalog-item"),
                ...parts.root.querySelectorAll(".sqlbilder-flow-node")
              ].forEach((item) => item.classList.remove("is-keyboard-active"));
            };

            const clearKeyboardAreaState = () => {
              keyboardAreaId = "";
              keyboardAreaIndex = 0;
              clearKeyboardAreaHighlight();
            };

            const getAreaDefinitions = () => ([
              { id: "data-catalog", label: "データカタログ" },
              { id: "sql-catalog", label: "SQLカタログ" },
              { id: "flow", label: "フローエディタ" }
            ]);

            const getAreaItems = (areaId) => {
              if (areaId === "data-catalog") {
                state.catalogView = "data";
                if (parts.dataCatalogListRoot) parts.dataCatalogListRoot.hidden = false;
                if (parts.sqlCatalogListRoot) parts.sqlCatalogListRoot.hidden = true;
                renderCatalogToggle(parts.catalogToggle, state, rerender);
                return Array.from(parts.dataCatalogListRoot?.querySelectorAll(".sqlbilder-catalog-item") || []);
              }
              if (areaId === "sql-catalog") {
                state.catalogView = "sql";
                if (parts.dataCatalogListRoot) parts.dataCatalogListRoot.hidden = true;
                if (parts.sqlCatalogListRoot) parts.sqlCatalogListRoot.hidden = false;
                renderCatalogToggle(parts.catalogToggle, state, rerender);
                return Array.from(parts.sqlCatalogListRoot?.querySelectorAll(".sqlbilder-catalog-item") || []);
              }
              if (areaId === "flow") {
                return Array.from(parts.flowListRoot?.querySelectorAll(".sqlbilder-flow-node") || []);
              }
              return [];
            };

            const syncKeyboardAreaHighlight = () => {
              clearKeyboardAreaHighlight();
              if (!keyboardAreaId) return;
              const items = getAreaItems(keyboardAreaId);
              if (!items.length) return;
              keyboardAreaIndex = Math.max(0, Math.min(keyboardAreaIndex, items.length - 1));
              const current = items[keyboardAreaIndex];
              current?.classList.add("is-keyboard-active");
              current?.scrollIntoView({ block: "nearest" });
            };

            const activateKeyboardArea = (areaId) => {
              keyboardAreaId = String(areaId || "");
              keyboardAreaIndex = 0;
              syncKeyboardAreaHighlight();
            };

            const moveKeyboardAreaSelection = (delta) => {
              if (!keyboardAreaId) return false;
              const items = getAreaItems(keyboardAreaId);
              if (!items.length) return false;
              keyboardAreaIndex = (keyboardAreaIndex + delta + items.length) % items.length;
              syncKeyboardAreaHighlight();
              return true;
            };

            const applyKeyboardAreaSelection = () => {
              if (!keyboardAreaId) return false;
              const items = getAreaItems(keyboardAreaId);
              if (!items.length) return false;
              items[keyboardAreaIndex]?.click?.();
              return true;
            };

            const normalizeSuggestText = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");

            const fuzzyMatch = (query, label) => {
              const normalizedQuery = normalizeSuggestText(query);
              const normalizedLabel = normalizeSuggestText(label);
              if (!normalizedQuery) return true;
              if (normalizedLabel.includes(normalizedQuery)) return true;
              let cursor = 0;
              for (const ch of normalizedQuery) {
                cursor = normalizedLabel.indexOf(ch, cursor);
                if (cursor < 0) return false;
                cursor += 1;
              }
              return true;
            };

            const refreshCommandSuggestItems = () => {
              commandSuggestItems = commandDefinitions.filter((command) => fuzzyMatch(commandSuggestQuery, command.label));
              if (commandSuggestActiveIndex >= commandSuggestItems.length) {
                commandSuggestActiveIndex = 0;
              }
            };

            const openAreaSuggest = () => {
              clearKeyboardAreaState();
              inlineSuggestMode = "area";
              commandSuggestQuery = "";
              commandSuggestItems = getAreaDefinitions();
              commandSuggestActiveIndex = 0;
              renderInlineSuggest();
            };

            const handleBuilderShortcut = (event) => {
              const key = String(event.key || "");
              const code = String(event.code || "");
              const hasCommandModifier = event.ctrlKey || event.metaKey;
              const isCommandShortcut = hasCommandModifier && (
                key === "@" ||
                (event.shiftKey && (key === "2" || code === "Digit2"))
              );
              const isAreaShortcut = hasCommandModifier && !event.altKey && (
                key.toLowerCase() === "p" ||
                code === "KeyP"
              );
              if (isCommandShortcut) {
                event.preventDefault();
                openInlineSuggest();
                return true;
              }
              if (isAreaShortcut) {
                event.preventDefault();
                openAreaSuggest();
                return true;
              }
              return false;
            };

            const applyCommand = async (index = commandSuggestActiveIndex) => {
              const command = commandSuggestItems[index];
              if (!command) return;
              if (inlineSuggestMode === "area") {
                hideInlineSuggest();
                activateKeyboardArea(command.id);
                return;
              }
              hideInlineSuggest();
              await Promise.resolve(command.run());
            };

            const renderInlineSuggest = () => {
              const activeEditor = getActiveEditorInstance();
              if (!parts.inlineCommandSuggest || !parts.inlineCommandList || !activeEditor) return;
              if (parts.inlineCommandQuery) {
                if (inlineSuggestMode === "area") {
                  parts.inlineCommandQuery.textContent = "エリア選択";
                } else {
                  parts.inlineCommandQuery.textContent = commandSuggestQuery ? `> ${commandSuggestQuery}` : "コマンド検索";
                }
              }
              parts.inlineCommandList.innerHTML = "";
              if (!commandSuggestItems.length) {
                const empty = document.createElement("div");
                empty.className = "sqlbilder-inline-suggest__empty";
                empty.textContent = "候補がありません";
                parts.inlineCommandList.appendChild(empty);
              }
              commandSuggestItems.forEach((command, index) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `sqlbilder-inline-suggest__item${index === commandSuggestActiveIndex ? " is-active" : ""}`;
                button.textContent = command.label;
                button.onmousedown = (event) => event.preventDefault();
                button.onclick = () => { void applyCommand(index); };
                parts.inlineCommandList.appendChild(button);
              });
              const cursor = activeEditor.cursorCoords(null, "window");
              parts.inlineCommandSuggest.style.left = `${Math.max(12, cursor.left)}px`;
              parts.inlineCommandSuggest.style.top = `${cursor.bottom + 6}px`;
              parts.inlineCommandSuggest.hidden = !commandSuggestItems.length;
            };

            const openInlineSuggest = () => {
              clearKeyboardAreaState();
              inlineSuggestMode = "command";
              commandSuggestQuery = "";
              refreshCommandSuggestItems();
              commandSuggestActiveIndex = 0;
              renderInlineSuggest();
            };

            const moveCommandSelection = (delta) => {
              if (!commandSuggestItems.length) return;
              commandSuggestActiveIndex = (commandSuggestActiveIndex + delta + commandSuggestItems.length) % commandSuggestItems.length;
              renderInlineSuggest();
            };

            const renderEditorViewToggle = (toggleRoot, mode, onChange) => {
              if (!toggleRoot) return;
              toggleRoot.innerHTML = "";
              [
                { id: "cte", label: "CTE" },
                { id: "full", label: "全文" }
              ].forEach((item) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `sqlbilder-editor-view-toggle__btn${item.id === mode ? " is-active" : ""}`;
                button.textContent = item.label;
                button.addEventListener("click", () => {
                  if (typeof onChange === "function") onChange(item.id);
                });
                toggleRoot.appendChild(button);
              });
            };

            const renderResultsViewToggle = (toggleRoot, mode, onChange) => {
              if (!toggleRoot) return;
              toggleRoot.innerHTML = "";
              [
                { id: "schema", label: "スキーマ" },
                { id: "data", label: "データ" },
                { id: "summary", label: "サマリ" }
              ].forEach((item) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `sqlbilder-editor-view-toggle__btn${item.id === mode ? " is-active" : ""}`;
                button.textContent = item.label;
                button.addEventListener("click", () => {
                  if (typeof onChange === "function") onChange(item.id);
                });
                toggleRoot.appendChild(button);
              });
            };

            const rerender = (options = {}) => {
              ensureSqlbilderState(appState);
              renderCatalogToggle(parts.catalogToggle, state, rerender);
              syncCatalogVisibility(parts, state);
              renderDataCatalog(parts.dataCatalogListRoot, state, rerender, appState);
              renderFlowList(parts.flowListRoot, state, rerender, appState);
              renderSqlCatalog(parts.sqlCatalogListRoot, state, rerender, appState);
              renderEditorTabs(parts.primaryEditorTabsRoot, state, rerender, appState, "primary");
              renderEditorTabs(parts.secondaryEditorTabsRoot, state, rerender, appState, "secondary");
              const primaryPaneState = buildEditorPaneState(
                state,
                getPrimaryTab(state),
                getPaneSelectedNodeId(state, "primary"),
                state.editor.primaryViewMode
              );
              renderEditorViewToggle(parts.primaryEditorToggle, primaryPaneState.viewMode, (nextMode) => {
                state.editor.primaryViewMode = nextMode;
                rerender();
              });
              if (primaryEditorInstance) {
                suppressPrimarySync = true;
                updateEditorPane(parts.primaryEditorMeta, primaryEditorInstance, primaryPaneState, options);
                suppressPrimarySync = false;
              } else {
                updateEditorPane(parts.primaryEditorMeta, null, primaryPaneState, options);
              }
              const compareTab = getSecondaryTab(state);
              const comparePaneState = compareTab
                ? buildEditorPaneState(
                    state,
                    compareTab,
                    getPaneSelectedNodeId(state, "secondary"),
                    state.editor.secondaryViewMode
                  )
                : null;
              renderEditorViewToggle(parts.secondaryEditorToggle, comparePaneState?.viewMode || state.editor.secondaryViewMode, (nextMode) => {
                state.editor.secondaryViewMode = nextMode;
                rerender();
              });
              if (parts.secondaryEditorPanel) {
                parts.secondaryEditorPanel.hidden = false;
              }
              if (parts.editorPanels) {
                parts.editorPanels.classList.add("is-split");
              }
              if (secondaryEditorInstance) {
                suppressSecondarySync = true;
                updateEditorPane(parts.secondaryEditorMeta, secondaryEditorInstance, comparePaneState || {
                  tabTitle: "",
                  selectedLabel: "",
                  value: ""
                }, options);
                suppressSecondarySync = false;
              } else {
                updateEditorPane(parts.secondaryEditorMeta, null, comparePaneState || {
                  tabTitle: "",
                  selectedLabel: "",
                  value: ""
                }, options);
              }
              renderResultsViewToggle(parts.resultsToggle, state.editor.resultViewMode, (nextMode) => {
                state.editor.resultViewMode = nextMode;
                rerender();
              });
              renderResultsPane(parts.resultsBody, state);
              applyLeftPaneWidth(parts.root, state.layout?.leftWidth || 320);
              applyMainPaneHeights(parts.main, state.layout?.mainHeights || [0.68, 0.32]);
              installLeftSplitters(parts, state, rerender);
              if (!commandSuggestItems.length) {
                hideInlineSuggest();
              } else {
                renderInlineSuggest();
              }
            };

            const applyPrimaryEditorChange = (nextText) => {
              if (suppressPrimarySync) return;
              const primaryTab = getPrimaryTab(state);
              if (!primaryTab) return;
              const selectedNodeId = getPaneSelectedNodeId(state, "primary");
              const beforeSelected = (primaryTab.ctes || []).find((cte) => String(cte?.id || "") === selectedNodeId);
              const beforeLabel = String(beforeSelected?.label || "");
              const beforeKind = String(beforeSelected?.kind || "");
              const beforeNodeCount = Array.isArray(primaryTab?.ctes) ? primaryTab.ctes.length : 0;
              let nextPrimaryCtes = primaryTab.ctes || [];
              if (state.editor.primaryViewMode === "full" && typeof sqlbilder.flowlist?.parseSqlDocumentToCtes === "function") {
                nextPrimaryCtes = sqlbilder.flowlist.parseSqlDocumentToCtes(String(nextText || ""));
              } else if (typeof editorApi.replaceSelectedCteBlock === "function") {
                nextPrimaryCtes = editorApi.replaceSelectedCteBlock(
                  primaryTab.ctes || [],
                  selectedNodeId,
                  String(nextText || "")
                );
              }
              syncPaneTab(state, "primary", nextPrimaryCtes, selectedNodeId);
              if (getFlowSourcePane(state) === "primary") {
                state.ctes = cloneCtes(nextPrimaryCtes);
              }
              ensureSqlbilderState(appState);
              const refreshedPrimaryTab = getPrimaryTab(state);
              const afterSelected = (refreshedPrimaryTab?.ctes || []).find((cte) => String(cte?.id || "") === getPaneSelectedNodeId(state, "primary"));
              const afterLabel = String(afterSelected?.label || "");
              const afterKind = String(afterSelected?.kind || "");
              const afterNodeCount = Array.isArray(refreshedPrimaryTab?.ctes) ? refreshedPrimaryTab.ctes.length : 0;
              return {
                rerender:
                  state.editor.primaryViewMode === "full" ||
                  beforeLabel !== afterLabel ||
                  beforeKind !== afterKind ||
                  beforeNodeCount !== afterNodeCount
              };
            };

            const applySecondaryEditorChange = (nextText) => {
              if (suppressSecondarySync) return;
              const compareTab = getSecondaryTab(state);
              if (!compareTab) return;
              const selectedNodeId = getPaneSelectedNodeId(state, "secondary");
              const beforeSelected = (compareTab?.ctes || []).find((cte) => String(cte?.id || "") === selectedNodeId);
              const beforeLabel = String(beforeSelected?.label || "");
              const beforeKind = String(beforeSelected?.kind || "");
              const beforeNodeCount = Array.isArray(compareTab?.ctes) ? compareTab.ctes.length : 0;
              let nextCompareCtes = compareTab.ctes || [];
              if (state.editor.secondaryViewMode === "full" && typeof sqlbilder.flowlist?.parseSqlDocumentToCtes === "function") {
                nextCompareCtes = sqlbilder.flowlist.parseSqlDocumentToCtes(String(nextText || ""));
              } else if (typeof editorApi.replaceSelectedCteBlock === "function") {
                nextCompareCtes = editorApi.replaceSelectedCteBlock(
                  compareTab.ctes || [],
                  selectedNodeId,
                  String(nextText || "")
                );
              }
              syncPaneTab(state, "secondary", nextCompareCtes, selectedNodeId);
              if (getFlowSourcePane(state) === "secondary") {
                state.ctes = cloneCtes(nextCompareCtes);
              }
              ensureSqlbilderState(appState);
              const refreshedCompareTab = getSecondaryTab(state);
              const afterSelected = (refreshedCompareTab?.ctes || []).find((cte) => String(cte?.id || "") === getPaneSelectedNodeId(state, "secondary"));
              const afterLabel = String(afterSelected?.label || "");
              const afterKind = String(afterSelected?.kind || "");
              const afterNodeCount = Array.isArray(refreshedCompareTab?.ctes) ? refreshedCompareTab.ctes.length : 0;
              return {
                rerender:
                  state.editor.secondaryViewMode === "full" ||
                  beforeLabel !== afterLabel ||
                  beforeKind !== afterKind ||
                  beforeNodeCount !== afterNodeCount
              };
            };

            const runtimeCodeEditors = getCodeEditors();
            if (parts.primaryEditorHost && typeof runtimeCodeEditors.mountCodeEditor === "function") {
              parts.primaryEditorHost.addEventListener("mousedown", () => {
                setFocusedPane("primary", { silent: true });
              });
              parts.primaryEditorHost.addEventListener("dragover", (event) => {
                event.preventDefault();
                setFocusedPane("primary", { silent: true });
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              });
              parts.primaryEditorHost.addEventListener("drop", (event) => {
                const text = event.dataTransfer?.getData("text/plain") || "";
                if (!text) return;
                event.preventDefault();
                insertTextIntoPane("primary", text);
              });
              primaryEditorInstance = await runtimeCodeEditors.mountCodeEditor({
                host: parts.primaryEditorHost,
                value: String(state.editor.selectedCteBody || ""),
                language: "sql",
                variableNames: [],
                onInputChanged: (value) => {
                  if (primaryEditorComposing) return;
                  const result = applyPrimaryEditorChange(value) || {};
                  appState.__sqlbilderEditorCursor = primaryEditorInstance?.getCursor?.() || appState.__sqlbilderEditorCursor;
                  if (result.rerender) {
                    rerender({ cursor: primaryEditorInstance?.getCursor?.() });
                  }
                },
                onCommitChanged: (value) => {
                  if (primaryEditorComposing) return;
                  const result = applyPrimaryEditorChange(value) || {};
                  appState.__sqlbilderEditorCursor = primaryEditorInstance?.getCursor?.() || appState.__sqlbilderEditorCursor;
                  if (result.rerender) {
                    rerender({ cursor: primaryEditorInstance?.getCursor?.() });
                  }
                }
              });
              appState.__sqlbilderPrimaryEditorInstance = primaryEditorInstance;
              appState.__sqlbilderEditorCursor = primaryEditorInstance.getCursor();
              primaryEditorInstance.on("focus", () => {
                setFocusedPane("primary");
              });
              primaryEditorInstance.on("compositionstart", () => {
                primaryEditorComposing = true;
              });
              primaryEditorInstance.on("compositionend", () => {
                primaryEditorComposing = false;
                const result = applyPrimaryEditorChange(primaryEditorInstance.getValue()) || {};
                appState.__sqlbilderEditorCursor = primaryEditorInstance.getCursor();
                if (result.rerender) {
                  rerender({ cursor: primaryEditorInstance.getCursor() });
                }
              });
              primaryEditorInstance.on("keydown", (_, event) => {
                if (handleBuilderShortcut(event)) {
                  return;
                }
                if (event.key === "ArrowDown" && commandSuggestItems.length) {
                  event.preventDefault();
                  moveCommandSelection(1);
                  return;
                }
                if (event.key === "ArrowUp" && commandSuggestItems.length) {
                  event.preventDefault();
                  moveCommandSelection(-1);
                  return;
                }
                if ((event.key === "Enter" || event.key === "Tab") && commandSuggestItems.length) {
                  event.preventDefault();
                  void applyCommand();
                  return;
                }
                if (parts.inlineCommandSuggest && !parts.inlineCommandSuggest.hidden && event.key === "Escape") {
                  event.preventDefault();
                  hideInlineSuggest();
                  return;
                }
                if (!commandSuggestItems.length && keyboardAreaId) {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveKeyboardAreaSelection(1);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveKeyboardAreaSelection(-1);
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyKeyboardAreaSelection();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    clearKeyboardAreaState();
                    return;
                  }
                }
                if (parts.inlineCommandSuggest && !parts.inlineCommandSuggest.hidden) {
                  if (inlineSuggestMode === "command" && event.key === "Backspace") {
                    event.preventDefault();
                    commandSuggestQuery = commandSuggestQuery.slice(0, -1);
                    refreshCommandSuggestItems();
                    renderInlineSuggest();
                    return;
                  }
                  if (inlineSuggestMode === "command" && !event.ctrlKey && !event.metaKey && !event.altKey && String(event.key || "").length === 1) {
                    event.preventDefault();
                    commandSuggestQuery += event.key;
                    refreshCommandSuggestItems();
                    renderInlineSuggest();
                    return;
                  }
                }
              });
              primaryEditorInstance.on("cursorActivity", () => {
                appState.__sqlbilderEditorCursor = primaryEditorInstance.getCursor();
                if (getLastFocusedPane() !== "primary") {
                  setFocusedPane("primary");
                  return;
                }
                if (commandSuggestItems.length) {
                  hideInlineSuggest();
                }
              });
            }
            if (parts.secondaryEditorHost && typeof runtimeCodeEditors.mountCodeEditor === "function") {
              parts.secondaryEditorHost.addEventListener("mousedown", () => {
                setFocusedPane("secondary", { silent: true });
              });
              parts.secondaryEditorHost.addEventListener("dragover", (event) => {
                event.preventDefault();
                setFocusedPane("secondary", { silent: true });
                if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              });
              parts.secondaryEditorHost.addEventListener("drop", (event) => {
                const text = event.dataTransfer?.getData("text/plain") || "";
                if (!text) return;
                event.preventDefault();
                insertTextIntoPane("secondary", text);
              });
              secondaryEditorInstance = await runtimeCodeEditors.mountCodeEditor({
                host: parts.secondaryEditorHost,
                value: "",
                language: "sql",
                variableNames: [],
                onInputChanged: (value) => {
                  if (secondaryEditorComposing) return;
                  const result = applySecondaryEditorChange(value) || {};
                  if (result.rerender) {
                    rerender();
                  }
                },
                onCommitChanged: (value) => {
                  if (secondaryEditorComposing) return;
                  const result = applySecondaryEditorChange(value) || {};
                  if (result.rerender) {
                    rerender();
                  }
                }
              });
              secondaryEditorInstance.on("focus", () => {
                setFocusedPane("secondary");
              });
              secondaryEditorInstance.on("compositionstart", () => {
                secondaryEditorComposing = true;
              });
              secondaryEditorInstance.on("compositionend", () => {
                secondaryEditorComposing = false;
                const result = applySecondaryEditorChange(secondaryEditorInstance.getValue()) || {};
                if (result.rerender) {
                  rerender();
                }
              });
              secondaryEditorInstance.on("cursorActivity", () => {
                if (getLastFocusedPane() !== "secondary") {
                  setFocusedPane("secondary");
                  return;
                }
                if (commandSuggestItems.length) {
                  hideInlineSuggest();
                }
              });
            }

            if (typeof appState.__sqlbilderGlobalKeydownDisposer === "function") {
              appState.__sqlbilderGlobalKeydownDisposer();
            }
            if (typeof appState.__sqlbilderGlobalPointerDisposer === "function") {
              appState.__sqlbilderGlobalPointerDisposer();
            }
            const globalKeydownHandler = (event) => {
              if (!parts.root?.isConnected) return;
              if (handleBuilderShortcut(event)) {
                return;
              }
              if (!commandSuggestItems.length && keyboardAreaId) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveKeyboardAreaSelection(1);
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveKeyboardAreaSelection(-1);
                  return;
                }
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyKeyboardAreaSelection();
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  clearKeyboardAreaState();
                  return;
                }
              }
            };
            document.addEventListener("keydown", globalKeydownHandler, true);
            const globalPointerHandler = (event) => {
              if (!parts.root?.isConnected) return;
              const target = event.target;
              if (parts.inlineCommandSuggest?.contains(target)) return;
              hideInlineSuggestIfOpen();
            };
            document.addEventListener("mousedown", globalPointerHandler, true);
            appState.__sqlbilderGlobalKeydownDisposer = () => {
              document.removeEventListener("keydown", globalKeydownHandler, true);
            };
            appState.__sqlbilderGlobalPointerDisposer = () => {
              document.removeEventListener("mousedown", globalPointerHandler, true);
            };

            rerender();
          }
        });
        return state;
      }
    };
  }

  const api = createSqlbilderPageApi();

  window.zizSqlbilderPage = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.page = api;
})();
