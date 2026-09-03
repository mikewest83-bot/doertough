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
                .disabled(isSaving || !canCreate)
            }
        }
    }

    private var canCreate: Bool {
        !location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !category.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func create() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let trimmedCategory = category.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedLocation = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedBudget = budget.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedRadius = radius.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedConstraints = constraints.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedCategory.isEmpty else {
            errorMessage = "Enter a category for Mike to watch."
            return
        }
        guard !trimmedLocation.isEmpty else {
            errorMessage = "Enter a city or ZIP code."
            return
        }

        let parsedBudget: Double?
        if trimmedBudget.isEmpty {
            parsedBudget = nil
        } else if let value = Double(trimmedBudget), value >= 0 {
            parsedBudget = value
        } else {
            errorMessage = "Max purchase price must be a valid number of $0 or more."
            return
        }

        let parsedRadius: Double?
        if trimmedRadius.isEmpty {
            parsedRadius = nil
        } else if let value = Double(trimmedRadius), value > 0, value <= 100 {
            parsedRadius = value
        } else {
            errorMessage = "Search radius must be between 1 and 100 miles."
            return
        }

        let request = CreateDealAlertRequest(
            category: trimmedCategory,
            location: trimmedLocation,
            budget: parsedBudget,
            radiusMiles: parsedRadius,
            constraints: trimmedConstraints.isEmpty ? nil : trimmedConstraints,
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
