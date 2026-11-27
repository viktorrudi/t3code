import SwiftUI

struct OverviewView: View {
    @EnvironmentObject var store: WatchStore
    @Environment(\.scenePhase) private var phase
    @State private var scopeSheet = false
    @State private var newChat = false
    @State private var snooze: ChatRow?
    @State private var details: ChatRow?
    var body: some View {
        List {
            if let error = store.error { Text(error).font(.footnote).foregroundStyle(.orange); Button("Retry") { Task { await store.refresh() } } }
            ForEach(store.overview?.environments.filter { !$0.live } ?? [], id: \.name) { env in Text("\(env.name) offline · updated \(env.asOf)").font(.footnote).foregroundStyle(.orange) }
            if store.loading && store.overview == nil { ProgressView("Loading chats") }
            if let overview = store.overview, overview.items.isEmpty { Text("No \(store.shelf == "active" ? "active" : store.shelf) chats in this scope.").foregroundStyle(.secondary) }
            ForEach(store.overview?.items ?? []) { row in
                NavigationLink(value: row.route) { ChatRowView(row: row) }
                    .swipeActions(edge: .leading, allowsFullSwipe: false) {
                        if row.canWrite && row.shelf == "snoozed" { Button("Wake", systemImage: "sun.max") { Task { await store.changeShelf(row, action: "wake") } }.tint(.orange) }
                        else if row.canSnooze && row.shelf == "active" { Button("Snooze", systemImage: "moon") { snooze = row }.tint(.orange) }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        if row.canWrite { Button(row.shelf == "settled" ? "Reopen" : "Settle", systemImage: row.shelf == "settled" ? "arrow.uturn.backward" : "checkmark") { Task { await store.changeShelf(row, action: row.shelf == "settled" ? "reopen" : "settle") } }.tint(.green) }
                    }
                    .accessibilityAction(named: "Details") { details = row }
                    .accessibilityAction(named: row.shelf == "settled" ? "Reopen" : "Settle") { if row.canWrite { Task { await store.changeShelf(row, action: row.shelf == "settled" ? "reopen" : "settle") } } }
                    .accessibilityAction(named: row.shelf == "snoozed" ? "Wake" : "Snooze") { if row.canWrite && row.shelf == "snoozed" { Task { await store.changeShelf(row, action: "wake") } } else if row.canSnooze { snooze = row } }
            }
            if store.overview?.nextCursor != nil { Button("More chats") { Task { await store.refresh(more: true) } } }
            if store.shelf == "active" {
                Button("Snoozed \(store.overview?.counts.snoozed ?? 0)", systemImage: "moon") { selectShelf("snoozed") }
                Button("Settled \(store.overview?.counts.settled ?? 0)", systemImage: "checkmark.circle") { selectShelf("settled") }
            } else { Button("Back to active chats") { selectShelf("active") } }
            Button("Refresh", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
            Button("Enable notifications", systemImage: "bell") { Task { await store.enableNotifications() } }
            Button("Disconnect Watch", role: .destructive) { store.forget() }
        }
        .navigationTitle(store.shelf == "active" ? (store.overview?.projects.first { $0.id == store.scope }?.title ?? "Chats") : store.shelf.capitalized)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) { Button("Scope", systemImage: "square.grid.2x2") { scopeSheet = true } }
            ToolbarItem(placement: .topBarTrailing) { Button("New chat", systemImage: "plus") { newChat = true } }
        }
        .sheet(isPresented: $scopeSheet) { ScopeView() }
        .sheet(isPresented: $newChat) { NewChatView() }
        .sheet(item: $snooze) { row in SnoozeView(row: row) }
        .sheet(item: $details) { row in DetailsView(row: row) }
        .overlay(alignment: .bottom) {
            if let undo = store.undo {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if context.date < undo.until { Button("Undo") { Task { await store.changeShelf(undo.row, action: "undo", undoCommandId: undo.commandId) } }.buttonStyle(.borderedProminent).tint(.green) }
                }
            }
        }
        .task(id: "\(phase == .active && store.path.isEmpty)-\(store.scope ?? "all")-\(store.shelf)") {
            guard phase == .active && store.path.isEmpty else { return }
            repeat {
                await store.refresh()
                do { try await Task.sleep(for: .seconds(20)) } catch { return }
            } while !Task.isCancelled
        }
    }
    private func selectShelf(_ shelf: String) { store.shelf = shelf; store.overview = nil }
}
struct ChatRowView: View {
    let row: ChatRow
    @ScaledMetric(relativeTo: .body) private var titleSize = 16.0
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 8) {
                Text(String(row.project.prefix(1))).font(.caption.bold()).frame(width: 22, height: 22).background(.indigo, in: RoundedRectangle(cornerRadius: 6))
                Image(systemName: row.symbol).foregroundStyle(row.status == "approval" || row.status == "input" ? .orange : row.status == "failed" ? .red : .green)
                    .overlay(alignment: .bottomTrailing) { if !row.live { Image(systemName: "clock.fill").font(.system(size: 8)).background(.black, in: Circle()) } }
            }.frame(width: 22)
            VStack(alignment: .leading, spacing: 5) {
                Text(row.title).font(.system(size: titleSize, weight: .medium)).fixedSize(horizontal: false, vertical: true)
                if row.shelf == "snoozed", let wake = row.wake { Text("Wakes \(wake)").font(.footnote).foregroundStyle(.secondary) }
            }
        }.padding(.vertical, 10).frame(minHeight: 64, alignment: .top)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(row.title). \(row.stateLabel). \(row.project) on \(row.environment). \(row.live ? "" : "Offline, updated \(row.asOf)")")
    }
}
struct ScopeView: View {
    @EnvironmentObject var store: WatchStore
    @Environment(\.dismiss) var dismiss
    var body: some View {
        NavigationStack {
            List {
                Button { store.choose(nil); dismiss() } label: { Label("All projects", systemImage: store.scope == nil ? "checkmark" : "square.grid.2x2") }
                ForEach(store.overview?.projects ?? []) { project in
                    Button { store.choose(project.id); dismiss() } label: {
                        VStack(alignment: .leading) { Text(project.title).fixedSize(horizontal: false, vertical: true); Text(project.environment).font(.footnote).foregroundStyle(.secondary); if store.scope == project.id { Image(systemName: "checkmark") } }
                    }
                }
            }.navigationTitle("Projects")
        }
    }
}
struct SnoozeView: View {
    let row: ChatRow
    @EnvironmentObject var store: WatchStore
    @Environment(\.dismiss) var dismiss
    var body: some View {
        NavigationStack { List { ForEach([30, 60, 180], id: \.self) { minutes in Button("\(minutes) minutes") { Task { await store.changeShelf(row, action: "snooze", minutes: minutes); dismiss() } } } }.navigationTitle("Snooze") }
    }
}
struct DetailsView: View {
    let row: ChatRow
    @EnvironmentObject var store: WatchStore
    @State private var snooze = false
    var body: some View {
        NavigationStack {
            List {
                Text(row.title).font(.headline)
                Text(row.stateLabel)
                Text("\(row.project)\n\(row.environment)\n\(row.model)")
                Text("\(row.shelf.capitalized) · updated \(row.asOf)").font(.footnote)
                if row.canWrite {
                    if row.shelf == "snoozed" { Button("Wake now") { Task { await store.changeShelf(row, action: "wake") } } }
                    else if row.canSnooze { Button("Snooze…") { snooze = true } }
                    else { Text("Snooze is unavailable while this chat needs attention or is starting.").font(.footnote) }
                    Button(row.shelf == "settled" ? "Reopen" : "Settle") { Task { await store.changeShelf(row, action: row.shelf == "settled" ? "reopen" : "settle") } }
                } else { Text(row.live ? "Read-only access" : "Offline. Writes are unavailable.") }
            }.navigationTitle("Details")
        }.sheet(isPresented: $snooze) { SnoozeView(row: row) }
    }
}

struct ConversationView: View {
    let route: ChatRoute
    @EnvironmentObject var store: WatchStore
    @Environment(\.scenePhase) var phase
    @State private var conversation: Conversation?
    @State private var failure: String?
    @State private var compose = false
    @State private var speak = false
    @State private var details = false
    @State private var busy = false
    @State private var historyLoaded = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(conversation?.row.title ?? route.title).font(.headline).fixedSize(horizontal: false, vertical: true)
                if let failure { Text(failure).foregroundStyle(.orange); Button("Retry") { Task { await load() } } }
                if let c = conversation {
                    Text(c.row.live && failure == nil ? "Updated \(c.row.asOf)" : "Cached · as of \(c.row.asOf)").font(.footnote).foregroundStyle(.secondary)
                    if ["approval", "input", "request", "failed", "limited"].contains(c.row.status) { Label(c.row.stateLabel, systemImage: c.row.symbol).padding(8).background(.orange.opacity(0.15), in: RoundedRectangle(cornerRadius: 10)) }
                    if c.nextCursor != nil { Button("Earlier messages") { Task { await load(earlier: true) } }.disabled(busy) }
                    ForEach(c.messages) { message in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(message.role).font(.caption).foregroundStyle(.secondary)
                            LongMessageText(text: message.text)
                        }
                    }
                    if c.messages.isEmpty { Text("No messages yet.").foregroundStyle(.secondary) }
                    Text(c.row.stateLabel).font(.footnote).foregroundStyle(.secondary)
                    if !c.row.canWrite { Text("You can keep a draft. Sending requires a connected environment and write access.").font(.footnote) }
                } else if failure == nil { ProgressView("Opening on \(route.environmentId)") }
            }.padding(.horizontal, 8)
        }
        .navigationTitle("Chat")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Details", systemImage: "ellipsis") { details = true }.disabled(conversation == nil) }
            ToolbarItemGroup(placement: .bottomBar) {
                Button("Type", systemImage: "keyboard") { speak = false; compose = true }
                Spacer()
                Button("Speak", systemImage: "mic.fill") { speak = true; compose = true }.tint(.green)
            }
        }
        .sheet(isPresented: $compose) { DraftView(route: route, project: nil, row: conversation?.row, startWithVoice: speak) }
        .sheet(isPresented: $details) { if let c = conversation { DetailsView(row: c.row) } }
        .task(id: phase == .active) {
            guard phase == .active else { return }
            if let data = UserDefaults.standard.data(forKey: "watch.chat.\(route.key)") { conversation = try? JSONDecoder().decode(Conversation.self, from: data); conversation?.row = conversation!.row.cached }
            repeat { await load(); do { try await Task.sleep(for: .seconds(10)) } catch { return } } while !Task.isCancelled
        }
    }
    private func load(earlier: Bool = false) async {
        guard !busy, let setup = store.api.setup else { return }; busy = true; defer { busy = false }
        do {
            let endpoint = route.endpoint + (earlier ? "?before=\((conversation?.nextCursor ?? "").urlComponent)" : "")
            var result: Conversation = try await store.api.request(endpoint, using: setup)
            guard store.api.setup == setup, !Task.isCancelled else { return }
            if let previous = conversation {
                if !earlier && historyLoaded { result.nextCursor = previous.nextCursor }
                let all = earlier ? result.messages + previous.messages : previous.messages + result.messages
                var seen = Set<String>(); result.messages = all.reversed().filter { seen.insert($0.id).inserted }.reversed().sorted { $0.position < $1.position }
            }
            if earlier { historyLoaded = true }
            conversation = result; failure = nil; store.gatewayAvailable = true
            if let data = try? JSONEncoder().encode(result) { UserDefaults.standard.set(data, forKey: "watch.chat.\(route.key)") }
            UserDefaults.standard.removeObject(forKey: "watch.pendingRoute")
        } catch {
            guard store.api.setup == setup, !Task.isCancelled else { return }
            failure = error.localizedDescription
            if let status = (error as? WatchFailure)?.status, [401, 403, 404].contains(status) {
                conversation = nil
                UserDefaults.standard.removeObject(forKey: "watch.chat.\(route.key)")
                UserDefaults.standard.removeObject(forKey: "watch.pendingRoute")
            } else {
                conversation?.row = conversation!.row.cached
                store.gatewayAvailable = false
            }
        }
    }
}
struct LongMessageText: View {
    let text: String
    @State private var length = 4000
    var body: some View {
        Text(String(text.prefix(length))).fixedSize(horizontal: false, vertical: true)
        if text.count > length { Button("Continue reading") { length += 4000 } }
    }
}
struct NewChatView: View {
    @EnvironmentObject var store: WatchStore
    @State private var project: WatchProject?
    @State private var speak = false
    @State private var draft = false
    var body: some View {
        NavigationStack {
            List {
                if let project {
                    Text("\(project.title)\n\(project.environment)\n\(project.model)").fixedSize(horizontal: false, vertical: true)
                    if !project.canCreate { Text("Configure project defaults on iPhone, or reconnect this environment.").foregroundStyle(.orange) }
                    Button("Speak", systemImage: "mic.fill") { speak = true; draft = true }.disabled(!project.canCreate)
                    Button("Type", systemImage: "keyboard") { speak = false; draft = true }
                    Button("Change project") { self.project = nil }
                } else {
                    ForEach(store.overview?.projects ?? []) { p in Button { project = p } label: { VStack(alignment: .leading) { Text(p.title); Text(p.environment).font(.footnote) } } }
                }
            }.navigationTitle("New chat")
                .onAppear { project = store.overview?.projects.first { $0.id == store.scope } }
                .sheet(isPresented: $draft) { if let project { DraftView(route: nil, project: project, row: nil, startWithVoice: speak) } }
        }
    }
}
