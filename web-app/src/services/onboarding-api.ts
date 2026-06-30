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
  orgName:        string;
  orgIdentifier?: string;
  fhirBaseUrl?:   string;
  level:          'l1' | 'l2';
  jwksUrl?:       string;
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

// An onboarded client as returned by GET /clients
export interface OnboardedClient {
  clientId:      string;
  level:         'l1' | 'l2';
  orgName:       string;
  orgId:         string;
  orgReference:  string;
  endpointId?:   string;
  fhirBaseUrl?:  string;
  createdAt:     string;
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

export async function listClients(token: string): Promise<OnboardedClient[]> {
  const res = await fetch(`${BASE}/clients`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Failed to list clients (${res.status})`);
  return data as OnboardedClient[];
}

export async function createClient(
  body: CreateClientRequest,
  token: string,
): Promise<CreateClientResponse> {
  const res = await fetch(`${BASE}/clients`, {
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
