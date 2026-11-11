import { useEffect } from 'preact/hooks';

/** 页面隐藏时给根元素打上标记，样式据此暂停所有装饰动态；页面回来后摘掉。 */
export function usePageHiddenFlag(): void {
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.toggleAttribute('data-page-hidden', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      root.removeAttribute('data-page-hidden');
    };
  }, []);
}
