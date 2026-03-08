import SwiftUI

struct ConnectionErrorView: View {
    let profile: ServerProfile
    let error: Error
    let onRetry: () -> Void
    let onEditURL: () -> Void
    let onBack: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Text("Could not connect to")
                .font(.headline)
                .foregroundStyle(.secondary)

            Text(profile.url.absoluteString)
                .font(.title3)
                .fontWeight(.medium)

            VStack(spacing: 8) {
                Text(errorTitle)
                    .font(.headline)

                Text(errorDescription)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding()
            .frame(maxWidth: 300)
            .background(.quaternary.opacity(0.5))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            HStack(spacing: 12) {
                Button("Edit URL", action: onEditURL)
                    .buttonStyle(.bordered)

                Button("Try Again", action: onRetry)
                    .buttonStyle(.borderedProminent)
            }

            Button("Back to Servers", action: onBack)
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var errorTitle: String {
        let nsError = error as NSError
        switch nsError.code {
        case NSURLErrorCannotFindHost:
            return "Server not found"
        case NSURLErrorCannotConnectToHost:
            return "Connection refused"
        case NSURLErrorTimedOut:
            return "Connection timed out"
        case NSURLErrorServerCertificateUntrusted,
             NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateHasUnknownRoot:
            return "Certificate error"
        default:
            return "Connection failed"
        }
    }

    private var errorDescription: String {
        let nsError = error as NSError
        switch nsError.code {
        case NSURLErrorCannotFindHost:
            return "The hostname could not be resolved. Check the URL and your network connection."
        case NSURLErrorCannotConnectToHost:
            return "The server may not be running, or the port may be wrong."
        case NSURLErrorTimedOut:
            return "The server did not respond in time. It may be down or unreachable."
        case NSURLErrorServerCertificateUntrusted,
             NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateHasUnknownRoot:
            return "The server's SSL certificate could not be verified."
        default:
            return error.localizedDescription
        }
    }
}
