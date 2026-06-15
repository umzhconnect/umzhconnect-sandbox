import React, { createContext, useContext, useState, useCallback } from 'react';
import type { PartyRole } from '../types/fhir';
import { env } from '../config/env';

// APISIX gateway base URLs (browser calls these directly via CORS).
// Resolved at runtime via window.__ENV__ (injected by env.sh in the Docker
// image), falling back to build-time VITE_* vars, then these defaults.
const PLACER_URL             = env('VITE_PLACER_URL',             'http://localhost:8080');
const PLACER_EXTERNAL_URL    = env('VITE_PLACER_EXTERNAL_URL',    'http://localhost:8081');
const FULFILLER_URL          = env('VITE_FULFILLER_URL',          'http://localhost:8082');
const FULFILLER_EXTERNAL_URL = env('VITE_FULFILLER_EXTERNAL_URL', 'http://localhost:8083');
const REGISTRY_URL           = env('VITE_REGISTRY_URL',           'http://localhost:8084');
const KEYCLOAK_URL           = env('VITE_KEYCLOAK_URL',           'http://localhost:8180');
const KEYCLOAK_REALM         = env('VITE_KEYCLOAK_REALM',         'umzh-connect');

// Keycloak token endpoint (published/frontend URL — also the assertion `aud`).
const KEYCLOAK_TOKEN_URL = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;

interface RoleContextType {
  activeRole: PartyRole;
  switchRole: (role: PartyRole) => void;
  toggleRole: () => void;
  partyLabel: string;
  partyColor: string;
  /** Base URL for own FHIR partition, e.g. http://localhost:8080/fhir */
  apiBasePath: string;
  /** Base URL for the partner's dedicated external FHIR gateway, e.g. http://localhost:8083/fhir */
  partnerExternalBaseUrl: string;
  /**
   * Base URL for THIS party's own external FHIR gateway, e.g. http://localhost:8081/fhir.
   * Use this when building absolute references inside resources that will be stored in the
   * partner's system — the partner must be able to resolve those URLs, so they must point
   * to the creator's publicly reachable external gateway, not the internal one.
   */
  ownExternalBaseUrl: string;
  /** Base URL for the Organization registry (public, no auth), e.g. http://localhost:8084/fhir */
  registryBaseUrl: string;
  /**
   * Absolute registry reference to THIS party's own Organization, e.g.
   * http://localhost:8084/fhir/Organization/HospitalP. Used as Task.requester,
   * which the IG profile constrains to Reference(Organization) with an absolute
   * URL (ch-umzh-connect-coordinationtask). Empty for the registry role.
   */
  ownOrgRegistryRef: string;
  // ─── L2 identity for in-browser client_credentials (cross-party calls) ───
  /** Keycloak token endpoint used for the M2M exchange. */
  keycloakTokenUrl: string;
  /** This party's L2 client_id, e.g. "placer-client-l2" (empty for registry). */
  ownL2ClientId: string;
  /** JWT header kid for this party's L2 key, e.g. "placer-l2" (empty for registry). */
  ownL2Kid: string;
  /** URL the party's L2 private key is served from, e.g. "/l2-keys/placer-l2.key". */
  ownL2KeyUrl: string;
}

const RoleContext = createContext<RoleContextType>({
  activeRole: 'placer',
  switchRole: () => {},
  toggleRole: () => {},
  partyLabel: 'HospitalP (Placer)',
  partyColor: 'blue',
  apiBasePath: `${PLACER_URL}/fhir`,
  partnerExternalBaseUrl: `${FULFILLER_EXTERNAL_URL}/fhir`,
  ownExternalBaseUrl: `${PLACER_EXTERNAL_URL}/fhir`,
  registryBaseUrl: `${REGISTRY_URL}/fhir`,
  ownOrgRegistryRef: `${REGISTRY_URL}/fhir/Organization/HospitalP`,
  keycloakTokenUrl: KEYCLOAK_TOKEN_URL,
  ownL2ClientId: 'placer-client-l2',
  ownL2Kid: 'placer-l2',
  ownL2KeyUrl: '/l2-keys/placer-l2.key',
});

export const useRole = () => useContext(RoleContext);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeRole, setActiveRole] = useState<PartyRole>('placer');

  const switchRole = useCallback((role: PartyRole) => {
    setActiveRole(role);
  }, []);

  const toggleRole = useCallback(() => {
    setActiveRole((prev) =>
      prev === 'placer' ? 'fulfiller' : prev === 'fulfiller' ? 'registry' : 'placer'
    );
  }, []);

  const registryBaseUrl = `${REGISTRY_URL}/fhir`;

  const config = activeRole === 'placer'
    ? {
        partyLabel: 'HospitalP (Placer)',
        partyColor: 'blue',
        apiBasePath:             `${PLACER_URL}/fhir`,
        partnerExternalBaseUrl:  `${FULFILLER_EXTERNAL_URL}/fhir`,
        ownExternalBaseUrl:      `${PLACER_EXTERNAL_URL}/fhir`,
        registryBaseUrl,
        ownOrgRegistryRef:       `${registryBaseUrl}/Organization/HospitalP`,
        keycloakTokenUrl:        KEYCLOAK_TOKEN_URL,
        ownL2ClientId:           'placer-client-l2',
        ownL2Kid:                'placer-l2',
        ownL2KeyUrl:             '/l2-keys/placer-l2.key',
      }
    : activeRole === 'fulfiller'
    ? {
        partyLabel: 'HospitalF (Fulfiller)',
        partyColor: 'green',
        apiBasePath:             `${FULFILLER_URL}/fhir`,
        partnerExternalBaseUrl:  `${PLACER_EXTERNAL_URL}/fhir`,
        ownExternalBaseUrl:      `${FULFILLER_EXTERNAL_URL}/fhir`,
        registryBaseUrl,
        ownOrgRegistryRef:       `${registryBaseUrl}/Organization/HospitalF`,
        keycloakTokenUrl:        KEYCLOAK_TOKEN_URL,
        ownL2ClientId:           'fulfiller-client-l2',
        ownL2Kid:                'fulfiller-l2',
        ownL2KeyUrl:             '/l2-keys/fulfiller-l2.key',
      }
    : {
        partyLabel: 'Registry',
        partyColor: 'purple',
        apiBasePath:             registryBaseUrl,
        partnerExternalBaseUrl:  '',
        ownExternalBaseUrl:      registryBaseUrl,
        registryBaseUrl,
        ownOrgRegistryRef:       '',
        keycloakTokenUrl:        KEYCLOAK_TOKEN_URL,
        ownL2ClientId:           '',
        ownL2Kid:                '',
        ownL2KeyUrl:             '',
      };

  return (
    <RoleContext.Provider
      value={{ activeRole, switchRole, toggleRole, ...config }}
    >
      {children}
    </RoleContext.Provider>
  );
};
