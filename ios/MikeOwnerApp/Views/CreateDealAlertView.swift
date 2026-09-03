import SwiftUI

struct CreateDealAlertView: View {
    @EnvironmentObject private var api: MikeAPIClient
    let onCreated: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var category = "resale opportunities"
    @State private var location = ""
    @State private var budget = ""
    @State private var radius = "25"
    @State private var constraints = ""
    @State private var frequency = 60
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let frequencies = [5, 15, 30, 60]

    var body: some View {
        Form {
            Section("What Mike should watch") {
                TextField("Category", text: $category)
                TextField("City or ZIP", text: $location)
                    .textInputAutocapitalization(.words)
                TextField("Max purchase price", text: $budget)
                    .keyboardType(.decimalPad)
                TextField("Search radius (miles)", text: $radius)
                    .keyboardType(.numberPad)
                TextField("Preferences / constraints", text: $constraints, axis: .vertical)
                    .lineLimit(2...5)
            }

            Section("Scan cadence") {
                Picker("Check", selection: $frequency) {
                    ForEach(frequencies, id: \.self) { minutes in
                        Text(minutes == 60 ? "Hourly" : "Every \(minutes) minutes")
                            .tag(minutes)
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }
        }
        .navigationTitle("New Deal Alert")
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Create") {
                    Task { await create() }
                }
                .disabled(isSaving || location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func create() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let request = CreateDealAlertRequest(
            category: category.trimmingCharacters(in: .whitespacesAndNewlines),
            location: location.trimmingCharacters(in: .whitespacesAndNewlines),
            budget: Double(budget.trimmingCharacters(in: .whitespacesAndNewlines)),
            radiusMiles: Double(radius.trimmingCharacters(in: .whitespacesAndNewlines)),
            constraints: constraints.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : constraints,
            frequencyMinutes: frequency
        )

        do {
            _ = try await api.createDealAlert(request)
            onCreated()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
