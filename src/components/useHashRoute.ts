import { useEffect, useState } from 'preact/hooks';

export type Route = 'house' | 'archive';

const read = (): Route => (window.location.hash === '#/archive' ? 'archive' : 'house');

/** 只有两个固定的 hash：旧宅（#/ 或空）与纪念册（#/archive）。Task 文字不会出现在 URL 里。 */
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener('hashchange', on);
    on();
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
