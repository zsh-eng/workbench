import SwiftUI

// MARK: Cards and rows

struct CardsSection: View {
  private static let cardStates = ["Image", "Text only", "Favourite", "Long title"]
  private static let rowStates = ["History", "Search", "No image"]
  @State private var card = ElementsLaunch.state(among: cardStates, default: "Image")
  @State private var row = ElementsLaunch.state(among: rowStates, default: "History")

  var body: some View {
    ElementsSpecimen(
      title: "Article card",
      note: "Touch and hold to feel the press. A long title drops its subtitle.",
      states: ElementsStates(id: "card", names: Self.cardStates, selection: $card)
    ) {
      Button {
      } label: {
        ArticleCard(article: cardArticle)
      }
      .buttonStyle(LibraryPressStyle())
      .padding(.horizontal, 2)
      .elementsStage()
    }
    ElementsSpecimen(
      title: "Search and history row",
      note: "Search highlights each matching word. Without a subtitle, the row shows the link.",
      states: ElementsStates(id: "row", names: Self.rowStates, selection: $row)
    ) {
      VStack(spacing: 0) {
        ForEach(Array(rowArticles.enumerated()), id: \.offset) { index, article in
          if index > 0 {
            Rectangle().fill(ReaderTheme.border).frame(height: 0.5)
              .padding(.leading, ArticleSearchRow.textInset)
              .padding(.trailing, ArticleSearchRow.horizontalInset)
          }
          Button {
          } label: {
            ArticleSearchRow(article: article, query: row == "Search" ? "mind glacial" : "")
          }
          .buttonStyle(LibraryPressStyle())
        }
      }
      .elementsStage(padding: 8)
    }
  }

  private var cardArticle: SavedArticle {
    switch card {
    case "Text only": ElementsFixtures.textOnly
    case "Favourite": ElementsFixtures.favourite
    case "Long title": ElementsFixtures.longTitle
    default: ElementsFixtures.glacial
    }
  }

  private var rowArticles: [SavedArticle] {
    switch row {
    case "No image":
      var bare = ElementsFixtures.textOnly
      bare.subtitle = ""
      return [ElementsFixtures.textOnly, bare]
    default: return [ElementsFixtures.glacial, ElementsFixtures.alienMind]
    }
  }
}

// MARK: Banners and toasts

struct BannersSection: View {
  private static let clipboardStates = ["Unsaved", "Saved", "Loading"]
  private static let continueStates = ["Image", "Text only"]
  @State private var clipboard = ElementsLaunch.state(among: clipboardStates, default: "Unsaved")
  @State private var continuation = ElementsLaunch.state(among: continueStates, default: "Image")

  var body: some View {
    ElementsSpecimen(
      title: "Clipboard banner",
      note: "A copied link offers Save and Open. A saved link offers only Open.",
      states: ElementsStates(id: "clipboard", names: Self.clipboardStates, selection: $clipboard)
    ) {
      BannerBackdrop {
        ClipboardBanner(
          url: ElementsFixtures.alienMind.url,
          preview: clipboard == "Loading" ? nil : ElementsFixtures.alienPreview,
          isSaved: clipboard == "Saved", save: {}, open: {}, dismiss: {})
      }
    }
    ElementsSpecimen(
      title: "Continue reading",
      note: "Appears for the latest article read between 1% and 95%.",
      states: ElementsStates(id: "continue", names: Self.continueStates, selection: $continuation)
    ) {
      BannerBackdrop {
        if continuation == "Image" {
          ContinueReadingBanner(article: ElementsFixtures.glacial, progress: 0.42, open: {}) {}
        } else {
          ContinueReadingBanner(article: ElementsFixtures.textOnly, progress: 0.8, open: {}) {}
        }
      }
    }
    UndoToastSpecimen()
    TaggingFeedbackSpecimen()
  }
}

/// Banners float over the library, so glass has a card to show through it.
private struct BannerBackdrop<Banner: View>: View {
  @ViewBuilder var banner: Banner
  @State private var width: CGFloat = 370

  private static var inset: CGFloat { 18 }
  private static var top: CGFloat { 14 }

  /// The bottom of the card's 2:1 image. Only the image shows, so the
  /// banner's lower half sits on the plain library surface.
  private var imageBottom: CGFloat { Self.top + max(0, width - Self.inset * 2) / 2 }

  var body: some View {
    Color.clear.frame(height: imageBottom + 46)
      .overlay(alignment: .top) {
        ArticleCard(article: ElementsFixtures.alienMind)
          .padding(.horizontal, Self.inset).padding(.top, Self.top)
          // A list gives the card its full height; show its image only.
          .fixedSize(horizontal: false, vertical: true)
          .frame(height: imageBottom, alignment: .top).clipped()
          .allowsHitTesting(false).accessibilityHidden(true)
      }
      .overlay(alignment: .bottom) { banner }
      .onGeometryChange(for: CGFloat.self) {
        $0.size.width
      } action: {
        width = $0
      }
      .elementsStage(padding: 0)
  }
}

/// A run: each Replay archives again, and the toast counts down by itself.
private struct UndoToastSpecimen: View {
  private static let states = ElementsUndoFixture.Kind.allCases.map(\.rawValue)
  @State private var kind = ElementsLaunch.state(among: states, default: "Archive")
  @State private var fixture = ElementsUndoFixture()
  @State private var player = DemoPlayer()

  var body: some View {
    ElementsSpecimen(
      title: "Undo toast",
      note: "The ring and digit count down six seconds, then the toast leaves.",
      states: ElementsStates(
        id: "undo", names: Self.states, selection: $kind, replay: player.restart)
    ) {
      VStack(spacing: 8) {
        // The toast is empty after it leaves; the stage keeps its place.
        Color.clear.frame(height: 156)
          .overlay(alignment: .bottom) {
            ArchiveUndoToast(store: fixture).padding([.horizontal, .bottom], 16)
          }
          .elementsStage(padding: 0)
          .onDemoFirstSight { player.restart() }
        DemoControls(player: player, label: "Undo toast")
      }
      .onChange(of: player.run) { _, _ in fixture.show(currentKind) }
      .onChange(of: kind) { _, _ in player.restart() }
    }
  }

  private var currentKind: ElementsUndoFixture.Kind {
    ElementsUndoFixture.Kind(rawValue: kind) ?? .archive
  }
}

/// A run: the beam hands its glow to the tag outlines once per mount.
private struct TaggingFeedbackSpecimen: View {
  private static let states = ["Two tags", "Four tags"]
  @State private var count = ElementsLaunch.state(among: states, default: "Two tags")
  @State private var player = DemoPlayer()
  @State private var dismissed = false
  /// The notice mounts when the stage is first in view, so the beam plays then.
  @State private var started = false

  var body: some View {
    ElementsSpecimen(
      title: "Tag notice",
      note: "After automatic tagging, the border glow passes to each tag before its label.",
      states: ElementsStates(
        id: "tags-notice", names: Self.states, selection: $count, replay: player.restart)
    ) {
      VStack(spacing: 8) {
        // The clear base keeps the stage when the notice is not mounted.
        ZStack {
          Color.clear
          if started, !dismissed {
            TaggingFeedback(
              title: ElementsFixtures.glacial.title,
              tags: count == "Two tags"
                ? ["Attention", "Life"]
                : ["Attention", "Life", "Learning & writing", "Society"]
            ) {
            } dismiss: {
              dismissed = true
            }
            .id(player.run)
          }
        }
        .frame(maxWidth: .infinity, minHeight: 150)
        .elementsStage()
        .onDemoFirstSight { started = true }
        DemoControls(player: player, label: "Tag notice")
      }
      .onChange(of: player.run) { _, _ in
        started = true
        dismissed = false
      }
      .onChange(of: count) { _, _ in player.restart() }
    }
  }
}

// MARK: Sheets and panels

struct SheetsSection: View {
  var body: some View {
    TagsSheetSpecimen()
    ReadingStatsSpecimen()
    AppearanceSpecimen()
  }
}

private struct TagsSheetSpecimen: View {
  private static let states = ["Few tags", "Many tags"]
  @State private var state = ElementsLaunch.state(among: states, default: "Few tags")
  @State private var presented = false
  @State private var fixture = ElementsTagFixture(tags: [])

  var body: some View {
    ElementsSpecimen(
      title: "Tags sheet",
      note: "The sheet grows with the list, up to 360 points. Choose a state to open it.",
      states: ElementsStates(id: "tags-sheet", names: Self.states, selection: $state) {
        open()
      }
    ) {
      SheetLauncher(
        title: "Tags for “\(ElementsFixtures.glacial.title)”",
        detail: fixture.saved.map {
          "Done chose " + ($0.isEmpty ? "no tags" : $0.joined(separator: ", "))
        }
          ?? "\(catalogue.count) tags, two chosen",
        action: open)
    }
    .onChange(of: state) { _, _ in open() }
    .sheet(isPresented: $presented) {
      ArticleTagsSheet(article: article, store: fixture)
    }
  }

  /// The automatic tag catalogue, or a few of its names.
  private var catalogue: [String] {
    state == "Many tags"
      ? ArticleTagCatalog.all.map(\.name) : ["Attention", "Craft", "Life"]
  }

  private var article: SavedArticle {
    var article = ElementsFixtures.glacial
    article.tags = ["Attention", "Life"]
    return article
  }

  private func open() {
    fixture = ElementsTagFixture(tags: catalogue)
    presented = true
  }
}

private struct ReadingStatsSpecimen: View {
  private static let states = ["This week", "Empty", "One article"]
  @State private var state = ElementsLaunch.state(among: states, default: "This week")
  @State private var presented = false

  var body: some View {
    ElementsSpecimen(
      title: "Reading stats",
      note: "Seven days of sample visits. Tap a day bubble to select it.",
      states: ElementsStates(id: "stats", names: Self.states, selection: $state) {
        presented = true
      }
    ) {
      SheetLauncher(
        title: state == "One article" ? "Reading time" : "Reading stats",
        detail: state == "Empty" ? "No visits" : "Visits on five of the last seven days",
        action: { presented = true })
    }
    .onChange(of: state) { _, _ in presented = true }
    .sheet(isPresented: $presented) {
      switch state {
      case "Empty": ReadingStatsView(sampleSessions: [])
      case "One article":
        ReadingStatsView(
          articleURL: ElementsFixtures.glacial.url, articleTitle: ElementsFixtures.glacial.title,
          sampleSessions: ElementsFixtures.readingWeek())
      default: ReadingStatsView(sampleSessions: ElementsFixtures.readingWeek())
      }
    }
  }
}

/// A quiet row that opens a sheet specimen.
private struct SheetLauncher: View {
  let title: String
  let detail: String
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 2) {
          Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(ReaderTheme.foreground)
          Text(detail).font(.caption).foregroundStyle(ReaderTheme.muted)
        }
        Spacer(minLength: 8)
        Text("Open").font(.subheadline.weight(.semibold)).foregroundStyle(ArcticBrand.accent)
      }
      .frame(minHeight: 44).contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .elementsStage(padding: 14)
  }
}

/// The live panel over a sample page. Choices change this page only, never
/// the saved Reader settings.
private struct AppearanceSpecimen: View {
  private static let states = ["System", "Paper", "Night"]
  @State private var state = ElementsLaunch.state(among: states, default: "Paper")
  @State private var font = "System"
  @State private var paletteName = "Paper"
  @State private var fontSize = 20.0
  @State private var padding = 18.0
  @State private var leading = 1.55
  @State private var showsPanel = true
  @Environment(\.colorScheme) private var systemScheme

  private var palette: ReadingPalette { ReadingPalette(rawValue: paletteName) ?? .system }

  var body: some View {
    ElementsSpecimen(
      title: "Reader appearance",
      note: "Try a theme, a typeface and the steppers. Choose a state again to reset.",
      states: ElementsStates(id: "appearance", names: Self.states, selection: $state) {
        reset()
      }
    ) {
      ZStack(alignment: .bottom) {
        VStack(alignment: .leading, spacing: 14) {
          Text("A good read")
            .font(ReaderAppearancePanel.sample(font, size: fontSize * 1.4).weight(.bold))
          Text(
            "Reader keeps the words and leaves the rest. Each choice below changes this page at once, so you can judge a theme, a typeface, a size, the margins and the line spacing together."
          )
          .font(ReaderAppearancePanel.sample(font, size: fontSize))
          .lineSpacing((leading - 1) * fontSize)
          .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(palette.foreground)
        .padding(.horizontal, padding).padding(.top, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(palette.background)
        if showsPanel {
          ReaderAppearancePanel(
            font: $font, paletteName: $paletteName, fontSize: $fontSize, padding: $padding,
            leading: $leading, palette: palette
          ) {
            showsPanel = false
          }
          .environment(\.colorScheme, palette.scheme ?? systemScheme)
          .padding(.horizontal, 12).padding(.bottom, 6)
        } else {
          Button("Show appearance") { showsPanel = true }
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16).frame(minHeight: 44)
            .readerGlass()
            .padding(.bottom, 16)
        }
      }
      .frame(height: 560)
      .elementsStage(padding: 0, background: palette.background)
      .onChange(of: state) { _, _ in reset() }
    }
  }

  private func reset() {
    paletteName = state
    font = "System"
    fontSize = 20
    padding = 18
    leading = 1.55
    showsPanel = true
  }
}

// MARK: Empty states

struct EmptyStatesSection: View {
  private static let folderStates = [
    "Saved", "Favourites", "Downloaded", "History", "Archive", "Tag",
  ]
  private static let otherStates = ["Search", "Highlights", "Notes", "Passages"]
  @State private var folder = ElementsLaunch.state(among: folderStates, default: "Saved")
  @State private var other = ElementsLaunch.state(among: otherStates, default: "Search")

  var body: some View {
    ElementsSpecimen(
      title: "Empty folder",
      note: "Each folder has its own study and words. A tag uses the search study.",
      states: ElementsStates(id: "empty-folder", names: Self.folderStates, selection: $folder)
    ) {
      LibraryEmptyState(folder: libraryFolder)
        .frame(height: 440)
        .elementsStage(padding: 0)
    }
    ElementsSpecimen(
      title: "Search, highlights and notes",
      note: "Smaller studies for search and the notebook.",
      states: ElementsStates(id: "empty-other", names: Self.otherStates, selection: $other)
    ) {
      otherState
        .frame(height: 360)
        .elementsStage(padding: 0)
    }
  }

  private var libraryFolder: ArticleFolder {
    switch folder {
    case "Favourites": .favourites
    case "Downloaded": .downloaded
    case "History": .history
    case "Archive": .archive
    case "Tag": .tag("Attention")
    default: .saved
    }
  }

  /// The words match the app's own empty search, notebook and article notes.
  @ViewBuilder private var otherState: some View {
    switch other {
    case "Highlights":
      ArcticEmptyState(
        kind: .highlights, title: "Keep a line.", detail: "Highlight a passage worth returning to.")
    case "Notes":
      ArcticEmptyState(
        kind: .notes, title: "Keep a thought", detail: "Leave yourself a note while you read.")
    case "Passages":
      ArcticEmptyState(
        kind: .passages, title: "No notes yet", detail: "Keep a thought about this article.")
    default:
      ArcticEmptyState(
        kind: .search, title: "No articles found", detail: "Try a title, a topic, or a website.")
    }
  }
}
