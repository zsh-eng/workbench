import ArcticSync
import AppKit
import SwiftUI

/// Quiet controls share a neutral wash. Animate the wash, never the reader or
/// list geometry. Native focus rings and the menus retain keyboard access.
struct MacQuietButtonStyle: ButtonStyle {
  var selected = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  func makeBody(configuration: Configuration) -> some View {
    Surface(configuration: configuration, selected: selected, reduceMotion: reduceMotion)
  }
  private struct Surface: View {
    let configuration: Configuration
    let selected: Bool
    let reduceMotion: Bool
    @State private var hovered = false
    var body: some View {
      configuration.label
        .foregroundStyle(selected ? .primary : .secondary)
        .background {
          RoundedRectangle(cornerRadius: 7)
            .fill(
              Color.primary.opacity(
                configuration.isPressed ? 0.10 : selected ? 0.07 : hovered ? 0.035 : 0)
            )
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: hovered)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: selected)
        }
        .contentShape(RoundedRectangle(cornerRadius: 7))
        .onHover { hovered = $0 }
    }
  }
}

struct MacNavigationSidebar: View {
  @Bindable var workspace: MacWorkspace
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(spacing: 7) {
        ArcticMark().frame(width: 16, height: 16).opacity(0.7)
        Text("Arctic").font(.system(size: 13, weight: .medium, design: .rounded))
        Spacer()
      }.padding(.horizontal, 10).padding(.top, 14).padding(.bottom, 18)
      Button {
        workspace.showOpen = true
      } label: {
        HStack {
          Text("Find or open")
          Spacer()
          Text("⌘K").font(.system(size: 11)).foregroundStyle(.tertiary)
        }.padding(.horizontal, 10).frame(height: 30)
      }.buttonStyle(MacQuietButtonStyle()).help("Open article · ⌘K")
        .accessibilityLabel("Open article")
      ScrollView {
        VStack(alignment: .leading, spacing: 2) {
          ForEach([MacLibraryFolder.saved, .favourites, .downloaded], id: \.self) { folder in
            folderRow(folder)
          }
          if !workspace.store.allTags.isEmpty {
            separator
            ForEach(workspace.store.allTags, id: \.self) { folderRow(.tag($0)) }
          }
          separator
          row("Notebook", selected: workspace.showNotebook) {
            workspace.library()
            workspace.showNotebook = true
          }
          row("Reading stats", selected: workspace.showStats) { workspace.statistics() }
          folderRow(.history)
          folderRow(.archive)
        }.padding(.vertical, 12)
      }.scrollIndicators(.hidden)
      HStack {
        Menu {
          Button("Import Reading List…") { workspace.importList() }
          #if DEBUG
          Button("Sync trial…") { workspace.showSyncTrial = true }
            .accessibilityIdentifier("sync-trial-open")
          #endif
          Button("Automatic tags…") { workspace.showSettings = true }
          Button("Keyboard shortcuts…") { workspace.showShortcuts = true }
        } label: {
          Text("Arctic settings").font(.system(size: 11))
        }.menuStyle(.borderlessButton).fixedSize().foregroundStyle(.secondary)
        Spacer()
        Button("?") { workspace.showShortcuts = true }
          .buttonStyle(.plain).foregroundStyle(.tertiary)
          .accessibilityLabel("Keyboard shortcuts").help("Keyboard shortcuts · ?")
      }.padding(.horizontal, 10).padding(.vertical, 16)
    }
    #if DEBUG
    .sheet(isPresented: $workspace.showSyncTrial) { SyncTrialView() }
    #endif
    .font(.system(size: 13))
    .padding(.horizontal, 10)
    .background(Color(nsColor: .textBackgroundColor))
  }
  private var separator: some View {
    Color.clear.frame(height: 16).accessibilityHidden(true)
  }
  private func folderRow(_ folder: MacLibraryFolder) -> some View {
    row(
      folder.title,
      selected: workspace.selectedURL == nil && !workspace.showNotebook && !workspace.showStats
        && workspace.folder == folder
    ) {
      workspace.library(folder)
    }
  }
  private func row(_ title: String, selected: Bool = false, action: @escaping () -> Void)
    -> some View
  {
    Button(action: action) {
      Text(title).lineLimit(1).fontWeight(selected ? .medium : .regular)
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).frame(height: 28)
    }.buttonStyle(MacQuietButtonStyle(selected: selected))
      .accessibilityLabel(title).accessibilityAddTraits(selected ? .isSelected : [])
  }
}

/// URL identity and the bounded WebKit pool remain in MacWorkspace. The strip
/// scrolls only enough to reveal the selected tab; document switches are instant.
struct MacArticleTabStrip: View {
  @Bindable var workspace: MacWorkspace
  var body: some View {
    HStack(spacing: 6) {
      Button {
        workspace.library()
      } label: {
        Image(systemName: "square.grid.2x2").frame(width: 30, height: 30)
      }.buttonStyle(MacQuietButtonStyle(selected: workspace.selectedURL == nil))
        .help("Library · ⌘L").accessibilityLabel("Show library")
      ScrollViewReader { proxy in
        ScrollView(.horizontal) {
          HStack(spacing: 3) {
            ForEach(workspace.tabs) { tab in
              MacArticleTabButton(tab: tab, workspace: workspace).id(tab.url)
            }
          }
        }.scrollIndicators(.hidden)
          .frame(maxWidth: CGFloat(max(1, workspace.tabs.count)) * 189)
          .onChange(of: workspace.selectedURL) { _, url in
            if let url { proxy.scrollTo(url) }
          }
          .onAppear { if let url = workspace.selectedURL { proxy.scrollTo(url) } }
      }
      Spacer(minLength: 0)
      Button {
        workspace.showOpen = true
      } label: {
        Image(systemName: "plus").font(.system(size: 12)).frame(width: 30, height: 30)
      }.buttonStyle(MacQuietButtonStyle()).help("Open article · ⌘K")
        .accessibilityLabel("New article tab")
    }.font(.system(size: 12)).padding(.horizontal, 4).frame(height: 46)
  }
}

private struct MacArticleTabButton: View {
  let tab: MacArticleTab
  let workspace: MacWorkspace
  @State private var hovered = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var selected: Bool { workspace.selectedURL == tab.url }
  var body: some View {
    HStack(spacing: 0) {
      Button {
        workspace.select(tab.url)
      } label: {
        Text(tab.title).lineLimit(1).truncationMode(.tail)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.leading, 11).frame(height: 30).contentShape(Rectangle())
      }.buttonStyle(.plain).accessibilityIdentifier("tab-" + tab.url.lastPathComponent)
        .accessibilityLabel(tab.title).accessibilityAddTraits(selected ? .isSelected : [])
      Button {
        workspace.close(tab.url)
      } label: {
        Image(systemName: "xmark").font(.system(size: 9, weight: .medium))
          .opacity(hovered || selected ? 1 : 0)
          .frame(width: 26, height: 30).contentShape(Rectangle())
      }.buttonStyle(.plain).help("Close article · ⌘W")
        .accessibilityLabel("Close " + tab.title)
    }
    .frame(width: 186)
    .foregroundStyle(selected ? .primary : .secondary)
    .background {
      RoundedRectangle(cornerRadius: 7).fill(
        Color.primary.opacity(selected ? 0.07 : hovered ? 0.035 : 0)
      )
      .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: hovered)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: selected)
    }
    .onHover { hovered = $0 }
    .help(tab.title + "\n" + tab.url.absoluteString)
    .contextMenu {
      Button("Close article") { workspace.close(tab.url) }
      Button("Copy link") {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(tab.url.absoluteString, forType: .string)
      }
    }
  }
}

/// Enter within the panel's final bounds. Only opacity and a small translation
/// animate; the adjacent WebKit surface receives one final width.
struct MacPanelReveal: ViewModifier {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var appeared = false
  func body(content: Content) -> some View {
    content
      .opacity(appeared || reduceMotion ? 1 : 0)
      .offset(x: appeared || reduceMotion ? 0 : 6)
      .onAppear {
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { appeared = true }
      }
  }
}

/// Drag only the unoccupied title row. Buttons and tabs remain normal controls.
struct MacWindowDragArea: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView { DragView() }
  func updateNSView(_ view: NSView, context: Context) {}
  private final class DragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
  }
}
