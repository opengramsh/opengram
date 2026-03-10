import SwiftUI

struct ServerListView: View {
    @ObservedObject var profileStore: ServerProfileStore
    @ObservedObject var discovery: ServerDiscoveryService
    let onConnect: (ServerProfile) -> Void

    @State private var showManualEntry = false
    @State private var profileHealth: [UUID: HealthResult] = [:]
    @State private var editingProfile: ServerProfile?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            serverList
        }
        .frame(minWidth: 360, minHeight: 400)
        .onAppear {
            discovery.startScanning()
            probeProfiles()
        }
        .onDisappear {
            discovery.stopScanning()
        }
        .sheet(isPresented: $showManualEntry) {
            ManualEntrySheet { profile in
                profileStore.addProfile(profile)
                onConnect(profile)
            }
        }
        .sheet(item: $editingProfile) { profile in
            EditProfileSheet(profile: profile) { updated in
                profileStore.updateProfile(updated)
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 8) {
            Image("Logo")
                .resizable()
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.top, 32)

            Text("Opengram")
                .font(.title.bold())

            discoveryStatus
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.bottom, 16)
        }
    }

    private var discoveryStatus: some View {
        Group {
            if discovery.isScanning {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Searching for servers...")
                }
            } else if discovery.discoveredServers.isEmpty && profileStore.profiles.isEmpty {
                Text("No servers found")
            } else {
                let count = allServers.count
                Text("Found \(count) server\(count == 1 ? "" : "s")")
            }
        }
    }

    // MARK: - Server list

    private var allServers: [ServerListItem] {
        var items: [ServerListItem] = []

        // Saved profiles first
        for profile in profileStore.profiles {
            items.append(.saved(profile, health: profileHealth[profile.id]))
        }

        // Discovered servers that don't match a saved profile
        let savedHosts = Set(profileStore.profiles.map { $0.url.absoluteString })
        for server in discovery.discoveredServers {
            if !savedHosts.contains(server.url.absoluteString) {
                items.append(.discovered(server))
            }
        }

        return items
    }

    private var serverList: some View {
        List {
            ForEach(allServers) { item in
                serverRow(item)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        connectToItem(item)
                    }
                    .contextMenu {
                        if case .saved(let profile, _) = item {
                            Button("Edit") {
                                editingProfile = profile
                            }
                            Divider()
                            Button("Remove", role: .destructive) {
                                profileStore.removeProfile(profile)
                            }
                        }
                    }
            }

            Button {
                showManualEntry = true
            } label: {
                Label("Add Server Manually", systemImage: "plus")
            }
            .buttonStyle(.plain)
            .padding(.vertical, 8)
        }
        .listStyle(.inset)
    }

    private func serverRow(_ item: ServerListItem) -> some View {
        HStack {
            Circle()
                .fill(item.isOnline ? Color.green : Color.gray.opacity(0.4))
                .frame(width: 8, height: 8)

            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(item.displayName)
                        .fontWeight(.medium)
                    if let badge = item.sourceBadge {
                        Text(badge)
                            .font(.caption2)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(item.badgeColor.opacity(0.15))
                            .foregroundStyle(item.badgeColor)
                            .clipShape(Capsule())
                    }
                }
                Text(item.urlString)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let version = item.version {
                    Text("v\(version)")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .foregroundStyle(.tertiary)
                .font(.caption)
        }
        .padding(.vertical, 4)
    }

    // MARK: - Actions

    private func connectToItem(_ item: ServerListItem) {
        switch item {
        case .saved(let profile, _):
            onConnect(profile)
        case .discovered(let server):
            let profile = ServerProfile(name: server.displayName, url: server.url)
            profileStore.addProfile(profile)
            onConnect(profile)
        }
    }

    private func probeProfiles() {
        for profile in profileStore.profiles {
            Task {
                if let result = await HealthProber.probe(url: profile.url, timeout: 3) {
                    profileHealth[profile.id] = result
                }
            }
        }
    }
}

// MARK: - Server list item

enum ServerListItem: Identifiable {
    case saved(ServerProfile, health: HealthResult?)
    case discovered(DiscoveredServer)

    var id: String {
        switch self {
        case .saved(let p, _): return p.id.uuidString
        case .discovered(let s): return s.id
        }
    }

    var displayName: String {
        switch self {
        case .saved(let p, _): return p.name
        case .discovered(let s): return s.displayName
        }
    }

    var urlString: String {
        switch self {
        case .saved(let p, _): return p.url.absoluteString
        case .discovered(let s): return s.url.absoluteString
        }
    }

    var isOnline: Bool {
        switch self {
        case .saved(_, let health): return health != nil
        case .discovered: return true  // discovered = already reachable
        }
    }

    var version: String? {
        switch self {
        case .saved(_, let health): return health?.version
        case .discovered(let s): return s.version
        }
    }

    var sourceBadge: String? {
        switch self {
        case .saved: return nil
        case .discovered(let s): return s.source.rawValue
        }
    }

    var badgeColor: Color {
        switch self {
        case .saved: return .clear
        case .discovered(let s):
            switch s.source {
            case .bonjour: return .blue
            case .localhost: return .green
            case .tailscale: return .purple
            }
        }
    }
}
