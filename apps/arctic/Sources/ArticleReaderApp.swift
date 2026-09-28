import SwiftUI
import UIKit
import UniformTypeIdentifiers

@main
struct ArticleReaderApp: App {
  @State private var store = ArticleStore()
  init() {
    #if DEBUG
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-store") {
        UserDefaults.standard.removeObject(forKey: "test-continue-reading-dismissed")
        for key in UserDefaults.standard.dictionaryRepresentation().keys
        where key.hasPrefix("reader-position.") {
          UserDefaults.standard.removeObject(forKey: key)
        }
      }
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-share-keychain-probe") {
        try? JevKeychain.writeShareAccessProbe()
      }
      if TestMode.enabled
        && ProcessInfo.processInfo.arguments.contains("-clear-share-keychain-probe")
      {
        JevKeychain.clearShareAccessProbe()
      }
      if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-appearance") {
        for key in [
          "reader-size", "reader-font", "reader-padding", "reader-leading", "reader-palette",
          LibraryFrameDiagnostics.enabledKey,
        ] {
          UserDefaults.standard.removeObject(forKey: key)
        }
      }
      if ProcessInfo.processInfo.arguments.contains("-ui-testing"),
        let text = ProcessInfo.processInfo.environment["TEST_CLIPBOARD"]
      {
        UIPasteboard.general.string = text
        UserDefaults.standard.removeObject(forKey: "test-clipboard-change")
      }
    #endif
  }
  var body: some Scene {
    WindowGroup {
      Group {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-dark-ui") {
          ArticleRootView(store: store).preferredColorScheme(.dark)
        } else {
          ArticleRootView(store: store)
        }
      }
      .font(ReaderTheme.sans(16))
      .transformEnvironment(\.dynamicTypeSize) { value in
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-large-type") {
          value = .accessibility2
        }
      }
      .transformEnvironment(\.articleReduceMotion) { value in
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reduce-motion") {
          value = true
        }
      }
    }
  }
}

/// Do not read the clipboard or preload pages behind first-run onboarding.
private struct ArticleRootView: View {
  let store: ArticleStore
  @State private var completed: Bool

  private static var completionKey: String {
    TestMode.enabled ? "test-onboarding-completed" : "onboarding-completed"
  }

  init(store: ArticleStore) {
    self.store = store
    if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-reset-onboarding") {
      UserDefaults.standard.removeObject(forKey: Self.completionKey)
    }
    _completed = State(initialValue: UserDefaults.standard.bool(forKey: Self.completionKey))
  }

  private var needsOnboarding: Bool {
    !completed
      && (!TestMode.enabled || ProcessInfo.processInfo.arguments.contains("-test-onboarding"))
  }

  var body: some View {
    if needsOnboarding {
      OnboardingView {
        UserDefaults.standard.set(true, forKey: Self.completionKey)
        completed = true
        store.resumeTagging()
      }
    } else {
      LibraryView(store: store)
    }
  }
}

struct LibraryView: View {
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.colorScheme) private var systemScheme
  @State private var clipboard = ClipboardSuggestion()
  @State private var continuation = ContinueReadingSuggestion()
  #if DEBUG
    @State private var testSharing = false
  #endif
  @Bindable var store: ArticleStore
  @State private var selected: ArticleBrowser?
  @State private var choosingImport = false
  @State private var showingTaggingSettings = false
  @State private var showingAnnotations = false
  @State private var showingReadingStats = false
  @State private var showingWeeklyFavourites = false
  @State private var weeklyArticleToOpen: URL?
  @State private var passageToOpen: ReaderAnnotation?
  @State private var showingOnboarding = false
  @State private var showingArticleReplay = false
  @State private var editingTags: SavedArticle?
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.articleReduceMotion) private var appReduceMotion
  @State private var query = ""
  @State private var searching = false
  @State private var isLibraryScrolling = false
  @State private var importReport: String?
  @State private var showingImportSummary = false
  @State private var folder = ArticleFolder.saved
  #if DEBUG
    @State private var folderTransition = "initial"
  #endif
  @State private var favouriteTags: Set<String> = []
  @State private var selecting = false
  @State private var selection: Set<UUID> = []
  @State private var sort = "Newest first"
  @State private var confirmDelete = false
  @State private var browsers = BrowserPool()
  @State private var projection = LibraryProjection()
  @State private var discoveryMotion = DiscoveryMotion()
  @State private var headerHeight: CGFloat = 48
  @State private var viewportVisibility = LibraryViewportVisibility()
  @AppStorage(LibraryFrameDiagnostics.enabledKey) private var frameDiagnostics = false
  @AppStorage("reader-palette") private var paletteName = "System"
  private let navigationBarHeight: CGFloat = 44

  private var matches: [SavedArticle] { matches(in: folder, query: query) }

  private var discoveryAvailable: Bool {
    selected == nil && !searching && !selecting && folder == .saved
      && !showingAnnotations && !showingWeeklyFavourites && !showingReadingStats
      && !showingOnboarding && !showingArticleReplay && !showingTaggingSettings
      && !choosingImport && editingTags == nil
  }

  private func matches(in folder: ArticleFolder, query: String = "") -> [SavedArticle] {
    projection.rows(
      articles: store.articles, revision: store.libraryRevision, folder: folder,
      query: query, sort: sort, favouritesOnly: filtersFavourites(in: folder)
    ).articles
  }

  private func filtersFavourites(in folder: ArticleFolder) -> Bool {
    guard case .tag(let name) = folder else { return false }
    return favouriteTags.contains(name)
  }

  private var searchTransition: Animation {
    .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.18)
  }

  var body: some View {
    NavigationStack {
      page
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationDestination(
          isPresented: Binding(get: { selected != nil }, set: { if !$0 { selected = nil } })
        ) {
          if let selected {
            ReaderPage(browser: selected, store: store).id(ObjectIdentifier(selected))
          }
        }
    }
    .onChange(of: discoveryAvailable, initial: true) { _, available in
      discoveryMotion.setEnabled(available)
    }
    .onChange(of: reduceMotion || appReduceMotion, initial: true) { _, reduced in
      discoveryMotion.reduceMotion = reduced
    }
    .overlay(alignment: .top) { navigationControls.accessibilityHidden(showingAnnotations) }
    .overlay(alignment: .bottomLeading) {
      LibraryPreloadDriver(
        visibility: viewportVisibility, store: store, browsers: browsers, projection: projection,
        folder: folder, query: query, sort: sort, favouritesOnly: filtersFavourites(in: folder),
        searching: searching,
        isLibraryScrolling: isLibraryScrolling, clipboardURL: clipboard.url,
        resumeURL: clipboard.url == nil && !selecting ? continuation.article?.url : nil,
        enabled: selected == nil && !showingOnboarding && !showingArticleReplay
          && !showingTaggingSettings
          && !showingAnnotations && !showingReadingStats && !showingWeeklyFavourites && !choosingImport && editingTags == nil
      )
    }
    .overlay(alignment: .bottom) {
      ArchiveUndoToast(store: store)
        .padding(.horizontal, 16).padding(.bottom, 86)
    }
    .overlay(alignment: .bottomLeading) {
      LibraryFrameDiagnostics().padding(.horizontal, 20).padding(.bottom, 84)
    }
    #if DEBUG
      .overlay(alignment: .bottomTrailing) {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-import-replay") {
          let ready = store.importSummary?.previewsReady ?? 0
          let datesOK =
            store.articles.count == 460
            && store.articles.allSatisfy { article in
              let index =
                Int(article.url.lastPathComponent.replacingOccurrences(of: "import-", with: ""))
                ?? -1
              return article.savedAt == Date(timeIntervalSince1970: Double(1_700_000_000 + index))
            }
          Text(
            "\(ready)/460; dates=\(datesOK); scrolls=\(store.previewScrollSessions); during=\(store.previewPublicationsDuringScrolling); batches=\(store.previewPublicationCount); buffered=\(store.previewPeakBuffered); workers=\(store.previewPeakWorkers)"
          )
          .font(.system(size: 7)).lineLimit(1).padding(2).background(.thinMaterial)
          .accessibilityIdentifier("import-replay-state").allowsHitTesting(false)
        }
      }
      .overlay(alignment: .top) {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-folder-transitions") {
          Text(folderTransition).font(.system(size: 7))
            .accessibilityIdentifier("folder-transition-mode").allowsHitTesting(false)
        }
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-share-fixture") {
          Button("Share fixture") { testSharing = true }.accessibilityIdentifier("share-fixture")
        }
      }
      .overlay(alignment: .bottomTrailing) {
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-tagging") {
          HStack {
            Text(store.isTagging ? "tagging" : "idle")
            .accessibilityIdentifier("tagging-test-state")
            Text(String(store.taggingRequestCount)).accessibilityIdentifier("tagging-request-count")
            Text(String(store.preparedTaggingCount)).accessibilityIdentifier(
              "tagging-prepared-count")
            if ProcessInfo.processInfo.arguments.contains("-test-tagging-held") {
              Button("Finish tagging") { store.finishFixtureTagging() }
              .disabled(!store.isFixtureTaggingHeld)
              .accessibilityIdentifier("finish-test-tagging")
            }
          }.font(.caption2).padding(4).background(.thinMaterial)
        }
      }
      .sheet(isPresented: $testSharing) {
        FixtureShareSheet {
          testSharing = false
          store.importSharedLinks()
        }
      }
    #endif
    .background(ReaderTheme.background)
    .foregroundStyle(ReaderTheme.foreground).tint(ArcticBrand.accent)
    .onOpenURL { url in
      guard url.scheme == "articles", url.host == "open",
        let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(
          where: { $0.name == "url" })?.value,
        let target = URL(string: value),
        ["https", "http"].contains(target.scheme?.lowercased() ?? ""),
        let host = target.host, host.contains(".")
      else { return }
      selected = browsers.open(target, store: store)
    }
    .task(id: scenePhase) {
      guard scenePhase == .active else {
        discoveryMotion.close()
        isLibraryScrolling = false
        store.setLibraryScrolling(false)
        store.flushPendingWrites()
        if scenePhase == .background {
          // Keep the last opened Reader, but stop speculative documents while
          // the app is hidden. Transient inactive states keep the warm viewport.
          browsers.releaseOffscreen()
          #if DEBUG
            browsers.backgroundRetainedCount = browsers.retainedBrowserCount
          #endif
        }
        return
      }
      store.importSharedLinks()
      store.resumeTagging()
      if selected == nil { continuation.refresh(from: store) }
      await clipboard.check()
    }
    .onChange(of: store.allTags) { _, tags in
      if case .tag(let name) = folder, !tags.contains(name) { folder = .saved }
    }
    .task(id: clipboard.url) {
      await clipboard.preparePreview()
      guard !Task.isCancelled, let url = clipboard.url, let preview = clipboard.preview else {
        return
      }
      store.prepareTagging(url: url, preview: preview)
    }
    .onChange(of: isLibraryScrolling) { _, scrolling in
      store.setLibraryScrolling(scrolling)
    }
    .onChange(of: selected != nil) { _, readerOpen in
      if readerOpen {
        isLibraryScrolling = false
      } else {
        continuation.refresh(from: store)
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: ReaderPosition.didChange)) { _ in
      if selected == nil { continuation.refresh(from: store) }
    }
    .onChange(of: store.libraryRevision) { _, _ in
      continuation.reconcile(with: store.articles)
    }
    .onDisappear { store.setLibraryScrolling(false) }
    .onReceive(
      NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)
    ) { _ in
      browsers.releaseOffscreen()
      ThumbnailCache.shared.releaseMemory()
    }
    .onChange(of: store.savedArticleIDs) { _, _ in
      browsers.persistExtractions(in: store)
    }
    .overlay(alignment: .top) {
      if let notice = store.taggingNotice {
        TaggingFeedback(title: notice.title, tags: notice.tags) {
          editingTags = store.articles.first { $0.id == notice.articleID && $0.saved }
          store.dismissTaggingNotice()
        } dismiss: {
          store.dismissTaggingNotice()
        }
        .id(notice.id).padding(.horizontal, 16).padding(.top, 60)
        .transition(.opacity)
      }
    }
    .sheet(
      isPresented: $showingAnnotations,
      onDismiss: {
        guard let passage = passageToOpen else { return }
        passageToOpen = nil
        let browser = browsers.open(passage.articleURL, store: store)
        browser.revealAnnotation(passage.id)
        selected = browser
      }
    ) {
      LibraryAnnotations(articles: store.articles) { passage in
        passageToOpen = passage
        showingAnnotations = false
      }
    }
    .sheet(isPresented: $showingWeeklyFavourites, onDismiss: {
      if let url = weeklyArticleToOpen {
        weeklyArticleToOpen = nil
        selected = browsers.open(url, store: store)
      }
    }) {
      WeeklyFavouritesSheet(store: store) { weeklyArticleToOpen = $0 }
    }
    .sheet(isPresented: $showingReadingStats) { ReadingStatsView() }
    .sheet(isPresented: $showingTaggingSettings) {
      TaggingSettingsView { store.resumeTagging() }
    }
    .fullScreenCover(isPresented: $showingOnboarding) {
      OnboardingView {
        showingOnboarding = false
        store.resumeTagging()
      }
    }
    .fullScreenCover(isPresented: $showingArticleReplay) {
      ArticleReplayView()
    }
    .sheet(item: $editingTags) { article in
      ArticleTagsSheet(article: article, store: store)
    }
    .fileImporter(isPresented: $choosingImport, allowedContentTypes: [.html]) { result in
      Task {
        do {
          let report = try await store.importReadingList(from: result.get())
          if store.importSummary != nil {
            showingImportSummary = true
          } else {
            importReport = report
          }
        } catch {
          store.errorMessage = error.localizedDescription
        }
      }
    }
    .sheet(isPresented: $showingImportSummary) {
      ImportSummarySheet(store: store)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
    .alert(
      "Reading list imported",
      isPresented: Binding(
        get: { importReport != nil }, set: { if !$0 { importReport = nil } }
      )
    ) {
      Button("Done") { importReport = nil }
    } message: {
      Text(importReport ?? "")
    }
    .alert(
      "Storage error",
      isPresented: Binding(
        get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } }
      )
    ) {
      Button("OK") { store.errorMessage = nil }
    } message: {
      Text(store.errorMessage ?? "")
    }
  }

  private var folderItems: [ArticleFolder] {
    [.saved, .favourites, .downloaded] + store.allTags.map(ArticleFolder.tag) + [
      .history, .archive,
    ]
  }

  /// This bar belongs to the stack, not either sliding page. Only its contents
  /// crossfade; the native push/pop transition remains responsible for the page.
  private var navigationControls: some View {
    let palette = ReadingPalette(rawValue: paletteName) ?? .system
    return ZStack {
      // Remove inactive glass controls from the hierarchy. Native glass can
      // retain accessibility children even when its SwiftUI parent is transparent.
      if selected == nil && !searching {
        libraryControls.transition(.opacity)
      }
      if searching && selected == nil {
        HStack {
          searchSummary
          Spacer()
        }
        .padding(.horizontal, 24)
        .transition(.opacity)
      }
      if let selected {
        ReaderNavigationBar(browser: selected, store: store) { self.selected = nil }
          .foregroundStyle(palette.foreground).tint(palette.foreground)
          .transition(.opacity)
      }
    }
    .frame(height: navigationBarHeight)
    .environment(\.colorScheme, selected == nil ? systemScheme : (palette.scheme ?? systemScheme))
    .animation(searchTransition, value: selected != nil)
    .animation(searchTransition, value: searching)
  }

  private var libraryControls: some View {
    HStack {
      Button(selecting ? "Done" : "Select") {
        selecting.toggle()
        selection.removeAll()
      }
      .font(.subheadline.weight(.medium)).padding(.horizontal, 16).frame(height: 44)
      .modifier(LibraryGlass()).accessibilityIdentifier("select-articles")
      .accessibilityHidden(searching)
      Spacer()
      HStack(spacing: 0) {
        Button {
          showingAnnotations = true
        } label: {
          Image(systemName: "highlighter").frame(width: 44, height: 44)
        }
        .accessibilityLabel("Highlights and notes")
        .accessibilityIdentifier("library-annotations")
        Menu {
          Picker("Sort", selection: $sort) {
            ForEach(["Newest first", "Oldest first", "Title"], id: \.self) { Text($0) }
          }
          Divider()
          Button("Import Chrome reading list", systemImage: "square.and.arrow.down") {
            choosingImport = true
          }.accessibilityIdentifier("import-reading-list")
          Divider()
          Button("Favourites this week", systemImage: "star") { showingWeeklyFavourites = true }
          Button("Reading stats", systemImage: "chart.bar.xaxis") { showingReadingStats = true }
            .accessibilityIdentifier("library-reading-stats")
          Button("Automatic tags", systemImage: "sparkles") { showingTaggingSettings = true }
            .accessibilityIdentifier("automatic-tag-settings")
          Button("Tag existing articles", systemImage: "tag") { store.retagSavedArticles() }
            .disabled(!TaggingPreferences.enabled)
            .accessibilityIdentifier("tag-existing-articles")
          Button("Getting started", systemImage: "book.closed") { showingOnboarding = true }
            .accessibilityIdentifier("show-onboarding")
          Button("Article replay", systemImage: "play.rectangle") { showingArticleReplay = true }
            .accessibilityIdentifier("show-article-replay")
          Divider()
          Toggle("Frame diagnostics", isOn: $frameDiagnostics)
            .accessibilityIdentifier("toggle-frame-diagnostics")
        } label: {
          Image(systemName: "line.3.horizontal.decrease").frame(width: 44, height: 44)
        }
        .accessibilityLabel("Sort and filter")
      }
      .modifier(LibraryGlass())
      .accessibilityHidden(searching)
    }
    .overlay {
      DiscoveryHeader(motion: discoveryMotion, available: discoveryAvailable)
    }
    .padding(.horizontal, 16)
  }

  private func selectFolder(_ target: ArticleFolder) {
    guard target != folder else { return }
    #if DEBUG
      folderTransition = "crossfade"
    #endif
    // All explicit folder choices fade; UIKit alone owns swipe translation.
    // Never animate SwiftUI selection or rebuild the pager to simulate a fade.
    var transaction = Transaction(animation: nil)
    transaction.disablesAnimations = true
    withTransaction(transaction) { folder = target }
  }

  private var folders: some View {
    HStack(spacing: 8) {
      ScrollViewReader { proxy in
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 2) {
            ForEach(folderItems, id: \.self) { item in
              Button {
                selectFolder(item)
              } label: {
                Text(item.title).font(.subheadline.weight(.semibold))
                  .foregroundStyle(folder == item ? ReaderTheme.foreground : ReaderTheme.muted)
                  .padding(.horizontal, 16).frame(minHeight: 44)
                  .background {
                    if folder == item {
                      Capsule().fill(ReaderTheme.foreground.opacity(0.08))
                    }
                  }
                  .contentShape(Capsule())
              }.buttonStyle(.plain).id(item)
                .accessibilityIdentifier(item.identifier)
                .accessibilityAddTraits(folder == item ? .isSelected : [])
            }
          }.padding(4)
        }
        .accessibilityIdentifier("library-folders")
        .clipShape(Capsule())
        .modifier(LibraryGlass())
        .onChange(of: folder) { _, value in
          selection.removeAll()
          withAnimation(reduceMotion ? nil : .smooth(duration: 0.2)) {
            proxy.scrollTo(value, anchor: .center)
          }
        }
      }
      if case .tag(let name) = folder {
        let active = favouriteTags.contains(name)
        Button {
          if active { favouriteTags.remove(name) } else { favouriteTags.insert(name) }
          selection.removeAll()
        } label: {
          Image(systemName: active ? "star.fill" : "star")
            .frame(width: 44, height: 44)
            .contentShape(Circle())
        }
        .buttonStyle(.plain).modifier(LibraryGlass())
        .accessibilityLabel("Favourites only")
        .accessibilityValue(active ? "On" : "Off")
        .accessibilityIdentifier("filter-tag-favourites")
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 8)
  }

  /// Keep the library mounted to preserve its scroll position. Search results
  /// exist only while searching, avoiding hidden image work and duplicate controls.
  private var page: some View {
    ZStack(alignment: .top) {
      pagedLibrary
        // Search owns keyboard avoidance. The retained library must not relayout
        // its cards underneath that transition or lose its scroll position.
        .ignoresSafeArea(.keyboard, edges: .bottom)
        .opacity(searching ? 0 : 1)
        .allowsHitTesting(!searching).accessibilityHidden(searching || showingAnnotations)
      if searching {
        GeometryReader { boundary in
          ScrollViewReader { proxy in
            ScrollView {
              VStack(spacing: 0) {
                Color.clear.frame(height: 0).id("search-top")
                searchResults
              }
            }
            .contentMargins(.top, boundary.safeAreaInsets.top, for: .scrollContent)
            .onGeometryChange(for: CGRect.self) {
              let frame = $0.frame(in: .global)
              return frame.inset(
                by: UIEdgeInsets(
                  top: boundary.safeAreaInsets.top, left: 0, bottom: 0, right: 0))
            } action: {
              viewportVisibility.searchBounds = $0
            }
            .modifier(LibraryScrollActivity { if searching { isLibraryScrolling = $0 } })
            .onChange(of: query) { _, _ in proxy.scrollTo("search-top", anchor: .top) }
            .overlay(alignment: .top) {
              LibraryScrollEdge().frame(height: boundary.safeAreaInsets.top + 20)
            }
            .ignoresSafeArea(.container, edges: .top)
          }
        }
        .transition(.opacity)
        .accessibilityHidden(showingAnnotations)
      }
    }
    .animation(searchTransition, value: searching)
    .scrollDismissesKeyboard(.interactively)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 0) {
        if let summary = store.importSummary, !searching, !selecting {
          HStack(spacing: 10) {
            Button {
              showingImportSummary = true
            } label: {
              HStack(spacing: 10) {
                Image(systemName: store.isImportWorking ? "sparkles" : "checkmark.circle")
                  .foregroundStyle(ArcticBrand.accent)
                Text("\(summary.total) articles added").font(.subheadline.weight(.medium))
                Spacer()
                Image(systemName: "chevron.up").font(.caption.weight(.semibold))
              }.frame(minHeight: 44)
            }.accessibilityIdentifier("import-summary-open")
            Button("Dismiss", systemImage: "xmark") { store.dismissImportSummary() }
              .labelStyle(.iconOnly).frame(width: 36, height: 44)
              .accessibilityIdentifier("import-summary-dismiss")
          }.padding(.horizontal, 16).readerGlass().padding(.horizontal, 20).padding(.bottom, 8)
        }
        if let url = clipboard.url, !searching, !selecting {
          ClipboardBanner(
            url: url, preview: clipboard.preview,
            isSaved: store.articles.contains { $0.url == url && $0.saved }
          ) {
            do {
              try store.add(url.absoluteString, preview: clipboard.preview)
              clipboard.dismiss()
            } catch {
              store.errorMessage = error.localizedDescription
            }
          } open: {
            // Opening dismisses the banner and cancels its task. Finish preparing
            // this explicit pasted link so a later Reader Save reuses the result.
            Task {
              guard let preview = try? await ArticlePreviewCache.shared.load(url) else { return }
              store.prepareTagging(url: url, preview: preview)
            }
            selected = browsers.open(url, store: store)
            clipboard.dismiss()
          } dismiss: {
            clipboard.dismiss()
          }
        } else if let article = continuation.article, !searching, !selecting {
          ContinueReadingBanner(article: article, progress: continuation.progress) {
            let browser = browsers.open(article.url, store: store)
            browser.showReader()
            selected = browser
          } dismiss: {
            continuation.dismiss()
          }
        }
      }
    }
    .modifier(LibrarySearchChrome(query: $query, active: $searching, obscured: showingAnnotations))
    .confirmationDialog(
      "Delete \(selection.count) links?", isPresented: $confirmDelete, titleVisibility: .visible
    ) {
      Button("Delete links", role: .destructive) {
        store.update(selection, delete: true)
        selection.removeAll()
      }
    }
  }

  private var pagedLibrary: some View {
    GeometryReader { boundary in
      libraryPages(topInset: boundary.safeAreaInsets.top)
        .ignoresSafeArea(.container, edges: .top)
    }
  }

  private func libraryPages(topInset: CGFloat) -> some View {
    GeometryReader { viewport in
      // Capture the inset before extending this scrolling surface under the
      // status area. Only the first row and folder controls keep that inset.
      VStack(spacing: 0) {
        // News is outside the pager. Opening it changes the available viewport,
        // not any page's scroll offset or content inset.
        Color.clear.frame(height: discoveryAvailable && discoveryMotion.isExpanded ? 128 : 0)
        ZStack(alignment: .top) {
          LibraryPager(pages: folderItems, selection: $folder, reduceMotion: reduceMotion) { item in
            GeometryReader { geometry in
              Group {
                if matches(in: item).isEmpty {
                  ScrollView {
                    VStack(spacing: 0) {
                      if item == .saved { DiscoveryScrollObserver(motion: discoveryMotion).frame(height: 0) }
                      LibraryEmptyState(folder: item, favouritesOnly: filtersFavourites(in: item))
                        .frame(minHeight: max(0, viewport.size.height - headerHeight - topInset - 110))
                    }.padding(.top, headerHeight + topInset + 16)
                  }
                } else {
                  ScrollView {
                    VStack(spacing: 0) {
                      if item == .saved { DiscoveryScrollObserver(motion: discoveryMotion).frame(height: 0) }
                      library(in: item)
                    }
                  }
                    .modifier(
                      LibraryScrollActivity {
                        if folder == item && !searching { isLibraryScrolling = $0 }
                      }
                    )
                    .contentMargins(.top, topInset + headerHeight + 16, for: .scrollContent)
                    .contentMargins(.top, topInset + headerHeight, for: .scrollIndicators)
                    .contentMargins(
                      .bottom, max(0, geometry.size.height - viewport.size.height),
                      for: .scrollContent)
                }
              }
              .scrollBounceBehavior(.always, axes: .vertical)
              .accessibilityHidden(searching || showingAnnotations || folder != item)
            }
            .accessibilityIdentifier("library-page-" + item.identifier)
          }
          .ignoresSafeArea(.container, edges: .bottom)
          LibraryScrollEdge()
            // Expanded news owns the area above the tabs. Keep the list's fade
            // below that safe-area space, rather than painting behind the panel.
            .frame(height: headerHeight + 28 + (discoveryMotion.isExpanded ? 0 : topInset))
            .clipped()
            .padding(.top, discoveryMotion.isExpanded ? topInset : 0)
            .frame(maxHeight: .infinity, alignment: .top)
          DiscoveryPullChrome(motion: discoveryMotion) {
            libraryHeader
              .onGeometryChange(for: CGFloat.self) {
                $0.size.height
              } action: {
                headerHeight = $0
              }
              .padding(.top, topInset + 8)
          }
        }
        .onGeometryChange(for: CGRect.self) { geometry in
          let frame = geometry.frame(in: .global)
          return CGRect(
            x: frame.minX, y: frame.minY + topInset + headerHeight + 8,
            width: frame.width, height: max(0, frame.height - topInset - headerHeight - 8))
        } action: {
          viewportVisibility.libraryBounds = $0
        }
      }
      .overlay(alignment: .top) {
        if discoveryAvailable && discoveryMotion.isExpanded {
          DiscoveryPullChrome(motion: discoveryMotion) {
            discoveryShelf
              .padding(.vertical, 6)
              .readerGlass(cornerRadius: 30)
              .shadow(color: .black.opacity(0.08), radius: 10, y: 4)
              .padding(.horizontal, 12)
              .padding(.top, topInset + 8)
          }
            .transition(reduceMotion || appReduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.94, anchor: .top)))
            .zIndex(1)
        }
      }
    }
  }

  private var libraryHeader: some View {
    VStack(spacing: 0) {
      folders.accessibilityHidden(searching)
      if selecting {
        HStack {
          Text("\(selection.count) selected").font(.caption)
          Spacer()
          Menu {
            Button("Archive") {
              store.update(selection, archived: true)
              selection.removeAll()
            }.accessibilityIdentifier("archive-selected")
            Button("Unarchive") {
              store.update(selection, archived: false)
              selection.removeAll()
            }
          } label: {
            Image(systemName: "archivebox")
          }
          .accessibilityLabel("Archive options")
          .disabled(!store.articles.contains { selection.contains($0.id) && $0.saved })
          Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
            .labelStyle(.iconOnly).disabled(selection.isEmpty)
        }.padding(.horizontal, 16).padding(.vertical, 10)
          .modifier(LibraryGlass()).padding(.horizontal, 16).padding(.bottom, 8)
      }
    }
  }

  private var discoveryShelf: some View {
    LibraryDiscovery { url in
      discoveryMotion.close()
      // A publisher shortcut is a website destination, never a cached Reader article.
      selected = browsers.open(url, store: store, preferWebsite: true)
    } weekly: {
      discoveryMotion.close()
      showingWeeklyFavourites = true
    }
  }

  private func library(in item: ArticleFolder) -> some View {
    let compact = item == .history || item == .archive
    return LazyVStack(alignment: .leading, spacing: compact ? 0 : 18) {
      ForEach(matches(in: item)) { article in
        articleButton(article) {
          if compact {
            ArticleSearchRow(article: article, query: "")
          } else {
            ArticleCard(article: article)
          }
        }
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: compact ? 16 : 24))
        .modifier(
          LibraryRowVisibility(
            row: LibraryVisibleRow(articleID: article.id, folder: item, search: false),
            active: folder == item && !searching, visibility: viewportVisibility))
        if compact {
          Rectangle().fill(ReaderTheme.border).frame(height: 0.5)
            .padding(.leading, ArticleSearchRow.textInset).padding(
              .trailing, ArticleSearchRow.horizontalInset)
        }
      }
    }.padding(.horizontal, compact ? 8 : 16).padding(.bottom, 20)
  }

  private var searchSummary: some View {
    Text(
      query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "SEARCH \(folder.title.uppercased())"
        : "\(matches.count) \(matches.count == 1 ? "RESULT" : "RESULTS")"
    )
    .font(.footnote.weight(.medium)).foregroundStyle(ReaderTheme.muted)
    .accessibilityIdentifier("search-summary")
  }

  private var searchResults: some View {
    let item = folder
    return LazyVStack(alignment: .leading, spacing: 0) {
      if matches.isEmpty {
        ArcticEmptyState(
          kind: .search, title: "No articles found", detail: "Try a title, a topic, or a website."
        ).padding(.top, 36)
      }
      ForEach(matches) { article in
        articleButton(article) { ArticleSearchRow(article: article, query: query) }
          .modifier(
            LibraryRowVisibility(
              row: LibraryVisibleRow(articleID: article.id, folder: item, search: true),
              active: folder == item && searching, visibility: viewportVisibility))
        Rectangle().fill(ReaderTheme.border).frame(height: 0.5)
          .padding(.leading, ArticleSearchRow.textInset).padding(
            .trailing, ArticleSearchRow.horizontalInset)
      }
    }.padding(.horizontal, 8).padding(.bottom, 24)
  }

  private func articleButton<Content: View>(
    _ article: SavedArticle, @ViewBuilder content: () -> Content
  ) -> some View {
    Button {
      if selecting {
        if selection.contains(article.id) {
          selection.remove(article.id)
        } else {
          selection.insert(article.id)
        }
      } else {
        selected = browsers.open(article.url, store: store)
      }
    } label: {
      content()
    }
    .buttonStyle(.plain)
    .overlay(alignment: .topTrailing) {
      if selecting {
        Image(systemName: selection.contains(article.id) ? "checkmark.circle.fill" : "circle")
          .font(.title2).padding(8).background(.regularMaterial, in: Circle())
      }
    }
    .accessibilityIdentifier("article-\(article.url.lastPathComponent)")
    .contextMenu {
      if article.saved {
        Button(
          article.favourite ? "Unfavourite" : "Favourite",
          systemImage: article.favourite ? "star.slash" : "star"
        ) {
          store.setFavourite(!article.favourite, for: article.id)
        }.accessibilityIdentifier("favourite-article")
        Button("Tags", systemImage: "tag") { editingTags = article }
        Button(article.isArchived == true ? "Move to Saved" : "Archive", systemImage: "archivebox")
        {
          store.update([article.id], archived: article.isArchived != true)
        }.accessibilityIdentifier("archive-article")
      } else {
        Button("Save to inbox", systemImage: "tray.and.arrow.down") {
          do { try store.add(article.url.absoluteString) } catch {
            store.errorMessage = error.localizedDescription
          }
        }
      }
      Button("Refresh preview", systemImage: "arrow.clockwise") {
        Task { await store.refreshPreview(article) }
      }
      Button("Remove link", systemImage: "trash", role: .destructive) { store.remove(article) }
    }
  }
}

#if DEBUG
  /// Exercises the real Share extension with a local fixture URL in UI tests.
  private struct FixtureShareSheet: UIViewControllerRepresentable {
    var onComplete: () -> Void

    func makeUIViewController(context: Context) -> UIActivityViewController {
      let arguments = ProcessInfo.processInfo.arguments
      let query: String
      if arguments.contains("-share-keychain-probe") {
        query = "?keychain_probe"
      } else if arguments.contains("-share-long-tags") {
        query = "?long_tags"
      } else if arguments.contains("-share-empty-tags") {
        query = "?no_tags"
      } else if arguments.contains("-share-wait-context") {
        query = "?wait_for_save"
      } else {
        query = ""
      }
      let controller = UIActivityViewController(
        activityItems: [URL(string: "https://fixture.example/story" + query)!],
        applicationActivities: nil)
      // UIKit can finish the activity without updating the SwiftUI sheet binding.
      controller.completionWithItemsHandler = { _, _, _, _ in onComplete() }
      return controller
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
  }
#endif

/// One batch-level result keeps a large import from producing a stream of toasts.
private struct ImportSummarySheet: View {
  let store: ArticleStore
  @Environment(\.dismiss) private var dismiss
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    NavigationStack {
      if let summary = store.importSummary {
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            ConnectedTagReveal(isProcessing: store.isImportWorking, tags: []) {
              VStack(alignment: .leading, spacing: 8) {
                Text(summary.total, format: .number)
                  .font(.system(size: 56, weight: .semibold, design: .rounded))
                Text("Articles added").font(.title3.weight(.medium))
                HStack(spacing: 6) {
                  Text("\(summary.previewsReady) checked")
                  if summary.tagged > 0 { Text("· \(summary.tagged) tagged") }
                }.font(.subheadline).foregroundStyle(.secondary)
              }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
                .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 24))
            }
            if !summary.tagCounts.isEmpty {
              LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 150), alignment: .leading)], spacing: 10
              ) {
                ForEach(summary.tagCounts.keys.sorted(), id: \.self) { tag in
                  HStack(spacing: 10) {
                    Text(tag).font(.subheadline.weight(.medium))
                    Spacer(minLength: 4)
                    Text(summary.tagCounts[tag]!, format: .number)
                      .font(.system(.subheadline, design: .rounded).weight(.semibold))
                      .foregroundStyle(ArcticBrand.accent)
                      .contentTransition(.numericText())
                  }.padding(14).frame(maxWidth: .infinity, minHeight: 52)
                    .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("import-tag-" + tag)
                }
              }
            }
            if summary.duplicates > 0 {
              Text("\(summary.duplicates) already in your library").font(.footnote).foregroundStyle(
                .secondary)
            }
            if summary.previewFailures > 0 {
              Text("\(summary.previewFailures) previews unavailable. Your links are saved.")
                .font(.footnote).foregroundStyle(.secondary)
            }
          }.padding(24)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: summary.tagged)
        }
        .accessibilityIdentifier("import-summary")
        .navigationTitle("Your reading list").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }.accessibilityIdentifier("import-summary-done")
          }
        }
      }
    }
    .tint(ArcticBrand.accent)
  }
}
