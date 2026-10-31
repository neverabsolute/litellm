/**
 * Page metadata for UI Settings configuration
 * This file contains descriptions and metadata for all navigation pages
 */

// Page descriptions for UI Settings configuration
export const pageDescriptions: Record<string, string> = {
  home: "Usage at a glance, recent launches and blog updates",
  "api-keys": "Manage virtual keys for API access and authentication",
  "llm-playground": "Interactive playground for testing LLM requests",
  models: "Configure and manage LLM models and endpoints",
  new_usage: "View usage analytics and metrics",
  "cost-optimization": "Track and configure cost-saving features: prompt compression, caching, and auto routing",
  "model-insights": "Model Leaderboard: compare usage, spend, tokens, and task mix across this gateway",
  "ip-analytics": "See which IP addresses call the gateway and which requests it denied",
  logs: "Access request and response logs",
  users: "Manage internal user accounts and permissions",
  teams: "Create and manage teams for access control",
  organizations: "Manage organizations and their members",
  projects: "Manage projects within teams",
  budgets: "Set and monitor spending budgets",
  api_ref: "Browse API documentation and endpoints",
  caching: "Configure response caching and coordination Redis settings",
  "transform-request": "Set up request transformation rules",
  "cost-tracking": "Track and analyze API costs",
  "ui-theme": "Customize dashboard appearance",
  "tag-management": "Organize resources with tags",
  prompts: "Manage and version prompt templates",
  "router-settings": "Configure routing and load balancing settings",
  telemetry: "Choose which anonymous usage telemetry this proxy collects and see the last report",
  "logging-and-alerts": "Set up logging and alert configurations",
  "admin-panel": "Access admin panel and settings",
};

export interface PageMetadata {
  page: string;
  label: string;
  group: string;
  description: string;
}
