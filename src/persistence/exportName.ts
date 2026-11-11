/** 导出文件名：today 为本地日期 YYYY-MM-DD。 */
export function exportFileName(today: string): string {
  return `unfinished-business-${today.replace(/-/g, '')}.json`;
}

/** 损坏数据副本的文件名：today 为本地日期 YYYY-MM-DD。内容不一定是合法 JSON，所以用 .txt。 */
export function damagedCopyFileName(today: string): string {
  return `unfinished-business-old-notebook-${today.replace(/-/g, '')}.txt`;
}
