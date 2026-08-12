const { test } = require('@playwright/test');

test('dump sidebar toggles', async ({ page }) => {
  await page.goto('/static/dataflow.html');
  await page.waitForSelector('.ziz-app-shell');
  const info = await page.evaluate(() => {
    const cls = document.body.className;
    const btns = Array.from(document.querySelectorAll('button,[role="button"]')).map((el) => ({
      id: el.id || '',
      cls: el.className || '',
      text: (el.textContent || '').trim().slice(0, 40),
      aria: el.getAttribute('aria-label') || '',
      title: el.getAttribute('title') || ''
    })).filter((b) => /sidebar|panel|detail|エクスプローラー|データ|node|right|left|toggle|開|閉|collapse|expand/i.test(`${b.id} ${b.cls} ${b.text} ${b.aria} ${b.title}`));
    return { bodyClass: cls, btns };
  });
  console.log(JSON.stringify(info, null, 2));
});
