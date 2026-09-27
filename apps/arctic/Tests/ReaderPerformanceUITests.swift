import Network
import XCTest

final class ReaderPerformanceUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testPublisherShortcutReturnsHomeAfterSavingReaderAndUnsaving() throws {
    let ready = expectation(description: "Local publisher replay is listening")
    let replay = try PublisherReplay(ready: ready)
    defer { replay.stop() }
    wait(for: [ready], timeout: 5)
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-disable-preloading",
    ]
    app.launchEnvironment["TEST_PUBLISHER_ORIGIN"] = replay.origin
    app.launch()
    let shortcut = app.buttons["publisher-www.ft.com"]
    XCTAssertTrue(shortcut.waitForExistence(timeout: 10), app.debugDescription)
    revealPublishersIfNeeded(app, shortcut: shortcut)
    shortcut.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher homepage"].waitForExistence(timeout: 10))
    app.webViews.buttons["Read publisher article"].tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher article"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["browser-back"].isEnabled)
    let bookmark = app.buttons["reader-save"]
    bookmark.tap()
    XCTAssertEqual(bookmark.value as? String, "Saved")
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["Publisher article"].waitForExistence(timeout: 5))
    bookmark.tap()
    XCTAssertEqual(bookmark.value as? String, "Not saved")
    // Leave directly from the extracted article: the shortcut starts at home.
    app.navigationBars.buttons.element(boundBy: 0).tap()
    revealPublishersIfNeeded(app, shortcut: shortcut)
    shortcut.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher homepage"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-toggle"].label, "Reader")
    app.webViews.buttons["Read publisher article"].tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher article"].waitForExistence(timeout: 5))
    XCTAssertEqual(bookmark.value as? String, "Not saved")
    showReader(app)
    app.buttons["browser-back"].tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher homepage"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-toggle"].label, "Reader")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    revealPublishersIfNeeded(app, shortcut: shortcut)
    shortcut.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher homepage"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-toggle"].label, "Reader")
    // An old homepage extraction must not override the publisher shortcut either.
    showReader(app)
    bookmark.tap()
    bookmark.tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    revealPublishersIfNeeded(app, shortcut: shortcut)
    shortcut.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher homepage"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-toggle"].label, "Reader")
    app.terminate()
    app.launchArguments = ["-ui-testing", "-disable-preloading"]
    app.launch()
    revealPublishersIfNeeded(app, shortcut: shortcut)
    shortcut.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher homepage"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-toggle"].label, "Reader")
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    capture(app, "publisher-home-after-unsaved-reader-and-relaunch")
  }

  @MainActor private func revealPublishersIfNeeded(_ app: XCUIApplication, shortcut: XCUIElement) {
    if app.staticTexts["discovery-collapse"].label.hasPrefix("100;") {
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.45))
      start.press(forDuration: 0.05,
        thenDragTo: start.withOffset(CGVector(dx: 0, dy: 200)),
        withVelocity: .slow, thenHoldForDuration: 0.2)
      expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: shortcut)
      waitForExpectations(timeout: 5)
    }
  }

  @MainActor func testFailedWebsiteRetriesWithoutRestart() {
    let app = openRecoverableFailure()
    let retry = app.buttons["reader-retry"]
    XCTAssertTrue(retry.waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertFalse(app.buttons["reader-toggle"].isEnabled)
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    capture(app, "failed-website-retry")
    retry.tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 5))
    XCTAssertFalse(retry.exists)
    capture(app, "website-recovered-without-restart")
  }

  @MainActor func testReopeningFailedPooledWebsiteRetriesItsRequest() {
    let app = openRecoverableFailure()
    XCTAssertTrue(app.buttons["reader-retry"].waitForExistence(timeout: 10))
    app.buttons["reader-save"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5), app.debugDescription)
    card.tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["reader-retry"].exists)
  }

  @MainActor func testPublisherFailureKeepsDownloadedReaderVisible() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
      "-disable-preloading", "-test-website-recovery",
    ]
    app.launch()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    let text = app.webViews.staticTexts[
      "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."]
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    app.buttons["reader-toggle"].tap()
    let retry = app.buttons["reader-retry"]
    XCTAssertTrue(retry.waitForExistence(timeout: 10))
    XCTAssertTrue(text.exists)
    XCTAssertEqual(app.buttons["reader-toggle"].label, "Website")
    capture(app, "downloaded-reader-survives-publisher-failure")
    retry.tap()
    let website = expectation(
      for: NSPredicate(format: "label == 'Reader'"), evaluatedWith: app.buttons["reader-toggle"])
    wait(for: [website], timeout: 10)
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    XCTAssertFalse(retry.exists)
  }

  @MainActor func testCachedReaderLinkHistoryNeverReplacesSavedArticle() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-disable-preloading"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    showReader(app)
    let bookmark = app.buttons["reader-save"]
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    app.terminate()
    app.launchArguments = ["-ui-testing", "-disable-preloading"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 10))
    app.buttons["article-story"].tap()
    showReader(app)
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    let link = app.webViews.links["Read the next story"]
    for _ in 0..<6 { if link.isHittable { break }; app.webViews.firstMatch.swipeUp() }
    XCTAssertTrue(link.isHittable)
    link.tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 10))
    XCTAssertEqual(bookmark.value as? String, "Not saved")
    XCTAssertTrue(app.buttons["browser-back"].isEnabled)
    showReader(app)
    app.buttons["Page options"].tap()
    app.buttons["reader-refresh"].tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 10))
    app.buttons["browser-back"].tap()
    showReader(app)
    XCTAssertEqual(bookmark.value as? String, "Saved")
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertTrue(app.buttons["browser-forward"].isEnabled)
    app.buttons["browser-forward"].tap()
    showReader(app)
    XCTAssertEqual(bookmark.value as? String, "Not saved")
    XCTAssertTrue(app.webViews.staticTexts["A second story"].exists)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["article-story"].tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertFalse(app.webViews.staticTexts["A second story"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launch()
    app.buttons["article-story"].tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertFalse(app.webViews.staticTexts["A second story"].exists)
    capture(app, "saved-reader-keeps-own-content-after-detour")
  }

  @MainActor func testReaderExtractsWhilePublisherImageNeverFinishes() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-hold-publisher-image", "-disable-preloading"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertTrue((app.buttons["reader-appearance"].value as? String ?? "").contains("publisher resource pending"))
    capture(app, "reader-with-publisher-resource-still-pending")
  }

  @MainActor func testRefreshReaderUsesLatestDOM() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-disable-preloading"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    showReader(app)
    app.buttons["reader-toggle"].tap()
    let button = app.webViews.buttons["Load late article text"]
    for _ in 0..<8 { if button.isHittable { break }; app.webViews.firstMatch.swipeUp() }
    XCTAssertTrue(button.isHittable)
    button.tap()
    showReader(app)
    let late = app.webViews.staticTexts["This late paragraph arrived after extraction. Refresh Reader includes the latest article text."]
    XCTAssertFalse(late.exists)
    app.buttons["Page options"].tap()
    app.buttons["reader-refresh"].tap()
    XCTAssertTrue(late.waitForExistence(timeout: 10))
    capture(app, "reader-refreshed-from-latest-dom")
  }

  @MainActor private func openRecoverableFailure() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard",
      "-disable-preloading", "-test-website-recovery",
    ]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    return app
  }

  @MainActor func testLaunchAndScrollDoNotStartSpeculativePublishers() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-long-list",
      "-hold-publisher-image", "-test-preloading",
    ]
    app.launch()
    let started = app.staticTexts["publisher-loads-started"]
    XCTAssertTrue(started.waitForExistence(timeout: 10))
    XCTAssertEqual(started.label, "0")
    app.swipeUp()
    let requested = app.staticTexts["preload-requested"]
    let visible = expectation(for: NSPredicate(format: "label != ''"), evaluatedWith: requested)
    wait(for: [visible], timeout: 5)
    XCTAssertEqual(started.label, "0")
    let firstPath = requested.label.split(separator: ",").first.map(String.init) ?? "missing"
    app.buttons["article-" + firstPath].tap()
    XCTAssertTrue(app.buttons["reader-toggle"].waitForExistence(timeout: 10))
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    capture(app, "local-first-launch-then-open")
  }

  @MainActor func testBackgroundReleasesNeighborsAndPreservesOpenReader() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
      "-test-preloading", "-articles-offline",
    ]
    app.launch()
    let ready = app.staticTexts["preload-ready"]
    let prepared = expectation(
      for: NSPredicate(format: "label CONTAINS 'cached-0' AND label CONTAINS ','"),
      evaluatedWith: ready)
    wait(for: [prepared], timeout: 20)
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5))
    app.activate()
    XCTAssertEqual(app.staticTexts["background-browser-count"].label, "0")
    let preparedAgain = expectation(
      for: NSPredicate(format: "label CONTAINS 'cached-0'"), evaluatedWith: ready)
    wait(for: [preparedAgain], timeout: 20)
    app.buttons["article-cached-0"].tap()
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "prepared")
    let text = app.webViews.staticTexts[
      "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."]
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    XCUIDevice.shared.press(.home)
    XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5))
    app.activate()
    XCTAssertEqual(app.staticTexts["background-browser-count"].label, "1")
    XCTAssertTrue(text.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Website"].exists)
    capture(app, "reader-preserved-after-background")
  }

  @MainActor func testReaderTextDoesNotWaitForArtworkOrBodyImages() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard", "-hold-reader-artwork",
    ]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    showReader(app)
    let appearance = app.buttons["reader-appearance"]
    let heldArtwork = expectation(
      for: NSPredicate(format: "value CONTAINS 'artwork held'"), evaluatedWith: appearance)
    wait(for: [heldArtwork], timeout: 5)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "reader-text-with-artwork-held")

    // Open the saved HTML with a subresource that never finishes. This proves
    // document readiness does not depend on WebKit's didFinish navigation event.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-hold-reader-body-image"]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    let heldBodyImage = expectation(
      for: NSPredicate(format: "value CONTAINS 'resource load pending'"), evaluatedWith: appearance)
    wait(for: [heldBodyImage], timeout: 5)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "cached-reader-with-body-image-held")
  }

  @MainActor func testPublisherRedirectRetainsRequestedCacheIdentity() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-test-preloading"]
    // TestMode resolves this alias to story.html. Its final source URL becomes
    // fixture.example/story, while the requested library identity stays below.
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/redirect-story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-toggle"].waitForExistence(timeout: 5))
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "warm-redirected-reader")
    let bookmark = app.buttons["reader-save"]
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    XCTAssertEqual(bookmark.value as? String, "Saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["article-redirect-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-redirect-story"].exists)
    XCTAssertFalse(app.buttons["article-story"].exists)

    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline"]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-redirect-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    capture(app, "redirected-reader-saved-offline")
  }

  @MainActor func testBundledReaderFontsRemainAvailableOffline() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard", "-test-reader-fonts",
    ]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/unicode"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    showReader(app)
    chooseFont("DM Sans", in: app)
    expectLoadedFont("DM Sans", in: app)
    capture(app, "bundled-font-fresh-reader")

    // A cached Reader has a local base URL rather than the initial HTML's opaque
    // origin. Both must receive the bundled font with website loading disabled.
    app.terminate()
    app.launchArguments = [
      "-ui-testing", "-articles-offline", "-images-offline", "-test-reader-fonts",
    ]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-unicode"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    showReader(app)
    expectLoadedFont("DM Sans", in: app)
    chooseFont("EB Garamond", in: app)
    expectLoadedFont("EB Garamond", in: app)
    XCTAssertTrue(
      app.webViews.staticTexts[
        "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
      ].exists)
    capture(app, "bundled-font-offline-garamond")
  }

  @MainActor private func chooseFont(_ family: String, in app: XCUIApplication) {
    app.buttons["reader-appearance"].tap()
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons[family].tap()
    app.buttons["Done"].tap()
  }

  @MainActor private func expectLoadedFont(_ family: String, in app: XCUIApplication) {
    let loaded = expectation(
      for: NSPredicate(format: "value CONTAINS %@", "loaded fonts: " + family),
      evaluatedWith: app.buttons["reader-appearance"])
    wait(for: [loaded], timeout: 10)
  }

  @MainActor private func showReader(_ app: XCUIApplication) {
    let toggle = app.buttons["reader-toggle"]
    let enabled = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: toggle)
    wait(for: [enabled], timeout: 20)
    if toggle.label == "Reader" { toggle.tap() }
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}

/// Real HTTP and WebKit History API navigation, without contacting a publisher.
private final class PublisherReplay {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "arctic.publisher-replay")
  var origin: String { "http://127.0.0.1:\(listener.port!.rawValue)" }

  init(ready: XCTestExpectation) throws {
    listener = try NWListener(using: .tcp, on: .any)
    listener.stateUpdateHandler = { state in
      if case .ready = state { ready.fulfill() }
    }
    listener.newConnectionHandler = { [queue] connection in
      connection.start(queue: queue)
      connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { data, _, _, _ in
        guard let data else {
          connection.cancel()
          return
        }
        let request = String(decoding: data, as: UTF8.self)
        let isArticle = request.hasPrefix("GET /content/")
        let title = isArticle ? "Publisher article" : "Publisher homepage"
        let paragraphs = String(
          repeating: "<p>A reading room holds the stories we return to. This article describes how patient attention changes our understanding of the world. A reader can save a passage, compare an idea with another writer, and return to the original source. The words remain available even when a connection is interrupted. Every article has its own address and every visit should preserve that boundary.</p>",
          count: 5)
        let html = """
          <!doctype html><html><head><meta name="viewport" content="width=device-width"><title>\(title)</title><link rel="icon" href="data:,"></head>
          <body><main><article><h1>\(title)</h1><button onclick="history.pushState({}, '', '/content/test-article'); document.title='Publisher article'; document.querySelector('h1').textContent='Publisher article'; this.remove()">Read publisher article</button>\(paragraphs)</article></main></body></html>
          """
        let body = Data(html.utf8)
        var response = Data(
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
        response.append(body)
        connection.send(
          content: response, completion: .contentProcessed { _ in connection.cancel() })
      }
    }
    listener.start(queue: queue)
  }

  func stop() { listener.cancel() }
}
