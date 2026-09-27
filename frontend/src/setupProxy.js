const { createProxyMiddleware } = require("http-proxy-middleware");

// Runs inside the CRA/craco dev server (see start_frontend.bat). Forwarding
// /api over loopback here - regardless of which hostname the browser used to
// reach the dev server (localhost, a LAN IP, or a Cloudflare quick-tunnel
// hostname) - is what keeps the app single-origin: the browser only ever
// talks to the dev server, never to the backend's own host/port directly.
module.exports = function (app) {
  app.use(
    "/api",
    createProxyMiddleware({
      target: process.env.BACKEND_PROXY_TARGET || "http://127.0.0.1:8000",
      changeOrigin: true,
    }),
  );
};
