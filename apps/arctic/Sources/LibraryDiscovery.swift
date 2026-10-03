import SwiftUI

/// Bundled publisher marks render immediately and make no favicon requests at launch.
struct ArcticPublisher: Identifiable {
  let name: String
  let asset: String
  let address: String
  var id: String { address }
  var url: URL { URL(string: address)! }
  static let all = [
    ArcticPublisher(
      name: "NY Times", asset: "PublisherNYTimes", address: "https://www.nytimes.com/"),
    ArcticPublisher(name: "Financial Times", asset: "PublisherFT", address: "https://www.ft.com/"),
    ArcticPublisher(
      name: "Economist", asset: "PublisherEconomist", address: "https://www.economist.com/"),
    ArcticPublisher(
      name: "New Yorker", asset: "PublisherNewYorker", address: "https://www.newyorker.com/"),
    ArcticPublisher(
      name: "The Atlantic", asset: "PublisherAtlantic", address: "https://www.theatlantic.com/"),
  ]
}

struct LibraryDiscovery: View {
  let motion: DiscoveryMotion
  let open: (URL) -> Void
  let weekly: () -> Void

  var body: some View {
    NativeDiscoveryShelf(motion: motion, open: open, weekly: weekly)
      .frame(height: 98)
  }
}

/// Week starts Monday in the user's current time zone. Undated legacy favourites
/// stay in All: do not invent a date when adding the new optional timestamp.
enum WeeklyFavourites {
  static func articles(_ articles: [SavedArticle], now: Date = .now, calendar: Calendar = .current)
    -> [SavedArticle]
  {
    var calendar = calendar
    calendar.firstWeekday = 2
    calendar.minimumDaysInFirstWeek = 4
    guard let week = calendar.dateInterval(of: .weekOfYear, for: now) else { return [] }
    return articles.filter {
      guard $0.saved, $0.favourite, let date = $0.favouritedAt else { return false }
      return date >= week.start && date < week.end
    }.sorted { ($0.favouritedAt ?? .distantPast) > ($1.favouritedAt ?? .distantPast) }
  }
}

struct WeeklyFavouritesSheet: View {
  let store: ArticleStore
  let open: (URL) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var all = false

  var body: some View {
    let week = WeeklyFavourites.articles(store.articles)
    let articles = all ? store.articles.filter { $0.saved && $0.favourite } : week
    NavigationStack {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "star.fill").font(.system(size: 32)).foregroundStyle(
              ArcticBrand.accent)
            ZStack(alignment: .topLeading) {
              Text("The week's\ngood finds.").opacity(all ? 0 : 1).accessibilityHidden(all)
              Text("Worth keeping.").opacity(all ? 1 : 0).accessibilityHidden(!all)
            }
            .font(.system(size: 38, weight: .regular, design: .serif)).tracking(-1)
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(
              all
                ? "All your favourites, including archived articles."
                : "\(week.count) \(week.count == 1 ? "favourite" : "favourites") · Monday to Sunday"
            )
            .font(.subheadline).foregroundStyle(.secondary).lineLimit(2, reservesSpace: true)
          }.padding(.top, 20).padding(.bottom, 6)
          Picker("Collection", selection: $all) {
            Text("This week").tag(false)
            Text("All favourites").tag(true)
          }.pickerStyle(.segmented).accessibilityIdentifier("weekly-collection")
          if articles.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text("Something will stay with you.").font(.system(.title3, design: .serif))
              Text("Favourite an article to keep it here.").font(.subheadline).foregroundStyle(
                .secondary)
            }.padding(.vertical, 32)
          }
          ForEach(articles) { article in
            Button {
              dismiss()
              open(article.url)
            } label: {
              VStack(alignment: .leading, spacing: 10) {
                if let image = article.imageURL {
                  ArticleThumbnail(url: image, pixels: 960).frame(height: 190)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                }
                Text(article.title).font(.system(size: 23, weight: .medium, design: .serif))
                  .lineLimit(3)
                  .frame(maxWidth: .infinity, alignment: .leading)
                Text(article.url.host ?? "").font(.caption).foregroundStyle(.secondary)
              }
            }.buttonStyle(ArcticPressStyle()).accessibilityIdentifier(
              "weekly-article-" + article.id.uuidString)
          }
        }.padding(.horizontal, 24).padding(.bottom, 32)
      }.background(ReaderTheme.background)
        .navigationTitle("Favourites").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }.tint(ArcticBrand.accent).presentationDragIndicator(.visible)
  }
}
