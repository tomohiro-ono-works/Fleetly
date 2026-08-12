const path = require('path');
const { execFileSync } = require('child_process');

let cachedResponses = null;

function loadCatalogResponses() {
  if (cachedResponses) return cachedResponses;
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const script = [
    'import json',
    'from app.services.catalog_service import CatalogService',
    'service = CatalogService()',
    'print(json.dumps({',
    '  "catalog.getConnectors": service.get_connectors(),',
    '  "catalog.getActions": service.get_actions(),',
    '  "catalog.getForms": service.get_forms(),',
    '  "catalog.getDataAreaPolicy": service.get_data_area_policy(),',
    '  "catalog.getSecurityPolicySummary": service.get_security_policy_summary(),',
    '}))',
  ].join('\n');
  cachedResponses = JSON.parse(execFileSync(
    'python',
    ['-c', script],
    { cwd: repoRoot, encoding: 'utf8' }
  ));
  return cachedResponses;
}

function buildCatalogBridgeStubScript() {
  const responses = JSON.stringify(loadCatalogResponses()).replace(/</g, '\\u003c');
  return `
    (function () {
      const responses = ${responses};
      const calls = [];
      window.__catalogBridgeCalls = calls;
      const bridgeApi = {
        available() { return true; },
        status() { return { state: 'ready', ready: true }; },
        unavailableMessage() { return ''; },
        call(type, payload) {
          calls.push({ type: String(type || ''), payload: payload || {} });
          if (Object.prototype.hasOwnProperty.call(responses, type)) {
            return Promise.resolve(responses[type]);
          }
          if (type === 'app.getStatus') {
            return Promise.resolve({ gui_mode: 'webview', host: 'qt' });
          }
          if (type === 'workspace.getRoot') {
            return Promise.resolve({ has_root: false, root_path: '', config_path: '' });
          }
          if (type === 'workspace.list') {
            return Promise.resolve({ scope: payload?.scope || 'root', entries: [] });
          }
          if (type === 'documents.list') {
            return Promise.resolve({ scope: payload?.scope || 'local', kind: payload?.kind || 'recent', items: [] });
          }
          if (type === 'app.logUiEvent') {
            return Promise.resolve({ logged: true });
          }
          return Promise.resolve({});
        }
      };
      window.zizPackages = window.zizPackages || {};
      window.zizPackages.core = window.zizPackages.core || {};
      window.zizPackages.core.bridge = bridgeApi;
      setTimeout(() => window.dispatchEvent(new CustomEvent('ziz:bridge-ready')), 0);
    })();
  `;
}

function withCatalogResponses(stubScript) {
  const responses = JSON.stringify(loadCatalogResponses()).replace(/</g, '\\u003c');
  return `${String(stubScript || '')}
    ;(function () {
      const responses = ${responses};
      const bridge = window.zizPackages?.core?.bridge || null;
      if (!bridge || typeof bridge.call !== 'function') return;
      const originalCall = bridge.call.bind(bridge);
      bridge.call = function (type, payload) {
        if (Object.prototype.hasOwnProperty.call(responses, type)) {
          return Promise.resolve(responses[type]);
        }
        return originalCall(type, payload);
      };
    })();
  `;
}

module.exports = {
  buildCatalogBridgeStubScript,
  loadCatalogResponses,
  withCatalogResponses
};
