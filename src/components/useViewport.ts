import { useEffect, useState } from 'preact/hooks';

export interface ViewportSize {
  w: number;
  h: number;
}

const read = (): ViewportSize => ({ w: window.innerWidth, h: window.innerHeight });

/** 视口宽高，窗口变化时更新。 */
export function useViewport(): ViewportSize {
  const [size, setSize] = useState(read);
  useEffect(() => {
    const on = () => setSize((prev) => {
      const next = read();
      return prev.w === next.w && prev.h === next.h ? prev : next;
    });
    window.addEventListener('resize', on);
    on();
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}
