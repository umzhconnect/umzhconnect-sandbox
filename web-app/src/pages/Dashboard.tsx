import React from 'react';
import { useRole } from '../contexts/RoleContext';
import WorkflowWizard from '../components/workflow/WorkflowWizard';

const Dashboard: React.FC = () => {
  const { partyLabel, activeRole } = useRole();
  const isRegistry = activeRole === 'registry';

  return (
    <div className="space-y-8">
      {!isRegistry && <WorkflowWizard key={activeRole} />}
    </div>
  );
};

export default Dashboard;
