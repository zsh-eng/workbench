import Foundation
import Testing

@testable import ArcticSync

@Test(arguments: Backend.allCases) func domainAndPrivateValuesAreOneDurableTransaction(
  _ backend: Backend
) async throws {
  let file = backend.location()
  defer { backend.remove(file) }
  let store = try backend.open(file, accountID: "alice")
  _ = try await store.transaction { journal in
    JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")],
      localValues: ["receipt": "presented"])
  }
  let restored = try backend.open(file, accountID: "alice")
  let journal = await restored.snapshotState()
  #expect(journal.rows.count == 1)
  #expect(journal.localValues == ["receipt": "presented"])
  #expect(await restored.pendingCount == 1)
}

@Test(arguments: Backend.allCases)
func failedJournalTransactionPublishesNeitherDomainNorPrivateValues(_ backend: Backend) async throws
{
  let (store, release) = try backend.failingStore()
  defer { release() }
  await #expect(throws: (any Error).self) {
    try await store.transaction { _ in
      JournalMutation(
        mutations: [LocalMutation(key: "library/one", value: "saved")],
        localValues: ["receipt": "presented"])
    }
  }
  let snapshot = await store.snapshotState()
  #expect(snapshot.rows.isEmpty)
  #expect(snapshot.localValues.isEmpty)
  #expect(await store.pendingCount == 0)
}

@Test(arguments: Backend.allCases) func unchangedJournalDoesNotRewriteFile(_ backend: Backend)
  async throws
{
  let file = backend.location()
  defer { backend.remove(file) }
  let store = try backend.open(file, accountID: "alice")
  // The first empty commit is still the durable marker for completed migration.
  #expect(await !store.hasCommitted)
  try await store.commit([])
  #expect(await store.hasCommitted)
  #expect(FileManager.default.fileExists(atPath: file.path))
  _ = try await store.transaction { _ in
    JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")], localValues: [:])
  }
  let oldDate = Date(timeIntervalSince1970: 1_600_000_000)
  let written = backend.written(file)
  try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: written.path)
  _ = try await store.transaction { journal in
    JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")],
      localValues: journal.localValues)
  }
  let date =
    try FileManager.default.attributesOfItem(atPath: written.path)[.modificationDate] as? Date
  #expect(date == oldDate)
}

@Test func firstOpenCopiesOnceAndAStoppedCopyRunsAgain() throws {
  let file = Backend.sqlite.location()
  defer { Backend.sqlite.remove(file) }
  struct Stopped: Error {}
  #expect(throws: Stopped.self) {
    try SyncStore.open(database: file, accountID: "alice", initial: { _ in throw Stopped() })
  }
  var copies = 0
  let copy: (JournalSnapshot) throws -> JournalMutation = { _ in
    copies += 1
    return JournalMutation(
      mutations: [LocalMutation(key: "library/one", value: "saved")],
      localValues: ["one": "cached"])
  }
  let first = try SyncStore.open(database: file, accountID: "alice", initial: copy).snapshot
  let second = try SyncStore.open(database: file, accountID: "alice", initial: copy).snapshot
  #expect(copies == 1)
  #expect(first.rows["library/one"]?.value == "saved")
  #expect(second.rows == first.rows)
  #expect(second.localValues == ["one": "cached"])
}
