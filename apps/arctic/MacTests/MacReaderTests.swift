import WebKit
import XCTest

@testable import ArcticMac

@MainActor final class MacReaderTests: XCTestCase {
  private var directory: URL!
  private var store: ArticleStore!
  override func setUp() async throws {
    directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    store = ArticleStore(directory: directory)
  }
  override func tearDown() async throws {
    store.flushPendingWrites()
    try? FileManager.default.removeItem(at: directory)
  }
  private func seed(_ index: Int) async throws -> URL {
    let url = URL(string: "https://fixture.example/mac-\(index)")!
    try store.add(
      url.absoluteString,
      preview: ArticlePreview(
        title: "Article \(index)", subtitle: "", taggingText: "Fixture", imageURL: nil,
        faviconURL: nil))
    let paragraphs = (0..<8).map {
      "<p>Passage \($0). The winter light falls across the water. An article stays separate from links opened from its pages.</p>"
    }.joined()
    await store.saveReader(
      "<html><head><meta charset='utf-8'></head><body><main><h1>Article \(index)</h1><article id='reader-content'>\(paragraphs)<a href='https://fixture.example/detour'>Another article</a></article></main></body></html>",
      for: url)
    return url
  }
  private func awaitReady(_ reader: MacReader) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(12))
    while !reader.ready && ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    XCTAssertTrue(reader.ready, reader.error ?? "Reader did not become ready")
  }
  func testPaletteIsPreparedAndReturnWaitsForTheCurrentQuery() async throws {
    let first = try await seed(0)
    let second = try await seed(1)
    let workspace = MacWorkspace(store: store)
    let palette = MacCommandPalette(workspace: workspace)
    XCTAssertEqual(palette.numberOfRows(in: palette.table), 2)
    XCTAssertEqual(palette.table.selectedRow, 0)
    XCTAssertEqual(palette.panel.animationBehavior, .none)
    palette.table.selectRowIndexes([1], byExtendingSelection: false)
    palette.updateIndex(Array(store.articles.reversed()), revision: store.libraryRevision + 1)
    XCTAssertEqual(
      palette.table.selectedRow, 0, "Metadata refresh must preserve the selected article")
    palette.input.stringValue = "Article 0"
    palette.controlTextDidChange(Notification(name: NSControl.textDidChangeNotification))
    _ = palette.control(
      palette.input, textView: NSTextView(), doCommandBy: #selector(NSResponder.insertNewline(_:)))
    let deadline = ContinuousClock.now.advanced(by: .seconds(3))
    while workspace.selectedURL == nil && ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(10))
    }
    XCTAssertEqual(workspace.selectedURL, first)
    XCTAssertNotEqual(workspace.selectedURL, second)
    workspace.close(first)
    workspace.shutDown()
  }

  func testCardMenuArchivesWithUndoAndResolvesCurrentState() async throws {
    let url = try await seed(0)
    let workspace = MacWorkspace(store: store)
    let menu = workspace.articleMenu(for: url)
    let archive = try XCTUnwrap(menu.items.first { $0.title == "Archive" })
    XCTAssertTrue(
      NSApp.sendAction(try XCTUnwrap(archive.action), to: archive.target, from: archive))
    XCTAssertEqual(store.article(for: url)?.isArchived, true)
    XCTAssertNotNil(store.undoReceipt)
    let updated = workspace.articleMenu(for: url)
    XCTAssertTrue(updated.items.contains { $0.title == "Move to Saved" })
    store.undo(try XCTUnwrap(store.undoReceipt).id)
    XCTAssertEqual(store.article(for: url)?.isArchived, false)
    let favourite = try XCTUnwrap(
      workspace.articleMenu(for: url).items.first { $0.title == "Favourite" })
    XCTAssertTrue(
      NSApp.sendAction(try XCTUnwrap(favourite.action), to: favourite.target, from: favourite))
    XCTAssertEqual(store.article(for: url)?.favourite, true)
    workspace.shutDown()
  }

  func testWebKitAcceptsTheSelectedRefreshPreference() throws {
    let preferences = WKPreferences()
    try XCTSkipUnless(
      WKPreferences.responds(to: NSSelectorFromString("_features")),
      "This WebKit has no feature discovery API")
    XCTAssertTrue(
      MacWebRefresh.configure(preferences), "WebKit must read back the requested refresh preference"
    )
  }

  func testWarmSwitchReusesWebViewsAndBoundsPool() async throws {
    let urls = try await [seed(0), seed(1), seed(2), seed(3)]
    let pool = MacReaderPool()
    var first: MacReader? = pool.acquire(urls[0], store: store)
    first!.start()
    try await awaitReady(first!)
    for url in urls[1...2] {
      let reader = pool.acquire(url, store: store)
      reader.start()
      try await awaitReady(reader)
    }
    // A few real WebKit reads prove retained documents still serve the right
    // article. Repeated timing loops belong in the opt-in benchmark below.
    for index in [0, 2, 1, 0] {
      let reader = pool.acquire(urls[index], store: store)
      reader.start()
      let title = try await reader.readerView.evaluateJavaScript(
        "document.querySelector('h1').textContent")
      XCTAssertEqual(title as? String, "Article \(index)")
      XCTAssertEqual(reader.loadCount, 1)
    }
    // Make the first reader least recently used before adding the fourth.
    _ = pool.acquire(urls[1], store: store)
    _ = pool.acquire(urls[2], store: store)
    XCTAssertEqual(pool.count, 3)
    weak var evicted = first
    first = nil
    _ = pool.acquire(urls[3], store: store)
    XCTAssertEqual(pool.count, 3)
    XCTAssertNil(pool.existing(urls[0]))
    // Tasks and JavaScript completion handlers can finish one run-loop later.
    for _ in 0..<50 where evicted != nil { try await Task.sleep(for: .milliseconds(20)) }
    XCTAssertNil(evicted, "The evicted reader must not form a WebKit retain cycle")
    pool.trim()
    XCTAssertEqual(pool.count, 1)
  }
  func testLocalReaderAndLinkIdentity() async throws {
    let url = try await seed(10)
    let originalFile = try XCTUnwrap(store.downloadedFile(for: url))
    let original = try Data(contentsOf: originalFile)
    let reader = MacReader(url: url, store: store)
    reader.start()
    try await awaitReady(reader)
    XCTAssertNil(reader.websiteView, "Saved Reader must not warm a publisher website")
    let linked = expectation(description: "Link opens an independent identity")
    reader.onLink = { destination, _ in
      XCTAssertEqual(destination.absoluteString, "https://fixture.example/detour")
      linked.fulfill()
    }
    _ = try await reader.readerView.evaluateJavaScript("document.querySelector('a').click()")
    await fulfillment(of: [linked], timeout: 3)
    XCTAssertEqual(reader.url, url)
    XCTAssertEqual(try Data(contentsOf: originalFile), original)
    XCTAssertNil(store.article(for: URL(string: "https://fixture.example/detour")!))
    reader.discard()
  }
  func testBackgroundPreparationDoesNotTrackReadingOrVisit() async throws {
    let url = try await seed(20)
    let before = ReadingSessions.shared.snapshot()
    let reader = MacReader(url: url, store: store)
    reader.start(localOnly: true)
    try await awaitReady(reader)
    XCTAssertNil(store.article(for: url)?.lastVisitedAt)
    XCTAssertEqual(ReadingSessions.shared.snapshot(), before)
    reader.discard()
  }
  func testEvictionKeepsDraftAndQuotedContext() async throws {
    let urls = try await [seed(40), seed(41), seed(42), seed(43)]
    let pool = MacReaderPool()
    let first = pool.acquire(urls[0], store: store)
    first.draft = "Keep this unfinished thought"
    first.quotedDraft = ReaderQuote(exact: "winter light", prefix: "", suffix: "", start: 0)
    for url in urls.dropFirst() { _ = pool.acquire(url, store: store) }
    XCTAssertNil(pool.existing(urls[0]))
    let restored = pool.acquire(urls[0], store: store)
    XCTAssertEqual(restored.draft, "Keep this unfinished thought")
    XCTAssertEqual(restored.quotedDraft?.exact, "winter light")
    pool.trim()
  }

  func testColdVersusWarmDocumentPreparation() async throws {
    try XCTSkipUnless(
      ProcessInfo.processInfo.environment["ARCTIC_RUN_BENCHMARKS"] == "1",
      "Opt-in timing diagnostic; not a regression or frame-rate assertion")
    let urls = try await [seed(50), seed(51), seed(52)]
    let pool = MacReaderPool()
    var cold: [Double] = []
    for url in urls {
      let reader = pool.acquire(url, store: store)
      reader.start()
      try await awaitReady(reader)
      cold.append(reader.readyMilliseconds)
    }
    var warm: [Double] = []
    for index in 0..<30 {
      let start = ContinuousClock.now
      let reader = pool.acquire(urls[index % 3], store: store)
      reader.start()
      let title = try await reader.readerView.evaluateJavaScript(
        "document.querySelector('h1').textContent")
      XCTAssertEqual(title as? String, "Article \(50 + index % 3)")
      let duration = start.duration(to: .now).components
      warm.append(Double(duration.seconds) * 1000 + Double(duration.attoseconds) / 1e15)
      XCTAssertEqual(reader.loadCount, 1)
    }
    warm.sort()
    print(
      "MAC_BENCH cold_ready_ms=\(cold); warm_webkit_roundtrip_median_ms=\(warm[15]); p95_ms=\(warm[28])"
    )
    pool.trim()
  }

  func testRelaunchResumesPreviewWithoutTaggingOrAnImportSheet() async throws {
    let base = URL(string: "http://127.0.0.1:8766/one")!
    do { _ = try await URLSession.shared.data(from: base) } catch {
      throw XCTSkip("Start MacTests/replay-server.py for this integration check")
    }
    // This is the durable snapshot immediately after import, before any preview
    // completion. One row also carries an interrupted network failure.
    var first = SavedArticle(url: base, title: "Imported title")
    first.savedAt = Date(timeIntervalSince1970: 1_234_567_890)
    first.importBatchID = UUID()
    var second = SavedArticle(url: URL(string: "http://127.0.0.1:8766/two")!, title: "Second")
    second.previewFailed = true
    // An old library file is copied once, on the first launch of its folder.
    let fresh = directory.appending(path: "relaunch", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: fresh, withIntermediateDirectories: true)
    let path = fresh.appending(path: TestMode.enabled ? "test-links.json" : "links.json")
    try JSONEncoder().encode([first, second]).write(to: path, options: .atomic)
    let restored = ArticleStore(directory: fresh)
    restored.resumePreviews()
    let deadline = ContinuousClock.now.advanced(by: .seconds(8))
    while restored.articles.contains(where: { $0.previewFetchedAt == nil }),
      ContinuousClock.now < deadline
    {
      try await Task.sleep(for: .milliseconds(30))
    }
    XCTAssertTrue(
      restored.articles.allSatisfy {
        $0.imageURL?.lastPathComponent == "cover.svg" && !$0.previewFailed
      })
    XCTAssertEqual(restored.article(for: base)?.savedAt, first.savedAt)
    restored.flushPendingWrites()
    let reopened = ArticleStore(directory: fresh)
    XCTAssertTrue(reopened.articles.allSatisfy { $0.previewFetchedAt != nil && !$0.needsPreview })
  }

  func testFreshExtractionFromLocalReplay() async throws {
    let url = URL(string: "http://127.0.0.1:8766/one")!
    do {
      var request = URLRequest(url: url)
      request.timeoutInterval = 2
      _ = try await URLSession.shared.data(for: request)
    } catch { throw XCTSkip("Start MacTests/replay-server.py for this controlled network check") }
    try store.add(
      url.absoluteString,
      preview: ArticlePreview(
        title: "Local replay", subtitle: "", taggingText: "Fixture", imageURL: nil, faviconURL: nil)
    )
    let reader = MacReader(url: url, store: store)
    reader.start()
    XCTAssertTrue(
      reader.websiteVisible, "A cold article presents the website without waiting for extraction")
    XCTAssertNotNil(reader.websiteView)
    try await awaitReady(reader)
    let title = try await reader.readerView.evaluateJavaScript(
      "document.querySelector('h1').textContent")
    XCTAssertEqual(title as? String, "The shape of a quiet morning")
    XCTAssertNil(reader.websiteView, "Extracted Reader releases its publisher WebView")
    let deadline = ContinuousClock.now.advanced(by: .seconds(4))
    while store.downloadedFile(for: url) == nil && ContinuousClock.now < deadline {
      try await Task.sleep(for: .milliseconds(20))
    }
    XCTAssertNotNil(store.downloadedFile(for: url))
    reader.discard()
  }

}
