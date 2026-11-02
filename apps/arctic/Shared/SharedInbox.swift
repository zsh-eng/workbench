import Foundation

/// A durable save request. The extension publishes this once; only the main app
/// removes it after a successful library commit.
struct SharedArticleTransfer: Codable {
  var id: UUID
  var url: URL
  var title: String?
  var subtitle: String?
  var taggingText: String?

  init(
    id: UUID = UUID(), url: URL, title: String? = nil, subtitle: String? = nil,
    taggingText: String? = nil
  ) {
    self.id = id
    self.url = url
    self.title = title
    self.subtitle = subtitle
    self.taggingText = taggingText
  }
}

/// Tag completion is a separate immutable event. Updating the original save file
/// would race with the main app importing and removing it.
struct SharedTaggingResult: Codable {
  var id: UUID
  var url: URL
  var title: String
  var subtitle: String?
  var taggingText: String?
  var tagNames: [String]
  var inputFingerprint: String
  var categoryVersion: Int
  /// Set only when the extension has displayed this result. Older events have no receipt.
  var feedbackPresented: Bool?
}

enum SharedInbox {
  static let group = "group.com.zsheng.ArticleReader"

  static func webURL(_ text: String) -> URL? {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.contains(where: \.isWhitespace), let url = URL(string: text),
      ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
      let host = url.host, host.contains(".")
    else { return nil }
    return url
  }

  static func directory() throws -> URL { try directory(named: "IncomingLinks") }
  static func taggingResultsDirectory() throws -> URL { try directory(named: "IncomingTagResults") }

  private static func directory(named name: String) throws -> URL {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { throw InboxError.unavailable }
    let directory = root.appending(path: name, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  @discardableResult
  static func save(
    _ url: URL, title: String? = nil, subtitle: String? = nil, taggingText: String? = nil
  ) throws
    -> SharedArticleTransfer
  {
    guard webURL(url.absoluteString) != nil else { throw InboxError.invalidLink }
    let transfer = SharedArticleTransfer(
      url: url, title: title, subtitle: subtitle, taggingText: taggingText)
    let file = try directory().appending(path: transfer.id.uuidString + ".json")
    try JSONEncoder().encode(transfer).write(to: file, options: .atomic)
    return transfer
  }

  static func saveTaggingResult(_ result: SharedTaggingResult) throws {
    let file = try taggingResultsDirectory().appending(path: result.id.uuidString + ".json")
    try JSONEncoder().encode(result).write(to: file, options: .atomic)
  }

  /// A queue's files, oldest first. The names are UUIDs and a directory listing
  /// has no order, so each file's creation is the record of when it was shared.
  static func pending(in directory: URL) throws -> [(file: URL, sharedAt: Date)] {
    try FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: [.creationDateKey]
    )
    .filter { $0.pathExtension == "json" }
    .map { file in
      (file, try file.resourceValues(forKeys: [.creationDateKey]).creationDate ?? .distantPast)
    }
    .sorted { $0.sharedAt < $1.sharedAt }
  }

  /// Accept old URL-only inbox entries that were queued before this version.
  static func decodeTransfer(from data: Data, fileID: UUID = UUID()) throws -> SharedArticleTransfer
  {
    let decoder = JSONDecoder()
    if let transfer = try? decoder.decode(SharedArticleTransfer.self, from: data) {
      return transfer
    }
    return SharedArticleTransfer(id: fileID, url: try decoder.decode(URL.self, from: data))
  }

  enum InboxError: LocalizedError {
    case unavailable, invalidLink
    var errorDescription: String? {
      switch self {
      case .unavailable:
        "Shared storage is unavailable. Enable the Articles App Group for both targets in Xcode."
      case .invalidLink: "Share a complete HTTP or HTTPS article link."
      }
    }
  }
}
