import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { HostControlPage } from './pages/HostControlPage';
import { LandingPage } from './pages/LandingPage';
import { MainScreenPage } from './pages/MainScreenPage';
import { PlayerMobilePage } from './pages/PlayerMobilePage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/host" element={<HostControlPage />} />
        <Route path="/host/:code" element={<HostControlPage />} />
        <Route path="/screen" element={<MainScreenPage />} />
        <Route path="/screen/:code" element={<MainScreenPage />} />
        <Route path="/play" element={<PlayerMobilePage />} />
        <Route path="/play/:code" element={<PlayerMobilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
