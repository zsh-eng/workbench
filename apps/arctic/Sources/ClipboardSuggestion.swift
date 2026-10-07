import SwiftUI
import UIKit

/// Refresh at library entry or after a Reader checkpoint, never during layout.
@MainActor @Observable final class ContinueReadingSuggestion {
  private(set) var article: SavedArticle?
  private(set) var progress = 0.0
  private var checkpoint = ""
  private var dismissalKey: String {
    TestMode.enabled ? "test-continue-reading-dismissed" : "continue-reading-dismissed"
  }

  @ObservationIgnored private var lookup: Task<Void, Never>?

  func refresh(from store: ArticleStore) {
    lookup?.cancel()
    let articles = store.articles
    let dismissed = UserDefaults.standard.string(forKey: dismissalKey)
    let work = Task.detached(priority: .userInitiated) {
      () -> (article: SavedArticle, progress: Double, checkpoint: String)? in
      let recent = articles.filter {
        $0.saved && $0.isArchived != true && $0.lastVisitedAt != nil
      }.sorted { $0.lastVisitedAt! > $1.lastVisitedAt! }
      for candidate in recent {
        guard !Task.isCancelled else { return nil }
        guard let json = ReaderPosition.load(candidate.url),
          let position = try? JSONDecoder().decode(ReaderPosition.self, from: Data(json.utf8)),
          position.progress.isFinite, position.progress > 0.01, position.progress < 0.95
        else { continue }
        // A visit is stable across WebView relayout and background checkpoints.
        // Do not let a subpixel position change undo an explicit dismissal.
        let checkpoint =
          candidate.url.absoluteString + "\n"
          + String(candidate.lastVisitedAt!.timeIntervalSince1970)
        // Dismiss the current suggestion without cycling through older articles.
        guard dismissed != checkpoint else { return nil }
        return (candidate, position.progress, checkpoint)
      }
      return nil
    }
    lookup = Task { [weak self, weak store] in
      let result = await withTaskCancellationHandler {
        await work.value
      } onCancel: {
        work.cancel()
      }
      guard !Task.isCancelled, let self, let store else { return }
      // The library may change while its checkpoints are read off the UI thread.
      self.article = result.flatMap { result in
        store.articles.first {
          $0.id == result.article.id && $0.saved && $0.isArchived != true
        }
      }
      self.progress = result?.progress ?? 0
      self.checkpoint = result?.checkpoint ?? ""
    }
  }

  func reconcile(with articles: [SavedArticle]) {
    guard let id = article?.id else { return }
    article = articles.first { $0.id == id && $0.saved && $0.isArchived != true }
  }

  func dismiss() {
    lookup?.cancel()
    UserDefaults.standard.set(checkpoint, forKey: dismissalKey)
    article = nil
  }
}

struct ContinueReadingBanner: View {
  let article: SavedArticle
  let progress: Double
  let open: () -> Void
  let dismiss: () -> Void

  var body: some View {
    HStack(spacing: 12) {
      if let image = article.imageURL {
        ArticleThumbnail(url: image, pixels: 192).frame(width: 38, height: 44)
          .clipShape(RoundedRectangle(cornerRadius: 7))
      } else {
        Image(systemName: "book.pages").font(.title3).foregroundStyle(ArcticBrand.accent)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(article.displayTitle).font(ReaderTheme.sans(14, weight: .medium)).lineLimit(2)
          .accessibilityIdentifier("continue-reading-title")
        HStack(spacing: 8) {
          // The bar shows how much remains; the label states it for VoiceOver.
          Capsule().fill(ReaderTheme.foreground.opacity(0.12))
            .overlay(alignment: .leading) {
              GeometryReader { bar in
                Capsule().fill(ArcticBrand.accent).frame(width: bar.size.width * progress)
              }
            }
            .frame(width: 56, height: 3)
            .accessibilityHidden(true)
          Text("\(Int(progress * 100))% read")
            .font(ReaderTheme.sans(12)).foregroundStyle(ReaderTheme.muted).lineLimit(1)
            .accessibilityLabel("Continue reading, \(Int(progress * 100)) percent read")
        }
      }
      Spacer(minLength: 0)
      Button("Continue", action: open).font(ReaderTheme.sans(14, weight: .semibold))
        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        .accessibilityIdentifier("continue-reading-open")
      Button(action: dismiss) {
        Image(systemName: "xmark").frame(width: 36, height: 44).contentShape(Rectangle())
      }
      .buttonStyle(.plain).accessibilityLabel("Dismiss")
      .accessibilityIdentifier("continue-reading-dismiss")
    }
    .padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 8)
    .readerGlass().padding(.horizontal, 20).padding(.bottom, 8)
    .accessibilityElement(children: .contain)
  }
}

/// Check only on app entry. Pattern detection does not read clipboard contents;
/// reading the matched URL still uses iOS's normal paste permission prompt.
@MainActor @Observable final class ClipboardSuggestion {
  var url: URL?
  private(set) var preview: ArticlePreview?
  private var checking = false
  private let defaults = UserDefaults.standard
  private var key: String { TestMode.enabled ? "test-clipboard-change" : "clipboard-change" }

  func check() async {
    if TestMode.enabled && !ProcessInfo.processInfo.arguments.contains("-test-clipboard") { return }
    guard !checking else { return }
    checking = true
    defer { checking = false }
    let pasteboard = UIPasteboard.general
    let change = pasteboard.changeCount
    guard defaults.object(forKey: key) == nil || defaults.integer(forKey: key) != change else {
      return
    }
    url = nil
    preview = nil
    // Record before reading: Allow Paste can itself cause a scene transition.
    defaults.set(change, forKey: key)
    let patterns: Set<UIPasteboard.DetectionPattern>? = try? await withCheckedThrowingContinuation {
      continuation in
      pasteboard.detectPatterns(for: [.probableWebURL]) { continuation.resume(with: $0) }
    }
    guard patterns?.contains(.probableWebURL) == true, pasteboard.changeCount == change,
      let text = pasteboard.string, pasteboard.changeCount == change
    else { return }
    guard let link = SharedInbox.webURL(text),
      var components = URLComponents(url: link, resolvingAgainstBaseURL: false)
    else { return }
    // Use the same cleaned URL for the preview, preload, save, and open paths.
    components.query = nil
    url = components.url
  }

  func preparePreview() async {
    preview = nil
    guard let url else { return }
    let result = try? await ArticlePreviewCache.shared.load(url)
    guard !Task.isCancelled, self.url == url else { return }
    preview = result
  }

  func dismiss() {
    url = nil
    preview = nil
  }
}

struct ClipboardBanner: View {
  let url: URL
  let preview: ArticlePreview?
  let isSaved: Bool
  let save: () -> Void
  let open: () -> Void
  let dismiss: () -> Void
  var body: some View {
    HStack(spacing: 12) {
      if let image = preview?.imageURL {
        ArticleThumbnail(url: image, pixels: 192).frame(width: 38, height: 44)
          .clipShape(RoundedRectangle(cornerRadius: 7))
      } else {
        Image(systemName: "link").font(.title3)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(preview?.title ?? "Copied link").font(ReaderTheme.sans(14, weight: .medium))
          .lineLimit(2).accessibilityIdentifier("clipboard-preview-title")
          .accessibilityValue(TestMode.enabled ? (preview?.taggingText ?? "") : "")
        Text(url.host ?? "Article").font(ReaderTheme.sans(12)).foregroundStyle(ReaderTheme.muted)
          .lineLimit(1).accessibilityLabel(url.absoluteString)
          .accessibilityIdentifier("clipboard-link")
      }
      Spacer()
      if !isSaved {
        Button("Save", action: save).font(ReaderTheme.sans(14, weight: .semibold))
          .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
          .accessibilityIdentifier("save-copied-link")
      }
      Button("Open", action: open).font(ReaderTheme.sans(14, weight: .semibold))
        .frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
        .accessibilityIdentifier("open-copied-link")
      Button(action: dismiss) {
        Image(systemName: "xmark").frame(width: 36, height: 44).contentShape(Rectangle())
      }
      .buttonStyle(.plain).accessibilityLabel("Dismiss")
      .accessibilityIdentifier("dismiss-copied-link")
    }
    .padding(.leading, 18).padding(.trailing, 6).padding(.vertical, 8)
    .readerGlass().padding(.horizontal, 20).padding(.bottom, 8)
    .accessibilityElement(children: .contain)
  }
}
