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

    private func discoverBonjour() async -> [DiscoveredServer] {
        // Use NWBrowser to find _opengram._tcp services on the local network.
        // We collect results for up to 5 seconds, then return what we found.
        await withCheckedContinuation { continuation in
            var found: [DiscoveredServer] = []
            let params = NWParameters()
            params.includePeerToPeer = true
            let browser = NWBrowser(for: .bonjour(type: "_opengram._tcp", domain: "local."), using: params)

            browser.browseResultsChangedHandler = { results, _ in
                for result in results {
                    if case let .bonjour(txtRecord) = result.metadata {
                        let version = txtRecord["version"]
                        // We need to resolve the endpoint to get a usable URL.
                        // For now, extract from the endpoint description.
                        if case let .service(name, _, _, _) = result.endpoint {
                            // We'll probe this after resolution; for now, store a placeholder.
                            let server = DiscoveredServer(
                                id: "bonjour-\(name)",
                                url: URL(string: "http://\(name).local:3000")!,
                                source: .bonjour,
                                version: version,
                                name: name
                            )
                            if !found.contains(where: { $0.id == server.id }) {
                                found.append(server)
                            }
                        }
                    }
                }
            }

            browser.stateUpdateHandler = { state in
                if case .failed = state {
                    browser.cancel()
                    continuation.resume(returning: found)
                }
            }

            browser.start(queue: .main)
            self.browser = browser

            // Give Bonjour 5 seconds to discover services
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                browser.cancel()
                continuation.resume(returning: found)
            }
        }
    }

    private func discoverLocalhost() async -> [DiscoveredServer] {
        let ports = [3000, 3333, 5173]
        var found: [DiscoveredServer] = []

        await withTaskGroup(of: DiscoveredServer?.self) { group in
            for port in ports {
                group.addTask {
                    let url = URL(string: "http://127.0.0.1:\(port)")!
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
        guard let output = try? await runCommand("/usr/local/bin/tailscale", arguments: ["status", "--json"]) else {
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

                for port in [3000, 443] {
                    let scheme = port == 443 ? "https" : "http"
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

            do {
                try process.run()
                process.waitUntilExit()

                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                if let output = String(data: data, encoding: .utf8) {
                    continuation.resume(returning: output)
                } else {
                    continuation.resume(throwing: NSError(domain: "ServerDiscovery", code: 1))
                }
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
