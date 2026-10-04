import Foundation

/// Server-issued identity of one record stream. A reset must never adopt an old
/// cursor or outbox silently, even when the user ID is unchanged.
public struct SyncScope: Codable, Equatable, Sendable {
  public let origin: String
  public let userId: String
  public let namespace: String
  public let epoch: String
  public init(origin: String, userId: String, namespace: String = "arctic", epoch: String) {
    self.origin = origin
    self.userId = userId
    self.namespace = namespace
    self.epoch = epoch
  }
  public var header: String {
    get throws {
      // The shared service compares its canonical header byte for byte.
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.withoutEscapingSlashes]
      func quoted(_ value: String) throws -> String {
        String(decoding: try encoder.encode(value), as: UTF8.self)
      }
      return try
        "{\"origin\":\(quoted(origin)),\"userId\":\(quoted(userId)),\"namespace\":\(quoted(namespace)),\"epoch\":\(quoted(epoch))}"
    }
  }
}

public struct SyncClock: Codable, Equatable, Sendable, Comparable {
  public var wallTimeMs: Int64
  public var counter: Int64
  public init(wallTimeMs: Int64, counter: Int64 = 0) {
    self.wallTimeMs = wallTimeMs
    self.counter = counter
  }
  public static func < (lhs: Self, rhs: Self) -> Bool {
    lhs.wallTimeMs == rhs.wallTimeMs ? lhs.counter < rhs.counter : lhs.wallTimeMs < rhs.wallTimeMs
  }
}
public struct SyncChange: Codable, Equatable, Sendable {
  public var key: String
  public var value: String
  public var isDeleted: Bool
  public var schemaVersion: Int
  public var hlc: SyncClock
}
public struct SyncRecord: Codable, Equatable, Sendable {
  public var key: String
  public var value: String
  public var isDeleted: Bool
  public var schemaVersion: Int
  public var hlc: SyncClock
  public var deviceId: String
  public var serverSeq: Int64
  public var change: SyncChange {
    .init(key: key, value: value, isDeleted: isDeleted, schemaVersion: schemaVersion, hlc: hlc)
  }
  public init(change: SyncChange, deviceId: String, serverSeq: Int64) {
    key = change.key
    value = change.value
    isDeleted = change.isDeleted
    schemaVersion = change.schemaVersion
    hlc = change.hlc
    self.deviceId = deviceId
    self.serverSeq = serverSeq
  }
}
public struct SyncPull: Codable, Sendable {
  public var records: [SyncRecord]
  public var cursor: Int64
  public var head: Int64
  public var hasMore: Bool
  public init(records: [SyncRecord], cursor: Int64, head: Int64, hasMore: Bool) {
    self.records = records
    self.cursor = cursor
    self.head = head
    self.hasMore = hasMore
  }
}
public struct SyncPush: Codable, Sendable {
  public struct Result: Codable, Sendable {
    public var accepted: Bool
    public var winner: SyncRecord
    public init(accepted: Bool, winner: SyncRecord) {
      self.accepted = accepted
      self.winner = winner
    }
  }
  public var results: [Result]
  public init(results: [Result]) { self.results = results }
}
public protocol SyncRemote: Sendable {
  func validateStore(accountID: String) async throws
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush
}
// Legacy/local test transports have no server scope. Network transports must
// check the persisted profile before either pulling or uploading.
extension SyncRemote {
  public func validateStore(accountID: String) async throws {}
}
public enum SyncFailure: Error, Equatable {
  case invalidRecord, invalidResponse, wrongAccount, alreadySyncing, invalidServer, unauthorized
  case httpStatus(Int)
  case scopeChanged, scopeRequired, mediaSyncDisabled
}
func validate(_ change: SyncChange) throws {
  guard !change.key.isEmpty, change.key.utf8.count <= 1024, change.value.utf8.count <= 65536,
    change.schemaVersion > 0, change.hlc.wallTimeMs >= 0, change.hlc.counter >= 0,
    change.hlc.wallTimeMs <= 9_007_199_254_740_991, change.hlc.counter <= 9_007_199_254_740_991
  else { throw SyncFailure.invalidRecord }
}
