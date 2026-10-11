import Foundation

public struct LocalMutation: Sendable {
  public let key: String
  public let value: String
  public let isDeleted: Bool
  public let schemaVersion: Int
  public init(key: String, value: String, isDeleted: Bool = false, schemaVersion: Int = 1) {
    self.key = key
    self.value = value
    self.isDeleted = isDeleted
    self.schemaVersion = schemaVersion
  }
}

/// Local-only state shares the domain transaction but never enters the wire log.
public struct JournalSnapshot: Sendable {
  public let rows: [String: SyncRecord]
  public let localValues: [String: String]
  public init(rows: [String: SyncRecord], localValues: [String: String]) {
    self.rows = rows
    self.localValues = localValues
  }
}

public struct JournalMutation: Sendable {
  public let mutations: [LocalMutation]
  public let localValues: [String: String]
  public init(mutations: [LocalMutation], localValues: [String: String]) {
    self.mutations = mutations
    self.localValues = localValues
  }
}

/// One actor owns each account's durable rows, versions, outbox and cursor, so
/// storage work runs off the main actor and never during a network await.
/// Domain updates and their upload intent commit together: as one SQLite
/// transaction of the changed rows, or as one atomic replacement of the small
/// trial's JSON file. Keep one store instance per profile and separate accounts.
public actor SyncStore {
  /// Merges another device's value with a change this device has not uploaded,
  /// against the value that change started from (nil for a new key). Nil keeps
  /// the newer record.
  public typealias Resolve =
    @Sendable (_ key: String, _ base: String?, _ local: String, _ remote: String) -> String?

  struct State: Codable {
    var accountID: String
    var deviceID: String
    var clock = SyncClock(wallTimeMs: 0)
    var cursor: Int64 = 0
    var rows: [String: SyncRecord] = [:]
    var pending: [String: SyncChange] = [:]
    /// The committed value that each pending change started from.
    var bases: [String: String] = [:]
    var localValues: [String: String]?
  }
  private let file: URL
  private let database: SQLiteJournal?
  private var state: State
  private var syncing = false
  private var hasPersisted: Bool
  /// Keys whose value a pull or upload winner replaced, kept until the owner takes them.
  private var merged = Set<String>()
  private let validateValue: @Sendable (SyncChange) throws -> Void
  private let resolve: Resolve?

  private init(
    file: URL, database: SQLiteJournal?, state: State, persisted: Bool,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void, resolve: Resolve? = nil
  ) {
    self.file = file
    self.database = database
    self.state = state
    hasPersisted = persisted
    self.validateValue = validateValue
    self.resolve = resolve
  }

  public init(
    file: URL, accountID: String, deviceID: String = UUID().uuidString,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in }
  ) throws {
    let persisted = FileManager.default.fileExists(atPath: file.path)
    var state = State(accountID: accountID, deviceID: deviceID)
    if persisted {
      state = try JSONDecoder().decode(State.self, from: Data(contentsOf: file))
      guard state.accountID == accountID else { throw SyncFailure.wrongAccount }
    }
    self.init(
      file: file, database: nil, state: state, persisted: persisted, validateValue: validateValue)
  }
  /// A v3 journal cannot reopen under another origin, user, app, or epoch.
  public init(
    file: URL, scope: SyncScope, deviceID: String = UUID().uuidString,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in }
  ) throws {
    try self.init(
      file: file, accountID: scope.header, deviceID: deviceID, validateValue: validateValue)
  }
  /// A live profile's SQLite journal. Opening another account's file fails.
  public init(
    database file: URL, scope: SyncScope, deviceID: String = UUID().uuidString,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in }
  ) throws {
    try self.init(
      database: file, accountID: scope.header, deviceID: deviceID, validateValue: validateValue)
  }

  /// `busyTimeout` is in milliseconds: how long a write waits for another
  /// connection's lock before it fails and leaves the store unchanged.
  public init(
    database file: URL, accountID: String, deviceID: String = UUID().uuidString,
    busyTimeout: Int32 = 5_000,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in }
  ) throws {
    let (database, state) = try Self.load(
      file, accountID: accountID, deviceID: deviceID, busyTimeout: busyTimeout,
      validateValue: validateValue, initial: nil)
    self.init(
      file: file, database: database,
      state: state ?? State(accountID: accountID, deviceID: deviceID),
      persisted: state != nil, validateValue: validateValue)
  }

  /// Opens a profile without an actor hop, so the caller can show its rows at
  /// once. `initial` runs only when nothing has committed yet. Its mutation and
  /// private values become the first transaction, which marks the copy complete.
  public static func open(
    database file: URL, accountID: String, deviceID: String = UUID().uuidString,
    busyTimeout: Int32 = 5_000,
    validateValue: @escaping @Sendable (SyncChange) throws -> Void = { _ in },
    resolve: Resolve? = nil,
    initial: ((JournalSnapshot) throws -> JournalMutation)? = nil
  ) throws -> (store: SyncStore, snapshot: JournalSnapshot) {
    let (database, loaded) = try load(
      file, accountID: accountID, deviceID: deviceID, busyTimeout: busyTimeout,
      validateValue: validateValue, initial: initial)
    let state = loaded ?? State(accountID: accountID, deviceID: deviceID)
    let store = SyncStore(
      file: file, database: database, state: state, persisted: loaded != nil,
      validateValue: validateValue, resolve: resolve)
    return (store, JournalSnapshot(rows: state.rows, localValues: state.localValues ?? [:]))
  }

  private static func load(
    _ file: URL, accountID: String, deviceID: String, busyTimeout: Int32,
    validateValue: @Sendable (SyncChange) throws -> Void,
    initial: ((JournalSnapshot) throws -> JournalMutation)?
  ) throws -> sending (SQLiteJournal, State?) {
    let database = try SQLiteJournal(file: file, busyTimeout: busyTimeout)
    if let stored = try database.load() {
      guard stored.accountID == accountID else { throw SyncFailure.wrongAccount }
      return (database, stored)
    }
    guard let initial else { return (database, nil) }
    let update = try initial(JournalSnapshot(rows: [:], localValues: [:]))
    var next = try applying(
      update.mutations, to: State(accountID: accountID, deviceID: deviceID), now: Date(),
      validateValue: validateValue)
    next.localValues = update.localValues
    try database.persist(next, previous: nil, keys: [])
    return (database, next)
  }

  /// False until the first transaction commits. An import that stopped before
  /// then left no rows, so the caller can safely run it again.
  public var hasCommitted: Bool { hasPersisted }

  /// Read the small, disposable trial journal's identity without a network call.
  /// SQLite profiles keep this identity in their state table.
  public static func persistedScope(file: URL) throws -> SyncScope? {
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    let stored = try JSONDecoder().decode(State.self, from: Data(contentsOf: file))
    return try JSONDecoder().decode(SyncScope.self, from: Data(stored.accountID.utf8))
  }
  public func snapshot() -> [String: SyncRecord] { state.rows }
  public func snapshotState() -> JournalSnapshot {
    JournalSnapshot(rows: state.rows, localValues: state.localValues ?? [:])
  }

  public func transaction(
    _ transform: @Sendable (JournalSnapshot) throws -> JournalMutation,
    now: Date = Date()
  ) throws -> JournalSnapshot {
    let update = try transform(snapshotState())
    var next = try Self.applying(
      update.mutations, to: state, now: now, validateValue: validateValue)
    next.localValues = update.localValues
    try persist(next, keys: update.mutations.map(\.key))
    return snapshotState()
  }
  public var pendingCount: Int { state.pending.count }
  public var cursor: Int64 { state.cursor }

  /// Import batches produce one file write. A failed write publishes no in-memory change.
  public func commit(_ mutations: [LocalMutation], now: Date = Date()) throws {
    try persist(
      Self.applying(mutations, to: state, now: now, validateValue: validateValue),
      keys: mutations.map(\.key))
  }

  private static func applying(
    _ mutations: [LocalMutation], to state: State, now: Date,
    validateValue: (SyncChange) throws -> Void
  ) throws -> State {
    var next = state
    for mutation in mutations {
      let old = next.rows[mutation.key]
      if old?.value == mutation.value && old?.isDeleted == mutation.isDeleted
        && old?.schemaVersion == mutation.schemaVersion
      {
        continue
      }
      next.clock = tick(next.clock, now: now)
      let change = SyncChange(
        key: mutation.key, value: mutation.value, isDeleted: mutation.isDeleted,
        schemaVersion: mutation.schemaVersion, hlc: next.clock)
      try validate(change)
      try validateValue(change)
      if next.pending[change.key] == nil {
        next.bases[change.key] = old?.isDeleted == false ? old?.value : nil
      }
      next.rows[change.key] = SyncRecord(change: change, deviceId: next.deviceID, serverSeq: 0)
      next.pending[change.key] = change
    }
    return next
  }

  private static func tick(_ clock: SyncClock, now: Date) -> SyncClock {
    let millis = Int64(now.timeIntervalSince1970 * 1000)
    return millis > clock.wallTimeMs
      ? SyncClock(wallTimeMs: millis)
      : SyncClock(wallTimeMs: clock.wallTimeMs, counter: clock.counter + 1)
  }

  /// Domain read-modify-write runs without actor suspension. Concurrent local
  /// edits and pulled rows cannot slip between the read and its durable outbox.
  public func update(
    _ transform: @Sendable ([String: SyncRecord]) throws -> [LocalMutation],
    now: Date = Date()
  ) throws -> [String: SyncRecord] {
    try commit(transform(state.rows), now: now)
    return state.rows
  }

  /// Pull first, then send a fixed outbox snapshot. New edits during network awaits
  /// remain pending. The caller schedules another pass for those later edits.
  public func sync(using remote: any SyncRemote) async throws {
    guard !syncing else { throw SyncFailure.alreadySyncing }
    syncing = true
    defer { syncing = false }
    try await remote.validateStore(accountID: state.accountID)
    var head: Int64?
    while true {
      try Task.checkCancellation()
      let requestedCursor = state.cursor
      let page = try await remote.pull(
        deviceID: state.deviceID, cursor: requestedCursor, head: head)
      try Task.checkCancellation()
      guard page.records.count <= 500, page.cursor >= requestedCursor, page.head >= page.cursor,
        head == nil || page.head == head,
        page.hasMore
          ? (page.cursor > requestedCursor && page.records.last?.serverSeq == page.cursor)
          : page.cursor == page.head
      else { throw SyncFailure.invalidResponse }
      var previous = requestedCursor
      for record in page.records {
        try validate(record.change)
        try validateValue(record.change)
        guard record.serverSeq > previous, record.serverSeq <= page.head, !record.deviceId.isEmpty
        else { throw SyncFailure.invalidResponse }
        previous = record.serverSeq
      }
      var next = state
      var replaced: [String] = []
      for record in page.records where merge(record, into: &next) { replaced.append(record.key) }
      next.cursor = page.cursor
      try persist(next, keys: page.records.map(\.key))
      merged.formUnion(replaced)
      if !page.hasMore { break }
      head = page.head
    }
    // A merged conflict leaves a newer version to upload. Send it in this pass.
    for _ in 0..<3 {
      guard try await upload(to: remote) else { break }
    }
  }

  /// Sends a fixed outbox snapshot. True when a rejected change is still pending:
  /// a conflict merged it, or this device edited it again meanwhile.
  private func upload(to remote: any SyncRemote) async throws -> Bool {
    var again = false
    let pending = state.pending.values.sorted { $0.key < $1.key }
    for batch in try batches(pending) {
      try Task.checkCancellation()
      let response = try await remote.push(deviceID: state.deviceID, changes: batch)
      try Task.checkCancellation()
      guard response.results.count == batch.count else { throw SyncFailure.invalidResponse }
      var seen = Set<String>()
      let submitted = Dictionary(uniqueKeysWithValues: batch.map { ($0.key, $0) })
      for result in response.results {
        try validate(result.winner.change)
        try validateValue(result.winner.change)
        guard let sent = submitted[result.winner.key], seen.insert(result.winner.key).inserted,
          result.winner.serverSeq > 0, !result.winner.deviceId.isEmpty,
          !result.accepted
            || (result.winner.change == sent && result.winner.deviceId == state.deviceID),
          result.winner.hlc > sent.hlc
            || (result.winner.hlc == sent.hlc && result.winner.deviceId >= state.deviceID),
          result.winner.hlc != sent.hlc || result.winner.deviceId != state.deviceID
            || result.winner.change == sent
        else { throw SyncFailure.invalidResponse }
      }
      var next = state
      var replaced: [String] = []
      for result in response.results {
        let key = result.winner.key
        if result.accepted {
          if next.pending[key] == submitted[key] {
            next.pending.removeValue(forKey: key)
            next.bases.removeValue(forKey: key)
          } else if next.pending[key] != nil {
            // A later edit now starts from the value the server accepted.
            next.bases[key] = result.winner.isDeleted ? nil : result.winner.value
          }
        }
        if merge(result.winner, into: &next) { replaced.append(key) }
        if !result.accepted && next.pending[key] != nil { again = true }
      }
      try persist(next, keys: response.results.map(\.winner.key))
      merged.formUnion(replaced)
    }
    return again
  }

  /// Keys whose committed value changed in a pull or an upload since the last
  /// call. An acknowledged upload of this device's own value is not a change.
  public func takeMergedKeys() -> Set<String> {
    defer { merged.removeAll() }
    return merged
  }

  /// True when the record replaced a different value.
  private func merge(_ record: SyncRecord, into next: inout State) -> Bool {
    next.clock = max(next.clock, record.hlc)
    if let changed = resolved(record, into: &next) { return changed }
    let local = next.rows[record.key]
    if let local {
      if local.hlc > record.hlc || (local.hlc == record.hlc && local.deviceId > record.deviceId) {
        return false
      }
    }
    next.rows[record.key] = record
    if let pending = next.pending[record.key],
      pending.hlc < record.hlc || (pending.hlc == record.hlc && next.deviceID <= record.deviceId)
    {
      next.pending.removeValue(forKey: record.key)
      next.bases.removeValue(forKey: record.key)
    }
    return local?.value != record.value || local?.isDeleted != record.isDeleted
      || local?.schemaVersion != record.schemaVersion
  }

  /// Another device's value for a key that this device changed and has not
  /// uploaded. Whichever is newer, the owner's resolver merges both against the
  /// value this device's change started from. A merged value that the server
  /// would reject gets a newer version, so it uploads. Nil: no merge applies.
  private func resolved(_ record: SyncRecord, into next: inout State) -> Bool? {
    guard let resolve, let pending = next.pending[record.key], record.deviceId != next.deviceID,
      !pending.isDeleted, !record.isDeleted, pending.schemaVersion == record.schemaVersion,
      let value = resolve(record.key, next.bases[record.key], pending.value, record.value)
    else { return nil }
    let shown = next.rows[record.key]
    if value == record.value {
      next.rows[record.key] = record
      next.pending.removeValue(forKey: record.key)
      next.bases.removeValue(forKey: record.key)
      return shown?.value != value || shown?.isDeleted == true
    }
    let ahead =
      pending.hlc > record.hlc || (pending.hlc == record.hlc && next.deviceID > record.deviceId)
    if value == pending.value && ahead {
      next.bases[record.key] = record.value
      return false
    }
    let clock = Self.tick(next.clock, now: Date())
    let change = SyncChange(
      key: record.key, value: value, isDeleted: false, schemaVersion: pending.schemaVersion,
      hlc: clock)
    guard (try? validate(change)) != nil, (try? validateValue(change)) != nil else { return nil }
    next.clock = clock
    next.rows[record.key] = SyncRecord(change: change, deviceId: next.deviceID, serverSeq: 0)
    next.pending[record.key] = change
    next.bases[record.key] = record.value
    return shown?.value != value || shown?.isDeleted == true
  }
  /// `keys` names every row and outbox entry that `next` can change, so a
  /// one-article edit costs the same in a large library as in a small one.
  private func persist(_ next: State, keys: [String]) throws {
    // A repeated value or an empty pull should not rewrite the journal.
    // The first empty commit still creates the durable migration marker.
    if hasPersisted, next.clock == state.clock, next.cursor == state.cursor,
      next.localValues == state.localValues,
      keys.allSatisfy({
        next.rows[$0] == state.rows[$0] && next.pending[$0] == state.pending[$0]
          && next.bases[$0] == state.bases[$0]
      })
    {
      return
    }
    if let database {
      try database.persist(next, previous: hasPersisted ? state : nil, keys: keys)
      state = next
      hasPersisted = true
      return
    }
    let data = try JSONEncoder().encode(next)
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: file, options: .atomic)
    state = next
    hasPersisted = true
  }
  private func batches(_ pending: [SyncChange]) throws -> [[SyncChange]] {
    var result: [[SyncChange]] = []
    var batch: [SyncChange] = []
    var size = 14  // {"changes":[]} plus one-byte safety margin
    for change in pending {
      let bytes = try JSONEncoder().encode(change).count + 1
      if batch.count == 500 || size + bytes > 1_048_576 {
        result.append(batch)
        batch = []
        size = 14
      }
      batch.append(change)
      size += bytes
    }
    if !batch.isEmpty { result.append(batch) }
    return result
  }
}

extension SyncStore.State {
  /// Journals written before `bases` existed decode without starting values.
  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    accountID = try container.decode(String.self, forKey: .accountID)
    deviceID = try container.decode(String.self, forKey: .deviceID)
    clock = try container.decode(SyncClock.self, forKey: .clock)
    cursor = try container.decode(Int64.self, forKey: .cursor)
    rows = try container.decode([String: SyncRecord].self, forKey: .rows)
    pending = try container.decode([String: SyncChange].self, forKey: .pending)
    bases = try container.decodeIfPresent([String: String].self, forKey: .bases) ?? [:]
    localValues = try container.decodeIfPresent([String: String].self, forKey: .localValues)
  }
}
