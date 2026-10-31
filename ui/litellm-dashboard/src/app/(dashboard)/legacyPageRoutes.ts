import { uiHref } from "@/utils/uiHref";

const LEGACY_PAGE_ROUTES: ReadonlyMap<string, string> = new Map(
  Object.entries({
    home: "home",
    "api-keys": "api-keys",
    models: "models-and-endpoints",
    api_ref: "api-reference",
    "api-reference": "api-reference",
    "llm-playground": "playground",
    projects: "projects",
    chat: "chat",
    budgets: "budgets",
    "tag-management": "tag-management",
    prompts: "prompts",
    caching: "caching",
    "cost-tracking": "cost-tracking",
    "transform-request": "transform-request",
    "ui-theme": "ui-theme",
    telemetry: "telemetry",
    logs: "logs",
    "admin-panel": "admin-panel",
    "logging-and-alerts": "logging-and-alerts",
    new_usage: "usage",
    usage: "usage",
    "cost-optimization": "cost-optimization",
    "model-insights": "model-insights",
    "ip-analytics": "ip-analytics",
    "router-settings": "router-settings",
    users: "users",
    teams: "teams",
    organizations: "organizations",
  }),
);

export function legacyPageRedirectHref(searchParams: URLSearchParams): string | null {
  const page = searchParams.get("page");
  const route = page === null ? undefined : LEGACY_PAGE_ROUTES.get(page);
  if (route === undefined) return null;
  const rest = new URLSearchParams(searchParams);
  rest.delete("page");
  const query = rest.toString();
  return query ? `${uiHref(route)}?${query}` : uiHref(route);
}
