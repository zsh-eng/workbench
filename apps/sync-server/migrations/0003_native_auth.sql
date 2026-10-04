-- Additive native sign-in handshakes. No changes to existing accounts/streams.
CREATE TABLE native_auth_flows (
 id_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, state TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX native_auth_flows_expiry ON native_auth_flows(expires_at);
CREATE TABLE native_auth_codes (
 code_hash TEXT PRIMARY KEY, challenge TEXT NOT NULL, payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX native_auth_codes_expiry ON native_auth_codes(expires_at);
