const { test, expect } = require('@playwright/test');

test('右サイドのSQLエディタが最下部まで伸びる', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  await page.waitForTimeout(800);

  await page.locator('.right-sidebar-content .node-topbar-connector-icon').click();
  await page.locator('.right-sidebar-content .connector-image-item:visible', { hasText: 'BigQuery' }).first().click();
  await page.waitForTimeout(200);
  await page.locator('.right-sidebar-content .connector-action-btn:visible').first().click();
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const pane = document.querySelector('.right-sidebar-content .node-tab-pane[data-tab-key="detail"].is-active');
    const row = pane?.querySelector('.row.row--code-editor');
    const right = row?.querySelector(':scope > div');
    const editor = row?.querySelector('.code-editor');
    const input = row?.querySelector('.code-editor-fallback');
    const gutter = row?.querySelector('.code-editor-gutter');
    const gutterLines = row?.querySelector('.code-editor-gutter-lines');
    if (!pane || !row || !right || !editor || !input) return null;
    const rr = row.getBoundingClientRect();
    const dr = right.getBoundingClientRect();
    const er = editor.getBoundingClientRect();
    return {
      gapRowToRight: Math.round(rr.bottom - dr.bottom),
      gapRightToEditor: Math.round(dr.bottom - er.bottom),
      editorHeight: Math.round(er.height),
      inputInlineHeight: input.style.height,
      inputInlineMaxHeight: input.style.maxHeight,
      hasGutter: !!gutter,
      gutterWidth: gutter ? Math.round(gutter.getBoundingClientRect().width) : 0,
      gutterFirstLine: gutterLines ? String(gutterLines.textContent || '').split(/\r?\n/)[0].trim() : '',
    };
  });

  expect(metrics).toBeTruthy();
  expect(metrics.editorHeight).toBeGreaterThan(300);
  expect(metrics.gapRowToRight).toBeLessThanOrEqual(1);
  expect(metrics.gapRightToEditor).toBeLessThanOrEqual(1);
  expect(metrics.inputInlineHeight).toBe('100%');
  expect(metrics.inputInlineMaxHeight).toBe('none');
  expect(metrics.hasGutter).toBeTruthy();
  expect(metrics.gutterWidth).toBeGreaterThanOrEqual(40);
  expect(metrics.gutterWidth).toBeLessThanOrEqual(60);
  expect(metrics.gutterFirstLine).toBe('1');
});
