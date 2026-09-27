import Foundation

/// Immutable, on-demand totals. Visits belong to their start day in the user's
/// calendar: existing records store active duration, not individual intervals.
struct ReadingStats: Sendable {
  struct Day: Identifiable, Sendable {
    var date: Date
    var seconds: TimeInterval = 0
    var id: Date { date }
  }

  var days: [Day]
  var weekSeconds: TimeInterval = 0
  var totalSeconds: TimeInterval = 0
  var articles: Int = 0
  var visits: Int = 0
  var activeDays: Int { days.filter { $0.seconds > 0 }.count }
  var todaySeconds: TimeInterval { days.last?.seconds ?? 0 }

  init(
    sessions: [ArticleReadingSession], now: Date = Date(), calendar: Calendar = .current,
    articleURL: URL? = nil
  ) {
    let today = calendar.startOfDay(for: now)
    days = (0..<7).map { Day(date: calendar.date(byAdding: .day, value: $0 - 6, to: today)!) }
    let indices = Dictionary(
      uniqueKeysWithValues: days.enumerated().map { ($0.element.date, $0.offset) })
    var secondsByArticle: [URL: TimeInterval] = [:]
    for session in sessions {
      guard session.seconds.isFinite, session.seconds > 0, session.startedAt <= now,
        articleURL == nil || session.articleURL == articleURL
      else { continue }
      totalSeconds += session.seconds
      guard let index = indices[calendar.startOfDay(for: session.startedAt)] else { continue }
      days[index].seconds += session.seconds
      weekSeconds += session.seconds
      visits += 1
      secondsByArticle[session.articleURL, default: 0] += session.seconds
    }
    // Count sustained reading across visits, not brief opens or lifetime totals.
    articles = secondsByArticle.values.filter { $0 >= 60 }.count
  }

  static func duration(_ seconds: TimeInterval) -> String {
    let minutes = Int(seconds / 60)
    if seconds > 0 && minutes == 0 { return "<1 min" }
    if minutes < 60 { return "\(minutes) min" }
    let remainder = minutes % 60
    return remainder == 0 ? "\(minutes / 60) hr" : "\(minutes / 60) hr \(remainder) min"
  }
}
