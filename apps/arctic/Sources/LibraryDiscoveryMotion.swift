import SwiftUI
import UIKit

/// Two stable states. UIKit owns every scroll offset, inset and momentum curve.
/// Only a deliberate drag or a header tap changes the news row above the tabs.
@MainActor @Observable final class DiscoveryMotion {
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
    withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .smooth(duration: 0.24)) {
      isExpanded = value
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
  let open: (URL) -> Void
  let weekly: () -> Void
  func makeUIView(context: Context) -> DiscoveryShelfView {
    DiscoveryShelfView()
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
    }
  }
}
