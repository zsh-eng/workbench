// Runs with Tests/check-account-records.py, which compiles the production sources.
import ArcticSync
import Foundation
import Testing

@testable import AccountRecordsBridge

/// One namespace of the account's server, with its rules: the higher clock
/// wins, then the higher device (packages/local-sync/src/hono/d1.ts), and a
/// file is named by its hash and holds no script (apps/sync-server/src/files.ts).
private actor Server {
  let scope: SyncScope
  var online = true
  private(set) var files: [String: Data] = [:]
  private(set) var uploads = 0
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
  func upload(_ html: Data) throws -> String {
    guard !String(decoding: html, as: UTF8.self).lowercased().contains("<script") else {
      throw SyncFailure.httpStatus(415)
    }
    let id = XXH64.fileID(html)
    files[id] = html
    uploads += 1
    return id
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
  func uploadText(_ html: Data) async throws -> String {
    try await server.reach()
    return try await server.upload(html)
  }
  func cancel() async {}
}

/// An account with a server for each family, and the phone's folder.
@MainActor private final class World {
  let root = FileManager.default.temporaryDirectory.appending(path: "arctic-records-\(UUID())")
  let account = SyncScope(origin: "https://sync.example", userId: "reader", epoch: "first")
  var servers: [AccountRecordFamily: Server] = [:]
  var copies: [KeptCopy] = []

  init() {
    for family in AccountRecordFamily.allCases {
      servers[family] = Server(
        SyncScope(
          origin: account.origin, userId: account.userId, namespace: family.namespace,
          epoch: "first"))
    }
  }
  deinit { try? FileManager.default.removeItem(at: root) }

  func connect(_ online: Bool) async {
    for server in servers.values { await server.connect(online) }
  }

  /// The app as it launches: its files, and its sync of them.
  func launch() -> (annotations: AnnotationStore, records: AccountRecords) {
    let annotations = AnnotationStore(directory: root.appending(path: "Annotations"))
    let servers = servers
    let records = AccountRecords(
      root: root.appending(path: "Library"), account: { [account] in account },
      annotations: annotations,
      sessions: ReadingSessions(directory: root.appending(path: "ReadingSessions")),
      copies: { [unowned self] in copies },
      connect: { family in Phone(server: servers[family]!) }, edited: {})
    return (annotations, records)
  }

  /// A Reader copy of a saved article, as the Reader writes it (ArticleBrowser.readerHTML).
  func keep(_ url: String, words: Int) throws -> KeptCopy {
    let folder = root.appending(path: "Downloads")
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let file = folder.appending(path: "\(UUID()).html")
    try Data(Self.page(words: words).utf8).write(to: file)
    return KeptCopy(url: URL(string: url)!, file: file)
  }

  static func article(words: Int) -> String {
    "<p>" + Array(repeating: "ice", count: words).joined(separator: " ") + "</p>"
  }
  static func page(words: Int) -> String {
    """
    <!doctype html><html><head><meta charset="utf-8"><style>body { margin: 0 }</style></head>\
    <body><main><header><h1>Polar night</h1></header>\
    <article id="reader-content">\(article(words: words))</article></main></body></html>
    """
  }
}

@MainActor @Test func anOlderPhoneEditDoesNotReplaceANewerWebEdit() async throws {
  let world = World()
  let notes = world.servers[.annotations]!

  // A highlight with a note reaches the account.
  var phone = world.launch()
  let quote = ReaderQuote(exact: "the sea smokes", prefix: "At dawn ", suffix: ".", start: 8)
  let highlight = try phone.annotations.highlight(
    quote, in: URL(string: "https://example.com/ice")!)
  try phone.annotations.updateNote("First thought", id: highlight.id)
  try await phone.records.sync()
  let key = "annotation/\(highlight.id.uuidString)"
  #expect(await notes.value(key)?.contains("First thought") == true)

  // Offline, the phone opens again and the note is edited.
  await world.connect(false)
  phone.records.retire()
  phone = world.launch()
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
  await world.connect(true)
  try await phone.records.sync()
  let sent = await notes.push(deviceID: "web", changes: [change])
  #expect(sent.results.first?.accepted == true)
  #expect(await notes.value(key)?.contains("The web's newer note") == true)
  try await phone.records.sync()
  #expect(phone.annotations.records.first { $0.id == highlight.id }?.note == "The web's newer note")
}

@MainActor @Test func aReaderCopyGoesToTheAccountWhenItHasNoText() async throws {
  let world = World()
  let text = world.servers[.copies]!
  // Newest first: an article, a teaser, and one whose text the web kept.
  let polar = try world.keep("https://example.com/polar-night", words: 150)
  let teaser = try world.keep("https://example.com/teaser", words: 30)
  let older = try world.keep("https://example.com/older", words: 400)
  world.copies = [polar, teaser, older]
  let key = { (copy: KeptCopy) in "content/\(try ArticleSyncCodec.identity(copy.url))" }
  let kept = try ArticleSyncCodec.encode(
    ArticleCopyRecord(
      url: "https://example.com/older", file: "xxh64:0123456789abcdef", bytes: 9, words: 380,
      source: "browser", savedAt: 1))
  _ = await text.push(
    deviceID: "web",
    changes: [
      SyncChange(
        key: try key(older), value: kept, isDeleted: false, schemaVersion: 1,
        hlc: SyncClock(wallTimeMs: 1))
    ])

  // The article's own HTML goes up, without the Reader's page around it,
  // with the record that Arctic for the web reads (Browser/src/articles.ts).
  let phone = world.launch()
  try await phone.records.sync()
  let html = Data(World.article(words: 150).utf8)
  let record = try JSONDecoder().decode(
    ArticleCopyRecord.self, from: Data(try #require(await text.value(try key(polar))).utf8))
  #expect(await text.files == [XXH64.fileID(html): html])
  #expect(record.file == XXH64.fileID(html))
  #expect(record.url == "https://example.com/polar-night")
  #expect(record.words == 150 && record.bytes == html.count)
  #expect(record.format == "html" && record.source == "arctic")
  #expect(await text.value(try key(teaser)) == nil)
  #expect(await text.value(try key(older)) == kept)

  // The next sync has nothing more to send.
  try await phone.records.sync()
  #expect(await text.uploads == 1)
}
