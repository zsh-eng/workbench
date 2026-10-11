import XCTest

/// Elements opens from Sort and filter and from its launch argument. The news
/// bubble specimen plays, changes state and scrubs on sample data.
final class ElementsUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  @MainActor func testMenuOpensNewsBubbleThatPlaysAndScrubs() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store"]
    app.launch()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 10))
    app.buttons["Sort and filter"].tap()
    app.buttons["show-elements"].tap()
    XCTAssertTrue(app.navigationBars["Elements"].waitForExistence(timeout: 5))
    app.buttons["elements-section-news"].tap()

    // The timeline starts by itself in view and ends on the open row.
    let readout = app.staticTexts["news-bubble-readout"]
    XCTAssertTrue(readout.waitForExistence(timeout: 5))
    wait(for: readout, labelBeginsWith: "Open distance 128.0 pt")
    XCTAssertTrue(app.buttons["weekly-favourites"].exists)

    // Choosing a state plays it.
    app.buttons["news-state-Close"].tap()
    wait(for: readout, labelBeginsWith: "Open distance 0.0 pt")
    XCTAssertFalse(app.buttons["weekly-favourites"].exists)

    // Dragging to the start of Close shows the open row again, paused.
    let scrubber = app.descendants(matching: .any)["demo-scrubber"]
    let middle = scrubber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    middle.press(
      forDuration: 0.1,
      thenDragTo: scrubber.coordinate(withNormalizedOffset: CGVector(dx: -0.2, dy: 0.5)))
    wait(for: readout, labelBeginsWith: "Open distance 128.0 pt")
    XCTAssertEqual(app.buttons["demo-play"].label, "Play")

    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "elements-news-scrubbed"
    shot.lifetime = .keepAlways
    add(shot)
    app.buttons["close-elements"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 5))
  }

  @MainActor func testLaunchArgumentOpensSectionPausedAtMoment() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-ArcticElements", "news", "-ArcticElementsState", "Close",
      "-ArcticElementsTime", "0", "-dark-ui",
    ]
    app.launch()
    let readout = app.staticTexts["news-bubble-readout"]
    XCTAssertTrue(readout.waitForExistence(timeout: 10))
    XCTAssertTrue(readout.label.hasPrefix("Open distance 128.0 pt"))
    // A deep-linked moment waits for Play.
    Thread.sleep(forTimeInterval: 1)
    XCTAssertTrue(readout.label.hasPrefix("Open distance 128.0 pt"))
    app.buttons["demo-play"].tap()
    wait(for: readout, labelBeginsWith: "Open distance 0.0 pt")
    app.buttons["close-elements"].tap()
    XCTAssertTrue(app.buttons["Sort and filter"].waitForExistence(timeout: 10))
  }

  @MainActor private func wait(for element: XCUIElement, labelBeginsWith prefix: String) {
    let matched = expectation(
      for: NSPredicate(format: "label BEGINSWITH %@", prefix), evaluatedWith: element)
    wait(for: [matched], timeout: 8)
  }
}
