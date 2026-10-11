import SwiftUI

struct NewsSection: View {
  var body: some View {
    NewsBubbleSpecimen()
  }
}

/// The news bubble as a function of time. The library's own spring moves the
/// open distance; the header, the drawn bubble and the publisher row are the
/// production views. Live hands the same stage to a real `DiscoveryMotion`.
private struct NewsBubbleSpecimen: View {
  private typealias Mode = NewsBubbleTimeline.Mode
  @State private var mode: Mode
  @State private var player: DemoPlayer
  /// The stage's own motion object: it measures the header, and in Live it
  /// runs the production open and close. It never sees the library.
  @State private var motion = DiscoveryMotion()
  @State private var stageFrame = CGRect.zero
  @Environment(\.articleReduceMotion) private var reduceMotion

  init() {
    let mode =
      Mode(
        rawValue: ElementsLaunch.state(
          among: Mode.allCases.map(\.rawValue), default: Mode.open.rawValue)) ?? .open
    _mode = State(initialValue: mode)
    _player = State(initialValue: NewsBubbleTimeline(mode: mode).player())
  }

  var body: some View {
    let timeline = NewsBubbleTimeline(mode: mode)
    let live = mode == .live
    let moment = timeline.moment(at: player.time)
    ElementsSpecimen(
      title: "News bubble",
      note: live
        ? "Tap Arctic to open and close with the real motion object."
        : "Drag the timeline to scrub the bubble. Choose 0.25× to study the spring.",
      states: ElementsStates(
        id: "news", names: Mode.allCases.map(\.rawValue),
        selection: Binding(get: { mode.rawValue }, set: { choose(Mode(rawValue: $0) ?? .open) }),
        replay: { live ? choose(mode) : player.restart() })
    ) {
      VStack(alignment: .leading, spacing: 8) {
        stage(moment: moment, live: live)
          .demoStage(player)
        if live {
          Text(
            reduceMotion
              ? "Reduce Motion is on: news fades in place, as in the library."
              : "The drawn bubble carries the circles; the working row takes over when it settles."
          )
          .font(.caption).foregroundStyle(ReaderTheme.muted)
          .fixedSize(horizontal: false, vertical: true)
        } else {
          DemoControls(player: player, label: "News bubble timeline")
          readout(moment: moment, timeline: timeline)
        }
      }
    }
    .onChange(of: reduceMotion, initial: true) { _, value in motion.reduceMotion = value }
    .onAppear { if mode == .live { motion.setEnabled(true) } }
    .onDisappear { motion.setEnabled(false) }
  }

  // MARK: Stage

  private static let stageHeight: CGFloat = 400
  /// The header row is the library's navigation bar: 44 points.
  private static let headerHeight: CGFloat = 44
  /// The panel sits 8 points below the bar; the tabs 16 points below it.
  private static let panelTop: CGFloat = headerHeight + 8
  private static let tabsTop: CGFloat = headerHeight + 16

  private func stage(moment: NewsBubbleTimeline.Moment, live: Bool) -> some View {
    let openness = live ? motion.openness : moment.openness
    let push = openness + (live ? 0 : moment.pull)
    let rowShown = live ? motion.isExpanded && motion.settled : moment.settledOpen
    return ZStack(alignment: .top) {
      VStack(spacing: 16) {
        NewsTabsStandIn()
        ArticleCard(article: ElementsFixtures.glacial).padding(.horizontal, 18)
          .allowsHitTesting(false)
      }
      // The library list has no height limit; the stage clips what overflows.
      .fixedSize(horizontal: false, vertical: true)
      .padding(.top, Self.tabsTop + push)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .accessibilityHidden(true)
      if rowShown {
        // The library wraps the row the same way once the bubble settles.
        LibraryDiscovery(motion: motion, open: { _ in }, weekly: {})
          .padding(.vertical, DiscoveryShelfLayout.inset)
          .readerGlass(cornerRadius: 30)
          .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
          .padding(.horizontal, 12)
          .padding(.top, Self.panelTop)
          .transition(motion.reduceMotion && live ? .opacity : .identity)
      }
      DiscoveryHeader(
        motion: motion, available: true,
        pose: live
          ? nil
          : DiscoveryHeader.Pose(
            folded: min(1, max(0, moment.folded)),
            stackOpacity: min(1, max(0, moment.stackOpacity)))
      )
      .frame(maxWidth: .infinity).frame(height: Self.headerHeight)
      .allowsHitTesting(live)
      .accessibilityHidden(!live)
    }
    // Content below the tabs runs past the stage; keep the top edge fixed.
    .frame(height: Self.stageHeight, alignment: .top)
    .background(ReaderTheme.background)
    .overlay {
      if live {
        DiscoveryGhost(motion: motion)
      } else if moment.bubble, stageFrame.width > 0, motion.compactFrame.width > 0 {
        DiscoveryGhostFrame(
          openness: moment.openness + moment.pull, panel: panelFrame,
          compact: motion.compactFrame, shelfScroll: 0
        )
        .allowsHitTesting(false)
        .accessibilityHidden(true)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 24, style: .continuous)
        .strokeBorder(ReaderTheme.border, lineWidth: 0.5)
    }
    .onGeometryChange(for: CGRect.self) {
      $0.frame(in: .global)
    } action: { frame in
      stageFrame = frame
      motion.setPanelFrame(Self.panel(in: frame))
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("news-bubble-stage")
  }

  private var panelFrame: CGRect { Self.panel(in: stageFrame) }

  /// The production panel geometry, in the global space the bubble draws in.
  private static func panel(in stage: CGRect) -> CGRect {
    CGRect(
      x: stage.minX + 12, y: stage.minY + panelTop,
      width: max(0, stage.width - 24), height: DiscoveryShelfLayout.panelHeight)
  }

  private func readout(moment: NewsBubbleTimeline.Moment, timeline: NewsBubbleTimeline)
    -> some View
  {
    VStack(alignment: .leading, spacing: 2) {
      Text(
        String(
          format: "Open distance %.1f pt · header %.2f", moment.openness + moment.pull,
          moment.folded)
      )
      .accessibilityIdentifier("news-bubble-readout")
      Text(timeline.summary)
    }
    .font(.caption.monospacedDigit()).foregroundStyle(ReaderTheme.muted)
    .fixedSize(horizontal: false, vertical: true)
  }

  // MARK: States

  private func choose(_ next: Mode) {
    if mode == .live { motion.setEnabled(false) }
    mode = next
    if next == .live {
      player.pause()
      motion.setEnabled(true)
      motion.setPanelFrame(panelFrame)
      return
    }
    // A new mode keeps the viewer's speed, so 0.25× compares open and close.
    let speed = player.speed
    player = NewsBubbleTimeline(mode: next).player()
    player.setSpeed(speed)
    player.play()
  }
}

/// The folder tabs belong to the library view, so the stage draws a quiet
/// stand-in with the same height and glass. Only its position matters here.
private struct NewsTabsStandIn: View {
  var body: some View {
    // Like the library's tabs, large text runs past the edge; the overlay
    // keeps the stage at its own width.
    Text("Saved").font(.subheadline.weight(.semibold)).hidden()
      .frame(maxWidth: .infinity, minHeight: 44).padding(4)
      .overlay(alignment: .leading) {
        HStack(spacing: 2) {
          ForEach(["Saved", "Favourites", "Downloaded"], id: \.self) { name in
            Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
              .foregroundStyle(name == "Saved" ? ReaderTheme.foreground : ReaderTheme.muted)
              .padding(.horizontal, 16).frame(minHeight: 44)
              .background {
                if name == "Saved" { Capsule().fill(ReaderTheme.foreground.opacity(0.08)) }
              }
              .fixedSize()
          }
        }
        .padding(4)
      }
      .clipShape(Capsule())
      .readerGlass(cornerRadius: 26, interactive: false)
      .padding(.horizontal, 16)
  }
}

/// The library's open and close as values of time. Every moving value comes
/// from `DiscoveryMotion`'s spring and sizes; nothing here is tuned separately.
@MainActor struct NewsBubbleTimeline {
  enum Mode: String, CaseIterable {
    case open = "Open"
    case pull = "Pull"
    case close = "Close"
    case live = "Live"
  }

  /// One moment of the stage.
  struct Moment {
    /// The open distance that pushes the tabs down: 0 closed, 128 open.
    var openness: CGFloat
    /// A finger's pull before release. The bubble follows it; so do the tabs.
    var pull: CGFloat
    /// How far the header stack has folded away, 0 to 1.
    var folded: CGFloat
    /// The header circles' own opacity.
    var stackOpacity: CGFloat = 1
    /// The drawn bubble is on screen.
    var bubble: Bool
    /// Open and settled: the working row has replaced the bubble.
    var settledOpen: Bool
  }

  let mode: Mode

  static let spring = Spring(
    response: DiscoveryMotion.springResponse, dampingRatio: DiscoveryMotion.springDamping)
  static let height = DiscoveryMotion.height
  /// A pull that passes the trigger before the finger lets go.
  static let pulled: CGFloat = DiscoveryMotion.trigger + 20
  static let pullSeconds = 0.6
  /// When SwiftUI counts the spring as finished and the real row takes over.
  static let settle = spring.settlingDuration

  /// Where the spring starts on the timeline.
  var release: Double { mode == .pull ? Self.pullSeconds : 0 }
  var duration: Double { release + Self.settle + 0.1 }

  /// The stage at `time`. The header follows what the library does: while
  /// the drawn bubble shows, the circles fade out as it fades in, over the
  /// same distance (`DiscoveryMotion.bubbleOpacity`).
  func moment(at time: Double) -> Moment {
    switch mode {
    case .open, .live:
      guard time > 0 else { return Self.closed }
      let unit = Self.unit(time)
      guard time < Self.settle else { return Self.open }
      return Moment(
        openness: Self.height * unit, pull: 0, folded: unit,
        stackOpacity: Self.handoff(Self.height * unit), bubble: true, settledOpen: false)
    case .pull:
      guard time > Self.pullSeconds else {
        let distance = Self.pullDistance(at: time)
        let pulling = distance > 0.5
        return Moment(
          openness: 0, pull: distance, folded: 0,
          stackOpacity: pulling ? Self.handoff(distance) : 1, bubble: pulling, settledOpen: false)
      }
      let since = time - Self.pullSeconds
      guard since < Self.settle else { return Self.open }
      let unit = Self.unit(since)
      let openness = Self.pulled + (Self.height - Self.pulled) * unit
      return Moment(
        openness: openness, pull: 0, folded: unit, stackOpacity: Self.handoff(openness),
        bubble: true, settledOpen: false)
    case .close:
      guard time > 0 else { return Self.open }
      guard time < Self.settle else { return Self.closed }
      let unit = Self.unit(time)
      return Moment(
        openness: Self.height * (1 - unit), pull: 0, folded: 1 - unit,
        stackOpacity: Self.handoff(Self.height * (1 - unit)), bubble: true, settledOpen: false)
    }
  }

  /// The header circles' opacity while the drawn bubble is at `openness`.
  private static func handoff(_ openness: CGFloat) -> CGFloat {
    1 - DiscoveryMotion.bubbleOpacity(openness: openness)
  }

  private static let closed = Moment(
    openness: 0, pull: 0, folded: 0, bubble: false, settledOpen: false)
  private static let open = Moment(
    openness: height, pull: 0, folded: 1, bubble: false, settledOpen: true)

  /// The spring's progress from 0 to 1, with its small overshoot.
  private static func unit(_ seconds: Double) -> CGFloat {
    CGFloat(spring.value(target: 1.0, time: max(0, seconds)))
  }

  /// A finger slows as the rubber band stiffens.
  private static func pullDistance(at time: Double) -> CGFloat {
    let progress = min(1, max(0, time / pullSeconds))
    return pulled * CGFloat(1 - (1 - progress) * (1 - progress))
  }

  /// The spring's highest point, found by sampling each millisecond.
  private static let peak: (time: Double, unit: Double) = {
    stride(from: 0.0, through: settle, by: 0.001)
      .map { (time: $0, unit: spring.value(target: 1.0, time: $0)) }
      .max { $0.unit < $1.unit } ?? (time: settle, unit: 1)
  }()

  private static let halfway: Double =
    stride(from: 0.0, through: settle, by: 0.001)
    .first { spring.value(target: 1.0, time: $0) >= 0.5 } ?? 0

  var beats: [DemoPlayer.Beat] {
    var beats: [DemoPlayer.Beat] = []
    if mode == .pull {
      // The rubber band reaches the trigger, and the haptic plays.
      let progress = 1 - (1 - Double(DiscoveryMotion.trigger / Self.pulled)).squareRoot()
      beats.append(.init(at: progress * Self.pullSeconds, label: "Trigger"))
      beats.append(.init(at: Self.pullSeconds, label: "Release"))
    }
    beats.append(.init(at: release + Self.halfway, label: "Halfway"))
    if Self.peak.unit > 1.0005 {
      beats.append(.init(at: release + Self.peak.time, label: mode == .close ? "Lowest" : "Peak"))
    }
    beats.append(.init(at: release + Self.settle, label: mode == .close ? "Home" : "Hand-off"))
    return beats
  }

  /// One line that states the curve: response, damping, overshoot, settling.
  var summary: String {
    let travel = mode == .pull ? Self.height - Self.pulled : Self.height
    let overshoot = (Self.peak.unit - 1) * Double(travel)
    return String(
      format: "Spring %.2f s, %.2f damping · overshoot %.1f pt at %.2f s · settles %.2f s",
      DiscoveryMotion.springResponse, DiscoveryMotion.springDamping, overshoot,
      release + Self.peak.time, release + Self.settle)
  }

  func player() -> DemoPlayer {
    DemoPlayer(duration: duration, beats: beats)
  }
}
