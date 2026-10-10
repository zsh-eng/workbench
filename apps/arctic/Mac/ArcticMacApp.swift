import AppKit
import SwiftUI

@main struct ArcticMacApp: App {
  @State private var workspace = MacWorkspace()
  var body: some Scene {
    Window("Arctic", id: "arctic") {
      MacWorkspaceView(workspace: workspace)
        .frame(minWidth: 760, minHeight: 540)
        .tint(ArcticBrand.accent)
        .onDisappear { workspace.shutDown() }
    }
    .defaultSize(width: 1240, height: 840)
    .windowStyle(.hiddenTitleBar)
    .commands { MacCommands(workspace: workspace) }
  }
}

/// Commands and the help panel use the same catalogue, so shortcut labels cannot drift.
enum MacShortcut: String, CaseIterable, Identifiable {
  case open, library, sidebar, notes, next, previous, close, reopen, save, find, refresh, highlight,
    shortcuts, importList, settings
  var id: String { rawValue }
  var title: String {
    switch self {
    case .open: "Open link or find article"
    case .library: "Show library"
    case .sidebar: "Toggle sidebar"
    case .notes: "Toggle notes"
    case .next: "Next article"
    case .previous: "Previous article"
    case .close: "Close article"
    case .reopen: "Reopen closed article"
    case .save: "Save article"
    case .find: "Find in article"
    case .refresh: "Refresh Reader"
    case .highlight: "Highlight selection"
    case .shortcuts: "Keyboard shortcuts"
    case .importList: "Import Reading List"
    case .settings: "Automatic tags"
    }
  }
  var key: KeyEquivalent {
    switch self {
    case .open: "k"
    case .library: "l"
    case .sidebar: "b"
    case .notes: "b"
    case .next: "]"
    case .previous: "["
    case .close: "w"
    case .reopen: "t"
    case .save: "s"
    case .find: "f"
    case .refresh: "r"
    case .highlight: "h"
    case .shortcuts: "/"
    case .importList: "i"
    case .settings: ","
    }
  }
  var modifiers: EventModifiers {
    if self == .notes { return [.command, .option] }
    return [.next, .previous, .reopen, .highlight, .shortcuts, .importList].contains(
      self)
      ? [.command, .shift] : .command
  }
  var keys: String {
    if self == .next { return "⌃⇥ / ⇧⌘]" }
    if self == .previous { return "⌃⇧⇥ / ⇧⌘[" }
    return (modifiers.contains(.option) ? "⌥" : "") + (modifiers.contains(.shift) ? "⇧" : "") + "⌘"
      + String(key.character).uppercased()
  }
  @MainActor func perform(_ w: MacWorkspace) {
    switch self {
    case .open: w.showOpen.toggle()
    case .library: w.library()
    case .sidebar: w.toggleSidebar(animated: false)
    case .notes: w.showNotes.toggle()
    case .next: w.cycle(1)
    case .previous: w.cycle(-1)
    case .close: if let url = w.selectedURL { w.close(url) }
    case .reopen: w.reopen()
    case .save: w.saveCurrent()
    case .find: w.selectedReader?.showFind = true
    case .refresh: w.selectedReader?.refresh()
    case .highlight: w.selectedReader?.highlight()
    case .shortcuts: w.showShortcuts = true
    case .importList: w.importList()
    case .settings: w.showSettings = true
    }
  }
}

struct MacCommands: Commands {
  let workspace: MacWorkspace
  var body: some Commands {
    CommandGroup(replacing: .newItem) {
      shortcut(.open)
      shortcut(.importList)
    }
    CommandGroup(replacing: .saveItem) { shortcut(.save) }
    CommandGroup(replacing: .help) { shortcut(.shortcuts) }
    CommandGroup(after: .sidebar) {
      shortcut(.sidebar)
      shortcut(.library)
      shortcut(.notes)
    }
    CommandMenu("Article") {
      shortcut(.next)
      shortcut(.previous)
      Divider()
      shortcut(.close)
      shortcut(.reopen)
      Divider()
      shortcut(.find)
      shortcut(.highlight)
      shortcut(.refresh)
    }
    CommandGroup(replacing: .appSettings) {
      shortcut(.settings)
    }
  }
  private func shortcut(_ action: MacShortcut) -> some View {
    Button(action.title) { action.perform(workspace) }
      .keyboardShortcut(action.key, modifiers: action.modifiers)
  }
}

struct MacWorkspaceView: View {
  @Bindable var workspace: MacWorkspace
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.scenePhase) private var scenePhase
  @State private var keyMonitor: Any?
  @State private var showAppearance = false

  private var layout: some View {
    VStack(spacing: 0) {
      HStack(spacing: 4) {
        // Native traffic lights remain owned by NSWindow. This space keeps all
        // article tabs on the same row without replacing system window controls.
        Color.clear.frame(width: 78).accessibilityHidden(true)
        Button {
          workspace.toggleSidebar(animated: true)
        } label: {
          Image(systemName: "sidebar.left").frame(width: 30, height: 30)
        }.buttonStyle(MacQuietButtonStyle()).help("Toggle sidebar · ⌘B")
          .accessibilityLabel("Toggle sidebar")
        MacArticleTabStrip(workspace: workspace)
        workspaceControls
      }.frame(height: 46).padding(.trailing, 10)
        .background(MacWindowDragArea())
      Divider().opacity(0.4)
      ZStack(alignment: .leading) {
        ZStack {
          // Keep the reusable grid and its last complete projection alive under
          // Reader. Returning must not rebuild an empty library for one frame.
          MacLibrary(workspace: workspace)
            .opacity(libraryVisible ? 1 : 0)
            .allowsHitTesting(libraryVisible)
            .accessibilityHidden(!libraryVisible)
          if let reader = workspace.selectedReader {
            HStack(spacing: 0) {
              MacReaderPane(reader: reader, workspace: workspace)
              if workspace.showNotes {
                Divider().opacity(0.4)
                MacNotesPane(workspace: workspace, reader: reader).frame(width: 300)
              }
            }
          } else if workspace.showNotebook {
            MacNotebook(workspace: workspace)
          } else if workspace.showStats {
            MacStatsPanel(stats: workspace.stats)
          }
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
          .padding(.leading, workspace.sidebarVisible ? 217 : 0)
        // Commit the document width once. Only the overlaid rail animates;
        // WebKit and the collection layout do not resize on every frame.
        MacNavigationSidebar(workspace: workspace).frame(width: 216)
          .frame(maxHeight: .infinity).background(MacMaterial())
          .overlay(alignment: .trailing) { Divider().opacity(0.3) }
          .offset(x: workspace.sidebarVisible ? 0 : -217)
          .opacity(workspace.sidebarVisible ? 1 : 0)
          .allowsHitTesting(workspace.sidebarVisible)
          .accessibilityHidden(!workspace.sidebarVisible)
          .animation(
            reduceMotion || !workspace.animateSidebar
              ? nil : .timingCurve(0.32, 0.72, 0, 1, duration: 0.24),
            value: workspace.sidebarVisible)
      }.clipped()
    }
    .background(Color(nsColor: .textBackgroundColor))
    .ignoresSafeArea(.container, edges: .top)
  }

  private var libraryVisible: Bool {
    workspace.selectedURL == nil && !workspace.showNotebook && !workspace.showStats
  }

  private var blocksReading: Bool {
    workspace.showNotes || workspace.showOpen || workspace.showShortcuts || workspace.showStats
      || workspace.showSettings || workspace.showSyncTrial
  }

  private var observedLayout: some View {
    layout
      .onChange(of: scenePhase) { _, phase in
        workspace.windowActive = phase == .active
        if phase == .active { workspace.store.resumeTagging() }
      }
      .onChange(of: blocksReading) { workspace.updateActivity() }
      .onReceive(NotificationCenter.default.publisher(for: NSApplication.willTerminateNotification))
    { _ in workspace.shutDown() }
  }

  var body: some View {
    observedLayout
      .background(
        MacCommandPaletteHost(
          workspace: workspace, isPresented: workspace.showOpen,
          revision: workspace.store.libraryRevision
        ).frame(width: 0, height: 0)
      )
      .sheet(isPresented: $workspace.showShortcuts) { MacShortcutsPanel() }
      .sheet(isPresented: $workspace.showSettings) { MacTaggingSettings(workspace: workspace) }
      .alert(
        "Arctic",
        isPresented: Binding(
          get: { workspace.error != nil || workspace.store.errorMessage != nil },
          set: {
            if !$0 {
              workspace.error = nil
              workspace.store.errorMessage = nil
            }
          })
      ) {
        Button("OK") {
          workspace.error = nil
          workspace.store.errorMessage = nil
        }
      } message: {
        Text(workspace.error ?? workspace.store.errorMessage ?? "")
      }
      .overlay(alignment: .bottom) {
        if let undo = workspace.store.undoReceipt {
          HStack {
            Image(systemName: undo.symbol)
            Text(undo.message)
            Button("Undo") { workspace.store.undo(undo.id) }.buttonStyle(.bordered)
            Button {
              workspace.store.dismissUndo(undo.id)
            } label: {
              Image(systemName: "xmark")
            }
            .buttonStyle(.plain).accessibilityLabel("Dismiss")
          }.padding(12).background(.regularMaterial, in: Capsule()).padding(20)
        }
      }
      .onAppear {
        installKeyMonitor()
        workspace.store.resumeTagging()
      }
      .onDisappear { if let keyMonitor { NSEvent.removeMonitor(keyMonitor) } }
  }

  @ViewBuilder private var workspaceControls: some View {
    HStack(spacing: 4) {
      if let reader = workspace.selectedReader {
        Button {
          reader.toggleWebsite()
        } label: {
          Image(systemName: reader.websiteVisible ? "doc.text" : "globe").frame(
            width: 30, height: 30)
        }.buttonStyle(MacQuietButtonStyle())
          .accessibilityLabel(reader.websiteVisible ? "Show Reader" : "Show website")
          .help(reader.websiteVisible ? "Show Reader" : "Show website")
        Button {
          workspace.showNotes.toggle()
        } label: {
          Image(systemName: "sidebar.right").frame(width: 30, height: 30)
        }.buttonStyle(MacQuietButtonStyle(selected: workspace.showNotes))
          .help("Notes · ⌥⌘B").accessibilityLabel("Toggle notes")
        Button {
          showAppearance.toggle()
        } label: {
          Image(systemName: "textformat.size").frame(width: 30, height: 30)
        }.buttonStyle(MacQuietButtonStyle(selected: showAppearance))
          .help("Reading appearance").accessibilityLabel("Reading appearance")
          .popover(isPresented: $showAppearance) { MacAppearancePanel() }
        Menu {
          Button(workspace.selectedArticle?.saved == true ? "Saved" : "Save article") {
            workspace.saveCurrent()
          }.disabled(workspace.selectedArticle?.saved == true)
          Divider()
          Button("Copy link") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(reader.url.absoluteString, forType: .string)
          }
          Button("Open in browser") { NSWorkspace.shared.open(reader.url) }
          Divider()
          Button("Refresh Reader") { reader.refresh() }
          Button("Find in article") { reader.showFind = true }
          if let article = workspace.selectedArticle, article.saved {
            Button(article.favourite ? "Unfavourite" : "Favourite") {
              workspace.store.setFavourite(!article.favourite, for: article.id)
            }
            Button(article.isArchived == true ? "Return to Saved" : "Archive") {
              do {
                try workspace.store.setArchived(article.isArchived != true, ids: [article.id])
              } catch { workspace.error = error.localizedDescription }
            }
          }
          Divider()
          Button("Reader diagnostics") { workspace.showDiagnostics.toggle() }
        } label: {
          Image(systemName: "ellipsis")
        }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
          .frame(width: 26).help("Article options").accessibilityLabel("Article options")
      }
    }

  }

  private func installKeyMonitor() {
    guard keyMonitor == nil else { return }
    keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
      // macOS reserves Command-? for Help search. Handle our documented
      // shortcut before menu dispatch, including when a text field has focus.
      let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
      if event.keyCode == 48, modifiers.contains(.control),
        !modifiers.contains(.command), !modifiers.contains(.option),
        !workspace.showOpen, !workspace.showSettings, !workspace.showSyncTrial, !workspace.showShortcuts
      {
        workspace.cycle(modifiers.contains(.shift) ? -1 : 1)
        return nil
      }
      if modifiers.contains([.command, .shift]),
        !modifiers.contains(.option), !modifiers.contains(.control),
        ["/", "?"].contains(event.charactersIgnoringModifiers ?? "")
      {
        workspace.showShortcuts = true
        return nil
      }
      guard event.characters == "?", !event.modifierFlags.contains(.command),
        !workspace.showOpen, !workspace.showSettings, !workspace.showSyncTrial,
        !(NSApp.keyWindow?.firstResponder is NSTextView)
      else { return event }
      // Website text fields own their typing. Reader uses an isolated JS handler.
      if let responder = NSApp.keyWindow?.firstResponder,
        String(describing: type(of: responder)).contains("WK")
      {
        return event
      }
      workspace.showShortcuts = true
      return nil
    }
  }
}
