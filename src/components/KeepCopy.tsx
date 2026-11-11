import { useState } from 'preact/hooks';
import { exportFileName } from '../persistence/exportName';
import { serializeSave } from '../persistence/serialize';
import { useCopy } from './useCopy';
import { browserEnv } from '../store/env';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { Dialog } from './Dialog';
import { downloadText } from './download';

/** “留一份副本”：先说明会带走全部原始文字，确认后才下载。存储出问题时按钮更醒目。不提供导入。 */
export function KeepCopy() {
  const t = useCopy();
  const { store } = useAppContext();
  const session = useStore(store.session, (s) => s);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const loud = session.storage === 'unavailable' || session.mode !== 'normal';

  const close = () => {
    setOpen(false);
    setFailed(false);
  };

  const pack = () => {
    try {
      downloadText(exportFileName(browserEnv().today()), serializeSave(store.getState()));
    } catch {
      setFailed(true);
      return;
    }
    close();
  };

  return (
    <>
      <button type="button" class={loud ? 'keep-copy loud' : 'keep-copy'} onClick={() => setOpen(true)}>
        {t('keep.button')}
      </button>
      {open ? (
        <Dialog labelledBy="keep-title" onClose={close}>
          <h2 id="keep-title">{t('keep.title')}</h2>
          <p>{t('keep.body')}</p>
          {failed ? <p class="form-error" role="alert">{t('keep.failed')}</p> : null}
          <div class="dialog-actions">
            <button type="button" class="primary" onClick={pack}>{t('keep.yes')}</button>
            <button type="button" onClick={close}>{t('keep.no')}</button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
