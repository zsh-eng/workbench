import SwiftUI
import UIKit

/// Two stable states. UIKit owns every scroll offset, inset and momentum curve.
/// Only a deliberate drag or a header tap changes the news row above the tabs.
@MainActor @Observable final class DiscoveryMotion {
  @ObservationIgnored let flight = DiscoveryBubbleFlight()
  private(set) var isExpanded = false
  private(set) var pullDistance: CGFloat = 0
  @ObservationIgnored var enabled = false
  @ObservationIgnored var reduceMotion = false
  @ObservationIgnored private var startedAtTop = false
  @ObservationIgnored private var startedExpanded = false
  @ObservationIgnored private var signalled = false
  @ObservationIgnored private let feedback = UIImpactFeedbackGenerator(style: .medium)
  private let trigger: CGFloat = 44

  func setEnabled(_ value: Bool) {
    enabled = value
    if !value {
      flight.cancel()
      isExpanded = false
      pullDistance = 0
    }
  }

  func followBounce(_ scroll: UIScrollView) {
    let distance = enabled ? max(0, -(scroll.contentOffset.y + scroll.adjustedContentInset.top)) : 0
    if pullDistance != distance { pullDistance = distance }
  }

  func toggle() {
    guard enabled else { return }
    setExpanded(!isExpanded)
  }

  func close() { setExpanded(false) }

  private func setExpanded(_ value: Bool) {
    guard isExpanded != value else { return }
    flight.prepare(opening: value, reduced: reduceMotion)
    withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .smooth(duration: 0.24)) {
      isExpanded = value
    }
    DispatchQueue.main.async { self.flight.startIfReady() }
  }

  func handle(_ pan: UIPanGestureRecognizer, in scroll: UIScrollView) {
    guard enabled else { return }
    let offset = scroll.contentOffset.y + scroll.adjustedContentInset.top
    let translation = pan.translation(in: scroll).y
    switch pan.state {
    case .began:
      startedAtTop = offset <= 1
      startedExpanded = isExpanded
      signalled = false
      feedback.prepare()
    case .changed:
      if startedExpanded, translation < -12, !signalled {
        feedback.impactOccurred(intensity: 1)
        signalled = true
        close()
      } else if !startedExpanded, startedAtTop, -offset >= trigger, !signalled {
        feedback.impactOccurred(intensity: 1)
        signalled = true
      }
    case .ended:
      if !startedExpanded, startedAtTop, -offset >= trigger {
        setExpanded(true)
      }
    case .cancelled, .failed:
      signalled = false
    default:
      break
    }
  }
}

/// Observe the native pan without replacing its delegate or touching scroll state.
struct DiscoveryScrollObserver: UIViewRepresentable {
  let motion: DiscoveryMotion
  func makeUIView(context: Context) -> DiscoveryScrollProbe { DiscoveryScrollProbe(motion: motion) }
  func updateUIView(_ view: DiscoveryScrollProbe, context: Context) { view.bind() }
  static func dismantleUIView(_ view: DiscoveryScrollProbe, coordinator: ()) { view.unbind() }
}

final class DiscoveryScrollProbe: UIView {
  private let motion: DiscoveryMotion
  private weak var scroll: UIScrollView?
  private var observation: NSKeyValueObservation?
  init(motion: DiscoveryMotion) {
    self.motion = motion
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    isAccessibilityElement = false
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func layoutSubviews() {
    super.layoutSubviews()
    bind()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { unbind() } else { bind() }
  }
  func bind() {
    guard window != nil else { return }
    var ancestor = superview
    while let view = ancestor {
      if let candidate = view as? UIScrollView {
        guard scroll !== candidate else { return }
        unbind()
        scroll = candidate
        candidate.panGestureRecognizer.addTarget(self, action: #selector(drag(_:)))
        observation = candidate.observe(\.contentOffset) { [weak self] scroll, _ in
          // UIKit changes this scroll view on the main thread.
          MainActor.assumeIsolated { self?.motion.followBounce(scroll) }
        }
        return
      }
      ancestor = view.superview
    }
  }
  func unbind() {
    scroll?.panGestureRecognizer.removeTarget(self, action: #selector(drag(_:)))
    observation = nil
    scroll = nil
  }
  @objc private func drag(_ pan: UIPanGestureRecognizer) {
    guard let scroll else { return }
    motion.handle(pan, in: scroll)
  }
}

/// Only the small header surfaces observe per-frame bounce. The article pager
/// and its rows do not subscribe to these updates.
struct DiscoveryPullChrome<Content: View>: View {
  let motion: DiscoveryMotion
  @ViewBuilder var content: () -> Content

  var body: some View {
    content().offset(y: motion.pullDistance)
      .animation(nil, value: motion.pullDistance)
  }
}

struct DiscoveryHeader: View {
  let motion: DiscoveryMotion
  let available: Bool

  var body: some View {
    Button(action: motion.toggle) {
      HStack(spacing: 0) {
        ZStack(alignment: .leading) {
          ForEach(Array(ArcticPublisher.all.prefix(3).enumerated()), id: \.element.id) {
            index, publisher in
            if let image = DiscoveryShelfView.publisherImage(publisher.asset) {
              Image(uiImage: image).resizable().scaledToFill()
                .frame(width: 24, height: 24).clipShape(Circle())
                .overlay(Circle().stroke(ReaderTheme.background, lineWidth: 2))
                .offset(x: CGFloat(index) * 11).zIndex(Double(3 - index))
            }
          }
        }
        .frame(width: 46, height: 26, alignment: .leading)
        .opacity(motion.flight.active ? 0 : 1)
        .background(DiscoveryCompactAnchor(flight: motion.flight))
        .frame(width: available && !motion.isExpanded ? 54 : 0, alignment: .leading)
        .clipped().opacity(available && !motion.isExpanded ? 1 : 0)
        ArcticMark().frame(width: 22, height: 22)
        Text("Arctic").font(.system(.headline, design: .rounded, weight: .semibold))
          .padding(.leading, 6).lineLimit(1).minimumScaleFactor(0.8)
          .accessibilityIdentifier("library-brand-title")
      }.frame(height: 44).contentShape(Rectangle())
    }
    .buttonStyle(.plain).disabled(!available)
    .accessibilityLabel(available ? "News" : "Arctic")
    .accessibilityValue(motion.isExpanded ? "Expanded" : "Collapsed")
    .accessibilityHint(available ? "Show or hide news sites and this week's favourites" : "")
    .accessibilityIdentifier("toggle-news")
    .transaction { if motion.reduceMotion { $0.animation = nil } }
  }
}

struct NativeDiscoveryShelf: UIViewRepresentable {
  let motion: DiscoveryMotion
  let open: (URL) -> Void
  let weekly: () -> Void
  func makeUIView(context: Context) -> DiscoveryShelfView {
    let view = DiscoveryShelfView()
    view.flight = motion.flight
    motion.flight.shelf = view
    return view
  }
  func updateUIView(_ view: DiscoveryShelfView, context: Context) {
    view.open = open
    view.weekly = weekly
    view.updatePalette()
  }
}

final class DiscoveryShelfView: UIView {
  let scroller = UIScrollView()
  var icons: [UIImageView] = []
  var labels: [UILabel] = []
  var buttons: [UIButton] = []
  var open: (URL) -> Void = { _ in }
  var weekly: () -> Void = {}
  weak var flight: DiscoveryBubbleFlight?

  init() {
    super.init(frame: .zero)
    backgroundColor = .clear
    scroller.backgroundColor = .clear
    scroller.showsHorizontalScrollIndicator = false
    scroller.alwaysBounceHorizontal = true
    scroller.contentInsetAdjustmentBehavior = .never
    addSubview(scroller)
    let titles = ["This week"] + ArcticPublisher.all.map(\.name)
    for (index, title) in titles.enumerated() {
      let button = UIButton(type: .custom)
      button.accessibilityLabel = index == 0 ? "Favourites this week" : "Browse " + title
      button.accessibilityIdentifier =
        index == 0
        ? "weekly-favourites" : "publisher-" + (ArcticPublisher.all[index - 1].url.host ?? "")
      button.accessibilityHint = index == 0 ? nil : "Opens through Unwall"
      button.addAction(
        UIAction { [weak self] _ in
          guard let self else { return }
          if index == 0 { self.weekly() } else { self.open(ArcticPublisher.all[index - 1].url) }
        }, for: .touchUpInside)
      let icon = UIImageView()
      icon.contentMode = index == 0 ? .center : .scaleAspectFill
      icon.clipsToBounds = true
      icon.layer.cornerRadius = 29
      if index > 0 { icon.backgroundColor = .white }
      icon.image =
        index == 0
        ? UIImage(
          systemName: "star.fill",
          withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .medium))
        : Self.publisherImage(ArcticPublisher.all[index - 1].asset)
      let label = UILabel()
      label.text = title
      label.font = .preferredFont(forTextStyle: .caption2)
      label.adjustsFontForContentSizeCategory = true
      label.textAlignment = .center
      label.lineBreakMode = .byTruncatingTail
      label.adjustsFontSizeToFitWidth = true
      label.minimumScaleFactor = 0.78
      button.addSubview(icon)
      button.addSubview(label)
      scroller.addSubview(button)
      icons.append(icon)
      labels.append(label)
      buttons.append(button)
    }
    updatePalette()
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  // The official FT avatar places the letters 24px above the canvas centre.
  // Normalize the artwork once so both the shelf and its compact header mark are centred.
  private static let centeredFT: UIImage? = {
    guard let original = UIImage(named: "PublisherFT") else { return nil }
    let format = UIGraphicsImageRendererFormat()
    format.scale = original.scale
    return UIGraphicsImageRenderer(size: original.size, format: format).image { _ in
      original.draw(at: .zero)
      original.draw(at: CGPoint(x: 0, y: original.size.height * 24 / 180))
    }
  }()
  static func publisherImage(_ name: String) -> UIImage? {
    name == "PublisherFT" ? centeredFT : UIImage(named: name)
  }

  func updatePalette() {
    icons[0].tintColor = UIColor(ArcticBrand.accent)
    icons[0].backgroundColor = UIColor(ArcticBrand.accent).withAlphaComponent(0.1)
    for label in labels { label.textColor = .label }
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    scroller.frame = bounds
    scroller.contentSize = CGSize(width: CGFloat(buttons.count) * 86 + 22, height: bounds.height)
    for index in buttons.indices {
      buttons[index].frame = CGRect(x: 16 + CGFloat(index) * 86, y: 0, width: 68, height: 88)
      icons[index].frame = CGRect(x: 5, y: 4, width: 58, height: 58)
      labels[index].frame = CGRect(x: 0, y: 70, width: 68, height: 18)
      icons[index].alpha = flight?.active == true ? 0 : 1
    }
    flight?.startIfReady()
  }
}

/// One overlay carries the same circles between their two real layouts. It never
/// changes a scroll offset. Interrupted transitions start at presentation frames.
@MainActor @Observable final class DiscoveryBubbleFlight {
  private(set) var active = false
  @ObservationIgnored weak var compact: UIView?
  @ObservationIgnored weak var shelf: DiscoveryShelfView?
  @ObservationIgnored weak var surface: UIView?
  @ObservationIgnored private var copies: [UIImageView] = []
  @ObservationIgnored private var animator: UIViewPropertyAnimator?
  @ObservationIgnored private var compactFrames: [CGRect] = []
  @ObservationIgnored private var pending = false
  @ObservationIgnored private var opening = false
  @ObservationIgnored private var generation = 0

  func attach(_ surface: UIView) {
    self.surface = surface
    copies = (0...ArcticPublisher.all.count).map { index in
      let image = UIImageView()
      image.image =
        index == 0
        ? UIImage(
          systemName: "star.fill",
          withConfiguration: UIImage.SymbolConfiguration(pointSize: 22, weight: .medium))
        : DiscoveryShelfView.publisherImage(ArcticPublisher.all[index - 1].asset)
      image.contentMode = index == 0 ? .center : .scaleAspectFill
      image.tintColor = UIColor(ArcticBrand.accent)
      image.backgroundColor =
        index == 0 ? UIColor(ArcticBrand.accent).withAlphaComponent(0.1) : .white
      image.clipsToBounds = true
      image.isHidden = true
      surface.addSubview(image)
      return image
    }
  }

  func prepare(opening: Bool, reduced: Bool) {
    guard !reduced, let surface, let compact, surface.window != nil else {
      cancel()
      return
    }
    if !active && opening {
      compactFrames = (0..<3).map {
        compact.convert(CGRect(x: CGFloat($0) * 11, y: 1, width: 24, height: 24), to: surface)
      }
    }
    guard compactFrames.count == 3 else {
      cancel()
      return
    }
    let current =
      active
      ? copies.map { image -> (CGRect, CGFloat) in
        let layer = image.layer.presentation() ?? image.layer
        return (layer.frame, CGFloat(layer.opacity))
      } : (opening ? compactPoses() : expandedPoses())
    guard current.count == copies.count else {
      cancel()
      return
    }
    generation += 1
    animator?.stopAnimation(true)
    animator = nil
    self.opening = opening
    pending = true
    active = true
    for icon in shelf?.icons ?? [] { icon.alpha = 0 }
    for (index, copy) in copies.enumerated() {
      copy.frame = current[index].0
      copy.layer.cornerRadius = current[index].0.width / 2
      copy.alpha = current[index].1
      copy.isHidden = false
      // Match the overlapping stack's order, with NY Times in front.
      copy.layer.zPosition = CGFloat(copies.count - index)
    }
  }

  private func compactPoses() -> [(CGRect, CGFloat)] {
    (0..<copies.count).map { index in
      (compactFrames[max(0, min(index - 1, 2))], (1...3).contains(index) ? 1 : 0)
    }
  }

  private func expandedPoses() -> [(CGRect, CGFloat)] {
    guard let shelf, let surface, shelf.window != nil, shelf.bounds.width > 0 else { return [] }
    let visible = shelf.scroller.convert(shelf.scroller.bounds, to: surface)
    return shelf.icons.map { icon in
      let rect = icon.convert(icon.bounds, to: surface)
      // Keep clipped edge items in the row instead of flying outside its panel.
      return (rect, visible.contains(rect) ? 1 : 0)
    }
  }

  func startIfReady() {
    guard pending, let surface, surface.window != nil else { return }
    let ends = opening ? expandedPoses() : compactPoses()
    guard ends.count == copies.count else { return }
    pending = false
    let token = generation
    let animator = UIViewPropertyAnimator(duration: 0.36, dampingRatio: 0.9)
    animator.addAnimations { [self] in
      for (index, copy) in copies.enumerated() {
        copy.frame = ends[index].0
        copy.layer.cornerRadius = ends[index].0.width / 2
        copy.alpha = ends[index].1
      }
    }
    animator.addCompletion { [weak self] _ in
      guard let self, self.generation == token else { return }
      self.active = false
      for copy in self.copies { copy.isHidden = true }
      for icon in self.shelf?.icons ?? [] { icon.alpha = 1 }
      self.animator = nil
    }
    self.animator = animator
    animator.startAnimation()
  }

  func cancel() {
    generation += 1
    animator?.stopAnimation(true)
    animator = nil
    pending = false
    active = false
    for copy in copies { copy.isHidden = true }
    for icon in shelf?.icons ?? [] { icon.alpha = 1 }
  }
}

struct DiscoveryCompactAnchor: UIViewRepresentable {
  let flight: DiscoveryBubbleFlight
  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    flight.compact = view
    return view
  }
  func updateUIView(_ view: UIView, context: Context) { flight.compact = view }
}

struct DiscoveryFlightSurface: UIViewRepresentable {
  let flight: DiscoveryBubbleFlight
  func makeCoordinator() -> DiscoveryBubbleFlight { flight }
  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    flight.attach(view)
    return view
  }
  func updateUIView(_ view: UIView, context: Context) {}
  static func dismantleUIView(_ view: UIView, coordinator: DiscoveryBubbleFlight) {
    coordinator.cancel()
  }
}
