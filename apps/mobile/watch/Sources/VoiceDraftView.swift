import SwiftUI
import AVFoundation
import WatchKit

@MainActor final class WatchRecorder: NSObject, ObservableObject, AVAudioRecorderDelegate {
    @Published var recording = false
    @Published var elapsed: TimeInterval = 0
    @Published var level: Float = 0
    @Published var error: String?
    private var recorder: AVAudioRecorder?
    private var meter: Task<Void, Never>?
    private(set) var file: URL?
    private var warned = false
    override init() {
        super.init()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("T3WatchVoice", isDirectory: true)
        for file in (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.creationDateKey])) ?? [] {
            if file.pathExtension == "m4a", let created = try? file.resourceValues(forKeys: [.creationDateKey]).creationDate, Date().timeIntervalSince(created) >= 86400 { try? FileManager.default.removeItem(at: file) }
        }
    }
    func restore(_ url: URL?, createdAt: Date?) {
        guard let url, url.isFileURL, url.deletingLastPathComponent().lastPathComponent == "T3WatchVoice", let createdAt, Date().timeIntervalSince(createdAt) < 86400, FileManager.default.fileExists(atPath: url.path) else { return }
        file = url
    }
    func start() async {
        let allowed = await AVAudioApplication.requestRecordPermission()
        guard allowed else { error = "Microphone access is off. Enable it in Settings, or use Type."; return }
        discard()
        do {
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .default)
            try audio.setActive(true)
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent("T3WatchVoice", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent(UUID().uuidString + ".m4a")
            let recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000])
            recorder.delegate = self; recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: 300) else { throw WatchFailure("Could not start recording. Use Type instead.") }
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUnlessOpen], ofItemAtPath: url.path)
            self.recorder = recorder; file = url; recording = true; error = nil; elapsed = 0; warned = false
            meter = Task { [weak self] in
                while !Task.isCancelled {
                    guard let self, let recorder = self.recorder, recorder.isRecording else { break }
                    elapsed = recorder.currentTime; recorder.updateMeters(); level = max(0, min(1, (recorder.averagePower(forChannel: 0) + 60) / 60))
                    if elapsed >= 270 && !warned { warned = true; WKInterfaceDevice.current().play(.notification) }
                    do { try await Task.sleep(for: .milliseconds(250)) } catch { break }
                }
            }
        } catch { self.error = error.localizedDescription; recording = false }
    }
    func stop() { recorder?.stop(); meter?.cancel(); meter = nil; recording = false; try? AVAudioSession.sharedInstance().setActive(false) }
    func discard() { stop(); if let file { try? FileManager.default.removeItem(at: file) }; file = nil; recorder = nil }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) { Task { @MainActor in self.stop(); if !flag { self.error = "Recording interrupted. Review or record again." } } }
    nonisolated func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) { Task { @MainActor in self.stop(); self.error = "Recording failed. Use Type or record again." } }
}
struct Transcript: Codable { let text, destination: String }
struct DraftView: View {
    let route: ChatRoute?
    let project: WatchProject?
    let row: ChatRow?
    let startWithVoice: Bool
    @EnvironmentObject var store: WatchStore
    @Environment(\.dismiss) var dismiss
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @Environment(\.scenePhase) var scenePhase
    @StateObject private var recorder = WatchRecorder()
    @State private var draft = Draft()
    @State private var failure: String?
    @State private var busy = false
    @State private var voice = false
    @State private var consent = false
    @State private var upload: Task<Void, Never>?
    @FocusState private var editing: Bool
    private var key: String { route?.key ?? "new:\(project?.id ?? "")" }
    private var destination: String { row.map { "\($0.title)\n\($0.project) · \($0.environment)" } ?? project.map { "\($0.title) · \($0.environment)" } ?? route?.title ?? "Choose project" }
    private var voiceDestination: String { "\(route?.environmentId ?? project?.environmentId ?? "") · local T3 speech" }
    private var canSend: Bool { !store.gatewayAvailable ? false : route != nil ? row?.canWrite == true && !["approval", "input", "request"].contains(row?.status ?? "") : project?.canCreate == true }
    private var sendLabel: String { route == nil ? "Start chat" : ["working", "waiting"].contains(row?.status ?? "") ? "Queue reply" : "Send" }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(destination).font(.headline).fixedSize(horizontal: false, vertical: true)
                    if voice {
                        if !consent {
                            Text("Record and transcribe on \(voiceDestination). Audio goes through your gateway and is deleted after transcription. Nothing is sent to the chat yet.")
                            Button("Allow and record") { UserDefaults.standard.set(true, forKey: "watch.voiceConsent.\(voiceDestination)"); consent = true; Task { await recorder.start() } }
                            Button("Type instead") { voice = false; editing = true }
                        } else if recorder.recording {
                            Text(String(format: "%d:%02d", Int(recorder.elapsed) / 60, Int(recorder.elapsed) % 60)).font(.largeTitle.monospacedDigit())
                            Text("Up to 5:00").font(.footnote)
                            ProgressView(value: reduceMotion ? 0.5 : Double(recorder.level)).accessibilityLabel("Recording audio")
                            Button("Stop", systemImage: "stop.fill") { recorder.stop(); transcribe() }.tint(.red)
                            Button("Discard recording", role: .destructive) { recorder.discard(); voice = false }
                        } else if busy {
                            ProgressView("Transcribing")
                            Text("Nothing is sent to the chat yet.").font(.footnote)
                            Button("Cancel") { upload?.cancel(); upload = nil; busy = false; recorder.discard(); voice = false }
                        } else if recorder.file != nil {
                            Button("Retry transcription") { transcribe() }
                            Button("Discard recording", role: .destructive) { recorder.discard(); voice = false }
                            Button("Type instead") { voice = false; editing = true }
                        } else { Button("Record") { Task { await recorder.start() } } }
                    }
                    if let error = recorder.error ?? failure { Text(error).foregroundStyle(.orange) }
                    if !voice || !draft.text.isEmpty {
                        TextField("Draft", text: Binding(get: { draft.text }, set: { text in if text != draft.text { draft.text = text; draft.commandId = UUID().uuidString; store.save(draft, key) } }), axis: .vertical).focused($editing).disabled(busy)
                        Text(draft.text).fixedSize(horizontal: false, vertical: true)
                        if let metadata = draft.transcriptDestination { Text("Transcribed on \(metadata)").font(.footnote) }
                        if !canSend { Text("Draft kept. Sending needs a connected environment with write access and no pending request.").font(.footnote).foregroundStyle(.orange) }
                        Button(sendLabel) { Task { await send() } }.tint(.green).disabled(!canSend || draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || busy || recorder.recording)
                        Button("Re-record", systemImage: "mic") { beginVoice() }.disabled(busy)
                        Button("Discard draft", role: .destructive) { recorder.discard(); store.clearDraft(key); dismiss() }.disabled(busy)
                    }
                }.padding(.horizontal, 8)
            }.navigationTitle(route == nil ? "New chat" : "Reply")
                .onAppear { draft = store.draft(key); recorder.restore(draft.audioURL.flatMap(URL.init(string:)), createdAt: draft.audioCreatedAt); if startWithVoice { beginVoice() } else { editing = true } }
                .onChange(of: scenePhase) { _, phase in if phase != .active && recorder.recording { recorder.stop(); failure = "Recording paused. Retry transcription or discard." } }
                .onDisappear { upload?.cancel(); if recorder.recording { recorder.stop() }; if let file = recorder.file { draft.audioURL = file.absoluteString; draft.audioCreatedAt = draft.audioCreatedAt ?? Date() }; store.save(draft, key) }
        }
    }
    private func beginVoice() {
        voice = true; consent = UserDefaults.standard.bool(forKey: "watch.voiceConsent.\(voiceDestination)")
        if consent { Task { await recorder.start() } }
    }
    private func transcribe() {
        guard let file = recorder.file else { return }
        let endpoint: String
        if let route { endpoint = route.endpoint + "/voice" }
        else if let project { endpoint = "/watch/v1/voice/transcriptions?environmentId=\(project.environmentId.urlComponent)&projectId=\(project.projectId.urlComponent)" }
        else { failure = "Choose a destination first."; return }
        draft.audioURL = file.absoluteString; draft.audioCreatedAt = draft.audioCreatedAt ?? Date(); store.save(draft, key)
        busy = true; failure = nil
        upload = Task {
            do {
                let data = try Data(contentsOf: file)
                let result: Transcript = try await store.api.request(endpoint, method: "POST", body: data, type: "audio/mp4")
                try Task.checkCancellation()
                draft.text = result.text; draft.commandId = UUID().uuidString; draft.transcriptDestination = result.destination; draft.audioURL = nil; draft.audioCreatedAt = nil; store.save(draft, key)
                recorder.discard(); voice = false
            } catch { if !Task.isCancelled { failure = error.localizedDescription } }
            busy = false
        }
    }
    private func send() async {
        busy = true; defer { busy = false }
        do {
            store.save(draft, key)
            var payload: [String: Any] = ["commandId": draft.commandId, "text": draft.text]
            let endpoint: String
            if let route { endpoint = route.endpoint + "/messages" }
            else if let project { endpoint = "/watch/v1/threads"; payload["environmentId"] = project.environmentId; payload["projectId"] = project.projectId }
            else { throw WatchFailure("Choose a destination first.") }
            let sent: Sent = try await store.api.post(endpoint, payload)
            let title = route?.title ?? draft.text
            draft = Draft(); store.clearDraft(key); recorder.discard()
            store.path = [ChatRoute(environmentId: sent.environmentId, threadId: sent.threadId, title: title)]
            dismiss(); await store.refresh()
        } catch { failure = error.localizedDescription }
    }
}
