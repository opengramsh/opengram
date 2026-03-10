import SwiftUI

struct ManualEntrySheet: View {
    let onConnect: (ServerProfile) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var urlText = "https://"
    @State private var displayName = ""

    private var isValid: Bool {
        guard let url = normalizedURL else { return false }
        return url.scheme == "http" || url.scheme == "https"
    }

    private var normalizedURL: URL? {
        var text = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        // Auto-prepend https:// if no scheme
        if !text.contains("://") {
            text = "https://\(text)"
        }
        return URL(string: text)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Add Server")
                .font(.title2.bold())

            VStack(alignment: .leading, spacing: 6) {
                Text("Server URL")
                    .font(.headline)
                TextField("https://opengram.example.com", text: $urlText)
                    .textFieldStyle(.roundedBorder)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Display Name")
                    .font(.headline)
                TextField("Optional", text: $displayName)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Spacer()
                Button("Cancel") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button("Connect") {
                    guard let url = normalizedURL else { return }
                    let name = displayName.isEmpty
                        ? ServerProfile.defaultName(for: url)
                        : displayName
                    let profile = ServerProfile(name: name, url: url)
                    onConnect(profile)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!isValid)
            }
        }
        .padding(24)
        .frame(width: 400)
    }
}
