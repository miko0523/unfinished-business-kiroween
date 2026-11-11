// 纯函数 reducer：reduce(state, action, env) → { state, events, error? }。
// 被拒绝的动作返回原 state 引用与 error，不产生事件。
import { evaluate, isPendingConfirmation } from './evaluate';
import { choreFor, progress } from './progress';
import { allocate, floorsNeeded, MAX_RESIDENTS, slotKey } from './slots';
import { lampsFor } from './house';
import { lanternDue, newGhostKind } from './collection';
import type { Action, AnimEvent, AppState, Env, MemorialEntry, ReduceResult, Task, UserError } from './types';
import { canAddStep, STEPS_MAX, validateCriteria, validateMemo, validateStepTitle, validateTitle } from './validate';

function reject(state: AppState, error: UserError): ReduceResult {
  return { state, events: [], error };
}

/** 替换一个 Task，返回新的 tasks 数组。 */
function withTask(state: AppState, next: Task): AppState {
  return { ...state, tasks: state.tasks.map((t) => (t.id === next.id ? next : t)) };
}

/** 由 Task 前后变化推出的状态类事件。 */
function changeEvents(before: Task, after: Task): AnimEvent[] {
  const events: AnimEvent[] = [];
  const from = evaluate(before);
  const to = evaluate(after);
  const { id: taskId, slot } = after;
  if (from !== to) {
    events.push({ type: 'StateChanged', taskId, slot, from, to });
    if (from === 'gray' && to === 'white') events.push({ type: 'ClarifiedTransition', taskId, slot });
  }
  if (!isPendingConfirmation(before) && isPendingConfirmation(after)) {
    events.push({ type: 'PendingEntered', taskId, slot });
  }
  return events;
}

export function reduce(state: AppState, action: Action, env: Env): ReduceResult {
  switch (action.type) {
    case 'SetLang':
      return {
        state: state.settings.lang === action.lang ? state : { ...state, settings: { ...state.settings, lang: action.lang } },
        events: [],
      };
    case 'CreateTask': {
      const title = validateTitle(action.title);
      if (!title.ok) return reject(state, title.error);
      if (state.tasks.length >= MAX_RESIDENTS) return reject(state, { kind: 'house-full' });
      const slot = allocate(new Set(state.tasks.map((t) => slotKey(t.slot))));
      if (!slot) return reject(state, { kind: 'house-full' });

      const task: Task = {
        ghostKind: newGhostKind(state, env),
        id: env.newId(),
        ghostNo: state.nextGhostNo,
        title: title.value,
        criteria: '',
        steps: [],
        slot,
        createdAt: env.now(),
      };
      const needed = floorsNeeded(state.tasks.length + 1);
      const grown = Math.max(state.house.grownFloors, needed) as typeof state.house.grownFloors;
      const events: AnimEvent[] = [{ type: 'GhostMovedIn', taskId: task.id, slot }];
      if (grown > state.house.grownFloors) events.push({ type: 'FloorGrown', floor: grown });
      return {
        state: {
          ...state,
          tasks: [...state.tasks, task],
          ...(lanternDue(state) ? { collection: { lanternWelcomed: true } } : {}),
          house: grown === state.house.grownFloors ? state.house : { ...state.house, grownFloors: grown },
          nextGhostNo: state.nextGhostNo + 1,
        },
        events,
      };
    }

    case 'SetCriteria': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      const criteria = validateCriteria(action.criteria);
      if (!criteria.ok) return reject(state, criteria.error);
      const next: Task = { ...task, criteria: criteria.value };
      return { state: withTask(state, next), events: changeEvents(task, next) };
    }

    case 'AddStep': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      const title = validateStepTitle(action.title);
      if (!title.ok) return reject(state, title.error);
      if (!canAddStep(task.steps.length)) return reject(state, { kind: 'too-many-steps', max: STEPS_MAX });
      const next: Task = { ...task, steps: [...task.steps, { id: env.newId(), title: title.value, done: false }] };
      return { state: withTask(state, next), events: changeEvents(task, next) };
    }

    case 'ToggleStep': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      const index = task.steps.findIndex((s) => s.id === action.stepId);
      if (index < 0) return reject(state, { kind: 'not-found' });
      const step = task.steps[index]!;
      const next: Task = {
        ...task,
        steps: task.steps.map((s, i) => (i === index ? { ...s, done: !s.done } : s)),
      };
      const first: AnimEvent = step.done
        ? { type: 'EraserScribble', taskId: task.id, slot: task.slot }
        : { type: 'StepChecked', taskId: task.id, slot: task.slot, chore: choreFor(index) };
      return { state: withTask(state, next), events: [first, ...changeEvents(task, next)] };
    }

    case 'EditStep': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      if (!task.steps.some((s) => s.id === action.stepId)) return reject(state, { kind: 'not-found' });
      const title = validateStepTitle(action.title);
      if (!title.ok) return reject(state, title.error);
      const next: Task = { ...task, steps: task.steps.map((s) => (s.id === action.stepId ? { ...s, title: title.value } : s)) };
      return { state: withTask(state, next), events: [] };
    }

    case 'DeleteStep': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      if (!task.steps.some((s) => s.id === action.stepId)) return reject(state, { kind: 'not-found' });
      const next: Task = { ...task, steps: task.steps.filter((s) => s.id !== action.stepId) };
      return { state: withTask(state, next), events: changeEvents(task, next) };
    }

    case 'MoveStep': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      const from = task.steps.findIndex((s) => s.id === action.stepId);
      if (from < 0) return reject(state, { kind: 'not-found' });
      const to = action.direction === 'up' ? from - 1 : from + 1;
      if (to < 0 || to >= task.steps.length) return reject(state, { kind: 'cannot-move' });
      const steps = [...task.steps];
      const [moved] = steps.splice(from, 1);
      steps.splice(to, 0, moved!);
      return { state: withTask(state, { ...task, steps }), events: [] };
    }

    case 'BeginConfirm': {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      if (!isPendingConfirmation(task)) return reject(state, { kind: 'not-pending' });
      return { state, events: [] };
    }

    case 'CancelConfirm':
      return { state, events: [] };

    case 'ConfirmComplete': {
      // 已确认的 Task 不在 tasks 里，所以重复确认、编辑已确认 Task 都会走到 not-found。
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      if (!isPendingConfirmation(task)) return reject(state, { kind: 'not-pending' });
      const memo = validateMemo(action.memo);
      if (!memo.ok) return reject(state, { kind: 'memo-too-long', length: memo.length, max: memo.max });
      const entry: MemorialEntry = {
        ...(task.ghostKind ? { ghostKind: task.ghostKind } : {}),
        id: env.newId(),
        title: task.title,
        titleVisible: false,
        completedOn: env.today(),
        stepCount: task.steps.length,
        memo: memo.value,
        confirmedAt: env.now(),
      };
      const completedCount = state.house.completedCount + 1;
      const events: AnimEvent[] = [{ type: 'Confirmed', taskId: task.id, slot: task.slot, entryId: entry.id }];
      if (lampsFor(completedCount) > lampsFor(state.house.completedCount)) {
        events.push({ type: 'WarmLampAdded', n: lampsFor(completedCount) });
      }
      return {
        state: {
          ...state,
          tasks: state.tasks.filter((t) => t.id !== task.id),
          archive: [...state.archive, entry],
          house: { ...state.house, completedCount },
        },
        events,
      };
    }

    case 'DeleteTask': {
      // 只移除这一只：archive、house（含 grownFloors 与暖灯计数）和其他 Task 的引用都原样保留。
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return reject(state, { kind: 'not-found' });
      const event: AnimEvent = {
        ...(task.ghostKind === 'lantern' ? { ghostKind: task.ghostKind } : {}),
        type: 'MovedOutQuietly',
        taskId: task.id,
        slot: task.slot,
        state: evaluate(task),
        ratio: progress(task).ratio,
        pending: isPendingConfirmation(task),
      };
      return { state: { ...state, tasks: state.tasks.filter((t) => t.id !== task.id) }, events: [event] };
    }

    case 'ToggleTitleVisible': {
      if (!state.archive.some((e) => e.id === action.entryId)) return reject(state, { kind: 'not-found' });
      return {
        state: {
          ...state,
          archive: state.archive.map((e) => (e.id === action.entryId ? { ...e, titleVisible: !e.titleVisible } : e)),
        },
        events: [],
      };
    }
  }
}
