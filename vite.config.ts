import { defineConfig } from 'vite';

// base: './' 讓打包後的網頁放在 GitHub Pages 的子路徑（/ProjectLite/）也能正常載入
export default defineConfig({
  base: './',
  test: { globals: true, environment: 'node' },
});
