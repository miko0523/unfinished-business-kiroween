import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo } from 'preact/hooks';
import { SUPPORT_ZH } from '../i18n/copy';
import { forLanguage } from '../i18n/t';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { CopyContext } from './useCopy';

/** 当前房子决定界面与页面语言；切换不重建表单或清掉草稿。 */
export function LanguageScope({ children }: { children: ComponentChildren }) {
  const { store } = useAppContext();
  const chosen = useStore(store, (s) => s.settings.lang);
  const lang = SUPPORT_ZH ? chosen : 'en';
  const t = useMemo(() => forLanguage(lang), [lang]);
  useLayoutEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('app.title');
  }, [lang, t]);
  return <CopyContext.Provider value={t}>{children}</CopyContext.Provider>;
}
