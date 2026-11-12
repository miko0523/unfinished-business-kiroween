import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';
import type { AnimEvent } from '../domain/types';
import type { SoundController } from '../sound/controller';
import { createSoundController } from '../sound/controller';
import { cuesFor, type CueName } from '../sound/cues';
import type { CueHandle } from '../sound/engine';
import type { Store } from '../store/store';
import type { UiStore } from '../store/uiStore';
import { prefersReducedMotion } from './useReducedMotion';

// 声音是页面级的：一页一个控制器，挂在示例与真实房子的上方，进出示例时不重建。
// 缺省（测试里没有注入）是一个放不了声音的控制器：打开会静默回到关。
export const SoundContext = createContext<SoundController>(createSoundController({ engine: null }));

export function useSoundController(): SoundController {
  return useContext(SoundContext);
}

const MODIFIERS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn', 'FnLock', 'Hyper', 'Super']);

/**
 * 这个事件能不能算一次“普通手势”：只认能授予用户激活的几种（鼠标按下、触控/笔抬起、触摸结束、不是 Esc 或修饰键的按键），
 * 只认浏览器真实派发的事件；落在声音开关自身上的交给开关处理。
 */
export function isActivationGesture(e: Event): boolean {
  if (!e.isTrusted) return false;
  const target = e.target as Element | null;
  if (target && typeof target.closest === 'function' && target.closest('[data-sound-switch]')) return false;
  switch (e.type) {
    case 'pointerdown':
      return (e as PointerEvent).pointerType === 'mouse';
    case 'pointerup':
      return (e as PointerEvent).pointerType !== 'mouse';
    case 'touchend':
      return true;
    case 'keydown': {
      const k = e as KeyboardEvent;
      return !k.repeat && !MODIFIERS.has(k.key);
    }
    default:
      return false;
  }
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown'] as const;

/** 手势与前后台：装在 App 上，整页只有一份。 */
export function useSoundLifecycle(sound: SoundController): void {
  useEffect(() => {
    const onGesture = (e: Event) => {
      if (isActivationGesture(e)) sound.gesture();
    };
    const onVisibility = () => sound.setHidden(document.hidden);
    for (const type of GESTURES) window.addEventListener(type, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    // 预加载（prerender）出来的页面加载时算后台，激活时 Chrome 不一定补发 visibilitychange；
    // 从往返缓存恢复时同理。装上时先对一次账，之后这两个事件也对账。
    document.addEventListener('prerenderingchange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    onVisibility();
    return () => {
      for (const type of GESTURES) window.removeEventListener(type, onGesture, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('prerenderingchange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, [sound]);
}

/** 跳过动画时，还没响的送别声立刻补上：先“啪嗒”，再隔这么久“叮”。 */
export const SKIP_LAMP_AFTER_MS = 350;

interface Farewell {
  stamp: CueHandle | null;
  lamp: CueHandle | null;
  seen: boolean;
}

/** 把当前房子（真实或示例）的成功事件接到音效上；被拒绝的操作没有事件，也就没有声音。 */
export function useSoundCues(sound: SoundController, store: Store, ui: UiStore): void {
  useEffect(() => {
    const farewells = new Map<string, Farewell>();
    const offEvents = store.subscribeEvents((events: readonly AnimEvent[]) => {
      const state = store.getState();
      const cues = cuesFor(events, (id) => state.tasks.find((t) => t.id === id)?.ghostKind, prefersReducedMotion());
      for (const cue of cues) {
        const handle = sound.cue(cue.name, cue.delayMs);
        if (!cue.entryId) continue;
        // 新的一场送别开始，旧的那场的庆祝层已经被它清掉了。
        if (cue.name === 'stamp') farewells.clear();
        const f = farewells.get(cue.entryId) ?? { stamp: null, lamp: null, seen: ui.getState().celebration?.entryId === cue.entryId };
        f[cue.name as 'stamp' | 'lamp'] = handle;
        farewells.set(cue.entryId, f);
      }
    });
    const offUi = ui.subscribe(() => {
      const current = ui.getState().celebration?.entryId ?? null;
      for (const [id, f] of farewells) {
        if (current === id) {
          f.seen = true;
          continue;
        }
        if (!f.seen) continue;
        // 这场庆祝结束了（演完或被跳过）：还排着没响的，立刻补上。
        farewells.delete(id);
        const replay: CueName[] = [];
        if (f.stamp?.cancel()) replay.push('stamp');
        if (f.lamp?.cancel()) replay.push('lamp');
        replay.forEach((name, i) => sound.cue(name, i * SKIP_LAMP_AFTER_MS));
      }
    });
    return () => {
      offEvents();
      offUi();
    };
  }, [sound, store, ui]);
}
