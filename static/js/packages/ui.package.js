(function () {
  const root = window;
  const packages = root.zizPackages = root.zizPackages || {};
  const ui = packages.ui = packages.ui || {};

  function expose(name, getter) {
    if (Object.prototype.hasOwnProperty.call(ui, name)) return;
    Object.defineProperty(ui, name, {
      configurable: true,
      enumerable: true,
      get: getter
    });
  }

  expose("renderer", () => root.renderer || {});
  expose("node", () => root.uiNode || {});
  expose("fields", () => root.uiFields || {});
  expose("suggest", () => root.uiSuggest || {});
})();
