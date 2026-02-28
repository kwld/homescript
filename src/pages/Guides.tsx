import { Shield, Zap, Server, Code } from "lucide-react";
import { Card } from "../components/ui/Card";

export default function Guides() {
  return (
    <div className="p-8 overflow-y-auto max-w-4xl mx-auto">
      <header className="mb-12 text-center">
        <h1 className="text-4xl font-semibold text-white mb-4">Setup Guides</h1>
        <p className="text-zinc-400 text-lg">Learn how to configure SSO and connect to your Home Assistant instance.</p>
      </header>

      <div className="space-y-12">
        {/* Authentik SSO */}
        <Card className="p-8 relative overflow-hidden rounded-3xl">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Shield className="w-32 h-32 text-indigo-500" />
          </div>
          <div className="relative z-10">
            <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
                <Shield className="w-5 h-5 text-indigo-400" />
              </div>
              Authentik SSO Integration
            </h2>
            
            <div className="prose prose-invert max-w-none">
              <p className="text-zinc-300 text-lg mb-6">
                Secure your Home Assistant Service using Authentik. This ensures only authorized users can manage scripts and service accounts.
              </p>
              
              <h3 className="text-xl font-medium text-white mt-8 mb-4">1. Create an Application in Authentik</h3>
              <ul className="list-disc list-inside space-y-2 text-zinc-400 ml-4 mb-6">
                <li>Go to your Authentik admin interface.</li>
                <li>Navigate to <strong>Applications</strong> &gt; <strong>Providers</strong>.</li>
                <li>Create a new <strong>OAuth2/OpenID Provider</strong>.</li>
                <li>Set the <strong>Redirect URI</strong> to <code className="bg-zinc-800 px-2 py-1 rounded text-sm text-indigo-300">https://your-app-url/api/auth/callback</code>.</li>
              </ul>

              <h3 className="text-xl font-medium text-white mt-8 mb-4">2. Configure Environment Variables</h3>
              <p className="text-zinc-400 mb-4">Add the following to your <code className="bg-zinc-800 px-2 py-1 rounded text-sm">.env</code> file:</p>
              <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm font-mono text-zinc-300 overflow-x-auto mb-6">
AUTHENTIK_CLIENT_ID="your-client-id"
AUTHENTIK_CLIENT_SECRET="your-client-secret"
AUTHENTIK_ISSUER="https://authentik.yourdomain.com/application/o/ha-service/"
SESSION_SECRET="a-long-random-string"
              </pre>
            </div>
          </div>
        </Card>

        {/* Home Assistant */}
        <Card className="p-8 relative overflow-hidden rounded-3xl">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Server className="w-32 h-32 text-emerald-500" />
          </div>
          <div className="relative z-10">
            <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                <Server className="w-5 h-5 text-emerald-400" />
              </div>
              Connecting to Home Assistant
            </h2>
            
            <div className="prose prose-invert max-w-none">
              <p className="text-zinc-300 text-lg mb-6">
                To allow HomeScripts to execute actions in Home Assistant, you need to provide a Long-Lived Access Token.
              </p>
              
              <h3 className="text-xl font-medium text-white mt-8 mb-4">1. Generate a Long-Lived Access Token</h3>
              <ul className="list-disc list-inside space-y-2 text-zinc-400 ml-4 mb-6">
                <li>Log in to your Home Assistant instance.</li>
                <li>Click on your profile picture in the bottom left.</li>
                <li>Scroll down to <strong>Long-Lived Access Tokens</strong>.</li>
                <li>Click <strong>Create Token</strong>, name it "HA Service", and copy the token.</li>
              </ul>

              <h3 className="text-xl font-medium text-white mt-8 mb-4">2. Configure Environment Variables</h3>
              <p className="text-zinc-400 mb-4">Add the following to your <code className="bg-zinc-800 px-2 py-1 rounded text-sm">.env</code> file:</p>
              <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm font-mono text-zinc-300 overflow-x-auto mb-6">
HA_URL="http://homeassistant.local:8123"
HA_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              </pre>
            </div>
          </div>
        </Card>

        {/* HomeScript Syntax */}
        <Card className="p-8 relative overflow-hidden rounded-3xl">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Code className="w-32 h-32 text-amber-500" />
          </div>
          <div className="relative z-10">
            <h2 className="text-2xl font-semibold text-white mb-6 flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
                <Code className="w-5 h-5 text-amber-400" />
              </div>
              HomeScript Syntax Guide
            </h2>
            
            <div className="prose prose-invert max-w-none">
              <p className="text-zinc-300 text-lg mb-6">
                HomeScript is a simple, COBOL-inspired language designed specifically for home automation tasks.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 className="text-lg font-medium text-white mb-2">Variables & Assignment</h4>
                  <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm font-mono text-amber-300 overflow-x-auto mb-6">
SET $temp = 25
SET $entity = "light.living_room"
PRINT $temp
                  </pre>
                </div>
                
                <div>
                  <h4 className="text-lg font-medium text-white mb-2">Conditionals</h4>
                  <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm font-mono text-amber-300 overflow-x-auto mb-6">
{`IF $temp > 20
  PRINT "It's warm"
ELSE
  PRINT "It's cold"
END_IF`}
                  </pre>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-white mb-2">Loops</h4>
                  <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm font-mono text-amber-300 overflow-x-auto mb-6">
{`SET $i = 0
WHILE $i < 5 DO
  PRINT $i
  SET $i = $i + 1
END_WHILE`}
                  </pre>
                </div>

                <div>
                  <h4 className="text-lg font-medium text-white mb-2">Home Assistant Calls</h4>
                  <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl text-sm font-mono text-amber-300 overflow-x-auto mb-6">
CALL homeassistant.turn_on("light.living_room")
CALL notify.mobile_app("Motion detected!")
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
