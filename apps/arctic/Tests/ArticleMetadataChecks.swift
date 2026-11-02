import Foundation

@main struct MetadataChecks {
  static func main() async throws {
    let url = URL(string: "https://example.com/essay")!
    let summary =
      "A publication about technology, creativity and the many questions that shape our everyday lives. Subscribe to discover more thoughtful stories each week."
    let introduction =
      "Glaciers preserve the past in layers of blue ice, inviting us to notice how attention changes the meaning of an ordinary day."
    let metadata = try await ArticleMetadata.parseOffMain(
      """
      <html><head><title>Glacial Longings</title><meta name="description" content="\(summary)">
      <meta property="og:image" content="/ice.jpg"></head><body>
      <nav><p>Navigation should never enter the classification excerpt despite its length.</p></nav>
      <p>Unrelated body prose should lose to the main article whenever it is present.</p>
      <article><header><p>This header is boilerplate and should be omitted from the article.</p></header>
      <p>\(introduction)</p><p>\(introduction)</p>
      <aside><p>Subscribe for more stories about the most wonderful ice in the world.</p></aside>
      <p hidden>Hidden prose should not be sent to the classifier even if it is long enough.</p>
      <p aria-hidden="true">More hidden prose that should never be used in the classification.</p>
      <script>Private script content must never enter the classification context.</script></article></body></html>
      """, baseURL: url)
    precondition(metadata.description == summary)
    precondition(metadata.taggingText == summary + "\n\nArticle excerpt: " + introduction)
    precondition(metadata.imageURL?.absoluteString == "https://example.com/ice.jpg")

    let xPost = URL(string: "https://x.com/iceberg/status/20001")!
    let xArticle = try ArticleMetadata.parse(
      """
      <html><head><meta property="og:title" content="Sea Reader on X: &quot;Reading the ice&quot; / X">
      <meta property="og:description" content="Reading the ice">
      <meta property="og:image" content="https://pbs.twimg.com/media/cover.jpg"></head></html>
      """, baseURL: xPost)
    precondition(xArticle.title == "Reading the ice")
    precondition(xArticle.description.isEmpty)
    precondition(xArticle.imageURL?.host == "pbs.twimg.com")
    let plainPost = try ArticleMetadata.parse(
      "<meta property='og:title' content='Sea Reader (@iceberg) on X'>", baseURL: xPost)
    precondition(plainPost.title == "Sea Reader (@iceberg) on X")
    let elsewhere = try ArticleMetadata.parse(
      "<meta property='og:title' content='Sea Reader on X: &quot;Reading the ice&quot; / X'>",
      baseURL: url)
    precondition(elsewhere.title.hasPrefix("Sea Reader on X"))
    func refused(_ html: String, at page: URL) -> ArticleMetadata.PageError? {
      do {
        _ = try ArticleMetadata.parse(html, baseURL: page)
        return nil
      } catch { return error as? ArticleMetadata.PageError }
    }
    let signIn = URL(string: "https://x.com/i/jf/onboarding/web?next=x")!
    precondition(refused("<title>X - The Everything App</title>", at: signIn) == .xSignIn)
    precondition(refused("<title>Checking your browser...</title>", at: url) == .browserCheck)
    precondition(
      refused("<title>A page</title><script src='/__challenge/x.js'></script>", at: url)
        == .browserCheck)
    precondition(
      refused("<title>Browser checks</title><p>\(introduction)</p>", at: url) == nil)

    let longProse = (1...300).map { "word\($0)" }.joined(separator: " ")
    let bounded = try ArticleMetadata.parse("<main><p>\(longProse)</p></main>", baseURL: url)
    let excerpt = bounded.taggingText.replacingOccurrences(of: "Article excerpt: ", with: "")
    precondition(excerpt.split(separator: " ").count == 180)
    precondition(excerpt.hasSuffix("word180"))
    precondition(bounded.taggingText.count <= 2500)
    let repeated = try ArticleMetadata.parse(
      "<title>Glacial Longings</title><meta name='description' content='Glacial Longings'><p>\(introduction)</p>",
      baseURL: url)
    precondition(repeated.taggingText == "Article excerpt: " + introduction)
    let fallback = try ArticleMetadata.parse(
      "<meta name='description' content='Brief summary'>", baseURL: url)
    precondition(fallback.taggingText == "Brief summary")
    let cached = try ArticleMetadata.taggingContext(
      fromHTML: "<article><p>\(introduction) 雪與冰。 Café.</p></article>", title: "Ice",
      description: "")
    precondition(cached.contains("雪與冰。 Café."))
    let oversize = String(repeating: " ", count: ArticleMetadata.maximumHTMLBytes)
    let truncated = try ArticleMetadata.taggingContext(
      fromHTML: oversize + "<p>\(introduction)</p>", title: "Ice", description: "Fallback")
    precondition(truncated == "Fallback")

    let expected = [
      "design_craft": "Craft", "work_career": "Career", "agency_courage": "Agency",
      "attention_wonder": "Attention", "people_relationships": "Social", "life_meaning": "Life",
      "society_power": "Society", "practical_life": "Practical",
    ]
    for (id, name) in expected {
      let tag = ArticleTagCatalog.all.first { $0.id == id }!
      precondition(tag.name == name)
      let old = ArticleTagCatalog.classificationName(for: tag)
      precondition(ArticleTagCatalog.displayName(for: old) == name)
      precondition(
        ArticleTagCatalog.displayName(for: old.replacingOccurrences(of: " & ", with: " and "))
          == name)
    }
    precondition(
      ArticleTagCatalog.displayNames(["Attention & wonder", "Attention", "My own category"]) == [
        "Attention", "My own category",
      ])
    precondition(
      ArticleTagCatalog.identity(title: "A title", description: "A description")
        == "f3daf9eedb262caa9f59be3ffb49263f683d1c451ef71d3bb4861a42c3874d41",
      "A display rename must not retag the library")
    var article = SavedArticle(url: url, title: "Ice")
    article.tags = ["Attention & wonder", "My own category"]
    let encoded = try JSONEncoder().encode(article)
    let decoded = try JSONDecoder().decode(SavedArticle.self, from: encoded)
    precondition(decoded.tags == article.tags, "Reading records must not rewrite stored tags")
    precondition(decoded.tagNames == ["Attention", "My own category"])
    if CommandLine.arguments.count > 1 {
      let server = URL(string: CommandLine.arguments[1])!
      let large = try await ArticleMetadata.fetch(server.appending(path: "large"))
      precondition(large.title == "Bounded response")
      for _ in 0..<2 {
        let small = try await ArticleMetadata.fetch(server.appending(path: "small"))
        precondition(small.title == "Small response")
      }
      let start = ContinuousClock.now
      let cancelled = Task { try await ArticleMetadata.fetch(server.appending(path: "slow")) }
      try await Task.sleep(for: .milliseconds(100))
      cancelled.cancel()
      do {
        _ = try await cancelled.value
        preconditionFailure("Cancelled metadata fetch published a result")
      } catch {
        precondition(start.duration(to: .now) < .seconds(2))
      }
    }
    print(
      "PASS: excerpt quality, 180-word/2MiB bounds, cached Reader reuse, display aliases, stable fingerprint and unchanged stored tags"
    )
  }
}
