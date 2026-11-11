import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 先由 webServer 执行 npm run build，因此此处 dist 必然是最新生产构建。
test('生产构建产物中没有校准层代码、入口字符串或调试标记', () => {
  const dist = resolve('dist');
  const files = walk(dist);
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const f of files) {
    if (/\.(png|jpe?g|webp|woff2?)$/i.test(f)) continue;
    const text = readFileSync(f, 'utf8').toLowerCase();
    for (const needle of ['calibrate', 'data-debug', 'cal-item', 'glow-evidence']) {
      if (text.includes(needle)) hits.push(`${f}: ${needle}`);
    }
  }
  expect(hits).toEqual([]);
  expect(files.filter((f) => /calibrat/i.test(f))).toEqual([]);
});

test('生产构建里打开 #/calibrate 仍是普通首页，没有任何调试元素', async ({ page }) => {
  await page.goto('/#/calibrate');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.static-layer img')).toHaveCount(3);
  await expect(page.locator('[data-debug]')).toHaveCount(0);
});
