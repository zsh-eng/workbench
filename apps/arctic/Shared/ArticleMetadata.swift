import Foundation
import SwiftSoup

/// Card metadata and a small, plain-text context for classification. The excerpt
/// is a paragraph heuristic, not a replacement for the Reader's full extraction.
struct ArticleMetadata: Sendable {
  let title: String
  let description: String
  let taggingText: String
  let imageURL: URL?
  let faviconURL: URL?

  static let maximumHTMLBytes = 2 * 1024 * 1024
  static let excerptWordLimit = 180
  static let taggingCharacterLimit = 2500
  /// `ARCTIC_USER_AGENT` in packages/arctic-links. A claim to be a browser costs
  /// pages: a site that compares it with the connection answers with a bot check.
  static let userAgent = "ArcticReader/1.0 (+https://arctic.zsheng.app)"

  /// The page that came back is not the link's: there is nothing in it to keep.
  enum PageError: LocalizedError {
    case browserCheck, xSignIn
    var errorDescription: String? {
      switch self {
      case .browserCheck: "The site showed a browser check instead of the article."
      case .xSignIn: "X asks to sign in before it shows this link."
      }
    }
  }

  // Each process reuses connections across previews. Separate pools preserve
  // Share's shorter resource deadline without per-request session creation.
  private static let shareSession = session(timeout: 8)
  private static let appSession = session(timeout: 20)

  private static func session(timeout: TimeInterval) -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeout
    configuration.timeoutIntervalForResource = timeout
    return URLSession(configuration: configuration)
  }

  static func fetch(_ url: URL, timeout: TimeInterval = 8) async throws -> Self {
    var request = URLRequest(url: url, timeoutInterval: timeout)
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
    let session = timeout <= 8 ? shareSession : appSession
    let (bytes, response) = try await session.bytes(for: request)
    // Breaking AsyncBytes iteration alone does not cancel the network task.
    defer { bytes.task.cancel() }
    guard let response = response as? HTTPURLResponse,
      (200..<300).contains(response.statusCode)
    else { throw URLError(.badServerResponse) }
    // Metadata and an introduction fit in a bounded prefix. Do not download a
    // second page for classification or retain an arbitrarily large response.
    var data = Data()
    data.reserveCapacity(min(maximumHTMLBytes, max(0, Int(response.expectedContentLength))))
    for try await byte in bytes {
      data.append(byte)
      if data.count == maximumHTMLBytes {
        bytes.task.cancel()
        break
      }
    }
    try Task.checkCancellation()
    return try await parseOffMain(
      String(decoding: data, as: UTF8.self), baseURL: response.url ?? url)
  }

  /// SwiftSoup and paragraph normalization stay off the caller's actor, including
  /// Share's main-actor model. Cancellation prevents a completed parse publishing.
  static func parseOffMain(_ html: String, baseURL: URL) async throws -> Self {
    let task = Task.detached(priority: .utility) {
      try Task.checkCancellation()
      return try parse(html, baseURL: baseURL)
    }
    return try await withTaskCancellationHandler {
      let result = try await task.value
      try Task.checkCancellation()
      return result
    } onCancel: {
      task.cancel()
    }
  }

  static func parse(_ html: String, baseURL: URL) throws -> Self {
    if isXSignIn(baseURL) { throw PageError.xSignIn }
    let document = try SwiftSoup.parse(html)
    func meta(_ names: [String]) throws -> String {
      for name in names {
        let value = clean(
          try document.select("meta[property='\(name)'], meta[name='\(name)']")
            .first()?.attr("content") ?? "")
        if !value.isEmpty { return value }
      }
      return ""
    }
    func resourceURL(_ value: String) -> URL? {
      guard !value.isEmpty,
        let url = URL(string: value, relativeTo: baseURL)?.absoluteURL,
        ["https", "http", "file"].contains(url.scheme ?? "")
      else { return nil }
      return url
    }
    let headline = try meta(["og:title", "twitter:title"])
    let fallbackTitle = clean(try document.title())
    if try isChallenge(html, title: fallbackTitle, document: document) {
      throw PageError.browserCheck
    }
    let xTitle = xArticleTitle(headline, baseURL)
    let title =
      xTitle
      ?? (headline.isEmpty
        ? (fallbackTitle.isEmpty ? (baseURL.host ?? baseURL.absoluteString) : fallbackTitle)
        : headline)
    var description = try meta(["og:description", "description", "twitter:description"])
    // The post of an X Article has only the Article's title to describe it.
    if description == xTitle { description = "" }
    let imageURL = resourceURL(try meta(["og:image", "twitter:image"]))
    let iconElement = try document.select("link[rel][href]").first { element in
      let roles = try element.attr("rel").lowercased().split(whereSeparator: \.isWhitespace)
      return roles.contains("icon") || roles.contains("apple-touch-icon")
    }
    let faviconURL = resourceURL(try iconElement?.attr("href") ?? "")
    let context = try taggingContext(document, title: title, description: description)
    return Self(
      title: title, description: description, taggingText: context,
      imageURL: imageURL, faviconURL: faviconURL)
  }

  /// Reuse a cached Reader page when its publisher metadata had no useful prose.
  /// Call from a worker, as with parse(_:baseURL:).
  static func taggingContext(fromHTML html: String, title: String, description: String) throws
    -> String
  {
    let prefix = String(decoding: html.utf8.prefix(maximumHTMLBytes), as: UTF8.self)
    return try taggingContext(SwiftSoup.parse(prefix), title: title, description: description)
  }

  static func containsExcerpt(_ text: String) -> Bool { text.contains("Article excerpt: ") }

  /// Include available introductory prose even when marketing metadata is long.
  /// Keep it distinct from the card description and exclude repeated boilerplate.
  private static func taggingContext(_ document: Document, title: String, description: String)
    throws -> String
  {
    let normalizedTitle = normalized(title)
    let normalizedDescription = normalized(description)
    let repeatsTitle =
      !normalizedTitle.isEmpty
      && (normalizedDescription == normalizedTitle
        || (normalizedDescription.hasPrefix(normalizedTitle)
          && normalizedDescription.count < normalizedTitle.count + 50))
    try document.select(
      "script, style, noscript, template, nav, header, footer, aside, form, [hidden], [aria-hidden=true], [role=navigation], [role=banner], [role=contentinfo]"
    ).remove()
    var paragraphs = try document.select("article p, main p, [role=main] p")
    if paragraphs.isEmpty() { paragraphs = try document.select("body p") }
    var words: [Substring] = []
    var seen = Set([normalizedTitle, normalizedDescription])
    for paragraph in paragraphs.prefix(120) {
      try Task.checkCancellation()
      let text = clean(try paragraph.text())
      guard text.count >= 40, seen.insert(normalized(text)).inserted else { continue }
      words.append(
        contentsOf: text.split(whereSeparator: \.isWhitespace).prefix(
          excerptWordLimit - words.count))
      if words.count == excerptWordLimit { break }
    }
    guard !words.isEmpty else { return String(description.prefix(taggingCharacterLimit)) }
    let excerpt = words.joined(separator: " ")
    let summary = repeatsTitle ? "" : String(description.prefix(600))
    let context =
      summary.isEmpty ? "Article excerpt: " + excerpt : summary + "\n\nArticle excerpt: " + excerpt
    return String(context.prefix(taggingCharacterLimit))
  }

  static func isX(_ url: URL) -> Bool {
    ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]
      .contains(url.host?.lowercased() ?? "")
  }

  /// X sends a link it will not show to a visitor to its sign-in page.
  private static func isXSignIn(_ url: URL) -> Bool {
    isX(url)
      && url.path.range(
        of: "^/(i/jf/onboarding|i/flow/login|login)(/|$)", options: .regularExpression) != nil
  }

  /// `Name on X: "Title" / X`, the title X gives a post that carries an Article.
  private static func xArticleTitle(_ title: String, _ url: URL) -> String? {
    guard isX(url), let match = title.wholeMatch(of: #/.+ on X: [“"](.+)[”"] \/ X/#) else {
      return nil
    }
    return String(match.1)
  }

  /// `isChallengePage` in packages/arctic-links: a check's title or markup, and
  /// little to read. An article that quotes one says more.
  private static func isChallenge(_ html: String, title: String, document: Document) throws -> Bool
  {
    let named =
      title.range(
        of: "^(just a moment|access denied|attention required"
          + "|checking your browser|verify you are human)[\\s.!…]*(\\|.*)?$",
        options: [.regularExpression, .caseInsensitive]) != nil
      || html.range(
        of: "/__challenge/|HASHCASH_CONFIG|_cf_chl_opt", options: .regularExpression) != nil
    return try named && (document.body()?.text().count ?? 0) < 1200
  }

  private static func clean(_ text: String) -> String {
    text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  private static func normalized(_ text: String) -> String {
    text.lowercased().filter { $0.isLetter || $0.isNumber }
  }
}
