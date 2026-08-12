const { test, expect } = require('@playwright/test');

test('step出力フィールド参照は未定義警告にならない', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  const warnings = await page.evaluate(() => {
    const node = { form: { text: '{{step12.device}}' } };
    const field = { key: 'text', kind: 'textarea', allowVars: true };
    return window.zizPackages.ui.fields.getFieldReferenceWarnings({
      node,
      field,
      upstreamSteps: ['step12'],
      availableVariableNames: ['current_date', 'user_name']
    });
  });
  expect(warnings).toEqual([]);
});

test('loopランタイム参照は未定義警告にならない', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  const warnings = await page.evaluate(() => {
    const node = { form: { text: '{{current_item.device}} / {{current_index}}' } };
    const field = { key: 'text', kind: 'textarea', allowVars: true };
    return window.zizPackages.ui.fields.getFieldReferenceWarnings({
      node,
      field,
      upstreamSteps: [],
      availableVariableNames: ['current_date', 'user_name']
    });
  });
  expect(warnings).toEqual([]);
});

test('未知参照は未定義警告になる', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  const warnings = await page.evaluate(() => {
    const node = { form: { text: '{{unknown_var}}' } };
    const field = { key: 'text', kind: 'textarea', allowVars: true };
    return window.zizPackages.ui.fields.getFieldReferenceWarnings({
      node,
      field,
      upstreamSteps: ['step12'],
      availableVariableNames: ['current_date', 'user_name']
    });
  });
  expect(warnings.length).toBeGreaterThan(0);
});

test('define_values で日本語変数名は許可される', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  const warnings = await page.evaluate(() => {
    const node = { form: { define_values: [{ name: '売上_合計', value: '100' }] } };
    const field = { key: 'define_values', kind: 'define-values-editor' };
    return window.zizPackages.ui.fields.getFieldReferenceWarnings({
      node,
      field,
      upstreamSteps: [],
      availableVariableNames: []
    });
  });
  expect(warnings).toEqual([]);
});

test('define_values 同名は上書き許可で警告しない', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  const warnings = await page.evaluate(() => {
    const node = { form: { define_values: [{ name: '変数A', value: '1' }, { name: '変数A', value: '2' }] } };
    const field = { key: 'define_values', kind: 'define-values-editor' };
    return window.zizPackages.ui.fields.getFieldReferenceWarnings({
      node,
      field,
      upstreamSteps: [],
      availableVariableNames: []
    });
  });
  expect(warnings).toEqual([]);
});
