import { useState } from 'preact/hooks';
import type { Task, UserError } from '../domain/types';
import { useCopy } from './useCopy';
import { useSampleText } from './useSampleText';
import type { Translate } from '../i18n/t';
import { useAppContext } from '../store/StoreContext';

function stepMessage(error: UserError, t: Translate): string {
  switch (error.kind) {
    case 'step-empty':
      return t('steps.error.empty', { max: error.max });
    case 'step-too-long':
      return t('steps.error.tooLong', { length: error.length, max: error.max });
    case 'too-many-steps':
      return t('steps.error.tooMany', { max: error.max });
    default:
      return t('steps.error.empty', { max: 80 });
  }
}

export interface StepListProps {
  task: Task;
}

/** 步骤：勾选、新增、编辑、删除、上移与下移（不依赖拖拽）。 */
export function StepList({ task }: StepListProps) {
  const t = useCopy();
  const sampleText = useSampleText();
  const { store } = useAppContext();
  const [draft, setDraft] = useState('');
  const [addError, setAddError] = useState<UserError | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<UserError | null>(null);

  const add = (e: Event) => {
    e.preventDefault();
    const result = store.dispatch({ type: 'AddStep', taskId: task.id, title: draft });
    if (result.error) return setAddError(result.error);
    setAddError(null);
    setDraft('');
  };

  const saveEdit = (stepId: string) => {
    const result = store.dispatch({ type: 'EditStep', taskId: task.id, stepId, title: editDraft });
    if (result.error) return setEditError(result.error);
    setEditError(null);
    setEditingId(null);
  };

  return (
    <section class="steps" aria-labelledby="steps-heading">
      <h3 id="steps-heading">{t('steps.heading')}</h3>
      {task.steps.length === 0 ? <p class="muted">{t('steps.empty')}</p> : null}
      <ol class="step-list">
        {task.steps.map((step, i) => {
          const name = (action: string) => t('steps.action', { action, title: sampleText(step.title) });
          return (
            <li key={step.id} class="step" data-done={step.done ? 'true' : 'false'}>
              {editingId === step.id ? (
                <div class="step-edit">
                  <label for={`edit-${i}`}>{t('steps.edit.label')}</label>
                  <input
                    id={`edit-${i}`}
                    type="text"
                    autocomplete="off"
                    value={editDraft}
                    aria-invalid={editError ? 'true' : undefined}
                    onInput={(e) => setEditDraft((e.currentTarget as HTMLInputElement).value)}
                  />
                  <button type="button" onClick={() => saveEdit(step.id)}>{t('steps.save')}</button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                      setEditError(null);
                    }}
                  >
                    {t('steps.cancel')}
                  </button>
                  {editError ? <p class="form-error" role="alert">{stepMessage(editError, t)}</p> : null}
                </div>
              ) : (
                <>
                  <label class="step-check">
                    <input
                      type="checkbox"
                      checked={step.done}
                      onChange={() => store.dispatch({ type: 'ToggleStep', taskId: task.id, stepId: step.id })}
                    />
                    <span>{sampleText(step.title)}</span>
                  </label>
                  <span class="step-actions">
                    <button
                      type="button"
                      aria-label={name(t('steps.edit'))}
                      onClick={() => {
                        setEditingId(step.id);
                        setEditDraft(sampleText(step.title));
                        setEditError(null);
                      }}
                    >
                      {t('steps.edit')}
                    </button>
                    <button type="button" aria-label={name(t('steps.up'))} disabled={i === 0} onClick={() => store.dispatch({ type: 'MoveStep', taskId: task.id, stepId: step.id, direction: 'up' })}>
                      ↑
                    </button>
                    <button type="button" aria-label={name(t('steps.down'))} disabled={i === task.steps.length - 1} onClick={() => store.dispatch({ type: 'MoveStep', taskId: task.id, stepId: step.id, direction: 'down' })}>
                      ↓
                    </button>
                    <button type="button" aria-label={name(t('steps.delete'))} onClick={() => store.dispatch({ type: 'DeleteStep', taskId: task.id, stepId: step.id })}>
                      {t('steps.delete')}
                    </button>
                  </span>
                </>
              )}
            </li>
          );
        })}
      </ol>
      <form class="step-add" onSubmit={add} noValidate>
        <label for="step-new">{t('steps.add.label')}</label>
        <div class="create-row">
          <input
            id="step-new"
            type="text"
            autocomplete="off"
            value={draft}
            aria-invalid={addError ? 'true' : undefined}
            onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="submit">{t('steps.add.submit')}</button>
        </div>
        {addError ? <p class="form-error" role="alert">{stepMessage(addError, t)}</p> : null}
      </form>
    </section>
  );
}
