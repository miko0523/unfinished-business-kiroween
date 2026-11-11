/** 把一段文本当作 UTF-8 文件交给浏览器下载（默认 JSON）。失败时抛出。 */
export function downloadText(filename: string, text: string, type = 'application/json;charset=utf-8'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // 稍后再释放，给浏览器留出读取的时间。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
