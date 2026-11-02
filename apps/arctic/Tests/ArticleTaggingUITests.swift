import XCTest

final class ArticleTaggingUITests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  /// An unsave during classification must also leave no hidden tags in history.
  /// Re-save with the classifier disabled to inspect the persisted result.
  @MainActor func testUnsaveDuringTaggingDiscardsResult() {
    let app = launchTagging()
    app.buttons["open-copied-link"].tap()
    let save = app.buttons["reader-save"]
    XCTAssertTrue(save.waitForExistence(timeout: 10))
    save.tap()
    waitForQueue("tagging", in: app)
    save.tap()
    XCTAssertEqual(save.value as? String, "Not saved")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)

    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-history"].waitForExistence(timeout: 5))
    app.buttons["folder-history"].tap()
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.tap()
    XCTAssertEqual(app.buttons["reader-save"].value as? String, "Not saved")
    app.buttons["reader-save"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    app.buttons["folder-saved"].tap()
    card.press(forDuration: 1)
    app.buttons["Tags"].tap()
    XCTAssertTrue(app.textFields["tag-name"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["tag-option-Engineering"].exists)
    XCTAssertFalse(app.buttons["tag-option-Craft"].exists)
  }

  @MainActor func testDeleteDuringTaggingCannotRestoreArticle() {
    let app = launchTagging()
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 10))
    app.buttons["reader-save"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    waitForQueue("tagging", in: app)
    let card = app.buttons["article-story"]
    XCTAssertTrue(card.waitForExistence(timeout: 5))
    card.press(forDuration: 1)
    app.buttons["Remove link"].tap()
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertFalse(card.exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-tagging"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)
  }

  @MainActor func testNetworkFailureResumesOnForeground() {
    let app = launchTagging(failure: true)
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 10))
    app.buttons["reader-save"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    waitForQueue("tagging", in: app)
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertTrue(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)

    XCUIDevice.shared.press(.home)
    app.activate()
    waitForQueue("tagging", in: app)
    releaseResponse(in: app)
    XCTAssertTrue(app.buttons["edit-automatic-tags"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
  }

  /// A Safari result can precede richer page metadata. Both the shared result and
  /// the later classification must remain quiet once the extension displayed tags.
  @MainActor func testSharedTagsDoNotRepeatAfterMetadataRefreshOrRelaunch() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-test-tagging", "-test-tagging-held",
      "-test-shared-tags", "-test-shared-tags-presented",
    ]
    app.launch()
    waitForQueue("tagging", in: app)
    XCTAssertTrue(app.buttons["folder-tag-Learning & writing"].exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)

    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-tagging"]
    app.launch()
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
  }

  @MainActor func testUnfinishedSharedTagsShowMainAppFeedback() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-test-tagging", "-test-tagging-held", "-test-shared-tags",
    ]
    app.launch()
    waitForQueue("tagging", in: app)
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertTrue(app.buttons["edit-automatic-tags"].exists)
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].exists)
  }

  /// Five links shared quickly: one at a time, oldest first, with the last one
  /// shared last, and at the top of Saved.
  @MainActor func testSharedLinksAreProcessedInTheOrderTheyWereShared() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-tagging", "-test-share-queue"]
    app.launch()
    waitForOrder("queue-1 queue-2 queue-3 queue-4 queue-5", in: app)
    XCTAssertLessThan(
      app.buttons["article-queue-5"].frame.minY, app.buttons["article-queue-4"].frame.minY)
    capture(app, "share-order-newest-on-top")
  }

  /// Offline, the first link fails and the queue waits. A relaunch takes it up
  /// where it stopped, in the same order.
  @MainActor func testShareOrderSurvivesAFailureAndARelaunch() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-test-tagging", "-test-tagging-failure",
      "-test-share-queue",
    ]
    app.launch()
    waitForOrder("queue-1", in: app)
    waitForQueue("idle", in: app)
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-tagging"]
    app.launch()
    waitForOrder("queue-1 queue-2 queue-3 queue-4 queue-5", in: app)
  }

  @MainActor func testUnreadableSharedLinkDoesNotHoldUpTheLinksAfterIt() {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-test-tagging", "-test-share-queue",
      "-test-share-unreadable",
    ]
    app.launch()
    waitForOrder("queue-1 queue-2 queue-3 queue-4 queue-5", in: app)
  }

  @MainActor func testPastePreparesTagsBeforeSaveAndReusesOneRequest() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-test-tagging"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    let prepared = app.staticTexts["tagging-prepared-count"]
    expectation(for: NSPredicate(format: "label == '1'"), evaluatedWith: prepared)
    waitForExpectations(timeout: 15)
    XCTAssertEqual(app.staticTexts["tagging-request-count"].label, "1")
    let context = app.staticTexts["clipboard-preview-title"].value as? String ?? ""
    XCTAssertTrue(context.contains("On walking slowly"))
    XCTAssertTrue(context.contains("There is a particular pleasure"))
    XCTAssertFalse(context.contains("Publisher navigation"))
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    app.buttons["save-copied-link"].tap()
    XCTAssertTrue(app.buttons["edit-automatic-tags"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].exists)
    XCTAssertEqual(app.staticTexts["tagging-request-count"].label, "1")
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-tag-Engineering"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
  }

  @MainActor func testPasteOpenReusesTagsWhenSavedInReader() {
    let app = launchTagging()
    app.buttons["open-copied-link"].tap()
    let save = app.buttons["reader-save"]
    XCTAssertTrue(save.waitForExistence(timeout: 10))
    XCTAssertEqual(save.value as? String, "Not saved")
    releaseResponse(in: app)
    waitForQueue("idle", in: app)
    XCTAssertEqual(app.staticTexts["tagging-request-count"].label, "1")
    XCTAssertFalse(app.buttons["edit-automatic-tags"].exists)
    save.tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.buttons["edit-automatic-tags"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.staticTexts["tagging-request-count"].label, "1")
  }

  @MainActor func testDismissPreparedPasteDoesNotSaveTagsOrArticle() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-clipboard", "-test-tagging"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    expectation(
      for: NSPredicate(format: "label == '1'"),
      evaluatedWith: app.staticTexts["tagging-prepared-count"])
    waitForExpectations(timeout: 15)
    app.buttons["dismiss-copied-link"].tap()
    XCTAssertFalse(app.buttons["article-story"].exists)
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)
    app.terminate()
    app.launchArguments = ["-ui-testing"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.staticTexts["Your next good read."].waitForExistence(timeout: 5))
  }

  @MainActor func testManualTagRemovalAndCustomTagSurviveRelaunch() {
    let app = XCUIApplication()
    app.launchArguments = ["-ui-testing", "-reset-store", "-test-tagging", "-test-clipboard"]
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    app.buttons["open-copied-link"].tap()
    XCTAssertTrue(app.buttons["reader-save"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.buttons["reader-save"].value as? String, "Not saved")
    XCTAssertFalse(app.otherElements["tagging-notice"].exists)
    app.buttons["reader-save"].tap()
    XCTAssertTrue(app.buttons["edit-automatic-tags"].waitForExistence(timeout: 15))
    app.buttons["edit-automatic-tags"].tap()
    let tag = app.buttons["tag-option-Engineering"]
    XCTAssertTrue(tag.waitForExistence(timeout: 5))
    XCTAssertEqual(tag.value as? String, "Selected")
    tag.tap()
    app.textFields["tag-name"].tap()
    app.textFields["tag-name"].typeText("Keep")
    app.buttons["save-tags"].tap()
    app.terminate()
    app.launchArguments = ["-ui-testing", "-test-tagging"]
    app.launchEnvironment = [:]
    app.launch()
    XCTAssertTrue(app.buttons["folder-tag-Keep"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["folder-tag-Engineering"].exists)
    XCTAssertFalse(app.otherElements["tagging-notice"].exists)
  }

  @MainActor private func launchTagging(failure: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = [
      "-ui-testing", "-reset-store", "-test-clipboard", "-test-tagging",
      "-test-tagging-held",
    ]
    if failure { app.launchArguments.append("-test-tagging-failure") }
    app.launchEnvironment["TEST_CLIPBOARD"] = "https://fixture.example/story"
    app.launch()
    XCTAssertTrue(app.buttons["open-copied-link"].waitForExistence(timeout: 10))
    return app
  }

  @MainActor private func waitForOrder(_ order: String, in app: XCUIApplication) {
    let label = app.staticTexts["tagging-order"]
    XCTAssertTrue(label.waitForExistence(timeout: 10))
    let reached = expectation(
      for: NSPredicate(format: "label.length >= %d", order.count), evaluatedWith: label)
    wait(for: [reached], timeout: 20)
    XCTAssertEqual(label.label, order)
  }

  @MainActor private func capture(_ app: XCUIApplication, _ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  @MainActor private func releaseResponse(in app: XCUIApplication) {
    let release = app.buttons["finish-test-tagging"]
    XCTAssertTrue(release.waitForExistence(timeout: 5))
    let held = expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: release)
    wait(for: [held], timeout: 5)
    release.tap()
  }

  @MainActor private func waitForQueue(_ state: String, in app: XCUIApplication) {
    let status = app.staticTexts["tagging-test-state"]
    XCTAssertTrue(status.waitForExistence(timeout: 5))
    let changed = expectation(for: NSPredicate(format: "label == %@", state), evaluatedWith: status)
    wait(for: [changed], timeout: 15)
  }
}
