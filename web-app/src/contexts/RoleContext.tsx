import React, { createContext, useContext, useState, useCallback } from 'react';
import type { PartyRole } from '../types/fhir';

// KrakenD gateway base URLs (browser calls these directly via CORS).
// Override at build time via VITE_* env vars, or at runtime via window.__ENV__
// (injected by env.sh in the Docker image).
const PLACER_URL             = import.meta.env.VITE_PLACER_URL             || 'http://localhost:8080';
const PLACER_EXTERNAL_URL    = import.meta.env.VITE_PLACER_EXTERNAL_URL    || 'http://localhost:8081';
const FULFILLER_URL          = import.meta.env.VITE_FULFILLER_URL          || 'http://localhost:8082';
const FULFILLER_EXTERNAL_URL = import.meta.env.VITE_FULFILLER_EXTERNAL_URL || 'http://localhost:8083';

interface RoleContextType {
  activeRole: PartyRole;
  switchRole: (role: PartyRole) => void;
  toggleRole: () => void;
  partyLabel: string;
  partyColor: string;
  /** Base URL for own FHIR partition, e.g. http://localhost:8080/fhir */
  apiBasePath: string;
  /** Base URL for partner's FHIR partition (via proxy), e.g. http://localhost:8080/proxy/fhir */
  proxyBasePath: string;
  /** Base URL for the partner's dedicated external FHIR gateway, e.g. http://localhost:8083/fhir */
  partnerExternalBaseUrl: string;
  /**
   * Base URL for THIS party's own external FHIR gateway, e.g. http://localhost:8081/fhir.
   * Use this when building absolute references inside resources that will be stored in the
   * partner's system — the partner must be able to resolve those URLs, so they must point
   * to the creator's publicly reachable external gateway, not the internal one.
   */
  ownExternalBaseUrl: string;
}

const RoleContext = createContext<RoleContextType>({
  activeRole: 'placer',
  switchRole: () => {},
  toggleRole: () => {},
  partyLabel: 'HospitalP (Placer)',
  partyColor: 'blue',
  apiBasePath: `${PLACER_URL}/fhir`,
  proxyBasePath: `${PLACER_URL}/proxy/fhir`,
  partnerExternalBaseUrl: `${FULFILLER_EXTERNAL_URL}/fhir`,
  ownExternalBaseUrl: `${PLACER_EXTERNAL_URL}/fhir`,
});

export const useRole = () => useContext(RoleContext);

export const RoleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeRole, setActiveRole] = useState<PartyRole>('placer');

  const switchRole = useCallback((role: PartyRole) => {
    setActiveRole(role);
  }, []);

  const toggleRole = useCallback(() => {
    setActiveRole((prev) => (prev === 'placer' ? 'fulfiller' : 'placer'));
  }, []);

  const config = activeRole === 'placer'
    ? {
        partyLabel: 'HospitalP (Placer)',
        partyColor: 'blue',
        apiBasePath:             `${PLACER_URL}/fhir`,
        proxyBasePath:           `${PLACER_URL}/proxy/fhir`,
        partnerExternalBaseUrl:  `${FULFILLER_EXTERNAL_URL}/fhir`,
        ownExternalBaseUrl:      `${PLACER_EXTERNAL_URL}/fhir`,
      }
    : {
        partyLabel: 'HospitalF (Fulfiller)',
        partyColor: 'green',
        apiBasePath:             `${FULFILLER_URL}/fhir`,
        proxyBasePath:           `${FULFILLER_URL}/proxy/fhir`,
        partnerExternalBaseUrl:  `${PLACER_EXTERNAL_URL}/fhir`,
        ownExternalBaseUrl:      `${FULFILLER_EXTERNAL_URL}/fhir`,
      };

  return (
    <RoleContext.Provider
      value={{ activeRole, switchRole, toggleRole, ...config }}
    >
      {children}
    </RoleContext.Provider>
  );
};
