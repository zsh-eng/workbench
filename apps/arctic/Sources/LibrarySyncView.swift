import AuthenticationServices
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// Sign in, choose whether to add this device's articles, and see sync status.
/// It uses plain words: no servers, cursors or records.
struct LibrarySyncView: View {
  let sync: LibrarySync
  @Environment(\.dismiss) private var dismiss
  @State private var anchor: ASPresentationAnchor?
  @State private var confirmingSignOut = false

  private var device: String {
    #if canImport(UIKit)
      UIDevice.current.model
    #else
      "Mac"
    #endif
  }

  var body: some View {
    NavigationStack {
      Form { content }
        .formStyle(.grouped)
        .navigationTitle("Sync")
        #if os(iOS)
          .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }.accessibilityIdentifier("sync-done")
          }
        }
        .animation(.snappy(duration: 0.3), value: sync.status)
        .background(
          SyncWindowAnchor { if anchor !== $0 { anchor = $0 } }.frame(width: 0, height: 0)
        )
        .confirmationDialog(
          "Sign out of sync?", isPresented: $confirmingSignOut, titleVisibility: .visible
        ) {
          Button("Sign out", role: .destructive) { Task { await sync.signOut() } }
            .accessibilityIdentifier("sync-confirm-sign-out")
        } message: {
          Text("This \(device) shows its own library again. Your account keeps its articles.")
        }
    }
    #if os(macOS)
      .frame(width: 460, height: 460)
    #endif
    .onDisappear {
      // Closing the sheet while choosing leaves this device's library as it was.
      if !sync.joined { sync.cancelSignIn() }
    }
  }

  @ViewBuilder private var content: some View {
    if sync.joined {
      signedIn
    } else if case .choosing(let missing) = sync.status {
      choosing(missing)
    } else if sync.status == .adding {
      Section {
        HStack(spacing: 12) {
          ProgressView()
          Text("Adding your articles…")
        }
      }
    } else {
      signedOut
    }
  }

  private var signedOut: some View {
    Group {
      Section {
        VStack(alignment: .leading, spacing: 8) {
          Image(systemName: "laptopcomputer.and.iphone")
            .font(.title2).foregroundStyle(.tint)
            .accessibilityHidden(true)
          Text("Your library on every device")
            .font(.title3.weight(.semibold))
          Text("Saved, archived, favourites, read and tags stay the same on iPhone and Mac.")
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 6)
        Button {
          guard let anchor else { return }
          Task { await sync.signIn(anchor: anchor) }
        } label: {
          HStack {
            Text("Continue with Google").fontWeight(.medium)
            if sync.status == .signingIn {
              Spacer()
              ProgressView()
            }
          }
        }
        .disabled(anchor == nil || sync.status == .signingIn)
        .accessibilityIdentifier("sync-sign-in")
      } footer: {
        Text(
          "Highlights, notes and reading time sync with your library. Reader copies and images stay on each device. Your Jev key, cookies and passwords never sync."
        )
      }
      if case .failed(let message) = sync.status {
        Section {
          Text(message).accessibilityIdentifier("sync-message")
        }
      }
    }
  }

  private func choosing(_ missing: Int) -> some View {
    let articles = missing == 1 ? "1 article" : "\(missing) articles"
    return Section {
      VStack(alignment: .leading, spacing: 6) {
        Text("Add \(articles) from this \(device)?")
          .font(.headline)
        Text(
          "They join the articles already in \(sync.account?.email ?? "your account"), and stay on this \(device) too."
        )
        .foregroundStyle(.secondary)
      }
      .padding(.vertical, 4)
      Button("Add \(articles)") { Task { await sync.finishSignIn(adding: true) } }
        .fontWeight(.semibold)
        .accessibilityIdentifier("sync-add-articles")
      Button("Not now") { Task { await sync.finishSignIn(adding: false) } }
        .accessibilityIdentifier("sync-skip-articles")
    } footer: {
      Text(
        "With Not now, your account shows only its own articles. This \(device)'s articles return when you sign out."
      )
    }
  }

  private var signedIn: some View {
    Group {
      Section {
        LabeledContent("Account", value: sync.account?.email ?? "")
        TimelineView(.periodic(from: .now, by: 30)) { context in
          SyncStatusLine(sync: sync, device: device, now: context.date)
        }
        if sync.status == .needsSignIn {
          Button("Sign in again") {
            guard let anchor else { return }
            Task { await sync.signIn(anchor: anchor) }
          }
          .disabled(anchor == nil)
          .accessibilityIdentifier("sync-sign-in")
        } else {
          Button("Sync now") { sync.syncNow() }
            .disabled(sync.status == .syncing)
            .accessibilityIdentifier("sync-now")
        }
      } footer: {
        Text("Arctic syncs when it opens and a few seconds after you change something.")
      }
      Section {
        Button("Sign out", role: .destructive) { confirmingSignOut = true }
          .accessibilityIdentifier("sync-sign-out")
      }
    }
  }
}

private struct SyncStatusLine: View {
  let sync: LibrarySync
  let device: String
  let now: Date

  var body: some View {
    HStack(spacing: 10) {
      if sync.status == .syncing {
        ProgressView().controlSize(.small)
      } else {
        Image(systemName: symbol).foregroundStyle(tint).accessibilityHidden(true)
      }
      Text(text)
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("sync-status")
  }

  private var waiting: String? {
    guard sync.pendingCount > 0 else { return nil }
    return sync.pendingCount == 1 ? "1 change waiting" : "\(sync.pendingCount) changes waiting"
  }

  private var text: String {
    switch sync.status {
    case .syncing: return "Syncing…"
    case .offline: return "Offline · " + (waiting ?? "changes stay on this \(device)")
    case .needsSignIn: return "Sign in again to keep syncing"
    case .failed(let message): return message
    default:
      guard let date = sync.lastSynced else { return "Up to date" }
      let when =
        now.timeIntervalSince(date) < 60
        ? "just now" : date.formatted(.relative(presentation: .named, unitsStyle: .wide))
      return "Up to date · " + when
    }
  }

  private var symbol: String {
    switch sync.status {
    case .offline: "wifi.slash"
    case .needsSignIn, .failed: "exclamationmark.circle"
    default: "checkmark.circle"
    }
  }

  private var tint: Color {
    switch sync.status {
    case .needsSignIn, .failed: .orange
    case .offline: .secondary
    default: .green
    }
  }
}

#if os(iOS)
  private struct SyncWindowAnchor: UIViewRepresentable {
    var update: (ASPresentationAnchor) -> Void
    func makeUIView(context: Context) -> UIView { UIView() }
    func updateUIView(_ view: UIView, context: Context) {
      DispatchQueue.main.async { if let window = view.window { update(window) } }
    }
  }
#elseif os(macOS)
  private struct SyncWindowAnchor: NSViewRepresentable {
    var update: (ASPresentationAnchor) -> Void
    func makeNSView(context: Context) -> NSView { NSView() }
    func updateNSView(_ view: NSView, context: Context) {
      DispatchQueue.main.async { if let window = view.window { update(window) } }
    }
  }
#endif
