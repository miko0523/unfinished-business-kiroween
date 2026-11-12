// 声音模块唯一接触浏览器的地方：音频环境的构造、内嵌音频的解码、定时器（R14.8）。
// 音频作为应用模块的一部分延迟加载；公开仓库与构建产物都不分发可独立下载的音频文件。
import type { AudioDeps, ContextLike } from './engine';

type ContextCtor = new () => ContextLike;

function decodeBase64(encoded: string): ArrayBuffer {
  const binary = window.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function browserAudioDeps(): AudioDeps {
  return {
    createContext() {
      const w = window as unknown as { AudioContext?: ContextCtor; webkitAudioContext?: ContextCtor };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (typeof Ctor !== 'function') throw new Error('no audio');
      return new Ctor();
    },
    async load(path) {
      const { EMBEDDED_AUDIO } = await import('./embeddedAudio');
      const encoded = EMBEDDED_AUDIO[path as keyof typeof EMBEDDED_AUDIO];
      if (typeof encoded !== 'string') throw new Error('unexpected path');
      return decodeBase64(encoded);
    },
    wait: (ms) => new Promise<void>((done) => window.setTimeout(done, ms)),
  };
}

/** 页面此刻是否在后台。 */
export const pageHidden = (): boolean => typeof document !== 'undefined' && document.hidden === true;
