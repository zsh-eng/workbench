import Foundation

/// Writes library edits to the active profile's SQLite journal, in order and off
/// the main actor. The screen changes at once; an edit waits here until it
/// commits. A change from another device is shown with these edits on top, so
/// nothing the user just did flickers back.
@MainActor final class LibraryJournal {
  let repository: ArticleSyncRepository
  private(set) var pending: [ArticlePatch] = []
  private var writing: Task<Void, Never>?
  private var retryDelay: Duration = .seconds(1)
  private var failing = false
  /// After each committed batch. Sync uses it to upload soon.
  var committed: (() -> Void)?
  /// Once for each run of failures. A failed batch retries with backoff.
  var failed: ((Error) -> Void)?

  init(repository: ArticleSyncRepository) { self.repository = repository }

  var hasPending: Bool { !pending.isEmpty }

  func enqueue(_ patches: [ArticlePatch]) {
    guard !patches.isEmpty else { return }
    pending += patches
    drain()
  }

  private func drain() {
    guard writing == nil, !pending.isEmpty else { return }
    let batch = pending
    let repository = repository
    writing = Task { [weak self] in
      do {
        try await repository.apply(batch)
        guard let self else { return }
        self.pending.removeFirst(batch.count)
        self.writing = nil
        self.retryDelay = .seconds(1)
        self.failing = false
        self.committed?()
        self.drain()
      } catch {
        guard let self else { return }
        if !self.failing {
          self.failing = true
          self.failed?(error)
        }
        let delay = self.retryDelay
        self.retryDelay = min(delay * 2, .seconds(60))
        try? await Task.sleep(for: delay)
        self.writing = nil
        self.drain()
      }
    }
  }

  /// Waits until every edit made so far has committed, or a write has failed.
  func flush() async {
    while let writing {
      await writing.value
      if failing { return }
    }
  }

  /// Termination cannot wait for the main actor. Commit what is still waiting
  /// from a worker thread, for at most two seconds. A repeated edit is harmless:
  /// each one sets its changed fields to the same values.
  func commitBeforeExit() {
    guard !pending.isEmpty else { return }
    let batch = pending
    let repository = repository
    let done = DispatchSemaphore(value: 0)
    Task.detached {
      try? await repository.apply(batch)
      done.signal()
    }
    _ = done.wait(timeout: .now() + 2)
  }
}
