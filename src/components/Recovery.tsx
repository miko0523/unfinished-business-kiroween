import { useState } from 'preact/hooks';
import { damagedCopyFileName } from '../persistence/exportName';
import { isBackupStageError } from '../persistence/recovery';
import { useCopy } from './useCopy';
import { browserEnv } from '../store/env';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { Dialog } from './Dialog';
import { downloadText } from './download';

type Notice = 'copied' | 'copy-failed' | 'backup-failed' | 'open-failed' | null;

/** 旧存档读不了时的专用界面：三个选项，都等玩家主动选择。 */
export function Recovery() {
  const t = useCopy();
  const { store } = useAppContext();
  const raw = useStore(store.session, (s) => s.raw);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const keepCopy = () => {
    if (raw === null) return;
    try {
      downloadText(damagedCopyFileName(browserEnv().today()), raw, 'text/plain;charset=utf-8');
    } catch {
      setNotice('copy-failed');
      return;
    }
    setNotice('copied');
  };

  const startFresh = () => {
    const result = store.startFresh();
    if (result.ok) return; // 离开恢复界面，这个组件随之卸下
    setConfirming(false);
    setNotice(isBackupStageError(result.error) ? 'backup-failed' : 'open-failed');
  };

  const message =
    notice === 'copied'
      ? t('recovery.copy.done')
      : notice === 'copy-failed'
        ? t('recovery.copy.failed')
        : notice === 'backup-failed'
          ? t('recovery.fresh.backupFailed')
          : notice === 'open-failed'
            ? t('recovery.fresh.openFailed')
            : null;
  const isProblem = notice !== null && notice !== 'copied';

  return (
    <section class="recovery" aria-labelledby="recovery-title">
      <h2 id="recovery-title">{t('recovery.title')}</h2>
      <p>{t('recovery.body')}</p>
      {message ? (
        <p class={isProblem ? 'form-error' : 'recovery-note'} role={isProblem ? 'alert' : 'status'}>
          {message}
        </p>
      ) : null}
      <ul class="recovery-options">
        <li>
          <button type="button" onClick={keepCopy}>{t('recovery.copy.button')}</button>
          <p>{t('recovery.copy.hint')}</p>
        </li>
        <li>
          <button type="button" onClick={() => store.continueInMemory()}>{t('recovery.blank.button')}</button>
          <p>{t('recovery.blank.hint')}</p>
        </li>
        <li>
          <button type="button" onClick={() => setConfirming(true)}>{t('recovery.fresh.button')}</button>
          <p>{t('recovery.fresh.hint')}</p>
        </li>
      </ul>
      {confirming ? (
        <Dialog labelledBy="recovery-fresh-title" onClose={() => setConfirming(false)}>
          <h3 id="recovery-fresh-title">{t('recovery.fresh.title')}</h3>
          <p>{t('recovery.fresh.body')}</p>
          <div class="dialog-actions">
            <button type="button" class="primary" onClick={startFresh}>{t('recovery.fresh.yes')}</button>
            <button type="button" onClick={() => setConfirming(false)}>{t('recovery.fresh.no')}</button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
