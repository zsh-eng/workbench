import Foundation
import Testing

@testable import ArcticSync

private let sharedServer = URL(string: "https://api.example.test")!
private let sharedScope = SyncScope(
  origin: sharedServer.absoluteString, userId: "alice", epoch: "epoch-1")
private let sharedIdentity = ArcticSession(
  accountID: "alice", email: "alice@example.test", server: sharedServer,
  cookie: "__Secure-workbench.session_token=original")

/// Only the HTTP boundary is simulated. Tests use the production transport,
/// durable journal, scope checks, cursor handling and credential refresh path.
private actor SharedService {
  var epoch = "epoch-1"
  var rejected = false
  var requests = [URLRequest]()
  func changeEpoch() { epoch = "epoch-2" }
  func revoke() { rejected = true }
  func load(_ request: URLRequest) throws -> (Data, URLResponse) {
    requests.append(request)
    let scope = SyncScope(origin: sharedServer.absoluteString, userId: "alice", epoch: epoch)
    let path = request.url!.path
    let expectedHeader = try scope.header
    let status =
      rejected
      ? 401
      : (path.hasSuffix("/state")
        || request.value(forHTTPHeaderField: "X-Sync-Scope") == expectedHeader) ? 200 : 409
    let body: Data
    if path.hasSuffix("/state") {
      body = try JSONEncoder().encode(scope)
    } else if path.hasSuffix("/pull") {
      body = Data(#"{"records":[],"cursor":0,"head":0,"hasMore":false}"#.utf8)
    } else if path.hasSuffix("/push") {
      struct Payload: Decodable { let changes: [SyncChange] }
      let sent = try JSONDecoder().decode(Payload.self, from: request.httpBody!)
      body = try JSONEncoder().encode(
        SyncPush(
          results: sent.changes.enumerated().map { index, change in
            .init(
              accepted: true,
              winner: .init(
                change: change, deviceId: request.value(forHTTPHeaderField: "X-Device-ID")!,
                serverSeq: Int64(index + 1)))
          }))
    } else {
      throw SyncFailure.invalidResponse
    }
    return (
      body,
      HTTPURLResponse(
        url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
        headerFields: [
          "X-Sync-Scope": try scope.header,
          "Set-Cookie": "__Secure-workbench.session_token=refreshed; Secure; HttpOnly; Path=/",
        ])!
    )
  }
}

@Test func sharedTransportBindsDurableProfileAndRejectsResetsWithoutLosingOfflineEdits()
  async throws
{
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let file = directory.appending(path: "trial.json")
  let service = SharedService()
  let remote = try HTTPRemote(
    identity: sharedIdentity, performRequest: { try await service.load($0) },
    cancelRequests: {}, persistSession: { _ in })
  await #expect(throws: SyncFailure.scopeRequired) {
    try await remote.pull(deviceID: "phone", cursor: 0, head: nil)
  }
  let scope = try await remote.getScope()
  // Same bytes as JSON.stringify on the shared server; escaped slashes fail.
  #expect(
    try scope.header
      == #"{"origin":"https://api.example.test","userId":"alice","namespace":"arctic","epoch":"epoch-1"}"#
  )
  let store = try SyncStore(file: file, scope: scope, deviceID: "phone")
  try await store.commit([.init(key: "article/one", value: #"{"title":"Offline article"}"#)])
  try await store.sync(using: remote)
  #expect(await store.pendingCount == 0)
  let sent = await service.requests.last!
  #expect(sent.url!.path == "/api/apps/arctic/sync/v3/push")
  #expect(sent.value(forHTTPHeaderField: "Cookie") == "__Secure-workbench.session_token=refreshed")
  let reopened = try SyncStore(file: file, scope: scope)
  #expect(await reopened.snapshot()["article/one"]?.value == #"{"title":"Offline article"}"#)
  try await reopened.commit([.init(key: "article/one", value: #"{"title":"Later edit"}"#)])
  await service.changeEpoch()
  await #expect(throws: SyncFailure.scopeChanged) { try await reopened.sync(using: remote) }
  await #expect(throws: SyncFailure.scopeChanged) { try await remote.getScope() }
  #expect(await reopened.pendingCount == 1)
  #expect(await reopened.cursor == 0)
  let resetScope = SyncScope(origin: sharedServer.absoluteString, userId: "alice", epoch: "epoch-2")
  #expect(throws: SyncFailure.wrongAccount) { try SyncStore(file: file, scope: resetScope) }
  let old = try SyncStore(file: directory.appending(path: "legacy.json"), accountID: "alice")
  await #expect(throws: SyncFailure.wrongAccount) { try await old.sync(using: remote) }
  await service.revoke()
  await #expect(throws: SyncFailure.unauthorized) { try await reopened.sync(using: remote) }
  #expect(await reopened.pendingCount == 1)
}
