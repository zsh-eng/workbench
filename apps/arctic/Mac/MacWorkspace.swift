import AppKit
import OSLog
import Observation

struct MacArticleTab: Identifiable, Equatable, Codable {
  var id: URL { url }
  let url: URL
  var title: String
}

enum MacLibraryFolder: Hashable {
  case saved, favourites, downloaded, history, archive
  case tag(String)
  var title: String {
    switch self {
    case .saved: "Saved"
    case .favourites: "Favourites"
    case .downloaded: "Downloaded"
    case .history: "History"
    case .archive: "Archive"
    case .tag(let tag): tag
    }
  }
  var symbol: String {
    switch self {
    case .saved: "tray"
    case .favourites: "star"
    case .downloaded: "arrow.down.circle"
    case .history: "clock"
    case .archive: "archivebox"
    case .tag: "number"
    }
  }
  func contains(_ article: SavedArticle) -> Bool {
    switch self {
    case .saved: article.saved && article.isArchived != true
    case .favourites: article.saved && article.favourite
    case .downloaded: article.saved && article.downloadedAt != nil
    case .history: article.lastVisitedAt != nil
    case .archive: article.saved && article.isArchived == true
    case .tag(let tag):
      article.saved && article.isArchived != true && article.tagNames.contains(tag)
    }
  }
}

/// Tabs are cheap identities. Only a bounded working set owns WebKit processes.
/// One workspace window owns reading activity; background tabs cannot credit time.
@MainActor @Observable final class MacWorkspace {
  let store: ArticleStore
  let annotations = AnnotationStore.shared
  let readers = MacReaderPool()
  var tabs: [MacArticleTab] = []
  var selectedURL: URL?
  var folder: MacLibraryFolder = .saved
  var search = ""
  var showNotes = false
  var showNotebook = false
  var showStats = false
  private(set) var stats = ReadingStats(sessions: [])
  @ObservationIgnored private var statsTask: Task<Void, Never>?
  var showShortcuts = false
  var showOpen = false
  var showSettings = false
  var showSyncTrial = false
  var showDiagnostics = false
  var error: String?
  var sidebarVisible = true
  var animateSidebar = false
  var windowActive = true { didSet { updateActivity() } }
  @ObservationIgnored private var visitedTabs: Set<URL> = []
  private var lastClosed: [MacArticleTab] = []
  @ObservationIgnored private var prewarmTask: Task<Void, Never>?
  @ObservationIgnored private var hoverTask: Task<Void, Never>?
  @ObservationIgnored private var hoverURL: URL?
  private let tabsKey = "mac.workspace.tabs.v1"

  var selectedTab: MacArticleTab? { tabs.first { $0.url == selectedURL } }
  var selectedReader: MacReader? { selectedURL.flatMap { readers.existing($0) } }
  var selectedArticle: SavedArticle? { selectedURL.flatMap { store.article(for: $0) } }

  convenience init() { self.init(store: ArticleStore()) }

  init(store: ArticleStore) {
    self.store = store
    refreshStats()
    if !TestMode.enabled, let bytes = UserDefaults.standard.data(forKey: tabsKey),
      let restored = try? JSONDecoder().decode([MacArticleTab].self, from: bytes)
    {
      tabs = restored.filter { SharedInbox.webURL($0.url.absoluteString) != nil }
    }
  }

  func toggleSidebar(animated: Bool) {
    animateSidebar = animated
    sidebarVisible.toggle()
  }

  func open(_ url: URL, title: String = "", background: Bool = false) {
    guard SharedInbox.webURL(url.absoluteString) != nil else { return }
    let title = title.isEmpty ? (store.article(for: url)?.title ?? url.host ?? "Article") : title
    if !tabs.contains(where: { $0.url == url }) {
      tabs.append(MacArticleTab(url: url, title: title))
      persistTabs()
    }
    if !background { select(url) }
  }

  func select(_ url: URL) {
    guard tabs.contains(where: { $0.url == url }) else { return }
    selectedReader?.checkpoint()
    ReadingSessions.shared.end()
    selectedURL = url
    showNotebook = false
    showStats = false
    let reader = readers.acquire(url, store: store)
    reader.onLink = { [weak self] url, background in self?.open(url, background: background) }
    reader.onChange = { [weak self] in self?.updateActivity() }
    reader.onQuote = { [weak self] in self?.showNotes = true }
    reader.onShortcuts = { [weak self] in self?.showShortcuts = true }
    reader.onTitle = { [weak self] title in
      guard let self, let index = tabs.firstIndex(where: { $0.url == url }) else { return }
      tabs[index].title = title
      persistTabs()
    }
    // Switching a retained tab does not rewrite the full library index. History
    // records one visit when a tab first becomes visible, and again after reopen.
    if visitedTabs.insert(url).inserted { store.visit(url, title: selectedTab?.title ?? "") }
    reader.start()
    reader.renderAnnotations()
    updateActivity()
    prewarmNeighbors(of: url)
  }

  func library(_ folder: MacLibraryFolder? = nil) {
    selectedReader?.checkpoint()
    ReadingSessions.shared.end()
    selectedURL = nil
    if let folder { self.folder = folder }
    showNotebook = false
    showStats = false
    prewarmTask?.cancel()
  }

  func statistics() {
    library()
    showStats = true
    refreshStats()
  }

  /// Keep the last complete projection visible. Disk reads and aggregation never
  /// sit on the navigation path, including the first visit after launch.
  private func refreshStats() {
    statsTask?.cancel()
    statsTask = Task { [weak self] in
      while !ReadingSessions.shared.isLoaded {
        do { try await Task.sleep(for: .milliseconds(30)) } catch { return }
      }
      let records = ReadingSessions.shared.snapshot()
      let result = await Task.detached(priority: .utility) { ReadingStats(sessions: records) }.value
      guard !Task.isCancelled else { return }
      self?.stats = result
    }
  }

  /// Intent-based loading shares the bounded reader pool. It creates neither a
  /// tab nor a history/reading event. Leaving cancels only a speculative load.
  func hover(_ url: URL, active: Bool) {
    if !active {
      guard hoverURL == url else { return }
      hoverTask?.cancel()
      hoverURL = nil
      if selectedURL != url, !tabs.contains(where: { $0.url == url }),
        let reader = readers.existing(url), !reader.ready
      {
        readers.remove(url)
      }
      return
    }
    if let previous = hoverURL, previous != url { hover(previous, active: false) }
    hoverURL = url
    hoverTask?.cancel()
    hoverTask = Task { [weak self] in
      do { try await Task.sleep(for: .milliseconds(160)) } catch { return }
      guard let self, hoverURL == url, selectedURL != url else { return }
      readers.acquire(url, store: store, protecting: selectedURL).start()
    }
  }

  func close(_ url: URL) {
    guard let index = tabs.firstIndex(where: { $0.url == url }) else { return }
    if selectedURL == url {
      selectedReader?.checkpoint()
      ReadingSessions.shared.end()
    }
    lastClosed.append(tabs.remove(at: index))
    if lastClosed.count > 20 { lastClosed.removeFirst() }
    readers.remove(url)
    visitedTabs.remove(url)
    if selectedURL == url {
      selectedURL = nil
      if !tabs.isEmpty { select(tabs[min(index, tabs.count - 1)].url) }
    }
    persistTabs()
  }

  func reopen() {
    guard let tab = lastClosed.popLast() else { return }
    open(tab.url, title: tab.title)
  }

  func cycle(_ offset: Int) {
    guard !tabs.isEmpty else { return }
    let current = tabs.firstIndex { $0.url == selectedURL } ?? (offset > 0 ? -1 : 0)
    select(tabs[(current + offset + tabs.count) % tabs.count].url)
  }

  func saveCurrent() {
    guard let url = selectedURL else { return }
    do {
      try store.setSaved(true, url: url)
      selectedReader?.persistReader()
      updateActivity()
    } catch { self.error = error.localizedDescription }
  }

  func updateActivity() {
    guard windowActive, !showShortcuts, !showOpen, !showSettings, !showSyncTrial, !showStats, !showNotes,
      let reader = selectedReader, reader.ready, !reader.websiteVisible, !reader.showFind,
      store.article(for: reader.url)?.saved == true
    else {
      ReadingSessions.shared.pause()
      return
    }
    ReadingSessions.shared.begin(url: reader.url)
  }

  func importList() {
    let panel = NSOpenPanel()
    panel.allowedContentTypes = [.html]
    panel.canChooseDirectories = false
    panel.begin { [weak self] result in
      guard result == .OK, let url = panel.url else { return }
      Task { @MainActor in
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do { _ = try await self?.store.importReadingList(from: url) } catch {
          self?.error = error.localizedDescription
        }
      }
    }
  }

  func shutDown() {
    hoverTask?.cancel()
    selectedReader?.checkpoint()
    ReadingSessions.shared.end()
    store.flushPendingWrites()
  }

  private func persistTabs() {
    guard !TestMode.enabled else { return }
    if let data = try? JSONEncoder().encode(tabs) {
      UserDefaults.standard.set(data, forKey: tabsKey)
    }
  }

  private func prewarmNeighbors(of url: URL) {
    prewarmTask?.cancel()
    // Delay speculative construction until the selected article can paint. Only
    // local HTML is prewarmed: opening many tabs never fans out publisher loads.
    prewarmTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(300))
      guard let self, !Task.isCancelled, selectedURL == url,
        let index = tabs.firstIndex(where: { $0.url == url })
      else { return }
      for offset in [1, -1] {
        guard !Task.isCancelled else { return }
        let neighbor = index + offset
        guard tabs.indices.contains(neighbor) else { continue }
        let candidate = tabs[neighbor].url
        guard store.downloadedFile(for: candidate) != nil else { continue }
        readers.acquire(candidate, store: store, protecting: url).start(localOnly: true)
        await Task.yield()
      }
    }
  }
}
