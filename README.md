# ProcureX — Local Windows Setup

ProcureX is the existing RE DECOR & MORE procurement application, migrated to run locally without Emergent or MongoDB. The Arabic RTL interface, screens, procurement calculations, workbook import/export, and real workbook data are preserved.

## Local architecture

- Frontend: React at `http://localhost:3000`
- Backend: FastAPI at `http://127.0.0.1:8000`
- API documentation: `http://127.0.0.1:8000/docs`
- Database: SQLite at `backend\procurement.db`
- Source workbook: `backend\workbook.xlsm`

The workbook remains the source for the initial migration. It is never overwritten by startup or import.

## Prerequisites

Install these once:

1. Python 3.11 or newer from [python.org](https://www.python.org/downloads/windows/). Enable **Add Python to PATH** during setup.
2. Node.js 20 LTS (including npm) from [nodejs.org](https://nodejs.org/).

MongoDB, Docker, WSL, and Emergent accounts or packages are not required.

## One-command startup

Double-click `start_app.bat` in the project folder.

The script opens two command windows, prepares missing dependencies, safely imports `backend\workbook.xlsm`, starts both services, waits for them to be ready, and opens `http://localhost:3000` in the default browser.

On first launch, dependency installation can take several minutes. Later launches reuse `.venv` and `frontend\node_modules`.

To stop the application, press `Ctrl+C` in both command windows or close them.

## Start each service separately

- Double-click `start_backend.bat` to run the API and workbook migration.
- Double-click `start_frontend.bat` to run only the React UI.

The frontend expects the backend at `http://127.0.0.1:8000`.

## Environment configuration

Local defaults are already present in the ignored `.env` files. Portable templates are included:

- `backend\.env.example`
- `frontend\.env.example`

Backend variables:

```env
DATABASE_URL=sqlite:///./procurement.db
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

Frontend variable:

```env
REACT_APP_BACKEND_URL=http://127.0.0.1:8000
```

Restart the relevant service after changing an environment file.

### Optional document extraction

Document extraction is disabled by default and the manual purchase-request form
continues to work without any cloud credentials. To enable reviewed extraction,
set the following in `backend\.env` and restart the backend:

```env
DOCUMENT_EXTRACTION_ENABLED=true
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://YOUR-RESOURCE.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=YOUR_AZURE_KEY
OPENAI_API_KEY=YOUR_OPENAI_KEY
OPENAI_DOCUMENT_EXTRACTION_MODEL=YOUR_STRUCTURED_OUTPUTS_MODEL
```

Optional overrides are `AZURE_DOCUMENT_INTELLIGENCE_API_VERSION` (default
`2024-11-30`), `AZURE_DOCUMENT_INTELLIGENCE_MODEL` (default `prebuilt-layout`),
`OPENAI_API_BASE_URL` (default `https://api.openai.com/v1`),
`DOCUMENT_PROVIDER_TIMEOUT_SECONDS`, `DOCUMENT_MAX_FILE_BYTES`,
`DOCUMENT_MAX_TOTAL_BYTES`, `DOCUMENT_MAX_FILES`,
`DOCUMENT_PROCESSING_MAX_ATTEMPTS`, `DOCUMENT_WORKER_POLL_SECONDS`, and
`DOCUMENT_RETENTION_DAYS`.

Open `/request-purchase`, choose **Upload or photograph a document**, and submit
a synthetic printed or handwritten request. The internal review link appears on
the matching incoming request. Correct every extracted row and select the explicit
review acknowledgment before confirmation. No extracted row or suggested match is
added to a request automatically.

To disable extraction, set `DOCUMENT_EXTRACTION_ENABLED=false` and restart. The UI
will show the feature as unavailable while preserving manual entry and already
saved reviews. To test without calling providers, run the backend suite; its fake
provider fixtures use temporary databases and synthetic images only:

```bat
.venv\Scripts\python.exe -m pytest backend\tests -k document_capture -q
```

Migration `0005_purchase_request_document_capture` is additive. Local SQLite
startup creates a verified pre-migration backup. Destructive downgrade is disabled;
rollback is performed by stopping ProcureX and restoring that verified database
backup together with its matching attachment directory.

## Real data migration

`start_backend.bat` runs the migration before every backend start. The import is idempotent: existing entity codes/names, purchase IDs and invoice/supplier pairs, payment IDs, and price-history keys are skipped.

Expected records from the supplied workbook:

| Data | Count |
|---|---:|
| Suppliers | 17 |
| Customers | 2 |
| Projects | 2 |
| Items | 15 |
| Purchases | 1 |
| Purchase item / price-history rows | 5 |
| Payments | 1 |
| Settings lists | 12 |

The supplied purchase is `PUR-000001` for 29,947.50 EGP and is fully paid by `PAY-001`.

To run the migration manually:

```bat
.venv\Scripts\python.exe backend\migrate.py
```

Running it again should report zero imported rows.

## Excel import and export

Use **سجل المشتريات** in the application:

- **استيراد Excel** accepts `.xlsx` or `.xlsm` and applies the same duplicate protection as startup migration.
- **تصدير Excel** downloads the current SQLite data as a multi-sheet RTL `.xlsx` file.

Keep `backend\workbook.xlsm` as the original backup. For regular backups, close the backend and copy both `backend\workbook.xlsm` and `backend\procurement.db` to a safe location.

## Manual development commands

Backend:

```bat
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
.venv\Scripts\python.exe backend\migrate.py
cd backend
..\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8000
```

Frontend, in another command window:

```bat
cd frontend
npm install
npm start
```

## Verification and tests

Backend tests use a temporary SQLite database and do not alter the local real-data database:

```bat
.venv\Scripts\python.exe -m pytest backend\tests -q
```

Frontend production build:

```bat
cd frontend
npm run build
```

## Troubleshooting

### Axios 404 or network errors

1. Confirm the backend window says it is serving on `http://127.0.0.1:8000`.
2. Open `http://127.0.0.1:8000/api/`; it should return the ProcureX API message.
3. Confirm `frontend\.env` contains `REACT_APP_BACKEND_URL=http://127.0.0.1:8000`.
4. Restart the frontend after editing `.env`.

### Port already in use

Close previous ProcureX command windows. The standard ports are 8000 for FastAPI and 3000 for React.

### Python dependency installation fails

Delete only the project `.venv` folder, then run `start_backend.bat` again. The dependency list uses public open-source packages only.

### Frontend dependency installation fails

Run `npm cache verify`, then run `start_frontend.bat` again. No Emergent-hosted npm package is required.

### Reset the local database from the workbook

First make a backup. With the backend stopped, rename `backend\procurement.db` to `backend\procurement.backup.db`, then run `start_backend.bat`. A fresh database will be created from the unchanged workbook. Renaming is recommended instead of deleting so recovery remains possible.
