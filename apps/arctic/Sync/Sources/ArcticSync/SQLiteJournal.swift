import Foundation
import SQLite3

/// SyncStore's durable rows, outbox, private values and state for one profile.
/// Only the owning actor uses it. One transaction writes only the changed rows,
/// outbox entries and private values, with the clock and receive cursor.
/// An outbox entry holds only the version to upload; its payload is the record.
/// HTML, images and credentials never live here.
final class SQLiteJournal {
  struct Failure: Error, Equatable { let code: Int32 }
  private var db: OpaquePointer?
  private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

  /// `busyTimeout` bounds the wait for another connection's write lock.
  init(file: URL, busyTimeout: Int32 = 5_000) throws {
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX
    let code = sqlite3_open_v2(file.path, &db, flags, nil)
    guard code == SQLITE_OK else {
      sqlite3_close_v2(db)
      db = nil
      throw Failure(code: code)
    }
    do {
      sqlite3_busy_timeout(db, busyTimeout)
      let version = try query("PRAGMA user_version").first?.first
      guard version == "0" || version == "1" else { throw SyncFailure.invalidRecord }
      // Committed user data must survive power loss; do not relax synchronous.
      try exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
      try exec(
        """
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS outbox (key TEXT PRIMARY KEY, version TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS local_values (key TEXT PRIMARY KEY, value TEXT NOT NULL)
          WITHOUT ROWID;
        PRAGMA user_version=1;
        """)
    } catch {
      sqlite3_close_v2(db)
      db = nil
      throw error
    }
  }
  deinit { sqlite3_close_v2(db) }

  /// Nil until the first transaction commits its state row. A copy interrupted
  /// before that commit left nothing behind, so it can simply run again.
  func load() throws -> SyncStore.State? {
    guard let encoded = try query("SELECT value FROM state WHERE id=1").first?.first else {
      return nil
    }
    let decoder = JSONDecoder()
    var state = try decoder.decode(SyncStore.State.self, from: Data(encoded.utf8))
    for row in try query("SELECT key,value FROM records") {
      let value = try decoder.decode(SyncRecord.self, from: Data(row[1].utf8))
      guard value.key == row[0] else { throw SyncFailure.invalidRecord }
      state.rows[row[0]] = value
    }
    // Every pending change is this device's current version of its row.
    for row in try query("SELECT key,version FROM outbox") {
      let version = try decoder.decode(SyncClock.self, from: Data(row[1].utf8))
      guard let record = state.rows[row[0]], record.hlc == version,
        record.deviceId == state.deviceID
      else { throw SyncFailure.invalidRecord }
      state.pending[row[0]] = record.change
    }
    state.localValues = Dictionary(
      uniqueKeysWithValues: try query("SELECT key,value FROM local_values").map { ($0[0], $0[1]) })
    return state
  }

  /// One immediate transaction. A failure rolls back and leaves the previous state.
  /// Rows and outbox entries can differ from `previous` only at `keys`.
  func persist(_ next: SyncStore.State, previous: SyncStore.State?, keys: [String]) throws {
    try exec("BEGIN IMMEDIATE")
    do {
      let changed = previous == nil ? Array(next.rows.keys) : keys
      try update("records", changed, previous?.rows ?? [:], next.rows, encode: json)
      try update(
        "outbox", changed, previous?.pending ?? [:], next.pending, encode: { try json($0.hlc) })
      let old = previous?.localValues ?? [:]
      let new = next.localValues ?? [:]
      if old != new {
        try update("local_values", Set(old.keys).union(new.keys), old, new, encode: { $0 })
      }
      var header = next
      header.rows = [:]
      header.pending = [:]
      header.localValues = nil
      try execute(
        "INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        [try json(header)])
      try exec("COMMIT")
    } catch {
      try? exec("ROLLBACK")
      throw error
    }
  }

  private func json<T: Encodable>(_ value: T) throws -> String {
    String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
  }

  private func update<T: Equatable>(
    _ table: String, _ keys: some Sequence<String>, _ old: [String: T], _ new: [String: T],
    encode: (T) throws -> String
  ) throws {
    // Each table is a key and one value column.
    let upsert = try prepare("INSERT OR REPLACE INTO \(table) VALUES(?,?)")
    defer { sqlite3_finalize(upsert) }
    let delete = try prepare("DELETE FROM \(table) WHERE key=?")
    defer { sqlite3_finalize(delete) }
    for key in keys where old[key] != new[key] {
      if let value = new[key] {
        try run(upsert, [key, try encode(value)])
      } else {
        try run(delete, [key])
      }
    }
  }

  private func exec(_ sql: String) throws {
    let code = sqlite3_exec(db, sql, nil, nil, nil)
    guard code == SQLITE_OK else { throw Failure(code: code) }
  }

  private func prepare(_ sql: String) throws -> OpaquePointer {
    var statement: OpaquePointer?
    let code = sqlite3_prepare_v2(db, sql, -1, &statement, nil)
    guard code == SQLITE_OK, let statement else { throw Failure(code: code) }
    return statement
  }

  private func run(_ statement: OpaquePointer, _ values: [String]) throws {
    defer {
      sqlite3_reset(statement)
      sqlite3_clear_bindings(statement)
    }
    for (index, value) in values.enumerated() {
      let code = value.withCString {
        sqlite3_bind_text(statement, Int32(index + 1), $0, Int32(value.utf8.count), transient)
      }
      guard code == SQLITE_OK else { throw Failure(code: code) }
    }
    let code = sqlite3_step(statement)
    guard code == SQLITE_DONE else { throw Failure(code: code) }
  }

  private func execute(_ sql: String, _ values: [String]) throws {
    let statement = try prepare(sql)
    defer { sqlite3_finalize(statement) }
    try run(statement, values)
  }

  private func query(_ sql: String) throws -> [[String]] {
    let statement = try prepare(sql)
    defer { sqlite3_finalize(statement) }
    var rows: [[String]] = []
    while true {
      let code = sqlite3_step(statement)
      if code == SQLITE_DONE { return rows }
      guard code == SQLITE_ROW else { throw Failure(code: code) }
      rows.append(
        (0..<sqlite3_column_count(statement)).map { index in
          guard let bytes = sqlite3_column_text(statement, index) else { return "" }
          let count = Int(sqlite3_column_bytes(statement, index))
          return String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self)
        })
    }
  }
}
