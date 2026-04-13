"""CLI commands for Bonsai server administration.

Usage::

    cd backend
    uv run python -m app.cli create-user --id danya --name "Danya"
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.core.config import get_data_dir
from app.core.server_store import ServerStore


async def _create_user(user_id: str, display_name: str) -> None:
    store = ServerStore(get_data_dir())
    await store.open()
    try:
        user = await store.ensure_user(user_id, display_name)
        token = await store.create_token(user_id)
        print(f'Created user "{user.id}" ({user.display_name})')
        print(f"Token: {token}")
    finally:
        await store.close()


async def _list_users() -> None:
    store = ServerStore(get_data_dir())
    await store.open()
    try:
        users = await store.list_users()
        if not users:
            print("No users.")
            return
        for u in users:
            tokens = await store.list_tokens(u.id)
            print(f"  {u.id} ({u.display_name}) — {len(tokens)} token(s)")
    finally:
        await store.close()


def main() -> None:
    parser = argparse.ArgumentParser(prog="bonsai-cli", description="Bonsai server admin")
    sub = parser.add_subparsers(dest="command")

    # create-user
    cu = sub.add_parser("create-user", help="Create a user and generate a token")
    cu.add_argument("--id", required=True, help="User ID (e.g. 'danya')")
    cu.add_argument("--name", required=True, help="Display name (e.g. 'Danya')")

    # list-users
    sub.add_parser("list-users", help="List all server users")

    args = parser.parse_args()

    if args.command == "create-user":
        asyncio.run(_create_user(args.id, args.name))
    elif args.command == "list-users":
        asyncio.run(_list_users())
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
