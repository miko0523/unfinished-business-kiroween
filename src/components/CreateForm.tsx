import { useEffect, useRef, useState } from 'preact/hooks';
import type { UserError } from '../domain/types';
import { useCopy } from './useCopy';
import type { Translate } from '../i18n/t';
import { useAppContext } from '../store/StoreContext';
import { FullHouseNotice } from './FullHouseNotice';
import { focusResidents } from './ResidentList';

function messageFor(error: UserError, t: Translate): string {
  switch (error.kind) {
    case 'title-empty':
      return t('create.error.empty', { max: error.max });
    case 'title-too-long':
      return t('create.error.tooLong', { length: error.length, max: error.max });
    case 'save-failed':
      return t('create.error.save');
    default:
      return t('create.error.empty', { max: 80 });
  }
}

/** 纯文本输入框：被拒绝时说明原因与上限，并保留草稿。 */
export function CreateForm() {
  const t = useCopy();
  const { store } = useAppContext();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<UserError | null>(null);
  const [full, setFull] = useState(false);
  const focusList = useRef(false);

  // “去看看住客”：对话框收起、焦点还回之后，再把焦点交给住客列表。
  useEffect(() => {
    if (!full && focusList.current) {
      focusList.current = false;
      focusResidents();
    }
  });

  const submit = (e: Event) => {
    e.preventDefault();
    const result = store.dispatch({ type: 'CreateTask', title: draft });
    if (result.error?.kind === 'house-full') {
      // 住满了：草稿原样留着，温柔地告诉她。
      setError(null);
      setFull(true);
      return;
    }
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setDraft('');
  };

  return (
    <form class="create-form" onSubmit={submit} noValidate>
      <label for="create-title">{t('create.label')}</label>
      <div class="create-row">
        <input
          id="create-title"
          type="text"
          autocomplete="off"
          value={draft}
          placeholder={t('create.placeholder')}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'create-error' : undefined}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit">{t('create.submit')}</button>
      </div>
      {error ? (
        <p id="create-error" class="create-error" role="alert">
          {messageFor(error, t)}
        </p>
      ) : null}
      {full ? (
        <FullHouseNotice
          onVisit={() => {
            focusList.current = true;
            setFull(false);
          }}
          onLater={() => setFull(false)}
        />
      ) : null}
    </form>
  );
}
