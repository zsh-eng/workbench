#!/usr/bin/env python3
"""Compile a verified rehearsal into bounded, repeatable D1 and R2 import batches."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3

TABLES = ['user', 'account', 'sync_streams', 'sync_records', 'file_storage']


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(rehearsal, output):
    os.umask(0o077)
    db = sqlite3.connect(f'file:{rehearsal / "shared.sqlite"}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Source integrity failed')
    report = json.loads((rehearsal / 'report.json').read_text())
    if report['missingFileReferences']:
        raise ValueError('Rehearsal has missing files')
    files = json.loads((rehearsal / 'file-copy-manifest.json').read_text())
    for file in files:
        path = Path(file['backupFile'])
        if path.stat().st_size != file['size'] or checksum(path) != file['sha256']:
            raise ValueError('File checksum mismatch')
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    steps = []
    # SQL has no transaction wrapper or sqlite_sequence writes. Apply migrations first.
    # OR IGNORE permits retry after an uncertain import. Full target comparison is mandatory.
    for table in TABLES:
        chunk, size, part = [], 0, 0
        def save():
            nonlocal chunk, size, part
            if not chunk:
                return
            path = output / f'{len(steps):04d}-{table}-{part}.sql'
            path.write_text('\n'.join(chunk) + '\n')
            steps.append({'kind': 'sql', 'file': path.name, 'sha256': checksum(path)})
            chunk, size, part = [], 0, part + 1
        for row in db.execute(f'SELECT * FROM "{table}" ORDER BY rowid'):
            values = ','.join(db.execute('SELECT quote(?)', (value,)).fetchone()[0] for value in row)
            line = f'INSERT OR IGNORE INTO "{table}" ({",".join(row.keys())}) VALUES({values});'
            length = len(line.encode())
            if length > 95000:
                raise ValueError('Row exceeds conservative D1 statement size')
            if size + length > 2_000_000 or len(chunk) >= 2000:
                save()
            chunk.append(line)
            size += length
        save()
    for offset in range(0, len(files), 50):
        path = output / f'{len(steps):04d}-files.json'
        rows = files[offset:offset + 50]
        path.write_text(json.dumps([{'key': row['targetKey'], 'file': row['backupFile']} for row in rows]))
        steps.append({'kind': 'files', 'file': path.name, 'sha256': checksum(path)})
    manifest = {'version': 1, 'rehearsal': str(rehearsal), 'sourceSHA256': checksum(rehearsal / 'shared.sqlite'),
                'recordFingerprint': report['recordFingerprint'], 'steps': steps,
                'files': files, 'counts': {table: db.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0] for table in TABLES}}
    (output / 'import-plan.json').write_text(json.dumps(manifest, indent=2))
    db.close()
    return {'steps': len(steps), 'counts': manifest['counts'], 'files': len(files)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearsal', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.rehearsal.resolve(), args.output.resolve())))
