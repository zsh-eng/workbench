import Foundation
import SQLite3

/// SyncStore's durable rows, outbox, private values and state for one profile.
/// Only the owning actor uses it. One transaction writes only the changed rows,
/// outbox entries and private values, with the clock and receive cursor.
/// Record fields are columns, so opening a profile decodes each value once.
/// An outbox entry holds the version to upload and the value its edit started
/// from; its payload is the record. HTML, images and credentials never live here.
final class SQLiteJournal {
  struct Failure: Error, Equatable { let code: Int32 }
  private enum Value {
    case text(String)
    case integer(Int64)
    case null
  }
  private struct Outgoing: Equatable {
    let version: SyncClock
    let base: String?
  }
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
      let version = try query("PRAGMA user_version") { $0.integer(0) }.first ?? 0
      guard (0...2).contains(version) else { throw SyncFailure.invalidRecord }
      // Committed user data must survive power loss; do not relax synchronous.
      try exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
      try exec(
        """
        CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS records (
          key TEXT PRIMARY KEY, value TEXT NOT NULL, deleted INTEGER NOT NULL,
          schema INTEGER NOT NULL, wall INTEGER NOT NULL, counter INTEGER NOT NULL,
          device TEXT NOT NULL, seq INTEGER NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS outbox (
          key TEXT PRIMARY KEY, wall INTEGER NOT NULL, counter INTEGER NOT NULL, base TEXT)
          WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS local_values (key TEXT PRIMARY KEY, value TEXT NOT NULL)
          WITHOUT ROWID;
        """)
      // Version 1 outboxes have no starting values. Their edits merge as new values.
      if version == 1 { try exec("ALTER TABLE outbox ADD COLUMN base TEXT") }
      try exec("PRAGMA user_version=2")
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
    guard let header = try query("SELECT value FROM state WHERE id=1", { $0.text(0) }).first
    else { return nil }
    var state = try JSONDecoder().decode(SyncStore.State.self, from: Data(header.utf8))
    let records = try query(
      "SELECT key,value,deleted,schema,wall,counter,device,seq FROM records"
    ) { row in
      SyncRecord(
        change: SyncChange(
          key: row.text(0), value: row.text(1), isDeleted: row.integer(2) != 0,
          schemaVersion: Int(row.integer(3)),
          hlc: SyncClock(wallTimeMs: row.integer(4), counter: row.integer(5))),
        deviceId: row.text(6), serverSeq: row.integer(7))
    }
    state.rows.reserveCapacity(records.count)
    for record in records { state.rows[record.key] = record }
    // Every pending change is this device's current version of its row.
    let outbox = try query("SELECT key,wall,counter,base FROM outbox") { row in
      (
        row.text(0), SyncClock(wallTimeMs: row.integer(1), counter: row.integer(2)),
        row.optionalText(3)
      )
    }
    for (key, version, base) in outbox {
      guard let record = state.rows[key], record.hlc == version, record.deviceId == state.deviceID
      else { throw SyncFailure.invalidRecord }
      state.pending[key] = record.change
      state.bases[key] = base
    }
    state.localValues = Dictionary(
      uniqueKeysWithValues: try query("SELECT key,value FROM local_values") {
        ($0.text(0), $0.text(1))
      })
    return state
  }

  /// One immediate transaction. A failure rolls back and leaves the previous state.
  /// Rows and outbox entries can differ from `previous` only at `keys`.
  func persist(_ next: SyncStore.State, previous: SyncStore.State?, keys: [String]) throws {
    try exec("BEGIN IMMEDIATE")
    do {
      let changed = previous == nil ? Array(next.rows.keys) : keys
      try write("records", changed, { previous?.rows[$0] }, { next.rows[$0] }) {
        [
          .text($0.value), .integer($0.isDeleted ? 1 : 0), .integer(Int64($0.schemaVersion)),
          .integer($0.hlc.wallTimeMs), .integer($0.hlc.counter), .text($0.deviceId),
          .integer($0.serverSeq),
        ]
      }
      func outgoing(_ state: SyncStore.State?, _ key: String) -> Outgoing? {
        guard let change = state?.pending[key] else { return nil }
        return Outgoing(version: change.hlc, base: state?.bases[key])
      }
      try write("outbox", changed, { outgoing(previous, $0) }, { outgoing(next, $0) }) {
        [.integer($0.version.wallTimeMs), .integer($0.version.counter), $0.base.map(Value.text) ?? .null]
      }
      let old = previous?.localValues ?? [:]
      let new = next.localValues ?? [:]
      if old != new {
        try write("local_values", Set(old.keys).union(new.keys), { old[$0] }, { new[$0] }) {
          [.text($0)]
        }
      }
      var header = next
      header.rows = [:]
      header.pending = [:]
      header.bases = [:]
      header.localValues = nil
      let statement = try prepare("INSERT OR REPLACE INTO state(id,value) VALUES(1,?)")
      defer { sqlite3_finalize(statement) }
      try run(statement, [.text(String(decoding: try JSONEncoder().encode(header), as: UTF8.self))])
      try exec("COMMIT")
    } catch {
      try? exec("ROLLBACK")
      throw error
    }
  }

  /// Each table is a key and its value columns, in declaration order.
  private func write<T: Equatable>(
    _ table: String, _ keys: some Sequence<String>, _ old: (String) -> T?, _ new: (String) -> T?,
    columns: (T) -> [Value]
  ) throws {
    var upsert: OpaquePointer?
    defer { sqlite3_finalize(upsert) }
    let delete = try prepare("DELETE FROM \(table) WHERE key=?")
    defer { sqlite3_finalize(delete) }
    for key in keys where old(key) != new(key) {
      guard let value = new(key) else {
        try run(delete, [.text(key)])
        continue
      }
      let values = [Value.text(key)] + columns(value)
      if upsert == nil {
        let marks = Array(repeating: "?", count: values.count).joined(separator: ",")
        upsert = try prepare("INSERT OR REPLACE INTO \(table) VALUES(\(marks))")
      }
      try run(upsert!, values)
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

  private func run(_ statement: OpaquePointer, _ values: [Value]) throws {
    defer {
      sqlite3_reset(statement)
      sqlite3_clear_bindings(statement)
    }
    for (index, value) in values.enumerated() {
      let position = Int32(index + 1)
      let code: Int32
      switch value {
      case .integer(let number): code = sqlite3_bind_int64(statement, position, number)
      case .null: code = sqlite3_bind_null(statement, position)
      case .text(let text):
        code = text.withCString {
          sqlite3_bind_text(statement, position, $0, Int32(text.utf8.count), transient)
        }
      }
      guard code == SQLITE_OK else { throw Failure(code: code) }
    }
    let code = sqlite3_step(statement)
    guard code == SQLITE_DONE else { throw Failure(code: code) }
  }

  private struct Row {
    let statement: OpaquePointer
    func text(_ index: Int32) -> String {
      guard let bytes = sqlite3_column_text(statement, index) else { return "" }
      let count = Int(sqlite3_column_bytes(statement, index))
      return String(decoding: UnsafeBufferPointer(start: bytes, count: count), as: UTF8.self)
    }
    func integer(_ index: Int32) -> Int64 { sqlite3_column_int64(statement, index) }
    func optionalText(_ index: Int32) -> String? {
      sqlite3_column_type(statement, index) == SQLITE_NULL ? nil : text(index)
    }
  }

  private func query<T>(_ sql: String, _ read: (Row) throws -> T) throws -> [T] {
    let statement = try prepare(sql)
    defer { sqlite3_finalize(statement) }
    var rows: [T] = []
    while true {
      let code = sqlite3_step(statement)
      if code == SQLITE_DONE { return rows }
      guard code == SQLITE_ROW else { throw Failure(code: code) }
      rows.append(try read(Row(statement: statement)))
    }
  }
}
