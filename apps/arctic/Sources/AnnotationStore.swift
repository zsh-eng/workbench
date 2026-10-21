import Foundation
import Observation

/// Text and context survive Reader regeneration. `start` is a UTF-16 hint, not identity.
struct ReaderQuote: Codable, Equatable, Sendable {
  var exact: String
  var prefix: String
  var suffix: String
  var start: Int
}

enum HighlightColour: String, Codable, CaseIterable, Identifiable, Sendable {
  case yellow, sage, rose, blue
  var id: String { rawValue }
  var name: String { rawValue.capitalized }
}

struct ReaderAnnotation: Codable, Identifiable, Equatable, Sendable {
  var id: UUID
  var articleURL: URL
  var quote: ReaderQuote?
  var note: String
  var isHighlighted: Bool
  var createdAt: Date
  var updatedAt: Date
  var deletedAt: Date?
  // Optional on disk so existing passages decode without a migration.
  var colour: HighlightColour?
  var highlightColour: HighlightColour { colour ?? .yellow }
}

/// Small, atomic record files keep note edits independent of library size.
/// Tombstones and stable IDs let sync merge records without reviving deletions.
@MainActor @Observable final class AnnotationStore {
  static let shared = AnnotationStore()
  private(set) var records: [ReaderAnnotation] = []
  private(set) var loadError: String?
  private let directory: URL
  private(set) var pendingNoteIDs: Set<UUID> = []
  private(set) var failedNotes: [UUID: String] = [:]
  @ObservationIgnored private let writes = DispatchQueue(label: "arctic.annotation-writes", qos: .userInitiated)
  /// Called after each edit on this device, so account sync can upload it.
  @ObservationIgnored var edited: (() -> Void)?
  @ObservationIgnored private var merging = false


  init(directory: URL? = nil) {
    self.directory =
      directory
      ?? URL.applicationSupportDirectory.appending(
        path: "ArticleReader/\(TestMode.enabled ? "TestAnnotations" : "Annotations")",
        directoryHint: .isDirectory)
    do {
      if directory == nil, TestMode.enabled,
        ProcessInfo.processInfo.arguments.contains("-reset-store")
      {
        try? FileManager.default.removeItem(at: self.directory)
      }
      try FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
      let files = try FileManager.default.contentsOfDirectory(
        at: self.directory, includingPropertiesForKeys: nil)
      for file in files where file.pathExtension == "json" {
        do {
          records.append(
            try JSONDecoder().decode(ReaderAnnotation.self, from: Data(contentsOf: file)))
        } catch {
          // Keep damaged files, and continue loading the other passages.
          loadError = "A saved passage could not be read. Its file has been kept."
        }
      }
    } catch { loadError = error.localizedDescription }
    #if DEBUG
      if directory == nil { seedNotebookFixture() }
    #endif
  }

  #if DEBUG
    /// In-memory UI fixture only: this measures list rendering/search, not disk
    /// persistence throughput. Real note persistence is tested separately.
    private func seedNotebookFixture() {
      let arguments = ProcessInfo.processInfo.arguments
      guard TestMode.enabled, arguments.contains("-reset-store"),
        let index = arguments.firstIndex(of: "-test-notebook-count"),
        arguments.indices.contains(index + 1), let requested = Int(arguments[index + 1])
      else { return }
      records = (0..<max(0, min(2000, requested))).map { index in
        let date = arguments.contains("-test-notebook-days")
          ? Calendar.current.date(byAdding: .day, value: -(index / 6), to: Calendar.current.startOfDay(for: .now))!.addingTimeInterval(Double(index % 6) * 60)
          : Date(timeIntervalSince1970: Double(1_700_000_000 + index))
        return ReaderAnnotation(
          id: UUID(), articleURL: URL(string: "https://fixture.example/unicode")!,
          quote: index.isMultiple(of: 2)
            ? ReaderQuote(exact: arguments.contains("-test-story-long") ? String(repeating: "Keep a little room for wonder. Read slowly; notice what stays with you. 日本語 — café.\n", count: 8) : "Fixture passage \(index)", prefix: "", suffix: "", start: 0)
            : nil,
          note: "Notebook thought \(index). A complete thought kept with this article.",
          isHighlighted: index.isMultiple(of: 2), createdAt: date, updatedAt: date,
          colour: .yellow)
      }
    }
  #endif

  func annotations(for url: URL) -> [ReaderAnnotation] {
    records.filter { $0.articleURL == url && $0.deletedAt == nil }
      .sorted { ($0.quote?.start ?? Int.max) < ($1.quote?.start ?? Int.max) }
  }

  /// Article notes do not require a text selection. A missing quote is local
  /// metadata only; it never produces a Reader range or an unmatched warning.
  @discardableResult func addNote(_ text: String, in url: URL) throws -> ReaderAnnotation {
    let now = Date()
    let record = ReaderAnnotation(
      id: UUID(), articleURL: url, quote: nil, note: text,
      isHighlighted: false, createdAt: now, updatedAt: now)
    try write(record)
    return record
  }

  /// Publish Send immediately, then persist off the UI thread. All writes use
  /// the same queue so an older pending send cannot overwrite a later edit/delete.
  /// Failed notes remain visible in memory with an explicit Retry action.
  @discardableResult func sendNote(
    _ text: String, in url: URL, annotationID: UUID? = nil,
    quote: ReaderQuote? = nil, colour: HighlightColour = .yellow
  ) -> UUID? {
    var record: ReaderAnnotation
    if let id = annotationID {
      guard
        let existing = records.first(where: {
          $0.id == id && $0.articleURL == url && $0.deletedAt == nil
        })
      else { return nil }
      record = existing
      record.note = text
      record.updatedAt = Date()
    } else {
      let now = Date()
      // A new quoted note creates the quote and text together. Draft creation
      // never leaves an empty highlight behind when the user cancels.
      record = ReaderAnnotation(
        id: UUID(), articleURL: url, quote: quote, note: text,
        isHighlighted: quote != nil, createdAt: now, updatedAt: now,
        colour: quote == nil ? nil : colour)
    }
    publish(record)
    enqueueNote(record)
    return record.id
  }

  func retryNote(_ id: UUID) {
    guard !pendingNoteIDs.contains(id), failedNotes[id] != nil,
      let record = records.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
    enqueueNote(record)
  }

  private func enqueueNote(_ record: ReaderAnnotation) {
    pendingNoteIDs.insert(record.id)
    failedNotes.removeValue(forKey: record.id)
    let directory = directory
    writes.async {
      let result = Result { try Self.saveFile(record, directory: directory) }
      Task { @MainActor in
        // A newer edit, recolour, merge, or deletion owns its own result.
        guard self.records.first(where: { $0.id == record.id }) == record else { return }
        self.pendingNoteIDs.remove(record.id)
        if case .failure(let error) = result {
          self.failedNotes[record.id] = error.localizedDescription
        }
      }
    }
  }

  @discardableResult func highlight(_ quote: ReaderQuote, in url: URL) throws -> ReaderAnnotation {
    if var existing = annotations(for: url).first(where: { $0.quote == quote }) {
      if !existing.isHighlighted {
        existing.isHighlighted = true
        existing.updatedAt = Date()
        try write(existing)
      }
      return existing
    }
    let now = Date()
    let record = ReaderAnnotation(
      id: UUID(), articleURL: url, quote: quote, note: "", isHighlighted: true,
      createdAt: now, updatedAt: now, colour: .yellow)
    try write(record)
    return record
  }

  func recolour(_ id: UUID, colour: HighlightColour) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }),
      record.quote != nil
    else { return }
    guard record.highlightColour != colour || !record.isHighlighted else { return }
    record.colour = colour
    record.isHighlighted = true
    record.updatedAt = Date()
    try write(record)
  }

  func updateNote(_ note: String, id: UUID) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }),
      record.note != note
    else { return }
    record.note = note
    record.updatedAt = Date()
    // An empty draft is still an editable passage. Only an explicit delete can
    // remove its identity, including when editing resumes after an app restart.
    try write(record)
  }

  func deleteNote(_ id: UUID) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
    record.note = ""
    record.updatedAt = Date()
    if !record.isHighlighted { record.deletedAt = record.updatedAt }
    try write(record)
  }

  func removeHighlight(_ id: UUID) throws {
    guard var record = records.first(where: { $0.id == id && $0.deletedAt == nil }) else { return }
    record.isHighlighted = false
    record.updatedAt = Date()
    if record.note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      record.deletedAt = record.updatedAt
    }
    try write(record)
  }

  /// Records from the account. One replaces this device's copy unless that
  /// copy is newer; on a tie the account's wins, so every device settles on it.
  func merge(_ incoming: [ReaderAnnotation]) throws {
    merging = true
    defer { merging = false }
    for record in incoming {
      if let local = records.first(where: { $0.id == record.id }),
        local == record || local.updatedAt > record.updatedAt
      {
        continue
      }
      try write(record)
    }
  }

  private func write(_ record: ReaderAnnotation) throws {
    try writes.sync { try Self.saveFile(record, directory: directory) }
    pendingNoteIDs.remove(record.id)
    failedNotes.removeValue(forKey: record.id)
    publish(record)
  }

  nonisolated private static func saveFile(_ record: ReaderAnnotation, directory: URL) throws {
    let data = try JSONEncoder().encode(record)
    try data.write(to: directory.appending(path: record.id.uuidString + ".json"), options: .atomic)
  }

  private func publish(_ record: ReaderAnnotation) {
    if let index = records.firstIndex(where: { $0.id == record.id }) {
      records[index] = record
    } else {
      records.append(record)
    }
    if !merging { edited?() }
  }
}
