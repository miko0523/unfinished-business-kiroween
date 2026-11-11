// 领域属性测试共用：把随机的抽象操作落到 state 里当前真实存在的任务上，让主线动作真的会生效。
import fc from 'fast-check';
import { reduce } from '../../src/domain/reducer';
import { emptyState, type Action, type AnimEvent, type AppState, type Env, type UserError } from '../../src/domain/types';

export function sequenceEnv(): Env {
  let n = 0;
  return { now: () => '2026-11-08T09:00:00.000Z', today: () => '2026-11-08', newId: () => `id-${++n}` };
}

export type Op =
  | { k: 'create'; text: string }
  | { k: 'criteria'; i: number; text: string }
  | { k: 'add'; i: number; text: string }
  | { k: 'toggle'; i: number; j: number }
  | { k: 'delete'; i: number }
  | { k: 'confirm'; i: number }
  | { k: 'ghost-delete' };

export const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 8, arbitrary: fc.string({ minLength: 1, maxLength: 12 }).map<Op>((text) => ({ k: 'create', text: text.trim() || 'x' })) },
  { weight: 3, arbitrary: fc.record({ k: fc.constant('criteria' as const), i: fc.nat(20), text: fc.string({ maxLength: 12 }) }) },
  { weight: 4, arbitrary: fc.record({ k: fc.constant('add' as const), i: fc.nat(20), text: fc.string({ maxLength: 12 }) }) },
  { weight: 5, arbitrary: fc.record({ k: fc.constant('toggle' as const), i: fc.nat(20), j: fc.nat(20) }) },
  { weight: 2, arbitrary: fc.nat(20).map<Op>((i) => ({ k: 'delete', i })) },
  { weight: 6, arbitrary: fc.nat(20).map<Op>((i) => ({ k: 'confirm', i })) },
  { weight: 1, arbitrary: fc.constant<Op>({ k: 'ghost-delete' }) },
);
const randomOps = fc.array(opArb, { minLength: 10, maxLength: 160 });
/** 先随机，再确认满十三次（灯数封顶）、住满十位并多创建一次（满员被拒）。 */
const fillOps: Op[] = [
  ...Array.from({ length: 13 }, (): Op[] => [{ k: 'create', text: 'x' }, { k: 'confirm', i: 0 }]).flat(),
  ...Array.from({ length: 11 }, (): Op => ({ k: 'create', text: 'y' })),
];
export const opsArb: fc.Arbitrary<Op[]> = fc.oneof(
  { weight: 3, arbitrary: randomOps },
  { weight: 1, arbitrary: fc.array(opArb, { maxLength: 40 }).map((head) => [...head, ...fillOps]) },
);

export interface Applied {
  op: Op;
  before: AppState;
  after: AppState;
  events: AnimEvent[];
  error?: UserError;
  /** 被操作的任务（操作前的样子）；create 与 ghost-delete 没有。 */
  target?: AppState['tasks'][number];
  /** 这一步是否真的确认成功了一只。 */
  confirmed: boolean;
}

function step(state: AppState, action: Action, env: Env) {
  return reduce(state, action, env);
}

/** 把一只任务推到“等待确认”：补完成条件、至少一步、全部勾上（已勾的不再动）。 */
export function toPending(state: AppState, id: string, env: Env): AppState {
  let s = state;
  const need = () => s.tasks.find((t) => t.id === id)!;
  if (need().criteria.trim().length === 0) s = step(s, { type: 'SetCriteria', taskId: id, criteria: 'Tidy' }, env).state;
  if (need().steps.length === 0) s = step(s, { type: 'AddStep', taskId: id, title: 'one' }, env).state;
  for (const st of need().steps) if (!st.done) s = step(s, { type: 'ToggleStep', taskId: id, stepId: st.id }, env).state;
  return s;
}

export function applyOp(state: AppState, op: Op, env: Env): Applied {
  const pick = (i: number) => (state.tasks.length > 0 ? state.tasks[i % state.tasks.length]! : undefined);
  const out = (r: ReturnType<typeof reduce>, extra: Partial<Applied> = {}): Applied => ({ op, before: state, after: r.state, events: r.events, error: r.error, confirmed: false, ...extra });
  switch (op.k) {
    case 'create':
      return out(step(state, { type: 'CreateTask', title: op.text }, env));
    case 'ghost-delete':
      return out(step(state, { type: 'DeleteTask', taskId: 'nobody' }, env));
    case 'criteria': {
      const t = pick(op.i);
      return t ? out(step(state, { type: 'SetCriteria', taskId: t.id, criteria: op.text }, env), { target: t }) : out({ state, events: [] });
    }
    case 'add': {
      const t = pick(op.i);
      return t ? out(step(state, { type: 'AddStep', taskId: t.id, title: op.text }, env), { target: t }) : out({ state, events: [] });
    }
    case 'toggle': {
      const t = pick(op.i);
      const st = t?.steps[op.j % Math.max(1, t.steps.length)];
      return t && st ? out(step(state, { type: 'ToggleStep', taskId: t.id, stepId: st.id }, env), { target: t }) : out({ state, events: [] });
    }
    case 'delete': {
      const t = pick(op.i);
      return t ? out(step(state, { type: 'DeleteTask', taskId: t.id }, env), { target: t }) : out({ state, events: [] });
    }
    case 'confirm': {
      const t = pick(op.i);
      if (!t) return out({ state, events: [] });
      const pending = toPending(state, t.id, env);
      const begun = step(pending, { type: 'BeginConfirm', taskId: t.id }, env);
      const done = step(begun.state, { type: 'ConfirmComplete', taskId: t.id, memo: '' }, env);
      return { op, before: state, after: done.state, events: done.events, error: done.error, target: t, confirmed: done.error === undefined };
    }
  }
}

/** 依次应用操作，每一步交给 visit 检查。 */
export function runOps(ops: readonly Op[], visit: (a: Applied, index: number) => void, env: Env = sequenceEnv()): AppState {
  let s = emptyState();
  ops.forEach((op, index) => {
    const a = applyOp(s, op, env);
    visit(a, index);
    s = a.after;
  });
  return s;
}
