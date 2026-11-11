import type { Env } from '../domain/types';

let fallbackCounter = 0;

/** 外壳提供的时钟与 id；reducer 自己不读时钟、不生成随机数。 */
export function browserEnv(): Env {
  return {
    random: () => Math.random(),
    now: () => new Date().toISOString(),
    today: () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    },
    newId: () => {
      const c = globalThis.crypto;
      if (c && typeof c.randomUUID === 'function') return c.randomUUID();
      fallbackCounter += 1;
      return `id-${Date.now().toString(36)}-${fallbackCounter}-${Math.random().toString(36).slice(2, 10)}`;
    },
  };
}
