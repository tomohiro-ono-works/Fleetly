const { test, expect } = require("@playwright/test");

test("zizai adapter exposes the instance package without the legacy global", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/static/dataflow.html");
  await expect(page.locator(".zui-shell")).toBeVisible();

  const result = await page.evaluate(() => ({
    hasInstance: typeof window.zizPackages?.app?.shell?.instance?.getLayout === "function",
    hasLegacyGlobal: Object.prototype.hasOwnProperty.call(window, "zizShell")
  }));
  expect(result).toEqual({ hasInstance: true, hasLegacyGlobal: false });
  expect(pageErrors).toEqual([]);
});

test("zizai adapter keeps sidebar selection callbacks connected", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/static/dataflow.html");

  const explorer = page.locator('[data-sidebar-action="explorer"]').first();
  await explorer.click();
  await page.waitForTimeout(100);
  expect(pageErrors).toEqual([]);
  await expect(explorer).toHaveClass(/is-current/);
});

test("home shell fits a mobile viewport without covering the title", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/static/home.html");
  await expect(page.locator(".home-screen__title")).toBeVisible();

  const metrics = await page.evaluate(() => {
    const title = document.querySelector(".home-screen__title")?.getBoundingClientRect();
    const actions = document.querySelector(".shell-window-actions")?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      titleTop: title?.top || 0,
      actionsBottom: actions?.bottom || 0
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.titleTop).toBeGreaterThanOrEqual(metrics.actionsBottom);
});

test("embedded dataflow keeps app navigation out and mounts its detail panel", async ({ page }) => {
  await page.goto("/static/dataflow.html?mode=dataflow&embedded=1");
  await expect(page.locator(".zui-shell")).toBeVisible();
  await expect(page.locator(".zui-shell__activitybar")).toBeHidden();
  await expect(page.locator("#rightSidebar")).toBeVisible();
  await expect(page.locator(".shell-window-actions")).toHaveCount(0);
});
