import SwiftUI

struct OwnerLoginView: View {
    @EnvironmentObject private var api: MikeAPIClient
    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        Form {
            Section("Mike AI Owner") {
                TextField("Email", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            Button {
                Task { await signIn() }
            } label: {
                if isLoading {
                    ProgressView()
                } else {
                    Text("Sign In")
                        .frame(maxWidth: .infinity)
                }
            }
            .disabled(isLoading || email.isEmpty || password.isEmpty)
        }
        .navigationTitle("Owner Access")
    }

    private func signIn() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let body = LoginRequest(email: email, password: password)
            let response: LoginResponse = try await api.post(path: "/api/auth/login", body: body)
            guard response.user.isOwner else {
                api.clearToken()
                throw APIError.server("This account is not authorized for the Mike owner app.")
            }
            api.setToken(response.token)
        } catch {
            errorMessage = error.localizedDescription
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

struct MikeUser: Codable {
    let id: String
    let name: String?
    let email: String
    let role: String?
    let isOwner: Bool
    let paid: Bool?
    let trialing: Bool?
}
