import type { Page } from '@playwright/test';

export interface SizeReport {
  viewport: [number, number];
  overflow: { scrollWidth: number; innerWidth: number; widest: string[] };
  smallTargets: string[];
  /** Controls drawn outside the viewport sideways (e.g. in a fixed panel that cannot scroll). */
  offscreen: string[];
  smallText: string[];
  lowTextContrast: string[];
  lowControlContrast: string[];
  lowPlaceholder: string[];
  counts: { targets: number; textNodes: number; controls: number; ghostsProbed: number; coveredByPanel: number };
}

/**
 * Self-contained (serialised into the page; arrow functions only). Measures what is on screen right now:
 * - every visible interactive target (links, buttons, fields, checkboxes through their label, ghost hit areas through
 *   real hit-testing) is at least 44x44 CSS px;
 * - every visible text node is at least 16 CSS px;
 * - text contrast >= 4.5:1 and control boundary contrast >= 3:1, composited against the darkest and the lightest sky colour
 *   for translucent surfaces and taking the worse of the two (painted house art and the gold graphic exception are not
 *   measured here: ghost/book controls are art, covered by the focus-ring pixel test);
 * - no horizontal overflow of the document.
 */
export const measureSizes = async (opts: { allow: string[] }): Promise<SizeReport> => {
  const frames = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  type Rgba = [number, number, number, number];
  const parse = (value: string): Rgba => {
    const m = /rgba?\(([^)]+)\)/.exec(value);
    if (!m) return [0, 0, 0, 0];
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [p[0]!, p[1]!, p[2]!, p[3] === undefined ? 1 : p[3]!];
  };
  const over = (top: Rgba, base: [number, number, number]): [number, number, number] => [
    top[0] * top[3] + base[0] * (1 - top[3]),
    top[1] * top[3] + base[1] * (1 - top[3]),
    top[2] * top[3] + base[2] * (1 - top[3]),
  ];
  const lum = (c: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const SKY: [number, number, number][] = [[7, 13, 36], [23, 36, 71]];
  /** Background behind an element, composited for both sky extremes. */
  const backgrounds = (el: Element | null): [number, number, number][] => {
    const layers: Rgba[] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    return SKY.map((sky) => layers.reduceRight((acc, layer) => over(layer, acc), sky));
  };
  const name = (el: Element) => {
    const cls = String(el.getAttribute('class') ?? '').split(' ')[0];
    const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
  };
  const modal = document.querySelector('dialog[open]');
  const hidden = (el: Element) => {
    if (modal && !el.closest('dialog')) return true; // behind a modal dialog: inert, not a target right now
    if (el.closest('[hidden], [inert], .visually-hidden, [aria-hidden="true"]')) return true;
    const dialog = el.closest('dialog');
    if (dialog && !dialog.hasAttribute('open')) return true;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') return true;
    }
    return false;
  };
  const allowed = (el: Element) => opts.allow.some((selector) => el.matches(selector) || el.closest(selector) !== null);

  const report: SizeReport = {
    viewport: [innerWidth, innerHeight],
    overflow: { scrollWidth: document.documentElement.scrollWidth, innerWidth, widest: [] },
    smallTargets: [],
    offscreen: [],
    smallText: [],
    lowTextContrast: [],
    lowControlContrast: [],
    lowPlaceholder: [],
    counts: { targets: 0, textNodes: 0, controls: 0, ghostsProbed: 0, coveredByPanel: 0 },
  };

  if (report.overflow.scrollWidth > innerWidth) {
    const over2 = [...document.querySelectorAll('body *')]
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter((x) => x.right > innerWidth + 0.5)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5);
    report.overflow.widest = over2.map((x) => `${name(x.el)} right=${Math.round(x.right)}`);
  }

  // ---- targets ----
  const interactive = document.querySelectorAll('a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"]');
  for (const el of interactive) {
    if (hidden(el) && !el.closest('.visually-hidden')) continue;
    if (el.closest('.visually-hidden')) continue;
    if (allowed(el)) continue;
    report.counts.targets += 1;
    let rect = el.getBoundingClientRect();
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
      if (label) rect = label.getBoundingClientRect();
    }
    if (el.matches('[data-ghost]')) {
      // A ghost's hit area is its button plus a 44x44 pseudo-element. Prove it by hit-testing a full 44x44 window at 1px
      // pixel-centre spacing (no inflation): the window must be hit by this very button everywhere.
      const panel = document.querySelector('.task-card');
      // With the drawer open, bring the ghost to the top of the view, above the drawer.
      el.scrollIntoView({ block: panel ? 'start' : 'center', inline: 'center' });
      if (panel) window.scrollBy(0, -30); // room above for the hit window, which reaches a little above the button
      // The ghost standing on the drawer follows the page on scroll events; let those settle before probing.
      for (let i = 0; i < 30; i++) {
        await frames();
        const staged = document.querySelector('[data-staged] .ghost-button');
        if (!panel || !staged || Math.abs(staged.getBoundingClientRect().bottom - panel.getBoundingClientRect().top) < 3) break;
      }
      if (panel) {
        const pr = panel.getBoundingClientRect();
        const gr = el.getBoundingClientRect();
        if (gr.bottom > pr.top) {
          report.counts.coveredByPanel += 1; // still behind the open drawer: not a target right now (measured with the drawer closed)
          continue;
        }
      }
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el, '::before');
      const candidates: [number, number][] = [];
      if (parseFloat(cs.width) >= 44 && parseFloat(cs.height) >= 44) {
        candidates.push([b.left + parseFloat(cs.left) + parseFloat(cs.marginLeft), b.top + parseFloat(cs.top) + parseFloat(cs.marginTop)]);
      }
      if (b.width >= 44 && b.height >= 44) candidates.push([b.left + (b.width - 44) / 2, b.top + (b.height - 44) / 2]);
      let blocker = '';
      const ok = candidates.some(([x0, y0]) => {
        const sx = Math.ceil(x0 - 0.5) + 0.5;
        const sy = Math.ceil(y0 - 0.5) + 0.5;
        for (let j = 0; j < 44; j++) {
          for (let i = 0; i < 44; i++) {
            const x = sx + i;
            const y = sy + j;
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
              blocker = `window leaves the viewport at (${x},${y}); button at ${Math.round(b.left)},${Math.round(b.top)}`;
              return false;
            }
            const hit = document.elementFromPoint(x, y);
            if (!hit || !(hit === el || el.contains(hit))) {
              blocker = `blocked at (${x},${y}) by ${hit ? name(hit.closest('[data-ghost], button, aside, dialog') ?? hit) : 'nothing'}; button at ${Math.round(b.left)},${Math.round(b.top)}`;
              return false;
            }
          }
        }
        return true;
      });
      report.counts.ghostsProbed += 1;
      if (!ok) report.smallTargets.push(`${name(el)} no fully hit 44x44 window (button ${b.width.toFixed(1)}x${b.height.toFixed(1)}, ${candidates.length} candidate windows; ${blocker})`);
      continue;
    }
    const box = el.getBoundingClientRect();
    if (!el.matches('[data-ghost]') && (box.left < -0.5 || box.right > innerWidth + 0.5)) report.offscreen.push(`${name(el)} x=${Math.round(box.left)}..${Math.round(box.right)}`);
    if (rect.width < 43.99 || rect.height < 43.99) report.smallTargets.push(`${name(el)} ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`);
  }

  // ---- text ----
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    const parent = node.parentElement;
    if (!text || !parent || seen.has(parent)) continue;
    if (parent.closest('svg, script, style, noscript') || hidden(parent) || allowed(parent)) continue;
    seen.add(parent);
    report.counts.textNodes += 1;
    const style = getComputedStyle(parent);
    const size = parseFloat(style.fontSize);
    if (size < 15.99) report.smallText.push(`${name(parent)} ${size}px`);
    const fg = parse(style.color);
    if ((parent as HTMLButtonElement).disabled) continue;
    const worst = Math.min(
      ...backgrounds(parent).map((bg) => ratio(over(fg, bg), bg)),
    );
    if (worst < 4.5) report.lowTextContrast.push(`${name(parent)} ${worst.toFixed(2)}`);
  }

  // ---- control boundaries and placeholders ----
  for (const el of document.querySelectorAll('button, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, select')) {
    if (hidden(el) || el.closest('.visually-hidden') || allowed(el) || (el as HTMLButtonElement).disabled || el.matches('.ghost-button, .archive-book')) continue;
    const s = getComputedStyle(el);
    const around = backgrounds(el.parentElement);
    const own = parse(s.backgroundColor);
    const hasBorder = parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== 'none' && parse(s.borderTopColor)[3] > 0;
    if (!hasBorder && own[3] === 0) continue; // a text link look: its text contrast is measured above
    report.counts.controls += 1;
    const best = Math.max(
      hasBorder ? Math.min(...around.map((bg) => ratio(over(parse(s.borderTopColor), bg), bg))) : 0,
      own[3] > 0.5 ? Math.min(...around.map((bg) => ratio(over(own, bg), bg))) : 0,
    );
    if (best < 3) report.lowControlContrast.push(`${name(el)} ${best.toFixed(2)}`);
    if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.placeholder && el.value === '') {
      const ph = parse(getComputedStyle(el, '::placeholder').color);
      const field = backgrounds(el);
      const solid = parse(s.backgroundColor);
      const bgs = field.map((bg) => over(solid, bg));
      const r = Math.min(...bgs.map((bg) => ratio(over(ph, bg), bg)));
      if (r < 4.5) report.lowPlaceholder.push(`${name(el)} ${r.toFixed(2)}`);
    }
  }
  return report;
};

export const sizes = (page: Page, allow: string[] = []) => page.evaluate(measureSizes, { allow });

export const EMPTY_REPORT: Pick<SizeReport, 'smallTargets' | 'offscreen' | 'smallText' | 'lowTextContrast' | 'lowControlContrast' | 'lowPlaceholder'> = {
  smallTargets: [], offscreen: [], smallText: [], lowTextContrast: [], lowControlContrast: [], lowPlaceholder: [],
};

/**
 * Hit areas of the ghosts, probed one at a time with the others' pointer events switched off, so z-order cannot hide an
 * overlap. Returns pairs whose real hit areas share a probed point. Probes at `step` CSS px over the button +/- 50px.
 */
export const measureGhostOverlap = (opts: { step: number }) => {
  const style = document.createElement('style');
  style.textContent = '[data-ghost]:not([data-probing]) { pointer-events: none !important; }';
  document.head.append(style);
  const ghosts = [...document.querySelectorAll<HTMLElement>('[data-ghost]')];
  const masks = new Map<HTMLElement, Set<string>>();
  for (const g of ghosts) {
    g.scrollIntoView({ block: 'center', inline: 'center' });
    g.setAttribute('data-probing', '');
    const b = g.getBoundingClientRect();
    const mask = new Set<string>();
    for (let y = Math.max(0, b.top - 50); y < Math.min(innerHeight, b.bottom + 50); y += opts.step) {
      for (let x = Math.max(0, b.left - 50); x < Math.min(innerWidth, b.right + 50); x += opts.step) {
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === g || g.contains(hit))) mask.add(`${Math.round((x + scrollX) / opts.step)}:${Math.round((y + scrollY) / opts.step)}`);
      }
    }
    g.removeAttribute('data-probing');
    masks.set(g, mask);
  }
  style.remove();
  const label = (g: HTMLElement) => `${g.dataset.floor}/${g.dataset.slot}`;
  const overlaps: string[] = [];
  for (let i = 0; i < ghosts.length; i++) {
    for (let j = i + 1; j < ghosts.length; j++) {
      const a = masks.get(ghosts[i]!)!;
      let shared = 0;
      for (const key of masks.get(ghosts[j]!)!) if (a.has(key)) shared += 1;
      if (shared > 0) overlaps.push(`${label(ghosts[i]!)} x ${label(ghosts[j]!)} share ${shared} probe points`);
    }
  }
  return { ghosts: ghosts.length, areas: [...masks.values()].map((m) => m.size), overlaps };
};

export const ghostOverlap = (page: Page, step = 2) => page.evaluate(measureGhostOverlap, { step });
