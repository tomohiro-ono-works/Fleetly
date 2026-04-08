(function () {
  function renderSqlbilderLayout(root, options = {}) {
    if (!root) return;
    root.innerHTML = "";
    root.classList.add("sqlbilder-root");

    const left = document.createElement("div");
    left.className = "sqlbilder-left-column";

    const verticalSplitter = document.createElement("div");
    verticalSplitter.className = "sqlbilder-vsplitter";
    verticalSplitter.dataset.splitIndex = "x";

    const catalog = document.createElement("section");
    catalog.className = "sqlbilder-pane sqlbilder-pane-catalog";
    catalog.innerHTML = `
      <div class="sqlbilder-pane__titlebar">
        <div class="sqlbilder-pane__title">カタログ</div>
        <div class="sqlbilder-pane__switcher" data-sqlbilder-role="catalog-toggle"></div>
      </div>
      <div class="sqlbilder-pane__body">
        <div class="sqlbilder-catalog-list" data-sqlbilder-role="data-catalog-list"></div>
        <div class="sqlbilder-catalog-list" data-sqlbilder-role="sql-catalog-list" hidden></div>
      </div>
    `;

    const splitterOne = document.createElement("div");
    splitterOne.className = "sqlbilder-splitter";
    splitterOne.dataset.splitIndex = "0";

    const flow = document.createElement("section");
    flow.className = "sqlbilder-pane sqlbilder-pane-flow";
    flow.innerHTML = `
      <div class="sqlbilder-pane__title">フローエディタ</div>
      <div class="sqlbilder-pane__body">
        <div class="sqlbilder-flowlist" data-sqlbilder-role="flow-list"></div>
      </div>
    `;

    left.append(catalog, splitterOne, flow);

    const main = document.createElement("div");
    main.className = "sqlbilder-main";
    const mainSplitter = document.createElement("div");
    mainSplitter.className = "sqlbilder-splitter sqlbilder-splitter-main";
    mainSplitter.dataset.splitIndex = "main";
    main.innerHTML = `
      <section class="sqlbilder-pane sqlbilder-pane-editor">
        <div class="sqlbilder-editor-panels" data-sqlbilder-role="editor-panels">
          <section class="sqlbilder-editor-panel is-primary" data-sqlbilder-role="editor-panel-primary">
            <div class="sqlbilder-editor-panel__toolbar">
              <div class="sqlbilder-editor-tabs" data-sqlbilder-role="editor-tabs-primary"></div>
              <div class="sqlbilder-editor-panel__meta" data-sqlbilder-role="editor-meta-primary"></div>
              <div class="sqlbilder-editor-view-toggle" data-sqlbilder-role="editor-toggle-primary"></div>
            </div>
            <div class="sqlbilder-editor-host" data-sqlbilder-role="editor-host-primary"></div>
          </section>
          <section class="sqlbilder-editor-panel is-secondary" data-sqlbilder-role="editor-panel-secondary" hidden>
            <div class="sqlbilder-editor-panel__toolbar">
              <div class="sqlbilder-editor-tabs" data-sqlbilder-role="editor-tabs-secondary"></div>
              <div class="sqlbilder-editor-panel__meta" data-sqlbilder-role="editor-meta-secondary"></div>
              <div class="sqlbilder-editor-view-toggle" data-sqlbilder-role="editor-toggle-secondary"></div>
            </div>
            <div class="sqlbilder-editor-host" data-sqlbilder-role="editor-host-secondary"></div>
          </section>
        </div>
      </section>
      <section class="sqlbilder-pane sqlbilder-pane-results">
        <div class="sqlbilder-results__toolbar">
          <div class="sqlbilder-results__meta" data-sqlbilder-role="results-meta">実行結果</div>
          <div class="sqlbilder-editor-view-toggle" data-sqlbilder-role="results-toggle"></div>
        </div>
        <div class="sqlbilder-pane__body sqlbilder-results__body" data-sqlbilder-role="results-body"></div>
      </section>
    `;
    const editorPane = main.querySelector('.sqlbilder-pane-editor');
    const resultsPane = main.querySelector('.sqlbilder-pane-results');
    main.innerHTML = "";
    if (editorPane) main.appendChild(editorPane);
    main.appendChild(mainSplitter);
    if (resultsPane) main.appendChild(resultsPane);

    const inlineCommandSuggest = document.createElement("div");
    inlineCommandSuggest.className = "sqlbilder-inline-suggest";
    inlineCommandSuggest.hidden = true;
    inlineCommandSuggest.innerHTML = `
      <div class="sqlbilder-inline-suggest__query" data-sqlbilder-role="inline-command-query"></div>
      <div class="sqlbilder-inline-suggest__list" data-sqlbilder-role="inline-command-list"></div>
    `;

    root.append(left, verticalSplitter, main, inlineCommandSuggest);
    if (typeof options.onRendered === "function") {
      options.onRendered({
        root,
        left,
        main,
        catalog,
        flow,
        editor: main.querySelector('.sqlbilder-pane-editor'),
        catalogToggle: catalog.querySelector('[data-sqlbilder-role="catalog-toggle"]'),
        dataCatalogListRoot: catalog.querySelector('[data-sqlbilder-role="data-catalog-list"]'),
        flowListRoot: flow.querySelector('[data-sqlbilder-role="flow-list"]'),
        sqlCatalogListRoot: catalog.querySelector('[data-sqlbilder-role="sql-catalog-list"]'),
        primaryEditorTabsRoot: main.querySelector('[data-sqlbilder-role="editor-tabs-primary"]'),
        secondaryEditorTabsRoot: main.querySelector('[data-sqlbilder-role="editor-tabs-secondary"]'),
        editorPanels: main.querySelector('[data-sqlbilder-role="editor-panels"]'),
        primaryEditorPanel: main.querySelector('[data-sqlbilder-role="editor-panel-primary"]'),
        secondaryEditorPanel: main.querySelector('[data-sqlbilder-role="editor-panel-secondary"]'),
        primaryEditorMeta: main.querySelector('[data-sqlbilder-role="editor-meta-primary"]'),
        secondaryEditorMeta: main.querySelector('[data-sqlbilder-role="editor-meta-secondary"]'),
        primaryEditorToggle: main.querySelector('[data-sqlbilder-role="editor-toggle-primary"]'),
        secondaryEditorToggle: main.querySelector('[data-sqlbilder-role="editor-toggle-secondary"]'),
        primaryEditorHost: main.querySelector('[data-sqlbilder-role="editor-host-primary"]'),
        secondaryEditorHost: main.querySelector('[data-sqlbilder-role="editor-host-secondary"]'),
        resultsMeta: main.querySelector('[data-sqlbilder-role="results-meta"]'),
        resultsToggle: main.querySelector('[data-sqlbilder-role="results-toggle"]'),
        resultsBody: main.querySelector('[data-sqlbilder-role="results-body"]'),
        inlineCommandSuggest,
        inlineCommandQuery: inlineCommandSuggest.querySelector('[data-sqlbilder-role="inline-command-query"]'),
        inlineCommandList: inlineCommandSuggest.querySelector('[data-sqlbilder-role="inline-command-list"]'),
        splitters: [splitterOne],
        verticalSplitter,
        mainSplitter,
      });
    }
  }

  const api = {
    renderSqlbilderLayout
  };

  window.zizSqlbilderLayout = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.layout = api;
})();
