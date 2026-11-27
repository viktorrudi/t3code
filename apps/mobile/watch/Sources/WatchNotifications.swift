import Foundation
import WatchKit
import UserNotifications

final class WatchAppDelegate: NSObject, WKApplicationDelegate, ObservableObject {
    @Published var token: String?
    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
    }
    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        NotificationCenter.default.post(name: Notification.Name("T3WatchPushError"), object: error.localizedDescription)
    }
}
struct PushRegistration: Codable { let registered: Bool }
extension WatchStore {
    func enableNotifications() async {
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard allowed else { throw WatchFailure("Notifications are off. Enable them in Watch Settings.") }
            WKApplication.shared().registerForRemoteNotifications()
        } catch { self.error = error.localizedDescription }
    }
    func registerPush(_ token: String) async {
        guard let pushToken = api.setup?.pushToken else { return }
        do {
            let _: PushRegistration = try await api.request("/watch/v1/devices", method: "POST", body: JSONSerialization.data(withJSONObject: ["token": token, "preview": false]), credential: pushToken)
        } catch { self.error = error.localizedDescription }
    }
}
