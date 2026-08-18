from __future__ import annotations

import argparse

import uvicorn

from beads_central.main import create_app


def main() -> None:
    parser = argparse.ArgumentParser(description="Paseo-managed Beads Central sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost"}:
        parser.error("bundled sidecar must bind to loopback")
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    uvicorn.run(create_app(), host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()
