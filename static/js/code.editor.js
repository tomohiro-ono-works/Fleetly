(function () {
  const CODE_EDITOR_VISIBLE_LINES = 15;
  const CODE_EDITOR_LINE_HEIGHT = 20;
  const CODE_EDITOR_VERTICAL_PADDING = 20;
  const CODE_EDITOR_GUTTER_DIGITS = 3;
  const INDENT_TEXT = "  ";
  const SUGGEST_INDEX_CACHE = new Map();
  const SUGGEST_INDEX_LOADING = new Map();

  function getShellApi() {
    return window.zizShell || {};
  }

  async function loadScriptOnce(path) {
    const shellApi = getShellApi();
    if (typeof shellApi.loadScriptOnce !== "function") return null;
    return shellApi.loadScriptOnce(path);
  }

  async function ensureYamlParserLoaded() {
    const parser = window.jsyaml;
    if (parser && typeof parser.load === "function") return parser;
    await loadScriptOnce("./vendor/js-yaml/js-yaml.min.js");
    return window.jsyaml || null;
  }

  async function ensureCodeHighlightLoaded() {
    const api = getCodeHighlightApi();
    if (typeof api.renderHighlightedHtml === "function") return api;
    await loadScriptOnce("./js/code.highlight.js");
    return getCodeHighlightApi();
  }

  function getCodeHighlightApi() {
    return (window.zizPackages && window.zizPackages.core && window.zizPackages.core.codeHighlight)
      || window.codeHighlight
      || {};
  }

  function applyEditorHeight(input, surface, highlight, host) {
    const basis = host || input;
    const shouldStretchInRightSidebar = !!basis?.closest?.(
      ".right-sidebar-content .node-tab-pane[data-tab-key='detail'] .row.row--code-editor"
    );
    const shouldStretchInWorkspaceText = !!basis?.closest?.(
      ".workspace-text-editor-host.code-editor"
    );
    if (shouldStretchInRightSidebar || shouldStretchInWorkspaceText) {
      const hostHeight = Math.max(
        0,
        Number.parseFloat(String(basis?.getBoundingClientRect?.().height || 0)) || 0
      );
      const stretchHeight = hostHeight > 0 ? `${Math.floor(hostHeight)}px` : "100%";
      if (input) {
        input.style.height = stretchHeight;
        input.style.minHeight = stretchHeight;
        input.style.maxHeight = "none";
      }
      if (surface) {
        surface.style.height = stretchHeight;
        surface.style.minHeight = stretchHeight;
        surface.style.maxHeight = "none";
      }
      if (highlight) {
        highlight.style.height = "auto";
        highlight.style.minHeight = stretchHeight;
        highlight.style.maxHeight = "none";
      }
      return;
    }
    const height = CODE_EDITOR_LINE_HEIGHT * CODE_EDITOR_VISIBLE_LINES + CODE_EDITOR_VERTICAL_PADDING;
    const fixedHeight = `${height}px`;
    if (input) {
      input.style.height = fixedHeight;
      input.style.minHeight = fixedHeight;
      input.style.maxHeight = fixedHeight;
    }
    if (surface) {
      surface.style.height = fixedHeight;
      surface.style.minHeight = fixedHeight;
      surface.style.maxHeight = fixedHeight;
    }
    if (highlight) {
      highlight.style.height = "auto";
      highlight.style.minHeight = fixedHeight;
      highlight.style.maxHeight = "none";
    }
  }

  function getBridgeApi() {
    return (window.zizPackages && window.zizPackages.core && window.zizPackages.core.bridge)
      || window.zizBridge
      || null;
  }

  function normalizeSuggestEntries(rawEntries) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const normalized = [];
    entries.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const index = String(entry.index || "").trim();
      if (!index) return;
      const rawSuggestWord = entry.suggest_word;
      const suggestWords = Array.isArray(rawSuggestWord)
        ? rawSuggestWord.map((item) => String(item || "").trim()).filter(Boolean)
        : [String(rawSuggestWord || "").trim()].filter(Boolean);
      if (!suggestWords.length) return;
      normalized.push({
        index,
        suggestWords
      });
    });
    return normalized;
  }

  function parseSuggestIndexYaml(text) {
    const parser = window.jsyaml;
    if (!parser || typeof parser.load !== "function") return [];
    try {
      const parsed = parser.load(String(text || "")) || [];
      if (Array.isArray(parsed)) return normalizeSuggestEntries(parsed);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
        return normalizeSuggestEntries(parsed.entries);
      }
    } catch (_) {
      return [];
    }
    return [];
  }

  async function fetchSuggestIndexFromStatic(connectorId) {
    const fileName = `suggest_index_${connectorId}.yml`;
    const candidates = [
      `/config/suggest_index/${fileName}`,
      `/static/config/suggest_index/${fileName}`,
      `./config/suggest_index/${fileName}`
    ];
    for (const path of candidates) {
      try {
        const response = await fetch(path, { cache: "no-store" });
        if (!response.ok) continue;
        const text = await response.text();
        const entries = parseSuggestIndexYaml(text);
        if (entries.length) return entries;
      } catch (_) {
        // try next
      }
    }
    return [];
  }

  async function loadSuggestEntriesForConnector(connectorId) {
    const normalizedConnector = String(connectorId || "").trim();
    if (!normalizedConnector) return [];
    if (SUGGEST_INDEX_CACHE.has(normalizedConnector)) {
      return SUGGEST_INDEX_CACHE.get(normalizedConnector) || [];
    }
    if (SUGGEST_INDEX_LOADING.has(normalizedConnector)) {
      return SUGGEST_INDEX_LOADING.get(normalizedConnector);
    }

    const promise = (async () => {
      const bridgeApi = getBridgeApi();
      if (bridgeApi?.available?.()) {
        try {
          const payload = await bridgeApi.call("app.getSuggestIndex", { connector: normalizedConnector });
          const entries = normalizeSuggestEntries(payload?.entries);
          SUGGEST_INDEX_CACHE.set(normalizedConnector, entries);
          return entries;
        } catch (_) {
          SUGGEST_INDEX_CACHE.set(normalizedConnector, []);
          return [];
        }
      }
      await ensureYamlParserLoaded().catch(() => null);
      const entries = await fetchSuggestIndexFromStatic(normalizedConnector);
      if (entries.length) {
        SUGGEST_INDEX_CACHE.set(normalizedConnector, entries);
      }
      return entries;
    })();

    SUGGEST_INDEX_LOADING.set(normalizedConnector, promise);
    try {
      return await promise;
    } finally {
      SUGGEST_INDEX_LOADING.delete(normalizedConnector);
    }
  }

  function buildItemsFromSuggestEntries(prefix, entries) {
    const loweredPrefix = String(prefix || "").toLowerCase();
    const items = [];
    const seen = new Set();
    (entries || []).forEach((entry) => {
      const index = String(entry?.index || "");
      if (!index.toLowerCase().startsWith(loweredPrefix)) return;
      const suggestWords = Array.isArray(entry?.suggestWords) ? entry.suggestWords : [];
      suggestWords.forEach((word) => {
        const text = String(word || "").trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        items.push({ label: text, insertText: text });
      });
    });
    return items;
  }

  function replaceRange(input, start, end, nextText) {
    const text = String(input.value || "");
    input.value = `${text.slice(0, start)}${nextText}${text.slice(end)}`;
    const cursor = start + nextText.length;
    input.selectionStart = cursor;
    input.selectionEnd = cursor;
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function getCompletionContext(input, variableNames, suggestEntries, options = {}) {
    const includeIndexSuggest = !!options.includeIndexSuggest;
    const text = String(input.value || "");
    const caret = input.selectionStart || 0;
    const left = text.slice(0, caret);

    const variableMatch = left.match(/\{\{\s*([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\u3005]*)$/);
    if (variableMatch) {
      const prefix = variableMatch[1] || "";
      const loweredPrefix = prefix.toLowerCase();
      const items = Array.from(new Set((variableNames || []).filter(Boolean)))
        .filter((name) => String(name || "").toLowerCase().startsWith(loweredPrefix))
        .map((name) => ({ label: `{{${name}}}`, insertText: `{{${name}}}` }));
      return {
        from: variableMatch.index,
        to: caret,
        items
      };
    }

    if (!includeIndexSuggest) return null;

    const wordMatch = left.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
    if (!wordMatch) return null;

    const prefix = wordMatch[1] || "";
    const items = buildItemsFromSuggestEntries(prefix, suggestEntries);
    if (!items.length) return null;
    return {
      from: caret - prefix.length,
      to: caret,
      items
    };
  }

  function createCompletionController({ input, host, variableNames, connectorId }) {
    const list = document.createElement("div");
    list.className = "suggest-list is-code-editor is-floating";
    document.body.appendChild(list);

    let currentContext = null;
    let currentItems = [];
    let activeIndex = 0;
    let positionFrameId = 0;
    let connectorSuggestEntries = [];
    const normalizedConnectorId = String(connectorId || "").trim();

    function hide() {
      if (positionFrameId) {
        window.cancelAnimationFrame(positionFrameId);
        positionFrameId = 0;
      }
      currentContext = null;
      currentItems = [];
      activeIndex = 0;
      list.style.display = "none";
      list.innerHTML = "";
    }

    function getCaretViewportRect() {
      const inputRect = input.getBoundingClientRect();
      const styles = window.getComputedStyle(input);
      const mirror = document.createElement("div");
      const mirrorStyle = mirror.style;
      mirrorStyle.position = "fixed";
      mirrorStyle.left = `${inputRect.left}px`;
      mirrorStyle.top = `${inputRect.top}px`;
      mirrorStyle.visibility = "hidden";
      mirrorStyle.pointerEvents = "none";
      mirrorStyle.whiteSpace = "pre-wrap";
      mirrorStyle.overflowWrap = "break-word";
      mirrorStyle.wordBreak = "break-word";
      mirrorStyle.boxSizing = styles.boxSizing;
      mirrorStyle.width = `${inputRect.width}px`;
      mirrorStyle.height = `${inputRect.height}px`;
      mirrorStyle.padding = styles.padding;
      mirrorStyle.border = styles.border;
      mirrorStyle.font = styles.font;
      mirrorStyle.lineHeight = styles.lineHeight;
      mirrorStyle.letterSpacing = styles.letterSpacing;
      mirrorStyle.textTransform = styles.textTransform;
      mirrorStyle.textIndent = styles.textIndent;
      mirrorStyle.textDecoration = styles.textDecoration;
      mirrorStyle.tabSize = styles.tabSize;
      mirrorStyle.MozTabSize = styles.MozTabSize;
      mirrorStyle.direction = styles.direction;
      mirrorStyle.textAlign = styles.textAlign;

      const caret = Number(input.selectionStart || 0);
      const text = String(input.value || "");
      const before = text.slice(0, caret);
      const after = text.slice(caret);
      mirror.textContent = before;
      const marker = document.createElement("span");
      marker.textContent = (after && after[0]) || " ";
      mirror.appendChild(marker);
      document.body.appendChild(mirror);

      const markerRect = marker.getBoundingClientRect();
      const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
      const rect = {
        left: markerRect.left - input.scrollLeft,
        top: markerRect.top - input.scrollTop,
        height: Number.isFinite(markerRect.height) && markerRect.height > 0 ? markerRect.height : lineHeight
      };
      mirror.remove();
      return rect;
    }

    function positionListNow() {
      if (list.style.display !== "block") return;
      const viewportPadding = 8;
      const anchor = (() => {
        try {
          return getCaretViewportRect();
        } catch (_) {
          const rect = host.getBoundingClientRect();
          return { left: rect.left + 8, top: rect.bottom - 8, height: 20 };
        }
      })();
      const listRect = list.getBoundingClientRect();
      const maxLeft = Math.max(viewportPadding, window.innerWidth - listRect.width - viewportPadding);
      const maxTop = Math.max(viewportPadding, window.innerHeight - listRect.height - viewportPadding);
      const left = Math.min(Math.max(viewportPadding, anchor.left), maxLeft);
      let top = anchor.top + Math.max(16, anchor.height) + 4;
      if (top > maxTop) {
        top = Math.max(viewportPadding, anchor.top - listRect.height - 4);
      }
      list.style.left = `${left}px`;
      list.style.top = `${top}px`;
    }

    function positionList() {
      if (positionFrameId) return;
      positionFrameId = window.requestAnimationFrame(() => {
        positionFrameId = 0;
        positionListNow();
      });
    }

    function applyItem(index = activeIndex) {
      const item = currentItems[index];
      if (!item || !currentContext) return false;
      replaceRange(input, currentContext.from, currentContext.to, item.insertText);
      hide();
      return true;
    }

    function renderItems() {
      list.innerHTML = "";
      currentItems.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = `suggest-item${index === activeIndex ? " is-active" : ""}`;
        row.textContent = item.label;
        row.onmousedown = (event) => event.preventDefault();
        row.onclick = () => applyItem(index);
        list.appendChild(row);
      });
      list.style.display = currentItems.length ? "block" : "none";
      positionList();
    }

    function refresh(options = {}) {
      const nextContext = getCompletionContext(
        input,
        variableNames,
        connectorSuggestEntries,
        { includeIndexSuggest: !!options.includeIndexSuggest }
      );
      if (!nextContext || !Array.isArray(nextContext.items) || !nextContext.items.length) {
        hide();
        return false;
      }
      currentContext = nextContext;
      currentItems = nextContext.items;
      activeIndex = 0;
      renderItems();
      return true;
    }

    function moveActive(delta) {
      if (!currentItems.length) return;
      activeIndex = (activeIndex + delta + currentItems.length) % currentItems.length;
      renderItems();
    }

    function scheduleRefresh() {
      window.requestAnimationFrame(() => {
        refresh({ includeIndexSuggest: false });
      });
    }

    input.addEventListener("input", scheduleRefresh);
    input.addEventListener("scroll", positionList);
    input.addEventListener("keyup", positionList);
    input.addEventListener("click", positionList);
    window.addEventListener("resize", positionList);
    window.addEventListener("scroll", positionList, true);
    input.addEventListener("blur", () => setTimeout(hide, 150));
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && currentItems.length) {
        event.preventDefault();
        moveActive(1);
        return;
      }
      if (event.key === "ArrowUp" && currentItems.length) {
        event.preventDefault();
        moveActive(-1);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && currentItems.length) {
        event.preventDefault();
        applyItem();
        return;
      }
      if (event.key === "Escape" && currentItems.length) {
        event.preventDefault();
        hide();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        replaceRange(input, start, end, INDENT_TEXT);
      }
    });

    const reloadSuggestEntries = () => loadSuggestEntriesForConnector(connectorId).then((entries) => {
      connectorSuggestEntries = Array.isArray(entries) ? entries : [];
      scheduleRefresh();
    }).catch(() => {
      connectorSuggestEntries = [];
    });
    reloadSuggestEntries();

    const onBridgeReady = () => {
      if (connectorSuggestEntries.length) return;
      reloadSuggestEntries();
    };
    window.addEventListener("ziz:bridge-ready", onBridgeReady);

    return { hide };
  }

  function createHighlightController({ input, wrapper, language }) {
    const surface = document.createElement("div");
    surface.className = "code-editor-surface";
    const highlight = document.createElement("pre");
    highlight.className = "code-editor-highlight";
    surface.appendChild(highlight);
    wrapper.insertBefore(surface, input);

    function render() {
      const api = getCodeHighlightApi();
      const inputStyles = window.getComputedStyle(input);
      const wrapperStyles = window.getComputedStyle(wrapper);
      const gutterWidth = Number.parseFloat(wrapperStyles.getPropertyValue("--code-editor-gutter-width") || "0") || 0;
      const inputPaddingLeft = Number.parseFloat(inputStyles.paddingLeft || "0") || 0;
      const highlightPaddingLeft = Math.max(0, inputPaddingLeft - gutterWidth);
      highlight.style.fontFamily = inputStyles.fontFamily;
      highlight.style.fontSize = inputStyles.fontSize;
      highlight.style.lineHeight = inputStyles.lineHeight;
      highlight.style.paddingTop = inputStyles.paddingTop;
      highlight.style.paddingRight = inputStyles.paddingRight;
      highlight.style.paddingBottom = inputStyles.paddingBottom;
      highlight.style.paddingLeft = `${highlightPaddingLeft}px`;
      if (typeof api.renderHighlightedHtml === "function") {
        surface.hidden = false;
        highlight.innerHTML = api.renderHighlightedHtml(input.value, language);
        wrapper.classList.add("is-code-editor-ready");
        return;
      }
      surface.hidden = true;
      wrapper.classList.remove("is-code-editor-ready");
    }

    function syncScroll() {
      surface.scrollTop = input.scrollTop;
      surface.scrollLeft = input.scrollLeft;
    }

    function bindWheelScrollSync() {
      if (!wrapper || typeof wrapper.addEventListener !== "function") return;
      wrapper.addEventListener("wheel", (event) => {
        if (!input) return;
        const deltaY = Number(event.deltaY || 0);
        const deltaX = Number(event.deltaX || 0);
        if (!deltaY && !deltaX) return;
        const prevTop = input.scrollTop;
        const prevLeft = input.scrollLeft;
        if (deltaY) input.scrollTop += deltaY;
        if (deltaX) input.scrollLeft += deltaX;
        const moved = input.scrollTop !== prevTop || input.scrollLeft !== prevLeft;
        if (!moved) return;
        syncScroll();
        input.dispatchEvent(new Event("scroll", { bubbles: false }));
        event.preventDefault();
      }, { passive: false });
    }

    input.addEventListener("input", render);
    input.addEventListener("scroll", syncScroll);
    bindWheelScrollSync();
    render();
    syncScroll();

    return { surface, highlight, render, syncScroll };
  }

  function createLineNumberController({ input, wrapper }) {
    const gutter = document.createElement("div");
    gutter.className = "code-editor-gutter";
    gutter.style.setProperty("--code-editor-gutter-digits", String(CODE_EDITOR_GUTTER_DIGITS));
    const inner = document.createElement("pre");
    inner.className = "code-editor-gutter-lines";
    gutter.appendChild(inner);
    wrapper.insertBefore(gutter, wrapper.firstChild || null);

    const lineWrapProbe = document.createElement("div");
    lineWrapProbe.style.position = "fixed";
    lineWrapProbe.style.left = "-99999px";
    lineWrapProbe.style.top = "0";
    lineWrapProbe.style.visibility = "hidden";
    lineWrapProbe.style.pointerEvents = "none";
    lineWrapProbe.style.whiteSpace = "pre-wrap";
    lineWrapProbe.style.wordBreak = "break-word";
    lineWrapProbe.style.boxSizing = "content-box";
    lineWrapProbe.style.padding = "0";
    lineWrapProbe.style.border = "0";
    lineWrapProbe.style.margin = "0";
    lineWrapProbe.style.overflow = "visible";
    document.body.appendChild(lineWrapProbe);

    function render() {
      const text = String(input.value || "");
      const logicalLines = text.split(/\r\n|\r|\n/);
      const lines = [];
      const inputStyles = window.getComputedStyle(input);
      const lineHeight = Math.max(1, Number.parseFloat(inputStyles.lineHeight || "0") || CODE_EDITOR_LINE_HEIGHT);
      const inputPaddingLeft = Number.parseFloat(inputStyles.paddingLeft || "0") || 0;
      const inputPaddingRight = Number.parseFloat(inputStyles.paddingRight || "0") || 0;
      const availableWidth = Math.max(1, (input.clientWidth || 1) - inputPaddingLeft - inputPaddingRight);
      lineWrapProbe.style.width = `${availableWidth}px`;
      lineWrapProbe.style.fontFamily = inputStyles.fontFamily;
      lineWrapProbe.style.fontSize = inputStyles.fontSize;
      lineWrapProbe.style.fontWeight = inputStyles.fontWeight;
      lineWrapProbe.style.fontStyle = inputStyles.fontStyle;
      lineWrapProbe.style.lineHeight = inputStyles.lineHeight;
      lineWrapProbe.style.letterSpacing = inputStyles.letterSpacing;
      lineWrapProbe.style.textTransform = inputStyles.textTransform;
      lineWrapProbe.style.tabSize = inputStyles.tabSize;
      lineWrapProbe.style.MozTabSize = inputStyles.MozTabSize;

      for (let i = 0; i < logicalLines.length; i += 1) {
        const logicalLineNumber = i + 1;
        const rawLine = logicalLines[i] ?? "";
        lineWrapProbe.textContent = rawLine || " ";
        const probeHeight = lineWrapProbe.getBoundingClientRect().height || lineHeight;
        const visualRows = Math.max(1, Math.round(probeHeight / lineHeight));
        lines.push(String(logicalLineNumber).padStart(CODE_EDITOR_GUTTER_DIGITS, " "));
        for (let row = 1; row < visualRows; row += 1) {
          lines.push("");
        }
      }
      inner.textContent = lines.join("\n");
    }

    function syncTypography() {
      const inputStyles = window.getComputedStyle(input);
      inner.style.fontFamily = inputStyles.fontFamily;
      inner.style.fontSize = inputStyles.fontSize;
      inner.style.lineHeight = inputStyles.lineHeight;
      inner.style.paddingTop = inputStyles.paddingTop;
      inner.style.paddingBottom = inputStyles.paddingBottom;
    }

    function syncScroll() {
      inner.style.transform = `translateY(${-input.scrollTop}px)`;
    }

    input.addEventListener("input", render);
    input.addEventListener("scroll", syncScroll);
    window.addEventListener("resize", () => {
      syncTypography();
      render();
    });
    syncTypography();
    render();
    syncScroll();
    return { gutter, inner, render, syncScroll };
  }

  function mountCodeEditor({ input, value, language, connectorId, variableNames, suggestionHost, onCommitChanged }) {
    if (!input || !suggestionHost) {
      return Promise.reject(new Error("Textarea host is not available"));
    }

    input.value = value || "";
    input.dataset.language = String(language || "");
    input.spellcheck = false;
    input.setAttribute("spellcheck", "false");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("aria-autocomplete", "none");
    input.setAttribute("data-gramm", "false");
    input.setAttribute("data-gramm_editor", "false");
    input.setAttribute("data-enable-grammarly", "false");
    input.autocapitalize = "off";
    input.autocomplete = "off";
    input.classList.add("is-enhanced-code-editor");

    return ensureCodeHighlightLoaded()
      .catch(() => null)
      .then(() => {
        const { surface, highlight } = createHighlightController({
          input,
          wrapper: suggestionHost,
          language
        });
        const lineNumbers = createLineNumberController({
          input,
          wrapper: suggestionHost
        });
        const syncEditorHeight = () => applyEditorHeight(input, surface, highlight, suggestionHost);
        syncEditorHeight();
        window.requestAnimationFrame(syncEditorHeight);
        window.setTimeout(syncEditorHeight, 0);
        window.addEventListener("resize", syncEditorHeight);

        createCompletionController({
          input,
          host: suggestionHost,
          connectorId,
          variableNames
        });

        if (typeof onCommitChanged === "function") {
          input.addEventListener("blur", () => {
            onCommitChanged(String(input.value || ""));
          });
        }

        return { input, surface, highlight, lineNumbers };
      });
  }

  const codeEditors = { mountCodeEditor };
  window.codeEditors = codeEditors;
  const packages = window.zizPackages = window.zizPackages || {};
  const core = packages.core = packages.core || {};
  core.codeEditors = codeEditors;
})();
