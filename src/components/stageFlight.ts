// 被选中的 Ghost 在“屋里的位置”和“抽屉上沿的小舞台”之间飞：同一个 DOM 元素，只加一个相对自己原位的位移。
// 位移作用在 Ghost 按钮上（它的父级 li 带着漫游的位置），所以语义列表、焦点和点击目标始终是同一个元素；
// 屋里不会留下第二只或影子。只动 transform。

export const FLIGHT_MS = 450;
const EASING = 'cubic-bezier(0.22, 0.8, 0.3, 1)';

type Mode = 'in' | 'staged' | 'out';

interface Rec {
  mode: Mode;
  anim: Animation | null;
  dx: number;
  dy: number;
  /** 飞回原位之后调用（清理舞台标记）。 */
  done: (() => void) | null;
}

const tr = (dx: number, dy: number) => `translate(${dx}px, ${dy}px)`;

/** 元素此刻相对自己原位的位移（含正在播放的动画）。读不出来时当作 0。 */
export function currentOffset(el: HTMLElement): [number, number] {
  try {
    const m = getComputedStyle(el).transform;
    if (!m || m === 'none') return [0, 0];
    const parsed = new DOMMatrix(m);
    return [parsed.m41, parsed.m42];
  } catch {
    return [0, 0];
  }
}

export interface StageFlights {
  /** 飞向（或停在）舞台：dx、dy 是相对原位的位移。已经在舞台上就直接跟随新的位置；正在飞就改终点。 */
  to(el: HTMLElement, dx: number, dy: number, animate: boolean): void;
  /** 沿原路飞回原位；done 在到家（或瞬移回去）之后调用。 */
  back(el: HTMLElement, animate: boolean, done?: () => void): void;
  /** 立刻清掉这个元素上的一切（元素被移除、示例切换时）。 */
  clear(el: HTMLElement): void;
  /** 把所有进行中的飞行直接推进到终点（页面隐藏时）。 */
  finishAll(): void;
  /** 立刻取消所有进行中的飞行并落在终点：去舞台的停在舞台上，回屋的回到原位（系统“减少动态”随时打开时）。 */
  settleAll(): void;
  clearAll(): void;
  isStaged(el: HTMLElement): boolean;
}

export function createStageFlights(): StageFlights {
  const recs = new Map<HTMLElement, Rec>();

  const stop = (rec: Rec) => {
    const a = rec.anim;
    rec.anim = null;
    if (a) {
      a.onfinish = null;
      try {
        a.cancel();
      } catch {
        /* 已经结束 */
      }
    }
  };

  const run = (el: HTMLElement, rec: Rec, fromX: number, fromY: number, toX: number, toY: number, onEnd: () => void) => {
    if (typeof el.animate !== 'function') {
      onEnd();
      return;
    }
    try {
      const a = el.animate([{ transform: tr(fromX, fromY) }, { transform: tr(toX, toY) }], { duration: FLIGHT_MS, easing: EASING, fill: 'forwards' });
      a.finished?.catch(() => {}); // 取消时 finished 会被拒绝，这是正常的
      a.onfinish = () => {
        if (rec.anim !== a) return;
        rec.anim = null;
        onEnd();
        try {
          a.cancel();
        } catch {
          /* 已经结束 */
        }
      };
      rec.anim = a;
    } catch {
      onEnd();
    }
  };

  const arrive = (el: HTMLElement, rec: Rec) => () => {
    rec.mode = 'staged';
    el.style.transform = tr(rec.dx, rec.dy);
  };

  const home = (el: HTMLElement, rec: Rec) => {
    stop(rec);
    el.style.transform = '';
    recs.delete(el);
    rec.done?.();
  };

  return {
    to(el, dx, dy, animate) {
      let rec = recs.get(el);
      if (!rec) recs.set(el, (rec = { mode: 'in', anim: null, dx, dy, done: null }));
      rec.done = null;
      if (rec.mode === 'staged' && rec.anim === null) {
        rec.dx = dx;
        rec.dy = dy;
        el.style.transform = tr(dx, dy);
        return;
      }
      if (!animate && rec.anim) {
        // 正在飞来时系统打开了“减少动态”：不再滑行，直接落在舞台上。
        stop(rec);
        rec.mode = 'in';
        rec.dx = dx;
        rec.dy = dy;
        arrive(el, rec)();
        return;
      }
      if (rec.mode === 'in' && rec.anim) {
        // 正在飞来：只改终点，进度不变。
        rec.dx = dx;
        rec.dy = dy;
        try {
          (rec.anim.effect as KeyframeEffect).setKeyframes([{ transform: tr(0, 0) }, { transform: tr(dx, dy) }]);
          return;
        } catch {
          /* 不支持就从当前位置重新起飞 */
        }
      }
      const [fx, fy] = currentOffset(el);
      stop(rec);
      rec.mode = 'in';
      rec.dx = dx;
      rec.dy = dy;
      if (!animate) {
        arrive(el, rec)();
        return;
      }
      el.style.transform = tr(fx, fy);
      run(el, rec, fx, fy, dx, dy, arrive(el, rec));
    },

    back(el, animate, done) {
      const rec = recs.get(el);
      if (!rec) {
        done?.();
        return;
      }
      const [fx, fy] = currentOffset(el);
      stop(rec);
      rec.mode = 'out';
      rec.done = done ?? null;
      if (!animate || (Math.abs(fx) < 0.5 && Math.abs(fy) < 0.5)) {
        home(el, rec);
        return;
      }
      el.style.transform = tr(fx, fy);
      run(el, rec, fx, fy, 0, 0, () => home(el, rec));
    },

    clear(el) {
      const rec = recs.get(el);
      if (!rec) return;
      rec.done = null;
      home(el, rec);
    },

    finishAll() {
      for (const rec of [...recs.values()]) {
        try {
          rec.anim?.finish();
        } catch {
          /* 已经结束 */
        }
      }
    },

    settleAll() {
      for (const [el, rec] of [...recs]) {
        if (!rec.anim) continue;
        stop(rec);
        if (rec.mode === 'out') home(el, rec);
        else arrive(el, rec)();
      }
    },

    clearAll() {
      for (const el of [...recs.keys()]) this.clear(el);
    },

    isStaged(el) {
      const rec = recs.get(el);
      return !!rec && rec.mode !== 'out';
    },
  };
}
