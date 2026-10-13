/**
 * Browser entry point.
 * Mounts the router: /status is the diagnostics page, and every other path is the editor.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App'
import { AppShell } from './components/layout/AppShell'
import { StatusPage } from './pages/status/StatusPage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/status" element={<StatusPage />} />
          <Route path="*" element={<AppShell />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
