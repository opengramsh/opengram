import SwiftUI

struct ConnectingView: View {
    let profile: ServerProfile
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("Connecting to")
                .font(.headline)
                .foregroundStyle(.secondary)

            Text(profile.url.absoluteString)
                .font(.title3)
                .fontWeight(.medium)

            ProgressView()
                .controlSize(.large)
                .padding()

            Text("Verifying server...")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Button("Cancel", action: onCancel)
                .buttonStyle(.bordered)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
