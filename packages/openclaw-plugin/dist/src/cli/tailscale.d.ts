/**
 * Detect a running OpenGram instance by probing health endpoints.
 *
 * Probes all candidate URLs in parallel and returns the highest-priority
 * URL whose health endpoint responds with `{ service: "opengram" }`.
 * Falls back to the Tailscale DNS URL or `http://localhost:3000` if
 * nothing responds.
 */
export declare function detectOpengramUrl(): Promise<string>;
