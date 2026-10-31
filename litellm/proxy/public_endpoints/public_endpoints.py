import asyncio
import json
import os
import re
from collections.abc import Awaitable, Callable, Mapping, Sequence
from functools import cache
from importlib.resources import files
from typing import Final

from fastapi import APIRouter, HTTPException
from pydantic import TypeAdapter
from typing_extensions import ReadOnly, TypedDict

import litellm
from litellm._logging import verbose_logger
from litellm.litellm_core_utils.get_blog_posts import (
    BlogPostsResponse,
    GetBlogPosts,
    get_blog_posts,
)
from litellm.litellm_core_utils.get_model_cost_map import GetModelCostMap
from litellm.litellm_core_utils.offline_mode import is_offline_mode
from litellm.router_strategy.complexity_router.fuse_presets import FusePresetCatalog, get_fuse_presets
from litellm.types.proxy.public_endpoints.public_endpoints import (
    AutoRouterPresetRecord,
    ComplexityScorerDefaults,
    ProviderCreateInfo,
    SupportedEndpointsResponse,
)
from litellm.types.utils import LlmProviders

router: Final = APIRouter()


class _ProviderSupportEntry(TypedDict, total=False):
    display_name: ReadOnly[str]
    endpoints: ReadOnly[Mapping[str, bool]]


class _ProvidersFile(TypedDict, total=False):
    providers: ReadOnly[Mapping[str, _ProviderSupportEntry]]


class _EndpointProviderEntry(TypedDict):
    slug: ReadOnly[str]
    display_name: ReadOnly[str]


class _EndpointEntry(TypedDict):
    key: ReadOnly[str]
    label: ReadOnly[str]
    endpoint: ReadOnly[str]
    providers: ReadOnly[Sequence[_EndpointProviderEntry]]


# ---------------------------------------------------------------------------
# /public/endpoints — helpers
# ---------------------------------------------------------------------------

_ENDPOINT_METADATA: Final[Mapping[str, Mapping[str, str]]] = {
    "chat_completions": {"label": "Chat Completions", "endpoint": "/chat/completions"},
    "messages": {"label": "Messages", "endpoint": "/messages"},
    "responses": {"label": "Responses", "endpoint": "/responses"},
    "embeddings": {"label": "Embeddings", "endpoint": "/embeddings"},
    "image_generations": {
        "label": "Image Generations",
        "endpoint": "/images/generations",
    },
    "audio_transcriptions": {
        "label": "Audio Transcriptions",
        "endpoint": "/audio/transcriptions",
    },
    "audio_speech": {"label": "Audio Speech", "endpoint": "/audio/speech"},
    "moderations": {"label": "Moderations", "endpoint": "/moderations"},
    "batches": {"label": "Batches", "endpoint": "/batches"},
    "rerank": {"label": "Rerank", "endpoint": "/rerank"},
    "ocr": {"label": "OCR", "endpoint": "/ocr"},
    "search": {"label": "Search", "endpoint": "/search"},
    "skills": {"label": "Skills", "endpoint": "/skills"},
    "interactions": {"label": "Interactions", "endpoint": "/interactions"},
    "a2a": {"label": "A2A (Agent Gateway)", "endpoint": "/a2a/{agent}/message/send"},
    "container": {"label": "Containers", "endpoint": "/containers"},
    "container_files": {
        "label": "Container Files",
        "endpoint": "/containers/{id}/files",
    },
    "compact": {"label": "Compact", "endpoint": "/responses/compact"},
    "files": {"label": "Files", "endpoint": "/files"},
    "image_edits": {"label": "Image Edits", "endpoint": "/images/edits"},
    "vector_stores_create": {
        "label": "Vector Stores (Create)",
        "endpoint": "/vector_stores",
    },
    "vector_stores_search": {
        "label": "Vector Stores (Search)",
        "endpoint": "/vector_stores/{id}/search",
    },
    "vector_store_files": {
        "label": "Vector Store Files",
        "endpoint": "/vector_stores/{id}/files",
    },
    "video_generations": {
        "label": "Video Generations",
        "endpoint": "/videos/generations",
    },
    "assistants": {"label": "Assistants", "endpoint": "/assistants"},
    "fine_tuning": {"label": "Fine Tuning", "endpoint": "/fine_tuning/jobs"},
    "text_completion": {"label": "Text Completion", "endpoint": "/completions"},
    "realtime": {"label": "Realtime", "endpoint": "/realtime"},
    "count_tokens": {"label": "Count Tokens", "endpoint": "/utils/token_counter"},
    "image_variations": {"label": "Image Variations", "endpoint": "/images/variations"},
    "generateContent": {"label": "Generate Content", "endpoint": "/generateContent"},
    "bedrock_invoke": {"label": "Bedrock Invoke", "endpoint": "/bedrock/invoke"},
    "bedrock_converse": {"label": "Bedrock Converse", "endpoint": "/bedrock/converse"},
    "rag_ingest": {"label": "RAG Ingest", "endpoint": "/rag/ingest"},
    "rag_query": {"label": "RAG Query", "endpoint": "/rag/query"},
}

_SLUG_SUFFIX_RE: Final = re.compile(r"\s*\(`[^`]+`\)\s*$")

# Loaded once on first request; never invalidated (local file, no TTL needed).
_cached_endpoints: SupportedEndpointsResponse | None = None


def _clean_display_name(raw: str) -> str:
    return _SLUG_SUFFIX_RE.sub("", raw).strip()


def _build_endpoints(raw: _ProvidersFile) -> list[_EndpointEntry]:
    """Transform raw provider_endpoints_support_backup.json into the response shape."""
    providers: Final = raw.get("providers", {})

    # Collect endpoint keys in insertion order (union across all providers).
    seen: Final[set[str]] = set()
    all_keys: Final[list[str]] = []
    for provider_data in providers.values():
        for key in provider_data.get("endpoints", {}):
            if key not in seen:
                seen.add(key)
                all_keys.append(key)

    result: Final[list[_EndpointEntry]] = []
    for key in all_keys:
        meta = _ENDPOINT_METADATA.get(key)
        label = meta["label"] if meta else key.replace("_", " ").title()
        path = meta["endpoint"] if meta else "/" + key.replace("_", "/")

        supporting: list[_EndpointProviderEntry] = [
            {
                "slug": slug,
                "display_name": _clean_display_name(pd.get("display_name", slug)),
            }
            for slug, pd in providers.items()
            if pd.get("endpoints", {}).get(key)
        ]
        result.append({"key": key, "label": label, "endpoint": path, "providers": supporting})

    return result


_PROVIDERS_FILE_ADAPTER: Final = TypeAdapter(_ProvidersFile)
_PROVIDER_CREATE_FIELDS_ADAPTER: Final = TypeAdapter(list[ProviderCreateInfo])


def _load_endpoints() -> list[_EndpointEntry]:
    raw: Final = _PROVIDERS_FILE_ADAPTER.validate_python(
        json.loads(files("litellm").joinpath("provider_endpoints_support_backup.json").read_text(encoding="utf-8"))
    )
    return _build_endpoints(raw)


def _read_bundled_file(filename: str) -> bytes:
    return files("litellm.proxy.public_endpoints").joinpath(filename).read_bytes()


@cache
def _provider_create_fields() -> tuple[ProviderCreateInfo, ...]:
    return tuple(_PROVIDER_CREATE_FIELDS_ADAPTER.validate_json(_read_bundled_file("provider_create_fields.json")))


# ---------------------------------------------------------------------------


@router.get(
    "/public/providers",
    tags=["public", "providers"],
    response_model=list[str],
)
async def get_supported_providers() -> list[str]:
    """
    Return a sorted list of all providers supported by LiteLLM.
    """

    return sorted(provider.value for provider in LlmProviders)


@router.get(
    "/public/providers/fields",
    tags=["public", "providers"],
    response_model=list[ProviderCreateInfo],
)
async def get_provider_fields() -> tuple[ProviderCreateInfo, ...]:
    """
    Return provider metadata required by the dashboard create-model flow.

    Reads from the bundled local file. Result is cached in-process for the
    lifetime of the server process.
    """

    return _provider_create_fields()


@router.get(
    "/public/complexity_router/scorer_defaults",
    tags=["public", "auto router"],
    response_model=ComplexityScorerDefaults,
)
async def get_complexity_scorer_defaults() -> ComplexityScorerDefaults:
    """
    Return the complexity router's shipped heuristic scorer defaults, for the dashboard to prefill with.
    """
    from litellm.router_strategy.complexity_router.config import (
        DEFAULT_DIMENSION_WEIGHTS,
        DEFAULT_TIER_BOUNDARIES,
        DEFAULT_TOKEN_THRESHOLDS,
    )

    return ComplexityScorerDefaults(
        tier_boundaries=DEFAULT_TIER_BOUNDARIES,
        token_thresholds=DEFAULT_TOKEN_THRESHOLDS,
        dimension_weights=DEFAULT_DIMENSION_WEIGHTS,
    )


@router.get(
    "/public/complexity_router/fuse_presets",
    response_model=FusePresetCatalog,
)
async def get_public_fuse_presets() -> FusePresetCatalog:
    return get_fuse_presets()


@router.get(
    "/public/litellm_model_cost_map",
    tags=["public", "model management"],
)
async def get_litellm_model_cost_map(catalog_only: bool = False):
    """
    Public endpoint to get the LiteLLM model cost map.
    Returns pricing information for all supported models.
    With catalog_only=true, returns the catalog as loaded, without entries registered at runtime for proxy deployments.
    """
    import litellm

    try:
        _model_cost_map: Final = GetModelCostMap.loaded_model_cost_map() if catalog_only else litellm.model_cost
        return _model_cost_map
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Internal Server Error ({e})",
        )


@router.get(
    "/public/litellm_blog_posts",
    tags=["public"],
    response_model=BlogPostsResponse,
)
async def get_litellm_blog_posts() -> BlogPostsResponse:
    """
    Public endpoint to get the latest LiteLLM blog posts, each with its RSS categories as ``tags``.

    Fetches the docs RSS feed with a 1-hour in-process cache.
    Falls back to the bundled local backup on any failure.
    """
    try:
        return BlogPostsResponse(posts=get_blog_posts(url=litellm.blog_posts_url))
    except Exception as e:
        verbose_logger.warning("LiteLLM: get_litellm_blog_posts endpoint fallback triggered: %s", str(e))
        return BlogPostsResponse(posts=GetBlogPosts.load_local_blog_posts())


_AUTOROUTER_PRESETS_ADAPTER: Final = TypeAdapter(dict[str, AutoRouterPresetRecord])


def _load_bundled_autorouter_presets() -> Mapping[str, AutoRouterPresetRecord]:
    return _AUTOROUTER_PRESETS_ADAPTER.validate_python(
        json.loads(
            files("litellm.proxy.public_endpoints").joinpath("autorouter_presets.json").read_text(encoding="utf-8")
        )
    )


async def _fetch_remote_bytes(url: str) -> bytes:
    from litellm.llms.custom_httpx.http_handler import get_async_httpx_client
    from litellm.types.llms.custom_http import httpxSpecialProvider

    client: Final = get_async_httpx_client(llm_provider=httpxSpecialProvider.UI)
    response: Final = await client.get(url, timeout=5.0)
    response.raise_for_status()
    return response.content


async def _fetch_remote_autorouter_presets(url: str) -> Mapping[str, AutoRouterPresetRecord]:
    presets: Final = _AUTOROUTER_PRESETS_ADAPTER.validate_json(await _fetch_remote_bytes(url))
    if not presets:
        raise ValueError("remote auto-router preset catalog is empty")
    return presets


async def _resolve_autorouter_presets(
    url: str,
    fetch: Callable[[str], Awaitable[Mapping[str, AutoRouterPresetRecord]]],
) -> Mapping[str, AutoRouterPresetRecord]:
    if is_offline_mode() or os.getenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", "").lower() == "true":
        return _load_bundled_autorouter_presets()
    try:
        return await fetch(url)
    except Exception as e:
        verbose_logger.warning(
            "LiteLLM: failed to fetch auto-router presets from %s: %s. Serving the bundled catalog for the life of this process.",
            url,
            str(e),
        )
        return _load_bundled_autorouter_presets()


class _AutoRouterPresetsCache:
    presets: Mapping[str, AutoRouterPresetRecord] | None = None
    lock: asyncio.Lock | None = None


async def get_autorouter_presets(
    url: str,
    fetch: Callable[[str], Awaitable[Mapping[str, AutoRouterPresetRecord]]] = _fetch_remote_autorouter_presets,
) -> Mapping[str, AutoRouterPresetRecord]:
    cached: Final = _AutoRouterPresetsCache.presets
    if cached is not None:
        return cached
    if _AutoRouterPresetsCache.lock is None:
        _AutoRouterPresetsCache.lock = asyncio.Lock()
    async with _AutoRouterPresetsCache.lock:
        held: Final = _AutoRouterPresetsCache.presets
        if held is not None:
            return held
        resolved: Final = await _resolve_autorouter_presets(url=url, fetch=fetch)
        _AutoRouterPresetsCache.presets = resolved
        return resolved


@router.get(
    "/public/autorouter_presets",
    tags=["public", "auto router"],
    response_model=dict[str, AutoRouterPresetRecord],
)
async def get_public_autorouter_presets() -> Mapping[str, AutoRouterPresetRecord]:
    """
    Return the auto-router preset catalog the dashboard's template picker renders.

    Resolved once per process, like the model cost map: fetched from ``litellm.autorouter_presets_url``
    (override with ``LITELLM_AUTOROUTER_PRESETS_URL``) on the first request, falling back to the
    catalog bundled with the package on any failure. Set ``LITELLM_LOCAL_AUTOROUTER_PRESETS=True``
    to serve the bundled catalog only. A restart picks up a newly published catalog.
    """
    return await get_autorouter_presets(url=litellm.autorouter_presets_url)


@router.get(
    "/public/endpoints",
    tags=["public"],
    response_model=SupportedEndpointsResponse,
)
async def get_supported_endpoints() -> SupportedEndpointsResponse:
    """
    Return the list of LiteLLM proxy endpoints and which providers support each one.

    Reads from the bundled local backup file. Result is cached in-process for
    the lifetime of the server process.
    """
    global _cached_endpoints
    if _cached_endpoints is None:
        _cached_endpoints = SupportedEndpointsResponse(endpoints=_load_endpoints())
    return _cached_endpoints
