import CryptoKit
import Foundation

/// Small device-local checkpoints, separate from the article metadata index.
/// Only a settled Reader gesture or leaving Reader writes a checkpoint.
struct ReaderPosition: Codable {
  static let didChange = Notification.Name("reader-position-changed")
  var index: Int
  var anchor: String
  var fraction: Double
  var progress: Double

  static func key(_ url: URL) -> String {
    "reader-position."
      + SHA256.hash(data: Data(url.absoluteString.utf8))
      .map { String(format: "%02x", $0) }.joined()
  }

  static func load(_ url: URL) -> String? {
    guard let data = UserDefaults.standard.data(forKey: key(url)),
      (try? JSONDecoder().decode(Self.self, from: data)) != nil
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func save(_ json: String, for url: URL) {
    let data = Data(json.utf8)
    guard let position = try? JSONDecoder().decode(Self.self, from: data),
      position.progress.isFinite, position.fraction.isFinite
    else { return }
    let defaults = UserDefaults.standard
    guard defaults.data(forKey: key(url)) != data else { return }
    defaults.set(data, forKey: key(url))
    NotificationCenter.default.post(name: didChange, object: url)
  }

  static let script = try! String(
    contentsOf: Bundle.main.url(forResource: "reader-position", withExtension: "js")!,
    encoding: .utf8)
}
