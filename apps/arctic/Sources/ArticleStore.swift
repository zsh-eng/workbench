import Foundation
import Observation
import SwiftSoup

#if DEBUG && canImport(UIKit)
  import UIKit
#endif

struct SavedArticle: Identifiable, Codable, Sendable {
  var id = UUID()
  let url: URL
  var title: String
  var subtitle = ""
  var taggingText: String?
  var taggingDescription: String { taggingText ?? subtitle }
  var imageURL: URL?
  var faviconURL: URL?
  var previewFailed = false
  var previewFetchedAt: Date?
  var needsPreview: Bool { previewFetchedAt == nil && imageURL == nil }
  var isRead: Bool?
  var isArchived: Bool?
  var isFavourite: Bool?
  var favouritedAt: Date?
  // Missing isSaved means a link from the original saved-only library.
  var isSaved: Bool?
  var savedAt: Date?
  var lastVisitedAt: Date?
  var tags: [String]?
  var downloadedAt: Date?
  var tagging: ArticleTaggingState?
  var sharedTransferID: UUID?
  var importBatchID: UUID?
  var saved: Bool { isSaved != false }
  var favourite: Bool { isFavourite == true }
  var tagNames: [String] { ArticleTagCatalog.displayNames(tags ?? []) }
}

/// Codable state lives in the same atomic record as the saved link and its tags.
struct ArticleTaggingState: Codable, Sendable {
  var generation = UUID()
  var pendingIdentity: String?
  var completedIdentity: String?
  var automatic: [String] = []
  var manual: [String] = []
  var rejected: [String] = []
  /// A shared save already acknowledged in the extension stays quiet after metadata refresh.
  var sharedFeedbackTransferID: UUID?
}

struct ImportSummary: Identifiable {
  let id = UUID()
  let total: Int
  let duplicates: Int
  var previewsReady = 0
  var previewFailures = 0
  var tagged = 0
  var tagCounts: [String: Int] = [:]
}

/// A receipt for the latest completed action, never a copy of the whole library.
/// A removal keeps only the removed records; their Reader files wait aside until
/// the receipt is dismissed, so Undo also restores the offline copy.
struct UndoReceipt: Identifiable {
  struct Removed {
    let index: Int
    let article: SavedArticle
  }
  enum Action {
    case archive(previous: [UUID: Bool], archived: Bool)
    case remove([Removed])
  }
  let id = UUID()
  let action: Action
  var message: String {
    switch action {
    case .archive(let previous, let archived):
      let count = previous.count
      if archived { return count == 1 ? "Article archived" : "\(count) articles archived" }
      return count == 1 ? "Returned to Saved" : "\(count) articles returned to Saved"
    case .remove(let removed):
      return removed.count == 1 ? "Link removed" : "\(removed.count) links removed"
    }
  }
  var symbol: String {
    switch action {
    case .archive(_, let archived): archived ? "archivebox.fill" : "tray.fill"
    case .remove: "trash.fill"
    }
  }
}

struct TaggingNotice: Identifiable {
  let id = UUID()
  let articleID: UUID
  let title: String
  let tags: [String]
}

/// Metadata is committed atomically. Each downloaded Reader view has a separate
/// file, so listing links never loads article bodies or embedded header images.
@MainActor @Observable final class ArticleStore {
  private(set) var articles: [SavedArticle] = []
  private(set) var libraryRevision = 0
  @ObservationIgnored private var derivedRevision = -1
  @ObservationIgnored private var cachedTags: [String] = []
  @ObservationIgnored private var cachedSavedIDs: [UUID] = []
  var errorMessage: String?
  private(set) var undoReceipt: UndoReceipt?
  private(set) var taggingNotice: TaggingNotice?
  private(set) var importSummary: ImportSummary?
  private var currentImportIDs = Set<UUID>()
  private var persistenceTask: Task<Void, Never>?
  private var importTaggedIDs = Set<UUID>()
  private var importPreparedIDs = Set<UUID>()
  @ObservationIgnored private var previewQueue: [URL] = []
  @ObservationIgnored private var previewWorkers: [URL: Task<Void, Never>] = [:]
  @ObservationIgnored private var pendingPreviews: [UUID: Result<ArticlePreview, Error>] = [:]
  @ObservationIgnored private var previewCommitTask: Task<Void, Never>?
  @ObservationIgnored private var priorityPreviewURLs: [URL] = []
  @ObservationIgnored private var libraryScrolling = false
  @ObservationIgnored private var previewArticleIDs: [URL: UUID] = [:]
  #if DEBUG
    @ObservationIgnored private(set) var previewPublicationCount = 0
    @ObservationIgnored private(set) var previewPublicationsDuringScrolling = 0
    @ObservationIgnored private(set) var previewPeakBuffered = 0
    @ObservationIgnored private(set) var previewPeakWorkers = 0
    @ObservationIgnored private(set) var previewScrollSessions = 0
  #endif
  var isImportWorking: Bool {
    guard let summary = importSummary else { return false }
    if summary.previewsReady < summary.total,
      !previewQueue.isEmpty || !previewWorkers.isEmpty || !pendingPreviews.isEmpty
    {
      return true
    }
    return taggingTask != nil && summary.tagged < summary.total - summary.previewFailures
  }
  private var taggingTask: Task<Void, Never>?
  private var taggingDeferred = Set<UUID>()
  private var retaggingContextNeeded = Set<UUID>()
  private var taggingWaitingForForeground = false
  private var fixtureTaggingFailed = false
  private var fixtureTaggingContinuations: [CheckedContinuation<Void, Never>] = []
  // Preview requests are memory-only. Save reuses the same request and remains
  // the only point that can persist a link or its automatic tags.
  private struct PreparedTagging {
    let id = UUID()
    let task: Task<[String], Error>
  }
  private var preparedTagging: [String: PreparedTagging] = [:]
  private var preparedOrder: [String] = []
  private var speculativeRequests = 0
  #if DEBUG
    private(set) var taggingRequestCount = 0
    private(set) var preparedTaggingCount = 0
  #endif
  var isTagging: Bool { taggingTask != nil || speculativeRequests > 0 }
  var isFixtureTaggingHeld: Bool { !fixtureTaggingContinuations.isEmpty }

  /// UI tests release an in-flight response only after the edit under test.
  func finishFixtureTagging() {
    guard fixtureTagging else { return }
    let continuations = fixtureTaggingContinuations
    fixtureTaggingContinuations.removeAll()
    for continuation in continuations { continuation.resume() }
  }
  private let fileURL: URL
  private let downloads: URL
  /// Reader files of removed links, kept only while their Undo is offered.
  private let removedDownloads: URL

  init(directory: URL? = nil) {
    let directory =
      directory
      ?? URL.applicationSupportDirectory.appending(
        path: "ArticleReader", directoryHint: .isDirectory)
    fileURL = directory.appending(path: TestMode.enabled ? "test-links.json" : "links.json")
    downloads = directory.appending(path: TestMode.enabled ? "TestDownloads" : "Downloads")
    removedDownloads = directory.appending(
      path: TestMode.enabled ? "TestRemovedDownloads" : "RemovedDownloads")
    // An Undo receipt does not survive relaunch, so neither do the files it held.
    if FileManager.default.fileExists(atPath: removedDownloads.path) {
      try? FileManager.default.removeItem(at: removedDownloads)
    }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-store") {
        try? FileManager.default.removeItem(at: fileURL)
        try? FileManager.default.removeItem(at: downloads)
        #if DEBUG
          try TestMode.resetSharedFixtures()
        #endif
      }
      if FileManager.default.fileExists(atPath: fileURL.path) {
        articles = try JSONDecoder().decode([SavedArticle].self, from: Data(contentsOf: fileURL))
      }
      try FileManager.default.createDirectory(at: downloads, withIntermediateDirectories: true)
      #if DEBUG && canImport(UIKit)
        if TestMode.enabled, ProcessInfo.processInfo.arguments.contains("-test-story-image"), articles.isEmpty {
          // Exercise the real article metadata and thumbnail path using bundled bytes.
          let photoURL = downloads.appending(path: "story-photo.jpg")
          guard let photo = UIImage(named: "OnboardingArticle")?.jpegData(compressionQuality: 0.9)
          else { throw CocoaError(.fileReadCorruptFile) }
          try photo.write(to: photoURL, options: .atomic)
          var article = SavedArticle(url: URL(string: "https://fixture.example/unicode")!, title: "A practice of attention")
          article.imageURL = photoURL
          article.taggingText = "A complete local article preview for the image sharing fixture."
          article.previewFetchedAt = Date()
          articles = [article]
          try JSONEncoder().encode(articles).write(to: fileURL, options: .atomic)
        }
      #endif
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-seed-preload-fixtures"),
          articles.isEmpty
        {
          let css = try String(
            contentsOf: Bundle.main.url(forResource: "reader", withExtension: "css")!,
            encoding: .utf8)
          for index in 0..<12 {
            let title = String(format: "Cached story %02d", index)
            var article = SavedArticle(
              url: URL(string: "https://fixture.example/cached-\(index)")!, title: title)
            article.savedAt = Date(timeIntervalSince1970: Double(12 - index))
            article.downloadedAt = Date()
            article.tags = index.isMultiple(of: 2) ? ["Even"] : ["Odd"]
            // Intentionally represents a legacy UTF-8 download without a charset.
            let html =
              "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'><style>\(css)</style></head><body><main><header><h1>\(title)</h1></header><article id='reader-content'><p>“Slow down,” she said — café, naïve, 日本語. Keep every character intact.</p></article></main></body></html>"
            try Data(html.utf8).write(to: downloadFile(article.id))
            articles.append(article)
          }
          try JSONEncoder().encode(articles).write(to: fileURL, options: .atomic)
        }
      #endif
      #if DEBUG
        if TestMode.enabled,
          ProcessInfo.processInfo.arguments.contains("-seed-long-list")
            || ProcessInfo.processInfo.arguments.contains("-seed-photo-list"),
          articles.isEmpty
        {
          let anchors = (0..<1000).map { index in
            "<a href='https://fixture.example/import-\(index)' add_date='\(1_700_000_000 + index)'>Imported story \(String(format: "%04d", index))</a>"
          }.joined()
          articles = try ReadingListImport.parse("<html><body>\(anchors)</body></html>")
          #if canImport(UIKit)
            if ProcessInfo.processInfo.arguments.contains("-seed-photo-list") {
              // One bundled photograph, 1000 distinct cache identities. Query
              // components preserve file reads without copying or decoding 1000
              // photos during setup. Each test launch gets fresh cache keys.
              let photoURL = downloads.appending(path: "scroll-photo.jpg")
              guard
                let photo = UIImage(named: "OnboardingArticle")?.jpegData(compressionQuality: 0.95)
              else { throw CocoaError(.fileReadCorruptFile) }
              try photo.write(to: photoURL, options: .atomic)
              let run = UUID().uuidString
              for index in articles.indices {
                articles[index].imageURL = photoURL.appending(queryItems: [
                  URLQueryItem(name: "run", value: run),
                  URLQueryItem(name: "article", value: String(index)),
                ])
                articles[index].subtitle = "A cached photograph from the Arctic onboarding fixture."
                articles[index].taggingText = articles[index].subtitle
              }
            }
          #endif
          try JSONEncoder().encode(articles).write(to: fileURL, options: .atomic)
        }
      #endif
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-store"),
          ProcessInfo.processInfo.arguments.contains("-test-shared-tags")
        {
          let url = URL(string: "https://fixture.example/story")!
          let presented = ProcessInfo.processInfo.arguments.contains("-test-shared-tags-presented")
          let transfer = try SharedInbox.save(url, title: presented ? "A title from Safari" : nil)
          if presented {
            try SharedInbox.saveTaggingResult(
              SharedTaggingResult(
                id: transfer.id, url: url, title: "A title from Safari", subtitle: nil,
                tagNames: ["Learning & writing"],
                inputFingerprint: ArticleTagCatalog.identity(
                  title: "A title from Safari", description: ""),
                categoryVersion: ArticleTagCatalog.version, feedbackPresented: true))
          }
        }
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-stage-import") {
          let fixture = Bundle.main.url(
            forResource: "Reading List", withExtension: "html", subdirectory: "Fixtures")!
          let documents = URL.documentsDirectory
          try FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
          try Data(contentsOf: fixture).write(
            to: documents.appending(path: "Reading List.html"), options: .atomic)
        }
      #endif
    } catch { errorMessage = "Could not read saved links: \(error.localizedDescription)" }
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-import-replay"),
        articles.isEmpty
      {
        // Replay real import and publication paths without Files or publishers.
        Task { [weak self] in
          guard let self else { return }
          let file = self.downloads.appending(path: "import-replay.html")
          let html = (0..<460).map { index in
            "<a href='https://fixture.example/import-\(index)' ADD_DATE='\(1_700_000_000 + index)'>Imported story \(index)</a>"
          }.joined(separator: "\n")
          do {
            try Data(html.utf8).write(to: file, options: .atomic)
            _ = try await self.importReadingList(from: file)
          } catch { self.errorMessage = error.localizedDescription }
        }
      }
    #endif
  }

  func add(_ text: String, preview: ArticlePreview? = nil) throws {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let candidate = trimmed.contains("://") ? trimmed : "https://" + trimmed
    guard let url = URL(string: candidate),
      ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
      let host = url.host, host.contains("."), !trimmed.contains(where: \.isWhitespace)
    else {
      throw ArticleError.message("Enter a complete website link, such as example.com/article.")
    }
    if let index = articles.firstIndex(where: { $0.url == url }) {
      var updated = articles
      updated[index].isSaved = true
      updated[index].isArchived = false
      updated[index].savedAt = Date()
      preview?.apply(to: &updated[index])
      try commit(updated)
      scheduleTagging()
      return
    }
    var article = SavedArticle(url: url, title: host)
    preview?.apply(to: &article)
    article.isSaved = true
    article.savedAt = Date()
    var updated = articles
    updated.insert(article, at: 0)
    try commit(updated)
    scheduleTagging()
    if preview == nil { Task { await refreshPreview(article, reload: false) } }
  }

  var allTags: [String] {
    updateLibraryDerivedValues()
    return cachedTags
  }

  var savedArticleIDs: [UUID] {
    updateLibraryDerivedValues()
    return cachedSavedIDs
  }

  /// Geometry updates do not change these values. Compute their projection once
  /// per committed revision instead of scanning a long list on every body pass.
  private func updateLibraryDerivedValues() {
    guard derivedRevision != libraryRevision else { return }
    var tags = Set<String>()
    var ids: [UUID] = []
    for article in articles where article.saved {
      ids.append(article.id)
      tags.formUnion(article.tagNames)
    }
    cachedTags = tags.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    cachedSavedIDs = ids
    derivedRevision = libraryRevision
  }

  /// Unsave keeps history, tags and the cached Reader copy. Removing the link
  /// is the separate operation that deletes its stored content.
  func setSaved(_ saved: Bool, url: URL) throws {
    if saved {
      try add(url.absoluteString)
      return
    }
    guard let index = articles.firstIndex(where: { $0.url == url }) else { return }
    var updated = articles
    updated[index].isSaved = false
    updated[index].isFavourite = false
    updated[index].isArchived = false
    updated[index].savedAt = nil
    updated[index].sharedTransferID = nil
    updated[index].tagging?.generation = UUID()
    try commit(updated)
  }

  /// Favourites are library state, independent from tags and archive membership.
  func setFavourite(_ favourite: Bool, for id: UUID) {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }),
      articles[index].favourite != favourite
    else { return }
    var updated = articles
    updated[index].isFavourite = favourite
    updated[index].favouritedAt = favourite ? Date() : nil
    do { try commit(updated) } catch { errorMessage = error.localizedDescription }
  }

  func archive(_ id: UUID) throws {
    try setArchived(true, ids: [id])
  }

  /// Undo restores only archive membership. New metadata, notes and tags survive.
  func setArchived(_ archived: Bool, ids: Set<UUID>) throws {
    let changed = articles.filter {
      ids.contains($0.id) && $0.saved && ($0.isArchived == true) != archived
    }
    guard !changed.isEmpty else { return }
    let previous = Dictionary(uniqueKeysWithValues: changed.map { ($0.id, $0.isArchived == true) })
    var updated = articles
    for index in updated.indices where previous[updated[index].id] != nil {
      updated[index].isArchived = archived
    }
    try commit(updated)
    present(UndoReceipt(action: .archive(previous: previous, archived: archived)))
  }

  /// Removal is durable at once. Annotations, positions and reading sessions are
  /// keyed by URL and stay; the Reader file waits aside while Undo is offered.
  func remove(_ ids: Set<UUID>) {
    let removed = articles.enumerated().filter { ids.contains($0.element.id) }
      .map { UndoReceipt.Removed(index: $0.offset, article: $0.element) }
    guard !removed.isEmpty else { return }
    try? FileManager.default.createDirectory(
      at: removedDownloads, withIntermediateDirectories: true)
    for item in removed {
      try? FileManager.default.moveItem(
        at: downloadFile(item.article.id), to: removedFile(item.article.id))
    }
    do {
      try commit(articles.filter { !ids.contains($0.id) })
      present(UndoReceipt(action: .remove(removed)))
    } catch {
      for item in removed {
        try? FileManager.default.moveItem(
          at: removedFile(item.article.id), to: downloadFile(item.article.id))
      }
      errorMessage = error.localizedDescription
    }
  }

  func undo(_ id: UUID) {
    guard let receipt = undoReceipt, receipt.id == id else { return }
    var updated = articles
    var restored: [UUID] = []
    switch receipt.action {
    case .archive(let previous, let archived):
      for index in updated.indices {
        guard let wasArchived = previous[updated[index].id], updated[index].saved,
          (updated[index].isArchived == true) == archived
        else { continue }
        updated[index].isArchived = wasArchived
      }
    case .remove(let removed):
      // A link saved again in the meantime keeps its new record.
      for item in removed {
        let article = item.article
        guard !updated.contains(where: { $0.id == article.id || $0.url == article.url })
        else { continue }
        updated.insert(article, at: min(item.index, updated.count))
        restored.append(item.article.id)
      }
    }
    do {
      try commit(updated)
      for articleID in restored {
        try? FileManager.default.moveItem(
          at: removedFile(articleID), to: downloadFile(articleID))
      }
      dismissUndo(id)
      if !restored.isEmpty { scheduleTagging() }
    } catch { errorMessage = error.localizedDescription }
  }

  func dismissUndo(_ id: UUID) {
    guard let receipt = undoReceipt, receipt.id == id else { return }
    undoReceipt = nil
    release(receipt)
  }

  private func present(_ receipt: UndoReceipt) {
    if let previous = undoReceipt { release(previous) }
    undoReceipt = receipt
  }

  /// Delete the Reader files a removal receipt held, off the main actor.
  private func release(_ receipt: UndoReceipt) {
    guard case .remove(let removed) = receipt.action else { return }
    let files = removed.map { removedFile($0.article.id) }
    Task.detached(priority: .utility) {
      for file in files { try? FileManager.default.removeItem(at: file) }
    }
  }

  /// Called by the visible Reader only. Speculative browsers never write history.
  func visit(_ url: URL, title: String = "") {
    guard ["http", "https"].contains(url.scheme ?? "") else { return }
    var updated = articles
    if let index = updated.firstIndex(where: { $0.url == url }) {
      updated[index].lastVisitedAt = Date()
      updated[index].isRead = true
      if !title.isEmpty { updated[index].title = title }
    } else {
      var article = SavedArticle(url: url, title: title.isEmpty ? (url.host ?? "Article") : title)
      article.isSaved = false
      article.isRead = true
      article.lastVisitedAt = Date()
      updated.insert(article, at: 0)
    }
    do {
      try commit(updated)
      if let article = updated.first(where: { $0.url == url }), article.imageURL == nil {
        Task { await refreshPreview(article, reload: false) }
      }
    } catch { errorMessage = error.localizedDescription }
  }

  func setTags(_ tags: [String], for id: UUID) {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }) else { return }
    var updated = articles
    let chosen = Set(ArticleTagCatalog.displayNames(tags))
    var state = updated[index].tagging ?? ArticleTaggingState()
    state.rejected = Array(
      Set(ArticleTagCatalog.displayNames(state.rejected)).union(
        Set(updated[index].tagNames).subtracting(chosen)
      ).subtracting(
        chosen)
    ).sorted()
    state.manual = Array(chosen).sorted()
    updated[index].tagging = state
    updated[index].tags = Array(chosen).sorted()
    do { try commit(updated) } catch { errorMessage = error.localizedDescription }
  }

  func update(_ ids: Set<UUID>, read: Bool? = nil, archived: Bool? = nil) {
    do {
      if let archived, read == nil {
        try setArchived(archived, ids: ids)
        return
      }
      let updated = articles.map { article -> SavedArticle in
        guard ids.contains(article.id) else { return article }
        var result = article
        if let read { result.isRead = read }
        if let archived, result.saved { result.isArchived = archived }
        return result
      }
      try commit(updated)
    } catch { errorMessage = error.localizedDescription }
  }

  /// Save and tag completion are separate immutable extension events. Import all
  /// saves first; completion can arrive on a later foreground without reviving a
  /// link the user removed or unsaved in the meantime.
  func importSharedLinks() {
    do {
      let files = try FileManager.default.contentsOfDirectory(
        at: SharedInbox.directory(), includingPropertiesForKeys: nil)
      for file in files where file.pathExtension == "json" {
        let transfer = try SharedInbox.decodeTransfer(
          from: Data(contentsOf: file),
          fileID: UUID(uuidString: file.deletingPathExtension().lastPathComponent) ?? UUID())
        if TestMode.enabled && transfer.url.host != "fixture.example" { continue }
        var updated = articles
        let index: Int
        if let existing = updated.firstIndex(where: { $0.url == transfer.url }) {
          index = existing
        } else {
          updated.insert(
            SavedArticle(url: transfer.url, title: transfer.url.host ?? "Article"), at: 0)
          index = 0
        }
        updated[index].isSaved = true
        updated[index].isArchived = false
        updated[index].savedAt = Date()
        updated[index].sharedTransferID = transfer.id
        if let title = transfer.title, updated[index].title == transfer.url.host {
          updated[index].title = title
        }
        if let subtitle = transfer.subtitle, updated[index].subtitle.isEmpty {
          updated[index].subtitle = subtitle
        }
        if updated[index].taggingText == nil, let text = transfer.taggingText {
          updated[index].taggingText = text
        }
        try commit(updated)
        let article = updated[index]
        Task { await refreshPreview(article) }
        try FileManager.default.removeItem(at: file)
      }
      let results = try FileManager.default.contentsOfDirectory(
        at: SharedInbox.taggingResultsDirectory(), includingPropertiesForKeys: nil)
      for file in results where file.pathExtension == "json" {
        let result = try JSONDecoder().decode(
          SharedTaggingResult.self, from: Data(contentsOf: file))
        if TestMode.enabled && result.url.host != "fixture.example" { continue }
        if let index = articles.firstIndex(where: {
          $0.sharedTransferID == result.id && $0.url == result.url && $0.saved
        }) {
          var updated = articles
          if updated[index].title == result.url.host { updated[index].title = result.title }
          if updated[index].subtitle.isEmpty { updated[index].subtitle = result.subtitle ?? "" }
          if updated[index].taggingText == nil, let text = result.taggingText {
            updated[index].taggingText = text
          }
          var state = updated[index].tagging ?? ArticleTaggingState()
          if result.feedbackPresented == true {
            state.sharedFeedbackTransferID = result.id
          }
          updated[index].tagging = state
          try commit(updated)
          let identity = ArticleTagCatalog.identity(
            title: updated[index].title, description: updated[index].taggingDescription)
          // Keep a newer main-app result, but retain the extension's receipt even
          // when Safari and the fetched page supplied different metadata.
          if taggingAllowed, result.categoryVersion == ArticleTagCatalog.version,
            state.completedIdentity != identity
          {
            let knownTags = Set(ArticleTagCatalog.all.map(\.name))
            try mergeTags(
              ArticleTagCatalog.displayNames(result.tagNames).filter { knownTags.contains($0) },
              at: index,
              identity: result.inputFingerprint)
          }
          if result.feedbackPresented == true,
            taggingNotice?.articleID == updated[index].id
          {
            taggingNotice = nil
          }
        }
        try FileManager.default.removeItem(at: file)
      }
      resumeTagging()
    } catch { errorMessage = "Could not import shared links: \(error.localizedDescription)" }
  }

  func remove(_ article: SavedArticle) {
    remove([article.id])
  }

  func downloadedFile(for url: URL) -> URL? {
    guard
      let article = articles.first(where: { $0.url == url && $0.saved && $0.downloadedAt != nil })
    else { return nil }
    let file = downloadFile(article.id)
    return FileManager.default.fileExists(atPath: file.path) ? file : nil
  }

  /// Write bytes before advertising a download. Recheck identity after the disk
  /// write so deleting a link during extraction cannot recreate that record.
  func saveReader(_ html: String, for url: URL) async {
    guard !Task.isCancelled,
      let article = articles.first(where: { $0.url == url && $0.saved })
    else { return }
    let file = downloadFile(article.id)
    do {
      let context = try await Task.detached {
        try Data(html.utf8).write(to: file, options: .atomic)
        guard !ArticleMetadata.containsExcerpt(article.taggingDescription) else {
          return Optional<String>.none
        }
        return try? ArticleMetadata.taggingContext(
          fromHTML: html, title: article.title, description: article.subtitle)
      }.value
      guard !Task.isCancelled else { return }
      guard let index = articles.firstIndex(where: { $0.id == article.id && $0.saved }) else {
        try? FileManager.default.removeItem(at: file)
        return
      }
      var updated = articles
      updated[index].downloadedAt = Date()
      if let context, ArticleMetadata.containsExcerpt(context) {
        updated[index].taggingText = context
      }
      try commit(updated)
      scheduleTagging()
    } catch { errorMessage = "Could not store Reader view: \(error.localizedDescription)" }
  }

  private func downloadFile(_ id: UUID) -> URL { downloads.appending(path: "\(id).html") }
  private func removedFile(_ id: UUID) -> URL { removedDownloads.appending(path: "\(id).html") }

  /// Import is one local transaction. Network work starts after the new list is
  /// visible, with at most three metadata requests and no eager image downloads.
  func importReadingList(from url: URL) async throws -> String {
    let granted = url.startAccessingSecurityScopedResource()
    defer { if granted { url.stopAccessingSecurityScopedResource() } }
    let entries = try await Task.detached {
      let data = try Data(contentsOf: url)
      guard let html = String(data: data, encoding: .utf8) else {
        throw ArticleError.message("Choose the HTML reading-list file from your Chrome export.")
      }
      return try ReadingListImport.parse(html)
    }.value
    let merged = ReadingListImport.merge(entries, into: articles)
    guard !merged.added.isEmpty else { return "All \(entries.count) links are already saved." }
    try commit(merged.articles)
    currentImportIDs = Set(merged.added.map(\.id))
    importPreparedIDs = Set(
      merged.added.filter {
        $0.taggingText != nil || $0.previewFailed
      }.map(\.id))
    let completed = merged.added.filter {
      $0.tagging?.completedIdentity
        == ArticleTagCatalog.identity(
          title: $0.title, description: $0.taggingDescription)
    }
    importTaggedIDs = Set(completed.map(\.id))
    var summary = ImportSummary(total: merged.added.count, duplicates: merged.duplicates)
    summary.previewsReady = importPreparedIDs.count
    summary.previewFailures = merged.added.filter(\.previewFailed).count
    summary.tagged = completed.count
    for article in completed {
      for tag in article.tagNames { summary.tagCounts[tag, default: 0] += 1 }
    }
    importSummary = summary
    let newestFirst = merged.added.enumerated().sorted {
      let lhs = $0.element.savedAt ?? .distantPast
      let rhs = $1.element.savedAt ?? .distantPast
      return lhs == rhs ? $0.offset < $1.offset : lhs > rhs
    }.map(\.element.url)
    enqueuePreviews(newestFirst)
    scheduleTagging()
    return "Added \(merged.added.count) \(merged.added.count == 1 ? "link" : "links")."
      + (merged.duplicates > 0
        ? " Skipped \(merged.duplicates) \(merged.duplicates == 1 ? "duplicate" : "duplicates")."
        : "")
  }

  func dismissImportSummary() { importSummary = nil }

  /// The library supplies visible rows followed by nearby rows. Reprioritizing
  /// queued metadata never cancels useful requests already in flight.
  func prioritizePreviews(_ urls: [URL]) {
    priorityPreviewURLs = urls
    enqueuePreviews(urls)
  }

  /// Automatic metadata waits for a settled viewport. User saves remain durable
  /// and foreground/background flushing bypasses this pause.
  func setLibraryScrolling(_ scrolling: Bool) {
    guard libraryScrolling != scrolling else { return }
    libraryScrolling = scrolling
    if scrolling {
      #if DEBUG
        previewScrollSessions += 1
      #endif
      previewCommitTask?.cancel()
      previewCommitTask = nil
      return
    }
    flushPreviews()
    persistPendingChanges()
    startPreviewWorkers()
    scheduleTagging()
  }

  private func enqueuePreviews(_ urls: [URL]) {
    previewArticleIDs = Dictionary(
      articles.filter {
        ($0.needsPreview || $0.taggingText == nil) && !$0.previewFailed
          && pendingPreviews[$0.id] == nil
      }.map { ($0.url, $0.id) }, uniquingKeysWith: { first, _ in first })
    let eligible = Set(previewArticleIDs.keys)
    var seen = Set<URL>()
    previewQueue = (priorityPreviewURLs + urls + previewQueue).filter {
      eligible.contains($0) && previewWorkers[$0] == nil && seen.insert($0).inserted
    }
    startPreviewWorkers()
  }

  private func startPreviewWorkers() {
    // Six origins can make progress without serializing the whole import. Keep
    // one publisher at the previous three-request limit, and cap buffered work
    // while scrolling so a long gesture cannot accumulate an unbounded batch.
    while previewWorkers.count < 6, pendingPreviews.count + previewWorkers.count < 48 {
      let hosts = Dictionary(grouping: previewWorkers.keys, by: { $0.host ?? "" })
      guard let next = previewQueue.firstIndex(where: { (hosts[$0.host ?? ""]?.count ?? 0) < 3 })
      else { break }
      let url = previewQueue.remove(at: next)
      guard let articleID = previewArticleIDs[url] else { continue }
      previewWorkers[url] = Task(priority: .utility) { [weak self] in
        let result: Result<ArticlePreview, Error>
        do { result = .success(try await ArticlePreviewCache.shared.load(url)) } catch {
          result = .failure(error)
        }
        guard let self else { return }
        self.pendingPreviews[articleID] = result
        #if DEBUG
          self.previewPeakBuffered = max(self.previewPeakBuffered, self.pendingPreviews.count)
        #endif
        self.previewWorkers[url] = nil
        self.startPreviewWorkers()
        self.schedulePreviewCommit()
      }
      #if DEBUG
        previewPeakWorkers = max(previewPeakWorkers, previewWorkers.count)
      #endif
    }
  }

  private func schedulePreviewCommit() {
    guard !libraryScrolling, previewCommitTask == nil, !pendingPreviews.isEmpty else { return }
    let visibleIDs = Set(priorityPreviewURLs.compactMap { previewArticleIDs[$0] })
    let hasVisibleResult = pendingPreviews.keys.contains { visibleIDs.contains($0) }
    let delay = hasVisibleResult ? 120 : 600
    previewCommitTask = Task { [weak self] in
      // Show the first visible metadata promptly; amortize background imports.
      do { try await Task.sleep(for: .milliseconds(delay)) } catch { return }
      guard let self else { return }
      self.previewCommitTask = nil
      self.flushPreviews(automatic: true)
      self.startPreviewWorkers()
    }
  }

  private func flushPreviews(automatic: Bool = false) {
    let results = pendingPreviews
    pendingPreviews.removeAll()
    guard !results.isEmpty else { return }
    #if DEBUG
      previewPublicationCount += 1
      if automatic && libraryScrolling { previewPublicationsDuringScrolling += 1 }
    #endif
    var updated = articles
    for index in updated.indices {
      guard let result = results[updated[index].id] else { continue }
      switch result {
      case .success(let preview): preview.apply(to: &updated[index])
      case .failure:
        updated[index].previewFailed = true
        if currentImportIDs.contains(updated[index].id),
          !importPreparedIDs.contains(updated[index].id)
        {
          importSummary?.previewFailures += 1
        }
      }
      if currentImportIDs.contains(updated[index].id) {
        importPreparedIDs.insert(updated[index].id)
      }
    }
    do {
      try commit(updated, deferred: true)
      importSummary?.previewsReady = importPreparedIDs.count
      scheduleTagging()
    } catch { errorMessage = "Could not save preview metadata: \(error.localizedDescription)" }
  }

  func refreshPreview(_ article: SavedArticle, reload: Bool = true) async {
    do {
      let preview = try await ArticlePreviewCache.shared.load(article.url, reload: reload)
      guard let index = articles.firstIndex(where: { $0.id == article.id }) else { return }
      var updated = articles
      preview.apply(to: &updated[index])
      try commit(updated)
      scheduleTagging()
    } catch {
      guard let index = articles.firstIndex(where: { $0.id == article.id }) else { return }
      var updated = articles
      updated[index].previewFailed = true
      do {
        try commit(updated)
        scheduleTagging()
      } catch {
        errorMessage = "Could not save preview metadata: \(error.localizedDescription)"
      }
    }
  }

  /// Foreground recovery retries pending saved articles once per activation.
  /// Title/description identity also records an empty result, avoiding repeated calls.
  func resumeTagging() {
    taggingDeferred.removeAll()
    taggingWaitingForForeground = false
    resumePreviews()
    scheduleTagging()
  }

  func resumePreviews() {
    // Preview completion belongs to the saved article, not the ephemeral import
    // sheet or Jev. Rebuild unfinished work after launch/foreground recovery.
    var updated = articles
    var resetFailures = false
    for index in updated.indices
    where updated[index].saved && updated[index].needsPreview && updated[index].previewFailed {
      updated[index].previewFailed = false
      resetFailures = true
    }
    if resetFailures {
      do { try commit(updated) } catch { errorMessage = error.localizedDescription }
    }
    enqueuePreviews(
      articles.filter {
        $0.saved && ($0.needsPreview || $0.taggingText == nil)
          && !retaggingContextNeeded.contains($0.id)
      }.sorted { ($0.savedAt ?? .distantPast) > ($1.savedAt ?? .distantPast) }.map(\.url))
  }

  func retagSavedArticles() {
    preparedTagging.removeAll()
    preparedOrder.removeAll()
    var updated = articles
    for index in updated.indices where updated[index].saved {
      var state = updated[index].tagging ?? ArticleTaggingState()
      state.completedIdentity = nil
      state.sharedFeedbackTransferID = nil
      state.generation = UUID()
      updated[index].tagging = state
      // Explicit retagging refreshes old description-only context. Keep existing
      // displayed tags until the replacement classification succeeds.
      updated[index].taggingText = nil
      retaggingContextNeeded.insert(updated[index].id)
    }
    do {
      try commit(updated)
      resumeTagging()
    } catch { errorMessage = error.localizedDescription }
  }

  func dismissTaggingNotice() { taggingNotice = nil }

  private var fixtureTagging: Bool {
    TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-tagging")
  }

  private var taggingAllowed: Bool {
    if TestMode.enabled { return fixtureTagging }
    return TaggingPreferences.enabled && !TaggingPreferences.credentialFailure
  }

  /// Start once metadata is ready, before Save. Dismissal can discard the UI
  /// without writing a link; an eventual Save can still reuse this bounded work.
  func prepareTagging(url: URL, preview: ArticlePreview) {
    guard taggingAllowed, !articles.contains(where: { $0.url == url && $0.saved }) else { return }
    let revision = TestMode.enabled ? "" : TaggingPreferences.credentialRevision
    speculativeRequests += 1
    Task { [weak self] in
      guard let self else { return }
      defer { self.speculativeRequests -= 1 }
      do {
        _ = try await self.requestTags(
          title: preview.title, description: preview.taggingText, credentialRevision: revision)
      } catch {
        guard self.taggingAllowed,
          TestMode.enabled || revision == TaggingPreferences.credentialRevision
        else { return }
        if !TestMode.enabled, case JevError.invalidKey = error {
          TaggingPreferences.credentialFailure = true
        }
        if !TestMode.enabled { TaggingPreferences.lastError = error.localizedDescription }
      }
    }
  }

  private func requestTags(title: String, description: String, credentialRevision: String)
    async throws -> [String]
  {
    let identity = ArticleTagCatalog.identity(title: title, description: description)
    let key = credentialRevision + ":" + identity
    if let entry = preparedTagging[key] { return try await entry.task.value }
    let task = Task<[String], Error> {
      guard self.taggingAllowed,
        TestMode.enabled || credentialRevision == TaggingPreferences.credentialRevision
      else { throw CancellationError() }
      #if DEBUG
        self.taggingRequestCount += 1
      #endif
      if self.fixtureTagging {
        // Exercise the same shared request and durable result path without a key.
        if ProcessInfo.processInfo.arguments.contains("-test-tagging-held") {
          await withCheckedContinuation { self.fixtureTaggingContinuations.append($0) }
        }
        if ProcessInfo.processInfo.arguments.contains("-test-tagging-delayed") {
          try await Task.sleep(for: .seconds(5))
        }
        if ProcessInfo.processInfo.arguments.contains("-test-tagging-failure")
          && !self.fixtureTaggingFailed
        {
          self.fixtureTaggingFailed = true
          throw URLError(.notConnectedToInternet)
        }
        await Task.yield()
        return ["Engineering", "Craft"]
      }
      guard let apiKey = try JevKeychain.read() else {
        throw ArticleError.message("Add your Jev API key in Settings to start tagging.")
      }
      return try await JevClient.classify(title: title, description: description, apiKey: apiKey)
    }
    let entry = PreparedTagging(task: task)
    preparedTagging[key] = entry
    preparedOrder.append(key)
    if preparedOrder.count > 8 { preparedTagging[preparedOrder.removeFirst()] = nil }
    do {
      let tags = try await task.value
      guard taggingAllowed,
        TestMode.enabled || credentialRevision == TaggingPreferences.credentialRevision
      else {
        throw CancellationError()
      }
      #if DEBUG
        preparedTaggingCount += 1
      #endif
      return tags
    } catch {
      if preparedTagging[key]?.id == entry.id {
        preparedTagging[key] = nil
        preparedOrder.removeAll { $0 == key }
      }
      throw error
    }
  }

  private func scheduleTagging() {
    guard taggingAllowed, !libraryScrolling, !taggingWaitingForForeground, taggingTask == nil else {
      return
    }
    taggingTask = Task { [weak self] in
      guard let self else { return }
      defer { self.taggingTask = nil }
      while self.taggingAllowed, !self.libraryScrolling, var article = self.nextTaggingArticle() {
        let credentialRevision = TestMode.enabled ? "" : TaggingPreferences.credentialRevision
        do {
          // Even an imported title is not enough context. A Save that beats the
          // preview joins its fetch before submitting anything to Jev.
          if article.taggingText == nil {
            let cachedContext = await self.cachedReaderContext(for: article)
            let preview: ArticlePreview?
            if cachedContext == nil {
              preview = try await ArticlePreviewCache.shared.load(
                article.url, reload: self.retaggingContextNeeded.contains(article.id))
            } else {
              preview = nil
            }
            guard !Task.isCancelled else { return }
            guard let index = self.articles.firstIndex(where: { $0.id == article.id && $0.saved })
            else { continue }
            var updated = self.articles
            if let cachedContext { updated[index].taggingText = cachedContext }
            if let preview { preview.apply(to: &updated[index]) }
            try self.commit(updated)
            self.retaggingContextNeeded.remove(article.id)
            article = updated[index]
          }
          guard self.taggingAllowed else { return }
          if !TestMode.enabled && credentialRevision != TaggingPreferences.credentialRevision {
            continue
          }
          var state = article.tagging ?? ArticleTaggingState()
          let identity = ArticleTagCatalog.identity(
            title: article.title, description: article.taggingDescription)
          let generation = state.generation
          state.pendingIdentity = identity
          guard let index = self.articles.firstIndex(where: { $0.id == article.id }) else {
            continue
          }
          var updated = self.articles
          updated[index].tagging = state
          try self.commit(updated, deferred: article.importBatchID != nil)
          let tags = try await self.requestTags(
            title: article.title, description: article.taggingDescription,
            credentialRevision: credentialRevision)
          guard self.taggingAllowed else { return }
          if !TestMode.enabled && credentialRevision != TaggingPreferences.credentialRevision {
            continue
          }
          try self.applyTags(tags, to: article.id, identity: identity, generation: generation)
        } catch {
          guard !Task.isCancelled else { return }
          if !TestMode.enabled && credentialRevision != TaggingPreferences.credentialRevision {
            continue
          }
          self.taggingDeferred.insert(article.id)
          self.taggingWaitingForForeground = true
          if !TestMode.enabled, case JevError.invalidKey = error {
            TaggingPreferences.credentialFailure = true
          }
          if !self.fixtureTagging { TaggingPreferences.lastError = error.localizedDescription }
          // Do not drain a library into an unavailable service. Foreground resumes it.
          return
        }
      }
    }
  }

  /// Explicit retagging can use an offline Reader copy without fetching the site.
  /// Read only a bounded prefix and parse on a worker; missing prose falls back to metadata.
  private func cachedReaderContext(for article: SavedArticle) async -> String? {
    guard article.downloadedAt != nil else { return nil }
    let file = downloadFile(article.id)
    return await Task.detached(priority: .utility) {
      guard !Task.isCancelled,
        let handle = try? FileHandle(forReadingFrom: file)
      else { return nil }
      defer { try? handle.close() }
      guard let data = try? handle.read(upToCount: ArticleMetadata.maximumHTMLBytes),
        let text = try? ArticleMetadata.taggingContext(
          fromHTML: String(decoding: data, as: UTF8.self),
          title: article.title, description: article.subtitle),
        ArticleMetadata.containsExcerpt(text)
      else { return nil }
      return text
    }.value
  }

  private func nextTaggingArticle() -> SavedArticle? {
    articles.first { article in
      guard article.saved, !taggingDeferred.contains(article.id),
        article.importBatchID == nil || article.taggingText != nil
          || retaggingContextNeeded.contains(article.id)
      else { return false }
      return article.tagging?.completedIdentity
        != ArticleTagCatalog.identity(
          title: article.title, description: article.taggingDescription)
    }
  }

  /// Merge onto the current article, not the request snapshot: manual changes
  /// during an in-flight request must win. Ignore deleted, unsaved or stale work.
  private func applyTags(_ tags: [String], to id: UUID, identity: String, generation: UUID) throws {
    guard let index = articles.firstIndex(where: { $0.id == id && $0.saved }),
      articles[index].tagging?.generation == generation,
      identity
        == ArticleTagCatalog.identity(
          title: articles[index].title, description: articles[index].taggingDescription)
    else { return }
    try mergeTags(tags, at: index, identity: identity)
  }

  /// Shared results can use an earlier metadata identity. Retain that identity so
  /// the queue can improve the tags, while the durable receipt prevents a repeat prompt.
  private func mergeTags(_ tags: [String], at index: Int, identity: String) throws {
    var updated = articles
    var state = updated[index].tagging ?? ArticleTaggingState()
    let existing = Set(updated[index].tagNames)
    let manual = Set(ArticleTagCatalog.displayNames(state.manual))
      .union(existing.subtracting(ArticleTagCatalog.displayNames(state.automatic)))
    let accepted = Set(ArticleTagCatalog.displayNames(tags))
      .subtracting(ArticleTagCatalog.displayNames(state.rejected))
    let result = manual.union(accepted)
    state.automatic = Array(accepted).sorted()
    state.manual = Array(manual).sorted()
    state.completedIdentity = identity
    state.pendingIdentity = nil
    updated[index].tagging = state
    updated[index].tags = Array(result).sorted()
    try commit(updated, deferred: updated[index].importBatchID != nil)
    if !TestMode.enabled { TaggingPreferences.lastError = nil }
    let added = Array(result.subtracting(existing)).sorted()
    let presentedInExtension =
      updated[index].sharedTransferID != nil
      && state.sharedFeedbackTransferID == updated[index].sharedTransferID
    if updated[index].importBatchID != nil {
      if currentImportIDs.contains(updated[index].id),
        importTaggedIDs.insert(updated[index].id).inserted
      {
        importSummary?.tagged = importTaggedIDs.count
        for tag in result { importSummary?.tagCounts[tag, default: 0] += 1 }
      }
    } else if !added.isEmpty && !presentedInExtension {
      taggingNotice = TaggingNotice(
        articleID: updated[index].id, title: updated[index].title, tags: added)
    }
  }

  /// User actions remain durable before returning. Regenerable metadata and
  /// import tags share one short trailing write; any user action flushes them too.
  private func commit(_ updated: [SavedArticle], deferred: Bool = false) throws {
    if !deferred {
      try JSONEncoder().encode(updated).write(to: fileURL, options: .atomic)
      persistenceTask?.cancel()
      persistenceTask = nil
    } else if persistenceTask == nil {
      persistenceTask = Task { [weak self] in
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
        guard self?.libraryScrolling == false else { return }
        self?.persistPendingChanges()
      }
    }
    // Deferred commits only add preview/tag metadata; they cannot remove rows.
    let removed = deferred ? Set<UUID>() : Set(articles.map(\.id)).subtracting(updated.map(\.id))
    articles = updated
    libraryRevision += 1
    if let notice = taggingNotice,
      !updated.contains(where: { $0.id == notice.articleID && $0.saved })
    {
      taggingNotice = nil
    }
    for id in removed { try? FileManager.default.removeItem(at: downloadFile(id)) }
  }

  /// Flush when leaving the foreground so a suspended app has no pending batch.
  func flushPendingWrites() {
    previewCommitTask?.cancel()
    previewCommitTask = nil
    flushPreviews()
    persistPendingChanges()
  }

  // The trailing disk write must not force an early metadata publication.
  // Foreground exit explicitly flushes both; the timer only persists published rows.
  private func persistPendingChanges() {
    guard persistenceTask != nil else { return }
    persistenceTask?.cancel()
    persistenceTask = nil
    do { try JSONEncoder().encode(articles).write(to: fileURL, options: .atomic) } catch {
      errorMessage = "Could not save article changes: \(error.localizedDescription)"
    }
  }

}

enum ReadingListImport {
  static func parse(_ html: String) throws -> [SavedArticle] {
    let document = try SwiftSoup.parse(html)
    let entries = try document.select("a[href]").compactMap { anchor -> SavedArticle? in
      let href = try anchor.attr("href").trimmingCharacters(in: .whitespacesAndNewlines)
      guard let url = URL(string: href),
        ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
        let host = url.host, host.contains(".")
      else { return nil }
      let title = try anchor.text().trimmingCharacters(in: .whitespacesAndNewlines)
      var article = SavedArticle(url: url, title: title.isEmpty ? host : title)
      let timestamp = try anchor.attr("add_date")
      if let seconds = Double(timestamp), seconds.isFinite, seconds > 0 {
        article.savedAt = Date(timeIntervalSince1970: seconds)
      }
      return article
    }
    guard !entries.isEmpty else {
      throw ArticleError.message(
        "No article links were found. Choose Chrome’s Reading List.html file, after unzipping the export."
      )
    }
    return entries
  }

  /// A URL index makes merging linear in the list size. Existing saved dates
  /// win; newly saved items use Chrome's date, with import time only as fallback.
  static func merge(_ entries: [SavedArticle], into existing: [SavedArticle], now: Date = Date())
    -> (articles: [SavedArticle], added: [SavedArticle], duplicates: Int)
  {
    var updated = existing
    var indices: [URL: Int] = [:]
    for (index, article) in existing.enumerated() { indices[article.url] = index }
    var inserted: [SavedArticle] = []
    var added: [SavedArticle] = []
    var seen = Set<URL>()
    let batchID = UUID()
    for entry in entries {
      guard seen.insert(entry.url).inserted else { continue }
      if let index = indices[entry.url] {
        guard !updated[index].saved else { continue }
        updated[index].isSaved = true
        updated[index].isArchived = false
        updated[index].importBatchID = batchID
        updated[index].savedAt = entry.savedAt ?? now
        added.append(updated[index])
      } else {
        var article = entry
        article.isSaved = true
        article.importBatchID = batchID
        article.savedAt = article.savedAt ?? now
        inserted.append(article)
        added.append(article)
      }
    }
    return (inserted + updated, added, entries.count - added.count)
  }

}

enum ArticleError: LocalizedError {
  case message(String)
  var errorDescription: String? {
    switch self {
    case .message(let text): text
    }
  }
}

/// Paste, save and speculative loading share one metadata request. The cache is
/// small and process-local; saved metadata and image bytes remain durable.
actor ArticlePreviewCache {
  static let shared = ArticlePreviewCache()
  private var previews: [URL: ArticlePreview] = [:]
  private var pending: [URL: Task<ArticlePreview, Error>] = [:]

  func load(_ url: URL, reload: Bool = false) async throws -> ArticlePreview {
    if let task = pending[url] { return try await task.value }
    if !reload, let preview = previews[url] { return preview }
    let task = Task { try await ArticlePreview.fetch(url) }
    pending[url] = task
    defer { pending[url] = nil }
    let preview = try await task.value
    if previews.count >= 32, let first = previews.keys.first { previews[first] = nil }
    previews[url] = preview
    return preview
  }
}

struct ArticlePreview: Sendable {
  let title: String
  let subtitle: String
  let taggingText: String
  let imageURL: URL?
  let faviconURL: URL?

  func apply(to article: inout SavedArticle) {
    article.title = title
    article.subtitle = subtitle
    // A publisher preview without prose must not discard an extracted Reader introduction.
    if ArticleMetadata.containsExcerpt(taggingText)
      || !ArticleMetadata.containsExcerpt(article.taggingDescription)
    {
      article.taggingText = taggingText
    }
    article.imageURL = imageURL
    article.faviconURL = faviconURL
    article.previewFailed = false
    article.previewFetchedAt = Date()
  }

  static func fetch(_ url: URL) async throws -> Self {
    let metadata: ArticleMetadata
    if let fixture = TestMode.fixture(for: url) {
      #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-test-import-replay") {
          let index = Int(url.lastPathComponent.replacingOccurrences(of: "import-", with: "")) ?? 0
          try await Task.sleep(for: .milliseconds(90 + (index % 5) * 10))
        }
      #endif
      let html = try String(contentsOf: fixture, encoding: .utf8)
      metadata = try await ArticleMetadata.parseOffMain(html, baseURL: fixture)
    } else {
      metadata = try await ArticleMetadata.fetch(url, timeout: 20)
    }
    return Self(
      title: metadata.title, subtitle: metadata.description, taggingText: metadata.taggingText,
      imageURL: metadata.imageURL, faviconURL: metadata.faviconURL)
  }
}

enum TestMode {
  #if DEBUG
    /// Failed share tests must not leave a saved fixture for the next test. Never
    /// remove real shared links or results from the simulator's App Group.
    static func resetSharedFixtures() throws {
      #if os(iOS)
        for directory in [try SharedInbox.directory(), try SharedInbox.taggingResultsDirectory()] {
          let files = try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil)
          for file in files where file.pathExtension == "json" {
            let data = try Data(contentsOf: file)
            let transfer = try? SharedInbox.decodeTransfer(from: data)
            let result = try? JSONDecoder().decode(SharedTaggingResult.self, from: data)
            if (transfer?.url ?? result?.url)?.host == "fixture.example" {
              try FileManager.default.removeItem(at: file)
            }
          }
        }
      #endif
    }
  #endif
  static var enabled: Bool {
    #if DEBUG
      ProcessInfo.processInfo.arguments.contains("-ui-testing")
        || ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    #else
      false
    #endif
  }
  static func fixture(for url: URL) -> URL? {
    if enabled, url.host == "www.ft.com",
      ProcessInfo.processInfo.environment["TEST_PUBLISHER_ORIGIN"] != nil
    {
      return Bundle.main.url(forResource: "next", withExtension: "html", subdirectory: "Fixtures")
    }
    guard enabled, url.host == "fixture.example" else { return nil }
    let name = url.lastPathComponent
    return Bundle.main.url(
      forResource: ["frame", "next", "short", "long", "unicode", "icon", "passages"].contains(name)
        ? name : "story",
      withExtension: "html",
      subdirectory: "Fixtures")
  }
}
