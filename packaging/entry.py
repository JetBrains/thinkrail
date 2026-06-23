"""ThinkRail standalone entry point for PyInstaller-packaged executable."""
from __future__ import annotations

import argparse
import sys
import threading
import webbrowser

import uvicorn

from app.version import VERSION, check_in_background, print_banner


def _run_server(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="thinkrail",
        description="ThinkRail - specification-driven development workspace",
    )
    parser.add_argument("--version", action="version", version=VERSION)
    parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    args = parser.parse_args(argv)

    print_banner()
    check_in_background()

    from app.core.config import find_free_port

    try:
        port = find_free_port(args.port, host=args.host)
    except OSError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    if port != args.port:
        print(f"Port {args.port} is in use; using {port} instead.", file=sys.stderr)

    browse_host = "127.0.0.1" if args.host == "0.0.0.0" else args.host
    url = f"http://{browse_host}:{port}"
    print(f"Starting ThinkRail on {url}")
    print("Open the URL in your browser to pick a project.")

    if not args.no_browser:
        threading.Timer(1.5, webbrowser.open, args=[url]).start()

    uvicorn.run(
        "app.main:create_app",
        factory=True,
        host=args.host,
        port=port,
    )
    return 0


def _run_upgrade(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="thinkrail upgrade",
        description="Re-download and install the latest ThinkRail for the current channel.",
    )
    parser.add_argument("--channel", choices=["stable", "nightly"],
                        help="Override channel (default: read from install metadata)")
    parser.add_argument("--version", default="latest",
                        help="Install a specific version (default: latest)")
    args = parser.parse_args(argv)

    from app import analytics
    from app.analytics import UpgradeStartedEvent
    analytics.emit_oneshot(UpgradeStartedEvent())

    from app.upgrade import run_upgrade
    return run_upgrade(channel=args.channel, version=args.version)


def _run_analytics(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="thinkrail analytics",
        description="Enable, disable, or show the status of anonymous usage analytics.",
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--enable", action="store_true",
                       help="Enable analytics (mints a fresh installation id)")
    group.add_argument("--disable", action="store_true",
                       help="Disable analytics and delete the installation id")
    group.add_argument("--status", action="store_true",
                       help="Show whether analytics is enabled")
    args = parser.parse_args(argv)

    from app.analytics import run_cli
    action = "enable" if args.enable else "disable" if args.disable else "status"
    return run_cli(action)


def main() -> None:
    argv = sys.argv[1:]
    if argv and argv[0] == "upgrade":
        sys.exit(_run_upgrade(argv[1:]))
    if argv and argv[0] == "analytics":
        sys.exit(_run_analytics(argv[1:]))
    sys.exit(_run_server(argv))


if __name__ == "__main__":
    main()
