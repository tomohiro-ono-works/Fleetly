(function () {
  const DEFAULT_SQL_CATALOG_ITEMS = [
    {
      id: "sql_catalog_user_orders_prep",
      label: "注文データにユーザー情報を紐付け、日付で整理する下準備",
      insertText: "--@cte: 1. 注文データにユーザー情報を紐付け、日付で整理する下準備 (CTE)\n,user_orders AS (\n    SELECT \n        u.user_id,\n        u.user_name,\n        o.order_id,\n        o.order_date,\n        o.amount,\n        -- 前回の注文日を取得する (WINDOW関数: LAG)\n        LAG(o.order_date) OVER(PARTITION BY u.user_id ORDER BY o.order_date) AS prev_order_date\n    FROM \n        users u\n    INNER JOIN \n        orders o ON u.user_id = o.user_id\n    WHERE \n        o.status = 'completed' -- 完了した注文のみ\n),"
    }
  ];

  function cloneItem(item) {
    return {
      id: String(item?.id || ""),
      label: String(item?.label || ""),
      insertText: String(item?.insertText || "")
    };
  }

  function normalizeSqlCatalogItems(value) {
    const source = Array.isArray(value) && value.length ? value : DEFAULT_SQL_CATALOG_ITEMS;
    return source.map(cloneItem);
  }

  const api = {
    DEFAULT_SQL_CATALOG_ITEMS,
    normalizeSqlCatalogItems
  };

  window.zizSqlbilderSqlCatalog = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.sqlCatalog = api;
})();
