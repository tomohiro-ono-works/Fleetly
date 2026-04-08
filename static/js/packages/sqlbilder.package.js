(function () {
  const root = window;
  const packages = root.zizPackages = root.zizPackages || {};
  const sqlbilder = packages.sqlbilder = packages.sqlbilder || {};

  function expose(name, getter) {
    if (Object.prototype.hasOwnProperty.call(sqlbilder, name)) return;
    Object.defineProperty(sqlbilder, name, {
      configurable: true,
      enumerable: true,
      get: getter
    });
  }

  expose("page", () => root.zizSqlbilderPage || {});
  expose("state", () => root.zizSqlbilderState || {});
  expose("layout", () => root.zizSqlbilderLayout || {});
  expose("flowlist", () => root.zizSqlbilderFlowlist || {});
  expose("dataCatalog", () => root.zizSqlbilderDataCatalog || {});
  expose("sqlCatalog", () => root.zizSqlbilderSqlCatalog || {});
  expose("editor", () => root.zizSqlbilderEditor || {});
  expose("yaml", () => root.zizSqlbilderYaml || {});
})();
