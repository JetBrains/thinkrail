"""CLI commands for Bonsai utilities.

Usage::

    cd backend
    uv run python -m app.cli export-schema -o openapi.json
"""

from __future__ import annotations

import argparse
import sys


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


def _export_rpc_schema(output: str | None) -> None:
    import json
    from app.rpc.schema_export import rpc_payload_json_schema

    schema = json.dumps(rpc_payload_json_schema(), indent=2)
    if output:
        import pathlib
        pathlib.Path(output).write_text(schema)
        print(f"RPC payload schema written to {output}")
    else:
        print(schema)


def main() -> None:
    parser = argparse.ArgumentParser(prog="bonsai-cli", description="Bonsai utilities")
    sub = parser.add_subparsers(dest="command")

    # export-schema
    es = sub.add_parser("export-schema", help="Export OpenAPI schema as JSON")
    es.add_argument("-o", "--output", help="Write to file instead of stdout")

    # export-ws-schema
    ews = sub.add_parser("export-ws-schema", help="Export WebSocket event JSON Schema")
    ews.add_argument("-o", "--output", help="Write to file instead of stdout")

    # export-rpc-schema
    ers = sub.add_parser("export-rpc-schema", help="Export RPC payload JSON Schema")
    ers.add_argument("-o", "--output", help="Write to file instead of stdout")

    args = parser.parse_args()

    if args.command == "export-schema":
        _export_schema(args.output)
    elif args.command == "export-ws-schema":
        _export_ws_schema(args.output)
    elif args.command == "export-rpc-schema":
        _export_rpc_schema(args.output)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
