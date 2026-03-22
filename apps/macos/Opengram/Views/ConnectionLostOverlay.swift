import SwiftUI

struct ConnectionLostOverlay: View {
    let onSwitchServer: () -> Void

    @State private var dotCount = 0
    private let timer = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                Text("Connection lost")
                    .font(.headline)

                HStack(spacing: 8) {
                    Text("Reconnecting\(String(repeating: ".", count: dotCount % 4))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .frame(width: 130, alignment: .leading)

                    ProgressView()
                        .controlSize(.small)
                }

                Button("Switch Server", action: onSwitchServer)
                    .buttonStyle(.bordered)
            }
            .padding(24)
            .background(.regularMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .onReceive(timer) { _ in
            dotCount += 1
        }
    }
}
