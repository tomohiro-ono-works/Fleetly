const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.goto("/static/test-fixtures/tabular-import-assistant.html");
  await expect(page.locator("#secondaryAssistant .ztia")).toBeVisible();
});

test("publishes factories without legacy modal globals", async ({ page }) => {
  const result = await page.evaluate(() => ({
    assistant: typeof window.zizPackages?.tabularImportAssistant?.createTabularImportAssistant,
    excel: typeof window.zizPackages?.tabularImportAssistant?.createExcelFormat,
    delimited: typeof window.zizPackages?.tabularImportAssistant?.createDelimitedTextFormat,
    excelModal: Object.prototype.hasOwnProperty.call(window, "ExcelModal"),
    csvModal: Object.prototype.hasOwnProperty.call(window, "CsvModal"),
    invalidSourceRejected: (() => {
      try {
        window.tabularImportFixture.assistant.setSource({ display_name: "invalid" });
        return false;
      } catch (error) {
        return error instanceof TypeError;
      }
    })()
  }));
  expect(result).toEqual({
    assistant: "function",
    excel: "function",
    delimited: "function",
    excelModal: false,
    csvModal: false,
    invalidSourceRejected: true
  });
});

test("Excel source, preview, row selection and confirm use the public contracts", async ({ page }) => {
  await page.locator("#fixtureTrigger").focus();
  await page.locator("#fixtureTrigger").click();
  const modal = page.locator("#primaryAssistant .ztia");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "ファイルを選択" }).click();
  await expect(modal.locator(".ztia__source-name")).toHaveText("sales.xlsx");
  await expect(modal.locator("tbody tr")).toHaveCount(3);

  await modal.getByLabel("シート").selectOption("Sheet2");
  await expect(modal.locator("tbody tr").nth(1)).toContainText("B-1");
  await modal.getByRole("combobox", { name: "ヘッダー行", exact: true }).selectOption("2");
  await modal.getByRole("combobox", { name: "データ開始行", exact: true }).selectOption("3");
  await modal.getByRole("button", { name: "確定" }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator("#fixtureTrigger")).toBeFocused();

  const result = await page.evaluate(() => {
    const fixture = window.tabularImportFixture;
    const confirm = fixture.events.findLast((event) => event.type === "confirm");
    return {
      sourceIdentityPreserved: confirm.payload.source === fixture.sources.excel,
      formatId: confirm.payload.format_id,
      options: confirm.payload.options,
      selection: confirm.payload.selection,
      schemaLength: confirm.payload.schema.length,
      sourceRequest: fixture.sourceRequests[0],
      previewRequestCount: fixture.previewRequests.length
    };
  });
  expect(result).toEqual({
    sourceIdentityPreserved: true,
    formatId: "excel",
    options: { sheet_name: "Sheet2" },
    selection: { header_row: 2, data_start_row: 3 },
    schemaLength: 3,
    sourceRequest: {
      format_id: "excel",
      accept: [".xlsx", ".xlsm", ".xls"],
      current_source: null
    },
    previewRequestCount: 2
  });
});

test("Delimited format options reload a common preview table", async ({ page }) => {
  await page.evaluate(() => window.tabularImportFixture.openCsv());
  const modal = page.locator("#primaryAssistant .ztia");
  await expect(modal.locator("tbody tr")).toHaveCount(2);
  await modal.getByLabel("区切り文字").selectOption("\t");
  await expect(modal.locator("tbody tr").nth(1)).toContainText("tab");

  const request = await page.evaluate(() => {
    const requests = window.tabularImportFixture.previewRequests;
    const latest = requests[requests.length - 1];
    return {
      format_id: latest.format_id,
      options: latest.options,
      max_rows: latest.limit.max_rows
    };
  });
  expect(request).toEqual({
    format_id: "csv",
    options: { encoding: "utf-8", delimiter: "\t" },
    max_rows: 100
  });
});

test("stale preview responses do not replace the current source result", async ({ page }) => {
  await page.evaluate(() => window.tabularImportFixture.startStalePreview());
  const modal = page.locator("#primaryAssistant .ztia");
  await expect(modal.locator("tbody tr").nth(1)).toContainText("result");
  await page.evaluate(() => window.tabularImportFixture.resolveStalePreview());
  await page.waitForTimeout(50);
  await expect(modal.locator("tbody tr").nth(1)).toContainText("result");
  await expect(modal.locator(".ztia__source-name")).toHaveText("new.xlsx");
});

test("close ignores in-flight preview and restores focus", async ({ page }) => {
  await page.locator("#fixtureTrigger").focus();
  await page.evaluate(() => window.tabularImportFixture.startClosePending());
  const modal = page.locator("#primaryAssistant .ztia");
  await expect(modal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await page.evaluate(() => window.tabularImportFixture.resolveClosePending());
  await page.waitForTimeout(50);

  const state = await page.evaluate(() => window.tabularImportFixture.assistant.getState());
  expect(state.open).toBe(false);
  expect(state.preview).toBeNull();
  await expect(page.locator("#fixtureTrigger")).toBeFocused();
});

test("destroy removes its DOM and ignores in-flight preview", async ({ page }) => {
  const result = await page.evaluate(
    () => window.tabularImportFixture.verifyDestroyIgnoresPending()
  );
  expect(result).toEqual({
    childCount: 0,
    previewChangeCount: 0
  });
});

test("keyboard row selection and multiple instances remain independent", async ({ page }) => {
  await page.evaluate(() => window.tabularImportFixture.openCsv());
  const primary = page.locator("#primaryAssistant .ztia");
  const secondRow = primary.locator("tbody tr").nth(1);
  await secondRow.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Enter");

  const states = await page.evaluate(() => ({
    primary: window.tabularImportFixture.assistant.getState(),
    secondary: window.tabularImportFixture.secondary.getState()
  }));
  expect(states.primary.selection).toEqual({ header_row: 2, data_start_row: 2 });
  expect(states.secondary.selection).toEqual({ header_row: 1, data_start_row: 2 });
  await expect(page.locator("#secondaryAssistant .ztia")).toBeVisible();
});

test("preview owns scrolling and keeps its column header sticky", async ({ page }) => {
  await page.evaluate(() => window.tabularImportFixture.openCsv());
  const style = await page.locator("#primaryAssistant .ztia").evaluate((modal) => {
    const preview = modal.querySelector(".ztia__preview");
    const header = modal.querySelector(".ztia-table thead th");
    return {
      overflowX: getComputedStyle(preview).overflowX,
      overflowY: getComputedStyle(preview).overflowY,
      headerPosition: getComputedStyle(header).position,
      headerTop: getComputedStyle(header).top
    };
  });
  expect(style).toEqual({
    overflowX: "auto",
    overflowY: "auto",
    headerPosition: "sticky",
    headerTop: "0px"
  });
});
