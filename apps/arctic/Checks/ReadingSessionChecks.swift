// swiftc Sources/ReadingSessions.swift Checks/ReadingSessionChecks.swift -o /tmp/arctic-reading-time-check
import Foundation

@main struct ReadingSessionChecks {
  @MainActor final class Clock {
    var tick: TimeInterval = 1000
    var date = Date(timeIntervalSince1970: 1_700_000_000)
    func advance(_ seconds: TimeInterval) {
      tick += seconds
      date.addTimeInterval(seconds)
    }
  }

  @MainActor static func main() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let clock = Clock()
    let first = URL(string: "https://fixture.example/first")!
    let next = URL(string: "https://fixture.example/next")!
    let store = ReadingSessions(
      directory: directory, monotonicNow: { clock.tick }, wallNow: { clock.date })
    try await ready(store)

    // No eligible visit: background or speculative extraction cannot record time.
    clock.advance(30)
    store.activity()
    precondition(store.total(for: first) == 0)
    store.begin(url: first)
    clock.advance(10)
    store.begin(url: first)  // Duplicate eligibility notifications do not reset the baseline.
    clock.advance(10)
    store.activity()
    precondition(store.total(for: first) == 20)
    clock.advance(120)
    store.activity()
    precondition(store.total(for: first) == 140)
    clock.advance(121)
    store.activity()
    precondition(store.total(for: first) == 140)  // Not capped to 120: discard all 121 seconds.
    clock.advance(3)
    store.pause()
    precondition(store.total(for: first) == 143)
    clock.advance(80)
    store.activity()
    store.pause()
    precondition(store.total(for: first) == 143)
    store.begin(url: first)
    clock.advance(5)
    store.end()
    try await settled(store)
    precondition(store.total(for: first) == 148)
    precondition(store.sessions(for: first).count == 1)

    // Crossing a document boundary closes the old interval before starting a new one.
    store.begin(url: first)
    clock.advance(7)
    store.begin(url: next)
    clock.advance(8)
    store.activity(for: first)
    precondition(store.total(for: next) == 0)  // An outgoing document cannot report for this visit.
    store.end()
    try await settled(store)
    precondition(store.total(for: first) == 155)
    precondition(store.total(for: next) == 8)
    precondition(store.sessions(for: first).count == 2)

    // A checkpoint never credits elapsed time or waits for a user's next action.
    store.begin(url: first)
    clock.advance(100)
    store.flush(force: true)
    precondition(store.total(for: first) == 155)
    clock.advance(30)
    store.end()
    precondition(store.sessions(for: first).count == 2)  // Empty idle visit is not persisted.

    // A regressed monotonic clock establishes a new boundary; wall-clock changes
    // cannot make a negative interval or move a session's update date backwards.
    store.begin(url: next)
    clock.advance(5)
    store.activity()
    let beforeRegression = store.sessions(for: next).last!
    clock.advance(-40)
    store.activity()
    precondition(store.total(for: next) == 13)
    clock.advance(4)
    store.end()
    try await settled(store)
    precondition(store.total(for: next) == 17)
    precondition(store.sessions(for: next).last!.updatedAt >= beforeRegression.updatedAt)

    // Frequent events coalesce until a checkpoint. A later edit while a previous
    // snapshot is in flight must win even after the owner stops its timer.
    store.begin(url: first)
    clock.advance(1)
    store.activity()
    store.flush(force: true)
    clock.advance(2)
    store.activity()
    store.end()
    try await settled(store)
    let restored = ReadingSessions(directory: directory)
    try await ready(restored)
    precondition(restored.total(for: first) == 158)
    precondition(restored.total(for: next) == 17)
    precondition(restored.sessions(for: first).count == 3)

    // Corruption stays isolated. Failed atomic writes retain the latest value
    // and can be retried after storage becomes available, without duplicate time.
    try Data("broken".utf8).write(to: directory.appending(path: "damaged.json"))
    let partial = ReadingSessions(directory: directory)
    try await ready(partial)
    precondition(partial.loadError != nil && partial.total(for: first) == 158)
    let failureDirectory = directory.appending(path: "failure")
    let failing = ReadingSessions(
      directory: failureDirectory, monotonicNow: { clock.tick }, wallNow: { clock.date })
    try await ready(failing)
    try FileManager.default.removeItem(at: failureDirectory)
    try Data("not a directory".utf8).write(to: failureDirectory)
    failing.begin(url: first)
    clock.advance(12)
    failing.end()
    try await settled(failing)
    precondition(failing.lastError != nil && failing.hasUnpersistedChanges)
    precondition(failing.total(for: first) == 12)
    try FileManager.default.removeItem(at: failureDirectory)
    failing.flush(force: true)
    try await settled(failing)
    precondition(failing.lastError == nil && !failing.hasUnpersistedChanges)
    let retried = ReadingSessions(directory: failureDirectory)
    try await ready(retried)
    precondition(retried.total(for: first) == 12)

    // A page opened above another begins its own visit before the covered page
    // disappears. The covered page's late pause or end must not stop it.
    let pages = ReadingSessions(
      directory: directory.appending(path: "pages"), monotonicNow: { clock.tick },
      wallNow: { clock.date })
    try await ready(pages)
    pages.begin(url: first)
    clock.advance(3)
    pages.begin(url: next)
    clock.advance(4)
    pages.pause(url: first)
    pages.end(url: first)
    clock.advance(5)
    pages.end(url: next)
    try await settled(pages)
    precondition(pages.total(for: first) == 3)
    precondition(pages.total(for: next) == 9)
    print(
      "Reading sessions: 120-second boundary, discarded idle gaps, pause/resume, navigation, clock regression, checkpoint ordering, restart, damaged record isolation, retained retry and scoped page lifecycle passed"
    )
  }

  @MainActor private static func ready(_ store: ReadingSessions) async throws {
    let deadline = Date().addingTimeInterval(5)
    while !store.isLoaded && Date() < deadline { try await Task.sleep(for: .milliseconds(5)) }
    precondition(store.isLoaded, "Session loading did not finish")
  }

  @MainActor private static func settled(_ store: ReadingSessions) async throws {
    let deadline = Date().addingTimeInterval(5)
    while store.hasPendingWrites && Date() < deadline {
      try await Task.sleep(for: .milliseconds(5))
    }
    precondition(!store.hasPendingWrites, "Session persistence did not finish")
  }
}
