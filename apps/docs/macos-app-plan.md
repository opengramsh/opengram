# Opengram macOS App — Implementation Plan

## Overview

A native macOS app (Swift + SwiftUI) that wraps the existing Opengram web UI in a WKWebView. The Opengram server remains a separate process — the app is purely a client.

**What this gives us over a browser tab:**

- Standalone app in Dock (own icon, Cmd+Tab)
- No browser chrome (no address bar, tabs, bookmarks bar)
- Native macOS notifications (not browser permission prompts)
- Menu bar icon with unread badge
- Auto-launch at login
- Global keyboard shortcut to show/hide
- Multiple server profiles (personal VPS, work server, etc.)

---

## Architecture

```
┌──────────────────────────────────┐
│         macOS App (Swift)        │
│                                  │
│  ┌────────────────────────────┐  │
│  │    SwiftUI Shell           │  │
│  │  - Server profile picker   │  │
│  │  - Settings window         │  │
│  │  - Menu bar icon           │  │
│  └────────────┬───────────────┘  │
│               │                  │
│  ┌────────────▼───────────────┐  │
│  │    WKWebView               │  │
│  │  - Loads remote server URL │  │
│  │  - Auth bootstrapped by    │  │
│  │    the server as usual     │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
          │ HTTPS
          ▼
┌──────────────────────────────────┐
│     Opengram Server (remote)     │
│  - Serves SPA + injects secret   │
│  - REST API + SSE                │
└──────────────────────────────────┘
```

**Key insight:** The Opengram server already serves the SPA with the instance secret injected via `window.__OPENGRAM_BOOTSTRAP__`. The WKWebView just loads the server URL — no special auth bridging needed. Everything works exactly as it does in a browser.

---

## Phase 1: Minimal Viable App

Goal: A working app that connects to an Opengram server and displays the UI.

### 1.1 Project Setup

- Create a new Xcode project: **macOS App → SwiftUI → Swift**
- App name: `Opengram` (bundle ID: `sh.opengram.macos`)
- Deployment target: macOS 14+ (Sonoma) — gives us the latest WKWebView features
- Create the project in a new `macos/` directory at the repo root

**File structure:**

```
macos/
├── Opengram.xcodeproj/
├── Opengram/
│   ├── OpengramApp.swift              # Entry point + app state machine
│   ├── Models/
│   │   ├── ServerProfile.swift        # Saved server profile model
│   │   └── DiscoveredServer.swift     # Auto-discovered server model
│   ├── Services/
│   │   ├── ServerDiscoveryService.swift   # Bonjour + localhost + Tailscale scanning
│   │   ├── HealthProber.swift             # Async health endpoint checker
│   │   └── ServerProfileStore.swift       # UserDefaults persistence
│   ├── Views/
│   │   ├── ServerListView.swift       # Main connection screen
│   │   ├── ManualEntrySheet.swift     # Manual URL entry
│   │   ├── ConnectingView.swift       # Probing/verification spinner
│   │   ├── ConnectionErrorView.swift  # Error states
│   │   ├── ConnectionLostOverlay.swift # Reconnection overlay on WebView
│   │   ├── WebView.swift              # WKWebView NSViewRepresentable wrapper
│   │   └── SettingsView.swift         # Preferences window
│   ├── Assets.xcassets/
│   ├── Opengram.entitlements
│   └── Info.plist
```

### 1.2 WKWebView Wrapper

Create an `NSViewRepresentable` wrapping `WKWebView`:

```swift
struct WebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.load(URLRequest(url: url))
        return webView
    }
}
```

Key configuration:
- Enable JavaScript (required for the React SPA)
- Set a custom `User-Agent` suffix so the server can detect the macOS app if needed
- Handle navigation delegate to intercept external links (open in default browser)
- Enable `WKWebView` persistent storage so localStorage/IndexedDB work across launches (this is the default — just don't use ephemeral configuration)

### 1.3 Server Connection Screen

On first launch (or when no profile is configured), show a connection screen:

```
┌─────────────────────────────────┐
│                                 │
│        [Opengram Logo]          │
│                                 │
│   Server URL                    │
│   ┌───────────────────────────┐ │
│   │ https://opengram.example  │ │
│   └───────────────────────────┘ │
│                                 │
│   Display Name (optional)       │
│   ┌───────────────────────────┐ │
│   │ My Server                 │ │
│   └───────────────────────────┘ │
│                                 │
│          [ Connect ]            │
│                                 │
└─────────────────────────────────┘
```

**Flow:**

1. User enters server URL
2. App calls `GET {url}/api/v1/health` to verify connectivity
3. On success → save profile, load the URL in WKWebView
4. The server's SPA handles auth from there (the existing settings page lets users configure the instance secret, and the bootstrap mechanism injects it)

No need to ask for the instance secret in the native UI — the web SPA already handles it. The user configures auth in the Opengram settings page just like they would in a browser.

### 1.4 Main Window

```swift
@main
struct OpengramApp: App {
    @StateObject private var profileStore = ServerProfileStore()

    var body: some Scene {
        WindowGroup {
            if let profile = profileStore.activeProfile {
                WebView(url: profile.url)
                    .ignoresSafeArea()
            } else {
                ConnectView(store: profileStore)
            }
        }
        .windowStyle(.titleBar)
        .defaultSize(width: 420, height: 780)  // Phone-like default

        Settings {
            SettingsView(store: profileStore)
        }
    }
}
```

### 1.5 Server Profile Persistence

```swift
struct ServerProfile: Codable, Identifiable {
    let id: UUID
    var name: String
    var url: URL
}

class ServerProfileStore: ObservableObject {
    @Published var profiles: [ServerProfile] = []
    @Published var activeProfileId: UUID?

    // Persist to UserDefaults (profiles are not secret — just URLs and names)
    // The instance secret is handled by the web SPA via localStorage inside WKWebView
}
```

### 1.6 Entitlements & Sandboxing

```xml
<!-- Opengram.entitlements -->
<dict>
    <key>com.apple.security.app-sandbox</key>        <true/>
    <key>com.apple.security.network.client</key>     <true/>  <!-- outgoing connections -->
</dict>
```

---

## Phase 2: Native macOS Integration

### 2.1 External Link Handling

Links to external sites (not the Opengram server) should open in the default browser:

```swift
func webView(_ webView: WKWebView,
             decidePolicyFor navigationAction: WKNavigationAction,
             decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url else {
        decisionHandler(.allow)
        return
    }
    // Allow navigation within the Opengram server
    if url.host == serverProfile.url.host {
        decisionHandler(.allow)
    } else {
        NSWorkspace.shared.open(url)  // Open in default browser
        decisionHandler(.cancel)
    }
}
```

### 2.2 File Downloads

WKWebView on macOS needs explicit download handling:

```swift
func webView(_ webView: WKWebView,
             navigationResponse: WKNavigationResponse,
             didBecome download: WKDownload) {
    download.delegate = self
}
```

- Intercept `Content-Disposition: attachment` responses
- Present `NSSavePanel` for the user to choose where to save
- Handle the download via `WKDownloadDelegate`

### 2.3 Window Management

- Remember window position and size across launches (`NSWindow.setFrameAutosaveName`)
- Support multiple windows if the user wants to view multiple servers at once
- Cmd+W closes the window but keeps the app running (standard macOS behavior)

### 2.4 Menu Bar

Add Opengram-specific menu items:

```
Opengram
├── About Opengram
├── Settings...          (Cmd+,)
├── ─────────
├── Switch Server ▸
│   ├── My VPS           (Cmd+1)
│   └── Work Server      (Cmd+2)
│   └── ─────────
│   └── Manage Servers...
├── ─────────
├── Reload               (Cmd+R)
└── Quit                 (Cmd+Q)
```

### 2.5 Keyboard Shortcuts

Forward standard shortcuts to the WKWebView:

- Cmd+C / Cmd+V / Cmd+A — copy/paste/select all (handled natively by WKWebView)
- Cmd+F — find in page (need to wire up `WKWebView.find()` on macOS 16+, or use `evaluateJavaScript` for a custom find)

---

## Phase 3: Notifications

### 3.1 Approach

Two options, from simplest to most native:

**Option A: Let the web SPA handle notifications (simplest)**

WKWebView does NOT support the Web Push API (`PushManager`). So web push notifications won't work from within the app. However:

- The SPA already shows in-app notification banners/sounds
- If the user also has the PWA installed in Safari, they get push notifications there

This may be sufficient for v1.

**Option B: Native notifications via JS→Swift bridge (recommended for v2)**

1. Inject a `WKScriptMessageHandler` that the SPA can call:

```swift
// Swift side
let handler = NotificationHandler()
config.userContentController.add(handler, name: "opengramNotifications")
```

2. Add a small JS shim injected via `WKUserScript` that the SPA detects:

```javascript
// Injected at document start
window.__OPENGRAM_MACOS__ = {
    postNotification: (title, body, chatId) => {
        window.webkit.messageHandlers.opengramNotifications
            .postMessage({ title, body, chatId });
    }
};
```

3. On the Swift side, use `UNUserNotificationCenter` to show native macOS notifications
4. When the user clicks a notification, navigate the WKWebView to the relevant chat

**This requires a small change in the Opengram SPA** to detect `window.__OPENGRAM_MACOS__` and call it instead of/in addition to the Web Notifications API. This is a minimal change (~10 lines in the notification client code).

### 3.2 Badge Count

Update the Dock icon badge with unread count:

```swift
NSApp.dockTile.badgeLabel = unreadCount > 0 ? "\(unreadCount)" : nil
```

The unread count can be obtained by:
- Listening to SSE events via the JS→Swift bridge
- Or polling `GET /api/v1/chats?hasUnread=true` periodically from Swift

---

## Phase 4: Polish & Distribution

### 4.1 App Icon

- Create an app icon based on the Opengram logo
- Provide all required sizes in the asset catalog (16x16 through 1024x1024)

### 4.2 Auto-Launch at Login

Use `SMAppService` (macOS 13+):

```swift
import ServiceManagement

func setLaunchAtLogin(_ enabled: Bool) {
    let service = SMAppService.mainApp
    if enabled {
        try? service.register()
    } else {
        try? service.unregister()
    }
}
```

Expose this as a toggle in Settings.

### 4.3 Global Keyboard Shortcut

Register a global hotkey to show/hide the app (e.g., Cmd+Shift+O):

- Use `NSEvent.addGlobalMonitorForEvents` for background detection
- Use `NSEvent.addLocalMonitorForEvents` for foreground detection
- Or use a library like [HotKey](https://github.com/soffes/HotKey) for simplicity

### 4.4 Settings Window

```
┌─── Settings ──────────────────────────────┐
│                                           │
│  Servers                                  │
│  ┌─────────────────────────────────────┐  │
│  │ ● My VPS     https://og.example.com │  │
│  │   Work       https://work.og.io     │  │
│  └─────────────────────────────────────┘  │
│  [+] [-] [Edit]                           │
│                                           │
│  General                                  │
│  ☑ Launch at login                        │
│  ☐ Show in menu bar                       │
│                                           │
│  Global Shortcut                          │
│  ┌───────────────────┐                    │
│  │   ⌘ ⇧ O          │  [Record]          │
│  └───────────────────┘                    │
│                                           │
└───────────────────────────────────────────┘
```

### 4.5 Code Signing & Notarization

Required for distribution outside the App Store:

1. **Apple Developer account** ($99/year) — required for both distribution paths
2. **Developer ID certificate** — for signing `.app` bundles
3. **Notarization** — submit to Apple for malware scanning
4. Use `xcodebuild` + `notarytool` in CI:

```bash
xcodebuild archive \
  -project macos/Opengram.xcodeproj \
  -scheme Opengram \
  -archivePath build/Opengram.xcarchive

xcodebuild -exportArchive \
  -archivePath build/Opengram.xcarchive \
  -exportPath build/ \
  -exportOptionsPlist ExportOptions.plist

xcrun notarytool submit build/Opengram.app.zip \
  --apple-id "$APPLE_ID" \
  --team-id "$TEAM_ID" \
  --password "$APP_PASSWORD" \
  --wait

xcrun stapler staple build/Opengram.app
```

### 4.6 Distribution Options

| Method | Pros | Cons |
|--------|------|------|
| **GitHub Releases** (`.dmg`) | No review process, immediate updates | User must trust the developer, no auto-discovery |
| **Mac App Store** | Auto-updates, user trust, discoverability | Review process, stricter sandboxing, 30% cut |
| **Homebrew Cask** | Easy install for dev audience (`brew install --cask opengram`) | Need to maintain the formula |
| **Sparkle** (auto-updater) | Auto-updates for direct distribution | Need to host an appcast feed |

**Recommended:** GitHub Releases + Homebrew Cask for v1. Add Sparkle auto-updates later.

### 4.7 Auto-Updates (Sparkle)

[Sparkle](https://sparkle-project.org/) is the standard auto-update framework for macOS apps distributed outside the App Store:

- Embed `Sparkle.framework` via Swift Package Manager
- Host an appcast XML feed (can be on GitHub Pages or in the repo)
- App checks for updates on launch and periodically
- User gets a native update prompt

---

## Phase 5: Optional Enhancements

These are nice-to-haves that can be added incrementally:

### 5.1 Menu Bar Icon (Status Item)

A small Opengram icon in the macOS menu bar:

- Click to show/hide the main window
- Badge with unread count
- Right-click menu: recent chats, quick actions, quit

### 5.2 Quick Note / Quick Reply

- Global shortcut opens a small floating panel
- User types a message → sent to the currently active chat
- Panel dismisses after sending

### 5.3 Drag & Drop

- Drag files from Finder onto the app window to upload
- WKWebView supports this partially; may need `WKUIDelegate` handling

### 5.4 Touch Bar Support (if applicable)

- Show quick actions on Touch Bar-equipped MacBooks

### 5.5 Share Extension

- Add a Share Extension so users can share content from other apps directly into an Opengram chat
- Requires a separate target in the Xcode project

---

## Connection & Discovery UX

This section details the connection/onboarding experience with auto-discovery of running Opengram instances.

**Key insight — the health endpoint is always public.** `GET /api/v1/health` returns `{ service: "opengram", status: "ok", version, uptime }` with no auth. This is the foundation for discovery.

### Server-side: Bonjour/mDNS advertisement

Add `bonjour-service` npm package to the Opengram server so it advertises itself on the local network.

**File:** `src/server.ts` — add after the `serve()` call (line 232)

```typescript
import Bonjour from 'bonjour-service';

// After server starts listening:
const bonjour = new Bonjour();
bonjour.publish({
  name: config.appName || 'Opengram',
  type: 'opengram',
  port,
  txt: { version: pkg.version }
});
```

- Service type: `_opengram._tcp`
- TXT record carries `version` for display before HTTP probe
- Graceful unpublish on SIGINT/SIGTERM (in the existing `shutdown()` handler)
- The `bonjour-service` package is pure JS, no native deps

### Connection Flow

#### Returning user (has a saved last-used server)

```
App launches
    │
    ├─ Health probe last-used server (3s timeout)
    │      │
    │      ├─ Reachable → Load WKWebView immediately (skip server list)
    │      │
    │      └─ Unreachable → Fall through to server list screen
    │
    └─ Show server list (Screen 1)
```

#### First launch / no saved servers

```
App launches → Show server list (Screen 1)
    │
    ├─ Auto-discovery runs in background (Bonjour + localhost + Tailscale)
    │
    ├─ User taps a discovered server → Probe → Connect
    │
    └─ User taps "Add Server Manually" → Manual entry sheet → Probe → Connect
```

### Screens

#### Screen 1: Server List (the home screen)

```
╭───────────────────────────────────────╮
│                                       │
│          (Opengram Icon)              │
│           Opengram                    │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  Searching for servers...   ◌   │  │  ← discovery status
│  └─────────────────────────────────┘  │
│                                       │
│  ● My VPS                      [→]   │  ← saved profile (green = online)
│    https://og.example.com             │
│    v0.1.3 · 2h ago                    │
│  ─────────────────────────────────── │
│  ○ macbook.local:3000   LAN    [→]   │  ← discovered (Bonjour)
│    v0.1.3                             │
│  ─────────────────────────────────── │
│  ○ mybox.ts.net      Tailscale [→]   │  ← discovered (Tailscale)
│    v0.1.3                             │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │  + Add Server Manually          │  │
│  └─────────────────────────────────┘  │
│                                       │
╰───────────────────────────────────────╯
```

**Behavior:**
- On appear, starts 3 parallel discovery channels:
  1. **Bonjour:** `NWBrowser` for `_opengram._tcp` (LAN, event-driven)
  2. **Localhost:** probe ports 3000, 3333, 5173 on 127.0.0.1
  3. **Tailscale:** shell out to `tailscale status --json`, build candidate URLs per the pattern in `packages/openclaw-plugin/src/cli/tailscale.ts`, probe health
- Saved profiles appear at top with reachability indicator (green/gray dot via background health probe)
- Discovered servers that match a saved profile URL are merged (not duplicated)
- Source badges: "LAN" (blue), "Tailscale" (purple), "Local" (green)
- Discovery status bar: "Searching..." → "Found N servers" → "No servers found" (after 5s)
- Tapping a row → Screen 3 (probing) → Screen 5 (connected)
- Right-click on saved profile: Edit, Remove

#### Screen 2: Manual Entry (sheet over Screen 1)

```
╭─────────────────────────────────────╮
│  Add Server                         │
│                                     │
│  Server URL                         │
│  ┌───────────────────────────────┐  │
│  │ https://                      │  │
│  └───────────────────────────────┘  │
│                                     │
│  Display Name (optional)            │
│  ┌───────────────────────────────┐  │
│  │                               │  │
│  └───────────────────────────────┘  │
│                                     │
│         [Cancel]    [Connect]       │
╰─────────────────────────────────────╯
```

- Pre-fills "https://"
- If user types bare hostname, auto-prepend "https://"
- "Connect" disabled until URL is valid
- Display name derived from hostname if left empty

#### Screen 3: Connecting (replaces content, or overlay)

```
     Connecting to
     https://mybox.ts.net

              ◌

     Verifying server...

          [Cancel]
```

- Probes `GET {url}/api/v1/health` (5s timeout)
- Validates `body.service === "opengram"`
- On success: save profile, transition to WKWebView

#### Screen 4: Connection Error

```
     Could not connect to
     https://mybox.ts.net

     ┌─────────────────────────┐
     │  Connection refused     │
     │                         │
     │  The server may not be  │
     │  running, or the port   │
     │  may be wrong.          │
     └─────────────────────────┘

     [Edit URL]    [Try Again]

          [Back to Servers]
```

Error categories:
| Condition | Title |
|---|---|
| DNS failure | "Server not found" |
| Connection refused | "Connection refused" |
| Timeout | "Connection timed out" |
| Response but not Opengram | "Not an Opengram server" |
| SSL error | "Certificate error" + "Connect Anyway" option |

#### Screen 5: Connected (full-bleed WKWebView)

```
╭───── Opengram — My VPS ──────────────╮
│                                       │
│     (Full WKWebView — the SPA)        │
│                                       │
╰───────────────────────────────────────╯
```

- Window title shows server name
- Thin progress bar during page load
- Per-profile `WKWebsiteDataStore` (see Data Isolation below)

#### Screen 6: Connection Lost (overlay on WKWebView)

```
     ┌───────────────────────────┐
     │  Connection lost          │
     │                           │
     │  Reconnecting...     ◌    │
     │                           │
     │  [Switch Server]          │
     └───────────────────────────┘
```

- Triggered on WKWebView navigation failure or background health check failure
- Auto-retries health probe every 3s
- On reconnect: reload WKWebView, dismiss overlay
- Chat content stays visible (dimmed) behind overlay

### Discovery Service Architecture

#### ServerDiscoveryService (ObservableObject)

```swift
@MainActor
class ServerDiscoveryService: ObservableObject {
    @Published var discoveredServers: [DiscoveredServer] = []
    @Published var isScanning: Bool = false

    func startScanning() {
        // 1. Bonjour: NWBrowser(for: .bonjour(type: "_opengram._tcp", domain: "local."), using: .tcp)
        // 2. Localhost: probe ports [3000, 3333, 5173] on 127.0.0.1
        // 3. Tailscale: shell out to `tailscale status --json`, build candidates, probe
        // All run concurrently via TaskGroup
    }

    func stopScanning() { ... }
}
```

#### HealthProber

```swift
struct HealthProber {
    /// Probe a URL's health endpoint. Returns server info or nil.
    static func probe(url: URL, timeout: TimeInterval = 5) async -> HealthResult? {
        // GET {url}/api/v1/health
        // Validate service == "opengram"
        // Return HealthResult(version:, uptime:) or nil
    }
}
```

#### Data Isolation

Each `ServerProfile` gets its own `WKWebsiteDataStore` keyed by profile ID. This ensures:
- localStorage (which holds the instance secret) is scoped per server
- Connecting to Server A cannot leak Server A's secret to Server B's JS context
- Cookies, IndexedDB, cache are all isolated

```swift
func dataStore(for profile: ServerProfile) -> WKWebsiteDataStore {
    WKWebsiteDataStore(forIdentifier: profile.id)  // macOS 14+
}
```

### App State Machine

```swift
enum AppState {
    case serverList                          // Screen 1
    case connecting(ServerProfile)           // Screen 3
    case connectionError(ServerProfile, Error) // Screen 4
    case connected(ServerProfile)            // Screen 5
}
```

```swift
@main
struct OpengramApp: App {
    @StateObject var appState = AppStateManager()
    @StateObject var profileStore = ServerProfileStore()
    @StateObject var discovery = ServerDiscoveryService()

    var body: some Scene {
        WindowGroup {
            switch appState.state {
            case .serverList:
                ServerListView(...)
            case .connecting(let profile):
                ConnectingView(profile: profile)
            case .connectionError(let profile, let error):
                ConnectionErrorView(profile: profile, error: error)
            case .connected(let profile):
                WebView(url: profile.url, dataStore: dataStore(for: profile))
                    .overlay { if appState.connectionLost { ConnectionLostOverlay() } }
            }
        }
        .defaultSize(width: 420, height: 780)

        Settings {
            SettingsView(store: profileStore)
        }
    }
}
```

On launch, `AppStateManager.init()`:
1. If a last-used profile exists → set state to `.connecting(lastProfile)`
2. Probe health in background
3. If reachable within 3s → `.connected(lastProfile)`
4. If unreachable → `.serverList`
5. If no saved profiles → `.serverList`

### Connection & Discovery Implementation Order

| Step | Description | Files |
|------|-------------|-------|
| 1 | Server-side: add `bonjour-service`, advertise on startup | `package.json`, `src/server.ts` |
| 2 | `HealthProber` — async health endpoint checker | `Services/HealthProber.swift` |
| 3 | `ServerDiscoveryService` — Bonjour + localhost + Tailscale | `Services/ServerDiscoveryService.swift` |
| 4 | `ServerListView` — connection home screen with discovery | `Views/ServerListView.swift` |
| 5 | `ManualEntrySheet` — manual URL entry | `Views/ManualEntrySheet.swift` |
| 6 | `ConnectingView` + `ConnectionErrorView` | `Views/` |
| 7 | `AppStateManager` — state machine + auto-connect on launch | `OpengramApp.swift` |
| 8 | `ConnectionLostOverlay` — reconnection UI | `Views/ConnectionLostOverlay.swift` |

### Verification

1. **Bonjour advertising:** Run the server locally, use `dns-sd -B _opengram._tcp` in Terminal to verify the service is advertised
2. **Discovery:** Launch the macOS app on the same LAN — the server should appear in the list within 2-3s
3. **Localhost detection:** Run the server on port 3000, launch the app — should detect under "Local"
4. **Manual entry:** Enter a valid server URL, verify health probe succeeds and WKWebView loads
5. **Invalid URL:** Enter a non-existent URL, verify error screen with appropriate message
6. **Auto-reconnect:** Connect to a server, stop the server, verify connection lost overlay appears, restart server, verify auto-reconnect
7. **Profile persistence:** Connect to a server, quit and relaunch the app, verify it auto-connects to the last server
8. **Data isolation:** Connect to two different servers, verify each has independent localStorage (different instance secrets)

---

## Implementation Order

| Step | What | Effort |
|------|------|--------|
| **1** | Project setup + WKWebView + connect screen | ~1 day |
| **2** | Server profile persistence + settings window | ~0.5 day |
| **3** | External link handling + file downloads | ~0.5 day |
| **4** | Menu bar items + keyboard shortcuts | ~0.5 day |
| **5** | App icon + window management polish | ~0.5 day |
| **6** | Code signing + notarization + DMG | ~0.5 day |
| **7** | Native notifications (JS→Swift bridge) | ~1 day |
| **8** | Dock badge + menu bar status item | ~0.5 day |
| **9** | Auto-launch + global hotkey | ~0.5 day |
| **10** | Sparkle auto-updates | ~0.5 day |
| **11** | Homebrew Cask formula | ~0.5 day |

**Phases 1-2 (steps 1-6):** ~3 days → usable app
**Phase 3 (step 7-8):** ~1.5 days → notifications
**Phase 4 (steps 9-11):** ~1.5 days → distribution polish

---

## Open Questions

1. **App name:** "Opengram" or "Opengram Desktop" or "Opengram for Mac"?
2. **Multiple windows:** Should Cmd+N open a new window to the same server, or allow connecting to a different server?
3. **Offline behavior:** Show a native "no connection" screen, or let the SPA's own offline handling take over?
4. **Deep links:** Support `opengram://` URL scheme for opening specific chats from other apps?
5. **Minimum macOS version:** 14 (Sonoma) is recommended for latest WKWebView features, but 13 (Ventura) is feasible if wider compatibility is needed.
