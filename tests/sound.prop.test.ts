import fc from 'fast-check';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSoundController } from '../src/sound/controller';
import { CHORE_CUE, cuesFor, farewellTimes, LANTERN_AFTER_MS } from '../src/sound/cues';
import type { SoundEngine, StartResult } from '../src/sound/engine';
import { loopWindow, BGM_SECONDS, BGM_PRIMING, BGM_RATE, BGM_UNTRIMMED_SECONDS } from '../src/sound/loop';
import { initialSound, isSwitchOn, stepSound, type SoundInput, type SoundState } from '../src/sound/machine';
import { opsArb, runOps, sequenceEnv } from './helpers/sequence';

const inputArb: fc.Arbitrary<SoundInput> = fc.constantFrom<SoundInput>(
  { type: 'toggle' },
  { type: 'gesture' },
  { type: 'hidden' },
  { type: 'visible' },
  { type: 'started' },
  { type: 'failed' },
);
const inputsArb = fc.array(inputArb, { maxLength: 60 });

/** 浏览器里可能已经有的东西：早先版本留下的 ub:sound（任意值，含 on）、存档与其他键。 */
const storedArb: fc.Arbitrary<Record<string, string>> = fc.record(
  {
    'ub:sound': fc.oneof(fc.constantFrom('on', 'off', 'ON', ' on', 'true', '1', ''), fc.string()),
    'ub:save': fc.string(),
    other: fc.string(),
  },
  { requiredKeys: [] },
);

/** 记录每一次访问的存储替身，装在 globalThis.localStorage 与 sessionStorage 上。 */
function withRecordingStorage<T>(initial: Record<string, string>, body: (touches: string[], data: () => Record<string, string>) => T): T {
  const touches: string[] = [];
  const make = (name: string, seed: Record<string, string>) => {
    const data = new Map(Object.entries(seed));
    const storage = {
      get length() {
        touches.push(`${name}.length`);
        return data.size;
      },
      key: (i: number) => (touches.push(`${name}.key`), [...data.keys()][i] ?? null),
      getItem: (k: string) => (touches.push(`${name}.getItem:${k}`), data.get(k) ?? null),
      setItem: (k: string, v: string) => void (touches.push(`${name}.setItem:${k}`), data.set(k, v)),
      removeItem: (k: string) => void (touches.push(`${name}.removeItem:${k}`), data.delete(k)),
      clear: () => void (touches.push(`${name}.clear`), data.clear()),
    };
    return { storage, data };
  };
  const local = make('localStorage', initial);
  const session = make('sessionStorage', {});
  const g = globalThis as Record<string, unknown>;
  const saved = { localStorage: Object.getOwnPropertyDescriptor(g, 'localStorage'), sessionStorage: Object.getOwnPropertyDescriptor(g, 'sessionStorage') };
  Object.defineProperty(g, 'localStorage', { configurable: true, get: () => (touches.push('localStorage'), local.storage) });
  Object.defineProperty(g, 'sessionStorage', { configurable: true, get: () => (touches.push('sessionStorage'), session.storage) });
  const restore = () => {
    for (const key of ['localStorage', 'sessionStorage'] as const) {
      const d = saved[key];
      if (d) Object.defineProperty(g, key, d);
      else delete g[key];
    }
  };
  let result: T;
  try {
    result = body(touches, () => Object.fromEntries(local.data));
  } catch (e) {
    restore();
    throw e;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}

/** 记录调用的假引擎：起播按给定结果兑现。 */
function recordingEngine(result: StartResult = 'started') {
  const calls: string[] = [];
  const engine: SoundEngine = {
    start: () => (calls.push('start'), Promise.resolve(result)),
    resume: () => (calls.push('resume'), Promise.resolve(result)),
    stop: () => void calls.push('stop'),
    pause: () => void calls.push('pause'),
    cue: () => (calls.push('cue'), { cancel: () => false }),
  };
  return { engine, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Feature: unfinished-business, Property 28: 每次加载声音都是关且不出声', () => {
  it('不论存储里有什么（含旧的 ub:sound=on）、页面在前台还是后台：初始状态是关，没有许可，引擎一次也没被调用', () => {
    fc.assert(
      fc.property(storedArb, fc.boolean(), (stored, hidden) => {
        expect(initialSound(hidden)).toEqual({ status: 'off', granted: false, hidden, resumeOnShow: false });
        withRecordingStorage(stored, () => {
          const { engine, calls } = recordingEngine();
          const sound = createSoundController({ engine, hidden });
          expect(sound.getState().status).toBe('off');
          expect(isSwitchOn(sound.inspect())).toBe(false);
          expect(sound.inspect()).toEqual(initialSound(hidden));
          // 初始化本身不是一步输入，没有任何命令可执行；第一次出声必须等玩家按开关（见 P32）。
          expect(calls).toEqual([]);
          expect(sound.cue('stamp')).toBeNull();
        });
      }),
      { numRuns: 200 },
    );
  });
});

const SOUND_SOURCES = [resolve('src/sound'), resolve('src/components/SoundSwitch.tsx'), resolve('src/components/useSound.ts'), resolve('src/components/App.tsx'), resolve('src/main.tsx')];
const walk = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => walk(join(p, n))) : [p]);

describe('Feature: unfinished-business, Property 29: 声音代码从不读写存储', () => {
  it('任意存储内容与任意操作序列（开关、手势、前后台、音效，起播成功或失败）：存储一次也没被访问，内容原样不变', async () => {
    const opArb = fc.constantFrom('toggle', 'gesture', 'hidden', 'visible', 'cue');
    await fc.assert(
      fc.asyncProperty(storedArb, fc.boolean(), fc.constantFrom<StartResult>('started', 'failed'), fc.array(opArb, { maxLength: 12 }), async (stored, hidden, result, ops) => {
        await withRecordingStorage(stored, async (touches, data) => {
          const { engine } = recordingEngine(result);
          const sound = createSoundController({ engine, hidden });
          for (const op of ops) {
            if (op === 'toggle') sound.toggle();
            else if (op === 'gesture') sound.gesture();
            else if (op === 'cue') sound.cue('move-in');
            else sound.setHidden(op === 'hidden');
            await flush();
          }
          expect(touches).toEqual([]);
          expect(data()).toEqual(stored);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('源码里没有存储：声音模块、开关与接线都不提 localStorage、sessionStorage、indexedDB 或 ub:sound', () => {
    const files = SOUND_SOURCES.flatMap(walk);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, 'utf8')).not.toMatch(/localStorage|sessionStorage|indexedDB|ub:sound|getItem|setItem/);
  });
});

function run(hidden: boolean, inputs: readonly SoundInput[], visit: (before: SoundState, input: SoundInput, after: SoundState, commands: ReturnType<typeof stepSound>['commands']) => void) {
  let s = initialSound(hidden);
  for (const input of inputs) {
    const r = stepSound(s, input);
    visit(s, input, r.state, r.commands);
    s = r.state;
  }
}

describe('Feature: unfinished-business, Property 30: 开与关只由声音开关决定', () => {
  it('只有开关能把关变成开；开变成关只来自开关或失败；每按一次开关，按下状态都翻转；命令里没有任何存储操作', () => {
    fc.assert(
      fc.property(fc.boolean(), inputsArb, (hidden, inputs) => {
        run(hidden, inputs, (before, input, after, commands) => {
          const was = isSwitchOn(before);
          const now = isSwitchOn(after);
          if (!was && now) expect(input.type).toBe('toggle');
          if (was && !now) expect(['toggle', 'failed']).toContain(input.type);
          if (input.type === 'toggle') expect(now).toBe(!was);
          for (const c of commands) expect(['start', 'stop', 'pause', 'resume']).toContain(c.type);
        });
      }),
      { numRuns: 300 },
    );
  });
});

describe('Feature: unfinished-business, Property 32: 出声只来自本次的玩家手势', () => {
  it('start 只来自关着时按下开关；resume 只来自回到前台且离开前在放、已有许可；普通手势与前后台从不起播', () => {
    fc.assert(
      fc.property(fc.boolean(), inputsArb, (hidden, inputs) => {
        run(hidden, inputs, (before, input, after, commands) => {
          for (const c of commands) {
            if (c.type === 'start') {
              expect(input.type).toBe('toggle');
              expect(before.status).toBe('off');
            }
            if (c.type === 'resume') {
              expect(input.type).toBe('visible');
              expect(before.status).toBe('paused');
              expect(before.resumeOnShow).toBe(true);
              expect(before.granted).toBe(true);
            }
          }
          if (input.type === 'gesture' || input.type === 'hidden' || (input.type === 'visible' && before.status === 'off')) {
            expect(commands.some((c) => c.type === 'start' || c.type === 'resume')).toBe(false);
          }
          // 只要不是 off，就不会在没有许可的情况下处于 starting/playing。
          if (after.status === 'starting' || after.status === 'playing') expect(after.granted).toBe(true);
        });
      }),
      { numRuns: 300 },
    );
  });
});

describe('Feature: unfinished-business, Property 33: 音效只配成功的故事时刻', () => {
  it('入住一声噗（提灯再加风铃）、勾选按家务、确认先盖章后灯亮；其余与被拒绝的操作没有音效', () => {
    const env = { ...sequenceEnv(), random: () => 0.01 };
    fc.assert(
      fc.property(opsArb, fc.boolean(), (ops, reduced) => {
        runOps(
          ops,
          (a) => {
            const kindOf = (id: string) => a.after.tasks.find((t) => t.id === id)?.ghostKind;
            const cues = cuesFor(a.events, kindOf, reduced);
            if (a.error) {
              expect(a.events).toEqual([]);
              expect(cues).toEqual([]);
            }
            const movedIn = a.events.filter((e) => e.type === 'GhostMovedIn');
            const lanterns = movedIn.filter((e) => kindOf(e.taskId) === 'lantern').length;
            const checked = a.events.filter((e) => e.type === 'StepChecked');
            const confirmed = a.events.filter((e) => e.type === 'Confirmed');
            const names = cues.map((c) => c.name);
            expect(names.filter((n) => n === 'move-in')).toHaveLength(movedIn.length);
            expect(names.filter((n) => n === 'lantern')).toHaveLength(lanterns);
            expect(cues.filter((c) => c.name === 'lantern').every((c) => c.delayMs === LANTERN_AFTER_MS)).toBe(true);
            expect(names.filter((n) => n === 'sweep' || n === 'water' || n === 'wipe')).toEqual(checked.map((e) => CHORE_CUE[e.chore]));
            for (const e of confirmed) {
              const stamp = cues.find((c) => c.name === 'stamp' && c.entryId === e.entryId)!;
              const lamp = cues.find((c) => c.name === 'lamp' && c.entryId === e.entryId)!;
              expect(stamp.delayMs).toBeLessThan(lamp.delayMs);
              expect({ stamp: stamp.delayMs, lamp: lamp.delayMs }).toEqual(farewellTimes(reduced));
            }
            // 没有别的音效：取消勾选、状态变化、长楼、搬走、暖灯都安静。
            expect(cues).toHaveLength(movedIn.length + lanterns + checked.length + confirmed.length * 2);
            // 取消勾选的那一步只有橡皮擦，没有家务声。
            if (a.op.k === 'toggle' && a.target) {
              const st = a.target.steps[a.op.j % Math.max(1, a.target.steps.length)];
              if (st?.done) expect(names.some((n) => n === 'sweep' || n === 'water' || n === 'wipe')).toBe(false);
            }
          },
          env,
        );
      }),
      { numRuns: 100 },
    );
  });
});


describe('声音：示例与边界', () => {
  it('家务映射：扫地、浇水、擦窗；第 4 步起按 index % 3 循环（与现有 choreFor 一致）', () => {
    expect(CHORE_CUE).toEqual({ sweep: 'sweep', water: 'water', window: 'wipe' });
  });

  it('送别两声对准告别动画：正常 1.9 秒盖章、4.1 秒灯亮；减少动态立即盖章、0.45 秒灯亮', () => {
    expect(farewellTimes(false)).toEqual({ stamp: 1900, lamp: 4100 });
    expect(farewellTimes(true)).toEqual({ stamp: 0, lamp: 450 });
  });

  it('循环区间：已去填充的一圈整段循环；未去填充的跳过预热与补齐；对不上的整段循环', () => {
    expect(loopWindow(BGM_SECONDS)).toEqual({ kind: 'whole', start: 0, end: BGM_SECONDS });
    // 0.8 倍速版本，约 175.9 秒；精确值由 tests/sound-file.test.ts 从文件头核对。
    expect(BGM_SECONDS).toBeGreaterThan(175.8);
    expect(BGM_SECONDS).toBeLessThan(175.95);
    const untrimmed = loopWindow(BGM_UNTRIMMED_SECONDS);
    expect(untrimmed.kind).toBe('trimmed');
    expect(untrimmed.start).toBeCloseTo(BGM_PRIMING / BGM_RATE, 9);
    expect(untrimmed.end - untrimmed.start).toBeCloseTo(BGM_SECONDS, 9);
    expect(loopWindow(BGM_SECONDS + 1).kind).toBe('whole');
  });

  it('普通手势不起播：只记下许可，开关仍是关；之后按开关才起播', () => {
    const g = stepSound(initialSound(false), { type: 'gesture' });
    expect(g.commands).toEqual([]);
    expect(g.state.status).toBe('off');
    expect(g.state.granted).toBe(true);
    const t = stepSound(g.state, { type: 'toggle' });
    expect(t.state.status).toBe('starting');
    expect(t.commands).toEqual([{ type: 'start' }]);
  });

  it('按开关：关 → 起播（命令只有 start）；起播中或在放时再按 → 关（命令只有 stop）', () => {
    const t = stepSound(initialSound(false), { type: 'toggle' });
    expect(t.state.status).toBe('starting');
    expect(t.state.granted).toBe(true);
    expect(t.commands).toEqual([{ type: 'start' }]);
    expect(stepSound(t.state, { type: 'toggle' }).commands).toEqual([{ type: 'stop' }]);
    const playing = stepSound(t.state, { type: 'started' }).state;
    expect(playing.status).toBe('playing');
    const off = stepSound(playing, { type: 'toggle' });
    expect(off.state.status).toBe('off');
    expect(off.commands).toEqual([{ type: 'stop' }]);
  });

  it('后台：在放时暂停，回来渐入恢复，开关一直是开；关着时回到前台不出声', () => {
    let s = stepSound(stepSound(initialSound(false), { type: 'toggle' }).state, { type: 'started' }).state;
    const h = stepSound(s, { type: 'hidden' });
    expect(h.commands).toEqual([{ type: 'pause' }]);
    expect(isSwitchOn(h.state)).toBe(true);
    const v = stepSound(h.state, { type: 'visible' });
    expect(v.commands).toEqual([{ type: 'resume' }]);
    expect(isSwitchOn(v.state)).toBe(true);
    s = initialSound(true);
    expect(stepSound(s, { type: 'visible' }).commands).toEqual([]);
    expect(stepSound(stepSound(s, { type: 'visible' }).state, { type: 'visible' }).commands).toEqual([]);
  });
});

describe('开局残留 hidden（预加载的新标签页）', () => {
  it('开局记成后台，第一下点开关起播成功后就是 playing，不会被当成后台暂停', () => {
    let s = initialSound(true);
    s = stepSound(s, { type: 'toggle' }).state;
    expect(s.hidden).toBe(false);
    const r = stepSound(s, { type: 'started' });
    expect(r.state.status).toBe('playing');
    expect(r.commands).toEqual([]);
  });

  it('开局记成后台：普通手势清掉 hidden、记下许可但不起播；之后按开关起播成功就是 playing', () => {
    const g = stepSound(initialSound(true), { type: 'gesture' });
    expect(g.commands).toEqual([]);
    expect(g.state).toEqual({ status: 'off', granted: true, hidden: false, resumeOnShow: false });
    const s = stepSound(stepSound(g.state, { type: 'toggle' }).state, { type: 'started' }).state;
    expect(s.status).toBe('playing');
  });
});
