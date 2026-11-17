/**
 * Allow proxy admin to add other people to view global spend
 * Use this to avoid sharing master key with others
 */
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { Alert, AlertDescription, AlertTitle } from "@/components/shared/Alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Info, TriangleAlert } from "lucide-react";
import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useBaseUrl } from "@/components/constants";
import i18n from "@/i18n/i18n";
import { toast } from "@/lib/toast";
import { addAllowedIP, deleteAllowedIP, getAllowedIPs, getSSOSettings } from "@/components/networking";
import SCIMConfig from "@/components/SCIM";
import LoggingSettings from "@/components/Settings/AdminSettings/LoggingSettings/LoggingSettings";
import SSOSettings from "@/components/Settings/AdminSettings/SSOSettings/SSOSettings";
import UISettings from "@/components/Settings/AdminSettings/UISettings/UISettings";
import TeamAdminEditableFieldsSettings from "@/components/Settings/AdminSettings/UISettings/TeamAdminEditableFieldsSettings";
import UserBannerSettings from "@/components/Settings/AdminSettings/UserBannerSettings/UserBannerSettings";
import CyberArk from "@/components/Settings/AdminSettings/CyberArk/CyberArk";
import HashicorpVault from "@/components/Settings/AdminSettings/HashicorpVault/HashicorpVault";
import PluginSettings from "@/components/Settings/AdminSettings/PluginSettings/PluginSettings";
import SSOModals from "@/components/SSOModals";
import {
  emptySSOSettingsFormValues,
  useSSOSettingsForm,
  type SSOSettingsFormValues,
} from "@/components/Settings/AdminSettings/SSOSettings/Modals/BaseSSOSettingsForm";
import UIAccessControlForm from "@/components/UIAccessControlForm";
import { z } from "zod";
import { FieldGroup } from "@/components/ui/field";
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";
import { useZodForm } from "@/lib/forms/useZodForm";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IP_OR_CIDR_MESSAGE, isIpOrCidr } from "@/utils/ipAddress";
import { extractErrorMessage } from "@/utils/errorUtils";
import { unwrapProxyErrorMessage } from "@/lib/http/client";

const allowedIPSchema = z.object({
  ip: z
    .string()
    .trim()
    .min(1, { error: () => i18n.t("adminPanel.page.addIp.required") })
    .refine(isIpOrCidr, IP_OR_CIDR_MESSAGE),
});

type AllowedIPFormValues = z.infer<typeof allowedIPSchema>;

const serverErrorMessage = (error: unknown): string => unwrapProxyErrorMessage(extractErrorMessage(error));

const ServerError = ({ title, message }: { title: string; message: string | null }) =>
  message === null ? null : (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );

const AddAllowedIPForm = ({
  onSubmit,
  error,
}: {
  onSubmit: (values: AllowedIPFormValues) => Promise<void>;
  error: string | null;
}) => {
  const { t } = useTranslation();
  const form = useZodForm(allowedIPSchema, { defaultValues: { ip: "" } });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <FieldGroup>
        <FormField
          control={form.control}
          name="ip"
          label={t("adminPanel.page.addIp.label")}
          description={t("adminPanel.page.addIp.description")}
        >
          {({ ref, ...field }) => <Input ref={ref} placeholder={t("adminPanel.page.addIp.placeholder")} {...field} />}
        </FormField>
        <ServerError title={t("adminPanel.page.addIp.errorTitle")} message={error} />
        <div>
          <Button type="submit">{t("adminPanel.page.addIp.submit")}</Button>
        </div>
      </FieldGroup>
    </form>
  );
};

interface AdminPanelProps {
  proxySettings?: any;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ proxySettings }) => {
  const { t } = useTranslation();
  const { premiumUser, accessToken, userId: userID } = useAuthorized();
  const form = useSSOSettingsForm("admin-panel");
  const [isAddSSOModalVisible, setIsAddSSOModalVisible] = useState(false);
  const [isInstructionsModalVisible, setIsInstructionsModalVisible] = useState(false);
  const [isAllowedIPModalVisible, setIsAllowedIPModalVisible] = useState(false);
  const [isAddIPModalVisible, setIsAddIPModalVisible] = useState(false);
  const [isDeleteIPModalVisible, setIsDeleteIPModalVisible] = useState(false);
  const [isUIAccessControlModalVisible, setIsUIAccessControlModalVisible] = useState(false);
  const [allowedIPs, setAllowedIPs] = useState<string[]>([]);
  const [ipToDelete, setIPToDelete] = useState<string | null>(null);
  const [addIPError, setAddIPError] = useState<string | null>(null);
  const [deleteIPError, setDeleteIPError] = useState<string | null>(null);
  const [ssoConfigured, setSsoConfigured] = useState<boolean>(false);

  const baseUrl = useBaseUrl();
  const all_ip_address_allowed = "All IP Addresses Allowed";

  let nonSssoUrl = baseUrl;
  nonSssoUrl += "/fallback/login";

  const checkSSOConfiguration = async () => {
    if (accessToken) {
      try {
        const ssoData = await getSSOSettings(accessToken);

        if (ssoData && ssoData.values) {
          const hasGoogleSSO = ssoData.values.google_client_id && ssoData.values.google_client_secret;
          const hasMicrosoftSSO = ssoData.values.microsoft_client_id && ssoData.values.microsoft_client_secret;
          const hasGenericSSO = ssoData.values.generic_client_id && ssoData.values.generic_client_secret;

          setSsoConfigured(hasGoogleSSO || hasMicrosoftSSO || hasGenericSSO);
        } else {
          setSsoConfigured(false);
        }
      } catch (error) {
        console.error("Error checking SSO configuration:", error);
        setSsoConfigured(false);
      }
    }
  };

  const handleShowAllowedIPs = async () => {
    try {
      if (accessToken) {
        const data = await getAllowedIPs(accessToken);
        setAllowedIPs(data && data.length > 0 ? data : [all_ip_address_allowed]);
      } else {
        setAllowedIPs([all_ip_address_allowed]);
      }
    } catch (error) {
      console.error("Error fetching allowed IPs:", error);
      toast.fromError(t("adminPanel.page.toasts.fetchIpsFailed", { error: String(error) }));
      setAllowedIPs([all_ip_address_allowed]);
    } finally {
      setIsAllowedIPModalVisible(true);
    }
  };

  const openAddIPModal = () => {
    setAddIPError(null);
    setIsAddIPModalVisible(true);
  };

  const handleAddIP = async (values: AllowedIPFormValues) => {
    if (!accessToken) return;
    try {
      await addAllowedIP(accessToken, values.ip);
    } catch (error) {
      setAddIPError(serverErrorMessage(error));
      return;
    }
    setIsAddIPModalVisible(false);
    toast.success(t("adminPanel.page.toasts.addIpSuccess"));
    const updatedIPs = await getAllowedIPs(accessToken);
    setAllowedIPs(updatedIPs && updatedIPs.length > 0 ? updatedIPs : [all_ip_address_allowed]);
  };

  const handleDeleteIP = (ip: string) => {
    setIPToDelete(ip);
    setDeleteIPError(null);
    setIsDeleteIPModalVisible(true);
  };

  const confirmDeleteIP = async () => {
    if (!ipToDelete || !accessToken) return;
    try {
      await deleteAllowedIP(accessToken, ipToDelete);
    } catch (error) {
      setDeleteIPError(serverErrorMessage(error));
      return;
    }
    setIsDeleteIPModalVisible(false);
    setIPToDelete(null);
    toast.success(t("adminPanel.page.toasts.deleteIpSuccess"));
    const updatedIPs = await getAllowedIPs(accessToken);
    setAllowedIPs(updatedIPs && updatedIPs.length > 0 ? updatedIPs : [all_ip_address_allowed]);
  };

  const handleAddSSOOk = () => {
    setIsAddSSOModalVisible(false);
    form.reset(emptySSOSettingsFormValues);
    if (accessToken && premiumUser) {
      checkSSOConfiguration();
    }
  };

  const handleAddSSOCancel = () => {
    setIsAddSSOModalVisible(false);
    form.reset(emptySSOSettingsFormValues);
  };

  const handleShowInstructions = (formValues: SSOSettingsFormValues) => {
    setIsAddSSOModalVisible(false);
    setIsInstructionsModalVisible(true);
  };

  const handleInstructionsOk = () => {
    setIsInstructionsModalVisible(false);
    if (accessToken && premiumUser) {
      checkSSOConfiguration();
    }
  };

  const handleInstructionsCancel = () => {
    setIsInstructionsModalVisible(false);
    if (accessToken && premiumUser) {
      checkSSOConfiguration();
    }
  };

  useEffect(() => {
    checkSSOConfiguration();
  }, [accessToken, premiumUser, checkSSOConfiguration]);

  const handleUIAccessControlOk = () => {
    setIsUIAccessControlModalVisible(false);
  };

  const handleUIAccessControlCancel = () => {
    setIsUIAccessControlModalVisible(false);
  };

  const tabItems = [
    {
      key: "sso-settings",
      label: t("adminPanel.page.tabs.ssoSettings"),
      children: <SSOSettings />,
    },
    {
      key: "security-settings",
      label: t("adminPanel.page.tabs.securitySettings"),
      children: (
        <>
          <Card className="block p-6">
            <h3 className="mb-2 text-base font-semibold text-foreground">{t("adminPanel.page.security.title")}</h3>
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>{t("adminPanel.page.security.deprecatedTitle")}</AlertTitle>
              <AlertDescription>{t("adminPanel.page.security.deprecatedDescription")}</AlertDescription>
            </Alert>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                marginTop: "1rem",
                marginLeft: "0.5rem",
              }}
            >
              <div>
                <Button style={{ width: "150px" }} onClick={() => setIsAddSSOModalVisible(true)}>
                  {ssoConfigured ? t("adminPanel.page.security.editSso") : t("adminPanel.page.security.addSso")}
                </Button>
              </div>
              <div>
                <Button style={{ width: "150px" }} onClick={handleShowAllowedIPs}>
                  {t("adminPanel.page.security.allowedIps")}
                </Button>
              </div>
              <div>
                <Button
                  style={{ width: "150px" }}
                  onClick={() =>
                    premiumUser === true
                      ? setIsUIAccessControlModalVisible(true)
                      : toast.fromError(t("adminPanel.page.toasts.uiAccessControlPremiumRequired"))
                  }
                >
                  {t("adminPanel.page.security.uiAccessControl")}
                </Button>
              </div>
            </div>
          </Card>

          <div className="flex justify-start mb-4">
            <SSOModals
              isAddSSOModalVisible={isAddSSOModalVisible}
              isInstructionsModalVisible={isInstructionsModalVisible}
              handleAddSSOOk={handleAddSSOOk}
              handleAddSSOCancel={handleAddSSOCancel}
              handleShowInstructions={handleShowInstructions}
              handleInstructionsOk={handleInstructionsOk}
              handleInstructionsCancel={handleInstructionsCancel}
              form={form}
              accessToken={accessToken}
              ssoConfigured={ssoConfigured}
            />
            <Dialog open={isAllowedIPModalVisible} onOpenChange={(open) => !open && setIsAllowedIPModalVisible(false)}>
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[800px]">
                <DialogHeader>
                  <DialogTitle>{t("adminPanel.page.allowedIps.title")}</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">{t("adminPanel.page.allowedIps.description")}</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("adminPanel.page.allowedIps.columns.ipAddress")}</TableHead>
                      <TableHead className="text-right">{t("adminPanel.page.allowedIps.columns.action")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allowedIPs.map((ip, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          {ip === all_ip_address_allowed ? t("adminPanel.page.allowedIps.allAllowed") : ip}
                        </TableCell>
                        <TableCell className="text-right">
                          {ip !== all_ip_address_allowed && (
                            <Button onClick={() => handleDeleteIP(ip)} variant="destructive" size="sm">
                              {t("adminPanel.page.allowedIps.delete")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <DialogFooter>
                  <Button className="mx-1" onClick={openAddIPModal}>
                    {t("adminPanel.page.allowedIps.addIp")}
                  </Button>
                  <Button onClick={() => setIsAllowedIPModalVisible(false)}>
                    {t("adminPanel.page.allowedIps.close")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={isAddIPModalVisible} onOpenChange={(open) => !open && setIsAddIPModalVisible(false)}>
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("adminPanel.page.addIp.title")}</DialogTitle>
                </DialogHeader>
                <AddAllowedIPForm onSubmit={handleAddIP} error={addIPError} />
              </DialogContent>
            </Dialog>

            <Dialog open={isDeleteIPModalVisible} onOpenChange={(open) => !open && setIsDeleteIPModalVisible(false)}>
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{t("adminPanel.page.deleteIp.title")}</DialogTitle>
                </DialogHeader>
                <span className="text-sm text-foreground">
                  <Trans i18nKey="adminPanel.page.deleteIp.message" components={{ ip: <>{ipToDelete}</> }} />
                </span>
                <ServerError title={t("adminPanel.page.deleteIp.errorTitle")} message={deleteIPError} />
                <DialogFooter>
                  <Button className="mx-1" onClick={() => confirmDeleteIP()}>
                    {t("adminPanel.page.deleteIp.confirm")}
                  </Button>
                  <Button onClick={() => setIsDeleteIPModalVisible(false)}>
                    {t("adminPanel.page.deleteIp.close")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* UI Access Control Modal */}
            <Dialog
              open={isUIAccessControlModalVisible}
              onOpenChange={(open) => !open && handleUIAccessControlCancel()}
            >
              <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>{t("adminPanel.page.uiAccessControlModal.title")}</DialogTitle>
                </DialogHeader>
                <UIAccessControlForm
                  accessToken={accessToken}
                  onSuccess={() => {
                    handleUIAccessControlOk();
                    toast.success(t("adminPanel.page.toasts.uiAccessControlUpdated"));
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
          <Alert variant="info">
            <Info />
            <AlertTitle>{t("adminPanel.page.security.loginWithoutSsoTitle")}</AlertTitle>
            <AlertDescription>
              <Trans
                i18nKey="adminPanel.page.security.loginWithoutSso"
                components={{
                  url: (
                    <a href={nonSssoUrl} target="_blank" rel="noopener noreferrer">
                      <b>{nonSssoUrl}</b>{" "}
                    </a>
                  ),
                }}
              />
            </AlertDescription>
          </Alert>
        </>
      ),
    },
    {
      key: "scim",
      label: "SCIM",
      children: <SCIMConfig accessToken={accessToken} userID={userID} proxySettings={proxySettings} />,
    },
    {
      key: "ui-settings",
      label: t("adminPanel.page.tabs.uiSettings"),
      children: (
        <div className="flex flex-col gap-4">
          <UISettings />
          <TeamAdminEditableFieldsSettings />
          <UserBannerSettings />
        </div>
      ),
    },
    {
      key: "logging-settings",
      label: t("adminPanel.page.tabs.loggingSettings"),
      children: <LoggingSettings />,
    },
    {
      key: "hashicorp-vault",
      label: "Hashicorp Vault",
      children: <HashicorpVault />,
    },
    {
      key: "cyberark",
      label: "CyberArk Conjur",
      children: <CyberArk />,
    },
    {
      key: "plugins",
      label: t("adminPanel.page.tabs.plugins"),
      children: <PluginSettings />,
    },
  ];

  return (
    <div className="w-full m-2 mt-2 p-8">
      <h2 className="mb-2 text-base font-semibold text-foreground">{t("adminPanel.page.title")}</h2>
      <p className="mb-4 text-sm text-foreground">{t("adminPanel.page.subtitle")}</p>
      <Tabs defaultValue={tabItems[0].key}>
        <TabsList variant="line" className="mb-4 h-auto flex-wrap">
          {tabItems.map((item) => (
            <TabsTrigger key={item.key} value={item.key} className="flex-none">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabItems.map((item) => (
          <TabsContent key={item.key} value={item.key}>
            {item.children}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

export default AdminPanel;
