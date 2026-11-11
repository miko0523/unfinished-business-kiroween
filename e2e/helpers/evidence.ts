import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';

/** Phase 14 evidence root. Every run uses its own sub-directory; originals are never overwritten. */
export const EVIDENCE_ROOT = 'artifacts/phase14/20261109-task-b3416845';
export const RUN = process.env.PHASE14_ARTIFACT_RUN ?? `run-${Date.now()}`;

/** presentation = natural synthetic notes; escaping = HTML-like safety fixtures; measurement = test states. */
export type EvidenceKind = 'presentation' | 'escaping-fixtures' | 'measurement';
export const evidenceDir = (kind: EvidenceKind) => `${EVIDENCE_ROOT}/screenshots/${RUN}/${kind}`;

export async function evidenceShot(page: Page, kind: EvidenceKind, name: string, fullPage = true): Promise<string> {
  const dir = evidenceDir(kind);
  await mkdir(dir, { recursive: true });
  const path = `${dir}/${name}.png`;
  await page.screenshot({ path, fullPage });
  return path;
}
