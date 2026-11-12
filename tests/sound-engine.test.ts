import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSoundController } from '../src/sound/controller';
import { CUE_NAMES } from '../src/sound/cues';
import {
  BGM_GAIN,
  BGM_PATH,
  createSoundEngine,
  FADE_IN_S,
  FADE_OUT_S,
  HIDE_FADE_S,
  SFX_GAIN,
  type AudioDeps,
  type BufferLike,
  type ContextLike,
} from '../src/sound/engine';
import { BGM_PRIMING, BGM_SECONDS, BGM_UNTRIMMED_SECONDS } from '../src/sound/loop';

// 用一个记录调用的假音频环境检查引擎与控制器；不靠听，也不需要浏览器。

type Call = [string, ...number[]];

class FakeParam {
  value = 1;
  calls: Call[] = [];
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(['set', v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(['ramp', v, t]);
  }
  cancelScheduledValues(t: number) {
    this.calls.push(['cancel', t]);
  }
}
class FakeGain {
  gain = new FakeParam();
  connect() {}
}
class FakeSource {
  buffer: BufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  started: number[][] = [];
  stopped: number[] = [];
  constructor(private readonly ctx: FakeContext) {}
  connect() {}
  start(when = 0, offset = 0) {
    if (this.ctx.failStart) throw new Error('start failed');
    this.started.push([when, offset]);
  }
  stop(when = 0) {
    this.stopped.push(when);
  }
}

type Fault = 'none' | 'create' | 'load' | 'decode' | 'resume-reject' | 'resume-hang' | 'start';

class FakeContext implements ContextLike {
  state = 'suspended';
  currentTime = 10;
  destination = {};
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  suspends = 0;
  failStart = false;
  constructor(private readonly fault: Fault, private readonly duration: number) {
    this.failStart = fault === 'start';
  }
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource(this);
    this.sources.push(s);
    return s;
  }
  decodeAudioData(data: ArrayBuffer) {
    if (this.fault === 'decode') return Promise.reject(new Error('decode'));
    return Promise.resolve({ duration: data.byteLength === 1 ? this.duration : 1 });
  }
  resume() {
    if (this.fault === 'resume-reject') return Promise.reject(new Error('not allowed'));
    if (this.fault === 'resume-hang') return new Promise<void>(() => {});
    this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    this.state = 'suspended';
    return Promise.resolve();
  }
}

function setup(fault: Fault = 'none', duration = BGM_SECONDS) {
  const contexts: FakeContext[] = [];
  const loads: string[] = [];
  const deps: AudioDeps = {
    createContext() {
      if (fault === 'create') throw new Error('no audio');
      const c = new FakeContext(fault, duration);
      contexts.push(c);
      return c;
    },
    load(path) {
      loads.push(path);
      if (fault === 'load') return Promise.reject(new Error('404'));
      // 背景音乐用 1 字节标记，解码出指定时长；音效解码成 1 秒。
      return Promise.resolve(new ArrayBuffer(path === BGM_PATH ? 1 : 2));
    },
    wait: () => Promise.resolve(),
  };
  return { engine: createSoundEngine(deps), contexts, loads };
}

/** 假环境里的承诺都已兑现：一次宏任务就能把所有后续的微任务跑完。 */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 背景音乐声部：第一个被设成 loop 的声源，以及接着它创建的那个 gain。 */
function bgmVoice(c: FakeContext) {
  const source = c.sources.find((s) => s.loop)!;
  // 创建顺序：master、bgmBus、sfxBus，然后每个声部 source → gain。
  const gain = c.gains[3 + c.sources.filter((s) => !s.loop && c.sources.indexOf(s) < c.sources.indexOf(source)).length]!;
  return { source, gain };
}

describe('Feature: unfinished-business, Property 31: 声音失败回到关且不抛错', () => {
  const faults: Fault[] = ['create', 'load', 'decode', 'resume-reject', 'resume-hang', 'start'];
  it('任一故障点：开关与手势都不抛出，最终回到关', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...faults), fc.boolean(), fc.array(fc.constantFrom('toggle', 'gesture', 'hidden', 'visible'), { maxLength: 6 }), async (fault, hidden, extra) => {
        const { engine } = setup(fault);
        const sound = createSoundController({ engine, hidden });
        const act = (a: string) => {
          if (a === 'toggle') sound.toggle();
          else if (a === 'gesture') sound.gesture();
          else sound.setHidden(a === 'hidden');
        };
        // 先让它真的试一次出声：按开关。
        expect(() => act('toggle')).not.toThrow();
        await flush();
        expect(sound.getState().status).toBe('off');
        for (const a of extra) {
          expect(() => act(a)).not.toThrow();
          await flush();
        }
        // 每次尝试都失败，所以最后一定是关。
        expect(sound.getState().status).toBe('off');
        // 关着的时候音效不出声。
        expect(sound.cue('stamp')).toBeNull();
      }),
      { numRuns: 120 },
    );
  }, 30_000);

  it('状态机：任何可达状态输入失败都回到关，只做清理、不起播', async () => {
    const { initialSound, stepSound } = await import('../src/sound/machine');
    fc.assert(
      fc.property(fc.boolean(), fc.array(fc.constantFrom('toggle', 'gesture', 'hidden', 'visible', 'started', 'failed') as fc.Arbitrary<'toggle'>, { maxLength: 30 }), (hidden, inputs) => {
        let s = initialSound(hidden);
        for (const type of inputs) s = stepSound(s, { type }).state;
        const r = stepSound(s, { type: 'failed' });
        expect(r.state.status).toBe('off');
        expect(r.commands.every((c) => c.type === 'stop')).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

describe('声音引擎', () => {
  it('页面加载（只建控制器）不创建音频环境、不请求文件', () => {
    const { engine, contexts, loads } = setup();
    createSoundController({ engine });
    expect(contexts).toHaveLength(0);
    expect(loads).toHaveLength(0);
  });

  it('起播：解码后的声源无缝循环，从 0 起 2 秒线性渐入到偏低的目标音量', async () => {
    const { engine, contexts, loads } = setup();
    expect(await engine.start()).toBe('started');
    const c = contexts[0]!;
    expect(loads).toEqual([BGM_PATH, ...CUE_NAMES.map((n) => `assets/audio/sfx/${n}.mp3`)]);
    const { source, gain } = bgmVoice(c);
    expect(source.loop).toBe(true);
    expect(source.started).toEqual([[10, 0]]);
    expect(gain.gain.calls).toEqual([['cancel', 10], ['set', 0, 10], ['ramp', BGM_GAIN, 10 + FADE_IN_S]]);
    expect(BGM_GAIN).toBe(0.15);
  });

  it('未去填充的解码结果：循环区间跳过开头预热与结尾补齐，从循环起点起播', async () => {
    const { engine, contexts } = setup('none', BGM_UNTRIMMED_SECONDS);
    await engine.start();
    const { source } = bgmVoice(contexts[0]!);
    expect(source.loopStart).toBeCloseTo(BGM_PRIMING / 44100, 9);
    expect(source.loopEnd - source.loopStart).toBeCloseTo(BGM_SECONDS, 9);
    expect(source.started[0]![1]).toBeCloseTo(BGM_PRIMING / 44100, 9);
  });

  it('关闭：0.5 秒线性渐出后停止，再挂起环境', async () => {
    const { engine, contexts } = setup();
    await engine.start();
    const c = contexts[0]!;
    const { source, gain } = bgmVoice(c);
    c.currentTime = 20;
    engine.stop();
    expect(gain.gain.calls.slice(-3)).toEqual([['cancel', 20], ['set', BGM_GAIN, 20], ['ramp', 0, 20 + FADE_OUT_S]]);
    expect(source.stopped[0]).toBeCloseTo(20 + FADE_OUT_S + 0.05, 9);
    await flush();
    expect(c.suspends).toBe(1);
  });

  it('后台暂停：很快降到 0 并挂起；回来从 0 起 2 秒渐入，同一个声源继续', async () => {
    const { engine, contexts } = setup();
    await engine.start();
    const c = contexts[0]!;
    const { source, gain } = bgmVoice(c);
    c.currentTime = 30;
    engine.pause();
    expect(gain.gain.calls.slice(-1)).toEqual([['ramp', 0, 30 + HIDE_FADE_S]]);
    expect(source.stopped).toEqual([]);
    await flush();
    expect(c.suspends).toBe(1);
    c.currentTime = 31;
    expect(await engine.resume()).toBe('started');
    expect(gain.gain.calls.slice(-3)).toEqual([['cancel', 31], ['set', 0, 31], ['ramp', BGM_GAIN, 31 + FADE_IN_S]]);
    expect(c.sources.filter((s) => s.loop)).toHaveLength(1);
  });

  it('起播途中被关掉：作废，不留下在放的声源', async () => {
    const { engine, contexts } = setup();
    const p = engine.start();
    engine.stop();
    expect(await p).toBe('cancelled');
    expect(contexts[0]!.sources.filter((s) => s.loop)).toHaveLength(0);
  });

  it('音效：统一音量 0.25，在背景音乐之上；同名的同时只保留一个，响完之后才可以再响；关着时不响', async () => {
    expect(SFX_GAIN).toBe(0.25);
    expect(SFX_GAIN).toBeGreaterThan(BGM_GAIN);
    const { engine, contexts } = setup();
    expect(engine.cue('sweep')).toBeNull();
    await engine.start();
    await flush();
    const first = engine.cue('sweep');
    expect(first).not.toBeNull();
    expect(engine.cue('sweep')).toBeNull();
    expect(engine.cue('water')).not.toBeNull();
    const c = contexts[0]!;
    const sweep = c.sources.filter((s) => !s.loop)[0]!;
    // 每个音效声部的 gain 紧跟在它的声源之后创建，都是同一个常数。
    for (const s of c.sources.filter((x) => !x.loop)) {
      const g = c.gains[3 + c.sources.indexOf(s)]!;
      expect(g.gain.value).toBe(SFX_GAIN);
    }
    sweep.onended?.();
    expect(engine.cue('sweep')).not.toBeNull();
    engine.stop();
    expect(engine.cue('stamp')).toBeNull();
  });

  it('排着没响的音效可以取消，已经开始响的不硬切', async () => {
    const { engine, contexts } = setup();
    await engine.start();
    await flush();
    const c = contexts[0]!;
    const later = engine.cue('lamp', 4100)!;
    expect(later.cancel()).toBe(true);
    const now = engine.cue('stamp', 0)!;
    expect(now.cancel()).toBe(false);
    expect(c.sources.filter((s) => !s.loop)[1]!.stopped).toEqual([]);
  });
});

describe('声音控制器', () => {
  it('每次创建都是关；按开关起播，再按一下关', async () => {
    const { engine, contexts } = setup();
    const sound = createSoundController({ engine });
    expect(sound.getState().status).toBe('off');
    sound.toggle();
    expect(sound.getState().status).toBe('starting');
    await flush();
    expect(sound.getState().status).toBe('playing');
    expect(contexts).toHaveLength(1);
    sound.toggle();
    await flush();
    expect(sound.getState().status).toBe('off');
  });

  it('普通手势不起播：只记下许可，不创建音频环境；之后按开关才起播', async () => {
    const { engine, contexts, loads } = setup();
    const sound = createSoundController({ engine });
    sound.gesture();
    await flush();
    expect(sound.getState().status).toBe('off');
    expect(sound.inspect().granted).toBe(true);
    expect(contexts).toHaveLength(0);
    expect(loads).toHaveLength(0);
    sound.toggle();
    await flush();
    expect(sound.getState().status).toBe('playing');
  });

  it('没有音频引擎（测试环境、老浏览器）：打开后静默回到关', async () => {
    const sound = createSoundController({ engine: null });
    sound.toggle();
    await flush();
    expect(sound.getState().status).toBe('off');
  });
});
