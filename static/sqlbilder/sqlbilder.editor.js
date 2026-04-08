(function () {
  function formatCteBlock(cte, fallbackLabel = "CTE 1") {
    const label = String(cte?.label || fallbackLabel).trim() || fallbackLabel;
    const body = String(cte?.body || "");
    const kind = String(cte?.kind || "").trim().toLowerCase() === "test" ? "test" : "cte";
    const marker = kind === "test" ? `--@test ${label}` : `--@cte: ${label}`;
    return `${marker}\n${body}`;
  }

  function extractSelectedCteBody(ctes, selectedNodeId) {
    const list = Array.isArray(ctes) ? ctes : [];
    const index = list.findIndex((cte) => String(cte?.id || "") === String(selectedNodeId || ""));
    const target = index >= 0 ? list[index] : null;
    return target ? formatCteBlock(target, `CTE ${index + 1}`) : "";
  }

  function parseCteBlock(nextBlockText, fallback = {}) {
    const text = String(nextBlockText || "");
    const normalized = text.replace(/\r\n/g, "\n");
    const headerMatch = normalized.match(/^\s*--@(cte|test)(?::\s*|\s+)?(.*)?\s*(?:\n|$)/);
    if (!headerMatch) {
      return {
        id: String(fallback?.id || ""),
        kind: String(fallback?.kind || "cte"),
        label: String(fallback?.label || "CTE 1"),
        body: normalized
      };
    }
    const kind = String(headerMatch[1] || fallback?.kind || "cte").trim().toLowerCase() === "test" ? "test" : "cte";
    const fallbackLabel = kind === "test" ? (fallback?.label || "新しいCTE") : (fallback?.label || "CTE 1");
    const label = String(headerMatch[2] || fallbackLabel).trim() || String(fallbackLabel);
    const body = normalized.slice(headerMatch[0].length);
    return {
      id: String(fallback?.id || ""),
      kind,
      label,
      body
    };
  }

  function replaceSelectedCteBlock(ctes, selectedNodeId, nextBlockText) {
    const list = Array.isArray(ctes) ? ctes : [];
    return list.map((cte, index) => {
      if (String(cte?.id || "") !== String(selectedNodeId || "")) {
        return cte;
      }
      const parsed = parseCteBlock(nextBlockText, {
        id: cte?.id || "",
        kind: cte?.kind || "cte",
        label: cte?.label || `CTE ${index + 1}`
      });
      return {
        id: String(cte?.id || parsed.id || `cte_${index + 1}`),
        kind: String(parsed.kind || cte?.kind || "cte"),
        label: String(parsed.label || cte?.label || `CTE ${index + 1}`),
        body: String(parsed.body || "")
      };
    });
  }

  function appendCteBlock(ctes, nextBlockText) {
    const list = Array.isArray(ctes) ? ctes.slice() : [];
    const nextIndex = list.length + 1;
    const parsed = parseCteBlock(nextBlockText, {
      id: `cte_${nextIndex}`,
      kind: "cte",
      label: `CTE ${nextIndex}`
    });
    list.push({
      id: `cte_${nextIndex}`,
      kind: String(parsed.kind || "cte"),
      label: String(parsed.label || `CTE ${nextIndex}`),
      body: String(parsed.body || "")
    });
    return list;
  }

  const api = {
    formatCteBlock,
    extractSelectedCteBody,
    parseCteBlock,
    replaceSelectedCteBlock,
    appendCteBlock
  };

  window.zizSqlbilderEditor = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.editor = api;
})();
