# ProcureX Windows Launcher

`ProcureXLauncher.exe` starts the existing FastAPI and React development services
without opening terminal windows. It does not modify the database, workbook,
routes, calculations, backend architecture, or frontend architecture.

When installed by `ProcureXSetup.exe`, the same launcher detects the bundled
desktop runtime and production frontend automatically. Installed mode does not
require system Python, Node.js, `node_modules`, or a React development server.
Writable files are redirected to `%LOCALAPPDATA%\ProcureX`.

## Normal use

- Double-click **ProcureX** on the Desktop or Start Menu.
- The launcher reuses healthy services, starts only missing services, waits for
  both health checks, and opens `http://localhost:3000` in the default browser.
- Double-click **Stop ProcureX** to stop services that were started by the launcher.
- `start_app.bat` remains the visible troubleshooting fallback.

The launcher remains as a windowless supervisor process while it owns either
service. A named mutex prevents a second supervisor. A Windows Job Object prevents
orphaned backend/frontend processes if the supervisor exits unexpectedly.

If a service is already running outside the launcher, it is reused but never
terminated by the Stop shortcut. This avoids killing an unrelated or manually
managed process. A port that responds with the wrong ProcureX health signature is
reported as occupied.

## Logs and state

- `logs/backend.log`
- `logs/frontend.log`
- `logs/launcher.log`
- `logs/launcher.state` while the supervisor is active

For an installed copy these paths are under `%LOCALAPPDATA%\ProcureX\logs`.
Repository development continues to use the project-local `logs` directory.

All logs append timestamps and remain available after shutdown. Startup failures
show one Windows error dialog and point to this folder.

## Dependencies

- Windows 10 or 11
- Python 3.11+; project virtual environment at `.venv\Scripts\python.exe` preferred
- Backend packages from `backend\requirements.txt`
- Node.js 20 LTS
- Existing `frontend\node_modules` with CRACO and React Scripts

The silent launcher never installs dependencies or uses the network to repair the
environment. Run `start_app.bat` for visible setup/troubleshooting when dependencies
are missing.

## Build and shortcut commands

Rebuild after changing `launcher/src/Program.cs`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\Build-Launcher.ps1
```

Install or repair the current user's shortcuts:

```powershell
.\launcher\ProcureXLauncher.exe --install
```

Remove only the shortcuts created by ProcureX:

```powershell
.\launcher\ProcureXLauncher.exe --uninstall-shortcuts
```

Run the launcher integration suite only when ports 8000 and 3000 are free:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\launcher\tests\Invoke-LauncherTests.ps1
```

## Rollback

1. Run `ProcureXLauncher.exe --stop`.
2. Run `ProcureXLauncher.exe --uninstall-shortcuts`.
3. Return to `start_app.bat`.
4. After verifying no launcher supervisor remains, the additive `launcher` folder
   and optional `logs` folder can be archived or removed with explicit approval.

No database or workbook rollback is needed because this phase does not touch them.
