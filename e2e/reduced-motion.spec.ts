import { expect, test, type Page } from '@playwright/test';
import { forLanguage } from '../src/i18n/t';
import { create, ghosts, openGhost, ready, setCriteria, addStep, card } from './helpers/app';
import { evidenceShot } from './helpers/evidence';
import { audit, displacedResidents, flipTiming, installMotionProbe, sampleAudit, transitions } from './helpers/motion';
import { saveWithArchive, seedSave } from './helpers/save';

// Phase 14.2: the system "reduce motion" setting is followed live. Every scenario starts in normal motion, waits until
// the motion in question is really running (and asserts that the probe sees it), flips the system preference with
// emulateMedia while it is in flight, and measures: how soon the page is clean, that nothing displaces/rotates/scales or
// loops afterwards, and that a static expression or text stands in. Chromium emulation only; not a physical device.

const t = forLanguage('en');
const reduce = (page: Page) => page.emulateMedia({ reducedMotion: 'reduce' });
const normal = (page: Page) => page.emulateMedia({ reducedMotion: 'no-preference' });
// Idle runs measure well under 10ms; one full-suite run under 4-worker load measured 127.5ms for the stage flight (kept in
// logs/final-r2). 200ms is the Reduced_Motion ceiling the spec itself uses and is still "at once" to a person.
const IMMEDIATE_MS = 200;

async function slowAnimations(page: Page, rate: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: rate });
}

/** Waits for the page to report clean after the flip and returns how long that took. */
async function cleanAfterFlip(page: Page, label: string) {
  await expect.poll(async () => (await flipTiming(page)).ms, { message: `${label}: page never reported clean`, timeout: 3000 }).not.toBeNull();
  const timing = await flipTiming(page);
  expect(timing.ms!, `${label}: time from media change to a clean animation list`).toBeLessThanOrEqual(IMMEDIATE_MS);
  expect(await audit(page), `${label}: nothing left after the flip`).toEqual([]);
  return timing.ms!;
}

test.describe('flipping the system setting during motion', () => {
  test('ambient motion (ghost float, halo, fireflies, lamps) stops at once and comes back when the setting is cleared', async ({ page }) => {
    await installMotionProbe(page);
    await seedSave(page, saveWithArchive(3));
    await ready(page);
    await create(page, 'Ambient');
    await expect(page.locator('.warm-lamp')).toHaveCount(3);
    await expect.poll(async () => (await audit(page)).filter((v) => v.kind === 'infinite').length).toBeGreaterThan(3);
    const before = await audit(page);
    expect(before.some((v) => v.target.startsWith('SPAN.firefly'))).toBe(true);
    expect(before.some((v) => v.target.includes('lamp'))).toBe(true);
    await reduce(page);
    const ms = await cleanAfterFlip(page, 'ambient');
    expect(await sampleAudit(page, 1200)).toEqual([]);
    expect(await transitions(page)).toEqual([]);
    expect(await displacedResidents(page)).toEqual([]);
    console.log(`[motion] ambient cleaned in ${ms.toFixed(1)}ms`);
    await normal(page);
    await expect.poll(async () => (await audit(page)).filter((v) => v.kind === 'infinite').length, { timeout: 3000 }).toBeGreaterThan(3);
  });

  test('roaming: a ghost mid-walk snaps home at once and stays home', async ({ page }) => {
    test.setTimeout(120_000);
    await installMotionProbe(page);
    await ready(page);
    await create(page, 'Walker one');
    await create(page, 'Walker two');
    await expect(ghosts(page)).toHaveCount(2);
    await expect(page.locator('.ghost-enter')).toHaveCount(0);
    // Wait until some resident is really walking (a running transform animation on the list item).
    await expect.poll(
      () => page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect).target instanceof HTMLLIElement && a.playState === 'running').length),
      { timeout: 60_000, intervals: [100] },
    ).toBeGreaterThan(0);
    await reduce(page);
    const ms = await cleanAfterFlip(page, 'roaming');
    expect(await displacedResidents(page)).toEqual([]);
    expect(await sampleAudit(page, 4000)).toEqual([]);
    expect(await displacedResidents(page)).toEqual([]);
    console.log(`[motion] roaming cleaned in ${ms.toFixed(1)}ms`);
  });

  test('stage flight: the selected ghost, in flight to the drawer, lands at once instead of gliding', async ({ page }) => {
    await installMotionProbe(page);
    await ready(page);
    await create(page, 'Stage flight');
    await expect(page.locator('.ghost-enter')).toHaveCount(0);
    await slowAnimations(page, 0.1);
    await ghosts(page).first().dispatchEvent('click');
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect).target?.classList?.contains('ghost-button') && a.playState === 'running'))).toBe(true);
    const flying = await page.locator('.ghost-button').evaluate((el) => getComputedStyle(el).transform);
    await reduce(page);
    await cleanAfterFlip(page, 'stage flight in');
    await expect(page.locator('.resident[data-staged]')).toHaveCount(1);
    const staged = await page.locator('.ghost-button').evaluate((el) => ({ transform: getComputedStyle(el).transform, anims: el.getAnimations().length }));
    expect(staged.anims).toBe(0);
    expect(staged.transform).not.toBe(flying); // it arrived, it did not freeze half way
    // Now the flight back: reduce already on, so closing is instant too.
    await card(page).getByRole('button', { name: t('card.close') }).click();
    await expect(page.locator('.resident[data-staged]')).toHaveCount(0);
    expect(await audit(page)).toEqual([]);

    // And the other direction: flip to reduce while it is flying home.
    await normal(page);
    await ghosts(page).first().dispatchEvent('click');
    await expect(page.locator('.resident[data-staged]')).toHaveCount(1);
    await card(page).getByRole('button', { name: t('card.close') }).click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect).target?.classList?.contains('ghost-button') && a.playState === 'running'))).toBe(true);
    await reduce(page);
    await cleanAfterFlip(page, 'stage flight out');
    await expect(page.locator('.resident[data-staged]')).toHaveCount(0);
    expect(await page.locator('.ghost-button').evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });

  test('move-in: a ghost still walking in appears in place at once', async ({ page }) => {
    await installMotionProbe(page);
    await ready(page);
    await slowAnimations(page, 0.1);
    await create(page, 'Newcomer');
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a as CSSAnimation).animationName === 'ghost-move-in'))).toBe(true);
    await reduce(page);
    await cleanAfterFlip(page, 'move-in');
    await expect(page.locator('.ghost-motion')).toHaveCSS('opacity', '1');
    expect(await page.locator('.ghost-motion').evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  });

  test('floor growth: roof lift, new floor reveal and sparkles are cancelled mid-way', async ({ page }) => {
    await installMotionProbe(page);
    await ready(page);
    await create(page, 'Floor one a');
    await create(page, 'Floor one b');
    await expect(ghosts(page)).toHaveCount(2);
    await slowAnimations(page, 0.1);
    await create(page, 'Third resident, new floor');
    await expect(page.locator('.house')).toHaveAttribute('data-growing', 'true');
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect).target?.classList?.contains('grow-sparkle')))).toBe(true);
    await reduce(page);
    await cleanAfterFlip(page, 'floor growth');
    await expect(page.locator('.house')).not.toHaveAttribute('data-growing', 'true');
    await expect(page.locator('.house')).toHaveAttribute('data-grown-floors', '3');
    await expect(page.locator('.grow-sparkle')).toHaveCount(0);
  });

  test('chores and star bursts: a sweep in progress ends in a static posture with text, no props or stars', async ({ page }) => {
    await installMotionProbe(page);
    await ready(page);
    await create(page, 'Chore');
    await expect(page.locator('.ghost-enter')).toHaveCount(0);
    await openGhost(ghosts(page).first());
    await setCriteria(page, 'Done');
    await addStep(page, 'Sweep step');
    await card(page).getByRole('checkbox').check();
    await expect(page.locator('.ghost-play[data-anim="sweep"], .ghost-play[data-anim="water"], .ghost-play[data-anim="window"]')).toHaveCount(1);
    expect((await audit(page)).some((v) => v.kind === 'non-colour')).toBe(true);
    await reduce(page);
    await cleanAfterFlip(page, 'chore');
    await expect(page.locator('.ghost-prop > *')).toHaveCount(0);
    await expect(page.locator('.fx-burst')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText(t('live.progress', { done: 1, total: 1 }));
    await expect(page.getByRole('status')).toHaveAttribute('data-caption', 'true');
  });

  test('archive: opening dust, the landing seal and the lifting mist stop when the setting changes', async ({ page }) => {
    await installMotionProbe(page);
    await seedSave(page, saveWithArchive(3));
    await ready(page);
    await page.goto('/#/archive');
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a as CSSAnimation).animationName === 'dust-puff'))).toBe(true);
    await reduce(page);
    await cleanAfterFlip(page, 'archive');
    await expect(page.locator('.dust').first()).toHaveCSS('display', 'none');
    await expect(page.locator('.archive-entry[data-landing] .stamp-seal')).toHaveCSS('opacity', '1');
    await expect(page.locator('.book')).toHaveCSS('opacity', '1');
    expect(await sampleAudit(page, 2500)).toEqual([]);
    expect(await transitions(page)).toEqual([]);
  });

  test('lantern welcome: the light pulse becomes a static light response', async ({ page }) => {
    await installMotionProbe(page);
    await seedSave(page, saveWithArchive(12));
    await ready(page);
    await create(page, 'Lantern guest');
    await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'true');
    await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a as CSSAnimation).animationName === 'lantern-welcome'))).toBe(true);
    await reduce(page);
    await cleanAfterFlip(page, 'lantern welcome');
    await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'true');
    expect(await page.locator('.warm-lamp').first().evaluate((el) => getComputedStyle(el).filter)).toContain('brightness(1.35)');
    await expect(page.locator('.warm-lamp')).toHaveCount(12);
    await expect(page.getByRole('status')).toContainText(t('collection.welcome'));
  });

  for (const phase of ['gold', 'wave', 'stamp', 'fly'] as const) {
    test(`farewell: reduce arrives during the ${phase} phase and the page settles on the still stamp page`, async ({ page }) => {
      test.setTimeout(60_000);
      await installMotionProbe(page);
      await ready(page);
      await create(page, 'Farewell');
      await openGhost(ghosts(page).first());
      await setCriteria(page, 'Done');
      await addStep(page, 'Only step');
      await card(page).getByRole('checkbox').check();
      await card(page).getByRole('button', { name: t('confirm.button'), exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: t('confirm.yes'), exact: true }).click();
      await expect(page.locator(`.celebration[data-phase="${phase}"]`)).toBeAttached({ timeout: 8000 });
      const before = await audit(page);
      if (phase !== 'stamp') expect(before.length, `${phase}: the probe sees real motion before the flip`).toBeGreaterThan(0);
      await reduce(page);
      await cleanAfterFlip(page, `farewell ${phase}`);
      await expect(page.locator('.celebration')).toHaveAttribute('data-still', 'true');
      await expect(page.locator('.celebration')).toHaveAttribute('data-phase', 'stamp');
      await expect(page.locator('.stamp-page')).toBeVisible();
      await expect(page.locator('.stamp-seal').first()).toHaveCSS('opacity', '1');
      await expect(page.locator('.fly-star, .celebration-trail')).toHaveCount(0);
      await expect(page.locator('.warm-lamp')).toHaveCount(1);
      expect(await sampleAudit(page, 1500)).toEqual([]);
      await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 6000 });
      await expect(page.getByRole('status')).toHaveText(t('live.farewellDone'));
    });
  }

  test('there is no application switch for motion', async ({ page }) => {
    await ready(page);
    await create(page, 'No switch');
    await openGhost(ghosts(page).first());
    const found = await page.evaluate(() => {
      const words = /reduce|motion|animation toggle|减少动态|动效|动态效果/i;
      const hits: string[] = [];
      for (const el of document.querySelectorAll('button, [role="switch"], input, label, a, summary, select')) {
        const text = `${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''} ${(el as HTMLInputElement).name ?? ''} ${el.id}`;
        if (words.test(text)) hits.push(`${el.tagName}:${text.trim().slice(0, 40)}`);
      }
      return { hits, switches: document.querySelectorAll('[role="switch"]').length };
    });
    expect(found.switches).toBe(0);
    expect(found.hits).toEqual([]);
    await page.goto('/#/archive');
    expect(await page.locator('main').innerText()).not.toMatch(/reduce|motion|减少动态/i);
  });
});

test.describe('the main flow with the system setting already on', () => {
  test('create, clarify, check, undo, pending, confirm, welcome: nothing moves, and each event leaves visible text', async ({ page }) => {
    test.setTimeout(60_000);
    await reduce(page);
    await installMotionProbe(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await seedSave(page, saveWithArchive(12));
    await ready(page);
    // A recorder inside the page: every 40ms, violations and the displacement of residents.
    await page.evaluate(() => {
      const w = window as unknown as { __seen: unknown[]; __audit: () => unknown[] };
      w.__seen = [];
      setInterval(() => {
        const a = w.__audit();
        if (a.length) w.__seen.push(a);
      }, 40);
    });
    const caption = async (expected: string) => {
      const status = page.getByRole('status');
      await expect(status).toContainText(expected);
      await expect(status).toHaveAttribute('data-caption', 'true');
      const box = await status.boundingBox();
      expect(box, `caption for "${expected}" is on screen`).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(900);
      expect(await status.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      expect(await status.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
    };
    // Welcome (a lantern, guaranteed after twelve): static text and a static light response.
    await create(page, 'Reduced flow');
    await caption(t('collection.welcome'));
    await expect(page.locator('.warm-lamps')).toHaveAttribute('data-welcoming', 'true');
    await evidenceShot(page, 'measurement', 'reduced-1280-en-welcome-caption', false);
    await openGhost(ghosts(page).first());
    await setCriteria(page, 'Tidy');
    await addStep(page, 'Only step');
    await caption(t('live.state', { state: t('state.white') }));
    await card(page).getByRole('checkbox').check();
    await caption(t('state.pending'));
    await expect(page.locator('.ghost-button')).toHaveAttribute('data-pending', 'true');
    await evidenceShot(page, 'measurement', 'reduced-1280-en-pending-caption', false);
    await card(page).getByRole('checkbox').uncheck();
    await caption(t('live.erase', { done: 0, total: 1 }));
    await expect(page.locator('.ghost-eyes')).toHaveAttribute('data-expression', /puzzled|relieved|shy|happy/);
    await card(page).getByRole('checkbox').check();
    await card(page).getByRole('button', { name: t('confirm.button'), exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: t('confirm.yes'), exact: true }).click();
    await caption(t('live.flew'));
    await expect(page.locator('.celebration')).toHaveAttribute('data-still', 'true');
    await expect(page.locator('.stamp-page')).toBeVisible();
    await expect(page.locator('.warm-lamp')).toHaveCount(12);
    await evidenceShot(page, 'measurement', 'reduced-1280-en-still-stamp', false);
    await expect(page.locator('.celebration')).toHaveCount(0, { timeout: 6000 });
    await caption(t('live.farewellDone'));
    expect(await displacedResidents(page)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __seen: unknown[] }).__seen)).toEqual([]);
    expect(await audit(page)).toEqual([]);
    expect(await transitions(page)).toEqual([]);
    // Archive: static book, mist already lifted, nothing moving.
    await page.goto('/#/archive');
    await expect(page.locator('.mist-tile[data-open="true"]')).toHaveCount(12);
    expect(await sampleAudit(page, 1500)).toEqual([]);
  });

  test('the caption hides after a few seconds, never blocks input, and keeps the text for assistive technology', async ({ page }) => {
    await reduce(page);
    await ready(page);
    await create(page, 'Caption life');
    const status = page.getByRole('status');
    await expect(status).toHaveAttribute('data-caption', 'true');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    // Clicking through it works (pointer-events: none): the create field underneath still takes focus.
    await page.locator('#create-title').click();
    await expect(page.locator('#create-title')).toBeFocused();
    await expect(status).toHaveAttribute('data-caption', 'false', { timeout: 9000 });
    await expect(status).toHaveText(t('create.movedIn'));
  });
});
