import SwiftUI

/// Saved is the inbox. Favourite tag filters also include archived saved articles.
enum ArticleFolder: Hashable {
  case saved, favourites, history, archive, downloaded
  case tag(String)

  var title: String {
    switch self {
    case .saved: "Saved"
    case .favourites: "Favourites"
    case .history: "History"
    case .archive: "Archive"
    case .downloaded: "Downloaded"
    case .tag(let name): name
    }
  }
  var identifier: String {
    switch self {
    case .tag(let name): "folder-tag-\(name)"
    default: "folder-\(title.lowercased())"
    }
  }
  func contains(_ article: SavedArticle, favouritesOnly: Bool = false) -> Bool {
    switch self {
    case .saved: article.saved && article.isArchived != true
    case .favourites: article.saved && article.favourite
    case .history: article.lastVisitedAt != nil
    case .archive: article.saved && article.isArchived == true
    case .downloaded: article.saved && article.downloadedAt != nil
    case .tag(let name):
      article.saved && article.tagNames.contains(name)
        && (favouritesOnly ? article.favourite : article.isArchived != true)
    }
  }
  var emptyTitle: String {
    switch self {
    case .favourites: "Worth keeping close."
    case .history: "Every read leaves a trail."
    case .archive: "A place for finished stories."
    case .downloaded: "Take a good read with you."
    case .tag: "No articles here"
    case .saved: "Your next good read."
    }
  }
  var emptyDescription: String {
    switch self {
    case .favourites: "Favourite an article to keep it here, even after archiving."
    case .history: "Links you open here appear in History, even if you do not save them."
    case .archive: "Archive saved articles to keep your inbox clear."
    case .downloaded: "Saved articles appear here once their Reader view is stored on this device."
    case .tag: "Add this tag to a saved article to find it here."
    case .saved:
      "Share to Arctic, or open a copied link."
    }
  }
}

/// The library store owns tags; Elements uses a fixture with the same shape.
@MainActor protocol ArticleTagSource: AnyObject, Observable {
  var allTags: [String] { get }
  func setTags(_ tags: [String], for id: UUID)
}

extension ArticleStore: ArticleTagSource {}

struct ArticleTagsSheet<Store: ArticleTagSource>: View {
  @Environment(\.dismiss) private var dismiss
  let article: SavedArticle
  let store: Store
  @State private var selected: Set<String>
  @State private var name = ""

  init(article: SavedArticle, store: Store) {
    self.article = article
    self.store = store
    _selected = State(initialValue: Set(article.tagNames))
  }

  private var tags: [String] { Array(Set(store.allTags).union(selected)).sorted() }
  private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    NavigationStack {
      List {
        Section {
          HStack {
            TextField("New tag", text: $name)
              .autocorrectionDisabled().submitLabel(.done).onSubmit(addTag)
              .accessibilityIdentifier("tag-name")
            Button("Add", action: addTag).disabled(trimmedName.isEmpty)
              .accessibilityIdentifier("add-tag")
          }
        }
        Section {
          ForEach(tags, id: \.self) { tag in
            Button {
              if selected.contains(tag) { selected.remove(tag) } else { selected.insert(tag) }
            } label: {
              HStack {
                Text(tag)
                Spacer()
                if selected.contains(tag) { Image(systemName: "checkmark") }
              }.foregroundStyle(ReaderTheme.foreground)
            }
            .accessibilityValue(selected.contains(tag) ? "Selected" : "Not selected")
            .accessibilityIdentifier("tag-option-\(tag)")
          }

        }
      }
      .navigationTitle("Tags").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") {
            if !trimmedName.isEmpty { addTag() }
            store.setTags(Array(selected), for: article.id)
            dismiss()
          }.accessibilityIdentifier("save-tags")
        }
      }
    }
    .tint(ReaderTheme.foreground)
    .presentationDetents([.height(min(360, 160 + Double(tags.count) * 44))])
    .presentationDragIndicator(.visible)
  }

  private func addTag() {
    guard !trimmedName.isEmpty else { return }
    let existing = tags.first { $0.localizedCaseInsensitiveCompare(trimmedName) == .orderedSame }
    selected.insert(existing ?? trimmedName)
    name = ""
  }
}
