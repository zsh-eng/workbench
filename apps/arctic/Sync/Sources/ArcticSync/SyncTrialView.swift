#if DEBUG
  import AuthenticationServices
  import CryptoKit
  import SwiftUI

  /// An explicit, disposable integration surface. It never opens ArticleStore or
  /// copies the user's library. Remove this once the approved migration ships.
  public struct SyncTrialView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model = SyncTrialModel()
    @State private var anchor: ASPresentationAnchor?
    @State private var server = "https://api.zsheng.app"
    @State private var title = "Arctic sync trial"

    public init() {}
    public var body: some View {
      NavigationStack {
        Form {
          Section {
            Text(
              "A separate sample article tests sign-in and sync between your devices. Your library stays local."
            )
            .foregroundStyle(.secondary)
            TextField("HTTPS server", text: $server)
              .textContentType(.URL)
              .disabled(model.connected || model.busy)
              .accessibilityIdentifier("sync-trial-server")
            if model.connected {
              Text(model.email).font(.subheadline)
              Button("Sync now") { model.run { try await model.synchronize() } }
                .accessibilityIdentifier("sync-trial-sync")
              Button("Sign out", role: .destructive) { model.run { try await model.signOut() } }
            } else {
              Button("Continue with Google") {
                guard let anchor else { return }
                model.run { try await model.signIn(server: server, anchor: anchor) }
              }.disabled(anchor == nil)
                .accessibilityIdentifier("sync-trial-sign-in")
              Button("Restore session") { model.run { try await model.restore(server: server) } }
            }
          } header: {
            Text("Sync trial")
          }
          if model.connected {
            Section("Sample article") {
              TextField("Title", text: $title).accessibilityIdentifier("sync-trial-title")
              Button("Save sample locally") {
                model.run { try await model.saveSample(title: title) }
              }
              .accessibilityIdentifier("sync-trial-save")
              if let sample = model.sample {
                Text(sample).accessibilityIdentifier("sync-trial-sample")
              }
              Text("\(model.pending) pending upload\(model.pending == 1 ? "" : "s")")
                .font(.caption).foregroundStyle(.secondary)
            }
          }
          Section {
            Text(model.status).font(.callout).textSelection(.enabled)
              .accessibilityIdentifier("sync-trial-status")
            if model.busy { ProgressView().controlSize(.small) }
          }
        }
        .formStyle(.grouped)
        .disabled(model.busy)
        .navigationTitle("Sync trial")
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .background(
          TrialWindowAnchor { if anchor !== $0 { anchor = $0 } }.frame(width: 0, height: 0))
      }
      #if os(macOS)
        .frame(width: 520, height: 540)
      #endif
      .onDisappear { model.cancel() }
    }
  }

  @MainActor
  private final class SyncTrialModel: ObservableObject {
    @Published var connected = false
    @Published var email = ""
    @Published var sample: String?
    @Published var pending = 0
    @Published var status = "Requires a server with native Arctic auth enabled."
    @Published var busy = false
    private var step = "Sync"
    private var operation: Task<Void, Never>?
    private var login: NativeGoogleSignIn?
    private var remote: HTTPRemote?
    private var store: SyncStore?
    private var identity: ArcticSession?

    func run(_ body: @escaping @MainActor () async throws -> Void) {
      guard !busy else { return }
      busy = true
      operation = Task {
        defer { busy = false }
        do { try await body() } catch is CancellationError {} catch {
          // Do not print the request, auth callback, cookie, or underlying error.
          switch error {
          case SyncFailure.scopeChanged, SyncFailure.wrongAccount:
            status =
              "The account or server data changed. This trial profile is preserved; sync is stopped."
          case SyncFailure.unauthorized:
            status = "The session expired. Sign out, then sign in again. Local changes are kept."
          case NativeSignInFailure.invalidCallback:
            status = "The sign-in return link did not match this attempt. Please start Google sign-in again."
          case NativeSignInFailure.callbackRejected(let reason):
            status = "Sign-in return link rejected (\(reason.rawValue)). Please report this label; do not share the return link."
          case NativeSignInFailure.failed:
            status = "Google sign-in returned without a valid session. Please try again."
          case NativeSignInFailure.unableToPresent:
            status = "Could not open the sign-in sheet. Close Sync trial and try again."
          case SyncFailure.httpStatus(let code):
            status = "\(step) failed (HTTP \(code)). Local changes are kept."
          case SyncFailure.invalidResponse:
            status = "\(step) received an invalid server response. Local changes are kept."
          case SyncFailure.invalidServer:
            status = "Use an HTTPS server address without a path, such as https://api.zsheng.app."
          default:
            let failure = error as NSError
            // Only allowlisted domains and numeric codes: error descriptions can
            // include credential-bearing request or callback URLs.
            if failure.domain == NSURLErrorDomain {
              status = "\(step) could not connect (network \(failure.code)). Please retry."
            } else if failure.domain == NSOSStatusErrorDomain {
              status = "\(step) failed (Keychain \(failure.code)). Local changes are kept."
            } else if failure.domain == ASWebAuthenticationSessionError.errorDomain {
              status = "Google sign-in was cancelled or could not return to Arctic (\(failure.code))."
            } else {
              status = "\(step) could not complete. Please retry. Local changes are kept."
            }
          }
        }
      }
    }
    func signIn(server: String, anchor: ASPresentationAnchor) async throws {
      guard let server = URL(string: server) else { throw SyncFailure.invalidServer }
      let login = NativeGoogleSignIn(anchor: anchor)
      self.login = login
      defer { self.login = nil }
      step = "Google sign-in and code exchange"
      status = "Opening Google sign-in…"
      let session = try await login.signIn(server: server)
      try Task.checkCancellation()
      // Save the credential before any sync; never use browser-global cookies.
      step = "Saving the session"
      try SessionKeychain.save(session)
      try await attach(session)
      try await synchronize()
    }
    func restore(server: String) async throws {
      step = "Restoring the session"
      guard let server = URL(string: server), let session = try SessionKeychain.load(server: server)
      else {
        status = "No session on this device. Continue with Google."
        return
      }
      try await attach(session)
      try await synchronize()
    }
    private func attach(_ session: ArcticSession) async throws {
      step = "Opening the local trial profile"
      let root = try FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask,
        appropriateFor: nil, create: true
      ).appending(path: "ArcticSyncTrial", directoryHint: .isDirectory)
      let name = SHA256.hash(
        data: Data((session.server.absoluteString + "\n" + session.accountID).utf8)
      )
      .map { String(format: "%02x", $0) }.joined()
      let file = root.appending(path: name + ".json")
      let prior = try await Task.detached { try SyncStore.persistedScope(file: file) }.value
      try Task.checkCancellation()
      let transport = try HTTPRemote(identity: session, scope: prior)
      // Open a known local profile before doing network work. Offline restore can
      // show its sample and accept edits even when session validation fails.
      if let prior {
        let local = try SyncStore(file: file, scope: prior)
        try Task.checkCancellation()
        identity = session
        remote = transport
        store = local
        connected = true
        email = session.email
        await refresh()
      } else {
        step = "Fetching the account scope"
        let scope = try await transport.getScope()
        step = "Creating the local trial profile"
        try Task.checkCancellation()
        let local = try SyncStore(file: file, scope: scope)
        try await local.commit([])
        try Task.checkCancellation()
        identity = session
        remote = transport
        store = local
        connected = true
        email = session.email
        await refresh()
      }
    }
    func synchronize() async throws {
      guard let remote, let store else { return }
      step = "Checking the account scope"
      _ = try await remote.getScope()
      step = "Syncing the sample"
      try await store.sync(using: remote)
      try Task.checkCancellation()
      await refresh()
      status = "Up to date. Open Sync trial on your other device and restore the same account."
    }
    func saveSample(title: String) async throws {
      step = "Saving the sample"
      guard let store else { return }
      struct Metadata: Encodable {
        let url: String
        let title: String
        let subtitle: String
      }
      let url = "https://example.com/arctic-sync-trial"
      let key =
        "article/" + SHA256.hash(data: Data(url.utf8)).map { String(format: "%02x", $0) }.joined()
      let value = try JSONEncoder().encode(
        Metadata(url: url, title: title, subtitle: "Disposable sync sample"))
      try await store.commit([.init(key: key, value: String(decoding: value, as: UTF8.self))])
      await refresh()
      status = "Saved on this device. Tap Sync now to upload."
    }
    private func refresh() async {
      guard let store else { return }
      let url = "https://example.com/arctic-sync-trial"
      let key =
        "article/" + SHA256.hash(data: Data(url.utf8)).map { String(format: "%02x", $0) }.joined()
      let row = await store.snapshot()[key]
      struct Metadata: Decodable { let title: String }
      sample = row.flatMap {
        $0.isDeleted
          ? nil : try? JSONDecoder().decode(Metadata.self, from: Data($0.value.utf8)).title
      }
      pending = await store.pendingCount
    }
    func signOut() async throws {
      step = "Signing out"
      guard let remote, let identity else { return }
      // Server failure still permits local sign-out, but must not imply revocation.
      var revoked = true
      do { try await remote.signOut() } catch { revoked = false }
      await remote.cancel()
      try SessionKeychain.clear(server: identity.server)
      self.remote = nil
      self.store = nil
      self.identity = nil
      connected = false
      email = ""
      sample = nil
      pending = 0
      status =
        revoked
        ? "Signed out. Local trial data is kept."
        : "Signed out on this device. Server revocation failed; revoke the session from account settings when online."
    }
    func cancel() {
      operation?.cancel()
      login?.cancel()
      if let remote { Task { await remote.cancel() } }
    }
  }

  #if os(iOS)
    private struct TrialWindowAnchor: UIViewRepresentable {
      var update: (ASPresentationAnchor) -> Void
      func makeUIView(context: Context) -> UIView { UIView() }
      func updateUIView(_ view: UIView, context: Context) {
        DispatchQueue.main.async { if let window = view.window { update(window) } }
      }
    }
  #elseif os(macOS)
    private struct TrialWindowAnchor: NSViewRepresentable {
      var update: (ASPresentationAnchor) -> Void
      func makeNSView(context: Context) -> NSView { NSView() }
      func updateNSView(_ view: NSView, context: Context) {
        DispatchQueue.main.async { if let window = view.window { update(window) } }
      }
    }
  #endif
#endif
