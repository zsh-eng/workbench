// Runs with Tests/check-account-records.py, which compiles the production sources.
import ArcticSync
import Foundation
import Testing

@testable import AccountRecordsBridge

/// One namespace of the account's server, with its rule: the higher clock
/// wins, then the higher device (packages/local-sync/src/hono/d1.ts).
private actor Server {
  let scope: SyncScope
  var online = true
  private var records: [String: SyncRecord] = [:]
  private var sequence: Int64 = 0
  init(_ scope: SyncScope) { self.scope = scope }

  func connect(_ online: Bool) { self.online = online }
  func reach() throws {
    if !online { throw URLError(.notConnectedToInternet) }
  }
  func value(_ key: String) -> String? { records[key]?.value }

  func pull(cursor: Int64) -> SyncPull {
    let rows = records.values.filter { $0.serverSeq > cursor }.sorted {
      $0.serverSeq < $1.serverSeq
    }
    return .init(records: rows, cursor: sequence, head: sequence, hasMore: false)
  }
  func push(deviceID: String, changes: [SyncChange]) -> SyncPush {
    .init(
      results: changes.map { change in
        if let old = records[change.key],
          old.hlc > change.hlc || (old.hlc == change.hlc && old.deviceId >= deviceID)
        {
          return .init(accepted: false, winner: old)
        }
        sequence += 1
        let winner = SyncRecord(change: change, deviceId: deviceID, serverSeq: sequence)
        records[change.key] = winner
        return .init(accepted: true, winner: winner)
      })
  }
}

/// The phone's transport to one namespace.
private struct Phone: AccountRecordRemote {
  let server: Server
  func getScope() async throws -> SyncScope {
    try await server.reach()
    return server.scope
  }
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    try await server.reach()
    return await server.pull(cursor: cursor)
  }
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    try await server.reach()
    return await server.push(deviceID: deviceID, changes: changes)
  }
  func cancel() async {}
}

@MainActor @Test func anOlderPhoneEditDoesNotReplaceANewerWebEdit() async throws {
  let root = FileManager.default.temporaryDirectory.appending(path: "arctic-records-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let account = SyncScope(origin: "https://sync.example", userId: "reader", epoch: "first")
  var servers: [AccountRecordFamily: Server] = [:]
  for family in AccountRecordFamily.allCases {
    servers[family] = Server(
      SyncScope(
        origin: account.origin, userId: account.userId, namespace: family.namespace,
        epoch: "first"))
  }
  let notes = servers[.annotations]!
  func connect(_ online: Bool) async {
    for server in servers.values { await server.connect(online) }
  }
  /// The app as it launches: its files, and its sync of them.
  func launch() -> (annotations: AnnotationStore, records: AccountRecords) {
    let annotations = AnnotationStore(directory: root.appending(path: "Annotations"))
    let records = AccountRecords(
      root: root.appending(path: "Library"), account: { account }, annotations: annotations,
      sessions: ReadingSessions(directory: root.appending(path: "ReadingSessions")),
      connect: { family in Phone(server: servers[family]!) }, edited: {})
    return (annotations, records)
  }

  // A highlight with a note reaches the account.
  var phone = launch()
  let quote = ReaderQuote(exact: "the sea smokes", prefix: "At dawn ", suffix: ".", start: 8)
  let highlight = try phone.annotations.highlight(
    quote, in: URL(string: "https://example.com/ice")!)
  try phone.annotations.updateNote("First thought", id: highlight.id)
  try await phone.records.sync()
  let key = "annotation/\(highlight.id.uuidString)"
  #expect(await notes.value(key)?.contains("First thought") == true)

  // Offline, the phone opens again and the note is edited.
  await connect(false)
  phone.records.retire()
  phone = launch()
  try phone.annotations.updateNote("The phone's older note", id: highlight.id)
  try await Task.sleep(for: .milliseconds(5))

  // Later, Arctic for the web edits the same note offline. Its change is
  // stamped when it is written (Browser/src/sync/storage.ts).
  var web = phone.annotations.records.first { $0.id == highlight.id }!
  web.note = "The web's newer note"
  web.updatedAt = Date()
  let change = SyncChange(
    key: key, value: try ArticleSyncCodec.encode(web), isDeleted: false, schemaVersion: 1,
    hlc: SyncClock(wallTimeMs: Int64(web.updatedAt.timeIntervalSince1970 * 1000)))
  try await Task.sleep(for: .milliseconds(5))

  // The phone syncs first, then the web sends its change. The newer note
  // stays, and the phone takes it at its next sync.
  await connect(true)
  try await phone.records.sync()
  let sent = await notes.push(deviceID: "web", changes: [change])
  #expect(sent.results.first?.accepted == true)
  #expect(await notes.value(key)?.contains("The web's newer note") == true)
  try await phone.records.sync()
  #expect(phone.annotations.records.first { $0.id == highlight.id }?.note == "The web's newer note")
}
