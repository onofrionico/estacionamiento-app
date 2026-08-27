import { useState } from "react";
import { LogIn, ParkingSquare, AlertTriangle } from "lucide-react";
import { signIn } from "../lib/auth";
import RootStyles from "./RootStyles";

export default function LoginScreen({ nombre }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError("Email o contraseña incorrectos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--bg)", color: "var(--text)" }} className="min-h-screen flex items-center justify-center px-4">
      <RootStyles />
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <ParkingSquare size={36} style={{ color: "var(--accent)" }} className="mb-2.5" />
          <h1 style={{ fontFamily: "var(--font-display)" }} className="text-lg font-bold">{nombre || "Mi Estacionamiento"}</h1>
          <p style={{ color: "var(--muted)" }} className="text-xs mt-0.5">Iniciá sesión para continuar</p>
        </div>

        <form onSubmit={submit} className="rounded-xl p-4 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div>
            <label style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-1.5 block">Email</label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder="tu@email.com"
            />
          </div>
          <div>
            <label style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-1.5 block">Contraseña</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--danger)" }}>
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: "var(--accent)", color: "#1A1300" }}
          >
            <LogIn size={16} /> {loading ? "Ingresando…" : "Ingresar"}
          </button>
        </form>

        <p style={{ color: "var(--muted)" }} className="text-[11px] text-center mt-4">
          ¿No tenés cuenta? Pedile a un administrador que te la cree.
        </p>
      </div>
    </div>
  );
}
