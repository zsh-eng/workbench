import SwiftUI
import UIKit

/// A local export snapshot. Sharing does not mutate the highlight or send it to a service.
struct PassageStory: Identifiable {
  let id = UUID()
  let text: String
  let title: String
  let url: URL
  let pages: [String]
  let imageURL: URL?
  let highlightColour: HighlightColour

  init(annotation: ReaderAnnotation, title: String?, imageURL: URL? = nil) {
    text = annotation.quote?.exact ?? annotation.note
    self.title = title ?? annotation.articleURL.host ?? "Article"
    url = annotation.articleURL
    self.imageURL = imageURL
    highlightColour = annotation.highlightColour
    pages = Self.paginate(annotation.quote?.exact ?? annotation.note)
  }

  /// Preserve the complete passage across cards, including CJK and long words.
  /// A bounded page keeps the smallest type readable at story size.
  func pages(for layout: StoryCardLayout) -> [String] { Self.paginate(text, layout: layout) }

  private static func paginate(_ text: String, layout: StoryCardLayout = .init()) -> [String] {
    var remaining = text[...]
    var result: [String] = []
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    // The largest actual font metrics decide shared pagination. Binary search
    // bounds shaping work, including long notes and explicit paragraph breaks.
    let styles = StoryStyle.allCases
    while !remaining.isEmpty {
      let candidate = Array(remaining.prefix(300))
      var lower = 1
      var upper = candidate.count
      while lower < upper {
        let middle = (lower + upper + 1) / 2
        let sample = String(candidate.prefix(middle)) as NSString
        let fits = styles.allSatisfy { style in
          let font = style.typeface(size: layout.minimumFontSize)
          let rect = layout.quoteRect(for: .paper)
          if style.isPrinted && !PrintedPassage.fits(sample as String, font: font, size: rect.size)
          {
            return false
          }
          return sample.boundingRect(
            with: CGSize(
              width: layout.quoteRect(for: .paper).width, height: CGFloat.greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font, .paragraphStyle: paragraph], context: nil
          ).height <= layout.quoteRect(for: .paper).height - 4
        }
        if fits { lower = middle } else { upper = middle - 1 }
      }
      var end = remaining.index(remaining.startIndex, offsetBy: lower)
      if end != remaining.endIndex,
        let space = remaining[..<end].lastIndex(where: \.isWhitespace),
        remaining.distance(from: remaining.startIndex, to: space) > 100
      {
        end = remaining.index(after: space)
      }
      result.append(String(remaining[..<end]))
      remaining = remaining[end...]
    }
    return result.isEmpty ? [""] : result
  }
}

struct PassageStorySheet: View {
  let story: PassageStory
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var style = StoryStyle.paper
  @State private var page = 0
  @State private var format = StoryFormat.story
  @State private var flow: StoryFlow
  @State private var pageTexts: [String]
  @State private var includeImage = false
  @State private var articleImage: UIImage?
  @State private var imageFailed = false
  @State private var imageAttempt = 0

  init(story: PassageStory) {
    self.story = story
    _pageTexts = State(initialValue: story.pages)
    let layout = StoryCardLayout(single: true)
    _flow = State(initialValue: layout.fits(story.text, style: .paper) ? .single : .pages)
  }
  private var usesImage: Bool {
    includeImage && style.supportsArticleImage && story.imageURL != nil
  }
  private var layout: StoryCardLayout {
    StoryCardLayout(format: format, hasImage: usesImage, single: flow == .single)
  }
  private var fits: Bool { flow == .pages || layout.fits(story.text, style: style) }
  private var waitingForImage: Bool { usesImage && articleImage == nil }

  @State private var export: StoryExport?
  @State private var copied = false
  @State private var rendering = false
  @State private var error: String?

  var body: some View {
    let pages = flow == .single ? [story.text] : pageTexts
    NavigationStack {
      VStack(spacing: 16) {
        GeometryReader { geometry in
          let scale = min(geometry.size.width / 360, geometry.size.height / format.height)
          card(pages).id("\(style.rawValue)-\(page)")
            .scaleEffect(scale, anchor: .topLeading)
            .frame(width: 360 * scale, height: format.height * scale, alignment: .topLeading)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .shadow(color: .black.opacity(0.09), radius: 16, y: 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .transition(.opacity)
            .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: style)
        }.accessibilityElement(children: .ignore)
          .accessibilityLabel(pages[min(page, pages.count - 1)])
          .accessibilityValue(
            "\(style.rawValue), \(format.rawValue), \(usesImage ? "with image" : "text only"), card \(page + 1) of \(pages.count)"
          )
          .accessibilityIdentifier("story-preview")
        VStack(spacing: 8) {
          Picker("Format", selection: $format) {
            ForEach(StoryFormat.allCases) { Text($0.rawValue).tag($0) }
          }.pickerStyle(.segmented).accessibilityIdentifier("story-format")
          Picker("Quote layout", selection: $flow) {
            ForEach(StoryFlow.allCases) { Text($0.rawValue).tag($0) }
          }.pickerStyle(.segmented).accessibilityIdentifier("story-flow")
          if style.supportsArticleImage, story.imageURL != nil {
            Toggle("Article image", isOn: $includeImage)
              .font(.subheadline).accessibilityIdentifier("story-include-image")
            if waitingForImage {
              HStack {
                if imageFailed {
                  Text("Image unavailable.").font(.caption).foregroundStyle(.secondary)
                  Button("Retry") { imageAttempt += 1 }.font(.caption)
                } else {
                  ProgressView().controlSize(.small)
                  Text("Loading article image…").font(.caption).foregroundStyle(.secondary)
                }
              }
            }
          }
          if !fits {
            Text("This quote needs Pages at a readable size.")
              .font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("story-too-long")
          }
        }
        if pages.count > 1 {
          HStack(spacing: 24) {
            Button("Previous card", systemImage: "chevron.left") { page -= 1 }
              .disabled(page == 0).labelStyle(.iconOnly).frame(width: 44, height: 36)
            Text("\(page + 1) / \(pages.count)").font(.caption.monospacedDigit()).foregroundStyle(
              .secondary)
            Button("Next card", systemImage: "chevron.right") { page += 1 }
              .disabled(page + 1 == pages.count).labelStyle(.iconOnly).frame(width: 44, height: 36)
          }
        }
        ScrollView(.horizontal) {
          HStack(spacing: 12) {
            ForEach(StoryStyle.allCases) { item in
              Button {
                withAnimation(.easeOut(duration: reduceMotion ? 0.1 : 0.18)) { style = item }
              } label: {
                VStack(spacing: 7) {
                  PassageStoryCard(
                    story: story, style: item, text: pages[min(page, pages.count - 1)], page: page,
                    count: pages.count,
                    layout: StoryCardLayout(
                      format: format, hasImage: usesImage && item.supportsArticleImage,
                      single: flow == .single),
                    articleImage: item.supportsArticleImage && usesImage ? articleImage : nil
                  )
                  .scaleEffect(0.16, anchor: .topLeading)
                  .frame(width: 57.6, height: format.height * 0.16, alignment: .topLeading)
                  .clipShape(RoundedRectangle(cornerRadius: 6))
                  .overlay(
                    RoundedRectangle(cornerRadius: 6).strokeBorder(
                      style == item ? ArcticBrand.accent : .clear, lineWidth: 2)
                  )
                  .accessibilityHidden(true)
                  Text(item.rawValue).font(.caption2).foregroundStyle(.secondary)
                }
              }.buttonStyle(ArcticPressStyle()).accessibilityLabel(item.rawValue)
                .accessibilityAddTraits(style == item ? .isSelected : [])
                .accessibilityIdentifier("story-style-" + item.rawValue)
            }
          }.padding(.vertical, 2)
        }.scrollIndicators(.hidden).fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("story-styles")
        HStack(spacing: 12) {
          Button {
            UIPasteboard.general.string = story.text
            copied = true
          } label: {
            Label(copied ? "Copied" : "Copy text", systemImage: copied ? "checkmark" : "doc.on.doc")
              .frame(maxWidth: .infinity, minHeight: 44)
          }.accessibilityIdentifier("story-copy-text")
          Button {
            export = StoryExport(items: [story.text + "\n\n" + story.url.absoluteString])
          } label: {
            Label("Text + link", systemImage: "square.and.arrow.up")
              .frame(maxWidth: .infinity, minHeight: 44)
          }.accessibilityLabel("Share text and link")
            .accessibilityIdentifier("story-share-text")
        }.font(.subheadline.weight(.medium)).buttonStyle(.bordered).buttonBorderShape(.capsule)
        Button {
          render(pages)
        } label: {
          Label(rendering ? "Preparing…" : "Share image", systemImage: "square.and.arrow.up")
            .font(.headline).frame(maxWidth: .infinity).frame(height: 52)
        }.buttonStyle(.borderedProminent).buttonBorderShape(.capsule)
          .disabled(rendering || !fits || waitingForImage).accessibilityIdentifier("story-export")
      }.padding(.horizontal, 24).padding(.vertical, 12)
        .background(Color(uiColor: .systemGroupedBackground))
        .navigationTitle("Share a passage").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }.tint(ArcticBrand.accent)
      .onChange(of: format) { _, value in
        let preferred = StoryCardLayout(format: value, hasImage: usesImage, single: true)
        flow = value == .story && preferred.fits(story.text, style: style) ? .single : .pages
        refreshPages()
      }
      .onChange(of: flow) { _, _ in refreshPages() }
      .onChange(of: usesImage) { _, _ in refreshPages() }
      .task(id: "\(usesImage)-\(imageAttempt)") {
        guard usesImage, articleImage == nil else { return }
        imageFailed = false
        let loaded = await ThumbnailCache.shared.load(story.imageURL, pixels: 1080)
        guard !Task.isCancelled else { return }
        articleImage = loaded
        imageFailed = loaded == nil
      }
      .task {
        #if DEBUG
          if TestMode.enabled, ProcessInfo.processInfo.arguments.contains("-test-story-gallery") {
            do { try await PassageStoryCard.writeDesignProofs(longStory: story) } catch {
              self.error = "Design proof failed: \(error.localizedDescription)"
            }
          }
        #endif
      }
      .sheet(item: $export) { item in StoryActivity(items: item.items) }
      .alert(
        "Could not create image",
        isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })
      ) {
        Button("OK") { error = nil }
      } message: {
        Text(error ?? "")
      }
  }

  private func refreshPages() {
    page = 0
    pageTexts = story.pages(for: StoryCardLayout(format: format, hasImage: usesImage))
  }

  private func card(_ pages: [String]) -> PassageStoryCard {
    PassageStoryCard(
      story: story, style: style, text: pages[min(page, pages.count - 1)], page: page,
      count: pages.count, layout: layout, articleImage: usesImage ? articleImage : nil)
  }

  @MainActor private func render(_ pages: [String]) {
    rendering = true
    let content = card(pages)
    // Only the selected card is rasterized. Browsing templates retains no bitmap queue.
    Task { @MainActor in
      await Task.yield()
      let renderer = ImageRenderer(content: content)
      renderer.scale = 3
      if let image = renderer.uiImage {
        export = StoryExport(items: [image])
      } else {
        error = "Please try again."
      }
      rendering = false
    }
  }
}

private struct StoryExport: Identifiable {
  let id = UUID()
  let items: [Any]
}
private struct StoryActivity: UIViewControllerRepresentable {
  let items: [Any]
  func makeUIViewController(context: Context) -> UIActivityViewController {
    UIActivityViewController(activityItems: items, applicationActivities: nil)
  }
  func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// Feedback only: no looping or scrolling-dependent animation, with a gentle
/// opacity alternative for Reduce Motion. Native sheets own presentation motion.
struct ArcticPressStyle: ButtonStyle {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
      .opacity(configuration.isPressed ? 0.8 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}
