import SwiftUI

@main
struct MikeOwnerApp: App {
    @StateObject private var api = MikeAPIClient.shared

    var body: some Scene {
        WindowGroup {
            NavigationStack {
                if api.token == nil {
                    OwnerLoginView()
                } else {
                    DealAlertsView()
                }
            }
            .environmentObject(api)
        }
    }
}
