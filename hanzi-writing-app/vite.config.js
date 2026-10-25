import { defineConfig, loadEnv } from 'vite';
import searchHandler from './api/search.js';
import translateHandler from './api/translate.js';

export default defineConfig(({ mode }) => {
  // Nạp toàn bộ biến trong .env / .env.local (kể cả không có tiền tố VITE_) vào process.env
  // để các hàm trong thư mục api/ đọc được GEMINI_API_KEY, MONGODB_URI khi chạy `npm run dev`
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return viteConfig;
});

const viteConfig = {
  plugins: [
    {
      name: 'vercel-api-dev-server',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const url = new URL(req.url, `http://${req.headers.host}`);

          // Mock helper res.status() và res.json() cho môi trường Vite dev
          res.status = (code) => {
            res.statusCode = code;
            return res;
          };
          res.json = (data) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(data));
            return res;
          };

          if (url.pathname === '/api/search') {
            req.query = Object.fromEntries(url.searchParams);
            try {
              await searchHandler(req, res);
            } catch (err) {
              res.status(500).json({ error: err.message });
            }
            return;
          }

          if (url.pathname === '/api/translate') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                req.body = body ? JSON.parse(body) : {};
              } catch {
                req.body = {};
              }
              try {
                await translateHandler(req, res);
              } catch (err) {
                res.status(500).json({ error: err.message });
              }
            });
            return;
          }

          next();
        });
      }
    }
  ]
};

