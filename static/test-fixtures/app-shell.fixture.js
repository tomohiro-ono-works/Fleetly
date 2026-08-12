(function () {
  const events = [];
  const eventLog = document.getElementById("eventLog");
  const cleanupState = { count: 0 };

  function node(tagName, text, id) {
    const element = document.createElement(tagName);
    element.textContent = text;
    if (id) element.id = id;
    return element;
  }

  function record(type, payload) {
    events.push({ type, payload });
    eventLog.value = JSON.stringify(events);
  }

  const shell = window.zizPackages.uiShell.createAppShell({
    root: document.getElementById("primaryShell"),
    layout: {
      sidebarVisible: true,
      rightPanelVisible: true,
      bottomPanelVisible: true,
      sidebarWidth: 240,
      rightPanelWidth: 300,
      bottomPanelHeight: 180,
      activeActivityId: "files"
    },
    activities: [
      { id: "files", label: "Files" },
      { id: "search", label: "Search", badge: 2 }
    ],
    commands: [
      { id: "run", label: "Run", region: "topbar" },
      { id: "refresh", label: "Refresh", region: "panel" }
    ],
    regions: {
      topbar: node("strong", "Fixture"),
      sidebar: node("div", "Sidebar content", "fixtureSidebar"),
      main: node("main", "Main content", "fixtureMain"),
      rightPanel: node("div", "Right content", "fixtureRight"),
      bottomPanel: node("div", "Bottom content", "fixtureBottom")
    }
  });

  [
    "activity:select",
    "tab:activate",
    "tab:close-request",
    "command:execute",
    "layout:change",
    "region:focus"
  ].forEach((eventName) => shell.on(eventName, (payload) => record(eventName, payload)));

  shell.setTabs([
    { id: "editor-a", title: "Editor A", dirty: true },
    { id: "editor-b", title: "Editor B" }
  ], "editor-a");
  shell.setStatus([
    { id: "mode", label: "Mode", value: "Ready" }
  ]);
  shell.mount();

  const secondary = window.zizPackages.uiShell.createAppShell({
    root: document.getElementById("secondaryShell"),
    regions: { main: node("main", "Secondary content", "secondaryMain") }
  });
  secondary.mount();

  window.appShellFixture = Object.freeze({
    shell,
    secondary,
    events,
    cleanupState,
    installDisposableRegion() {
      shell.setRegion("main", {
        mount(host) {
          host.appendChild(node("div", "Disposable", "disposableRegion"));
        },
        destroy() {
          cleanupState.count += 1;
        }
      });
    }
  });
})();
