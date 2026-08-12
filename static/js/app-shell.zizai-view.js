(function (root) {
  const packages = root.zizPackages = root.zizPackages || {};
  const parts = packages.__zizaiShellAdapter = packages.__zizaiShellAdapter || {};

  function appendIcon(button, src, wrapperClass) {
    const wrapper = document.createElement("span");
    wrapper.className = wrapperClass;
    const image = document.createElement("img");
    image.src = src;
    image.alt = "";
    wrapper.appendChild(image);
    button.appendChild(wrapper);
  }

  function createSidebarItem({ action, label, icon, navUrl = "", current = false, className = "" }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `sidebar-item${className ? ` ${className}` : ""}`;
    button.dataset.sidebarAction = action;
    button.title = label;
    if (navUrl) button.dataset.navUrl = navUrl;
    if (current) {
      button.classList.add("is-current");
      button.setAttribute("aria-current", "page");
    }
    appendIcon(button, icon, "sidebar-item-icon");
    const text = document.createElement("span");
    text.className = "sidebar-item-label";
    text.textContent = label;
    button.appendChild(text);
    return button;
  }

  function createNavigation({ page, urls }) {
    const content = document.createElement("div");
    content.className = "ziz-app-activity-content";

    const top = document.createElement("div");
    top.className = "sidebar-top";
    const home = document.createElement("button");
    home.id = "sidebarToggle";
    home.type = "button";
    home.className = "sidebar-toggle sidebar-home-btn";
    home.title = "トップ画面へ戻る";
    home.setAttribute("aria-label", "トップ画面へ戻る");
    home.setAttribute("aria-expanded", "false");
    home.setAttribute("aria-controls", "sidebarNav");
    appendIcon(home, "./icons/ziz_one.svg", "sidebar-toggle-icon");
    top.appendChild(home);

    const navigation = document.createElement("nav");
    navigation.id = "sidebarNav";
    navigation.className = "sidebar-nav";
    navigation.append(
      createSidebarItem({
        action: "project-select",
        label: "プロジェクト選択",
        icon: "./icons/launch_project.svg"
      }),
      createSidebarItem({
        action: "explorer",
        label: "エクスプローラー",
        icon: "./icons/folder_open.svg"
      })
    );

    const bottom = document.createElement("div");
    bottom.className = "sidebar-bottom";
    bottom.appendChild(createSidebarItem({
      action: "settings",
      label: "設定",
      icon: "./icons/settings.svg",
      navUrl: urls.settings,
      current: page === "settings",
      className: "sidebar-item-settings"
    }));
    content.append(top, navigation, bottom);
    return content;
  }

  function createWindowButton(id, label, icon, className = "") {
    const button = document.createElement("button");
    button.id = id;
    button.type = "button";
    button.className = `header-action-btn header-icon-btn${className ? ` ${className}` : ""}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    button.appendChild(image);
    return button;
  }

  function createWindowActions() {
    const actions = document.createElement("div");
    actions.id = "shellWindowActions";
    actions.className = "shell-window-actions";
    actions.setAttribute("aria-label", "ウィンドウ操作");
    actions.append(
      createWindowButton("btnDiagnostics", "診断", "./icons/healthcheck.svg"),
      createWindowButton("btnWindowMinimize", "最小化", "./icons/small.svg"),
      createWindowButton("btnWindowMaximize", "拡大", "./icons/middle.svg", "window-control-btn"),
      createWindowButton("btnWindowClose", "閉じる", "./icons/closel.svg", "window-control-btn is-close")
    );
    return actions;
  }

  function createRightSidebar() {
    const sidebar = document.createElement("aside");
    sidebar.id = "rightSidebar";
    sidebar.className = "right-sidebar";
    sidebar.setAttribute("aria-label", "ノード詳細");

    const resizer = document.createElement("div");
    resizer.id = "rightSidebarResizer";
    resizer.className = "right-sidebar-resizer";
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-orientation", "vertical");
    resizer.setAttribute("aria-label", "右サイドバー幅");

    const content = document.createElement("div");
    content.id = "rightSidebarContent";
    content.className = "right-sidebar-content";
    const detail = document.createElement("div");
    detail.id = "nodeDetail";
    content.appendChild(detail);
    sidebar.append(resizer, content);
    return sidebar;
  }

  function createAppContent(main, includeRightSidebar) {
    const content = document.createElement("div");
    content.className = "ziz-app-content";
    content.appendChild(main);
    if (includeRightSidebar) {
      content.classList.add("ziz-app-content--with-right-sidebar");
      content.appendChild(createRightSidebar());
    }
    return content;
  }

  parts.createNavigation = createNavigation;
  parts.createWindowActions = createWindowActions;
  parts.createAppContent = createAppContent;
})(window);
