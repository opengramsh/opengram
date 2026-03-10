import AppKit
import Foundation
import UserNotifications

@MainActor
class NotificationService: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    @Published private(set) var isAuthorized = false
    @Published private(set) var unreadCount: Int = 0

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            Task { @MainActor in
                self.isAuthorized = granted
            }
        }
    }

    func showNotification(title: String, subtitle: String, body: String, chatId: String?) {
        let content = UNMutableNotificationContent()
        content.title = title
        if !subtitle.isEmpty { content.subtitle = subtitle }
        content.body = body
        // Don't set content.sound — the web app already plays its own notification tone

        if let chatId {
            content.userInfo["chatId"] = chatId
        }

        // Use chatId as identifier so new messages in the same chat replace previous notifications
        let identifier = chatId.map { "chat:\($0)" } ?? UUID().uuidString
        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request)
    }

    func updateBadge(count: Int) {
        self.unreadCount = count
        NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show banner notifications even when the app is in the foreground.
    /// The web app's JS bridge already suppresses notifications for the active chat,
    /// so any notification that reaches here should be displayed.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner])
    }

    /// Handle notification click — navigate to the relevant chat.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        if let chatId = userInfo["chatId"] as? String {
            Task { @MainActor in
                // Bring the app to the foreground
                NSApp.activate(ignoringOtherApps: true)
                for window in NSApp.windows {
                    window.makeKeyAndOrderFront(nil)
                }

                // Tell the WebView to navigate to this chat
                NotificationCenter.default.post(
                    name: .webViewShouldNavigate,
                    object: nil,
                    userInfo: ["chatId": chatId]
                )
            }
        }
        completionHandler()
    }
}
