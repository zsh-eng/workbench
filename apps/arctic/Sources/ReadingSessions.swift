import Foundation

/// One visit can contain several active intervals. Wall dates describe the visit;
/// only monotonic activity boundaries contribute to its estimated duration.
struct ArticleReadingSession: Codable, Identifiable, Equatable, Sendable {
  var id: UUID
  var articleURL: URL
  var startedAt: Date
  var updatedAt: Date
  var seconds: TimeInterval
}

/// Activity accounting has no render-loop observation or per-interaction writes.
/// The owner enables this only for a visible article with readable text.
/// A timer may checkpoint dirty values, but it must never manufacture activity.
@MainActor final class ReadingSessions {
  static let shared = ReadingSessions()
  static let inactivityThreshold: TimeInterval = 120
  static let checkpointInterval: TimeInterval = 5

  private(set) var isLoaded = false
  private(set) var loadError: String?
  var lastError: String? { failures.values.first ?? loadError }
  var hasPendingWrites: Bool { !pending.isEmpty }
  var hasUnpersistedChanges: Bool { !dirty.isEmpty }

  private struct Visit {
    var id: UUID
    var boundary: TimeInterval?
  }

  private let directory: URL
  private let monotonicNow: () -> TimeInterval
  private let wallNow: () -> Date
  private let writes = DispatchQueue(label: "arctic.reading-session-files", qos: .utility)
  private var records: [UUID: ArticleReadingSession] = [:]
  private var totals: [URL: TimeInterval] = [:]
  private var visit: Visit?
  private var revisions: [UUID: UInt64] = [:]
  private var dirty: Set<UUID> = []
  private var pending: Set<UUID> = []
  private var failures: [UUID: String] = [:]
  private var lastCheckpoint: TimeInterval?

  init(
    directory: URL? = nil,
    monotonicNow: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    wallNow: @escaping () -> Date = Date.init
  ) {
    var folder = "ReadingSessions"
    var reset = false
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-ui-testing") {
        folder = "TestReadingSessions"
        reset = directory == nil && ProcessInfo.processInfo.arguments.contains("-reset-store")
      }
    #endif
    self.directory =
      directory
      ?? URL.applicationSupportDirectory.appending(
        path: "ArticleReader/\(folder)", directoryHint: .isDirectory)
    self.monotonicNow = monotonicNow
    self.wallNow = wallNow
    load(reset: reset)
  }

  /// Calling begin for the same URL is idempotent while active and resumes a
  /// paused visit from now. A different document closes the previous visit.
  func begin(url: URL) {
    if let visit, records[visit.id]?.articleURL == url {
      if visit.boundary == nil { self.visit?.boundary = monotonicNow() }
      return
    }
    end()
    let date = wallNow()
    let record = ArticleReadingSession(
      id: UUID(), articleURL: url, startedAt: date, updatedAt: date, seconds: 0)
    records[record.id] = record
    visit = Visit(id: record.id, boundary: monotonicNow())
  }

  /// The caller supplies deliberate user actions, not layout, image loading,
  /// programmatic scroll restoration, or speculative Reader preparation.
  func activity() {
    accountBoundary()
  }

  /// UI callbacks carry their current document identity. A late callback from
  /// an outgoing page must not credit the newly opened article.
  func activity(for url: URL) {
    guard let visit, records[visit.id]?.articleURL == url else { return }
    activity()
  }

  /// Ends an active interval without ending the article visit. Repeated pauses
  /// have no effect. No time between this call and the next begin is included.
  /// With a URL, only that document's visit pauses: a page covered by another
  /// page cannot pause the visible one.
  func pause(url: URL? = nil) {
    guard visit?.boundary != nil, owns(url) else { return }
    accountBoundary()
    visit?.boundary = nil
    flush(force: true)
  }

  func end(url: URL? = nil) {
    guard owns(url) else { return }
    pause()
    if let visit, records[visit.id]?.seconds == 0 { records.removeValue(forKey: visit.id) }
    visit = nil
  }

  private func owns(_ url: URL?) -> Bool {
    guard let url else { return true }
    guard let visit else { return false }
    return records[visit.id]?.articleURL == url
  }

  /// Includes durable history and completed activity intervals from this visit.
  /// It never extrapolates time from an unanswered activity boundary.
  func total(for url: URL) -> TimeInterval { totals[url, default: 0] }

  /// Read once when statistics open, rather than observing each activity boundary.
  func snapshot() -> [ArticleReadingSession] { Array(records.values) }

  func sessions(for url: URL) -> [ArticleReadingSession] {
    records.values.filter { $0.articleURL == url && $0.seconds > 0 }
      .sorted { $0.startedAt < $1.startedAt }
  }

  /// Copies only changed session records to a serial writer. A failed write
  /// leaves its dirty value available for a later checkpoint or explicit retry.
  func flush(force: Bool = false) {
    guard !dirty.isEmpty else { return }
    let now = monotonicNow()
    if !force, let lastCheckpoint, now >= lastCheckpoint,
      now - lastCheckpoint < Self.checkpointInterval
    {
      return
    }
    lastCheckpoint = now
    for id in dirty where !pending.contains(id) { write(id) }
  }

  private func accountBoundary() {
    guard let visit, let previous = visit.boundary, var record = records[visit.id] else { return }
    let now = monotonicNow()
    self.visit?.boundary = now
    let elapsed = now - previous
    // A long idle gap is discarded in full, not credited up to the threshold.
    // A regressed clock starts a fresh baseline and cannot subtract duration.
    guard elapsed > 0, elapsed <= Self.inactivityThreshold else { return }
    record.seconds += elapsed
    record.updatedAt = max(record.updatedAt, wallNow())
    records[record.id] = record
    totals[record.articleURL, default: 0] += elapsed
    revisions[record.id, default: 0] += 1
    dirty.insert(record.id)
  }

  private func load(reset: Bool) {
    let directory = directory
    writes.async { [weak self] in
      var loaded: [ArticleReadingSession] = []
      var message: String?
      do {
        if reset, FileManager.default.fileExists(atPath: directory.path) {
          try FileManager.default.removeItem(at: directory)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let files = try FileManager.default.contentsOfDirectory(
          at: directory, includingPropertiesForKeys: nil)
        for file in files where file.pathExtension == "json" {
          do {
            let record = try JSONDecoder().decode(
              ArticleReadingSession.self, from: Data(contentsOf: file))
            guard record.seconds.isFinite, record.seconds >= 0 else {
              message = "A reading session could not be read. Its file has been kept."
              continue
            }
            loaded.append(record)
          } catch {
            // Isolate a damaged record; never clear or rewrite the remaining history.
            message = "A reading session could not be read. Its file has been kept."
          }
        }
      } catch { message = error.localizedDescription }
      let result = loaded
      let failure = message
      Task { @MainActor [weak self] in
        guard let self else { return }
        for record in result where self.records[record.id] == nil {
          self.records[record.id] = record
          self.totals[record.articleURL, default: 0] += record.seconds
        }
        self.loadError = failure
        self.isLoaded = true
      }
    }
  }

  private func write(_ id: UUID) {
    guard let record = records[id], let revision = revisions[id] else { return }
    pending.insert(id)
    let directory = directory
    writes.async { [weak self] in
      let failure: String?
      do {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(record)
        try data.write(to: directory.appending(path: "\(id.uuidString).json"), options: .atomic)
        failure = nil
      } catch { failure = error.localizedDescription }
      Task { @MainActor [weak self] in
        guard let self else { return }
        self.pending.remove(id)
        if let failure {
          self.failures[id] = failure
          return
        }
        self.failures.removeValue(forKey: id)
        if self.revisions[id] == revision {
          self.dirty.remove(id)
        } else {
          // A pause or exit may have arrived during the write. Drain that newer
          // value now, even if the periodic checkpoint timer has already stopped.
          self.write(id)
        }
      }
    }
  }
}
