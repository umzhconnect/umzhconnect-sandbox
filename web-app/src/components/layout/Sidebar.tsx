import React from 'react';
import { NavLink } from 'react-router-dom';
import { useRole } from '../../contexts/RoleContext';
import { useAuth } from '../../contexts/AuthContext';

const NAV_ITEMS = [
  {
    path: '/intro',
    label: 'Intro',
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    authRequired: false,
  },
  {
    path: '/workflow',
    label: 'Workflow',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
    authRequired: true,
  },
  {
    path: '/resources',
    label: 'Resources',
    icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4',
    authRequired: true,
  },
  {
    path: '/tasks',
    label: 'Tasks',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    authRequired: true,
  },
  {
    path: '/registry',
    label: 'Registry',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    authRequired: false,
  },
  {
    path: '/credentials',
    label: 'Credentials',
    icon: 'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
    authRequired: true,
  },
  {
    path: '/onboarding',
    label: 'Get access',
    icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z',
    authRequired: false,
  },
];

const Sidebar: React.FC = () => {
  const { activeRole } = useRole();
  const { authenticated } = useAuth();

  const activeColor = activeRole === 'placer' ? 'blue' : activeRole === 'fulfiller' ? 'green' : 'purple';
  const visibleItems = NAV_ITEMS.filter((item) => !item.authRequired || authenticated);

  return (
    <aside className="w-56 bg-white border-r border-gray-200 min-h-[calc(100vh-4rem)]">
      <nav className="p-3 space-y-1">
        {visibleItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? activeColor === 'blue'
                    ? 'bg-blue-50 text-blue-700'
                    : activeColor === 'green'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-purple-50 text-purple-700'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
          >
            <svg
              className="w-5 h-5 flex-shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
            </svg>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;
