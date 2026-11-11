import type { ComponentChildren } from 'preact';
import type { Task } from '../domain/types';
import { residentFloors } from '../house/order';
import { useCopy } from './useCopy';

export const RESIDENTS_ID = 'residents';

export interface ResidentListProps {
  tasks: readonly Task[];
  /** 渲染一只住客：必须返回一个 <li>，里面放这只 Ghost 唯一的按钮。 */
  renderResident(task: Task): ComponentChildren;
}

/** 把键盘焦点放到住客列表上（“去看看住客”）；列表还没出现时返回 false。 */
export function focusResidents(): boolean {
  const list = document.getElementById(RESIDENTS_ID);
  if (!list) return false;
  list.focus();
  return true;
}

/**
 * 唯一的住客控件集：顶层 Residents 列表 → 每个有住客的楼层一项（有名称）→ 内层列表 → 每只 Ghost 一项。
 * DOM 顺序即 Tab 顺序：楼层从高到低，同层从左到右。这里不画任何东西，位置与动作由外层的每一项自己带。
 */
export function ResidentList({ tasks, renderResident }: ResidentListProps) {
  const t = useCopy();
  const floors = residentFloors(tasks);
  if (floors.length === 0) return null;
  return (
    <ul id={RESIDENTS_ID} class="residents" role="list" tabIndex={-1} aria-label={t('residents.label')}>
      {floors.map(({ floor, residents }) => (
        <li key={floor} class="resident-floor" data-floor={floor} aria-labelledby={`resident-floor-${floor}`}>
          <span id={`resident-floor-${floor}`} class="visually-hidden">
            {t('floor.label', { floor })}
          </span>
          <ul class="floor-residents" role="list">
            {residents.map(renderResident)}
          </ul>
        </li>
      ))}
    </ul>
  );
}
