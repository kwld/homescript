import { Shield, Key, FileCode2, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "../components/ui/Card";

export default function Dashboard() {
  return (
    <div className="p-8 overflow-y-auto">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-white mb-2">Dashboard</h1>
        <p className="text-zinc-400">Manage your Home Assistant services and scripts.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        <Link to="/accounts" className="group">
          <Card className="p-6 hover:border-indigo-500 transition-colors h-full">
            <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-indigo-500/20 transition-colors">
              <Key className="w-6 h-6 text-indigo-400" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">Service Accounts</h2>
            <p className="text-zinc-400 text-sm">Manage API keys for external services to access your HomeScript endpoints.</p>
          </Card>
        </Link>
        
        <Link to="/scripts" className="group">
          <Card className="p-6 hover:border-emerald-500 transition-colors h-full">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
              <FileCode2 className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">HomeScripts</h2>
            <p className="text-zinc-400 text-sm">Write custom automation scripts in our simple COBOL-like language.</p>
          </Card>
        </Link>

        <Link to="/guides" className="group">
          <Card className="p-6 hover:border-amber-500 transition-colors h-full">
            <div className="w-12 h-12 bg-amber-500/10 rounded-xl flex items-center justify-center mb-4 group-hover:bg-amber-500/20 transition-colors">
              <Zap className="w-6 h-6 text-amber-400" />
            </div>
            <h2 className="text-xl font-medium text-white mb-2">Setup Guides</h2>
            <p className="text-zinc-400 text-sm">Learn how to configure Authentik SSO and connect to Home Assistant.</p>
          </Card>
        </Link>
      </div>

      <Card className="p-8">
        <h2 className="text-xl font-semibold text-white mb-4">Quick Start</h2>
        <ol className="list-decimal list-inside space-y-4 text-zinc-300">
          <li>Go to <Link to="/accounts" className="text-indigo-400 hover:underline">Service Accounts</Link> and create a new API key.</li>
          <li>Navigate to <Link to="/scripts" className="text-emerald-400 hover:underline">HomeScripts</Link> and write your first automation.</li>
          <li>Call your script endpoint with <code className="bg-zinc-800 px-2 py-1 rounded text-sm">X-Service-Id</code> and <code className="bg-zinc-800 px-2 py-1 rounded text-sm">X-Service-Secret</code> headers.</li>
        </ol>
      </Card>
    </div>
  );
}
