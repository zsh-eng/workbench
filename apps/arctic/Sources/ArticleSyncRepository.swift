import ArcticSync
import CryptoKit
import Foundation

/// Local and authenticated libraries are separate profiles. Signing in does not
/// silently copy the local library, and signing out cannot expose another account.
enum ArticleSyncScope: Equatable, Sendable {
  case local
  /// The server's stream scope. Its account and epoch name the profile, so a
  /// reset stream on the server can never reuse an old cursor or outbox.
  case account(SyncScope)

  var identity: String {
    get throws {
      switch self {
      case .local: return "local"
      case .account(let scope): return try scope.header
      }
    }
  }
}

enum ArticleSyncError: Error, Equatable {
  case invalidScope, invalidValue, localMigrationIntoAccount, localProfileCannotSync
  /// The copied library did not read back the same as its source. Nothing committed.
  case copyMismatch
}

/// Versioned record families keep page metadata separate from library actions
/// and explicit tag edits. Credentials, cached-file paths and pending requests
/// never enter these records.
enum ArticleSyncCodec {
  struct LocalState: Codable {
    let id: UUID
    let url: URL
    let previewFailed: Bool
    var previewFetchedAt: Date?
    let downloadedAt: Date?
    var sharedTransferID: UUID?
    var feedbackTransferID: UUID?
    var pendingTaggingIdentity: String?
    let imageFileURL: URL?
    let faviconFileURL: URL?

    init(_ article: SavedArticle) {
      id = article.id
      url = article.url
      previewFailed = article.previewFailed
      previewFetchedAt = article.previewFetchedAt
      downloadedAt = article.downloadedAt
      sharedTransferID = article.sharedTransferID
      feedbackTransferID = article.tagging?.sharedFeedbackTransferID
      pendingTaggingIdentity = article.tagging?.pendingIdentity
      imageFileURL = article.imageURL?.isFileURL == true ? article.imageURL : nil
      faviconFileURL = article.faviconURL?.isFileURL == true ? article.faviconURL : nil
    }

    /// This device's caches without share or tagging receipts. An account
    /// import keeps the article's ID, so its offline copy stays available.
    var deviceCache: LocalState {
      var value = self
      value.sharedTransferID = nil
      value.feedbackTransferID = nil
      value.pendingTaggingIdentity = nil
      return value
    }
  }

  struct Metadata: Codable, Equatable {
    let url: URL
    let title: String
    let subtitle: String
    let taggingText: String?
    let imageURL: URL?
    let faviconURL: URL?
  }
  struct Library: Codable, Equatable {
    let url: URL
    let saved: Bool
    let archived: Bool
    let favourite: Bool?
    let read: Bool
    let savedAt: Date?
    let lastVisitedAt: Date?
    let importBatchID: UUID?
    let favouritedAt: Date?
  }
  struct Tags: Codable, Equatable {
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
          lastVisitedAt: article.lastVisitedAt, importBatchID: article.importBatchID,
          favouritedAt: article.favouritedAt)),
      "tags/" + id: try encode(
        Tags(
          url: url, names: article.tagNames.sorted(), generation: state?.generation ?? localID(id),
          automatic: state?.automatic.sorted() ?? [],
          manual: state?.manual.sorted() ?? article.tagNames.sorted(),
          rejected: state?.rejected.sorted() ?? [], completedIdentity: state?.completedIdentity)),
    ]
  }

  /// Merges a change that this device has not uploaded with another device's
  /// value for the same record. A field that this device changed keeps its value;
  /// every other field takes the other device's. Tags merge as one value, because
  /// their names follow from the other lists. An unsaved article is neither
  /// archived nor favourite. Nil leaves the newer record to win.
  static func resolve(key: String, base: String?, local: String, remote: String) -> String? {
    func decode<T: Decodable>(_ value: String?) -> T? {
      value.flatMap { try? JSONDecoder().decode(T.self, from: Data($0.utf8)) }
    }
    switch key.split(separator: "/").first {
    case "article":
      guard let local: Metadata = decode(local), let remote: Metadata = decode(remote) else {
        return nil
      }
      let base: Metadata =
        decode(base)
        ?? Metadata(
          url: local.url, title: "", subtitle: "", taggingText: nil, imageURL: nil, faviconURL: nil)
      func pick<T: Equatable>(_ field: KeyPath<Metadata, T>) -> T {
        local[keyPath: field] != base[keyPath: field] ? local[keyPath: field] : remote[keyPath: field]
      }
      return try? encode(
        Metadata(
          url: remote.url, title: pick(\.title), subtitle: pick(\.subtitle),
          taggingText: pick(\.taggingText), imageURL: pick(\.imageURL),
          faviconURL: pick(\.faviconURL)))
    case "library":
      guard let local: Library = decode(local), let remote: Library = decode(remote) else {
        return nil
      }
      let base: Library =
        decode(base)
        ?? Library(
          url: local.url, saved: false, archived: false, favourite: nil, read: false, savedAt: nil,
          lastVisitedAt: nil, importBatchID: nil, favouritedAt: nil)
      func pick<T: Equatable>(_ field: KeyPath<Library, T>) -> T {
        local[keyPath: field] != base[keyPath: field] ? local[keyPath: field] : remote[keyPath: field]
      }
      let saved = pick(\.saved)
      let favourite = pick(\.favourite)
      return try? encode(
        Library(
          url: remote.url, saved: saved, archived: saved && pick(\.archived),
          favourite: saved || favourite != true ? favourite : false, read: pick(\.read),
          savedAt: saved ? pick(\.savedAt) : nil, lastVisitedAt: pick(\.lastVisitedAt),
          importBatchID: pick(\.importBatchID), favouritedAt: pick(\.favouritedAt)))
    case "tags":
      guard let local: Tags = decode(local), let remote: Tags = decode(remote),
        let base: Tags = decode(base)
      else { return nil }
      if local == base { return try? encode(remote) }
      if remote == base { return try? encode(local) }
      return nil
    default:
      return nil
    }
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
        [value.savedAt, value.lastVisitedAt, value.favouritedAt].compactMap({ $0 }).allSatisfy({
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
      article.favouritedAt = library.favouritedAt
      if let record = rows["tags/" + id], !record.isDeleted {
        let tags = try decoder.decode(Tags.self, from: Data(record.value.utf8))
        var state = ArticleTaggingState(generation: tags.generation)
        state.automatic = tags.automatic
        state.manual = tags.manual
        state.rejected = tags.rejected
        state.completedIdentity = tags.completedIdentity
        state.sharedFeedbackTransferID = article.tagging?.sharedFeedbackTransferID
        state.pendingIdentity = article.tagging?.pendingIdentity
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
    article.previewFetchedAt = state.previewFetchedAt
    article.downloadedAt = state.downloadedAt
    article.sharedTransferID = state.sharedTransferID
    var tagging = ArticleTaggingState()
    tagging.sharedFeedbackTransferID = state.feedbackTransferID
    tagging.pendingIdentity = state.pendingTaggingIdentity
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
    try mutation(journal, articles: [id: article])
  }

  /// Several articles' new values, by identity, in one transaction. Nil removes
  /// an article with tombstones. Only families whose content changed are written.
  static func mutation(_ journal: JournalSnapshot, articles: [String: SavedArticle?]) throws
    -> JournalMutation
  {
    var localValues = journal.localValues
    var mutations: [LocalMutation] = []
    for (id, article) in articles {
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
    }
    return JournalMutation(
      mutations: mutations.sorted { $0.key < $1.key }, localValues: localValues)
  }

  /// Reads a copy back before it commits. Every source article, one per identity,
  /// must project to the same synced records and the same device state.
  static func verifyCopy(of source: [SavedArticle], mutation: JournalMutation) throws {
    var rows: [String: SyncRecord] = [:]
    for change in mutation.mutations where !change.isDeleted {
      rows[change.key] = SyncRecord(
        change: SyncChange(
          key: change.key, value: change.value, isDeleted: false,
          schemaVersion: change.schemaVersion, hlc: SyncClock(wallTimeMs: 0)),
        deviceId: "copy", serverSeq: 0)
    }
    let projected = try project(JournalSnapshot(rows: rows, localValues: mutation.localValues))
    let byIdentity = Dictionary(
      try projected.map { (try identity($0.url), $0) }, uniquingKeysWith: { first, _ in first })
    var seen = Set<String>()
    for article in source {
      let id = try identity(article.url)
      guard seen.insert(id).inserted else { continue }
      guard let copy = byIdentity[id], try values(copy) == values(article),
        try encode(LocalState(copy)) == encode(LocalState(article))
      else { throw ArticleSyncError.copyMismatch }
    }
    guard projected.count == seen.count else { throw ArticleSyncError.copyMismatch }
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
      lhs.favouritedAt == rhs.favouritedAt,
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

/// One article's edit, as its value before and after. Applying it to the latest
/// committed article changes only the fields this edit changed, so a change that
/// another device made to a different field survives.
struct ArticlePatch: Sendable {
  let before: SavedArticle?
  let after: SavedArticle?
  var url: URL { (after ?? before)!.url }

  /// The library publishes whole arrays. Articles keep their IDs across edits.
  static func changes(from old: [SavedArticle], to new: [SavedArticle]) -> [ArticlePatch] {
    // Most edits change one article in place, so try a walk in step first.
    if old.count == new.count, zip(old, new).allSatisfy({ $0.id == $1.id }) {
      return zip(old, new).compactMap { $0 == $1 ? nil : ArticlePatch(before: $0, after: $1) }
    }
    var previous = Dictionary(old.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    var patches: [ArticlePatch] = []
    for article in new {
      let before = previous.removeValue(forKey: article.id)
      if before != article { patches.append(ArticlePatch(before: before, after: article)) }
    }
    for article in old where previous.removeValue(forKey: article.id) != nil {
      patches.append(ArticlePatch(before: article, after: nil))
    }
    return patches
  }

  func applied(to current: SavedArticle?) -> SavedArticle? {
    guard let after else { return nil }
    guard var result = current else { return after }
    // A new article meets one that another device saved: compare with an empty one.
    let base = before ?? SavedArticle(id: result.id, url: result.url, title: "")
    func take<T: Equatable>(_ field: WritableKeyPath<SavedArticle, T>) {
      if base[keyPath: field] != after[keyPath: field] {
        result[keyPath: field] = after[keyPath: field]
      }
    }
    take(\.id)
    take(\.title)
    take(\.subtitle)
    take(\.taggingText)
    take(\.imageURL)
    take(\.faviconURL)
    take(\.previewFailed)
    take(\.previewFetchedAt)
    take(\.isRead)
    take(\.isArchived)
    take(\.isFavourite)
    take(\.favouritedAt)
    take(\.isSaved)
    take(\.savedAt)
    take(\.lastVisitedAt)
    take(\.tags)
    take(\.downloadedAt)
    take(\.sharedTransferID)
    take(\.importBatchID)
    if base.tagging != after.tagging {
      if let previous = base.tagging, let next = after.tagging, var state = result.tagging {
        func takeTagging<T: Equatable>(_ field: WritableKeyPath<ArticleTaggingState, T>) {
          if previous[keyPath: field] != next[keyPath: field] {
            state[keyPath: field] = next[keyPath: field]
          }
        }
        takeTagging(\.generation)
        takeTagging(\.pendingIdentity)
        takeTagging(\.completedIdentity)
        takeTagging(\.automatic)
        takeTagging(\.manual)
        takeTagging(\.rejected)
        takeTagging(\.sharedFeedbackTransferID)
        result.tagging = state
      } else {
        result.tagging = after.tagging
      }
    }
    // A history visit never unsaves an article that another device saved.
    if before == nil, current?.saved == true, !after.saved {
      result.isSaved = current?.isSaved
      result.savedAt = current?.savedAt
    }
    // An unsaved article is neither archived nor favourite, whichever device set them.
    if !result.saved {
      if result.isArchived == true { result.isArchived = false }
      if result.isFavourite == true { result.isFavourite = false }
    }
    return result
  }
}

/// One profile's library. This journal is authoritative: domain records and the
/// outbox are persisted together before a write returns. The legacy JSON file is
/// only the first copy's source. Keep one repository per profile. Network errors
/// never discard local rows.
actor ArticleSyncRepository {
  let scope: ArticleSyncScope
  let directory: URL
  private let store: SyncStore

  private init(scope: ArticleSyncScope, directory: URL, store: SyncStore) {
    self.scope = scope
    self.directory = directory
    self.store = store
  }

  /// Opens a profile at once, without an actor hop, and returns its articles.
  /// A local profile with nothing committed first copies `legacyLocalArticles`.
  /// The copy is read back and checked before it commits; a mismatch commits
  /// nothing and throws `copyMismatch`.
  static func load(
    root: URL, scope: ArticleSyncScope, legacyLocalArticles: [SavedArticle]? = nil
  ) throws -> (repository: ArticleSyncRepository, articles: [SavedArticle]) {
    if legacyLocalArticles != nil, scope != .local {
      throw ArticleSyncError.localMigrationIntoAccount
    }
    let identity = try scope.identity
    let directory = root.appending(
      path: ArticleSyncCodec.hash(identity), directoryHint: .isDirectory)
    // Every committed record passed this check, so opening does not repeat it.
    let (store, snapshot) = try SyncStore.open(
      database: directory.appending(path: "journal.sqlite"), accountID: identity,
      validateValue: { try ArticleSyncCodec.validate($0) },
      resolve: { ArticleSyncCodec.resolve(key: $0, base: $1, local: $2, remote: $3) },
      initial: { journal in
        let source = legacyLocalArticles ?? []
        let copy = try ArticleSyncCodec.transaction(replacing: journal, with: source)
        try ArticleSyncCodec.verifyCopy(of: source, mutation: copy)
        return copy
      })
    let repository = ArticleSyncRepository(scope: scope, directory: directory, store: store)
    return (repository, try ArticleSyncCodec.project(snapshot))
  }

  static func open(root: URL, scope: ArticleSyncScope, legacyLocalArticles: [SavedArticle]? = nil)
    async throws -> ArticleSyncRepository
  {
    try load(root: root, scope: scope, legacyLocalArticles: legacyLocalArticles).repository
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

  /// Commits library edits in order, in one transaction. Each one applies to the
  /// latest committed article. An article whose URL cannot sync stays on screen
  /// for this session only.
  func apply(_ patches: [ArticlePatch]) async throws {
    _ = try await store.transaction { journal in
      var staged: [String: SavedArticle?] = [:]
      for patch in patches {
        guard let id = try? ArticleSyncCodec.identity(patch.url) else { continue }
        let current: SavedArticle?
        if let value = staged[id] {
          current = value
        } else {
          current = try ArticleSyncCodec.article(journal, identity: id)
        }
        staged[id] = patch.applied(to: current)
      }
      return try ArticleSyncCodec.mutation(journal, articles: staged)
    }
  }

  /// Explicit account import copies only missing identities. A tombstone counts
  /// as existing, so a retry cannot revive a removed article. Each article keeps
  /// its ID, offline copy and cached images; share and tagging receipts stay behind.
  func importLocalArticles(_ articles: [SavedArticle]) async throws -> [SavedArticle] {
    guard scope != .local else { throw ArticleSyncError.invalidScope }
    let journal = try await store.transaction { journal in
      var localValues = journal.localValues
      var mutations: [LocalMutation] = []
      var seen = Set<String>()
      for article in articles {
        let id = try ArticleSyncCodec.identity(article.url)
        guard journal.rows["article/" + id] == nil, journal.rows["library/" + id] == nil,
          seen.insert(id).inserted
        else { continue }
        mutations += try ArticleSyncCodec.values(article).map {
          LocalMutation(key: $0.key, value: $0.value)
        }
        localValues[id] = try ArticleSyncCodec.encode(
          ArticleSyncCodec.LocalState(article).deviceCache)
      }
      return JournalMutation(mutations: mutations, localValues: localValues)
    }
    return try ArticleSyncCodec.project(journal)
  }

  /// How many of these articles an import would add.
  func missingCount(of articles: [SavedArticle]) async throws -> Int {
    let rows = await store.snapshot()
    var seen = Set<String>()
    for article in articles {
      guard let id = try? ArticleSyncCodec.identity(article.url),
        rows["article/" + id] == nil, rows["library/" + id] == nil
      else { continue }
      seen.insert(id)
    }
    return seen.count
  }

  /// Pull, then upload. Call `takeRemoteChanges` afterwards, also after a failure:
  /// a sync that stops part way keeps the pages it already committed.
  func sync(using remote: any SyncRemote) async throws {
    guard scope != .local else { throw ArticleSyncError.localProfileCannotSync }
    try await store.sync(using: remote)
  }

  /// Articles that another device changed since the last call, by identity.
  /// Nil means removed, or not yet complete in this profile.
  func takeRemoteChanges() async throws -> [String: SavedArticle?] {
    let keys = await store.takeMergedKeys()
    guard !keys.isEmpty else { return [:] }
    let journal = await store.snapshotState()
    var changes: [String: SavedArticle?] = [:]
    for key in keys {
      guard let slash = key.firstIndex(of: "/") else { continue }
      let id = String(key[key.index(after: slash)...])
      guard changes[id] == nil else { continue }
      changes[id] = .some(try ArticleSyncCodec.article(journal, identity: id))
    }
    return changes
  }

  var pendingCount: Int { get async { await store.pendingCount } }
}
