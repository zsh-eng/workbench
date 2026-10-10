import XCTest

final class ArticleReaderUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testSyncTrialIsSeparateAndRejectsInsecureServer() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
    ]
    app.launch()
    let menu = app.buttons["Sort and filter"]
    XCTAssertTrue(menu.waitForExistence(timeout: 10))
    let article = app.descendants(matching: .any).matching(identifier: "article-cached-0")
      .firstMatch
    XCTAssertTrue(article.waitForExistence(timeout: 10), app.debugDescription)
    menu.tap()
    app.buttons["sync-trial-open"].tap()
    let input = app.textFields["sync-trial-server"]
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.tap()
    input.press(forDuration: 1)
    if app.menuItems["Select All"].exists {
      app.menuItems["Select All"].tap()
    } else {
      input.typeText(
        String(
          repeating: XCUIKeyboardKey.delete.rawValue, count: (input.value as? String ?? "").count))
    }
    input.typeText("http://localhost")
    app.buttons["sync-trial-sign-in"].tap()
    let error = app.staticTexts["sync-trial-status"]
    expectation(
      for: NSPredicate(format: "label CONTAINS %@", "Could not complete"), evaluatedWith: error)
    waitForExpectations(timeout: 5)
    XCTAssertFalse(app.buttons["sync-trial-save"].exists)
    app.buttons["Done"].tap()
    XCTAssertTrue(menu.waitForExistence(timeout: 5))
    XCTAssertTrue(article.waitForExistence(timeout: 5), app.debugDescription)
  }

  @MainActor func testStationaryBarAndReaderBackSwipe() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    let folders = ["saved", "downloaded", "history", "archive"].map { app.buttons["folder-" + $0] }
    for index in 1..<folders.count {
      XCTAssertLessThan(folders[index - 1].frame.minX, folders[index].frame.minX)
    }
    let top = app.buttons["Sort and filter"].frame.minY
    app.buttons["article-story"].tap()
    let back = app.navigationBars.buttons.element(boundBy: 0)
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons["Page options"].frame.minY, top, accuracy: 1)
    XCTAssertEqual(back.frame.minY, top, accuracy: 1)
    XCTAssertTrue(app.buttons["Page options"].isHittable)
    waitEnabled(app.buttons["reader-toggle"])
    let controls = [
      "browser-back", "browser-forward", "reader-appearance", "reader-save", "reader-toggle",
    ]
    .map { app.buttons[$0] }
    // 44 pt targets keep clear gaps beside the note button.
    for index in 1..<controls.count {
      XCTAssertGreaterThan(controls[index].frame.midX - controls[index - 1].frame.midX, 52)
    }
    capture(app, "71-shared-reader-bar")
    let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.45))
    edge.press(forDuration: 0.05, thenDragTo: end)
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: back)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(app.buttons["select-articles"].isHittable)
    app.buttons["article-story"].tap()
    XCTAssertTrue(back.waitForExistence(timeout: 5))
    back.tap()
    XCTAssertTrue(app.buttons["select-articles"].isHittable)
  }

  @MainActor func testInsetCardVariantsAndScrollMaterial() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    for name in ["story", "long", "short", "next"] {
      add("https://fixture.example/" + name, to: app)
    }
    let textCard = app.buttons["article-next"]
    XCTAssertTrue(textCard.waitForExistence(timeout: 10))
    XCTAssertLessThan(textCard.frame.height, 200)
    let short = app.buttons["article-short"]
    XCTAssertTrue(short.staticTexts["card-caption-subtitle"].exists)
    let long = app.buttons["article-long"]
    XCTAssertFalse(long.staticTexts["card-caption-subtitle"].exists)
    capture(app, "63-card-variants-and-search-material")
    app.swipeUp()
    capture(app, "64-cards-behind-search")
    let search = app.searchFields.firstMatch
    search.tap()
    search.typeText("fixture.example")
    let shortResult = app.buttons["article-short"]
    let longResult = app.buttons["article-long"]
    XCTAssertTrue(shortResult.waitForExistence(timeout: 5))
    XCTAssertTrue(shortResult.staticTexts["search-result-subtitle"].exists)
    XCTAssertFalse(longResult.staticTexts["search-result-subtitle"].exists)
    // Compact results retain the full text variant while reducing vertical gaps.
    XCTAssertLessThanOrEqual(shortResult.frame.height, 92)
    XCTAssertLessThanOrEqual(longResult.frame.height, 92)
    let title = longResult.staticTexts["article-title-two-lines"]
    XCTAssertTrue(title.exists)
    XCTAssertLessThanOrEqual(title.frame.height, 44)
    let subtitle = shortResult.staticTexts["search-result-subtitle"]
    let thumbnail = shortResult.images["Article preview"].firstMatch
    XCTAssertGreaterThanOrEqual(subtitle.frame.minY, thumbnail.frame.minY)
    XCTAssertLessThanOrEqual(subtitle.frame.maxY, thumbnail.frame.maxY + 1)
    capture(app, "65-search-title-variants")
  }

  @MainActor func testReaderBookmarkAndArchiveAtEnd() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    XCTAssertLessThan(open.frame.maxY, app.searchFields.firstMatch.frame.minY)
    let empty = app.staticTexts["Your next good read."]
    XCTAssertTrue(empty.exists)
    XCTAssertGreaterThan(empty.frame.midY, app.frame.height * 0.4)
    XCTAssertLessThan(empty.frame.midY, app.frame.height * 0.65)
    capture(app, "50-empty-library-and-bottom-paste")
    open.tap()
    waitEnabled(app.buttons["reader-toggle"])
    let save = app.buttons["reader-save"]
    XCTAssertEqual(save.value as? String, "Not saved")
    save.tap()
    XCTAssertEqual(save.value as? String, "Saved")
    save.tap()
    XCTAssertEqual(save.value as? String, "Not saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["folder-history"].tap()
    app.buttons["article-story"].tap()
    save.tap()
    XCTAssertEqual(save.value as? String, "Saved")
    showReader(app)
    let archive = app.buttons["reader-archive-prompt"]
    XCTAssertFalse(archive.exists)
    for _ in 0..<8 where !archive.exists { app.webViews.firstMatch.swipeUp() }
    XCTAssertTrue(archive.waitForExistence(timeout: 5))
    capture(app, "51-end-of-article-archive")
    archive.tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["reader-save"].exists)
    app.buttons["folder-saved"].tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(app.buttons["article-story"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    app.buttons["folder-archive"].tap()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    app.buttons["folder-saved"].tap()
    card.tap()
    app.buttons["Page options"].tap()
    XCTAssertFalse(app.buttons["Save to inbox"].exists)
    app.buttons["reader-archive-menu"].tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(card.exists)
  }
  @MainActor
  func testSaveRestartBrowseReadAndRemove() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    add("https://fixture.example/story", to: app)
    XCTAssertTrue(
      app.staticTexts["The quiet art of paying attention"].waitForExistence(timeout: 15))
    capture(app, "01-library")

    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    let toggle = app.buttons["reader-toggle"]
    waitEnabled(toggle)
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    XCTAssertFalse(app.buttons["browser-forward"].isEnabled)
    capture(app, "02-browser")
    showReader(app)
    XCTAssertFalse(app.webViews.staticTexts["Publisher navigation"].exists)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "03-reader")
    toggle.tap()
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].waitForExistence(timeout: 5))

    let next = app.webViews.links["Read the next story"]
    for _ in 0..<5 where !next.isHittable { app.webViews.firstMatch.swipeUp() }
    XCTAssertTrue(next.isHittable)
    next.tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 5))
    waitEnabled(app.buttons["browser-back"])
    XCTAssertFalse(app.buttons["browser-forward"].isEnabled)
    app.buttons["browser-back"].tap()
    XCTAssertTrue(next.waitForExistence(timeout: 5))
    waitEnabled(app.buttons["browser-forward"])
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    app.buttons["browser-forward"].tap()
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 5))
    // The followed story is a page above the first; leave both.
    let close = app.navigationBars.buttons.element(boundBy: 0)
    close.tap()
    XCTAssertTrue(next.waitForExistence(timeout: 5))
    close.tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-next"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-next"].waitForExistence(timeout: 5))
    app.buttons["folder-saved"].tap()
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
  }

  @MainActor
  func testArticleFrameAndSwipeBack() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    add("https://fixture.example/frame", to: app)
    let card = app.buttons["article-frame"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    waitEnabled(app.buttons["reader-toggle"])
    showReader(app)
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    XCTAssertFalse(app.webViews.staticTexts["Unwall shell fixture"].exists)
    let edge = app.coordinate(withNormalizedOffset: CGVector(dx: 0.005, dy: 0.45))
    edge.press(
      forDuration: 0.1,
      thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.45)))
    XCTAssertTrue(card.waitForExistence(timeout: 5))
  }

  @MainActor func testReaderLayoutLiveControlsAndDiskImages() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    XCTAssertTrue(app.images["Article preview"].firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue(app.images["Site icon"].firstMatch.waitForExistence(timeout: 10))
    capture(app, "10-editorial-library")
    app.terminate()
    app.launchArguments = ["-ui-testing", "-images-offline"]
    app.launch()
    XCTAssertTrue(app.images["Article preview"].firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue(app.images["Site icon"].firstMatch.waitForExistence(timeout: 10))
    app.buttons["article-story"].tap()
    waitEnabled(app.buttons["reader-toggle"])
    showReader(app)
    XCTAssertTrue(
      app.webViews.staticTexts[
        "On walking slowly, noticing more, and making room for a good story."
      ].exists)
    XCTAssertTrue(app.webViews.staticTexts["Alex Reader"].exists)
    let heading = app.webViews.staticTexts["The quiet art of paying attention"].firstMatch
    XCTAssertGreaterThanOrEqual(
      heading.frame.minY, app.navigationBars.buttons.element(boundBy: 0).frame.maxY)
    capture(app, "11-editorial-reader")
    app.webViews.firstMatch.swipeUp()
    app.buttons["reader-appearance"].tap()
    XCTAssertFalse(app.staticTexts["A little room to read."].exists)
    XCTAssertTrue(app.staticTexts["Reader appearance"].waitForExistence(timeout: 5))
    let panelHeight =
      app.buttons["reader-increase-line-spacing"].frame.maxY
      - app.staticTexts["Reader appearance"].frame.minY + 36
    XCTAssertLessThan(panelHeight, app.frame.height * 0.4)
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons["Georgia"].tap()
    for _ in 0..<5 { app.buttons["reader-decrease-side-padding"].tap() }
    XCTAssertFalse(app.buttons["reader-decrease-side-padding"].isEnabled)
    for _ in 0..<8 { app.buttons["reader-increase-line-spacing"].tap() }
    XCTAssertFalse(app.buttons["reader-increase-line-spacing"].isEnabled)
    XCTAssertEqual(app.sliders.count, 0)
    app.descendants(matching: .any)["reader-theme"].firstMatch.tap()
    app.buttons["Paper"].tap()
    capture(app, "12-live-paper-controls")
    app.buttons["Done"].tap()
    let applied = expectation(
      for: NSPredicate(
        format:
          "value CONTAINS 'Georgia' AND value CONTAINS '8px padding' AND value CONTAINS '1.95 spacing' AND value CONTAINS 'Paper'"
      ), evaluatedWith: app.buttons["reader-appearance"])
    wait(for: [applied], timeout: 8)
    app.buttons["reader-appearance"].tap()
    app.descendants(matching: .any)["reader-theme"].firstMatch.tap()
    app.buttons["Ink"].tap()
    app.buttons["Done"].tap()
    capture(app, "13-ink-reader")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = ["-ui-testing", "-images-offline", "-dark-ui"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    capture(app, "14-dark-library")
  }

  @MainActor private func add(_ url: String, to app: XCUIApplication) {
    app.terminate()
    app.launchArguments.removeAll { $0 == "-reset-store" || $0 == "-reset-appearance" }
    if !app.launchArguments.contains("-test-clipboard") {
      app.launchArguments.append("-test-clipboard")
    }
    app.launchEnvironment["TEST_CLIPBOARD"] = url
    app.launch()
    app.launchEnvironment = [:]
    XCTAssertTrue(
      app.buttons["open-copied-link"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.buttons["save-copied-link"].exists)
    app.buttons["open-copied-link"].tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if bookmark.value as? String == "Not saved" { bookmark.tap() }
    app.navigationBars.buttons.element(boundBy: 0).tap()

  }

  @MainActor func testClipboardSaveAndSearch() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["add-link"].exists)
    XCTAssertFalse(app.tabBars.firstMatch.exists)
    add("https://fixture.example/story", to: app)
    add("https://fixture.example/next", to: app)
    XCTAssertTrue(
      app.staticTexts["The quiet art of paying attention"].waitForExistence(timeout: 10))
    capture(app, "60-inset-image-and-text-card")
    let search = app.searchFields.firstMatch
    search.tap()
    search.typeText("QUIET")
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-next"].exists)
    XCTAssertLessThan(app.staticTexts["search-summary"].frame.minY, app.frame.height * 0.12)
    capture(app, "05-search-results")
    app.buttons["article-story"].tap()
    XCTAssertTrue(app.buttons["reader-toggle"].waitForExistence(timeout: 5))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertEqual(search.value as? String, "QUIET")
    app.searchFields.buttons["Clear text"].tap()
    search.typeText("nothing-matches-this")
    XCTAssertTrue(app.staticTexts["No articles found"].waitForExistence(timeout: 5))
    app.searchFields.buttons["Clear text"].tap()
    search.typeText("fixture.example")
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
    app.buttons["close"].tap()
    XCTAssertTrue(app.buttons["article-next"].exists)
    XCTAssertFalse(app.buttons["close"].exists)
    XCTAssertTrue(app.buttons["select-articles"].isHittable)
    // Reversing search must leave one usable set of controls, with no stale overlay.
    search.tap()
    XCTAssertTrue(app.buttons["close"].waitForExistence(timeout: 5))
    search.typeText("QUIET")
    expectation(
      for: NSPredicate(format: "hittable == false"), evaluatedWith: app.buttons["select-articles"])
    waitForExpectations(timeout: 5)
    XCTAssertTrue(app.buttons["article-story"].isHittable)
    XCTAssertFalse(app.buttons["article-next"].exists)
    capture(app, "06-search-reopened")
    app.buttons["close"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].isHittable)
  }

  @MainActor func testFolderSwipesAndDownloadedReaderSurviveRestart() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(card.frame.height, 190)
    XCTAssertLessThan(card.frame.height, 280)
    card.press(forDuration: 1)
    capture(app, "40-padded-card-preview")
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.85)).tap()
    card.tap()
    let ready = NSPredicate(format: "value == 'Ready'")
    expectation(for: ready, evaluatedWith: app.buttons["reader-toggle"])
    waitForExpectations(timeout: 15)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-downloaded"].isSelected)
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    capture(app, "41-downloaded-folder")
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-history"].isSelected)
    XCTAssertTrue(card.exists)
    XCTAssertLessThan(card.frame.height, 145)
    capture(app, "70-compact-history")
    swipeLibrary(app, left: true)
    XCTAssertTrue(app.buttons["folder-archive"].isSelected)
    XCTAssertTrue(app.staticTexts["A place for finished stories."].exists)
    swipeLibrary(app, left: false)
    XCTAssertTrue(app.buttons["folder-history"].isSelected)

    // No publisher/fixture load is permitted on this fresh process.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline"]
    app.launch()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.webViews.staticTexts["Publisher navigation"].exists)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["folder-downloaded"].tap()
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["Website"].exists)
    XCTAssertFalse(app.buttons["browser-back"].isEnabled)
    XCTAssertFalse(app.buttons["browser-forward"].isEnabled)
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    app.buttons["reader-appearance"].tap()
    XCTAssertTrue(app.buttons["reader-font"].waitForExistence(timeout: 5))
    capture(app, "42-offline-reader-appearance")
    app.buttons["Done"].tap()
    // Toggling a saved link must preserve its already downloaded Reader copy.
    let save = app.buttons["reader-save"]
    save.tap()
    XCTAssertEqual(save.value as? String, "Not saved")
    save.tap()
    XCTAssertEqual(save.value as? String, "Saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    app.buttons["folder-downloaded"].tap()
    card.tap()
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].waitForExistence(timeout: 10))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    XCTAssertTrue(app.staticTexts["Take a good read with you."].waitForExistence(timeout: 5))
    app.terminate()
    app.launch()
    app.buttons["folder-downloaded"].tap()
    XCTAssertFalse(card.exists)
  }

  @MainActor private func swipeLibrary(_ app: XCUIApplication, left: Bool) {
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.85 : 0.15, dy: 0.5))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: left ? 0.15 : 0.85, dy: 0.5))
    start.press(forDuration: 0.05, thenDragTo: end)
  }

  @MainActor func testChromeHTMLImport() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-stage-import", "-test-tagging"]
    app.launch()
    app.buttons["Sort and filter"].tap()
    app.buttons["import-reading-list"].tap()
    XCTAssertTrue(app.tabBars.buttons["Browse"].waitForExistence(timeout: 5), app.debugDescription)
    app.tabBars.buttons["Browse"].tap()
    let file = app.cells.matching(NSPredicate(format: "label CONTAINS 'Reading List'")).firstMatch
    // Files can restore the app folder from a previous import.
    if !file.waitForExistence(timeout: 2) {
      let localFiles = app.cells.containing(.staticText, identifier: "On My iPhone").firstMatch
      if localFiles.waitForExistence(timeout: 2) { localFiles.tap() }
      let articlesFolder = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'Arctic'"))
        .firstMatch
      XCTAssertTrue(articlesFolder.waitForExistence(timeout: 5), app.debugDescription)
      articlesFolder.tap()
    }
    XCTAssertTrue(file.waitForExistence(timeout: 5), app.debugDescription)
    file.tap()
    XCTAssertTrue(
      app.buttons["import-summary-done"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.staticTexts["2"].exists)
    XCTAssertTrue(app.staticTexts["1 already in your library"].exists, app.debugDescription)
    let engineering = app.staticTexts["import-tag-Engineering"]
    XCTAssertTrue(engineering.waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.staticTexts["· 2 tagged"].waitForExistence(timeout: 10), app.debugDescription)
    capture(app, "import-summary")
    app.buttons["import-summary-done"].tap()
    XCTAssertFalse(app.otherElements["tagging-notice"].exists)
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
  }

  @MainActor func testSavedHistoryTagsAndArchivePersist() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    XCTAssertTrue(
      app.staticTexts["The quiet art of paying attention"].waitForExistence(timeout: 10))
    capture(app, "61-prefetched-clipboard-preview")
    // Merely preloading the clipboard must not create a history entry.
    app.buttons["folder-history"].tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    app.buttons["open-copied-link"].tap()
    waitEnabled(app.buttons["reader-toggle"])
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let article = app.buttons["article-story"]
    XCTAssertTrue(article.waitForExistence(timeout: 5))
    app.buttons["folder-saved"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["folder-history"].tap()
    article.press(forDuration: 1)
    app.buttons["Save to inbox"].tap()
    app.buttons["folder-saved"].tap()
    XCTAssertTrue(article.exists)
    article.press(forDuration: 1)
    app.buttons["Tags"].tap()
    let tag = app.textFields["tag-name"]
    XCTAssertTrue(tag.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(tag.frame.minY, app.frame.height * 0.7)
    XCTAssertFalse(
      app.staticTexts["Tags group your saved articles. Tap a tag to add or remove it."].exists)
    capture(app, "62-compact-tags")
    tag.tap()
    tag.typeText("Ideas")
    app.buttons["add-tag"].tap()
    app.buttons["save-tags"].tap()
    let ideas = app.buttons["folder-tag-Ideas"]
    XCTAssertLessThan(ideas.frame.minX, app.buttons["folder-history"].frame.minX)
    XCTAssertLessThan(
      app.buttons["folder-history"].frame.minX, app.buttons["folder-archive"].frame.minX)
    ideas.tap()
    XCTAssertTrue(article.waitForExistence(timeout: 5))
    capture(app, "15-tag-folder")
    article.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)
    XCTAssertLessThan(article.frame.height, 145)
    capture(app, "16-archive")
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertFalse(article.exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(article.exists)
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)
    article.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    app.buttons["folder-tag-Ideas"].tap()
    XCTAssertTrue(article.exists)
    article.press(forDuration: 1)
    app.buttons["Tags"].tap()
    app.buttons["tag-option-Ideas"].tap()
    app.buttons["save-tags"].tap()
    app.buttons["folder-saved"].tap()
    XCTAssertFalse(app.buttons["folder-tag-Ideas"].exists)
    XCTAssertTrue(article.exists)
    app.buttons["select-articles"].tap()
    article.tap()
    app.buttons["Archive options"].tap()
    app.buttons["archive-selected"].tap()
    XCTAssertFalse(article.exists)
    app.buttons["select-articles"].tap()
    app.buttons["folder-archive"].tap()
    XCTAssertTrue(article.exists)

  }

  @MainActor func testCopiedLinkPreloadsWithoutSavingOrRepeating() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(
      app.buttons["open-copied-link"].waitForExistence(timeout: 10), app.debugDescription)
    capture(app, "07-copied-link")
    app.buttons["open-copied-link"].tap()
    waitEnabled(app.buttons["reader-toggle"])
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].exists)
    app.buttons["reader-appearance"].tap()
    app.descendants(matching: .any)["reader-font"].firstMatch.tap()
    app.buttons["DM Sans"].tap()
    let increase = app.buttons["reader-increase-text-size"]
    for _ in 0..<15 where increase.isEnabled { increase.tap() }
    XCTAssertFalse(increase.isEnabled)
    app.buttons["Done"].tap()
    let applied = expectation(
      for: NSPredicate(format: "value CONTAINS 'DM Sans' AND value CONTAINS '30px'"),
      evaluatedWith: app.buttons["reader-appearance"])
    wait(for: [applied], timeout: 8)
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.webViews.staticTexts["A little room to think"].exists)
    capture(app, "09-copied-reader-appearance")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-clipboard"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
  }

  @MainActor func testPastedLinkStripsQueryAndOffersSaveOnlyWhenUnsaved() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] =
      "https://fixture.example/story?utm_source=first&ref=mail#section"
    app.launch()
    let save = app.buttons["save-copied-link"]
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(save.waitForExistence(timeout: 10))
    XCTAssertTrue(open.exists)
    XCTAssertEqual(app.staticTexts["clipboard-link"].label, "https://fixture.example/story#section")
    capture(app, "clipboard-save-and-open")
    save.tap()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["reader-toggle"].exists)

    // A different query must resolve to the persisted saved article after restart.
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] =
      "https://fixture.example/story?utm_source=second#section"
    app.launch()
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    XCTAssertFalse(save.exists)
    XCTAssertEqual(app.buttons.matching(identifier: "article-story").count, 1)
    capture(app, "clipboard-saved-open-only")
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    XCTAssertEqual(bookmark.value as? String, "Saved")
    bookmark.tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()

    // Keeping a link in history does not count as saving it.
    app.terminate()
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story?another=value#section"
    app.launch()
    XCTAssertTrue(save.waitForExistence(timeout: 10))
    XCTAssertTrue(open.exists)
    save.tap()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons.matching(identifier: "article-story").count, 1)
  }

  @MainActor func testNonURLClipboardDoesNotOfferOpen() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "just a note, not a link"
    app.launch()
    XCTAssertTrue(app.searchFields.firstMatch.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["open-copied-link"].exists)
  }

  @MainActor func testDeepLinkReplacesVisiblePageAndRecordsHistory() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCUIDevice.shared.system.open(
      URL(string: "articles://open?url=https%3A%2F%2Ffixture.example%2Fstory")!)
    waitEnabled(app.buttons["reader-toggle"])
    XCTAssertTrue(app.webViews.staticTexts["Publisher navigation"].exists)
    XCUIDevice.shared.system.open(
      URL(string: "articles://open?url=https%3A%2F%2Ffixture.example%2Fnext")!)
    XCTAssertTrue(app.webViews.staticTexts["A second story"].waitForExistence(timeout: 10))
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["article-next"].exists)
    app.buttons["folder-history"].tap()
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertTrue(app.buttons["article-next"].exists)
  }

  @MainActor func testEmptyFolderIllustrationsInLightMode() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    let strip = app.scrollViews.containing(.button, identifier: "folder-saved").firstMatch
    for name in ["saved", "favourites", "downloaded", "history", "archive"] {
      let button = app.buttons["folder-" + name]
      for _ in 0..<5 {
        if button.isHittable { break }
        strip.swipeLeft()
      }
      XCTAssertTrue(button.isHittable)
      button.tap()
      XCTAssertTrue(
        app.staticTexts.matching(NSPredicate(format: "label == %@", name.uppercased())).firstMatch
          .waitForExistence(timeout: 5))
      capture(app, "empty-" + name + "-light")
    }
  }

  /// The site puts advertisements between passages and uses its own type, so
  /// only the words connect the two views.
  @MainActor func testSwitchingViewsKeepsTheSameWords() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/passages", to: app)
    app.buttons["article-passages"].tap()
    showReader(app)
    let web = app.webViews.firstMatch
    let toggle = app.buttons["reader-toggle"]
    let probe = app.navigationBars.firstMatch.frame.maxY + 24
    func expectSwitch(to mode: String, keeping top: (name: String, y: CGFloat)) {
      XCTAssertTrue(app.buttons[mode].waitForExistence(timeout: 10))
      // Let the 0.22 s crossfade finish, so the outgoing view is not measured.
      Thread.sleep(forTimeInterval: 0.6)
      var frame: CGRect?
      let deadline = Date().addingTimeInterval(10)
      while frame == nil && Date() < deadline { frame = passage(top.name, in: app)?.frame }
      guard let frame else {
        return XCTFail("\(top.name) is not visible in \(mode)\n\(app.debugDescription)")
      }
      // The same passage still holds the first line below the bar.
      XCTAssertLessThanOrEqual(frame.minY, max(top.y, probe) + 30, top.name)
      XCTAssertGreaterThan(frame.maxY, probe, top.name)
    }
    // Reader to a website that loads for the first time.
    web.swipeUp(velocity: .slow)
    var top = topPassage(below: probe, in: app)
    toggle.tap()
    expectSwitch(to: "Reader", keeping: top)
    capture(app, "switch-website-at-reader-words")
    // Website to Reader.
    web.swipeUp(velocity: .slow)
    web.swipeUp(velocity: .slow)
    top = topPassage(below: probe, in: app)
    toggle.tap()
    expectSwitch(to: "Website", keeping: top)
    capture(app, "switch-reader-at-website-words")
    // Reader to the website that is already loaded.
    web.swipeDown(velocity: .slow)
    top = topPassage(below: probe, in: app)
    toggle.tap()
    expectSwitch(to: "Reader", keeping: top)
  }

  private let passageNames = [
    "Amber", "Birch", "Cedar", "Dune", "Ember", "Fern", "Garnet", "Heron", "Iris", "Juniper",
    "Kestrel", "Linden", "Moss", "Nettle",
  ]

  /// Each passage's text names it in every sentence, for example "Ferry Birch".
  @MainActor private func passage(_ name: String, in app: XCUIApplication) -> XCUIElement? {
    app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Ferry \(name) "))
      .allElementsBoundByIndex.first { $0.isHittable }
  }

  /// The passage on the first line below the bar, or the next one below a gap.
  @MainActor private func topPassage(below probe: CGFloat, in app: XCUIApplication) -> (
    name: String, y: CGFloat
  ) {
    for name in passageNames {
      guard let frame = passage(name, in: app)?.frame, frame.maxY > probe else { continue }
      return (name, frame.minY)
    }
    XCTFail(app.debugDescription)
    return ("", 0)
  }

  @MainActor func testReaderPositionSurvivesOfflineRelaunchAndWebsiteSwitch() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    app.buttons["article-story"].tap()
    showReader(app)
    let web = app.webViews.firstMatch
    web.swipeUp(velocity: .slow)
    let heading = app.webViews.staticTexts["A little room to think"]
    XCTAssertTrue(heading.isHittable, app.debugDescription)
    let y = heading.frame.minY
    capture(app, "reader-position-before")
    // Without a website scroll, Reader keeps its own position.
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(app.buttons["Reader"].waitForExistence(timeout: 10))
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10))
    XCTAssertEqual(heading.frame.minY, y, accuracy: 16)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["continue-reading-open"].waitForExistence(timeout: 5))
    capture(app, "continue-reading-banner")
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/next"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["continue-reading-open"].exists)
    app.buttons["dismiss-copied-link"].tap()
    XCTAssertFalse(app.buttons["open-copied-link"].exists, app.debugDescription)
    let resume = app.buttons["continue-reading-open"]
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    XCTAssertLessThan(resume.frame.maxY, app.searchFields.firstMatch.frame.minY)
    resume.tap()
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10))
    let restored = expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: heading)
    wait(for: [restored], timeout: 10)
    XCTAssertEqual(heading.frame.minY, y, accuracy: 16)
    capture(app, "reader-position-restored-offline")
    web.swipeUp(velocity: .slow)
    web.swipeUp(velocity: .slow)
    let last = app.webViews.staticTexts["Read the next story"]
    XCTAssertTrue(last.isHittable)
    let archive = app.buttons["reader-archive-prompt"]
    XCTAssertTrue(archive.isHittable)
    let endGap = archive.frame.minY - last.frame.maxY
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["continue-reading-open"].exists)
    app.buttons["article-story"].tap()
    showReader(app)
    let atEnd = expectation(for: NSPredicate(format: "hittable == true"), evaluatedWith: last)
    wait(for: [atEnd], timeout: 10)
    // The Archive prompt appears after a gesture, so a fresh Reader has 54pt
    // more space. Preserve the end passage relative to the visible controls.
    let controls = archive.exists ? archive : app.buttons["reader-toggle"]
    XCTAssertGreaterThan(controls.frame.minY, last.frame.maxY)
    XCTAssertEqual(controls.frame.minY - last.frame.maxY, endGap, accuracy: 16)
    capture(app, "reader-position-end-restored")
  }

  @MainActor func testContinueReadingDismissalSurvivesRelaunch() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-dark-ui"]
    app.launch()
    add("https://fixture.example/story", to: app)
    XCTAssertFalse(app.buttons["continue-reading-open"].exists)
    app.buttons["article-story"].tap()
    showReader(app)
    app.webViews.firstMatch.swipeUp(velocity: .slow)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let dismiss = app.buttons["continue-reading-dismiss"]
    XCTAssertTrue(dismiss.waitForExistence(timeout: 5))
    capture(app, "continue-reading-dark")
    dismiss.tap()
    XCTAssertFalse(dismiss.exists, app.debugDescription)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline", "-dark-ui"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["continue-reading-open"].exists)
    app.buttons["article-story"].tap()
    showReader(app)
    // A new settled position makes this article eligible again.
    let web = app.webViews.firstMatch
    let start = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    let end = web.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    start.press(forDuration: 0.1, thenDragTo: end)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let resume = app.buttons["continue-reading-open"]
    XCTAssertTrue(resume.waitForExistence(timeout: 5))
    resume.tap()
    app.buttons["reader-save"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["folder-saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(resume.exists)
  }

  @MainActor func testReaderCopyShareAndNativeFind() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/story", to: app)
    app.buttons["article-story"].tap()
    showReader(app)
    app.buttons["Page options"].tap()
    XCTAssertFalse(app.buttons["Open original"].exists)
    XCTAssertTrue(app.buttons["reader-open-browser"].exists)
    app.buttons["reader-copy-link"].tap()
    app.buttons["reader-add-note"].tap()
    let input = app.textFields["note-message-input"]
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    XCTAssertGreaterThanOrEqual(
      app.descendants(matching: .any).matching(identifier: "note-input-bar").firstMatch.frame
        .height, 54)
    capture(app, "reader-composer-height")
    input.press(forDuration: 1.1)
    let paste = app.menuItems["Paste"]
    XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
    paste.tap()
    XCTAssertEqual(input.value as? String, "https://fixture.example/story")
    app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    XCTAssertTrue(app.buttons["reader-add-note"].waitForExistence(timeout: 5))
    app.buttons["Page options"].tap()
    app.buttons["reader-share-link"].tap()
    XCTAssertTrue(app.cells["Copy"].waitForExistence(timeout: 5), app.debugDescription)
    capture(app, "reader-share-sheet")
    app.cells["Copy"].tap()
    app.buttons["Page options"].tap()
    app.buttons["reader-find"].tap()
    let find = app.searchFields.firstMatch
    XCTAssertTrue(find.waitForExistence(timeout: 5), app.debugDescription)
    find.typeText("particular")
    capture(app, "reader-native-find")
    XCTAssertTrue(app.buttons["Done"].exists, app.debugDescription)
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["reader-add-note"].isHittable)
  }

  @MainActor func testSVGReaderIconSurvivesOfflineReopen() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-test-reader-icon"]
    app.launch()
    add("https://fixture.example/icon", to: app)
    app.buttons["article-icon"].tap()
    showReader(app)
    XCTAssertTrue(app.webViews.images["Loaded Reader icon"].waitForExistence(timeout: 10))
    capture(app, "reader-svg-favicon")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["folder-downloaded"].tap()
    XCTAssertTrue(app.buttons["article-icon"].waitForExistence(timeout: 10))
    app.terminate()
    app.launchArguments = [
      "-ui-testing", "-test-reader-icon", "-articles-offline", "-images-offline",
    ]
    app.launch()
    app.buttons["article-icon"].tap()
    showReader(app)
    XCTAssertTrue(app.webViews.images["Loaded Reader icon"].waitForExistence(timeout: 10))
    capture(app, "reader-svg-favicon-offline")
  }

  @MainActor func testShareTagsPackLeftAndKeepLongLabelsOnOneLine() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-share-fixture", "-test-tagging", "-share-long-tags"]
    app.launch()
    _ = openShareFixture(app)
    let group = app.descendants(matching: .any).matching(identifier: "share-added-tags").firstMatch
    expectation(for: NSPredicate(format: "value == 'presented'"), evaluatedWith: group)
    waitForExpectations(timeout: 10)
    let attention = app.staticTexts["Attention"]
    let life = app.staticTexts["Life"]
    let long = app.staticTexts["Technology and Society"]
    XCTAssertTrue(long.exists)
    // Label frames include the pill's padding. Short tags stay together instead
    // of occupying equal-width columns; the long label remains a single line.
    XCTAssertEqual(attention.frame.minY, life.frame.minY, accuracy: 1)
    XCTAssertLessThan(life.frame.minX - attention.frame.maxX, 36)
    XCTAssertEqual(long.frame.height, attention.frame.height, accuracy: 1)
    XCTAssertLessThanOrEqual(long.frame.maxX, group.frame.maxX + 1)
    capture(app, "share-leading-single-line-tags")
    app.buttons["share-cancel"].tap()
  }

  @MainActor func testReadingStatsTotalsAndDaySelection() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-seed-preload-fixtures", "-disable-preloading", "-seed-reading-stats"]
    app.launch()
    app.buttons["Sort and filter"].tap()
    app.buttons["library-reading-stats"].tap()
    let total = app.staticTexts["stats-week-total"]
    XCTAssertTrue(total.waitForExistence(timeout: 5))
    XCTAssertEqual(total.label, "1 hr 21 min")
    let days = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'stats-day-'"))
    XCTAssertEqual(days.count, 7)
    days.element(boundBy: 0).tap()
    XCTAssertTrue(app.descendants(matching: .any)["stats-selected-day"].label.contains("7 min"))
    capture(app, "reading-stats-light")
    app.buttons["stats-done"].tap()
    XCTAssertTrue(app.buttons["article-cached-0"].waitForExistence(timeout: 5))
    app.buttons["article-cached-0"].tap()
    app.buttons["Page options"].tap()
    app.buttons["reader-reading-time"].tap()
    XCTAssertTrue(app.staticTexts["stats-week-total"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["stats-week-total"].label, "0 min")
    app.buttons["stats-done"].tap()
    XCTAssertTrue(app.buttons["Page options"].exists)
  }

  @MainActor func testReadingStatsEmptyDarkLargeType() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-disable-preloading", "-dark-ui", "-large-type", "-reduce-motion"]
    app.launch()
    app.buttons["Sort and filter"].tap()
    app.buttons["library-reading-stats"].tap()
    XCTAssertTrue(app.staticTexts["stats-week-total"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["stats-week-total"].label, "0 min")
    capture(app, "reading-stats-dark-large-type-top")
    app.swipeUp()
    XCTAssertTrue(app.staticTexts["stats-empty"].waitForExistence(timeout: 5))
    capture(app, "reading-stats-empty-dark-large-type")
    app.buttons["stats-done"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].exists)
  }

  @MainActor func testFolderTapsAlwaysFadeAndSwipesStillNavigate() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-seed-preload-fixtures", "-disable-preloading", "-test-folder-transitions"]
    app.launch()
    XCTAssertTrue(app.buttons["article-cached-0"].waitForExistence(timeout: 10))
    let originalCard = app.buttons["article-cached-0"].frame
    let originalHeader = app.buttons["folder-saved"].frame.minY
    let strip = app.scrollViews["library-folders"]
    let history = app.buttons["folder-history"]
    for _ in 0..<5 { if history.isHittable { break }; strip.swipeLeft() }
    history.tap()
    XCTAssertTrue(history.isSelected)
    XCTAssertEqual(app.staticTexts["folder-transition-mode"].label, "crossfade")
    XCTAssertTrue(app.staticTexts["Every read leaves a trail."].waitForExistence(timeout: 5))
    let archive = app.buttons["folder-archive"]
    if !archive.isHittable { strip.swipeLeft() }
    archive.tap()
    XCTAssertTrue(archive.isSelected)
    XCTAssertEqual(app.staticTexts["folder-transition-mode"].label, "crossfade")
    swipeLibrary(app, left: false)
    XCTAssertTrue(history.isSelected)
    let downloaded = app.buttons["folder-downloaded"]
    for _ in 0..<5 { if downloaded.isHittable { break }; strip.swipeRight() }
    downloaded.tap()
    XCTAssertTrue(downloaded.isSelected)
    XCTAssertEqual(app.staticTexts["folder-transition-mode"].label, "crossfade")
    XCTAssertTrue(app.buttons["article-cached-0"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.buttons["article-cached-0"].frame.minX, originalCard.minX, accuracy: 1)
    XCTAssertEqual(app.buttons["article-cached-0"].frame.minY, originalCard.minY, accuracy: 1)
    XCTAssertEqual(downloaded.frame.minY, originalHeader, accuracy: 1)
    let saved = app.buttons["folder-saved"]
    if !saved.isHittable { strip.swipeRight() }
    saved.tap()
    XCTAssertTrue(saved.isSelected)
    XCTAssertEqual(app.staticTexts["folder-transition-mode"].label, "crossfade")
    XCTAssertTrue(app.buttons["article-cached-0"].exists)
    capture(app, "library-after-distant-and-nearby-jumps")
  }

  @MainActor func testShareExtensionSavesToLibrary() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-share-fixture", "-test-tagging"]
    app.launch()
    let save = openShareFixture(app)
    let footerY = save.frame.midY
    let card = app.descendants(matching: .any).matching(identifier: "share-preview-card").firstMatch
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    let previewTitle = app.staticTexts["share-preview-title"]
    XCTAssertTrue(previewTitle.waitForExistence(timeout: 5))
    let revealed = expectation(
      for: NSPredicate(format: "hittable == true"), evaluatedWith: previewTitle)
    wait(for: [revealed], timeout: 5)
    XCTAssertEqual(save.frame.midY, footerY, accuracy: 2)
    XCTAssertLessThan(previewTitle.frame.maxY, save.frame.minY)
    expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: save)
    waitForExpectations(timeout: 10)
    let artwork = expectation(for: NSPredicate(format: "value == 'image'"), evaluatedWith: card)
    wait(for: [artwork], timeout: 10)
    XCTAssertEqual(save.frame.midY, footerY, accuracy: 2)
    let tags = app.descendants(matching: .any).matching(identifier: "share-added-tags").firstMatch
    expectation(for: NSPredicate(format: "value == 'presented'"), evaluatedWith: tags)
    waitForExpectations(timeout: 10)
    XCTAssertTrue(app.staticTexts["Attention"].exists)
    XCTAssertTrue(app.staticTexts["Life"].exists)
    XCTAssertLessThan(card.frame.height, 400)
    let surface = app.descendants(matching: .any).matching(identifier: "share-article-card").firstMatch
    XCTAssertTrue(surface.exists)
    XCTAssertLessThan(tags.frame.maxY, surface.frame.minY)
    capture(app, "share-tags-before-save")
    let previewHeight = card.frame.height
    save.tap()
    let done = app.buttons["share-done"]
    XCTAssertTrue(done.waitForExistence(timeout: 5))
    XCTAssertEqual(tags.value as? String, "presented")
    XCTAssertEqual(card.frame.height, previewHeight, accuracy: 2)
    XCTAssertEqual(done.frame.midY, footerY, accuracy: 2)
    capture(app, "share-magic-tags")
    done.tap()
    // Match the real Safari flow: finish sharing, then foreground Arctic.
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 5))
  }

  @MainActor private func openShareFixture(_ app: XCUIApplication) -> XCUIElement {
    app.buttons["share-fixture"].tap()
    let articles = app.cells["Arctic"]
    if !articles.waitForExistence(timeout: 3) {
      let more = app.cells["More"]
      XCTAssertTrue(more.waitForExistence(timeout: 5), app.debugDescription)
      more.tap()
    }
    XCTAssertTrue(articles.waitForExistence(timeout: 5), app.debugDescription)
    articles.tap()
    let save = app.buttons["share-save"]
    XCTAssertTrue(save.waitForExistence(timeout: 10), app.debugDescription)
    waitEnabled(save)
    return save
  }

  @MainActor func testCancelPreparedShareDoesNotSaveTagsOrArticle() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-share-fixture", "-test-tagging"]
    app.launch()
    let save = openShareFixture(app)
    expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: save)
    waitForExpectations(timeout: 10)
    XCTAssertTrue(app.staticTexts["Attention"].waitForExistence(timeout: 5))
    app.buttons["share-cancel"].tap()
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launch()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
  }

  @MainActor func testShareSaveBeforeMetadataStillFinishesTags() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-share-fixture", "-test-tagging", "-share-wait-context",
    ]
    app.launch()
    let save = openShareFixture(app)
    XCTAssertEqual(save.value as? String, "loading-context")
    save.tap()
    let tags = app.descendants(matching: .any).matching(identifier: "share-added-tags").firstMatch
    expectation(for: NSPredicate(format: "value == 'presented'"), evaluatedWith: tags)
    waitForExpectations(timeout: 15)
    app.buttons["share-done"].tap()
    XCUIDevice.shared.press(.home)
    app.activate()
    XCTAssertTrue(app.buttons["article-story"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
  }

  @MainActor func testShareWithoutMatchingTagsDoesNotReserveEmptySpace() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-share-fixture", "-test-tagging", "-share-empty-tags",
    ]
    app.launch()
    let save = openShareFixture(app)
    let card = app.descendants(matching: .any).matching(identifier: "share-preview-card").firstMatch
    expectation(for: NSPredicate(format: "value == 'image'"), evaluatedWith: card)
    waitForExpectations(timeout: 10)
    let height = card.frame.height
    // Image (154), two title lines and their source/padding; no blank tag region.
    XCTAssertLessThan(height, 310)
    let footerY = save.frame.midY
    expectation(for: NSPredicate(format: "value == 'ready'"), evaluatedWith: save)
    waitForExpectations(timeout: 10)
    save.tap()
    let done = app.buttons["share-done"]
    XCTAssertTrue(done.waitForExistence(timeout: 5))
    XCTAssertEqual(card.frame.height, height, accuracy: 2)
    XCTAssertEqual(done.frame.midY, footerY, accuracy: 2)
    XCTAssertFalse(
      app.descendants(matching: .any).matching(identifier: "share-added-tags").firstMatch.exists)
    capture(app, "share-no-empty-tag-reservation")
    done.tap()
  }

  @MainActor func testShareExtensionReadsAppKeychainAccessProbe() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-share-fixture", "-share-keychain-probe",
    ]
    app.launch()
    _ = openShareFixture(app)
    let probe = app.staticTexts["share-keychain-probe"]
    XCTAssertTrue(probe.waitForExistence(timeout: 5))
    XCTAssertEqual(probe.label, "keychain-probe:available")
    app.buttons["share-cancel"].tap()
    app.terminate()
    app.launchArguments = ["-ui-testing", "-clear-share-keychain-probe"]
    app.launch()
  }

  @MainActor func testViewportPreparesCachedReadersBeforeTap() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
      "-test-preloading", "-articles-offline", "-disable-preloading",
    ]
    app.launch()
    app.buttons["article-cached-0"].tap()
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "cold")
    let unicode = "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
    XCTAssertTrue(app.webViews.staticTexts[unicode].waitForExistence(timeout: 10))
    capture(app, "legacy-utf8-cached-reader")
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-preloading", "-articles-offline"]
    app.launch()
    let ready = app.staticTexts["preload-ready"]
    expectation(for: NSPredicate(format: "label CONTAINS 'cached-0'"), evaluatedWith: ready)
    waitForExpectations(timeout: 15)
    let requested = app.staticTexts["preload-requested"]
    XCTAssertFalse(requested.label.contains("cached-11"))
    app.buttons["article-cached-0"].tap()
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "prepared")
    XCTAssertTrue(app.webViews.staticTexts[unicode].waitForExistence(timeout: 5))
    XCTAssertFalse(app.alerts["Could not open article"].exists)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    for _ in 0..<3 { app.swipeUp() }
    expectation(for: NSPredicate(format: "label CONTAINS 'cached-11'"), evaluatedWith: ready)
    waitForExpectations(timeout: 15)
    XCTAssertFalse(requested.label.split(separator: ",").contains("cached-0"))
    let lastCard = app.buttons["article-cached-11"]
    for _ in 0..<6 {
      if lastCard.exists && lastCard.isHittable
        && lastCard.frame.midY < app.searchFields.firstMatch.frame.minY - 60
      {
        break
      }
      app.swipeUp()
    }
    XCTAssertTrue(lastCard.isHittable)
    lastCard.tap()
    XCTAssertTrue(app.buttons["reader-notes"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["reader-open-state"].label, "prepared")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.searchFields.firstMatch.tap()
    app.searchFields.firstMatch.typeText("cached-7")
    expectation(for: NSPredicate(format: "label == 'cached-7'"), evaluatedWith: requested)
    waitForExpectations(timeout: 5)
    capture(app, "viewport-preloaded-search")
  }

  @MainActor func testThousandArticleLibrarySearchAndViewport() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-long-list",
      "-test-preloading", "-articles-offline",
    ]
    app.launch()
    XCTAssertTrue(app.buttons["article-import-999"].waitForExistence(timeout: 10))
    let requested = app.staticTexts["preload-requested"]
    expectation(for: NSPredicate(format: "label CONTAINS 'import-999'"), evaluatedWith: requested)
    waitForExpectations(timeout: 10)
    XCTAssertLessThanOrEqual(requested.label.split(separator: ",").count, 10)
    XCTAssertFalse(requested.label.split(separator: ",").contains("import-0"))
    for _ in 0..<4 { app.swipeUp() }
    let search = app.searchFields.firstMatch
    search.tap()
    search.typeText("import-217")
    XCTAssertTrue(app.buttons["article-import-217"].waitForExistence(timeout: 5))
    expectation(for: NSPredicate(format: "label == 'import-217'"), evaluatedWith: requested)
    waitForExpectations(timeout: 5)
    capture(app, "thousand-article-search")
    app.buttons["close"].tap()
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline"]
    app.launch()
    XCTAssertTrue(app.buttons["article-import-999"].waitForExistence(timeout: 5))
  }

  @MainActor func testUnicodeAndNativeCopyInReaderAndWebsite() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance"]
    app.launch()
    add("https://fixture.example/unicode", to: app)
    let text = "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
    for reader in [true, false] {
      app.buttons["article-unicode"].tap()
      showReader(app)
      if !reader { app.buttons["reader-toggle"].tap() }
      let paragraph = app.webViews.staticTexts[text].firstMatch
      XCTAssertTrue(paragraph.waitForExistence(timeout: 10))
      XCTAssertTrue(paragraph.isHittable)
      paragraph.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).press(forDuration: 1.2)
      let copy = app.menuItems["Copy"]
      XCTAssertTrue(copy.waitForExistence(timeout: 5), app.debugDescription)
      capture(app, reader ? "reader-copy-menu" : "website-copy-menu")
      copy.tap()
      app.navigationBars.buttons.element(boundBy: 0).tap()
      let search = app.searchFields.firstMatch
      search.tap()
      search.press(forDuration: 1.2)
      let paste = app.menuItems["Paste"]
      XCTAssertTrue(paste.waitForExistence(timeout: 5), app.debugDescription)
      paste.tap()
      let value = search.value as? String ?? ""
      XCTAssertFalse(value.isEmpty)
      XCTAssertTrue(text.localizedCaseInsensitiveContains(value), value)
      app.buttons["close"].tap()
    }
  }

  /// Opt-in smoke check. Publisher/network failures must not affect the local suite.
  @MainActor func testLiveArticle() throws {
    let url = ProcessInfo.processInfo.environment["ARTICLE_READER_LIVE_URL"] ?? ""
    try XCTSkipIf(url.isEmpty, "Set TEST_RUNNER_ARTICLE_READER_LIVE_URL to check a live site.")
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    add(url, to: app)
    let card = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'article-'"))
      .firstMatch
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    // The browser readiness check follows real page load, including its subframes.
    card.tap()
    waitEnabled(app.buttons["reader-toggle"])
    capture(app, "live-browser")
    showReader(app)
    capture(app, "live-reader")
    if let title = ProcessInfo.processInfo.environment["ARTICLE_READER_LIVE_TITLE"] {
      XCTAssertTrue(app.webViews.staticTexts[title].firstMatch.waitForExistence(timeout: 15), app.debugDescription)
      // Reopen the real extraction with networking disabled, not a fixture.
      app.terminate()
      app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline", "-disable-preloading"]
      app.launch()
      XCTAssertTrue(card.waitForExistence(timeout: 10))
      card.tap()
      showReader(app)
      XCTAssertTrue(app.webViews.staticTexts[title].firstMatch.waitForExistence(timeout: 10))
      capture(app, "live-reader-offline-reopen")
    }
    app.navigationBars.buttons.element(boundBy: 0).tap()
    capture(app, "live-library")
  }

  @MainActor private func showReader(_ app: XCUIApplication) {
    let toggle = app.buttons["reader-toggle"]
    waitEnabled(toggle)
    if toggle.label == "Reader" { toggle.tap() }
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
  }

  @MainActor private func waitEnabled(_ element: XCUIElement) {
    let ready = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: element)
    wait(for: [ready], timeout: 30)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
