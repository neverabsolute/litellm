import { useTerminology } from "@/contexts/TerminologyContext";
import React from "react";
import { Control, UseFormReturn } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CircleHelp } from "lucide-react";
import { FormField } from "@/components/shared/form/FormField";
import { toast } from "@/lib/toast";
import RateLimitTypeFormItem from "../common_components/RateLimitTypeFormItem";
import NumericalInput from "../shared/numerical_input";
import { TagsInput } from "@/components/common_components/TagsInput";
import { moveTagsOutOfMetadataJson } from "./keyEditFieldNormalizers";
import { KeyEditFormValues } from "./keyEditFormValues";

export const labelWithHint = (label: React.ReactNode, hint: string): React.ReactNode => (
  <>
    {label}
    <Tooltip>
      <TooltipTrigger render={<CircleHelp className="size-3.5 shrink-0 cursor-help text-muted-foreground" />} />
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  </>
);

const KEY_TYPE_OPTIONS = [
  { value: "default", label: "Full Access", hint: "Can call all routes (AI APIs, Management, and read-only)" },
  { value: "llm_api", label: "AI APIs", hint: "Can call only AI API routes (chat/completions, embeddings, etc.)" },
  { value: "management", label: "Management", hint: "Can call only management routes (user/team/key management)" },
];

export const KeyTypeSelect = ({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const term = useTerminology();
  const keyTypeOptions = KEY_TYPE_OPTIONS.map((option) => ({
    ...option,
    label: term(option.label),
    hint: term(option.hint),
  }));
  return (
    <Select
      items={Object.fromEntries(keyTypeOptions.map((option) => [option.value, option.label]))}
      value={value}
      onValueChange={(next: string | null) => next != null && onChange(next)}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Select key type" />
      </SelectTrigger>
      <SelectContent>
        {keyTypeOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="py-1">
              <div className="font-medium">{option.label}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{option.hint}</div>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

const TPD_HINT =
  "Daily token budget for batch submissions (/v1/batches). When set, batch input files are charged against this 24h window instead of the key's TPM/RPM limits. Online requests keep using TPM/RPM.";

export const KeyRateLimitFields = ({ control }: { control: Control<KeyEditFormValues> }) => (
  <>
    <FormField control={control} name="tpm_limit" label="TPM Limit">
      {({ ref: _ref, ...field }) => <NumericalInput {...field} value={field.value ?? ""} min={0} />}
    </FormField>

    <FormField control={control} name="tpm_limit_type">
      {({ value, onChange, id }) => (
        <RateLimitTypeFormItem
          id={id}
          type="tpm"
          name="tpm_limit_type"
          showDetailedDescriptions={false}
          value={value as string | null}
          onChange={onChange}
        />
      )}
    </FormField>

    <FormField control={control} name="rpm_limit" label="RPM Limit">
      {({ ref: _ref, ...field }) => <NumericalInput {...field} value={field.value ?? ""} min={0} />}
    </FormField>

    <FormField control={control} name="rpm_limit_type">
      {({ value, onChange, id }) => (
        <RateLimitTypeFormItem
          id={id}
          type="rpm"
          name="rpm_limit_type"
          showDetailedDescriptions={false}
          value={value as string | null}
          onChange={onChange}
        />
      )}
    </FormField>

    <FormField control={control} name="tpd_limit" label={labelWithHint("TPD Limit (batch)", TPD_HINT)}>
      {({ ref: _ref, ...field }) => <NumericalInput {...field} value={field.value ?? ""} min={0} />}
    </FormField>
  </>
);

type KeyEditForm = Pick<
  UseFormReturn<KeyEditFormValues, unknown, KeyEditFormValues>,
  "control" | "getValues" | "setValue"
>;

export const moveMetadataTagsToTagsField = (form: KeyEditForm): void => {
  const moved = moveTagsOutOfMetadataJson(form.getValues("metadata"), form.getValues("tags"));
  if (moved === null) return;
  form.setValue("metadata", moved.metadata, { shouldDirty: true });
  form.setValue("tags", moved.tags, { shouldDirty: true });
  if (moved.movedTags.length > 0) {
    toast.info(`Moved ${moved.movedTags.join(", ")} from metadata to the Tags field`);
  }
};

export const KeyMetadataField = ({ form }: { form: KeyEditForm }) => (
  <FormField
    control={form.control}
    name="metadata"
    label="Metadata"
    description="Tags are managed by the Tags field above. A tags array typed here is moved to that field."
  >
    {(field) => (
      <Textarea
        {...field}
        value={(field.value as string | undefined) ?? ""}
        rows={10}
        onBlur={() => {
          field.onBlur();
          moveMetadataTagsToTagsField(form);
        }}
      />
    )}
  </FormField>
);

export const KeyBudgetNumberField = ({
  control,
  name,
  label,
  placeholder,
}: {
  control: Control<KeyEditFormValues>;
  name: "max_budget" | "soft_budget";
  label: string;
  placeholder: string;
}) => (
  <FormField control={control} name={name} label={label}>
    {({ ref: _ref, ...field }) => (
      <NumericalInput
        {...field}
        value={field.value ?? ""}
        step={0.01}
        style={{ width: "100%" }}
        placeholder={placeholder}
      />
    )}
  </FormField>
);

interface KeyTagListFieldProps {
  readonly control: Control<KeyEditFormValues>;
  readonly name: "tags" | "allowed_ips";
  readonly label: React.ReactNode;
  readonly placeholder: string;
  readonly options?: readonly string[];
  readonly tokenSeparators?: string[];
}

export const KeyTagListField = ({
  control,
  name,
  label,
  placeholder,
  options = [],
  tokenSeparators,
}: KeyTagListFieldProps) => (
  <FormField control={control} name={name} label={label}>
    {({ value, onChange, id }) => (
      <TagsInput
        id={id}
        value={(value as string[] | undefined) ?? []}
        onValueChange={onChange}
        options={options.map((option) => ({ value: option, label: option }))}
        placeholder={placeholder}
        tokenSeparators={tokenSeparators}
      />
    )}
  </FormField>
);

export const KeyAllowedIpsField = ({ control }: { control: Control<KeyEditFormValues> }) => (
  <KeyTagListField
    control={control}
    name="allowed_ips"
    label={labelWithHint(
      "Allowed IPs",
      "IP addresses or CIDR ranges this key can be used from. Leave empty to allow any address the proxy accepts",
    )}
    placeholder="e.g. 203.0.113.7 or 10.0.0.0/8"
    tokenSeparators={[",", " "]}
  />
);
