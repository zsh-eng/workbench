import SwiftUI
import UIKit

/// Sample content for Elements. It uses the two bundled articles from
/// onboarding and Article replay (credited in THIRD_PARTY_NOTICES.txt) and the
/// app's reserved `fixture.example` host. Nothing here touches the library,
/// the network, or the disk.
@MainActor enum ElementsFixtures {
  /// A scheme no loader fetches. If the memory cache drops an image, the
  /// thumbnail shows its placeholder; it never starts a request.
  static let glacialImage = URL(string: "arctic-elements://image/glacial-longings")!
  static let alienImage = URL(string: "arctic-elements://image/an-alien-mind")!

  private static var resized: [String: UIImage] = [:]

  /// Puts the bundled artwork in the thumbnail memory cache at each display
  /// size, so production thumbnail views find it. Safe to call again.
  static func prepare() {
    for (url, asset) in [(glacialImage, "OnboardingArticle"), (alienImage, "AlienMindReplay")] {
      for pixels in [960, 256, 192] {
        guard let image = image(asset, pixels: pixels) else { continue }
        ThumbnailCache.shared.insert(image, for: url, pixels: pixels)
      }
    }
  }

  private static func image(_ asset: String, pixels: Int) -> UIImage? {
    let key = "\(asset)-\(pixels)"
    if let image = resized[key] { return image }
    guard let source = UIImage(named: asset) else { return nil }
    let scale = min(1, CGFloat(pixels) / max(source.size.width, source.size.height))
    let size = CGSize(width: source.size.width * scale, height: source.size.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      source.draw(in: CGRect(origin: .zero, size: size))
    }
    resized[key] = image
    return image
  }

  // MARK: Articles

  static let glacial: SavedArticle = {
    var article = SavedArticle(
      url: URL(string: "https://emergencemagazine.org/essay/glacial-longings/")!,
      title: "Glacial Longings")
    article.subtitle = "Elizabeth Rush"
    article.taggingText = article.subtitle
    article.imageURL = glacialImage
    article.previewFetchedAt = .now
    return article
  }()

  static let alienMind: SavedArticle = {
    var article = SavedArticle(
      url: URL(string: "https://openai.com/index/an-alien-mind/")!, title: "An Alien Mind")
    article.subtitle = alienMindDescription
    article.taggingText = alienMindDescription
    article.imageURL = alienImage
    article.previewFetchedAt = .now
    return article
  }()

  static let alienMindDescription =
    "Jakub Pachocki reflects on increasingly capable AI and the challenge of keeping it aligned. He calls for stronger safeguards and international coordination."

  static var favourite: SavedArticle {
    var article = glacial
    article.isFavourite = true
    return article
  }

  static let textOnly: SavedArticle = {
    var article = SavedArticle(
      url: URL(string: "https://fixture.example/notes-on-reading-slowly")!,
      title: "Notes on reading slowly")
    article.subtitle = "A link without a preview image gets a text card on the secondary surface."
    article.taggingText = article.subtitle
    article.previewFetchedAt = .now
    return article
  }()

  static let longTitle: SavedArticle = {
    var article = SavedArticle(
      url: URL(string: "https://fixture.example/long-title")!,
      title:
        "A long title takes two balanced lines and then an ellipsis, so the card never grows past them | Fixture"
    )
    article.subtitle = "A subtitle shows only when the title fits on one line."
    article.taggingText = article.subtitle
    article.imageURL = alienImage
    article.previewFetchedAt = .now
    return article
  }()

  static let alienPreview = ArticlePreview(
    title: "An Alien Mind", subtitle: alienMindDescription, taggingText: alienMindDescription,
    imageURL: alienImage, faviconURL: nil)

  // MARK: Reading time

  /// A week of visits across three articles, ending today.
  static func readingWeek(now: Date = .now) -> [ArticleReadingSession] {
    let calendar = Calendar.current
    let minutes = [7.0, 18, 0, 12, 25, 4, 15]
    return minutes.enumerated().flatMap { index, minutes -> [ArticleReadingSession] in
      guard minutes > 0,
        let day = calendar.date(byAdding: .day, value: index - 6, to: now)
      else { return [] }
      let url = [glacial.url, alienMind.url, textOnly.url][index % 3]
      return [
        ArticleReadingSession(
          id: UUID(), articleURL: url, startedAt: day, updatedAt: day, seconds: minutes * 60)
      ]
    }
  }
}

/// Undo receipts for the toast specimen, kept in memory.
@MainActor @Observable final class ElementsUndoFixture: UndoReceiptSource {
  enum Kind: String, CaseIterable {
    case archive = "Archive"
    case remove = "Remove"
    case bulk = "Bulk"
  }
  private(set) var undoReceipt: UndoReceipt?

  func show(_ kind: Kind) {
    let action: UndoReceipt.Action =
      switch kind {
      case .archive: .archive(previous: [UUID(): false], archived: true)
      case .remove: .remove([UndoReceipt.Removed(index: 0, article: ElementsFixtures.glacial)])
      case .bulk:
        .archive(previous: [UUID(): false, UUID(): false, UUID(): false], archived: true)
      }
    undoReceipt = UndoReceipt(action: action)
  }

  func undo(_ id: UUID) { dismissUndo(id) }

  func dismissUndo(_ id: UUID) {
    if undoReceipt?.id == id { undoReceipt = nil }
  }
}

/// A tag catalogue for the tags sheet. Done keeps the choice on this page only.
@MainActor @Observable final class ElementsTagFixture: ArticleTagSource {
  private(set) var allTags: [String]
  private(set) var saved: [String]?

  init(tags: [String]) { allTags = tags }

  func setTags(_ tags: [String], for id: UUID) { saved = tags.sorted() }
}
