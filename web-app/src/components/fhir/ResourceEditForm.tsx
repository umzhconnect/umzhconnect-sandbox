import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFhirSearch } from '../../hooks/useFhirSearch';
import { useFhirClient } from '../../hooks/useFhirClient';
import { useRole } from '../../contexts/RoleContext';
import { TASK_STATUSES } from '../../types/fhir';
import type {
  FhirResource,
  Patient,
  Organization,
  ServiceRequest,
  Task,
  TaskParameter,
  Condition,
  Consent,
} from '../../types/fhir';
import ResourcePickerModal, { getResourceLabel } from './ResourcePickerModal';

// =============================================================================
// Constants
// =============================================================================

export const SUPPORTED_EDIT_TYPES = [
  'Patient',
  'Organization',
  'ServiceRequest',
  'Task',
  'Condition',
  'Consent',
];

const SR_STATUSES = [
  'draft',
  'active',
  'on-hold',
  'revoked',
  'completed',
  'entered-in-error',
  'unknown',
];
const SR_INTENTS = [
  'proposal',
  'plan',
  'directive',
  'order',
  'original-order',
  'reflex-order',
  'filler-order',
  'instance-order',
  'option',
];
const TASK_INTENTS = [
  'unknown',
  'proposal',
  'plan',
  'order',
  'original-order',
  'reflex-order',
  'filler-order',
  'instance-order',
  'option',
];
const CONDITION_CLINICAL = [
  'active',
  'recurrence',
  'relapse',
  'inactive',
  'remission',
  'resolved',
];
const CONDITION_VERIFICATION = [
  'unconfirmed',
  'provisional',
  'differential',
  'confirmed',
  'refuted',
  'entered-in-error',
];
const CONSENT_STATUSES = [
  'draft',
  'proposed',
  'active',
  'rejected',
  'inactive',
  'entered-in-error',
];
const CONSENT_SCOPES = ['adr', 'research', 'patient-privacy', 'treatment'];
const PRIORITIES = ['routine', 'urgent', 'asap', 'stat'];
const GENDERS = ['male', 'female', 'other', 'unknown'];

// =============================================================================
// Helpers
// =============================================================================

export const cloneResource = <T,>(r: T): T => JSON.parse(JSON.stringify(r));

export const extractIdFromRef = (ref?: string): string => {
  if (!ref) return '';
  return ref.split('/').pop() ?? '';
};

export const getPatientLabel = (p: Patient): string => {
  const n = p.name?.[0];
  if (!n) return p.id ?? 'Unknown';
  return `${n.given?.join(' ') ?? ''} ${n.family ?? ''}`.trim() || (p.id ?? 'Unknown');
};

export const getOrgLabel = (o: Organization): string =>
  o.name ?? o.alias?.[0] ?? o.id ?? 'Unknown';

export const getSRLabel = (sr: ServiceRequest): string => {
  const display =
    sr.category?.[0]?.coding?.[0]?.display ??
    sr.code?.coding?.[0]?.display ??
    sr.code?.text;
  return `${sr.id} — ${display ?? 'ServiceRequest'}`;
};

export const getPRLabel = (pr: FhirResource): string => {
  const r = pr as unknown as Record<string, unknown>;
  const prac = r.practitioner as { display?: string } | undefined;
  return prac?.display ?? pr.id ?? 'Unknown';
};

// =============================================================================
// Shared UI primitives
// =============================================================================

const Label: React.FC<{ text: string; required?: boolean; hint?: string }> = ({
  text,
  required,
  hint,
}) => (
  <label className="block text-sm font-medium text-gray-700 mb-1">
    {text}
    {required && <span className="text-red-500 ml-0.5">*</span>}
    {hint && <span className="ml-1 text-gray-400 font-normal text-xs">{hint}</span>}
  </label>
);

const textInputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500';

const selectCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-100 pt-4 mt-2">
    {title}
  </h3>
);

const ReadOnlyRow: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-gray-500 font-medium w-28 flex-shrink-0 text-xs pt-0.5">{label}</span>
      <span className="text-gray-800 font-mono text-xs break-all">{value}</span>
    </div>
  );
};

export const RefSelect: React.FC<{
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  placeholder: string;
  optional?: boolean;
}> = ({ value, onChange, options, placeholder, optional }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
    <option value="">{optional ? `None — ${placeholder}` : placeholder}</option>
    {options.map((o) => (
      <option key={o.id} value={o.id!}>
        {o.label}
      </option>
    ))}
  </select>
);

// Read-only fallback for unsupported types
const FallbackFormView: React.FC<{ resource: FhirResource }> = ({ resource }) => {
  const entries = Object.entries(resource).filter(
    ([key]) => !['resourceType', 'meta', 'text'].includes(key)
  );
  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-sm">
          <span className="font-mono text-gray-500 w-36 flex-shrink-0 text-xs pt-0.5">{key}</span>
          <span className="text-gray-900 break-all">
            {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : typeof value === 'object' &&
                  value !== null &&
                  'reference' in (value as Record<string, unknown>)
                ? (value as { reference: string }).reference
                : JSON.stringify(value, null, 0).slice(0, 200)}
          </span>
        </div>
      ))}
    </div>
  );
};

// =============================================================================
// Patient form
// =============================================================================

const PatientForm: React.FC<{
  draft: Patient;
  setDraft: (p: Patient) => void;
}> = ({ draft, setDraft }) => {
  const n = draft.name?.[0] ?? {};
  const addr = draft.address?.[0] ?? {};
  const phone = draft.telecom?.find((t) => t.system === 'phone');
  const email = draft.telecom?.find((t) => t.system === 'email');
  const ident = draft.identifier?.[0] ?? {};

  const patchName = (patch: object) =>
    setDraft({ ...draft, name: [{ ...n, ...patch }] });
  const patchAddr = (patch: object) =>
    setDraft({ ...draft, address: [{ ...addr, ...patch }] });
  const patchTelecom = (system: string, value: string) => {
    const rest = (draft.telecom ?? []).filter((t) => t.system !== system);
    setDraft({ ...draft, telecom: value ? [...rest, { system, value }] : rest });
  };
  const patchIdent = (patch: object) =>
    setDraft({ ...draft, identifier: [{ ...ident, ...patch }] });

  return (
    <div className="space-y-3">
      {/* Active */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.active ?? true}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          className="rounded border-gray-300 text-blue-600"
        />
        <span className="text-sm font-medium text-gray-700">Active</span>
      </label>

      {/* Name */}
      <SectionHeader title="Name" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Family name" />
          <input
            className={textInputCls}
            value={n.family ?? ''}
            onChange={(e) => patchName({ family: e.target.value })}
          />
        </div>
        <div>
          <Label text="Given name(s)" hint="space-separated" />
          <input
            className={textInputCls}
            value={n.given?.join(' ') ?? ''}
            onChange={(e) =>
              patchName({ given: e.target.value.split(' ').filter(Boolean) })
            }
          />
        </div>
        <div>
          <Label text="Prefix" hint="e.g. Dr., Prof." />
          <input
            className={textInputCls}
            value={n.prefix?.join(' ') ?? ''}
            onChange={(e) =>
              patchName({ prefix: e.target.value ? [e.target.value] : [] })
            }
          />
        </div>
        <div>
          <Label text="Gender" />
          <select
            className={selectCls}
            value={draft.gender ?? ''}
            onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
          >
            <option value="">— select —</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label text="Birth date" />
          <input
            type="date"
            className={textInputCls}
            value={draft.birthDate ?? ''}
            onChange={(e) => setDraft({ ...draft, birthDate: e.target.value })}
          />
        </div>
      </div>

      {/* Identifier */}
      <SectionHeader title="Identifier" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="System" hint="URI" />
          <input
            className={textInputCls}
            value={ident.system ?? ''}
            onChange={(e) => patchIdent({ system: e.target.value })}
          />
        </div>
        <div>
          <Label text="Value" />
          <input
            className={textInputCls}
            value={ident.value ?? ''}
            onChange={(e) => patchIdent({ value: e.target.value })}
          />
        </div>
      </div>

      {/* Address */}
      <SectionHeader title="Address" />
      <div>
        <Label text="Line" />
        <input
          className={textInputCls}
          value={addr.line?.[0] ?? ''}
          onChange={(e) => patchAddr({ line: e.target.value ? [e.target.value] : [] })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <Label text="City" />
          <input
            className={textInputCls}
            value={addr.city ?? ''}
            onChange={(e) => patchAddr({ city: e.target.value })}
          />
        </div>
        <div>
          <Label text="Postal code" />
          <input
            className={textInputCls}
            value={addr.postalCode ?? ''}
            onChange={(e) => patchAddr({ postalCode: e.target.value })}
          />
        </div>
        <div>
          <Label text="Country" />
          <input
            className={textInputCls}
            value={addr.country ?? ''}
            onChange={(e) => patchAddr({ country: e.target.value })}
          />
        </div>
      </div>

      {/* Contact */}
      <SectionHeader title="Contact" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Phone" />
          <input
            className={textInputCls}
            value={phone?.value ?? ''}
            onChange={(e) => patchTelecom('phone', e.target.value)}
          />
        </div>
        <div>
          <Label text="Email" />
          <input
            type="email"
            className={textInputCls}
            value={email?.value ?? ''}
            onChange={(e) => patchTelecom('email', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Organization form
// =============================================================================

const OrganizationForm: React.FC<{
  draft: Organization;
  setDraft: (o: Organization) => void;
}> = ({ draft, setDraft }) => {
  const addr = draft.address?.[0] ?? {};
  const phone = draft.telecom?.find((t) => t.system === 'phone');
  const email = draft.telecom?.find((t) => t.system === 'email');

  const patchAddr = (patch: object) =>
    setDraft({ ...draft, address: [{ ...addr, ...patch }] });
  const patchTelecom = (system: string, value: string) => {
    const rest = (draft.telecom ?? []).filter((t) => t.system !== system);
    setDraft({ ...draft, telecom: value ? [...rest, { system, value }] : rest });
  };

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.active ?? true}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          className="rounded border-gray-300 text-blue-600"
        />
        <span className="text-sm font-medium text-gray-700">Active</span>
      </label>

      <div>
        <Label text="Name" />
        <input
          className={textInputCls}
          value={draft.name ?? ''}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </div>
      <div>
        <Label text="Alias" hint="short name" />
        <input
          className={textInputCls}
          value={draft.alias?.[0] ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, alias: e.target.value ? [e.target.value] : [] })
          }
        />
      </div>

      <SectionHeader title="Address" />
      <div>
        <Label text="Line" />
        <input
          className={textInputCls}
          value={addr.line?.[0] ?? ''}
          onChange={(e) => patchAddr({ line: e.target.value ? [e.target.value] : [] })}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <Label text="City" />
          <input
            className={textInputCls}
            value={addr.city ?? ''}
            onChange={(e) => patchAddr({ city: e.target.value })}
          />
        </div>
        <div>
          <Label text="Postal code" />
          <input
            className={textInputCls}
            value={addr.postalCode ?? ''}
            onChange={(e) => patchAddr({ postalCode: e.target.value })}
          />
        </div>
        <div>
          <Label text="Country" />
          <input
            className={textInputCls}
            value={addr.country ?? ''}
            onChange={(e) => patchAddr({ country: e.target.value })}
          />
        </div>
      </div>

      <SectionHeader title="Contact" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Phone" />
          <input
            className={textInputCls}
            value={phone?.value ?? ''}
            onChange={(e) => patchTelecom('phone', e.target.value)}
          />
        </div>
        <div>
          <Label text="Email" />
          <input
            type="email"
            className={textInputCls}
            value={email?.value ?? ''}
            onChange={(e) => patchTelecom('email', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// ServiceRequest form
// =============================================================================

const ServiceRequestForm: React.FC<{
  draft: ServiceRequest;
  setDraft: (sr: ServiceRequest) => void;
  patients: Patient[];
  practitionerRoles: FhirResource[];
}> = ({ draft, setDraft, patients, practitionerRoles }) => {
  const patientId = extractIdFromRef(draft.subject?.reference);
  const requesterId = extractIdFromRef(draft.requester?.reference);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label text="Status" />
          <select
            className={selectCls}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            {SR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label text="Intent" />
          <select
            className={selectCls}
            value={draft.intent}
            onChange={(e) => setDraft({ ...draft, intent: e.target.value })}
          >
            {SR_INTENTS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label text="Priority" />
          <select
            className={selectCls}
            value={draft.priority ?? 'routine'}
            onChange={(e) => setDraft({ ...draft, priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Category" hint="display text" />
          <input
            className={textInputCls}
            value={draft.category?.[0]?.coding?.[0]?.display ?? draft.category?.[0]?.text ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                category: [{ coding: [{ display: e.target.value }] }],
              })
            }
          />
        </div>
        <div>
          <Label text="Code" hint="display or text" />
          <input
            className={textInputCls}
            value={draft.code?.text ?? draft.code?.coding?.[0]?.display ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, code: { text: e.target.value } })
            }
          />
        </div>
      </div>

      <div>
        <Label text="Subject (patient)" required />
        <RefSelect
          value={patientId}
          onChange={(id) =>
            setDraft({
              ...draft,
              subject: {
                reference: id ? `Patient/${id}` : '',
                display: patients.find((p) => p.id === id) ? getPatientLabel(patients.find((p) => p.id === id)!) : undefined,
              },
            })
          }
          options={patients.map((p) => ({ id: p.id!, label: getPatientLabel(p) }))}
          placeholder="Select patient…"
        />
      </div>

      <div>
        <Label text="Requester" hint="optional" />
        <RefSelect
          value={requesterId}
          onChange={(id) =>
            setDraft({
              ...draft,
              requester: id
                ? {
                    reference: `PractitionerRole/${id}`,
                    display: getPRLabel(practitionerRoles.find((pr) => pr.id === id)!),
                  }
                : undefined,
            })
          }
          options={practitionerRoles.map((pr) => ({ id: pr.id!, label: getPRLabel(pr) }))}
          placeholder="Select requester…"
          optional
        />
      </div>

      <div>
        <Label text="Authored on" />
        <input
          className={textInputCls}
          value={draft.authoredOn ?? ''}
          disabled
          title="Authored date is set at creation and cannot be changed."
        />
      </div>

      <div>
        <Label text="Note" />
        <textarea
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={2}
          value={draft.note?.[0]?.text ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              note: e.target.value ? [{ text: e.target.value }] : [],
            })
          }
        />
      </div>
    </div>
  );
};

// =============================================================================
// Task form
// =============================================================================

const TaskForm: React.FC<{
  draft: Task;
  setDraft: (t: Task) => void;
  organizations: Organization[];
}> = ({ draft, setDraft, organizations }) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const ownerId = extractIdFromRef(draft.owner?.reference);

  const getParamTypeLabel = (p: TaskParameter): string =>
    p.type?.coding?.[0]?.display ?? p.type?.coding?.[0]?.code ?? p.type?.text ?? '—';

  const getParamValueLabel = (p: TaskParameter): string =>
    p.valueReference?.reference ??
    p.valueReference?.display ??
    p.valueCanonical ??
    p.valueString ??
    '—';

  const handleAddOutput = (resource: FhirResource) => {
    const newOutput: TaskParameter = {
      type: { text: resource.resourceType },
      valueReference: {
        reference: `${resource.resourceType}/${resource.id}`,
        display: getResourceLabel(resource),
      },
    };
    setDraft({ ...draft, output: [...(draft.output ?? []), newOutput] });
    setPickerOpen(false);
  };

  const handleRemoveOutput = (index: number) => {
    setDraft({ ...draft, output: (draft.output ?? []).filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-3">

      {/* ── Editable fields ─────────────────────────────────────────── */}
      <SectionHeader title="Edit" />

      <div>
        <Label text="Status" />
        <select
          className={selectCls}
          value={draft.status}
          onChange={(e) => setDraft({ ...draft, status: e.target.value })}
        >
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div>
        <Label text="Owner" hint="optional" />
        <RefSelect
          value={ownerId}
          onChange={(id) =>
            setDraft({
              ...draft,
              owner: id
                ? {
                    reference: `Organization/${id}`,
                    display: organizations.find((o) => o.id === id)
                      ? getOrgLabel(organizations.find((o) => o.id === id)!)
                      : undefined,
                  }
                : undefined,
            })
          }
          options={organizations.map((o) => ({ id: o.id!, label: getOrgLabel(o) }))}
          placeholder="Select owner organization…"
          optional
        />
      </div>

      {/* ── Read-only task details ───────────────────────────────────── */}
      <SectionHeader title="Task Details" />
      <div className="space-y-1.5">
        <ReadOnlyRow label="Intent"        value={draft.intent} />
        <ReadOnlyRow label="Priority"      value={draft.priority} />
        <ReadOnlyRow label="Description"   value={draft.description} />
        <ReadOnlyRow label="Based on"      value={draft.basedOn?.[0]?.reference} />
        <ReadOnlyRow label="For"           value={draft.for?.reference ?? draft.for?.display} />
        <ReadOnlyRow label="Requester"     value={draft.requester?.reference ?? draft.requester?.display} />
        <ReadOnlyRow label="Authored on"   value={draft.authoredOn} />
        <ReadOnlyRow label="Last modified" value={draft.lastModified} />
      </div>

      {/* ── Inputs (read-only) ──────────────────────────────────────── */}
      <SectionHeader title="Inputs" />
      {(draft.input ?? []).length === 0 ? (
        <p className="text-xs text-gray-400 italic">No inputs defined.</p>
      ) : (
        <div className="space-y-1.5">
          {(draft.input ?? []).map((inp, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs bg-gray-50 border border-gray-200 rounded px-3 py-2"
            >
              <span className="font-medium text-gray-500 w-24 flex-shrink-0 pt-0.5">
                {getParamTypeLabel(inp)}
              </span>
              <span className="font-mono text-gray-700 break-all flex-1">
                {getParamValueLabel(inp)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Outputs ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between pt-4 mt-2 border-t border-gray-100">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Outputs
        </h3>
        <button
          onClick={() => setPickerOpen(true)}
          className="text-xs btn-primary py-1 px-2.5"
        >
          + Add Output
        </button>
      </div>

      {(draft.output ?? []).length === 0 ? (
        <p className="text-xs text-gray-400 italic">No outputs defined.</p>
      ) : (
        <div className="space-y-1.5">
          {(draft.output ?? []).map((out, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-xs bg-blue-50 border border-blue-200 rounded px-3 py-2"
            >
              <span className="font-medium text-blue-700 w-24 flex-shrink-0 pt-0.5">
                {getParamTypeLabel(out)}
              </span>
              <span className="font-mono text-blue-900 break-all flex-1">
                {getParamValueLabel(out)}
              </span>
              <button
                onClick={() => handleRemoveOutput(i)}
                className="text-blue-400 hover:text-red-500 flex-shrink-0 font-bold text-sm leading-none"
                title="Remove output"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Resource picker modal */}
      <ResourcePickerModal
        open={pickerOpen}
        title="Add Task Output"
        onClose={() => setPickerOpen(false)}
        onSelect={handleAddOutput}
      />
    </div>
  );
};

// =============================================================================
// Condition form
// =============================================================================

const ConditionForm: React.FC<{
  draft: Condition;
  setDraft: (c: Condition) => void;
  patients: Patient[];
}> = ({ draft, setDraft, patients }) => {
  const subjectId = extractIdFromRef(draft.subject?.reference);
  const clinicalCode =
    draft.clinicalStatus?.coding?.[0]?.code ?? '';
  const verificationCode =
    draft.verificationStatus?.coding?.[0]?.code ?? '';

  const CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
  const VERIFICATION_SYSTEM =
    'http://terminology.hl7.org/CodeSystem/condition-ver-status';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Clinical status" />
          <select
            className={selectCls}
            value={clinicalCode}
            onChange={(e) =>
              setDraft({
                ...draft,
                clinicalStatus: {
                  coding: [{ system: CLINICAL_SYSTEM, code: e.target.value }],
                },
              })
            }
          >
            <option value="">— select —</option>
            {CONDITION_CLINICAL.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label text="Verification status" />
          <select
            className={selectCls}
            value={verificationCode}
            onChange={(e) =>
              setDraft({
                ...draft,
                verificationStatus: {
                  coding: [{ system: VERIFICATION_SYSTEM, code: e.target.value }],
                },
              })
            }
          >
            <option value="">— select —</option>
            {CONDITION_VERIFICATION.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label text="Code / display" />
        <input
          className={textInputCls}
          value={draft.code?.text ?? draft.code?.coding?.[0]?.display ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, code: { text: e.target.value } })
          }
        />
      </div>
      <div>
        <Label text="Body site" />
        <input
          className={textInputCls}
          value={draft.bodySite?.[0]?.text ?? draft.bodySite?.[0]?.coding?.[0]?.display ?? ''}
          onChange={(e) =>
            setDraft({ ...draft, bodySite: e.target.value ? [{ text: e.target.value }] : [] })
          }
        />
      </div>

      <div>
        <Label text="Subject (patient)" required />
        <RefSelect
          value={subjectId}
          onChange={(id) =>
            setDraft({
              ...draft,
              subject: {
                reference: id ? `Patient/${id}` : '',
                display: patients.find((p) => p.id === id)
                  ? getPatientLabel(patients.find((p) => p.id === id)!)
                  : undefined,
              },
            })
          }
          options={patients.map((p) => ({ id: p.id!, label: getPatientLabel(p) }))}
          placeholder="Select patient…"
        />
      </div>

      <div>
        <Label text="Recorded date" />
        <input
          type="date"
          className={textInputCls}
          value={draft.recordedDate?.split('T')[0] ?? ''}
          onChange={(e) => setDraft({ ...draft, recordedDate: e.target.value })}
        />
      </div>
    </div>
  );
};

// =============================================================================
// Consent form
// =============================================================================

const ConsentForm: React.FC<{
  draft: Consent;
  setDraft: (c: Consent) => void;
  patients: Patient[];
  serviceRequests: ServiceRequest[];
}> = ({ draft, setDraft, patients, serviceRequests }) => {
  const patientId = extractIdFromRef(draft.patient?.reference);
  const sourceRefId = extractIdFromRef(draft.sourceReference?.reference);
  const scopeCode = draft.scope?.coding?.[0]?.code ?? '';
  const SCOPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/consentscope';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Status" />
          <select
            className={selectCls}
            value={draft.status}
            onChange={(e) => setDraft({ ...draft, status: e.target.value })}
          >
            {CONSENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label text="Scope" />
          <select
            className={selectCls}
            value={scopeCode}
            onChange={(e) =>
              setDraft({
                ...draft,
                scope: { coding: [{ system: SCOPE_SYSTEM, code: e.target.value }] },
              })
            }
          >
            <option value="">— select —</option>
            {CONSENT_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <Label text="Patient" />
        <RefSelect
          value={patientId}
          onChange={(id) =>
            setDraft({
              ...draft,
              patient: id
                ? {
                    reference: `Patient/${id}`,
                    display: patients.find((p) => p.id === id)
                      ? getPatientLabel(patients.find((p) => p.id === id)!)
                      : undefined,
                  }
                : undefined,
            })
          }
          options={patients.map((p) => ({ id: p.id!, label: getPatientLabel(p) }))}
          placeholder="Select patient…"
          optional
        />
      </div>

      <div>
        <Label text="Source (ServiceRequest)" hint="optional — document that authorises the consent" />
        <RefSelect
          value={sourceRefId}
          onChange={(id) =>
            setDraft({
              ...draft,
              sourceReference: id
                ? {
                    reference: `ServiceRequest/${id}`,
                    display: serviceRequests.find((sr) => sr.id === id)
                      ? getSRLabel(serviceRequests.find((sr) => sr.id === id)!)
                      : undefined,
                  }
                : undefined,
            })
          }
          options={serviceRequests.map((sr) => ({ id: sr.id!, label: getSRLabel(sr) }))}
          placeholder="Select ServiceRequest…"
          optional
        />
      </div>

      <div>
        <Label text="Date / time" />
        <input
          className={textInputCls}
          value={draft.dateTime ?? ''}
          disabled
          title="DateTime is set at creation and cannot be changed."
        />
      </div>

      <SectionHeader title="Provision" />
      <div>
        <Label text="Type" />
        <select
          className={selectCls}
          value={draft.provision?.type ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              provision: { ...draft.provision, type: e.target.value },
            })
          }
        >
          <option value="">— select —</option>
          <option value="deny">deny</option>
          <option value="permit">permit</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Valid from" />
          <input
            type="date"
            className={textInputCls}
            value={draft.provision?.period?.start?.split('T')[0] ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                provision: {
                  ...draft.provision,
                  period: { ...draft.provision?.period, start: e.target.value },
                },
              })
            }
          />
        </div>
        <div>
          <Label text="Valid until" />
          <input
            type="date"
            className={textInputCls}
            value={draft.provision?.period?.end?.split('T')[0] ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                provision: {
                  ...draft.provision,
                  period: { ...draft.provision?.period, end: e.target.value },
                },
              })
            }
          />
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// Main: ResourceEditForm
// =============================================================================

interface ResourceEditFormProps {
  resource: FhirResource;
  onSaved: () => void;
  onSavedResource?: (resource: FhirResource) => void;
}

const ResourceEditForm: React.FC<ResourceEditFormProps> = ({ resource, onSaved, onSavedResource }) => {
  const { activeRole } = useRole();
  const client = useFhirClient();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<FhirResource>(() => cloneResource(resource));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);

  // Reset when a different resource is selected in the list
  useEffect(() => {
    setDraft(cloneResource(resource));
    setError(null);
    setSavedOk(false);
  }, [resource.id, resource.resourceType]);

  const isSupported = SUPPORTED_EDIT_TYPES.includes(resource.resourceType);

  // Only fetch reference data for resource types that need it
  const needsPatients = ['ServiceRequest', 'Condition', 'Consent'].includes(resource.resourceType);
  const needsPRoles = resource.resourceType === 'ServiceRequest';
  const needsSRs = resource.resourceType === 'Consent';
  const needsOrgs = resource.resourceType === 'Task';

  const { data: patientBundle } = useFhirSearch<Patient>('Patient', {}, needsPatients);
  const { data: prBundle } = useFhirSearch<FhirResource>('PractitionerRole', {}, needsPRoles);
  const { data: srBundle } = useFhirSearch<ServiceRequest>('ServiceRequest', {}, needsSRs);
  const { data: orgBundle } = useFhirSearch<Organization>('Organization', {}, needsOrgs);

  const patients =
    (patientBundle?.entry?.map((e) => e.resource).filter(Boolean) as Patient[]) ?? [];
  const practitionerRoles =
    (prBundle?.entry?.map((e) => e.resource).filter(Boolean) as FhirResource[]) ?? [];
  const serviceRequests =
    (srBundle?.entry?.map((e) => e.resource).filter(Boolean) as ServiceRequest[]) ?? [];
  const organizations =
    (orgBundle?.entry?.map((e) => e.resource).filter(Boolean) as Organization[]) ?? [];

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const saved = await client.update(draft);
      // Invalidate the list query so the left panel refreshes
      queryClient.invalidateQueries({ queryKey: ['fhir', activeRole, resource.resourceType] });
      setSavedOk(true);
      onSavedResource?.(saved);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(cloneResource(resource));
    setError(null);
    setSavedOk(false);
  };

  return (
    <div className="space-y-4">
      {/* Header row: resource identity + action buttons */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-mono text-gray-400 truncate">
          {resource.resourceType}/{resource.id}
        </p>
        {isSupported && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleDiscard}
              disabled={saving}
              className="btn-secondary text-sm py-1 px-3"
            >
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-sm py-1 px-3 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Status banners */}
      {savedOk && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">
          Saved successfully.
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
          {error}
        </p>
      )}

      {/* Form body */}
      {!isSupported ? (
        <div className="space-y-2">
          <p className="text-xs italic text-gray-400 border border-dashed border-gray-200 rounded px-3 py-2">
            Editing is not supported for <strong>{resource.resourceType}</strong>. View only:
          </p>
          <FallbackFormView resource={resource} />
        </div>
      ) : resource.resourceType === 'Patient' ? (
        <PatientForm
          draft={draft as Patient}
          setDraft={(p) => setDraft(p as FhirResource)}
        />
      ) : resource.resourceType === 'Organization' ? (
        <OrganizationForm
          draft={draft as Organization}
          setDraft={(o) => setDraft(o as FhirResource)}
        />
      ) : resource.resourceType === 'ServiceRequest' ? (
        <ServiceRequestForm
          draft={draft as ServiceRequest}
          setDraft={(sr) => setDraft(sr as FhirResource)}
          patients={patients}
          practitionerRoles={practitionerRoles}
        />
      ) : resource.resourceType === 'Task' ? (
        <TaskForm
          draft={draft as Task}
          setDraft={(t) => setDraft(t as FhirResource)}
          organizations={organizations}
        />
      ) : resource.resourceType === 'Condition' ? (
        <ConditionForm
          draft={draft as Condition}
          setDraft={(c) => setDraft(c as FhirResource)}
          patients={patients}
        />
      ) : resource.resourceType === 'Consent' ? (
        <ConsentForm
          draft={draft as Consent}
          setDraft={(c) => setDraft(c as FhirResource)}
          patients={patients}
          serviceRequests={serviceRequests}
        />
      ) : null}
    </div>
  );
};

export default ResourceEditForm;
