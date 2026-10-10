import SwiftUI

/// A pushed reading page. The compact controls leave the actual article visible
/// and scrollable while appearance changes are applied without a reload.
struct ReaderPage: View {
  let store: ArticleStore
  @State private var browser: ArticleBrowser
  @Environment(\.colorScheme) private var systemScheme
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var appearance = false
  @State private var readingVisible = false
  @State private var nearEnd = false
  @State private var actionError: String?
  @State private var sharingPassage: PassageStory?
  @State private var controlsHeight: CGFloat = 60
  @AppStorage("reader-size") private var fontSize = 20.0
  @AppStorage("reader-font") private var font = "System"
  @AppStorage("reader-padding") private var padding = 18.0
  @AppStorage("reader-leading") private var leading = 1.55
  @AppStorage("reader-palette") private var paletteName = "System"
  private var palette: ReadingPalette { ReadingPalette(rawValue: paletteName) ?? .system }
  /// System follows the device with the White and Ink documents.
  private var documentPalette: ReadingPalette {
    palette != .system ? palette : (systemScheme == .dark ? .dark : .light)
  }
  private var article: SavedArticle? {
    store.articles.first { $0.url == browser.libraryURL }
      ?? store.articles.first { $0.url == browser.sourceURL }
  }
  private var isSaved: Bool { article?.saved == true }
  /// Publisher pages can take seconds to paint. Show the article's own title
  /// and image at once instead of a blank page; stored Reader views skip it.
  private var showsPreface: Bool {
    !browser.hasPresentedContent && browser.websiteFailure == nil && browser.errorMessage == nil
      && article?.downloadedAt == nil
  }
  private var canArchive: Bool { isSaved && article?.isArchived != true }
  /// Back first walks this page's own history, then returns to the page whose
  /// link opened it.
  private var canGoBack: Bool { browser.canGoBack || browser.opener != nil }
  /// The page below, named by its publisher or site for the end prompt.
  private var openerName: String? {
    guard let opener = browser.opener else { return nil }
    func site(_ url: URL?) -> String {
      (url?.host ?? "").replacingOccurrences(of: "www.", with: "")
    }
    let host = site(opener.sourceURL)
    return ArcticPublisher.all.first { site($0.url) == host }?.name
      ?? (host.isEmpty ? "previous page" : host)
  }
  init(browser: ArticleBrowser, store: ArticleStore) {
    _browser = State(initialValue: browser)
    self.store = store
  }

  var body: some View {
    readingPage
      .sheet(item: $sharingPassage) { PassageStorySheet(story: $0) }
      .sheet(item: $browser.annotationPresentation) { presentation in
        ReaderAnnotations(browser: browser, presentation: presentation)
      }
      #if DEBUG
        .overlay(alignment: .topLeading) {
          if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-test-reading-time") {
            Text(readingContext.eligible ? "Tracking" : "Paused")
            .font(.system(size: 7)).accessibilityIdentifier("reading-time-state")
            .allowsHitTesting(false)
          }
          if TestMode.enabled
            && ProcessInfo.processInfo.arguments.contains("-test-annotation-render")
          {
            Text(browser.annotationRenderState).font(.system(size: 7))
            .accessibilityIdentifier("annotation-render-state").allowsHitTesting(false)
          }
        }
      #endif
      .onAppear {
        updateAppearance()
        browser.refreshAnnotations()
        store.visit(browser.libraryURL)
        browser.readingActivity = { [weak browser] in
          guard let browser else { return }
          ReadingSessions.shared.activity(for: browser.libraryURL)
        }
        browser.readingDocumentEnded = { [weak browser] in
          guard let browser else { return }
          ReadingSessions.shared.end(url: browser.libraryURL)
        }
        readingVisible = true
        updateReadingSession()
      }
      .onDisappear {
        readingVisible = false
        browser.showingReadingTime = false
        browser.readingActivity = nil
        browser.readingDocumentEnded = nil
        ReadingSessions.shared.end(url: browser.libraryURL)
        browser.captureReaderPosition()
        if browser.selectedAnnotationID != nil { browser.selectedAnnotationID = nil }
      }
      .onChange(of: scenePhase) { _, phase in
        if phase != .active {
          browser.captureReaderPosition()
          if browser.selectedAnnotationID != nil { browser.selectedAnnotationID = nil }
        }
      }
      .onChange(of: browser.committedURL) { _, url in
        nearEnd = false
        if url != nil { store.visit(browser.libraryURL) }
      }
      .onChange(of: browser.isReader) { _, reader in
        if !reader { browser.captureReaderPosition() }
        nearEnd = false
        if browser.selectedAnnotationID != nil { browser.selectedAnnotationID = nil }
      }
      .onChange(of: readingContext) { _, _ in updateReadingSession() }
      .task {
        while !Task.isCancelled {
          do { try await Task.sleep(for: .seconds(5)) } catch { return }
          ReadingSessions.shared.flush()
        }
      }
      .onChange(of: fontSize, updateAppearance)
      .onChange(of: font, updateAppearance)
      .onChange(of: padding, updateAppearance)
      .onChange(of: leading, updateAppearance)
      .onChange(of: paletteName, updateAppearance)
      .onChange(of: systemScheme, updateAppearance)
      .alert(
        "Could not update article",
        isPresented: Binding(
          get: { actionError != nil }, set: { if !$0 { actionError = nil } }
        )
      ) {
        Button("OK") { actionError = nil }
      } message: {
        Text(actionError ?? "")
      }
      .alert(
        "Could not open article",
        isPresented: Binding(
          get: { browser.errorMessage != nil }, set: { if !$0 { browser.errorMessage = nil } })
      ) {
        Button("OK", role: .cancel) { browser.errorMessage = nil }
      } message: {
        Text(browser.errorMessage ?? "")
      }
  }

  private struct ReadingContext: Equatable {
    let url: URL
    let eligible: Bool
  }

  /// Any article counts, saved or not. Website counts once Reader extraction has
  /// found article text in the page; a publisher's front page never counts.
  private var readingContext: ReadingContext {
    let readable = browser.readerReady && (!browser.isReader || browser.positionReady)
    return ReadingContext(
      url: browser.libraryURL,
      eligible: readingVisible && scenePhase == .active && readable
        && !browser.isPublisherFront && !appearance
        && browser.noteDraft == nil && browser.annotationPresentation == nil
        && !browser.showingReadingTime && sharingPassage == nil
        && browser.errorMessage == nil && actionError == nil)
  }

  /// Calls carry this page's URL, so a covered page cannot stop the visible one.
  private func updateReadingSession() {
    let context = readingContext
    if context.eligible {
      ReadingSessions.shared.begin(url: context.url)
    } else {
      ReadingSessions.shared.pause(url: context.url)
    }
  }

  private var readingPage: some View {
    pageContent
      .background(documentPalette.background)
      .navigationTitle("")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar(.visible, for: .navigationBar)
      .toolbarBackground(.hidden, for: .navigationBar)
      .readerBar(edge: .bottom) { bottomControls }
      .foregroundStyle(palette.foreground).tint(palette.foreground)
      .preferredColorScheme(palette.scheme)
  }

  private var pageContent: some View {
    ZStack(alignment: .top) {
      GeometryReader { geometry in
        // SwiftUI retains the outgoing surface only for the crossfade. WebKit's
        // remote accessibility tree must leave the hierarchy once it is hidden.
        // The browser still owns both documents and their scroll/history state.
        ZStack {
          if browser.isReader {
            WebSurface(
              webView: browser.readerView, insets: geometry.safeAreaInsets,
              isActive: { browser.isReader && browser.readerReady }, nearEnd: $nearEnd,
              onScrollEnd: browser.readerScrollEnded,
              onReadingActivity: { browser.readingActivity?() },
              onTap: browser.noteDraft == nil ? nil : { browser.noteDismissRequest += 1 }
            )
            .opacity(browser.readerReady && browser.positionReady ? 1 : 0)
            .allowsHitTesting(browser.readerReady)
            .accessibilityHidden(!browser.readerReady)
            .transition(.opacity)
          } else {
            WebSurface(
              webView: browser.webView, insets: geometry.safeAreaInsets,
              isActive: { !browser.isReader }, nearEnd: $nearEnd,
              onScrollEnd: browser.websiteScrollEnded,
              onReadingActivity: { browser.readingActivity?() },
              onTap: browser.noteDraft == nil ? nil : { browser.noteDismissRequest += 1 }
            )
            .opacity(browser.websiteAligning ? 0 : 1)
            .animation(.easeOut(duration: 0.12), value: browser.websiteAligning)
            .transition(.opacity)
          }
        }
        .animation(
          .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.22),
          value: browser.isReader
        )
        .accessibilityIdentifier("reader-document")
        .accessibilityValue(
          browser.isReader ? (browser.readerReady ? "Reader" : "Preparing Reader") : "Website"
        )
        .ignoresSafeArea(.container, edges: .vertical)
      }
      if showsPreface {
        ReaderPreface(
          article: article, host: browser.sourceURL.host, palette: documentPalette,
          padding: padding, reduceMotion: reduceMotion
        )
        .transition(.opacity.animation(.easeOut(duration: reduceMotion ? 0.1 : 0.35)))
      }
      ReaderLoadingBar(
        progress: browser.loadProgress,
        active: (browser.isLoading && !browser.isReader) || browser.isOpeningWebsite)
      if let failed = browser.annotations.first(where: { AnnotationStore.shared.failedNotes[$0.id] != nil }) {
        Button("Note not saved · Retry") { AnnotationStore.shared.retryNote(failed.id) }
          .font(.subheadline).padding(12).readerGlass().padding(.top, 8)
          .accessibilityIdentifier("reader-note-retry")
      }
      if let failure = browser.websiteFailure {
        if browser.readerReady {
          HStack(spacing: 12) {
            Text("Website unavailable").font(.subheadline)
            Button("Retry", action: browser.retryFailedWebsite).font(.subheadline.weight(.semibold))
              .accessibilityIdentifier("reader-retry")
          }
          .padding(.horizontal, 16).padding(.vertical, 10)
          .background(.regularMaterial, in: Capsule()).padding(.top, 8)
        } else {
          ContentUnavailableView {
            Label("Page unavailable", systemImage: "wifi.slash")
          } description: {
            Text(failure)
          } actions: {
            Button("Retry", action: browser.retryFailedWebsite)
              .buttonStyle(.borderedProminent).accessibilityIdentifier("reader-retry")
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(documentPalette.background)
        }
      }
    }
  }

  @ViewBuilder private var bottomControls: some View {
    if browser.annotationPresentation != nil {
      // safeAreaBar has a separate native host. Remove its controls during a
      // modal sheet; an accessibilityHidden modifier alone does not hide them.
      Color.clear.frame(height: controlsHeight).allowsHitTesting(false).accessibilityHidden(true)
    } else {
      interactiveBottomControls
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          controlsHeight = $0
        }
    }
  }

  private var interactiveBottomControls: some View {
    VStack(spacing: 10) {
      if browser.selectedAnnotationID == nil, !appearance, nearEnd {
        // A page opened from another page returns there; a library page closes.
        if canArchive {
          Button(action: archive) {
            Label(
              openerName == nil ? "Archive and close" : "Archive and go back",
              systemImage: "archivebox"
            )
            .font(.subheadline.weight(.semibold)).padding(.horizontal, 20).frame(height: 44)
          }
          .readerGlass().accessibilityIdentifier("reader-archive-prompt")
          .transition(reduceMotion ? .opacity : .offset(y: 8).combined(with: .opacity))
        } else if let openerName {
          Button {
            dismiss()
          } label: {
            Label("Back to " + openerName, systemImage: "chevron.left")
              .font(.subheadline.weight(.semibold)).lineLimit(1)
              .padding(.horizontal, 20).frame(height: 44)
          }
          .readerGlass().accessibilityIdentifier("reader-back-prompt")
          .transition(reduceMotion ? .opacity : .offset(y: 8).combined(with: .opacity))
        }
      }
      if let draft = browser.noteDraft {
        ReaderNoteComposer(browser: browser, draft: draft).id(draft.id)
          .transition(.opacity)
      } else if let id = browser.selectedAnnotationID,
        let annotation = browser.annotations.first(where: { $0.id == id }), browser.isReader
      {
        HighlightToolbar(annotation: annotation, browser: browser) {
          sharingPassage = PassageStory(
            annotation: annotation, title: browser.readerView.title ?? browser.webView.title,
            imageURL: browser.previewImageURL)
        }
        .padding(.bottom, 6)
        .transition(reduceMotion ? .opacity : .offset(y: 8).combined(with: .opacity))
      } else if appearance {
        appearanceControls
      } else {
        HStack(alignment: .bottom, spacing: 10) {
          navigationControls
          Button {
            browser.beginNote()
          } label: {
            Image(systemName: "square.and.pencil").font(.system(size: 21))
              .offset(y: -1).frame(width: 54, height: 54)
          }
          .readerGlass().accessibilityLabel("Add note").accessibilityIdentifier("reader-add-note")
        }
        .padding(.horizontal, 12).padding(.bottom, 6)
        .transition(.opacity)
      }
    }
    .animation(
      reduceMotion ? .easeOut(duration: 0.1) : .spring(response: 0.42, dampingFraction: 0.86),
      value: appearance
    )
    .animation(
      .timingCurve(0.23, 1, 0.32, 1, duration: reduceMotion ? 0.1 : 0.18), value: nearEnd
    )
    .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: browser.selectedAnnotationID)
    .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.18), value: browser.noteDraft?.id)
  }

  private var navigationControls: some View {
    HStack(spacing: 0) {
      Button("Back", systemImage: "chevron.left") {
        if browser.canGoBack { browser.back() } else { dismiss() }
      }
      .labelStyle(.iconOnly).frame(width: 44, height: 44).disabled(!canGoBack)
      .accessibilityIdentifier("browser-back")
      .opacity(canGoBack ? 1 : 0.28).frame(maxWidth: .infinity)
      Button("Forward", systemImage: "chevron.right", action: browser.goForward)
        .labelStyle(.iconOnly).frame(width: 44, height: 44)
        .disabled(!browser.canGoForwardPage)
        .accessibilityIdentifier("browser-forward")
        .opacity(browser.canGoForwardPage ? 1 : 0.28).frame(maxWidth: .infinity)
      Button {
        if !browser.isReader { browser.toggleReader() }
        appearance = true
      } label: {
        Image(systemName: "textformat.size").frame(width: 44, height: 44)
      }
      .accessibilityLabel("Reader appearance").accessibilityIdentifier("reader-appearance")
      .accessibilityValue(browser.appearanceDescription).disabled(!browser.hasLoaded)
      .frame(maxWidth: .infinity)
      Button(action: toggleSaved) {
        Image(systemName: isSaved ? "bookmark.fill" : "bookmark").frame(width: 44, height: 44)
          .contentTransition(.symbolEffect(.replace))
          .symbolEffect(.bounce.down, options: .speed(1.4), value: isSaved && !reduceMotion)
          .animation(.easeOut(duration: reduceMotion ? 0.1 : 0.2), value: isSaved)
      }
      .sensoryFeedback(.impact(weight: .medium, intensity: 0.8), trigger: isSaved)
      .accessibilityLabel(isSaved ? "Unsave article" : "Save article")
      .accessibilityValue(isSaved ? "Saved" : "Not saved")
      .accessibilityIdentifier("reader-save").frame(maxWidth: .infinity)
      Button(action: browser.toggleReader) {
        Image(systemName: browser.isReader ? "globe" : "bolt.fill")
          .font(.system(size: 22, weight: .medium, design: .rounded)).frame(width: 44, height: 44)
      }
      .accessibilityLabel(browser.isReader ? "Website" : "Reader")
      .accessibilityIdentifier("reader-toggle")
      .accessibilityValue(browser.readerReady ? "Ready" : "Preparing")
      .disabled(!browser.hasLoaded || browser.isOpeningWebsite)
      .frame(maxWidth: .infinity)
    }
    .font(.title3).padding(.horizontal, 12).padding(.vertical, 5)
    .frame(maxWidth: 360).readerGlass()
  }

  private func toggleSaved() {
    do {
      try store.setSaved(!isSaved, url: article?.url ?? browser.libraryURL)
      if isSaved { browser.persistExtraction(in: store) }
    } catch { actionError = error.localizedDescription }
  }

  private func archive() {
    guard canArchive, let article else { return }
    do {
      try store.archive(article.id)
      dismiss()
    } catch { actionError = error.localizedDescription }
  }

  private var appearanceControls: some View {
    ReaderAppearancePanel(
      font: $font, paletteName: $paletteName, fontSize: $fontSize, padding: $padding,
      leading: $leading, palette: documentPalette
    ) {
      appearance = false
    }
    // Bar content adapts to the content behind it; the panel follows the page.
    .environment(\.colorScheme, documentPalette.scheme ?? systemScheme)
    .padding(.horizontal, 12).padding(.bottom, 6)
    .transition(
      reduceMotion
        ? .opacity
        : .asymmetric(
          insertion: .offset(y: 40).combined(with: .opacity),
          removal: .offset(y: 24).combined(with: .opacity)))
  }

  private func updateAppearance() {
    browser.darkAppearance = systemScheme == .dark
    if browser.readerReady { browser.applyAppearance() }
  }
}

/// Shared stack chrome stays stationary while the Reader page slides beneath it.
struct ReaderNavigationBar: View {
  let browser: ArticleBrowser
  let store: ArticleStore
  let close: () -> Void
  @Environment(\.openURL) private var openURL

  private var article: SavedArticle? {
    store.articles.first { $0.url == browser.libraryURL }
      ?? store.articles.first { $0.url == browser.sourceURL }
  }

  var body: some View {
    HStack {
      // UIKit owns the Back button and its interactive pop gesture.
      Color.clear.frame(width: 44, height: 44).allowsHitTesting(false)
      Spacer()
      Button {
        browser.annotationPresentation = AnnotationPresentation()
      } label: {
        Image(systemName: "text.bubble").frame(width: 44, height: 44)
      }
      .readerGlass()
      .accessibilityLabel("Notes")
      .accessibilityIdentifier("reader-notes")
      .accessibilityValue(
        "\(browser.annotations.count) \(browser.annotations.count == 1 ? "passage" : "passages")"
      )
      // Article notes are local and remain available when the page cannot load.
      Menu {
        Button("Copy link", systemImage: "link") {
          UIPasteboard.general.url = browser.libraryURL
        }.accessibilityIdentifier("reader-copy-link")
        ShareLink(item: browser.libraryURL) {
          Label("Share", systemImage: "square.and.arrow.up")
        }.accessibilityIdentifier("reader-share-link")
        Button("Find in page", systemImage: "doc.text.magnifyingglass", action: browser.findInPage)
          .disabled(!browser.hasLoaded || browser.noteDraft != nil)
          .accessibilityIdentifier("reader-find")
        Button("Reading time", systemImage: "clock") {
          ReadingSessions.shared.pause(url: browser.libraryURL)
          browser.showingReadingTime = true
        }.accessibilityIdentifier("reader-reading-time")
        Divider()
        if let article, article.saved {
          Button(
            article.favourite ? "Unfavourite" : "Favourite",
            systemImage: article.favourite ? "star.slash" : "star"
          ) {
            store.setFavourite(!article.favourite, for: article.id)
          }.accessibilityIdentifier("reader-favourite")
        }
        Button("Archive article", systemImage: "archivebox") {
          guard let article else { return }
          do {
            try store.archive(article.id)
            close()
          } catch { store.errorMessage = error.localizedDescription }
        }
        .disabled(article?.saved != true || article?.isArchived == true)
        .accessibilityIdentifier("reader-archive-menu")
        Button(
          "Refresh Reader", systemImage: "arrow.clockwise.circle", action: browser.refreshReader
        )
        .disabled(browser.isExtracting || browser.isOpeningWebsite)
        .accessibilityIdentifier("reader-refresh")
        Button("Reload", systemImage: "arrow.clockwise", action: browser.reload)
        Button("Open in browser", systemImage: "safari") { openURL(browser.libraryURL) }
          .accessibilityIdentifier("reader-open-browser")
        Button("Try Unwall", systemImage: "doc.text", action: browser.openUnwall)
      } label: {
        Image(systemName: "ellipsis").frame(width: 44, height: 44)
      }.readerGlass().accessibilityLabel("Page options")
    }
    .overlay {
      Text(browser.sourceURL.host?.replacingOccurrences(of: "www.", with: "") ?? "Article")
        .font(.subheadline.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.85)
        .padding(.horizontal, 108).allowsHitTesting(false)
    }
    .padding(.horizontal, 16)
    .sheet(isPresented: Binding(
      get: { browser.showingReadingTime },
      set: { browser.showingReadingTime = $0 }
    )) {
      ReadingStatsView(articleURL: browser.libraryURL, articleTitle: article?.title)
    }
  }
}

/// The article's own front matter, set like Reader, while the publisher loads.
/// Text lines stand in for the body; the image is the card's cached cover.
private struct ReaderPreface: View {
  let article: SavedArticle?
  let host: String?
  let palette: ReadingPalette
  let padding: Double
  let reduceMotion: Bool
  private let metrics = UIFontMetrics(forTextStyle: .body)

  var body: some View {
    GeometryReader { geometry in
      VStack(alignment: .leading, spacing: 0) {
        HStack(spacing: 8) {
          if let favicon = article?.faviconURL {
            ArticleThumbnail(url: favicon, label: "Site icon", pixels: 96)
              .frame(width: 16, height: 16).clipShape(Circle())
          }
          Text((host ?? "").replacingOccurrences(of: "www.", with: "").uppercased())
            .font(.system(size: metrics.scaledValue(for: 12), weight: .semibold))
            .tracking(0.8).opacity(0.65).lineLimit(1)
        }
        if let article {
          Text(article.displayTitle)
            .font(.system(size: metrics.scaledValue(for: 34), weight: .bold))
            .tracking(-1.1).lineLimit(4).minimumScaleFactor(0.8)
            .padding(.vertical, 16)
          if !article.subtitle.isEmpty {
            Text(article.subtitle)
              .font(.system(size: metrics.scaledValue(for: 18)))
              .lineSpacing(5).opacity(0.65).lineLimit(3)
              .padding(.bottom, 26)
          }
        } else {
          ReaderTextPlaceholder(
            widths: [0.92, 0.7], lineHeight: 26, pitch: 40, reduceMotion: reduceMotion
          )
          .padding(.vertical, 18)
        }
        if let image = article?.imageURL {
          ArticleThumbnail(url: image)
            .frame(width: geometry.size.width, height: min(geometry.size.width / 1.6, 260))
            .clipped()
            .padding(.horizontal, -(padding + 4))
            .padding(.bottom, 30)
        }
        ReaderTextPlaceholder(
          widths: [1, 0.97, 0.99, 0.94, 0.98, 0.62], lineHeight: 11, pitch: 31,
          reduceMotion: reduceMotion)
        Spacer(minLength: 0)
      }
      .padding(.horizontal, padding + 4)
      .padding(.top, 28)
      .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
    }
    .foregroundStyle(palette.foreground)
    .background(palette.background.ignoresSafeArea())
    .allowsHitTesting(false)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Loading " + (article?.displayTitle ?? host ?? "article"))
    .accessibilityIdentifier("reader-preface")
  }
}

/// Rounded bars at body rhythm. One soft highlight passes over them while the
/// page loads; Reduce Motion keeps them still.
private struct ReaderTextPlaceholder: View {
  let widths: [CGFloat]
  let lineHeight: CGFloat
  let pitch: CGFloat
  let reduceMotion: Bool
  @State private var sweep = false

  var body: some View {
    GeometryReader { geometry in
      let bars = VStack(alignment: .leading, spacing: pitch - lineHeight) {
        ForEach(widths.indices, id: \.self) { index in
          Capsule().frame(width: geometry.size.width * widths[index], height: lineHeight)
        }
      }
      bars.opacity(0.08)
        .overlay {
          if !reduceMotion {
            LinearGradient(
              colors: [.clear, .primary.opacity(0.1), .clear], startPoint: .leading,
              endPoint: .trailing
            )
            .frame(width: geometry.size.width * 0.6)
            .offset(x: sweep ? geometry.size.width * 1.2 : -geometry.size.width * 0.8)
            .frame(width: geometry.size.width, alignment: .leading)
            .mask(bars)
          }
        }
    }
    .frame(height: pitch * CGFloat(widths.count - 1) + lineHeight)
    .onAppear {
      guard !reduceMotion else { return }
      withAnimation(.easeInOut(duration: 1.5).repeatForever(autoreverses: false).delay(0.2)) {
        sweep = true
      }
    }
  }
}

/// A hairline under the controls, in place of a spinner over the article.
private struct ReaderLoadingBar: View {
  let progress: Double
  let active: Bool

  var body: some View {
    GeometryReader { geometry in
      Capsule().fill(ArcticBrand.accent)
        .frame(width: geometry.size.width * max(0.08, min(1, progress)), height: 2.5)
        .animation(.easeOut(duration: 0.3), value: progress)
    }
    .frame(height: 2.5)
    .padding(.horizontal, 20)
    .opacity(active ? 1 : 0)
    .animation(.easeOut(duration: active ? 0.15 : 0.4).delay(active ? 0.25 : 0), value: active)
    .allowsHitTesting(false)
    .accessibilityHidden(true)
  }
}

/// Live appearance controls. Each choice is shown as itself: themes as their
/// colours, typefaces in their own letterforms, sizes as numbers.
private struct ReaderAppearancePanel: View {
  @Binding var font: String
  @Binding var paletteName: String
  @Binding var fontSize: Double
  @Binding var padding: Double
  @Binding var leading: Double
  let palette: ReadingPalette
  let done: () -> Void
  @Namespace private var selection
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private static let fonts = ["System", "DM Sans", "EB Garamond", "Georgia", "Palatino"]

  private var choice: Animation? {
    reduceMotion ? nil : .spring(response: 0.32, dampingFraction: 0.8)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("Reader appearance").font(.headline)
        Spacer()
        Button("Done", action: done).font(.subheadline.weight(.semibold))
      }
      themes
      typefaces
      HStack {
        Text("Text size").font(.subheadline)
        Spacer(minLength: 8)
        stepper(
          "Text size", value: $fontSize, range: 16...30, step: 1, display: "\(Int(fontSize))",
          decrease: "textformat.size.smaller", increase: "textformat.size.larger")
      }
      HStack(alignment: .bottom, spacing: 10) {
        VStack(alignment: .leading, spacing: 4) {
          Text("Margins").font(.caption).foregroundStyle(.secondary).padding(.leading, 12)
          stepper(
            "Side padding", value: $padding, range: 8...36, step: 2, display: "\(Int(padding))")
        }
        Spacer(minLength: 0)
        VStack(alignment: .leading, spacing: 4) {
          Text("Line spacing").font(.caption).foregroundStyle(.secondary).padding(.leading, 12)
          stepper(
            "Line spacing", value: $leading, range: 1.25...1.95, step: 0.05,
            display: String(format: "%.2f", leading))
        }
      }
    }
    .padding(18)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 28, style: .continuous)
        .strokeBorder(palette.foreground.opacity(0.08), lineWidth: 0.5)
    }
    .shadow(color: .black.opacity(0.1), radius: 20, y: 8)
    .accessibilityElement(children: .contain)
    .sensoryFeedback(.selection, trigger: paletteName)
    .sensoryFeedback(.selection, trigger: font)
  }

  private var themes: some View {
    HStack(spacing: 0) {
      ForEach(ReadingPalette.allCases, id: \.rawValue) { theme in
        let selected = paletteName == theme.rawValue
        Button {
          withAnimation(choice) { paletteName = theme.rawValue }
        } label: {
          VStack(spacing: 6) {
            swatch(theme)
              .frame(width: 38, height: 38)
              .padding(4)
              .overlay {
                if selected {
                  Circle().strokeBorder(palette.foreground, lineWidth: 2)
                    .matchedGeometryEffect(id: "theme", in: selection)
                }
              }
            Text(theme.rawValue).font(.caption2.weight(selected ? .semibold : .regular))
              .foregroundStyle(palette.foreground.opacity(selected ? 1 : 0.55))
          }
          .frame(maxWidth: .infinity).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(theme.rawValue)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("reader-theme")
  }

  @ViewBuilder private func swatch(_ theme: ReadingPalette) -> some View {
    let edge = Circle().strokeBorder(.primary.opacity(0.14), lineWidth: 0.5)
    if theme == .system {
      // System follows the device, so it shows both halves.
      Circle()
        .fill(
          LinearGradient(
            stops: [
              .init(color: ReadingPalette.light.background, location: 0.5),
              .init(color: ReadingPalette.dark.background, location: 0.5),
            ], startPoint: .leading, endPoint: .trailing)
        )
        .overlay(edge)
    } else {
      Circle().fill(theme.background)
        .overlay {
          Text("Aa").font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.foreground)
        }
        .overlay(edge)
    }
  }

  private var typefaces: some View {
    HStack(spacing: 6) {
      ForEach(Self.fonts, id: \.self) { name in
        let selected = font == name
        Button {
          withAnimation(choice) { font = name }
        } label: {
          VStack(spacing: 2) {
            Text("Aa").font(Self.sample(name, size: 21))
            Text(name == "EB Garamond" ? "Garamond" : name)
              .font(.system(size: 10, weight: selected ? .semibold : .regular))
              .lineLimit(1).minimumScaleFactor(0.8)
              .foregroundStyle(palette.foreground.opacity(selected ? 1 : 0.55))
          }
          .frame(maxWidth: .infinity, minHeight: 54)
          .background {
            if selected {
              RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(palette.foreground.opacity(0.08))
                .overlay {
                  RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(palette.foreground.opacity(0.5), lineWidth: 1)
                }
                .matchedGeometryEffect(id: "font", in: selection)
            }
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
        .accessibilityAddTraits(selected ? .isSelected : [])
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("reader-font")
  }

  private static func sample(_ name: String, size: CGFloat) -> Font {
    switch name {
    case "System": .system(size: size, weight: .regular)
    case "Palatino": .custom("Palatino", size: size)
    default: .custom(name, size: size)
    }
  }

  private func stepper(
    _ name: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double,
    display: String, decrease: String = "minus", increase: String = "plus"
  ) -> some View {
    let identifier = name.lowercased().replacingOccurrences(of: " ", with: "-")
    return HStack(spacing: 0) {
      Button {
        value.wrappedValue = max(
          range.lowerBound, ((value.wrappedValue - step) / step).rounded() * step)
      } label: {
        Image(systemName: decrease).frame(width: 42, height: 44)
      }
      .disabled(value.wrappedValue <= range.lowerBound + 0.001)
      .accessibilityLabel("Decrease " + name.lowercased())
      .accessibilityIdentifier("reader-decrease-" + identifier)
      Text(display).font(.subheadline.monospacedDigit()).frame(minWidth: 40)
        .contentTransition(.numericText(value: value.wrappedValue))
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: display)
        .accessibilityLabel(name).accessibilityValue(display)
      Button {
        value.wrappedValue = min(
          range.upperBound, ((value.wrappedValue + step) / step).rounded() * step)
      } label: {
        Image(systemName: increase).frame(width: 42, height: 44)
      }
      .disabled(value.wrappedValue >= range.upperBound - 0.001)
      .accessibilityLabel("Increase " + name.lowercased())
      .accessibilityIdentifier("reader-increase-" + identifier)
    }
    .font(.subheadline.weight(.semibold))
    .background(palette.foreground.opacity(0.06), in: Capsule())
    .sensoryFeedback(.selection, trigger: value.wrappedValue)
  }
}
