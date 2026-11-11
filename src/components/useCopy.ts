import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import { forLanguage } from '../i18n/t';

// 语言来自当前房子的设置；示例与真实房子各自持有一份。
export const CopyContext = createContext(forLanguage('en'));

export function useCopy() {
  return useContext(CopyContext);
}
