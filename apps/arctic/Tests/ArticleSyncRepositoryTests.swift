import ArcticSync
import Foundation
import Testing

@testable import ArticleSyncBridge

private func root() -> URL {
  FileManager.default.temporaryDirectory.appending(path: "arctic-domain-\(UUID())")
}
private let server = URL(string: "https://sync.example")!
private func article(_ slug: String = "one") -> SavedArticle {
  var article = SavedArticle(url: URL(string: "https://example.com/\(slug)")!, title: "Original")
  article.savedAt = Date(timeIntervalSince1970: 1_700_000_000)
  article.tags = ["Design"]
  return article
}

@Test func canonicalIdentityAndPrivateLocalFields() throws {
  let original = URL(string: "HTTPS://EXAMPLE.COM:443/path?q=one#section")!
  #expect(
    try ArticleSyncCodec.identity(original)
      == ArticleSyncCodec.identity(URL(string: "https://example.com/path?q=one")!))
  #expect(
    try ArticleSyncCodec.identity(original)
      != ArticleSyncCodec.identity(URL(string: "https://example.com/path?q=two")!))
  var value = article()
  value.downloadedAt = Date()
  value.imageURL = URL(filePath: "/private/fixture.png")
  value.sharedTransferID = UUID()
  var state = ArticleTaggingState()
  state.pendingIdentity = "private-pending-input"
  value.tagging = state
  let values = try ArticleSyncCodec.values(value)
  #expect(values.count == 3)
  let encoded = values.values.joined()
  #expect(!encoded.contains("downloadedAt"))
  #expect(!encoded.contains("private-pending-input"))
  #expect(!encoded.contains("sharedTransferID"))
  #expect(!encoded.contains("/private/fixture"))
}

@Test func localMigrationIsAtomicAndDoesNotRepeatAfterDeletion() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let legacy = article()
  let first = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [legacy])
  #expect(try await first.snapshot().first?.savedAt == legacy.savedAt)
  #expect(await first.pendingCount == 3)
  _ = try await first.transaction { $0.removeAll() }
  let restored = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [legacy])
  #expect(try await restored.snapshot().isEmpty)
  #expect(await restored.pendingCount == 3)
}

@Test func accountAndServerScopesDoNotMix() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let local = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [article()])
  let alice = try await ArticleSyncRepository.open(
    root: directory, scope: .account(server: server, id: "alice"))
  let bob = try await ArticleSyncRepository.open(
    root: directory, scope: .account(server: server, id: "bob"))
  let elsewhere = try await ArticleSyncRepository.open(
    root: directory, scope: .account(server: URL(string: "https://other.example")!, id: "alice"))
  #expect(try await alice.snapshot().isEmpty)
  #expect(try await bob.snapshot().isEmpty)
  #expect(try await elsewhere.snapshot().isEmpty)
  _ = try await alice.importLocalArticles(try await local.snapshot())
  #expect(try await alice.snapshot().count == 1)
  #expect(try await bob.snapshot().isEmpty)
  #expect(try await elsewhere.snapshot().isEmpty)
  #expect(try await local.snapshot().count == 1)
  await #expect(throws: ArticleSyncError.localMigrationIntoAccount) {
    try await ArticleSyncRepository.open(
      root: directory, scope: .account(server: server, id: "eve"), legacyLocalArticles: [article()])
  }
  let normalized = try await ArticleSyncRepository.open(
    root: directory, scope: .account(server: URL(string: "https://SYNC.EXAMPLE:443/")!, id: "alice")
  )
  #expect(try await normalized.snapshot().count == 1)
}

@Test func explicitImportKeepsExistingValuesAndTombstones() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let repository = try await ArticleSyncRepository.open(
    root: directory, scope: .account(server: server, id: "alice"))
  _ = try await repository.importLocalArticles([article(), article("two")])
  _ = try await repository.transaction {
    $0.removeAll { $0.url.lastPathComponent == "one" }
    $0[0].title = "Remote edit"
  }
  let result = try await repository.importLocalArticles([article(), article("two")])
  #expect(result.count == 1)
  #expect(result[0].title == "Remote edit")
}

@Test func concurrentDomainTransactionsDoNotLoseArticles() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let repository = try await ArticleSyncRepository.open(root: directory, scope: .local)
  try await withThrowingTaskGroup(of: Void.self) { tasks in
    for index in 0..<2 {
      tasks.addTask { _ = try await repository.transaction { $0.append(article("\(index)")) } }
    }
    try await tasks.waitForAll()
  }
  #expect(try await repository.snapshot().count == 2)
  let restored = try await ArticleSyncRepository.open(root: directory, scope: .local)
  #expect(try await restored.snapshot().count == 2)
}

@Test func partialRemoteFamilyIsNotDeletedByAnUnrelatedEdit() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let journal = try SyncStore(
    database: directory.appending(path: "journal.sqlite"), accountID: "test",
    validateValue: ArticleSyncCodec.validate)
  let value = try ArticleSyncCodec.values(article()).first { $0.key.hasPrefix("article/") }!
  try await journal.commit([LocalMutation(key: value.key, value: value.value)])
  let rows = await journal.snapshot()
  #expect(try ArticleSyncCodec.project(rows).isEmpty)
  let mutations = try ArticleSyncCodec.mutations(replacing: rows, with: [article("two")])
  #expect(mutations.count == 3)
  #expect(mutations.allSatisfy { !$0.isDeleted && $0.key != value.key })
}

private actor DomainRemote: SyncRemote {
  var records: [String: SyncRecord] = [:]
  var sequence: Int64 = 0
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    let end = head ?? sequence
    let rows = records.values.filter { $0.serverSeq > cursor && $0.serverSeq <= end }.sorted {
      $0.serverSeq < $1.serverSeq
    }
    return SyncPull(records: rows, cursor: end, head: end, hasMore: false)
  }
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    SyncPush(
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

@Test func twoDevicesKeepMetadataLibraryAndTagsIndependent() async throws {
  let aRoot = root()
  let bRoot = root()
  defer {
    try? FileManager.default.removeItem(at: aRoot)
    try? FileManager.default.removeItem(at: bRoot)
  }
  let scope = ArticleSyncScope.account(server: server, id: "alice")
  let a = try await ArticleSyncRepository.open(root: aRoot, scope: scope)
  let b = try await ArticleSyncRepository.open(root: bRoot, scope: scope)
  let remote = DomainRemote()
  _ = try await a.importLocalArticles([article()])
  _ = try await a.sync(using: remote)
  _ = try await b.sync(using: remote)
  _ = try await a.transaction { $0[0].isArchived = true }
  _ = try await b.transaction {
    $0[0].title = "Metadata refreshed"
    $0[0].tags = ["Intentional tag"]
    $0[0].tagging?.manual = ["Intentional tag"]
  }
  _ = try await a.sync(using: remote)
  _ = try await b.sync(using: remote)
  let result = try await a.sync(using: remote)
  #expect(result[0].isArchived == true)
  #expect(result[0].title == "Metadata refreshed")
  #expect(result[0].tagNames == ["Intentional tag"])
  #expect(result[0].savedAt == article().savedAt)
  #expect(await a.pendingCount == 0)
  #expect(await b.pendingCount == 0)
}

@Test func localReceiptsAndCachedFieldsShareDomainCommitButNeverUpload() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  var original = article()
  original.downloadedAt = Date(timeIntervalSince1970: 1_700_000_500)
  original.sharedTransferID = UUID()
  original.imageURL = URL(filePath: "/private/fixture.png")
  var state = ArticleTaggingState()
  state.sharedFeedbackTransferID = original.sharedTransferID
  original.tagging = state
  let local = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [original])
  let snapshot = try await local.snapshot()
  #expect(snapshot[0].id == original.id)
  #expect(snapshot[0].downloadedAt == original.downloadedAt)
  #expect(snapshot[0].tagging?.sharedFeedbackTransferID == original.sharedTransferID)
  let restored = try await ArticleSyncRepository.open(root: directory, scope: .local)
  #expect(try await restored.snapshot()[0].imageURL == original.imageURL)
  #expect(try await restored.snapshot()[0].downloadedAt == original.downloadedAt)
  let account = try await ArticleSyncRepository.open(
    root: directory, scope: .account(server: server, id: "alice"))
  let copied = try await account.importLocalArticles(snapshot)
  #expect(copied[0].downloadedAt == nil)
  #expect(copied[0].sharedTransferID == nil)
  #expect(copied[0].imageURL == nil)
  #expect(copied[0].tagging?.sharedFeedbackTransferID == nil)
  await #expect(throws: ArticleSyncError.localProfileCannotSync) {
    try await local.sync(using: DomainRemote())
  }
}

@Test func migratedDatesSurviveEditingOneArticle() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let articles = (0..<3).map { index in
    var value = article("batch-\(index)")
    value.savedAt = Date(timeIntervalSince1970: Double(1_700_000_000 + index))
    return value
  }
  let repository = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: articles)
  _ = try await repository.transaction { values in
    let index = values.firstIndex { $0.url.lastPathComponent == "batch-1" }!
    values[index].isArchived = true
  }
  let reopened = try await ArticleSyncRepository.open(root: directory, scope: .local)
  let restored = try await reopened.snapshot()
  #expect(restored.count == articles.count)
  #expect(restored.filter { $0.isArchived == true }.map(\.url.lastPathComponent) == ["batch-1"])
  for original in articles {
    #expect(restored.first { $0.url == original.url }?.savedAt == original.savedAt)
  }
}

@Test func scopedEditsKeepOtherArticlesAndPrivateFields() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let repository = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [article(), article("two")])
  let edited = try await repository.editArticle(at: article().url) { value in
    value?.isArchived = true
    value?.downloadedAt = Date(timeIntervalSince1970: 1_700_000_123)
  }
  #expect(edited?.isArchived == true)
  #expect(edited?.downloadedAt?.timeIntervalSince1970 == 1_700_000_123)
  let other = try await repository.snapshot().first { $0.url.lastPathComponent == "two" }!
  #expect(other.isArchived == false)
  _ = try await repository.editArticle(at: article().url) { $0 = nil }
  let restored = try await ArticleSyncRepository.open(root: directory, scope: .local)
  #expect(try await restored.snapshot().count == 1)
  #expect(try await restored.snapshot()[0].url.lastPathComponent == "two")
  await #expect(throws: ArticleSyncError.invalidValue) {
    try await repository.editArticle(at: article("two").url) { $0 = article("another") }
  }
  #expect(try await repository.snapshot().count == 1)
  #expect(try await repository.snapshot()[0].url.lastPathComponent == "two")
}

@Test func concurrentScopedEditsReadLatestState() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let initial = article()
  let repository = try await ArticleSyncRepository.open(
    root: directory, scope: .local, legacyLocalArticles: [initial])
  try await withThrowingTaskGroup(of: Void.self) { tasks in
    for index in 0..<2 {
      tasks.addTask {
        _ = try await repository.editArticle(at: initial.url) { value in
          value?.tags?.append("Tag \(index)")
        }
      }
    }
    try await tasks.waitForAll()
  }
  let snapshot = try await repository.snapshot()
  #expect(Set(snapshot[0].tagNames) == ["Design", "Tag 0", "Tag 1"])
}

@Test func scopedLibraryEditDoesNotRewriteDifferentlyFormattedRemoteFamilies() async throws {
  let directory = root()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try SyncStore(
    database: directory.appending(path: "journal.sqlite"), accountID: "test")
  let original = article()
  let mutations = try ArticleSyncCodec.values(original).map { key, value in
    let object = try JSONSerialization.jsonObject(with: Data(value.utf8))
    let reformatted = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted])
    return LocalMutation(key: key, value: String(decoding: reformatted, as: UTF8.self))
  }
  try await store.commit(mutations)
  let journal = await store.snapshotState()
  let id = try ArticleSyncCodec.identity(original.url)
  var projected = try ArticleSyncCodec.article(journal, identity: id)!
  projected.isArchived = true
  let changed = try ArticleSyncCodec.articleMutation(journal, identity: id, article: projected)
  #expect(changed.mutations.count == 1)
  #expect(changed.mutations[0].key == "library/" + id)
}
