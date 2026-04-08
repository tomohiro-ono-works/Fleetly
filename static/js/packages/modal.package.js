(function () {
  const root = window;
  const packages = root.zizPackages = root.zizPackages || {};
  const modal = packages.modal = packages.modal || {};

  function expose(name, getter) {
    if (Object.prototype.hasOwnProperty.call(modal, name)) return;
    Object.defineProperty(modal, name, {
      configurable: true,
      enumerable: true,
      get: getter
    });
  }

  expose("modalCore", () => root.ModalCore || null);
  expose("previewSchema", () => root.PreviewSchema || null);
  expose("excel", () => root.ExcelModal || null);
  expose("csv", () => root.CsvModal || null);
})();
