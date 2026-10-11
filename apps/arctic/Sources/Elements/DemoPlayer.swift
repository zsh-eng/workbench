import QuartzCore
import SwiftUI

/// The player for moving specimens. It has the contract of the web player in
/// `packages/elements` (docs/ELEMENTS.md, "Demos"); Arctic draws the controls.
///
/// - A timeline has a duration. Its view is a function of `time`. It plays,
///   pauses, scrubs and replays.
/// - A run has no duration. Each restart counts a new `run`: give the live
///   component `.id(player.run)`, or start it again when `run` changes.
///
/// A demo starts when most of its stage is in view and pauses when the stage
/// leaves. After the viewer uses a control, only the viewer starts and stops
/// it. With Reduce Motion it does not start by itself and shows its last
/// moment. The display link runs only while a timeline plays.
@MainActor @Observable final class DemoPlayer {
  /// A named moment on a timeline, in seconds.
  struct Beat: Hashable {
    var at: Double
    var label: String
  }
  enum Kind { case timeline, run }
  enum Autoplay { case visible, manual }
  /// The moment a demo shows with Reduce Motion.
  enum Rest { case start, end }

  let kind: Kind
  /// The playable slice, in seconds.
  let start: Double
  let end: Double
  let beats: [Beat]
  let loops: Bool
  /// Seconds from the start of the timeline. Always 0 for a run.
  private(set) var time: Double
  private(set) var playing = false
  private(set) var scrubbing = false
  private(set) var speed: Double
  /// Counts restarts. Key a run's component with it.
  private(set) var run = 0
  /// True once the viewer has used a control, or when the demo must not
  /// start by itself. Autoplay then stops.
  private(set) var controlled: Bool

  @ObservationIgnored private let autoplay: Bool
  @ObservationIgnored private let initialTime: Double?
  @ObservationIgnored private let rest: Rest
  @ObservationIgnored private var touched = false
  @ObservationIgnored private var reduced = false
  @ObservationIgnored private var resumeAfterScrub = false
  @ObservationIgnored private var visibility = DemoVisibility.hidden
  @ObservationIgnored private var clock: DemoClock?

  /// Most of a stage, or most of the view for a stage taller than the view.
  nonisolated static let mostlyVisible = 0.6
  /// The longest frame step, so a pause in delivery never jumps to the end.
  private static let maxFrame = 0.05
  private static let epsilon = 1e-3

  /// - Parameters:
  ///   - duration: Seconds. Omit it for a run.
  ///   - initialTime: Opens at a moment, paused. Defaults to
  ///     `-ArcticElementsTime` for timelines.
  init(
    duration: Double? = nil, beats: [Beat] = [], from: Double? = nil, to: Double? = nil,
    loop: Bool = false, speed: Double = 1, autoplay: Autoplay = ElementsLaunch.autoplay,
    initialTime: Double? = nil, reducedMotion: Rest = .end
  ) {
    kind = duration == nil ? .run : .timeline
    let length = max(0, duration ?? 0)
    start = min(max(from ?? 0, 0), length)
    end = min(max(to ?? length, start), length)
    self.beats = beats.sorted { $0.at < $1.at }
    loops = loop
    self.speed = speed
    let initial = kind == .timeline ? initialTime ?? ElementsLaunch.time : nil
    self.initialTime = initial
    self.autoplay = autoplay == .visible && initial == nil
    rest = reducedMotion
    time = min(max(initial ?? start, start), end)
    controlled = !self.autoplay
  }

  var duration: Double { end - start }
  /// 0 to 1 through the playable slice.
  var progress: Double { duration > 0 ? (time - start) / duration : 0 }
  var ended: Bool { kind == .timeline && !playing && time >= end - Self.epsilon }
  /// The last beat at or before the current time.
  var beat: Beat? { beats.last { $0.at <= time + Self.epsilon } }

  // MARK: Controls

  func play() {
    touch()
    setPlaying(true)
  }

  func pause() {
    touch()
    setPlaying(false)
  }

  /// Plays, pauses, or replays from the start when ended.
  func toggle() {
    touch()
    setPlaying(!playing)
  }

  func seek(_ seconds: Double) {
    touch()
    seekTo(seconds)
  }

  /// Moves by seconds and pauses.
  func step(_ seconds: Double) {
    touch()
    if playing { setPlaying(false) }
    seekTo(time + seconds)
  }

  /// Moves to the next or previous beat, or an end.
  func stepBeat(_ direction: Int) {
    touch()
    if playing { setPlaying(false) }
    let points = [start] + beats.map(\.at) + [end]
    let target =
      direction > 0
      ? points.first { $0 > time + Self.epsilon }
      : points.last { $0 < time - Self.epsilon }
    seekTo(target ?? (direction > 0 ? end : start))
  }

  /// Goes back to the start and counts a new run. Plays a timeline again.
  func restart() {
    touch()
    run += 1
    time = start
    if kind == .timeline { setPlaying(true) }
  }

  func setSpeed(_ value: Double) { speed = value }

  /// Holds playback while a finger drags the scrubber.
  func beginScrub() {
    touch()
    guard !scrubbing else { return }
    scrubbing = true
    resumeAfterScrub = playing
    playing = false
    stopClock()
  }

  func endScrub() {
    guard scrubbing else { return }
    scrubbing = false
    if resumeAfterScrub && time < end - Self.epsilon { setPlaying(true) }
  }

  // MARK: Stage

  /// Starts and pauses the demo as its stage enters and leaves the view.
  func setVisibility(_ value: DemoVisibility) {
    visibility = value
    guard !controlled, kind == .timeline else { return }
    if value == .mostly, !playing, time < end - Self.epsilon {
      setPlaying(true)
    } else if value == .hidden, playing {
      setPlaying(false)
    }
  }

  /// With Reduce Motion a demo shows its resting moment and waits.
  func setReduceMotion(_ value: Bool) {
    guard value != reduced else { return }
    reduced = value
    guard !touched else { return }
    if value {
      controlled = true
      if playing { setPlaying(false) }
      if initialTime == nil, kind == .timeline { time = rest == .end ? end : start }
    } else {
      controlled = !autoplay
      setVisibility(visibility)
    }
  }

  /// The stage left the screen: stop the clock without taking control.
  func suspend() {
    scrubbing = false
    if playing { setPlaying(false) }
  }

  /// Hardware keyboard rules for a focused scrubber. Returns true if handled.
  func handleKey(_ key: KeyEquivalent, characters: String, modifiers: EventModifiers) -> Bool {
    guard modifiers.isDisjoint(with: [.command, .option, .control]) else { return false }
    if kind == .run {
      guard characters.lowercased() == "r" else { return false }
      restart()
      return true
    }
    let small = max(0.05, duration / 50)
    switch key {
    case .space: toggle()
    case .rightArrow: modifiers.contains(.shift) ? stepBeat(1) : step(small)
    case .leftArrow: modifiers.contains(.shift) ? stepBeat(-1) : step(-small)
    case .home: seek(start)
    case .end: seek(end)
    default:
      switch characters.lowercased() {
      case "k": toggle()
      case "r": restart()
      default: return false
      }
    }
    return true
  }

  // MARK: Clock

  private func touch() {
    touched = true
    controlled = true
  }

  private func seekTo(_ seconds: Double) {
    guard kind == .timeline else { return }
    time = min(max(seconds, start), end)
  }

  private func setPlaying(_ next: Bool) {
    guard kind == .timeline else { return }
    if next, time >= end - Self.epsilon { time = start }
    if playing != next { playing = next }
    if playing, !scrubbing { startClock() } else { stopClock() }
  }

  private func startClock() {
    guard clock == nil else { return }
    clock = DemoClock { [weak self] seconds in
      guard let self else { return false }
      self.advance(seconds)
      return self.playing
    }
  }

  private func stopClock() {
    clock?.stop()
    clock = nil
  }

  private func advance(_ seconds: Double) {
    guard playing, !scrubbing else { return }
    var next = time + min(Self.maxFrame, max(0, seconds)) * speed
    if next >= end {
      if loops, end > start {
        next = start + (next - start).truncatingRemainder(dividingBy: end - start)
      } else {
        next = end
        playing = false
        stopClock()
      }
    }
    time = next
  }
}

/// How much of a stage the viewer can see.
enum DemoVisibility: Equatable {
  case hidden, partly, mostly

  init(stage: CGRect, viewport: CGRect) {
    let seen = stage.intersection(viewport)
    guard !seen.isNull, seen.height > 0, stage.height > 0 else {
      self = .hidden
      return
    }
    let mostly =
      seen.height / stage.height >= DemoPlayer.mostlyVisible
      || seen.height >= viewport.height * DemoPlayer.mostlyVisible
    self = mostly ? .mostly : .partly
  }
}

/// A display link that exists only while a timeline plays. It stops itself
/// when `tick` returns false, including after its player is released.
@MainActor private final class DemoClock: NSObject {
  private var link: CADisplayLink?
  private var last = CACurrentMediaTime()
  private let tick: @MainActor (Double) -> Bool

  init(tick: @escaping @MainActor (Double) -> Bool) {
    self.tick = tick
    super.init()
    let link = CADisplayLink(target: self, selector: #selector(step(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 120, preferred: 120)
    // Common modes keep the clock running while the page scrolls.
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  @objc private func step(_ link: CADisplayLink) {
    let now = link.targetTimestamp
    let seconds = now - last
    last = now
    if !tick(seconds) { stop() }
  }

  func stop() {
    link?.invalidate()
    link = nil
  }
}

private struct DemoViewportKey: EnvironmentKey {
  static let defaultValue = CGRect.infinite
}

extension EnvironmentValues {
  /// The visible part of the scrolling page, in global coordinates.
  var demoViewport: CGRect {
    get { self[DemoViewportKey.self] }
    set { self[DemoViewportKey.self] = newValue }
  }
}

extension View {
  /// Starts and pauses `player` as this stage enters and leaves the view, and
  /// applies Reduce Motion.
  func demoStage(_ player: DemoPlayer) -> some View {
    modifier(DemoStage(player: player))
  }

  /// Calls `action` once, when this stage is first mostly visible. A run
  /// that ends by itself starts here, so the viewer sees it from the start.
  func onDemoFirstSight(_ action: @escaping @MainActor () -> Void) -> some View {
    modifier(DemoFirstSight(action: action))
  }
}

private struct DemoFirstSight: ViewModifier {
  let action: @MainActor () -> Void
  @Environment(\.demoViewport) private var viewport
  @State private var seen = false

  func body(content: Content) -> some View {
    let viewport = viewport
    return
      content
      .onGeometryChange(for: Bool.self) { proxy in
        DemoVisibility(stage: proxy.frame(in: .global), viewport: viewport) == .mostly
      } action: { mostly in
        guard mostly, !seen else { return }
        seen = true
        action()
      }
  }
}

private struct DemoStage: ViewModifier {
  let player: DemoPlayer
  @Environment(\.articleReduceMotion) private var reduceMotion
  @Environment(\.demoViewport) private var viewport

  func body(content: Content) -> some View {
    let viewport = viewport
    let reduced = reduceMotion
    return
      content
      .onGeometryChange(for: DemoVisibility.self) { proxy in
        DemoVisibility(stage: proxy.frame(in: .global), viewport: viewport)
      } action: { visibility in
        player.setReduceMotion(reduced)
        player.setVisibility(visibility)
      }
      .onAppear { player.setReduceMotion(reduced) }
      .onChange(of: reduceMotion) { _, value in player.setReduceMotion(value) }
      .onDisappear { player.suspend() }
  }
}

/// Arctic's demo controls: Play, Pause or Replay; a scrubber with beat ticks;
/// and 0.25× to study a curve. A run shows one Replay button.
struct DemoControls: View {
  let player: DemoPlayer
  /// Names the timeline for VoiceOver, for example "News bubble timeline".
  let label: String
  var speeds = true
  var replayTitle = "Replay"

  var body: some View {
    if player.kind == .run {
      HStack {
        Spacer()
        Button(action: player.restart) {
          Label(replayTitle, systemImage: "arrow.counterclockwise")
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 14).frame(minHeight: 36)
            .background(Capsule().fill(ReaderTheme.foreground.opacity(0.06)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain).frame(minHeight: 44)
        .accessibilityIdentifier("demo-replay")
      }
    } else {
      // The caption sits under the scrubber, so its ends line up at any size.
      HStack(alignment: .top, spacing: 8) {
        Button(action: player.toggle) {
          Image(systemName: symbol)
            .font(.body.weight(.semibold))
            .contentTransition(.symbolEffect(.replace))
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(player.playing ? "Pause" : player.ended ? "Replay" : "Play")
        .accessibilityIdentifier("demo-play")
        VStack(spacing: 0) {
          DemoScrubber(player: player, label: label)
          HStack(alignment: .firstTextBaseline) {
            Text(player.beat?.label ?? " ")
            Spacer(minLength: 12)
            // The time keeps one line; a long beat name wraps first.
            Text("\(Self.seconds(player.time - player.start)) / \(Self.seconds(player.duration))")
              .fixedSize()
          }
          .font(.caption.monospacedDigit()).foregroundStyle(ReaderTheme.muted)
          .accessibilityHidden(true)
        }
        if speeds {
          Button {
            player.setSpeed(player.speed == 1 ? 0.25 : 1)
          } label: {
            // The wider label sets the width, so the scrubber does not move.
            Text("0.25×").hidden()
              .overlay { Text(player.speed == 1 ? "1×" : "0.25×") }
              .font(.footnote.weight(.semibold).monospacedDigit())
              .foregroundStyle(player.speed == 1 ? ReaderTheme.muted : ReaderTheme.foreground)
              .padding(.horizontal, 10).frame(minWidth: 52, minHeight: 30)
              .background(
                Capsule().fill(ReaderTheme.foreground.opacity(player.speed == 1 ? 0.05 : 0.1))
              )
              .frame(minHeight: 44).contentShape(Rectangle())
          }
          .buttonStyle(.plain)
          .accessibilityLabel("Speed")
          .accessibilityValue(player.speed == 1 ? "Normal" : "Quarter speed")
          .accessibilityIdentifier("demo-speed")
        }
      }
    }
  }

  private var symbol: String {
    player.playing ? "pause.fill" : player.ended ? "arrow.counterclockwise" : "play.fill"
  }

  static func seconds(_ value: Double) -> String { String(format: "%.2f s", max(0, value)) }
}

/// A slider-like scrubber. Ticks mark the beats; a selection haptic marks
/// each beat the finger crosses.
private struct DemoScrubber: View {
  let player: DemoPlayer
  let label: String
  private let thumb: CGFloat = 18

  var body: some View {
    GeometryReader { proxy in
      let inset = thumb / 2
      let width = max(1, proxy.size.width - thumb)
      let middle = proxy.size.height / 2
      let fraction = { (seconds: Double) in
        CGFloat(player.duration > 0 ? (seconds - player.start) / player.duration : 0)
      }
      ZStack(alignment: .topLeading) {
        Canvas { context, _ in
          let track = CGRect(x: inset, y: middle - 2, width: width, height: 4)
          context.fill(
            Capsule().path(in: track), with: .color(ReaderTheme.foreground.opacity(0.12)))
          let filled = CGRect(
            x: inset, y: middle - 2, width: width * CGFloat(player.progress), height: 4)
          context.fill(Capsule().path(in: filled), with: .color(ArcticBrand.accent))
          for beat in player.beats {
            let x = inset + width * fraction(beat.at)
            context.fill(
              Capsule().path(in: CGRect(x: x - 1, y: middle - 7, width: 2, height: 14)),
              with: .color(ReaderTheme.foreground.opacity(0.4)))
          }
        }
        Circle().fill(.white)
          .overlay(Circle().strokeBorder(.black.opacity(0.08), lineWidth: 0.5))
          .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
          .frame(width: thumb, height: thumb)
          .scaleEffect(player.scrubbing ? 1.15 : 1)
          .animation(.easeOut(duration: 0.12), value: player.scrubbing)
          .position(x: inset + width * CGFloat(player.progress), y: middle)
      }
      .frame(width: proxy.size.width, height: proxy.size.height)
      .contentShape(Rectangle())
      .gesture(
        DragGesture(minimumDistance: 0)
          .onChanged { value in
            if !player.scrubbing { player.beginScrub() }
            let at = Double(min(max(0, (value.location.x - inset) / width), 1))
            player.seek(player.start + player.duration * at)
          }
          .onEnded { _ in player.endScrub() }
      )
    }
    .frame(height: 44)
    .sensoryFeedback(.selection, trigger: player.beat) { _, _ in player.scrubbing }
    .focusable()
    .focusEffectDisabled()
    .onKeyPress(phases: .down) { press in
      player.handleKey(press.key, characters: press.characters, modifiers: press.modifiers)
        ? .handled : .ignored
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(label)
    .accessibilityValue(accessibilityValue)
    .accessibilityAdjustableAction { direction in
      switch direction {
      case .increment: player.stepBeat(1)
      case .decrement: player.stepBeat(-1)
      @unknown default: break
      }
    }
    .accessibilityIdentifier("demo-scrubber")
  }

  private var accessibilityValue: String {
    let position = String(
      format: "%.2f of %.2f seconds", player.time - player.start, player.duration)
    guard let beat = player.beat else { return position }
    return position + ", " + beat.label
  }
}
