// 领域类型。纯数据，不引用 DOM 或 Preact。
export type ISO = string;
export type GhostKind = 'ordinary' | 'lantern';

export interface Step {
  id: string;
  /** 1–80 个码点（已 trim）。 */
  title: string;
  done: boolean;
}

export type FloorNo = 2 | 3 | 4 | 5 | 6;
export type SideNo = 0 | 1;

/** 住客位：slot 0=左，1=右。 */
export interface SlotId {
  floor: FloorNo;
  slot: SideNo;
}

export interface Task {
  /** Absent in legacy saves: ordinary, without drawing again. */
  ghostKind?: GhostKind;
  id: string;
  /** 仅内部排序用，单调递增，不复用，绝不显示给玩家。 */
  ghostNo: number;
  title: string;
  criteria: string;
  steps: Step[];
  slot: SlotId;
  createdAt: ISO;
}

export interface MemorialEntry {
  ghostKind?: GhostKind;
  id: string;
  title: string;
  titleVisible: boolean;
  /** 本地时区 YYYY-MM-DD。 */
  completedOn: string;
  stepCount: number;
  memo: string;
  confirmedAt: ISO;
}

export interface Settings {
  lang: 'en' | 'zh-CN';
}

export interface HouseState {
  grownFloors: FloorNo;
  completedCount: number;
}

export interface AppState {
  /** Absent in legacy saves: the first lantern welcome is still owed at twelve. */
  collection?: { lanternWelcomed: boolean };
  /** 仅未确认 Task。 */
  tasks: Task[];
  archive: MemorialEntry[];
  house: HouseState;
  settings: Settings;
  nextGhostNo: number;
}

export type GhostState = 'gray' | 'white' | 'green' | 'gold';
export type Chore = 'sweep' | 'water' | 'window';

/** 由外壳注入；reducer 不读时钟、不生成随机数。 */
export interface Env {
  now(): ISO;
  /** 本地时区的今天，YYYY-MM-DD（盖章日期）。 */
  today(): string;
  newId(): string;
  random?(): number;
}

export type Action =
  | { type: 'SetLang'; lang: Settings['lang'] }
  | { type: 'CreateTask'; title: string }
  | { type: 'SetCriteria'; taskId: string; criteria: string }
  | { type: 'AddStep'; taskId: string; title: string }
  | { type: 'ToggleStep'; taskId: string; stepId: string }
  | { type: 'EditStep'; taskId: string; stepId: string; title: string }
  | { type: 'DeleteStep'; taskId: string; stepId: string }
  | { type: 'MoveStep'; taskId: string; stepId: string; direction: 'up' | 'down' }
  | { type: 'BeginConfirm'; taskId: string }
  | { type: 'CancelConfirm'; taskId: string }
  | { type: 'ConfirmComplete'; taskId: string; memo: string }
  /** 未完成的 Task 安静搬走：不进纪念册，只腾出自己的 Slot。 */
  | { type: 'DeleteTask'; taskId: string }
  | { type: 'ToggleTitleVisible'; entryId: string };

export type AnimEvent =
  | { type: 'GhostMovedIn'; taskId: string; slot: SlotId }
  | { type: 'ClarifiedTransition'; taskId: string; slot: SlotId }
  | { type: 'StepChecked'; taskId: string; slot: SlotId; chore: Chore }
  | { type: 'EraserScribble'; taskId: string; slot: SlotId }
  | { type: 'StateChanged'; taskId: string; slot: SlotId; from: GhostState; to: GhostState }
  | { type: 'PendingEntered'; taskId: string; slot: SlotId }
  | { type: 'FloorGrown'; floor: FloorNo }
  | { type: 'Confirmed'; taskId: string; slot: SlotId; entryId: string }
  /** 搬走时的样子随事件带出（Task 此刻已不在 state 里）：状态、进度比例与是否在等确认。 */
  | { type: 'MovedOutQuietly'; taskId: string; slot: SlotId; state: GhostState; ratio: number; pending: boolean; ghostKind?: GhostKind }
  | { type: 'WarmLampAdded'; n: number };

export type UserError =
  | { kind: 'title-empty'; max: number }
  | { kind: 'title-too-long'; length: number; max: number }
  | { kind: 'criteria-too-long'; length: number; max: number }
  | { kind: 'step-empty'; max: number }
  | { kind: 'step-too-long'; length: number; max: number }
  | { kind: 'too-many-steps'; max: number }
  | { kind: 'house-full' }
  | { kind: 'not-found' }
  | { kind: 'cannot-move' }
  | { kind: 'not-pending' }
  | { kind: 'not-confirming' }
  | { kind: 'memo-too-long'; length: number; max: number }
  | { kind: 'save-failed' }
  | { kind: 'paused' };

export interface ReduceResult {
  state: AppState;
  events: AnimEvent[];
  error?: UserError;
}

export function emptyState(): AppState {
  return {
    tasks: [],
    archive: [],
    house: { grownFloors: 2, completedCount: 0 },
    settings: { lang: 'en' },
    nextGhostNo: 1,
  };
}
