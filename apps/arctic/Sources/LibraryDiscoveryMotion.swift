import SwiftUI
import UIKit

/// Two stable states joined by one distance. `openness` is the space news takes
/// above the tabs: 0 when closed, `height` when open. A pull scrubs it directly;
/// releasing past the trigger hands the pulled distance to a spring, so the list
/// never bounces back before news pushes it down again. UIKit still owns every
/// scroll offset and momentum curve.
@MainActor @Observable final class DiscoveryMotion {
  static let height: CGFloat = 128
  private(set) var isExpanded = false
  private(set) var pullDistance: CGFloat = 0
  private(set) var openness: CGFloat = 0
  /// The real shelf takes over once opening settles. Until then, and while
  /// closing, drawn bubbles carry the publishers between header and shelf.
  private(set) var settled = false
  private(set) var ghostActive = false
  private(set) var compactFrame: CGRect = .zero
  private(set) var panelFrame: CGRect = .zero
  private(set) var shelfScroll: CGFloat = 0
  /// A drag that began at the top of a closed list. Momentum bounces do not
  /// count, so a fast scroll back to the top never shakes the bubbles loose.
  private(set) var pulling = false
  @ObservationIgnored weak var shelf: DiscoveryShelfView?
  // Observed, so a view that first rendered while news was unavailable still
  // tracks the motion values once it becomes available.
  private(set) var enabled = false
  var reduceMotion = false
  @ObservationIgnored private var startedAtTop = false
  @ObservationIgnored private var startedExpanded = false
  @ObservationIgnored private var signalled = false
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private let feedback = UIImpactFeedbackGenerator(style: .medium)
  private let trigger: CGFloat = 56
  // Settles in about half a second with a few points of give, not a bounce.
  private let spring = Animation.spring(response: 0.44, dampingFraction: 0.86)

  /// The distance drawn on screen: a closed pull adds the rubber-band distance.
  var visibleOpenness: CGFloat { isExpanded ? openness : openness + pullDistance }
  var showsGhost: Bool {
    enabled && !reduceMotion && (ghostActive || (pulling && !isExpanded && pullDistance > 0.5))
  }

  func setEnabled(_ value: Bool) {
    if enabled != value { enabled = value }
    if !value {
      generation += 1
      isExpanded = false
      openness = 0
      settled = false
      ghostActive = false
      pulling = false
      pullDistance = 0
    }
  }

  func setCompactFrame(_ frame: CGRect) { if compactFrame != frame { compactFrame = frame } }
  func setPanelFrame(_ frame: CGRect) { if panelFrame != frame { panelFrame = frame } }

  func followBounce(_ scroll: UIScrollView) {
    let distance = enabled ? max(0, -(scroll.contentOffset.y + scroll.adjustedContentInset.top)) : 0
    if pullDistance != distance { pullDistance = distance }
    if pulling, distance == 0, !scroll.isDragging { pulling = false }
  }

  func toggle() {
    guard enabled else { return }
    if isExpanded { close() } else { open(from: 0) }
  }

  /// Closes with the bubbles flying home, or at once when the library is
  /// about to be hidden.
  func close(animated: Bool = true) {
    guard isExpanded else { return }
    generation += 1
    let token = generation
    if !animated {
      var transaction = Transaction()
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        isExpanded = false
        openness = 0
        settled = false
        ghostActive = false
        shelfScroll = 0
      }
      return
    }
    if reduceMotion {
      withAnimation(.easeOut(duration: 0.12)) {
        isExpanded = false
        openness = 0
        settled = false
      }
      return
    }
    // Draw the bubbles where the shelf shows them, then let them fly home.
    shelfScroll = shelf?.scroller.contentOffset.x ?? 0
    settled = false
    ghostActive = true
    DispatchQueue.main.async { [self] in
      guard generation == token else { return }
      withAnimation(spring, completionCriteria: .removed) {
        isExpanded = false
        openness = 0
      } completion: { [self] in
        guard generation == token else { return }
        ghostActive = false
        shelfScroll = 0
      }
    }
  }

  /// Opens from `start` points of space: zero for a tap, the pulled distance
  /// for a released pull.
  private func open(from start: CGFloat) {
    guard enabled, !isExpanded else { return }
    generation += 1
    let token = generation
    if reduceMotion {
      withAnimation(.easeOut(duration: 0.12)) {
        isExpanded = true
        openness = Self.height
        settled = true
      }
      return
    }
    settled = false
    shelfScroll = 0
    ghostActive = true
    openness = start
    // The bubbles render once at the starting distance before the spring moves them.
    DispatchQueue.main.async { [self] in
      guard generation == token else { return }
      withAnimation(spring, completionCriteria: .removed) {
        isExpanded = true
        openness = Self.height
      } completion: { [self] in
        guard generation == token else { return }
        settled = true
        ghostActive = false
      }
    }
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
      pulling = startedAtTop && !isExpanded
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
        let pulled = -offset
        // Hold the list where the finger left it; the spring continues from there.
        scroll.setContentOffset(
          CGPoint(x: scroll.contentOffset.x, y: -scroll.adjustedContentInset.top), animated: false)
        pulling = false
        open(from: pulled)
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
        .opacity(motion.showsGhost ? 0 : 1)
        .onGeometryChange(for: CGRect.self) {
          $0.frame(in: .global)
        } action: {
          motion.setCompactFrame($0)
        }
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
    motion.shelf = view
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
    typealias Layout = DiscoveryShelfLayout
    scroller.contentSize = CGSize(
      width: CGFloat(buttons.count) * Layout.pitch + 22, height: bounds.height)
    for index in buttons.indices {
      buttons[index].frame = CGRect(
        x: Layout.leading + CGFloat(index) * Layout.pitch, y: 0, width: Layout.slot, height: 88)
      icons[index].frame = CGRect(
        x: (Layout.slot - Layout.icon) / 2, y: Layout.iconTop, width: Layout.icon,
        height: Layout.icon)
      labels[index].frame = CGRect(x: 0, y: Layout.labelTop, width: Layout.slot, height: 18)
    }
  }
}

/// Shelf geometry shared by the UIKit row and the drawn bubbles, so the hand-off
/// between them lands on the same pixels.
enum DiscoveryShelfLayout {
  static let leading: CGFloat = 16
  static let pitch: CGFloat = 86
  static let slot: CGFloat = 68
  static let icon: CGFloat = 58
  static let iconTop: CGFloat = 4
  static let labelTop: CGFloat = 70
  /// The row sits inside the glass panel with this vertical padding.
  static let inset: CGFloat = 6
  static let panelHeight: CGFloat = 110
  static let compact: CGFloat = 24
}

/// The shelf grows out of the compact stack as one glass bubble. Its frame and
/// every circle inside it interpolate between the header and the shelf, driven
/// only by `openness`: a pull scrubs it, and the open and close springs animate
/// the same value. It is drawn in screen coordinates and never takes touches.
struct DiscoveryGhost: View {
  let motion: DiscoveryMotion

  var body: some View {
    if motion.showsGhost, motion.panelFrame.width > 0, motion.compactFrame.width > 0 {
      DiscoveryGhostFrame(
        openness: motion.visibleOpenness, panel: motion.panelFrame,
        compact: motion.compactFrame, shelfScroll: motion.shelfScroll
      )
      .ignoresSafeArea()
      .allowsHitTesting(false)
      .accessibilityHidden(true)
    }
  }
}

/// Animatable, so a spring on `openness` redraws every frame along the same
/// path a pull takes, instead of moving each view straight to its end state.
private struct DiscoveryGhostFrame: View, Animatable {
  var openness: CGFloat
  let panel: CGRect
  let compact: CGRect
  let shelfScroll: CGFloat
  var animatableData: CGFloat {
    get { openness }
    set { openness = newValue }
  }
  private typealias Layout = DiscoveryShelfLayout
  private static let titles = ["This week"] + ArcticPublisher.all.map(\.name)

  private static func mix(_ from: CGFloat, _ to: CGFloat, _ t: CGFloat) -> CGFloat {
    from + (to - from) * t
  }

  var body: some View {
    GeometryReader { proxy in
      let origin = proxy.frame(in: .global).origin
      let panel = panel.offsetBy(dx: -origin.x, dy: -origin.y)
      let compact = compact.offsetBy(dx: -origin.x, dy: -origin.y)
      // A capsule around the compact stack is the bubble's first shape.
      let seed = compact.insetBy(dx: -4, dy: -4)
      // Linear in openness, so a pull moves the bubble with the finger. It drops
      // a little ahead of its growth to clear the title; its lower edge still
      // stays above the tabs, which move down by the same distance.
      let t = max(0, openness / DiscoveryMotion.height)
      let drop = t < 1 ? 1 - (1 - t) * (1 - t) : t
      let frame = CGRect(
        x: Self.mix(seed.minX, panel.minX, t), y: Self.mix(seed.minY, panel.minY, drop),
        width: Self.mix(seed.width, panel.width, t), height: Self.mix(seed.height, panel.height, t))
      let radius = Self.mix(seed.height / 2, 30, min(1, t))
      ZStack(alignment: .topLeading) {
        ForEach(Self.titles.indices, id: \.self) { index in
          circle(index, t: t, panel: panel, compact: compact, frame: frame)
        }
      }
      .frame(width: frame.width, height: frame.height, alignment: .topLeading)
      .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
      .readerGlass(cornerRadius: radius, interactive: false)
      .shadow(color: .black.opacity(0.08 * min(1, t)), radius: 10, y: 4)
      .opacity(min(1, t * 10))
      .position(x: frame.midX, y: frame.midY)
    }
  }

  @ViewBuilder
  private func circle(_ index: Int, t: CGFloat, panel: CGRect, compact: CGRect, frame: CGRect)
    -> some View
  {
    // Circles to the right leave a moment later, so the row fans out from the stack.
    let p = min(1, max(0, (t - 0.03 * CGFloat(index)) / 0.85))
    // The compact stack shows three publishers. The star and the others wait
    // behind them and fade in as they leave.
    let stacked = max(0, min(index - 1, 2))
    let start = CGPoint(
      x: compact.minX + CGFloat(stacked) * 11 + Layout.compact / 2,
      y: compact.minY + 1 + Layout.compact / 2)
    let slotX =
      panel.minX + Layout.leading + CGFloat(index) * Layout.pitch + Layout.slot / 2 - shelfScroll
    let end = CGPoint(x: slotX, y: panel.minY + Layout.inset + Layout.iconTop + Layout.icon / 2)
    let size = Self.mix(Layout.compact, Layout.icon, p)
    Group {
      if index == 0 {
        Image(systemName: "star.fill")
          .font(.system(size: 22 * size / Layout.icon, weight: .medium))
          .foregroundStyle(ArcticBrand.accent)
          .frame(width: size, height: size)
          .background(ArcticBrand.accent.opacity(0.1))
      } else if let image = DiscoveryShelfView.publisherImage(ArcticPublisher.all[index - 1].asset)
      {
        Image(uiImage: image).resizable().scaledToFill()
          .frame(width: size, height: size)
          .background(Color.white)
      }
    }
    .clipShape(Circle())
    .overlay(Circle().stroke(ReaderTheme.background, lineWidth: 2 * (1 - p)))
    .opacity((1...3).contains(index) ? 1 : min(1, p * 3))
    .position(
      x: Self.mix(start.x, end.x, p) - frame.minX, y: Self.mix(start.y, end.y, p) - frame.minY
    )
    .zIndex(index == 0 ? 0 : Double(Self.titles.count - index))
    Text(Self.titles[index]).font(.caption2).lineLimit(1).minimumScaleFactor(0.78)
      .foregroundStyle(.primary)
      .frame(width: Layout.slot)
      .position(
        x: slotX - frame.minX, y: panel.minY + Layout.inset + Layout.labelTop + 9 - frame.minY
      )
      .opacity(min(1, max(0, (p - 0.7) / 0.3)))
  }
}
