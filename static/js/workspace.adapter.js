(function () {
  const COMMANDS = Object.freeze({
    getRoot: "workspace.getRoot",
    setRoot: "workspace.setRoot",
    pickRoot: "workspace.pickRoot",
    list: "workspace.list",
    stat: "workspace.stat",
    readText: "workspace.readText",
    writeText: "workspace.writeText",
    mkdir: "workspace.mkdir",
    deleteEntry: "workspace.delete"
  });

  function resolveBridge() {
    const local = window.zizPackages?.core?.bridge || null;
    const parent = window.parent && window.parent !== window
      ? (window.parent.zizPackages?.core?.bridge || null)
      : null;
    if (local?.available?.()) return local;
    if (parent?.available?.()) return parent;
    return local || parent;
  }

  function call(command, payload = {}) {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.call !== "function") {
      return Promise.reject({
        code: "E_NOT_READY",
        message: "workspace操作に必要なBridgeClientが初期化されていません。"
      });
    }
    return bridge.call(command, payload);
  }

  const api = Object.freeze({
    getRoot: () => call(COMMANDS.getRoot, {}),
    setRoot: (payload) => call(COMMANDS.setRoot, payload),
    pickRoot: (payload = {}) => call(COMMANDS.pickRoot, payload),
    list: (payload = {}) => call(COMMANDS.list, payload),
    stat: (payload) => call(COMMANDS.stat, payload),
    readText: (payload) => call(COMMANDS.readText, payload),
    writeText: (payload) => call(COMMANDS.writeText, payload),
    mkdir: (payload) => call(COMMANDS.mkdir, payload),
    delete: (payload) => call(COMMANDS.deleteEntry, payload)
  });

  const packages = window.zizPackages = window.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.workspace = api;
})();
