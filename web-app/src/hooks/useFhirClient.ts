import { useCallback, useMemo } from 'react';
import { FhirClient } from '../services/fhir-client';
import { acquireM2mToken } from '../services/l2-signing';
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
 * Hook returning an async function that mints an M2M (client_credentials) access
 * token for THIS party, signing the assertion in-browser (Web Crypto). Pass a
 * fhirContextRef (e.g. "ServiceRequest/abc") for fhirContext-gated clinical
 * reads; omit it for Task list/create.
 *
 * The web-app authenticates cross-party calls itself, then talks to the
 * partner external gateway directly.
 */
export function useM2mToken(): (fhirContextRef?: string) => Promise<string> {
  const { keycloakTokenUrl, ownL2ClientId, ownL2Kid, ownL2KeyUrl } = useRole();
  const { addLog } = useLog();

  return useCallback(
    (fhirContextRef?: string) =>
      acquireM2mToken({
        keycloakTokenUrl,
        clientId: ownL2ClientId,
        kid: ownL2Kid,
        keyUrl: ownL2KeyUrl,
        fhirContextRef,
        onLog: addLog,
      }),
    [keycloakTokenUrl, ownL2ClientId, ownL2Kid, ownL2KeyUrl, addLog]
  );
}

/**
 * Hook returning an async factory for a FHIR client pointed at the partner's
 * external gateway, authenticated with a freshly-minted M2M token. The optional
 * fhirContextRef is bound into that token for OPA's fhirContext gate.
 */
export function usePartnerClient(): (fhirContextRef?: string) => Promise<FhirClient> {
  const { partnerExternalBaseUrl } = useRole();
  const { addLog } = useLog();
  const getM2mToken = useM2mToken();

  return useCallback(
    async (fhirContextRef?: string) => {
      const token = await getM2mToken(fhirContextRef);
      return new FhirClient(partnerExternalBaseUrl, token, addLog);
    },
    [partnerExternalBaseUrl, addLog, getM2mToken]
  );
}

/**
 * Hook returning an async GET against an absolute partner-external URL,
 * authenticated with a freshly-minted M2M token. Used for cross-party reads
 * where the search URL is built by hand (e.g. multi-valued _include). Pass the
 * fhirContextRef so OPA's fhirContext gate permits the read.
 */
export function useCrossPartyFetch(): <T>(absoluteUrl: string, fhirContextRef?: string) => Promise<T> {
  const { addLog } = useLog();
  const getM2mToken = useM2mToken();

  return useCallback(
    async <T,>(absoluteUrl: string, fhirContextRef?: string): Promise<T> => {
      const token = await getM2mToken(fhirContextRef);
      const headers = {
        Accept: 'application/fhir+json',
        Authorization: `Bearer ${token}`,
      };
      addLog({ type: 'request', method: 'GET', url: absoluteUrl, headers,
        message: 'Cross-party read (direct to partner external gateway)' });
      const start = Date.now();
      const res = await fetch(absoluteUrl, { headers });
      const body = await res.json();
      addLog({ type: res.ok ? 'response' : 'error', method: 'GET', url: absoluteUrl,
        status: res.status, body, duration: Date.now() - start });
      if (!res.ok) throw new Error(`Cross-party fetch failed: ${res.status}`);
      return body as T;
    },
    [addLog, getM2mToken]
  );
}
