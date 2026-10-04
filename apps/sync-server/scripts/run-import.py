#!/usr/bin/env python3
"""Load an import plan into a dedicated local or explicitly selected remote target."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

SOURCE_NAMES = {'reader-db', 'spaced2-v2', 'arctic-db', 'epub-reader-books', 'spaced2-files-v2'}
SOURCE_IDS = {'b830fea5-d461-4be0-8916-2e01d77c141f', '3ec0ff8a-230f-4c3a-8d93-4d4c9e58007b', '810925d0-4966-4da9-840b-16e6347e245e'}


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True, help='Strict JSON Wrangler config')
    parser.add_argument('--database', required=True)
    parser.add_argument('--bucket', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--persist-to', type=Path)
    mode.add_argument('--remote-new-target', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    app = Path(__file__).resolve().parent.parent
    plan_path, config_path = args.plan.resolve(), args.config.resolve()
    plan = json.loads(plan_path.read_text())
    config = json.loads(config_path.read_text())
    database = next((row for row in config['d1_databases'] if row['binding'] == 'DATABASE'), None)
    bucket = next((row for row in config['r2_buckets'] if row['binding'] == 'FILES'), None)
    if not database or not bucket or database['database_name'] != args.database or bucket['bucket_name'] != args.bucket:
        raise SystemExit('Target arguments must match config bindings')
    if args.database in SOURCE_NAMES or args.bucket in SOURCE_NAMES or database['database_id'] in SOURCE_IDS:
        raise SystemExit('Refusing a source production resource')
    if args.remote_new_target and (config.get('vars', {}).get('LOCAL_DEVELOPMENT') == 'true' or config.get('vars', {}).get('MIGRATION_MODE') != 'closed'):
        raise SystemExit('Remote import requires a closed production target config')
    if checksum(Path(plan['rehearsal']) / 'shared.sqlite') != plan['sourceSHA256']:
        raise SystemExit('Rehearsal changed')
    for step in plan['steps']:
        if checksum(plan_path.parent / step['file']) != step['sha256']:
            raise SystemExit('Import chunk changed')
    for row in plan['files']:
        if checksum(Path(row['backupFile'])) != row['sha256']:
            raise SystemExit('Object changed')
    target = {'database': database, 'bucket': bucket, 'remote': args.remote_new_target,
              'persistTo': str(args.persist_to.resolve()) if args.persist_to else None,
              'planSHA256': checksum(plan_path)}
    receipt_path = plan_path.parent / 'import-progress.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {'target': target, 'completed': []}
    if receipt['target'] != target:
        raise SystemExit('Receipt belongs to another target or plan')
    flags = ['--remote'] if args.remote_new_target else ['--local', '--persist-to', str(args.persist_to.resolve())]
    prefix = ['bun', 'x', '--no-install', 'wrangler']

    def run(name, command):
        with (plan_path.parent / (name + '.log')).open('w') as log:
            result = subprocess.run(prefix + command + ['--config', str(config_path)] + flags,
                                    cwd=app, stdout=log, stderr=subprocess.STDOUT,
                                    env={**os.environ, 'CI': 'true'})
        if result.returncode:
            raise SystemExit('Import failed; inspect private ' + name + '.log and resume the same plan')

    # This runner must only be used before target writes are enabled. It never deletes or updates rows.
    run('migrations', ['d1', 'migrations', 'apply', args.database])
    if not receipt_path.exists():
        run('empty-check', ['d1', 'execute', args.database, '--command',
            'SELECT (SELECT count(*) FROM user)+(SELECT count(*) FROM sync_records)+(SELECT count(*) FROM file_storage) AS n', '--json'])
        check = json.loads((plan_path.parent / 'empty-check.log').read_text())
        if check[0]['results'][0]['n'] != 0:
            raise SystemExit('New import requires an empty target; no data was replaced')
        receipt_path.write_text(json.dumps(receipt, indent=2))
    for index, step in enumerate(plan['steps']):
        if step['file'] in receipt['completed']:
            continue
        path = str(plan_path.parent / step['file'])
        command = ['d1', 'execute', args.database, '--file', path] if step['kind'] == 'sql' else [
            'r2', 'bulk', 'put', args.bucket, '--filename', path, '--concurrency', '4', '--force']
        run(f'step-{index:04d}', command)
        receipt['completed'].append(step['file'])
        temporary = receipt_path.with_suffix('.partial')
        temporary.write_text(json.dumps(receipt, indent=2))
        temporary.replace(receipt_path)
        print(f'Imported {index + 1}/{len(plan["steps"])}', flush=True)
    print('Upload complete. Target verification is required before enabling the service.')


if __name__ == '__main__':
    main()
