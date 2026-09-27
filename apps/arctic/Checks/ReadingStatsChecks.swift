// swiftc Sources/ReadingSessions.swift Sources/ReadingStats.swift Checks/ReadingStatsChecks.swift -o /tmp/arctic-stats-check
import Foundation

@main struct ReadingStatsChecks {
  static func main() {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
    let now = calendar.date(from: DateComponents(year: 2026, month: 3, day: 10, hour: 12))!
    let a = URL(string: "https://example.com/a")!
    let b = URL(string: "https://example.com/b")!
    func visit(_ day: Int, _ seconds: Double, _ url: URL = a) -> ArticleReadingSession {
      let date = calendar.date(byAdding: .day, value: day, to: now)!
      return ArticleReadingSession(
        id: UUID(), articleURL: url, startedAt: date,
        updatedAt: date.addingTimeInterval(seconds), seconds: seconds)
    }
    let sessions = [
      visit(-7, 600), visit(-6, 60), visit(-2, 120, b), visit(0, 30),
      visit(0, 15), visit(0, 0), visit(1, 800), visit(0, .nan), visit(0, -30),
    ]
    let stats = ReadingStats(sessions: sessions, now: now, calendar: calendar)
    precondition(stats.days.count == 7 && Set(stats.days.map(\.date)).count == 7)
    precondition(stats.weekSeconds == 225 && stats.totalSeconds == 825)
    precondition(stats.todaySeconds == 45 && stats.visits == 4 && stats.articles == 2)
    precondition(stats.activeDays == 3)
    precondition(calendar.component(.day, from: stats.days.first!.date) == 4)
    // Guard our calendar aggregation across DST. UI tests cover displayed labels.
    precondition(stats.days[5].date.timeIntervalSince(stats.days[4].date) == 23 * 3600)
    let article = ReadingStats(sessions: sessions, now: now, calendar: calendar, articleURL: b)
    precondition(article.weekSeconds == 120 && article.totalSeconds == 120 && article.visits == 1)
    // Aggregate short visits within the seven-day window before applying the
    // inclusive one-minute threshold. Older reading must not qualify an article.
    let c = URL(string: "https://example.com/c")!
    let threshold = ReadingStats(
      sessions: [visit(-7, 600, a), visit(0, 59, a),
        visit(-1, 25, b), visit(0, 35, b), visit(0, 61, c)],
      now: now, calendar: calendar)
    precondition(threshold.articles == 2)
    precondition(threshold.weekSeconds == 180 && threshold.totalSeconds == 780)
    precondition(threshold.visits == 4 && threshold.todaySeconds == 155)
    let empty = ReadingStats(sessions: [], now: now, calendar: calendar)
    precondition(empty.weekSeconds == 0 && empty.articles == 0 && empty.days.count == 7)
    print(
      "Reading stats: calendar boundaries, DST, zero/invalid/future visits, URL scope, one-minute article count and totals passed"
    )
  }
}
