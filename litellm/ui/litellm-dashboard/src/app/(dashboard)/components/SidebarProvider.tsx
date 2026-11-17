"use client";

import Sidebar from "@/components/leftnav";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";

interface SidebarProviderProps {
  sidebarCollapsed: boolean;
  onToggleCollapsed?: () => void;
}

const SidebarProvider = ({ sidebarCollapsed, onToggleCollapsed }: SidebarProviderProps) => {
  const { data: settings } = useUISettings();
  const values = settings?.values;

  return (
    <Sidebar
      collapsed={sidebarCollapsed}
      onToggleCollapsed={onToggleCollapsed}
      enabledPagesInternalUsers={values?.enabled_ui_pages_internal_users ?? null}
      enableProjectsUI={Boolean(values?.enable_projects_ui)}
    />
  );
};

export default SidebarProvider;
