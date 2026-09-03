import Foundation
import Security
import Combine

@MainActor
final class MikeAPIClient: ObservableObject {
    static let shared = MikeAPIClient()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    @Published private(set) var token: String?
    @Published private(set) var currentUser: MikeUser?

    init(baseURL: URL = URL(string: "https://doertoughmikeai.com")!, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        self.decoder.dateDecodingStrategy = .iso8601
        self.encoder.dateEncodingStrategy = .iso8601
        self.token = KeychainStore.load(key: "mike-owner-auth-token")
    }

    func setToken(_ token: String, user: MikeUser? = nil) {
        self.token = token
        self.currentUser = user
        KeychainStore.save(token, key: "mike-owner-auth-token")
    }

    func clearToken() {
        token = nil
        currentUser = nil
        KeychainStore.delete(key: "mike-owner-auth-token")
    }

    func restoreSession() async {
        guard token != nil else { return }
        do {
            let response: MeResponse = try await request(path: "/api/auth/me", method: "GET")
            guard response.user.isOwner else {
                clearToken()
                return
            }
            setToken(response.token, user: response.user)
        } catch {
            clearToken()
        }
    }

    func login(email: String, password: String) async throws {
        let response: LoginResponse = try await post(
            path: "/api/auth/login",
            body: LoginRequest(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password)
        )
        guard response.user.isOwner else {
            clearToken()
            throw APIError.server("This account is not authorized for the Mike owner app.")
        }
        setToken(response.token, user: response.user)
    }

    func listDealAlerts() async throws -> [DealAlert] {
        let response: DealAlertsResponse = try await request(path: "/api/owner/deal-alerts", method: "GET")
        return response.alerts
    }

    func createDealAlert(_ requestBody: CreateDealAlertRequest) async throws -> DealAlert {
        let response: CreateDealAlertResponse = try await request(path: "/api/owner/deal-alerts", method: "POST", body: requestBody)
        return response.alert
    }

    func cancelDealAlert(id: Int) async throws {
        let _: CancelDealAlertResponse = try await request(path: "/api/owner/deal-alerts/\(id)", method: "DELETE")
    }

    func post<T: Decodable, Body: Encodable>(path: String, body: Body) async throws -> T {
        try await request(path: path, method: "POST", body: body)
    }

    private func request<T: Decodable, Body: Encodable>(path: String, method: String, body: Body? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try encoder.encode(body) }

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 {
            clearToken()
            throw APIError.unauthorized
        }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? decoder.decode(APIErrorEnvelope.self, from: data).message)
                ?? (try? decoder.decode(APIErrorEnvelope.self, from: data).error)
                ?? "Request failed (\(http.statusCode))."
            throw APIError.server(message)
        }
        return try decoder.decode(T.self, from: data)
    }

    private func request<T: Decodable>(path: String, method: String) async throws -> T {
        try await request(path: path, method: method, body: Optional<String>.none)
    }
}

struct APIErrorEnvelope: Codable {
    let error: String?
    let message: String?
}

enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Mike returned an invalid response."
        case .unauthorized: return "Your Mike owner session has expired."
        case .server(let message): return message
        }
    }
}

struct LoginRequest: Codable {
    let email: String
    let password: String
}

struct LoginResponse: Codable {
    let token: String
    let user: MikeUser
}

struct MeResponse: Codable {
    let user: MikeUser
    let token: String
}

struct MikeUser: Codable {
    let id: String
    let name: String?
    let email: String
    let role: String?
    let isOwner: Bool
    let paid: Bool?
    let trialing: Bool?
}

private enum KeychainStore {
    static func save(_ value: String, key: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        SecItemAdd(item as CFDictionary, nil)
    }

    static func load(key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(key: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
    }
}
