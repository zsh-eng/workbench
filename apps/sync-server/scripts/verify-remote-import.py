#!/usr/bin/env python3
"""Read-only full comparison of a closed production target with its import plan."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tomllib
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    plan = json.loads(args.plan.read_text())
    config = json.loads(args.config.read_text())
    if config.get('vars', {}).get('MIGRATION_MODE') != 'closed':
        raise SystemExit('Keep the target closed until verification is complete')
    database = next(row for row in config['d1_databases'] if row['binding'] == 'DATABASE')
    bucket = next(row['bucket_name'] for row in config['r2_buckets'] if row['binding'] == 'FILES')
    output = args.output.resolve()
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    with (output / 'export.log').open('x') as log:
        result = subprocess.run(['bun', 'x', '--no-install', 'wrangler', 'd1', 'export', database['database_name'], '--remote',
            '--config', str(args.config.resolve()), '--output', str(output / 'target.sql'), '--skip-confirmation'],
            cwd=Path(__file__).resolve().parent.parent, stdout=log, stderr=subprocess.STDOUT)
    if result.returncode:
        raise SystemExit('Read-only target export failed; inspect the private log')
    target = sqlite3.connect(output / 'target.sqlite')
    target.executescript('BEGIN;\n' + (output / 'target.sql').read_text() + '\nCOMMIT;')
    source = sqlite3.connect(f'file:{Path(plan["rehearsal"]) / "shared.sqlite"}?mode=ro', uri=True)
    counts = {}
    for table in ['user', 'account', 'sync_streams', 'sync_records', 'file_storage', 'session', 'verification', 'client_devices']:
        columns = ','.join('"' + row[1] + '"' for row in source.execute(f'PRAGMA table_info("{table}")'))
        # Same explicit sequences and insertion order are part of the prepared import.
        query = f'SELECT {columns} FROM "{table}" ORDER BY rowid'
        expected, actual = source.execute(query).fetchall(), target.execute(query).fetchall()
        if expected != actual:
            raise SystemExit('Target table differs: ' + table)
        counts[table] = len(expected)
    if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or target.execute('PRAGMA foreign_key_check').fetchall():
        raise SystemExit('Target integrity failed')
    candidates = [Path.home() / suffix for suffix in ['.wrangler/config/default.toml',
        'Library/Preferences/.wrangler/config/default.toml', '.config/.wrangler/config/default.toml']]
    credential = next((file for file in candidates if file.exists()), None)
    if not credential:
        raise SystemExit('Wrangler authorization unavailable')
    auth = tomllib.loads(credential.read_text())
    token = auth.get('oauth_token') or auth.get('api_token')
    if not token:
        raise SystemExit('Wrangler token unavailable')

    def get(path):
        for attempt in range(10):
            try:
                return urllib.request.urlopen(urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                    headers={'Authorization': 'Bearer ' + token}), timeout=120)
            except urllib.error.HTTPError as error:
                if error.code not in [429, 500, 502, 503, 504] or attempt == 9:
                    raise
                delay = min(60, max(5, int(error.headers.get('Retry-After', '30'))))
                print(f'Cloudflare verification retry after HTTP {error.code}; waiting {delay}s', flush=True)
                error.close()
                time.sleep(delay)

    with get('/accounts') as response:
        accounts = json.load(response)['result']
    if len(accounts) != 1:
        raise SystemExit('Explicit account selection required')
    account = accounts[0]['id']

    def verify(row):
        key = urllib.parse.quote(row['targetKey'], safe='')
        with get(f'/accounts/{account}/r2/buckets/{bucket}/objects/{key}') as response:
            digest, size = hashlib.sha256(), 0
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        if size != row['size'] or digest.hexdigest() != row['sha256']:
            raise ValueError('Target object checksum differs')

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for index, _ in enumerate(pool.map(verify, plan['files']), 1):
            if index % 50 == 0:
                print(f'Verified {index}/{len(plan["files"])} objects', flush=True)
    report = {'counts': counts, 'filesVerified': len(plan['files']), 'allRowsCompared': True, 'allObjectHashesCompared': True}
    (output / 'verification.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
    target.close()
    source.close()


if __name__ == '__main__':
    main()
