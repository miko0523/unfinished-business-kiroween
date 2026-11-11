import { useDemoControl } from '../demo/control';
import { forLanguage } from '../i18n/t';
import { useCopy } from './useCopy';

const SAMPLE_KEYS = ['demo.sample.title', 'demo.sample.criteria', 'demo.sample.step1', 'demo.sample.step2', 'demo.sample.step3'] as const;
const originals = [forLanguage('en'), forLanguage('zh-CN')];

/** 只翻译示例里仍保持原样的预置句子；真实房子的正文不经过翻译。 */
export function useSampleText() {
  const demo = useDemoControl();
  const t = useCopy();
  return (text: string): string => {
    const key = demo.active ? SAMPLE_KEYS.find((key) => originals.some((copy) => copy(key) === text)) : undefined;
    return key ? t(key) : text;
  };
}
