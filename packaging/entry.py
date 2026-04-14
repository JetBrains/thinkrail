"""Bonsai standalone entry point for PyInstaller-packaged executable."""
from __future__ import annotations

import argparse
import asyncio
import sys
import threading
import webbrowser

import uvicorn


def _init_admin(user_id: str, name: str) -> None:
    """Create first admin user and print token, then exit."""
    from app.core.config import get_data_dir
    from app.core.server_store import ServerStore

    async def _run() -> None:
        store = ServerStore(get_data_dir())
        await store.open()
        try:
            user = await store.create_user(user_id, name, is_admin=True)
            token = await store.create_token(user_id)
            print(f'Created admin user "{user.id}" ({user.display_name})')
            print(f"Token: {token}")
        finally:
            await store.close()

    asyncio.run(_run())


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bonsai - specification-driven development workspace",
    )
    parser.add_argument("--port", type=int, default=8000, help="Server port (default: 8000)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    parser.add_argument(
        "--init-admin", nargs=2, metavar=("ID", "NAME"),
        help="Create first admin user and print token, then exit",
    )
    args = parser.parse_args()

    if args.init_admin:
        _init_admin(args.init_admin[0], args.init_admin[1])
        return

    browse_host = "127.0.0.1" if args.host == "0.0.0.0" else args.host
    url = f"http://{browse_host}:{args.port}"
    print(f"Starting Bonsai on {url}")
    print("First run? Create admin via: bonsai --init-admin <id> <name>")
    print("Or just open the browser — the Setup Screen will guide you.")

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
