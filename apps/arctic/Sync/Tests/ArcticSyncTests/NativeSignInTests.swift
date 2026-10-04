import Foundation
import Testing

@testable import ArcticSync

@Test func pkceMatchesRFC7636AndDoesNotExposeVerifier() throws {
  let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
  let request = try NativeSignInRequest(
    server: URL(string: "https://reader.zsheng.app")!, state: String(repeating: "s", count: 43),
    verifier: verifier)
  #expect(!request.authorizationURL.absoluteString.contains(verifier))
  #expect(
    request.authorizationURL.absoluteString.contains(
      "challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"))
}
@Test func callbackRequiresExactRouteStateAndSingleCode() throws {
  let state = String(repeating: "s", count: 43)
  let code = String(repeating: "c", count: 43)
  let request = try NativeSignInRequest(
    server: URL(string: "https://reader.zsheng.app")!, state: state,
    verifier: String(repeating: "v", count: 43))
  #expect(
    try request.callbackCode(URL(string: "articles://auth/callback?state=\(state)&code=\(code)")!)
      == code)
  let invalidCallbacks: [(String, CallbackRejection)] = [
    ("articles://auth/callback?state=wrong&code=\(code)", .stateMismatch),
    ("articles://attacker/callback?state=\(state)&code=\(code)", .route),
    ("articles://auth/other?state=\(state)&code=\(code)", .route),
    ("https://auth/callback?state=\(state)&code=\(code)", .route),
    ("articles://user@auth/callback?state=\(state)&code=\(code)", .credentials),
    ("articles://auth/callback?state=\(state)&code=\(code)#", .fragment),
    ("articles://auth/callback?code=\(code)", .missingState),
    ("articles://auth/callback?state=\(state)&state=\(state)&code=\(code)", .duplicateState),
    ("articles://auth/callback?state=\(state)", .missingCode),
    ("articles://auth/callback?state=\(state)&code=\(code)&code=\(code)", .duplicateCode),
    ("articles://auth/callback?state=\(state)&code=short", .codeFormat),
  ]
  for (invalid, reason) in invalidCallbacks {
    #expect(throws: NativeSignInFailure.callbackRejected(reason)) {
      try request.callbackCode(URL(string: invalid)!)
    }
  }
  #expect(throws: NativeSignInFailure.failed) {
    try request.callbackCode(
      URL(string: "articles://auth/callback?state=\(state)&error=sign_in_failed")!)
  }
}
@Test func signInAttemptsHaveIndependentStateAndChallenge() throws {
  let server = URL(string: "https://reader.zsheng.app")!
  let a = try NativeSignInRequest(server: server)
  let b = try NativeSignInRequest(server: server)
  let aQuery = URLComponents(url: a.authorizationURL, resolvingAgainstBaseURL: false)!.queryItems!
  let bQuery = URLComponents(url: b.authorizationURL, resolvingAgainstBaseURL: false)!.queryItems!
  for name in ["state", "challenge"] {
    let aValue = aQuery.first { $0.name == name }!.value!
    let bValue = bQuery.first { $0.name == name }!.value!
    #expect(aValue != bValue)
    #expect(aValue.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil)
  }
}
