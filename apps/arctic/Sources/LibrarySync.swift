import ArcticSync
import AuthenticationServices
import Foundation
import Observation

/// The signed-in account whose library is on screen. Not a secret: the session
/// credential stays in Keychain.
struct LibraryAccount: Codable, Equatable {
  let scope: SyncScope
  let email: String

  private static var key: String { TestMode.enabled ? "test-library-account" : "library-account" }

  static var saved: LibraryAccount? {
    get {
      UserDefaults.standard.data(forKey: key).flatMap {
        try? JSONDecoder().decode(LibraryAccount.self, from: $0)
      }
    }
    set {
      if let newValue, let data = try? JSONEncoder().encode(newValue) {
        UserDefaults.standard.set(data, forKey: key)
      } else {
        UserDefaults.standard.removeObject(forKey: key)
      }
    }
  }
}

/// Keeps the library the same on every device signed in to one account. Saved,
/// archived, favourite and read state, titles and tags sync, and so do
/// highlights, notes and reading sessions (`AccountRecordJournal`); Reader
/// copies and images stay on each device. Jev keys, cookies and credentials
/// never sync.
///
/// Signing in opens the account's own profile. The device's local library is
/// added only when the user chooses to, and it shows again after sign-out.
@MainActor @Observable final class LibrarySync {
  enum Status: Equatable {
    case signedOut
    case signingIn
    /// Signed in. The local library has this many articles the account lacks.
    case choosing(missing: Int)
    case adding
    case syncing
    case upToDate
    case offline
    case needsSignIn
    case failed(String)
  }

  static let server = URL(string: "https://api.zsheng.app")!

  private(set) var status: Status
  /// The account being joined during sign-in, then the one on screen.
  private(set) var account: LibraryAccount?
  /// True while an account's library is on screen.
  private(set) var joined: Bool
  private(set) var lastSynced: Date?
  private(set) var pendingCount = 0
  @ObservationIgnored private let store: ArticleStore
  @ObservationIgnored private var remote: (any SyncRemote)?
  @ObservationIgnored private var cancelRemote: (() async -> Void)?
  @ObservationIgnored private var signOutRemote: (() async throws -> Void)?
  @ObservationIgnored private var login: NativeGoogleSignIn?
  /// The account profile opened during sign-in, before the user chooses.
  @ObservationIgnored private var joining: ArticleSyncRepository?
  /// Highlights and notes, and reading sessions.
  @ObservationIgnored private var records: AccountRecords!
  @ObservationIgnored private var running: Task<Void, Never>?
  @ObservationIgnored private var again = false
  @ObservationIgnored private var soon: Task<Void, Never>?

  init(store: ArticleStore) {
    self.store = store
    let saved = LibraryAccount.saved
    account = saved
    joined = saved != nil
    status = saved == nil ? .signedOut : .syncing
    store.journalCommitted = { [weak self] in self?.syncSoon() }
    records = AccountRecords(
      root: store.libraryRoot,
      connect: { [weak self] family in
        // The credential comes from Keychain, where the library's transport keeps it fresh.
        guard let session = try self?.savedSession() else { throw SyncFailure.unauthorized }
        return try HTTPRemote(identity: session, namespace: family.namespace)
      },
      edited: { [weak self] in self?.syncSoon() })
  }

  var isSignedIn: Bool { account != nil }

  // MARK: Sign-in

  func signIn(anchor: ASPresentationAnchor) async {
    guard status == .signedOut || status == .needsSignIn || isFailure else { return }
    status = .signingIn
    do {
      let session: ArcticSession
      #if DEBUG
        if let fixture = SyncFixture.current {
          session = fixture.session
        } else {
          session = try await signInWithGoogle(anchor: anchor)
        }
      #else
        session = try await signInWithGoogle(anchor: anchor)
      #endif
      try await connect(session)
      if let account, store.profile == .account(account.scope) {
        // Signing in again to the account already on screen.
        syncNow()
        return
      }
      let repository = try ArticleSyncRepository.load(
        root: store.libraryRoot, scope: .account(account!.scope)
      ).repository
      joining = repository
      // Learn what the account already has before asking what to add.
      try await repository.sync(using: remote!)
      _ = try await repository.takeRemoteChanges()
      await store.journal?.flush()
      let missing = try await repository.missingCount(of: store.articles)
      if missing > 0 {
        status = .choosing(missing: missing)
      } else {
        try await join(adding: false)
      }
    } catch {
      joining = nil
      if LibraryAccount.saved == nil {
        account = nil
        forgetSession()
      }
      report(error, signingIn: true)
    }
  }

  private func signInWithGoogle(anchor: ASPresentationAnchor) async throws -> ArcticSession {
    let login = NativeGoogleSignIn(anchor: anchor)
    self.login = login
    defer { self.login = nil }
    let session = try await login.signIn(server: Self.server)
    // Keep the credential before any sync; never use browser-global cookies.
    try SessionKeychain.save(session)
    return session
  }

  private func savedSession() throws -> ArcticSession? {
    #if DEBUG
      if let fixture = SyncFixture.current { return fixture.session }
    #endif
    return try SessionKeychain.load(server: Self.server)
  }

  private func connect(_ session: ArcticSession) async throws {
    #if DEBUG
      if let fixture = SyncFixture.current {
        remote = fixture.remote
        cancelRemote = nil
        signOutRemote = nil
        account = LibraryAccount(scope: fixture.scope, email: session.email)
        return
      }
    #endif
    let transport = try HTTPRemote(identity: session)
    let scope = try await transport.getScope()
    if let current = account, current.scope != scope {
      // The server reset this account's stream. Keep the old profile on disk.
      await transport.cancel()
      throw SyncFailure.scopeChanged
    }
    records.retire()
    remote = transport
    cancelRemote = { await transport.cancel() }
    signOutRemote = { try await transport.signOut() }
    account = LibraryAccount(scope: scope, email: session.email)
  }

  /// Adds this device's articles to the account, or not, and shows the account.
  func finishSignIn(adding: Bool) async {
    guard case .choosing = status else { return }
    do {
      try await join(adding: adding)
    } catch {
      report(error, signingIn: false)
    }
  }

  private func join(adding: Bool) async throws {
    guard let repository = joining, let account else { return }
    if adding {
      status = .adding
      await store.journal?.flush()
      _ = try await repository.importLocalArticles(store.articles)
    }
    try await store.show(repository)
    joining = nil
    LibraryAccount.saved = account
    joined = true
    lastSynced = nil
    syncNow()
  }

  func cancelSignIn() {
    login?.cancel()
    joining = nil
    if LibraryAccount.saved == nil {
      account = nil
      forgetSession()
      status = .signedOut
    }
  }

  // MARK: Sync

  /// Uploads soon after edits, so a burst of edits shares one request.
  func syncSoon() {
    guard LibraryAccount.saved != nil else { return }
    soon?.cancel()
    soon = Task { [weak self] in
      do { try await Task.sleep(for: .seconds(3)) } catch { return }
      self?.syncNow()
    }
  }

  func syncNow() {
    guard LibraryAccount.saved != nil else { return }
    if running != nil {
      again = true
      return
    }
    running = Task { [weak self] in
      repeat {
        self?.again = false
        await self?.run()
      } while self?.again == true
      self?.running = nil
    }
  }

  private func run() async {
    guard let account, let journal = store.journal,
      journal.repository.scope == .account(account.scope)
    else { return }
    let repository = journal.repository
    if remote == nil {
      do {
        guard let session = try savedSession() else {
          status = .needsSignIn
          return
        }
        try await connect(session)
      } catch {
        report(error, signingIn: false)
        return
      }
    }
    guard let remote else { return }
    status = .syncing
    await journal.flush()
    do {
      try await repository.sync(using: remote)
      guard LibraryAccount.saved == account else { return }
      try await syncRecords()
      guard LibraryAccount.saved == account else { return }
      lastSynced = Date()
      status = .upToDate
    } catch {
      guard LibraryAccount.saved == account else { return }
      report(error, signingIn: false)
    }
    // A sync that stops part way still shows the pages it committed.
    if let changes = try? await repository.takeRemoteChanges() {
      store.applyRemoteChanges(changes, from: repository)
    }
    pendingCount = await repository.pendingCount
  }

  /// Highlights and notes, then reading sessions, after the library.
  private func syncRecords() async throws {
    #if DEBUG
      // The test account holds a library only.
      if SyncFixture.current != nil { return }
    #endif
    try await records.sync()
  }

  // MARK: Sign-out

  /// The account's articles stay in the account and in its profile on this
  /// device. This device shows its own library again.
  func signOut() async {
    soon?.cancel()
    running?.cancel()
    login?.cancel()
    await store.journal?.flush()
    // A failed revocation still signs out here; the session expires on the server.
    if let signOutRemote {
      try? await signOutRemote()
    } else if let session = try? SessionKeychain.load(server: Self.server),
      let transport = try? HTTPRemote(identity: session)
    {
      try? await transport.signOut()
      await transport.cancel()
    }
    do {
      let local = try ArticleSyncRepository.load(root: store.libraryRoot, scope: .local)
      try await store.show(local.repository)
    } catch {
      status = .failed("Could not open this device's library. Restart Arctic.")
      return
    }
    LibraryAccount.saved = nil
    joined = false
    account = nil
    forgetSession()
    lastSynced = nil
    pendingCount = 0
    status = .signedOut
  }

  private func forgetSession() {
    let cancel = cancelRemote
    records.retire()
    remote = nil
    cancelRemote = nil
    signOutRemote = nil
    Task {
      await cancel?()
      try? SessionKeychain.clear(server: Self.server)
    }
  }

  private var isFailure: Bool {
    if case .failed = status { return true }
    return false
  }

  private func report(_ error: Error, signingIn: Bool) {
    if error is CancellationError {
      status = LibraryAccount.saved == nil ? .signedOut : .upToDate
      return
    }
    switch error {
    case SyncFailure.unauthorized:
      remote = nil
      records.retire()
      status = .needsSignIn
    case SyncFailure.scopeChanged, SyncFailure.wrongAccount:
      status = .failed(
        "This account's sync data changed on the server. Sign out, then sign in again.")
    case NativeSignInFailure.unableToPresent:
      status = .failed("Could not open Google sign-in. Try again.")
    case is NativeSignInFailure:
      status = .failed("Google sign-in did not finish. Try again.")
    default:
      let failure = error as NSError
      if failure.domain == NSURLErrorDomain {
        status = signingIn ? .failed("No connection. Try again when you are online.") : .offline
      } else if failure.domain == ASWebAuthenticationSessionError.errorDomain {
        status = LibraryAccount.saved == nil ? .signedOut : .needsSignIn
      } else {
        // Only fixed text: error descriptions can include request or callback URLs.
        status = .failed("Sync could not finish. Your changes are saved on this device.")
      }
    }
  }
}

/// A record that syncs whole: a highlight or note, or a reading session. Each
/// is one file on this device and one record in the account, in the same
/// encoding, so Arctic for the web reads it as it is
/// (`Browser/src/annotations.ts`, `Browser/src/reading.ts`).
protocol AccountRecord: Codable, Equatable, Identifiable, Sendable where ID == UUID {
  var updatedAt: Date { get }
}
extension ReaderAnnotation: AccountRecord {}
extension ArticleReadingSession: AccountRecord {}

/// The namespaces beside the library's: `annotation/<UUID>` records in
/// `arctic-annotations`, and `session/<UUID>` records in `arctic-reading`.
enum AccountRecordFamily: String, CaseIterable, Sendable {
  case annotations = "arctic-annotations"
  case reading = "arctic-reading"
  var namespace: String { rawValue }
  var prefix: String { self == .annotations ? "annotation/" : "session/" }
}

/// One family's journal in one account: the account's rows, this device's
/// outbox and the cursor. The files stay what the app shows. On both sides the
/// newer `updatedAt` wins, as in `AnnotationStore.merge`, and a removed passage
/// is a record with `deletedAt`, so a sync cannot revive it.
actor AccountRecordJournal {
  let family: AccountRecordFamily
  private let store: SyncStore

  /// The journal sits beside the library's profiles, named by its own
  /// stream's scope: a stream reset on the server starts a new journal.
  init(root: URL, scope: SyncScope) throws {
    guard let family = AccountRecordFamily(rawValue: scope.namespace) else {
      throw ArticleSyncError.invalidScope
    }
    let identity = try scope.header
    let prefix = family.prefix
    self.family = family
    store = try SyncStore(
      database: root.appending(path: ArticleSyncCodec.hash(identity), directoryHint: .isDirectory)
        .appending(path: "journal.sqlite"),
      accountID: identity,
      validateValue: { change in
        guard change.schemaVersion == 1, change.key.hasPrefix(prefix) else {
          throw ArticleSyncError.invalidValue
        }
      })
  }

  /// Uploads this device's newer records, and returns the account's newer
  /// ones and those this device lacks. A record that does not decode is left
  /// out; the others still arrive.
  func sync<Record: AccountRecord>(_ records: [Record], using remote: any SyncRemote) async throws
    -> [Record]
  {
    var local: [String: String] = [:]
    for record in records {
      local[family.prefix + record.id.uuidString] = try ArticleSyncCodec.encode(record)
    }
    let pulled = try await store.sync(using: remote, reconciling: local) { local, remote in
      Self.newer(Record.self, local: local, remote: remote)
    }
    let decoder = JSONDecoder()
    return pulled.values.compactMap { try? decoder.decode(Record.self, from: Data($0.utf8)) }
  }

  /// The later edit wins. On a tie the account's copy does, so two devices
  /// settle on one. A record that does not decode is replaced.
  static func newer<Record: AccountRecord>(_: Record.Type, local: String, remote: String)
    -> SyncStore.Newer
  {
    let decoder = JSONDecoder()
    guard let theirs = try? decoder.decode(Record.self, from: Data(remote.utf8)) else {
      return .local
    }
    guard let ours = try? decoder.decode(Record.self, from: Data(local.utf8)) else {
      return .remote
    }
    if ours == theirs { return .neither }
    return ours.updatedAt > theirs.updatedAt ? .local : .remote
  }
}

/// What a family's stream needs from its transport.
protocol AccountRecordRemote: SyncRemote {
  func getScope() async throws -> SyncScope
  func cancel() async
}
extension HTTPRemote: AccountRecordRemote {}

/// Highlights and notes, and reading sessions, each in its own stream beside
/// the library's, with a transport and a journal bound once per sign-in. A
/// sync pulls each family, keeps the newer edit of every record, and uploads
/// this device's.
@MainActor final class AccountRecords {
  private let root: URL
  private let annotations: AnnotationStore
  private let sessions: ReadingSessions
  private let connect: (AccountRecordFamily) throws -> any AccountRecordRemote
  private var streams:
    [AccountRecordFamily: (remote: any AccountRecordRemote, journal: AccountRecordJournal)] = [:]

  /// `edited` runs after each edit on this device, so a sync can follow.
  init(
    root: URL,
    annotations: AnnotationStore = .shared,
    sessions: ReadingSessions = .shared,
    connect: @escaping (AccountRecordFamily) throws -> any AccountRecordRemote,
    edited: @escaping () -> Void
  ) {
    self.root = root
    self.annotations = annotations
    self.sessions = sessions
    self.connect = connect
    annotations.edited = edited
    sessions.paused = edited
  }

  func sync() async throws {
    for family in AccountRecordFamily.allCases {
      switch family {
      case .annotations:
        let (remote, journal) = try await stream(family)
        try annotations.merge(try await journal.sync(annotations.records, using: remote))
      case .reading:
        // Before its files load, this device would seem to have no sessions.
        guard sessions.isLoaded else { continue }
        let (remote, journal) = try await stream(family)
        sessions.merge(try await journal.sync(sessions.syncable, using: remote))
      }
    }
  }

  /// Stops each transport, as the session it holds ends or changes.
  func retire() {
    let remotes = streams.values.map(\.remote)
    streams = [:]
    Task {
      for remote in remotes { await remote.cancel() }
    }
  }

  private func stream(_ family: AccountRecordFamily) async throws
    -> (remote: any AccountRecordRemote, journal: AccountRecordJournal)
  {
    if let stream = streams[family] { return stream }
    let remote = try connect(family)
    do {
      let journal = try AccountRecordJournal(root: root, scope: try await remote.getScope())
      streams[family] = (remote, journal)
      return (remote, journal)
    } catch {
      await remote.cancel()
      throw error
    }
  }
}

#if DEBUG
  /// UI tests sign in to an in-memory account that already has one article from
  /// another device. No network, Google page or Keychain entry is used.
  struct SyncFixture {
    let session: ArcticSession
    let scope: SyncScope
    let remote: any SyncRemote

    @MainActor static let current: SyncFixture? = {
      guard TestMode.enabled, ProcessInfo.processInfo.arguments.contains("-test-sync") else {
        return nil
      }
      let scope = SyncScope(origin: "https://sync.example", userId: "fixture", epoch: "first")
      return SyncFixture(
        session: ArcticSession(
          accountID: "fixture", email: "reader@example.com", server: LibrarySync.server,
          cookie: ""),
        scope: scope, remote: FixtureRemote(scope: scope))
    }()
  }

  private actor FixtureRemote: SyncRemote {
    private var records: [String: SyncRecord]
    private var sequence: Int64

    init(scope: SyncScope) {
      var records: [String: SyncRecord] = [:]
      var sequence: Int64 = 0
      var article = SavedArticle(
        url: URL(string: "https://fixture.example/from-your-mac")!, title: "Read on your Mac")
      article.isSaved = true
      article.savedAt = Date()
      article.tags = ["Design & craft"]
      for (key, value) in (try? ArticleSyncCodec.values(article)) ?? [:] {
        sequence += 1
        records[key] = SyncRecord(
          change: SyncChange(
            key: key, value: value, isDeleted: false, schemaVersion: 1,
            hlc: SyncClock(wallTimeMs: 1)),
          deviceId: "mac", serverSeq: sequence)
      }
      self.records = records
      self.sequence = sequence
    }

    func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
      // A relaunched test app keeps its cursor; this account restarts in memory.
      let end = max(head ?? sequence, cursor)
      let rows = records.values.filter { $0.serverSeq > cursor && $0.serverSeq <= end }
        .sorted { $0.serverSeq < $1.serverSeq }
      return SyncPull(records: rows, cursor: end, head: end, hasMore: false)
    }

    func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
      SyncPush(
        results: changes.map { change in
          if let old = records[change.key],
            old.hlc > change.hlc || (old.hlc == change.hlc && old.deviceId >= deviceID)
          {
            return .init(accepted: false, winner: old)
          }
          sequence += 1
          let winner = SyncRecord(change: change, deviceId: deviceID, serverSeq: sequence)
          records[change.key] = winner
          return .init(accepted: true, winner: winner)
        })
    }
  }
#endif
