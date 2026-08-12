(function () {
  const COMMANDS = Object.freeze({
    list: "documents.list",
    load: "documents.load",
    save: "documents.save",
    close: "documents.close"
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
        message: "document操作に必要なBridgeClientが初期化されていません。"
      });
    }
    return bridge.call(command, payload);
  }

  const api = Object.freeze({
    list: (payload = {}) => call(COMMANDS.list, payload),
    load: (payload) => call(COMMANDS.load, payload),
    save: (payload) => call(COMMANDS.save, payload),
    close: (payload) => call(COMMANDS.close, payload)
  });

  const packages = window.zizPackages = window.zizPackages || {};
  const app = packages.app = packages.app || {};
  app.documents = api;
})();
