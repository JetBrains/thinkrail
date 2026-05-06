"""Bonsai standalone entry point for PyInstaller-packaged executable."""
from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bonsai - specification-driven development workspace",
    )
    parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    args = parser.parse_args()

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


if __name__ == "__main__":
    main()
