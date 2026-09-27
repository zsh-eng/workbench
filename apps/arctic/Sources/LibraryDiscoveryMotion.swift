import SwiftUI
import UIKit

/// Six local layers follow the scroll offset directly. Dragging does not publish
/// SwiftUI state or relayout the list. Release uses a bounded display-link settle.
@MainActor final class DiscoveryMotion {
  weak var shelf: DiscoveryShelfView?
  weak var target: UIView?
  weak var surface: UIView?
  var enabled = false {
    didSet { if !enabled { cancelSettle() } }
  }
  var reduceMotion = false
  private var copies: [UIImageView] = []
  private var probe: UILabel?

  private let trigger: CGFloat = 12
  private var collapseDistance: CGFloat = 80
  private var dragStartedCollapsed = false
  private var signalled = false
  private let feedback = UIImpactFeedbackGenerator(style: .medium)

  private var displayLink: CADisplayLink?
  private weak var settlingScroll: UIScrollView?
  private var pendingDestination: CGFloat?
  private var settleFrom: CGFloat = 0
  private var settleTo: CGFloat = 0
  private var settleStart: CFTimeInterval = 0
  private var settleGeneration = 0

  deinit { displayLink?.invalidate() }

  func beginDragging(_ scroll: UIScrollView) {
    cancelSettle()
    let travel = scroll.contentOffset.y + scroll.adjustedContentInset.top
    // When catching an unfinished snap, use the nearer endpoint as the origin.
    // The commit threshold remains 12 points from that endpoint, not halfway.
    dragStartedCollapsed = travel >= collapseDistance * 0.5
    signalled = false
    if enabled { feedback.prepare() }
  }

  /// Finger release ends scrubbing. Stop native momentum inside the shelf;
  /// a separate, bounded scroll settle owns the remaining 240 ms of movement.
  func endDragging(_ scroll: UIScrollView, target: UnsafeMutablePointer<CGPoint>) {
    guard enabled else { return }
    let inset = scroll.adjustedContentInset.top
    let current = scroll.contentOffset.y + inset
    guard current >= 0, current <= collapseDistance else { return }
    let collapse =
      canCollapse(scroll)
      && (dragStartedCollapsed
        ? current > collapseDistance - trigger : current >= trigger)
    pendingDestination = (collapse ? collapseDistance : 0) - inset
    target.pointee = scroll.contentOffset
  }

  func didEndDragging(_ scroll: UIScrollView) {
    guard let destination = pendingDestination else { return }
    queueSettle(scroll, to: destination)
  }

  private func queueSettle(_ scroll: UIScrollView, to destination: CGFloat) {
    pendingDestination = destination
    let generation = settleGeneration
    // UIKit establishes its deceleration after the delegate callback returns.
    DispatchQueue.main.async { [weak self, weak scroll] in
      guard let self, let scroll, self.enabled, !scroll.isDragging,
        self.settleGeneration == generation
      else { return }
      self.pendingDestination = nil
      self.settlingScroll = scroll
      self.settleFrom = scroll.contentOffset.y
      self.settleTo = destination
      self.settleStart = CACurrentMediaTime()
      self.probe?.accessibilityValue = nil
      let relay = DiscoverySettleTick(motion: self)
      let link = CADisplayLink(target: relay, selector: #selector(DiscoverySettleTick.tick))
      link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
      self.displayLink = link
      scroll.setContentOffset(scroll.contentOffset, animated: false)
      link.add(to: .main, forMode: .common)
    }
  }

  fileprivate func tickSettle() {
    guard enabled, let scroll = settlingScroll, scroll.window != nil else {
      cancelSettle()
      return
    }
    // A new touch stops the motion immediately, even before pan recognition.
    // A stationary touch pauses; a recognised drag cancels and resumes scrubbing.
    if scroll.isTracking {
      settleFrom = scroll.contentOffset.y
      settleStart = CACurrentMediaTime()
      return
    }
    let duration = reduceMotion ? 0.16 : 0.24
    let elapsed = CACurrentMediaTime() - settleStart
    let fraction = min(1, elapsed / duration)
    let eased = 1 - pow(1 - fraction, 3)
    scroll.setContentOffset(
      CGPoint(x: scroll.contentOffset.x, y: settleFrom + (settleTo - settleFrom) * eased),
      animated: false)
    if fraction == 1 {
      // Simulator evidence of actual settling time, not just the requested duration.
      probe?.accessibilityValue = String(Int(elapsed * 1000))
      cancelSettle()
    }
  }

  func cancelSettle() {
    settleGeneration += 1
    pendingDestination = nil
    displayLink?.invalidate()
    displayLink = nil
    settlingScroll = nil
  }

  private func canCollapse(_ scroll: UIScrollView) -> Bool {
    scroll.contentSize.height - scroll.bounds.height
      + scroll.adjustedContentInset.top + scroll.adjustedContentInset.bottom >= collapseDistance
  }

  func attach(_ view: UIView) {
    surface = view
    for copy in copies { copy.removeFromSuperview() }
    copies = (0...ArcticPublisher.all.count).map { _ in
      let copy = UIImageView()
      copy.contentMode = .scaleAspectFill
      copy.clipsToBounds = true
      copy.isUserInteractionEnabled = false
      copy.bounds = CGRect(x: 0, y: 0, width: 58, height: 58)
      copy.layer.cornerRadius = 29
      view.addSubview(copy)
      return copy
    }
    if TestMode.enabled {
      probe?.removeFromSuperview()
      let label = UILabel(frame: CGRect(x: 0, y: 0, width: 90, height: 10))
      label.font = .systemFont(ofSize: 6)
      label.accessibilityIdentifier = "discovery-collapse"
      label.isUserInteractionEnabled = false
      view.addSubview(label)
      probe = label
    }
    update()
  }

  func update() {
    guard let shelf, let surface, let target, shelf.window === surface.window,
      target.window === surface.window, let scroll = shelf.verticalScroll
    else {
      for copy in copies { copy.alpha = 0 }
      return
    }
    let travel = max(0, scroll.contentOffset.y + scroll.adjustedContentInset.top)
    let destination = target.convert(
      CGPoint(x: target.bounds.midX, y: target.bounds.midY), to: surface)
    let first = shelf.icons[0]
    let current = first.convert(CGPoint(x: 29, y: 29), to: surface)
    let distance = max(80, current.y + travel - destination.y)
    collapseDistance = distance
    let progress = min(1, travel / distance)
    // Momentum from deeper in the list may enter the shelf after release.
    // Take over at the boundary instead of replaying the gesture at its speed.
    if enabled, scroll.isDecelerating, !scroll.isTracking,
      displayLink == nil, pendingDestination == nil, travel > 0, travel < distance
    {
      queueSettle(scroll, to: -scroll.adjustedContentInset.top)
    }
    if enabled, scroll.isDragging, !signalled, canCollapse(scroll) {
      let crossed = dragStartedCollapsed ? travel <= distance - trigger : travel >= trigger
      if crossed {
        feedback.impactOccurred(intensity: 1)
        signalled = true
      }
    }
    let active = enabled && !shelf.isHidden
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (index, icon) in shelf.icons.enumerated() {
      let copy = copies[index]
      copy.image = icon.image
      copy.contentMode = icon.contentMode
      copy.backgroundColor = icon.backgroundColor
      let rect = icon.convert(icon.bounds, to: surface)
      let visibleWidth = rect.intersection(
        shelf.scroller.convert(shelf.scroller.bounds, to: surface)
      ).width
      let flying = active && !reduceMotion && progress > 0 && progress < 1 && visibleWidth > 30
      // The real controls retain their layout. Only visual layers move.
      icon.alpha = active ? (reduceMotion ? max(0, 1 - progress * 2) : (progress == 0 ? 1 : 0)) : 1
      shelf.labels[index].alpha = active ? max(0, 1 - progress * 4) : 1
      shelf.buttons[index].isUserInteractionEnabled = !active || progress < 0.12
      copy.alpha = flying ? min(1, (1 - progress) / 0.28) : 0
      guard flying else { continue }
      let gather = min(1, progress / 0.72)
      let eased = gather * gather * (3 - 2 * gather)
      let fan = CGFloat(index - 2) * 4 * sin(progress * .pi)
      let x = rect.midX + (destination.x - rect.midX) * eased + fan
      let y = current.y + travel + (destination.y - current.y - travel) * progress
      copy.center = CGPoint(x: x, y: y)
      copy.transform = CGAffineTransform(scaleX: 1 - 0.62 * progress, y: 1 - 0.62 * progress)
    }
    if TestMode.enabled {
      probe?.text =
        enabled ? "\(Int(progress * 100)); \(reduceMotion ? "fade" : "gather")" : "inactive"
    }
    CATransaction.commit()
  }
}

struct DiscoveryFlightSurface: UIViewRepresentable {
  let motion: DiscoveryMotion
  let enabled: Bool
  @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
  @Environment(\.articleReduceMotion) private var appReduceMotion

  func makeUIView(context: Context) -> UIView {
    let view = UIView()
    view.isUserInteractionEnabled = false
    motion.attach(view)
    return view
  }
  func updateUIView(_ view: UIView, context: Context) {
    motion.enabled = enabled
    motion.reduceMotion = systemReduceMotion || appReduceMotion
    motion.update()
  }
}

struct DiscoveryTarget: UIViewRepresentable {
  let motion: DiscoveryMotion
  func makeUIView(context: Context) -> DiscoveryTargetView {
    let view = DiscoveryTargetView()
    view.motion = motion
    motion.target = view
    return view
  }
  func updateUIView(_ view: DiscoveryTargetView, context: Context) { motion.target = view }
}

final class DiscoveryTargetView: UIView {
  weak var motion: DiscoveryMotion?
  override func layoutSubviews() {
    super.layoutSubviews()
    motion?.update()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    motion?.update()
  }
}

struct NativeDiscoveryShelf: UIViewRepresentable {
  let motion: DiscoveryMotion
  let open: (URL) -> Void
  let weekly: () -> Void
  func makeUIView(context: Context) -> DiscoveryShelfView {
    DiscoveryShelfView(motion: motion)
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
  weak var verticalScroll: UIScrollView?
  private var verticalObservation: NSKeyValueObservation?
  private var horizontalObservation: NSKeyValueObservation?
  private var scrollDelegate: DiscoveryScrollDelegate?
  private let motion: DiscoveryMotion
  var open: (URL) -> Void = { _ in }
  var weekly: () -> Void = {}

  init(motion: DiscoveryMotion) {
    self.motion = motion
    super.init(frame: .zero)
    motion.shelf = self
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
    horizontalObservation = scroller.observe(\.contentOffset) { [weak self] _, _ in
      self?.motion.update()
    }
    updatePalette()
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  // The official FT avatar places the letters 24px above the canvas centre.
  // Normalize the artwork once so both the shelf and its flying copy are centred.
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
    motion.update()
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
    bindScrollView()
    motion.update()
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      unbindScrollView()
    } else {
      bindScrollView()
    }
    motion.update()
  }
  private func unbindScrollView() {
    if let scroll = verticalScroll, let delegate = scrollDelegate,
      scroll.delegate === delegate
    {
      scroll.delegate = delegate.forwarding
    }
    motion.cancelSettle()
    scrollDelegate = nil
    verticalObservation = nil
    verticalScroll = nil
  }

  private func bindScrollView() {
    var ancestor = superview
    while let view = ancestor {
      if let scroll = view as? UIScrollView {
        guard verticalScroll !== scroll else { return }
        unbindScrollView()
        verticalScroll = scroll
        let delegate = DiscoveryScrollDelegate(motion: motion, forwarding: scroll.delegate)
        scrollDelegate = delegate
        scroll.delegate = delegate
        if scroll.isDragging { motion.beginDragging(scroll) }
        verticalObservation = scroll.observe(\.contentOffset) { [weak self] _, _ in
          self?.motion.update()
        }
        return
      }
      ancestor = view.superview
    }
  }
}

/// Preserve SwiftUI's scroll delegate and all its optional callbacks. Intercept
/// only gesture boundaries, after forwarding, to hand release to the fixed settle.
@MainActor private final class DiscoveryScrollDelegate: NSObject, UIScrollViewDelegate {
  weak var forwarding: UIScrollViewDelegate?
  private let motion: DiscoveryMotion

  init(motion: DiscoveryMotion, forwarding: UIScrollViewDelegate?) {
    self.motion = motion
    self.forwarding = forwarding
  }

  override func responds(to selector: Selector!) -> Bool {
    super.responds(to: selector) || (forwarding?.responds(to: selector) ?? false)
  }

  override func forwardingTarget(for selector: Selector!) -> Any? {
    forwarding?.responds(to: selector) == true ? forwarding : super.forwardingTarget(for: selector)
  }

  func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
    forwarding?.scrollViewWillBeginDragging?(scrollView)
    motion.beginDragging(scrollView)
  }

  func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
    forwarding?.scrollViewDidEndDragging?(scrollView, willDecelerate: decelerate)
    motion.didEndDragging(scrollView)
  }

  func scrollViewWillEndDragging(
    _ scrollView: UIScrollView, withVelocity velocity: CGPoint,
    targetContentOffset: UnsafeMutablePointer<CGPoint>
  ) {
    forwarding?.scrollViewWillEndDragging?(
      scrollView, withVelocity: velocity, targetContentOffset: targetContentOffset)
    motion.endDragging(scrollView, target: targetContentOffset)
  }
}

/// CADisplayLink retains its target; the relay keeps that link from retaining
/// the library. No display link runs while the user scrubs or after settling.
@MainActor private final class DiscoverySettleTick: NSObject {
  weak var motion: DiscoveryMotion?
  init(motion: DiscoveryMotion) { self.motion = motion }
  @objc func tick() { motion?.tickSettle() }
}
