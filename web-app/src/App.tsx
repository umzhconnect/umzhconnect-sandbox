import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Header from './components/layout/Header';
import Sidebar from './components/layout/Sidebar';
import ProtocolLogPanel from './components/layout/ProtocolLogPanel';
import Dashboard from './pages/Dashboard';
import ResourcesPage from './pages/ResourcesPage';
import TasksPage from './pages/TasksPage';
import CredentialsPage from './pages/CredentialsPage';
import { useRole } from './contexts/RoleContext';

const App: React.FC = () => {
  const { activeRole } = useRole();

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 p-6 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/resources" element={<ResourcesPage key={activeRole} />} />
            <Route path="/tasks" element={<TasksPage key={activeRole} />} />
            <Route path="/credentials" element={<CredentialsPage />} />
          </Routes>
        </main>
        <ProtocolLogPanel />
      </div>
    </div>
  );
};

export default App;
