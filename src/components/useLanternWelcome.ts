import { useEffect, useState } from 'preact/hooks';
import type { Store } from '../store/store';

/** Event-only response: never replays on load and never changes collected lamps. */
export function useLanternWelcome(store: Store): boolean {
  const [welcoming, setWelcoming] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = store.subscribeEvents((events) => {
      if (!events.some((e) => e.type === 'GhostMovedIn' && store.getState().tasks.find((task) => task.id === e.taskId)?.ghostKind === 'lantern')) return;
      clearTimeout(timer);
      setWelcoming(true);
      timer = setTimeout(() => setWelcoming(false), 1800);
    });
    return () => { off(); clearTimeout(timer); };
  }, [store]);
  return welcoming;
}
