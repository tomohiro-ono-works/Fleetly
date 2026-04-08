(function () {
  function createInitialSqlbilderState() {
    return {
      dataCatalog: {
        tree: [],
        expandedIds: []
      },
      sqlCatalog: {
        items: []
      },
      primaryTabs: [
        {
          id: "sql_tab_1",
          title: "SQL 1",
          ctes: [
            {
              id: "cte_1",
              label: "CTE 1",
              body: ""
            }
          ],
          selectedNodeId: "cte_1"
        }
      ],
      secondaryTabs: [
        {
          id: "sql_tab_1",
          title: "SQL 1",
          ctes: [
            {
              id: "cte_1",
              label: "CTE 1",
              body: ""
            }
          ],
          selectedNodeId: "cte_1"
        }
      ],
      flow: {
        nodes: [],
        selectedNodeId: ""
      },
      editor: {
        selectedCteBody: "",
        primaryTabId: "sql_tab_1",
        secondaryTabId: "sql_tab_1",
        flowSourcePane: "primary",
        primaryViewMode: "cte",
        secondaryViewMode: "cte",
        resultViewMode: "data"
      },
      catalogView: "data",
      layout: {
        leftHeights: [0.5, 0.5],
        mainHeights: [0.68, 0.32]
      }
    };
  }

  const api = {
    createInitialSqlbilderState
  };

  window.zizSqlbilderState = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.state = api;
})();
