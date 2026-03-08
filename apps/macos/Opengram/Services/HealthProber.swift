import Foundation

struct HealthResult {
    let version: String
    let uptime: TimeInterval
}

enum HealthProber {
    /// Probe a URL's `/api/v1/health` endpoint.
    /// Returns server info on success, nil if unreachable or not an Opengram server.
    static func probe(url: URL, timeout: TimeInterval = 5) async -> HealthResult? {
        let healthURL = url.appendingPathComponent("api/v1/health")
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = timeout
        request.httpMethod = "GET"

        do {
            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200 else {
                return nil
            }

            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let service = json["service"] as? String,
                  service == "opengram" else {
                return nil
            }

            let version = json["version"] as? String ?? "unknown"
            let uptime = json["uptime"] as? TimeInterval ?? 0

            return HealthResult(version: version, uptime: uptime)
        } catch {
            return nil
        }
    }
}
