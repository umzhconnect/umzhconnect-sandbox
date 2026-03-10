import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRole } from '../contexts/RoleContext';
import TaskList from '../components/fhir/TaskList';
import CreateTaskModal from '../components/fhir/CreateTaskModal';

const TasksPage: React.FC = () => {
  const { activeRole, partyLabel } = useRole();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  const handleSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['all-tasks', activeRole] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Tasks</h2>
          <p className="text-gray-500 mt-1">
            {activeRole === 'placer'
              ? 'Tasks created at the Fulfiller, authored by your party. Manage referral tasks and track their status.'
              : 'Incoming tasks assigned to your party. Process referrals, fetch data, and update task status.'}
            {' '}Active role: <strong>{partyLabel}</strong>
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="btn-primary flex-shrink-0"
        >
          + Create new
        </button>
      </div>

      <TaskList />

      <CreateTaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleSuccess}
      />
    </div>
  );
};

export default TasksPage;
