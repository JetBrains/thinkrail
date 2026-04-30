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


async def _create_user(user_id: str, display_name: str, *, is_admin: bool = False) -> None:
    store = ServerStore(get_data_dir())
    await store.open()
    try:
        user = await store.ensure_user(user_id, display_name)
        if is_admin and not user.is_admin:
            await store.set_admin(user_id, True)
        token = await store.create_token(user_id)
        admin_tag = " [admin]" if is_admin or user.is_admin else ""
        print(f'Created user "{user.id}" ({user.display_name}){admin_tag}')
        print(f"Token: {token}")
    finally:
        await store.close()


async def _delete_user(user_id: str) -> None:
    store = ServerStore(get_data_dir())
    await store.open()
    try:
        user = await store.get_user(user_id)
        if not user:
            print(f"User {user_id!r} not found.")
            sys.exit(1)
        await store.delete_user(user_id)
        print(f'Deleted user "{user_id}"')
    finally:
        await store.close()


async def _set_admin(user_id: str) -> None:
    store = ServerStore(get_data_dir())
    await store.open()
    try:
        user = await store.get_user(user_id)
        if not user:
            print(f"User {user_id!r} not found.")
            sys.exit(1)
        if user.is_admin:
            print(f'User "{user.id}" is already an admin.')
            return
        await store.set_admin(user_id, True)
        print(f'Granted admin to "{user.id}" ({user.display_name})')
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
            admin_badge = " [admin]" if u.is_admin else ""
            print(f"  {u.id} ({u.display_name}){admin_badge} — {len(tokens)} token(s)")
    finally:
        await store.close()


def _export_schema(output: str | None) -> None:
    import json
    from app.main import create_app

    schema = json.dumps(create_app().openapi(), indent=2)
    if output:
        import pathlib
        pathlib.Path(output).write_text(schema)
        print(f"Schema written to {output}")
    else:
        print(schema)


def _export_ws_schema(output: str | None) -> None:
    import json
    from app.agent.models import agent_event_json_schema

    schema = json.dumps(agent_event_json_schema(), indent=2)
    if output:
        import pathlib
        pathlib.Path(output).write_text(schema)
        print(f"WS event schema written to {output}")
    else:
        print(schema)


def main() -> None:
    parser = argparse.ArgumentParser(prog="bonsai-cli", description="Bonsai server admin")
    sub = parser.add_subparsers(dest="command")

    # create-user
    cu = sub.add_parser("create-user", help="Create a user and generate a token")
    cu.add_argument("--id", required=True, help="User ID (e.g. 'danya')")
    cu.add_argument("--name", required=True, help="Display name (e.g. 'Danya')")
    cu.add_argument("--admin", action="store_true", help="Grant admin role")

    # delete-user
    du = sub.add_parser("delete-user", help="Delete a user and all associated data")
    du.add_argument("--id", required=True, help="User ID to delete")

    # set-admin
    sa = sub.add_parser("set-admin", help="Grant admin role to an existing user")
    sa.add_argument("--id", required=True, help="User ID to promote")

    # list-users
    sub.add_parser("list-users", help="List all server users")

    # export-schema
    es = sub.add_parser("export-schema", help="Export OpenAPI schema as JSON")
    es.add_argument("-o", "--output", help="Write to file instead of stdout")

    # export-ws-schema
    ews = sub.add_parser("export-ws-schema", help="Export WebSocket event JSON Schema")
    ews.add_argument("-o", "--output", help="Write to file instead of stdout")

    args = parser.parse_args()

    if args.command == "create-user":
        asyncio.run(_create_user(args.id, args.name, is_admin=args.admin))
    elif args.command == "delete-user":
        asyncio.run(_delete_user(args.id))
    elif args.command == "set-admin":
        asyncio.run(_set_admin(args.id))
    elif args.command == "list-users":
        asyncio.run(_list_users())
    elif args.command == "export-schema":
        _export_schema(args.output)
    elif args.command == "export-ws-schema":
        _export_ws_schema(args.output)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
