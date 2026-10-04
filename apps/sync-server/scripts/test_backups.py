"""Exercise backup files and resume behavior with external Cloudflare calls stubbed."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


d1 = load('backup-d1')
r2 = load('backup-r2')


class BackupTest(unittest.TestCase):
    def test_d1_export_import_checksums_and_existing_directory_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp) / 'backup'

            def export(command, **kwargs):
                destination = Path(command[command.index('--output') + 1])
                destination.write_text("CREATE TABLE example(id INTEGER PRIMARY KEY); INSERT INTO example VALUES(1);")
                return type('Result', (), {'returncode': 0})()

            with patch('sys.argv', ['backup-d1', '--backup-dir', str(base)]), \
                    patch.object(d1.subprocess, 'run', side_effect=export), \
                    contextlib.redirect_stdout(io.StringIO()):
                d1.main()
                for app in ['reader', 'spaced2']:
                    folder = base / app
                    manifest = json.loads((folder / 'manifest.json').read_text())
                    self.assertEqual(manifest['tableCounts'], {'example': 1})
                    self.assertEqual(manifest['sqlSHA256'], d1.checksum(folder / 'source.sql'))
                    self.assertEqual(manifest['sqliteSHA256'], d1.checksum(folder / 'source.sqlite'))
                    self.assertEqual((folder / 'source.sqlite').stat().st_mode & 0o777, 0o400)
                    with sqlite3.connect(folder / 'source.sqlite') as db:
                        self.assertEqual(db.execute('SELECT * FROM example').fetchall(), [(1,)])
                with self.assertRaises(FileExistsError):
                    d1.main()

    def test_r2_complete_backup_resume_and_inventory_change_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            base = home / 'backup'
            config = home / '.wrangler/config/default.toml'
            config.parent.mkdir(parents=True)
            config.write_text('oauth_token="test-token"')
            for app in ['reader', 'spaced2']:
                folder = base / app
                folder.mkdir(parents=True)
                (folder / 'manifest.json').write_text('{}')
            downloads = []
            etag = 'first'
            payload = b'file bytes'

            def response(request, **kwargs):
                url = request.full_url
                if url.endswith('/accounts'):
                    value = {'result': [{'id': 'test-account'}]}
                elif '/objects?' in url:
                    value = {'result': [{'key': 'files/example', 'size': len(payload), 'etag': etag}]}
                else:
                    downloads.append(url)
                    return io.BytesIO(payload)
                return io.BytesIO(json.dumps(value).encode())

            with patch('sys.argv', ['backup-r2', '--backup-dir', str(base)]), \
                    patch.object(r2.Path, 'home', return_value=home), \
                    patch.object(r2.urllib.request, 'urlopen', side_effect=response), \
                    contextlib.redirect_stdout(io.StringIO()):
                r2.main()
                self.assertEqual(len(downloads), 2)
                # A completed first app must not block resuming the second app.
                (base / 'spaced2/r2-manifest.json').unlink()
                r2.main()
                self.assertEqual(len(downloads), 2)
                for app in ['reader', 'spaced2']:
                    folder = base / app
                    manifest = json.loads((folder / 'r2-manifest.json').read_text())
                    self.assertTrue(manifest['completed'])
                    self.assertEqual(manifest['bytes'], len(payload))
                    row = manifest['objects'][0]
                    self.assertEqual((folder / row['file']).read_bytes(), payload)
                    self.assertEqual(row['sha256'], hashlib.sha256(payload).hexdigest())
                etag = 'changed'
                with self.assertRaisesRegex(SystemExit, 'R2 changed'):
                    r2.main()


if __name__ == '__main__':
    unittest.main()
