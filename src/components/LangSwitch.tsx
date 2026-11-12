import { SUPPORT_ZH } from '../i18n/copy';
import { useAppContext } from '../store/StoreContext';
import { useStore } from '../store/useStore';
import { useCopy } from './useCopy';

/** 正常、恢复与临时页共用；是否保存由 store 的会话边界决定。一个小按钮：“E / 中”，当前语言那一半加粗，点一下切到另一种。 */
export function LangSwitch() {
  const t = useCopy();
  const { store } = useAppContext();
  const lang = useStore(store, (s) => s.settings.lang);
  if (!SUPPORT_ZH) return null;
  const zh = lang === 'zh-CN';
  return (
    <button
      type="button"
      class="lang-switch"
      aria-label={t(zh ? 'language.toEn' : 'language.toZh')}
      title={t(zh ? 'language.toEn' : 'language.toZh')}
      onClick={() => store.dispatch({ type: 'SetLang', lang: zh ? 'en' : 'zh-CN' })}
    >
      <span lang="en" aria-hidden="true" data-current={!zh}>{t('language.markEn')}</span>
      <span class="lang-sep" aria-hidden="true">/</span>
      <span lang="zh-CN" aria-hidden="true" data-current={zh}>{t('language.markZh')}</span>
    </button>
  );
}
