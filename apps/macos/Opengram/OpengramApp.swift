import SwiftUI
import WebKit

// MARK: - App State

enum AppConnectionState: Equatable {
    case serverList
    case connecting(ServerProfile)
    case connectionError(ServerProfile, String)  // String because Error isn't Equatable
    case connected(ServerProfile)

    static func == (lhs: AppConnectionState, rhs: AppConnectionState) -> Bool {
        switch (lhs, rhs) {
        case (.serverList, .serverList): return true
        case (.connecting(let a), .connecting(let b)): return a == b
        case (.connectionError(let a, _), .connectionError(let b, _)): return a == b
        case (.connected(let a), .connected(let b)): return a == b
        default: return false
        }
    }
}

// MARK: - App State Manager

@MainActor
class AppStateManager: ObservableObject {
    @Published var state: AppConnectionState = .serverList
    @Published var connectionLost = false

    private var healthCheckTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?

    func connect(to profile: ServerProfile) {
        state = .connecting(profile)
        connectionLost = false
        stopHealthCheck()

        Task {
            if let _ = await HealthProber.probe(url: profile.url, timeout: 5) {
                state = .connected(profile)
                startHealthCheck(for: profile)
            } else {
                state = .connectionError(
                    profile,
                    "Could not reach the server. It may not be running."
                )
            }
        }
    }

    func disconnect() {
        stopHealthCheck()
        stopReconnect()
        connectionLost = false
        state = .serverList
    }

    func retry(profile: ServerProfile) {
        connect(to: profile)
    }

    /// Auto-connect to last used profile on launch.
    func autoConnect(profileStore: ServerProfileStore) {
        guard let profile = profileStore.activeProfile else { return }
        connect(to: profile)
    }

    // MARK: - Background health check

    private func startHealthCheck(for profile: ServerProfile) {
        healthCheckTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if Task.isCancelled { break }

                let reachable = await HealthProber.probe(url: profile.url, timeout: 5) != nil
                if !reachable && !connectionLost {
                    connectionLost = true
                    startReconnect(for: profile)
                }
            }
        }
    }

    private func stopHealthCheck() {
        healthCheckTask?.cancel()
        healthCheckTask = nil
    }

    private func startReconnect(for profile: ServerProfile) {
        reconnectTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if Task.isCancelled { break }

                if let _ = await HealthProber.probe(url: profile.url, timeout: 5) {
                    connectionLost = false
                    // Post notification so WebView can reload
                    NotificationCenter.default.post(name: .webViewShouldReload, object: nil)
                    break
                }
            }
        }
    }

    private func stopReconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
    }
}

extension Notification.Name {
    static let webViewShouldReload = Notification.Name("webViewShouldReload")
}

// MARK: - App Entry Point

@main
struct OpengramApp: App {
    @StateObject private var appState = AppStateManager()
    @StateObject private var profileStore = ServerProfileStore()
    @StateObject private var discovery = ServerDiscoveryService()

    var body: some Scene {
        WindowGroup {
            contentView
                .frame(minWidth: 380, minHeight: 600)
                .onAppear {
                    appState.autoConnect(profileStore: profileStore)
                }
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 420, height: 780)

        Settings {
            SettingsView(store: profileStore)
        }
    }

    @ViewBuilder
    private var contentView: some View {
        switch appState.state {
        case .serverList:
            ServerListView(
                profileStore: profileStore,
                discovery: discovery
            ) { profile in
                profileStore.setActive(profile)
                appState.connect(to: profile)
            }

        case .connecting(let profile):
            ConnectingView(profile: profile) {
                appState.disconnect()
            }

        case .connectionError(let profile, let message):
            ConnectionErrorView(
                profile: profile,
                error: NSError(domain: "Opengram", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: message
                ]),
                onRetry: { appState.retry(profile: profile) },
                onEditURL: { appState.disconnect() },
                onBack: { appState.disconnect() }
            )

        case .connected(let profile):
            ZStack {
                WebView(url: profile.url, profileId: profile.id)
                    .ignoresSafeArea()

                if appState.connectionLost {
                    ConnectionLostOverlay {
                        appState.disconnect()
                    }
                }
            }
            .navigationTitle("Opengram — \(profile.name)")
        }
    }
}
