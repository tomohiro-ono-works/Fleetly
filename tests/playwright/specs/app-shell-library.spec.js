const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/static/test-fixtures/app-shell.html");
  await expect(page.locator("#fixtureMain")).toBeVisible();
});

test("AppShell mounts all configured regions without a legacy global", async ({ page }) => {
  await expect(page.locator("#primaryShell > .zui-shell")).toBeVisible();
  await expect(page.locator("#fixtureSidebar")).toHaveText("Sidebar content");
  await expect(page.locator("#fixtureRight")).toHaveText("Right content");
  await expect(page.locator("#fixtureBottom")).toHaveText("Bottom content");
  await expect(page.locator('[data-status-id="mode"]')).toHaveText("Mode: Ready");
  await expect(page.locator("#secondaryMain")).toBeVisible();

  const globals = await page.evaluate(() => ({
    hasFactory: typeof window.zizPackages?.uiShell?.createAppShell === "function",
    hasLegacyGlobal: Object.prototype.hasOwnProperty.call(window, "zizShell")
  }));
  expect(globals).toEqual({ hasFactory: true, hasLegacyGlobal: false });
});

test("activity, command, tab activation and close are emitted as requests", async ({ page }) => {
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Run" }).click();
  await page.getByRole("button", { name: "Editor B", exact: true }).click();
  await page.getByRole("button", { name: "Close: Editor B" }).click();

  const result = await page.evaluate(() => ({
    events: window.appShellFixture.events,
    tabCount: document.querySelectorAll("#primaryShell .zui-shell__tab").length
  }));
  expect(result.events).toEqual(expect.arrayContaining([
    { type: "activity:select", payload: { activityId: "search" } },
    { type: "command:execute", payload: { commandId: "run", source: "topbar" } },
    { type: "tab:activate", payload: { tabId: "editor-b" } },
    { type: "tab:close-request", payload: { tabId: "editor-b" } }
  ]));
  expect(result.tabCount).toBe(2);
});

test("tab and layout APIs update only the target instance", async ({ page }) => {
  const result = await page.evaluate(() => {
    const { shell } = window.appShellFixture;
    shell.updateTab("editor-a", { title: "Updated", dirty: false });
    shell.openTab({ id: "editor-c", title: "Editor C" });
    shell.setLayout({
      sidebarVisible: false,
      rightPanelVisible: false,
      bottomPanelVisible: false
    });
    return shell.getLayout();
  });

  expect(result).toMatchObject({
    sidebarVisible: false,
    rightPanelVisible: false,
    bottomPanelVisible: false
  });
  await expect(page.getByRole("button", { name: "Updated", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Editor C", exact: true })).toBeVisible();
  await expect(page.locator("#fixtureSidebar")).toBeHidden();
  await expect(page.locator("#secondaryMain")).toBeVisible();
});

test("region adapters are disposed and destroy removes only its mount", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.appShellFixture;
    fixture.installDisposableRegion();
    fixture.shell.setRegion("main", document.createElement("main"));
    const afterReplace = fixture.cleanupState.count;
    fixture.secondary.destroy();
    return {
      afterReplace,
      primaryMounted: !!document.querySelector("#primaryShell .zui-shell"),
      secondaryMounted: !!document.querySelector("#secondaryShell .zui-shell")
    };
  });

  expect(result).toEqual({
    afterReplace: 1,
    primaryMounted: true,
    secondaryMounted: false
  });
});

test("sidebar resize updates the layout snapshot through a layout event", async ({ page }) => {
  const resizer = page.locator("#primaryShell .zui-shell__resizer--sidebar");
  const bounds = await resizer.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds.x + (bounds.width / 2), bounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 42, bounds.y + 30);
  await page.mouse.up();

  const result = await page.evaluate(() => ({
    layout: window.appShellFixture.shell.getLayout(),
    layoutEvents: window.appShellFixture.events.filter((event) => event.type === "layout:change")
  }));
  expect(result.layout.sidebarWidth).toBeGreaterThan(240);
  expect(result.layoutEvents.length).toBeGreaterThan(0);
});

test("focusRegion moves focus and emits its region name", async ({ page }) => {
  const result = await page.evaluate(() => {
    const fixture = window.appShellFixture;
    const focused = fixture.shell.focusRegion("main");
    return {
      focused,
      region: document.activeElement?.dataset?.shellRegion || "",
      event: fixture.events.find((item) => item.type === "region:focus") || null
    };
  });
  expect(result).toEqual({
    focused: true,
    region: "main",
    event: { type: "region:focus", payload: { region: "main" } }
  });
});
