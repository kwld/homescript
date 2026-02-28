import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { Home, Key, FileCode2, BookOpen, LogOut, Shield, Menu, X, Box, Settings } from "lucide-react";
import Dashboard from "./pages/Dashboard";
import ServiceAccounts from "./pages/ServiceAccounts";
import Scripts from "./pages/Scripts";
import ScriptEditor from "./pages/ScriptEditor";
import Guides from "./pages/Guides";
import Entities from "./pages/Entities";
import HASettingsModal from "./components/HASettingsModal";
import { Button } from "./components/ui/Button";

function Layout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ name: string } | null>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    const initAuth = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        if (token) {
          const res = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.name) {
              setUser(data);
              setIsInitializing(false);
              return;
            }
          }
        }

        // If no valid token, check if mock is enabled
        const configRes = await fetch("/api/config");
        if (configRes.ok) {
          const config = await configRes.json();
          localStorage.setItem("is_mock", config.mock ? "true" : "false");
          if (config.mock) {
            localStorage.setItem("auth_token", "mock-admin-token");
            setUser({ name: "Administrator" });
          }
        }
      } catch (e) {
        console.error("Auth initialization failed", e);
      } finally {
        setIsInitializing(false);
      }
    };

    initAuth();
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location]);

  const handleLogin = async () => {
    try {
      const response = await fetch(`/api/auth/url`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to get auth URL');
      }
      const { url } = await response.json();

      const authWindow = window.open(
        url,
        'oauth_popup',
        'width=600,height=700'
      );

      if (!authWindow) {
        setLoginError('Please allow popups for this site to connect your account.');
      }
    } catch (error: any) {
      console.error('OAuth error:', error);
      setLoginError(`Login failed: ${error.message}`);
    }
  };

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Validate origin is from AI Studio preview, localhost, or local network
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && !origin.includes('.local')) {
        return;
      }
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        localStorage.setItem("auth_token", event.data.token);
        setUser(event.data.user);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("auth_token");
    setUser(null);
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-100">
        <div className="animate-pulse flex flex-col items-center">
          <Shield className="w-12 h-12 text-indigo-500 mb-4 opacity-50" />
          <div className="text-zinc-500 font-medium">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-zinc-100 p-4">
        <div className="bg-zinc-900 p-8 rounded-2xl border border-zinc-800 max-w-md w-full text-center">
          <Shield className="w-16 h-16 mx-auto mb-6 text-indigo-500" />
          <h1 className="text-2xl font-semibold mb-2">Home Assistant Service</h1>
          <p className="text-zinc-400 mb-8">Login via Authentik SSO to manage your services and scripts.</p>
          
          {loginError && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              {loginError}
            </div>
          )}

          <Button
            onClick={handleLogin}
            className="w-full bg-indigo-600 hover:bg-indigo-500"
          >
            Login with Authentik
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2">
          <Shield className="text-indigo-500 w-6 h-6" />
          <span className="font-semibold">HA Service</span>
        </div>
        <Button 
          variant="ghost"
          size="icon"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <X /> : <Menu />}
        </Button>
      </div>

      {/* Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col
        transform transition-transform duration-200 ease-in-out
        md:relative md:translate-x-0
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 border-b border-zinc-800 hidden md:block">
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Shield className="text-indigo-500" />
            HA Service
          </h1>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <Link to="/" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Home className="w-5 h-5 text-zinc-400" />
            Dashboard
          </Link>
          <Link to="/accounts" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Key className="w-5 h-5 text-zinc-400" />
            Service Accounts
          </Link>
          <Link to="/scripts" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <FileCode2 className="w-5 h-5 text-zinc-400" />
            HomeScripts
          </Link>
          <Link to="/entities" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <Box className="w-5 h-5 text-zinc-400" />
            Entities & Devices
          </Link>
          <Link to="/guides" className="flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-zinc-800 transition-colors">
            <BookOpen className="w-5 h-5 text-zinc-400" />
            Setup Guides
          </Link>
        </nav>
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center justify-between px-4 py-3 bg-zinc-950 rounded-xl border border-zinc-800">
            <span className="text-sm font-medium truncate max-w-[120px]">{user.name}</span>
            <div className="flex items-center gap-2">
              {localStorage.getItem("is_mock") === "true" && (
                <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)}>
                  <Settings className="w-5 h-5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="hover:text-red-400" onClick={handleLogout}>
                <LogOut className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden h-[calc(100vh-65px)] md:h-screen">
        {children}
      </main>
      <HASettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<ServiceAccounts />} />
          <Route path="/scripts" element={<Scripts />} />
          <Route path="/scripts/new" element={<ScriptEditor />} />
          <Route path="/scripts/:id" element={<ScriptEditor />} />
          <Route path="/entities" element={<Entities />} />
          <Route path="/guides" element={<Guides />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
