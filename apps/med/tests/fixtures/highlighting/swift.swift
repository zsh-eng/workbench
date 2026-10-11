import SwiftUI

/// Shows the number of unread items.
@MainActor
final class UnreadModel: ObservableObject {
    @Published private(set) var count = 0 // updated by sync

    func refresh(from store: Store) async throws -> Int {
        let items = try await store.items(where: { $0.isUnread })
        count = items.count
        return count
    }
}

struct Badge<Label: View>: View {
    var label: Label
    var body: some View {
        label.overlay(alignment: .topTrailing) {
            Text("\(count, format: .number) new")
        }
    }
}
