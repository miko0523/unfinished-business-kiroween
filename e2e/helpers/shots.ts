import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';

/**
 * 视觉复核用的原图。只有设置了 SHOTS_DIR（旧名 STAGE15_SHOTS_DIR 也认）才会落盘（目录在本地忽略区内、每次运行换一个新子目录）；
 * 普通回归不写任何截图。
 */
export const SHOTS_DIR = process.env.SHOTS_DIR ?? process.env.STAGE15_SHOTS_DIR ?? '';

export async function shot(page: Page, name: string, fullPage = false): Promise<void> {
  if (!SHOTS_DIR) return;
  await mkdir(SHOTS_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOTS_DIR}/${name}.png`, fullPage });
}
