(function () {
  const root = window;
  const packages = root.zizPackages = root.zizPackages || {};
  const core = packages.core = packages.core || {};

  function expose(name, getter) {
    if (Object.prototype.hasOwnProperty.call(core, name)) return;
    Object.defineProperty(core, name, {
      configurable: true,
      enumerable: true,
      get: getter
    });
  }

  expose("CONFIG", () => root.CONFIG || {});
  expose("utils", () => root.utils || {});
  expose("stateOps", () => root.stateOps || {});
  expose("bridge", () => root.zizBridge || null);
  expose("dialog", () => root.zizDialog || null);
  expose("codeEditors", () => root.codeEditors || null);
})();
