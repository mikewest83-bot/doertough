import SwiftUI

struct DealAlertsView: View {
    @EnvironmentObject private var api: MikeAPIClient
    @State private var alerts: [DealAlert] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showingCreate = false

    var body: some View {
        List {
            Section {
                HStack {
                    Label("Server scheduler", systemImage: "server.rack")
                    Spacer()
                    Text("Authoritative")
                        .foregroundStyle(.secondary)
                }
                HStack {
                    Label("Hourly option", systemImage: "clock")
                    Spacer()
                    Text("60 min")
                        .foregroundStyle(.secondary)
                }
            } footer: {
                Text("Mike runs searches on the server. The iPhone never creates its own alert timer.")
            }

            Section("Active Alerts") {
                if alerts.isEmpty && !isLoading {
                    ContentUnavailableView("No Deal Alerts", systemImage: "bell.slash", description: Text("Create an alert and Mike will keep watching for resale opportunities."))
                } else {
                    ForEach(alerts) { alert in
                        NavigationLink {
                            DealAlertDetailView(alert: alert)
                        } label: {
                            DealAlertRow(alert: alert)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await cancel(alert) }
                            } label: {
                                Label("Stop", systemImage: "bell.slash")
                            }
                        }
                    }
                }
            }

            if let errorMessage {
                Section {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Deal Alerts")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingCreate = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Create Deal Alert")
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showingCreate) {
            NavigationStack {
                CreateDealAlertView {
                    showingCreate = false
                    Task { await load() }
                }
                .environmentObject(api)
            }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            alerts = try await api.listDealAlerts()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func cancel(_ alert: DealAlert) async {
        do {
            try await api.cancelDealAlert(id: alert.id)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct DealAlertRow: View {
    let alert: DealAlert

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(alert.category)
                    .font(.headline)
                Spacer()
                Circle()
                    .fill(alert.enabled ? .green : .gray)
                    .frame(width: 9, height: 9)
            }
            Text(alert.location)
                .foregroundStyle(.secondary)
            HStack(spacing: 12) {
                Label(alert.isHourly ? "Hourly" : "Every \(alert.frequencyMinutes)m", systemImage: "clock")
                if let radius = alert.radiusMiles {
                    Label("\(radius) mi", systemImage: "location")
                }
                if let score = alert.lastResults.first?.score {
                    Label("\(score)/100", systemImage: "chart.bar")
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}
