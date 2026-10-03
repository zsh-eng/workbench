#!/usr/bin/env python3
"""Back up all R2 objects read-only after D1 export, using Wrangler authorization."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import tomllib
import urllib.parse
import urllib.request


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def inventory_signature(items):
    return sorted((item.get('key') or item.get('name'), int(item['size']), item.get('etag'))
                  for item in items)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    base = args.backup_dir.resolve()
    for app in ['reader', 'spaced2']:
        if not (base / app / 'manifest.json').exists():
            raise SystemExit('Export and verify both D1 databases first')
    candidates = [Path.home() / suffix for suffix in [
        '.wrangler/config/default.toml',
        'Library/Preferences/.wrangler/config/default.toml',
        '.config/.wrangler/config/default.toml',
    ]]
    config = next((path for path in candidates if path.exists()), None)
    if not config:
        raise SystemExit('Wrangler credential file not found in standard locations')
    auth = tomllib.loads(config.read_text())
    token = auth.get('oauth_token') or auth.get('api_token')
    if not token:
        raise SystemExit('No usable Wrangler credential')

    def get(path):
        request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
                                         headers={'Authorization': 'Bearer ' + token})
        return urllib.request.urlopen(request, timeout=120)

    with get('/accounts') as response:
        accounts = json.load(response)['result']
    if len(accounts) != 1:
        raise SystemExit('Explicit Cloudflare account selection required')
    account = accounts[0]['id']

    def list_objects(bucket):
        items, cursor = [], None
        while True:
            query = urllib.parse.urlencode({'per_page': 1000, **({'cursor': cursor} if cursor else {})})
            with get(f'/accounts/{account}/r2/buckets/{bucket}/objects?{query}') as response:
                result = json.load(response)
            items.extend(result['result'])
            cursor = result.get('result_info', {}).get('cursor')
            if not cursor:
                return items

    for app, bucket in [('reader', 'epub-reader-books'), ('spaced2', 'spaced2-files-v2')]:
        folder = base / app
        object_dir = folder / 'objects'
        object_dir.mkdir(mode=0o700, exist_ok=True)
        inventory_path = folder / 'r2-inventory.json'
        manifest_path = folder / 'r2-manifest.json'
        progress_path = folder / 'r2-progress.json'
        items = list_objects(bucket)
        if inventory_path.exists():
            if inventory_signature(items) != inventory_signature(json.loads(inventory_path.read_text())):
                raise SystemExit('R2 changed since this backup started; use a new complete snapshot')
        else:
            inventory_path.write_text(json.dumps(items, indent=2))
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text())
            if not manifest['completed'] or inventory_signature(manifest['objects']) != inventory_signature(items):
                raise SystemExit('Completed manifest does not match R2 inventory')
            for row in manifest['objects']:
                file = folder / row['file']
                if file.stat().st_size != row['size'] or checksum(file) != row['sha256']:
                    raise SystemExit('Completed backup checksum mismatch')
            print(app, 'completed backup verified', manifest['count'], 'objects', flush=True)
            continue
        prior = json.loads(progress_path.read_text()) if progress_path.exists() else []
        completed = {row['key']: row for row in prior}
        print(app, 'objects', len(items), flush=True)

        def download(item):
            key = item.get('key') or item.get('name')
            name = hashlib.sha256(key.encode()).hexdigest()
            destination = object_dir / name
            previous = completed.get(key)
            if (previous and previous['etag'] == item.get('etag') and destination.exists()
                    and destination.stat().st_size == int(item['size'])
                    and checksum(destination) == previous['sha256']):
                return previous
            partial = destination.with_suffix('.partial')
            path = f'/accounts/{account}/r2/buckets/{bucket}/objects/' + urllib.parse.quote(key, safe='')
            with get(path) as response, partial.open('wb') as out:
                digest, size = hashlib.sha256(), 0
                while data := response.read(1024 * 1024):
                    out.write(data)
                    digest.update(data)
                    size += len(data)
            if size != int(item['size']):
                raise RuntimeError('Object length mismatch')
            os.replace(partial, destination)
            destination.chmod(0o400)
            return {'key': key, 'file': 'objects/' + name, 'size': size,
                    'sha256': digest.hexdigest(), 'etag': item.get('etag')}

        records = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for row in pool.map(download, items):
                records.append(row)
                progress_path.write_text(json.dumps(records))
                if len(records) % 50 == 0:
                    print(app, 'downloaded', len(records), flush=True)
        if inventory_signature(items) != inventory_signature(list_objects(bucket)):
            raise SystemExit('R2 changed during download; use a new complete snapshot')
        manifest = {'bucket': bucket, 'objects': records, 'count': len(records),
                    'bytes': sum(row['size'] for row in records), 'completed': True}
        manifest_path.write_text(json.dumps(manifest, indent=2))
        (folder / 'r2-stability.json').write_text(json.dumps({'unchangedDuringBackup': True}))
        print(app, 'complete', manifest['count'], manifest['bytes'], 'bytes', flush=True)


if __name__ == '__main__':
    main()
