// 声音控制器：状态机 + 引擎。页面级，一页一个；示例、恢复与内存模式共用同一个。
// 开关不记住：不读也不写任何存储，每次页面加载都从关开始（R14.3）。
import type { Subscribable } from '../store/store';
import type { CueName } from './cues';
import type { CueHandle, SoundEngine, StartResult } from './engine';
import { initialSound, stepSound, type SoundInput, type SoundState, type SoundStatus } from './machine';

export interface SoundView {
  status: SoundStatus;
}

export interface SoundController extends Subscribable<SoundView> {
  /** 玩家按下声音开关。 */
  toggle(): void;
  /** 不在开关上的普通玩家手势。 */
  gesture(): void;
  setHidden(hidden: boolean): void;
  /** 只在背景音乐已经在放时出声；否则返回 null。 */
  cue(name: CueName, delayMs?: number): CueHandle | null;
  /** 测试与调试用：完整状态（含许可与前后台标记）。 */
  inspect(): SoundState;
}

export interface SoundControllerOptions {
  /** 音频引擎；null 表示这个环境放不了声音（打开即静默回到关）。 */
  engine: SoundEngine | null;
  hidden?: boolean;
}

export function createSoundController({ engine, hidden = false }: SoundControllerOptions): SoundController {
  let state = initialSound(hidden);
  let view: SoundView = { status: state.status };
  const listeners = new Set<() => void>();

  const settle = (p: Promise<StartResult>) => {
    p.then(
      (result) => {
        if (result === 'started') send({ type: 'started' });
        else if (result === 'failed') send({ type: 'failed' });
      },
      () => send({ type: 'failed' }),
    );
  };

  const run = (fn: () => Promise<StartResult>) => {
    if (!engine) {
      settle(Promise.resolve('failed'));
      return;
    }
    try {
      settle(fn());
    } catch {
      settle(Promise.resolve('failed'));
    }
  };

  const quietly = (fn: () => void) => {
    try {
      fn();
    } catch {
      /* 关与暂停只是收尾，失败也不影响游戏 */
    }
  };

  function send(input: SoundInput) {
    const step = stepSound(state, input);
    state = step.state;
    for (const cmd of step.commands) {
      switch (cmd.type) {
        case 'start':
          run(() => engine!.start());
          break;
        case 'resume':
          run(() => engine!.resume());
          break;
        case 'stop':
          if (engine) quietly(() => engine.stop());
          break;
        case 'pause':
          if (engine) quietly(() => engine.pause());
          break;
      }
    }
    if (view.status !== state.status) {
      view = { status: state.status };
      for (const l of [...listeners]) l();
    }
  }

  return {
    getState: () => view,
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    toggle: () => send({ type: 'toggle' }),
    gesture: () => send({ type: 'gesture' }),
    setHidden: (h) => send({ type: h ? 'hidden' : 'visible' }),
    cue(name, delayMs) {
      if (state.status !== 'playing' || !engine) return null;
      try {
        return engine.cue(name, delayMs);
      } catch {
        return null;
      }
    },
    inspect: () => state,
  };
}
