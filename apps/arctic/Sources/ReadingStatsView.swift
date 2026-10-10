import SwiftUI

/// A snapshot keeps session accounting out of the render loop. Only this small
/// seven-day chart changes on selection; no article images or WebViews are loaded.
struct ReadingStatsView: View {
  var articleURL: URL?
  var articleTitle: String?
  @Environment(\.dismiss) private var dismiss
  @Environment(\.articleReduceMotion) private var reduceMotion
  @State private var stats: ReadingStats?
  @State private var selectedDay: Date?
  @State private var error: String?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if let articleTitle, !articleTitle.isEmpty {
            Text(articleTitle).font(.subheadline).foregroundStyle(ReaderTheme.muted).lineLimit(2)
          }
          if let stats {
            summary(stats)
            ViewThatFits(in: .horizontal) {
              HStack(spacing: 10) { metrics(stats) }
              VStack(spacing: 10) { metrics(stats) }
            }
            HStack {
              Label("All time", systemImage: "clock")
              Spacer()
              Text(ReadingStats.duration(stats.totalSeconds)).fontWeight(.semibold)
            }
            .font(.subheadline).padding(20)
            .background(ReaderTheme.secondary, in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("stats-all-time")
            if stats.totalSeconds == 0 {
              Text("Make time for a good read.")
                .font(.system(.title3, design: .serif)).frame(maxWidth: .infinity)
                .padding(.vertical, 8).accessibilityIdentifier("stats-empty")
            }
            DisclosureGroup("Estimated reading time") {
              Text(
                "Articles in Reader or Website, saved or not. Publisher front pages are not counted. Idle gaps over 2 minutes are excluded. Visits appear on the day they started. Articles count after 1 minute of reading across the last 7 days."
              )
              .font(.footnote).foregroundStyle(ReaderTheme.muted).padding(.top, 6)
            }.font(.footnote).foregroundStyle(ReaderTheme.muted).padding(.horizontal, 6)
          } else {
            Text("Loading reading time…").foregroundStyle(ReaderTheme.muted)
              .frame(maxWidth: .infinity, minHeight: 240)
          }
          if let error {
            Text(error).font(.footnote).foregroundStyle(ReaderTheme.muted)
            if ReadingSessions.shared.hasUnpersistedChanges {
              Button("Retry saving") {
                ReadingSessions.shared.flush(force: true)
                dismiss()
              }
            }
          }
        }.padding(20)
      }
      .background(ReaderTheme.background)
      .navigationTitle(articleURL == nil ? "Reading stats" : "Reading time")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button("Done") { dismiss() }.accessibilityIdentifier("stats-done")
        }
      }
    }
    .foregroundStyle(ReaderTheme.foreground).tint(ArcticBrand.accent)
    .presentationDetents([.large]).presentationDragIndicator(.visible)
    .task {
      while !ReadingSessions.shared.isLoaded {
        do { try await Task.sleep(for: .milliseconds(50)) } catch { return }
      }
      guard !Task.isCancelled else { return }
      var records = ReadingSessions.shared.snapshot()
      #if DEBUG
        if TestMode.enabled && ProcessInfo.processInfo.arguments.contains("-seed-reading-stats") {
          records = Self.fixture()
        }
      #endif
      let url = articleURL
      let snapshotRecords = records
      let summary = await Task.detached(priority: .userInitiated) {
        ReadingStats(sessions: snapshotRecords, articleURL: url)
      }.value
      guard !Task.isCancelled else { return }
      stats = summary
      selectedDay = summary.days.last?.date
      error = ReadingSessions.shared.lastError
    }
  }

  private func summary(_ stats: ReadingStats) -> some View {
    VStack(alignment: .leading, spacing: 20) {
      HStack {
        Text("Last 7 days").font(.subheadline.weight(.medium))
        Spacer()
        ArcticMark().frame(width: 26, height: 26)
      }
      Text(ReadingStats.duration(stats.weekSeconds))
        .font(.system(.largeTitle, design: .rounded, weight: .bold))
        .minimumScaleFactor(0.7).lineLimit(1)
        .accessibilityIdentifier("stats-week-total")
      HStack(alignment: .bottom, spacing: 6) {
        ForEach(stats.days) { day in
          dayBubble(day, maximum: stats.days.map(\.seconds).max() ?? 0)
        }
      }
      let day = stats.days.first { $0.date == selectedDay } ?? stats.days.last!
      HStack(spacing: 6) {
        Text(day.date, format: .dateTime.weekday(.wide))
        Text("·")
        Text(ReadingStats.duration(day.seconds)).fontWeight(.semibold)
      }
      .font(.subheadline).frame(maxWidth: .infinity)
      .accessibilityElement(children: .combine).accessibilityIdentifier("stats-selected-day")
    }
    .padding(24).background(
      ArcticBrand.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 36))
  }

  private func dayBubble(_ day: ReadingStats.Day, maximum: TimeInterval) -> some View {
    let selected = selectedDay == day.date
    let height = maximum > 0 && day.seconds > 0 ? 24 + 72 * day.seconds / maximum : 8
    return Button {
      withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { selectedDay = day.date }
    } label: {
      VStack(spacing: 12) {
        Capsule()
          .fill(ArcticBrand.accent.opacity(day.seconds > 0 ? (selected ? 1 : 0.42) : 0.14))
          .frame(maxWidth: 32).frame(height: height)
          .padding(4)
          .overlay(Capsule().strokeBorder(selected ? ArcticBrand.accent : .clear, lineWidth: 1.5))
          .frame(height: 108, alignment: .bottom)
        Text(day.date, format: .dateTime.weekday(.narrow))
          .font(.caption.weight(selected ? .bold : .medium))
      }.frame(maxWidth: .infinity).contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(day.date.formatted(date: .complete, time: .omitted))
    .accessibilityValue(ReadingStats.duration(day.seconds))
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier("stats-day-\(Calendar.current.component(.weekday, from: day.date))")
  }

  @ViewBuilder private func metrics(_ stats: ReadingStats) -> some View {
    metric(ReadingStats.duration(stats.todaySeconds), label: "Today", icon: "sun.max")
    metric(
      "\(articleURL == nil ? stats.articles : stats.activeDays)",
      label: articleURL == nil ? "Articles" : "Days", icon: "book.closed")
    metric("\(stats.visits)", label: "Visits", icon: "bookmark")
  }

  private func metric(_ value: String, label: String, icon: String) -> some View {
    VStack(spacing: 8) {
      Image(systemName: icon).font(.subheadline).foregroundStyle(ArcticBrand.accent)
      Text(value).font(.system(.title3, design: .rounded, weight: .semibold)).fixedSize()
      Text(label).font(.caption).foregroundStyle(ReaderTheme.muted)
    }.frame(maxWidth: .infinity).padding(.horizontal, 12).padding(.vertical, 22)
      .background(ReaderTheme.secondary, in: RoundedRectangle(cornerRadius: 32))
      .accessibilityElement(children: .combine)
  }

  #if DEBUG
    private static func fixture() -> [ArticleReadingSession] {
      let calendar = Calendar.current
      let now = Date()
      return [420.0, 1080, 0, 720, 1500, 240, 900].enumerated().map { index, seconds in
        let date = calendar.date(byAdding: .day, value: index - 6, to: now)!
        return ArticleReadingSession(
          id: UUID(),
          articleURL: URL(string: "https://fixture.example/stats-\(index % 3)")!,
          startedAt: date, updatedAt: date, seconds: seconds)
      }
    }
  #endif
}
