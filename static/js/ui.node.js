(function () {
  const { el } = window.utils;
  const {
    addNodeAfter,
    addParallelAfter,
    insertNodeAt,
    moveNodeToInsert,
    moveNodeToParallel,
    removeNode,
    setSelectedNode
  } = window.stateOps;
  const { renderField, getFieldReferenceWarnings } = window.uiFields;

  const NODE_W = 52;
  const NODE_H = 52;
  const LEVEL_MARGIN = 112;
  const MIN_SIBLING_GAP = 44;
  const START_X = 44;
  const START_Y = 40;
  const BTN_X_OFFSET = 12;
  const BTN_GAP = 20;
  const BTN_R = 8;
  const BTN_HIT_SLOP = 32;
  const BTN_HIT_BIAS_Y = 32;
  const EDGE_CURVE = 42;
  const ICON_CACHE = new Map();

  function jpLabel(x) {
    return (x && (x.label_jp || x.label)) || (x && x.id) || "";
  }

  function normalizeSteps(state) {
    let next = Number(state.nextStepSeq) || 1;
    state.nodes.forEach((node) => {
      const m = String(node.stepName || "").match(/^step(\d+)$/);
      if (m) {
        const num = Number(m[1]);
        if (Number.isFinite(num) && num >= next) next = num + 1;
        return;
      }
      node.stepName = `step${next}`;
      next += 1;
    });
    state.nextStepSeq = next;

    if (!state.selectedNodeId && state.nodes.length) {
      state.selectedNodeId = state.nodes[0].id;
    }
  }

  function getUpstreamSteps(state, nodeId) {
    const byId = new Map(state.nodes.map((n) => [n.id, n]));
    const target = byId.get(nodeId);
    if (!target) return [];

    const out = [];
    let parentId = target.parentId || null;
    while (parentId) {
      const parent = byId.get(parentId);
      if (!parent) break;
      out.unshift(parent.stepName);
      parentId = parent.parentId || null;
    }
    return out;
  }

  function getFormSchema(config, connector, action) {
    return (config.forms && config.forms[`${connector}.${action}`]) || [];
  }

  function getActionConfig(config, connector, action) {
    const actions = (config.actions && config.actions[connector]) || [];
    return actions.find((a) => a.id === action) || null;
  }

  function applyModalResultToNodeForm(node, detailModal, result) {
    if (!node) return;
    if (!node.form) node.form = {};
    const fieldMap = (detailModal && detailModal.resultFieldMap) || {};

    Object.entries(fieldMap).forEach(([resultKey, formKey]) => {
      if (!formKey) return;
      if (!result || !Object.prototype.hasOwnProperty.call(result, resultKey)) return;
      node.form[formKey] = result[resultKey];
    });
  }

  function openConfiguredDetailModal({ node, detailModal, onStateChanged }) {
    if (!detailModal || !detailModal.type) return;

    if (detailModal.type === "excel") {
      if (!window.ExcelModal || typeof window.ExcelModal.open !== "function") {
        alert("Excelアシスタントを読み込めませんでした。");
        return;
      }
      window.ExcelModal.open({
        onOk: (result) => {
          applyModalResultToNodeForm(node, detailModal, result);
          if (onStateChanged) onStateChanged();
        }
      });
      return;
    }

    alert(`未対応のモーダル種別です: ${detailModal.type}`);
  }

  function requestNodeRun(node, mode, onStateChanged) {
    if (!node) return;
    if (!Array.isArray(node.runtimeLogs)) node.runtimeLogs = [];
    const timestamp = new Date().toISOString();
    const modeLabel = mode === "through" ? "フロー実行" : "ステップ実行";
    node.runtimeLogs.push(`[${timestamp}] ${modeLabel} をリクエストしました（未実装）`);
    window.dispatchEvent(
      new CustomEvent("fleetly:node-run-request", {
        detail: { mode, nodeId: node.id, stepName: node.stepName, connector: node.connector, action: node.action }
      })
    );
    if (onStateChanged) onStateChanged();
  }

  function requestNodeRunById(state, nodeId, mode, onStateChanged) {
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node) return;
    requestNodeRun(node, mode, onStateChanged);
  }

  function removeNodeById(state, nodeId, onStateChanged) {
    const idx = state.nodes.findIndex((item) => item.id === nodeId);
    if (idx < 0) return;
    const node = state.nodes[idx];
    if (isLoopRootNode(node)) {
      const ok = window.confirm("ループ内のすべてのノードが削除されますが、削除してよろしいでしょうか。");
      if (!ok) return;
    }
    removeNode(state, idx);
    if (onStateChanged) onStateChanged();
  }

  function ensureNodeDefaults(config, node) {
    if (!node.connector) node.connector = config.connectors?.[0]?.id || "";
    if (!node.action) {
      const actions = config.actions?.[node.connector] || [];
      node.action = actions[0]?.id || "";
    }
    if (!node.form) node.form = {};
  }

  function hasMissingRequiredField(config, node) {
    const schema = getFormSchema(config, node.connector, node.action);
    for (const field of schema) {
      if (!field.required) continue;
      const hasExplicit = node.form && Object.prototype.hasOwnProperty.call(node.form, field.key);
      const useDefaultWhenUnset = field.key !== "input_data";
      const v = hasExplicit ? node.form[field.key] : (useDefaultWhenUnset ? field.default : "");
      const empty = v === undefined || v === null || String(v) === "";
      if (empty) return true;
    }
    return false;
  }

  function getSelectedNodeIndex(state) {
    const idx = state.nodes.findIndex((n) => n.id === state.selectedNodeId);
    return idx >= 0 ? idx : 0;
  }

  function isLoopRootNode(node) {
    return !!node && node.action === "loop_tasks" && !node.loopOwnerId;
  }

  function isDraggableNode(node) {
    return !!node && !isLoopRootNode(node) && !node.loopOwnerId;
  }

  function collectNodeAndDescendantIds(state, nodeId) {
    const seen = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const currentId = queue.shift();
      if (!currentId || seen.has(currentId)) continue;
      seen.add(currentId);
      getChildrenByParent(state, currentId).forEach((child) => {
        if (!seen.has(child.id)) queue.push(child.id);
      });
    }
    return seen;
  }

  function canDropDraggedNodeOnControl(state, nodeId, control) {
    if (!control || control.mode !== "normal") return false;
    if (control.kind === "parallel" && !control.rightId) return false;

    const node = state.nodes.find((item) => item.id === nodeId);
    if (!isDraggableNode(node)) return false;

    const blockedIds = collectNodeAndDescendantIds(state, nodeId);
    if (control.anchorId && blockedIds.has(control.anchorId)) return false;
    if (control.rightId && blockedIds.has(control.rightId)) return false;
    if (control.loopRootId && blockedIds.has(control.loopRootId)) return false;
    return true;
  }

  function applyDraggedNodeDrop(state, nodeId, control) {
    if (!canDropDraggedNodeOnControl(state, nodeId, control)) return false;
    if (control.kind === "insert") {
      return !!moveNodeToInsert?.(state, nodeId, {
        anchorId: control.anchorId === "__start__" ? null : control.anchorId,
        rightId: control.rightId || null
      });
    }
    if (control.kind === "parallel") {
      return !!moveNodeToParallel?.(state, nodeId, {
        anchorId: control.anchorId === "__start__" ? null : control.anchorId,
        rightId: control.rightId || null
      });
    }
    return false;
  }

  function getMissingRequiredFieldLabels(config, node) {
    const schema = getFormSchema(config, node.connector, node.action);
    return schema
      .filter((field) => {
        if (!field.required) return false;
        const hasExplicit = node.form && Object.prototype.hasOwnProperty.call(node.form, field.key);
        const useDefaultWhenUnset = field.key !== "input_data";
        const value = hasExplicit ? node.form[field.key] : (useDefaultWhenUnset ? field.default : "");
        return value === undefined || value === null || String(value).trim() === "";
      })
      .map((field) => field.label || field.key);
  }

  function getNodeReferenceWarnings(config, state, node) {
    if (!node) return [];
    const upstreamSteps = getUpstreamSteps(state, node.id);
    const schema = getFormSchema(config, node.connector, node.action);
    return schema.flatMap((field) => getFieldReferenceWarnings({ node, field, upstreamSteps }));
  }

  function hasInvalidUpstreamReference(config, state, node) {
    return getNodeReferenceWarnings(config, state, node).length > 0;
  }

  function getChildrenByParent(state, parentId) {
    return state.nodes
      .filter((n) => (n.parentId ?? null) === (parentId ?? null))
      .sort((a, b) => (Number(a.parallelOrder) || 1) - (Number(b.parallelOrder) || 1));
  }

  function getLoopFirstInternalChild(state, loopRootId) {
    return getChildrenByParent(state, loopRootId).find((n) => n.loopOwnerId === loopRootId) || null;
  }

  function getLoopOutsideChildren(state, loopRootId) {
    return getChildrenByParent(state, loopRootId).filter((n) => n.loopOwnerId !== loopRootId);
  }

  function normalizeChildrenForParent(state, parentId) {
    const children = getChildrenByParent(state, parentId);
    if (!children.length) return;
    const first = children[0];
    children.forEach((child, idx) => {
      child.parallelOrder = idx + 1;
      child.parallelOf = idx === 0 ? null : first.id;
    });
  }

  function moveChildBefore(state, parentId, childId, beforeId) {
    const children = getChildrenByParent(state, parentId);
    const target = children.find((n) => n.id === childId);
    if (!target) return;
    const rest = children.filter((n) => n.id !== childId);
    const pos = rest.findIndex((n) => n.id === beforeId);
    const ordered = pos >= 0
      ? [...rest.slice(0, pos), target, ...rest.slice(pos)]
      : [...rest, target];
    if (!ordered.length) return;
    const first = ordered[0];
    ordered.forEach((node, idx) => {
      node.parallelOrder = idx + 1;
      node.parallelOf = idx === 0 ? null : first.id;
    });
  }

  function moveChildToFirst(state, parentId, childId) {
    const children = getChildrenByParent(state, parentId);
    if (!children.length) return;
    const firstId = children[0].id;
    if (firstId === childId) return;
    moveChildBefore(state, parentId, childId, firstId);
  }

  function createNodeAtParentEnd(state, parentId) {
    const before = new Set(state.nodes.map((n) => n.id));
    const siblings = getChildrenByParent(state, parentId);
    if (siblings.length) {
      const sourceIndex = state.nodes.findIndex((n) => n.id === siblings[0].id);
      if (sourceIndex >= 0) addParallelAfter(state, sourceIndex, { parentId });
    } else if (parentId === null) {
      insertNodeAt(state, 0);
    } else {
      const parentIndex = state.nodes.findIndex((n) => n.id === parentId);
      if (parentIndex >= 0) addNodeAfter(state, parentIndex);
    }
    return state.nodes.find((n) => !before.has(n.id)) || null;
  }

  function runAndFindNewNode(state, fn) {
    const before = new Set(state.nodes.map((n) => n.id));
    fn();
    return state.nodes.find((n) => !before.has(n.id)) || null;
  }

  function createNodeAfterAnchor(state, anchorId) {
    if (!anchorId) {
      return runAndFindNewNode(state, () => insertNodeAt(state, 0));
    }
    const anchorIndex = state.nodes.findIndex((n) => n.id === anchorId);
    if (anchorIndex < 0) return null;
    return runAndFindNewNode(state, () => addNodeAfter(state, anchorIndex));
  }

  function createParallelNodeAtParent(state, parentId, sourceId) {
    const sourceIndex = state.nodes.findIndex((n) => n.id === sourceId);
    if (sourceIndex < 0) return null;
    return runAndFindNewNode(state, () => addParallelAfter(state, sourceIndex, { parentId }));
  }

  function insertLoopInternalAtAnchor(state, loopRootId, anchorId) {
    if (!loopRootId || !anchorId) return null;
    const internalNext = getChildrenByParent(state, anchorId).find((n) => n.loopOwnerId === loopRootId) || null;
    let newNode = null;

    if (internalNext) {
      moveChildToFirst(state, anchorId, internalNext.id);
      newNode = createNodeAfterAnchor(state, anchorId);
    } else {
      newNode = createNodeAtParentEnd(state, anchorId);
    }
    if (!newNode) return null;

    newNode.loopOwnerId = loopRootId;
    normalizeChildrenForParent(state, anchorId);
    normalizeChildrenForParent(state, newNode.id);
    return newNode;
  }

  function insertAfterLoopEnd(state, loopRootId, rightId) {
    if (!loopRootId) return null;
    const right = rightId ? state.nodes.find((n) => n.id === rightId) : null;

    let newNode = null;
    if (right && (right.parentId ?? null) === loopRootId) {
      moveChildToFirst(state, loopRootId, right.id);
      newNode = createNodeAfterAnchor(state, loopRootId);
    } else {
      newNode = createNodeAtParentEnd(state, loopRootId);
    }
    if (!newNode) return null;

    delete newNode.loopOwnerId;
    normalizeChildrenForParent(state, loopRootId);
    normalizeChildrenForParent(state, newNode.id);
    return newNode;
  }

  function addParallelAfterLoopEnd(state, loopRootId, rightId) {
    if (!loopRootId || !rightId) return null;
    const right = state.nodes.find((n) => n.id === rightId);
    if (!right || (right.parentId ?? null) !== loopRootId) return null;

    const newNode = createParallelNodeAtParent(state, loopRootId, right.id);
    if (!newNode) return null;
    delete newNode.loopOwnerId;
    normalizeChildrenForParent(state, loopRootId);
    return newNode;
  }

  function getActionLabel(config, connectorId, actionId) {
    const actions = config.actions?.[connectorId] || [];
    const action = actions.find((a) => a.id === actionId);
    return jpLabel(action || { id: actionId });
  }

  function buildNodeYamlSettings(node) {
    const out = {
      step: String(node.stepName || ""),
      connector: String(node.connector || ""),
      action: String(node.action || ""),
      form: { ...(node.form || {}) }
    };
    if (node.parentId) out.parent_id = node.parentId;
    if (node.parallelOf) out.parallel_of = node.parallelOf;
    if (node.parallelOrder !== undefined && node.parallelOrder !== null) {
      const num = Number(node.parallelOrder);
      out.parallel_order = Number.isFinite(num) ? num : node.parallelOrder;
    }
    if (node.loopOwnerId) out.loop_owner_id = node.loopOwnerId;
    return out;
  }

  function dumpYamlSafe(value) {
    const parser = window.jsyaml;
    if (parser && typeof parser.dump === "function") {
      try {
        return parser.dump(value, { lineWidth: -1, noRefs: true });
      } catch (err) {
        console.warn("yaml dump failed, fallback to internal yaml serializer", err);
      }
    }
    if (window.utils && typeof window.utils.toYaml === "function") {
      return window.utils.toYaml(value);
    }
    return JSON.stringify(value, null, 2);
  }

  function toLogText(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch (err) {
      return String(value);
    }
  }

  function getNodeLogLines(node) {
    const src = Array.isArray(node.logs)
      ? node.logs
      : Array.isArray(node.runtimeLogs)
        ? node.runtimeLogs
        : [];
    return src
      .map((item) => toLogText(item).trim())
      .filter((line) => line.length > 0);
  }

  const ACTION_TYPE_TABS = [
    { id: "Extract", label: "入力" },
    { id: "Load", label: "出力" },
    { id: "Transform", label: "加工" }
  ];
  const NOIMAGE_SRC = "./img/noimage.png";

  function isDataConnector(connectorId, config) {
    const connectors = config?.connectors || [];
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector) return false;
    return connector.category === "data";
  }

  function connectorDisplayLabel(connector) {
    if (!connector) return "";
    const label = jpLabel(connector);
    const id = connector.id || "";
    return label || id;
  }

  function normalizeActionType(actionType) {
    return ACTION_TYPE_TABS.some((tab) => tab.id === actionType) ? actionType : "Transform";
  }

  function getActionTypeLabel(actionType) {
    return ACTION_TYPE_TABS.find((tab) => tab.id === normalizeActionType(actionType))?.label || "加工";
  }

  function buildConnectorChoices(config, selectedConnectorId) {
    const connectors = [...(config.connectors || [])];
    if (selectedConnectorId && !connectors.some((connector) => connector.id === selectedConnectorId)) {
      connectors.push({ id: selectedConnectorId, label: selectedConnectorId });
    }
    return connectors;
  }

  function getConnectorImageSrc(connectorId) {
    return connectorId ? `./img/${connectorId}.png` : NOIMAGE_SRC;
  }

  function getActionTypeItems(config, connectorId, actionType) {
    const actions = (config.actions && config.actions[connectorId]) || [];
    return actions.filter((action) => normalizeActionType(action.rpaType) === normalizeActionType(actionType));
  }

  function renderConnectorSelect({ config, node, onStateChanged, disabled = false }) {
    const connectors = buildConnectorChoices(config, node.connector);
    let activeConnectorId = node.connector || (connectors[0]?.id || "");
    let activeActionType = normalizeActionType(getActionConfig(config, node.connector, node.action)?.rpaType);
    let stage = "grid";

    const wrapper = el("div", { class: "connector-flyout" });
    const trigger = el("button", { class: "connector-flyout-trigger", type: "button" });
    const menu = el("div", { class: "connector-flyout-menu" });
    const gridPane = el("div", { class: "connector-stage connector-stage-grid" });
    const actionPane = el("div", { class: "connector-stage connector-stage-actions", hidden: "hidden" });
    const gridList = el("div", { class: "connector-image-grid" });
    const actionHeader = el("div", { class: "connector-action-head" });
    const backButton = el(
      "button",
      {
        type: "button",
        class: "connector-back-btn",
        onclick: () => {
          stage = "grid";
          renderStage();
        }
      },
      [document.createTextNode("戻る")]
    );
    const connectorTitle = el("div", { class: "connector-action-title" });
    const actionTabs = el("div", { class: "connector-action-tabs", role: "tablist", "aria-label": "アクション種別" });
    const actionList = el("div", { class: "connector-action-list" });

    actionHeader.appendChild(backButton);
    actionHeader.appendChild(connectorTitle);
    actionPane.appendChild(actionHeader);
    actionPane.appendChild(actionTabs);
    actionPane.appendChild(actionList);
    gridPane.appendChild(gridList);
    menu.appendChild(gridPane);
    menu.appendChild(actionPane);
    wrapper.appendChild(trigger);
    wrapper.appendChild(menu);

    let open = false;
    let outsideHandler = null;

    function updateTriggerLabel() {
      const selected =
        (config.connectors || []).find((c) => c.id === node.connector) ||
        connectors.find((c) => c.id === node.connector) ||
        { id: node.connector || "", label: node.connector || "" };
      const connectorText = connectorDisplayLabel(selected) || "コネクタを選択";
      const actionText = getActionLabel(config, node.connector, node.action) || "";
      const merged = actionText ? `${connectorText} / ${actionText}` : connectorText;
      trigger.textContent = merged;
      trigger.title = merged;
    }

    function normalizeActiveConnector() {
      if (!connectors.length) {
        activeConnectorId = "";
        return;
      }
      if (!connectors.some((item) => item.id === activeConnectorId)) {
        activeConnectorId = connectors[0].id;
      }
      const currentTypeItems = getActionTypeItems(config, activeConnectorId, activeActionType);
      if (!currentTypeItems.length) {
        const firstAvailableTab = ACTION_TYPE_TABS.find((tab) => getActionTypeItems(config, activeConnectorId, tab.id).length);
        activeActionType = firstAvailableTab?.id || "Transform";
      }
    }

    function setOpen(next) {
      if (disabled && next) return;
      if (open === next) return;
      open = next;
      wrapper.classList.toggle("is-open", open);
      if (open) {
        outsideHandler = (ev) => {
          if (!wrapper.contains(ev.target)) setOpen(false);
        };
        document.addEventListener("pointerdown", outsideHandler);
      } else if (outsideHandler) {
        document.removeEventListener("pointerdown", outsideHandler);
        outsideHandler = null;
      }
    }

    function renderGrid() {
      gridList.innerHTML = "";
      connectors.forEach((connector) => {
        const img = el("img", {
          class: "connector-image-thumb",
          src: getConnectorImageSrc(connector.id),
          alt: connectorDisplayLabel(connector),
          loading: "lazy"
        });
        img.addEventListener("error", () => {
          if (img.getAttribute("src") !== NOIMAGE_SRC) img.setAttribute("src", NOIMAGE_SRC);
        });

        const btn = el(
          "button",
          {
            type: "button",
            class: `connector-image-item${connector.id === node.connector ? " is-current" : ""}`,
            onclick: () => {
              activeConnectorId = connector.id;
              const currentAction = getActionConfig(config, connector.id, node.connector === connector.id ? node.action : "");
              activeActionType = normalizeActionType(currentAction?.rpaType);
              stage = "actions";
              renderStage();
            }
          },
          [
            el("span", { class: "connector-image-frame" }, [img]),
            el("span", { class: "connector-image-label" }, [document.createTextNode(connectorDisplayLabel(connector))])
          ]
        );
        gridList.appendChild(btn);
      });
    }

    function selectConnectorAction(connectorId, actionId) {
      if (disabled) return;
      const changed = node.connector !== connectorId || node.action !== actionId;
      node.connector = connectorId;
      node.action = actionId || "";
      if (changed) node.form = {};
      setOpen(false);
      onStateChanged();
    }

    function renderActionTabs() {
      actionTabs.innerHTML = "";
      ACTION_TYPE_TABS.forEach((tab) => {
        const hasItems = getActionTypeItems(config, activeConnectorId, tab.id).length > 0;
        const btn = el(
          "button",
          {
            type: "button",
            class: `connector-action-tab${tab.id === activeActionType ? " is-active" : ""}`,
            "data-empty": hasItems ? "false" : "true"
          },
          [document.createTextNode(tab.label)]
        );
        btn.addEventListener("mouseenter", () => {
          if (!hasItems) return;
          activeActionType = tab.id;
          renderActionTabs();
          renderActionList();
        });
        btn.addEventListener("click", () => {
          if (!hasItems) return;
          activeActionType = tab.id;
          renderActionTabs();
          renderActionList();
        });
        actionTabs.appendChild(btn);
      });
    }

    function renderActionList() {
      actionList.innerHTML = "";
      const actions = getActionTypeItems(config, activeConnectorId, activeActionType);
      if (!actions.length) {
        actionList.appendChild(
          el("div", { class: "connector-action-empty" }, [document.createTextNode("この種別のアクションがありません")])
        );
        return;
      }

      actions.forEach((action) => {
        const isSelected = node.connector === activeConnectorId && node.action === action.id;
        const btn = el(
          "button",
          {
            type: "button",
            class: `connector-action-btn${isSelected ? " is-active" : ""}`,
            onclick: () => selectConnectorAction(activeConnectorId, action.id)
          },
          [
            el("span", { class: "connector-action-kind" }, [document.createTextNode(getActionTypeLabel(action.rpaType))]),
            el("span", { class: "connector-action-name" }, [document.createTextNode(jpLabel(action || { id: action.id }))])
          ]
        );
        actionList.appendChild(btn);
      });
    }

    function renderStage() {
      normalizeActiveConnector();
      const activeConnector = connectors.find((connector) => connector.id === activeConnectorId) || null;
      const showActions = stage === "actions" && !!activeConnector;
      gridPane.hidden = showActions;
      actionPane.hidden = !showActions;
      wrapper.classList.toggle("is-stage-actions", showActions);
      renderGrid();
      if (!showActions) return;
      connectorTitle.textContent = connectorDisplayLabel(activeConnector);
      renderActionTabs();
      renderActionList();
    }

    trigger.addEventListener("click", (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      const nextOpen = !open;
      if (nextOpen) stage = "grid";
      setOpen(nextOpen);
      if (nextOpen) renderStage();
    });
    wrapper.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });

    normalizeActiveConnector();
    updateTriggerLabel();
    if (disabled) {
      trigger.disabled = true;
      trigger.title = `${trigger.title}（ループ構造維持のため変更不可）`;
    }
    renderStage();
    return wrapper;
  }

  function createPseudoNode(id, text, kind) {
    return {
      id,
      text,
      kind,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: []
    };
  }

  function createTaskView(node, config) {
    const connectorLabel = jpLabel(config.connectors.find((c) => c.id === node.connector) || { id: node.connector });
    const actionLabel = getActionLabel(config, node.connector, node.action);
    const subtitle = actionLabel;
    return {
      id: node.id,
      kind: "task",
      nodeRef: node,
      x: 0,
      y: 0,
      subtreeHeight: NODE_H,
      children: [],
      title: connectorLabel,
      subtitle
    };
  }

  function buildFlowModel(state, config) {
    const start = createPseudoNode("__start__", "START", "start");
    const end = createPseudoNode("__end__", "END", "end");
    const rawById = new Map();
    state.nodes.forEach((node) => {
      ensureNodeDefaults(config, node);
      rawById.set(node.id, node);
    });

    const normalizedNodes = state.nodes.map((node, idx) => {
      let parentId = node.parentId || null;
      if (parentId && !rawById.has(parentId)) parentId = null;
      const parallelOrder = Number(node.parallelOrder) || idx + 1;
      return { ...node, parentId, parallelOrder };
    });

    const parentKey = (parentId) => parentId || start.id;
    const childrenByParent = new Map();
    function pushChild(parentId, node) {
      const key = parentKey(parentId);
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(node);
    }
    normalizedNodes.forEach((node) => pushChild(node.parentId, node));
    childrenByParent.forEach((arr) => {
      arr.sort((a, b) => {
        const ao = Number(a.parallelOrder) || 1;
        const bo = Number(b.parallelOrder) || 1;
        if (ao !== bo) return ao - bo;
        return 0;
      });
    });
    function getChildren(parentId) {
      return childrenByParent.get(parentKey(parentId)) || [];
    }

    const viewById = new Map();
    normalizedNodes.forEach((node) => viewById.set(node.id, createTaskView(node, config)));

    const loopMetaByRootId = new Map();
    const loopOwnerByNodeId = new Map();
    const loopRootIdByLoopEndId = new Map();

    normalizedNodes.filter((n) => isLoopRootNode(n)).forEach((rootNode) => {
      const chainIds = [];
      const seen = new Set([rootNode.id]);
      let currentId = rootNode.id;
      while (true) {
        const next = getChildren(currentId).find((c) => c.loopOwnerId === rootNode.id);
        if (!next || seen.has(next.id)) break;
        chainIds.push(next.id);
        loopOwnerByNodeId.set(next.id, rootNode.id);
        seen.add(next.id);
        currentId = next.id;
      }

      const outsideIds = getChildren(rootNode.id)
        .filter((c) => c.loopOwnerId !== rootNode.id)
        .map((c) => c.id);
      const loopEndId = `__loop_end__${rootNode.id}`;
      const meta = {
        rootId: rootNode.id,
        loopEndId,
        chainIds,
        chainSet: new Set(chainIds),
        outsideIds
      };
      loopMetaByRootId.set(rootNode.id, meta);
      loopRootIdByLoopEndId.set(loopEndId, rootNode.id);
      viewById.set(loopEndId, createPseudoNode(loopEndId, "繰り返し終了", "loop-end"));
    });

    const displayChildren = new Map();
    const setDisplayChildren = (id, ids) => displayChildren.set(id, (ids || []).filter(Boolean));

    setDisplayChildren(start.id, getChildren(null).map((n) => n.id));

    normalizedNodes.forEach((node) => {
      if (isLoopRootNode(node) && loopMetaByRootId.has(node.id)) {
        const meta = loopMetaByRootId.get(node.id);
        const firstInner = meta.chainIds[0] || null;
        setDisplayChildren(node.id, [firstInner || meta.loopEndId]);
        setDisplayChildren(meta.loopEndId, meta.outsideIds.slice());
        return;
      }

      const ownerRootId = loopOwnerByNodeId.get(node.id);
      if (ownerRootId) {
        const meta = loopMetaByRootId.get(ownerRootId);
        const chain = meta?.chainIds || [];
        const idx = chain.indexOf(node.id);
        const nextInChain = idx >= 0 ? chain[idx + 1] : null;
        const realChildren = getChildren(node.id).map((c) => c.id);
        const extraChildren = realChildren.filter((id) => id !== nextInChain);
        setDisplayChildren(node.id, [nextInChain || meta.loopEndId, ...extraChildren]);
        return;
      }

      setDisplayChildren(node.id, getChildren(node.id).map((n) => n.id));
    });

    loopMetaByRootId.forEach((meta) => {
      if (!displayChildren.has(meta.loopEndId)) {
        setDisplayChildren(meta.loopEndId, meta.outsideIds.slice());
      }
    });

    start.x = START_X;
    start.y = START_Y;

    const depthById = new Map([[start.id, 0]]);
    const nodeMap = new Map([[start.id, start], ...Array.from(viewById.entries()), [end.id, end]]);

    function layoutNode(nodeId, depth, y, visiting) {
      const view = nodeMap.get(nodeId);
      if (!view) return y + NODE_H;
      if (visiting.has(nodeId)) return y + NODE_H;

      visiting.add(nodeId);
      view.x = START_X + LEVEL_MARGIN * depth;
      view.y = y;
      depthById.set(nodeId, depth);

      const children = displayChildren.get(nodeId) || [];
      let bottom = y + NODE_H;
      let childY = y;
      children.forEach((childId) => {
        const childBottom = layoutNode(childId, depth + 1, childY, visiting);
        bottom = Math.max(bottom, childBottom);
        childY = childBottom + MIN_SIBLING_GAP;
      });
      visiting.delete(nodeId);
      return bottom;
    }

    const rootChildren = displayChildren.get(start.id) || [];
    let yCursor = START_Y;
    rootChildren.forEach((childId) => {
      const subtreeBottom = layoutNode(childId, 1, yCursor, new Set([start.id]));
      yCursor = subtreeBottom + MIN_SIBLING_GAP;
    });

    const taskViews = normalizedNodes.map((node) => viewById.get(node.id)).filter(Boolean);
    const loopEndViews = Array.from(loopMetaByRootId.values())
      .map((meta) => viewById.get(meta.loopEndId))
      .filter(Boolean);

    const edges = [];
    const edgeKeys = new Set();
    const pushEdge = (from, to, kind) => {
      if (!from || !to) return;
      const key = `${from}->${to}:${kind}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from, to, kind });
    };

    displayChildren.forEach((children, parentId) => {
      children.forEach((childId, idx) => {
        const edgeKind = idx === 0 ? "tree" : "parallel";
        pushEdge(parentId, childId, edgeKind);
      });
    });

    const leaves = [...taskViews, ...loopEndViews]
      .filter((view) => (displayChildren.get(view.id) || []).length === 0);
    leaves.forEach((leaf) => {
      const edgeKind = leaf.kind === "loop-end" ? "to-end-main" : "to-end";
      pushEdge(leaf.id, end.id, edgeKind);
    });
    if (!leaves.length) pushEdge(start.id, end.id, "to-end-main");

    const maxDepth = Math.max(1, ...Array.from(depthById.values()));
    end.x = START_X + LEVEL_MARGIN * (maxDepth + 1);
    end.y = START_Y;

    const controls = [];
    function pushInsertControl({ anchorId, rightId, x, y, mode, loopRootId }) {
      controls.push({
        kind: "insert",
        anchorId,
        rightId: rightId || null,
        x,
        y,
        r: BTN_R,
        label: "I",
        mode: mode || "normal",
        loopRootId: loopRootId || null
      });
    }
    function pushParallelControl({ anchorId, rightId, x, y, mode, loopRootId }) {
      controls.push({
        kind: "parallel",
        anchorId,
        rightId: rightId || null,
        x,
        y,
        r: BTN_R,
        label: "P",
        mode: mode || "normal",
        loopRootId: loopRootId || null
      });
    }

    function addNormalControls(anchorId, anchorView) {
      const children = displayChildren.get(anchorId) || [];
      const rightId = children[0] || null;
      const centerY = anchorView.y + NODE_H / 2;
      const cx = anchorView.x + NODE_W + BTN_X_OFFSET;

      if (rightId) {
        pushInsertControl({ anchorId, rightId, x: cx, y: centerY - BTN_GAP / 2 });
        pushParallelControl({ anchorId, rightId, x: cx, y: centerY + BTN_GAP / 2 });
      } else {
        pushInsertControl({ anchorId, rightId: null, x: cx, y: centerY });
      }
    }

    addNormalControls(start.id, start);
    taskViews.forEach((view) => {
      const node = view.nodeRef;
      const cx = view.x + NODE_W + BTN_X_OFFSET;
      const centerY = view.y + NODE_H / 2;
      if (isLoopRootNode(node)) {
        const meta = loopMetaByRootId.get(node.id);
        const rightId = meta?.chainIds?.[0] || meta?.loopEndId || null;
        pushInsertControl({
          anchorId: node.id,
          rightId,
          x: cx,
          y: centerY,
          mode: "loop-root",
          loopRootId: node.id
        });
        return;
      }

      const ownerRootId = loopOwnerByNodeId.get(node.id);
      if (ownerRootId) {
        const meta = loopMetaByRootId.get(ownerRootId);
        const idx = meta?.chainIds?.indexOf(node.id) ?? -1;
        const nextId = idx >= 0 ? (meta.chainIds[idx + 1] || meta.loopEndId) : meta?.loopEndId;
        pushInsertControl({
          anchorId: node.id,
          rightId: nextId || null,
          x: cx,
          y: centerY,
          mode: "loop-internal",
          loopRootId: ownerRootId
        });
        return;
      }

      addNormalControls(node.id, view);
    });

    loopEndViews.forEach((view) => {
      const loopRootId = loopRootIdByLoopEndId.get(view.id) || null;
      const children = displayChildren.get(view.id) || [];
      const rightId = children[0] || null;
      const centerY = view.y + NODE_H / 2;
      const cx = view.x + NODE_W + BTN_X_OFFSET;

      if (rightId) {
        pushInsertControl({
          anchorId: view.id,
          rightId,
          x: cx,
          y: centerY - BTN_GAP / 2,
          mode: "loop-end",
          loopRootId
        });
        pushParallelControl({
          anchorId: view.id,
          rightId,
          x: cx,
          y: centerY + BTN_GAP / 2,
          mode: "loop-end",
          loopRootId
        });
      } else {
        pushInsertControl({
          anchorId: view.id,
          rightId: null,
          x: cx,
          y: centerY,
          mode: "loop-end",
          loopRootId
        });
      }
    });

    const loopFrames = [];
    loopMetaByRootId.forEach((meta) => {
      const ids = [meta.rootId, ...meta.chainIds, meta.loopEndId];
      const views = ids.map((id) => nodeMap.get(id)).filter(Boolean);
      if (!views.length) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      views.forEach((v) => {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x + NODE_W);
        maxY = Math.max(maxY, v.y + NODE_H);
      });
      const padX = 24;
      const padY = 20;
      loopFrames.push({
        loopRootId: meta.rootId,
        x: minX - padX,
        y: minY - padY,
        w: (maxX - minX) + padX * 2,
        h: (maxY - minY) + padY * 2
      });
    });

    const drawableNodes = [start, ...taskViews, ...loopEndViews, end];
    const maxNodeX = Math.max(START_X, ...drawableNodes.map((n) => n.x));
    const maxNodeY = Math.max(START_Y, ...drawableNodes.map((n) => n.y));
    const maxFrameX = loopFrames.length
      ? Math.max(...loopFrames.map((f) => f.x + f.w))
      : 0;
    const maxFrameY = loopFrames.length
      ? Math.max(...loopFrames.map((f) => f.y + f.h))
      : 0;
    const width = Math.max(end.x + NODE_W + 220, maxNodeX + NODE_W + 220, maxFrameX + 220);
    const height = Math.max(220, maxNodeY + NODE_H + 48, maxFrameY + 48);

    return {
      start,
      end,
      taskViews,
      loopEndViews,
      nodeMap,
      edges,
      controls,
      loopFrames,
      width,
      height
    };
  }

  function wrapText(ctx, text, maxWidth) {
    const chars = String(text || "").split("");
    let line = "";
    let lines = [];
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        lines.push(line);
        line = chars[i];
      } else {
        line = testLine;
      }
    }
    lines.push(line);
    if (lines.length > 2) {
      lines = [lines[0], `${lines[1].slice(0, Math.max(0, lines[1].length - 1))}…`];
    }
    return lines;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    if (typeof ctx.roundRect === "function") {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return;
    }

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }

  function drawOneSideRoundedRect(ctx, x, y, w, h, side) {
    const r = Math.min(h / 2, w / 2);
    const cy = y + h / 2;

    ctx.beginPath();
    if (side === "left") {
      const cx = x + r;
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
      ctx.lineTo(x + w, y + h);
    } else {
      const cx = x + w - r;
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - r, y);
      ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
  }

  function drawArrowHead(ctx, x, y, angle, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - size * Math.cos(angle - Math.PI / 6), y - size * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x - size * Math.cos(angle + Math.PI / 6), y - size * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function getConnectorIconSrc(connectorId) {
    return getConnectorImageSrc(connectorId);
  }

  function ensureConnectorIcon(view, src) {
    if (!src) return null;
    if (ICON_CACHE.has(src)) return ICON_CACHE.get(src);

    const img = new Image();
    img.__failed = false;
    img.onload = () => drawFlowCanvas(view);
    img.onerror = () => {
      if (!img.__fallbackTried && src !== NOIMAGE_SRC) {
        img.__fallbackTried = true;
        img.src = NOIMAGE_SRC;
        return;
      }
      img.__failed = true;
      drawFlowCanvas(view);
    };
    img.src = src;
    ICON_CACHE.set(src, img);
    return img;
  }

  function normalizedSigmoid(t, k, center) {
    const s = (x) => 1 / (1 + Math.exp(-x));
    const min = s((0 - center) * k);
    const max = s((1 - center) * k);
    const cur = s((t - center) * k);
    const denom = max - min || 1;
    return (cur - min) / denom;
  }

  function drawEdge(ctx, from, to, style) {
    const sx = from.x + NODE_W;
    const sy = from.y + NODE_H / 2;
    const tx = to.x;
    const ty = to.y + NODE_H / 2;
    const k = style.sigmoidK || 12;
    const center = style.sigmoidBias || 0.82; // right-biased bend
    const steps = Math.max(18, Math.min(64, Math.floor(Math.abs(tx - sx) / 8)));
    let prevX = sx;
    let prevY = sy;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const x = sx + (tx - sx) * t;
      const eased = normalizedSigmoid(t, k, center);
      const y = sy + (ty - sy) * eased;
      ctx.lineTo(x, y);
      if (i === steps - 1) {
        prevX = x;
        prevY = y;
      }
    }

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash || []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (style.arrow) {
      const angle = Math.atan2(ty - prevY, tx - prevX);
      drawArrowHead(ctx, tx, ty, angle, style.arrowSize || 6, style.color);
    }
  }

  function drawDraggedNodePreview(ctx, view, model) {
    const dragState = view.dragState;
    if (!dragState || !dragState.started) return;

    const draggedView = model.nodeMap.get(dragState.nodeId);
    if (!draggedView || !draggedView.nodeRef) return;
    const rootStyles = getComputedStyle(document.documentElement);
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const dragPreviewStroke = rootStyles.getPropertyValue("--flow-drag-preview-stroke").trim() || "#4b4e63";
    const shadowSoft = rootStyles.getPropertyValue("--alpha-shadow-12").trim() || "rgba(0, 0, 0, 0.12)";

    const x = Math.round(dragState.canvasX - NODE_W / 2);
    const y = Math.round(dragState.canvasY - NODE_H / 2);

    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = surfacePage;
    ctx.strokeStyle = dragPreviewStroke;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.shadowColor = shadowSoft;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    drawRoundedRect(ctx, x, y, NODE_W, NODE_H, 8);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = surfaceStrong;
    ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(draggedView.nodeRef.stepName || ""), x + NODE_W / 2, y + NODE_H / 2);
    ctx.restore();
  }

  function drawFlowCanvas(view) {
    const runtime = view.root.__flowRuntime;
    if (!runtime) return;

    const { model, state, config } = runtime;
    const { canvas, ctx } = view;
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = Math.max(1, Math.ceil(rawDpr));
    canvas.width = Math.floor(model.width * dpr);
    canvas.height = Math.floor(model.height * dpr);
    canvas.style.width = `${model.width}px`;
    canvas.style.height = `${model.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.clearRect(0, 0, model.width, model.height);

    const rootStyles = getComputedStyle(document.documentElement);
    const warningNodeFill = rootStyles.getPropertyValue("--brand-200").trim() || "#f9c4df";
    const warningAccent = rootStyles.getPropertyValue("--semantic-error-fg").trim() || "#9e1f5f";
    const warningText = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const flowEdgeMain = rootStyles.getPropertyValue("--flow-edge-main").trim() || "#5c6f88";
    const flowEdgeSecondary = rootStyles.getPropertyValue("--flow-edge-secondary").trim() || "#74859d";
    const flowEdgeParallel = rootStyles.getPropertyValue("--flow-edge-parallel").trim() || "#6e829c";
    const flowNodeBorder = rootStyles.getPropertyValue("--flow-node-border").trim() || "#9aa5b6";
    const flowNodeBorderSelected = rootStyles.getPropertyValue("--flow-node-border-selected").trim() || "#4b4e63";
    const flowNodeSubtext = rootStyles.getPropertyValue("--flow-node-subtext").trim() || "#626b7b";
    const flowNodeShadow = rootStyles.getPropertyValue("--alpha-shadow-10").trim() || "rgba(79, 67, 67, 0.68)";
    const flowLoopFrameFill = rootStyles.getPropertyValue("--flow-loop-frame-fill").trim() || "#eef8ee";
    const flowLoopFrameStroke = rootStyles.getPropertyValue("--flow-loop-frame-stroke").trim() || "#1a7259";
    const flowStepBadgeBorder = rootStyles.getPropertyValue("--flow-step-badge-border").trim() || "#c8cad8";
    const flowControlFillActive = rootStyles.getPropertyValue("--flow-control-fill-active").trim() || "#4b4e63";
    const flowControlStroke = rootStyles.getPropertyValue("--flow-control-stroke").trim() || "#bdbdbd";
    const flowControlStrokeActive = rootStyles.getPropertyValue("--flow-control-stroke-active").trim() || "#4b4e63";
    const flowControlText = rootStyles.getPropertyValue("--flow-control-text").trim() || "#4b4e63";
    const flowControlTextActive = rootStyles.getPropertyValue("--flow-control-text-active").trim() || "#fffefe";
    const surfaceStrong = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    const surfacePage = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    const textMuted = rootStyles.getPropertyValue("--text-muted").trim() || "#767b93";

    (model.loopFrames || []).forEach((frame) => {
      ctx.fillStyle = flowLoopFrameFill;
      drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, 12);
      ctx.fill();
      ctx.strokeStyle = flowLoopFrameStroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      drawRoundedRect(ctx, frame.x, frame.y, frame.w, frame.h, 12);
      ctx.stroke();
    });

    model.edges.forEach((edge) => {
      const from = model.nodeMap.get(edge.from);
      const to = model.nodeMap.get(edge.to);
      if (!from || !to) return;
      drawEdge(ctx, from, to, {
        color:
          edge.kind === "to-end-main" ? flowEdgeMain :
          edge.kind === "to-end" ? flowEdgeSecondary :
          edge.kind === "parallel" ? flowEdgeParallel : flowEdgeMain,
        width:
          edge.kind === "to-end-main" ? 2.2 :
          edge.kind === "to-end" ? 1.3 :
          edge.kind === "parallel" ? 1.3 : 2.2,
        dash:
          edge.kind === "to-end-main" ? [] :
          edge.kind === "to-end" ? [4, 3] :
          edge.kind === "parallel" ? [3, 3] : [],
        mode: edge.kind === "parallel" ? "parallel_branch" : "horizontal",
        sigmoidBias: edge.kind === "parallel" ? 0.88 : 0.92,
        sigmoidK: edge.kind === "parallel" ? 10 : 12,
        arrow: true,
        arrowSize: edge.kind === "parallel" ? 5 : edge.kind === "to-end" ? 5 : 6
      });
    });

    const alertNodeIds = new Set(
      model.taskViews
        .filter((taskView) =>
          hasMissingRequiredField(config, taskView.nodeRef) ||
          hasInvalidUpstreamReference(config, state, taskView.nodeRef)
        )
        .map((taskView) => taskView.id)
    );

    const nodesToDraw = [model.start, ...model.taskViews, ...(model.loopEndViews || []), model.end];
    nodesToDraw.forEach((node) => {
      const isStart = node.kind === "start";
      const isEnd = node.kind === "end";
      const isTask = node.kind === "task";
      const isLoopEnd = node.kind === "loop-end";
      const isSelected = isTask && state.selectedNodeId === node.id;
      const isParallel = isTask && !!node.nodeRef.parallelOf;
      const isDraggingNode = !!(view.dragState && view.dragState.started && view.dragState.nodeId === node.id);
      const hasAlert = isTask && alertNodeIds.has(node.id);
      const hasInvalidReference = isTask && hasInvalidUpstreamReference(config, state, node.nodeRef);

      if (isParallel) ctx.setLineDash([4, 2]);
      else ctx.setLineDash([]);

      if (isStart) ctx.fillStyle = surfaceStrong;
      else if (isEnd) ctx.fillStyle = surfaceStrong;
      // else if (isTask && hasAlert) ctx.fillStyle = warningNodeFill;
      else ctx.fillStyle = surfacePage;

      ctx.globalAlpha = isDraggingNode ? 0.28 : 1;
      ctx.shadowColor = flowNodeShadow;
      ctx.shadowBlur = isSelected ? 7 : 5;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = isSelected ? flowNodeBorderSelected : flowNodeBorder;
      ctx.lineWidth = isSelected ? 2 : 1;
      if (isStart) {
        drawOneSideRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, "left");
      } else if (isEnd) {
        drawOneSideRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, "right");
      } else {
        drawRoundedRect(ctx, node.x, node.y, NODE_W, NODE_H, 8);
      }
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.globalAlpha = 1;

      if (isTask) {
        const badgeText = String(node.nodeRef.stepName || "");
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const tw = Math.ceil(ctx.measureText(badgeText).width);
        const bw = Math.max(36, tw + 12);
        const bh = 16;
        const bx = Math.round(node.x + (NODE_W - bw) / 2);
        const by = Math.round(node.y - Math.floor(bh / 2));
        ctx.fillStyle = surfacePage;
        ctx.strokeStyle = flowStepBadgeBorder;
        ctx.lineWidth = 1;
        drawRoundedRect(ctx, bx, by, bw, bh, 8);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = textMuted;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, bx + bw / 2, by + bh / 2);
        ctx.textBaseline = "alphabetic";
      }

      if (hasAlert) {
        const markerR = 8;
        const markerX = node.x + NODE_W - 2;
        const markerY = node.y + 4;
        ctx.fillStyle = warningAccent;
        ctx.beginPath();
        ctx.arc(markerX, markerY, markerR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = warningText;
        ctx.font = "700 11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("!", markerX, markerY + 0.5);
        ctx.textBaseline = "alphabetic";
      }

      const iconSrc = isTask ? getConnectorIconSrc(node.nodeRef.connector) : null;
      const icon = iconSrc ? ensureConnectorIcon(view, iconSrc) : null;
      const hasIcon = !!(icon && !icon.__failed && icon.complete && icon.naturalWidth > 0);

      ctx.fillStyle = isStart || isEnd ? surfacePage : surfaceStrong;
      ctx.font = isStart || isEnd
        ? "700 12px 'Segoe UI', 'Yu Gothic UI', sans-serif"
        : "700 15px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      if (isStart) {
        const cx = node.x + NODE_W / 2;
        const cy = node.y + NODE_H / 2;
        const radius = 10;
        ctx.strokeStyle = surfacePage;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = surfacePage;
        ctx.beginPath();
        ctx.moveTo(cx - 3, cy - 5);
        ctx.lineTo(cx - 3, cy + 5);
        ctx.lineTo(cx + 5, cy);
        ctx.closePath();
        ctx.fill();
      } else if (isEnd) {
        ctx.textBaseline = "middle";
        ctx.textBaseline = "alphabetic";
      } else if (isLoopEnd) {
        ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(node.text, node.x + NODE_W / 2, node.y + NODE_H / 2);
        ctx.textBaseline = "alphabetic";
      } else if (!hasIcon) {
        ctx.fillText(node.nodeRef.stepName, node.x + NODE_W / 2, node.y + 32);
      }

      if (isTask && hasIcon) {
        const pad = 14;
        const maxW = NODE_W - pad * 2;
        const maxH = NODE_H - pad * 2;
        const ratio = Math.min(maxW / icon.naturalWidth, maxH / icon.naturalHeight) * 1.5;
        const w = Math.max(1, Math.floor(icon.naturalWidth * ratio));
        const h = Math.max(1, Math.floor(icon.naturalHeight * ratio));
        const x = Math.round(node.x + (NODE_W - w) / 2);
        const y = Math.round(node.y + (NODE_H - h) / 2);
        ctx.drawImage(icon, x, y, w, h);
      } else if (isTask) {
        ctx.font = "14px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        const titleLines = wrapText(ctx, node.title, NODE_W - 16);
        const subtitleLines = wrapText(ctx, node.subtitle, NODE_W - 16);
        const lines = [...titleLines, ...subtitleLines].slice(0, 2);
        lines.forEach((line, idx) => {
          ctx.fillText(line, node.x + NODE_W / 2, node.y + 56 + idx * 18);
        });
      }

      if (isTask) {
        ctx.fillStyle = flowNodeSubtext;
        ctx.font = "11px 'Segoe UI', 'Yu Gothic UI', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`${node.title}/${node.subtitle}`, node.x + NODE_W / 2, node.y + NODE_H + 6);
        ctx.textBaseline = "alphabetic";
      }
    });

    drawDraggedNodePreview(ctx, view, model);

    model.controls.forEach((ctrl) => {
      const isDropTarget = view.dropControl === ctrl;
      const isHover = view.hoverControl === ctrl || isDropTarget;
      ctx.fillStyle = isDropTarget ? flowControlFillActive : surfacePage;
      ctx.strokeStyle = isHover ? flowControlStrokeActive : flowControlStroke;
      ctx.lineWidth = isHover ? 2 : 1;
      ctx.beginPath();
      ctx.arc(ctrl.x, ctrl.y, ctrl.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isDropTarget ? flowControlTextActive : (isHover ? flowControlStrokeActive : flowControlText);
      ctx.font = "700 10px 'Segoe UI', 'Yu Gothic UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(ctrl.label, ctrl.x, ctrl.y + 3);
    });
  }

  function hitTask(model, x, y) {
    for (let i = model.taskViews.length - 1; i >= 0; i--) {
      const n = model.taskViews[i];
      if (x >= n.x && x <= n.x + NODE_W && y >= n.y && y <= n.y + NODE_H) return n;
    }
    return null;
  }

  function hasSiblingControlPair(model, control) {
    return model.controls.some((candidate) =>
      candidate !== control &&
      candidate.anchorId === control.anchorId &&
      candidate.rightId === control.rightId &&
      candidate.mode === control.mode &&
      candidate.loopRootId === control.loopRootId &&
      candidate.kind !== control.kind
    );
  }

  function hitControl(model, x, y, options = {}) {
    const expanded = !!options.expanded;
    for (let i = model.controls.length - 1; i >= 0; i--) {
      const c = model.controls[i];
      const hasPair = hasSiblingControlPair(model, c);
      const hitCenterY = hasPair
        ? c.y + (c.kind === "insert" ? -BTN_HIT_BIAS_Y : BTN_HIT_BIAS_Y)
        : c.y;
      if (expanded) {
        const halfW = c.r + BTN_HIT_SLOP;
        const halfH = c.r + BTN_HIT_SLOP;
        const insideX = x >= c.x - halfW && x <= c.x + halfW;
        const insideY = y >= hitCenterY - halfH && y <= hitCenterY + halfH;
        if (insideX && insideY) return c;
        continue;
      }
      if (Math.hypot(x - c.x, y - c.y) <= c.r + 2) return c;
    }
    return null;
  }

  function getControlTooltip(ctrl, dragState) {
    if (!ctrl) return "";
    if (dragState && dragState.started) {
      if (ctrl.kind === "insert") return "挿入する";
      if (ctrl.kind === "parallel") return "並行フローを挿入する";
    }
    if (ctrl.label === "I" || ctrl.kind === "insert") return "ステップを挿入";
    if (ctrl.label === "P" || ctrl.kind === "parallel") return "ステップを並列で挿入";
    return "";
  }

  function createImmediateTooltip() {
    const rootStyles = getComputedStyle(document.documentElement);
    const tip = document.createElement("div");
    tip.style.position = "fixed";
    tip.style.left = "-9999px";
    tip.style.top = "-9999px";
    tip.style.pointerEvents = "none";
    tip.style.zIndex = "9999";
    tip.style.padding = "4px 8px";
    tip.style.borderRadius = "6px";
    tip.style.background = rootStyles.getPropertyValue("--surface-strong").trim() || "#4b4e63";
    tip.style.color = rootStyles.getPropertyValue("--surface-page").trim() || "#fffefe";
    tip.style.font = "12px 'Segoe UI', 'Yu Gothic UI', sans-serif";
    tip.style.whiteSpace = "nowrap";
    tip.style.opacity = "0";
    tip.style.transition = "opacity 80ms linear";
    document.body.appendChild(tip);
    return tip;
  }

  function ensureFlowCanvas(root) {
    if (root.__flowView) return root.__flowView;

    root.innerHTML = "";
    root.style.overflowX = "auto";
    root.style.overflowY = "auto";
    const canvas = document.createElement("canvas");
    canvas.className = "flow-canvas";
    canvas.title = "";
    root.appendChild(canvas);
    const menuEl = document.createElement("div");
    menuEl.className = "flow-context-menu";
    menuEl.setAttribute("role", "menu");
    menuEl.setAttribute("aria-hidden", "true");
    menuEl.innerHTML = [
      '<button class="flow-context-menu__item" type="button" data-action="run" role="menuitem">実行</button>',
      '<button class="flow-context-menu__item is-danger" type="button" data-action="delete" role="menuitem">削除</button>'
    ].join("");
    document.body.appendChild(menuEl);
    const ctx = canvas.getContext("2d");
    const tooltipEl = createImmediateTooltip();
    const view = {
      root,
      canvas,
      ctx,
      hoverControl: null,
      dropControl: null,
      dragState: null,
      tooltipEl,
      menuEl,
      menuNodeId: null
    };
    root.__flowView = view;

    function hideTooltip() {
      tooltipEl.style.opacity = "0";
      tooltipEl.style.left = "-9999px";
      tooltipEl.style.top = "-9999px";
      tooltipEl.textContent = "";
    }

    function showTooltip(ctrl, clientX, clientY) {
      const text = getControlTooltip(ctrl, view.dragState);
      if (!text) {
        hideTooltip();
        return;
      }
      tooltipEl.textContent = text;
      tooltipEl.style.left = `${clientX + 12}px`;
      tooltipEl.style.top = `${clientY + 12}px`;
      tooltipEl.style.opacity = "1";
    }

    function hideContextMenu() {
      view.menuNodeId = null;
      menuEl.classList.remove("is-open");
      menuEl.style.left = "-9999px";
      menuEl.style.top = "-9999px";
      menuEl.setAttribute("aria-hidden", "true");
    }

    function showContextMenu(nodeId, clientX, clientY) {
      view.menuNodeId = nodeId;
      menuEl.style.left = `${clientX}px`;
      menuEl.style.top = `${clientY}px`;
      menuEl.classList.add("is-open");
      menuEl.setAttribute("aria-hidden", "false");
    }

    let pendingDrag = null;

    canvas.addEventListener("mousemove", (e) => {
      if (view.dragState || pendingDrag || isPanning) return;
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      view.hoverControl = hitControl(runtime.model, x, y);
      view.dropControl = null;
      showTooltip(view.hoverControl, e.clientX, e.clientY);
      const hoverTask = hitTask(runtime.model, x, y);
      const selectableTask = !!(hoverTask && isDraggableNode(hoverTask.nodeRef));
      canvas.style.cursor = view.hoverControl || selectableTask ? "pointer" : "default";
      drawFlowCanvas(view);
    });

    canvas.addEventListener("mouseleave", () => {
      if (view.dragState || pendingDrag) return;
      view.hoverControl = null;
      view.dropControl = null;
      hideTooltip();
      canvas.style.cursor = "default";
      drawFlowCanvas(view);
    });

    root.addEventListener("wheel", (e) => {
      // Horizontal wheel/Shift+wheel pans left-right.
      // Normal vertical wheel is kept as-is for up/down scrolling.
      const horizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!horizontalIntent) return;
      const delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      root.scrollLeft += delta;
      e.preventDefault();
    }, { passive: false });

    canvas.addEventListener("contextmenu", (e) => {
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      if (!task) {
        hideContextMenu();
        return;
      }
      e.preventDefault();
      hideTooltip();
      setSelectedNode(runtime.state, task.id);
      runtime.onStateChanged();
      showContextMenu(task.id, e.clientX, e.clientY);
    });

    let isPanning = false;
    let panMoved = false;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;
    let lastPanAt = 0;
    canvas.addEventListener("mousedown", (e) => {
      hideContextMenu();
      if (e.button !== 0) return;
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const task = hitTask(runtime.model, x, y);
      if (task && isDraggableNode(task.nodeRef)) {
        pendingDrag = {
          nodeId: task.id,
          startClientX: e.clientX,
          startClientY: e.clientY
        };
        view.hoverControl = null;
        view.dropControl = null;
        hideTooltip();
        document.body.style.userSelect = "none";
        e.preventDefault();
        return;
      }
      isPanning = true;
      panMoved = false;
      hideTooltip();
      panStartX = e.clientX;
      panStartY = e.clientY;
      panStartScrollLeft = root.scrollLeft;
      panStartScrollTop = root.scrollTop;
      canvas.style.cursor = "grabbing";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (pendingDrag) {
        const moveDx = e.clientX - pendingDrag.startClientX;
        const moveDy = e.clientY - pendingDrag.startClientY;
        if (!view.dragState && Math.hypot(moveDx, moveDy) < 5) return;

        const runtime = root.__flowRuntime;
        if (!runtime) return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hoveredControl = hitControl(runtime.model, x, y, { expanded: true });
        const dropControl = canDropDraggedNodeOnControl(runtime.state, pendingDrag.nodeId, hoveredControl)
          ? hoveredControl
          : null;

        view.dragState = {
          nodeId: pendingDrag.nodeId,
          started: true,
          canvasX: x,
          canvasY: y
        };
        view.hoverControl = dropControl;
        view.dropControl = dropControl;
        canvas.style.cursor = dropControl ? "copy" : "grabbing";
        if (dropControl) showTooltip(dropControl, e.clientX, e.clientY);
        else hideTooltip();
        drawFlowCanvas(view);
        return;
      }
      if (!isPanning) return;
      const dx = e.clientX - panStartX;
      const dy = e.clientY - panStartY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panMoved = true;
      root.scrollLeft = panStartScrollLeft - dx;
      root.scrollTop = panStartScrollTop - dy;
    });
    window.addEventListener("mouseup", () => {
      if (pendingDrag) {
        const runtime = root.__flowRuntime;
        const draggingNodeId = pendingDrag.nodeId;
        const dropControl = view.dropControl;
        const didDrag = !!view.dragState;

        pendingDrag = null;
        document.body.style.userSelect = "";
        hideTooltip();
        canvas.style.cursor = "default";
        view.dragState = null;
        view.hoverControl = null;
        view.dropControl = null;

        if (didDrag) {
          lastPanAt = Date.now();
          const moved = runtime ? applyDraggedNodeDrop(runtime.state, draggingNodeId, dropControl) : false;
          if (moved && runtime) {
            runtime.onStateChanged();
            return;
          }
          drawFlowCanvas(view);
        }
        return;
      }
      if (!isPanning) return;
      if (panMoved) lastPanAt = Date.now();
      isPanning = false;
      panMoved = false;
      canvas.style.cursor = "default";
      document.body.style.userSelect = "";
    });

    menuEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const runtime = root.__flowRuntime;
      const nodeId = view.menuNodeId;
      hideContextMenu();
      if (!runtime || !nodeId) return;
      if (btn.dataset.action === "run") {
        requestNodeRunById(runtime.state, nodeId, "single", runtime.onStateChanged);
        return;
      }
      if (btn.dataset.action === "delete") {
        removeNodeById(runtime.state, nodeId, runtime.onStateChanged);
      }
    });

    canvas.addEventListener("click", (e) => {
      hideContextMenu();
      if (Date.now() - lastPanAt < 180) return;
      hideTooltip();
      const runtime = root.__flowRuntime;
      if (!runtime) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const control = hitControl(runtime.model, x, y);
      if (control) {
        if (control.mode === "loop-root" || control.mode === "loop-internal") {
          if (control.kind === "insert") {
            const created = insertLoopInternalAtAnchor(
              runtime.state,
              control.loopRootId || control.anchorId,
              control.anchorId
            );
            if (created) runtime.onStateChanged();
          }
          return;
        }

        if (control.mode === "loop-end") {
          if (control.kind === "insert") {
            const created = insertAfterLoopEnd(
              runtime.state,
              control.loopRootId,
              control.rightId || null
            );
            if (created) runtime.onStateChanged();
            return;
          }
          if (control.kind === "parallel") {
            const created = addParallelAfterLoopEnd(
              runtime.state,
              control.loopRootId,
              control.rightId || null
            );
            if (created) runtime.onStateChanged();
            return;
          }
        }

        const rightIndex = control.rightId
          ? runtime.state.nodes.findIndex((n) => n.id === control.rightId)
          : -1;
        const anchorIndex = control.anchorId && control.anchorId !== "__start__"
          ? runtime.state.nodes.findIndex((n) => n.id === control.anchorId)
          : -1;

        if (control.kind === "insert") {
          if (control.rightId === null) {
            if (anchorIndex >= 0) addNodeAfter(runtime.state, anchorIndex);
            else insertNodeAt(runtime.state, 0);
          } else if (anchorIndex >= 0) {
            addNodeAfter(runtime.state, anchorIndex);
          } else if (rightIndex >= 0) {
            insertNodeAt(runtime.state, rightIndex);
          }
          runtime.onStateChanged();
          return;
        }

        if (control.kind === "parallel" && rightIndex >= 0) {
          addParallelAfter(runtime.state, rightIndex, { parentId: control.anchorId });
          runtime.onStateChanged();
          return;
        }
      }

      const task = hitTask(runtime.model, x, y);
      if (task) {
        setSelectedNode(runtime.state, task.id);
        runtime.onStateChanged();
      }
    });

    window.addEventListener("pointerdown", (e) => {
      if (!menuEl.classList.contains("is-open")) return;
      if (menuEl.contains(e.target)) return;
      hideContextMenu();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideContextMenu();
    });

    window.addEventListener("resize", () => {
      hideContextMenu();
      drawFlowCanvas(view);
    });

    return view;
  }

  function renderFlowChart({ root, state, config, onStateChanged }) {
    try {
      state.nodes.forEach((node) => ensureNodeDefaults(config, node));
      const model = buildFlowModel(state, config);
      const view = ensureFlowCanvas(root);
      root.__flowRuntime = { state, config, model, onStateChanged };
      drawFlowCanvas(view);
    } catch (err) {
      console.error("flowchart render failed", err);
      root.innerHTML = "";
      const msg = el("div", { class: "flow-fallback" }, [
        document.createTextNode("フローチャート描画に失敗しました。状態を確認してください。")
      ]);
      root.appendChild(msg);
    }
  }

  function renderNodeDetail({ state, config, root, onStateChanged }) {
    root.innerHTML = "";
    if (!state.nodes.length) return;

    let idx = getSelectedNodeIndex(state);
    let node = state.nodes[idx];
    if (!node) return;
    const loopRootSelected = isLoopRootNode(node);
    ensureNodeDefaults(config, node);

    const upstreamSteps = getUpstreamSteps(state, node.id);
    const schema = getFormSchema(config, node.connector, node.action);
    const actionConfig = getActionConfig(config, node.connector, node.action);
    const detailModal = actionConfig && actionConfig.detailModal;
    const missingRequiredLabels = getMissingRequiredFieldLabels(config, node);
    const referenceWarnings = Array.from(new Set(
      schema.flatMap((field) => getFieldReferenceWarnings({ node, field, upstreamSteps }))
    ));

    const headActionItems = [];

    if (detailModal && detailModal.label) {
      headActionItems.push(
        el(
          "button",
          {
            type: "button",
            onclick: () => openConfiguredDetailModal({ node, detailModal, onStateChanged })
          },
          [document.createTextNode(detailModal.label)]
        )
      );
    }

    headActionItems.push(
      el(
        "button",
        {
          class: "run-btn",
          type: "button",
          onclick: () => requestNodeRun(node, "single", onStateChanged)
        },
        [document.createTextNode("ステップ実行")]
      )
    );

    headActionItems.push(
      el(
        "button",
        {
          class: "run-btn",
          type: "button",
          onclick: () => requestNodeRun(node, "through", onStateChanged)
        },
        [document.createTextNode("フロー実行")]
      )
    );

    headActionItems.push(
      el(
        "button",
        {
          class: "danger",
          type: "button",
          onclick: () => removeNodeById(state, node.id, onStateChanged)
        },
        [document.createTextNode("削除")]
      )
    );

    const headActions = el("div", { class: "node-head-actions" }, headActionItems);
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
    const logTabBtn = el(
      "button",
      { type: "button", class: "node-tab-btn", role: "tab", "data-tab-key": "log" },
      [document.createTextNode("ログ")]
    );
    tabBar.appendChild(detailTabBtn);
    tabBar.appendChild(yamlTabBtn);
    tabBar.appendChild(dataTabBtn);
    tabBar.appendChild(logTabBtn);
    const tabsHead = el("div", { class: "node-tabs-head" }, [tabBar, headActions]);

    const detailPane = el("div", { class: "node-tab-pane", "data-tab-key": "detail" }, [body]);
    const yamlText = el("textarea", {
      class: "node-yaml-editor",
      readonly: "readonly",
      spellcheck: "false",
      "aria-label": "ノード設定YAML"
    });
    const yamlPane = el("div", { class: "node-tab-pane", "data-tab-key": "yaml" }, [yamlText]);
    const dataTableBody = el("tbody", {}, []);
    const dataTable = el("table", { class: "node-data-table" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", {}, [document.createTextNode("項目")]),
          el("th", {}, [document.createTextNode("値")])
        ])
      ]),
      dataTableBody
    ]);
    const dataTableWrap = el("div", { class: "node-data-wrap" }, [dataTable]);
    const dataUnsupportedNote = el("div", { class: "node-data-note" }, [
      document.createTextNode("データコネクタではないため対応していません。")
    ]);
    const dataPane = el("div", { class: "node-tab-pane", "data-tab-key": "data" }, [
      dataUnsupportedNote,
      dataTableWrap
    ]);
    const logText = el("textarea", {
      class: "node-log-view",
      readonly: "readonly",
      spellcheck: "false",
      "aria-label": "処理ログ"
    });
    const logPane = el("div", { class: "node-tab-pane", "data-tab-key": "log" }, [
      el("div", { class: "node-log-wrap" }, [logText])
    ]);

    const connectorSelect = renderConnectorSelect({
      config,
      node,
      onStateChanged,
      disabled: loopRootSelected
    });
    const detailMeta = el("div", { class: "node-detail-meta" }, [
      el("div", { class: "badge" }, [document.createTextNode(`{${node.stepName}}`)]),
      el("div", { class: "head-selects" }, [
        el("div", { class: "head-select" }, [connectorSelect])
      ])
    ]);
    body.appendChild(detailMeta);

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
      nodeWarnings.push(`上流でないステップを参照しています。${referenceWarnings.join(" / ")}`);
    }

    if (nodeWarnings.length) {
      body.appendChild(
        el("div", { class: "node-warning-banner" }, [
          document.createTextNode(nodeWarnings.join(" "))
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
        body.appendChild(renderField({ node, field, upstreamSteps, onStateChanged }));
      }
    }

    function syncYamlView() {
      yamlText.value = dumpYamlSafe(buildNodeYamlSettings(node)).trimEnd();
    }

    function syncDataView() {
      const dataConnector = isDataConnector(node.connector, config);
      dataUnsupportedNote.hidden = dataConnector;
      dataTableWrap.hidden = !dataConnector;
      dataTableBody.innerHTML = "";
      if (!dataConnector) return;
      dataTableBody.appendChild(
        el("tr", {}, [
          el("td", {}, [document.createTextNode("状態")]),
          el("td", { class: "node-data-value" }, [document.createTextNode("データがないです。")])
        ])
      );
    }

    function syncLogView() {
      const lines = getNodeLogLines(node);
      if (!lines.length) {
        logText.value = "ログがないです。";
        return;
      }
      logText.value = lines.join("\n");
    }

    const activeTabByRoot = ["detail", "yaml", "data", "log"].includes(root.__nodeDetailActiveTab)
      ? root.__nodeDetailActiveTab
      : "detail";
    function setActiveTab(tabKey) {
      const activeTab = ["yaml", "data", "log"].includes(tabKey) ? tabKey : "detail";
      root.__nodeDetailActiveTab = activeTab;
      const showDetail = activeTab === "detail";
      const showYaml = activeTab === "yaml";
      const showData = activeTab === "data";
      const showLog = activeTab === "log";

      detailTabBtn.classList.toggle("is-active", showDetail);
      detailTabBtn.setAttribute("aria-selected", showDetail ? "true" : "false");

      yamlTabBtn.classList.toggle("is-active", showYaml);
      yamlTabBtn.setAttribute("aria-selected", showYaml ? "true" : "false");

      dataTabBtn.classList.toggle("is-active", showData);
      dataTabBtn.setAttribute("aria-selected", showData ? "true" : "false");

      logTabBtn.classList.toggle("is-active", showLog);
      logTabBtn.setAttribute("aria-selected", showLog ? "true" : "false");

      detailPane.classList.toggle("is-active", showDetail);
      yamlPane.classList.toggle("is-active", showYaml);
      dataPane.classList.toggle("is-active", showData);
      logPane.classList.toggle("is-active", showLog);
      detailPane.hidden = !showDetail;
      yamlPane.hidden = !showYaml;
      dataPane.hidden = !showData;
      logPane.hidden = !showLog;

      if (showYaml) syncYamlView();
      if (showData) syncDataView();
      if (showLog) syncLogView();
    }

    detailTabBtn.addEventListener("click", () => setActiveTab("detail"));
    yamlTabBtn.addEventListener("click", () => setActiveTab("yaml"));
    dataTabBtn.addEventListener("click", () => setActiveTab("data"));
    logTabBtn.addEventListener("click", () => setActiveTab("log"));

    body.addEventListener("input", syncYamlView);
    body.addEventListener("change", syncYamlView);
    body.addEventListener("input", syncDataView);
    body.addEventListener("change", syncDataView);
    body.addEventListener("input", syncLogView);
    body.addEventListener("change", syncLogView);
    syncYamlView();
    syncDataView();
    syncLogView();
    setActiveTab(activeTabByRoot);

    root.appendChild(el("section", { class: "node detail-node" }, [tabsHead, detailPane, yamlPane, dataPane, logPane]));
  }

  window.uiNode = { normalizeSteps, renderFlowChart, renderNodeDetail };
})();
