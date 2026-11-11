import { SUPPORT_ZH } from '../i18n/copy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { useCopy } from './useCopy';

/** 正常、恢复与临时页共用；是否保存由 store 的会话边界决定。 */
export function LangSwitch() {
  const t = useCopy();
  const { store } = useAppContext();
  const lang = useStore(store, (s) => s.settings.lang);
  if (!SUPPORT_ZH) return null;
  return (
    <div class="lang-switch" role="group" aria-label={t('language.label')}>
      {(['en', 'zh-CN'] as const).map((value) => (
        <button type="button" lang={value} aria-pressed={lang === value}
          onClick={() => store.dispatch({ type: 'SetLang', lang: value })}>
          {t(`language.${value}`)}
        </button>
      ))}
    </div>
  );
}
