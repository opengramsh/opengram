import Foundation

enum DiscoverySource: String {
    case bonjour = "LAN"
    case localhost = "Local"
    case tailscale = "Tailscale"
}

struct DiscoveredServer: Identifiable, Hashable {
    let id: String  // URL string used as stable identity
    let url: URL
    let source: DiscoverySource
    var version: String?
    var name: String?

    var displayName: String {
        name ?? url.host() ?? url.absoluteString
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: DiscoveredServer, rhs: DiscoveredServer) -> Bool {
        lhs.id == rhs.id
    }
}
