// A tiny HTTP CONNECT proxy that enforces a *real* network block.
//
// Any client pointed at this proxy (via https_proxy / http_proxy) can only
// reach hosts that are NOT on the blocklist. CONNECT tunnels to blocked hosts
// are refused with a 403, so an `npm install` against registry.npmjs.org fails
// at the network layer with an authentic error, while git+https to github.com
// still succeeds.
//
// This is fully self-contained: no sudo, no /etc/hosts edits. When the process
// exits, the block is gone.

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PROXY_PORT || 8899);

// Hosts the agent must NOT be able to reach. Defaults cover the npm registry
// and the common public mirrors/CDNs that also serve npm packages. The demo
// (run-demo.ts) overrides this via BLOCKED_HOSTS, adding GitHub for the
// demo:block-gh variant. Matching is suffix-based (see isBlocked), so listing
// "github.com" would also block every *.github.com host, e.g. codeload.github.com.
const BLOCKED_HOSTS = (
  process.env.BLOCKED_HOSTS ||
  "registry.npmjs.org,registry.yarnpkg.com,unpkg.com,cdn.jsdelivr.net,npm.pkg.github.com"
)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

function isBlocked(host) {
  const h = host.toLowerCase();
  return BLOCKED_HOSTS.some((b) => h === b || h.endsWith("." + b));
}

// Plain HTTP requests (rare for these tools, but handle them anyway).
const server = http.createServer((req, res) => {
  res.writeHead(405, { "content-type": "text/plain" });
  res.end("This proxy only supports CONNECT tunneling.\n");
});

// HTTPS goes through CONNECT tunneling; this is where the block is enforced.
server.on("connect", (req, clientSocket, head) => {
  const [rawHost, rawPort] = req.url.split(":");
  const host = rawHost;
  const port = Number(rawPort) || 443;

  if (isBlocked(host)) {
    console.error(`[proxy] BLOCKED ${host}:${port}  (network policy)`);
    clientSocket.write(
      "HTTP/1.1 403 Forbidden\r\n" +
        "Proxy-Agent: dep-break-blocking-proxy\r\n" +
        "\r\n"
    );
    clientSocket.end();
    return;
  }

  console.error(`[proxy] allow   ${host}:${port}`);
  const upstream = net.connect(port, host, () => {
    clientSocket.write(
      "HTTP/1.1 200 Connection Established\r\n" +
        "Proxy-Agent: dep-break-blocking-proxy\r\n" +
        "\r\n"
    );
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });

  upstream.on("error", (err) => {
    console.error(`[proxy] upstream error for ${host}:${port}: ${err.message}`);
    clientSocket.end();
  });
  clientSocket.on("error", () => upstream.destroy());
});

server.on("clientError", (_err, socket) => {
  if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(PORT, "127.0.0.1", () => {
  console.error(
    `[proxy] listening on 127.0.0.1:${PORT} | blocking: ${BLOCKED_HOSTS.join(", ")}`
  );
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.error(`[proxy] shutting down (${sig})`);
    server.close(() => process.exit(0));
  });
}
