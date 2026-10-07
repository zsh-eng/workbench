import SwiftUI

/// A library-wide index. Records remain owned by AnnotationStore; the same note
/// editor is used here and in Reader, so edits never fork into a second draft.
struct LibraryAnnotations: View {
  let articles: [SavedArticle]
  let open: (ReaderAnnotation) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  @State private var filter = PassageFilter.all
  @State private var editing: ReaderAnnotation?
  @State private var sharing: PassageStory?
  @State private var errorMessage: String?
  @State private var matching: [NotebookDay] = []
  @State private var today = Calendar.current.startOfDay(for: .now)
  @Environment(\.scenePhase) private var scenePhase
  @State private var hasLoaded = false
  @State private var detent: PresentationDetent

  init(articles: [SavedArticle], open: @escaping (ReaderAnnotation) -> Void) {
    self.articles = articles
    self.open = open
    let hasNotes = AnnotationStore.shared.records.contains { $0.deletedAt == nil }
    _detent = State(initialValue: hasNotes ? .large : .medium)
  }

  private enum PassageFilter: String, CaseIterable, Sendable {
    case all = "All"
    case highlights = "Highlights"
    case notes = "Notes"
  }

  private var articleTitles: [URL: String] {
    Dictionary(articles.map { ($0.url, $0.title) }, uniquingKeysWith: { first, _ in first })
  }

  /// Filter and sort a snapshot away from scrolling and text layout. Results keep
  /// the annotation's stable identity; the lazy stack only creates visible rows.
  private struct NotebookQuery: Equatable, Sendable {
    var records: [ReaderAnnotation]
    var titles: [URL: String]
    var text: String
    var filter: PassageFilter
    var today: Date

    func results() -> [NotebookDay] {
      let filtered = records.filter { record in
        guard !Task.isCancelled, record.deletedAt == nil else { return false }
        if filter == .highlights && !record.isHighlighted { return false }
        if filter == .notes && record.note.isEmpty { return false }
        guard !text.isEmpty else { return true }
        return [
          record.quote?.exact ?? "", record.note, titles[record.articleURL] ?? "",
          record.articleURL.host ?? "",
        ].contains { $0.localizedStandardContains(text) }
      }.sorted {
        if $0.createdAt != $1.createdAt { return $0.createdAt > $1.createdAt }
        return $0.id.uuidString < $1.id.uuidString
      }
      return NotebookDay.group(filtered)
    }
  }

  var body: some View {
    let titles = articleTitles
    let request = NotebookQuery(
      records: AnnotationStore.shared.records, titles: titles,
      text: query.trimmingCharacters(in: .whitespacesAndNewlines), filter: filter, today: today)
    return NavigationStack {
      ScrollView {
        LazyVStack(spacing: 8, pinnedViews: [.sectionHeaders]) {
          if let loadError = AnnotationStore.shared.loadError {
            Text(loadError).font(.caption).foregroundStyle(.secondary)
          }
          if hasLoaded && matching.isEmpty {
            emptyState
          }
          ForEach(matching) { day in
            Section {
              ForEach(day.records) { annotation in
                passageCard(annotation, title: titles[annotation.articleURL])
              }
            } header: {
              NotebookDateHeader(date: day.id, today: today)
            }
          }
        }.padding(.horizontal, 16).padding(.bottom, 20)
      }
      .accessibilityIdentifier("notebook-scroll")
      .background(Color(uiColor: .systemGroupedBackground))
      .safeAreaInset(edge: .top, spacing: 0) {
        Picker("Passages", selection: $filter) {
          ForEach(PassageFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented).padding(.horizontal, 20).padding(.vertical, 8)
        .background(.bar)
      }
      .searchable(text: $query, prompt: "Passage, note, or article")
      .navigationTitle("Highlights & notes").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
    }
    .tint(ArcticBrand.accent)
    .task(id: request) {
      let work = Task.detached(priority: .userInitiated) { request.results() }
      await withTaskCancellationHandler {
        let result = await work.value
        guard !Task.isCancelled else { return }
        matching = result
        hasLoaded = true
      } onCancel: {
        work.cancel()
      }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { today = Calendar.current.startOfDay(for: .now) }
    }
    .onReceive(
      NotificationCenter.default.publisher(for: UIApplication.significantTimeChangeNotification)
    ) { _ in
      today = Calendar.current.startOfDay(for: .now)
    }
    .presentationDetents([.medium, .large], selection: $detent)
    .presentationDragIndicator(.visible)
    .presentationContentInteraction(.scrolls)
    .sheet(item: $sharing) { PassageStorySheet(story: $0) }
    .sheet(item: $editing) { annotation in
      NavigationStack { AnnotationEditor(annotation: annotation) }
        .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
    .alert(
      "Could not save passage",
      isPresented: Binding(
        get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
      )
    ) {
      Button("OK") { errorMessage = nil }
    } message: {
      Text(errorMessage ?? "")
    }
  }

  private var emptyState: ArcticEmptyState {
    if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      return ArcticEmptyState(
        kind: .search, title: "No passages found", detail: "Try another word or article.",
        compact: true)
    }
    switch filter {
    case .all:
      return ArcticEmptyState(
        kind: .passages, title: "Keep a thought",
        detail: "Keep a line or leave yourself a note.")
    case .highlights:
      return ArcticEmptyState(
        kind: .highlights, title: "Keep a line.",
        detail: "Highlight a passage worth returning to.")
    case .notes:
      return ArcticEmptyState(
        kind: .notes, title: "Keep a thought",
        detail: "Leave yourself a note while you read.")
    }
  }

  private func passageCard(_ annotation: ReaderAnnotation, title: String?) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Button {
        editing = annotation
      } label: {
        VStack(alignment: .leading, spacing: 8) {
          if let quote = annotation.quote {
            AnnotationQuote(quote: quote.exact, colour: annotation.highlightColour)
          }
          if !annotation.note.isEmpty {
            Text(annotation.note).font(.subheadline).fixedSize(horizontal: false, vertical: true)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }.contentShape(Rectangle())
      }.buttonStyle(.plain).accessibilityIdentifier("library-passage-" + annotation.id.uuidString)
      HStack(alignment: .center, spacing: 8) {
        Button {
          open(annotation)
        } label: {
          HStack(spacing: 5) {
            Image(systemName: "arrow.up.right").font(.caption2)
            Text(title ?? annotation.articleURL.host ?? "Article")
              .font(.caption.weight(.medium)).lineLimit(1)
          }
          .foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(annotation.quote == nil ? "Open article" : "Show in article")
        .accessibilityIdentifier("library-passage-open-" + annotation.id.uuidString)
        Menu {
          Button("Share passage", systemImage: "square.and.arrow.up") {
            sharing = PassageStory(
              annotation: annotation, title: title,
              imageURL: articles.first { $0.url == annotation.articleURL }?.imageURL)
          }.accessibilityIdentifier("share-passage-image")
          Button(
            annotation.note.isEmpty ? "Add note" : "Edit note", systemImage: "square.and.pencil"
          ) {
            editing = annotation
          }
          if annotation.isHighlighted {
            Button("Remove highlight", systemImage: "highlighter", role: .destructive) {
              perform { try AnnotationStore.shared.removeHighlight(annotation.id) }
            }
          }
          if !annotation.note.isEmpty || !annotation.isHighlighted {
            Button("Delete note", systemImage: "trash", role: .destructive) {
              perform { try AnnotationStore.shared.deleteNote(annotation.id) }
            }
          }
        } label: {
          Image(systemName: "ellipsis").frame(width: 44, height: 44).contentShape(Rectangle())
            .padding(.vertical, -8)
        }.accessibilityLabel("Passage options")
      }
    }
    .padding(14)
    .background(
      Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18))
  }

  private func perform(_ action: () throws -> Void) {
    do { try action() } catch { errorMessage = error.localizedDescription }
  }
}

/// Each capsule is one glass surface. Increased contrast and reduced
/// transparency receive an opaque semantic surface with a clear boundary.
struct LibraryGlass: ViewModifier {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  @Environment(\.colorSchemeContrast) private var contrast

  @ViewBuilder func body(content: Content) -> some View {
    if reduceTransparency || contrast == .increased {
      content.background(ReaderTheme.secondary, in: Capsule())
        .overlay { Capsule().strokeBorder(ReaderTheme.border, lineWidth: 0.5) }
    } else if #available(iOS 26.0, *) {
      content.glassEffect(.regular, in: .capsule)
    } else {
      content.background(.regularMaterial, in: Capsule())
    }
  }
}

/// A short scroll-edge fade keeps the title readable as cards pass beneath it.
/// It is a wash of the page colour, not material, so it never shows a tinted
/// band against the background; the lower edge is transparent.
struct LibraryScrollEdge: View {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
  var body: some View {
    LinearGradient(
      stops: [
        .init(color: ReaderTheme.background, location: 0),
        .init(color: ReaderTheme.background.opacity(reduceTransparency ? 1 : 0.94), location: 0.5),
        .init(
          color: ReaderTheme.background.opacity(reduceTransparency ? 0.7 : 0.55), location: 0.78),
        .init(color: ReaderTheme.background.opacity(0), location: 1),
      ], startPoint: .top, endPoint: .bottom
    )
    .allowsHitTesting(false)
  }
}

/// Native phase changes avoid per-frame offset writes solely to detect scrolling.
struct LibraryScrollActivity: ViewModifier {
  let changed: (Bool) -> Void
  @ViewBuilder func body(content: Content) -> some View {
    if #available(iOS 18.0, *) {
      content.onScrollPhaseChange { _, phase in changed(phase != .idle) }
    } else {
      content
    }
  }
}

/// Compute sections once when the records change, never during scroll layout.
struct NotebookDay: Identifiable, Sendable {
  let id: Date
  var records: [ReaderAnnotation]

  static func group(_ records: [ReaderAnnotation], calendar: Calendar = .current) -> [NotebookDay] {
    var result: [NotebookDay] = []
    for record in records {
      let day = calendar.startOfDay(for: record.createdAt)
      if result.last?.id == day {
        result[result.count - 1].records.append(record)
      } else {
        result.append(NotebookDay(id: day, records: [record]))
      }
    }
    return result
  }
}

struct NotebookDateHeader: View {
  let date: Date
  var today = Calendar.current.startOfDay(for: .now)
  private var label: String {
    let calendar = Calendar.current
    if calendar.isDate(date, inSameDayAs: today) { return "Today" }
    if let yesterday = calendar.date(byAdding: .day, value: -1, to: today),
      calendar.isDate(date, inSameDayAs: yesterday)
    {
      return "Yesterday"
    }
    let format = DateFormatter()
    format.setLocalizedDateFormatFromTemplate(
      calendar.component(.year, from: date) == calendar.component(.year, from: today)
        ? "dMMM" : "dMMMyyyy")
    return format.string(from: date)
  }
  var body: some View {
    Text(label).font(.caption.weight(.medium)).foregroundStyle(.secondary)
      .padding(.horizontal, 12).padding(.vertical, 6)
      .background(.regularMaterial, in: Capsule())
      .frame(maxWidth: .infinity).padding(.vertical, 7)
      .accessibilityAddTraits(.isHeader)
      .accessibilityIdentifier("notebook-day-" + String(Int(date.timeIntervalSince1970)))
  }
}
