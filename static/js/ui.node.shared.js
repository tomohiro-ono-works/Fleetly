(function () {
  const packages = window.zizPackages || {};
  const corePkg = packages.core || {};
  const uiPkg = packages.ui || {};
  const modalPkg = packages.modal || {};
  const bridgeApi = corePkg.bridge || null;
  const dialogApi = corePkg.dialog || null;
  const { el, getFormSchema } = (corePkg.utils || {});
  const {
    addNodeAfter,
    addParallelAfter,
    duplicateNodeAfter,
    insertNodeAt,
    moveNodeToInsert,
    moveNodeToParallel,
    addMergeParent,
    clearPendingMergeSource,
    removeNode,
    removeMergeParent,
    setPendingMergeSource,
    setSelectedNode
  } = (corePkg.stateOps || {});
  function getUiFieldsApi() {
    return (window.zizPackages && window.zizPackages.ui && window.zizPackages.ui.fields)
      || window.uiFields
      || {};
  }

  function renderFieldSafe(args) {
    const api = getUiFieldsApi();
    if (typeof api.renderField === "function") return api.renderField(args);
    return el("div", { class: "row" }, [
      el("label", {}, [document.createTextNode(args?.field?.label || args?.field?.key || "field")]),
      el("div", { class: "small" }, [document.createTextNode("フィールド描画を読み込めませんでした。")])
    ]);
  }

  function getFieldReferenceWarningsSafe(args) {
    const api = getUiFieldsApi();
    if (typeof api.getFieldReferenceWarnings === "function") return api.getFieldReferenceWarnings(args);
    return [];
  }

  const NODE_W = 60;
  const NODE_H = 60;
  const LEVEL_MARGIN = 128;
  const MIN_SIBLING_GAP = 56;
  const START_X = 44;
  const START_Y = 40;
  const BTN_X_OFFSET = 12;
  const BTN_GAP = 20;
  const BTN_R = 8;
  const BTN_HIT_SLOP = 32;
  const BTN_HIT_BIAS_Y = 32;
  const EDGE_CURVE = 42;
  const ICON_CACHE = new Map();
  let copiedNodeSnapshot = null;
  const SYSTEM_VARIABLE_NAMES = ["current_date", "user_name"];

  function jpLabel(x) {
    return (x && (x.label_jp || x.label)) || (x && x.id) || "";
  }

  function cloneUiValue(value) {
    if (typeof window.structuredClone === "function") {
      try {
        return window.structuredClone(value);
      } catch (error) {
        // fallback below
      }
    }
    return JSON.parse(JSON.stringify(value ?? null));
  }

  function buildNodeClipboardSnapshot(node) {
    if (!node) return null;
    return {
      connector: String(node.connector || ""),
      action: String(node.action || ""),
      description: typeof node.description === "string" ? node.description : "",
      descriptionAuto: !!node.descriptionAuto,
      form: cloneUiValue(node.form || {})
    };
  }

  function isEditingShortcutTarget(target) {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest("input, textarea, select, [contenteditable='true'], .combo-field, .connector-flyout");
  }

  function getMergeParentIds(node) {
    if (!Array.isArray(node?.mergeParentIds)) return [];
    return node.mergeParentIds
      .map((id) => String(id || "").trim())
      .filter(Boolean);
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
    const seen = new Set();
    const queue = [];
    if (target.parentId) queue.push(target.parentId);
    getMergeParentIds(target).forEach((parentId) => queue.push(parentId));
    while (queue.length) {
      const currentId = queue.shift();
      if (!currentId || seen.has(currentId)) continue;
      seen.add(currentId);
      const parent = byId.get(currentId);
      if (!parent) continue;
      out.push(parent.stepName);
      if (parent.parentId) queue.push(parent.parentId);
      getMergeParentIds(parent).forEach((parentId) => queue.push(parentId));
    }
    return Array.from(new Set(out)).reverse();
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

  function openConfiguredDetailModal({ node, detailModal, hiddenBindings, onStateChanged }) {
    if (!detailModal || !detailModal.type) return;
    const fieldMap = (detailModal && detailModal.resultFieldMap) || {};
    const pathFieldKey = fieldMap.fileName || "file_path";
    const currentPathValue = node?.form?.[pathFieldKey] || "";

    if (detailModal.type === "excel") {
      const excelModal = modalPkg.excel || null;
      if (!excelModal || typeof excelModal.open !== "function") {
        if (dialogApi?.show) dialogApi.show("Excelアシスタントを読み込めませんでした。", { kind: "error", title: "モーダルエラー" });
        else alert("Excelアシスタントを読み込めませんでした。");
        return;
      }
      excelModal.open({
        stepName: String(node.stepName || "global"),
        fieldKey: String(pathFieldKey || "file_path"),
        currentValue: String(currentPathValue || ""),
        hiddenBindings: hiddenBindings || {},
        onOk: (result) => {
          applyModalResultToNodeForm(node, detailModal, result);
          if (onStateChanged) onStateChanged();
        }
      });
      return;
    }

    if (detailModal.type === "csv") {
      const csvModal = modalPkg.csv || null;
      if (!csvModal || typeof csvModal.open !== "function") {
        if (dialogApi?.show) dialogApi.show("CSVアシスタントを読み込めませんでした。", { kind: "error", title: "モーダルエラー" });
        else alert("CSVアシスタントを読み込めませんでした。");
        return;
      }
      csvModal.open({
        stepName: String(node.stepName || "global"),
        fieldKey: String(pathFieldKey || "file_path"),
        currentValue: String(currentPathValue || ""),
        hiddenBindings: hiddenBindings || {},
        onOk: (result) => {
          applyModalResultToNodeForm(node, detailModal, result);
          if (onStateChanged) onStateChanged();
        }
      });
      return;
    }

    if (dialogApi?.show) dialogApi.show(`未対応のモーダル種別です: ${detailModal.type}`, { kind: "warning", title: "モーダル" });
    else alert(`未対応のモーダル種別です: ${detailModal.type}`);
  }

  function requestNodeRun(node, mode, onStateChanged) {
    if (!node) return;
    if (!Array.isArray(node.runtimeLogs)) node.runtimeLogs = [];
    const timestamp = new Date().toISOString();
    const modeLabel = mode === "through" ? "フロー実行" : "ステップ実行";
    node.runtimeLogs.push(`[${timestamp}] ${modeLabel} をリクエストしました`);
    window.dispatchEvent(
      new CustomEvent("zizai:node-run-request", {
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
    if (!String(node.nodeType || "").trim()) node.nodeType = "task";
    if (!node.connector) node.connector = config.connectors?.[0]?.id || "";
    if (!node.action) {
      const actions = config.actions?.[node.connector] || [];
      node.action = actions[0]?.id || "";
    }
    if (typeof node.description !== "string") node.description = "";
    if (typeof node.descriptionAuto !== "boolean") {
      node.descriptionAuto = !String(node.description || "").trim();
    }
    if (node.descriptionAuto) {
      node.description = getNodeDescriptionSeed(config, node.connector, node.action);
    }
    if (!node.form) node.form = {};
  }

  function createUiId(prefix = "id") {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function ensureStartParameters(state) {
    if (!Array.isArray(state.startParameters)) {
      state.startParameters = [];
    }
    state.startParameters = state.startParameters.map((item) => ({
      id: item?.id || createUiId("start_param"),
      name: String(item?.name ?? ""),
      value: String(item?.value ?? "")
    }));
    return state.startParameters;
  }

  function getAvailableVariables(state, node) {
    const startVariables = ensureStartParameters(state)
      .map((item) => String(item?.name || "").trim())
      .filter(Boolean);
    const upstreamVariables = getUpstreamSteps(state, node.id);
    const systemVariables = [...SYSTEM_VARIABLE_NAMES];
    return {
      startVariables,
      systemVariables,
      upstreamVariables,
      suggestNames: Array.from(new Set([...startVariables, ...systemVariables]))
    };
  }

  function isMergeableNode(node) {
    return !!node && !isLoopRootNode(node) && !node.loopOwnerId;
  }

  function getMergeErrorMessage(result) {
    return result?.reason === "connected" ? "祖先・子孫関係を含む、既存の接続関係があるノード同士には合流できません。" :
      result?.reason === "already_primary" ? "すでに主系統で接続されています。" :
      result?.reason === "already_merge" ? "すでに合流設定されています。" :
      result?.reason === "loop_root" || result?.reason === "loop_internal" ? "ループ関連ノードには合流できません。" :
      "合流の作成に失敗しました。";
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
    return !!node && String(node.nodeType || "").trim() === "loop" && !node.loopOwnerId;
  }

  function isDraggableNode(node) {
    return !!node;
  }

  function collectNodeAndDescendantIds(state, nodeId) {
    const seen = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const currentId = queue.shift();
      if (!currentId || seen.has(currentId)) continue;
      seen.add(currentId);
      state.nodes.forEach((child) => {
        if ((child.parentId ?? null) === currentId && !seen.has(child.id)) {
          queue.push(child.id);
          return;
        }
        if (getMergeParentIds(child).includes(currentId) && !seen.has(child.id)) {
          queue.push(child.id);
        }
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
    const availableVariables = getAvailableVariables(state, node);
    const schema = getFormSchema(config, node.connector, node.action);
    return schema.flatMap((field) =>
      getFieldReferenceWarningsSafe({
        node,
        field,
        upstreamSteps,
        availableVariableNames: availableVariables.suggestNames
      })
    );
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

  function getConnectorLabel(config, connectorId) {
    const connector = config.connectors?.find((item) => item.id === connectorId);
    return jpLabel(connector || { id: connectorId });
  }

  function getNodeDescriptionSeed(config, connectorId, actionId) {
    return [getConnectorLabel(config, connectorId), getActionLabel(config, connectorId, actionId)]
      .filter(Boolean)
      .join(" / ");
  }

  function buildNodeYamlSettings(node) {
    const out = {
      step: String(node.stepName || ""),
      connector: String(node.connector || ""),
      action: String(node.action || ""),
      form: { ...(node.form || {}) }
    };
    if (typeof node.description === "string" && (node.description || node.descriptionAuto === false)) {
      out.description = node.description;
    }
    if (node.parentId) out.parent_id = node.parentId;
    if (getMergeParentIds(node).length) out.merge_parent_ids = getMergeParentIds(node);
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
    const utilsApi = corePkg.utils || {};
    if (utilsApi && typeof utilsApi.toYaml === "function") {
      return utilsApi.toYaml(value);
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
  const NOIMAGE_SRC = "./img/noimage.jpg";

  function isDataConnector(connectorId, config) {
    const connectors = config?.connectors || [];
    const connector = connectors.find((item) => item.id === connectorId);
    if (!connector) return false;
    if (connector.category) {
      return connector.category === "data";
    }
    const dataflowConnectorIds = Array.isArray(config?.modes?.dataflow?.connectorIds)
      ? config.modes.dataflow.connectorIds
      : [];
    return dataflowConnectorIds.includes(connectorId);
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

  function getConnectorImageSrc(connectorId, config) {
    if (!connectorId) return NOIMAGE_SRC;
    const connectors = Array.isArray(config?.connectors) ? config.connectors : [];
    const connector = connectors.find((item) => String(item?.id || "") === String(connectorId || "")) || null;
    const iconPath = String(connector?.icon || connector?.iconSrc || "").trim();
    if (iconPath) return iconPath;
    return `./img/${connectorId}.jpg`;
  }

  function getActionTypeItems(config, connectorId, actionType) {
    const actions = (config.actions && config.actions[connectorId]) || [];
    return actions.filter((action) => normalizeActionType(action.rpaType) === normalizeActionType(actionType));
  }

  function renderConnectorSelect({ config, state, node, onStateChanged, disabled = false }) {
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
          src: getConnectorImageSrc(connector.id, config),
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

    function showLoopConvertWarning(message) {
      if (dialogApi?.show) {
        dialogApi.show(message, { kind: "warning", title: "ループ変換" });
      } else {
        alert(message);
      }
    }

    function hasMergeRelationsForNode(nodeId) {
      if (!state || !Array.isArray(state.nodes) || !nodeId) return false;
      const currentNode = state.nodes.find((item) => item.id === nodeId);
      if (!currentNode) return false;
      if (getMergeParentIds(currentNode).length) return true;
      return state.nodes.some((candidate) => getMergeParentIds(candidate).includes(nodeId));
    }

    function hasLoopInternalNodes(loopRootId) {
      if (!state || !Array.isArray(state.nodes) || !loopRootId) return false;
      return state.nodes.some((candidate) => String(candidate?.loopOwnerId || "") === String(loopRootId || ""));
    }

    function normalizeLoopFormDefaults(targetNode) {
      if (!targetNode || typeof targetNode !== "object") return;
      if (!targetNode.form || typeof targetNode.form !== "object") targetNode.form = {};
      if (targetNode.form.max_iterations === undefined || targetNode.form.max_iterations === null || targetNode.form.max_iterations === "") {
        targetNode.form.max_iterations = 30;
      }
      if (targetNode.form.source_step_id === undefined || targetNode.form.source_step_id === null) {
        targetNode.form.source_step_id = "";
      }
    }

    function convertTaskNodeToLoop(targetNode) {
      if (!state || !Array.isArray(state.nodes)) {
        showLoopConvertWarning("ループ変換に必要な状態を取得できませんでした。");
        return false;
      }
      if (!targetNode || !targetNode.id) {
        showLoopConvertWarning("ループ変換対象のノードが見つかりません。");
        return false;
      }
      if (targetNode.loopOwnerId) {
        showLoopConvertWarning("ループ内ノードはループノードに変換できません。");
        return false;
      }
      if (hasMergeRelationsForNode(targetNode.id)) {
        showLoopConvertWarning("合流設定があるノードはループに変換できません。");
        return false;
      }

      const snapshot = {
        nodes: cloneUiValue(state.nodes || []),
        selectedNodeId: state.selectedNodeId || null,
        selectedNodeIds: cloneUiValue(state.selectedNodeIds || []),
        nextStepSeq: state.nextStepSeq
      };
      targetNode.nodeType = "loop";
      delete targetNode.loopOwnerId;
      normalizeLoopFormDefaults(targetNode);

      if (!hasLoopInternalNodes(targetNode.id)) {
        const created = insertLoopInternalAtAnchor(state, targetNode.id, targetNode.id);
        if (!created) {
          state.nodes = snapshot.nodes;
          state.selectedNodeId = snapshot.selectedNodeId;
          state.selectedNodeIds = snapshot.selectedNodeIds;
          state.nextStepSeq = snapshot.nextStepSeq;
          showLoopConvertWarning("ループ内ノードの自動作成に失敗したため、変換を中止しました。");
          return false;
        }
      }
      return true;
    }

    function selectConnectorAction(connectorId, actionId) {
      if (disabled) return;
      const nextAction = getActionConfig(config, connectorId, actionId);
      const nextNodeType = String(nextAction?.nodeType || "").trim();
      const currentNodeType = String(node.nodeType || "task").trim() || "task";
      const needsLoopConversion = nextNodeType === "loop" && currentNodeType !== "loop";
      if (needsLoopConversion && !convertTaskNodeToLoop(node)) {
        return;
      }
      const changed = node.connector !== connectorId || node.action !== actionId;
      node.connector = connectorId;
      node.action = actionId || "";
      if (nextNodeType) {
        node.nodeType = nextNodeType;
      } else if (!String(node.nodeType || "").trim()) {
        node.nodeType = "task";
      }
      if (changed) {
        node.form = {};
        if (nextNodeType === "loop") normalizeLoopFormDefaults(node);
      }
      if (node.descriptionAuto) {
        node.description = getNodeDescriptionSeed(config, node.connector, node.action);
      }
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
      const currentNodeType = String(node.nodeType || "task").trim() || "task";
      const actions = getActionTypeItems(config, activeConnectorId, activeActionType)
        .filter((action) => {
          const actionNodeType = String(action?.nodeType || "").trim();
          if (!actionNodeType) return true;
          if (actionNodeType === "loop" && currentNodeType === "task") {
            return !node.loopOwnerId;
          }
          return actionNodeType === currentNodeType;
        });
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

    function openFlyout() {
      if (disabled) return false;
      if (open) return true;
      stage = "grid";
      setOpen(true);
      renderStage();
      return true;
    }

    function closeFlyout() {
      if (!open) return true;
      setOpen(false);
      return true;
    }

    function toggleFlyout() {
      if (disabled) return false;
      if (open) return closeFlyout();
      return openFlyout();
    }

    wrapper.__connectorFlyoutController = {
      open: openFlyout,
      close: closeFlyout,
      toggle: toggleFlyout,
      isOpen: () => open
    };

    trigger.addEventListener("click", (e) => {
      if (disabled) return;
      e.preventDefault();
      e.stopPropagation();
      toggleFlyout();
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
  const nodeShared = {
    getUiFieldsApi,
    renderFieldSafe,
    getFieldReferenceWarningsSafe,
    jpLabel,
    cloneUiValue,
    buildNodeClipboardSnapshot,
    isEditingShortcutTarget,
    getMergeParentIds,
    normalizeSteps,
    getUpstreamSteps,
    getActionConfig,
    applyModalResultToNodeForm,
    openConfiguredDetailModal,
    requestNodeRun,
    requestNodeRunById,
    removeNodeById,
    ensureNodeDefaults,
    createUiId,
    ensureStartParameters,
    getAvailableVariables,
    isMergeableNode,
    getMergeErrorMessage,
    hasMissingRequiredField,
    getSelectedNodeIndex,
    isLoopRootNode,
    isDraggableNode,
    collectNodeAndDescendantIds,
    canDropDraggedNodeOnControl,
    applyDraggedNodeDrop,
    getMissingRequiredFieldLabels,
    getNodeReferenceWarnings,
    hasInvalidUpstreamReference,
    getChildrenByParent,
    getLoopFirstInternalChild,
    getLoopOutsideChildren,
    normalizeChildrenForParent,
    moveChildBefore,
    moveChildToFirst,
    createNodeAtParentEnd,
    runAndFindNewNode,
    createNodeAfterAnchor,
    createParallelNodeAtParent,
    insertLoopInternalAtAnchor,
    insertAfterLoopEnd,
    addParallelAfterLoopEnd,
    getActionLabel,
    getConnectorLabel,
    getNodeDescriptionSeed,
    buildNodeYamlSettings,
    dumpYamlSafe,
    toLogText,
    getNodeLogLines,
    isDataConnector,
    connectorDisplayLabel,
    normalizeActionType,
    getActionTypeLabel,
    buildConnectorChoices,
    getConnectorImageSrc,
    getActionTypeItems,
    renderConnectorSelect,
    NOIMAGE_SRC
  };
  window.uiNodeShared = nodeShared;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.nodeShared = nodeShared;
})();
