(function () {
  const PYTHON_KEYWORDS = new Set([
    "and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del",
    "elif", "else", "except", "False", "finally", "for", "from", "global", "if", "import", "in",
    "is", "lambda", "match", "None", "nonlocal", "not", "or", "pass", "raise", "return", "True",
    "try", "while", "with", "yield"
  ]);
  const SQL_KEYWORDS = new Set([
    "ALL", "AND", "AS", "ASC", "BETWEEN", "BY", "CASE", "CREATE", "DELETE", "DESC", "DISTINCT",
    "ELSE", "END", "FROM", "FULL", "GROUP", "HAVING", "IN", "INNER", "INSERT", "INTO", "IS",
    "JOIN", "LEFT", "LIKE", "LIMIT", "NOT", "NULL", "ON", "OR", "ORDER", "OUTER", "RIGHT",
    "SELECT", "SET", "TABLE", "THEN", "UNION", "UPDATE", "VALUES", "WHEN", "WHERE", "WITH"
  ]);

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function wrapToken(text, className) {
    const escaped = escapeHtml(text);
    if (!className) return escaped;
    return `<span class="cm-token ${className}">${escaped}</span>`;
  }

  function tokenizePython(text) {
    const out = [];
    let index = 0;

    while (index < text.length) {
      const ch = text[index];
      const next3 = text.slice(index, index + 3);

      if (ch === "#") {
        let end = index;
        while (end < text.length && text[end] !== "\n") end += 1;
        out.push(wrapToken(text.slice(index, end), "cm-comment"));
        index = end;
        continue;
      }

      if (next3 === "'''" || next3 === "\"\"\"") {
        const quote = next3;
        let end = index + 3;
        while (end < text.length && text.slice(end, end + 3) !== quote) end += 1;
        end = Math.min(text.length, end + 3);
        out.push(wrapToken(text.slice(index, end), "cm-string"));
        index = end;
        continue;
      }

      if (ch === "'" || ch === "\"") {
        const quote = ch;
        let end = index + 1;
        while (end < text.length) {
          const current = text[end];
          if (current === "\\") {
            end += 2;
            continue;
          }
          if (current === quote) {
            end += 1;
            break;
          }
          end += 1;
        }
        out.push(wrapToken(text.slice(index, end), "cm-string"));
        index = end;
        continue;
      }

      if (/\d/.test(ch)) {
        let end = index + 1;
        while (end < text.length && /[\d._]/.test(text[end])) end += 1;
        out.push(wrapToken(text.slice(index, end), "cm-number"));
        index = end;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        let end = index + 1;
        while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
        const word = text.slice(index, end);
        out.push(wrapToken(word, PYTHON_KEYWORDS.has(word) ? "cm-keyword" : ""));
        index = end;
        continue;
      }

      out.push(escapeHtml(ch));
      index += 1;
    }

    return out.join("");
  }

  function tokenizeSql(text) {
    const out = [];
    let index = 0;

    while (index < text.length) {
      const ch = text[index];
      const next2 = text.slice(index, index + 2);

      if (next2 === "--") {
        let end = index;
        while (end < text.length && text[end] !== "\n") end += 1;
        out.push(wrapToken(text.slice(index, end), "cm-comment"));
        index = end;
        continue;
      }

      if (next2 === "/*") {
        let end = index + 2;
        while (end < text.length && text.slice(end, end + 2) !== "*/") end += 1;
        end = Math.min(text.length, end + 2);
        out.push(wrapToken(text.slice(index, end), "cm-comment"));
        index = end;
        continue;
      }

      if (ch === "#") {
        let end = index;
        while (end < text.length && text[end] !== "\n") end += 1;
        out.push(wrapToken(text.slice(index, end), "cm-comment"));
        index = end;
        continue;
      }

      if (ch === "'" || ch === "\"" || ch === "`") {
        const quote = ch;
        let end = index + 1;
        while (end < text.length) {
          const current = text[end];
          if (current === quote) {
            if (quote === "'" && text[end + 1] === "'") {
              end += 2;
              continue;
            }
            end += 1;
            break;
          }
          end += 1;
        }
        out.push(wrapToken(text.slice(index, end), "cm-string"));
        index = end;
        continue;
      }

      if (/\d/.test(ch)) {
        let end = index + 1;
        while (end < text.length && /[\d._]/.test(text[end])) end += 1;
        out.push(wrapToken(text.slice(index, end), "cm-number"));
        index = end;
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        let end = index + 1;
        while (end < text.length && /[A-Za-z0-9_]/.test(text[end])) end += 1;
        const word = text.slice(index, end);
        out.push(wrapToken(word, SQL_KEYWORDS.has(word.toUpperCase()) ? "cm-keyword" : ""));
        index = end;
        continue;
      }

      out.push(escapeHtml(ch));
      index += 1;
    }

    return out.join("");
  }

  function renderHighlightedHtml(text, language) {
    const source = String(text || "");
    if (!source) return " ";

    if (language === "python") return tokenizePython(source);
    if (language === "sql") return tokenizeSql(source);
    return escapeHtml(source);
  }

  const api = { renderHighlightedHtml };
  window.codeHighlight = api;
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.codeHighlight = api;
})();
