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
  Condition,
  Consent,
} from '../../types/fhir';
import LoadingSpinner from '../common/LoadingSpinner';
import {
  SUPPORTED_EDIT_TYPES,
  extractIdFromRef,
  getPatientLabel,
  getOrgLabel,
  getSRLabel,
  getPRLabel,
  RefSelect,
} from './ResourceEditForm';

// =============================================================================
// Constants (shared with ResourceEditForm but redeclared locally where needed)
// =============================================================================

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
// Initial draft builders — one per supported type
// =============================================================================

const buildInitialDraft = (resourceType: string): FhirResource | null => {
  switch (resourceType) {
    case 'Patient':
      return {
        resourceType: 'Patient',
        active: true,
        name: [{ family: '', given: [] }],
        gender: 'unknown',
        birthDate: '',
        identifier: [{ system: '', value: '' }],
        address: [{ line: [], city: '', postalCode: '', country: '' }],
        telecom: [],
      } as Patient;

    case 'Organization':
      return {
        resourceType: 'Organization',
        active: true,
        name: '',
        alias: [],
        address: [{ line: [], city: '', postalCode: '', country: '' }],
        telecom: [],
      } as Organization;

    case 'ServiceRequest':
      return {
        resourceType: 'ServiceRequest',
        status: 'draft',
        intent: 'order',
        priority: 'routine',
        subject: { reference: '' },
      } as ServiceRequest;

    case 'Task':
      return {
        resourceType: 'Task',
        status: 'draft',
        intent: 'order',
        priority: 'routine',
        description: '',
      } as Task;

    case 'Condition':
      return {
        resourceType: 'Condition',
        subject: { reference: '' },
      } as Condition;

    case 'Consent':
      return {
        resourceType: 'Consent',
        status: 'draft',
        scope: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/consentscope', code: 'patient-privacy' }] },
        category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'INFAUT' }] }],
        dateTime: new Date().toISOString(),
      } as Consent;

    default:
      return null;
  }
};

// =============================================================================
// UI helpers (shared style constants)
// =============================================================================

const textInputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-500';

const selectCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

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

const SectionHeader: React.FC<{ title: string }> = ({ title }) => (
  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-t border-gray-100 pt-4 mt-2">
    {title}
  </h3>
);

// =============================================================================
// Per-type create forms
// =============================================================================

// ---- Patient ----------------------------------------------------------------

const CreatePatientForm: React.FC<{
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
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.active ?? true}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          className="rounded border-gray-300 text-blue-600"
        />
        <span className="text-sm font-medium text-gray-700">Active</span>
      </label>

      <SectionHeader title="Name" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label text="Family name" required />
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
            value={draft.gender ?? 'unknown'}
            onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
          >
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

// ---- Organization -----------------------------------------------------------

const CreateOrganizationForm: React.FC<{
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
        <Label text="Name" required />
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

// ---- ServiceRequest ---------------------------------------------------------

const CreateServiceRequestForm: React.FC<{
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
            onChange={(e) => setDraft({ ...draft, code: { text: e.target.value } })}
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

// ---- Task -------------------------------------------------------------------

const CreateTaskForm: React.FC<{
  draft: Task;
  setDraft: (t: Task) => void;
  patients: Patient[];
  practitionerRoles: FhirResource[];
  serviceRequests: ServiceRequest[];
  organizations: Organization[];
}> = ({ draft, setDraft, patients, practitionerRoles, serviceRequests, organizations }) => {
  const basedOnId = extractIdFromRef(draft.basedOn?.[0]?.reference);
  const forPatientId = extractIdFromRef(draft.for?.reference);
  const requesterId = extractIdFromRef(draft.requester?.reference);
  const ownerId = extractIdFromRef(draft.owner?.reference);

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
            {TASK_STATUSES.map((s) => (
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
            {TASK_INTENTS.map((i) => (
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

      <div>
        <Label text="Description" />
        <textarea
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          rows={2}
          value={draft.description ?? ''}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
      </div>

      <div>
        <Label text="Based on (ServiceRequest)" hint="optional" />
        <RefSelect
          value={basedOnId}
          onChange={(id) =>
            setDraft({
              ...draft,
              basedOn: id ? [{ reference: `ServiceRequest/${id}` }] : [],
            })
          }
          options={serviceRequests.map((sr) => ({ id: sr.id!, label: getSRLabel(sr) }))}
          placeholder="Select ServiceRequest…"
          optional
        />
      </div>

      <div>
        <Label text="For (patient)" hint="optional" />
        <RefSelect
          value={forPatientId}
          onChange={(id) =>
            setDraft({
              ...draft,
              for: id
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
    </div>
  );
};

// ---- Condition --------------------------------------------------------------

const CreateConditionForm: React.FC<{
  draft: Condition;
  setDraft: (c: Condition) => void;
  patients: Patient[];
}> = ({ draft, setDraft, patients }) => {
  const subjectId = extractIdFromRef(draft.subject?.reference);
  const clinicalCode = draft.clinicalStatus?.coding?.[0]?.code ?? '';
  const verificationCode = draft.verificationStatus?.coding?.[0]?.code ?? '';
  const CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
  const VERIFICATION_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';

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
                clinicalStatus: { coding: [{ system: CLINICAL_SYSTEM, code: e.target.value }] },
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
          onChange={(e) => setDraft({ ...draft, code: { text: e.target.value } })}
        />
      </div>
      <div>
        <Label text="Body site" />
        <input
          className={textInputCls}
          value={draft.bodySite?.[0]?.text ?? ''}
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

// ---- Consent ----------------------------------------------------------------

const CreateConsentForm: React.FC<{
  draft: Consent;
  setDraft: (c: Consent) => void;
  patients: Patient[];
  serviceRequests: ServiceRequest[];
  organizations: Organization[];
}> = ({ draft, setDraft, patients, serviceRequests, organizations }) => {
  const patientId = extractIdFromRef(draft.patient?.reference);
  const sourceRefId = extractIdFromRef(draft.sourceReference?.reference);
  const performerId = extractIdFromRef(draft.performer?.[0]?.reference);
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
        <Label text="Performer (who may access)" hint="organisation that receives access" />
        <RefSelect
          value={performerId}
          onChange={(id) =>
            setDraft({
              ...draft,
              performer: id ? [{ reference: `Organization/${id}` }] : undefined,
            })
          }
          options={organizations.map((o) => ({ id: o.id!, label: getOrgLabel(o) }))}
          placeholder="Select organisation…"
          optional
        />
      </div>

      <SectionHeader title="Provision" />
      <div>
        <Label text="Type" />
        <select
          className={selectCls}
          value={draft.provision?.type ?? 'permit'}
          onChange={(e) =>
            setDraft({
              ...draft,
              provision: { ...draft.provision, type: e.target.value },
            })
          }
        >
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
// Validation
// =============================================================================

const validate = (draft: FhirResource): string | null => {
  switch (draft.resourceType) {
    case 'Patient': {
      const p = draft as Patient;
      if (!p.name?.[0]?.family) return 'Family name is required.';
      break;
    }
    case 'Organization': {
      const o = draft as Organization;
      if (!o.name) return 'Organization name is required.';
      break;
    }
    case 'ServiceRequest': {
      const sr = draft as ServiceRequest;
      if (!sr.subject?.reference) return 'Subject (patient) is required.';
      break;
    }
    case 'Condition': {
      const c = draft as Condition;
      if (!c.subject?.reference) return 'Subject (patient) is required.';
      break;
    }
  }
  return null;
};

// =============================================================================
// Main: CreateResourceModal
// =============================================================================

interface CreateResourceModalProps {
  open: boolean;
  resourceType: string;
  onClose: () => void;
  onSuccess: () => void;
  initialDraft?: Record<string, unknown>;
  onSuccessResource?: (resource: FhirResource) => void;
}

const CreateResourceModal: React.FC<CreateResourceModalProps> = ({
  open,
  resourceType,
  onClose,
  onSuccess,
  initialDraft,
  onSuccessResource,
}) => {
  const { activeRole } = useRole();
  const client = useFhirClient();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState<FhirResource | null>(() =>
    buildInitialDraft(resourceType)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rebuild the draft whenever the resource type or open state changes;
  // merge initialDraft on top so wizard can pre-populate fields.
  useEffect(() => {
    const base = buildInitialDraft(resourceType);
    setDraft(base && initialDraft ? ({ ...base, ...initialDraft } as FhirResource) : base);
    setError(null);
  }, [resourceType, open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reference data (conditionally fetched based on type)
  const needsPatients = ['ServiceRequest', 'Task', 'Condition', 'Consent'].includes(resourceType);
  const needsPRoles = ['ServiceRequest', 'Task'].includes(resourceType);
  const needsSRs = ['Task', 'Consent'].includes(resourceType);
  const needsOrgs = ['Task', 'Consent'].includes(resourceType);

  const { data: patientBundle, isLoading: pLoading } = useFhirSearch<Patient>(
    'Patient',
    {},
    open && needsPatients
  );
  const { data: prBundle, isLoading: prLoading } = useFhirSearch<FhirResource>(
    'PractitionerRole',
    {},
    open && needsPRoles
  );
  const { data: srBundle, isLoading: srLoading } = useFhirSearch<ServiceRequest>(
    'ServiceRequest',
    {},
    open && needsSRs
  );
  const { data: orgBundle, isLoading: orgLoading } = useFhirSearch<Organization>(
    'Organization',
    {},
    open && needsOrgs
  );

  const patients =
    (patientBundle?.entry?.map((e) => e.resource).filter(Boolean) as Patient[]) ?? [];
  const practitionerRoles =
    (prBundle?.entry?.map((e) => e.resource).filter(Boolean) as FhirResource[]) ?? [];
  const serviceRequests =
    (srBundle?.entry?.map((e) => e.resource).filter(Boolean) as ServiceRequest[]) ?? [];
  const organizations =
    (orgBundle?.entry?.map((e) => e.resource).filter(Boolean) as Organization[]) ?? [];

  const isLoading = pLoading || prLoading || srLoading || orgLoading;
  const isSupported = SUPPORTED_EDIT_TYPES.includes(resourceType);

  const handleSubmit = async () => {
    if (!draft) return;
    const validationError = validate(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await client.create(draft);
      // Invalidate queries for this resource type so mounted list views
      // refresh immediately. Use refetchType:'active' (not 'all') to avoid
      // firing a background refetch for inactive queries — a background
      // fetch completing after our setQueryData injection in the wizard
      // would silently overwrite the injected resource.
      await queryClient.invalidateQueries({
        queryKey: ['fhir', activeRole, resourceType],
        refetchType: 'active',
      });
      onSuccessResource?.(result);
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            Create New {resourceType}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!isSupported ? (
            <p className="text-sm text-gray-500 italic">
              Creating <strong>{resourceType}</strong> resources is not supported in this UI.
            </p>
          ) : isLoading ? (
            <LoadingSpinner message="Loading reference data…" />
          ) : draft ? (
            <>
              {draft.resourceType === 'Patient' && (
                <CreatePatientForm
                  draft={draft as Patient}
                  setDraft={(p) => setDraft(p as FhirResource)}
                />
              )}
              {draft.resourceType === 'Organization' && (
                <CreateOrganizationForm
                  draft={draft as Organization}
                  setDraft={(o) => setDraft(o as FhirResource)}
                />
              )}
              {draft.resourceType === 'ServiceRequest' && (
                <CreateServiceRequestForm
                  draft={draft as ServiceRequest}
                  setDraft={(sr) => setDraft(sr as FhirResource)}
                  patients={patients}
                  practitionerRoles={practitionerRoles}
                />
              )}
              {draft.resourceType === 'Task' && (
                <CreateTaskForm
                  draft={draft as Task}
                  setDraft={(t) => setDraft(t as FhirResource)}
                  patients={patients}
                  practitionerRoles={practitionerRoles}
                  serviceRequests={serviceRequests}
                  organizations={organizations}
                />
              )}
              {draft.resourceType === 'Condition' && (
                <CreateConditionForm
                  draft={draft as Condition}
                  setDraft={(c) => setDraft(c as FhirResource)}
                  patients={patients}
                />
              )}
              {draft.resourceType === 'Consent' && (
                <CreateConsentForm
                  draft={draft as Consent}
                  setDraft={(c) => setDraft(c as FhirResource)}
                  patients={patients}
                  serviceRequests={serviceRequests}
                  organizations={organizations}
                />
              )}

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {error}
                </p>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <button onClick={onClose} className="btn-secondary" disabled={submitting}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || isLoading || !isSupported}
            className="btn-primary disabled:opacity-50"
          >
            {submitting ? 'Creating…' : `Create ${resourceType}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CreateResourceModal;
