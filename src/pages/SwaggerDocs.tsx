import { useEffect, useState } from "react";

export default function SwaggerDocs() {
  const [html, setHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (!token) {
      setError("Missing auth token.");
      return;
    }

    fetch("/api/docs/scripts/frame", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(body || `HTTP ${res.status}`);
        }
        return res.text();
      })
      .then((doc) => {
        setHtml(doc);
        setError(null);
      })
      .catch((e: any) => {
        setError(e?.message || "Failed to load Swagger UI");
      });
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-950 text-zinc-100 min-h-0">
      <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
        <h1 className="text-2xl font-semibold">HomeScripts API</h1>
        <p className="text-zinc-400 mt-1">Swagger generated dynamically from current script definitions.</p>
      </div>
      {error ? (
        <div className="m-4 rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-300">{error}</div>
      ) : (
        <div className="flex-1 p-4 min-h-0">
          <iframe
            title="Swagger UI"
            srcDoc={html}
            className="w-full h-full border border-zinc-800 rounded-xl bg-zinc-950"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      )}
    </div>
  );
}
