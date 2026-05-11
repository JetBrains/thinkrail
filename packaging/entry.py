"""Bonsai standalone entry point for PyInstaller-packaged executable."""
from __future__ import annotations

import argparse
import sys
import threading
import webbrowser

import uvicorn

from app.version import VERSION, check_in_background, print_banner


def _run_server(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="bonsai",
        description="Bonsai - specification-driven development workspace",
    )
    parser.add_argument("--version", action="version", version=VERSION)
    parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    args = parser.parse_args(argv)

    print_banner()
    check_in_background()

    browse_host = "127.0.0.1" if args.host == "0.0.0.0" else args.host
    url = f"http://{browse_host}:{args.port}"
    print(f"Starting Bonsai on {url}")
    print("Open the URL in your browser to pick a project.")

    if not args.no_browser:
        threading.Timer(1.5, webbrowser.open, args=[url]).start()

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=args.host,
        port=args.port,
    )
    return 0


def _run_upgrade(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="bonsai upgrade",
        description="Re-download and install the latest Bonsai for the current channel.",
    )
    parser.add_argument("--channel", choices=["stable", "nightly"],
                        help="Override channel (default: read from install metadata)")
    parser.add_argument("--version", default="latest",
                        help="Install a specific version (default: latest)")
    args = parser.parse_args(argv)

    from app.upgrade import run_upgrade
    return run_upgrade(channel=args.channel, version=args.version)


def main() -> None:
    argv = sys.argv[1:]
    if argv and argv[0] == "upgrade":
        sys.exit(_run_upgrade(argv[1:]))
    sys.exit(_run_server(argv))


if __name__ == "__main__":
    main()
