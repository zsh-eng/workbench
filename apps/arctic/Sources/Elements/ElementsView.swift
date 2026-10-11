import SwiftUI

/// Arctic's parts on sample data, one section at a time, for design review.
/// It follows docs/ELEMENTS.md. Specimens render production views with
/// fixtures; nothing here reads or writes the library.
struct ElementsView: View {
  var close: (() -> Void)?
  @Environment(\.dismiss) private var dismiss
  @State private var path: [ElementsSection]

  init(initialSection: ElementsSection? = nil, close: (() -> Void)? = nil) {
    self.close = close
    _path = State(initialValue: initialSection.map { [$0] } ?? [])
  }

  var body: some View {
    NavigationStack(path: $path) {
      List {
        Section {
          ForEach(ElementsSection.allCases) { section in
            NavigationLink(value: section) {
              VStack(alignment: .leading, spacing: 3) {
                Text(section.title).font(.body.weight(.medium))
                Text(section.summary).font(.footnote).foregroundStyle(ReaderTheme.muted)
              }
              .padding(.vertical, 4)
            }
            .accessibilityIdentifier("elements-section-" + section.rawValue)
          }
        } footer: {
          Text("Sample data only. Elements never reads or changes your library.")
        }
      }
      .navigationTitle("Elements")
      .toolbar { ElementsCloseButton(action: finish) }
      .navigationDestination(for: ElementsSection.self) { section in
        ElementsSectionPage(section: section, path: $path, close: finish)
      }
    }
    .foregroundStyle(ReaderTheme.foreground)
    .tint(ArcticBrand.accent)
    .onAppear { ElementsFixtures.prepare() }
  }

  private func finish() {
    if let close { close() } else { dismiss() }
  }
}

/// Sections in page order: Foundations first, then parts from small to large.
enum ElementsSection: String, CaseIterable, Identifiable, Hashable {
  case foundations, cards, news, banners, sheets, empty

  var id: String { rawValue }

  var title: String {
    switch self {
    case .foundations: "Foundations"
    case .cards: "Cards and rows"
    case .news: "News shelf"
    case .banners: "Banners and toasts"
    case .sheets: "Sheets and panels"
    case .empty: "Empty states"
    }
  }

  var summary: String {
    switch self {
    case .foundations: "Colours, type, radii and motion"
    case .cards: "Library cards and search rows"
    case .news: "The bubble that opens news, frame by frame"
    case .banners: "Clipboard, Continue reading, Undo and tags"
    case .sheets: "Tags, reading stats and Reader appearance"
    case .empty: "Folders, search and notes with nothing in them"
    }
  }

  var lede: String {
    switch self {
    case .foundations:
      "The values that every part uses. Colours show their light and dark values."
    case .cards:
      "Cards fill Saved, Favourites, Downloaded and tags. History, Archive and search use rows."
    case .news:
      "A single distance drives the bubble, from 0 (closed) to 128 points (open)."
    case .banners:
      "Transient surfaces above the search bar and the library. Buttons here do nothing."
    case .sheets:
      "Sheets open on sample data. Saving changes only this page."
    case .empty:
      "Ink-wash studies on the library surface. Artwork drops first when space is short."
    }
  }
}

/// One section: a lede and its specimens. The title menu moves between sections.
private struct ElementsSectionPage: View {
  let section: ElementsSection
  @Binding var path: [ElementsSection]
  let close: () -> Void
  @State private var viewport = CGRect.zero

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 44) {
        Text(section.lede)
          .font(.subheadline).foregroundStyle(ReaderTheme.muted)
          .fixedSize(horizontal: false, vertical: true)
        content
      }
      .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 56)
      .frame(maxWidth: 640, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .onGeometryChange(for: CGRect.self) { proxy in
      let frame = proxy.frame(in: .global)
      let insets = proxy.safeAreaInsets
      return CGRect(
        x: frame.minX + insets.leading, y: frame.minY + insets.top,
        width: max(0, frame.width - insets.leading - insets.trailing),
        height: max(0, frame.height - insets.top - insets.bottom))
    } action: {
      viewport = $0
    }
    .environment(\.demoViewport, viewport)
    .background(ReaderTheme.background)
    .navigationTitle(section.title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbarTitleMenu {
      ForEach(ElementsSection.allCases) { other in
        Button(other.title) { path = [other] }
      }
    }
    .toolbar { ElementsCloseButton(action: close) }
    .onAppear { ElementsFixtures.prepare() }
    .accessibilityIdentifier("elements-page-" + section.rawValue)
  }

  @ViewBuilder private var content: some View {
    switch section {
    case .foundations: FoundationsSection()
    case .cards: CardsSection()
    case .news: NewsSection()
    case .banners: BannersSection()
    case .sheets: SheetsSection()
    case .empty: EmptyStatesSection()
    }
  }
}

private struct ElementsCloseButton: ToolbarContent {
  let action: () -> Void

  var body: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Button(action: action) {
        Image(systemName: "xmark")
      }
      .accessibilityLabel("Close Elements")
      .accessibilityIdentifier("close-elements")
    }
  }
}

// MARK: Specimens

/// A part on a stage. The title names it as the user knows it; the note says
/// what to try. A specimen with states has a row of them above its stage.
struct ElementsSpecimen<Stage: View>: View {
  let title: String
  let note: String
  var states: ElementsStates?
  @ViewBuilder var stage: Stage

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      VStack(alignment: .leading, spacing: 3) {
        Text(title).font(.headline)
          .accessibilityAddTraits(.isHeader)
        Text(note).font(.subheadline).foregroundStyle(ReaderTheme.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
      if let states { ElementsStatePicker(states: states) }
      stage
    }
  }
}

/// Named states for a specimen. Choosing the current state again replays it.
struct ElementsStates {
  /// Identifies the picker in UI tests: `<id>-state-<name>`.
  let id: String
  let names: [String]
  let selection: Binding<String>
  var replay: @MainActor () -> Void = {}
}

private struct ElementsStatePicker: View {
  let states: ElementsStates
  @Namespace private var indicator
  @Environment(\.articleReduceMotion) private var reduceMotion

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 2) {
        ForEach(states.names, id: \.self) { name in
          let selected = states.selection.wrappedValue == name
          Button {
            if selected {
              states.replay()
            } else {
              withAnimation(reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.84)) {
                states.selection.wrappedValue = name
              }
            }
          } label: {
            Text(name).font(.subheadline.weight(.semibold))
              .foregroundStyle(selected ? ReaderTheme.foreground : ReaderTheme.muted)
              .padding(.horizontal, 14).frame(minHeight: 40)
              .background {
                if selected {
                  Capsule().fill(ReaderTheme.foreground.opacity(0.08))
                    .matchedGeometryEffect(id: "state", in: indicator)
                }
              }
              .contentShape(Capsule())
          }
          .buttonStyle(.plain)
          .accessibilityAddTraits(selected ? .isSelected : [])
          .accessibilityHint(selected ? "Plays this state again" : "")
          .accessibilityIdentifier(states.id + "-state-" + name)
        }
      }
      .padding(2)
    }
    .scrollClipDisabled()
    .sensoryFeedback(.selection, trigger: states.selection.wrappedValue)
  }
}

extension View {
  /// The page surface with a hairline edge, so a part reads as a specimen.
  func elementsStage(padding: CGFloat = 16, background: Color = ReaderTheme.background)
    -> some View
  {
    let shape = RoundedRectangle(cornerRadius: 24, style: .continuous)
    return self.padding(padding)
      .frame(maxWidth: .infinity)
      .background(background, in: shape)
      .clipShape(shape)
      .overlay(shape.strokeBorder(ReaderTheme.border, lineWidth: 0.5))
  }
}

// MARK: Launch

/// Launch arguments for screenshots and recordings:
/// - `-ArcticElements <section>` opens Elements at a section
///   (foundations, cards, news, banners, sheets, empty).
/// - `-ArcticElementsTime 0.3` opens timelines paused at 0.3 s.
/// - `-ArcticElementsAutoplay NO` waits for Play.
/// - `-ArcticElementsState Close` chooses that state where a specimen has it.
enum ElementsLaunch {
  private static var defaults: UserDefaults { .standard }

  static var requested: Bool { defaults.string(forKey: "ArcticElements") != nil }

  static var section: ElementsSection? {
    defaults.string(forKey: "ArcticElements").flatMap { ElementsSection(rawValue: $0.lowercased()) }
  }

  static var time: Double? {
    defaults.string(forKey: "ArcticElementsTime").flatMap(Double.init)
  }

  static var autoplay: DemoPlayer.Autoplay {
    let value = defaults.string(forKey: "ArcticElementsAutoplay")?.lowercased()
    return ["0", "no", "false"].contains(value ?? "") ? .manual : .visible
  }

  /// The launch state when `names` has it, otherwise `fallback`.
  static func state(among names: [String], default fallback: String) -> String {
    guard let wanted = defaults.string(forKey: "ArcticElementsState")?.lowercased() else {
      return fallback
    }
    return names.first { $0.lowercased() == wanted } ?? fallback
  }
}
