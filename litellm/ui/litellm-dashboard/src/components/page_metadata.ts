/**
 * Page metadata for UI Settings configuration
 * This file contains descriptions and metadata for all navigation pages
 */

import type { ParseKeys } from "i18next";

// Page descriptions for UI Settings configuration
export const pageDescriptions: Record<string, ParseKeys> = {
  home: "shell.pageDescriptions.home",
  "api-keys": "shell.pageDescriptions.apiKeys",
  "llm-playground": "shell.pageDescriptions.llmPlayground",
  models: "shell.pageDescriptions.models",
  new_usage: "shell.pageDescriptions.newUsage",
  alerts: "shell.pageDescriptions.alerts",
  "cost-optimization": "shell.pageDescriptions.costOptimization",
  "ip-analytics": "shell.pageDescriptions.ipAnalytics",
  logs: "shell.pageDescriptions.logs",
  users: "shell.pageDescriptions.users",
  teams: "shell.pageDescriptions.teams",
  organizations: "shell.pageDescriptions.organizations",
  projects: "shell.pageDescriptions.projects",
  budgets: "shell.pageDescriptions.budgets",
  caching: "shell.pageDescriptions.caching",
  "transform-request": "shell.pageDescriptions.transformRequest",
  "cost-tracking": "shell.pageDescriptions.costTracking",
  "ui-theme": "shell.pageDescriptions.uiTheme",
  "tag-management": "shell.pageDescriptions.tagManagement",
  prompts: "shell.pageDescriptions.prompts",
  "router-settings": "shell.pageDescriptions.routerSettings",
  telemetry: "shell.pageDescriptions.telemetry",
  "logging-and-alerts": "shell.pageDescriptions.loggingAndAlerts",
  "admin-panel": "shell.pageDescriptions.adminPanel",
};

export interface PageMetadata {
  page: string;
  label: string;
  group: string;
  description: string;
}
