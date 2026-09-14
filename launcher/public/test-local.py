"""Read-only integration checks; never creates users or submits business data."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from database import DATABASE_URL, IS_SQLITE


def snapshot():
    if not IS_SQLITE:
        return None
    database = Path(DATABASE_URL.removeprefix('sqlite:///')).resolve()
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as connection:
        return hashlib.sha256('\n'.join(connection.iterdump()).encode()).hexdigest()


def response(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as result:
            return result.status, result.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


before = snapshot()
environment = dict(os.environ, PROCUREX_SKIP_DATABASE_INIT='1')
log_path = ROOT / 'logs/public-launcher/backend-smoke.log'
with log_path.open('w') as log:
    process = subprocess.Popen(
        [sys.executable, '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1',
         '--port', '18000', '--no-access-log'], cwd=ROOT / 'backend', env=environment,
        stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError('Isolated backend failed: see backend-smoke.log')
            try:
                status, body = response('http://127.0.0.1:18000/api/')
                if status == 200 and b'Procurement ERP API' in body:
                    break
            except OSError:
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Backend readiness timed out')
        assert response('http://127.0.0.1:18000/api/auth/me')[0] == 401
        assert response('http://127.0.0.1:18000/api/suppliers')[0] == 401
    finally:
        process.terminate()
        process.wait(timeout=15)
after = snapshot()
assert before == after, 'Database contents changed during the test; investigate concurrent application activity.'
result = {'backend_start': 'PASS', 'api_readiness': 'PASS', 'authentication_required': 'PASS',
          'database_logical_hash_unchanged': before == after, 'database_hash': after}
(ROOT / 'logs/public-launcher/local-test.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
