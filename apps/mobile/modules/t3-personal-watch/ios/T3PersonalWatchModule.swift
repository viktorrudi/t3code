import ExpoModulesCore
import Foundation
import WatchConnectivity

public class T3PersonalWatchModule: Module {
    private let bridge = PersonalWatchBridge()
    public func definition() -> ModuleDefinition {
        Name("T3PersonalWatch")
        AsyncFunction("configure") { (json: String) async throws in
            try await self.bridge.configure(json)
        }
    }
}

private final class PersonalWatchBridge: NSObject, WCSessionDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var pending: ([String: Any], CheckedContinuation<Void, Error>)?
    func configure(_ json: String) async throws {
        struct Setup: Decodable { let url, token: String; let pushToken: String? }
        let setup = try JSONDecoder().decode(Setup.self, from: Data(json.utf8))
        guard let url = URL(string: setup.url), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/", setup.token.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw failure("Use the private Watch setup JSON from your Mac.") }
        guard WCSession.isSupported() else { throw failure("WatchConnectivity is unavailable on this device.") }
        var context: [String: Any] = ["watchGatewayURL": setup.url.trimmingCharacters(in: CharacterSet(charactersIn: "/")), "watchCredential": setup.token]
        if let pushToken = setup.pushToken { context["watchPushCredential"] = pushToken }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            lock.lock()
            guard pending == nil else { lock.unlock(); continuation.resume(throwing: failure("Watch setup is already in progress.")); return }
            pending = (context, continuation)
            lock.unlock()
            let session = WCSession.default
            session.delegate = self
            if session.activationState == .activated { deliver(session) } else { session.activate() }
        }
    }
    private func deliver(_ session: WCSession, error: Error? = nil) {
        lock.lock(); let next = pending; pending = nil; lock.unlock()
        guard let (context, continuation) = next else { return }
        do {
            if let error { throw error }
            guard session.isPaired else { throw failure("Pair an Apple Watch with this iPhone first.") }
            try session.updateApplicationContext(context)
            continuation.resume()
        } catch { continuation.resume(throwing: error) }
    }
    private func failure(_ message: String) -> NSError { NSError(domain: "T3PersonalWatch", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { deliver(session, error: error) }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
}
