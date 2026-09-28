import XCTest

final class FavouritesUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  /// A favourite stays discoverable after archiving. Tag filtering is separate
  /// from the ordinary inbox view, and both actions survive an app relaunch.
  @MainActor func testArchivedFavouritePersistsAndTagFilterIncludesIt() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.press(forDuration: 1)
    let favourite = app.buttons["favourite-article"]
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Favourite")
    favourite.tap()
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    waitForAbsence(card)

    openFolder("folder-favourites", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    openFolder("folder-tag-Even", in: app)
    waitForAbsence(card)
    let filter = app.buttons["filter-tag-favourites"]
    XCTAssertTrue(filter.waitForExistence(timeout: 5))
    XCTAssertEqual(filter.value as? String, "Off")
    filter.tap()
    expectation(for: NSPredicate(format: "value == 'On'"), evaluatedWith: filter)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-cached-2"].exists)
    filter.tap()
    expectation(for: NSPredicate(format: "value == 'Off'"), evaluatedWith: filter)
    waitForExpectations(timeout: 5)
    waitForAbsence(card)
    XCTAssertTrue(app.buttons["article-cached-2"].waitForExistence(timeout: 5))

    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launch()
    openFolder("folder-favourites", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    let unfavourite = app.buttons["favourite-article"]
    XCTAssertTrue(unfavourite.waitForExistence(timeout: 3))
    XCTAssertEqual(unfavourite.label, "Unfavourite")
    unfavourite.tap()
    waitForAbsence(card)
    XCTAssertTrue(app.staticTexts["Worth keeping close."].waitForExistence(timeout: 5))
    openFolder("folder-archive", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5), "Unfavourite must not unarchive or delete")

    app.terminate()
    app.launch()
    openFolder("folder-favourites", in: app)
    XCTAssertTrue(app.staticTexts["Worth keeping close."].waitForExistence(timeout: 5))
    XCTAssertFalse(card.exists)
  }

  @MainActor func testReaderPageOptionsToggleFavourite() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    let options = app.buttons["Page options"]
    XCTAssertTrue(options.waitForExistence(timeout: 10))
    options.tap()
    let favourite = app.buttons["reader-favourite"]
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Favourite")
    favourite.tap()
    options.tap()
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Unfavourite")
    favourite.tap()
    options.tap()
    XCTAssertTrue(favourite.waitForExistence(timeout: 3))
    XCTAssertEqual(favourite.label, "Favourite")
    favourite.tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    openFolder("folder-favourites", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
  }

  @MainActor func testArchiveAndUnarchiveUndoSurviveReaderCloseAndRelaunch() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.tap()
    app.buttons["Page options"].tap()
    app.buttons["reader-archive-menu"].tap()
    let undo = app.buttons["archive-undo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Article archived"].exists)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "archive-undo-after-reader-close"; shot.lifetime = .keepAlways; add(shot)
    undo.tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-disable-preloading"]
    app.launch()
    XCTAssertTrue(card.waitForExistence(timeout: 10), "Undo must persist the saved membership")
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    openFolder("folder-archive", in: app)
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    app.buttons["archive-article"].tap()
    XCTAssertTrue(app.staticTexts["Returned to Saved"].waitForExistence(timeout: 5))
    undo.tap()
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    app.terminate(); app.launch()
    openFolder("folder-archive", in: app)
    XCTAssertTrue(
      card.waitForExistence(timeout: 5), "Undo Unarchive must persist archive membership")
  }

  @MainActor func testWeeklyFavouritesPersistOfflineAndOpenArticle() {
    let app = launchFixtures()
    let card = app.buttons["article-cached-0"]
    XCTAssertTrue(card.waitForExistence(timeout: 10))
    card.press(forDuration: 1)
    app.buttons["favourite-article"].tap()
    revealDiscovery(app)
    app.buttons["weekly-favourites"].tap()
    XCTAssertTrue(app.staticTexts["1 favourite · Monday to Sunday"].waitForExistence(timeout: 5))
    let picker = app.segmentedControls["weekly-collection"]
    let initialY = picker.frame.minY
    let firstArticle = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'weekly-article-' ")).firstMatch
    let articleY = firstArticle.frame.minY
    picker.buttons["All favourites"].tap()
    XCTAssertTrue(app.staticTexts["Worth keeping."].exists)
    XCTAssertEqual(picker.frame.minY, initialY, accuracy: 1)
    XCTAssertEqual(firstArticle.frame.minY, articleY, accuracy: 1)
    picker.buttons["This week"].tap()
    XCTAssertEqual(picker.frame.minY, initialY, accuracy: 1)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "weekly-favourites"; shot.lifetime = .keepAlways; add(shot)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-articles-offline", "-images-offline"]
    app.launch()
    XCTAssertTrue(app.buttons["toggle-news"].waitForExistence(timeout: 10))
    revealDiscovery(app)
    app.buttons["weekly-favourites"].tap()
    XCTAssertTrue(app.staticTexts["1 favourite · Monday to Sunday"].waitForExistence(timeout: 5))
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'weekly-article-' ")).firstMatch.tap()
    XCTAssertTrue(app.buttons["reader-toggle"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.webViews.staticTexts["“Slow down,” she said — café, naïve, 日本語. Keep every character intact."].firstMatch.waitForExistence(timeout: 10))
  }

  @MainActor func testNewsDoesNotTrapLibraryScrolling() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance",
      "-seed-long-list", "-articles-offline", "-images-offline", "-disable-preloading"]
    app.launch()
    let first = app.buttons["article-import-999"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    let initialY = first.frame.minY
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
    let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35))
    start.press(forDuration: 0.05, thenDragTo: end,
      withVelocity: .slow, thenHoldForDuration: 0.2)
    XCTAssertTrue(!first.exists || first.frame.minY < initialY - 150,
      "The list must follow an ordinary upward drag")
    for _ in 0..<4 { app.swipeUp() }
    XCTAssertFalse(first.isHittable, "Repeated swipes must move beyond the first article")
    for _ in 0..<7 { app.swipeDown() }
    XCTAssertTrue(first.isHittable, "The library must scroll back to its first article")
    revealDiscovery(app)
    for _ in 0..<4 { app.swipeUp() }
    XCTAssertFalse(first.isHittable, "The list must scroll normally after news was opened")
  }

  @MainActor func testNewsHeaderTogglesWithoutMovingLibrary() {
    checkDiscoveryMotion(reduced: false)
  }

  @MainActor func testEmptyNewsOpensWithNativePull() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-reset-appearance", "-articles-offline"]
    app.launch()
    let header = app.buttons["toggle-news"]
    XCTAssertTrue(header.waitForExistence(timeout: 10))
    XCTAssertEqual(header.value as? String, "Collapsed")
    revealDiscovery(app)
    XCTAssertEqual(header.value as? String, "Expanded")
    XCTAssertTrue(app.buttons["weekly-favourites"].isHittable)
    header.tap()
    XCTAssertFalse(app.buttons["weekly-favourites"].exists)
  }

  @MainActor func testNewsHeaderWithReduceMotion() {
    checkDiscoveryMotion(reduced: true)
  }

  @MainActor private func checkDiscoveryMotion(reduced: Bool) {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-long-list", "-articles-offline",
      "-images-offline", "-disable-preloading",
    ]
    if reduced { app.launchArguments += ["-reduce-motion", "-dark-ui"] }
    app.launch()
    let header = app.buttons["toggle-news"]
    XCTAssertTrue(header.waitForExistence(timeout: 10))
    let shelf = app.buttons["weekly-favourites"]
    XCTAssertFalse(shelf.exists)
    XCTAssertEqual(header.value as? String, "Collapsed")
    let first = app.buttons["article-import-999"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    let originalY = first.frame.minY
    let brand = app.staticTexts["library-brand-title"]
    let compactX = brand.frame.midX
    let initial = XCTAttachment(screenshot: app.screenshot())
    initial.name = reduced ? "news-compact-dark" : "news-compact-light"
    initial.lifetime = .keepAlways; add(initial)

    // A small overdrag returns through UIKit's normal bounce, without opening.
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6))
    start.press(forDuration: 0.05,
      thenDragTo: start.withOffset(CGVector(dx: 0, dy: 35)),
      withVelocity: .slow, thenHoldForDuration: 0.2)
    XCTAssertEqual(header.value as? String, "Collapsed")
    XCTAssertEqual(first.frame.minY, originalY, accuracy: 2)

    // Tap is an accessible alternative to pull; it must not move the article.
    header.tap()
    XCTAssertTrue(shelf.waitForExistence(timeout: 5))
    XCTAssertEqual(header.value as? String, "Expanded")
    XCTAssertEqual(first.frame.minY, originalY, accuracy: 2)
    XCTAssertGreaterThan(compactX - brand.frame.midX, 15)
    XCTAssertTrue(app.buttons["publisher-www.ft.com"].isHittable)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = reduced ? "news-tray-dark" : "news-tray-light"
    shot.lifetime = .keepAlways; add(shot)
    // Repeated taps always finish in one of the two usable states.
    header.tap(); header.tap(); header.tap()
    XCTAssertFalse(shelf.exists)
    XCTAssertEqual(first.frame.minY, originalY, accuracy: 2)
    revealDiscovery(app)
    XCTAssertEqual(first.frame.minY, originalY, accuracy: 2)
    app.swipeUp()
    XCTAssertFalse(shelf.exists)
    XCTAssertEqual(header.value as? String, "Collapsed")
    // Returning from below with momentum must not reopen the tray.
    app.swipeDown()
    XCTAssertFalse(shelf.exists)
    openFolder("folder-history", in: app)
    XCTAssertFalse(shelf.exists)
    openFolder("folder-saved", in: app)
    XCTAssertEqual(header.value as? String, "Collapsed")
    header.tap()
    XCTAssertTrue(shelf.waitForExistence(timeout: 5))
  }

  @MainActor private func revealDiscovery(_ app: XCUIApplication) {
    let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55))
    start.press(forDuration: 0.05,
      thenDragTo: start.withOffset(CGVector(dx: 0, dy: 200)),
      withVelocity: .slow, thenHoldForDuration: 0.2)
    XCTAssertTrue(app.buttons["weekly-favourites"].waitForExistence(timeout: 5))
  }

  @MainActor private func launchFixtures() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-seed-preload-fixtures",
      "-articles-offline", "-disable-preloading",
    ]
    app.launch()
    return app
  }

  @MainActor private func openFolder(_ identifier: String, in app: XCUIApplication) {
    let button = app.buttons[identifier]
    let strip = app.scrollViews["library-folders"]
    XCTAssertTrue(strip.waitForExistence(timeout: 5))
    for _ in 0..<5 {
      if button.exists && button.isHittable { break }
      if identifier == "folder-saved" || (button.exists && button.frame.midX < strip.frame.minX) {
        strip.swipeRight()
      } else {
        strip.swipeLeft()
      }
    }
    XCTAssertTrue(button.isHittable, "Folder should be visible: \(identifier)")
    button.tap()
    expectation(for: NSPredicate(format: "selected == true"), evaluatedWith: button)
    waitForExpectations(timeout: 5)
  }

  @MainActor private func waitForAbsence(_ element: XCUIElement) {
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
    waitForExpectations(timeout: 5)
  }
}
