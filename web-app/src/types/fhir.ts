// =============================================================================
// FHIR R4 Type Definitions for UMZH Connect Sandbox
// =============================================================================

export interface FhirResource {
  resourceType: string;
  id?: string;
  meta?: {
    versionId?: string;
    lastUpdated?: string;
    profile?: string[];
    tag?: Coding[];
    security?: Coding[];
  };
}

export interface Reference {
  reference?: string;
  display?: string;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Coding {
  system?: string;
  code?: string;
  display?: string;
}

export interface Identifier {
  type?: CodeableConcept;
  system?: string;
  value?: string;
  use?: string;
}

export interface Annotation {
  text: string;
  authorReference?: Reference;
  time?: string;
}

export interface Period {
  start?: string;
  end?: string;
}

// --- Patient ---
export interface Patient extends FhirResource {
  resourceType: 'Patient';
  identifier?: Identifier[];
  active?: boolean;
  name?: { family?: string; given?: string[]; prefix?: string[] }[];
  gender?: string;
  birthDate?: string;
  address?: { line?: string[]; city?: string; postalCode?: string; country?: string }[];
  telecom?: { system?: string; value?: string; use?: string }[];
}

// --- Organization ---
export interface Organization extends FhirResource {
  resourceType: 'Organization';
  identifier?: Identifier[];
  active?: boolean;
  name?: string;
  alias?: string[];
  address?: { line?: string[]; city?: string; postalCode?: string; country?: string }[];
  telecom?: { system?: string; value?: string }[];
}

// --- ServiceRequest ---
export interface ServiceRequest extends FhirResource {
  resourceType: 'ServiceRequest';
  identifier?: Identifier[];
  status: string;
  intent: string;
  category?: CodeableConcept[];
  priority?: string;
  code?: CodeableConcept;
  subject: Reference;
  authoredOn?: string;
  requester?: Reference;
  performer?: Reference[];
  reasonReference?: Reference[];
  reasonCode?: CodeableConcept[];
  insurance?: Reference[];
  supportingInfo?: Reference[];
  note?: Annotation[];
}

// --- Task ---
export interface Task extends FhirResource {
  resourceType: 'Task';
  status: string;
  intent: string;
  priority?: string;
  code?: CodeableConcept;
  description?: string;
  basedOn?: Reference[];
  focus?: Reference;
  for?: Reference;
  authoredOn?: string;
  lastModified?: string;
  requester?: Reference;
  owner?: Reference;
  input?: TaskParameter[];
  output?: TaskParameter[];
}

export interface TaskParameter {
  type: CodeableConcept;
  valueReference?: Reference;
  valueCanonical?: string;
  valueString?: string;
}

// --- Condition ---
export interface Condition extends FhirResource {
  resourceType: 'Condition';
  clinicalStatus?: CodeableConcept;
  verificationStatus?: CodeableConcept;
  category?: CodeableConcept[];
  code?: CodeableConcept;
  bodySite?: CodeableConcept[];
  subject: Reference;
  recordedDate?: string;
}

// --- Consent ---
export interface Consent extends FhirResource {
  resourceType: 'Consent';
  status: string;
  scope: CodeableConcept;
  category: CodeableConcept[];
  patient?: Reference;
  dateTime?: string;
  organization?: Reference[];
  performer?: Reference[];
  sourceReference?: Reference;
  provision?: ConsentProvision;
}

export interface ConsentProvision {
  type?: string;
  period?: Period;
  actor?: { role: CodeableConcept; reference: Reference }[];
  data?: { meaning: string; reference: Reference }[];
}

// --- Questionnaire ---
export interface Questionnaire extends FhirResource {
  resourceType: 'Questionnaire';
  url?: string;
  name?: string;
  title?: string;
  status: string;
  item?: QuestionnaireItem[];
}

export interface QuestionnaireItem {
  linkId: string;
  text?: string;
  type: string;
  required?: boolean;
  answerOption?: { valueCoding?: Coding; valueString?: string }[];
  enableWhen?: { question: string; operator: string; answerCoding?: Coding }[];
}

// --- QuestionnaireResponse ---
export interface QuestionnaireResponse extends FhirResource {
  resourceType: 'QuestionnaireResponse';
  questionnaire?: string;
  status: string;
  subject?: Reference;
  authored?: string;
  item?: QuestionnaireResponseItem[];
}

export interface QuestionnaireResponseItem {
  linkId: string;
  text?: string;
  answer?: { valueCoding?: Coding; valueDecimal?: number; valueString?: string }[];
}

// --- Bundle ---
export interface Bundle extends FhirResource {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: BundleEntry[];
  link?: { relation: string; url: string }[];
}

export interface BundleEntry {
  fullUrl?: string;
  resource?: FhirResource;
}

// --- Log Entry ---
export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'request' | 'response' | 'error' | 'info';
  method?: string;
  url?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  message?: string;
  duration?: number;
}

// --- Role ---
export type PartyRole = 'placer' | 'fulfiller';

// --- Task Status ---
export const TASK_STATUSES = [
  'draft',
  'requested',
  'received',
  'accepted',
  'ready',
  'in-progress',
  'on-hold',
  'completed',
  'cancelled',
  'entered-in-error',
  'rejected',
  'failed',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

// --- Supported Resource Types ---
export const RESOURCE_TYPES = [
  'Patient',
  'Organization',
  'Practitioner',
  'PractitionerRole',
  'ServiceRequest',
  'Task',
  'Condition',
  'MedicationStatement',
  'AllergyIntolerance',
  'Coverage',
  'Consent',
  'DocumentReference',
  'ImagingStudy',
  'Observation',
  'Procedure',
  'Immunization',
  'DiagnosticReport',
  'Questionnaire',
  'QuestionnaireResponse',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];
