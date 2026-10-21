import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AgentDashboard from './pages/AgentDashboard';
import ChatWidget from './pages/ChatWidget';
import Login from './pages/Login';
import AgentManagement from './pages/AgentManagement';
import SetPassword from './pages/SetPassword';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/set-password" element={<SetPassword />} />
        <Route path="/agents" element={<AgentManagement />} />
        <Route path="/dashboard" element={<AgentDashboard />} />
        <Route path="/widget" element={<ChatWidget />} />
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </Router>
  );
}

export default App;
