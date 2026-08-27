import { useEffect, useState } from "react";
import { Users, RefreshCw } from "lucide-react";
import { fetchAllProfiles, updateProfileRole, ROLES } from "../lib/auth";

export default function UserManagement({ currentUserId }) {
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    setError("");
    try {
      setProfiles(await fetchAllProfiles());
    } catch (e) {
      setError("No se pudo cargar la lista de usuarios.");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const changeRole = async (id, role) => {
    setSavingId(id);
    setError("");
    try {
      await updateProfileRole(id, role);
      setProfiles((prev) => prev.map((p) => (p.id === id ? { ...p, role } : p)));
    } catch (e) {
      setError("No se pudo actualizar el rol.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="pt-4 mt-2" style={{ borderTop: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between mb-2.5">
        <p style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide flex items-center gap-1.5">
          <Users size={13} /> Usuarios y roles
        </p>
        <button onClick={load} className="p-1 rounded-md" style={{ color: "var(--muted)" }} aria-label="Actualizar">
          <RefreshCw size={13} />
        </button>
      </div>

      <p style={{ color: "var(--muted)" }} className="text-[11px] mb-2.5">
        Para dar de alta una cuenta nueva, creala desde Supabase (Authentication → Users)
        con el email de la persona. Al iniciar sesión por primera vez va a aparecer acá
        con rol "usuario"; después podés subirla a "administrador".
      </p>

      {error && <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</p>}

      {!profiles ? (
        <p style={{ color: "var(--muted)" }} className="text-xs">Cargando…</p>
      ) : profiles.length === 0 ? (
        <p style={{ color: "var(--muted)" }} className="text-xs">Todavía no hay usuarios registrados.</p>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
          {profiles.map((p, i) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 px-3 py-2.5"
              style={{ background: "var(--surface)", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}
            >
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{p.email}</p>
                {p.id === currentUserId && (
                  <p style={{ color: "var(--muted)" }} className="text-[10px]">Vos</p>
                )}
              </div>
              <select
                value={p.role}
                disabled={savingId === p.id || p.id === currentUserId}
                onChange={(e) => changeRole(p.id, e.target.value)}
                className="text-xs rounded-lg px-2 py-1.5 outline-none disabled:opacity-50"
                style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}
              >
                <option value={ROLES.USUARIO}>Usuario</option>
                <option value={ROLES.ADMIN}>Administrador</option>
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
