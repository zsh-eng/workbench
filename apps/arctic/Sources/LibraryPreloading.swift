import Observation
import SwiftUI

struct LibraryVisibleRow: Hashable {
  let articleID: UUID
  let folder: ArticleFolder
  let search: Bool
}

/// Visibility changes frequently during a gesture. Only the preload driver reads
/// this state; the library and its row-building closures must not depend on it.
@MainActor @Observable final class LibraryViewportVisibility {
  private(set) var rows: Set<LibraryVisibleRow> = []
  var libraryBounds: CGRect = .zero
  var searchBounds: CGRect = .zero
  func record(_ row: LibraryVisibleRow, visible: Bool) {
    if visible {
      guard !rows.contains(row) else { return }
      rows.insert(row)
    } else {
      remove(row)
    }
  }
  func remove(_ row: LibraryVisibleRow) {
    guard rows.contains(row) else { return }
    rows.remove(row)
  }
}

/// Keyboard safe-area changes affect only these small visibility modifiers.
/// Reading viewport bounds in LibraryView would rebuild all its row closures.
struct LibraryRowVisibility: ViewModifier {
  let row: LibraryVisibleRow
  let active: Bool
  let visibility: LibraryViewportVisibility
  private struct Value: Equatable {
    let row: LibraryVisibleRow
    let visible: Bool
  }

  func body(content: Content) -> some View {
    let viewport = row.search ? visibility.searchBounds : visibility.libraryBounds
    content.onGeometryChange(for: Value.self) { geometry in
      let overlap = geometry.frame(in: .global).intersection(viewport)
      let visible =
        active && !viewport.isEmpty && !overlap.isNull && overlap.width > 1
        && overlap.height > 1
      return Value(row: row, visible: visible)
    } action: { value in
      visibility.record(value.row, visible: value.visible)
    }
    .onChange(of: row) { old, _ in
      // A tag edit can move a retained result into another folder without an
      // appearance event. Retire its old identity even if it stays visible.
      visibility.remove(old)
    }
    .onDisappear { visibility.remove(row) }
  }
}

/// An isolated observation boundary: scrolling updates this small task owner,
/// without rebuilding the NavigationStack, tabs, card buttons or context menus.
struct LibraryPreloadDriver: View {
  let visibility: LibraryViewportVisibility
  let store: ArticleStore
  let browsers: BrowserPool
  let projection: LibraryProjection
  let folder: ArticleFolder
  let query: String
  let sort: String
  var favouritesOnly = false
  let searching: Bool
  let isLibraryScrolling: Bool
  let clipboardURL: URL?
  var resumeURL: URL? = nil
  let enabled: Bool
  @Environment(\.scenePhase) private var scenePhase
  @State private var keyboardIsMoving = false

  var body: some View {
    ZStack(alignment: .bottomLeading) {
      Color.clear.frame(width: 0, height: 0)
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-preloading") {
          VStack(alignment: .leading) {
            Text(preloadURLs.map(\.lastPathComponent).joined(separator: ","))
              .accessibilityIdentifier("preload-requested")
            Text(browsers.readyReaderURLs.map(\.lastPathComponent).joined(separator: ","))
              .accessibilityIdentifier("preload-ready")
            if ProcessInfo.processInfo.arguments.contains("-hold-publisher-image") {
              Text(String(PublisherLoadProbe.shared.started))
                .accessibilityIdentifier("publisher-loads-started")
              // WebKit can retire a handler without a final stop callback.
              // Poll weak owners, rather than treating missing callbacks as leaks.
              TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Text(String(PublisherLoadProbe.shared.active))
                  .accessibilityIdentifier("publisher-loads-active")
              }
            }
            Text(String(browsers.backgroundRetainedCount))
              .accessibilityIdentifier("background-browser-count")
            Text(browsers.lastOpenState)
              .accessibilityIdentifier("reader-open-state")
          }.font(.system(size: 8)).lineLimit(1).padding(4).background(.thinMaterial)
            .allowsHitTesting(false)
        }

      #endif
    }
    .allowsHitTesting(false)
    .onReceive(
      NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)
    ) { _ in
      keyboardIsMoving = true
    }
    .onReceive(
      NotificationCenter.default.publisher(for: UIResponder.keyboardDidChangeFrameNotification)
    ) { _ in
      keyboardIsMoving = false
    }
    .onChange(of: scenePhase) { _, phase in
      if phase != .active { keyboardIsMoving = false }
    }
    .task(id: preloadURLs) { store.prioritizePreviews(preloadURLs) }
    .task(id: imagePrefetchRequests) {
      await ThumbnailCache.shared.preheat(imagePrefetchRequests)
    }
    .task(id: browserPreloadURLs) {
      let urls = browserPreloadURLs
      if !urls.isEmpty {
        do { try await Task.sleep(for: .milliseconds(150)) } catch { return }
      }
      await browsers.preload(urls, store: store)
    }
  }

  /// Preload the rows the user can see, then their nearest two neighbors. Lazy
  /// stack appearance is not visibility: it includes rows outside the viewport.
  private var preloadURLs: [URL] {
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-disable-preloading") {
        return []
      }
    #endif
    guard scenePhase == .active, enabled
    else { return [] }
    let rows = projection.rows(
      articles: store.articles, revision: store.libraryRevision, folder: folder,
      query: searching ? query : "", sort: sort, favouritesOnly: favouritesOnly)
    let articles = rows.articles
    let visibleIndices = visibility.rows.compactMap { row -> Int? in
      guard row.folder == folder, row.search == searching else { return nil }
      return rows.indices[row.articleID]
    }.sorted()
    var urls = visibleIndices.map { articles[$0].url }
    // The paste suggestion has its own URL and may not exist in the library.
    if let copied = clipboardURL, !searching, !urls.contains(copied) { urls.append(copied) }
    for distance in 1...2 {
      for index in visibleIndices {
        for neighbor in [index - distance, index + distance]
        where articles.indices.contains(neighbor) {
          let url = articles[neighbor].url
          if !urls.contains(url) { urls.append(url) }
        }
      }
    }
    return Array(urls.prefix(10))
  }

  // WebView initialization was visible in the physical first-keyboard trace.
  // Keep image/metadata preheating active, but give the keyboard the UI budget.
  private var browserPreloadURLs: [URL] {
    guard enabled, scenePhase == .active, !isLibraryScrolling, !keyboardIsMoving else { return [] }
    // Local documents can warm offline. Uncached publisher pages create script,
    // media and redirect work that competes with launch and visible thumbnails.
    // Open is the explicit intent that starts those websites.
    var urls = preloadURLs.filter { store.downloadedFile(for: $0) != nil }
    // Warm the resume prompt's local document even when its card is offscreen.
    // This does not enqueue a publisher request or metadata refresh.
    if let resumeURL, !searching, store.downloadedFile(for: resumeURL) != nil {
      urls.removeAll { $0 == resumeURL }
      urls.insert(resumeURL, at: 0)
    }
    return Array(urls.prefix(10))
  }

  private var imagePrefetchRequests: [ThumbnailRequest] {
    let rows = projection.rows(
      articles: store.articles, revision: store.libraryRevision, folder: folder,
      query: searching ? query : "", sort: sort, favouritesOnly: favouritesOnly)
    let pixels = searching || folder == .history || folder == .archive ? 256 : 960
    var requests: [ThumbnailRequest] = []
    for url in preloadURLs {
      guard let index = rows.urlIndices[url] else { continue }
      let article = rows.articles[index]
      if let image = article.imageURL {
        requests.append(ThumbnailRequest(url: image, pixels: pixels))
      }
      if let icon = article.faviconURL { requests.append(ThumbnailRequest(url: icon, pixels: 96)) }
    }
    return requests
  }

}

/// SwiftUI reevaluates the library while rows cross the viewport. Reuse sorted
/// projections and ID indexes until domain data or the filter actually changes.
@MainActor final class LibraryProjection {
  struct Rows {
    let articles: [SavedArticle]
    let indices: [UUID: Int]
    let urlIndices: [URL: Int]
  }
  private struct Key: Hashable {
    let folder: ArticleFolder
    let query: String
    let favouritesOnly: Bool
  }
  private var revision = -1
  private var sort = ""
  private var savedOrder: [SavedArticle] = []
  private var historyOrder: [SavedArticle] = []
  private var cache: [Key: Rows] = [:]

  func rows(
    articles: [SavedArticle], revision: Int, folder: ArticleFolder, query: String, sort: String,
    favouritesOnly: Bool = false
  ) -> Rows {
    if self.revision != revision || self.sort != sort {
      self.revision = revision
      self.sort = sort
      cache.removeAll(keepingCapacity: true)
      if sort == "Title" {
        savedOrder = articles.sorted {
          $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
        historyOrder = savedOrder
      } else {
        let oldest = sort == "Oldest first"
        savedOrder = articles.sorted {
          let left = $0.savedAt ?? .distantPast
          let right = $1.savedAt ?? .distantPast
          return oldest ? left < right : left > right
        }
        historyOrder = articles.sorted {
          let left = $0.lastVisitedAt ?? .distantPast
          let right = $1.lastVisitedAt ?? .distantPast
          return oldest ? left < right : left > right
        }
      }
    }
    let key = Key(folder: folder, query: query, favouritesOnly: favouritesOnly)
    if let rows = cache[key] { return rows }
    let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
    let rows = (folder == .history ? historyOrder : savedOrder).filter { article in
      guard folder.contains(article, favouritesOnly: favouritesOnly) else { return false }
      guard !words.isEmpty else { return true }
      let text =
        "\(article.title) \(article.subtitle) \(article.url.absoluteString) \(article.tagNames.joined(separator: " "))"
      return words.allSatisfy { text.localizedStandardContains($0) }
    }
    let result = Rows(
      articles: rows,
      indices: Dictionary(
        uniqueKeysWithValues: rows.enumerated().map { ($0.element.id, $0.offset) }),
      urlIndices: Dictionary(
        rows.enumerated().map { ($0.element.url, $0.offset) },
        uniquingKeysWith: { first, _ in first }))
    if cache.count >= 24 { cache.removeAll(keepingCapacity: true) }
    cache[key] = result
    return result
  }
}
