import UIKit
import XCTest

final class AnnotationUITests: XCTestCase {
  private let paragraph = "“Slow down,” she said — café, naïve, 日本語. Keep every character intact."
  override func setUp() { continueAfterFailure = false }

  @MainActor func testUnsavedQuotedDraftDoesNotSaveUntilExplicitHighlight() {
    let app = openFixture(saved: false)
    selectWord(in: app)
    tapSelectionAction("Add note", in: app)
    let input = messageInput(in: app)
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["annotation-quote-preview"].exists)
    expectValue("0 passages", on: app.buttons["reader-notes"])
    app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 5))
    expectValue("Not saved", on: app.buttons["reader-save"])
    expectValue("0 passages", on: app.buttons["reader-notes"])
    selectWord(in: app)
    tapSelectionAction("Save & highlight", in: app)
    XCTAssertTrue(app.buttons["highlight-colour-yellow"].waitForExistence(timeout: 5))
    expectValue("1 passage", on: app.buttons["reader-notes"])
    app.buttons["Close highlight controls"].tap()
    expectValue("Saved", on: app.buttons["reader-save"])
    reopenOffline(app)
    expectValue("1 passage", on: app.buttons["reader-notes"])
  }

  @MainActor func testQuotedNoteExplicitlySavesAndExistingNoteEditsStayUnsaved() {
    let app = openFixture(saved: false)
    selectWord(in: app)
    tapSelectionAction("Add note", in: app)
    let input = messageInput(in: app)
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.typeText("A deliberately saved quote.")
    XCTAssertEqual(app.buttons["note-send"].label, "Save & keep note")
    expectValue("0 passages", on: app.buttons["reader-notes"])
    capture(app, "unsaved-quote-explicit-send")
    app.buttons["note-send"].tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 5))
    expectValue("Saved", on: app.buttons["reader-save"])
    expectValue("1 passage", on: app.buttons["reader-notes"])
    expectRender("painted=1; marks=0; selected=0", in: app)
    app.buttons["reader-save"].tap()
    expectValue("Not saved", on: app.buttons["reader-save"])
    app.buttons["reader-notes"].tap()
    XCTAssertTrue(app.staticTexts["A deliberately saved quote."].waitForExistence(timeout: 5))
    app.buttons["Note options"].tap()
    app.buttons["Edit note"].tap()
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.press(forDuration: 1.1)
    tapSelectionAction("Select All", in: app)
    let replacement = "A deliberately saved quote. Still kept after unsaving."
    editor.typeText(replacement)
    XCTAssertEqual(editor.value as? String, replacement)
    app.buttons["annotation-save"].tap()
    XCTAssertTrue(app.staticTexts[replacement].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    expectValue("Not saved", on: app.buttons["reader-save"])
    expectValue("1 passage", on: app.buttons["reader-notes"])
  }

  @MainActor func testStandaloneNotesUnfocusResumeSendEditAndPersistOffline() {
    let app = openFixture()
    app.buttons["reader-add-note"].tap()
    let input = messageInput(in: app)
    XCTAssertTrue(input.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertFalse(app.buttons["note-send"].exists)
    XCTAssertFalse(app.buttons["note-draft-cancel"].exists)
    input.typeText("A thought about the whole article.")
    XCTAssertTrue(app.buttons["note-send"].exists)
    capture(app, "note-oblong-send-light")
    expectValue("0 passages", on: app.buttons["reader-notes"])
    app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    XCTAssertTrue(app.buttons["reader-add-note"].waitForExistence(timeout: 5))
    expectValue("0 passages", on: app.buttons["reader-notes"])
    app.buttons["reader-add-note"].tap()
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    XCTAssertEqual(input.value as? String, "A thought about the whole article.")
    app.buttons["note-send"].tap()
    XCTAssertTrue(app.buttons["reader-add-note"].waitForExistence(timeout: 5))
    expectValue("1 passage", on: app.buttons["reader-notes"])
    expectRender("painted=0; marks=0; selected=0", in: app)
    reopenOffline(app)
    app.buttons["reader-notes"].tap()
    XCTAssertTrue(
      app.staticTexts["A thought about the whole article."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["annotation-quote-preview"].exists)
    app.buttons["Note options"].tap()
    app.buttons["Edit note"].tap()
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.typeText(" A discarded edit.")
    app.buttons["annotation-cancel"].tap()
    XCTAssertTrue(
      app.staticTexts["A thought about the whole article."].waitForExistence(timeout: 5))
    app.buttons["Note options"].tap()
    app.buttons["Edit note"].tap()
    XCTAssertTrue(editor.waitForExistence(timeout: 5))
    editor.tap()
    editor.press(forDuration: 1.1)
    tapSelectionAction("Select All", in: app)
    let replacement = "A thought about the whole article. Saved deliberately."
    editor.typeText(replacement)
    XCTAssertEqual(editor.value as? String, replacement)
    app.buttons["annotation-save"].tap()
    XCTAssertTrue(app.staticTexts[replacement].waitForExistence(timeout: 5))
    capture(app, "article-note-conversation")
    app.buttons["Note options"].tap()
    XCTAssertFalse(app.buttons["Remove highlight"].exists)
    app.buttons["Delete note"].tap()
    XCTAssertTrue(app.staticTexts["No notes yet"].waitForExistence(timeout: 5))
  }

  @MainActor func testPassageCopyPreservesText() { checkPassageTextSharing(includeLink: false) }
  @MainActor func testPassageShareIncludesTextAndSourceLink() { checkPassageTextSharing(includeLink: true) }

  @MainActor private func checkPassageTextSharing(includeLink: Bool) {
    let app = openFixture()
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    app.buttons["highlight-share"].tap()
    let preview = app.otherElements["story-preview"]
    XCTAssertTrue(preview.waitForExistence(timeout: 5))
    let quote = preview.label
    if includeLink {
      app.buttons["story-share-text"].tap()
      XCTAssertTrue(app.cells["Copy"].waitForExistence(timeout: 5))
      app.cells["Copy"].tap()
    } else {
      app.buttons["story-copy-text"].tap()
      XCTAssertEqual(app.buttons["story-copy-text"].label, "Copied")
    }
    app.buttons["Done"].tap()
    app.buttons["highlight-note"].tap()
    let input = messageInput(in: app)
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    input.press(forDuration: 1.1)
    tapSelectionAction("Paste", in: app)
    XCTAssertEqual(input.value as? String,
      quote + (includeLink ? "\n\nhttps://fixture.example/unicode" : ""))
  }

  @MainActor func testMultilineHighlightNoteLight() { checkMultilineHighlightNote(dark: false) }
  @MainActor func testMultilineHighlightNoteDark() { checkMultilineHighlightNote(dark: true) }

  @MainActor private func checkMultilineHighlightNote(dark: Bool) {
    let app = openFixture(dark: dark)
    app.webViews.staticTexts[paragraph].firstMatch.tap()
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    app.buttons["highlight-note"].tap()
    let input = messageInput(in: app)
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    let bar = app.descendants(matching: .any).matching(identifier: "note-input-bar").firstMatch
    let singleHeight = bar.frame.height
    let note = "First line of a thought.\nSecond line, still readable.\nThird line at the edge.\nFourth line, ready to keep."
    input.typeText(note)
    XCTAssertEqual(input.value as? String, note)
    XCTAssertGreaterThan(bar.frame.height, singleHeight + 40)
    XCTAssertTrue(app.buttons["note-send"].isHittable)
    XCTAssertLessThanOrEqual(bar.frame.maxY, app.keyboards.firstMatch.frame.minY + 2)
    capture(app, dark ? "multiline-highlight-note-dark" : "multiline-highlight-note-light")
    app.buttons["note-send"].tap()
    XCTAssertTrue(app.buttons["reader-notes"].waitForExistence(timeout: 5))
    app.buttons["reader-notes"].tap()
    XCTAssertTrue(app.staticTexts[note].waitForExistence(timeout: 5))
  }

  @MainActor func testSelectedHighlightOpensPassageSharer() {
    let app = openFixture(dark: true)
    app.webViews.staticTexts[paragraph].firstMatch.tap()
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    let share = app.buttons["highlight-share"]
    XCTAssertTrue(share.waitForExistence(timeout: 5))
    XCTAssertTrue(share.isHittable)
    capture(app, "highlight-toolbar-with-share")
    share.tap()
    let preview = app.otherElements["story-preview"]
    XCTAssertTrue(preview.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertTrue(paragraph.contains(preview.label))
    XCTAssertFalse(preview.label.isEmpty)
    XCTAssertTrue(app.buttons["story-export"].isEnabled)
    capture(app, "selected-highlight-passage-sharer")
    app.buttons["story-export"].tap()
    XCTAssertTrue(app.cells["Copy"].waitForExistence(timeout: 10))
    app.cells["Copy"].tap()
    app.buttons["Done"].tap()
    expectValue("1 passage", on: app.buttons["reader-notes"])
    XCTAssertTrue(app.webViews.staticTexts[paragraph].firstMatch.exists)
  }

  @MainActor func testHighlightTapRecoloursAndPersistsOffline() {
    let app = openFixture(dark: true)
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    let rose = app.buttons["highlight-colour-rose"]
    XCTAssertTrue(rose.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["highlight-colour-yellow"].isSelected)
    rose.tap()
    XCTAssertTrue(rose.isSelected)
    app.buttons["highlight-note"].tap()
    let input = messageInput(in: app)
    XCTAssertTrue(input.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["annotation-quote-preview"].exists)
    input.typeText("The yellow can become rose.")
    capture(app, "quoted-note-inline-composer-dark")
    app.buttons["note-send"].tap()
    reopenOffline(app)
    let passage = app.webViews.staticTexts[paragraph].firstMatch
    passage.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(rose.waitForExistence(timeout: 5))
    XCTAssertTrue(rose.isSelected)
    app.buttons["highlight-remove"].tap()
    expectRender("painted=0; marks=0; selected=0", in: app)
    expectValue("1 passage", on: app.buttons["reader-notes"])
    app.buttons["reader-notes"].tap()
    XCTAssertTrue(app.staticTexts["The yellow can become rose."].waitForExistence(timeout: 5))
    app.buttons["Note options"].tap()
    XCTAssertFalse(app.buttons["Remove highlight"].exists)
    app.buttons["Delete note"].tap()
    XCTAssertTrue(app.staticTexts["No notes yet"].waitForExistence(timeout: 5))
  }

  @MainActor func testHighlightFocusClearsAndNewSelectionOwnsTheToolbar() {
    let app = openFixture()
    // Establish WebKit focus before asking the simulator for its native edit menu.
    app.webViews.staticTexts[paragraph].firstMatch.tap()
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    let rose = app.buttons["highlight-colour-rose"]
    XCTAssertTrue(rose.waitForExistence(timeout: 5))
    rose.tap()
    // Creation focuses natively. A tap on unmarked text must dismiss that focus.
    let second = app.webViews.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH %@", "There is a particular pleasure")
    ).firstMatch
    XCTAssertTrue(second.isHittable)
    second.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(rose.waitForNonExistence(timeout: 5))
    expectValue("1 passage", on: app.buttons["reader-notes"])

    let first = app.webViews.staticTexts[paragraph].firstMatch
    first.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(rose.waitForExistence(timeout: 5))
    XCTAssertTrue(rose.isSelected)
    // Starting another selection must also clear focus, without a prior tap-away.
    second.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).press(forDuration: 1.2)
    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5))
    XCTAssertFalse(rose.exists)
    tapSelectionAction("Highlight", in: app)
    XCTAssertTrue(app.buttons["highlight-colour-yellow"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["highlight-colour-yellow"].isSelected)
    expectValue("2 passages", on: app.buttons["reader-notes"])
    app.buttons["highlight-remove"].tap()
    expectValue("1 passage", on: app.buttons["reader-notes"])
    first.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(rose.waitForExistence(timeout: 5))
    XCTAssertTrue(rose.isSelected, "Removing the new highlight must not alter the old one")
    app.webViews.firstMatch.swipeUp()
    XCTAssertTrue(rose.waitForNonExistence(timeout: 5))
    expectValue("1 passage", on: app.buttons["reader-notes"])
  }

  @MainActor func testEmptyArticleNotesUseMediumSheetAndKeepFullMessages() {
    let app = openFixture()
    app.buttons["reader-notes"].tap()
    XCTAssertTrue(app.staticTexts["No notes yet"].waitForExistence(timeout: 5))
    XCTAssertGreaterThan(app.navigationBars["Notes"].frame.minY, app.frame.height * 0.3)
    let input = messageInput(in: app)
    XCTAssertTrue(input.exists)
    capture(app, "empty-article-notes-medium")
    input.tap()
    let note = String(repeating: "A sentence worth keeping with this article. ", count: 10)
    input.typeText(note)
    app.buttons["note-send"].tap()
    let saved = app.staticTexts.matching(
      NSPredicate(format: "label == %@", note.trimmingCharacters(in: .whitespacesAndNewlines))
    ).firstMatch
    XCTAssertTrue(saved.waitForExistence(timeout: 5))
    XCTAssertGreaterThan(saved.frame.height, 120)
    capture(app, "full-note-in-conversation")
  }

  @MainActor func testLongQuoteIsCompactReplyPreview() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard",
      "-test-long-annotation", "-dark-ui",
    ]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/long"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10))
    open.tap()
    let editor = app.textViews["annotation-note"]
    XCTAssertTrue(editor.waitForExistence(timeout: 15), app.debugDescription)
    XCTAssertEqual(editor.value as? String, "Keep the whole passage.")
    let quote = app.staticTexts["annotation-quote-preview"].firstMatch
    XCTAssertTrue(quote.exists)
    XCTAssertLessThanOrEqual(quote.frame.height, 46)
    XCTAssertFalse(app.scrollViews["annotation-quote-scroll"].exists)
    capture(app, "two-line-quote-reply-dark")
  }

  @MainActor private func messageInput(in app: XCUIApplication) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "note-message-input").firstMatch
  }

  @MainActor func testRemoveHighlightClearsReaderPaintImmediately() {
    let app = openFixture()
    XCTAssertLessThan(
      app.buttons["reader-appearance"].frame.midX, app.buttons["reader-save"].frame.midX)
    XCTAssertGreaterThan(
      app.buttons["reader-toggle"].frame.midX, app.buttons["reader-save"].frame.midX)
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    expectRender("painted=1; marks=0; selected=0", in: app)
    let passageFrame = app.webViews.staticTexts[paragraph].firstMatch.frame
    let scale = CGFloat(app.screenshot().image.cgImage!.width) / app.frame.width
    XCTAssertGreaterThan(yellowPixelCount(app.screenshot(), in: passageFrame, scale: scale), 20)
    capture(app, "highlight-before-removal")
    app.buttons["highlight-remove"].tap()
    expectValue("0 passages", on: app.buttons["reader-notes"])
    expectRender("painted=0; marks=0; selected=0", in: app)
    XCTAssertEqual(
      yellowPixelCount(app.screenshot(), in: passageFrame, scale: scale), 0,
      "WebKit must repaint after removing registered ranges")
    capture(app, "highlight-after-removal")
    XCTAssertFalse(app.buttons["highlight-colour-yellow"].exists)
  }

  /// The registry can be empty while WebKit retains yellow paint. Inspect the
  /// selected paragraph only; native controls and other article content cannot
  /// make this check pass or fail.
  private func yellowPixelCount(_ screenshot: XCUIScreenshot, in frame: CGRect, scale: CGFloat)
    -> Int
  {
    let pixelsFrame = CGRect(
      x: frame.minX * scale, y: frame.minY * scale,
      width: frame.width * scale, height: frame.height * scale)
    guard let image = screenshot.image.cgImage?.cropping(to: pixelsFrame) else { return -1 }
    let width = image.width
    let height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    return pixels.withUnsafeMutableBytes { bytes in
      guard
        let context = CGContext(
          data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
          bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
          bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )
      else { return -1 }
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
      let channels = bytes.bindMemory(to: UInt8.self)
      var count = 0
      for y in 0..<height {
        for x in 0..<width {
          let index = (y * width + x) * 4
          if channels[index] > 225 && channels[index + 1] > 180
            && channels[index + 2] < 210
            && Int(channels[index]) - Int(channels[index + 2]) > 30
          {
            count += 1
          }
        }
      }
      return count
    }
  }

  @MainActor private func expectRender(_ value: String, in app: XCUIApplication) {
    let rendered = app.staticTexts["annotation-render-state"]
    expectation(for: NSPredicate(format: "label == %@", value), evaluatedWith: rendered)
    waitForExpectations(timeout: 5)
  }

  /// The website paints and hit-tests the same records as Reader.
  @MainActor func testWebsiteHighlightIsTappableAndPaintsInReader() {
    let app = openFixture(reader: false)
    let toggle = app.buttons["reader-toggle"]
    let ready = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: toggle)
    wait(for: [ready], timeout: 20)
    XCTAssertEqual(toggle.label, "Reader", "The fixture should still show its website")
    selectPassage(in: app)
    tapSelectionAction("Highlight", in: app)
    let yellow = app.buttons["highlight-colour-yellow"]
    XCTAssertTrue(yellow.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertTrue(yellow.isSelected)
    expectRender("painted=1; marks=0; selected=0", in: app)
    capture(app, "website-highlight-toolbar")
    // Another visible paragraph clears focus; the painted passage takes it back.
    let other = app.webViews.staticTexts.matching(
      NSPredicate(format: "label BEGINSWITH %@", "There is a particular pleasure")
    ).firstMatch
    XCTAssertTrue(other.isHittable)
    other.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(yellow.waitForNonExistence(timeout: 5))
    let passage = app.webViews.staticTexts[paragraph].firstMatch
    passage.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(yellow.waitForExistence(timeout: 5))
    capture(app, "website-highlight-tapped")
    // Reader finds the website's quote in its own text.
    other.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).tap()
    XCTAssertTrue(yellow.waitForNonExistence(timeout: 5))
    showReader(app)
    expectRender("painted=1; marks=0; selected=0", in: app)
  }

  @MainActor func testReadingTimeCountsAnyArticleAndPausesForNotes() {
    let app = openFixture(saved: false)
    let state = app.staticTexts["reading-time-state"]
    func expectState(_ value: String) {
      let ready = expectation(for: NSPredicate(format: "label == %@", value), evaluatedWith: state)
      wait(for: [ready], timeout: 5)
    }
    // An unsaved article counts from the start; saving later keeps that time.
    expectState("Tracking")
    app.buttons["reader-add-note"].tap()
    expectState("Paused")
    app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    expectState("Tracking")
    app.buttons["reader-appearance"].tap()
    expectState("Paused")
    app.buttons["Done"].tap()
    expectState("Tracking")
    // Website counts too, because Reader found article text in the page.
    app.buttons["reader-toggle"].tap()
    XCTAssertTrue(app.buttons["Reader"].waitForExistence(timeout: 5))
    expectState("Tracking")
    showReader(app)
    expectState("Tracking")
    app.buttons["reader-save"].tap()
    // A lifecycle checkpoint must survive process restart, not just UI state.
    reopenOffline(app)
    app.buttons["Page options"].tap()
    app.buttons["reader-reading-time"].tap()
    let total = app.staticTexts["stats-week-total"]
    XCTAssertTrue(total.waitForExistence(timeout: 5))
    XCTAssertNotEqual(total.label, "0 min")
    app.buttons["stats-done"].tap()
    expectState("Tracking")
  }

  @MainActor private func openFixture(
    dark: Bool = false, saved: Bool = true, reader: Bool = true
  ) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-reset-appearance", "-test-clipboard",
      "-test-annotation-render", "-test-reading-time",
    ]
    if dark { app.launchArguments.append("-dark-ui") }
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/unicode"
    app.launch()
    let open = app.buttons["open-copied-link"]
    XCTAssertTrue(open.waitForExistence(timeout: 10), app.debugDescription)
    open.tap()
    let bookmark = app.buttons["reader-save"]
    XCTAssertTrue(bookmark.waitForExistence(timeout: 5))
    if saved && bookmark.value as? String == "Not saved" { bookmark.tap() }
    if reader { showReader(app) }
    return app
  }

  @MainActor private func reopenOffline(_ app: XCUIApplication) {
    app.terminate()
    app.launchArguments = [
      "-ui-testing", "-articles-offline", "-test-annotation-render", "-test-reading-time",
    ]
    app.launchEnvironment = [:]
    app.launch()
    let card = app.buttons["article-unicode"]
    XCTAssertTrue(card.waitForExistence(timeout: 10), app.debugDescription)
    card.tap()
    showReader(app)
  }

  @MainActor private func showReader(_ app: XCUIApplication) {
    let toggle = app.buttons["reader-toggle"]
    let enabled = expectation(
      for: NSPredicate(format: "exists == true AND enabled == true"), evaluatedWith: toggle)
    wait(for: [enabled], timeout: 20)
    if toggle.label == "Reader" { toggle.tap() }
    XCTAssertTrue(app.buttons["Website"].waitForExistence(timeout: 10), app.debugDescription)
    XCTAssertTrue(app.webViews.staticTexts[paragraph].firstMatch.waitForExistence(timeout: 10))
  }

  /// Pick the first text line, not a fraction of a multi-line paragraph's box.
  /// Focus and select the same word using WebKit's native edit interaction.
  @MainActor private func selectWord(in app: XCUIApplication) {
    let text = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(text.isHittable)
    let word = text.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 40, dy: 12))
    word.tap()
    word.press(forDuration: 1.2)
    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5), app.debugDescription)
  }

  @MainActor private func selectPassage(in app: XCUIApplication) {
    let text = app.webViews.staticTexts[paragraph].firstMatch
    XCTAssertTrue(text.isHittable)
    text.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)).press(forDuration: 1.2)
    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5), app.debugDescription)
  }

  @MainActor private func tapSelectionAction(_ name: String, in app: XCUIApplication) {
    for _ in 0..<4 {
      let item = app.menuItems[name]
      if item.exists && item.isHittable {
        item.tap()
        return
      }
      let button = app.buttons[name]
      if button.exists && button.isHittable {
        button.tap()
        return
      }
      let next = app.buttons["Next"].firstMatch
      let more = app.buttons["More"].firstMatch
      if next.exists && next.isHittable {
        next.tap()
      } else if more.exists && more.isHittable {
        more.tap()
      } else {
        break
      }
    }
    XCTFail("Missing selection action: \(name)\n\(app.debugDescription)")
  }

  @MainActor private func annotationRows(in app: XCUIApplication) -> XCUIElementQuery {
    app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'annotation-'"))
  }

  @MainActor private func expectValue(_ value: String, on element: XCUIElement) {
    let ready = expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
    wait(for: [ready], timeout: 5)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
