import SwiftUI

struct SettingsView: View {
    @ObservedObject var profileStore: ServerProfileStore

    @State private var editingProfile: ServerProfile?

    var body: some View {
        Form {
            Section("Servers") {
                List {
                    ForEach(profileStore.profiles) { profile in
                        HStack {
                            if profile.id == profileStore.activeProfileId {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else {
                                Image(systemName: "circle")
                                    .foregroundStyle(.secondary)
                            }

                            VStack(alignment: .leading) {
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
                }
                .frame(minHeight: 100)
            }
        }
        .formStyle(.grouped)
        .frame(width: 500, height: 300)
        .sheet(item: $editingProfile) { profile in
            EditProfileSheet(profile: profile) { updated in
                profileStore.updateProfile(updated)
            }
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
