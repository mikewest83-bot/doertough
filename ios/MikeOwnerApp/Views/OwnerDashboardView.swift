import SwiftUI

struct OwnerDashboardView: View {
    @EnvironmentObject private var api: MikeAPIClient
    @State private var alerts: [DealAlert] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showingSignOut = false

    private var activeCount: Int { alerts.filter(\.enabled).count }
    private var latestAlert: DealAlert? { alerts.first(where: { $0.enabled }) ?? alerts.first }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                statusCard
                metrics
                latestActivity
                NavigationLink {
                    DealAlertsView()
                        .environmentObject(api)
                } label: {
                    Label("Manage Deal Alerts", systemImage: "bell.badge")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
        .navigationTitle("Mike Owner")
        .refreshable { await load() }
        .task { await load() }
        .overlay {
            if isLoading && alerts.isEmpty { ProgressView("Loading…") }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Sign Out") { showingSignOut = true }
            }
        }
        .confirmationDialog("Sign out of Mike Owner?", isPresented: $showingSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) {
                api.clearToken()
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Deal Alerts", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text("Deal Alerts")
                .font(.largeTitle.bold())
            Text("Owner control center")
                .foregroundStyle(.secondary)
        }
    }

    private var statusCard: some View {
        HStack(spacing: 12) {
            Image(systemName: "server.rack")
                .font(.title2)
            VStack(alignment: .leading, spacing: 3) {
                Text("Server scheduler")
                    .font(.headline)
                Text("Mike's backend is the source of truth")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        }
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var metrics: some View {
        HStack(spacing: 12) {
            metric("Active", value: "\(activeCount)", icon: "bell.fill")
            metric("Hourly", value: "60m", icon: "clock.fill")
        }
    }

    private func metric(_ title: String, value: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: icon)
            Text(value).font(.title2.bold())
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    private var latestActivity: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Latest Activity").font(.headline)
            if let alert = latestAlert {
                Text(alert.category).font(.subheadline.bold())
                Text(alert.location).foregroundStyle(.secondary)
                if let checked = alert.lastCheckedAt {
                    Text("Last checked \(checked.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    Text("Waiting for the first server scan")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let error = alert.lastError, !error.isEmpty {
                    Label(error, systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            } else {
                Text("No Deal Alerts configured yet.")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
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
}
