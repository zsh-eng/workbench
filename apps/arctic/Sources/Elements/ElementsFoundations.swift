import SwiftUI
import UIKit

/// Colour tokens, the type scale, corner radii and motion. Colours resolve in
/// both appearances, so one screen shows the light and dark values.
struct FoundationsSection: View {
  var body: some View {
    ElementsSpecimen(
      title: "Colour tokens",
      note: "Switch the system appearance to check each pair. Glacier blue is for actions only."
    ) {
      VStack(spacing: 0) {
        ForEach(Array(ColourToken.library.enumerated()), id: \.offset) { index, token in
          if index > 0 { Divider().padding(.leading, 56) }
          ColourRow(token: token)
        }
      }
      .elementsStage(padding: 12)
    }
    ElementsSpecimen(
      title: "Reading palettes",
      note: "The five Reader themes, from the parent app's neutral and Flexoki palettes."
    ) {
      HStack(alignment: .top, spacing: 8) {
        ForEach(ReadingPalette.allCases, id: \.rawValue) { palette in
          PaletteSwatch(palette: palette)
        }
      }
      .elementsStage(padding: 12)
    }
    ElementsSpecimen(
      title: "Library type",
      note: "Each style follows Dynamic Type. Titles use the system serif."
    ) {
      VStack(alignment: .leading, spacing: 16) {
        ForEach(Array(TypeToken.library.enumerated()), id: \.offset) { _, token in
          VStack(alignment: .leading, spacing: 3) {
            Text(token.sample).font(token.font).lineLimit(2)
            Text(token.spec).font(.caption).foregroundStyle(ReaderTheme.muted)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
      .elementsStage()
    }
    ElementsSpecimen(
      title: "Reader typefaces",
      note: "The five choices in Reader appearance, each set in itself."
    ) {
      VStack(alignment: .leading, spacing: 14) {
        ForEach(ReaderAppearancePanel.fonts, id: \.self) { name in
          VStack(alignment: .leading, spacing: 2) {
            Text("A good read, a place for it.")
              .font(ReaderAppearancePanel.sample(name, size: 21))
            Text(name).font(.caption).foregroundStyle(ReaderTheme.muted)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .elementsStage()
    }
    ElementsSpecimen(
      title: "Corner radii",
      note: "Continuous corners. Glass controls, tabs and the search field are capsules."
    ) {
      LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 12)], spacing: 12) {
        ForEach(RadiusToken.all, id: \.use) { token in
          VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: token.radius, style: .continuous)
              .fill(ReaderTheme.secondary)
              .overlay {
                RoundedRectangle(cornerRadius: token.radius, style: .continuous)
                  .strokeBorder(ReaderTheme.foreground.opacity(0.18), lineWidth: 1)
              }
              .frame(height: 72)
            Text("\(Int(token.radius)) pt").font(.subheadline.weight(.semibold).monospacedDigit())
            Text(token.use).font(.caption).foregroundStyle(ReaderTheme.muted)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
      .elementsStage()
    }
    MotionSpecimen()
  }
}

// MARK: Colour

private struct ColourToken {
  let name: String
  let use: String
  let colour: Color
  let uiColor: UIColor

  static let library: [ColourToken] = [
    .init(
      name: "Accent", use: "Actions, progress, the brand mark",
      colour: ArcticBrand.accent, uiColor: UIColor(ArcticBrand.accent)),
    .init(
      name: "On accent", use: "Text and icons on accent",
      colour: ArcticBrand.onAccent, uiColor: .systemBackground),
    .init(
      name: "Background", use: "Library, sheets, card surround",
      colour: ReaderTheme.background, uiColor: .systemBackground),
    .init(
      name: "Foreground", use: "Titles and primary text",
      colour: ReaderTheme.foreground, uiColor: .label),
    .init(
      name: "Secondary", use: "Text cards, metrics, raised areas",
      colour: ReaderTheme.secondary, uiColor: .secondarySystemBackground),
    .init(
      name: "Muted", use: "Sites, subtitles, captions",
      colour: ReaderTheme.muted, uiColor: .secondaryLabel),
    .init(
      name: "Border", use: "Hairlines and row rules",
      colour: ReaderTheme.border, uiColor: .separator),
  ]
}

private struct ColourRow: View {
  let token: ColourToken

  var body: some View {
    HStack(spacing: 12) {
      RoundedRectangle(cornerRadius: 10, style: .continuous)
        .fill(token.colour)
        .overlay {
          RoundedRectangle(cornerRadius: 10, style: .continuous)
            .strokeBorder(ReaderTheme.foreground.opacity(0.12), lineWidth: 0.5)
        }
        .frame(width: 44, height: 44)
      VStack(alignment: .leading, spacing: 2) {
        Text(token.name).font(.subheadline.weight(.semibold))
        Text(token.use).font(.caption).foregroundStyle(ReaderTheme.muted)
        let light = Text("Light " + Hex.string(token.uiColor, .light))
        let dark = Text("Dark " + Hex.string(token.uiColor, .dark))
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 14) {
            light
            dark
          }
          VStack(alignment: .leading, spacing: 1) {
            light
            dark
          }
        }
        .font(.caption.monospacedDigit()).foregroundStyle(ReaderTheme.muted)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 8)
    .accessibilityElement(children: .combine)
  }
}

private struct PaletteSwatch: View {
  let palette: ReadingPalette

  var body: some View {
    VStack(spacing: 6) {
      Text("Aa").font(.system(size: 17, weight: .semibold))
        .foregroundStyle(palette.foreground)
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(palette.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(ReaderTheme.foreground.opacity(0.14), lineWidth: 0.5)
        }
      Text(palette.rawValue).font(.caption.weight(.semibold))
      Text(palette == .system ? "Follows" : Hex.string(UIColor(palette.background), .light))
        .font(.caption2.monospaced()).foregroundStyle(ReaderTheme.muted)
        .lineLimit(1).minimumScaleFactor(0.7)
    }
    .frame(maxWidth: .infinity)
    .accessibilityElement(children: .combine)
  }
}

private enum Hex {
  static func string(_ colour: UIColor, _ style: UIUserInterfaceStyle) -> String {
    let resolved = colour.resolvedColor(with: UITraitCollection(userInterfaceStyle: style))
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    let channel = { (value: CGFloat) in Int((min(max(value, 0), 1) * 255).rounded()) }
    let hex = String(format: "#%02X%02X%02X", channel(red), channel(green), channel(blue))
    return alpha < 0.999 ? hex + String(format: " %d%%", Int((alpha * 100).rounded())) : hex
  }
}

// MARK: Type

private struct TypeToken {
  let sample: String
  let font: Font
  let spec: String

  static let library: [TypeToken] = [
    .init(
      sample: "Glacial Longings", font: LibraryCardType.title,
      spec: "Title 3, serif, semibold: card titles"),
    .init(
      sample: "Your next good read.", font: .system(.title2, design: .rounded, weight: .semibold),
      spec: "Title 2, rounded, semibold: empty states"),
    .init(
      sample: "1 hr 21 min", font: .system(.largeTitle, design: .rounded, weight: .bold),
      spec: "Large title, rounded, bold: reading stats"),
    .init(
      sample: "Arctic", font: .system(.headline, design: .rounded, weight: .semibold),
      spec: "Headline, rounded, semibold: the brand"),
    .init(
      sample: "Share to Arctic, or open a copied link.", font: ReaderTheme.sans(16),
      spec: "16 pt, scaled: the app default"),
    .init(
      sample: "An Alien Mind", font: ReaderTheme.sans(14, weight: .medium),
      spec: "14 pt, scaled, medium: banner titles"),
    .init(
      sample: "Elizabeth Rush", font: .subheadline,
      spec: "Subheadline: subtitles and notes"),
    .init(
      sample: "emergencemagazine.org", font: .footnote.weight(.medium),
      spec: "Footnote, medium: sources"),
    .init(sample: "New Yorker", font: .caption2, spec: "Caption 2: shelf labels"),
  ]
}

// MARK: Radii

@MainActor private struct RadiusToken {
  let radius: CGFloat
  let use: String

  static let all: [RadiusToken] = [
    .init(radius: 7, use: "Banner thumbnails"),
    .init(radius: 16, use: "Search and history rows"),
    .init(radius: ArticleCard.cornerRadius, use: "Article cards, Undo toast"),
    .init(radius: 24, use: "Tag notice, import summary"),
    .init(radius: 28, use: "Reader appearance panel"),
    .init(radius: 30, use: "News panel, open bubble"),
    .init(radius: 36, use: "Reading stats summary"),
  ]
}

// MARK: Motion

/// Each curve as a plot, with a dot that a shared timeline moves along it.
private struct MotionSpecimen: View {
  @State private var player = DemoPlayer(duration: MotionToken.duration)

  var body: some View {
    ElementsSpecimen(
      title: "Motion",
      note: "Play, or drag the timeline. Choose 0.25× to compare overshoot and settling."
    ) {
      VStack(spacing: 12) {
        VStack(spacing: 14) {
          ForEach(MotionToken.all, id: \.name) { token in
            MotionRow(token: token, time: player.time, duration: MotionToken.duration)
          }
          Text("With Reduce Motion, moving parts fade in place in 100 to 160 ms.")
            .font(.caption).foregroundStyle(ReaderTheme.muted)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .elementsStage()
        .demoStage(player)
        DemoControls(player: player, label: "Motion timeline")
      }
    }
  }
}

private struct MotionToken {
  enum Curve {
    case spring(Spring)
    case timing(UnitCurve, seconds: Double)
  }
  let name: String
  let detail: String
  let curve: Curve

  static func spring(_ name: String, _ response: Double, _ damping: Double) -> MotionToken {
    let spring = Spring(response: response, dampingRatio: damping)
    let overshoot = (0...400).map { spring.value(target: 1.0, time: Double($0) / 400) }.max() ?? 1
    let detail = String(
      format: "%.2f s, %.2f damping · %.1f%% overshoot · settles %.2f s", response, damping,
      max(0, overshoot - 1) * 100, spring.settlingDuration)
    return MotionToken(name: name, detail: detail, curve: .spring(spring))
  }

  static let all: [MotionToken] = [
    spring("News bubble", DiscoveryMotion.springResponse, DiscoveryMotion.springDamping),
    spring("Banners", 0.42, 0.86),
    spring("Undo toast", 0.4, 0.82),
    spring("Folder indicator", 0.36, 0.84),
    spring("Card release", 0.34, 0.68),
    spring("Reader appearance choice", 0.32, 0.8),
    spring("Selection mark", 0.26, 0.55),
    MotionToken(
      name: "Library and search crossfade", detail: "180 ms, fast out",
      curve: .timing(
        .bezier(
          startControlPoint: UnitPoint(x: 0.23, y: 1), endControlPoint: UnitPoint(x: 0.32, y: 1)),
        seconds: 0.18)),
    MotionToken(
      name: "Card press", detail: "120 ms, ease out", curve: .timing(.easeOut, seconds: 0.12)),
  ]

  static let duration = 1.0

  func value(at time: Double) -> Double {
    switch curve {
    case .spring(let spring): spring.value(target: 1.0, time: max(0, time))
    case .timing(let curve, let seconds): curve.value(at: min(1, max(0, time / seconds)))
    }
  }
}

private struct MotionRow: View {
  let token: MotionToken
  let time: Double
  let duration: Double

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(alignment: .firstTextBaseline) {
        Text(token.name).font(.subheadline.weight(.semibold))
        Spacer(minLength: 8)
      }
      Text(token.detail).font(.caption.monospacedDigit()).foregroundStyle(ReaderTheme.muted)
        .fixedSize(horizontal: false, vertical: true)
      Canvas { context, size in
        // 1.0 sits at 80% of the height, so overshoot shows above the line.
        let y = { (value: Double) in size.height - CGFloat(value) * size.height * 0.8 }
        let x = { (seconds: Double) in CGFloat(seconds / duration) * size.width }
        var rest = Path()
        rest.move(to: CGPoint(x: 0, y: y(1)))
        rest.addLine(to: CGPoint(x: size.width, y: y(1)))
        context.stroke(rest, with: .color(ReaderTheme.border), lineWidth: 0.5)
        var curve = Path()
        var played = Path()
        let steps = 120
        for step in 0...steps {
          let seconds = duration * Double(step) / Double(steps)
          let point = CGPoint(x: x(seconds), y: y(token.value(at: seconds)))
          if step == 0 { curve.move(to: point) } else { curve.addLine(to: point) }
          if seconds <= time {
            if step == 0 { played.move(to: point) } else { played.addLine(to: point) }
          }
        }
        context.stroke(curve, with: .color(ReaderTheme.foreground.opacity(0.18)), lineWidth: 1.5)
        context.stroke(played, with: .color(ArcticBrand.accent), lineWidth: 1.5)
        let dot = CGPoint(x: x(min(time, duration)), y: y(token.value(at: time)))
        context.fill(
          Circle().path(in: CGRect(x: dot.x - 4, y: dot.y - 4, width: 8, height: 8)),
          with: .color(ArcticBrand.accent))
      }
      .frame(height: 40)
      .accessibilityHidden(true)
    }
    .accessibilityElement(children: .combine)
  }
}
