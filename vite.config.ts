import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiKey = env.VITE_OUTSHIFT_API_KEY;

  return {
    base: mode === 'production' ? '/stats-game/' : '/',
    server: {
      open: false,
      proxy: {
        '/api/qrng': {
          target: 'https://api.qrng.outshift.com',
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace('/api/qrng', '/api/v1/random_numbers'),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) {
                proxyReq.setHeader('x-id-api-key', apiKey);
              }
              proxyReq.setHeader('Content-Type', 'application/json');
              proxyReq.setHeader('Accept', 'application/json');
            });
          }
        }
      }
    }
  };
});
