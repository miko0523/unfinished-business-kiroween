import { useState } from 'preact/hooks';
import { codePointLength, MEMO_MAX } from '../domain/validate';
import type { Task, UserError } from '../domain/types';
import { useCopy } from './useCopy';
import { useDemoControl } from '../demo/control';
import { useAppContext } from '../store/StoreContext';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  task: Task;
}

/** “确认完成 / 再想想”对话框，附 0–140 字的可选留言。 */
export function ConfirmDialog({ task }: ConfirmDialogProps) {
  const t = useCopy();
  const { store, ui } = useAppContext();
  const demo = useDemoControl();
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<UserError | null>(null);
  const count = codePointLength(memo);

  const close = () => store.dispatch({ type: 'CancelConfirm', taskId: task.id });

  const confirm = () => {
    const result = store.dispatch({ type: 'ConfirmComplete', taskId: task.id, memo });
    if (!result.error) {
      ui.closeCard();
      return;
    }
    setError(result.error);
  };

  return (
    <Dialog labelledBy="confirm-title" onClose={close}>
      <h3 id="confirm-title">{t('confirm.title')}</h3>
      <p>{t('confirm.body')}</p>
      <label for="confirm-memo">{t('confirm.memo.label')}</label>
      <textarea id="confirm-memo" rows={3} value={memo} onInput={(e) => setMemo((e.currentTarget as HTMLTextAreaElement).value)} />
      <p class="count" aria-hidden="true">{t('criteria.count', { count, max: MEMO_MAX })}</p>
      {error ? <p class="form-error" role="alert">{error.kind === 'memo-too-long'
        ? t('confirm.memo.error', { length: error.length, max: error.max }) : t('confirm.failed')}</p> : null}
      <div class="dialog-actions">
        <button type="button" class="primary" onClick={confirm}>{t('confirm.yes')}</button>
        <button type="button" onClick={close}>{t('confirm.no')}</button>
        {demo.active ? <button type="button" class="demo-exit" onClick={demo.exit}>{t('demo.exit')}</button> : null}
      </div>
    </Dialog>
  );
}
