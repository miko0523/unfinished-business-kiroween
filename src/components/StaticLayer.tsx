import { useState } from 'preact/hooks';
import { srcFor, srcsetFor, type ModuleId } from '../house/assets';
import { layoutHouse, type GrownFloors } from '../house/layout';
import { FLOOR_IMAGE_SIZES, percentBox, stageBoxes } from '../house/stage';

/** 入参只有 grownFloors：类型层面读不到任何 Task 数据。 */
export interface StaticLayerProps {
  readonly grownFloors: GrownFloors;
}

export function StaticLayer({ grownFloors }: StaticLayerProps) {
  const [failed, setFailed] = useState<ReadonlySet<ModuleId>>(() => new Set());
  const layout = layoutHouse(grownFloors);
  const boxes = stageBoxes(layout);

  const markFailed = (id: ModuleId) => setFailed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  return (
    <div class="static-layer" aria-hidden="true">
      {boxes.map((b) => {
        const style = percentBox(b.x, b.y, b.w, b.h, layout.stageHeight);
        if (failed.has(b.id)) {
          return <div key={b.id} class="static-plate" data-module={b.id} data-failed="true" style={style} />;
        }
        return (
          <img
            key={b.id}
            class="static-module"
            data-module={b.id}
            alt=""
            aria-hidden="true"
            draggable={false}
            width={b.w}
            height={b.h}
            src={srcFor(b.id)}
            srcset={srcsetFor(b.id)}
            sizes={FLOOR_IMAGE_SIZES}
            style={style}
            onError={() => markFailed(b.id)}
          />
        );
      })}
    </div>
  );
}
