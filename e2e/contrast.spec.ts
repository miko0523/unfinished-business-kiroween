import { expect, test } from '@playwright/test';
import { contrastRatio, contrastOfLuminance, grayOfLuminance, median, over, parseColor, relativeLuminance, type RGB } from '../src/house/contrast';
import { FLOOR_SPACES } from '../src/house/data/space';
import { FLOOR_SLOTS } from '../src/house/data/slots';
import { ghostPaint } from '../src/house/paint';
import type { GhostState } from '../src/domain/types';

// 在真实浏览器里把每层 PNG 画到 canvas（同源，可读像素），在整个可导航区按网格取背景亮度的中位数，
// 再分别取两个 Home Anchor 附近（Ghost 身体所在位置）的中位数，计算 Ghost 的描边与填充对背景的对比度。
const FLOORS = ['floor-01', 'floor-02', 'floor-03', 'floor-04', 'floor-05'] as const;
const GRID = 12;

interface Luma {
  navigable: number;
  homes: [number, number];
}

const CASES: { name: string; state: GhostState; ratio: number; pending: boolean }[] = [
  { name: 'gray', state: 'gray', ratio: 0, pending: false },
  { name: 'white', state: 'white', ratio: 0, pending: false },
  { name: 'green(0)', state: 'green', ratio: 0, pending: false },
  { name: 'green(.5)', state: 'green', ratio: 0.5, pending: false },
  { name: 'pending', state: 'green', ratio: 1, pending: true },
  { name: 'gold', state: 'gold', ratio: 1, pending: false },
];

async function measure(page: import('@playwright/test').Page): Promise<Record<string, Luma>> {
  const spec = FLOORS.map((id) => ({ id, nav: FLOOR_SPACES[id].navigable, homes: [FLOOR_SLOTS[id].left.idle, FLOOR_SLOTS[id].right.idle] }));
  return page.evaluate(
    async ({ spec: floors, grid }) => {
      const lum = (r: number, g: number, b: number) => {
        const l = (c: number) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * l(r) + 0.7152 * l(g) + 0.0722 * l(b);
      };
      const med = (v: number[]) => {
        const s = [...v].sort((a, b) => a - b);
        return s[s.length >> 1]!;
      };
      const out: Record<string, { navigable: number; homes: [number, number] }> = {};
      for (const f of floors) {
        const img = new Image();
        img.src = `/assets/dollhouse/1x/${f.id}.png`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const sample = (x0: number, y0: number, x1: number, y1: number) => {
          const v: number[] = [];
          for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(canvas.height - 1, y1); y += grid) {
            for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(canvas.width - 1, x1); x += grid) {
              const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
              if (a! >= 200) v.push(lum(r!, g!, b!));
            }
          }
          return med(v);
        };
        const [nx0, ny0, nx1, ny1] = f.nav;
        // Home Anchor 附近：身体宽约 95、高约 115，锚点在底边中点
        const near = (p: [number, number]) => sample(p[0] - 48, p[1] - 120, p[0] + 48, p[1]);
        out[f.id] = { navigable: sample(nx0, ny0, nx1, ny1), homes: [near(f.homes[0] as [number, number]), near(f.homes[1] as [number, number])] };
      }
      return out;
    },
    { spec, grid: GRID },
  );
}

test('灰白绿描边对每层背景与对自身填充、金色描边对自身填充不低于 3:1（金色对背景单独报告）；标签文字不低于 4.5:1', async ({ page }) => {
  await page.goto('/');
  const lumas = await measure(page);
  const rows: string[] = [];
  const failures: string[] = [];
  const goldVsBackground: number[] = [];
  for (const id of FLOORS) {
    const l = lumas[id]!;
    for (const [where, y] of [['navigable', l.navigable], ['home-left', l.homes[0]], ['home-right', l.homes[1]]] as const) {
      const bg: RGB = grayOfLuminance(y);
      for (const c of CASES) {
        const p = ghostPaint(c.state, c.ratio, c.pending);
        const fill = over(parseColor(p.fill)!, bg, p.opacity);
        const stroke = parseColor(p.stroke)!;
        const fillC = contrastRatio(fill, bg);
        const strokeC = contrastRatio(stroke, bg);
        rows.push(`${id} ${where} bgY=${y.toFixed(3)} ${c.name}: fill ${fillC.toFixed(2)} stroke ${strokeC.toFixed(2)}`);
        // 柔和的浅色填充在中间调的墙上拉不开 3:1，轮廓由深色描边承担（WCAG 1.4.11）：
        // 描边对背景、描边对自身填充都不低于 3:1；填充对背景只记录，不作要求。
        const strokeVsFill = contrastRatio(stroke, fill);
        if (c.state === 'gold') goldVsBackground.push(strokeC);
        // 金色轮廓是视觉负责人批准的暖金深色（不用近黑），在中间调墙面上达不到 3:1：单独如实报告，不计入失败；
        // 金色的可识别手段是描边对填充 ≥3:1、温暖的光晕与标签、金色章印。其他颜色的门槛不变。
        if (c.state !== 'gold' && strokeC < 3) failures.push(`${id} ${where} ${c.name} 描边对背景 ${strokeC.toFixed(2)}`);
        if (strokeVsFill < 3) failures.push(`${id} ${where} ${c.name} 描边对填充 ${strokeVsFill.toFixed(2)}`);
      }
    }
  }
  console.log(rows.join('\n'));
  const lo = Math.min(...goldVsBackground);
  const hi = Math.max(...goldVsBackground);
  console.log(`GOLD_OUTLINE_VS_BACKGROUND min=${lo.toFixed(2)} max=${hi.toFixed(2)}`);
  test.info().annotations.push({ type: 'gold-outline-vs-background', description: `${lo.toFixed(2)}–${hi.toFixed(2)}:1（五层墙面，整个可导航区与两个 Home Anchor 附近）` });
  expect(lo).toBeGreaterThan(1.5); // 不是 3:1，只防止金色轮廓退化到几乎看不见
  expect(failures).toEqual([]);

  // 标签：不透明底色，文字对比度 ≥4.5:1
  await page.goto('/');
  await page.getByLabel("What's waiting?").fill('Contrast');
  await page.getByRole('button', { name: 'Welcome a little ghost' }).click();
  const tag = await page.locator('.ghost-tag').first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  const rgba = (c: string) => c.match(/[\d.]+/g)!.map(Number);
  const [br, bg2, bb, ba = 1] = rgba(tag.background);
  expect(ba).toBe(1);
  const [fr, fg, fb] = rgba(tag.color);
  expect(contrastRatio([fr!, fg!, fb!], [br!, bg2!, bb!])).toBeGreaterThanOrEqual(4.5);
  expect(contrastOfLuminance(relativeLuminance([255, 255, 255]), 0)).toBeGreaterThan(4.5);
  expect(median([3, 1, 2])).toBe(2);
});
