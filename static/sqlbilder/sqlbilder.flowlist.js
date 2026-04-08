(function () {
  function normalizeBlockKind(value) {
    return String(value || "").trim().toLowerCase() === "test" ? "test" : "cte";
  }

  function buildMarkerLine(kind, label) {
    const safeKind = normalizeBlockKind(kind);
    const safeLabel = String(label || "").trim();
    if (safeKind === "test") {
      return `--@test ${safeLabel}`.trimEnd();
    }
    return `--@cte: ${safeLabel}`.trimEnd();
  }

  function parseSqlDocumentToCtes(sqlText) {
    const text = String(sqlText || "");
    const markerRegex = /^\s*--@(cte|test)(?::\s*|\s+)?(.*)?\s*$/gm;
    const matches = [...text.matchAll(markerRegex)];
    if (!matches.length) {
      return [{
        id: "cte_1",
        kind: "cte",
        label: "CTE 1",
        body: text
      }];
    }

    const ctes = [];
    const firstMarkerIndex = matches[0].index || 0;
    if (firstMarkerIndex > 0) {
      const preamble = text.slice(0, firstMarkerIndex);
      ctes.push({
        id: "cte_1",
        kind: "cte",
        label: "CTE 1",
        body: preamble
      });
    }

    matches.forEach((match, index) => {
      const start = match.index || 0;
      const end = index + 1 < matches.length ? (matches[index + 1].index || text.length) : text.length;
      const rawText = text.slice(start, end);
      const markerLine = String(match[0] || "");
      const body = rawText.startsWith(markerLine)
        ? rawText.slice(markerLine.length).replace(/^\r?\n/, "").replace(/(?:\r?\n)+$/, "")
        : rawText;
      const kind = normalizeBlockKind(match[1]);
      const fallbackLabel = kind === "test" ? "新しいCTE" : `CTE ${ctes.length + 1}`;
      ctes.push({
        id: `cte_${ctes.length + 1}`,
        kind,
        label: String(match[2] || fallbackLabel).trim() || fallbackLabel,
        body
      });
    });
    return ctes;
  }

  function buildFlowNodesFromCtes(ctes) {
    const list = Array.isArray(ctes) ? ctes : [];
    return list.map((cte, index) => ({
      id: String(cte?.id || `cte_${index + 1}`),
      kind: normalizeBlockKind(cte?.kind),
      label: String(cte?.label || `CTE ${index + 1}`),
      body: String(cte?.body || "")
    }));
  }

  function buildSqlDocumentFromCtes(ctes) {
    const list = Array.isArray(ctes) ? ctes : [];
    return list
      .map((cte, index) => {
        const label = String(cte?.label || `CTE ${index + 1}`).trim() || `CTE ${index + 1}`;
        const body = String(cte?.body || "");
        return `${buildMarkerLine(cte?.kind, label)}\n${body}`;
      })
      .join("\n");
  }

  function createDefaultCtes() {
    return [{
      id: "cte_1",
      kind: "cte",
      label: "CTE 1",
      body: ""
    }];
  }

  function moveCteById(ctes, draggedId, targetId) {
    const list = Array.isArray(ctes) ? ctes.slice() : [];
    const fromIndex = list.findIndex((cte) => String(cte?.id || "") === String(draggedId || ""));
    const toIndex = list.findIndex((cte) => String(cte?.id || "") === String(targetId || ""));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
      return list;
    }
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);
    return list.map((cte, index) => ({
      id: `cte_${index + 1}`,
      kind: normalizeBlockKind(cte?.kind),
      label: String(cte?.label || `CTE ${index + 1}`),
      body: String(cte?.body || ""),
    }));
  }

  const api = {
    parseSqlDocumentToCtes,
    buildFlowNodesFromCtes,
    buildSqlDocumentFromCtes,
    createDefaultCtes,
    moveCteById,
    buildMarkerLine,
    normalizeBlockKind
  };

  window.zizSqlbilderFlowlist = api;
  const packages = window.zizPackages = window.zizPackages || {};
  packages.sqlbilder = packages.sqlbilder || {};
  packages.sqlbilder.flowlist = api;
})();
