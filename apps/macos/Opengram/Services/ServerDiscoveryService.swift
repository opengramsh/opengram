import Foundation
import Network

@MainActor
class ServerDiscoveryService: ObservableObject {
    @Published var discoveredServers: [DiscoveredServer] = []
    @Published var isScanning = false

    private var browser: NWBrowser?
    private var scanTask: Task<Void, Never>?

    func startScanning() {
        guard !isScanning else { return }
        isScanning = true
        discoveredServers = []

        scanTask = Task {
            await withTaskGroup(of: [DiscoveredServer].self) { group in
                // 1. Bonjour discovery
                group.addTask { await self.discoverBonjour() }

                // 2. Localhost probe
                group.addTask { await self.discoverLocalhost() }

                // 3. Tailscale probe
                group.addTask { await self.discoverTailscale() }

                for await servers in group {
                    let newServers = servers.filter { server in
                        !self.discoveredServers.contains { $0.id == server.id }
                    }
                    self.discoveredServers.append(contentsOf: newServers)
                }
            }
            isScanning = false
        }
    }

    func stopScanning() {
        scanTask?.cancel()
        scanTask = nil
        browser?.cancel()
        browser = nil
        isScanning = false
    }

    // MARK: - Discovery channels

    /// Holds mutable state for Bonjour discovery (reference type to avoid
    /// Swift 6 concurrency warnings when captured in multiple closures).
    private class BonjourScanState {
        var found: [DiscoveredServer] = []
        var hasResumed = false
    }

    private func discoverBonjour() async -> [DiscoveredServer] {
        // Use NWBrowser to find _opengram._tcp services on the local network.
        // We collect results for up to 5 seconds, then return what we found.
        await withCheckedContinuation { continuation in
            let state = BonjourScanState()
            let params = NWParameters()
            params.includePeerToPeer = true
            let browser = NWBrowser(for: .bonjour(type: "_opengram._tcp", domain: "local."), using: params)

            // All closures run on DispatchQueue.main, so access to `state` is serialized.
            let resumeOnce: @Sendable () -> Void = { [state] in
                guard !state.hasResumed else { return }
                state.hasResumed = true
                browser.cancel()
                continuation.resume(returning: state.found)
            }

            browser.browseResultsChangedHandler = { [state] results, _ in
                for result in results {
                    if case let .bonjour(txtRecord) = result.metadata {
                        let version = txtRecord["version"]
                        if case let .service(name, _, _, _) = result.endpoint {
                            let server = DiscoveredServer(
                                id: "bonjour-\(name)",
                                url: URL(string: "http://\(name).local:3000")!,
                                source: .bonjour,
                                version: version,
                                name: name
                            )
                            if !state.found.contains(where: { $0.id == server.id }) {
                                state.found.append(server)
                            }
                        }
                    }
                }
            }

            browser.stateUpdateHandler = { state in
                if case .failed = state {
                    resumeOnce()
                }
            }

            browser.start(queue: .main)
            self.browser = browser

            // Give Bonjour 5 seconds to discover services
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                resumeOnce()
            }
        }
    }

    private func discoverLocalhost() async -> [DiscoveredServer] {
        let probeTargets: [(Int, String)] = [
            (3000, "http"),
            (3333, "http"),
            (5173, "http"),
            (8080, "http"),
            (8443, "https"),
            (443, "https"),
        ]
        var found: [DiscoveredServer] = []

        await withTaskGroup(of: DiscoveredServer?.self) { group in
            for (port, scheme) in probeTargets {
                group.addTask {
                    let url = URL(string: "\(scheme)://127.0.0.1:\(port)")!
                    if let result = await HealthProber.probe(url: url, timeout: 3) {
                        return DiscoveredServer(
                            id: url.absoluteString,
                            url: url,
                            source: .localhost,
                            version: result.version,
                            name: "localhost:\(port)"
                        )
                    }
                    return nil
                }
            }
            for await server in group {
                if let server {
                    found.append(server)
                }
            }
        }
        return found
    }

    private func discoverTailscale() async -> [DiscoveredServer] {
        // Shell out to `tailscale status --json` and probe discovered hosts.
        // Check multiple known paths for the Tailscale CLI
        let tailscalePaths = [
            "/usr/local/bin/tailscale",
            "/opt/homebrew/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]
        var output: String?
        for path in tailscalePaths {
            if FileManager.default.isExecutableFile(atPath: path),
               let result = try? await runCommand(path, arguments: ["status", "--json"]) {
                output = result
                break
            }
        }
        guard let output else {
            return []
        }

        guard let data = output.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let peers = json["Peer"] as? [String: Any] else {
            return []
        }

        var found: [DiscoveredServer] = []

        await withTaskGroup(of: DiscoveredServer?.self) { group in
            for (_, peerValue) in peers {
                guard let peer = peerValue as? [String: Any],
                      let hostName = peer["DNSName"] as? String,
                      let online = peer["Online"] as? Bool,
                      online else { continue }

                let cleanHost = hostName.hasSuffix(".") ? String(hostName.dropLast()) : hostName

                let probeTargets: [(Int, String)] = [
                    (443, "https"),
                    (8443, "https"),
                    (3000, "https"),
                    (3333, "https"),
                    (5173, "https"),
                    (8080, "https"),
                ]
                for (port, scheme) in probeTargets {
                    group.addTask {
                        let url = URL(string: "\(scheme)://\(cleanHost):\(port)")!
                        if let result = await HealthProber.probe(url: url, timeout: 3) {
                            return DiscoveredServer(
                                id: url.absoluteString,
                                url: url,
                                source: .tailscale,
                                version: result.version,
                                name: cleanHost
                            )
                        }
                        return nil
                    }
                }
            }
            for await server in group {
                if let server {
                    found.append(server)
                }
            }
        }
        return found
    }

    // MARK: - Helpers

    private func runCommand(_ path: String, arguments: [String]) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: path)
            process.arguments = arguments

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            process.terminationHandler = { _ in
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let output = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: output)
                } else {
                    continuation.resume(throwing: NSError(domain: "ServerDiscovery", code: 1))
                }
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
