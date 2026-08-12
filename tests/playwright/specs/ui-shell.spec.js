const { test, expect } = require('@playwright/test');

async function gotoHome(page) {
  await page.goto('/static/home.html');
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(page.locator('.home-screen__title')).toContainText('ziz ai craft');
}

async function openExplorerFromHome(page) {
  await page.locator('[data-sidebar-action="explorer"]').first().click();
  await expect(page).toHaveURL(/\/static\/dataflow\.html/);
}

test.describe('zizai browser-only UI shell (current)', () => {
  test('トップ画面の基本表示ができる', async ({ page }) => {
    await gotoHome(page);

    await expect(page.getByRole('heading', { name: '最近使ったプロジェクト' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'テンプレートから作成する' })).toBeVisible();
    await expect(page.getByText('プロジェクトがありません。')).toHaveCount(1);
    await expect(page.getByText('ファイルがありません。')).toHaveCount(1);
  });

  test('トップ画面からエクスプローラーへ遷移できる', async ({ page }) => {
    await gotoHome(page);
    await openExplorerFromHome(page);

    await expect(page.locator('.home-screen')).toHaveCount(0);
  });

  test('トップ画面からプロジェクト選択へ遷移できる', async ({ page }) => {
    await gotoHome(page);

    await page.locator('[data-sidebar-action="project-select"]').first().click();
    await expect(page).toHaveURL(/\/static\/dataflow\.html/);
    await expect(page.locator('.home-screen')).toHaveCount(0);
  });

  test('左サイドバーの選択表示は開いているビューに同期する', async ({ page }) => {
    await page.goto('/static/dataflow.html');

    const explorer = page.locator('[data-sidebar-action="explorer"]').first();
    const projectSelect = page.locator('[data-sidebar-action="project-select"]').first();

    await explorer.click();
    await expect(explorer).toHaveClass(/is-current/);
    await expect(projectSelect).not.toHaveClass(/is-current/);

    await explorer.click();
    await expect(explorer).not.toHaveClass(/is-current/);

    await projectSelect.click();
    await expect(projectSelect).toHaveClass(/is-current/);
    await expect(explorer).not.toHaveClass(/is-current/);
  });

  test('ブラウザ単体では診断がダイアログ表示される', async ({ page }) => {
    await gotoHome(page);

    await page.getByRole('button', { name: '診断' }).click();
    await expect(page.locator('#appDialog.is-open')).toBeVisible();
    await expect(page.locator('#appDialogTitle')).toHaveText('診断');
  });
});
