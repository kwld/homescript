import { useState, useEffect } from "react";
import { FileCode2, Plus, Trash2, Edit3, Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardFooter } from "../components/ui/Card";

interface Script {
  id: string;
  name: string;
  endpoint: string;
  created_at: string;
}

export default function Scripts() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const navigate = useNavigate();

  const fetchScripts = async () => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch("/api/scripts", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setScripts(await res.json());
  };

  useEffect(() => {
    fetchScripts();
  }, []);

  const handleDelete = async (id: string) => {
    const token = localStorage.getItem("auth_token");
    const res = await fetch(`/api/scripts/${id}`, { 
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      setDeletingId(null);
      fetchScripts();
    }
  };

  return (
    <div className="p-8 overflow-y-auto">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white mb-2">HomeScripts</h1>
          <p className="text-zinc-400">Manage and create custom automation scripts.</p>
        </div>
        <Button
          onClick={() => navigate("/scripts/new")}
          className="flex items-center gap-2"
        >
          <Plus className="w-5 h-5" />
          New Script
        </Button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {scripts.length === 0 ? (
          <Card className="col-span-full p-12 text-center">
            <FileCode2 className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-white mb-2">No scripts yet</h2>
            <p className="text-zinc-400 mb-6">Create your first HomeScript to automate your home.</p>
            <Button
              onClick={() => navigate("/scripts/new")}
              className="inline-flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create Script
            </Button>
          </Card>
        ) : (
          scripts.map((script) => (
            <Card key={script.id} className="flex flex-col group hover:border-emerald-500/50 transition-colors">
              <CardContent className="flex-1">
                <div className="flex items-center justify-between mb-4">
                  <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                    <FileCode2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex items-center gap-2">
                    {deletingId === script.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-400">Sure?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDelete(script.id)}
                        >
                          Yes
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingId(null)}
                        >
                          No
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/scripts/${script.id}`)}
                        >
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:text-red-400"
                          onClick={() => setDeletingId(script.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <h3 className="text-lg font-medium text-white mb-1">{script.name}</h3>
                <div className="text-sm text-zinc-400 mb-4 font-mono truncate">
                  /api/run/{script.endpoint}
                </div>
              </CardContent>
              <CardFooter className="bg-zinc-950 justify-between">
                <span className="text-xs text-zinc-500">
                  {new Date(script.created_at).toLocaleDateString()}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                  onClick={() => navigate(`/scripts/${script.id}`)}
                >
                  <Play className="w-4 h-4" />
                  Edit & Run
                </Button>
              </CardFooter>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
