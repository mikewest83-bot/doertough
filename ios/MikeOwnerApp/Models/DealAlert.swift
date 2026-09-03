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
}

struct DealAlertResult: Codable, Equatable {
    let checkedAt: Date?
    let score: Int?
    let results: String?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case checkedAt, score, results, error
    }
}

struct DealAlertsResponse: Codable {
    let alerts: [DealAlert]
}

struct CreateDealAlertRequest: Codable {
    let category: String
    let location: String
    let budget: Double?
    let radiusMiles: Double?
    let constraints: String?
    let frequencyMinutes: Int
}

struct CreateDealAlertResponse: Codable {
    let alert: DealAlert
}

struct CancelDealAlertResponse: Codable {
    let canceled: Bool
    let id: Int
}
