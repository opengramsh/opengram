import SwiftUI
import ServiceManagement

struct SettingsView: View {
    @ObservedObject var profileStore: ServerProfileStore
    @ObservedObject var shortcutService: GlobalShortcutService
    @ObservedObject var updaterService: UpdaterService

    @State private var editingProfile: ServerProfile?
    @State private var showingAddServer = false
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @AppStorage("showInMenuBar") private var showInMenuBar = false

    var body: some View {
        Form {
            Section("Servers") {
                ForEach(profileStore.profiles) { profile in
                    HStack(spacing: 8) {
                        Image(systemName: profile.id == profileStore.activeProfileId ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(profile.id == profileStore.activeProfileId ? .green : .secondary)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(profile.name)
                                .fontWeight(.medium)
                            Text(profile.url.absoluteString)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        Button {
                            editingProfile = profile
                        } label: {
                            Image(systemName: "pencil")
                        }
                        .buttonStyle(.borderless)

                        Button {
                            profileStore.removeProfile(profile)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.borderless)
                        .foregroundStyle(.red)
                    }
                    .padding(.vertical, 2)
                }

                Button {
                    showingAddServer = true
                } label: {
                    Label("Add Server…", systemImage: "plus")
                }
            }

            Section("General") {
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { _, enabled in
                        setLaunchAtLogin(enabled)
                    }

                Toggle("Show in menu bar", isOn: $showInMenuBar)
            }

            Section("Updates") {
                Toggle("Automatically check for updates", isOn: Binding(
                    get: { updaterService.automaticallyChecksForUpdates },
                    set: { updaterService.automaticallyChecksForUpdates = $0 }
                ))

                Button("Check for Updates…") {
                    updaterService.checkForUpdates()
                }
                .disabled(!updaterService.canCheckForUpdates)
            }

            Section("Global Shortcut") {
                HStack {
                    Text("Show / Hide Opengram")
                    Spacer()
                    ShortcutRecorderView(service: shortcutService)
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 500, height: 520)
        .sheet(item: $editingProfile) { profile in
            EditProfileSheet(profile: profile) { updated in
                profileStore.updateProfile(updated)
            }
        }
        .sheet(isPresented: $showingAddServer) {
            ManualEntrySheet { profile in
                profileStore.addProfile(profile)
            }
        }
    }
}

// MARK: - Launch at Login

extension SettingsView {
    private func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
        } catch {
            // Revert the toggle if registration fails
            launchAtLogin = SMAppService.mainApp.status == .enabled
        }
    }
}

struct EditProfileSheet: View {
    @State var profile: ServerProfile
    let onSave: (ServerProfile) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Edit Server")
                .font(.title2.bold())

            VStack(alignment: .leading, spacing: 6) {
                Text("Display Name")
                    .font(.headline)
                TextField("Name", text: $profile.name)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Server URL")
                    .font(.headline)
                TextField("URL", text: Binding(
                    get: { profile.url.absoluteString },
                    set: { if let url = URL(string: $0) { profile.url = url } }
                ))
                .textFieldStyle(.roundedBorder)
            }

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Save") {
                    onSave(profile)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 400)
    }
}
