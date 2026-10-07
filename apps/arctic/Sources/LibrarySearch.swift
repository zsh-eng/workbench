import CryptoKit
import ImageIO
import SwiftUI
import UIKit

/// Keep the native text field mounted during normal search transitions. A tap
/// focuses it directly; modal sheets remove the inactive hosted bar temporarily.
struct LibrarySearchChrome: ViewModifier {
  @Binding var query: String
  @Binding var active: Bool
  var obscured = false

  func body(content: Content) -> some View {
    content.readerBar(edge: .bottom) {
      if obscured {
        // iOS 26 hosts safe-area bars separately from the modal page. Remove
        // interactive descendants, but keep the same inset to prevent a jump.
        Color.clear.frame(height: 66).accessibilityHidden(true).allowsHitTesting(false)
      } else {
        HStack(spacing: 10) {
          NativeArticleSearch(query: $query, active: $active)
            .frame(height: 50).padding(.horizontal, 12).readerGlass()
          if active {
            Button {
              query = ""
              active = false
            } label: {
              Image(systemName: "xmark").frame(width: 44, height: 44)
            }.readerGlass().accessibilityLabel("Close search").accessibilityIdentifier("close")
          }
        }.padding(.horizontal, 20).padding(.vertical, 8)
      }
    }
  }
}

private struct NativeArticleSearch: UIViewRepresentable {
  @Binding var query: String
  @Binding var active: Bool

  func makeCoordinator() -> Coordinator { Coordinator(query: $query, active: $active) }
  func makeUIView(context: Context) -> UISearchTextField {
    let field = UISearchTextField()
    field.placeholder = "Search"
    field.backgroundColor = .clear
    field.borderStyle = .none
    field.font = .preferredFont(forTextStyle: .body)
    field.adjustsFontForContentSizeCategory = true
    field.autocapitalizationType = .none
    field.autocorrectionType = .no
    field.returnKeyType = .search
    field.accessibilityIdentifier = "article-search"
    field.accessibilityTraits.insert(.searchField)
    field.delegate = context.coordinator
    field.addTarget(
      context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
    return field
  }
  func updateUIView(_ field: UISearchTextField, context: Context) {
    context.coordinator.query = $query
    context.coordinator.active = $active
    if field.text != query { field.text = query }
    if !active && field.isFirstResponder { field.resignFirstResponder() }
  }
  final class Coordinator: NSObject, UITextFieldDelegate {
    var query: Binding<String>
    var active: Binding<Bool>
    init(query: Binding<String>, active: Binding<Bool>) {
      self.query = query
      self.active = active
    }
    func textFieldDidBeginEditing(_ textField: UITextField) { active.wrappedValue = true }
    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
      textField.resignFirstResponder()
      return true
    }
    @objc func changed(_ field: UITextField) { query.wrappedValue = field.text ?? "" }
  }
}

/// Cache decoded variants by display size, but share their compressed resource by
/// URL. A 58-point search image must never retain a 1,200-pixel Reader bitmap.
struct ThumbnailRequest: Hashable, Sendable {
  let url: URL
  var pixels = 960
  var key: NSString { "\(pixels):\(url.absoluteString)" as NSString }
}

@MainActor final class ThumbnailCache {
  static let shared = ThumbnailCache()
  private let images = NSCache<NSString, UIImage>()
  private let previews = NSCache<NSURL, UIImage>()
  private let decoding = PreviewImageWorkLimit(limit: 2)
  private struct Request {
    let task: Task<UIImage?, Never>
    var readers: Set<UUID>
  }
  private var pending: [ThumbnailRequest: Request] = [:]

  private init() {
    images.countLimit = 96
    images.totalCostLimit = 32 * 1024 * 1024
    previews.countLimit = 256
    previews.totalCostLimit = 1024 * 1024
  }

  func image(for url: URL?, pixels: Int = 960) -> UIImage? {
    guard let url else { return nil }
    return images.object(forKey: ThumbnailRequest(url: url, pixels: pixels).key)
  }

  @discardableResult
  func load(_ url: URL?, pixels: Int = 960, prefetch: Bool = false) async -> UIImage? {
    guard let url else { return nil }
    if let image = image(for: url, pixels: pixels) { return image }
    let key = ThumbnailRequest(url: url, pixels: pixels)
    let reader = UUID()
    let task: Task<UIImage?, Never>
    if var request = pending[key] {
      request.readers.insert(reader)
      pending[key] = request
      task = request.task
    } else {
      let decoding = self.decoding
      task = Task.detached(priority: prefetch ? .utility : .userInitiated) { () -> UIImage? in
        guard
          let bytes = await PreviewImageDisk.shared.thumbnailData(
            for: url, pixels: pixels, prefetch: prefetch),
          !Task.isCancelled, await decoding.acquire(prefetch: prefetch)
        else { return nil }
        let decoded = Task.isCancelled ? nil : PreviewImageCodec.thumbnail(bytes, pixels: pixels)
        await decoding.release()
        return decoded.map { UIImage(cgImage: $0) }
      }
      pending[key] = Request(task: task, readers: [reader])
    }
    let image = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { @MainActor in self.finish(key, reader: reader) }
    }
    finish(key, reader: reader)
    guard !Task.isCancelled else { return nil }
    if let image {
      images.setObject(
        image, forKey: key.key,
        cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
    }
    return image
  }

  /// Tiny placeholders are decoded once and kept apart from full thumbnails.
  /// The detached work never creates a network request and cannot publish after cancellation.
  func placeholder(for url: URL) async -> UIImage? {
    if let image = previews.object(forKey: url as NSURL) { return image }
    let task = Task.detached(priority: .userInitiated) { () -> UIImage? in
      guard !Task.isCancelled,
        let bytes = await PreviewImageDisk.shared.preview(for: url, regenerateFromMaster: false),
        !Task.isCancelled, let image = PreviewImageCodec.thumbnail(bytes, pixels: 24)
      else { return nil }
      return UIImage(cgImage: image)
    }
    let image = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      task.cancel()
    }
    guard !Task.isCancelled else { return nil }
    if let image {
      previews.setObject(
        image, forKey: url as NSURL, cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
    }
    return image
  }

  /// Two speculative consumers leave capacity for newly visible work. SwiftUI's
  /// viewport task owns this group; leaving the working set cancels its leases.
  func preheat(_ requests: [ThumbnailRequest]) async {
    var seen = Set<ThumbnailRequest>()
    var remaining = requests.filter { seen.insert($0).inserted }.makeIterator()
    await withTaskGroup(of: Void.self) { group in
      func enqueue(_ request: ThumbnailRequest) {
        group.addTask { await self.load(request.url, pixels: request.pixels, prefetch: true) }
      }
      for _ in 0..<2 { if let request = remaining.next() { enqueue(request) } }
      for await _ in group {
        guard !Task.isCancelled else {
          group.cancelAll()
          return
        }
        if let request = remaining.next() { enqueue(request) }
      }
    }
  }

  private func finish(_ key: ThumbnailRequest, reader: UUID) {
    guard var request = pending[key], request.readers.remove(reader) != nil else { return }
    if request.readers.isEmpty {
      request.task.cancel()
      pending[key] = nil
    } else {
      pending[key] = request
    }
  }

  func releaseMemory() {
    images.removeAllObjects()
    previews.removeAllObjects()
  }
}

struct ArticleThumbnail: View {
  private enum LoadedPart {
    case image(UIImage?)
    case preview(UIImage?)
  }
  let url: URL?
  var label = "Article preview"
  var pixels = 960
  @State private var loadedImage: UIImage?
  @State private var preview: UIImage?
  @State private var showProgress = false
  @State private var requestID = UUID()
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var body: some View {
    GeometryReader { geometry in
      Group {
        if let image = loadedImage ?? ThumbnailCache.shared.image(for: url, pixels: pixels) {
          Image(uiImage: image).resizable().scaledToFill().accessibilityLabel(label)
        } else {
          ZStack {
            ReaderTheme.secondary
            if let preview {
              Image(uiImage: preview).resizable().scaledToFill().blur(radius: 5)
            } else {
              Image(systemName: "text.alignleft")
                .font(.system(size: 20, weight: .light))
                .foregroundStyle(ReaderTheme.muted.opacity(0.5))
            }
            if showProgress && pixels > 96 {
              ThumbnailLoadingArc(reduceMotion: reduceMotion).frame(width: 24, height: 24)
                .accessibilityHidden(true)
            }
          }.accessibilityLabel("Loading " + label.lowercased())
        }
      }
      .frame(width: geometry.size.width, height: geometry.size.height).clipped()
    }
    .onDisappear {
      requestID = UUID()
      loadedImage = nil
      preview = nil
      showProgress = false
    }
    .task(id: url.map { ThumbnailRequest(url: $0, pixels: pixels) }) {
      let request = UUID()
      requestID = request
      preview = nil
      showProgress = false
      loadedImage = ThumbnailCache.shared.image(for: url, pixels: pixels)
      guard loadedImage == nil, let url else { return }
      let indicator = Task {
        do { try await Task.sleep(for: .milliseconds(250)) } catch { return }
        guard requestID == request, !Task.isCancelled else { return }
        showProgress = true
      }
      defer {
        indicator.cancel()
        if requestID == request { showProgress = false }
      }
      await withTaskGroup(of: LoadedPart.self) { group in
        // A blur is optional. Publish the useful image as soon as it is ready,
        // regardless of the preview's disk or codec work.
        group.addTask { .image(await ThumbnailCache.shared.load(url, pixels: pixels)) }
        group.addTask { .preview(await ThumbnailCache.shared.placeholder(for: url)) }
        for await part in group {
          guard requestID == request, !Task.isCancelled else {
            group.cancelAll()
            return
          }
          switch part {
          case .image(let image):
            loadedImage = image
            if image != nil {
              group.cancelAll()
              return
            }
          case .preview(let image):
            preview = image
          }
        }
      }
    }
  }
}

/// Core Animation owns the repeating arc. SwiftUI gets no per-frame state updates.
/// Reduced Motion keeps a static partial ring; detachment removes both animations.
private struct ThumbnailLoadingArc: UIViewRepresentable {
  var reduceMotion: Bool
  func makeUIView(context: Context) -> ThumbnailArcView { ThumbnailArcView() }
  func updateUIView(_ view: ThumbnailArcView, context: Context) {
    view.setReducedMotion(reduceMotion)
  }
  static func dismantleUIView(_ view: ThumbnailArcView, coordinator: ()) { view.stop() }
}

private final class ThumbnailArcView: UIView {
  private let arc = CAShapeLayer()
  private let track = CAShapeLayer()
  private var reduceMotion = false

  init() {
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    for shape in [track, arc] {
      shape.fillColor = UIColor.clear.cgColor
      shape.lineWidth = 2
      shape.lineCap = .round
      layer.addSublayer(shape)
    }
    arc.strokeEnd = 0.25
    updateColours()
    registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitAccessibilityContrast.self]) {
      (view: ThumbnailArcView, _: UITraitCollection) in view.updateColours()
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    let circle = UIBezierPath(ovalIn: bounds.insetBy(dx: 2, dy: 2)).cgPath
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for shape in [track, arc] {
      shape.frame = bounds
      shape.path = circle
    }
    CATransaction.commit()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateAnimation()
  }
  func setReducedMotion(_ value: Bool) {
    guard value != reduceMotion else { return }
    reduceMotion = value
    updateAnimation()
  }
  func stop() { arc.removeAllAnimations() }
  private func updateColours() {
    arc.strokeColor = UIColor.secondaryLabel.resolvedColor(with: traitCollection).cgColor
    track.strokeColor =
      UIColor.secondaryLabel.resolvedColor(with: traitCollection).withAlphaComponent(0.15).cgColor
  }
  private func updateAnimation() {
    guard window != nil, !reduceMotion else {
      stop()
      return
    }
    guard arc.animation(forKey: "rotation") == nil else { return }
    let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
    rotation.fromValue = 0
    rotation.toValue = Double.pi * 2
    rotation.duration = 1.4
    rotation.repeatCount = .infinity
    let length = CABasicAnimation(keyPath: "strokeEnd")
    length.fromValue = 0.12
    length.toValue = 1.0
    length.duration = 0.7
    length.autoreverses = true
    length.repeatCount = .infinity
    length.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    arc.add(rotation, forKey: "rotation")
    arc.add(length, forKey: "length")
  }
}

struct ArticleSearchRow: View {
  static let thumbnailWidth: CGFloat = 74
  static let contentSpacing: CGFloat = 10
  static let horizontalInset: CGFloat = 16
  static var textInset: CGFloat { horizontalInset + thumbnailWidth + contentSpacing }
  let article: SavedArticle
  let query: String
  @ScaledMetric(relativeTo: .body) private var thumbnailHeight = 74

  var body: some View {
    HStack(alignment: .center, spacing: Self.contentSpacing) {
      ArticleThumbnail(url: article.imageURL, pixels: 256)
        .frame(width: Self.thumbnailWidth, height: thumbnailHeight).clipShape(
          RoundedRectangle(cornerRadius: 10))
      VStack(alignment: .leading, spacing: 4) {
        Text(article.siteName)
          .font(ReaderTheme.sans(11, weight: .medium, relativeTo: .caption))
          .foregroundStyle(ReaderTheme.muted).lineLimit(1)
        SearchResultText(
          title: article.displayTitle,
          subtitle: article.subtitle.isEmpty ? article.url.absoluteString : article.subtitle,
          query: query
        )
        .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.vertical, 8)
    .padding(.horizontal, Self.horizontalInset)
    .background(ReaderTheme.background, in: RoundedRectangle(cornerRadius: 16))
    .contentShape(RoundedRectangle(cornerRadius: 16))
  }
}

/// Fit the title, not the subtitle's unbounded ideal width. One native text
/// layout chooses either one title line plus two subtitle lines, or two title
/// lines alone. Repeated SwiftUI size proposals reuse the same measurement.
struct SearchResultText: UIViewRepresentable {
  let title: String
  let subtitle: String
  let query: String
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colourScheme

  func makeUIView(context: Context) -> SearchResultTextView { SearchResultTextView() }
  func updateUIView(_ view: SearchResultTextView, context: Context) {
    view.configure(
      title: title, subtitle: subtitle, query: query,
      category: LibraryTextFormatting.category(dynamicTypeSize), colourScheme: colourScheme)
  }
  func sizeThatFits(_ proposal: ProposedViewSize, uiView: SearchResultTextView, context: Context)
    -> CGSize?
  {
    let width = proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil } ?? uiView.idealWidth
    return CGSize(width: width, height: uiView.measure(width: width).height)
  }
}

final class SearchResultTextView: UIView {
  private struct Configuration: Equatable {
    let title: String
    let subtitle: String
    let query: String
    let category: UIContentSizeCategory
    let colourScheme: ColorScheme
  }
  struct Measurement {
    let titleHeight: CGFloat
    let subtitleHeight: CGFloat
    let showsSubtitle: Bool
    var height: CGFloat { titleHeight + (showsSubtitle ? 4 + subtitleHeight : 0) }
  }
  private let titleLabel = UILabel()
  private let subtitleLabel = UILabel()
  private var configuration: Configuration?
  private var measurements: [CGFloat: Measurement] = [:]
  private(set) var idealWidth: CGFloat = 0

  init() {
    super.init(frame: .zero)
    isAccessibilityElement = false
    titleLabel.numberOfLines = 2
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.lineBreakStrategy = .pushOut
    titleLabel.textColor = .label
    subtitleLabel.numberOfLines = 2
    subtitleLabel.lineBreakMode = .byTruncatingTail
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.accessibilityIdentifier = "search-result-subtitle"
    for label in [titleLabel, subtitleLabel] {
      label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      addSubview(label)
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  func configure(
    title: String, subtitle: String, query: String,
    category: UIContentSizeCategory, colourScheme: ColorScheme
  ) {
    let next = Configuration(
      title: title, subtitle: subtitle, query: query, category: category, colourScheme: colourScheme
    )
    guard configuration != next else { return }
    configuration = next
    measurements.removeAll(keepingCapacity: true)
    titleLabel.font = LibraryTextFormatting.font(
      style: .body, pointSize: 16, weight: .medium, design: .serif, category: category)
    subtitleLabel.font = LibraryTextFormatting.font(
      style: .subheadline, pointSize: 13, weight: .regular, category: category)
    LibraryTextFormatting.apply(title, query: query, to: titleLabel)
    LibraryTextFormatting.apply(subtitle, query: query, to: subtitleLabel)
    idealWidth = ceil((title as NSString).size(withAttributes: [.font: titleLabel.font!]).width)
    setNeedsLayout()
    invalidateIntrinsicContentSize()
  }

  func measure(width: CGFloat) -> Measurement {
    if let cached = measurements[width] { return cached }
    let multiline = configuration?.title.rangeOfCharacter(from: .newlines) != nil
    let showsSubtitle =
      !multiline && idealWidth <= floor(width) && configuration?.subtitle.isEmpty == false
    let titleSize = titleLabel.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    let subtitleSize =
      showsSubtitle
      ? subtitleLabel.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)) : .zero
    let measured = Measurement(
      titleHeight: ceil(titleSize.height), subtitleHeight: ceil(subtitleSize.height),
      showsSubtitle: showsSubtitle)
    if measurements.count >= 4 { measurements.removeAll(keepingCapacity: true) }
    measurements[width] = measured
    return measured
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let measured = measure(width: bounds.width)
    titleLabel.frame = CGRect(x: 0, y: 0, width: bounds.width, height: measured.titleHeight)
    titleLabel.accessibilityIdentifier =
      measured.showsSubtitle ? "search-result-title" : "article-title-two-lines"
    subtitleLabel.isHidden = !measured.showsSubtitle
    subtitleLabel.frame = CGRect(
      x: 0, y: measured.titleHeight + 4, width: bounds.width, height: measured.subtitleHeight)
  }
}

/// Durable, bounded image storage shared by library thumbnails and Reader headers.
/// Hash URL keys, validate/decode images, and retain only a downsampled image, preserving transparency for icons.
actor PreviewImageDisk {
  static let shared = PreviewImageDisk()
  private struct Request {
    let task: Task<Data?, Never>
    var readers: Set<UUID>
  }
  private var pending: [URL: Request] = [:]
  private struct EncodedImage: Sendable {
    var bytes: Data
    var preview: Data?
  }
  private struct TransformRequest {
    let task: Task<EncodedImage?, Never>
    var readers: Set<UUID>
  }
  private enum Transform: Sendable {
    case display(Int)
    case preview
  }
  private var pendingTransforms: [URL: TransformRequest] = [:]
  // A single shared CPU budget covers master, display, preview and web encodes.
  // The disk actor only reads/writes bytes, never waits inside a synchronous codec.
  private nonisolated static let transforms = PreviewImageWorkLimit(limit: 2)
  private let work = PreviewImageWorkLimit()
  private let directory: URL

  init(directory: URL = URL.applicationSupportDirectory.appending(path: "ArticleReader/Images")) {
    self.directory = directory
  }
  private var lastTrim = Date.distantPast
  private var bytesSinceTrim = 0

  /// Persist only the app's three display sizes. Existing master images remain
  /// usable offline; derivatives are local, regenerable and share the disk budget.
  func thumbnailData(for url: URL, pixels: Int, prefetch: Bool = false) async -> Data? {
    guard [96, 256, 960].contains(pixels) else { return await data(for: url, prefetch: prefetch) }
    let file = imageFile(for: url).appendingPathExtension("thumb-v1-\(pixels)")
    if let bytes = read(file) { return bytes }
    guard !Task.isCancelled, let bytes = await data(for: url, prefetch: prefetch), !Task.isCancelled
    else { return nil }
    return await transformed(
      bytes, using: .display(pixels), at: file,
      previewAt: imageFile(for: url).appendingPathExtension("preview"), prefetch: prefetch)
  }

  private func transformed(
    _ bytes: Data, using transform: Transform, at file: URL, previewAt: URL? = nil,
    prefetch: Bool = true
  ) async -> Data? {
    if let existing = read(file) { return existing }
    let reader = UUID()
    let task: Task<EncodedImage?, Never>
    if var pending = pendingTransforms[file] {
      pending.readers.insert(reader)
      pendingTransforms[file] = pending
      task = pending.task
    } else {
      task = Task.detached(priority: .utility) {
        guard await Self.transforms.acquire(prefetch: prefetch) else { return nil }
        let encoded: EncodedImage?
        if Task.isCancelled {
          encoded = nil
        } else {
          switch transform {
          case .display(let pixels):
            if let display = PreviewImageCodec.displayThumbnail(bytes, pixels: pixels) {
              // JPEG/PNG to 24px is cheap; avoid decoding the HEIC master again.
              encoded = EncodedImage(
                bytes: display, preview: PreviewImageCodec.placeholder(display))
            } else {
              encoded = nil
            }
          case .preview:
            encoded = PreviewImageCodec.placeholder(bytes).map { EncodedImage(bytes: $0) }
          }
        }
        await Self.transforms.release()
        return Task.isCancelled ? nil : encoded
      }
      pendingTransforms[file] = TransformRequest(task: task, readers: [reader])
    }
    let result = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { await self.finishTransform(file, reader: reader) }
    }
    finishTransform(file, reader: reader)
    guard !Task.isCancelled, let result else { return nil }
    if !FileManager.default.fileExists(atPath: file.path) { store(result.bytes, at: file) }
    if let previewAt, let preview = result.preview,
      !FileManager.default.fileExists(atPath: previewAt.path)
    {
      store(preview, at: previewAt)
    }
    return result.bytes
  }

  private func finishTransform(_ file: URL, reader: UUID) {
    guard var request = pendingTransforms[file], request.readers.remove(reader) != nil else {
      return
    }
    if request.readers.isEmpty {
      request.task.cancel()
      pendingTransforms[file] = nil
    } else {
      pendingTransforms[file] = request
    }
  }

  func data(for url: URL, prefetch: Bool = false) async -> Data? {
    let file = imageFile(for: url)
    if let data = read(file) { return data }
    if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-images-offline") {
      return nil
    }
    let reader = UUID()
    let task: Task<Data?, Never>
    if var request = pending[url] {
      request.readers.insert(reader)
      pending[url] = request
      task = request.task
    } else {
      let work = self.work
      task = Task.detached(priority: .utility) { () -> Data? in
        guard await work.acquire(prefetch: prefetch) else { return nil }
        let bytes = await Self.fetch(url, prefetch: prefetch)
        await work.release()
        return bytes
      }
      pending[url] = Request(task: task, readers: [reader])
    }
    let bytes = await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      Task { await self.finish(url, reader: reader) }
    }
    finish(url, reader: reader)
    guard !Task.isCancelled else { return nil }
    guard let bytes else { return nil }
    // Concurrent size variants share one resource; only the first consumer stores it.
    guard !FileManager.default.fileExists(atPath: file.path) else { return bytes }
    store(bytes, at: file)
    return bytes
  }

  private func finish(_ url: URL, reader: UUID) {
    guard var request = pending[url], request.readers.remove(reader) != nil else { return }
    if request.readers.isEmpty {
      request.task.cancel()
      pending[url] = nil
    } else {
      pending[url] = request
    }
  }

  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpMaximumConnectionsPerHost = 3
    return URLSession(configuration: configuration)
  }()

  private nonisolated static func fetch(_ url: URL, prefetch: Bool) async -> Data? {
    guard !Task.isCancelled else { return nil }
    let file: URL
    let temporary: Bool
    if TestMode.enabled && url.isFileURL {
      file = url
      temporary = false
    } else {
      guard ["http", "https"].contains(url.scheme ?? ""),
        let (download, response) = try? await session.download(
          for: URLRequest(url: url, timeoutInterval: 8))
      else { return nil }
      guard let response = response as? HTTPURLResponse,
        (200..<300).contains(response.statusCode)
      else {
        try? FileManager.default.removeItem(at: download)
        return nil
      }
      file = download
      temporary = true
    }
    defer { if temporary { try? FileManager.default.removeItem(at: file) } }
    guard !Task.isCancelled,
      let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
      size < 15_000_000,
      let bytes = try? Data(contentsOf: file, options: .mappedIfSafe)
    else { return nil }
    guard await transforms.acquire(prefetch: prefetch) else { return nil }
    let compact = Task.isCancelled ? nil : PreviewImageCodec.compact(bytes)
    await transforms.release()
    return Task.isCancelled ? nil : compact
  }

  /// A tiny local preview is available after the first download. It does not
  /// start network work or pretend to know colours before seeing the source.
  func preview(for url: URL, regenerateFromMaster: Bool = true) async -> Data? {
    let image = imageFile(for: url)
    let preview = image.appendingPathExtension("preview")
    if let bytes = read(preview) { return bytes }
    guard !Task.isCancelled else { return nil }
    // Prefer already decoded-to-display formats. On the first visible load,
    // the full thumbnail creates its preview; don't compete with a HEIC decode.
    for pixels in [96, 256, 960] {
      if let display = read(image.appendingPathExtension("thumb-v1-\(pixels)")) {
        return await transformed(display, using: .preview, at: preview)
      }
    }
    guard regenerateFromMaster, let bytes = read(image) else { return nil }
    return await transformed(bytes, using: .preview, at: preview)
  }

  private func imageFile(for url: URL) -> URL {
    let key = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }
      .joined()
    return directory.appending(path: key + ".image")
  }

  private func read(_ file: URL) -> Data? {
    guard let bytes = try? Data(contentsOf: file) else { return nil }
    try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
    return bytes
  }

  private func store(_ bytes: Data, at file: URL) {
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    do { try bytes.write(to: file, options: .atomic) } catch { return }
    // Include derivatives and placeholders in the same 128 MB budget.
    bytesSinceTrim += bytes.count
    if bytesSinceTrim >= 8_000_000 || Date().timeIntervalSince(lastTrim) > 60 {
      bytesSinceTrim = 0
      lastTrim = Date()
      trim()
    }
  }

  /// Reader text can use an existing local decoration without waiting for network work.
  func cachedDataURL(for value: String) async -> String {
    guard let url = URL(string: value) else { return "" }
    guard let bytes = read(imageFile(for: url)) else {
      return ""
    }
    return await Self.webDataURL(bytes)
  }

  func dataURL(for value: String) async -> String {
    guard let url = URL(string: value), let bytes = await data(for: url) else { return "" }
    return await Self.webDataURL(bytes)
  }

  private nonisolated static func webDataURL(_ bytes: Data) async -> String {
    let task = Task.detached(priority: .utility) {
      guard await transforms.acquire(prefetch: true) else { return "" }
      let result = Task.isCancelled ? "" : PreviewImageCodec.webDataURL(bytes)
      await transforms.release()
      return Task.isCancelled ? "" : result
    }
    return await withTaskCancellationHandler {
      await task.value
    } onCancel: {
      task.cancel()
    }
  }

  private func trim() {
    let files =
      (try? FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? []
    let entries = files.compactMap { url -> (URL, Int, Date)? in
      guard
        let info = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
      else { return nil }
      return (url, info.fileSize ?? 0, info.contentModificationDate ?? .distantPast)
    }.sorted { $0.2 < $1.2 }
    var size = entries.reduce(0) { $0 + $1.1 }
    for (url, bytes, _) in entries where size > 128_000_000 {
      try? FileManager.default.removeItem(at: url)
      size -= bytes
    }
  }
}
