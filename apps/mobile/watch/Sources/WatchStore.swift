import CryptoKit
import SwiftUI
import WatchConnectivity
import UserNotifications
import WatchKit

@MainActor final class WatchStore: NSObject, ObservableObject {
    @Published var overview: Overview?
    @Published var path: [ChatRoute] = []
    @Published var error: String?
    @Published var loading = false
    @Published var gatewayAvailable = false
    @Published var paired = false
    @Published var scope: String? = UserDefaults.standard.string(forKey: "watch.scope")
    @Published var shelf = "active"
    @Published var undo: UndoAction?
    let api = WatchAPI()
    private var refreshInFlight = false
    private var setupGeneration = 0
    private static let disconnectedTokenKey = "watch.disconnectedTokenHash"
    private var session: WCSession?
    struct UndoAction { let row: ChatRow; let commandId: String; let until: Date }
    override init() {
        super.init()
        api.setup = WatchKeychain.load()
        #if DEBUG && targetEnvironment(simulator)
        // Simulator checks pass a setup through SIMCTL_CHILD_T3_WATCH_SIMULATOR_SETUP; release and device builds omit this.
        if let raw = ProcessInfo.processInfo.environment["T3_WATCH_SIMULATOR_SETUP"] { api.setup = try? JSONDecoder().decode(WatchSetup.self, from: Data(raw.utf8)).validated() }
        #endif
        paired = api.setup != nil
        if paired, let data = UserDefaults.standard.data(forKey: "watch.overview") { overview = try? JSONDecoder().decode(Overview.self, from: data); overview?.items = overview?.items.map { $0.cached } ?? [] }
        if paired, let data = UserDefaults.standard.data(forKey: "watch.pendingRoute"), let route = try? JSONDecoder().decode(ChatRoute.self, from: data) { path = [route] }
        if WCSession.isSupported() { session = WCSession.default; session?.delegate = self; session?.activate() }
        UNUserNotificationCenter.current().delegate = self
    }
    func setUp(_ setup: WatchSetup) async {
        setupGeneration += 1
        let generation = setupGeneration
        do {
            let validated = try setup.validated()
            let result: Overview = try await api.request("/watch/v1/overview", using: validated)
            guard generation == setupGeneration else { return }
            try WatchKeychain.save(validated)
            let previous = api.setup
            if previous != validated {
                clearAccountData()
                if let previous, previous.url != validated.url || previous.pushToken != validated.pushToken {
                    retireNotifications(previous)
                }
            }
            api.setup = validated
            paired = true
            gatewayAvailable = true
            error = nil
            if previous != validated {
                overview = result
                UserDefaults.standard.set(try? JSONEncoder().encode(result), forKey: "watch.overview")
            }
        } catch {
            guard generation == setupGeneration else { return }
            self.error = error.localizedDescription
        }
    }
    func refresh(more: Bool = false) async {
        guard paired, !refreshInFlight else { return }
        refreshInFlight = true; loading = true
        defer { refreshInFlight = false; loading = false }
        let requestedScope = scope, requestedShelf = shelf
        let requestedSetup = api.setup
        var query = "/watch/v1/overview?shelf=\(requestedShelf)"
        if let scope = requestedScope { query += "&scope=\(scope.urlComponent)" }
        if more, let cursor = overview?.nextCursor { query += "&cursor=\(cursor.urlComponent)" }
        do {
            var result: Overview = try await api.request(query)
            guard api.setup == requestedSetup, scope == requestedScope, shelf == requestedShelf else { return }
            if more { result.items = (overview?.items ?? []) + result.items }
            overview = result; error = nil; gatewayAvailable = true
            if let data = try? JSONEncoder().encode(result) { UserDefaults.standard.set(data, forKey: "watch.overview") }
        } catch {
            guard api.setup == requestedSetup else { return }
            self.error = error.localizedDescription; gatewayAvailable = false; overview?.items = overview?.items.map { $0.cached } ?? []
        }
    }
    func choose(_ scope: String?) {
        self.scope = scope; shelf = "active"; overview = nil
        UserDefaults.standard.set(scope, forKey: "watch.scope")
    }
    func draft(_ key: String) -> Draft {
        guard let data = UserDefaults.standard.data(forKey: "watch.draft.\(key)") else { return Draft() }
        return (try? JSONDecoder().decode(Draft.self, from: data)) ?? Draft()
    }
    func save(_ draft: Draft, _ key: String) { UserDefaults.standard.set(try? JSONEncoder().encode(draft), forKey: "watch.draft.\(key)") }
    func clearDraft(_ key: String) { UserDefaults.standard.removeObject(forKey: "watch.draft.\(key)") }
    func changeShelf(_ row: ChatRow, action: String, minutes: Int? = nil, undoCommandId: String? = nil) async {
        guard row.canWrite else { return }
        do {
            var body: [String: Any] = ["commandId": UUID().uuidString, "action": action]
            if let minutes { body["minutes"] = minutes }
            if let undoCommandId { body["undoCommandId"] = undoCommandId }
            let _: Sent = try await api.post(row.route.endpoint + "/shelf", body)
            if undoCommandId == nil { undo = UndoAction(row: row, commandId: body["commandId"] as! String, until: Date().addingTimeInterval(5)) }
            else { undo = nil }
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
    func openNotification(_ route: ChatRoute) {
        guard paired else { return }
        UserDefaults.standard.set(try? JSONEncoder().encode(route), forKey: "watch.pendingRoute")
        path = [route]
    }
    func forget() {
        setupGeneration += 1
        let previous = api.setup
        if let token = (session?.receivedApplicationContext["watchCredential"] as? String) ?? previous?.token {
            UserDefaults.standard.set(tokenDigest(token), forKey: Self.disconnectedTokenKey)
        }
        WatchKeychain.forget()
        api.setup = nil
        paired = false
        clearAccountData()
        retireNotifications(previous)
    }

    private func clearAccountData() {
        let defaults = UserDefaults.standard
        for key in defaults.dictionaryRepresentation().keys where key.hasPrefix("watch.") && key != Self.disconnectedTokenKey {
            defaults.removeObject(forKey: key)
        }
        try? FileManager.default.removeItem(at: FileManager.default.temporaryDirectory.appendingPathComponent("T3WatchVoice", isDirectory: true))
        overview = nil
        path = []
        scope = nil
        shelf = "active"
        undo = nil
        gatewayAvailable = false
    }

    private func tokenDigest(_ token: String) -> Data {
        Data(SHA256.hash(data: Data(token.utf8)))
    }

    private func retireNotifications(_ setup: WatchSetup?) {
        WKApplication.shared().unregisterForRemoteNotifications()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        guard let setup, let pushToken = setup.pushToken else { return }
        Task {
            do {
                let _: PushRegistration = try await api.request("/watch/v1/devices", method: "DELETE", credential: pushToken, using: setup)
            } catch {
                guard api.setup == nil else { return }
                self.error = "Watch disconnected. If notifications continue, revoke the Watch invitation on your Mac."
            }
        }
    }
}
struct Sent: Codable { let environmentId, threadId: String }
extension WatchStore: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        let context = session.receivedApplicationContext
        Task { @MainActor in await receive(context) }
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) { Task { @MainActor in await receive(applicationContext) } }
    private func receive(_ context: [String: Any]) async {
        guard let url = context["watchGatewayURL"] as? String, let token = context["watchCredential"] as? String else { return }
        guard token != api.setup?.token, tokenDigest(token) != UserDefaults.standard.data(forKey: Self.disconnectedTokenKey) else { return }
        await setUp(WatchSetup(url: url, token: token, pushToken: context["watchPushCredential"] as? String))
    }
}
extension WatchStore: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let route = notificationRoute(response.notification.request.content.userInfo) else { return }
        await MainActor.run { self.openNotification(route) }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let incoming = notificationRoute(notification.request.content.userInfo)
        return await MainActor.run {
            guard self.paired else { return [] }
            if let route = self.path.last, let incoming, incoming.threadId == route.threadId, incoming.environmentId == route.environmentId { return [] }
            return [.banner, .sound]
        }
    }
}

private func notificationRoute(_ userInfo: [AnyHashable: Any]) -> ChatRoute? {
    let body = userInfo["body"] as? [String: Any] ?? userInfo as? [String: Any] ?? [:]
    guard let environmentId = body["environmentId"] as? String, let threadId = body["threadId"] as? String else { return nil }
    return ChatRoute(environmentId: environmentId, threadId: threadId, title: body["titleSnapshot"] as? String ?? "Opening chat")
}
