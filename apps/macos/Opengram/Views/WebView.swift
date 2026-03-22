import AVFoundation
import SwiftUI
import WebKit

/// Observable object to expose WKWebView loading progress to SwiftUI.
@MainActor
class WebViewProgressTracker: ObservableObject {
    @Published var estimatedProgress: Double = 0
    @Published var isLoading: Bool = false
}

struct WebView: NSViewRepresentable {
    let url: URL
    let profileId: UUID
    let notificationService: NotificationService
    @ObservedObject var progressTracker: WebViewProgressTracker

    func makeCoordinator() -> Coordinator {
        Coordinator(serverURL: url, notificationService: notificationService, progressTracker: progressTracker)
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.applicationNameForUserAgent = "Opengram-macOS/0.1.0"
        // Per-profile data store for isolation (macOS 14+)
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: profileId)

        // Inject the macOS native bridge at document start so it's available
        // before the React SPA mounts
        let bridgeScript = WKUserScript(
            source: """
            window.__OPENGRAM_MACOS__ = {
                postNotification: function(title, subtitle, body, chatId) {
                    window.webkit.messageHandlers.opengramNative.postMessage({
                        type: 'notification', title: title, subtitle: subtitle, body: body, chatId: chatId
                    });
                },
                updateBadge: function(count) {
                    window.webkit.messageHandlers.opengramNative.postMessage({
                        type: 'badge', count: count
                    });
                }
            };
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(bridgeScript)
        config.userContentController.add(context.coordinator, name: "opengramNative")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true

        webView.load(URLRequest(url: url))
        context.coordinator.webView = webView
        context.coordinator.startObserving()
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // Only reload if the URL changed
        if webView.url?.host() != url.host() {
            webView.load(URLRequest(url: url))
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
        let serverURL: URL
        let serverHost: String?
        private let notificationService: NotificationService
        private let progressTracker: WebViewProgressTracker
        weak var webView: WKWebView?
        private var progressObservation: NSKeyValueObservation?
        private var loadingObservation: NSKeyValueObservation?
        private var reloadObserver: Any?
        private var findObserver: Any?
        private var dismissFindObserver: Any?
        private var navigateObserver: Any?

        init(serverURL: URL, notificationService: NotificationService, progressTracker: WebViewProgressTracker) {
            self.serverURL = serverURL
            self.serverHost = serverURL.host()
            self.notificationService = notificationService
            self.progressTracker = progressTracker
            super.init()

            // Observe reload notifications from AppStateManager reconnect logic
            reloadObserver = NotificationCenter.default.addObserver(
                forName: .webViewShouldReload,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.webView?.reload()
            }

            // Observe find-in-page notifications
            findObserver = NotificationCenter.default.addObserver(
                forName: .webViewShouldFind,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let text = notification.userInfo?["text"] as? String,
                      let forward = notification.userInfo?["forward"] as? Bool,
                      !text.isEmpty else { return }
                let escaped = text
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                    .replacingOccurrences(of: "\n", with: "\\n")
                    .replacingOccurrences(of: "\r", with: "\\r")
                self?.webView?.evaluateJavaScript("window.find('\(escaped)', false, \(!forward), true)")
            }

            dismissFindObserver = NotificationCenter.default.addObserver(
                forName: .webViewShouldDismissFind,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.webView?.evaluateJavaScript("window.getSelection().removeAllRanges()")
            }

            // Observe notification click navigation
            navigateObserver = NotificationCenter.default.addObserver(
                forName: .webViewShouldNavigate,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                guard let chatId = notification.userInfo?["chatId"] as? String,
                      let webView = self?.webView else { return }
                // Dispatch a custom event that the web app listens for to navigate
                // via React Router (no full page reload)
                let escaped = chatId
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "'", with: "\\'")
                webView.evaluateJavaScript(
                    "window.dispatchEvent(new CustomEvent('opengram:navigate', { detail: { chatId: '\(escaped)' } }))"
                )
            }
        }

        deinit {
            if let observer = reloadObserver {
                NotificationCenter.default.removeObserver(observer)
            }
            if let observer = findObserver {
                NotificationCenter.default.removeObserver(observer)
            }
            if let observer = dismissFindObserver {
                NotificationCenter.default.removeObserver(observer)
            }
            if let observer = navigateObserver {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        /// Start KVO on the webView for progress and loading state.
        func startObserving() {
            guard let webView else { return }

            progressObservation = webView.observe(\.estimatedProgress, options: .new) { [weak self] _, change in
                guard let progress = change.newValue else { return }
                Task { @MainActor in
                    self?.progressTracker.estimatedProgress = progress
                }
            }

            loadingObservation = webView.observe(\.isLoading, options: .new) { [weak self] _, change in
                guard let loading = change.newValue else { return }
                Task { @MainActor in
                    self?.progressTracker.isLoading = loading
                }
            }
        }

        // MARK: - WKScriptMessageHandler

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }

            switch type {
            case "notification":
                let title = body["title"] as? String ?? "Opengram"
                let subtitle = body["subtitle"] as? String ?? ""
                let msgBody = body["body"] as? String ?? "New message"
                let chatId = body["chatId"] as? String
                Task { @MainActor in
                    notificationService.showNotification(title: title, subtitle: subtitle, body: msgBody, chatId: chatId)
                }
            case "badge":
                let count = body["count"] as? Int ?? 0
                Task { @MainActor in
                    notificationService.updateBadge(count: count)
                }
            default:
                break
            }
        }

        // MARK: - WKNavigationDelegate

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            preferences: WKWebpagePreferences,
            decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow, preferences)
                return
            }

            // Handle <a download> clicks — route to WKDownloadDelegate
            if navigationAction.shouldPerformDownload {
                decisionHandler(.download, preferences)
                return
            }

            // Allow navigation within the Opengram server
            if url.host() == serverHost || url.scheme == "about" || url.scheme == "blob" {
                decisionHandler(.allow, preferences)
            } else {
                // Open external links in the default browser
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel, preferences)
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationResponse: WKNavigationResponse,
            decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
        ) {
            if navigationResponse.canShowMIMEType {
                decisionHandler(.allow)
            } else {
                decisionHandler(.download)
            }
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
            download.delegate = self
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            NotificationCenter.default.post(
                name: .webViewNavigationFailed,
                object: nil,
                userInfo: ["error": error]
            )
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation!,
            withError error: Error
        ) {
            NotificationCenter.default.post(
                name: .webViewNavigationFailed,
                object: nil,
                userInfo: ["error": error]
            )
        }

        // MARK: - WKDownloadDelegate

        func download(
            _ download: WKDownload,
            decideDestinationUsing response: URLResponse,
            suggestedFilename: String,
            completionHandler: @escaping (URL?) -> Void
        ) {
            let savePanel = NSSavePanel()
            savePanel.nameFieldStringValue = suggestedFilename
            savePanel.canCreateDirectories = true

            guard let window = webView?.window else {
                let result = savePanel.runModal()
                completionHandler(result == .OK ? savePanel.url : nil)
                return
            }

            savePanel.beginSheetModal(for: window) { result in
                completionHandler(result == .OK ? savePanel.url : nil)
            }
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            guard let window = webView?.window else { return }
            Task { @MainActor in
                let alert = NSAlert()
                alert.messageText = "Download Failed"
                alert.informativeText = error.localizedDescription
                alert.alertStyle = .warning
                alert.addButton(withTitle: "OK")
                alert.beginSheetModal(for: window)
            }
        }

        func downloadDidFinish(_ download: WKDownload) {
            // Download completed successfully
        }

        // MARK: - WKUIDelegate

        /// Handle target="_blank" links
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }

            if url.host() == serverHost {
                // Same-host link: navigate in the current webView
                webView.load(navigationAction.request)
            } else {
                // External link: open in default browser
                NSWorkspace.shared.open(url)
            }
            return nil
        }

        /// JS alert()
        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = message
            alert.addButton(withTitle: "OK")
            alert.runModal()
            completionHandler()
        }

        /// JS confirm()
        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = message
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Cancel")
            let response = alert.runModal()
            completionHandler(response == .alertFirstButtonReturn)
        }

        /// JS prompt()
        func webView(
            _ webView: WKWebView,
            runJavaScriptTextInputPanelWithPrompt prompt: String,
            defaultText: String?,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (String?) -> Void
        ) {
            let alert = NSAlert()
            alert.messageText = prompt
            alert.addButton(withTitle: "OK")
            alert.addButton(withTitle: "Cancel")

            let textField = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
            textField.stringValue = defaultText ?? ""
            alert.accessoryView = textField

            let response = alert.runModal()
            completionHandler(response == .alertFirstButtonReturn ? textField.stringValue : nil)
        }

        /// Handle getUserMedia() — request OS microphone permission, then grant to web content
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            let requiresMicrophone: Bool
            switch type {
            case .microphone, .cameraAndMicrophone:
                // Some WebKit paths can request camera+microphone even for audio-first flows.
                // We treat both as microphone-gated for voice notes.
                requiresMicrophone = true
            default:
                requiresMicrophone = false
            }

            guard requiresMicrophone else {
                print("[WebView] Denying media capture for unsupported type=\(type.rawValue) origin=\(origin.host)")
                decisionHandler(.deny)
                return
            }

            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            print("[WebView] Media capture requested type=\(type.rawValue) origin=\(origin.host) audioStatus=\(status.rawValue)")

            switch status {
            case .authorized:
                decisionHandler(.grant)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        print("[WebView] Microphone access prompt resolved granted=\(granted)")
                        decisionHandler(granted ? .grant : .deny)
                    }
                }
            default:
                print("[WebView] Denying media capture because audioStatus=\(status.rawValue)")
                decisionHandler(.deny)
            }
        }

        /// Handle <input type="file"> — show native file picker
        func webView(
            _ webView: WKWebView,
            runOpenPanelWith parameters: WKOpenPanelParameters,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping ([URL]?) -> Void
        ) {
            DispatchQueue.main.async {
                let panel = NSOpenPanel()
                panel.allowsMultipleSelection = parameters.allowsMultipleSelection
                panel.canChooseFiles = true
                panel.canChooseDirectories = false

                panel.begin { response in
                    if response == .OK {
                        completionHandler(panel.urls)
                    } else {
                        completionHandler(nil)
                    }
                }
            }
        }
    }
}

extension Notification.Name {
    static let webViewNavigationFailed = Notification.Name("webViewNavigationFailed")
    static let webViewShouldFind = Notification.Name("webViewShouldFind")
    static let webViewShouldDismissFind = Notification.Name("webViewShouldDismissFind")
    static let webViewShouldNavigate = Notification.Name("webViewShouldNavigate")
}
