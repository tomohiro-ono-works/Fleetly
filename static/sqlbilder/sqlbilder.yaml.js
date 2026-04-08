(function () {
  function normalizeSqlDocument(sqlText) {
    return String(sqlText || "").replace(/\r\n/g, "\n");
  }

  const api = {
    normalizeSqlDocument
  };

  window.zizSqlbilderYaml = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.yaml = api;
})();
