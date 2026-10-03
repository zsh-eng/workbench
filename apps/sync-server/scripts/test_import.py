"""Compile and replay actual migration batches against a fresh schema."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
from unittest import TestCase, main
from unittest.mock import patch
import test_rehearse_migration as fixture

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-import.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ImportTest(TestCase):
    def test_runner_refuses_a_source_production_resource_before_commands(self):
        spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run-import.py'))
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'plan.json').write_text('{}')
            (root / 'config.json').write_text(json.dumps({
                'd1_databases': [{'binding': 'DATABASE', 'database_name': 'reader-db', 'database_id': 'source'}],
                'r2_buckets': [{'binding': 'FILES', 'bucket_name': 'new-bucket'}],
                'vars': {'MIGRATION_MODE': 'closed'},
            }))
            with patch('sys.argv', ['run-import', '--plan', str(root / 'plan.json'), '--config', str(root / 'config.json'),
                '--database', 'reader-db', '--bucket', 'new-bucket', '--remote-new-target']), \
                patch.object(runner.subprocess, 'run') as command:
                with self.assertRaisesRegex(SystemExit, 'source production resource'):
                    runner.main()
                command.assert_not_called()

    def test_replays_complete_batches_without_duplicate_rows_or_schema_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fixture.MigrationTest().fixture(root / 'backup')
            fixture.migration.convert(root / 'backup', root / 'rehearsal', fixture.ORIGIN)
            prepare.prepare(root / 'rehearsal', root / 'plan')
            plan = json.loads((root / 'plan/import-plan.json').read_text())
            target = sqlite3.connect(':memory:')
            for file in sorted((Path(__file__).resolve().parent.parent / 'migrations').glob('*.sql')):
                target.executescript(file.read_text())
            for repeat in range(2):
                for step in plan['steps']:
                    if step['kind'] == 'sql':
                        sql = (root / 'plan' / step['file']).read_text()
                        self.assertNotIn('DROP ', sql)
                        self.assertNotIn('BEGIN;', sql)
                        target.executescript(sql)
            with sqlite3.connect(root / 'rehearsal/shared.sqlite') as source:
                for table in prepare.TABLES:
                    query = f'SELECT * FROM "{table}" ORDER BY rowid'
                    self.assertEqual(target.execute(query).fetchall(), source.execute(query).fetchall())
            self.assertEqual(target.execute('PRAGMA foreign_key_check').fetchall(), [])
            self.assertEqual(len(plan['files']), 2)


if __name__ == '__main__':
    main()
