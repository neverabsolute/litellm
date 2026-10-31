import asyncio
import json
from typing import Final
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import TypeAdapter

import litellm
from litellm.proxy.public_endpoints import router
from litellm.router_strategy.complexity_router.fuse_presets import get_fuse_presets
from litellm.types.proxy.public_endpoints.public_endpoints import ProviderCreateInfo
from litellm.types.utils import LlmProviders


def test_meta_model_api_fields_are_separate_from_meta_llama() -> None:
    app: Final = FastAPI()
    app.include_router(router)
    response: Final = TestClient(app).get("/public/providers/fields")
    assert response.status_code == 200
    providers: Final = response.json()
    meta: Final = next((p for p in providers if p["litellm_provider"] == "meta"), None)
    llama: Final = next(p for p in providers if p["litellm_provider"] == "meta_llama")
    assert meta is not None
    assert meta["provider"] == "META"
    assert meta["provider_display_name"] == "Meta Model API"
    assert meta["default_model_placeholder"] == "meta/muse-spark-1.1"
    fields: Final = {field["key"]: field for field in meta["credential_fields"]}
    assert set(fields) == {"api_base", "api_key"}
    assert fields["api_base"]["field_type"] == "text"
    assert fields["api_key"]["field_type"] == "password"
    assert fields["api_base"]["required"] is False
    assert fields["api_key"]["required"] is False
    assert llama["provider"] == "LLAMA"
    assert llama["provider_display_name"] == "Meta Llama"


def test_bigmodel_fields_require_private_key_and_share_default_base_with_adapter() -> None:
    from litellm.llms.bigmodel.common_utils import BIGMODEL_API_BASE

    app: Final = FastAPI()
    app.include_router(router)
    response: Final = TestClient(app).get("/public/providers/fields")
    assert response.status_code == 200
    providers: Final = TypeAdapter(list[ProviderCreateInfo]).validate_python(response.json())
    provider: Final = next(item for item in providers if item.litellm_provider == "bigmodel")
    fields: Final = {field.key: field for field in provider.credential_fields}
    assert provider.provider_display_name == "BigModel (Zhipu AI)"
    assert fields["api_key"].required is True
    assert fields["api_key"].field_type == "password"
    assert fields["api_base"].required is False
    assert fields["api_base"].default_value == BIGMODEL_API_BASE
    assert fields["api_base"].placeholder == BIGMODEL_API_BASE
    assert provider.default_model_placeholder is not None
    assert provider.default_model_placeholder.startswith("bigmodel/")


def test_fuse_presets_route_serves_the_shared_catalog_without_authentication() -> None:
    app: Final = FastAPI()
    app.include_router(router)
    client: Final = TestClient(app)
    response: Final = client.get("/public/complexity_router/fuse_presets")
    assert response.status_code == 200
    assert response.json() == get_fuse_presets().model_dump(mode="json")
    assert client.get("/public/complexity_router/fuse_presets").json() == response.json()


def test_get_supported_providers_returns_enum_values():
    app_instance = FastAPI()
    app_instance.include_router(router)
    client = TestClient(app_instance)

    response = client.get("/public/providers")

    assert response.status_code == 200
    expected_providers = sorted(provider.value for provider in LlmProviders)
    assert response.json() == expected_providers


def test_get_provider_create_fields():
    app_instance = FastAPI()
    app_instance.include_router(router)
    client = TestClient(app_instance)

    response = client.get("/public/providers/fields")

    assert response.status_code == 200

    response_data = response.json()

    assert isinstance(response_data, list)

    assert len(response_data) > 0

    first_provider = response_data[0]
    assert "provider" in first_provider
    assert "provider_display_name" in first_provider
    assert "litellm_provider" in first_provider
    assert "credential_fields" in first_provider

    assert isinstance(first_provider["credential_fields"], list)

    has_detailed_fields = any(
        provider.get("credential_fields") and len(provider.get("credential_fields", [])) > 0
        for provider in response_data
    )
    assert has_detailed_fields, "Expected at least one provider to have detailed credential fields"


def test_get_litellm_model_cost_map_catalog_only_excludes_runtime_registered_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from litellm.litellm_core_utils.get_model_cost_map import GetModelCostMap

    monkeypatch.setattr(litellm, "model_cost", dict(litellm.model_cost))
    runtime_key: Final = "lit-9263-deployment-alias"
    litellm.register_model({runtime_key: {"litellm_provider": "openai", "mode": "chat"}}, persist_across_reloads=False)
    app: Final = FastAPI()
    app.include_router(router)
    client: Final = TestClient(app)

    live_response: Final = client.get("/public/litellm_model_cost_map")
    catalog_response: Final = client.get("/public/litellm_model_cost_map", params={"catalog_only": "true"})

    assert live_response.status_code == 200
    assert live_response.json()[runtime_key]["litellm_provider"] == "openai"
    assert catalog_response.status_code == 200
    catalog_payload: Final = catalog_response.json()
    assert runtime_key not in catalog_payload
    assert catalog_payload == json.loads(
        json.dumps({key: dict(entry) for key, entry in GetModelCostMap.loaded_model_cost_map().items()})
    )


def test_get_litellm_model_cost_map_returns_cost_map():
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/public/litellm_model_cost_map")

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload, dict)
    assert len(payload) > 0, "Expected model cost map to contain at least one model"

    # Verify the structure contains expected keys for at least one model
    # Check for a common model like gpt-4 or gpt-3.5-turbo
    model_keys = list(payload.keys())
    assert len(model_keys) > 0

    # Verify at least one model has expected cost fields
    sample_model = model_keys[0]
    sample_model_data = payload[sample_model]
    assert isinstance(sample_model_data, dict)
    # Check for common cost fields that should be present
    assert "input_cost_per_token" in sample_model_data or "output_cost_per_token" in sample_model_data


def test_watsonx_provider_fields():
    """Test that Watsonx provider has all required credential fields including multiple auth options."""
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/public/providers/fields")
    providers = response.json()

    watsonx = next((p for p in providers if p["provider"] == "WATSONX"), None)
    assert watsonx is not None

    field_keys = [f["key"] for f in watsonx["credential_fields"]]
    # Core fields
    assert "api_base" in field_keys
    assert "project_id" in field_keys
    assert "space_id" in field_keys
    # Multiple auth methods supported
    assert "api_key" in field_keys
    assert "token" in field_keys
    assert "zen_api_key" in field_keys


def test_azure_provider_fields_include_entra_id():
    """Azure provider must expose Entra ID (Service Principal) credential fields so
    the UI can input tenant_id / client_id / client_secret as an alternative to api_key.
    """
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/public/providers/fields")
    providers = response.json()

    azure = next((p for p in providers if p["provider"] == "Azure"), None)
    assert azure is not None

    fields_by_key = {f["key"]: f for f in azure["credential_fields"]}
    # API-key auth still supported
    assert "api_key" in fields_by_key
    # Entra ID fields
    assert "tenant_id" in fields_by_key
    assert "client_id" in fields_by_key
    assert "client_secret" in fields_by_key
    # client_secret must be masked in the UI
    assert fields_by_key["client_secret"]["field_type"] == "password"
    # Entra ID is an alternative to api_key, so none of these are individually required
    assert fields_by_key["tenant_id"]["required"] is False
    assert fields_by_key["client_id"]["required"] is False
    assert fields_by_key["client_secret"]["required"] is False


def test_anthropic_provider_fields_support_byok():
    """
    The Anthropic provider form must allow BYOK:
    - api_key is optional (not required) so admins can create models without a key
    - api_key has a non-null tooltip explaining the BYOK use case
    """
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    anthropic = next((p for p in providers if p["provider"] == "Anthropic"), None)
    assert anthropic is not None, "Anthropic provider entry not found"

    fields_by_key = {f["key"]: f for f in anthropic["credential_fields"]}
    assert "api_key" in fields_by_key
    assert fields_by_key["api_key"]["required"] is False, (
        "Anthropic api_key must be optional so admins can configure BYOK models "
        "without entering a key. See BYOK tutorial."
    )
    assert fields_by_key["api_key"].get("tooltip"), (
        "Anthropic api_key must have a tooltip explaining the BYOK use case."
    )
    assert "api_base" in fields_by_key, (
        "Anthropic provider form must expose api_base so cloud customers "
        "can override the upstream URL without env var access."
    )
    api_base_field = fields_by_key["api_base"]
    assert api_base_field["required"] is False
    assert api_base_field["field_type"] == "text"
    assert api_base_field.get("tooltip"), "api_base should have a tooltip explaining it is optional."

    # UI forms render fields in credential_fields order; api_base should come first
    # so an admin sees the URL override before the key field.
    field_order = [f["key"] for f in anthropic["credential_fields"]]
    assert field_order.index("api_base") < field_order.index("api_key"), (
        "api_base must appear before api_key in credential_fields (matches AI21 and ANTHROPIC_TEXT convention)."
    )


def test_bedrock_mantle_provider_fields():
    """Amazon Bedrock Mantle must be a selectable provider in the Add Model flow.

    The dropdown is driven entirely by /public/providers/fields, so a missing
    entry means Mantle cannot be added through the UI at all (regression guard
    for LIT-3885). The credential fields must match what the backend actually
    honors: an optional bearer api_key (BYOK), the AWS SigV4 chain, a region,
    and an api_base override.
    """
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    mantle = next((p for p in providers if p["provider"] == "BedrockMantle"), None)
    assert mantle is not None, "Bedrock Mantle provider entry not found"

    # provider must equal the UI provider_map key so the model dropdown resolves
    # bedrock_mantle models; litellm_provider must be the backend slug.
    assert mantle["provider_display_name"] == "Amazon Bedrock Mantle"
    assert mantle["litellm_provider"] == "bedrock_mantle"
    assert mantle["default_model_placeholder"].startswith("bedrock_mantle/")

    fields_by_key = {f["key"]: f for f in mantle["credential_fields"]}

    # Bearer-token auth is BYOK: optional and masked.
    assert "api_key" in fields_by_key
    assert fields_by_key["api_key"]["required"] is False
    assert fields_by_key["api_key"]["field_type"] == "password"

    # AWS SigV4 fallback credentials.
    assert fields_by_key["aws_access_key_id"]["field_type"] == "password"
    assert fields_by_key["aws_secret_access_key"]["field_type"] == "password"
    assert "aws_region_name" in fields_by_key

    # api_base override so admins can target a custom Mantle host without env access.
    assert fields_by_key["api_base"]["field_type"] == "text"


def test_vllm_provider_display_names_are_distinct():
    """Hosted and local vLLM must not share a dropdown label.

    The Add Model provider dropdown is driven by /public/providers/fields.
    Both entries previously rendered as near-identical "vllm"/"Vllm" rows
    with the same logo, so admins could not tell them apart.
    """
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    hosted = next((p for p in providers if p["provider"] == "Hosted_Vllm"), None)
    local = next((p for p in providers if p["provider"] == "VLLM"), None)
    assert hosted is not None, "Hosted vLLM provider entry not found"
    assert local is not None, "Local vLLM provider entry not found"

    assert hosted["provider_display_name"] == "Hosted vLLM"
    assert local["provider_display_name"] == "Local vLLM"
    assert hosted["provider_display_name"].casefold() != local["provider_display_name"].casefold()
    assert hosted["litellm_provider"] == "hosted_vllm"
    assert local["litellm_provider"] == "vllm"


def test_nvidia_riva_provider_fields():
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    riva = next((p for p in providers if p["provider"] == "NVIDIA_RIVA"), None)
    assert riva is not None, "NVIDIA Riva provider entry not found"

    assert riva["provider_display_name"] == "Nvidia Riva"
    assert riva["litellm_provider"] == LlmProviders.NVIDIA_RIVA.value
    assert riva["default_model_placeholder"].startswith("nvidia_riva/")

    fields_by_key = {f["key"]: f for f in riva["credential_fields"]}

    assert fields_by_key["api_base"]["required"] is True
    assert fields_by_key["api_base"]["field_type"] == "text"

    assert fields_by_key["api_key"]["required"] is False
    assert fields_by_key["api_key"]["field_type"] == "password"

    assert "nvcf_function_id" in fields_by_key
    assert fields_by_key["nvcf_function_id"]["required"] is False


def test_cognition_provider_fields():
    """Cognition must be selectable in the Add Model flow (LIT-5348).

    The dropdown is driven entirely by /public/providers/fields, so without an
    entry here admins have to fall back to the generic OpenAI-compatible route,
    which is exactly the provider identity mix-up this feature removes.
    """
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    cognition = next((p for p in providers if p["provider"] == "Cognition"), None)
    assert cognition is not None, "Cognition provider entry not found"

    assert cognition["provider_display_name"] == "Cognition"
    assert cognition["litellm_provider"] == "cognition"
    assert cognition["default_model_placeholder"].startswith("cognition/")

    fields_by_key = {f["key"]: f for f in cognition["credential_fields"]}

    assert fields_by_key["api_key"]["required"] is True
    assert fields_by_key["api_key"]["field_type"] == "password"

    assert fields_by_key["api_base"]["field_type"] == "text"
    assert fields_by_key["api_base"]["required"] is False


def test_zai_provider_fields():
    from litellm.llms.zai.chat.transformation import ZAI_API_BASE

    app_instance: Final = FastAPI()
    app_instance.include_router(router)
    test_client: Final = TestClient(app_instance)

    response: Final = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers: Final = response.json()

    zai: Final = next((p for p in providers if p["provider"] == "ZAI"), None)
    assert zai is not None, "Z.AI provider entry not found"

    assert zai["provider_display_name"] == "Z.AI (Zhipu AI)"
    assert zai["litellm_provider"] == "zai"
    assert zai["default_model_placeholder"].startswith("zai/")

    fields_by_key: Final = {f["key"]: f for f in zai["credential_fields"]}

    assert fields_by_key["api_key"]["required"] is True
    assert fields_by_key["api_key"]["field_type"] == "password"

    assert fields_by_key["api_base"]["required"] is False
    assert fields_by_key["api_base"]["field_type"] == "text"
    assert fields_by_key["api_base"]["placeholder"] == ZAI_API_BASE


def test_zerogpu_add_model_form_defaults_resolve_to_a_priced_zerogpu_model():
    import litellm
    from litellm.litellm_core_utils.get_llm_provider_logic import get_llm_provider

    app_instance: Final = FastAPI()
    app_instance.include_router(router)
    providers: Final = TestClient(app_instance).get("/public/providers/fields").json()

    zerogpu: Final = next(p for p in providers if p["litellm_provider"] == "zerogpu")
    fields_by_key: Final = {f["key"]: f for f in zerogpu["credential_fields"]}
    placeholder: Final = zerogpu["default_model_placeholder"]
    _, provider, _, api_base = get_llm_provider(model=placeholder)

    assert provider == "zerogpu"
    assert api_base == fields_by_key["api_base"]["placeholder"]
    assert litellm.model_cost[placeholder]["litellm_provider"] == "zerogpu"
    assert fields_by_key["api_key"]["required"] is True
    assert fields_by_key["api_key"]["field_type"] == "password"


def test_qwen_mainland_provider_fields_carry_the_qianwen_brand():
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    providers = test_client.get("/public/providers/fields").json()

    mainland = next(p for p in providers if p["litellm_provider"] == "qwen_ai_platform")
    international = next(p for p in providers if p["litellm_provider"] == "qwencloud")

    assert mainland["provider_display_name"] == "Qianwen AI Platform"
    assert international["provider_display_name"] == "QwenCloud"

    mainland_fields = {f["key"]: f for f in mainland["credential_fields"]}
    assert mainland_fields["api_key"]["label"] == "Qianwen AI Platform API Key"
    assert "Qianwen AI Platform" in mainland_fields["api_base"]["tooltip"]
    assert "Qwen AI Platform" not in json.dumps(mainland)


def test_chatgpt_provider_fields():
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    chatgpt = next((p for p in providers if p["provider"] == "CHATGPT"), None)
    assert chatgpt is not None, "ChatGPT provider entry not found"

    assert chatgpt["provider_display_name"] == "ChatGPT Subscription"
    assert chatgpt["litellm_provider"] == LlmProviders.CHATGPT.value
    assert chatgpt["default_model_placeholder"].startswith("chatgpt/")
    assert chatgpt["credential_fields"] == []


def test_tencent_provider_fields():
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    tencent = next((p for p in providers if p["provider"] == "Tencent"), None)
    assert tencent is not None, "Tencent provider entry not found"

    assert tencent["provider_display_name"] == "Tencent"
    assert tencent["litellm_provider"] == LlmProviders.TENCENT.value
    assert tencent["default_model_placeholder"].startswith("tencent/")

    fields_by_key = {f["key"]: f for f in tencent["credential_fields"]}

    assert fields_by_key["api_key"]["required"] is True
    assert fields_by_key["api_key"]["field_type"] == "password"

    assert fields_by_key["api_base"]["field_type"] == "text"
    assert fields_by_key["api_base"]["required"] is False


def _decisions_provider_entry(provider: str) -> ProviderCreateInfo:
    app_instance: Final = FastAPI()
    app_instance.include_router(router)
    test_client: Final = TestClient(app_instance)

    response: Final = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers: Final = TypeAdapter(list[ProviderCreateInfo]).validate_python(response.json())
    entry: Final = next((p for p in providers if p.provider == provider), None)
    assert entry is not None, f"{provider} provider entry not found"
    return entry


@pytest.mark.parametrize(
    ("provider_key", "display_name", "provider"),
    (
        ("TypeSafe", "TypeSafe", LlmProviders.TYPESAFE),
        ("Nace", "Nace", LlmProviders.NACE),
        ("EU_JEV", "eu/jev", LlmProviders.EU_JEV),
    ),
)
def test_decisions_provider_fields(provider_key: str, display_name: str, provider: LlmProviders) -> None:
    entry: Final = _decisions_provider_entry(provider_key)

    assert entry.provider_display_name == display_name
    assert entry.litellm_provider == provider.value
    assert entry.default_model_placeholder is not None
    assert entry.default_model_placeholder.startswith(f"{provider.value}/")

    fields_by_key: Final = {f.key: f for f in entry.credential_fields}

    assert fields_by_key["api_key"].required is True
    assert fields_by_key["api_key"].field_type == "password"

    assert fields_by_key["api_base"].required is False
    assert fields_by_key["api_base"].field_type == "text"


def test_strands_decider_provider_fields():
    strands: Final = _decisions_provider_entry("StrandsDecider")

    assert strands.provider_display_name == "Strands Decider"
    assert strands.litellm_provider == LlmProviders.STRANDS_DECIDER.value
    assert strands.default_model_placeholder is not None
    assert strands.default_model_placeholder.startswith("strands_decider/")

    fields_by_key: Final = {f.key: f for f in strands.credential_fields}

    assert fields_by_key["api_base"].required is True
    assert fields_by_key["api_base"].field_type == "text"

    assert fields_by_key["api_key"].required is False
    assert fields_by_key["api_key"].field_type == "password"


@pytest.mark.parametrize(
    ("provider", "display_name", "litellm_provider", "model_placeholder"),
    (
        ("Laya", "Laya", LlmProviders.LAYA.value, "laya/english"),
        ("Bespoke", "Bespoke Nimble", LlmProviders.BESPOKE.value, "bespoke/nimble"),
    ),
)
def test_oss_decisions_provider_fields(
    provider: str, display_name: str, litellm_provider: str, model_placeholder: str
) -> None:
    entry: Final = _decisions_provider_entry(provider)

    assert entry.provider_display_name == display_name
    assert entry.litellm_provider == litellm_provider
    assert entry.default_model_placeholder == model_placeholder

    fields_by_key: Final = {f.key: f for f in entry.credential_fields}

    assert fields_by_key["api_base"].required is True
    assert fields_by_key["api_base"].field_type == "text"

    assert fields_by_key["api_key"].required is False
    assert fields_by_key["api_key"].field_type == "password"


ADD_MODEL_UNLISTED_PROVIDERS: Final = frozenset(
    {
        "a2a",
        "a2a_agent",
        "amazon_nova",
        "apertis",
        "aws_polly",
        "black_forest_labs",
        "charity_engine",
        "chutes",
        "darkbloom",
        "databricks_agent",
        "gdc",
        "helicone",
        "inception",
        "langflow",
        "langgraph",
        "libertai",
        "litellm_agent",
        "manus",
        "modelscope",
        "mongodb",
        "nano-gpt",
        "neosantara",
        "opensearch",
        "parasail",
        "pinstripes",
        "poe",
        "publicai",
        "ragflow",
        "reducto",
        "s3_vectors",
        "sagemaker_nova",
        "scaleway",
        "stability",
        "synthetic",
        "tensormesh",
        "text-completion-inception",
        "transcribe",
        "valkey",
        "xiaomi_mimo",
    }
)


def test_every_backend_provider_is_listed_in_add_model_or_frozen_as_unlisted():
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    listed = {p["litellm_provider"] for p in response.json()}

    unlisted = {provider.value for provider in LlmProviders} - listed
    assert unlisted == ADD_MODEL_UNLISTED_PROVIDERS, (
        "Add Model dropdown drift: give the new provider an entry in provider_create_fields.json "
        "rather than adding it to ADD_MODEL_UNLISTED_PROVIDERS"
    )


def test_google_ai_studio_provider_fields_expose_api_base():
    """The Google AI Studio (gemini) credential form must let admins set a custom
    api_base so they can point at a Gemini-compatible gateway (e.g. a self-hosted
    proxy at /v1beta) without env var access.

    The runtime gemini provider already supports custom api_base via
    `vertex_llm_base._check_custom_proxy`; the UI just needs to expose the field.
    """
    app_instance = FastAPI()
    app_instance.include_router(router)
    test_client = TestClient(app_instance)

    response = test_client.get("/public/providers/fields")
    assert response.status_code == 200
    providers = response.json()

    google_ai = next((p for p in providers if p["provider"] == "Google_AI_Studio"), None)
    assert google_ai is not None, "Google_AI_Studio provider entry not found"
    assert google_ai["litellm_provider"] == "gemini"

    fields_by_key = {f["key"]: f for f in google_ai["credential_fields"]}
    assert "api_key" in fields_by_key
    assert "api_base" in fields_by_key, (
        "Google_AI_Studio provider form must expose api_base so admins can "
        "point at a Gemini-compatible gateway without env var access."
    )

    api_base_field = fields_by_key["api_base"]
    assert api_base_field["required"] is False
    assert api_base_field["field_type"] == "text"
    # default_value MUST be null (not the canonical URL): saving it as the
    # default would persist v1beta into every credential record and bypass
    # `get_gemini_url`'s automatic v1alpha routing for Gemini 3+ models. The
    # placeholder shows the canonical URL so users still get the visual hint.
    # (See greptileai threads on PR #30419.)
    assert api_base_field["default_value"] is None
    assert api_base_field["placeholder"] == "https://generativelanguage.googleapis.com/v1beta"

    # UI forms render fields in credential_fields order; api_base should come
    # first so an admin sees the URL override before the key field (matches
    # OpenAI and Anthropic conventions).
    field_order = [f["key"] for f in google_ai["credential_fields"]]
    assert field_order.index("api_base") < field_order.index("api_key"), (
        "api_base must appear before api_key in credential_fields."
    )


# ---------------------------------------------------------------------------
# /public/endpoints
# ---------------------------------------------------------------------------

import litellm.proxy.public_endpoints.public_endpoints as _pe_module
from litellm.proxy.public_endpoints.public_endpoints import (
    _build_endpoints,
    _clean_display_name,
)


@pytest.fixture(autouse=False)
def reset_endpoints_cache():
    """Reset the module-level cache before and after each cache-related test."""
    original = _pe_module._cached_endpoints
    _pe_module._cached_endpoints = None
    yield
    _pe_module._cached_endpoints = original


def _make_client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_get_supported_endpoints_returns_200(reset_endpoints_cache):
    response = _make_client().get("/public/endpoints")
    assert response.status_code == 200


def test_get_supported_endpoints_response_shape(reset_endpoints_cache):
    data = _make_client().get("/public/endpoints").json()
    assert "endpoints" in data
    assert isinstance(data["endpoints"], list)
    assert len(data["endpoints"]) > 0


def test_get_supported_endpoints_item_fields(reset_endpoints_cache):
    endpoints = _make_client().get("/public/endpoints").json()["endpoints"]
    for item in endpoints:
        assert "key" in item
        assert "label" in item
        assert "endpoint" in item
        assert "providers" in item
        assert isinstance(item["providers"], list)


def test_get_supported_endpoints_provider_fields(reset_endpoints_cache):
    endpoints = _make_client().get("/public/endpoints").json()["endpoints"]
    for item in endpoints:
        for provider in item["providers"]:
            assert "slug" in provider
            assert "display_name" in provider


def test_get_supported_endpoints_paths_start_with_slash(reset_endpoints_cache):
    endpoints = _make_client().get("/public/endpoints").json()["endpoints"]
    for item in endpoints:
        assert item["endpoint"].startswith("/"), f"Expected path starting with /, got: {item['endpoint']}"


def test_get_supported_endpoints_chat_completions_present(reset_endpoints_cache):
    endpoints = _make_client().get("/public/endpoints").json()["endpoints"]
    keys = [item["key"] for item in endpoints]
    assert "chat_completions" in keys

    chat = next(item for item in endpoints if item["key"] == "chat_completions")
    assert chat["endpoint"] == "/chat/completions"
    assert chat["label"] == "Chat Completions"
    assert len(chat["providers"]) > 0


def test_get_supported_endpoints_lists_streamlake_on_chat_messages_and_responses(
    reset_endpoints_cache: None,
) -> None:
    app: Final[FastAPI] = FastAPI()
    app.include_router(router)
    client: Final[TestClient] = TestClient(app)
    with client:
        response: Final = client.get("/public/endpoints")
    assert response.status_code == 200, response.text

    streamlake_endpoints: Final = {
        endpoint["key"]
        for endpoint in response.json()["endpoints"]
        if any(provider["slug"] == "streamlake" for provider in endpoint["providers"])
    }
    assert {"chat_completions", "messages", "responses"} <= streamlake_endpoints
    assert "embeddings" not in streamlake_endpoints


def test_get_supported_endpoints_display_names_have_no_slug_suffix(
    reset_endpoints_cache,
):
    """Provider display_names must not contain the raw `` (`slug`) `` suffix."""
    import re

    suffix_re = re.compile(r"\(`[^`]+`\)")
    endpoints = _make_client().get("/public/endpoints").json()["endpoints"]
    for item in endpoints:
        for provider in item["providers"]:
            assert not suffix_re.search(provider["display_name"]), (
                f"display_name still contains slug suffix: {provider['display_name']!r}"
            )


def test_get_supported_endpoints_is_cached(reset_endpoints_cache):
    """`_load_endpoints` is called only once; subsequent requests use the cache."""
    client = _make_client()
    with patch(
        "litellm.proxy.public_endpoints.public_endpoints._load_endpoints",
        wraps=_pe_module._load_endpoints,
    ) as mock_load:
        client.get("/public/endpoints")
        client.get("/public/endpoints")
        client.get("/public/endpoints")

    mock_load.assert_called_once()


# ---------------------------------------------------------------------------
# _build_endpoints unit tests (transformation logic)
# ---------------------------------------------------------------------------

_MINIMAL_RAW = {
    "providers": {
        "openai": {
            "display_name": "OpenAI (`openai`)",
            "url": "https://example.com",
            "endpoints": {
                "chat_completions": True,
                "embeddings": True,
                "images": False,
            },
        },
        "anthropic": {
            "display_name": "Anthropic (`anthropic`)",
            "url": "https://example.com",
            "endpoints": {
                "chat_completions": True,
                "embeddings": False,
                "images": False,
            },
        },
    }
}


def test_build_endpoints_known_key_uses_metadata():
    result = _build_endpoints(_MINIMAL_RAW)
    chat = next(e for e in result if e["key"] == "chat_completions")
    assert chat["label"] == "Chat Completions"
    assert chat["endpoint"] == "/chat/completions"


def test_build_endpoints_only_includes_supporting_providers():
    result = _build_endpoints(_MINIMAL_RAW)
    embeddings = next(e for e in result if e["key"] == "embeddings")
    slugs = [p["slug"] for p in embeddings["providers"]]
    assert slugs == ["openai"]


def test_build_endpoints_unknown_key_derives_label_and_path():
    raw = {
        "providers": {
            "someprovider": {
                "display_name": "Some Provider (`someprovider`)",
                "endpoints": {"my_custom_endpoint": True},
            }
        }
    }
    result = _build_endpoints(raw)
    item = result[0]
    assert item["key"] == "my_custom_endpoint"
    assert item["label"] == "My Custom Endpoint"
    assert item["endpoint"].startswith("/")


def test_build_endpoints_empty_providers_returns_empty():
    result = _build_endpoints({"providers": {}})
    assert result == []


def test_clean_display_name_strips_suffix():
    assert _clean_display_name("OpenAI (`openai`)") == "OpenAI"
    assert _clean_display_name("AI/ML API (`aiml`)") == "AI/ML API"
    assert _clean_display_name("A2A (Agent-to-Agent) (`a2a`)") == "A2A (Agent-to-Agent)"


def test_clean_display_name_passthrough_when_no_suffix():
    assert _clean_display_name("OpenAI") == "OpenAI"
    assert _clean_display_name("") == ""


@pytest.fixture
def reset_autorouter_presets_cache():
    from litellm.proxy.public_endpoints.public_endpoints import _AutoRouterPresetsCache

    _AutoRouterPresetsCache.presets = None
    _AutoRouterPresetsCache.lock = None
    yield
    _AutoRouterPresetsCache.presets = None
    _AutoRouterPresetsCache.lock = None


def test_get_autorouter_presets_local_mode_serves_bundled_catalog(monkeypatch, reset_autorouter_presets_cache):
    monkeypatch.setenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", "True")
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/public/autorouter_presets")

    assert response.status_code == 200
    payload = response.json()
    assert "anthropic_family" in payload
    assert payload["1m_context"]["complexity_router_config"]["classifier_type"] == "heuristic_v2"
    assert payload["1m_context"]["complexity_router_config"]["tiers"] == {
        "SIMPLE": ["gpt-6-luna"],
        "MEDIUM": ["gpt-5.6-terra"],
        "COMPLEX": ["gpt-6-sol"],
        "REASONING": ["claude-opus-5-5"],
    }
    assert payload["1m_context"]["complexity_router_config"]["tier_model_configs"] == {
        "REASONING": [{"model_name": "claude-opus-5-5", "litellm_params": {"reasoning_effort": "high"}}]
    }
    for preset in payload.values():
        assert isinstance(preset["label"], str)
        assert isinstance(preset["description"], str)
        assert "tiers" in preset["complexity_router_config"]


@pytest.mark.asyncio
async def test_get_autorouter_presets_fetches_once_per_process(monkeypatch, reset_autorouter_presets_cache):
    from litellm.proxy.public_endpoints.public_endpoints import (
        _AUTOROUTER_PRESETS_ADAPTER,
        get_autorouter_presets,
    )

    monkeypatch.delenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", raising=False)
    remote = _AUTOROUTER_PRESETS_ADAPTER.validate_python(
        {
            "remote_only": {
                "label": "Remote Only",
                "description": "from the remote catalog",
                "complexity_router_config": {
                    "tiers": {"SIMPLE": ["m1"], "MEDIUM": ["m2"], "COMPLEX": ["m3"], "REASONING": ["m4"]}
                },
            }
        }
    )
    calls = []

    async def fake_fetch(url):
        calls.append(url)
        return remote

    first = await get_autorouter_presets(url="https://example.test/presets.json", fetch=fake_fetch)
    second = await get_autorouter_presets(url="https://example.test/presets.json", fetch=fake_fetch)

    assert first == remote
    assert second == remote
    assert calls == ["https://example.test/presets.json"]


@pytest.mark.asyncio
@pytest.mark.parametrize("flag", ["LITELLM_LOCAL_AUTOROUTER_PRESETS", "LITELLM_OFFLINE_MODE"])
async def test_get_autorouter_presets_local_flags_serve_bundled_without_fetching(
    monkeypatch, reset_autorouter_presets_cache, flag
):
    from litellm.proxy.public_endpoints.public_endpoints import (
        _load_bundled_autorouter_presets,
        get_autorouter_presets,
    )

    monkeypatch.delenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", raising=False)
    monkeypatch.setenv(flag, "True")
    calls = []

    async def fake_fetch(url):
        calls.append(url)
        raise AssertionError("no fetch when the bundled catalog is forced")

    presets = await get_autorouter_presets(url="https://example.test/presets.json", fetch=fake_fetch)

    assert presets == _load_bundled_autorouter_presets()
    assert calls == []


@pytest.mark.asyncio
async def test_get_autorouter_presets_single_flight_on_concurrent_cold_start(
    monkeypatch, reset_autorouter_presets_cache
):

    from litellm.proxy.public_endpoints.public_endpoints import (
        _AUTOROUTER_PRESETS_ADAPTER,
        get_autorouter_presets,
    )

    monkeypatch.delenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", raising=False)
    remote = _AUTOROUTER_PRESETS_ADAPTER.validate_python(
        {
            "remote_only": {
                "label": "Remote Only",
                "description": "from the remote catalog",
                "complexity_router_config": {
                    "tiers": {"SIMPLE": ["m1"], "MEDIUM": ["m2"], "COMPLEX": ["m3"], "REASONING": ["m4"]}
                },
            }
        }
    )
    calls = []

    async def slow_fetch(url):
        calls.append(url)
        await asyncio.sleep(0.05)
        return remote

    results = await asyncio.gather(
        get_autorouter_presets(url="https://example.test/presets.json", fetch=slow_fetch),
        get_autorouter_presets(url="https://example.test/presets.json", fetch=slow_fetch),
        get_autorouter_presets(url="https://example.test/presets.json", fetch=slow_fetch),
    )

    assert all(result == remote for result in results)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_get_autorouter_presets_caches_bundled_fallback_on_remote_failure(
    monkeypatch, reset_autorouter_presets_cache
):
    from litellm.proxy.public_endpoints.public_endpoints import get_autorouter_presets

    monkeypatch.delenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", raising=False)
    calls = []

    async def broken_fetch(url):
        calls.append(url)
        raise ValueError("remote catalog unavailable")

    first = await get_autorouter_presets(url="https://example.test/presets.json", fetch=broken_fetch)
    second = await get_autorouter_presets(url="https://example.test/presets.json", fetch=broken_fetch)

    assert "anthropic_family" in first
    assert second == first
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_autorouter_presets_adapter_rejects_wrong_shapes():
    from pydantic import ValidationError

    from litellm.proxy.public_endpoints.public_endpoints import _AUTOROUTER_PRESETS_ADAPTER

    with pytest.raises(ValidationError):
        _AUTOROUTER_PRESETS_ADAPTER.validate_python({"bad": {"label": "no description or config"}})
    with pytest.raises(ValidationError):
        _AUTOROUTER_PRESETS_ADAPTER.validate_python(["not", "a", "mapping"])
    with pytest.raises(ValidationError):
        _AUTOROUTER_PRESETS_ADAPTER.validate_python(
            {"no_tiers": {"label": "L", "description": "D", "complexity_router_config": {}}}
        )
    with pytest.raises(ValidationError):
        _AUTOROUTER_PRESETS_ADAPTER.validate_python(
            {
                "missing_builtin_tier": {
                    "label": "L",
                    "description": "D",
                    "complexity_router_config": {"tiers": {"SIMPLE": ["m1"], "MEDIUM": ["m2"], "COMPLEX": ["m3"]}},
                }
            }
        )
    with pytest.raises(ValidationError):
        _AUTOROUTER_PRESETS_ADAPTER.validate_python(
            {
                "unknown_tier_name": {
                    "label": "L",
                    "description": "D",
                    "complexity_router_config": {
                        "tiers": {
                            "SIMPLE": ["m1"],
                            "MEDIUM": ["m2"],
                            "COMPLEX": ["m3"],
                            "REASONING": ["m4"],
                            "ULTRA": ["m5"],
                        }
                    },
                }
            }
        )
    with pytest.raises(ValidationError):
        _AUTOROUTER_PRESETS_ADAPTER.validate_python(
            {
                "bad_tiers": {
                    "label": "L",
                    "description": "D",
                    "complexity_router_config": {"tiers": "not-a-mapping"},
                }
            }
        )


def test_get_autorouter_presets_passes_unknown_catalog_fields_through(monkeypatch, reset_autorouter_presets_cache):
    from litellm.proxy.public_endpoints.public_endpoints import (
        _AUTOROUTER_PRESETS_ADAPTER,
        _AutoRouterPresetsCache,
    )

    monkeypatch.delenv("LITELLM_LOCAL_AUTOROUTER_PRESETS", raising=False)
    _AutoRouterPresetsCache.presets = _AUTOROUTER_PRESETS_ADAPTER.validate_python(
        {
            "future_preset": {
                "label": "Future",
                "description": "carries fields this proxy version does not know",
                "complexity_router_config": {
                    "tiers": {"SIMPLE": ["m1"], "MEDIUM": ["m2"], "COMPLEX": ["m3"], "REASONING": ["m4"]},
                    "future_config_knob": 3,
                },
                "icon": "sparkles",
            }
        }
    )
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    response = client.get("/public/autorouter_presets")

    assert response.status_code == 200
    served = response.json()["future_preset"]
    assert served["icon"] == "sparkles"
    assert served["complexity_router_config"]["future_config_knob"] == 3
    assert served["complexity_router_config"]["tiers"]["SIMPLE"] == ["m1"]


@pytest.mark.asyncio
async def test_fetch_remote_autorouter_presets_parses_and_rejects_empty(monkeypatch):
    import litellm.llms.custom_httpx.http_handler as http_handler_module
    from litellm.proxy.public_endpoints.public_endpoints import _fetch_remote_autorouter_presets

    catalog = {
        "remote_only": {
            "label": "Remote Only",
            "description": "from the remote catalog",
            "complexity_router_config": {
                "tiers": {"SIMPLE": ["m1"], "MEDIUM": ["m2"], "COMPLEX": ["m3"], "REASONING": ["m4"]}
            },
        }
    }
    response = MagicMock()
    response.raise_for_status = MagicMock()
    response.content = json.dumps(catalog).encode()
    client = MagicMock()
    client.get = AsyncMock(return_value=response)
    monkeypatch.setattr(http_handler_module, "get_async_httpx_client", lambda llm_provider: client)

    presets = await _fetch_remote_autorouter_presets("https://example.test/presets.json")
    assert presets["remote_only"].label == "Remote Only"
    response.raise_for_status.assert_called_once()

    response.content = b"{}"
    with pytest.raises(ValueError, match="empty"):
        await _fetch_remote_autorouter_presets("https://example.test/presets.json")
