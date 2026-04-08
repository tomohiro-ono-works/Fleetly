(function () {
  const packages = window.zizPackages || {};
  const uiNode = (packages.ui && packages.ui.node) || {};
  const sqlbilder = packages.sqlbilder || {};
  const normalizeSteps = uiNode.normalizeSteps;
  const renderFlowChart = uiNode.renderFlowChart;
  const renderNodeDetail = uiNode.renderNodeDetail;
  const destroyFlowCanvas = uiNode.destroyFlowCanvas;

  function formatRecentTimestamp(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return text;
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }

  function createHomeItem(item, kind, onHomeAction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "home-screen__item";
    button.addEventListener("click", () => {
      if (typeof onHomeAction === "function") {
        onHomeAction({ type: "open-flow", kind, item });
      }
    });

    const title = document.createElement("div");
    title.className = "home-screen__item-title";
    title.textContent = String(item?.display_name || "");
    button.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "home-screen__item-hint";
    hint.textContent = `(${String(item?.display_hint || "") || "-"})`;
    button.appendChild(hint);

    if (kind === "recent") {
      const timestamp = formatRecentTimestamp(item?.opened_at);
      if (timestamp) {
        const meta = document.createElement("div");
        meta.className = "home-screen__item-meta";
        meta.textContent = `最終利用: ${timestamp}`;
        button.appendChild(meta);
      }
    }
    return button;
  }

  function createHomeSection({ title, items, emptyMessage, kind, onHomeAction }) {
    const section = document.createElement("section");
    section.className = "home-screen__section";

    const heading = document.createElement("h2");
    heading.className = "home-screen__section-title";
    heading.textContent = title;
    section.appendChild(heading);

    const body = document.createElement("div");
    body.className = "home-screen__section-body";

    if (!Array.isArray(items) || !items.length) {
      const empty = document.createElement("div");
      empty.className = "home-screen__empty";
      empty.textContent = emptyMessage;
      body.appendChild(empty);
    } else {
      items.forEach((item) => body.appendChild(createHomeItem(item, kind, onHomeAction)));
    }

    section.appendChild(body);
    return section;
  }

  function renderHomeScreen({ flowRoot, detailRoot, homeViewModel, onHomeAction }) {
    if (detailRoot) detailRoot.innerHTML = "";
    if (typeof destroyFlowCanvas === "function") {
      destroyFlowCanvas(flowRoot);
    }
    flowRoot.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "home-screen";

    const header = document.createElement("div");
    header.className = "home-screen__header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "home-screen__title-wrap";
    const title = document.createElement("h1");
    title.className = "home-screen__title";
    title.textContent = "トップ画面";
    const subtitle = document.createElement("div");
    subtitle.className = "home-screen__subtitle";
    subtitle.textContent = "最近使ったファイルやテンプレートから開始できます。";
    titleWrap.appendChild(title);
    titleWrap.appendChild(subtitle);
    header.appendChild(titleWrap);

    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "home-screen__new-btn";
    newButton.textContent = "新規作成";
    newButton.addEventListener("click", () => {
      if (typeof onHomeAction === "function") onHomeAction({ type: "dismiss-home" });
    });
    header.appendChild(newButton);
    shell.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "home-screen__grid";
    grid.appendChild(createHomeSection({
      title: "最近使ったファイル",
      items: (homeViewModel?.recentFiles || []).slice(0, 10),
      emptyMessage: "ファイルがありません。",
      kind: "recent",
      onHomeAction
    }));
    grid.appendChild(createHomeSection({
      title: "テンプレートから作成する",
      items: homeViewModel?.templates || [],
      emptyMessage: "ファイルがありません。",
      kind: "template",
      onHomeAction
    }));
    shell.appendChild(grid);

    flowRoot.appendChild(shell);
  }

  function renderApp({ flowRoot, detailRoot, state, config, onStateChanged, homeViewModel, onHomeAction }) {
    if (!flowRoot || !detailRoot) return;

    if (homeViewModel?.visible) {
      renderHomeScreen({ flowRoot, detailRoot, homeViewModel, onHomeAction });
      return;
    }

    if (String(state?.appMode || "") === "query-builder") {
      if (detailRoot) detailRoot.innerHTML = "";
      if (typeof destroyFlowCanvas === "function") {
        destroyFlowCanvas(flowRoot);
      }
      flowRoot.innerHTML = "";
      if (sqlbilder.page && typeof sqlbilder.page.mount === "function") {
        sqlbilder.page.mount(flowRoot, state);
      }
      return;
    }

    if (typeof normalizeSteps === "function") {
      normalizeSteps(state);
    }

    if (typeof renderFlowChart === "function") {
      renderFlowChart({ root: flowRoot, state, config, onStateChanged });
    }

    if (typeof renderNodeDetail === "function") {
      renderNodeDetail({ root: detailRoot, state, config, onStateChanged });
    }
  }

  const rendererApi = { renderApp };
  window.renderer = rendererApi;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.renderer = rendererApi;
})();
