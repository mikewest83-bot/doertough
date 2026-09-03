import SwiftUI

struct DealAlertDetailView: View {
    @EnvironmentObject private var api: MikeAPIClient
    let alert: DealAlert

    @State private var currentAlert: DealAlert
    @State private var isRefreshing = false
    @State private var isStopping = false
    @State private var errorMessage: String?
    @State private var showingStopConfirmation = false

    init(alert: DealAlert) {
        self.alert = alert
        _currentAlert = State(initialValue: alert)
    }

    var body: some View {
        List {
            Section("Configuration") {
                LabeledContent("Status", value: currentAlert.enabled ? "Active" : "Stopped")
                LabeledContent("Cadence", value: currentAlert.isHourly ? "Hourly (60 min)" : "Every \(currentAlert.frequencyMinutes) min")
                LabeledContent("Location", value: currentAlert.location)
                if let radius = currentAlert.radiusMiles {
                    LabeledContent("Radius", value: "\(radius) miles")
                }
                if let budget = currentAlert.budget {
                    LabeledContent("Max price", value: budget.formatted(.currency(code: "USD")))
                }
                if let constraints = currentAlert.constraints, !constraints.isEmpty {
                    LabeledContent("Preferences", value: constraints)
                }
            }

            Section("Server Activity") {
                if let date = currentAlert.lastCheckedAt {
                    LabeledContent("Last checked", value: date.formatted(date: .abbreviated, time: .shortened))
                } else {
                    Text("No scan has completed yet.")
                        .foregroundStyle(.secondary)
                }
                if let date = currentAlert.lastNotifiedAt {
                    LabeledContent("Last notified", value: date.formatted(date: .abbreviated, time: .shortened))
                }
                if currentAlert.consecutiveFailures > 0 {
                    Label("\(currentAlert.consecutiveFailures) consecutive scan failure(s)", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }
                if let error = currentAlert.lastError, !error.isEmpty {
                    Text(error)
                        .font(.callout)
                        .foregroundStyle(.red)
                }
            }

            Section("Latest Result") {
                if let result = currentAlert.lastResults.first {
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

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Alert #\(currentAlert.id)")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    Task { await refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh alert")
                .disabled(isRefreshing || isStopping)

                if currentAlert.enabled {
                    Button(role: .destructive) {
                        showingStopConfirmation = true
                    } label: {
                        Image(systemName: "bell.slash")
                    }
                    .accessibilityLabel("Stop alert")
                    .disabled(isRefreshing || isStopping)
                }
            }
        }
        .refreshable { await refresh() }
        .task { await refresh() }
        .confirmationDialog(
            "Stop this deal alert?",
            isPresented: $showingStopConfirmation,
            titleVisibility: .visible
        ) {
            Button("Stop Alert", role: .destructive) {
                Task { await stop() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Mike will stop checking this alert. You can keep the alert history on the server.")
        }
    }

    private func refresh() async {
        guard !isRefreshing, !isStopping else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            let alerts = try await api.listDealAlerts()
            guard let updated = alerts.first(where: { $0.id == currentAlert.id }) else {
                errorMessage = "This alert is no longer available."
                return
            }
            currentAlert = updated
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func stop() async {
        guard currentAlert.enabled, !isStopping else { return }
        isStopping = true
        do {
            try await api.cancelDealAlert(id: currentAlert.id)
            isStopping = false
            await refresh()
        } catch {
            isStopping = false
            errorMessage = error.localizedDescription
        }
    }
}
