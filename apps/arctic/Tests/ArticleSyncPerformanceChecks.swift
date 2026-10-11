import ArcticSync
import Foundation
import Testing

@testable import ArticleSyncBridge

/// Acknowledges every upload, so the measured profile ends with an empty outbox.
private actor AcceptingRemote: SyncRemote {
  var sequence: Int64 = 0
  func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    SyncPull(records: [], cursor: cursor, head: cursor, hasMore: false)
  }
  func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    SyncPush(
      results: changes.map { change in
        sequence += 1
        return .init(
          accepted: true,
          winner: SyncRecord(change: change, deviceId: deviceID, serverSeq: sequence))
      })
  }
}

private func milliseconds(_ duration: Duration) -> Double {
  let value = duration.components
  return Double(value.seconds) * 1000 + Double(value.attoseconds) / 1e15
}

private func measure<T>(_ label: String, _ work: () throws -> T) rethrows -> T {
  let start = ContinuousClock.now
  let value = try work()
  print("  \(label): \(String(format: "%.2f", milliseconds(start.duration(to: .now)))) ms")
  return value
}

@Test func profileDormantJournal() async throws {
  for count in [1000, 10_000] {
    let directory = FileManager.default.temporaryDirectory.appending(path: "arctic-perf-\(UUID())")
    defer { try? FileManager.default.removeItem(at: directory) }
    let articles = (0..<count).map { index in
      var value = SavedArticle(
        url: URL(string: "https://example.com/article-\(index)")!,
        title: "A considered article \(index)")
      value.subtitle = "An article about software, ideas and paying attention."
      value.savedAt = Date(timeIntervalSince1970: Double(1_700_000_000 + index))
      value.tags = ["Design & craft", "Engineering"]
      return value
    }
    print("PROFILE \(count) articles")
    let raw = try SyncStore(
      database: directory.appending(path: "phases.sqlite"), accountID: "performance")
    let empty = await raw.snapshotState()
    let initial = try measure("initial codec batch") {
      try ArticleSyncCodec.transaction(replacing: empty, with: articles)
    }
    let initialWrite = ContinuousClock.now
    _ = try await raw.transaction { _ in initial }
    print(
      "  initial SQLite import: \(String(format: "%.2f", milliseconds(initialWrite.duration(to: .now)))) ms"
    )
    let journal = await raw.snapshotState()
    let projected = try measure("full projection") { try ArticleSyncCodec.project(journal) }
    _ = try measure("all URL canonicalization + SHA256") {
      try articles.map { try ArticleSyncCodec.identity($0.url) }
    }
    var updated = projected
    updated[0].isArchived = true
    let fullMutation = try measure("full edit codec") {
      try ArticleSyncCodec.transaction(replacing: journal, with: updated)
    }
    let id = try ArticleSyncCodec.identity(updated[0].url)
    let single = try measure("single article projection") {
      try ArticleSyncCodec.article(journal, identity: id)
    }
    #expect(single != nil)
    let scopedMutation = try measure("single article codec") {
      try ArticleSyncCodec.articleMutation(journal, identity: id, article: updated[0])
    }
    #expect(fullMutation.mutations.count == 1)
    #expect(scopedMutation.mutations.count == 1)
    let persisted = ContinuousClock.now
    _ = try await raw.transaction { _ in scopedMutation }
    print(
      "  one-record SQLite transaction only: \(String(format: "%.2f", milliseconds(persisted.duration(to: .now)))) ms"
    )
    let repository = try await ArticleSyncRepository.open(
      root: directory.appending(path: "repository"), scope: .local, legacyLocalArticles: articles)
    let target = articles[count / 2].url
    var fullSamples: [Double] = []
    var scopedSamples: [Double] = []
    for _ in 0..<3 {
      let start = ContinuousClock.now
      _ = try await repository.transaction { values in
        let index = values.firstIndex { $0.url == target }!
        values[index].isArchived = !(values[index].isArchived == true)
      }
      fullSamples.append(milliseconds(start.duration(to: .now)))
      let keyStart = ContinuousClock.now
      _ = try await repository.editArticle(at: target) { value in
        let archived = value?.isArchived == true
        value?.isArchived = !archived
      }
      scopedSamples.append(milliseconds(keyStart.duration(to: .now)))
    }
    print(
      "  full transaction samples: \(fullSamples.map { String(format: "%.2f", $0) }.joined(separator: ", ")) ms"
    )
    print(
      "  scoped transaction samples: \(scopedSamples.map { String(format: "%.2f", $0) }.joined(separator: ", ")) ms"
    )
    // The import leaves a full outbox. Acknowledge it to measure steady-state edits.
    let settledRoot = directory.appending(path: "settled")
    let settledFile = settledRoot.appending(path: ArticleSyncCodec.hash("local"))
      .appending(path: "journal.sqlite")
    do {
      let settledStore = try SyncStore(database: settledFile, accountID: "local")
      _ = try await settledStore.transaction { _ in initial }
      try await settledStore.sync(using: AcceptingRemote())
      #expect(await settledStore.pendingCount == 0)
    }
    let reopen = ContinuousClock.now
    let settled = try await ArticleSyncRepository.open(root: settledRoot, scope: .local)
    print(
      "  reopen and validate: \(String(format: "%.2f", milliseconds(reopen.duration(to: .now)))) ms"
    )
    var settledSamples: [Double] = []
    for _ in 0..<3 {
      let start = ContinuousClock.now
      _ = try await settled.editArticle(at: target) { value in
        let archived = value?.isArchived == true
        value?.isArchived = !archived
      }
      settledSamples.append(milliseconds(start.duration(to: .now)))
    }
    let bytes = (try? FileManager.default.attributesOfItem(atPath: settledFile.path)[.size]) ?? 0
    print("  empty-outbox database size: \(bytes) bytes")
    print(
      "  empty-outbox scoped samples: \(settledSamples.map { String(format: "%.2f", $0) }.joined(separator: ", ")) ms"
    )
    let restored = try await ArticleSyncRepository.open(
      root: directory.appending(path: "repository"), scope: .local)
    #expect(try await restored.snapshot().count == count)
  }
}
