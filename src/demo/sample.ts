// 示例幽灵：二楼左侧的“整理书桌”，条件已填，三个未完成的步骤依次是扫地、浇花、擦窗。
import { forLanguage } from '../i18n/t';
import type { AppState, Env, Settings } from '../domain/types';

export function createSampleState(env: Env, settings: Settings): AppState {
  const t = forLanguage(settings.lang);
  const steps = (['demo.sample.step1', 'demo.sample.step2', 'demo.sample.step3'] as const).map((key) => ({
    id: env.newId(),
    title: t(key),
    done: false,
  }));
  return {
    tasks: [
      {
        id: env.newId(),
        ghostNo: 1,
        title: t('demo.sample.title'),
        criteria: t('demo.sample.criteria'),
        steps,
        slot: { floor: 2, slot: 0 },
        createdAt: env.now(),
      },
    ],
    archive: [],
    house: { grownFloors: 2, completedCount: 0 },
    settings: { ...settings },
    nextGhostNo: 2,
  };
}
