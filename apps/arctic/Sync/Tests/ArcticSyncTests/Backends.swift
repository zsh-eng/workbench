import Foundation
import SQLite3
import Testing

@testable import ArcticSync

/// Store tests run against the trial's JSON file and the live profile's SQLite.
enum Backend: CaseIterable, CustomTestStringConvertible {
  case json, sqlite
  var testDescription: String { self == .json ? "JSON" : "SQLite" }

  func location() -> URL {
    FileManager.default.temporaryDirectory.appending(
      path: "arctic-sync-\(UUID()).\(self == .json ? "json" : "sqlite")")
  }

  func open(
    _ url: URL, accountID: String, deviceID: String = UUID().uuidString,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in }
  ) throws -> SyncStore {
    switch self {
    case .json:
      try SyncStore(
        file: url, accountID: accountID, deviceID: deviceID, validateValue: validateValue)
    case .sqlite:
      try SyncStore(
        database: url, accountID: accountID, deviceID: deviceID, busyTimeout: 50,
        validateValue: validateValue)
    }
  }

  func remove(_ url: URL) {
    for suffix in ["", "-wal", "-shm"] {
      try? FileManager.default.removeItem(at: URL(filePath: url.path + suffix))
    }
  }

  /// The file a write changes: SQLite's WAL holds committed transactions.
  func written(_ url: URL) -> URL { self == .json ? url : URL(filePath: url.path + "-wal") }

  /// A store whose writes fail. JSON cannot create its file. For SQLite, another
  /// connection holds the write lock, as the share extension or a second process could.
  func failingStore() throws -> (SyncStore, release: () -> Void) {
    if self == .json {
      return (try open(URL(filePath: "/dev/null/arctic.json"), accountID: "alice"), {})
    }
    let url = location()
    let store = try open(url, accountID: "alice")
    var other: OpaquePointer?
    #expect(sqlite3_open(url.path, &other) == SQLITE_OK)
    #expect(sqlite3_exec(other, "BEGIN IMMEDIATE", nil, nil, nil) == SQLITE_OK)
    return (
      store,
      {
        sqlite3_exec(other, "ROLLBACK", nil, nil, nil)
        sqlite3_close_v2(other)
        remove(url)
      }
    )
  }
}
