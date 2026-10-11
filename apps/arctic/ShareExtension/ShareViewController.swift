import ImageIO
import LinkPresentation
import OSLog
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Hosts a native sheet with a stable bottom action row. Its detent follows the
/// preview's measured height, so the card unfolds upward without moving Save.
final class ShareViewController: UIViewController, UISheetPresentationControllerDelegate {
  private var didPresent = false
  private weak var savePanel: SaveArticleViewController?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewIsAppearing(_ animated: Bool) {
    super.viewIsAppearing(animated)
    // iOS 26 wraps the extension root. Only the presented sheet is opaque.
    var wrapper: UIView? = view
    while let current = wrapper {
      current.backgroundColor = .clear
      wrapper = current.superview
    }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didPresent, let context = extensionContext else { return }
    didPresent = true
    let panel = SaveArticleViewController(context: context)
    savePanel = panel
    panel.modalPresentationStyle = .pageSheet
    if let sheet = panel.sheetPresentationController {
      sheet.detents = [
        .custom(identifier: .init("save-article")) { [weak panel] context in
          min(panel?.contentHeight ?? 260, context.maximumDetentValue)
        }
      ]
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
      sheet.prefersEdgeAttachedInCompactHeight = true
      sheet.delegate = self
    }
    present(panel, animated: true)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    savePanel?.cancelWork()
    extensionContext?.completeRequest(returningItems: nil)
  }
}

private final class SaveArticleViewController: UIHostingController<ShareSaveView> {
  private let model: ShareSaveModel
  fileprivate var contentHeight: CGFloat = 260
  private var pendingHeight: CGFloat?

  init(context: NSExtensionContext) {
    let model = ShareSaveModel(context: context)
    self.model = model
    super.init(rootView: ShareSaveView(model: model))
    // Extension host notifications are the reliable lifecycle source here; this
    // UIKit-hosted subtree does not own a SwiftUI App scene.
    NotificationCenter.default.addObserver(
      self, selector: #selector(hostDidBecomeActive),
      name: .NSExtensionHostDidBecomeActive, object: context)
    NotificationCenter.default.addObserver(
      self, selector: #selector(hostWillResignActive),
      name: .NSExtensionHostWillResignActive, object: context)
    model.heightDidChange = { [weak self] height in
      self?.scheduleResize(to: height)
    }
  }

  @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("Use init(context:)") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    view.accessibilityIdentifier = "share-content"
    model.start()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    model.isVisible = true
  }

  override func viewWillDisappear(_ animated: Bool) {
    model.isVisible = false
    super.viewWillDisappear(animated)
  }

  @objc private func hostDidBecomeActive() { model.hostIsActive = true }
  @objc private func hostWillResignActive() { model.hostIsActive = false }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || presentingViewController == nil { cancelWork() }
  }

  func cancelWork() { model.cancelWork() }

  private func scheduleResize(to height: CGFloat) {
    let alreadyScheduled = pendingHeight != nil
    pendingHeight = height
    guard !alreadyScheduled else { return }
    // Coalesce body/footer measurements from one layout pass into one detent
    // update; never animate the sheet again for each intermediate measurement.
    DispatchQueue.main.async { [weak self] in
      guard let self, let height = self.pendingHeight else { return }
      self.pendingHeight = nil
      self.resize(to: height)
    }
  }

  private func resize(to height: CGFloat) {
    let height = max(240, height + 28)
    guard abs(height - contentHeight) > 1 else { return }
    contentHeight = height
    guard let sheet = sheetPresentationController else { return }
    let updateDetent = {
      sheet.detents = [
        .custom(identifier: .init("save-article")) { context in
          min(height, context.maximumDetentValue)
        }
      ]
      sheet.selectedDetentIdentifier = .init("save-article")
    }
    if UIAccessibility.isReduceMotionEnabled || !model.isVisible {
      updateDetent()
    } else {
      sheet.animateChanges(updateDetent)
    }
  }
}

/// Metadata and classification start while the user reviews the preview. Results
/// stay in memory until Save commits the inbox entry; Cancel leaves no article
/// or tagging receipt behind. Artwork never blocks classification.
@MainActor
private final class ShareSaveModel: ObservableObject {
  @Published var url: URL?
  @Published var title: String?
  @Published var image: UIImage?
  @Published var isSaved = false
  @Published var isTagging = false
  @Published private(set) var isLoadingContext = false
  @Published private(set) var taggingState = "idle"
  #if DEBUG
    @Published private(set) var keychainProbeStatus: String?
  #endif
  @Published var isVisible = false
  @Published var hostIsActive = true
  @Published var tagNames: [String]?
  @Published var tagFeedbackPresented = false
  @Published var message: String?
  @Published var error: String?
  var heightDidChange: ((CGFloat) -> Void)?
  private var bodyHeight: CGFloat = 0
  private var footerHeight: CGFloat = 80

  private let context: NSExtensionContext
  /// Exists only once a fetch starts. Cancelling a provider that never started
  /// calls its missing completion handler and crashes the extension.
  private var metadataProvider: LPMetadataProvider?
  private var linkTask: Task<Void, Never>?
  private var previewTask: Task<Void, Never>?
  private var metadataTask: Task<Void, Never>?
  private var thumbnailTask: Task<Void, Never>?
  private var taggingTask: Task<Void, Never>?
  private var imageLoadProgress: Progress?
  private var pendingTaggingResult: SharedTaggingResult?
  private var savedTransfer: SharedArticleTransfer?
  private var taggingContext: TaggingContext?
  private var classification: Classification?
  private var taggingRevision: String?
  private let logger = Logger(subsystem: "com.zsheng.ArticleReader", category: "ShareTagging")

  private func record(_ stage: String) {
    taggingState = stage
    TaggingPreferences.lastShareStatus = stage
    logger.info("Share tagging: \(stage, privacy: .public)")
  }

  private struct TaggingContext {
    var title: String
    var subtitle: String
    var text: String
  }

  private struct Classification {
    var context: TaggingContext
    var tags: [String]
    var credentialRevision: String
  }

  private var isFixture: Bool {
    #if DEBUG
      return url?.host == "fixture.example"
    #else
      return false
    #endif
  }

  var isPreparingTags: Bool {
    isTagging || (isLoadingContext && (isFixture || TaggingPreferences.enabled))
  }

  private func accepts(_ revision: String) -> Bool {
    isFixture
      || (TaggingPreferences.enabled && !TaggingPreferences.credentialFailure
        && TaggingPreferences.credentialRevision == revision)
  }

  init(context: NSExtensionContext) {
    self.context = context
  }

  func start() { linkTask = Task { await readLink() } }

  func measureBody(_ height: CGFloat) {
    guard abs(bodyHeight - height) > 0.5 else { return }
    bodyHeight = height
    heightDidChange?(bodyHeight + footerHeight)
  }

  func measureFooter(_ height: CGFloat) {
    guard abs(footerHeight - height) > 0.5 else { return }
    footerHeight = height
    heightDidChange?(bodyHeight + footerHeight)
  }

  private func readLink() async {
    let items = context.inputItems as? [NSExtensionItem] ?? []
    for provider in items.flatMap({ $0.attachments ?? [] }) {
      for type in [UTType.url.identifier, UTType.plainText.identifier]
      where provider.hasItemConformingToTypeIdentifier(type) {
        let item = try? await provider.loadItem(forTypeIdentifier: type, options: nil)
        guard !Task.isCancelled else { return }
        let text = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
        guard let url = SharedInbox.webURL(text) else { continue }
        self.url = url
        record("loading-context")
        #if DEBUG
          if url.query == "keychain_probe" {
            keychainProbeStatus = JevKeychain.shareAccessProbeStatus()
          }
        #endif
        previewTask = Task { await loadPreview(for: url) }
        isLoadingContext = true
        metadataTask = Task { await loadTaggingContext(for: url) }
        return
      }
    }
    error = "No article link found. Share a link from Safari, Chrome, or another app."
  }

  private func loadPreview(for url: URL) async {
    do {
      #if DEBUG
        // The reserved fixture host makes the actual extension reveal testable
        // without publisher timing. This path is absent from release builds.
        if url.host == "fixture.example" {
          try await Task.sleep(for: .milliseconds(250))
          try Task.checkCancellation()
          title = "The quiet art of paying attention"
          try await Task.sleep(for: .milliseconds(1250))
          try Task.checkCancellation()
          image = Self.fixtureImage()
          return
        }
      #endif
      let fetcher = LPMetadataProvider()
      fetcher.timeout = 8
      metadataProvider = fetcher
      let metadata = try await fetcher.startFetchingMetadata(for: url)
      guard !Task.isCancelled else { return }
      let candidate = metadata.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !candidate.isEmpty && candidate != url.absoluteString { title = candidate }
      guard let provider = metadata.imageProvider else { return }
      // A slow image provider must not hold up classification.
      thumbnailTask = Task { await loadThumbnail(from: provider) }
    } catch {
      // A publisher can refuse previews. The original URL remains saveable.
    }
  }

  private func loadTaggingContext(for url: URL) async {
    defer { isLoadingContext = false }
    do {
      #if DEBUG
        if isFixture {
          // Hold context until Save to test the real early-save path deterministically.
          if url.query == "wait_for_save" {
            while !isSaved { try await Task.sleep(for: .milliseconds(50)) }
          }
          try await Task.sleep(for: .milliseconds(250))
          try Task.checkCancellation()
          taggingContext = TaggingContext(
            title: "The quiet art of paying attention",
            subtitle: "An essay on attention, meaning, and the natural world.",
            text: "An essay on attention, meaning, and the natural world.")
          startClassification()
          return
        }
      #endif
      let metadata = try await ArticleMetadata.fetch(url)
      try Task.checkCancellation()
      taggingContext = TaggingContext(
        title: metadata.title, subtitle: metadata.description, text: metadata.taggingText)
      if title == nil { title = metadata.title }
    } catch is CancellationError {
      return
    } catch {
      // Some publishers block HTML fetches but permit Link Presentation. Use
      // that title only after richer context has proved unavailable.
      await previewTask?.value
      guard !Task.isCancelled else { return }
      guard let title else {
        record("context-unavailable")
        message = "Could not read this page. Open it in Arctic to add tags."
        return
      }
      record("using-preview-title")
      taggingContext = TaggingContext(title: title, subtitle: "", text: "")
    }
    startClassification()
  }

  private func loadThumbnail(from provider: NSItemProvider) async {
    do {
      let data: Data? = try await withCheckedThrowingContinuation { continuation in
        imageLoadProgress = provider.loadDataRepresentation(
          forTypeIdentifier: UTType.image.identifier
        ) {
          data, error in
          if let error {
            continuation.resume(throwing: error)
          } else {
            continuation.resume(returning: data)
          }
        }
      }
      guard !Task.isCancelled, let data else { return }
      // Decode at preview size off the main actor. An undecoded full-size image
      // can otherwise stall the first frame that places it in the card.
      let decode = Task.detached(priority: .userInitiated) { () -> CGImage? in
        guard data.count <= 15_000_000,
          let source = CGImageSourceCreateWithData(
            data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          !Task.isCancelled
        else { return nil }
        return CGImageSourceCreateThumbnailAtIndex(
          source, 0,
          [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 800,
            kCGImageSourceShouldCacheImmediately: true,
          ] as CFDictionary)
      }
      let thumbnail = await withTaskCancellationHandler {
        await decode.value
      } onCancel: {
        decode.cancel()
      }
      guard !Task.isCancelled, let thumbnail else { return }
      image = UIImage(cgImage: thumbnail)
    } catch {
      // Preview artwork is optional; metadata-based tagging can already proceed.
    }
  }

  #if DEBUG
    private static func fixtureImage() -> UIImage {
      let size = CGSize(width: 640, height: 320)
      return UIGraphicsImageRenderer(size: size).image { context in
        let colours = [UIColor.systemGray6.cgColor, UIColor.systemGray4.cgColor] as CFArray
        if let gradient = CGGradient(
          colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colours,
          locations: [0, 1])
        {
          context.cgContext.drawLinearGradient(
            gradient, start: .zero,
            end: CGPoint(x: size.width, y: size.height), options: [])
        }
        let leaf = UIImage(systemName: "leaf.fill")?
          .withTintColor(.secondaryLabel, renderingMode: .alwaysOriginal)
        leaf?.draw(in: CGRect(x: 275, y: 115, width: 90, height: 90))
      }
    }
  #endif

  func save() {
    guard !isSaved, let url else { return }
    do {
      savedTransfer = try SharedInbox.save(
        url, title: taggingContext?.title ?? title, subtitle: taggingContext?.subtitle,
        taggingText: taggingContext?.text)
      isSaved = true
      error = nil
      UIAccessibility.post(notification: .announcement, argument: "Saved to Arctic")
      if let classification, accepts(classification.credentialRevision) {
        try publish(classification)
        return
      }
      // A changed key or disabled setting must not reuse speculative results.
      classification = nil
      tagNames = nil
      tagFeedbackPresented = false
      pendingTaggingResult = nil
      if let taggingRevision, !accepts(taggingRevision) {
        taggingTask?.cancel()
        taggingTask = nil
        isTagging = false
        taggingState = "idle"
      }
      startClassification()
    } catch { self.error = error.localizedDescription }
  }

  private func startClassification() {
    guard taggingTask == nil, classification == nil, let taggingContext else { return }
    guard isFixture || TaggingPreferences.enabled else {
      record("disabled")
      return
    }
    guard isFixture || !TaggingPreferences.credentialFailure else {
      record("credentials-paused")
      message = "Update your API key in Arctic to add tags."
      return
    }
    let revision = TaggingPreferences.credentialRevision
    taggingRevision = revision
    isTagging = true
    record("started")
    taggingTask = Task { await classify(taggingContext, revision: revision) }
  }

  private func classify(_ input: TaggingContext, revision: String) async {
    defer {
      // An older, cancelled request must not reset a replacement request.
      if taggingRevision == revision {
        isTagging = false
        taggingTask = nil
      }
    }
    do {
      let tags: [String]
      #if DEBUG
        if isFixture {
          try await Task.sleep(for: .milliseconds(650))
          switch url?.query {
          case "no_tags": tags = []
          case "long_tags": tags = ["Attention", "Life", "Technology and Society"]
          default: tags = ["Attention", "Life"]
          }
        } else {
          guard let key = try JevKeychain.read(), !key.isEmpty else {
            record("keychain-missing")
            message = "Arctic could not find your API key. Open Arctic to check automatic tags."
            return
          }
          tags = try await JevClient.classify(
            title: input.title, description: input.text, apiKey: key)
        }
      #else
        guard let key = try JevKeychain.read(), !key.isEmpty else {
          record("keychain-missing")
          message = "Arctic could not find your API key. Open Arctic to check automatic tags."
          return
        }
        tags = try await JevClient.classify(
          title: input.title, description: input.text, apiKey: key)
      #endif
      try Task.checkCancellation()
      guard accepts(revision) else {
        record("credentials-changed")
        return
      }
      let result = Classification(context: input, tags: tags, credentialRevision: revision)
      classification = result
      tagNames = tags
      tagFeedbackPresented = false
      UIAccessibility.post(
        notification: .announcement,
        argument: tags.isEmpty
          ? "No matching tags" : "Suggested tags: " + tags.joined(separator: ", "))
      record("ready")
      if isSaved { try publish(result) }
    } catch is CancellationError {
      // Cancel discards speculative work; a saved entry remains available to the app.
    } catch JevError.keychain(let status) {
      record("keychain-error:\(status)")
      message = "Share could not access the API key. Open Arctic to check automatic tags."
    } catch JevError.invalidKey {
      record("invalid-key")
      guard TaggingPreferences.credentialRevision == revision else { return }
      TaggingPreferences.credentialFailure = true
      TaggingPreferences.lastError = JevError.invalidKey.localizedDescription
      message = "Update your API key in Arctic to add tags."
    } catch let error as URLError {
      record("network-error:\(error.code.rawValue)")
      message =
        error.code == .timedOut
        ? "Tagging timed out. Open Arctic to retry."
        : "Could not reach Jev. Open Arctic to retry."
    } catch JevError.unavailable(let status) {
      record("service-error:\(status)")
      message = "Jev is unavailable. Open Arctic to retry."
    } catch JevError.invalidResponse {
      record("invalid-response")
      message = "Jev returned an incomplete result. Open Arctic to retry."
    } catch {
      record("classification-failed")
      message = "Could not add tags. Open Arctic to retry."
    }
  }

  private func publish(_ classification: Classification) throws {
    guard let transfer = savedTransfer, accepts(classification.credentialRevision) else { return }
    let input = classification.context
    // Do not rewrite the immutable inbox entry: the app may have imported it.
    // The result carries the exact richer input used for this classification.
    let result = SharedTaggingResult(
      id: transfer.id, url: transfer.url, title: input.title, subtitle: input.subtitle,
      taggingText: input.text, tagNames: classification.tags,
      inputFingerprint: ArticleTagCatalog.identity(title: input.title, description: input.text),
      categoryVersion: ArticleTagCatalog.version, feedbackPresented: tagFeedbackPresented)
    // Commit on Save even when the reveal is unfinished. Extension termination
    // can skip dismissal callbacks; the app must still receive completed tags.
    try SharedInbox.saveTaggingResult(result)
    if !classification.tags.isEmpty && !tagFeedbackPresented { pendingTaggingResult = result }
  }

  func presentTagFeedback() {
    // The reveal can finish before Save. Carry that receipt into the later
    // committed result, without writing anything for a cancelled preview.
    guard let classification, accepts(classification.credentialRevision) else { return }
    tagFeedbackPresented = true
    guard var result = pendingTaggingResult else { return }
    result.feedbackPresented = true
    do {
      try SharedInbox.saveTaggingResult(result)
      pendingTaggingResult = nil
      tagFeedbackPresented = true
    } catch { self.error = "Could not keep these tags. Arctic will try again." }
  }

  func cancelWork() {
    // Done or swipe dismissal can precede the reveal. Keep completed tags with
    // an unpresented receipt so the app can show them once after import.
    if let result = pendingTaggingResult, let classification,
      accepts(classification.credentialRevision)
    {
      do {
        try SharedInbox.saveTaggingResult(result)
        pendingTaggingResult = nil
      } catch { self.error = "Could not keep these tags. Arctic will try again." }
    }
    isVisible = false
    linkTask?.cancel()
    previewTask?.cancel()
    metadataTask?.cancel()
    thumbnailTask?.cancel()
    taggingTask?.cancel()
    imageLoadProgress?.cancel()
    metadataProvider?.cancel()
  }

  func close() {
    cancelWork()
    context.completeRequest(returningItems: nil)
  }
}

private struct ShareSaveView: View {
  @ObservedObject var model: ShareSaveModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Label(
            model.isSaved ? "Saved to Arctic" : "Save to Arctic",
            systemImage: model.isSaved ? "checkmark.circle.fill" : "tray.and.arrow.down"
          )
          .font(.headline)
          .foregroundStyle(model.isSaved ? ArcticBrand.accent : Color.primary)
          ConnectedTagReveal(
            isProcessing: model.isPreparingTags, tags: model.tagNames ?? [],
            cornerRadius: 22, borderAroundContent: false,
            onRevealed: model.presentTagFeedback
          ) {
            VStack(spacing: 12) {
              if let tags = model.tagNames, !tags.isEmpty { tagResult(tags) }
              articleCard.overlay { ConnectedTagCardBorder() }
            }
          }
          .environment(\.scenePhase, model.isVisible && model.hostIsActive ? .active : .inactive)
          .accessibilityElement(children: .contain)
          .accessibilityIdentifier("share-preview-card")
          #if DEBUG
            .accessibilityValue(
              model.image != nil ? "image" : model.title != nil ? "title" : "link")
          #endif
          #if DEBUG
            if let probe = model.keychainProbeStatus {
              Text(probe).font(.caption).accessibilityIdentifier("share-keychain-probe")
            }
          #endif
          if model.isSaved, let message = model.message {
            Text(message).font(.subheadline).foregroundStyle(.secondary)
          }
          if let error = model.error {
            Text(error).font(.subheadline).foregroundStyle(.secondary)
              .accessibilityIdentifier("share-error")
          }
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          model.measureBody($0)
        }
      }
      .scrollBounceBehavior(.basedOnSize)
      footer
    }
    .background(Color(uiColor: .systemBackground))
  }

  private var articleCard: some View {
    VStack(alignment: .leading, spacing: 0) {
      ZStack {
        Color(uiColor: .tertiarySystemBackground)
        if let image = model.image {
          Image(uiImage: image).resizable().scaledToFill()
            .transition(.opacity)
        } else {
          Image(systemName: "photo").font(.system(size: 24, weight: .light))
            .foregroundStyle(.tertiary)
        }
      }
      .frame(height: 154).clipped().accessibilityHidden(true)
      .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: model.image != nil)
      .accessibilityIdentifier("share-artwork")
      VStack(alignment: .leading, spacing: 10) {
        Text(model.title ?? model.url?.absoluteString ?? "Reading link…")
          .font(.system(.title3, design: .serif).weight(.semibold))
          .foregroundStyle(model.title == nil ? .secondary : .primary)
          .lineLimit(2, reservesSpace: true)
          .truncationMode(model.title == nil ? .middle : .tail)
          .contentTransition(.opacity)
          .animation(.easeOut(duration: 0.18), value: model.title)
          .accessibilityIdentifier(model.title == nil ? "share-link" : "share-preview-title")
        Text(model.url?.host?.replacingOccurrences(of: "www.", with: "") ?? " ")
          .font(.caption).foregroundStyle(.secondary)
          .lineLimit(1, reservesSpace: true)
          .accessibilityIdentifier("share-source")
      }
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Color(uiColor: .secondarySystemBackground))
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("share-article-card")
    .accessibilityValue(model.isTagging ? "Finding tags" : "")
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)
    }
  }

  private func tagResult(_ tags: [String]) -> some View {
    LeadingTagFlow(spacing: 8) {
      ForEach(Array(tags.enumerated()), id: \.element) { index, tag in
        TagRevealPill(name: tag, index: index, surface: Color(uiColor: .secondarySystemBackground))
          .accessibilityIdentifier("share-tag-" + tag)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 2)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("share-added-tags")
    .accessibilityValue(model.tagFeedbackPresented ? "presented" : "revealing")
  }

  private var footer: some View {
    HStack(spacing: 12) {
      if !model.isSaved {
        Button("Cancel", action: model.close)
          .buttonStyle(ShareActionButtonStyle(primary: false))
          .accessibilityIdentifier("share-cancel")
      }
      Button(model.isSaved ? "Done" : "Save") {
        if model.isSaved { model.close() } else { model.save() }
      }
      .buttonStyle(ShareActionButtonStyle(primary: true))
      .disabled(!model.isSaved && model.url == nil)
      .accessibilityIdentifier(model.isSaved ? "share-done" : "share-save")
      .accessibilityLabel(model.isSaved ? "Done" : "Save article")
      #if DEBUG
        .accessibilityValue(model.taggingState)
      #endif
    }
    .padding(.horizontal, 24)
    .padding(.top, 8)
    .padding(.bottom, 18)
    .background(Color(uiColor: .systemBackground))
    .onGeometryChange(for: CGFloat.self) {
      $0.size.height
    } action: {
      model.measureFooter($0)
    }
  }
}

private struct ShareActionButtonStyle: ButtonStyle {
  var primary: Bool
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.body.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 54)
      .foregroundStyle(primary ? ArcticBrand.onAccent : Color.primary)
      .background(
        primary ? ArcticBrand.accent : Color(uiColor: .secondarySystemBackground), in: Capsule()
      )
      .overlay { Capsule().strokeBorder(Color.primary.opacity(primary ? 0 : 0.12), lineWidth: 1) }
      .opacity(!isEnabled ? 0.4 : configuration.isPressed ? 0.7 : 1)
      .contentShape(Capsule())
  }
}
