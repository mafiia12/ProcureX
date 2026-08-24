# ProcureX Windows installer

`ProcureXSetup.exe` is an offline x64 Windows 10/11 installer. It installs the
application under `C:\Program Files\ProcureX` by default and includes the silent
launcher, a frozen Python backend runtime, and the prebuilt React frontend.
System Python and Node.js are detected for diagnostics but are not prerequisites.

## Installation

1. Copy `ProcureXSetup.exe` to the target Windows computer.
2. Verify its SHA-256 against `ProcureXSetup.sha256`.
3. Right-click the installer and choose **Run as administrator**.
4. Keep **Create a desktop shortcut** selected and complete Setup.
5. Start ProcureX from the Desktop or Start Menu. The default browser opens at
   `http://localhost:3000` after both local services pass their health checks.

Setup creates an uninstall entry in Windows Apps & Features. Running Setup again
repairs the installed binaries. Installing a newer version performs an in-place
upgrade and creates a verified database backup before replacing application files.

## Writable business data

Program files and business data are intentionally separated:

| Content | Location |
|---|---|
| SQLite database | `%LOCALAPPDATA%\ProcureX\data\procurement.db` |
| Request uploads | `%LOCALAPPDATA%\ProcureX\data\attachments\incoming_requests` |
| Verified backups | `%LOCALAPPDATA%\ProcureX\data\backups` |
| Launcher/backend/frontend logs | `%LOCALAPPDATA%\ProcureX\logs` |

The installer never packages or overwrites an existing database, attachment, or
backup. Fresh installations create an empty schema on first launch and do not add
sample data. To move an existing company database to another computer, use the
Start Menu **Backup ProcureX Data** and **Restore ProcureX Data** tools.

## Upgrade, repair, and rollback

- Stop ProcureX before an upgrade. Setup also requests a clean stop automatically.
- Setup refuses an upgrade if it cannot create and verify the pre-upgrade backup.
- Schema migrations use the application's verified SQLite backup mechanism.
- For repair, rerun the same `ProcureXSetup.exe`; LocalAppData is not replaced.
- For rollback, uninstall only the application, reinstall the former Setup.exe,
  then use **Restore ProcureX Data** if a database rollback is explicitly required.
  Restore validates integrity and foreign keys and makes a safety backup first.

## Uninstall

Uninstall from Windows Apps & Features or the ProcureX Start Menu. Business data
is preserved by default. The uninstaller presents:

> Delete ProcureX business data

This checkbox is unchecked by default. Select it only after confirming that a
verified external backup exists and permanent deletion is intended.

## Troubleshooting

Use the Start Menu **Troubleshooting Startup** entry or run `start_app.bat` from
the installation directory. Review the three log files under
`%LOCALAPPDATA%\ProcureX\logs`. Ports 3000 and 8000 must be available.

## Rebuilding

Prerequisites on the build workstation only:

- Node.js/npm with the existing frontend dependencies
- Project `.venv` with the desktop requirements and PyInstaller
- Inno Setup 6

From the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\installer\Build-Installer.ps1 -Version 0.3.0
```

Build intermediates are placed under `installer\.build` and `installer\staging`;
the distributable and checksum are written to `installer\output`.

Run the installer smoke test with an explicit disposable data root so it cannot
touch an existing Windows profile database:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\installer\tests\Invoke-InstallerTests.ps1 `
  -DataRoot 'D:\temp\procurex-installer-test\ProcureX'
```
