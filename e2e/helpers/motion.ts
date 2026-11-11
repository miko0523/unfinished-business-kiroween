import type { Page } from '@playwright/test';

/**
 * Self-contained (it is serialised into the page): lists every running or in-effect animation that breaks the
 * Reduced_Motion rule. Allowed: colour/opacity changes of at most 200ms in total. Everything else is a violation:
 * any infinite animation, any property other than colour/opacity (transform, translate, rotate, scale, offsets,
 * clip-path, filter, shadows ...), and any colour change longer than 200ms. Covers CSS animations, CSS transitions
 * and Web Animations alike, because document.getAnimations() returns all three.
 */
export const auditAnimations = () => {
  const ALLOWED = [
    'color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color',
    'border-left-color', 'outline-color', 'fill', 'stroke', 'stop-color', 'opacity', 'caret-color', 'text-decoration-color',
  ];
  const META = ['offset', 'easing', 'composite', 'computedOffset'];
  const kebab = (p: string) => p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
  const out: { kind: string; props: string[]; target: string; name: string; total: number }[] = [];
  for (const a of document.getAnimations()) {
    const effect = a.effect as KeyframeEffect | null;
    if (!effect) continue;
    const timing = effect.getComputedTiming();
    const props = new Set<string>();
    for (const frame of effect.getKeyframes()) for (const key of Object.keys(frame)) if (!META.includes(key)) props.add(kebab(key));
    const el = effect.target as Element | null;
    const target = `${el?.tagName ?? '?'}.${String(el?.getAttribute?.('class') ?? '').split(' ')[0]}`;
    const name = (a as unknown as { animationName?: string; transitionProperty?: string }).animationName
      ?? (a as unknown as { transitionProperty?: string }).transitionProperty ?? 'script';
    const iterations = timing.iterations;
    const duration = typeof timing.duration === 'number' ? timing.duration : Infinity;
    const total = (timing.delay ?? 0) + duration * (iterations === Infinity ? 1 : (iterations as number)) + (timing.endDelay ?? 0);
    const bad = [...props].filter((p) => !ALLOWED.includes(p));
    if (iterations === Infinity) out.push({ kind: 'infinite', props: [...props], target, name, total });
    else if (bad.length > 0) out.push({ kind: 'non-colour', props: bad, target, name, total });
    else if (total > 200) out.push({ kind: 'long-colour', props: [...props], target, name, total });
  }
  return out;
};

/** Computed transition settings that would allow motion or a long colour fade once something changes. */
export const auditTransitions = () => {
  const ALLOWED = ['color', 'background-color', 'border-color', 'outline-color', 'fill', 'stroke', 'opacity', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'stop-color', 'text-decoration-color'];
  const seconds = (v: string) => v.split(',').map((x) => (x.trim().endsWith('ms') ? parseFloat(x) / 1000 : parseFloat(x)));
  const out: { target: string; property: string; duration: number }[] = [];
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    const durations = seconds(s.transitionDuration);
    const delays = seconds(s.transitionDelay);
    const props = s.transitionProperty.split(',').map((x) => x.trim());
    durations.forEach((d, i) => {
      const total = d + (delays[i % delays.length] ?? 0);
      const p = props[i % props.length] ?? 'all';
      if (total <= 0) return;
      if (total > 0.2 + 1e-9 || !(ALLOWED.includes(p))) out.push({ target: `${el.tagName}.${String(el.getAttribute('class') ?? '').split(' ')[0]}`, property: p, duration: total });
    });
  }
  return out;
};

/** Install the audit inside the page, plus a recorder that notes how fast the page cleans up after a media change. */
export async function installMotionProbe(page: Page) {
  await page.addInitScript(`
    window.__audit = (${auditAnimations.toString()});
    window.__flip = { changeAt: null, cleanAt: null, count: 0 };
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    mq.addEventListener('change', () => {
      const f = window.__flip;
      f.count += 1;
      f.changeAt = performance.now();
      f.cleanAt = null;
      f.reduced = mq.matches;
      const tick = () => {
        if (f.reduced === false) return;
        if (window.__audit().length === 0) f.cleanAt = performance.now();
        else requestAnimationFrame(tick);
      };
      tick();
    });
  `);
}

export const audit = (page: Page) => page.evaluate(auditAnimations);
export const transitions = (page: Page) => page.evaluate(auditTransitions);
export const flipTiming = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as { __flip: { changeAt: number | null; cleanAt: number | null; count: number } }).__flip;
    return { ...f, ms: f.changeAt !== null && f.cleanAt !== null ? f.cleanAt - f.changeAt : null };
  });

/** Sample the audit in the page every `every` ms for `ms` ms; returns every violation seen (empty = clean throughout). */
export const sampleAudit = (page: Page, ms: number, every = 50) =>
  page.evaluate(
    ([total, step]) =>
      new Promise<ReturnType<typeof auditAnimations>[]>((resolve) => {
        const seen: ReturnType<typeof auditAnimations>[] = [];
        const started = performance.now();
        const timer = setInterval(() => {
          const now = (window as unknown as { __audit: () => ReturnType<typeof auditAnimations> }).__audit();
          if (now.length > 0) seen.push(now);
          if (performance.now() - started >= (total as number)) {
            clearInterval(timer);
            resolve(seen);
          }
        }, step as number);
      }),
    [ms, every] as const,
  );

/** Resident elements whose position is not their home (identity transform). */
export const displacedResidents = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.resident:not([data-staged])')]
      .map((el) => ({ id: el.querySelector('[data-ghost]')?.getAttribute('aria-label') ?? '', transform: getComputedStyle(el).transform }))
      .filter((r) => !(r.transform === 'none' || /^matrix\(1, 0, 0, 1, 0(\.0+)?, 0(\.0+)?\)$/.test(r.transform))),
  );
