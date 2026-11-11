import type { CopyKey, Lang } from '../../src/i18n/copy';

// 只扫词表和应用生成的文字；玩家输入不是应用文案，不能据此拦截或改写。
export const EMOTION = /断签|逾期|羞辱|催促|愧疚|放弃|失败|丢脸|惩罚|偷懒|赶紧|快点|\b(streaks?|overdue|late|failed|failure|give\s+up|hurry|shame|guilty|punishment|lazy)\b/i;
export const TECH = /哈希|版本|键名|存储|解析|素材|生成工具|生成方式|内部编号|内部标识|碰撞框|多边形|预留矩形|免责声明|\b(hash(?:es)?|version|key|id|schema|localStorage|sessionStorage|indexedDB|JSON|parse|UUID|API|SDK|error\s+code|asset|source\s+file|copyright|disclaimer|ChatGPT|OpenAI|Midjourney|DALL[·-]?E|Stable\s+Diffusion|Vite|TypeScript|PNG|SVG|JPEG|WebP)\b|\.(?:png|svg|jpe?g|webp|json|tsx?|jsx?|css|html|zip|txt|md|ya?ml)\b/i;
export const INTERNAL = /ghostNo|ub:|floor-0|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

// 当前没有例外。将来如确有需要，必须限定语言、文案键、精确命中词并写理由；
// 测试还会拒绝空理由、过时条目以及重复条目，不能用整条文案豁免扫描。
export const COPY_ALLOWLIST: readonly { lang: Lang; key: CopyKey; token: string; reason: string }[] = [];

export function copyIssues(text: string, lang?: Lang, key?: CopyKey): string[] {
  const issues: string[] = [];
  for (const pattern of [EMOTION, TECH, INTERNAL]) {
    for (const [token] of text.matchAll(new RegExp(pattern.source, 'gi'))) {
      if (!COPY_ALLOWLIST.some((a) => a.lang === lang && a.key === key && a.token === token && a.reason.trim())) issues.push(token);
    }
  }
  return issues;
}
