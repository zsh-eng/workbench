#!/usr/bin/env python3
"""Read verified private backups and build a new local shared database. No network writes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import urllib.parse
import uuid

APPS = {'reader': 'reader', 'spaced2': 'spaced'}
FILE_URL = re.compile(r'/api/files/(xxh64:[a-f0-9]{16})')
RECORD_FIELDS = ['key', 'value', 'schema_version', 'hlc_wall_time_ms', 'hlc_counter', 'device_id', 'is_deleted']


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def insert(db, table, row):
    fields = list(row)
    db.execute(f'INSERT INTO "{table}" ({",".join(fields)}) VALUES ({",".join("?" for _ in fields)})', [row[k] for k in fields])


def convert(backup, output, origin):
    url = urllib.parse.urlparse(origin)
    if url.scheme != 'https' or not url.netloc or url.path not in ['', '/'] or url.query or url.fragment or url.username or url.password:
        raise ValueError('Use a proposed HTTPS API origin, without a path')
    origin = origin.rstrip('/')
    if output.exists():
        raise ValueError('Output already exists; use a new rehearsal directory')
    sources = {}
    manifests = {}
    for app in APPS:
        folder = backup / app
        manifest = json.loads((folder / 'manifest.json').read_text())
        if digest(folder / 'source.sql') != manifest['sqlSHA256'] or digest(folder / 'source.sqlite') != manifest['sqliteSHA256']:
            raise ValueError('SQL backup checksum mismatch')
        db = sqlite3.connect(f'file:{folder / "source.sqlite"}?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Source database integrity failed')
        sources[app] = db
        manifests[app] = json.loads((folder / 'r2-manifest.json').read_text())
        if not manifests[app]['completed']:
            raise ValueError('R2 backup incomplete')
        for obj in manifests[app]['objects']:
            file = folder / obj['file']
            if file.stat().st_size != obj['size'] or digest(file) != obj['sha256']:
                raise ValueError('Object backup checksum mismatch')

    # Only identical provider subjects can join accounts; never match on email alone.
    users = {(app, row['id']): dict(row) for app, db in sources.items() for row in db.execute('SELECT * FROM user ORDER BY id')}
    parents = {key: key for key in users}
    def root(key):
        while parents[key] != key:
            key = parents[key]
        return key
    accounts = []
    subjects = {}
    for app, db in sources.items():
        for row in db.execute('SELECT * FROM account ORDER BY id'):
            row = dict(row)
            accounts.append((app, row))
            if row['provider_id'] == 'credential':
                continue
            subject = (row['provider_id'], row['account_id'])
            key = (app, row['user_id'])
            if subject in subjects:
                parents[root(key)] = root(subjects[subject])
            else:
                subjects[subject] = key
    groups = {}
    for key in users:
        groups.setdefault(root(key), []).append(key)
    mapping = {}
    target_users = []
    emails = set()
    ids = set()
    for group in groups.values():
        owner = min(group, key=lambda k: (k[0] != 'reader', k))
        user = users[owner].copy()
        if user['id'] in ids:
            user['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, repr(owner)))
        if user['email'].casefold() in emails:
            raise ValueError('Email collision without verified provider match requires an explicit mapping')
        emails.add(user['email'].casefold()); ids.add(user['id'])
        user['created_at'] = min(users[k]['created_at'] for k in group)
        user['updated_at'] = max(users[k]['updated_at'] for k in group)
        target_users.append(user)
        for key in group:
            mapping[key] = user['id']

    output.mkdir(parents=True, mode=0o700)
    db = sqlite3.connect(output / 'shared.sqlite')
    db.row_factory = sqlite3.Row
    migrations = Path(__file__).resolve().parent.parent / 'migrations'
    for file in sorted(migrations.glob('*.sql')):
        db.executescript(file.read_text())
    db.execute('PRAGMA foreign_keys=ON')
    report = {'origin': origin, 'productionReady': False, 'sourceUsers': len(users), 'targetUsers': len(target_users), 'mergedUsers': len(users)-len(target_users), 'namespaces': {}, 'sessionsCopied': 0, 'oauthTokensCopied': 0, 'legacyPasswords': 0, 'providers': {}, 'missingFileReferences': 0}
    files = []
    seq = 0
    record_hash = hashlib.sha256()
    with db:
        for row in target_users:
            insert(db, 'user', row)
        saved_accounts = {}
        for app, row in accounts:
            row = row.copy(); row['user_id'] = mapping[(app, row['user_id'])]
            key = (row['user_id'], row['provider_id'], row['account_id'] if row['provider_id'] != 'credential' else '')
            if key in saved_accounts:
                if row['provider_id'] == 'credential' and saved_accounts[key]['password'] != row['password']:
                    raise ValueError('Conflicting passwords require an explicit auth policy')
                continue
            row['id'] = str(uuid.uuid5(uuid.NAMESPACE_URL, app + '/account/' + row['id']))
            if row['provider_id'] == 'credential':
                row['account_id'] = row['user_id']
            for field in ['access_token', 'refresh_token', 'id_token', 'access_token_expires_at', 'refresh_token_expires_at']:
                row[field] = None
            insert(db, 'account', row); saved_accounts[key] = row
            report['providers'][row['provider_id']] = report['providers'].get(row['provider_id'], 0) + 1
            report['legacyPasswords'] += int((row['password'] or '').startswith('legacy-pbkdf2:'))
        for app, namespace in APPS.items():
            source = sources[app]
            objects = {obj['key']: obj for obj in manifests[app]['objects']}
            catalog = {}
            counts = {'records': 0, 'tombstones': 0, 'fileCatalogRows': 0, 'fileBytes': 0, 'rewrittenRecords': 0, 'rewrittenURLs': 0, 'referencedFiles': 0}
            for row in source.execute('SELECT * FROM file_storage ORDER BY user_id,id'):
                row = dict(row); old_user = row['user_id']; old_key = row['r2_key']
                target_key = 'users/' + urllib.parse.quote(mapping[(app,old_user)], safe='') + '/apps/' + namespace + '/' + row['id']
                obj = objects.get(old_key)
                if row['deleted_at'] is None and (not obj or obj['size'] != row['file_size']):
                    raise ValueError('Active catalog object missing or length differs')
                catalog[(old_user,row['id'])] = row
                row['user_id'] = mapping[(app,old_user)]; row['namespace'] = namespace; row['r2_key'] = target_key
                insert(db,'file_storage',row)
                counts['fileCatalogRows'] += 1
                if obj:
                    files.append({'namespace':namespace,'userId':row['user_id'],'fileId':row['id'],'sourceBucket':manifests[app]['bucket'],'sourceKey':old_key,'targetKey':target_key,'backupFile':str(backup/app/obj['file']),'size':obj['size'],'sha256':obj['sha256'],'mediaType':row['media_type'],'deletedAt':row['deleted_at']})
                    counts['fileBytes'] += obj['size']
            references = set()
            owners = set()
            for original in source.execute('SELECT * FROM sync_records ORDER BY server_seq'):
                row = dict(original); old_user = row['user_id']; owners.add(old_user)
                value = row['value']; parsed = json.loads(value); key = json.loads(row['key'])
                if namespace == 'reader' and key[0] == 'books' and not row['is_deleted']:
                    file_id = parsed.get('sourceFileId') or ('xxh64:'+parsed['fileHash'] if parsed.get('fileHash') else None)
                    if file_id:references.add((old_user,file_id))
                    cover = parsed.get('cover')
                    if isinstance(cover,dict) and cover.get('fileId'):references.add((old_user,cover['fileId']))
                    elif parsed.get('coverContentHash'):references.add((old_user,'xxh64:'+parsed['coverContentHash']))
                if namespace == 'spaced' and key[0] == 'operations' and parsed.get('type') == 'cardContent':
                    found = FILE_URL.findall(value)
                    if not row['is_deleted']:references.update((old_user,file_id) for file_id in found)
                    value,n = FILE_URL.subn(lambda m: origin + '/api/apps/spaced/files/' + m[1],value)
                    counts['rewrittenURLs'] += n; counts['rewrittenRecords'] += int(n>0)
                row['value'] = value;row['user_id'] = mapping[(app,old_user)];row['namespace'] = namespace
                seq += 1;row['server_seq'] = seq
                insert(db,'sync_records',row)
                record_hash.update(json.dumps([row['user_id'],namespace]+[row[k] for k in RECORD_FIELDS],ensure_ascii=False,separators=(',',':')).encode()+b'\n')
                counts['records'] += 1;counts['tombstones'] += row['is_deleted']
            missing = [key for key in references if key not in catalog or catalog[key]['deleted_at'] is not None]
            if missing:
                raise ValueError('Referenced file missing from active catalog')
            report['missingFileReferences'] += len(missing)
            counts['referencedFiles'] = len(references)
            # Fresh streams, deterministic for this exact snapshot. Never re-use old cursors.
            snapshot = digest(backup/app/'source.sql')
            for old_user in sorted(owners | {key[0] for key in catalog}):
                uid = mapping[(app,old_user)]
                insert(db,'sync_streams',{'user_id':uid,'namespace':namespace,'epoch':str(uuid.uuid5(uuid.NAMESPACE_URL,snapshot+'/'+namespace+'/'+uid))})
            report['namespaces'][namespace] = counts
    if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall():
        raise ValueError('Target integrity check failed')
    actual = hashlib.sha256()
    for row in db.execute('SELECT * FROM sync_records ORDER BY server_seq'):
        actual.update(json.dumps([row['user_id'],row['namespace']]+[row[k] for k in RECORD_FIELDS],ensure_ascii=False,separators=(',',':')).encode()+b'\n')
    if actual.digest()!=record_hash.digest():raise ValueError('Target record hash mismatch')
    # Independent comparison: reverse the documented URL edit and compare all preserved fields.
    for app,namespace in APPS.items():
        for row in sources[app].execute('SELECT * FROM sync_records'):
            saved=db.execute('SELECT * FROM sync_records WHERE user_id=? AND namespace=? AND key=?',(mapping[(app,row['user_id'])],namespace,row['key'])).fetchone()
            for field in RECORD_FIELDS:
                value=saved[field]
                if field=='value' and namespace=='spaced':value=value.replace(origin+'/api/apps/spaced/files/','/api/files/')
                if value!=row[field]:raise ValueError('Source/target record field differs: '+field)
    with (output/'seed.sql').open('x') as file:
        for line in db.iterdump():file.write(line+'\n')
    db.close()
    report['recordFingerprint']=actual.hexdigest();report['sqliteBytes']=(output/'shared.sqlite').stat().st_size
    report['verification']={'integrity':'ok','foreignKeys':'ok','allRecordFieldsCompared':True,'allBackupObjectsHashed':True}
    report['blockers']=['Final freeze and fresh export','Production API origin and OAuth callback','Old-client write retirement and explicit local migration','Legacy credential policy and unsupported provider policy']
    (output/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    (output/'file-copy-manifest.json').write_text(json.dumps(files,indent=2)+'\n')
    (output/'account-map.json').write_text(json.dumps([{'source':k[0],'sourceUserId':k[1],'targetUserId':v} for k,v in mapping.items()],indent=2)+'\n')
    for file in output.iterdir():os.chmod(file,0o600)
    for source in sources.values():source.close()
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup-dir',type=Path,required=True)
    parser.add_argument('--output-dir',type=Path,required=True)
    parser.add_argument('--origin',required=True)
    args=parser.parse_args()
    print(json.dumps(convert(args.backup_dir.resolve(),args.output_dir.resolve(),args.origin),indent=2))
