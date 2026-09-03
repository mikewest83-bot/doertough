import SwiftUI

struct DealAlertsView: View {
    @EnvironmentObject private var api: MikeAPIClient
    @State private var alerts: [DealAlert] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showingCreate = false

    private var activeAlerts: [DealAlert] { alerts.filter(\.enabled) }
    private var stoppedAlerts: [DealAlert] { alerts.filter { !$0.enabled } }

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
                if activeAlerts.isEmpty && !isLoading {
                    EmptyAlertsView(
                        title: "No Active Alerts",
                        message: "Create an alert and Mike will keep watching for resale opportunities."
                    )
                } else {
                    ForEach(activeAlerts) { alert in
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

            if !stoppedAlerts.isEmpty {
                Section("Stopped Alerts") {
                    ForEach(stoppedAlerts) { alert in
                        NavigationLink {
                            DealAlertDetailView(alert: alert)
                        } label: {
                            DealAlertRow(alert: alert)
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

private struct EmptyAlertsView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "bell.slash")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
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
                    .accessibilityHidden(true)
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
