import { useContext, useEffect, useState } from 'preact/hooks';
import { computeViewLayout, type ViewLayout } from '../house/viewport';
import { StoreContext } from '../store/StoreContext';
import type { Camera } from '../store/uiStore';
import { useViewport } from './useViewport';

/** 当前视口与镜头下的旧宅布局。没有 StoreContext（如校准页）时固定为聚焦。 */
export function useViewLayout(grownFloors: number): ViewLayout {
  const ctx = useContext(StoreContext);
  const { w, h } = useViewport();
  const [camera, setCamera] = useState<Camera>(() => ctx?.ui.getState().camera ?? 'focus');
  useEffect(() => {
    if (!ctx) return;
    const sync = () => setCamera(ctx.ui.getState().camera);
    sync();
    return ctx.ui.subscribe(sync);
  }, [ctx]);
  return computeViewLayout({ vw: w, vh: h, grownFloors, camera });
}
