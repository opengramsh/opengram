import Foundation
import SwiftUI

@MainActor
class ServerProfileStore: ObservableObject {
    @Published var profiles: [ServerProfile] = []
    @Published var activeProfileId: UUID?

    private let profilesKey = "opengram.serverProfiles"
    private let activeProfileKey = "opengram.activeProfileId"

    var activeProfile: ServerProfile? {
        guard let id = activeProfileId else { return nil }
        return profiles.first { $0.id == id }
    }

    init() {
        loadProfiles()
    }

    func addProfile(_ profile: ServerProfile) {
        profiles.append(profile)
        activeProfileId = profile.id
        saveProfiles()
    }

    func removeProfile(_ profile: ServerProfile) {
        profiles.removeAll { $0.id == profile.id }
        if activeProfileId == profile.id {
            activeProfileId = profiles.first?.id
        }
        saveProfiles()
    }

    func updateProfile(_ profile: ServerProfile) {
        if let index = profiles.firstIndex(where: { $0.id == profile.id }) {
            profiles[index] = profile
            saveProfiles()
        }
    }

    func setActive(_ profile: ServerProfile) {
        activeProfileId = profile.id
        UserDefaults.standard.set(profile.id.uuidString, forKey: activeProfileKey)
    }

    // MARK: - Persistence

    private func loadProfiles() {
        if let data = UserDefaults.standard.data(forKey: profilesKey),
           let decoded = try? JSONDecoder().decode([ServerProfile].self, from: data) {
            profiles = decoded
        }
        if let idString = UserDefaults.standard.string(forKey: activeProfileKey),
           let id = UUID(uuidString: idString) {
            activeProfileId = id
        }
    }

    private func saveProfiles() {
        if let data = try? JSONEncoder().encode(profiles) {
            UserDefaults.standard.set(data, forKey: profilesKey)
        }
        if let id = activeProfileId {
            UserDefaults.standard.set(id.uuidString, forKey: activeProfileKey)
        } else {
            UserDefaults.standard.removeObject(forKey: activeProfileKey)
        }
    }
}
