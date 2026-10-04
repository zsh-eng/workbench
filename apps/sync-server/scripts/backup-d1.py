#!/usr/bin/env python3
"""Export both production D1 databases read-only into a new private directory."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    base = args.backup_dir.resolve()
    base.mkdir(parents=True, mode=0o700, exist_ok=False)
    root = Path(__file__).resolve().parents[3]
    for app, database in [('reader', 'reader-db'), ('spaced2', 'spaced2-v2')]:
        folder = base / app
        folder.mkdir(mode=0o700)
        started = datetime.now(timezone.utc).isoformat()
        # Wrangler can print signed download URLs. Keep its complete log private.
        with (folder / 'export.log').open('x') as log:
            result = subprocess.run(
                ['bun', 'x', '--no-install', 'wrangler', 'd1', 'export', database,
                 '--remote', '--output', str(folder / 'source.sql'), '--skip-confirmation'],
                cwd=root / 'apps' / app, stdout=log, stderr=subprocess.STDOUT,
            )
        if result.returncode:
            raise SystemExit('D1 export failed; inspect the private export.log')
        db = sqlite3.connect(folder / 'source.sqlite')
        sql = (folder / 'source.sql').read_text()
        # D1 export is SQL statements without an enclosing transaction.
        db.executescript('BEGIN;\n' + sql + '\nCOMMIT;')
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('D1 backup integrity check failed')
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise SystemExit('D1 backup foreign key check failed')
        tables = [row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )]
        counts = {table: db.execute('SELECT count(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
                  for table in tables}
        db.close()
        manifest = {
            'database': database, 'startedAt': started,
            'completedAt': datetime.now(timezone.utc).isoformat(),
            'sqlBytes': (folder / 'source.sql').stat().st_size,
            'sqliteBytes': (folder / 'source.sqlite').stat().st_size,
            'sqlSHA256': checksum(folder / 'source.sql'),
            'sqliteSHA256': checksum(folder / 'source.sqlite'),
            'tableCounts': counts, 'integrity': 'ok', 'foreignKeys': 'ok',
        }
        (folder / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        for name in ['source.sql', 'source.sqlite', 'manifest.json']:
            (folder / name).chmod(0o400)
        print(json.dumps({'app': app, 'sqlBytes': manifest['sqlBytes'], 'tables': counts}))


if __name__ == '__main__':
    main()
