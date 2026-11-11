import { useRef } from 'preact/hooks';
import type { Task } from '../domain/types';
import { useCopy } from './useCopy';
import { useDemoControl } from '../demo/control';
import { useAppContext } from '../store/StoreContext';
import { Dialog } from './Dialog';

export interface MoveOutDialogProps {
  task: Task;
  onClose(): void;
}

/** 告别一只还没完成的小幽灵：中性的话，不进纪念册，腾出它的房间。 */
export function MoveOutDialog({ task, onClose }: MoveOutDialogProps) {
  const t = useCopy();
  const { store, ui } = useAppContext();
  const demo = useDemoControl();
  const movedOut = useRef(false);

  const confirm = () => {
    const result = store.dispatch({ type: 'DeleteTask', taskId: task.id });
    if (result.error) return onClose();
    movedOut.current = true;
    ui.closeCard();
    ui.takeTrigger();
  };

  // 它的按钮随之消失；对话框收起后，焦点交给创建框，下一只小幽灵可以接着欢迎。
  const restoreFocus = () => (movedOut.current ? document.getElementById('create-title') : null);

  return (
    <Dialog labelledBy="move-out-title" onClose={onClose} restoreFocus={restoreFocus}>
      <h3 id="move-out-title">{t('moveOut.title')}</h3>
      <p>{t('moveOut.body')}</p>
      <div class="dialog-actions">
        <button type="button" class="primary" onClick={confirm}>{t('moveOut.yes')}</button>
        <button type="button" onClick={onClose}>{t('moveOut.no')}</button>
        {demo.active ? <button type="button" class="demo-exit" onClick={demo.exit}>{t('demo.exit')}</button> : null}
      </div>
    </Dialog>
  );
}
