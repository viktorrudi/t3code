import Foundation
import Security

struct ChatRow: Codable, Identifiable, Hashable {
    let id, environmentId, threadId, environment, projectId, project, title, status, phase, model, shelf, asOf: String
    let wake: String?
    var live, canWrite, canSnooze: Bool
    var route: ChatRoute { ChatRoute(environmentId: environmentId, threadId: threadId, title: title) }
    var symbol: String {
        switch status {
        case "approval": return "hand.raised.fill"
        case "input": return "questionmark.bubble.fill"
        case "request": return "person.crop.circle.badge.questionmark"
        case "working": return "gearshape.fill"
        case "waiting": return "pause.circle"
        case "failed": return "exclamationmark.triangle.fill"
        case "limited": return "hourglass"
        default: return "checkmark.circle"
        }
    }
    var stateLabel: String {
        switch status {
        case "approval": return "Needs approval on iPhone or Mac"
        case "input": return "Needs input on iPhone or Mac"
        case "request": return "Needs your response"
        case "working": return phase.capitalized
        case "waiting": return "Waiting"
        case "failed": return "Failed"
        case "limited": return "Usage limit"
        default: return phase == "cancelled" ? "Cancelled" : phase == "interrupted" ? "Interrupted" : "Ready / Done"
        }
    }
}
struct ChatRoute: Codable, Hashable, Sendable {
    let environmentId, threadId, title: String
    var key: String { "\(environmentId):\(threadId)" }
    var endpoint: String { "/watch/v1/threads/\(environmentId.urlComponent)/\(threadId.urlComponent)" }
}
struct WatchProject: Codable, Identifiable, Hashable {
    let id, environmentId, projectId, title, environment, model: String
    let canCreate: Bool
}
struct WatchMessage: Codable, Identifiable, Hashable {
    let id: String
    let position: Int
    let role, text: String
}
struct Freshness: Codable { let name, asOf: String; var live: Bool }
struct Counts: Codable { let snoozed, settled: Int }
struct Overview: Codable { var items: [ChatRow]; let nextCursor: String?; let projects: [WatchProject]; let counts: Counts; var environments: [Freshness] }
struct Conversation: Codable { var row: ChatRow; var messages: [WatchMessage]; var nextCursor: String? }
struct WatchSetup: Codable {
    let url, token: String
    var pushToken: String? = nil
    func validated() throws -> WatchSetup {
        guard let origin = URL(string: url), origin.scheme == "https", origin.host != nil, origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil, origin.path.isEmpty || origin.path == "/", token.count == 43, token.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }) else { throw WatchFailure("Paste the private HTTPS Watch setup from your Mac.") }
        return WatchSetup(url: url.hasSuffix("/") ? String(url.dropLast()) : url, token: token, pushToken: pushToken)
    }
}
struct WatchFailure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
struct Draft: Codable {
    var text: String = ""
    var commandId: String = UUID().uuidString
    var transcriptDestination: String?
    var original: String?
    var audioURL: String?
    var audioCreatedAt: Date?
}
extension ChatRow {
    var cached: ChatRow { var row = self; row.live = false; row.canWrite = false; row.canSnooze = false; return row }
}
extension String {
    var urlComponent: String { addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
}

@MainActor final class WatchAPI {
    var setup: WatchSetup?
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 190
        config.httpMaximumConnectionsPerHost = 2
        config.urlCache = nil
        return URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }()
    func request<T: Decodable>(_ endpoint: String, method: String = "GET", body: Data? = nil, type: String = "application/json", credential: String? = nil) async throws -> T {
        guard let setup, let url = URL(string: setup.url + endpoint) else { throw WatchFailure("Set up this Watch first.") }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(credential ?? setup.token)", forHTTPHeaderField: "Authorization")
        req.setValue(type, forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw WatchFailure("Gateway is unavailable.") }
        guard (200...299).contains(http.statusCode) else {
            let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
            throw WatchFailure(error?.error ?? (http.statusCode == 401 ? "Pair your Watch again. Access has expired or was revoked." : "Gateway unavailable. Your draft is kept."))
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
    private struct ErrorBody: Codable { let error: String }
    func post<T: Decodable>(_ endpoint: String, _ body: [String: Any]) async throws -> T {
        try await request(endpoint, method: "POST", body: JSONSerialization.data(withJSONObject: body))
    }
}
final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

enum WatchKeychain {
    static let account = "watch-gateway"
    static func load() -> WatchSetup? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(WatchSetup.self, from: data).validated()
    }
    static func save(_ setup: WatchSetup) throws {
        let value = try setup.validated()
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account]
        let data = try JSONEncoder().encode(value)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw WatchFailure("Could not update Watch access securely.") }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw WatchFailure("Could not save Watch access securely.") }
    }
    static func forget() { SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account] as CFDictionary) }
}
