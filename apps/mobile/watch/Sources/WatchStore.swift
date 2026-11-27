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
        if let data = UserDefaults.standard.data(forKey: "watch.overview") { overview = try? JSONDecoder().decode(Overview.self, from: data); overview?.items = overview?.items.map { $0.cached } ?? [] }
        if let data = UserDefaults.standard.data(forKey: "watch.pendingRoute"), let route = try? JSONDecoder().decode(ChatRoute.self, from: data) { path = [route] }
        if WCSession.isSupported() { session = WCSession.default; session?.delegate = self; session?.activate() }
        UNUserNotificationCenter.current().delegate = self
    }
    func setUp(_ setup: WatchSetup) async {
        do {
            let validated = try setup.validated()
            api.setup = validated
            let _: Overview = try await api.request("/watch/v1/overview")
            try WatchKeychain.save(validated)
            paired = true
            error = nil
            await refresh()
        } catch { api.setup = WatchKeychain.load(); self.error = error.localizedDescription }
    }
    func refresh(more: Bool = false) async {
        guard paired, !refreshInFlight else { return }
        refreshInFlight = true; loading = true
        defer { refreshInFlight = false; loading = false }
        let requestedScope = scope, requestedShelf = shelf
        var query = "/watch/v1/overview?shelf=\(requestedShelf)"
        if let scope = requestedScope { query += "&scope=\(scope.urlComponent)" }
        if more, let cursor = overview?.nextCursor { query += "&cursor=\(cursor.urlComponent)" }
        do {
            var result: Overview = try await api.request(query)
            guard scope == requestedScope, shelf == requestedShelf else { return }
            if more { result.items = (overview?.items ?? []) + result.items }
            overview = result; error = nil; gatewayAvailable = true
            if let data = try? JSONEncoder().encode(result) { UserDefaults.standard.set(data, forKey: "watch.overview") }
        } catch { self.error = error.localizedDescription; gatewayAvailable = false; overview?.items = overview?.items.map { $0.cached } ?? [] }
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
        UserDefaults.standard.set(try? JSONEncoder().encode(route), forKey: "watch.pendingRoute")
        path = [route]
    }
    func forget() {
        WatchKeychain.forget(); api.setup = nil; paired = false; overview = nil; path = []
        UserDefaults.standard.removeObject(forKey: "watch.overview")
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
