import SwiftUI
import UIKit

/// An editorial card: the publisher's photograph stays untreated above the
/// text, so no cover can reduce title contrast. Titles use the system serif.
struct ArticleCard: View {
  static let cornerRadius: CGFloat = 22
  let article: SavedArticle
  private var shape: RoundedRectangle {
    RoundedRectangle(cornerRadius: Self.cornerRadius, style: .continuous)
  }

  var body: some View {
    Group {
      // Imports start with a title. Reserve the eventual cover's space while
      // metadata is pending so arriving images do not push cards under a finger.
      if article.imageURL != nil || (article.taggingText == nil && !article.previewFailed) {
        VStack(alignment: .leading, spacing: 12) {
          ArticleThumbnail(url: article.imageURL)
            .aspectRatio(2, contentMode: .fit)
            .clipShape(shape)
            .overlay { shape.strokeBorder(ReaderTheme.foreground.opacity(0.07), lineWidth: 0.5) }
          VStack(alignment: .leading, spacing: 6) {
            source
            caption(subtitleLines: 1)
          }.padding(.horizontal, 4)
        }
      } else {
        VStack(alignment: .leading, spacing: 14) {
          source
          caption(subtitleLines: 2)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ReaderTheme.secondary, in: shape)
      }
    }
    .padding(.vertical, 4)
    .background(ReaderTheme.background)
    .contentShape(Rectangle())
  }

  private var source: some View {
    HStack(spacing: 6) {
      if let favicon = article.faviconURL {
        ArticleThumbnail(url: favicon, label: "Site icon", pixels: 96)
          .frame(width: 16, height: 16).clipShape(Circle())
      }
      Text(article.siteName)
        .font(.footnote.weight(.medium)).foregroundStyle(ReaderTheme.muted).lineLimit(1)
      if article.favourite {
        Image(systemName: "star.fill").font(.caption2).foregroundStyle(ArcticBrand.accent)
          .accessibilityLabel("Favourite")
      }
    }
  }

  private func caption(subtitleLines: Int) -> some View {
    ViewThatFits(in: .horizontal) {
      // Only keep the subtitle when the entire title fits on one line.
      VStack(alignment: .leading, spacing: 4) {
        Text(article.displayTitle).font(LibraryCardType.title)
          .fixedSize(horizontal: true, vertical: false)
        if !article.subtitle.isEmpty {
          Text(article.subtitle).font(.subheadline).foregroundStyle(ReaderTheme.muted)
            .lineLimit(subtitleLines).fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("card-caption-subtitle")
            // A zero ideal width lets ViewThatFits measure the title alone.
            .frame(minWidth: 0, idealWidth: 0, maxWidth: .infinity, alignment: .leading)
        }
      }
      LibraryTitle(text: article.displayTitle, style: .title3, design: .serif)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}

enum LibraryCardType {
  static let title = Font.system(.title3, design: .serif, weight: .semibold)
}

extension SavedArticle {
  /// The source appears beside every title, so a matching publisher suffix is
  /// display noise. Stored titles, search and tagging input are unchanged.
  var displayTitle: String { ArticleTitle.display(title, host: url.host) }
  var siteName: String { url.host?.replacingOccurrences(of: "www.", with: "") ?? "" }
}

enum ArticleTitle {
  static func display(_ title: String, host: String?) -> String {
    guard let site = host.map(siteKey), site.count >= 3 else { return title }
    for separator in [" | ", " – ", " — ", " · ", " - ", " :: "] {
      guard let range = title.range(of: separator, options: .backwards) else { continue }
      let suffix = title[range.upperBound...].lowercased()
      var key = suffix.filter { $0.isLetter || $0.isNumber }
      if key.hasPrefix("the"), !site.hasPrefix("the") { key.removeFirst(3) }
      let head = title[..<range.lowerBound].trimmingCharacters(in: .whitespaces)
      guard key.count >= 3, key.count <= 40, head.count >= 3 else { continue }
      if site.hasPrefix(key) || key.hasPrefix(site) { return head }
    }
    return title
  }

  /// The registrable label: "quantamagazine" for www.quantamagazine.org,
  /// "bbc" for bbc.co.uk. A short second-level label marks a country suffix.
  private static func siteKey(_ host: String) -> String {
    let labels = host.lowercased().split(separator: ".").map(String.init)
    guard labels.count >= 2 else { return labels.first ?? "" }
    let second = labels[labels.count - 2]
    if labels.count >= 3, second.count <= 3 { return labels[labels.count - 3] }
    return second
  }
}

/// Cards answer a touch immediately and settle with a short spring.
struct LibraryPressStyle: ButtonStyle {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
      .opacity(configuration.isPressed && reduceMotion ? 0.7 : 1)
      .animation(
        configuration.isPressed
          ? .easeOut(duration: 0.12) : .spring(response: 0.34, dampingFraction: 0.68),
        value: configuration.isPressed)
  }
}

/// Native push-out wrapping avoids a short orphan at the end of a heading.
/// Keep the complete title accessible while limiting its visible layout to two lines.
struct LibraryTitle: UIViewRepresentable {
  let text: String
  var style: UIFont.TextStyle = .headline
  var pointSize: CGFloat? = nil
  var weight: UIFont.Weight = .semibold
  var design: UIFontDescriptor.SystemDesign = .default
  var query = ""
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colourScheme

  struct Configuration: Equatable {
    var text: String
    var query: String
    var style: UIFont.TextStyle
    var pointSize: CGFloat?
    var weight: UIFont.Weight
    var design: UIFontDescriptor.SystemDesign
    var category: UIContentSizeCategory
    var colourScheme: ColorScheme
  }
  final class Coordinator {
    var configuration: Configuration?
    var sizes: [CGFloat: CGSize] = [:]
  }
  func makeCoordinator() -> Coordinator { Coordinator() }

  func makeUIView(context: Context) -> UILabel {
    let label = UILabel()
    label.numberOfLines = 2
    label.lineBreakMode = .byTruncatingTail
    label.lineBreakStrategy = .pushOut
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    label.accessibilityIdentifier = "article-title-two-lines"
    return label
  }

  func updateUIView(_ label: UILabel, context: Context) {
    let configuration = Configuration(
      text: text, query: query, style: style, pointSize: pointSize, weight: weight,
      design: design, category: LibraryTextFormatting.category(dynamicTypeSize),
      colourScheme: colourScheme)
    guard context.coordinator.configuration != configuration else { return }
    context.coordinator.configuration = configuration
    context.coordinator.sizes.removeAll(keepingCapacity: true)
    label.font = LibraryTextFormatting.font(
      style: style, pointSize: pointSize, weight: weight, design: design,
      category: configuration.category)
    label.textColor = .label
    LibraryTextFormatting.apply(text, query: query, to: label)
    label.accessibilityLabel = text
  }

  func sizeThatFits(_ proposal: ProposedViewSize, uiView: UILabel, context: Context) -> CGSize? {
    let width =
      proposal.width.flatMap { $0.isFinite ? max(0, $0) : nil }
      ?? max(0, uiView.intrinsicContentSize.width)
    if let size = context.coordinator.sizes[width] { return size }
    let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    let size = CGSize(width: width, height: fitting.height)
    if context.coordinator.sizes.count >= 4 {
      context.coordinator.sizes.removeAll(keepingCapacity: true)
    }
    context.coordinator.sizes[width] = size
    return size
  }
}

/// Shared native text formatting. Content, query and Dynamic Type are stable
/// between scroll frames, so callers apply this only when their key changes.
enum LibraryTextFormatting {
  static func apply(_ text: String, query: String, to label: UILabel) {
    let words = query.split(whereSeparator: \.isWhitespace)
    guard !words.isEmpty else {
      label.attributedText = nil
      label.text = text
      return
    }
    let attributed = NSMutableAttributedString(string: text)
    for word in words {
      var search = text.startIndex..<text.endIndex
      while let range = text.range(
        of: String(word), options: [.caseInsensitive, .diacriticInsensitive], range: search)
      {
        attributed.addAttributes(
          [.backgroundColor: UIColor.secondarySystemBackground, .foregroundColor: UIColor.label],
          range: NSRange(range, in: text))
        search = range.upperBound..<text.endIndex
      }
    }
    label.attributedText = attributed
  }

  static func font(
    style: UIFont.TextStyle, pointSize: CGFloat?, weight: UIFont.Weight,
    design: UIFontDescriptor.SystemDesign = .default, category: UIContentSizeCategory
  ) -> UIFont {
    let traits = UITraitCollection(preferredContentSizeCategory: category)
    func system(_ size: CGFloat) -> UIFont {
      let font = UIFont.systemFont(ofSize: size, weight: weight)
      guard design != .default, let descriptor = font.fontDescriptor.withDesign(design) else {
        return font
      }
      return UIFont(descriptor: descriptor, size: size)
    }
    guard let pointSize else {
      return system(UIFont.preferredFont(forTextStyle: style, compatibleWith: traits).pointSize)
    }
    return UIFontMetrics(forTextStyle: style).scaledFont(
      for: system(pointSize), compatibleWith: traits)
  }

  static func category(_ size: DynamicTypeSize) -> UIContentSizeCategory {
    switch size {
    case .xSmall: .extraSmall
    case .small: .small
    case .medium: .medium
    case .large: .large
    case .xLarge: .extraLarge
    case .xxLarge: .extraExtraLarge
    case .xxxLarge: .extraExtraExtraLarge
    case .accessibility1: .accessibilityMedium
    case .accessibility2: .accessibilityLarge
    case .accessibility3: .accessibilityExtraLarge
    case .accessibility4: .accessibilityExtraExtraLarge
    case .accessibility5: .accessibilityExtraExtraExtraLarge
    @unknown default: .large
    }
  }
}

/// Retained alternative; the library currently uses ArticleCard.
/// A wide image fades into the card surface. The title remains on an opaque
/// surface, so its contrast does not depend on the publisher's photograph.
struct GradientArticleCard: View {
  let article: SavedArticle
  private let shape = RoundedRectangle(cornerRadius: 24)

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let image = article.imageURL {
        ArticleThumbnail(url: image)
          .aspectRatio(1.8, contentMode: .fit)
          .overlay(alignment: .bottom) {
            LinearGradient(
              stops: (0...16).map { step in
                let progress = Double(step) / 16
                let opacity = (1 - cos(progress * .pi)) / 2
                return .init(color: ReaderTheme.secondary.opacity(opacity), location: progress)
              }, startPoint: .top, endPoint: .bottom
            ).frame(height: 90)
          }
          .clipShape(RoundedRectangle(cornerRadius: 18))
          .padding(6).padding(.bottom, -20)
      }
      VStack(alignment: .leading, spacing: 10) {
        Text(article.title).font(.title3.weight(.semibold)).lineLimit(3)
          .frame(maxWidth: .infinity, alignment: .leading)
        if !article.subtitle.isEmpty {
          Text(article.subtitle).font(.subheadline).foregroundStyle(ReaderTheme.muted).lineLimit(2)
        }
        HStack(spacing: 7) {
          if let favicon = article.faviconURL {
            ArticleThumbnail(url: favicon, label: "Site icon", pixels: 96)
              .frame(width: 18, height: 18).clipShape(Circle())
          }
          Text(article.url.host?.replacingOccurrences(of: "www.", with: "") ?? "")
            .font(.caption).lineLimit(1)
          if !article.tagNames.isEmpty {
            Text("· " + article.tagNames.joined(separator: " · "))
              .font(.caption).lineLimit(1)
          }
        }.foregroundStyle(ReaderTheme.muted)
      }.padding(20)
    }
    .background(ReaderTheme.secondary, in: shape)
    .clipShape(shape).contentShape(shape)
  }
}

/// The existing paper still-life gains a small Arctic detail for each folder.
struct LibraryEmptyState: View {
  let folder: ArticleFolder
  var favouritesOnly = false

  private var kind: ArcticEmptyState.Kind {
    switch folder {
    case .saved: .saved
    case .favourites: .favourites
    case .downloaded: .downloaded
    case .history: .history
    case .archive: .archive
    case .tag: .tag
    }
  }

  private var detail: String {
    switch folder {
    case .saved: "Share to Arctic, or open a copied link."
    case .favourites: "Favourite an article to keep it here, even after archiving."
    case .downloaded: "Articles ready to read offline appear here."
    case .history: "Find your opened articles here."
    case .archive: "Finished for now. Kept for later."
    case .tag:
      favouritesOnly
        ? "Favourite an article with this tag to keep it here."
        : "Add this tag to a saved article to find it here."
    }
  }

  var body: some View {
    ArcticEmptyState(kind: kind, title: folder.emptyTitle, detail: detail, eyebrow: folder.title)
      .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}
