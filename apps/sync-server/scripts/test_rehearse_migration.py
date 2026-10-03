"""End-to-end local migration checks with two small source databases and file backups."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).with_name('rehearse-migration.py'))
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
ORIGIN = 'https://sync.example.test'
FILE = 'xxh64:0123456789abcdef'


class MigrationTest(unittest.TestCase):
    def fixture(self, base, same_subject=True):
        for app in ['reader', 'spaced2']:
            folder = base / app
            folder.mkdir(parents=True)
            db = sqlite3.connect(folder / 'source.sqlite')
            auth = Path(__file__).resolve().parent.parent / 'migrations/0001_auth.sql'
            db.executescript(auth.read_text())
            db.executescript('''CREATE TABLE sync_records(server_seq INTEGER PRIMARY KEY, user_id TEXT, key TEXT, value TEXT, schema_version INTEGER, hlc_wall_time_ms INTEGER, hlc_counter INTEGER, device_id TEXT, is_deleted INTEGER);
            CREATE TABLE file_storage(user_id TEXT,id TEXT,r2_key TEXT,file_size INTEGER,media_type TEXT,created_at INTEGER,deleted_at INTEGER);''')
            uid = app + '-user'
            db.execute('INSERT INTO user VALUES (?,?,?,?,?,?,?)', (uid, 'Example', 'same@example.test', 1, None, 100, 200))
            db.execute('INSERT INTO account (id,account_id,provider_id,user_id,access_token,refresh_token,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', (app+'-account', 'same-provider-subject' if same_subject else app, 'google', uid, 'must-not-copy', 'must-not-copy', 100, 200))
            db.execute('INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)', (app, 999999, 'old-session', 100, 200, uid))
            value = json.dumps({'type': 'cardContent', 'payload': {'front': '![image](/api/files/'+FILE+')', 'back': 'Preserve this'}, 'timestamp': 321}) if app == 'spaced2' else json.dumps({'id': 'book', 'sourceFileId': FILE, 'cover': None})
            key = json.dumps(['operations','card']) if app=='spaced2' else json.dumps(['books','book'])
            db.execute('INSERT INTO sync_records VALUES (?,?,?,?,?,?,?,?,?)', (37,uid,key,value,1,1234,7,'original-device',0))
            db.execute('INSERT INTO sync_records VALUES (?,?,?,?,?,?,?,?,?)', (91,uid,json.dumps(['notes','deleted']),'{"id":"deleted"}',1,1240,8,'other-device',1))
            data=b'fixture bytes'
            db.execute('INSERT INTO file_storage VALUES (?,?,?,?,?,?,?)', (uid,FILE,app+'/old-key',len(data),'application/octet-stream',111,None))
            db.commit()
            sql='\n'.join(db.iterdump());db.close()
            (folder/'source.sql').write_text(sql)
            (folder/'manifest.json').write_text(json.dumps({'sqlSHA256':hashlib.sha256(sql.encode()).hexdigest(),'sqliteSHA256':hashlib.sha256((folder/'source.sqlite').read_bytes()).hexdigest()}))
            (folder/'object').write_bytes(data)
            (folder/'r2-manifest.json').write_text(json.dumps({'completed':True,'bucket':app,'objects':[{'key':app+'/old-key','file':'object','size':len(data),'sha256':hashlib.sha256(data).hexdigest()}]}))

    def test_restores_both_sources_with_versions_files_and_fresh_auth(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)/'backups';self.fixture(base)
            output=Path(tmp)/'result'
            report=migration.convert(base,output,ORIGIN)
            self.assertEqual((report['targetUsers'],report['mergedUsers']),(1,1))
            self.assertEqual(report['missingFileReferences'],0)
            restored=sqlite3.connect(':memory:')
            restored.executescript((output/'seed.sql').read_text())
            self.assertEqual(restored.execute('select count(*) from sync_records').fetchone()[0],4)
            self.assertEqual(restored.execute('select count(*) from session').fetchone()[0],0)
            self.assertEqual(restored.execute('select access_token,refresh_token from account').fetchone(),(None,None))
            self.assertEqual(restored.execute('select count(distinct user_id) from sync_records').fetchone()[0],1)
            row=restored.execute("select value,hlc_wall_time_ms,hlc_counter,device_id from sync_records where namespace='spaced' and is_deleted=0").fetchone()
            self.assertIn(ORIGIN+'/api/apps/spaced/files/'+FILE,row[0])
            self.assertEqual(row[1:],(1234,7,'original-device'))
            self.assertEqual(restored.execute('select sum(is_deleted) from sync_records').fetchone()[0],2)
            copies=json.loads((output/'file-copy-manifest.json').read_text())
            self.assertEqual(len({r['targetKey'] for r in copies}),2)
            self.assertTrue(all(r['size']==len(b'fixture bytes') for r in copies))
            self.assertEqual(restored.execute('pragma integrity_check').fetchone()[0],'ok')
            self.assertEqual(restored.execute('pragma foreign_key_check').fetchall(),[])
            with self.assertRaisesRegex(ValueError,'already exists'):
                migration.convert(base,output,ORIGIN)

    def test_refuses_email_only_merge(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)/'backups';self.fixture(base,same_subject=False)
            with self.assertRaisesRegex(ValueError,'Email collision'):
                migration.convert(base,Path(tmp)/'result',ORIGIN)

    def test_refuses_missing_referenced_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)/'backups';self.fixture(base)
            folder=base/'reader'
            with sqlite3.connect(folder/'source.sqlite') as db:
                db.execute('DELETE FROM file_storage')
            manifest=json.loads((folder/'manifest.json').read_text())
            manifest['sqliteSHA256']=hashlib.sha256((folder/'source.sqlite').read_bytes()).hexdigest()
            (folder/'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'Referenced file missing'):
                migration.convert(base,Path(tmp)/'result',ORIGIN)

    def test_refuses_corrupted_object(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)/'backups';self.fixture(base)
            (base/'reader/object').write_bytes(b'wrong contents')
            with self.assertRaisesRegex(ValueError,'checksum'):
                migration.convert(base,Path(tmp)/'result',ORIGIN)


if __name__=='__main__':
    unittest.main()
