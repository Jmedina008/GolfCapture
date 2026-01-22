import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import CaptureForm from './components/CaptureForm';
import AdminDashboard from './components/AdminDashboard';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CaptureForm />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
