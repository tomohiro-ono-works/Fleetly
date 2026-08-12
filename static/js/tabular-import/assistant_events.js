(function (root) {
  "use strict";

  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__tabularImportModules = packages.__tabularImportModules || {};

  function createEmitter() {
    const listeners = new Map();

    function on(eventName, handler) {
      const name = String(eventName || "").trim();
      if (!name || typeof handler !== "function") {
        throw new TypeError("event name and handler are required");
      }
      const handlers = listeners.get(name) || new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
      return () => {
        handlers.delete(handler);
        if (!handlers.size) listeners.delete(name);
      };
    }

    function emit(eventName, payload) {
      const handlers = listeners.get(String(eventName || "").trim());
      if (!handlers) return;
      Array.from(handlers).forEach((handler) => handler(payload));
    }

    function clear() {
      listeners.clear();
    }

    return Object.freeze({ on, emit, clear });
  }

  modules.createEmitter = createEmitter;
})(window);
