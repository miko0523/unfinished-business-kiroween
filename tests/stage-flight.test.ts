// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStageFlights, FLIGHT_MS } from '../src/components/stageFlight';
import { createUiStore } from '../src/store/uiStore';
import { createStageBus, stageBusOf } from '../src/store/stageBus';

interface FakeAnim {
  keyframes: unknown[];
  onfinish: (() => void) | null;
  finished: Promise<void>;
  effect: { setKeyframes(k: unknown[]): void };
  cancel(): void;
  finish(): void;
  cancelled: boolean;
}

let anims: FakeAnim[];

function mount(): HTMLElement {
  const el = document.createElement('button');
  document.body.append(el);
  (el as unknown as { animate: unknown }).animate = (keyframes: unknown[]) => {
    const a: FakeAnim = {
      keyframes,
      onfinish: null,
      finished: Promise.resolve(),
      effect: { setKeyframes: (k) => void (a.keyframes = k) },
      cancelled: false,
      cancel() {
        a.cancelled = true;
      },
      finish() {
        a.onfinish?.();
      },
    };
    anims.push(a);
    return a;
  };
  return el;
}

beforeEach(() => {
  anims = [];
  // happy-dom 不算动画中的位移：用元素上写着的 translate(...) 充当“此刻的位移”。
  vi.stubGlobal('getComputedStyle', (el: HTMLElement) => {
    const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform);
    return { transform: m ? `matrix(1, 0, 0, 1, ${m[1]}, ${m[2]})` : 'none' };
  });
  vi.stubGlobal(
    'DOMMatrix',
    class {
      m41: number;
      m42: number;
      constructor(s: string) {
        const n = s.match(/-?[\d.]+/g)!.map(Number);
        this.m41 = n[4]!;
        this.m42 = n[5]!;
      }
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('舞台飞行：同一个元素，只加位移', () => {
  it('飞来：动画结束后停在舞台位置；飞回：动画结束后清得干净', () => {
    const f = createStageFlights();
    const el = mount();
    f.to(el, 40, -300, true);
    expect(anims).toHaveLength(1);
    expect(anims[0]!.keyframes).toEqual([{ transform: 'translate(0px, 0px)' }, { transform: 'translate(40px, -300px)' }]);
    expect(f.isStaged(el)).toBe(true);
    anims[0]!.finish();
    expect(el.style.transform).toBe('translate(40px, -300px)');
    const done = vi.fn();
    f.back(el, true, done);
    expect(anims).toHaveLength(2);
    expect(anims[1]!.keyframes).toEqual([{ transform: 'translate(40px, -300px)' }, { transform: 'translate(0px, 0px)' }]);
    anims[1]!.finish();
    expect(el.style.transform).toBe('');
    expect(done).toHaveBeenCalledTimes(1);
    expect(f.isStaged(el)).toBe(false);
  });

  it('已经在舞台上：位置变了（滚动、窗口变化）直接跟随，不再起新动画', () => {
    const f = createStageFlights();
    const el = mount();
    f.to(el, 10, -100, false);
    expect(el.style.transform).toBe('translate(10px, -100px)');
    f.to(el, 12, -140, true);
    expect(anims).toHaveLength(0);
    expect(el.style.transform).toBe('translate(12px, -140px)');
  });

  it('正在飞来时位置变了：只改终点，不重新起飞', () => {
    const f = createStageFlights();
    const el = mount();
    f.to(el, 10, -100, true);
    f.to(el, 30, -120, true);
    expect(anims).toHaveLength(1);
    expect(anims[0]!.keyframes).toEqual([{ transform: 'translate(0px, 0px)' }, { transform: 'translate(30px, -120px)' }]);
    anims[0]!.finish();
    expect(el.style.transform).toBe('translate(30px, -120px)');
  });

  it('减少动态：瞬移过去、瞬移回来，不创建动画', () => {
    const f = createStageFlights();
    const el = mount();
    f.to(el, 5, -50, false);
    expect(el.style.transform).toBe('translate(5px, -50px)');
    const done = vi.fn();
    f.back(el, false, done);
    expect(el.style.transform).toBe('');
    expect(done).toHaveBeenCalled();
    expect(anims).toHaveLength(0);
  });

  it('飞回途中又被选中：取消回程，从当前位置再飞去；不会同时有两个动画', () => {
    const f = createStageFlights();
    const el = mount();
    f.to(el, 20, -200, true);
    anims[0]!.finish();
    f.back(el, true, vi.fn());
    f.to(el, 20, -200, true);
    expect(anims[1]!.cancelled).toBe(true);
    expect(anims.filter((a) => !a.cancelled && a.onfinish)).toHaveLength(1);
  });

  it('取消的动画不会再回调（被取消的旧回程不能把新的舞台位置清掉）', () => {
    const f = createStageFlights();
    const el = mount();
    f.to(el, 20, -200, true);
    anims[0]!.finish();
    const done = vi.fn();
    f.back(el, true, done);
    const stale = anims[1]!;
    f.to(el, 22, -210, true);
    stale.finish(); // 迟到的旧回调
    expect(done).not.toHaveBeenCalled();
    expect(f.isStaged(el)).toBe(true);
  });

  it('隐藏页面：finishAll 把进行中的飞行推进到终点；clear / clearAll 不留痕迹', () => {
    const f = createStageFlights();
    const a = mount();
    const b = mount();
    f.to(a, 1, -1, true);
    f.to(b, 2, -2, true);
    f.finishAll();
    expect(a.style.transform).toBe('translate(1px, -1px)');
    expect(b.style.transform).toBe('translate(2px, -2px)');
    f.clear(a);
    expect(a.style.transform).toBe('');
    f.clearAll();
    expect(b.style.transform).toBe('');
    expect(f.isStaged(b)).toBe(false);
  });

  it('飞行时长不超过 0.5 秒', () => {
    expect(FLIGHT_MS).toBeLessThanOrEqual(500);
  });
});

describe('镜头与点击：全景里点 Ghost 先聚焦，再点才打开', () => {
  it('聚焦模式直接选中，并把那一层记作当前楼层', () => {
    const ui = createUiStore();
    expect(ui.activateGhost('a', 3)).toBe(true);
    expect(ui.getState()).toMatchObject({ selectedTaskId: 'a', focusFloor: 3, primedTaskId: null });
  });

  it('全景：第一次点只聚焦所在楼层并记下它，第二次点才打开详情', () => {
    const ui = createUiStore();
    ui.setCamera('panorama');
    expect(ui.activateGhost('a', 4)).toBe(false);
    expect(ui.getState()).toMatchObject({ camera: 'focus', focusFloor: 4, primedTaskId: 'a', selectedTaskId: null });
    expect(ui.activateGhost('a', 4)).toBe(true);
    expect(ui.getState()).toMatchObject({ selectedTaskId: 'a', primedTaskId: null });
  });

  it('进入全景时详情收起', () => {
    const ui = createUiStore();
    ui.activateGhost('a', 2);
    ui.setCamera('panorama');
    expect(ui.getState().selectedTaskId).toBeNull();
  });
});

describe('舞台总线', () => {
  it('只在位置真的变了才通知；取消订阅后不再通知；每个上下文各一条', () => {
    const bus = createStageBus();
    const fn = vi.fn();
    const off = bus.subscribe(fn);
    bus.set({ left: 1, width: 2, top: 3 });
    bus.set({ left: 1, width: 2, top: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    bus.set(null);
    expect(fn).toHaveBeenCalledTimes(2);
    bus.set(null);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    bus.set({ left: 9, width: 9, top: 9 });
    expect(fn).toHaveBeenCalledTimes(2);
    const a = {};
    expect(stageBusOf(a)).toBe(stageBusOf(a));
    expect(stageBusOf(a)).not.toBe(stageBusOf({}));
  });
});
