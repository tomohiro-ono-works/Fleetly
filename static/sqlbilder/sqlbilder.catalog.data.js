(function () {
  const DEFAULT_DATA_CATALOG_TREE = [
    {
      id: "table_orders_202401",
      type: "table",
      label: "orders_202401",
      children: [
        { id: "orders_202401_order_id", type: "column", label: "order_id", insertText: "order_id" },
        { id: "orders_202401_product_id", type: "column", label: "product_id", insertText: "product_id" },
        { id: "orders_202401_price", type: "column", label: "price", insertText: "price" },
        {
          id: "orders_202401_calc",
          type: "group",
          label: "計算フィールド",
          children: [
            {
              id: "orders_202401_price_band",
              type: "calculated",
              label: "price_band",
              insertText: "CASE\n  WHEN price >= 10000 THEN 'high'\n  WHEN price >= 5000 THEN 'mid'\n  ELSE 'low'\nEND AS price_band"
            }
          ]
        }
      ]
    },
    {
      id: "table_products",
      type: "table",
      label: "products",
      children: [
        { id: "products_product_id", type: "column", label: "product_id", insertText: "product_id" },
        { id: "products_category", type: "column", label: "category", insertText: "category" },
        {
          id: "products_calc",
          type: "group",
          label: "計算フィールド",
          children: [
            {
              id: "products_category_group",
              type: "calculated",
              label: "category_group",
              insertText: "CASE\n  WHEN category IN ('A', 'B') THEN 'priority'\n  ELSE 'standard'\nEND AS category_group"
            }
          ]
        }
      ]
    },
    {
      id: "table_sales_summary",
      type: "table",
      label: "sales_summary",
      children: [
        { id: "sales_summary_order_id", type: "column", label: "order_id", insertText: "order_id" },
        { id: "sales_summary_product_id", type: "column", label: "product_id", insertText: "product_id" },
        { id: "sales_summary_category", type: "column", label: "category", insertText: "category" },
        { id: "sales_summary_price", type: "column", label: "price", insertText: "price" },
        { id: "sales_summary_price2", type: "column", label: "price2", insertText: "price2" },
        {
          id: "sales_summary_calc",
          type: "group",
          label: "計算フィールド",
          children: [
            {
              id: "sales_summary_growth_flag",
              type: "calculated",
              label: "growth_flag",
              insertText: "CASE\n  WHEN price2 > price THEN 'up'\n  WHEN price2 < price THEN 'down'\n  ELSE 'flat'\nEND AS growth_flag"
            }
          ]
        }
      ]
    }
  ];

  function cloneNode(node) {
    return {
      id: String(node?.id || ""),
      type: String(node?.type || "item"),
      label: String(node?.label || ""),
      insertText: String(node?.insertText || ""),
      children: Array.isArray(node?.children) ? node.children.map(cloneNode) : []
    };
  }

  function normalizeDataCatalogTree(value) {
    const source = Array.isArray(value) && value.length ? value : DEFAULT_DATA_CATALOG_TREE;
    return source.map(cloneNode);
  }

  const api = {
    DEFAULT_DATA_CATALOG_TREE,
    normalizeDataCatalogTree
  };

  window.zizSqlbilderDataCatalog = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.dataCatalog = api;
})();
