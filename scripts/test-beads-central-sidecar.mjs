#!/usr/bin/env node

import { readFileSync } from "node:fs";
import http from "node:http";

const lock = JSON.parse(
  readFileSync(new URL("../components/beads-central.lock.json", import.meta.url), "utf8"),
);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const host = argumentValue("--host");
const port = Number(argumentValue("--port"));
if (host !== "127.0.0.1" || !Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write("Expected --host 127.0.0.1 and a valid --port\n");
  process.exit(2);
}

const server = http.createServer((request, response) => {
  if (request.url !== "/health/ready") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      status: "ready",
      central: lock.version,
      bd: `bd version ${lock.beadsVersion} (test fixture)`,
    }),
  );
});

server.listen(port, host);

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
