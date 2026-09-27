import SwiftUI

struct AnnotationPresentation: Identifiable {
  let id = UUID()
  var editing: UUID?
}

/// Unsent text belongs to the open article, not to persisted note records.
/// Unfocus tucks the draft away; only Send creates or updates a note.
@Observable final class ReaderNoteDraft: Identifiable {
  let id = UUID()
  let articleURL: URL
  var storageKey: String {
    let identity =
      annotationID?.uuidString
      ?? quote.map { "quote:\($0.start):\($0.exact)" } ?? "article"
    return articleURL.absoluteString + "::" + identity
  }
  var annotationID: UUID?
  var quote: ReaderQuote?
  var colour: HighlightColour = .yellow
  var text = ""

  init(in url: URL, annotation: ReaderAnnotation? = nil, quote: ReaderQuote? = nil) {
    articleURL = url
    annotationID = annotation?.id
    self.quote = annotation?.quote ?? quote
    colour = annotation?.highlightColour ?? .yellow
    text = annotation?.note ?? ""
  }
}

/// Article-specific conversation. Stable record IDs and lazy rows keep long
/// note histories inexpensive; note bodies are never truncated in the thread.
struct ReaderAnnotations: View {
  let browser: ArticleBrowser
  let presentation: AnnotationPresentation
  @Environment(\.dismiss) private var dismiss
  @State private var editing: ReaderAnnotation?
  @State private var sharing: PassageStory?
  @State private var errorMessage: String?
  @State private var detent: PresentationDetent

  init(browser: ArticleBrowser, presentation: AnnotationPresentation) {
    self.browser = browser
    self.presentation = presentation
    _editing = State(
      initialValue: presentation.editing.flatMap { id in
        browser.annotations.first { $0.id == id }
      })
    _detent = State(
      initialValue: browser.annotations.contains { !$0.note.isEmpty } ? .large : .medium)
  }

  private var notes: [ReaderAnnotation] {
    browser.annotations.sorted {
      $0.createdAt == $1.createdAt
        ? $0.id.uuidString < $1.id.uuidString : $0.createdAt < $1.createdAt
    }
  }

  var body: some View {
    NavigationStack {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 8, pinnedViews: [.sectionHeaders]) {
            if notes.isEmpty {
              ArcticEmptyState(
                kind: .passages, title: "No notes yet", detail: "Keep a thought about this article."
              )
              .padding(.vertical, 24)
            }
            ForEach(NotebookDay.group(notes)) { day in
              Section {
                ForEach(day.records) { annotation in
                  noteBubble(annotation).id(annotation.id)
                }
              } header: { NotebookDateHeader(date: day.id) }
            }
          }.padding(.horizontal, 16).padding(.bottom, 16)
        }
        .defaultScrollAnchor(.bottom)
        .onChange(of: notes.last?.id) { _, id in
          if let id { proxy.scrollTo(id, anchor: .bottom) }
        }
      }
      .background(Color(uiColor: .systemGroupedBackground))
      .safeAreaInset(edge: .bottom, spacing: 0) {
        ArticleNoteInput(browser: browser)
      }
      .navigationTitle("Notes").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
      }
    }
    .tint(ArcticBrand.accent)
    .presentationDetents([.medium, .large], selection: $detent)
    .presentationDragIndicator(.visible)
    .presentationContentInteraction(.scrolls)
    .sheet(item: $sharing) { PassageStorySheet(story: $0) }
    .sheet(item: $editing) { annotation in
      NavigationStack {
        AnnotationEditor(annotation: annotation, onChange: browser.refreshAnnotations)
      }
      .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    }
  }

  private func noteBubble(_ annotation: ReaderAnnotation) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      if let quote = annotation.quote {
        let preview = AnnotationQuote(quote: quote.exact, colour: annotation.highlightColour)
        if browser.unmatchedAnnotations.contains(annotation.id.uuidString) {
          VStack(alignment: .leading, spacing: 6) {
            preview
            Text("Passage changed").font(.caption).foregroundStyle(.secondary)
          }
        } else {
          Button {
            dismiss()
            browser.revealAnnotation(annotation.id)
          } label: {
            preview
          }.buttonStyle(.plain).accessibilityLabel("Show passage")
        }
      }
      if !annotation.note.isEmpty {
        Text(annotation.note).font(.subheadline).textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .accessibilityIdentifier("article-note-text-" + annotation.id.uuidString)
      }
      HStack {
        Text(annotation.createdAt, style: .time).font(.caption2).foregroundStyle(.tertiary)
        if AnnotationStore.shared.failedNotes[annotation.id] != nil {
          Button("Not saved · Retry") { AnnotationStore.shared.retryNote(annotation.id) }
            .font(.caption).accessibilityIdentifier("note-retry")
        }
        Spacer()
        Menu {
          Button("Share passage", systemImage: "square.and.arrow.up") {
            sharing = PassageStory(
              annotation: annotation, title: browser.readerView.title ?? browser.webView.title,
              imageURL: browser.previewImageURL)
          }.accessibilityIdentifier("share-passage-image")
          Button(
            annotation.note.isEmpty ? "Add note" : "Edit note", systemImage: "square.and.pencil"
          ) { editing = annotation }
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
          Image(systemName: "ellipsis").frame(width: 44, height: 28)
        }.accessibilityLabel("Note options")
      }
    }
    .padding(14).background(
      Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20)
    )
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("article-note-" + annotation.id.uuidString)
  }

  private func perform(_ action: () throws -> Void) {
    do {
      try action()
      browser.refreshAnnotations()
      errorMessage = nil
    } catch { errorMessage = error.localizedDescription }
  }
}

/// Draft keystrokes stay inside this small view rather than rebuilding the
/// conversation's lazy rows or sorting its note history.
private struct ArticleNoteInput: View {
  let browser: ArticleBrowser
  @State private var text = ""
  @State private var errorMessage: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(.red) }
      NoteMessageInput(text: $text, requiresSave: browser.annotationRequiresSave, send: send)
    }.padding(.horizontal, 16).padding(.vertical, 10).background(.bar)
  }

  private func send() {
    let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return }
    do {
      try browser.saveForNewAnnotation(in: browser.libraryURL)
      AnnotationStore.shared.sendNote(value, in: browser.libraryURL)
      text = ""
      errorMessage = nil
      UISelectionFeedbackGenerator().selectionChanged()
    } catch { errorMessage = error.localizedDescription }
  }
}

extension HighlightColour {
  var tint: Color {
    switch self {
    case .yellow: Color(uiColor: .systemYellow)
    case .sage: Color(uiColor: .systemGreen)
    case .rose: Color(uiColor: .systemPink)
    case .blue: Color(uiColor: .systemCyan)
    }
  }
}

/// A reply preview, never a separately clipped or scrolling passage. The full
/// source remains one tap away in Reader and the note receives the available room.
struct AnnotationQuote: View {
  let quote: String
  var colour: HighlightColour = .yellow
  var body: some View {
    Text(quote).font(.subheadline).lineLimit(2).foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.leading, 12)
      .overlay(alignment: .leading) {
        RoundedRectangle(cornerRadius: 2).fill(colour.tint).frame(width: 3)
      }
      .accessibilityIdentifier("annotation-quote-preview")
  }
}

struct AnnotationEditor: View {
  let annotation: ReaderAnnotation
  var onChange: () -> Void
  @State private var text: String
  @State private var errorMessage: String?
  @Environment(\.dismiss) private var dismiss

  init(annotation: ReaderAnnotation, onChange: @escaping () -> Void = {}) {
    self.annotation = annotation
    self.onChange = onChange
    _text = State(initialValue: annotation.note)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      if let quote = annotation.quote {
        AnnotationQuote(quote: quote.exact, colour: annotation.highlightColour)
          .padding(14)
          .background(
            annotation.highlightColour.tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
      }
      TextEditor(text: $text).scrollContentBackground(.hidden).font(.body)
        .accessibilityLabel("Note").accessibilityIdentifier("annotation-note")
      if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(.red) }
    }
    .padding(20).background(Color(uiColor: .systemBackground))
    .navigationTitle("Note").navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel") { dismiss() }.accessibilityIdentifier("annotation-cancel")
      }
      ToolbarItem(placement: .confirmationAction) {
        Button("Save", action: save).accessibilityIdentifier("annotation-save")
          .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }
    .presentationDetents([.medium, .large]).presentationDragIndicator(.visible)
    .presentationContentInteraction(.scrolls)
    .interactiveDismissDisabled(text != annotation.note)
  }

  private func save() {
    do {
      try AnnotationStore.shared.updateNote(
        text.trimmingCharacters(in: .whitespacesAndNewlines), id: annotation.id)
      onChange()
      dismiss()
    } catch { errorMessage = "Not saved: " + error.localizedDescription }
  }
}

/// Shared input geometry gives Reader's toolbar and the article conversation
/// the same composition affordance. Typing changes draft state only.
private struct NoteMessageInput: View {
  @Binding var text: String
  var requiresSave = false
  var autofocus = false
  var dismissing = false
  var onBlur: () -> Void = {}
  let send: () -> Void
  @FocusState private var focused: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var hasText: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

  var body: some View {
    HStack(alignment: .bottom, spacing: 0) {
      TextField("Write a note…", text: $text, axis: .vertical)
        .lineLimit(1...5).focused($focused).padding(.vertical, 12)
        .padding(.leading, 18).padding(.trailing, hasText ? 8 : 18)
        .frame(minHeight: 54)
        .accessibilityIdentifier("note-message-input")
      if hasText {
        Button(action: send) {
          Group {
            if requiresSave {
              Text("Save & keep note").font(.caption.weight(.semibold))
                .fixedSize().padding(.horizontal, 12)
            } else {
              Image(systemName: "arrow.up").font(.system(size: 20, weight: .semibold))
                .frame(width: 50)
            }
          }
          .foregroundStyle(Color(uiColor: .systemBackground))
          .frame(height: 40).background(ArcticBrand.accent, in: Capsule())
          .frame(height: 54).padding(.horizontal, 3)
        }
        .buttonStyle(.plain).padding(.trailing, 3)
        .accessibilityLabel(requiresSave ? "Save & keep note" : "Send note")
        .accessibilityIdentifier("note-send")
        .transition(.opacity)
      }
    }
    .font(.body).frame(minHeight: 54).readerGlass(cornerRadius: 27)
    .accessibilityElement(children: .contain).accessibilityIdentifier("note-input-bar")
    .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.15), value: hasText)
    .onAppear { focused = autofocus }
    .onChange(of: dismissing) { _, value in if value { focused = false } }
    .onChange(of: focused) { wasFocused, isFocused in
      if wasFocused && !isFocused { onBlur() }
    }
  }
}

struct ReaderNoteComposer: View {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var keyboardVisible = false
  @State private var closing = false
  @State private var sent = false
  @State private var errorMessage: String?
  let browser: ArticleBrowser
  @Bindable var draft: ReaderNoteDraft

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let quote = draft.quote {
        AnnotationQuote(quote: quote.exact, colour: draft.colour).padding(14)
          .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
      }
      if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(.red) }
      NoteMessageInput(
        text: $draft.text,
        requiresSave: draft.annotationID == nil && browser.annotationRequiresSave,
        autofocus: true, dismissing: closing, onBlur: close, send: send
      )
      .disabled(closing)
    }.padding(.horizontal, 12).padding(.bottom, 6)
      .onChange(of: browser.noteDismissRequest) { _, _ in close() }
      .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
        keyboardVisible = true
      }
      .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidHideNotification)) { _ in
        keyboardVisible = false
        if closing { finishClosing() }
      }
  }

  // The empty input responds to Send immediately; its native host stays alive
  // while the keyboard lowers, then the reading controls occupy the same bar.
  private func close() {
    guard !closing else { return }
    closing = true
    if !keyboardVisible { finishClosing() }
  }

  private func finishClosing() {
    withAnimation(.easeOut(duration: reduceMotion ? 0.1 : 0.16)) {
      browser.finishNoteDraft(draft.id, sent: sent)
    }
    if sent && draft.quote != nil { browser.refreshAnnotations() }
  }

  private func send() {
    let value = draft.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty, !closing else { return }
    do {
      if draft.annotationID == nil { try browser.saveForNewAnnotation(in: draft.articleURL) }
    } catch {
      errorMessage = error.localizedDescription
      return
    }
    guard
      AnnotationStore.shared.sendNote(
        value, in: draft.articleURL,
        annotationID: draft.annotationID, quote: draft.quote, colour: draft.colour) != nil
    else {
      errorMessage = "This passage was removed. Copy your draft before closing."
      return
    }
    sent = true
    draft.text = ""
    UISelectionFeedbackGenerator().selectionChanged()
    close()
  }
}

/// A compact, one-tap palette keeps recolouring next to the reading controls.
/// The ring and check identify selection without relying on colour alone.
struct HighlightToolbar: View {
  let annotation: ReaderAnnotation
  let browser: ArticleBrowser
  let share: () -> Void

  var body: some View {
    HStack(spacing: 0) {
      ForEach(HighlightColour.allCases) { colour in
        Button {
          perform { try AnnotationStore.shared.recolour(annotation.id, colour: colour) }
          UISelectionFeedbackGenerator().selectionChanged()
        } label: {
          ZStack {
            Circle().fill(colour.tint.opacity(0.65)).frame(width: 26, height: 26)
            if annotation.isHighlighted && annotation.highlightColour == colour {
              Circle().strokeBorder(.primary.opacity(0.7), lineWidth: 1.5)
                .frame(width: 33, height: 33)
              Image(systemName: "checkmark").font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.black.opacity(0.8))
            }
          }.frame(width: 44, height: 44)
        }
        .accessibilityLabel(colour.name + " highlight")
        .accessibilityAddTraits(
          annotation.isHighlighted && annotation.highlightColour == colour ? .isSelected : []
        )
        .accessibilityIdentifier("highlight-colour-" + colour.rawValue)
      }
      Divider().frame(height: 22).padding(.horizontal, 3)
      Button {
        browser.beginNote(annotation: annotation)
      } label: {
        Image(systemName: "square.and.pencil").frame(width: 44, height: 44)
      }
      .accessibilityLabel(annotation.note.isEmpty ? "Add note" : "Edit note")
      .accessibilityIdentifier("highlight-note")
      if annotation.isHighlighted {
        Button {
          perform { try AnnotationStore.shared.removeHighlight(annotation.id) }
          browser.readerView.evaluateJavaScript(
            "window.getSelection()?.removeAllRanges()", in: nil, in: .defaultClient
          ) { _ in }
          browser.selectedAnnotationID = nil
        } label: {
          Image(systemName: "eraser").frame(width: 44, height: 44)
        }
        .accessibilityLabel("Remove highlight").accessibilityIdentifier("highlight-remove")
      }
      Button(action: share) {
        Image(systemName: "square.and.arrow.up").frame(width: 44, height: 44)
      }.accessibilityLabel("Share passage").accessibilityIdentifier("highlight-share")
      Button {
        browser.selectedAnnotationID = nil
      } label: {
        Image(systemName: "xmark").frame(width: 44, height: 44)
      }.accessibilityLabel("Close highlight controls")
    }
    .font(.body.weight(.medium)).buttonStyle(.plain)
    .padding(.horizontal, 2).padding(.vertical, 5).readerGlass()
  }

  private func perform(_ action: () throws -> Void) {
    do {
      try action()
      browser.refreshAnnotations()
    } catch { browser.errorMessage = "Could not update passage: " + error.localizedDescription }
  }
}
