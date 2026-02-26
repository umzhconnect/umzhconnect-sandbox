import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

// Keycloak token accessor — injected by useAuth hook
let _getToken: (() => Promise<string | null>) | null = null

export function setTokenAccessor(fn: () => Promise<string | null>) {
  _getToken = fn
}

const api: AxiosInstance = axios.create({
  baseURL: BACKEND_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
})

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (_getToken) {
    const token = await _getToken()
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

// ── API helpers ───────────────────────────────────────────────────────────────

export const authApi = {
  acquireToken: (partyId: string) =>
    api.post(`/auth/token/${partyId}`).then(r => r.data),
  listClients: () =>
    api.get('/auth/clients').then(r => r.data),
  realmInfo: () =>
    api.get('/auth/realm-info').then(r => r.data),
}

export const fhirApi = {
  search: (partyId: string, resourceType: string, params?: Record<string, string>) =>
    api.get(`/fhir/${partyId}/${resourceType}`, { params }).then(r => r.data),
  read: (partyId: string, resourceType: string, id: string) =>
    api.get(`/fhir/${partyId}/${resourceType}/${id}`).then(r => r.data),
  create: (partyId: string, resourceType: string, body: object) =>
    api.post(`/fhir/${partyId}/${resourceType}`, body).then(r => r.data),
  update: (partyId: string, resourceType: string, id: string, body: object) =>
    api.put(`/fhir/${partyId}/${resourceType}/${id}`, body).then(r => r.data),
  crossPartySearch: (
    targetParty: string,
    resourceType: string,
    sourceParty: string,
    params?: Record<string, string>
  ) =>
    api.get(`/fhir/external/${targetParty}/${resourceType}`, {
      params: { source_party: sourceParty, ...params },
    }).then(r => r.data),
  crossPartyRead: (
    targetParty: string,
    resourceType: string,
    id: string,
    sourceParty: string
  ) =>
    api.get(`/fhir/external/${targetParty}/${resourceType}/${id}`, {
      params: { source_party: sourceParty },
    }).then(r => r.data),
}

export const workflowApi = {
  createServiceRequest: (body: {
    patient_id: string
    requester_practitioner_id: string
    performer_organization_id: string
    reason_code?: string
    reason_display?: string
    note?: string
    condition_ids?: string[]
  }) => api.post('/workflow/service-request', body).then(r => r.data),

  createConsent: (body: {
    patient_id: string
    service_request_id: string
    performer_party_id?: string
    performer_organization_id: string
  }) => api.post('/workflow/consent', body).then(r => r.data),

  createTask: (body: {
    service_request_id: string
    service_request_party?: string
    owner_organization_id: string
    requester_organization_id: string
  }) => api.post('/workflow/task', body).then(r => r.data),

  updateTaskStatus: (taskId: string, body: {
    status: string
    owner_reference?: string
    business_status_code?: string
    business_status_display?: string
  }) => api.put(`/workflow/task/${taskId}/status`, body).then(r => r.data),

  addTaskOutput: (taskId: string, body: {
    output_type: string
    output_reference: string
  }) => api.post(`/workflow/task/${taskId}/output`, body).then(r => r.data),
}

export const onboardingApi = {
  register: (userEmail: string, userName?: string) =>
    api.post('/onboarding/register', { user_email: userEmail, user_name: userName }).then(r => r.data),
  status: () =>
    api.get('/onboarding/status').then(r => r.data),
}

export default api
