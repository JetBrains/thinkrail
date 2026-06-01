"""Curated RPC payload models and JSON-Schema export for codegen.

Source of truth for the RPC type-generation pipeline (`app.cli
export-rpc-schema` → `json-schema-to-typescript` →
`frontend/src/types/rpc-methods.ts`). It declares request / response wrappers
around the runtime-capability models and emits one JSON Schema document with
all of them under ``$defs``. Future RPC types opt in by adding their model to
``RPC_PAYLOAD_MODELS``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, TypeAdapter

from app.agent.models import RuntimeType, to_camel
from app.agent.runtime.types import (
    LabeledOption,
    RuntimeCapabilities,
    RuntimeFlag,
    RuntimeIdentity,
)


class RuntimesListResponse(BaseModel):
    """Wire payload returned by ``runtimes/list``."""

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    runtimes: list[RuntimeIdentity]


class RuntimesCapabilitiesRequest(BaseModel):
    """Wire payload accepted by ``runtimes/capabilities``."""

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    runtime_type: RuntimeType


class InvalidCapabilityValueData(BaseModel):
    """``data`` payload attached to ``INVALID_CAPABILITY_VALUE`` (-32032)."""

    model_config = ConfigDict(
        extra="forbid",
        alias_generator=to_camel,
        populate_by_name=True,
        frozen=True,
    )

    field: str
    value: str
    runtime_type: RuntimeType
    allowed: list[str]


# Order is the order they'll appear in the generated TS file's exports.
RPC_PAYLOAD_MODELS: tuple[type[BaseModel], ...] = (
    LabeledOption,
    RuntimeFlag,
    RuntimeIdentity,
    RuntimeCapabilities,
    RuntimesListResponse,
    RuntimesCapabilitiesRequest,
    InvalidCapabilityValueData,
)


def rpc_payload_json_schema() -> dict[str, Any]:
    """Return one JSON Schema document with every curated model under ``$defs``.

    The top-level schema is an ``anyOf`` referencing each curated model so
    ``json-schema-to-typescript`` walks every definition and emits one TS type
    per model — without the top-level reference, json2ts ignores the contents
    of ``$defs``. Uses ``mode="serialization"`` so camelCase aliases (matching
    the on-wire shape) drive the generated TS field names.
    """
    defs: dict[str, Any] = {}
    for model in RPC_PAYLOAD_MODELS:
        schema = TypeAdapter(model).json_schema(
            by_alias=True,
            mode="serialization",
            ref_template="#/$defs/{model}",
        )
        nested = schema.pop("$defs", {})
        defs.update(nested)
        defs[model.__name__] = schema

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "BonsaiRpcPayloads",
        "$defs": defs,
        "anyOf": [
            {"$ref": f"#/$defs/{model.__name__}"} for model in RPC_PAYLOAD_MODELS
        ],
    }
