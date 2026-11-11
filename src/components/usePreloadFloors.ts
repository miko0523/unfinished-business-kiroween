import { useEffect, useRef, useState } from 'preact/hooks';
import { pendingFloorModules, srcFor, srcsetFor } from '../house/assets';
import { FLOOR_IMAGE_SIZES } from '../house/stage';

/**
 * 还没长出的楼层图片的预载状态。
 * - `ready`：它们都已经到了浏览器手里（或本来就没有尚未出现的楼层）。这之后断网，新楼层仍能长出来。
 * - `loading`：正在趁空闲一张一张取。
 * - `partial`：有图片没取到；长出那层时会用纯色底板顶替，不会弹提示。
 */
export type FloorPreloadStatus = 'loading' | 'ready' | 'partial';

/** 空闲回调；不支持时退回一个短定时器。返回取消函数。 */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 300);
  return () => window.clearTimeout(id);
}

/**
 * 页面渲染好之后，趁空闲用 `Image` 对象依次取下一层、下下层……的图片（不使用 Service Worker）。
 * `srcset` 与 `sizes` 和静态层显示时完全一样，所以浏览器为将来的那一层选中并缓存的，正是之后真正要显示的那个文件。
 * 取回的 `Image` 一直握在手里，直到旧宅卸载，避免浏览器过早丢掉。每个组件实例只跑一轮，不随楼层增长重来。
 */
export function usePreloadFloors(grownFloors: number): FloorPreloadStatus {
  // 第一轮只看挂载时的楼层数；之后的增长不重启（已长出的图片本来就在显示）。
  const initialFloors = useRef(grownFloors);
  const queue = pendingFloorModules(initialFloors.current);
  const [status, setStatus] = useState<FloorPreloadStatus>(queue.length === 0 ? 'ready' : 'loading');

  useEffect(() => {
    const ids = pendingFloorModules(initialFloors.current);
    if (ids.length === 0) return;
    let cancelled = false;
    let cancelIdle = () => {};
    let failures = 0;
    const held: HTMLImageElement[] = [];

    const step = (i: number) => {
      if (cancelled) return;
      if (i >= ids.length) {
        setStatus(failures === 0 ? 'ready' : 'partial');
        return;
      }
      cancelIdle = whenIdle(() => {
        const id = ids[i]!;
        const img = new Image();
        const finish = (ok: boolean) => {
          if (!ok) failures++;
          step(i + 1);
        };
        img.onload = () => {
          // 解码也趁现在做完；失败不影响“已取到”。
          void img.decode?.().catch(() => {});
          finish(true);
        };
        img.onerror = () => finish(false);
        img.sizes = FLOOR_IMAGE_SIZES;
        img.srcset = srcsetFor(id);
        img.src = srcFor(id);
        held.push(img);
      });
    };
    step(0);

    return () => {
      cancelled = true;
      cancelIdle();
      for (const img of held) {
        img.onload = null;
        img.onerror = null;
      }
      held.length = 0;
    };
  }, []);

  return status;
}
