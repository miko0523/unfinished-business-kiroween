import { SUPPORT_ZH, type CopyKey, type Lang } from './copy';
import { en } from './en';
import { zhCN } from './zh-CN';

export type CopyParams = Readonly<Record<string, string | number>>;

/** 取文案；{name} 占位符用 params 替换。此后所有界面文字只能经由它取得。 */
export function t(key: CopyKey, params?: CopyParams, lang: Lang = 'en'): string {
  const text = (SUPPORT_ZH && lang === 'zh-CN' ? zhCN[key] : undefined) ?? en[key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export type Translate = (key: CopyKey, params?: CopyParams) => string;

/** 显式绑定语言；没有全局可变语言，也不读取浏览器偏好。 */
export function forLanguage(lang: Lang): Translate {
  return (key, params) => t(key, params, lang);
}
