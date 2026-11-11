import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  build: {
    rolldownOptions: {
      output: {
        // 框架单独成一个文件：产物扫描（tests/dist.test.ts）只对这一个文件放行 Preact 自带的命名空间常量与 HTML 渲染实现，
        // 并核对它只含 node_modules/preact；应用自己的脚本一概按最严的规则扫。
        codeSplitting: { groups: [{ name: 'preact', test: /node_modules[\\/]preact[\\/]/ }] },
      },
    },
  },
});
