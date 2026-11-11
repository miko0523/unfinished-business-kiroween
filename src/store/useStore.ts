import { useEffect, useRef, useState } from 'preact/hooks';
import type { Subscribable } from './store';

/** 订阅 store 的一部分；选择器结果引用不变则不重渲染。 */
export function useStore<S, T>(store: Subscribable<S>, select: (s: S) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const [value, setValue] = useState<T>(() => select(store.getState()));

  useEffect(() => {
    const sync = () => {
      const next = selectRef.current(store.getState());
      setValue((prev) => (Object.is(prev, next) ? prev : next));
    };
    sync();
    return store.subscribe(sync);
  }, [store]);

  return value;
}
