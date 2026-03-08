import Foundation

struct ServerProfile: Codable, Identifiable, Hashable {
    let id: UUID
    var name: String
    var url: URL

    init(id: UUID = UUID(), name: String, url: URL) {
        self.id = id
        self.name = name
        self.url = url
    }

    /// Derive a display name from the URL hostname if no name was given.
    static func defaultName(for url: URL) -> String {
        url.host() ?? url.absoluteString
    }
}
