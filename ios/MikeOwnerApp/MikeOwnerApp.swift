import SwiftUI

@main
struct MikeOwnerApp: App {
    @StateObject private var api = MikeAPIClient.shared
    @State private var sessionRestored = false

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Group {
                    if !sessionRestored {
                        SessionLoadingView()
                    } else if api.token == nil {
                        OwnerLoginView()
                    } else {
                        OwnerDashboardView()
                    }
                }
            }
            .environmentObject(api)
            .task {
                await api.restoreSession()
                sessionRestored = true
            }
        }
    }
}

private struct SessionLoadingView: View {
    var body: some View {
        VStack(spacing: 14) {
            ProgressView()
            Text("Connecting to Mike…")
                .font(.headline)
            Text("Restoring your secure owner session.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
        .accessibilityElement(children: .combine)
    }
}
