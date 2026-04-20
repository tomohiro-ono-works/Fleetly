(function () {
  function getPackages() {
    return window.zizPackages || {};
  }

  function getUiNodeApi() {
    const packages = getPackages();
    return (packages.ui && packages.ui.node) || {};
  }

  function getUiNodeLoader() {
    const packages = getPackages();
    return (packages.ui && packages.ui.nodeLoader) || {};
  }

  function getSqlbilderApi() {
    const packages = getPackages();
    return packages.sqlbilder || {};
  }

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

  function createHomeCreateButton({ title, hint, actionType, onHomeAction }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "home-screen__create-btn";
    button.addEventListener("click", () => {
      if (typeof onHomeAction === "function") onHomeAction({ type: actionType });
    });

    const titleEl = document.createElement("div");
    titleEl.className = "home-screen__create-btn-title";
    titleEl.textContent = title;
    button.appendChild(titleEl);

    const hintEl = document.createElement("div");
    hintEl.className = "home-screen__create-btn-hint";
    hintEl.textContent = hint;
    button.appendChild(hintEl);
    return button;
  }

  function renderHomeScreen({ flowRoot, detailRoot, detailBottomRoot, homeViewModel, onHomeAction }) {
    if (detailRoot) detailRoot.innerHTML = "";
    if (detailBottomRoot && detailBottomRoot !== detailRoot) detailBottomRoot.innerHTML = "";

    const uiNode = getUiNodeApi();
    if (typeof uiNode.destroyFlowCanvas === "function") {
      uiNode.destroyFlowCanvas(flowRoot);
    }
    flowRoot.innerHTML = "";

    const shell = document.createElement("div");
    shell.className = "home-screen";

    const hero = document.createElement("section");
    hero.className = "home-screen__hero";
    const title = document.createElement("h1");
    title.className = "home-screen__title";
    const titleText = document.createElement("span");
    titleText.textContent = "ziz ai craft";
    const titleIcon = document.createElement("img");
    titleIcon.className = "home-screen__title-icon";
    titleIcon.src = "./icons/ziz.svg";
    titleIcon.alt = "";
    titleIcon.setAttribute("aria-hidden", "true");
    title.appendChild(titleText);
    title.appendChild(titleIcon);
    const subtitle = document.createElement("div");
    subtitle.className = "home-screen__subtitle";
    subtitle.textContent = "自由自在の業務エージェントビルダーツール";
    const divider = document.createElement("div");
    divider.className = "home-screen__divider";
    hero.appendChild(title);
    hero.appendChild(subtitle);
    hero.appendChild(divider);
    shell.appendChild(hero);

    const createSection = document.createElement("section");
    createSection.className = "home-screen__section home-screen__section--create";
    const createHeading = document.createElement("h2");
    createHeading.className = "home-screen__section-title";
    createHeading.textContent = "作成する";
    createSection.appendChild(createHeading);
    const createBody = document.createElement("div");
    createBody.className = "home-screen__create-actions";
    createBody.appendChild(createHomeCreateButton({
      title: "ワークフローを新規で作る",
      hint: "データフロー画面を開きます",
      actionType: "create-flow",
      onHomeAction
    }));
    createBody.appendChild(createHomeCreateButton({
      title: "SQLを新規で作る",
      hint: "クエリビルダー画面を開きます",
      actionType: "create-sql",
      onHomeAction
    }));
    createSection.appendChild(createBody);
    shell.appendChild(createSection);

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

  function renderNodeShellLoading(flowRoot) {
    flowRoot.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "home-screen__empty";
    loading.textContent = "フローエディタを読み込んでいます。";
    flowRoot.appendChild(loading);
  }

  function ensureNodeRuntime(args) {
    const loader = getUiNodeLoader();
    if (typeof loader.ensureLoaded !== "function") return false;

    if (args.flowRoot.__uiNodeLoadingPromise) {
      renderNodeShellLoading(args.flowRoot);
      return true;
    }

    renderNodeShellLoading(args.flowRoot);
    if (args.detailRoot) args.detailRoot.innerHTML = "";
    if (args.detailBottomRoot && args.detailBottomRoot !== args.detailRoot) {
      args.detailBottomRoot.innerHTML = "";
    }
    args.flowRoot.__uiNodeLoadingPromise = loader.ensureLoaded()
      .then(() => {
        args.flowRoot.__uiNodeLoadingPromise = null;
        renderApp(args);
      })
      .catch((error) => {
        args.flowRoot.__uiNodeLoadingPromise = null;
        console.error("ui.node load failed", error);
        renderNodeShellLoading(args.flowRoot);
        args.flowRoot.lastElementChild.textContent = "フローエディタの読み込みに失敗しました。";
      });
    return true;
  }

  function renderApp(args) {
    const { flowRoot, detailRoot, detailBottomRoot, rightPanelTab, state, config, onStateChanged, homeViewModel, onHomeAction } = args;
    if (!flowRoot || (!detailRoot && !detailBottomRoot)) return;

    if (homeViewModel?.visible) {
      renderHomeScreen({ flowRoot, detailRoot, detailBottomRoot, homeViewModel, onHomeAction });
      return;
    }

    if (String(state?.appMode || "") === "query-builder") {
      const uiNode = getUiNodeApi();
      if (detailRoot) detailRoot.innerHTML = "";
      if (detailBottomRoot && detailBottomRoot !== detailRoot) detailBottomRoot.innerHTML = "";
      if (typeof uiNode.destroyFlowCanvas === "function") {
        uiNode.destroyFlowCanvas(flowRoot);
      }
      flowRoot.innerHTML = "";
      const sqlbilder = getSqlbilderApi();
      if (sqlbilder.page && typeof sqlbilder.page.mount === "function") {
        sqlbilder.page.mount(flowRoot, state);
      }
      return;
    }

    const uiNode = getUiNodeApi();
    if (typeof uiNode.renderFlowChart !== "function" || typeof uiNode.renderNodeDetail !== "function") {
      if (ensureNodeRuntime(args)) return;
    }

    if (typeof uiNode.normalizeSteps === "function") {
      uiNode.normalizeSteps(state);
    }

    if (typeof uiNode.renderFlowChart === "function") {
      uiNode.renderFlowChart({ root: flowRoot, state, config, onStateChanged });
    }

    if (typeof uiNode.renderNodeDetail === "function") {
      const splitDetail = !!detailRoot && !!detailBottomRoot && detailBottomRoot !== detailRoot;
      if (splitDetail) {
        const activeRightPanel = ["detail", "yaml", "variables", "log"].includes(String(rightPanelTab || ""))
          ? String(rightPanelTab || "")
          : "detail";
        uiNode.renderNodeDetail({
          root: detailRoot,
          state,
          config,
          onStateChanged,
          tabKeys: ["detail", "yaml", "variables", "log"],
          defaultTab: "detail",
          includePanelRunAction: false,
          hideTabs: true,
          forcedActiveTab: activeRightPanel
        });
        uiNode.renderNodeDetail({
          root: detailBottomRoot,
          state,
          config,
          onStateChanged,
          tabKeys: ["data"],
          defaultTab: "data",
          includePanelRunAction: false,
          hideTabs: true,
          forcedActiveTab: "data"
        });
        return;
      }
      uiNode.renderNodeDetail({ root: detailRoot || detailBottomRoot, state, config, onStateChanged });
    }
  }

  const rendererApi = { renderApp };
  window.renderer = rendererApi;
  const packagesOut = window.zizPackages = window.zizPackages || {};
  const uiOut = packagesOut.ui = packagesOut.ui || {};
  uiOut.renderer = rendererApi;
})();
