// 把一次 dispatch 产生的事件翻译成给 aria-live 的一句话（取最新数据里的步数）。
import { evaluate, isPendingConfirmation } from '../domain/evaluate';
import { progress } from '../domain/progress';
import type { AnimEvent, AppState } from '../domain/types';
import { forLanguage } from '../i18n/t';

export function announce(events: readonly AnimEvent[], state: AppState): string {
  const t = forLanguage(state.settings.lang);
  const parts: string[] = [];
  const taskOf = (id: string) => state.tasks.find((x) => x.id === id);

  for (const e of events) {
    switch (e.type) {
      case 'GhostMovedIn':
        parts.push(t(taskOf(e.taskId)?.ghostKind === 'lantern' ? 'collection.welcome' : 'create.movedIn'));
        break;
      case 'StepChecked': {
        const task = taskOf(e.taskId);
        if (!task) break;
        const { done, total } = progress(task);
        parts.push(t(`live.chore.${e.chore}`), t('live.progress', { done, total }));
        break;
      }
      case 'EraserScribble': {
        const task = taskOf(e.taskId);
        if (!task) break;
        const { done, total } = progress(task);
        parts.push(t('live.erase', { done, total }));
        break;
      }
      case 'StateChanged': {
        const task = taskOf(e.taskId);
        if (!task) break;
        const name = isPendingConfirmation(task) ? t('state.pending') : t(`state.${evaluate(task)}`);
        parts.push(t('live.state', { state: name }));
        break;
      }
      case 'PendingEntered': {
        // 状态名没变（仍是绿色）时，StateChanged 不会出现，单独播报“等你确认”。
        if (!events.some((x) => x.type === 'StateChanged' && x.taskId === e.taskId)) {
          parts.push(t('live.state', { state: t('state.pending') }));
        }
        break;
      }
      case 'Confirmed':
        parts.push(t('live.flew'));
        break;
      case 'MovedOutQuietly':
        parts.push(t('live.movedOut'));
        break;
      case 'WarmLampAdded':
        parts.push(t('live.lamp'));
        break;
      default:
        break;
    }
  }
  return parts.join(' ');
}
