import SwiftUI

struct DealAlertDetailView: View {
    let alert: DealAlert

    var body: some View {
        List {
            Section("Configuration") {
                LabeledContent("Status", value: alert.enabled ? "Active" : "Stopped")
                LabeledContent("Cadence", value: alert.isHourly ? "Hourly (60 min)" : "Every \(alert.frequencyMinutes) min")
                LabeledContent("Location", value: alert.location)
                if let radius = alert.radiusMiles {
                    LabeledContent("Radius", value: "\(radius) miles")
                }
                if let budget = alert.budget {
                    LabeledContent("Max price", value: budget.formatted(.currency(code: "USD")))
                }
                if let constraints = alert.constraints, !constraints.isEmpty {
                    LabeledContent("Preferences", value: constraints)
                }
            }

            Section("Server Activity") {
                if let date = alert.lastCheckedAt {
                    LabeledContent("Last checked", value: date.formatted(date: .abbreviated, time: .shortened))
                } else {
                    Text("No scan has completed yet.")
                        .foregroundStyle(.secondary)
                }
                if let date = alert.lastNotifiedAt {
                    LabeledContent("Last notified", value: date.formatted(date: .abbreviated, time: .shortened))
                }
                if alert.consecutiveFailures > 0 {
                    Label("\(alert.consecutiveFailures) consecutive scan failure(s)", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
                if let error = alert.lastError, !error.isEmpty {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }

            Section("Latest Result") {
                if let result = alert.lastResults.first {
                    if let score = result.score {
                        LabeledContent("Deal score", value: "\(score)/100")
                    }
                    if let text = result.results, !text.isEmpty {
                        Text(text)
                            .textSelection(.enabled)
                    } else if let error = result.error, !error.isEmpty {
                        Text(error)
                            .foregroundStyle(.red)
                    } else {
                        Text("The server returned a scan result without display text.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("Mike has not stored a result for this alert yet.")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("Alert #\(alert.id)")
        .navigationBarTitleDisplayMode(.inline)
    }
}
