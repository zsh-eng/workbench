CREATE TABLE sync_streams (
 user_id TEXT NOT NULL REFERENCES user(id), namespace TEXT NOT NULL,
 epoch TEXT NOT NULL, PRIMARY KEY(user_id,namespace)
);
CREATE TABLE sync_records (
 server_seq INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL REFERENCES user(id), namespace TEXT NOT NULL,
 key TEXT NOT NULL, value TEXT NOT NULL, schema_version INTEGER NOT NULL,
 hlc_wall_time_ms INTEGER NOT NULL, hlc_counter INTEGER NOT NULL,
 device_id TEXT NOT NULL, is_deleted INTEGER NOT NULL
);
CREATE UNIQUE INDEX sync_records_scope_key_unique ON sync_records(user_id,namespace,key);
CREATE INDEX sync_records_scope_seq_idx ON sync_records(user_id,namespace,server_seq);
CREATE TABLE file_storage (
 user_id TEXT NOT NULL REFERENCES user(id), namespace TEXT NOT NULL, id TEXT NOT NULL,
 r2_key TEXT NOT NULL, file_size INTEGER NOT NULL, media_type TEXT NOT NULL,
 created_at INTEGER NOT NULL, deleted_at INTEGER,
 PRIMARY KEY(user_id,namespace,id)
);
CREATE TABLE client_devices (
 user_id TEXT NOT NULL REFERENCES user(id), namespace TEXT NOT NULL, client_id TEXT NOT NULL,
 user_agent TEXT, created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,namespace,client_id)
);
