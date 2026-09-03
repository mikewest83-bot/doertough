import Foundation

struct DealAlert: Codable, Identifiable, Equatable {
    let id: Int
    let category: String
    let location: String
    let budget: Double?
    let radiusMiles: Int?
    let constraints: String?
    let frequencyMinutes: Int
    let enabled: Bool
    let lastResults: [DealAlertResult]
    let lastCheckedAt: Date?
    let lastNotifiedAt: Date?
    let consecutiveFailures: Int
    let lastError: String?
    let createdAt: Date?

    var isHourly: Bool { frequencyMinutes == 60 }

    enum CodingKeys: String, CodingKey {
        case id, category, location, budget, constraints, enabled
        case radiusMiles = "radius_miles"
        case frequencyMinutes = "frequency_minutes"
        case lastResults = "last_results"
        case lastCheckedAt = "last_checked_at"
        case lastNotifiedAt = "last_notified_at"
        case consecutiveFailures = "consecutive_failures"
        case lastError = "last_error"
        case createdAt = "created_at"
    }
}

struct DealAlertResult: Codable, Equatable {
    let checkedAt: Date?
    let score: Int?
    let results: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case checkedAt = "checkedAt"
        case score, results, error
    }
}

struct DealAlertsResponse: Codable {
    let alerts: [DealAlert]
}

struct CreateDealAlertRequest: Encodable {
    let category: String
    let location: String
    let budget: Double?
    let radiusMiles: Double?
    let constraints: String?
    let frequencyMinutes: Int

    enum CodingKeys: String, CodingKey {
        case category, location, budget, constraints
        case radiusMiles
        case frequencyMinutes
    }
}

struct CreateDealAlertResponse: Codable {
    let alert: DealAlert
}

struct CancelDealAlertResponse: Codable {
    let canceled: Bool
    let id: Int
}
