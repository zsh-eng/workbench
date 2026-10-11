import ArcticSync
import CryptoKit
import Foundation

/// Local and authenticated libraries are separate profiles. Signing in does not
/// silently copy the local library, and signing out cannot expose another account.
enum ArticleSyncScope: Equatable, Sendable {
  case local
  case account(server: URL, id: String)

  var identity: String {
    get throws {
      switch self {
      case .local: return "local"
      case .account(let server, let id):
        guard var origin = URLComponents(url: server, resolvingAgainstBaseURL: false),
          origin.scheme?.lowercased() == "https", let host = origin.host, !host.isEmpty,
          origin.user == nil, origin.password == nil, !id.isEmpty,
          origin.query == nil, origin.fragment == nil, origin.path.isEmpty || origin.path == "/"
        else { throw ArticleSyncError.invalidScope }
        origin.scheme = "https"
        origin.host = host.lowercased()
        if origin.port == 443 { origin.port = nil }
        origin.path = ""
        origin.query = nil
        origin.fragment = nil
        guard let value = origin.string else { throw ArticleSyncError.invalidScope }
        return value + "\n" + id
      }
    }
  }
}

enum ArticleSyncError: Error, Equatable {
  case invalidScope, invalidValue, localMigrationIntoAccount, localProfileCannotSync
}

/// Versioned record families keep page metadata separate from library actions
/// and explicit tag edits. Credentials, cached-file paths and pending requests
/// never enter these records.
enum ArticleSyncCodec {
  struct LocalState: Codable {
    let id: UUID
    let url: URL
    let previewFailed: Bool
    let downloadedAt: Date?
    let sharedTransferID: UUID?
    let feedbackTransferID: UUID?
    let imageFileURL: URL?
    let faviconFileURL: URL?

    init(_ article: SavedArticle) {
      id = article.id
      url = article.url
      previewFailed = article.previewFailed
      downloadedAt = article.downloadedAt
      sharedTransferID = article.sharedTransferID
      feedbackTransferID = article.tagging?.sharedFeedbackTransferID
      imageFileURL = article.imageURL?.isFileURL == true ? article.imageURL : nil
      faviconFileURL = article.faviconURL?.isFileURL == true ? article.faviconURL : nil
    }
  }

  struct Metadata: Codable {
    let url: URL
    let title: String
    let subtitle: String
    let taggingText: String?
    let imageURL: URL?
    let faviconURL: URL?
  }
  struct Library: Codable {
    let url: URL
    let saved: Bool
    let archived: Bool
    let favourite: Bool?
    let read: Bool
    let savedAt: Date?
    let lastVisitedAt: Date?
    let importBatchID: UUID?
  }
  struct Tags: Codable {
    let url: URL
    let names: [String]
    let generation: UUID
    let automatic: [String]
    let manual: [String]
    let rejected: [String]
    let completedIdentity: String?
  }

  /// Query strings can identify different documents and are retained. Fragments,
  /// default ports and host casing do not identify a different saved article.
  static func canonicalURL(_ url: URL) throws -> URL {
    guard var value = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let scheme = value.scheme?.lowercased(), ["https", "http"].contains(scheme),
      let host = value.host, !host.isEmpty, value.user == nil, value.password == nil
    else { throw ArticleSyncError.invalidValue }
    value.scheme = scheme
    value.host = host.lowercased()
    if (scheme == "https" && value.port == 443) || (scheme == "http" && value.port == 80) {
      value.port = nil
    }
    value.fragment = nil
    if value.path.isEmpty { value.path = "/" }
    guard let result = value.url else { throw ArticleSyncError.invalidValue }
    return result
  }

  static func hash(_ value: String) -> String {
    let digits = Array("0123456789abcdef".utf8)
    let bytes = SHA256.hash(data: Data(value.utf8)).flatMap { byte in
      [digits[Int(byte >> 4)], digits[Int(byte & 0x0f)]]
    }
    return String(decoding: bytes, as: UTF8.self)
  }

  static func identity(_ url: URL) throws -> String { try hash(canonicalURL(url).absoluteString) }

  static func localID(_ identity: String) -> UUID {
    let hex = String(identity.prefix(32))
    let offsets = [0, 8, 12, 16, 20, 32]
    let parts = zip(offsets, offsets.dropFirst()).map { begin, end in
      String(
        hex[hex.index(hex.startIndex, offsetBy: begin)..<hex.index(hex.startIndex, offsetBy: end)])
    }
    return UUID(uuidString: parts.joined(separator: "-"))!
  }

  static func encode<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }

  private static func sharedImageURL(_ url: URL?) -> URL? {
    guard let url, ["https", "http"].contains(url.scheme?.lowercased() ?? "") else { return nil }
    return url
  }

  static func values(_ article: SavedArticle) throws -> [String: String] {
    let url = try canonicalURL(article.url)
    let id = try identity(url)
    let state = article.tagging
    return [
      "article/" + id: try encode(
        Metadata(
          url: url, title: article.title, subtitle: article.subtitle,
          taggingText: article.taggingText, imageURL: sharedImageURL(article.imageURL),
          faviconURL: sharedImageURL(article.faviconURL))),
      "library/" + id: try encode(
        Library(
          url: url, saved: article.saved, archived: article.isArchived == true,
          favourite: article.isFavourite, read: article.isRead == true, savedAt: article.savedAt,
          lastVisitedAt: article.lastVisitedAt, importBatchID: article.importBatchID)),
      "tags/" + id: try encode(
        Tags(
          url: url, names: article.tagNames.sorted(), generation: state?.generation ?? localID(id),
          automatic: state?.automatic.sorted() ?? [],
          manual: state?.manual.sorted() ?? article.tagNames.sorted(),
          rejected: state?.rejected.sorted() ?? [], completedIdentity: state?.completedIdentity)),
    ]
  }

  static func validate(_ change: SyncChange) throws {
    guard change.schemaVersion == 1 else { throw ArticleSyncError.invalidValue }
    let data = Data(change.value.utf8)
    let decoder = JSONDecoder()
    let url: URL
    let family: String
    switch change.key.split(separator: "/").first {
    case "article":
      let value = try decoder.decode(Metadata.self, from: data)
      url = value.url
      family = "article"
      for image in [value.imageURL, value.faviconURL].compactMap({ $0 }) {
        _ = try canonicalURL(image)
      }
    case "library":
      let value = try decoder.decode(Library.self, from: data)
      url = value.url
      family = "library"
      guard
        [value.savedAt, value.lastVisitedAt].compactMap({ $0 }).allSatisfy({
          $0.timeIntervalSince1970.isFinite
        })
      else { throw ArticleSyncError.invalidValue }
    case "tags":
      let value = try decoder.decode(Tags.self, from: data)
      url = value.url
      family = "tags"
      for tags in [value.names, value.automatic, value.manual, value.rejected] {
        guard tags.count <= 256, Set(tags).count == tags.count,
          tags.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 })
        else { throw ArticleSyncError.invalidValue }
      }
    default: throw ArticleSyncError.invalidValue
    }
    guard try canonicalURL(url) == url, try change.key == family + "/" + identity(url) else {
      throw ArticleSyncError.invalidValue
    }
  }

  static func project(_ rows: [String: SyncRecord], retaining local: [SavedArticle] = []) throws
    -> [SavedArticle]
  {
    var overlays: [String: SavedArticle] = [:]
    for article in local { overlays[try identity(article.url)] = article }
    let decoder = JSONDecoder()
    var result: [SavedArticle] = []
    for (key, record) in rows where key.hasPrefix("article/") && !record.isDeleted {
      let id = String(key.dropFirst("article/".count))
      guard let membership = rows["library/" + id], !membership.isDeleted else { continue }
      let metadata = try decoder.decode(Metadata.self, from: Data(record.value.utf8))
      let library = try decoder.decode(Library.self, from: Data(membership.value.utf8))
      var article =
        overlays[id] ?? SavedArticle(id: localID(id), url: metadata.url, title: metadata.title)
      article.title = metadata.title
      article.subtitle = metadata.subtitle
      article.taggingText = metadata.taggingText
      article.imageURL =
        metadata.imageURL ?? (article.imageURL?.isFileURL == true ? article.imageURL : nil)
      article.faviconURL =
        metadata.faviconURL ?? (article.faviconURL?.isFileURL == true ? article.faviconURL : nil)
      article.isSaved = library.saved
      article.isArchived = library.archived
      article.isFavourite = library.favourite
      article.isRead = library.read
      article.savedAt = library.savedAt
      article.lastVisitedAt = library.lastVisitedAt
      article.importBatchID = library.importBatchID
      if let record = rows["tags/" + id], !record.isDeleted {
        let tags = try decoder.decode(Tags.self, from: Data(record.value.utf8))
        var state = ArticleTaggingState(generation: tags.generation)
        state.automatic = tags.automatic
        state.manual = tags.manual
        state.rejected = tags.rejected
        state.completedIdentity = tags.completedIdentity
        state.sharedFeedbackTransferID = article.tagging?.sharedFeedbackTransferID
        article.tagging = state
        article.tags = tags.names
      } else {
        article.tagging = nil
        article.tags = []
      }
      result.append(article)
    }
    return result.sorted {
      let lhs = $0.savedAt ?? $0.lastVisitedAt ?? .distantPast
      let rhs = $1.savedAt ?? $1.lastVisitedAt ?? .distantPast
      return lhs == rhs ? $0.url.absoluteString < $1.url.absoluteString : lhs > rhs
    }
  }

  private static func localOverlay(id: String, encoded: String) throws -> SavedArticle {
    let state = try JSONDecoder().decode(LocalState.self, from: Data(encoded.utf8))
    guard try identity(state.url) == id else { throw ArticleSyncError.invalidValue }
    var article = SavedArticle(id: state.id, url: state.url, title: "")
    article.previewFailed = state.previewFailed
    article.downloadedAt = state.downloadedAt
    article.sharedTransferID = state.sharedTransferID
    var tagging = ArticleTaggingState()
    tagging.sharedFeedbackTransferID = state.feedbackTransferID
    article.tagging = tagging
    article.imageURL = state.imageFileURL
    article.faviconURL = state.faviconFileURL
    return article
  }

  static func project(_ journal: JournalSnapshot) throws -> [SavedArticle] {
    let overlays = try journal.localValues.map { try localOverlay(id: $0.key, encoded: $0.value) }
    return try project(journal.rows, retaining: overlays)
  }

  /// Normal edits need only three domain records and one private value. This
  /// avoids rebuilding the complete library to change a tag, title or saved flag.
  static func article(_ journal: JournalSnapshot, identity id: String) throws -> SavedArticle? {
    var rows: [String: SyncRecord] = [:]
    for family in ["article", "library", "tags"] {
      let key = family + "/" + id
      rows[key] = journal.rows[key]
    }
    let overlays = try journal.localValues[id].map { [try localOverlay(id: id, encoded: $0)] } ?? []
    return try project(rows, retaining: overlays).first
  }

  static func articleMutation(
    _ journal: JournalSnapshot, identity id: String, article: SavedArticle?
  ) throws -> JournalMutation {
    var localValues = journal.localValues
    var mutations: [LocalMutation] = []
    if let article {
      guard try identity(article.url) == id else { throw ArticleSyncError.invalidValue }
      let previous = try self.article(journal, identity: id)
      let previousValues = try previous.map(values) ?? [:]
      for (key, value) in try values(article) where previousValues[key] != value {
        mutations.append(LocalMutation(key: key, value: value))
      }
      let localValue = try encode(LocalState(article))
      if localValues[id] != localValue { localValues[id] = localValue }
    } else {
      for family in ["article", "library", "tags"] {
        let key = family + "/" + id
        guard let record = journal.rows[key], !record.isDeleted else { continue }
        mutations.append(LocalMutation(key: key, value: record.value, isDeleted: true))
      }
      localValues[id] = nil
    }
    return JournalMutation(mutations: mutations, localValues: localValues)
  }

  static func transaction(replacing journal: JournalSnapshot, with articles: [SavedArticle]) throws
    -> JournalMutation
  {
    var localValues = journal.localValues
    var seen = Set<String>()
    for article in articles {
      let id = try identity(article.url)
      guard seen.insert(id).inserted else { continue }
      let localValue = try encode(LocalState(article))
      if localValues[id] != localValue { localValues[id] = localValue }
    }
    for article in try project(journal.rows) {
      let id = try identity(article.url)
      if !seen.contains(id) { localValues[id] = nil }
    }
    return JournalMutation(
      mutations: try mutations(replacing: journal.rows, with: articles), localValues: localValues)
  }

  static func mutations(replacing rows: [String: SyncRecord], with articles: [SavedArticle]) throws
    -> [LocalMutation]
  {
    let previous = try project(rows)
    let previousByURL = Dictionary(uniqueKeysWithValues: previous.map { ($0.url, $0) })
    var seen = Set<URL>()
    var mutations: [LocalMutation] = []
    for article in articles {
      let url = try canonicalURL(article.url)
      guard seen.insert(url).inserted else { continue }
      let before = previousByURL[url]
      // Most edits affect one article. Compare domain values before allocating
      // JSON and hashing every family of every unchanged article.
      if let before, try sameSyncedValues(before, article) { continue }
      let previousValues = try before.map(values) ?? [:]
      for (key, value) in try values(article) where previousValues[key] != value {
        mutations.append(LocalMutation(key: key, value: value))
      }
    }
    // Only complete, visible articles can be removed by a domain edit. Partial
    // pull groups stay untouched until their remaining families arrive.
    for article in previous where !seen.contains(article.url) {
      let id = try identity(article.url)
      for family in ["article", "library", "tags"] {
        let key = family + "/" + id
        guard let record = rows[key], !record.isDeleted else { continue }
        mutations.append(LocalMutation(key: key, value: record.value, isDeleted: true))
      }
    }
    return mutations.sorted { $0.key < $1.key }
  }

  private static func sameSyncedValues(_ lhs: SavedArticle, _ rhs: SavedArticle) throws -> Bool {
    guard lhs.title == rhs.title, lhs.subtitle == rhs.subtitle,
      lhs.taggingText == rhs.taggingText,
      sharedImageURL(lhs.imageURL) == sharedImageURL(rhs.imageURL),
      sharedImageURL(lhs.faviconURL) == sharedImageURL(rhs.faviconURL),
      lhs.saved == rhs.saved, (lhs.isArchived == true) == (rhs.isArchived == true),
      lhs.favourite == rhs.favourite,
      (lhs.isRead == true) == (rhs.isRead == true), lhs.savedAt == rhs.savedAt,
      lhs.lastVisitedAt == rhs.lastVisitedAt, lhs.importBatchID == rhs.importBatchID,
      lhs.tagNames.sorted() == rhs.tagNames.sorted(),
      (lhs.tagging?.automatic ?? []).sorted() == (rhs.tagging?.automatic ?? []).sorted(),
      (lhs.tagging?.manual ?? lhs.tagNames).sorted()
        == (rhs.tagging?.manual ?? rhs.tagNames).sorted(),
      (lhs.tagging?.rejected ?? []).sorted() == (rhs.tagging?.rejected ?? []).sorted(),
      lhs.tagging?.completedIdentity == rhs.tagging?.completedIdentity
    else { return false }
    let lhsGeneration = try lhs.tagging?.generation ?? localID(identity(lhs.url))
    let rhsGeneration = try rhs.tagging?.generation ?? localID(identity(rhs.url))
    return lhsGeneration == rhsGeneration
  }
}

/// Staged integration: ArticleStore does not use this repository yet.
/// This journal is authoritative: domain records and the outbox are persisted
/// together before a mutation returns. The legacy JSON is only an import source.
/// The app must keep one repository per scope, and guard UI publication with its
/// account generation after every await. Network errors never discard local rows.
actor ArticleSyncRepository {
  let scope: ArticleSyncScope
  let directory: URL
  private let store: SyncStore

  private init(scope: ArticleSyncScope, directory: URL, store: SyncStore) {
    self.scope = scope
    self.directory = directory
    self.store = store
  }

  static func open(root: URL, scope: ArticleSyncScope, legacyLocalArticles: [SavedArticle]? = nil)
    async throws -> ArticleSyncRepository
  {
    if legacyLocalArticles != nil, scope != .local {
      throw ArticleSyncError.localMigrationIntoAccount
    }
    let identity = try scope.identity
    let directory = root.appending(
      path: ArticleSyncCodec.hash(identity), directoryHint: .isDirectory)
    let file = directory.appending(path: "journal.sqlite")
    let store = try SyncStore(
      database: file, accountID: identity, validateValue: { try ArticleSyncCodec.validate($0) })
    for record in await store.snapshot().values {
      try ArticleSyncCodec.validate(record.change)
    }
    // The first committed transaction is the migration marker. The complete source
    // and its outbox commit together; a crash before that commit retries.
    if await !store.hasCommitted {
      _ = try await store.transaction { journal in
        try ArticleSyncCodec.transaction(replacing: journal, with: legacyLocalArticles ?? [])
      }
    }
    return ArticleSyncRepository(scope: scope, directory: directory, store: store)
  }

  func snapshot() async throws -> [SavedArticle] {
    try ArticleSyncCodec.project(await store.snapshotState())
  }

  func transaction(
    _ edit: @Sendable (inout [SavedArticle]) throws -> Void
  ) async throws -> [SavedArticle] {
    let journal = try await store.transaction { journal in
      var articles = try ArticleSyncCodec.project(journal)
      try edit(&articles)
      return try ArticleSyncCodec.transaction(replacing: journal, with: articles)
    }
    return try ArticleSyncCodec.project(journal)
  }

  /// Use for a single article edit. The callback receives the latest committed
  /// article and cannot change its canonical URL. Nil removes it with tombstones.
  func editArticle(
    at url: URL, _ edit: @Sendable (inout SavedArticle?) throws -> Void
  ) async throws -> SavedArticle? {
    let id = try ArticleSyncCodec.identity(url)
    let journal = try await store.transaction { journal in
      var article = try ArticleSyncCodec.article(journal, identity: id)
      try edit(&article)
      return try ArticleSyncCodec.articleMutation(journal, identity: id, article: article)
    }
    return try ArticleSyncCodec.article(journal, identity: id)
  }

  /// Explicit account import copies only missing identities. A tombstone counts
  /// as existing so this operation cannot revive a deleted article on retry.
  func importLocalArticles(_ articles: [SavedArticle]) async throws -> [SavedArticle] {
    guard scope != .local else { throw ArticleSyncError.invalidScope }
    let rows = try await store.update { rows in
      var mutations: [LocalMutation] = []
      var seen = Set<String>()
      for article in articles {
        let id = try ArticleSyncCodec.identity(article.url)
        guard rows["article/" + id] == nil, seen.insert(id).inserted else { continue }
        mutations += try ArticleSyncCodec.values(article).map {
          LocalMutation(key: $0.key, value: $0.value)
        }
      }
      return mutations
    }
    // Local profile caches and receipts must not cross into an account profile.
    return try ArticleSyncCodec.project(rows)
  }

  func sync(using remote: any SyncRemote) async throws -> [SavedArticle] {
    guard scope != .local else { throw ArticleSyncError.localProfileCannotSync }
    try await store.sync(using: remote)
    return try await snapshot()
  }

  var pendingCount: Int { get async { await store.pendingCount } }
}
