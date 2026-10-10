import Foundation
import Testing

@testable import ArcticSync

private func mutation(_ value: String, key: String = "article/one", deleted: Bool = false)
  -> LocalMutation
{
  .init(key: key, value: value, isDeleted: deleted)
}
private actor Remote: SyncRemote {
  var records: [String: SyncRecord] = [:]
  var sequence: Int64 = 0
  var beforePush: (@Sendable () async throws -> Void)?
  var failPush = false
  var badPage = false
  var badWinner = false
  func configure(
    hook: (@Sendable () async throws -> Void)? = nil, fail: Bool = false, badPage: Bool = false,
    badWinner: Bool = false
  ) {
    beforePush = hook
    failPush = fail
    self.badPage = badPage
    self.badWinner = badWinner
  }
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    if badPage { return .init(records: [], cursor: cursor + 1, head: cursor, hasMore: false) }
    let end = head ?? sequence
    let rows = records.values.filter { $0.serverSeq > cursor && $0.serverSeq <= end }.sorted {
      $0.serverSeq < $1.serverSeq
    }
    let page = Array(rows.prefix(2))
    let more = rows.count > page.count
    return .init(records: page, cursor: more ? page.last!.serverSeq : end, head: end, hasMore: more)
  }
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    try await beforePush?()
    if failPush { throw SyncFailure.httpStatus(503) }
    return .init(
      results: changes.map { change in
        if let old = records[change.key],
          old.hlc > change.hlc || (old.hlc == change.hlc && old.deviceId >= deviceID)
        {
          return .init(accepted: false, winner: old)
        }
        sequence += 1
        var winner = SyncRecord(change: change, deviceId: deviceID, serverSeq: sequence)
        if badWinner { winner.key = "unexpected" }
        records[change.key] = winner
        return .init(accepted: true, winner: winner)
      })
  }
}

@Test(arguments: Backend.allCases) func durableOfflineEditsAndAccountIsolation(_ backend: Backend)
  async throws
{
  let file = backend.location()
  defer { backend.remove(file) }
  let first = try backend.open(file, accountID: "alice", deviceID: "phone")
  try await first.commit([mutation("local")])
  let restored = try backend.open(file, accountID: "alice")
  #expect(await restored.pendingCount == 1)
  #expect(await restored.snapshot()["article/one"]?.value == "local")
  #expect(throws: SyncFailure.wrongAccount) { try backend.open(file, accountID: "bob") }
}
@Test(arguments: Backend.allCases) func twoDevicesConvergeAndKeepDeletion(_ backend: Backend)
  async throws
{
  let remote = Remote()
  let aFile = backend.location()
  let bFile = backend.location()
  defer {
    backend.remove(aFile)
    backend.remove(bFile)
  }
  let a = try backend.open(aFile, accountID: "alice", deviceID: "a")
  let b = try backend.open(bFile, accountID: "alice", deviceID: "b")
  try await a.commit(
    (0..<5).map { mutation("first", key: "article/\($0)") }, now: Date(timeIntervalSince1970: 100))
  try await a.sync(using: remote)
  try await b.sync(using: remote)
  #expect(await b.snapshot().count == 5)
  try await b.commit(
    [mutation("first", key: "article/0", deleted: true)], now: Date(timeIntervalSince1970: 101))
  try await b.sync(using: remote)
  try await a.sync(using: remote)
  #expect(await a.snapshot()["article/0"]?.isDeleted == true)
  #expect(await a.pendingCount == 0)
  // Pulls, acknowledgements and deletions reach the disk, not only memory.
  for (file, live) in [(aFile, a), (bFile, b)] {
    let reopened = try backend.open(file, accountID: "alice")
    #expect(await reopened.snapshot() == live.snapshot())
    #expect(await reopened.pendingCount == live.pendingCount)
    #expect(await reopened.cursor == live.cursor)
  }
}
@Test(arguments: Backend.allCases) func editDuringUploadStaysQueued(_ backend: Backend) async throws
{
  let file = backend.location()
  defer { backend.remove(file) }
  let store = try backend.open(file, accountID: "alice", deviceID: "a")
  let remote = Remote()
  try await store.commit([mutation("first")], now: Date(timeIntervalSince1970: 100))
  await remote.configure(hook: {
    try await store.commit(
      [mutation("edited while uploading")], now: Date(timeIntervalSince1970: 101))
  })
  try await store.sync(using: remote)
  #expect(await store.snapshot()["article/one"]?.value == "edited while uploading")
  #expect(await store.pendingCount == 1)
  await remote.configure()
  try await store.sync(using: remote)
  #expect(await store.pendingCount == 0)
  #expect(await remote.records["article/one"]?.value == "edited while uploading")
}
@Test(arguments: Backend.allCases) func failedUploadRetainsOutboxAcrossRestart(_ backend: Backend)
  async throws
{
  let file = backend.location()
  defer { backend.remove(file) }
  let store = try backend.open(file, accountID: "alice")
  let remote = Remote()
  try await store.commit([mutation("queued")])
  await remote.configure(fail: true)
  await #expect(throws: SyncFailure.httpStatus(503)) { try await store.sync(using: remote) }
  let restored = try backend.open(file, accountID: "alice")
  #expect(await restored.pendingCount == 1)
}
@Test(arguments: Backend.allCases) func malformedResponseDoesNotAdvanceCursorOrDropEdits(
  _ backend: Backend
) async throws {
  let file = backend.location()
  defer { backend.remove(file) }
  let store = try backend.open(file, accountID: "alice")
  let remote = Remote()
  try await store.commit([mutation("queued")])
  await remote.configure(badPage: true)
  await #expect(throws: SyncFailure.invalidResponse) { try await store.sync(using: remote) }
  #expect(await store.cursor == 0)
  await remote.configure(badWinner: true)
  await #expect(throws: SyncFailure.invalidResponse) { try await store.sync(using: remote) }
  #expect(await store.pendingCount == 1)
}
@Test(arguments: Backend.allCases) func failedDiskWriteDoesNotPublishMutation(_ backend: Backend)
  async throws
{
  let (store, release) = try backend.failingStore()
  defer { release() }
  await #expect(throws: (any Error).self) { try await store.commit([mutation("not committed")]) }
  #expect(await store.snapshot().isEmpty)
  #expect(await store.pendingCount == 0)
}
@Test(arguments: Backend.allCases) func clockRollbackStillCreatesNewerVersion(_ backend: Backend)
  async throws
{
  let file = backend.location()
  defer { backend.remove(file) }
  let store = try backend.open(file, accountID: "alice")
  try await store.commit([mutation("first")], now: Date(timeIntervalSince1970: 100))
  let first = await store.snapshot()["article/one"]!.hlc
  try await store.commit([mutation("second")], now: Date(timeIntervalSince1970: 90))
  #expect(await store.snapshot()["article/one"]!.hlc > first)
}
@Test func filesHaveStableSHA256IdentityAndHTTPIsRejected() throws {
  #expect(
    HTTPRemote.fileID(Data())
      == "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
  let identity = ArcticSession(
    accountID: "alice", email: "a@example.com", server: URL(string: "http://example.com")!,
    cookie: "secret")
  #expect(throws: SyncFailure.invalidServer) { try HTTPRemote(identity: identity) }
}

@Test(arguments: Backend.allCases) func unsupportedDomainRecordDoesNotCommitPullCursor(
  _ backend: Backend
) async throws {
  let remote = Remote()
  let sourceFile = backend.location()
  let targetFile = backend.location()
  defer {
    backend.remove(sourceFile)
    backend.remove(targetFile)
  }
  let source = try backend.open(sourceFile, accountID: "alice")
  try await source.commit([mutation("future schema")])
  try await source.sync(using: remote)
  let target = try backend.open(
    targetFile, accountID: "alice", validateValue: { _ in throw SyncFailure.invalidRecord })
  await #expect(throws: SyncFailure.invalidRecord) { try await target.sync(using: remote) }
  #expect(await target.cursor == 0)
  #expect(await target.snapshot().isEmpty)
}

@Test(arguments: Backend.allCases)
func simultaneousOfflineEditsResolveByDeviceAndStayResolvedAfterRestart(_ backend: Backend)
  async throws
{
  let aFile = backend.location()
  let bFile = backend.location()
  let remote = Remote()
  defer {
    backend.remove(aFile)
    backend.remove(bFile)
  }
  let a = try backend.open(aFile, accountID: "alice", deviceID: "a")
  let b = try backend.open(bFile, accountID: "alice", deviceID: "b")
  let sameTime = Date(timeIntervalSince1970: 100)
  try await a.commit([mutation("from a")], now: sameTime)
  try await b.commit([mutation("from b")], now: sameTime)
  try await a.sync(using: remote)
  try await b.sync(using: remote)
  let restarted = try backend.open(aFile, accountID: "alice")
  try await restarted.sync(using: remote)
  #expect(await restarted.snapshot()["article/one"]?.value == "from b")
  #expect(await restarted.pendingCount == 0)
}
