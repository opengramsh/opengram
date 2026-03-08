import SwiftUI
import WebKit

struct WebView: NSViewRepresentable {
    let url: URL
    let profileId: UUID

    func makeCoordinator() -> Coordinator {
        Coordinator(serverHost: url.host())
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        // Per-profile data store for isolation (macOS 14+)
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: profileId)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.customUserAgent = "Opengram-macOS/0.1.0 " + (webView.value(forKey: "_userAgent") as? String ?? "")
        webView.allowsBackForwardNavigationGestures = true

        webView.load(URLRequest(url: url))
        context.coordinator.webView = webView
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        // Only reload if the URL changed
        if webView.url?.host() != url.host() {
            webView.load(URLRequest(url: url))
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate {
        let serverHost: String?
        weak var webView: WKWebView?

        init(serverHost: String?) {
            self.serverHost = serverHost
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            // Allow navigation within the Opengram server
            if url.host() == serverHost || url.scheme == "about" || url.scheme == "blob" {
                decisionHandler(.allow)
            } else {
                // Open external links in the default browser
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
            }
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
    }
}

extension Notification.Name {
    static let webViewNavigationFailed = Notification.Name("webViewNavigationFailed")
}
