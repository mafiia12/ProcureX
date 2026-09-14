// Serve the compiled full app and its same-origin API, without development tools.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../frontend/build-launcher');
const types = {'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-ProcureX-Launcher', 'static-v1');
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const headers = {...req.headers, host:'127.0.0.1:8000'};
    for (const key of Object.keys(headers)) {
      if (key.startsWith('x-forwarded-') || ['forwarded','cf-connecting-ip','true-client-ip'].includes(key)) delete headers[key];
    }
    const upstream = http.request({hostname:'127.0.0.1',port:8000,path:req.url,method:req.method,headers}, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('ProcureX API unavailable'); });
    req.on('aborted', () => upstream.destroy());
    req.pipe(upstream);
    return;
  }
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { res.writeHead(400); res.end(); return; }
  let file = path.resolve(root, '.' + decoded);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
  if (decoded.split('/').some(part => part.startsWith('.')) || file.endsWith('.map')) { res.writeHead(404); res.end(); return; }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(decoded)) { res.writeHead(404); res.end(); return; }
    file = path.join(root, 'index.html');
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = fs.createReadStream(file);
  stream.on('error', () => { if (!res.headersSent) res.writeHead(500); res.end(); });
  stream.pipe(res);
}).listen(3000, '127.0.0.1', () => console.log('ProcureX static frontend ready on 127.0.0.1:3000'));
