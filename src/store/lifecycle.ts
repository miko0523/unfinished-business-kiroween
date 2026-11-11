// 页面隐藏或离开时，立刻把还没写下的变更补写进去。
import type { Store } from './store';

export function installFlushOnHide(store: Store): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') store.flush();
  };
  const onPageHide = () => store.flush();
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  };
}
