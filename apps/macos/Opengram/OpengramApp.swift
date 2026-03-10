import SwiftUI
import Sparkle
import UserNotifications
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

// MARK: - App Delegate

@MainActor
class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    var profileStore: ServerProfileStore?
    var appState: AppStateManager?
    var notificationService: NotificationService?
    var updaterService: UpdaterService?

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            for window in sender.windows {
                window.makeKeyAndOrderFront(self)
            }
        }
        return true
    }

    // MARK: - Status Item

    func setupStatusItem() {
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem = item
        updateStatusItemIcon(unreadCount: notificationService?.unreadCount ?? 0)
        rebuildMenu()
    }

    func teardownStatusItem() {
        if let item = statusItem {
            NSStatusBar.system.removeStatusItem(item)
            statusItem = nil
        }
    }

    func updateStatusItemIcon(unreadCount: Int) {
        guard let button = statusItem?.button else { return }
        button.image = Self.renderMenuBarIcon(unreadCount: unreadCount)
    }

    func rebuildMenu() {
        guard let statusItem else { return }

        let menu = NSMenu()

        // Active profile header
        if let profile = profileStore?.activeProfile {
            let headerItem = NSMenuItem(title: profile.name, action: nil, keyEquivalent: "")
            headerItem.isEnabled = false
            headerItem.attributedTitle = NSAttributedString(
                string: profile.name,
                attributes: [.font: NSFont.boldSystemFont(ofSize: 13)]
            )
            menu.addItem(headerItem)
            menu.addItem(NSMenuItem.separator())
        }

        // Server list
        if let profiles = profileStore?.profiles {
            for profile in profiles {
                let item = NSMenuItem(title: profile.name, action: #selector(switchServer(_:)), keyEquivalent: "")
                item.target = self
                item.representedObject = profile
                if profile.id == profileStore?.activeProfileId {
                    item.state = .on
                }
                menu.addItem(item)
            }
            menu.addItem(NSMenuItem.separator())
        }

        // Show Opengram
        let showItem = NSMenuItem(title: "Show Opengram", action: #selector(showApp), keyEquivalent: "O")
        showItem.keyEquivalentModifierMask = [.command, .shift]
        showItem.target = self
        menu.addItem(showItem)

        // Reload Page
        let reloadItem = NSMenuItem(title: "Reload Page", action: #selector(reloadPage), keyEquivalent: "r")
        reloadItem.keyEquivalentModifierMask = .command
        reloadItem.target = self
        menu.addItem(reloadItem)

        // Check for Updates
        let updateItem = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdates), keyEquivalent: "")
        updateItem.target = self
        menu.addItem(updateItem)

        menu.addItem(NSMenuItem.separator())

        // Quit
        let quitItem = NSMenuItem(title: "Quit Opengram", action: #selector(quitApp), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    // MARK: - Menu Actions

    @objc func switchServer(_ sender: NSMenuItem) {
        guard let profile = sender.representedObject as? ServerProfile else { return }
        profileStore?.setActive(profile)
        appState?.connect(to: profile)
        rebuildMenu()
    }

    @objc func showApp() {
        NSApp.activate(ignoringOtherApps: true)
        for window in NSApp.windows where window.canBecomeKey {
            window.makeKeyAndOrderFront(nil)
        }
    }

    @objc func reloadPage() {
        NotificationCenter.default.post(name: .webViewShouldReload, object: nil)
    }

    @objc func checkForUpdates() {
        updaterService?.checkForUpdates()
    }

    @objc func quitApp() {
        NSApp.terminate(nil)
    }

    // MARK: - Icon Rendering

    static func renderMenuBarIcon(unreadCount: Int) -> NSImage {
        let symbolConfig = NSImage.SymbolConfiguration(pointSize: 16, weight: .regular)
        guard let baseIcon = NSImage(systemSymbolName: "paperplane.fill", accessibilityDescription: "Opengram")?
            .withSymbolConfiguration(symbolConfig) else {
            return NSImage()
        }

        if unreadCount == 0 {
            let img = baseIcon.copy() as! NSImage
            img.isTemplate = true
            return img
        }

        // Draw icon with red badge dot
        let size = NSSize(width: 22, height: 22)
        let image = NSImage(size: size, flipped: false) { rect in
            // Draw the base icon centered
            let iconSize = baseIcon.size
            let iconOrigin = NSPoint(
                x: (rect.width - iconSize.width) / 2,
                y: (rect.height - iconSize.height) / 2
            )
            baseIcon.draw(in: NSRect(origin: iconOrigin, size: iconSize))

            // Draw red badge dot at top-right
            let dotSize: CGFloat = 7
            let dotRect = NSRect(
                x: rect.width - dotSize - 1,
                y: rect.height - dotSize - 1,
                width: dotSize,
                height: dotSize
            )
            NSColor.systemRed.setFill()
            NSBezierPath(ovalIn: dotRect).fill()

            return true
        }
        image.isTemplate = false
        return image
    }
}

// MARK: - Window Accessor

private struct WindowAccessor: NSViewRepresentable {
    let autosaveName: String

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            let hadSavedFrame = UserDefaults.standard.string(forKey: "NSWindow Frame \(autosaveName)") != nil
            window.setFrameAutosaveName(autosaveName)
            if !hadSavedFrame {
                window.zoom(nil)
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

// MARK: - App Entry Point

@main
struct OpengramApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppStateManager()
    @StateObject private var profileStore = ServerProfileStore()
    @StateObject private var discovery = ServerDiscoveryService()
    @StateObject private var webViewProgress = WebViewProgressTracker()
    @StateObject private var notificationService = NotificationService()
    @StateObject private var shortcutService = GlobalShortcutService()
    @StateObject private var updaterService = UpdaterService()
    @AppStorage("showInMenuBar") private var showInMenuBar = false
    @State private var showFindBar = false
    @State private var findText = ""

    var body: some Scene {
        WindowGroup {
            contentView
                .frame(minWidth: 380, minHeight: 600)
                .background(WindowAccessor(autosaveName: "MainWindow"))
                .onAppear {
                    appState.autoConnect(profileStore: profileStore)
                    notificationService.requestPermission()
                    setupGlobalShortcut()
                    updaterService.startObserving()

                    // Wire AppDelegate references for status item
                    appDelegate.profileStore = profileStore
                    appDelegate.appState = appState
                    appDelegate.notificationService = notificationService
                    appDelegate.updaterService = updaterService
                    if showInMenuBar {
                        appDelegate.setupStatusItem()
                    }
                }
                .onChange(of: appState.state) { _, newState in
                    if case .connected = newState { } else {
                        showFindBar = false
                        findText = ""
                    }
                }
                .onChange(of: showInMenuBar) { _, show in
                    if show {
                        appDelegate.setupStatusItem()
                    } else {
                        appDelegate.teardownStatusItem()
                    }
                }
                .onChange(of: notificationService.unreadCount) { _, count in
                    appDelegate.updateStatusItemIcon(unreadCount: count)
                }
                .onChange(of: profileStore.activeProfileId) { _, _ in
                    appDelegate.rebuildMenu()
                }
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 1200, height: 800)
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    updaterService.checkForUpdates()
                }
                .disabled(!updaterService.canCheckForUpdates)
            }

            CommandMenu("Server") {
                ForEach(Array(profileStore.profiles.prefix(9).enumerated()), id: \.element.id) { index, profile in
                    Toggle(profile.name, isOn: Binding(
                        get: { profileStore.activeProfileId == profile.id },
                        set: { _ in
                            profileStore.setActive(profile)
                            appState.connect(to: profile)
                        }
                    ))
                    .keyboardShortcut(KeyEquivalent(Character(String(index + 1))), modifiers: .command)
                }

                if profileStore.profiles.count > 9 {
                    ForEach(Array(profileStore.profiles.dropFirst(9))) { profile in
                        Toggle(profile.name, isOn: Binding(
                            get: { profileStore.activeProfileId == profile.id },
                            set: { _ in
                                profileStore.setActive(profile)
                                appState.connect(to: profile)
                            }
                        ))
                    }
                }

                Divider()

                Button("Manage Servers…") {
                    appState.disconnect()
                }
            }

            CommandGroup(after: .toolbar) {
                Button("Reload Page") {
                    NotificationCenter.default.post(name: .webViewShouldReload, object: nil)
                }
                .keyboardShortcut("r", modifiers: .command)
                .disabled(!isConnected)
            }

            CommandGroup(after: .pasteboard) {
                Divider()

                Button("Find…") {
                    showFindBar.toggle()
                    if !showFindBar {
                        findText = ""
                        NotificationCenter.default.post(name: .webViewShouldDismissFind, object: nil)
                    }
                }
                .keyboardShortcut("f", modifiers: .command)
                .disabled(!isConnected)
            }
        }

        Settings {
            SettingsView(profileStore: profileStore, shortcutService: shortcutService, updaterService: updaterService)
        }

        // Menu bar icon is managed programmatically via AppDelegate.setupStatusItem()
        // to support dynamic badge overlays (unread count dot).
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
            ZStack(alignment: .top) {
                WebView(url: profile.url, profileId: profile.id, notificationService: notificationService, progressTracker: webViewProgress)
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    if webViewProgress.isLoading {
                        ProgressView(value: webViewProgress.estimatedProgress)
                            .progressViewStyle(.linear)
                            .tint(.accentColor)
                            .frame(height: 2)
                    }

                    if showFindBar {
                        findBarView
                            .padding(.top, 4)
                    }
                }

                if appState.connectionLost {
                    ConnectionLostOverlay {
                        appState.disconnect()
                    }
                }
            }
            .navigationTitle("Opengram — \(profile.name)")
        }
    }

    private var isConnected: Bool {
        if case .connected = appState.state { return true }
        return false
    }

    @ViewBuilder
    private var findBarView: some View {
        HStack(spacing: 6) {
            TextField("Find in page", text: $findText)
                .textFieldStyle(.roundedBorder)
                .frame(width: 200)
                .onSubmit {
                    postFind(forward: true)
                }

            Button(action: { postFind(forward: false) }) {
                Image(systemName: "chevron.up")
            }
            .buttonStyle(.borderless)
            .disabled(findText.isEmpty)

            Button(action: { postFind(forward: true) }) {
                Image(systemName: "chevron.down")
            }
            .buttonStyle(.borderless)
            .disabled(findText.isEmpty)

            Button(action: { dismissFindBar() }) {
                Image(systemName: "xmark")
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.bar)
        .cornerRadius(8)
        .shadow(radius: 2)
        .padding(.horizontal, 8)
    }

    private func postFind(forward: Bool) {
        guard !findText.isEmpty else { return }
        NotificationCenter.default.post(
            name: .webViewShouldFind,
            object: nil,
            userInfo: ["text": findText, "forward": forward]
        )
    }

    private func dismissFindBar() {
        showFindBar = false
        findText = ""
        NotificationCenter.default.post(name: .webViewShouldDismissFind, object: nil)
    }

    private func setupGlobalShortcut() {
        shortcutService.onToggle = {
            if NSApp.isActive {
                NSApp.hide(nil)
            } else {
                NSApp.activate(ignoringOtherApps: true)
                for window in NSApp.windows where window.canBecomeKey {
                    window.makeKeyAndOrderFront(nil)
                }
            }
        }
    }
}
