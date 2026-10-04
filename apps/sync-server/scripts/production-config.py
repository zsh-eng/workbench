#!/usr/bin/env python3
"""Write a closed production Worker config for new, separately created resources."""
import argparse
import json
from pathlib import Path
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--database-id', required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
identifier = str(uuid.UUID(args.database_id))
if identifier in {'b830fea5-d461-4be0-8916-2e01d77c141f', '3ec0ff8a-230f-4c3a-8d93-4d4c9e58007b', '810925d0-4966-4da9-840b-16e6347e245e'} or identifier.startswith('00000000-'):
    raise SystemExit('Use a new production D1 database ID')
app = Path(__file__).resolve().parent.parent
config = {
    'name': 'workbench-sync', 'main': str(app / 'src/index.ts'),
    'compatibility_date': '2026-04-01', 'compatibility_flags': ['nodejs_compat'],
    'workers_dev': False, 'routes': [{'pattern': 'api.zsheng.app', 'custom_domain': True}],
    'd1_databases': [{'binding': 'DATABASE', 'database_name': 'workbench-sync',
                      'database_id': identifier, 'migrations_dir': str(app / 'migrations')}],
    'r2_buckets': [{'binding': 'FILES', 'bucket_name': 'workbench-sync'}],
    'vars': {'BASE_URL': 'https://api.zsheng.app',
             'APP_ORIGINS': 'https://reader.zsheng.app,https://spaced2.zsheng.app',
             'MIGRATION_MODE': 'closed'},
}
with args.output.open('x') as file:
    file.write(json.dumps(config, indent=2) + '\n')
print('Wrote closed config. Set production auth secrets separately; no resource was created or deployed.')
