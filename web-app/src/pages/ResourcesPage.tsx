import React from 'react';
import { useRole } from '../contexts/RoleContext';
import ResourceList from '../components/fhir/ResourceList';

const ResourcesPage: React.FC = () => {
  const { activeRole, partyLabel } = useRole();
  const isRegistry = activeRole === 'registry';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">FHIR Resources</h2>
        <p className="text-gray-500 mt-1">
          {isRegistry
            ? <>Shared mCSD directory — <strong>Organization</strong> and <strong>Endpoint</strong> resources (public, no auth)</>
            : <>Browse and manage FHIR resources for <strong>{partyLabel}</strong></>
          }
        </p>
      </div>
      <ResourceList defaultType={isRegistry ? 'Organization' : 'Patient'} />
    </div>
  );
};

export default ResourcesPage;
