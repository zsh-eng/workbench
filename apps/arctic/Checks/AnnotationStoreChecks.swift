// swiftc Sources/AnnotationStore.swift Checks/AnnotationStoreChecks.swift -o /tmp/arctic-annotations-check
import Foundation

enum TestMode { static let enabled = false }

@main struct AnnotationStoreChecks {
  @MainActor static func main() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = URL(string: "https://fixture.example/article")!
    let quote = ReaderQuote(
      exact: "“Keep this” — 日本語", prefix: "Before ", suffix: " after", start: 7)
    let store = AnnotationStore(directory: directory)
    let annotation = try store.highlight(quote, in: url)
    precondition(annotation.highlightColour == .yellow)
    var legacyJSON =
      try JSONSerialization.jsonObject(with: JSONEncoder().encode(annotation)) as! [String: Any]
    legacyJSON.removeValue(forKey: "colour")
    let legacy = try JSONDecoder().decode(
      ReaderAnnotation.self, from: JSONSerialization.data(withJSONObject: legacyJSON))
    precondition(legacy.highlightColour == .yellow)
    try store.recolour(annotation.id, colour: .rose)
    try store.updateNote("A thought to keep", id: annotation.id)
    let restored = AnnotationStore(directory: directory)
    precondition(restored.annotations(for: url).first?.highlightColour == .rose)
    precondition(restored.annotations(for: url).first?.note == "A thought to keep")
    precondition(restored.annotations(for: url).first?.quote == quote)
    let repeated = try restored.highlight(quote, in: url)
    precondition(repeated.id == annotation.id)
    try restored.removeHighlight(annotation.id)
    precondition(restored.annotations(for: url).first?.note == "A thought to keep")
    precondition(restored.annotations(for: url).first?.isHighlighted == false)
    try restored.updateNote("", id: annotation.id)
    precondition(restored.annotations(for: url).first?.id == annotation.id)
    let emptyDraft = AnnotationStore(directory: directory)
    precondition(emptyDraft.annotations(for: url).first?.note == "")
    try emptyDraft.updateNote("Replacement thought", id: annotation.id)
    let replacement = AnnotationStore(directory: directory)
    precondition(replacement.annotations(for: url).first?.note == "Replacement thought")
    precondition(replacement.annotations(for: url).first?.id == annotation.id)
    try replacement.deleteNote(annotation.id)
    precondition(replacement.annotations(for: url).isEmpty)
    let deleted = AnnotationStore(directory: directory)
    precondition(deleted.records.first?.deletedAt != nil)
    try deleted.merge([annotation])
    precondition(deleted.annotations(for: url).isEmpty)
    // Deleting a note on a highlighted passage keeps its highlight.
    let highlighted = try deleted.highlight(quote, in: url)
    try deleted.updateNote("Temporary note", id: highlighted.id)
    try deleted.deleteNote(highlighted.id)
    precondition(deleted.annotations(for: url).first?.isHighlighted == true)
    precondition(deleted.annotations(for: url).first?.note == "")
    try deleted.removeHighlight(highlighted.id)
    precondition(deleted.annotations(for: url).isEmpty)
    // Empty note-only drafts can also be explicitly removed.
    let draft = try deleted.highlight(quote, in: url)
    try deleted.updateNote("A draft", id: draft.id)
    try deleted.removeHighlight(draft.id)
    try deleted.updateNote("", id: draft.id)
    try deleted.deleteNote(draft.id)
    precondition(deleted.annotations(for: url).isEmpty)
    // Standalone notes have no quote, paint, or migration requirement.
    let standalone = try deleted.addNote("An article-level thought.", in: url)
    precondition(standalone.quote == nil && !standalone.isHighlighted)
    let noteRestored = AnnotationStore(directory: directory)
    precondition(noteRestored.annotations(for: url).first?.note == "An article-level thought.")
    precondition(noteRestored.annotations(for: url).first?.quote == nil)
    try noteRestored.recolour(standalone.id, colour: .rose)
    precondition(noteRestored.annotations(for: url).first?.isHighlighted == false)
    try noteRestored.updateNote("Revised only on explicit Save.", id: standalone.id)
    let noteEdited = AnnotationStore(directory: directory)
    precondition(noteEdited.annotations(for: url).first?.note == "Revised only on explicit Save.")
    try noteEdited.deleteNote(standalone.id)
    precondition(noteEdited.annotations(for: url).isEmpty)
    try Data("bad json".utf8).write(to: directory.appending(path: "broken.json"))
    let partial = AnnotationStore(directory: directory)
    precondition(partial.records.count == 4)
    precondition(partial.loadError != nil)
    // Send publishes before its completion callback; disk work never delays UI.
    let sending = AnnotationStore(directory: directory.appending(path: "sending"))
    let sent = sending.sendNote("Immediate thought", in: url)!
    precondition(sending.annotations(for: url).first?.note == "Immediate thought")
    precondition(sending.pendingNoteIDs.contains(sent))
    try await finishWrites(sending)
    precondition(AnnotationStore(directory: directory.appending(path: "sending")).records.first?.note == "Immediate thought")
    let editedID = sending.sendNote("Old value", in: url)!
    try sending.updateNote("Newest edit", id: editedID)
    let removedID = sending.sendNote("Remove before completion", in: url)!
    try sending.deleteNote(removedID)
    try await finishWrites(sending)
    let ordered = AnnotationStore(directory: directory.appending(path: "sending"))
    precondition(ordered.records.first(where: { $0.id == editedID })?.note == "Newest edit")
    precondition(ordered.records.first(where: { $0.id == removedID })?.deletedAt != nil)
    // Quoted drafts publish their quote and note in one record only at Send.
    let quotedID = sending.sendNote(
      "Thought with a staged quote", in: url, quote: quote, colour: .sage)!
    precondition(sending.annotations(for: url).first(where: { $0.id == quotedID })?.quote == quote)
    precondition(
      sending.annotations(for: url).first(where: { $0.id == quotedID })?.isHighlighted == true)
    let otherURL = URL(string: "https://fixture.example/linked-article")!
    precondition(sending.sendNote("Wrong article", in: otherURL, annotationID: quotedID) == nil)
    try await finishWrites(sending)
    let quoted = AnnotationStore(directory: directory.appending(path: "sending"))
      .annotations(for: url).first(where: { $0.id == quotedID })!
    precondition(quoted.note == "Thought with a staged quote" && quoted.highlightColour == .sage)
    // A failed write retains the text, exposes Retry, then persists the same ID.
    let failedDirectory = directory.appending(path: "failure")
    let failing = AnnotationStore(directory: failedDirectory)
    try FileManager.default.removeItem(at: failedDirectory)
    try Data("Not a directory".utf8).write(to: failedDirectory)
    let failedID = failing.sendNote("Do not lose this thought", in: url)!
    try await finishWrites(failing)
    precondition(failing.failedNotes[failedID] != nil)
    precondition(failing.annotations(for: url).first?.note == "Do not lose this thought")
    try FileManager.default.removeItem(at: failedDirectory)
    try FileManager.default.createDirectory(at: failedDirectory, withIntermediateDirectories: true)
    failing.retryNote(failedID)
    try await finishWrites(failing)
    precondition(failing.failedNotes.isEmpty)
    precondition(AnnotationStore(directory: failedDirectory).records.first?.id == failedID)
    print("Optimistic notes: immediate publication, async persistence, ordered edits/deletes, retained failure and retry passed")

    // Account sync: the record is byte for byte what Arctic for the web writes
    // (Browser/src/annotations.ts). A merge takes the later edit, the account's
    // copy on a tie, and is not an edit on this device.
    let id = UUID(uuidString: "0F3A3B5E-6C1D-4E2A-9B7C-1D2E3F405162")!
    let web = ReaderAnnotation(
      id: id, articleURL: URL(string: "https://example.com/ice?a=1")!,
      quote: ReaderQuote(exact: "Sea ice", prefix: "", suffix: " forms", start: 12), note: "",
      isHighlighted: true, createdAt: Date(timeIntervalSinceReferenceDate: 782_000_000.5),
      updatedAt: Date(timeIntervalSinceReferenceDate: 782_000_100.25), colour: .sage)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    let encoded = String(decoding: try encoder.encode(web), as: UTF8.self)
    precondition(
      encoded
        == #"{"articleURL":"https://example.com/ice?a=1","colour":"sage","createdAt":782000000.5,"id":"0F3A3B5E-6C1D-4E2A-9B7C-1D2E3F405162","isHighlighted":true,"note":"","quote":{"exact":"Sea ice","prefix":"","start":12,"suffix":" forms"},"updatedAt":782000100.25}"#
    )
    var edits = 0
    let synced = AnnotationStore(directory: directory.appending(path: "synced"))
    synced.edited = { edits += 1 }
    try synced.merge([web])
    precondition(synced.records == [web] && edits == 0)
    var tie = web
    tie.note = "The same moment, on another device"
    try synced.merge([tie])
    precondition(synced.records.first?.note == tie.note)
    var older = web
    older.note = "An older edit"
    older.updatedAt = web.updatedAt.addingTimeInterval(-1)
    try synced.merge([older])
    precondition(synced.records.first?.note == tie.note && edits == 0)
    try synced.recolour(id, colour: .blue)
    precondition(edits == 1)
    print("Account records: web encoding, later edit wins, tie takes the account's copy, merges are not edits passed")
    print(
      "Annotation storage: reopen, legacy yellow, persisted colour, Unicode, deduplication, note preservation, clear-and-retype after restart, explicit deletion, stale merge, damaged-record isolation passed"
    )
  }

  @MainActor private static func finishWrites(_ store: AnnotationStore) async throws {
    let deadline = Date().addingTimeInterval(5)
    while !store.pendingNoteIDs.isEmpty && Date() < deadline {
      try await Task.sleep(for: .milliseconds(5))
    }
    precondition(store.pendingNoteIDs.isEmpty, "Annotation writes did not finish")
  }
}
