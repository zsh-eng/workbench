import Foundation
import Testing

@testable import ArcticSync

private actor Requests {
  var sent: [URLRequest] = []
  func add(_ request: URLRequest) { sent.append(request) }
}

/// The server names each file again and refuses a mismatch, so a Reader copy
/// must upload under the ID that Browser/src/sync/xxh64.ts gives. These IDs
/// come from that implementation.
@Test func articleTextUploadsUnderTheIDTheServerChecks() async throws {
  let pattern = { (count: Int) in Data((0..<count).map { UInt8(($0 * 31 + 7) & 0xff) }) }
  let html = Data("<p>“Slow down,” she said — café, naïve, 日本語.</p>".utf8)
  let expected: [(Data, String)] = [
    (Data(), "xxh64:ef46db3751d8e999"),
    (Data("a".utf8), "xxh64:d24ec4f1a98c6e5b"),
    (Data("abc".utf8), "xxh64:44bc2cf5ad770999"),
    (pattern(31), "xxh64:4a74f3a1a39ad4a1"),
    (pattern(32), "xxh64:8d57d6a4671cc43d"),
    (pattern(101), "xxh64:fbfdf3fa1a53bc7f"),
    (html, "xxh64:8ccbed78a0a0a003"),
  ]
  for (bytes, id) in expected { #expect(XXH64.fileID(bytes) == id) }

  let server = URL(string: "https://sync.example")!
  let identity = ArcticSession(
    accountID: "reader", email: "reader@example.com", server: server, cookie: "session=fixture")
  let requests = Requests()
  func remote(_ namespace: String) throws -> HTTPRemote {
    let scope = SyncScope(
      origin: server.absoluteString, userId: "reader", namespace: namespace, epoch: "first")
    return try HTTPRemote(
      identity: identity, scope: scope, namespace: namespace,
      performRequest: { request in
        await requests.add(request)
        let reply = HTTPURLResponse(
          url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
          headerFields: ["X-Sync-Scope": try scope.header])!
        return (Data("{}".utf8), reply)
      }, cancelRequests: {}, persistSession: { _ in })
  }
  // A copy goes to the files of arctic-content, as HTML, under that ID.
  #expect(
    try await remote("arctic-content").uploadText(html) == expected.last!.1)
  let sent = try #require(await requests.sent.first)
  #expect(sent.httpMethod == "PUT")
  #expect(sent.url?.path() == "/api/apps/arctic-content/files/xxh64:8ccbed78a0a0a003")
  #expect(sent.value(forHTTPHeaderField: "Content-Type") == "text/html; charset=utf-8")
  #expect(sent.value(forHTTPHeaderField: "X-Sync-Scope")?.contains("arctic-content") == true)
  #expect(sent.httpBody == html)
  // The library's other media stays on the phone.
  await #expect(throws: SyncFailure.mediaSyncDisabled) {
    try await remote("arctic").uploadText(html)
  }
}
