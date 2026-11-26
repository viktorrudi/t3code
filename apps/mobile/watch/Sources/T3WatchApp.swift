import SwiftUI
import WatchKit

@main struct T3WatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) var appDelegate
    @StateObject private var store = WatchStore()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $store.path) {
                Group { if store.paired { OverviewView() } else { SetupView() } }
                    .navigationDestination(for: ChatRoute.self) { route in ConversationView(route: route) }
            }
            .environmentObject(store)
            .onChange(of: appDelegate.token) { _, token in if let token { Task { await store.registerPush(token) } } }
            .onChange(of: store.paired) { _, paired in if paired, let token = appDelegate.token { Task { await store.registerPush(token) } } }
        }
    }
}
struct SetupView: View {
    @EnvironmentObject var store: WatchStore
    @State private var value = ""
    @State private var busy = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("T3 Code Personal").font(.headline)
                Text("Connect this Watch from your paired iPhone, or paste the private Watch setup from your Mac.")
                TextField("Private setup JSON", text: $value).privacySensitive()
                Button("Connect") {
                    busy = true
                    Task {
                        do { await store.setUp(try JSONDecoder().decode(WatchSetup.self, from: Data(value.utf8))); value = "" }
                        catch { store.error = "Use the Watch setup JSON created by your Mac." }
                        busy = false
                    }
                }.disabled(busy || value.isEmpty)
                if let error = store.error { Text(error).foregroundStyle(.orange) }
            }.padding()
        }.navigationTitle("Set up")
    }
}
