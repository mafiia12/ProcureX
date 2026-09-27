# ProcureX Windows public launcher

Double-click **START PROCUREX PUBLIC.bat** on the Desktop. The first build can take several minutes. When ready, the launcher opens the browser, copies the URL to the clipboard, and saves **PROCUREX PUBLIC URL.txt** on the Desktop. The PC must stay awake and connected. Double-click **STOP PROCUREX.bat** to stop launcher-owned services. An independently started backend is deliberately preserved.

START now closes automatically on success. Only an error pauses for a key press. Backend, frontend, and cloudflared are created with Windows `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`, with stdin disconnected and stdout/stderr writing directly to log file handles. They do not inherit the launcher's console and do not depend on a PowerShell output reader. The short Python spawning helper exits immediately. Process IDs and creation timestamps remain in `logs/public-launcher/state.json` for safe STOP. No administrator token, Windows service installation, DNS changes, or firewall changes are needed. See [Microsoft's process creation flag definitions](https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags).

Run **INSTALL DESKTOP LAUNCHERS.bat** in this folder to install or refresh the Desktop wrappers after moving the repository. Master START/STOP files at the repository root locate helpers relative to themselves. Desktop wrappers remember the installed repository location and report a readable error if it moves. No administrator rights, editor, or pre-existing terminal is needed.

## Architecture

The inspected project startup scripts and proxy use backend 8000 and frontend 3000. The launcher uses the existing `.venv` with `uvicorn server:app`, bound to loopback, and the existing full-app `craco build` configuration. The separate `build:public` script is a different request portal and is intentionally not used. A dedicated ignored `frontend/build-launcher` output avoids overwriting the normal build. Both browser API origins are set to `/` during this build so their existing trailing-slash normalization yields same-origin `/api`, including purchase requests. Environment files are never edited.

Compiled output is reused when the source/configuration fingerprint matches. Changed frontend sources, public assets, configuration, dependency manifests, or environment files trigger a rebuild.

The Node static server binds only to 127.0.0.1:3000 and forwards only `/api` to 127.0.0.1:8000. It does not serve repository files, source maps, development tooling, or backend OpenAPI/docs. It preserves authentication headers and strips client-supplied forwarding identities. Existing authentication and role checks are unchanged.

Before launching a backend, a read-only preflight verifies the existing SQLite file and core tables. `PROCUREX_SKIP_DATABASE_INIT=1` disables the existing application's initialization/schema helpers for this launcher only. Normal startup behavior is unchanged. There are no database installation, migration, reset, import, or seed commands. Existing background jobs retain their normal application behavior.

START/STOP serialize through a file lock. Process IDs plus creation timestamps guard against stale state/PID reuse after restart. STOP traverses only descendants of verified launcher-owned processes. START reuses an owned frontend or a verified repository backend; incompatible or unverifiable port occupants produce an error without being killed. Failed starts roll back only processes created during that attempt.

Persistent services write combined stdout/stderr directly to `logs/procurex-backend.log`, `logs/procurex-frontend.log`, and `logs/procurex-tunnel.log`. State, build logs, and diagnostic results live in `logs/public-launcher/` (all Git-ignored). One previous session is retained. Backend access logging is disabled. Logs rotate on startup, not during a continuous session. Older `logs/public-launcher/procurex-tunnel.error.log` files are historical, not the live tunnel log.

Cloudflared is found on PATH; no credentials are stored in batch files. It uses an isolated Quick Tunnel configuration, HTTP/2 outbound transport, and loopback-only metrics. Only the frontend is the tunnel origin. The generated URL is extracted automatically and both public HTML and proxied API readiness are checked before reporting online. Quick Tunnels can change URL after restart and have no uptime guarantee: [official Cloudflare documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

If normal public URL requests fail, the launcher also tries Cloudflare DNS (1.1.1.1) and `curl --resolve`, retaining HTTPS certificate validation. This does not modify Windows, router, or browser DNS. If that fallback succeeds, a warning explains that the public service works but the default browser may still have DNS trouble. The current router DNS (192.168.1.1) returned NXDOMAIN during testing while Cloudflare DNS resolved the same names successfully. Use another connection (for example mobile data) or browser secure DNS to verify login if that persists.

The DNS fallback is used only when system hostname resolution fails, not for ordinary HTTP errors. A DNS warning is also saved beneath the URL in the Desktop URL file and in `logs/public-launcher/startup-status.txt`, so it remains visible after START closes. An alive process alone is never treated as proof of public readiness: both public HTML and API responses are required.

If cloudflared is missing, install the official **Cloudflare.cloudflared** Windows Package Manager package (`winget install --id Cloudflare.cloudflared --exact`), then restart the launcher. This machine already has cloudflared installed. Missing Python/frontend dependencies are reported without rebuilding environments or touching data.

For a future named tunnel, replace the isolated tunnel-start block in `ProcureX.ps1` with a named-tunnel invocation and use its fixed URL. Keep the static frontend origin, readiness checks, and ownership tracking.

Successful account login requires your existing credentials; the launcher never creates accounts or changes passwords.

## Tests performed, 2026-09-13

Follow-up persistence diagnosis: the original saved tunnel PID 13912 was still alive with its matching creation time, and the original log showed a registered connection. The observed reachability failure was hostname resolution, not evidence that the final batch pause killed the tunnel. Explicit console detachment and direct log handles were nevertheless added to remove launcher lifetime dependencies.

The Desktop START host (PID 8732) exited at 14:27:28 UTC. At 14:28:32 UTC, 63.5 seconds later, the same detached frontend PID 20676 and tunnel PID 15524 were alive; ports 3000/8000 were listening, and public HTML/API passed through certificate-validated Cloudflare HTTPS. The Windows administrator-token check was false. Normal router DNS still failed. The independent web-fetch tool could not open the temporary hostname, so verification used the actual public Cloudflare edge from this PC rather than a second external machine. These test PIDs/URL are historical and change after STOP/restart.

- Existing backend was identified and reused. An isolated backend on loopback 18000 also started successfully using the same environment and initialization opt-out, then exited cleanly.
- Local frontend rendered the actual Arabic username/password login screen in a browser.
- Cloudflare connected using HTTP/2 and the public URL was detected, saved to the Desktop, copied to the clipboard, and dispatched to the default browser.
- Public HTTPS HTML and `/api/`: 200 via Cloudflare DNS fallback. `/api/auth/me` and `/api/suppliers`: 401 without credentials. `/.env` and a missing static asset: 404.
- Duplicate START retained frontend/tunnel PIDs. STOP removed launcher-owned frontend/tunnel and preserved the independently started backend.
- An unrelated test Node service on 3000 was rejected by START and survived STOP. Restart succeeded and reused the compiled build.
- Read-only logical snapshots of the SQLite schema/data matched before and after backend testing and across the lifecycle tests. No accounts, procurement records, or database schema were created or changed by the tests.
- `git diff --check` passed. No commit was made.

Run `test-local.py` with the existing virtualenv for the isolated read-only backend test. `test-lifecycle.ps1` requires a successfully running launcher and an independently started backend; it deliberately stops/restarts the launcher and uses a temporary port-3000 fixture.

`test-after-exit.ps1` exercises the actual Desktop batch file through a separate hidden cmd.exe host. It waits for that host to exit successfully, waits at least 60 seconds, checks saved PID creation times and both local listeners, and verifies public HTML and API over HTTPS. It writes measured timestamps and results to `logs/public-launcher/exit-test-result.json`. Run STOP before this test to exercise freshly detached processes.

Not verified: a successful login with a real user's credentials, a physical Windows reboot, or public browser rendering on this router's failing DNS. Final manual check: open the Desktop URL on mobile data (or a browser with working secure DNS) and sign in with your existing account. Authentication rejection was verified; no credentials were read or fabricated.
