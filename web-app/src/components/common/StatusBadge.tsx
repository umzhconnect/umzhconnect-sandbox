import React from 'react';

interface StatusBadgeProps {
  status: string;
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  ready: 'bg-yellow-100 text-yellow-800',
  'in-progress': 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
  draft: 'bg-gray-100 text-gray-800',
  'on-hold': 'bg-orange-100 text-orange-800',
  'entered-in-error': 'bg-red-100 text-red-800',
  revoked: 'bg-red-100 text-red-800',
  routine: 'bg-gray-100 text-gray-700',
  urgent: 'bg-orange-100 text-orange-800',
  asap: 'bg-red-100 text-red-800',
  stat: 'bg-red-200 text-red-900',
  confirmed: 'bg-green-100 text-green-800',
  provisional: 'bg-yellow-100 text-yellow-800',
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  const colorClass = statusColors[status] || 'bg-gray-100 text-gray-800';

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
};

export default StatusBadge;
