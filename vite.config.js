import { defineConfig } from 'vite';

// base './' 使产物可直接托管在 GitHub Pages 子路径（https://<user>.github.io/<repo>/）
// emptyOutDir:false：本机 safe-delete 包装器会拦截 fs.rmSync(dist)，关闭自动清空避免构建失败
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@lark-base-open/js-sdk')) {
            return 'feishu-sdk';
          }
        },
      },
    },
  },
});
