(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const modules = packages.__uiShellModules = packages.__uiShellModules || {};

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
      return () => off(name, handler);
    }

    function off(eventName, handler) {
      const handlers = listeners.get(String(eventName || "").trim());
      if (!handlers) return false;
      const removed = handlers.delete(handler);
      if (!handlers.size) listeners.delete(String(eventName || "").trim());
      return removed;
    }

    function emit(eventName, payload) {
      const handlers = listeners.get(String(eventName || "").trim());
      if (!handlers) return;
      Array.from(handlers).forEach((handler) => handler(payload));
    }

    function clear() {
      listeners.clear();
    }

    return Object.freeze({ on, off, emit, clear });
  }

  modules.createEmitter = createEmitter;
})(window);
