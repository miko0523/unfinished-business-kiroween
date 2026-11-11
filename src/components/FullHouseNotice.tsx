import { useCopy } from './useCopy';
import { useDemoControl } from '../demo/control';
import { Dialog } from './Dialog';

export interface FullHouseNoticeProps {
  /** “去看看住客”：关闭提示，由外层把焦点交给住客列表。 */
  onVisit(): void;
  /** “稍后再来”：关闭提示，草稿原样留着。 */
  onLater(): void;
}

/** 旧宅住满时的温柔提示。文案就是需求里的原文，不催促、不愧疚。 */
export function FullHouseNotice({ onVisit, onLater }: FullHouseNoticeProps) {
  const t = useCopy();
  const demo = useDemoControl();
  return (
    <Dialog labelledBy="full-house-text" onClose={onLater}>
      <p id="full-house-text">{t('create.error.houseFull')}</p>
      <div class="dialog-actions">
        <button type="button" class="primary" onClick={onVisit}>{t('fullHouse.visit')}</button>
        <button type="button" onClick={onLater}>{t('fullHouse.later')}</button>
        {demo.active ? <button type="button" class="demo-exit" onClick={demo.exit}>{t('demo.exit')}</button> : null}
      </div>
    </Dialog>
  );
}
