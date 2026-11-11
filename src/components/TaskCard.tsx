import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { evaluate, isClarified, isPendingConfirmation } from '../domain/evaluate';
import { progress } from '../domain/progress';
import { codePointLength, CRITERIA_MAX } from '../domain/validate';
import { useCopy } from './useCopy';
import { useSampleText } from './useSampleText';
import type { Translate } from '../i18n/t';
import type { UserError } from '../domain/types';
import { useDemoControl } from '../demo/control';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { ConfirmDialog } from './ConfirmDialog';
import { MoveOutDialog } from './MoveOutDialog';
import { StepList } from './StepList';
import { prefersReducedMotion } from './useReducedMotion';
import { stageSpot, TOP_EMPTY_RATIO } from '../house/stageSpot';
import { stageBusOf } from '../store/stageBus';
import { revealAboveDrawer } from './revealAboveDrawer';
import { stateLabel, STATE_ICON } from './stateText';
import { canHoldFocus, settleFocus } from './focusFallback';

export interface TaskCardProps {
  taskId: string;
}

function missingText(hasCriteria: boolean, hasSteps: boolean, t: Translate): string | null {
  if (hasCriteria && hasSteps) return null;
  if (!hasCriteria && !hasSteps) return t('card.missing.both');
  return t(hasCriteria ? 'card.missing.steps' : 'card.missing.criteria');
}

/**
 * 非模态详情抽屉：所有视口都从底部滑出的半透明磨砂面板。打开时焦点到标题；关闭只通过关闭按钮与 Esc。
 * 打开（或换选另一只）后，被选中的 Ghost 会被最小幅度地滚到抽屉上方的可视区。
 */
export function TaskCard({ taskId }: TaskCardProps) {
  const t = useCopy();
  const sampleText = useSampleText();
  const ctx = useAppContext();
  const { store, ui } = ctx;
  const demo = useDemoControl();
  const task = useStore(store, (s) => s.tasks.find((x) => x.id === taskId) ?? null);
  const confirmingId = useStore(store.flow, (f) => f.confirmingId);
  const heading = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState(sampleText(task?.criteria ?? ''));
  const [error, setError] = useState<Extract<UserError, { kind: 'criteria-too-long' }> | null>(null);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [movingOut, setMovingOut] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'textarea' | 'edit' | null>(null);

  const drawer = useRef<HTMLElement>(null);

  useEffect(() => {
    // 刚从示例回来时，焦点留给“Try sample”。
    if (!demo.returning()) heading.current?.focus({ preventScroll: true });
  }, [taskId]);
  // 表单与只读行互换后，原来拿着焦点的按钮已被移除：焦点要在同一次提交里交给“编辑”或输入框。
  // 不能放进下一帧才执行的 useEffect：迟到时会把玩家已移到步骤框的焦点抢回来；
  // 上一轮还没执行的副作用也会在这一轮渲染开始前抢先取走标记，焦点就掉进空处。
  useLayoutEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === 'textarea') textarea.current?.focus({ preventScroll: true });
    else if (target === 'edit') editButton.current?.focus({ preventScroll: true });
  });

  // 页面底部留出抽屉的高度，然后把被选中的 Ghost 露在抽屉上方。
  useLayoutEffect(() => {
    const el = drawer.current;
    if (!el) return;
    const bus = stageBusOf(ctx);
    const selectedGhost = () => document.querySelector<HTMLElement>('[data-ghost][aria-pressed="true"]');
    // 把抽屉的最终位置（用布局高度算，不受滑入动画影响）告诉小舞台：被选的 Ghost 会飞到它的上沿。
    const publish = () => {
      const r = el.getBoundingClientRect();
      bus.set({ left: r.left, width: r.width, top: window.innerHeight - 8 - el.offsetHeight });
    };
    const sync = () => {
      const root = document.documentElement.style;
      root.setProperty('--drawer-h', `${el.offsetHeight + 16}px`);
      // 站在抽屉上沿的 Ghost 占掉的高度：减少动态时的文字提示要躲在它的上面，不盖住它。
      const g = selectedGhost();
      root.setProperty('--stage-h', g ? `${Math.ceil(g.offsetHeight * (1 - TOP_EMPTY_RATIO))}px` : '0px');
      publish();
    };
    // 小舞台放得下时，被选的 Ghost 自己飞到抽屉上沿，房子不用动；放不下才滚动露出（兜底）。
    const stageFits = () => {
      const g = selectedGhost();
      const box = bus.get();
      return !!g && !!box && stageSpot(box, { width: g.offsetWidth, height: g.offsetHeight }, window.innerWidth).fits;
    };
    const reveal = () => {
      sync();
      if (stageFits()) return;
      revealAboveDrawer(el, selectedGhost(), !prefersReducedMotion());
    };
    reveal();
    const late = setTimeout(reveal, 450);
    // 抽屉高度变了（例如勾完最后一步多出“确认完成”）：重新把被选的 Ghost 露在抽屉上方。
    let lastHeight = el.offsetHeight;
    const onResize = () => {
      sync();
      if (el.offsetHeight === lastHeight) return;
      lastHeight = el.offsetHeight;
      if (!stageFits()) reveal();
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
    observer?.observe(el);
    window.addEventListener('resize', reveal);
    return () => {
      clearTimeout(late);
      observer?.disconnect();
      window.removeEventListener('resize', reveal);
      bus.set(null);
    };
  }, [taskId]);
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--drawer-h');
      document.documentElement.style.removeProperty('--stage-h');
    },
    [],
  );

  if (!task) return null;

  const state = evaluate(task);
  const pending = isPendingConfirmation(task);
  const { done, total } = progress(task);
  const needsDone = total > 0 && done === total && task.criteria.trim().length === 0;
  const missing = isClarified(task)
    ? null
    : needsDone
      ? t('card.missing.lastThing')
      : missingText(task.criteria.trim().length > 0, task.steps.length > 0, t);
  const count = codePointLength(draft);
  const hasSaved = task.criteria.trim().length > 0;
  const showForm = !hasSaved || editing;

  const close = () => {
    ui.closeCard();
    const trigger = ui.takeTrigger();
    if (canHoldFocus(trigger)) trigger.focus();
    // 触发它的 Ghost 按钮若已经不在，焦点交给创建框或页面标题。
    settleFocus();
  };

  const save = (e: Event) => {
    e.preventDefault();
    const result = store.dispatch({ type: 'SetCriteria', taskId: task.id, criteria: draft });
    if (result.error?.kind === 'criteria-too-long') {
      setSaved(false);
      return setError(result.error);
    }
    setError(null);
    setSaved(true);
    setEditing(false);
    focusNext.current = 'edit';
  };

  const startEdit = () => {
    setDraft(sampleText(task.criteria));
    setError(null);
    setSaved(false);
    setEditing(true);
    focusNext.current = 'textarea';
  };

  const cancelEdit = () => {
    setDraft(sampleText(task.criteria));
    setError(null);
    setSaved(false);
    setEditing(false);
    focusNext.current = 'edit';
  };

  return (
    <aside ref={drawer} class="task-card" aria-label={t('card.label')} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div class="card-head">
        <h2 ref={heading} tabIndex={-1}>{sampleText(task.title)}</h2>
        <div class="card-head-actions">
          <button type="button" class="move-out" onClick={() => setMovingOut(true)}>{t('moveOut.button')}</button>
          <button type="button" class="card-close" onClick={close}>{t('card.close')}</button>
        </div>
      </div>

      <div class="card-scroll">
      <p class="card-state" data-state={state} data-pending={pending ? 'true' : 'false'}>
        <span aria-hidden="true">{STATE_ICON[state]}</span> <span>{stateLabel(task, t)}</span>
        {total > 0 ? <>{' · '}<span>{t('ghost.progress', { done, total })}</span></> : null}
      </p>
      {missing ? <p class={needsDone ? 'muted last-thing' : 'muted'} id="criteria-hint" data-needs-criteria={needsDone ? 'true' : undefined}>{needsDone ? '✎ ' : ''}{missing}</p> : null}

      {showForm ? (
      <form class={needsDone ? 'criteria needs-done' : 'criteria'} data-needs-criteria={needsDone ? 'true' : undefined} onSubmit={save} noValidate>
        <label for="criteria">{t('criteria.label')}</label>
        <textarea
          ref={textarea}
          id="criteria"
          rows={3}
          value={draft}
          placeholder={t('criteria.placeholder')}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={needsDone ? 'criteria-hint' : undefined}
          onInput={(e) => {
            setDraft((e.currentTarget as HTMLTextAreaElement).value);
            setSaved(false);
          }}
        />
        <p class="count" aria-hidden="true">{t('criteria.count', { count, max: CRITERIA_MAX })}</p>
        <button type="submit">{t('criteria.save')}</button>
        {hasSaved ? <button type="button" onClick={cancelEdit}>{t('criteria.cancel')}</button> : null}
        {error ? <p class="form-error" role="alert">{t('criteria.error', { length: error.length, max: error.max })}</p> : null}
      </form>
      ) : (
      <div class="criteria criteria-read">
        <p class="criteria-title">{t('criteria.label')}</p>
        <p class="criteria-text">{sampleText(task.criteria)}</p>
        <button type="button" ref={editButton} onClick={startEdit}>{t('criteria.edit')}</button>
        {saved ? <p class="muted">{t('criteria.saved')}</p> : null}
      </div>
      )}

      <StepList task={task} />

      {pending ? (
        <div class="pending-box">
          <span class="pending-badge">{t('state.pending')}</span>
          <button type="button" class="primary" onClick={() => store.dispatch({ type: 'BeginConfirm', taskId: task.id })}>
            {t('confirm.button')}
          </button>
        </div>
      ) : null}
      {confirmingId === task.id && pending ? <ConfirmDialog task={task} /> : null}

      {movingOut ? <MoveOutDialog task={task} onClose={() => setMovingOut(false)} /> : null}
      </div>
    </aside>
  );
}
