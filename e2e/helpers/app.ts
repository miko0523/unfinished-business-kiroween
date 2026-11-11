import { expect, type Locator, type Page } from '@playwright/test';

export const titleInput = (page: Page) => page.getByLabel('What is still waiting for you?');
export const welcome = (page: Page) => page.getByRole('button', { name: 'Welcome a little ghost' });
export const ghosts = (page: Page) => page.locator('[data-ghost]');
export const card = (page: Page) => page.getByRole('complementary', { name: 'Little ghost details' });

/** 页面就绪：静态图片都已解码。 */
export async function ready(page: Page, path = '/') {
  await page.goto(path);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.static-layer img')].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0),
  );
}

export async function create(page: Page, title: string) {
  await titleInput(page).fill(title);
  await welcome(page).click();
}

/** Ghost 会四处飘动，所以直接派发点击，而不是等它静止。 */
export async function openGhost(ghost: Locator) {
  await ghost.dispatchEvent('click');
  await expect(ghost).toHaveAttribute('aria-pressed', 'true');
}

export async function addStep(page: Page, title: string) {
  await card(page).getByLabel('Add a small step').fill(title);
  await card(page).getByRole('button', { name: 'Add step' }).click();
}

export const criteriaEdit = (page: Page) => card(page).getByRole('button', { name: 'Edit', exact: true });
export const criteriaField = (page: Page) => card(page).getByLabel('What does "done" look like?');

export async function setCriteria(page: Page, text: string) {
  if (await criteriaEdit(page).count()) await criteriaEdit(page).click();
  await card(page).getByLabel('What does "done" look like?').fill(text);
  await card(page).getByRole('button', { name: 'Save', exact: true }).click();
}

/** 读 Ghost 身体填充的饱和度（hsl 的 S）；非 hsl（灰、白）返回 0。 */
export async function saturation(ghost: Locator): Promise<number> {
  const fill = (await ghost.locator('.ghost-body').getAttribute('fill')) ?? '';
  const m = /hsl\(\s*\d+,\s*([\d.]+)%/.exec(fill);
  return m ? Number(m[1]) : 0;
}
