import { useMemo } from 'react';
import { FhirClient } from '../services/fhir-client';
import { useAuth } from '../contexts/AuthContext';
import { useRole } from '../contexts/RoleContext';
import { useLog } from '../contexts/LogContext';

/**
 * Hook to get a FHIR client for the active role's own FHIR server.
 */
export function useFhirClient(): FhirClient {
  const { token } = useAuth();
  const { apiBasePath, activeRole } = useRole();
  const { addLog } = useLog();

  // Registry is public — never send an auth token to it.
  const effectiveToken = activeRole === 'registry' ? undefined : token;

  return useMemo(
    () => new FhirClient(apiBasePath, effectiveToken, addLog),
    [apiBasePath, effectiveToken, addLog]
  );
}

/**
 * Hook to get an unauthenticated FHIR client for the public Organization registry.
 */
export function useRegistryClient(): FhirClient {
  const { registryBaseUrl } = useRole();
  const { addLog } = useLog();

  return useMemo(
    () => new FhirClient(registryBaseUrl, undefined, addLog),
    [registryBaseUrl, addLog]
  );
}

/**
 * Hook to get a FHIR client for the partner's FHIR server (via proxy).
 */
export function useProxyClient(): FhirClient {
  const { token } = useAuth();
  const { proxyBasePath } = useRole();
  const { addLog } = useLog();

  return useMemo(
    () => new FhirClient(proxyBasePath, token, addLog),
    [proxyBasePath, token, addLog]
  );
}
