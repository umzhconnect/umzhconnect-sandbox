import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useRole } from '../../contexts/RoleContext';

type ReseedStatus = 'idle' | 'loading' | 'success' | 'error';

const Header: React.FC = () => {
  const { authenticated, username, login, logout } = useAuth();
  const { activeRole, switchRole, partyLabel } = useRole();

  const [reseedStatus, setReseedStatus] = useState<ReseedStatus>('idle');

  const handleReseed = async () => {
    if (reseedStatus === 'loading') return;
    setReseedStatus('loading');
    try {
      const res = await fetch('http://localhost:9001/reseed', { method: 'POST' });
      const json = await res.json();
      setReseedStatus(json.success ? 'success' : 'error');
    } catch {
      setReseedStatus('error');
    }
    // Reset to idle after 3 s
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
            {/* Reseed button */}
            <button
              onClick={handleReseed}
              disabled={reseedStatus === 'loading'}
              title="Delete all FHIR data and reload seed bundles"
              className={`btn-secondary text-xs ${reseedCls}`}
            >
              {reseedLabel}
            </button>

            <div
              className={`text-xs px-3 py-1 rounded-full font-medium ${
                activeRole === 'placer'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-green-100 text-green-800'
              }`}
            >
              {partyLabel}
            </div>
            {authenticated ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">{username}</span>
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
