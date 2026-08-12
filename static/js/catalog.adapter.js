(function () {
  const COMMANDS = Object.freeze({
    connectors: "catalog.getConnectors",
    actions: "catalog.getActions",
    forms: "catalog.getForms",
    dataArea: "catalog.getDataAreaPolicy",
    security: "catalog.getSecurityPolicySummary"
  });

  const state = {
    loadPromise: null,
    config: null,
    raw: null
  };

  function resolveBridge() {
    const local = window.zizPackages?.core?.bridge || null;
    const parent = window.parent && window.parent !== window
      ? (window.parent.zizPackages?.core?.bridge || null)
      : null;
    if (local?.available?.()) return local;
    if (parent?.available?.()) return parent;
    return local || parent;
  }

  function requireArray(value, command, key) {
    if (!Array.isArray(value)) {
      throw new Error(`${command} response.data.${key} は配列である必要があります。`);
    }
    return value;
  }

  function toCamelKey(value) {
    return String(value || "").replace(/_([a-z])/g, (_, char) => char.toUpperCase());
  }

  function normalizeDetailModal(value) {
    if (!value || typeof value !== "object") return null;
    const sourceMap = value.result_field_map && typeof value.result_field_map === "object"
      ? value.result_field_map
      : {};
    return {
      type: String(value.type || ""),
      label: String(value.label || ""),
      resultFieldMap: Object.fromEntries(
        Object.entries(sourceMap).map(([key, target]) => [toCamelKey(key), target])
      )
    };
  }

  function buildConfig(responses) {
    const appModes = requireArray(
      responses.connectors?.app_modes,
      COMMANDS.connectors,
      "app_modes"
    );
    const connectors = requireArray(
      responses.connectors?.connectors,
      COMMANDS.connectors,
      "connectors"
    );
    const actions = requireArray(
      responses.actions?.actions,
      COMMANDS.actions,
      "actions"
    );
    const forms = requireArray(
      responses.forms?.forms,
      COMMANDS.forms,
      "forms"
    );
    const policies = requireArray(
      responses.dataArea?.policies,
      COMMANDS.dataArea,
      "policies"
    );
    const profiles = requireArray(
      responses.security?.profiles,
      COMMANDS.security,
      "profiles"
    );

    const modeMap = Object.fromEntries(appModes.map((mode) => [
      mode.mode_id,
      {
        id: mode.mode_id,
        label: mode.label,
        defaultFlowName: mode.default_flow_name,
        fileExtension: mode.file_extension,
        nodeDefaults: {
          initialConnectorId: mode.node_defaults?.initial_connector_id,
          initialActionId: mode.node_defaults?.initial_action_id,
          preferredConnectorId: mode.node_defaults?.preferred_connector_id,
          preferredActionId: mode.node_defaults?.preferred_action_id,
          loopConnectorId: mode.node_defaults?.loop_connector_id,
          loopActionId: mode.node_defaults?.loop_action_id
        },
        connectorIds: [...(mode.connector_ids || [])]
      }
    ]));

    const connectorItems = connectors.map((connector) => ({
      id: connector.connector_id,
      label: connector.label,
      exportId: connector.export_id,
      category: connector.category,
      icon: connector.icon,
      actionIds: [...(connector.actions || [])]
    }));

    const actionMap = {};
    actions.forEach((action) => {
      const connectorId = String(action.connector_id || "");
      if (!actionMap[connectorId]) actionMap[connectorId] = [];
      const normalized = {
        id: action.action_id,
        connectorId,
        label: action.label,
        category: action.category,
        subcategory: action.subcategory,
        nodeType: action.node_type,
        formSchemaId: action.form_schema_id,
        dataAreaPolicyId: action.data_area_policy_id,
        securityProfileId: action.security_profile_id,
        resultContract: action.result_contract,
        standaloneAllowed: action.standalone_allowed === true,
        standaloneResultModes: [...(action.standalone_result_modes || [])],
        standaloneDocument: action.standalone_document
          ? {
              extensions: [...(action.standalone_document.extensions || [])],
              sourceKind: String(action.standalone_document.source_kind || ""),
              sourceParam: String(action.standalone_document.source_param || "")
            }
          : null,
        exportAllowed: action.export_allowed === true,
        standaloneExportModes: [...(action.standalone_export_modes || [])],
        dryRun: action.dry_run || null
      };
      const detailModal = normalizeDetailModal(action.detail_modal);
      if (detailModal) normalized.detailModal = detailModal;
      actionMap[connectorId].push(normalized);
    });

    const formMap = Object.fromEntries(
      forms.map((form) => [form.form_schema_id, [...(form.fields || [])]])
    );
    const dataAreaPolicyMap = Object.fromEntries(
      policies.map((policy) => [policy.data_area_policy_id, { ...policy }])
    );
    const securityProfileMap = Object.fromEntries(
      profiles.map((profile) => [profile.security_profile_id, { ...profile }])
    );

    return {
      version: Number(responses.connectors?.version) || 1,
      modes: modeMap,
      connectors: connectorItems,
      actions: actionMap,
      forms: formMap,
      dataAreaPolicies: dataAreaPolicyMap,
      executionMetadataColumns: [
        ...(responses.dataArea?.execution_metadata_columns || [])
      ],
      securityProfiles: securityProfileMap
    };
  }

  async function loadCatalog() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.call !== "function") {
      throw new Error("catalog取得に必要なBridgeClientが初期化されていません。");
    }
    const [connectors, actions, forms, dataArea, security] = await Promise.all([
      bridge.call(COMMANDS.connectors, {}),
      bridge.call(COMMANDS.actions, {}),
      bridge.call(COMMANDS.forms, {}),
      bridge.call(COMMANDS.dataArea, {}),
      bridge.call(COMMANDS.security, {})
    ]);
    const raw = { connectors, actions, forms, dataArea, security };
    const config = buildConfig(raw);
    state.raw = raw;
    state.config = config;
    window.dispatchEvent(new CustomEvent("ziz:catalog-ready"));
    return config;
  }

  function initialize() {
    if (!state.loadPromise) {
      state.loadPromise = loadCatalog();
    }
    return state.loadPromise;
  }

  function getConfig() {
    return state.config;
  }

  function getConfigForMode(modeId) {
    const config = state.config;
    if (!config) return null;
    const mode = config.modes[String(modeId || "")] || null;
    const connectorIds = new Set(mode?.connectorIds || []);
    const connectors = config.connectors.filter(
      (connector) => !connectorIds.size || connectorIds.has(connector.id)
    );
    const visibleIds = new Set(connectors.map((connector) => connector.id));
    const actions = Object.fromEntries(
      Object.entries(config.actions).filter(([connectorId]) => visibleIds.has(connectorId))
    );
    const forms = {};
    Object.values(actions).flat().forEach((action) => {
      if (config.forms[action.formSchemaId]) {
        forms[action.formSchemaId] = config.forms[action.formSchemaId];
      }
    });
    return {
      ...config,
      appMode: mode?.id || String(modeId || ""),
      connectors,
      actions,
      forms
    };
  }

  function getAction(connectorId, actionId) {
    return (state.config?.actions?.[connectorId] || [])
      .find((action) => action.id === actionId) || null;
  }

  function getFormSchema(connectorId, actionId) {
    const action = getAction(connectorId, actionId);
    return action ? (state.config?.forms?.[action.formSchemaId] || []) : [];
  }

  function getDataAreaPolicy(connectorId, actionId) {
    const action = getAction(connectorId, actionId);
    return action
      ? (state.config?.dataAreaPolicies?.[action.dataAreaPolicyId] || null)
      : null;
  }

  const api = Object.freeze({
    initialize,
    getConfig,
    getConfigForMode,
    getAction,
    getFormSchema,
    getDataAreaPolicy
  });
  const packages = window.zizPackages = window.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.catalog = api;
})();
