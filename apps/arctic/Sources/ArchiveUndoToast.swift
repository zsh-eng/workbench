import SwiftUI

/// Telegram's Undo overlay informs this transient, stationary feedback surface.
/// The action is already durable; timeout dismisses feedback, not the mutation.
struct ArchiveUndoToast: View {
  let store: ArticleStore
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    Group {
      if let receipt = store.archiveUndo {
        HStack(spacing: 12) {
          if voiceOver {
            Image(systemName: receipt.archived ? "archivebox.fill" : "tray.fill")
              .font(.title3).accessibilityHidden(true)
          } else {
            // The timer restarts on return to the app; so does its ring.
            UndoCountdown(seconds: 6, reduceMotion: reduceMotion)
              .id("\(receipt.id)-\(scenePhase)")
          }
          Text(receipt.message).font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
          Button("Undo") { store.undoArchive(receipt.id) }
            .font(.subheadline.weight(.semibold)).frame(minHeight: 44)
            .accessibilityIdentifier("archive-undo")
          if voiceOver {
            Button("Dismiss") { store.archiveUndo = nil }.frame(minHeight: 44)
          }
        }
        .padding(.horizontal, 16).padding(.vertical, 5)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay {
          RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.primary.opacity(0.08))
        }
        .shadow(color: .black.opacity(0.1), radius: 16, y: 6)
        .frame(maxWidth: 480)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("archive-toast")
        .accessibilityAction(.escape) { store.archiveUndo = nil }
        .transition(
          reduceMotion
            ? .opacity
            : .asymmetric(
              insertion: .offset(y: 20).combined(with: .scale(scale: 0.94, anchor: .bottom))
                .combined(with: .opacity),
              removal: .offset(y: 10).combined(with: .opacity))
        )
        .id(receipt.id)
        .onAppear {
          UIAccessibility.post(
            notification: .announcement, argument: receipt.message + ". Undo available.")
        }
      }
    }
    .animation(
      reduceMotion ? .easeOut(duration: 0.1) : .spring(response: 0.4, dampingFraction: 0.82),
      value: store.archiveUndo?.id
    )
    .sensoryFeedback(.impact(weight: .light), trigger: store.archiveUndo?.id) { _, new in
      new != nil
    }
    .task(id: timerIdentity) {
      guard let receipt = store.archiveUndo, !voiceOver, scenePhase == .active else { return }
      do { try await Task.sleep(for: .seconds(6)) } catch { return }
      guard store.archiveUndo?.id == receipt.id else { return }
      store.archiveUndo = nil
    }
  }

  // Backgrounding or enabling VoiceOver cancels the timer. Returning gets the
  // full interval; assistive-technology users dismiss or undo at their own pace.
  private var timerIdentity: String {
    "\(store.archiveUndo?.id.uuidString ?? "")-\(voiceOver)-\(scenePhase)"
  }
}

/// The remaining Undo time: one linear animation drains the ring, and the
/// digit updates once per second. Nothing here writes view state per frame.
private struct UndoCountdown: View {
  let seconds: Int
  let reduceMotion: Bool
  @State private var start = Date()
  @State private var drained = false

  var body: some View {
    ZStack {
      Circle().stroke(.primary.opacity(0.12), lineWidth: 2)
      Circle().trim(from: 0, to: drained ? 0 : 1)
        .stroke(.primary, style: StrokeStyle(lineWidth: 2, lineCap: .round))
        .rotationEffect(.degrees(-90))
      TimelineView(.periodic(from: start, by: 1)) { context in
        let left = max(1, seconds - Int(context.date.timeIntervalSince(start)))
        Text("\(left)").font(.system(size: 12, weight: .semibold, design: .rounded))
          .monospacedDigit()
          .contentTransition(.numericText(countsDown: true))
          .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: left)
      }
    }
    .frame(width: 24, height: 24)
    .onAppear {
      start = Date()
      withAnimation(.linear(duration: Double(seconds))) { drained = true }
    }
    .accessibilityHidden(true)
  }
}
