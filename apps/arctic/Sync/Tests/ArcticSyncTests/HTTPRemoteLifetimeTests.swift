import Foundation
import Testing

@testable import ArcticSync

private let server = URL(string: "https://sync.example")!
private let scope = SyncScope(origin: server.absoluteString, userId: "old", epoch: "test-epoch")
private func credential(_ account: String, cookie: String) -> ArcticSession {
  .init(accountID: account, email: "\(account)@example.com", server: server, cookie: cookie)
}

/// Deliberately ignores cancellation, as an already completed network callback
/// can be queued before URLSession invalidation reaches its task.
private actor DeferredResponse {
  private var response: CheckedContinuation<(Data, URLResponse), Error>?
  private var started: [CheckedContinuation<Void, Never>] = []
  func load(_ request: URLRequest) async throws -> (Data, URLResponse) {
    try await withCheckedThrowingContinuation { continuation in
      response = continuation
      for waiter in started { waiter.resume() }
      started.removeAll()
    }
  }
  func waitUntilRequested() async {
    guard response == nil else { return }
    await withCheckedContinuation { started.append($0) }
  }
  func deliver() {
    let reply = HTTPURLResponse(
      url: server, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: [
        "X-Sync-Scope": try! scope.header,
        "Set-Cookie":
          "__Secure-workbench.session_token=renewed-old-token; Path=/; Secure; HttpOnly",
      ])!
    let body = Data(#"{"records":[],"cursor":0,"head":0,"hasMore":false}"#.utf8)
    response?.resume(returning: (body, reply))
    response = nil
  }
}

/// Synchronous, locked credential sink mirrors the non-suspending Keychain write
/// without reading or modifying any system credentials.
private final class MemoryCredentials: @unchecked Sendable {
  private let lock = NSLock()
  private var value: ArcticSession
  private var writes = 0
  private var cancellations = 0
  private var requests = 0
  init(_ initial: ArcticSession) { value = initial }
  func save(_ value: ArcticSession) {
    lock.withLock {
      self.value = value
      writes += 1
    }
  }
  func replaceAccount(_ value: ArcticSession) { lock.withLock { self.value = value } }
  func cancel() { lock.withLock { cancellations += 1 } }
  func requested() { lock.withLock { requests += 1 } }
  func snapshot() -> (
    account: String, cookie: String, writes: Int, cancellations: Int, requests: Int
  ) {
    lock.withLock { (value.accountID, value.cookie, writes, cancellations, requests) }
  }
}

@Test func retiredRemoteCannotOverwriteReplacementAccountWithLateCookie() async throws {
  let old = credential("old", cookie: "old-token")
  let sink = MemoryCredentials(old)
  let response = DeferredResponse()
  let remote = try HTTPRemote(
    identity: old, scope: scope, performRequest: { try await response.load($0) },
    cancelRequests: { sink.cancel() }, persistSession: { sink.save($0) })
  let request = Task { try await remote.pull(deviceID: "phone", cursor: 0, head: nil) }
  await response.waitUntilRequested()
  await remote.cancel()
  sink.replaceAccount(credential("new", cookie: "new-token"))
  await response.deliver()
  await #expect(throws: CancellationError.self) { try await request.value }
  let state = sink.snapshot()
  #expect(state.account == "new")
  #expect(state.cookie == "new-token")
  #expect(state.writes == 0)
  #expect(state.cancellations == 1)
}

@Test func retiredRemoteCannotStartAnotherRequest() async throws {
  let old = credential("old", cookie: "old-token")
  let response = DeferredResponse()
  let sink = MemoryCredentials(old)
  let remote = try HTTPRemote(
    identity: old, scope: scope,
    performRequest: { request in
      sink.requested()
      return try await response.load(request)
    }, cancelRequests: { sink.cancel() }, persistSession: { sink.save($0) })
  await remote.cancel()
  await #expect(throws: CancellationError.self) {
    try await remote.pull(deviceID: "phone", cursor: 0, head: nil)
  }
  #expect(sink.snapshot().requests == 0)
  #expect(sink.snapshot().writes == 0)
}

@Test func cancelledTaskCannotPersistLateRefreshWithoutRemoteRetirement() async throws {
  let old = credential("old", cookie: "old-token")
  let response = DeferredResponse()
  let sink = MemoryCredentials(old)
  let remote = try HTTPRemote(
    identity: old, scope: scope, performRequest: { try await response.load($0) },
    cancelRequests: { sink.cancel() }, persistSession: { sink.save($0) })
  let request = Task { try await remote.pull(deviceID: "phone", cursor: 0, head: nil) }
  await response.waitUntilRequested()
  request.cancel()
  await response.deliver()
  await #expect(throws: CancellationError.self) { try await request.value }
  #expect(sink.snapshot().writes == 0)
  #expect(sink.snapshot().cookie == "old-token")
}

@Test func activeRemotePersistsItsValidRefresh() async throws {
  let old = credential("old", cookie: "old-token")
  let response = DeferredResponse()
  let sink = MemoryCredentials(old)
  let remote = try HTTPRemote(
    identity: old, scope: scope, performRequest: { try await response.load($0) },
    cancelRequests: { sink.cancel() }, persistSession: { sink.save($0) })
  let request = Task { try await remote.pull(deviceID: "phone", cursor: 0, head: nil) }
  await response.waitUntilRequested()
  await response.deliver()
  _ = try await request.value
  #expect(sink.snapshot().writes == 1)
  #expect(sink.snapshot().account == "old")
  #expect(sink.snapshot().cookie.contains("renewed-old-token"))
}
