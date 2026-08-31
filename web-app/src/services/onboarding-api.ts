import { VITE_ADMIN_API_URL } from '../config/env';

const BASE = VITE_ADMIN_API_URL;

export interface RegisterRequest {
  email:       string;
  password:    string;
  firstName:   string;
  lastName:    string;
  inviteToken: string;
}

export interface InviteResponse {
  token:     string;
  expiresAt: string;
  message:   string;
}

export interface RegisterResponse {
  userId:  string;
  email:   string;
  message: string;
}

export interface CreateClientRequest {
  orgName?:       string;
  orgIdentifier?: string;
  fhirBaseUrl?:   string;
  level:          'l1' | 'l2';
  jwksUrl?:       string;
  existingOrgId?: string;
}

export interface CreateClientResponse {
  clientId:      string;
  level:         'l1' | 'l2';
  orgName:       string;
  orgId:         string;
  orgReference:  string;
  endpointId?:   string;
  fhirBaseUrl?:  string;
  tokenEndpoint: string;
  clientSecret?: string;
  jwksUrl?:      string;
}

// An onboarded client as returned by GET /my-clients
export interface OnboardedClient {
  clientId:      string;
  level:         'l1' | 'l2';
  orgName:       string;
  orgId:         string;
  orgReference:  string;
  endpointId?:   string;
  fhirBaseUrl?:  string;
  tokenEndpoint: string;
  createdAt:     string;
}

// An organisation as returned by GET /my-organisations
export interface MyOrganisation {
  orgId:          string;
  orgName:        string;
  orgReference:   string;
  orgIdentifier?: string;
  fhirBaseUrl?:   string;
  createdAt:      string;
}

export interface AddHealthcareServiceRequest {
  name:         string;
  typeCode:     string;
  typeDisplay?: string;
  typeSystem?:  string;
}

export interface HealthcareService {
  id:           string;
  name:         string;
  typeCode:     string;
  typeDisplay?: string;
  typeSystem?:  string;
}

export async function registerUser(body: RegisterRequest): Promise<RegisterResponse> {
  const res = await fetch(`${BASE}/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Registration failed (${res.status})`);
  return data as RegisterResponse;
}

export async function createInvite(token: string): Promise<InviteResponse> {
  const res = await fetch(`${BASE}/invites`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to create invite (${res.status})`);
  return data as InviteResponse;
}

export async function listMyClients(token: string): Promise<OnboardedClient[]> {
  const res = await fetch(`${BASE}/my-clients`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to list my clients (${res.status})`);
  return data as OnboardedClient[];
}

export async function listMyOrganisations(token: string): Promise<MyOrganisation[]> {
  const res = await fetch(`${BASE}/my-organisations`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to list my organisations (${res.status})`);
  return data as MyOrganisation[];
}

export async function listOrgHealthcareServices(
  orgId: string,
  token: string,
): Promise<HealthcareService[]> {
  const res = await fetch(`${BASE}/my-organisations/${orgId}/healthcare-services`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to list services (${res.status})`);
  return data as HealthcareService[];
}

export async function addHealthcareService(
  orgId: string,
  body:  AddHealthcareServiceRequest,
  token: string,
): Promise<HealthcareService> {
  const res = await fetch(`${BASE}/my-organisations/${orgId}/healthcare-services`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to add service (${res.status})`);
  return data as HealthcareService;
}

export async function createClient(
  body: CreateClientRequest,
  token: string,
): Promise<CreateClientResponse> {
  const res = await fetch(`${BASE}/my-clients`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Client creation failed (${res.status})`);
  return data as CreateClientResponse;
}
