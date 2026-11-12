// Web Audio 引擎（R14.2、R14.4、R14.6）：解码后的 AudioBufferSourceNode 无缝循环背景音乐，GainNode 线性渐入渐出，
// 同名音效同时只保留一个。只依赖注入的 AudioDeps，自己不碰任何浏览器全局；任何失败都只返回 'failed'，不抛出。
import { CUE_NAMES, type CueName } from './cues';
import { loopWindow } from './loop';

export interface ParamLike {
  value: number;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  cancelScheduledValues(time: number): unknown;
}
export interface NodeLike {
  connect(destination: never): unknown;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface BufferLike {
  readonly duration: number;
}
export interface SourceLike extends NodeLike {
  buffer: BufferLike | null;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
  onended: (() => void) | null;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}
export interface ContextLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  createGain(): GainLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer, ok?: (b: BufferLike) => void, fail?: (e: unknown) => void): Promise<BufferLike> | void;
  resume(): Promise<void>;
  suspend(): Promise<void>;
}

export interface AudioDeps {
  /** 创建音频环境；只在玩家手势的同步调用栈里调用。 */
  createContext(): ContextLike;
  /** 读取延迟加载的内嵌音频字节。 */
  load(path: string): Promise<ArrayBuffer>;
  wait(ms: number): Promise<void>;
}

export type StartResult = 'started' | 'failed' | 'cancelled';

export interface CueHandle {
  /** 还没开始响就取消，返回 true；已经在响或已经响完，返回 false（不硬切，免得爆音）。 */
  cancel(): boolean;
}

export interface SoundEngine {
  /** 背景音乐从 0 起 2 秒渐入。 */
  start(): Promise<StartResult>;
  /** 回到前台：从 0 起 2 秒渐入；还没有在放的音乐时等同 start。 */
  resume(): Promise<StartResult>;
  /** 关闭：0.5 秒渐出后停止。 */
  stop(): void;
  /** 切到后台：很快降到 0 并挂起环境，循环位置保留。 */
  pause(): void;
  cue(name: CueName, delayMs?: number): CueHandle | null;
}

export const BGM_PATH = 'assets/audio/bgm-loop.mp3';
export const sfxPath = (name: CueName) => `assets/audio/sfx/${name}.mp3`;

/** 背景音乐目标音量（偏低）。 */
export const BGM_GAIN = 0.15;
/** 所有音效统一的音量。音效文件已做响度拉齐（约 −20 LUFS），所以用同一个常数；
 *  比背景音乐的目标音量略高，让音效在音乐之上清晰可闻（R14.4）。 */
export const SFX_GAIN = 0.25;
export const FADE_IN_S = 2;
export const FADE_OUT_S = 0.5;
export const HIDE_FADE_S = 0.15;
export const RESUME_TIMEOUT_MS = 2500;

interface Voice {
  source: SourceLike;
  gain: GainLike;
}

function decode(ctx: ContextLike, data: ArrayBuffer): Promise<BufferLike> {
  return new Promise<BufferLike>((ok, fail) => {
    // 旧版 Safari 只有回调形式；新版两种都给，谁先到用谁。
    const p = ctx.decodeAudioData(data, ok, fail);
    if (p && typeof p.then === 'function') p.then(ok, fail);
  });
}

/** 从当前值线性地走到 target。 */
function rampTo(param: ParamLike, target: number, now: number, seconds: number) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

/** 从 0 线性地升到 target：不会以目标音量突然起音。 */
function rampUp(param: ParamLike, target: number, now: number, seconds: number) {
  param.cancelScheduledValues(now);
  param.setValueAtTime(0, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

export function createSoundEngine(deps: AudioDeps): SoundEngine {
  let ctx: ContextLike | null = null;
  let sfxBus: GainLike | null = null;
  let bgmBus: GainLike | null = null;
  let bgm: Promise<BufferLike> | null = null;
  let sfxRequested = false;
  const sfx = new Map<CueName, BufferLike>();
  const live = new Map<CueName, SourceLike>();
  let voice: Voice | null = null;
  let active = false;
  /** 每次 start/resume/stop/pause 加一；异步的后半段发现自己过期就作废。 */
  let epoch = 0;

  const ensureContext = (): ContextLike => {
    if (ctx) return ctx;
    const c = deps.createContext();
    const master = c.createGain();
    master.connect(c.destination as never);
    bgmBus = c.createGain();
    bgmBus.connect(master as never);
    sfxBus = c.createGain();
    sfxBus.connect(master as never);
    ctx = c;
    return c;
  };

  const loadBgm = (c: ContextLike): Promise<BufferLike> => {
    if (!bgm) {
      const p = deps.load(BGM_PATH).then((data) => decode(c, data));
      // 失败后清掉，玩家下次亲手打开开关时才会再试。
      p.catch(() => {
        if (bgm === p) bgm = null;
      });
      bgm = p;
    }
    return bgm;
  };

  const loadSfx = (c: ContextLike) => {
    if (sfxRequested) return;
    sfxRequested = true;
    for (const name of CUE_NAMES) {
      // 每个音效只试一次；某一个加载失败，只是那一声安静。
      deps.load(sfxPath(name)).then((data) => decode(c, data)).then((b) => void sfx.set(name, b), () => {});
    }
  };

  /** 在手势的同步调用栈里请求恢复；不论结果如何都不抛出。 */
  const askResume = (c: ContextLike): Promise<unknown> => {
    let p: Promise<unknown>;
    try {
      p = c.resume();
    } catch (e) {
      p = Promise.reject(e);
    }
    p.catch(() => {});
    return Promise.race([p, deps.wait(RESUME_TIMEOUT_MS)]);
  };

  const fadeOutVoice = (v: Voice, now: number, seconds: number, stopToo: boolean) => {
    try {
      rampTo(v.gain.gain, 0, now, seconds);
      if (stopToo) v.source.stop(now + seconds + 0.05);
    } catch {
      /* 已经停了 */
    }
  };

  const fadeOutSfx = (c: ContextLike, seconds: number) => {
    const now = c.currentTime;
    for (const s of live.values()) {
      try {
        s.stop(now + seconds);
      } catch {
        /* 已经停了 */
      }
    }
    live.clear();
    if (sfxBus) rampTo(sfxBus.gain, 0, now, seconds);
  };

  const suspendLater = (ms: number) => {
    const mine = epoch;
    deps.wait(ms).then(() => {
      if (mine === epoch && ctx) ctx.suspend().catch(() => {});
    }, () => {});
  };

  const begin = (c: ContextLike, buffer: BufferLike) => {
    const now = c.currentTime;
    // 还在渐出的旧声部继续按自己的计划渐出并停下；新声部从 0 起，两者都不会跳变。
    if (voice) fadeOutVoice(voice, now, 0.05, true);
    voice = null;
    const w = loopWindow(buffer.duration);
    const source = c.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    if (w.kind === 'trimmed') {
      source.loopStart = w.start;
      source.loopEnd = w.end;
    }
    const gain = c.createGain();
    gain.gain.value = 0;
    source.connect(gain as never);
    gain.connect(bgmBus as never);
    rampUp(gain.gain, BGM_GAIN, now, FADE_IN_S);
    if (sfxBus) rampTo(sfxBus.gain, 1, now, 0.05);
    source.start(now, w.start);
    voice = { source, gain };
    active = true;
  };

  const start = (): Promise<StartResult> => {
    const mine = ++epoch;
    let c: ContextLike;
    let resumed: Promise<unknown>;
    let buffer: Promise<BufferLike>;
    try {
      c = ensureContext();
      resumed = askResume(c);
      buffer = loadBgm(c);
      loadSfx(c);
    } catch {
      return Promise.resolve('failed');
    }
    return (async (): Promise<StartResult> => {
      try {
        await resumed;
        const b = await buffer;
        if (mine !== epoch) return 'cancelled';
        if (c.state !== 'running') return 'failed';
        begin(c, b);
        return 'started';
      } catch {
        return mine !== epoch ? 'cancelled' : 'failed';
      }
    })();
  };

  return {
    start,
    resume() {
      if (!ctx || !voice) return start();
      const mine = ++epoch;
      const c = ctx;
      const v = voice;
      let resumed: Promise<unknown>;
      try {
        resumed = askResume(c);
      } catch {
        return Promise.resolve('failed');
      }
      return (async (): Promise<StartResult> => {
        try {
          await resumed;
          if (mine !== epoch) return 'cancelled';
          if (c.state !== 'running') return 'failed';
          const now = c.currentTime;
          rampUp(v.gain.gain, BGM_GAIN, now, FADE_IN_S);
          if (sfxBus) rampTo(sfxBus.gain, 1, now, 0.05);
          active = true;
          return 'started';
        } catch {
          return mine !== epoch ? 'cancelled' : 'failed';
        }
      })();
    },
    stop() {
      epoch++;
      active = false;
      const c = ctx;
      if (!c) return;
      try {
        const now = c.currentTime;
        if (voice) fadeOutVoice(voice, now, FADE_OUT_S, true);
        voice = null;
        fadeOutSfx(c, FADE_OUT_S);
        suspendLater(FADE_OUT_S * 1000 + 150);
      } catch {
        voice = null;
      }
    },
    pause() {
      epoch++;
      active = false;
      const c = ctx;
      if (!c) return;
      try {
        const now = c.currentTime;
        if (voice) fadeOutVoice(voice, now, HIDE_FADE_S, false);
        fadeOutSfx(c, HIDE_FADE_S);
        suspendLater(HIDE_FADE_S * 1000 + 50);
      } catch {
        /* 留给回到前台时重新起播 */
      }
    },
    cue(name, delayMs = 0) {
      const c = ctx;
      const buffer = sfx.get(name);
      if (!active || !c || !sfxBus || !buffer || live.has(name)) return null;
      try {
        const source = c.createBufferSource();
        source.buffer = buffer;
        const gain = c.createGain();
        gain.gain.value = SFX_GAIN;
        source.connect(gain as never);
        gain.connect(sfxBus as never);
        const when = c.currentTime + Math.max(0, delayMs) / 1000;
        source.onended = () => {
          if (live.get(name) === source) live.delete(name);
        };
        live.set(name, source);
        source.start(when);
        return {
          cancel() {
            if (live.get(name) !== source || !ctx || ctx.currentTime >= when) return false;
            live.delete(name);
            try {
              source.stop();
            } catch {
              /* 已经停了 */
            }
            return true;
          },
        };
      } catch {
        live.delete(name);
        return null;
      }
    },
  };
}
