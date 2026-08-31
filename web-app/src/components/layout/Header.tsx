import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useRole } from '../../contexts/RoleContext';
import { VITE_ADMIN_API_URL } from '../../config/env';

type ReseedStatus = 'idle' | 'loading' | 'success' | 'error';

const Header: React.FC = () => {
  const { authenticated, username, roles, login, logout, getToken } = useAuth();
  const { activeRole, switchRole } = useRole();

  const [reseedStatus, setReseedStatus] = useState<ReseedStatus>('idle');

  const handleReseed = async () => {
    if (reseedStatus === 'loading') return;
    setReseedStatus('loading');
    try {
      const token = await getToken();
      const res = await fetch(`${VITE_ADMIN_API_URL}/reseed`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      const json = await res.json();
      setReseedStatus(json.success ? 'success' : 'error');
    } catch {
      setReseedStatus('error');
    }
    setTimeout(() => setReseedStatus('idle'), 3000);
  };

  const reseedLabel =
    reseedStatus === 'loading' ? 'Reseeding…' :
    reseedStatus === 'success' ? '✓ Reseeded' :
    reseedStatus === 'error'   ? '✗ Failed'   :
    'Reseed data';

  const reseedCls =
    reseedStatus === 'loading' ? 'opacity-60 cursor-not-allowed' :
    reseedStatus === 'success' ? 'text-green-700 border-green-300 bg-green-50' :
    reseedStatus === 'error'   ? 'text-red-700 border-red-300 bg-red-50'      :
    '';

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-green-500 rounded-lg flex items-center justify-center text-white font-bold text-sm">
              U
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">UMZH Connect</h1>
              <p className="text-xs text-gray-500">Sandbox</p>
            </div>
          </div>

          {/* Role Switcher */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => switchRole('placer')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeRole === 'placer'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              HospitalP (Placer)
            </button>
            <button
              onClick={() => switchRole('fulfiller')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeRole === 'fulfiller'
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              HospitalF (Fulfiller)
            </button>
          </div>

          {/* User & Auth */}
          <div className="flex items-center gap-4">
            {/* Reseed button — admin only */}
            {roles.includes('admin') && (
              <button
                onClick={handleReseed}
                disabled={reseedStatus === 'loading'}
                title="Delete all FHIR data and reload seed bundles"
                className={`btn-secondary text-xs ${reseedCls}`}
              >
                {reseedLabel}
              </button>
            )}

            {authenticated ? (
              <div className="flex items-center gap-3">
                <div
                  className="relative group cursor-default select-none text-right"
                  title={roles.join(', ') || 'no roles'}
                >
                  <p className="text-xs text-gray-500 leading-tight">Logged in as</p>
                  <p className="text-sm font-medium text-gray-900 leading-tight">{username}</p>
                  <div className="absolute right-0 top-full mt-1.5 hidden group-hover:block z-50 bg-gray-800 text-white text-xs rounded-md px-3 py-2 whitespace-nowrap shadow-lg">
                    <p className="font-medium mb-1 text-gray-300">Roles</p>
                    {roles.length > 0 ? roles.map((r) => (
                      <p key={r} className="font-mono">{r}</p>
                    )) : <p className="italic text-gray-400">no roles</p>}
                  </div>
                </div>
                <button onClick={logout} className="btn-secondary text-xs">
                  Logout
                </button>
              </div>
            ) : (
              <button onClick={login} className="btn-primary text-xs">
                Login
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
