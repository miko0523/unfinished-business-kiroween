import { expect, test } from '@playwright/test';
import { ready } from './helpers/app';
import { saveWithArchive, seedSave } from './helpers/save';

for (const width of [320, 899, 1280]) {
  test(`灯笼图片、火苗与灯位一起缩放：${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedSave(page, saveWithArchive(12));
    await ready(page);
    const slots = page.locator('.warm-lamp[data-kind="hung-lantern"]');
    await expect(slots).toHaveCount(9);
    const boxes = await slots.evaluateAll(els => els.map(el => {
      const box = (node: Element) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      return { slot: box(el), image: box(el.querySelector('img')!), flame: box(el.querySelector('.lamp-art')!), halo: box(el.querySelector('.lamp-halo')!) };
    }));
    for (const { slot, image, flame, halo } of boxes) {
      expect(image.x).toBeGreaterThanOrEqual(slot.x - 0.1);
      expect(image.right).toBeLessThanOrEqual(slot.right + 0.1);
      expect(image.y).toBeGreaterThanOrEqual(slot.y);
      expect(image.bottom).toBeLessThanOrEqual(slot.bottom + 0.1);
      for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(image[key] - flame[key])).toBeLessThan(0.1);
      expect(halo.width / slot.width).toBeCloseTo(78 / 27, 1);
      expect(image.width / image.height).toBeCloseTo(2 / 3, 2);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!.image, b = boxes[j]!.image;
      expect(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y).toBe(true);
    }
  });
}
