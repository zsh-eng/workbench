import AppKit
import SwiftUI
import WebKit

struct MacReaderPane: View {
  @Bindable var reader: MacReader
  @Bindable var workspace: MacWorkspace
  @State private var findText = ""
  var body: some View {
    VStack(spacing: 0) {
      if reader.showFind {
        HStack {
          Image(systemName: "magnifyingglass")
          TextField("Find in article", text: $findText).onSubmit { reader.find(findText) }
            .textFieldStyle(.roundedBorder)
          Button {
            reader.find(findText, backwards: true)
          } label: {
            Image(systemName: "chevron.up")
          }
          Button {
            reader.find(findText)
          } label: {
            Image(systemName: "chevron.down")
          }
          Button("Done") { reader.showFind = false }
        }.padding(12).background(.bar)
      }
      ZStack {
        if reader.websiteVisible, let website = reader.websiteView {
          MacWebSurface(webView: website).opacity(reader.sourceCommitted ? 1 : 0)
          if !reader.sourceCommitted && reader.error == nil { ProgressView().controlSize(.small) }
        } else {
          MacWebSurface(webView: reader.readerView).opacity(reader.ready ? 1 : 0)
          if !reader.ready && reader.error == nil {
            VStack(spacing: 16) {
              ArcticMark().frame(width: 38, height: 38).opacity(0.6)
              Text(workspace.selectedTab?.title ?? "Opening article").font(
                .system(size: 25, design: .serif)
              ).lineLimit(2)
              ProgressView().controlSize(.small)
            }.padding(48).frame(maxWidth: .infinity, maxHeight: .infinity)
          }
        }
      }
      if let error = reader.error {
        HStack {
          Text(error).font(.callout).foregroundStyle(.secondary)
          Spacer()
          Button("Retry") { reader.refresh() }
          Button("Website") { if !reader.websiteVisible { reader.toggleWebsite() } }
        }.padding(14).background(.bar)
      }
    }
    .overlay(alignment: .bottomTrailing) {
      if workspace.showDiagnostics { MacFrameCounter(diagnostics: reader.diagnostics).padding(12) }
    }
    .onAppear { updateDiagnostics() }
    .onChange(of: workspace.showDiagnostics) { updateDiagnostics() }
    .onChange(of: reader.websiteVisible) { updateDiagnostics() }
    .onChange(of: reader.sourceCommitted) { updateDiagnostics() }
    .onChange(of: reader.ready) { updateDiagnostics() }
    .onChange(of: reader.url) { updateDiagnostics() }
    .onChange(of: workspace.windowActive) { updateDiagnostics() }
    .onDisappear { reader.diagnostics.stop() }
    .onChange(of: workspace.annotations.records) { _, _ in reader.renderAnnotations() }
    .onAppear { reader.onShortcuts = { workspace.showShortcuts = true } }
  }
  private func updateDiagnostics() {
    reader.diagnostics.attach(
      to: reader.websiteVisible ? reader.websiteView : reader.readerView,
      enabled: workspace.showDiagnostics && workspace.windowActive)
  }

}

struct MacNotesPane: View {
  @Bindable var workspace: MacWorkspace
  @Bindable var reader: MacReader
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text("Notes").font(.system(size: 13, weight: .medium))
        Spacer()
        Button("Hide") { workspace.showNotes = false }
          .buttonStyle(.plain).font(.system(size: 11)).foregroundStyle(.secondary)
          .accessibilityLabel("Hide notes")
      }.padding(.horizontal, 20).frame(height: 46)
      let notes = workspace.annotations.annotations(for: reader.url).sorted {
        $0.createdAt < $1.createdAt
      }
      if notes.isEmpty {
        VStack(spacing: 12) {
          Text("A thought worth keeping.").font(.system(size: 19, design: .serif))
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        ScrollViewReader { proxy in
          ScrollView {
            LazyVStack(alignment: .leading, spacing: 16) {
              ForEach(notes) { note in MacNoteBubble(note: note, workspace: workspace).id(note.id) }
            }.padding(18)
          }.onChange(of: notes.count) { _, _ in
            if let id = notes.last?.id { proxy.scrollTo(id, anchor: .bottom) }
          }
        }
      }
      VStack(alignment: .leading, spacing: 10) {
        if let quote = reader.quotedDraft {
          HStack {
            Text(quote.exact).lineLimit(2).font(.system(size: 12, design: .serif))
              .padding(.leading, 9).overlay(alignment: .leading) {
                Capsule().fill(ArcticBrand.accent).frame(width: 2)
              }
            Button {
              reader.quotedDraft = nil
            } label: {
              Image(systemName: "xmark")
            }.buttonStyle(.plain)
          }
        }
        HStack(alignment: .bottom) {
          MacNoteInput(text: $reader.draft, send: send).frame(height: 44)
          Button(action: send) {
            MacSendGlyph().stroke(
              style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round)
            )
            .frame(width: 20, height: 20).foregroundStyle(.white)
            .frame(width: 32, height: 30).background(
              ArcticBrand.accent, in: RoundedRectangle(cornerRadius: 12))
          }.buttonStyle(.plain)
            .opacity(reader.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 1)
            .disabled(reader.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .help("Send · Return (Shift-Return for a new line)").accessibilityLabel(
              workspace.selectedArticle?.saved == true ? "Send note" : "Save & keep note"
            )
            .padding(.bottom, 6)

        }
      }.padding(14).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 20))
        .padding(16)
    }.background(Color(nsColor: .textBackgroundColor))
      .modifier(MacPanelReveal())
  }
  private func send() {
    let text = reader.draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    do {
      if workspace.store.article(for: reader.url)?.saved != true {
        try workspace.store.setSaved(true, url: reader.url)
        reader.persistReader()
      }
      guard workspace.annotations.sendNote(text, in: reader.url, quote: reader.quotedDraft) != nil
      else { return }
      reader.draft = ""
      reader.quotedDraft = nil
    } catch { workspace.error = error.localizedDescription }
  }
}

struct MacNoteBubble: View {
  let note: ReaderAnnotation
  let workspace: MacWorkspace
  @State private var editing = false
  @State private var draft = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let quote = note.quote {
        Text(quote.exact).font(.system(size: 14, design: .serif)).lineLimit(3)
          .padding(.leading, 10).padding(.vertical, 3)
          .overlay(alignment: .leading) { Capsule().fill(colour).frame(width: 3) }
      }
      if !note.note.isEmpty { Text(note.note).font(.system(size: 13)).textSelection(.enabled) }
      if workspace.annotations.failedNotes[note.id] != nil {
        Button("Retry saving") { workspace.annotations.retryNote(note.id) }
      }
    }.padding(14).frame(maxWidth: .infinity, alignment: .leading)
      .background(.quaternary.opacity(0.45), in: RoundedRectangle(cornerRadius: 15))
      .contextMenu {
        Button("Edit note") {
          draft = note.note
          editing = true
        }
        if !note.note.isEmpty {
          Button("Delete note") { perform { try workspace.annotations.deleteNote(note.id) } }
        }
        if note.isHighlighted {
          Button("Remove highlight") {
            perform { try workspace.annotations.removeHighlight(note.id) }
          }
        }
      }
      .sheet(isPresented: $editing) {
        VStack(alignment: .leading, spacing: 18) {
          Text("Edit note").font(.title2)
          TextEditor(text: $draft).frame(width: 400, height: 160)
          HStack {
            Button("Cancel") { editing = false }.keyboardShortcut(.cancelAction)
            Spacer()
            Button("Save") {
              perform { try workspace.annotations.updateNote(draft, id: note.id) }
              editing = false
            }
            .keyboardShortcut(.defaultAction)
          }
        }.padding(24)
      }
  }
  private var colour: Color {
    switch note.highlightColour {
    case .yellow: .yellow
    case .sage: .green
    case .rose: .pink
    case .blue: ArcticBrand.accent
    }
  }
  private func perform(_ action: () throws -> Void) {
    do { try action() } catch { workspace.error = error.localizedDescription }
  }
}

struct MacNotebook: View {
  let workspace: MacWorkspace
  var body: some View {
    let notes = workspace.annotations.records.filter { $0.deletedAt == nil }.sorted {
      $0.createdAt > $1.createdAt
    }
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        Text("Notebook").font(.system(size: 32, weight: .medium, design: .rounded)).padding(
          .bottom, 10)
        if notes.isEmpty {
          Text("Thoughts find a home here.").font(.system(size: 23, design: .serif))
            .foregroundStyle(.secondary)
        }
        ForEach(notes) { note in
          VStack(alignment: .leading, spacing: 6) {
            Button(
              workspace.store.article(for: note.articleURL)?.title ?? note.articleURL.host
                ?? "Article"
            ) {
              workspace.open(note.articleURL)
              workspace.showNotes = true
            }.buttonStyle(.plain).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            MacNoteBubble(note: note, workspace: workspace)
          }
        }
      }.padding(32).frame(maxWidth: 800)
    }.frame(maxWidth: .infinity)
  }
}

struct MacShortcutsPanel: View {
  @Environment(\.dismiss) private var dismiss
  @State private var query = ""
  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        Text("A little more fluent.").font(.system(size: 29, design: .serif))
        Spacer()
        ArcticMark().frame(width: 30, height: 30)
      }
      TextField("Find a shortcut", text: $query).textFieldStyle(.roundedBorder)
      VStack(spacing: 13) {
        ForEach(
          MacShortcut.allCases.filter { query.isEmpty || $0.title.localizedStandardContains(query) }
        ) { shortcut in
          HStack {
            Text(shortcut.title)
            Spacer()
            Text(shortcut.keys).font(.system(.callout, design: .monospaced)).foregroundStyle(
              .secondary)
          }
        }
      }
      HStack {
        Text("Press ? while browsing to open this guide.").font(.caption).foregroundStyle(
          .secondary)
        Spacer()
        Button("Done") { dismiss() }.keyboardShortcut(.cancelAction)
      }
    }.padding(30).frame(width: 480)
  }
}

struct MacStatsPanel: View {
  let stats: ReadingStats
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack {
        Text("Time well spent").font(.system(size: 30, design: .serif))
        Spacer()
        ArcticMark().frame(width: 28, height: 28)
      }
      Group {
        VStack(alignment: .leading, spacing: 20) {
          Text(ReadingStats.duration(stats.weekSeconds)).font(
            .system(size: 44, weight: .bold, design: .rounded))
          Text("This week").foregroundStyle(.secondary)
          HStack(alignment: .bottom, spacing: 14) {
            ForEach(stats.days) { day in
              VStack {
                Capsule().fill(ArcticBrand.accent.opacity(day.seconds > 0 ? 0.7 : 0.15))
                  .frame(
                    height: max(8, 90 * day.seconds / max(1, stats.days.map(\.seconds).max() ?? 1))
                  )
                  .frame(height: 100, alignment: .bottom)
                Text(day.date, format: .dateTime.weekday(.narrow)).font(.caption)
              }
            }
          }
        }.padding(26).background(
          ArcticBrand.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 30))
        HStack {
          Text("\(stats.articles) articles")
          Spacer()
          Text("\(stats.visits) visits")
          Spacer()
          Text("\(stats.activeDays) \(stats.activeDays == 1 ? "day" : "days")")
        }.font(.subheadline)
        Text(
          "Estimated time in saved articles. Idle gaps over 2 minutes are excluded. Articles count after 1 minute across the last 7 days."
        ).font(.caption).foregroundStyle(.secondary)
      }
    }.padding(48).frame(maxWidth: 720)
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      .accessibilityIdentifier("reading-stats-page")
  }
}

struct MacTaggingSettings: View {
  let workspace: MacWorkspace
  @Environment(\.dismiss) private var dismiss
  @State private var key = ""
  @State private var error: String?
  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      Text("A little magic.").font(.system(size: 30, design: .serif))
      Text(
        "Your Jev key stays in this Mac’s Keychain. Automatic tagging sends article titles and excerpts to Jev."
      )
      .font(.callout).foregroundStyle(.secondary)
      SecureField("Jev API key", text: $key).textFieldStyle(.roundedBorder)
      if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
      HStack {
        Button("Remove key") {
          do {
            try JevKeychain.delete()
            dismiss()
          } catch { self.error = error.localizedDescription }
        }
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("Save key") {
          do {
            try JevKeychain.save(key.trimmingCharacters(in: .whitespacesAndNewlines))
            TaggingPreferences.enabled = true
            workspace.store.resumeTagging()
            dismiss()
          } catch { self.error = error.localizedDescription }
        }.disabled(key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).keyboardShortcut(
          .defaultAction)
      }
    }.padding(28).frame(width: 470)
  }
}

/// A reused native tooltip follows the selected passage. These controls exist
/// only while a passage is selected, leaving the entire reading area available.
struct MacSelectionTools: View {
  let reader: MacReader
  var body: some View {
    VStack(spacing: 6) {
      if !reader.isSaved { Text("Save & highlight").font(.caption).foregroundStyle(.secondary) }
      HStack(spacing: 2) {
        ForEach(HighlightColour.allCases) { colour in
          Button {
            reader.colourSelection(colour)
          } label: {
            Circle().fill(tint(colour)).frame(width: 18, height: 18)
              .overlay(Circle().strokeBorder(.primary.opacity(0.14)))
              .frame(width: 34, height: 30).contentShape(Capsule())
          }.buttonStyle(MacQuietButtonStyle())
            .help(colour.name).accessibilityLabel("Highlight " + colour.name)
        }
        Divider().frame(height: 18)
        Button {
          reader.quoteSelection()
        } label: {
          Image(systemName: "square.and.pencil").frame(width: 28, height: 28)
        }.buttonStyle(MacQuietButtonStyle()).help("Quote in note").accessibilityLabel(
          "Quote in note")
        Button {
          reader.removeFocusedHighlight()
        } label: {
          Image(systemName: "eraser").frame(width: 28, height: 28)
        }.buttonStyle(MacQuietButtonStyle()).help("Remove highlight").accessibilityLabel(
          "Remove highlight"
        )
        .disabled(reader.focusedAnnotation == nil)
        .opacity(reader.focusedAnnotation == nil ? 0.35 : 1)
      }
    }.padding(.horizontal, 6).padding(.vertical, 4).fixedSize()
  }
  private func tint(_ colour: HighlightColour) -> Color {
    switch colour {
    case .yellow: .yellow
    case .sage: .green
    case .rose: .pink
    case .blue: .cyan
    }
  }
}

struct MacFrameCounter: View {
  @Bindable var diagnostics: MacDiagnostics
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text("Web \(diagnostics.webFPS) · UI \(diagnostics.uiFPS) fps").fontWeight(.medium)
      Text(
        "p95 \(diagnostics.webP95, specifier: "%.1f") / \(diagnostics.uiP95, specifier: "%.1f") ms · \(diagnostics.gaps) web gaps"
      )
      HStack {
        Button(diagnostics.recording ? "Stop (\(diagnostics.seconds)s)" : "Record 30s") {
          if diagnostics.recording { diagnostics.endTrace() } else { diagnostics.beginTrace() }
        }
        if diagnostics.hasTrace { Button("Save trace…") { diagnostics.exportTrace() } }
      }.buttonStyle(.borderless)
    }.font(.system(size: 10, design: .monospaced)).padding(10)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
      .accessibilityIdentifier("reader-diagnostics")
  }
}
