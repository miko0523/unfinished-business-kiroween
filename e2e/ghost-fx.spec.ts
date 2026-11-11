import { expect, test, type Page } from '@playwright/test';
import { addStep, card, create, ghosts, openGhost, ready, setCriteria } from './helpers/app';

const TITLE = 'Plan the picnic';

async function oneGhostWithSteps(page: Page, steps = 3) {
  await ready(page);
  await create(page, TITLE);
  const ghost = ghosts(page).first();
  await expect(ghost).toHaveCount(1);
  // 本组量家务，不把尚未落地的入住位移混进采样；入住边界另有专项。
  await expect(ghost.locator('.ghost-enter')).toHaveCount(0);
  await openGhost(ghost);
  await setCriteria(page, 'Everyone knows where to meet');
  for (let i = 0; i < steps; i++) await addStep(page, `Step ${i + 1}`);
  return ghost;
}

type R = [number, number, number, number];
interface Sample {
  /** 相对 Ghost 盒（= 带道具的碰撞盒）左上角的矩形：[l, t, r, b]。 */
  prop: R[];
  fx: R[];
  hands: R[];
  leftHand: R | null;
  rightHand: R | null;
  body: R;
  eyes: R | null;
  box: [number, number];
  handMoved: boolean;
  expression: string;
}

/** 采样一段时间内道具、特效、小手、身体与眼睛相对 Ghost 盒的真实位置（量的是屏幕上的几何，不是 transform 属性）。 */
async function sampleReach(page: Page, ms: number): Promise<Sample[]> {
  return page.evaluate(async (total) => {
    const out: Sample[] = [];
    // 轮廓在家务中固定；只缓存局部路径点，每帧仍读取真实屏幕变换。
    const outlines = new WeakMap<SVGPathElement, { d: string | null; length: number; points: { x: number; y: number }[] }>();
    const t0 = performance.now();
    while (performance.now() - t0 < total) {
      const btn = document.querySelector('[data-ghost]')!;
      const box = btn.getBoundingClientRect();
      const r = (el: Element): R => {
        // SVG 的 getBoundingClientRect 会旋转整个局部包围矩形，连圆裙边外的空角也算入。
        // 基线浇花时它报 182.30，而实际轮廓下沿为 177.99。沿路径量真实轮廓，
        // 再加半段弧长的保守误差和圆描边半宽；不放宽下方的 2px 判定。
        if (el instanceof SVGPathElement && el.matches('.ghost-body')) {
          const matrix = el.getScreenCTM();
          if (matrix) {
            const count = 1024;
            const d = el.getAttribute('d');
            let outline = outlines.get(el);
            if (!outline || outline.d !== d) {
              const length = el.getTotalLength();
              const points = Array.from({ length: count + 1 }, (_, i) => {
                const p = el.getPointAtLength(length * i / count);
                return { x: p.x, y: p.y };
              });
              outline = { d, length, points };
              outlines.set(el, outline);
            }
            const points = outline.points.map((p) => ({
              x: matrix.a * p.x + matrix.c * p.y + matrix.e,
              y: matrix.b * p.x + matrix.d * p.y + matrix.f,
            }));
            const style = getComputedStyle(el);
            const halfStroke = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) / 2;
            const padding = outline.length / count / 2 + halfStroke;
            const px = padding * Math.hypot(matrix.a, matrix.c);
            const py = padding * Math.hypot(matrix.b, matrix.d);
            return [
              Math.min(...points.map((p) => p.x)) - px - box.left,
              Math.min(...points.map((p) => p.y)) - py - box.top,
              Math.max(...points.map((p) => p.x)) + px - box.left,
              Math.max(...points.map((p) => p.y)) + py - box.top,
            ];
          }
        }
        const b = el.getBoundingClientRect();
        return [b.left - box.left, b.top - box.top, b.right - box.left, b.bottom - box.top];
      };
      const leaves = (root: Element | null) => (root ? [...root.querySelectorAll('rect,path,ellipse,circle')].map(r) : []);
      const hand = btn.querySelector('.ghost-hand-right');
      const matrix = hand ? getComputedStyle(hand).transform : 'none';
      const hands = [...btn.querySelectorAll('.ghost-hand ellipse')];
      out.push({
        prop: leaves(btn.querySelector('.ghost-prop')),
        fx: [...btn.querySelectorAll('.fx-scene')].flatMap(leaves),
        hands: hands.map(r),
        leftHand: btn.querySelector('.ghost-hand-left ellipse') ? r(btn.querySelector('.ghost-hand-left ellipse')!) : null,
        rightHand: btn.querySelector('.ghost-hand-right ellipse') ? r(btn.querySelector('.ghost-hand-right ellipse')!) : null,
        body: r(btn.querySelector('.ghost-body')!),
        eyes: btn.querySelector('.ghost-eyes') ? r(btn.querySelector('.ghost-eyes')!) : null,
        box: [box.width, box.height],
        handMoved: matrix !== 'none' && matrix !== 'matrix(1, 0, 0, 1, 0, 0)',
        expression: btn.querySelector('.ghost-eyes')?.getAttribute('data-expression') ?? '',
      });
      await new Promise((res) => setTimeout(res, 60));
    }
    return out;
  }, ms);
}

const centre = (b: R): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const intersects = (a: R, b: R) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/** 点到矩形的距离（0 表示点在矩形内）。 */
const distTo = (p: [number, number], r: R) => Math.hypot(Math.max(r[0] - p[0], 0, p[0] - r[2]), Math.max(r[1] - p[1], 0, p[1] - r[3]));

for (const [index, chore] of (['sweep', 'water', 'window'] as const).entries()) {
  test(`家务（${chore}）：约 2 秒；小手真实抬向道具；道具与特效都在碰撞盒内、不压脸；专注眼到开心眼`, async ({ page }) => {
    test.setTimeout(60_000);
    const ghost = await oneGhostWithSteps(page);
    // 先走完前面的家务，让第 index 步对应这一种
    for (let i = 0; i < index; i++) {
      await card(page).getByRole('checkbox').nth(i).check();
      await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 5000 });
    }
    await page.waitForTimeout(400);
    const [rest] = await sampleReach(page, 80); // 家务开始前的静止姿态
    await card(page).getByRole('checkbox').nth(index).check();
    await expect(ghost).toHaveAttribute('data-chore', chore);
    const started = Date.now();
    const samples = await sampleReach(page, 2300);
    const withProp = samples.filter((s) => s.prop.length > 0);
    expect(withProp.length).toBeGreaterThan(10);
    const tol = 2; // CSS px
    for (const s of samples) {
      const [w, h] = s.box;
      for (const r of [...s.prop, ...s.fx, ...s.hands, s.body]) {
        expect(r[0]).toBeGreaterThanOrEqual(-tol);
        expect(r[1]).toBeGreaterThanOrEqual(-tol);
        expect(r[2]).toBeLessThanOrEqual(w + tol);
        expect(r[3]).toBeLessThanOrEqual(h + tol);
      }
      // 道具、特效与抬起的手都不压脸
      if (s.eyes) for (const r of [...s.prop, ...s.fx, ...(s.rightHand ? [s.rightHand] : [])]) expect(intersects(r, s.eyes)).toBe(false);
    }
    // 小手：相对身体真实抬高、移向道具，并抓住道具（量的是手的几何中心，不是 transform 是否为单位矩阵）
    const unit = rest!.box[0] / 140; // CSS px / viewBox 单位
    const relY = (s: Sample) => (s.body[3] - centre(s.rightHand!)[1]) / unit;
    const relX = (s: Sample) => (centre(s.rightHand!)[0] - (s.body[0] + s.body[2]) / 2) / unit;
    const lift = Math.max(...withProp.map(relY)) - relY(rest!);
    expect(lift).toBeGreaterThan(18);
    const reach = Math.max(...withProp.map(relX)) - relX(rest!);
    expect(reach).toBeGreaterThan(4);
    const grip = Math.min(...withProp.map((s) => Math.min(...s.prop.map((p) => distTo(centre(s.rightHand!), p))) / unit));
    expect(grip).toBeLessThan(6);
    // 靠道具那一侧的手在最高处明显高于另一只手
    const peak = withProp.reduce((a, b) => (relY(b) > relY(a) ? b : a));
    expect(centre(peak.leftHand!)[1] - centre(peak.rightHand!)[1]).toBeGreaterThan(8 * unit);
    expect(samples.find((s) => s.prop.length > 0)?.expression).toBe('focused');
    expect(samples.some((s) => s.expression === 'happy')).toBe(true);
    if (chore === 'window') {
      // 擦窗时身体略飘高到窗旁
      const rise = Math.max(...samples.map((s) => rest!.body[3] - s.body[3])) / unit;
      expect(rise).toBeGreaterThan(7);
    }
    // 整套约 2 秒：道具撤掉后 data-chore 也随之消失
    await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 3000 });
    expect(Date.now() - started).toBeLessThan(3500);
  });
}

test('取消勾选：橡皮擦在身体外侧，小手抬向它，灰屑不出界', async ({ page }) => {
  test.setTimeout(60_000);
  const ghost = await oneGhostWithSteps(page, 2);
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 5000 });
  await page.waitForTimeout(400);
  const [rest] = await sampleReach(page, 80);
  await card(page).getByRole('checkbox').nth(0).uncheck();
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  const samples = await sampleReach(page, 1500);
  const withProp = samples.filter((s) => s.prop.length > 0);
  const unit = rest!.box[0] / 140;
  const relY = (s: Sample) => (s.body[3] - centre(s.rightHand!)[1]) / unit;
  expect(Math.max(...withProp.map(relY)) - relY(rest!)).toBeGreaterThan(15);
  expect(Math.min(...withProp.map((s) => Math.min(...s.prop.map((p) => distTo(centre(s.rightHand!), p))) / unit))).toBeLessThan(6);
  for (const s of samples) {
    const [w, h] = s.box;
    for (const r of [...s.prop, ...s.fx, ...s.hands]) {
      expect(r[2]).toBeLessThanOrEqual(w + 2);
      expect(r[3]).toBeLessThanOrEqual(h + 2);
      expect(r[0]).toBeGreaterThanOrEqual(-2);
    }
    if (s.eyes) for (const r of [...s.prop, ...s.fx]) expect(intersects(r, s.eyes)).toBe(false);
  }
});

test('家务做完冒两三颗小星；第一次变绿再接几颗；平时没有粒子', async ({ page }) => {
  test.setTimeout(60_000);
  const ghost = await oneGhostWithSteps(page);
  await expect(ghost.locator('.fx-star')).toHaveCount(0); // 平时安静
  // 用观察器记下出现过的每一轮星星（负载高时轮询可能错过中间那一轮）
  await page.evaluate(() => {
    const seen: Record<string, number> = {};
    (window as unknown as { __bursts: Record<string, number> }).__bursts = seen;
    const note = () => {
      for (const b of document.querySelectorAll('[data-ghost] .fx-burst')) {
        const k = b.getAttribute('data-burst')!;
        seen[k] = Math.max(seen[k] ?? 0, b.querySelectorAll('.fx-star').length);
      }
    };
    new MutationObserver(note).observe(document.body, { childList: true, subtree: true });
  });
  await card(page).getByRole('checkbox').nth(0).check();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __bursts: Record<string, number> }).__bursts), { timeout: 8000 })
    .toEqual({ chore: 3, few: 4 });
  await expect(ghost).toHaveAttribute('data-state', 'green');
});

test('取消勾选：橡皮擦两下带灰屑，没有退步的话', async ({ page }) => {
  test.setTimeout(60_000);
  const ghost = await oneGhostWithSteps(page, 2);
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/, { timeout: 5000 });
  await card(page).getByRole('checkbox').nth(0).uncheck();
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  await expect(ghost.locator('.fx-crumb')).toHaveCount(4);
  const samples = await sampleReach(page, 1500);
  const xs = samples.filter((s) => s.prop.length > 0).map((s) => s.prop[0]![0]);
  // 来回两次：左极值出现两段
  let dips = 0;
  for (let i = 1; i < xs.length - 1; i++) if (xs[i]! < xs[i - 1]! - 0.3 && xs[i]! <= xs[i + 1]!) dips += 1;
  expect(dips).toBeGreaterThanOrEqual(1);
  await expect(ghost).toHaveAttribute('data-anim', 'none', { timeout: 3000 });
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const word of ['regress', 'worse', 'failed', 'behind']) expect(text).not.toContain(word);
});

test('新事件取消旧动作：勾选后立刻取消，只剩橡皮擦，没有旧家务的道具或星星冒出来', async ({ page }) => {
  test.setTimeout(60_000);
  const ghost = await oneGhostWithSteps(page, 2);
  await card(page).getByRole('checkbox').nth(0).check();
  await expect(ghost).toHaveAttribute('data-chore', 'sweep');
  await card(page).getByRole('checkbox').nth(0).uncheck();
  await expect(ghost).toHaveAttribute('data-anim', 'erase');
  await expect(ghost.locator('.fx-sweep')).toHaveCount(0);
  await page.waitForTimeout(3600);
  await expect(ghost.locator('.fx-star')).toHaveCount(0);
  await expect(ghost.locator('.fx-scene')).toHaveCount(0);
  await expect(ghost).toHaveAttribute('data-state', 'white');
});

test('入住落地冒几颗星，然后恢复安静；平时慢漂浮、光晕缓呼吸', async ({ page }) => {
  await ready(page);
  await create(page, TITLE);
  const ghost = ghosts(page).first();
  await expect(ghost.locator('.fx-burst[data-burst="few"] .fx-star')).toHaveCount(4, { timeout: 3000 });
  await expect(ghost.locator('.fx-star').first()).toBeAttached();
  const idle = await page.evaluate(() => {
    const sprite = document.querySelector('[data-ghost] .ghost-sprite')!;
    const halo = document.querySelector('[data-ghost] .ghost-halo')!;
    return {
      float: getComputedStyle(sprite).animationName,
      floatS: parseFloat(getComputedStyle(sprite).animationDuration),
      halo: getComputedStyle(halo).animationName,
      haloS: parseFloat(getComputedStyle(halo).animationDuration),
    };
  });
  expect(idle.float).toBe('ghost-float');
  expect(idle.floatS).toBeGreaterThanOrEqual(4.5);
  expect(idle.halo).toBe('halo-idle');
  expect(idle.haloS).toBeGreaterThanOrEqual(5);
});

test('水平漫游：脸朝前挪身体宽的 8%–10%，身体前倾、裙边后飘，停下回正，方向与实际移动一致', async ({ page }) => {
  test.setTimeout(90_000);
  await ready(page);
  await create(page, TITLE);
  const result = await page.evaluate(async () => {
    const btn = document.querySelector('[data-ghost]') as HTMLElement;
    const li = btn.closest('li') as HTMLElement;
    const seen = { right: false, left: false, rest: false, bad: [] as string[], faceRatio: [] as number[] };
    const tx = (el: Element | null) => {
      const m = el ? new DOMMatrix(getComputedStyle(el).transform) : null;
      return m ? m.m41 : 0;
    };
    let lastWalk = btn.getAttribute('data-walk');
    let changedAt = performance.now();
    let lastX = li.getBoundingClientRect().left;
    const t0 = performance.now();
    while (performance.now() - t0 < 70000 && !(seen.right && seen.left && seen.rest)) {
      await new Promise((r) => setTimeout(r, 100));
      const now = performance.now();
      const walk = btn.getAttribute('data-walk');
      if (walk !== lastWalk) {
        lastWalk = walk;
        changedAt = now;
      }
      const x = li.getBoundingClientRect().left;
      const moved = x - lastX;
      lastX = x;
      if (now - changedAt < 600) continue; // 过渡 0.35s，等稳定再量
      const face = tx(btn.querySelector('.ghost-face'));
      const lean = new DOMMatrix(getComputedStyle(btn.querySelector('.ghost-lean')!).transform);
      const outline = btn.querySelector('.ghost-outline') as SVGGeometryElement;
      const body = btn.querySelector('.ghost-body')!.getBoundingClientRect();
      const viewScale = btn.getBoundingClientRect().width / 140;
      if (walk === '1' || walk === '-1') {
        const dir = Number(walk);
        if (Math.sign(face) !== dir) seen.bad.push(`face ${face} vs walk ${walk}`);
        if (Math.sign(lean.b) !== dir) seen.bad.push(`lean ${lean.b} vs walk ${walk}`);
        // 身体与下摆只有一条闭合轮廓；方向写进下摆路径，绝不能再出现两块拼图。
        if (outline.getAttribute('data-walk') !== walk) seen.bad.push(`outline walk ${outline.getAttribute('data-walk')} vs ${walk}`);
        const a = outline.getPointAtLength(0);
        const z = outline.getPointAtLength(outline.getTotalLength());
        if (Math.hypot(a.x - z.x, a.y - z.y) > 0.05) seen.bad.push('outline is open');
        if (btn.querySelector('.ghost-skirt, .ghost-hem')) seen.bad.push('split skirt remains');
        if (Math.abs(moved) > 0.2 && Math.sign(moved) !== dir) seen.bad.push(`moved ${moved} vs walk ${walk}`);
        seen.faceRatio.push(Math.abs(face) / (body.width / viewScale));
        if (dir === 1) seen.right = true; else seen.left = true;
      } else if (walk === '0') {
        if (Math.abs(face) > 0.05 || Math.abs(lean.b) > 0.001) seen.bad.push(`not centered: face ${face}`);
        seen.rest = true;
      }
    }
    return seen;
  });
  expect(result.bad).toEqual([]);
  expect(result.rest).toBe(true);
  expect(result.right || result.left).toBe(true);
  for (const ratio of result.faceRatio) {
    expect(ratio).toBeGreaterThan(0.07);
    expect(ratio).toBeLessThan(0.11);
  }
});

test('页面隐藏：装饰动态全部暂停，回来后继续；隐藏时的新事件不起动画', async ({ page }) => {
  const ghost = await oneGhostWithSteps(page, 2);
  const running = () => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
  expect(await running()).toBeGreaterThan(0); // 漂浮、光晕
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-page-hidden', '');
  await expect.poll(running).toBe(0);
  await card(page).getByRole('checkbox').nth(0).check();
  await page.waitForTimeout(300);
  await expect(ghost).not.toHaveAttribute('data-chore', /.*/);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('html')).not.toHaveAttribute('data-page-hidden', '');
  await expect.poll(running).toBeGreaterThan(0);
});

test.describe('减少动态', () => {
  test.use({ reducedMotion: 'reduce' });

  test('没有漂浮、漫游、粒子、拖尾、手脚动画和道具，只有颜色与静态表情', async ({ page }) => {
    test.setTimeout(60_000);
    const ghost = await oneGhostWithSteps(page);
    const idleStart = await page.evaluate(() => document.querySelector('[data-ghost]')!.getBoundingClientRect().left);
    await card(page).getByRole('checkbox').nth(0).check();
    await expect(ghost).toHaveAttribute('data-chore', 'sweep');
    const samples = await sampleReach(page, 2200);
    for (const s of samples) {
      expect(s.prop).toEqual([]);
      expect(s.fx).toEqual([]);
      expect(s.handMoved).toBe(false);
    }
    expect(samples.some((s) => s.expression === 'focused')).toBe(true);
    expect(samples.some((s) => s.expression === 'happy')).toBe(true);
    await expect(ghost.locator('.fx-star')).toHaveCount(0);
    await expect(ghost).toHaveAttribute('data-walk', '0');
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await page.evaluate(() => document.querySelector('[data-ghost]')!.getBoundingClientRect().left)).toBe(idleStart);
    await expect(ghost).toHaveAttribute('data-state', 'green');
  });
});
