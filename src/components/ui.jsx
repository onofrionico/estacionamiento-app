import { fmtMoney } from "../lib/format";

export function SectionTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 mt-1">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
        <Icon size={17} style={{ color: "var(--accent)" }} />
      </div>
      <div>
        <h2 style={{ fontFamily: "var(--font-display)" }} className="font-bold text-base leading-tight">{title}</h2>
        {subtitle && <p style={{ color: "var(--muted)" }} className="text-xs">{subtitle}</p>}
      </div>
    </div>
  );
}

export function StatCard({ label, value, color }) {
  return (
    <div className="rounded-xl py-3.5 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div style={{ fontFamily: "var(--font-display)", color }} className="text-xl font-bold">{value}</div>
      <div style={{ color: "var(--muted)" }} className="text-[10px] uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

export function CorteCard({ label, value }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p style={{ color: "var(--muted)" }} className="text-[10px] uppercase tracking-wide mb-1">{label}</p>
      <p style={{ fontFamily: "var(--font-display)" }} className="text-lg font-bold">{fmtMoney(value)}</p>
    </div>
  );
}

export function ChartCard({ title, children }) {
  return (
    <div className="rounded-xl p-3.5 mb-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <p style={{ color: "var(--muted)" }} className="text-xs font-semibold mb-1">{title}</p>
      {children}
    </div>
  );
}

export function EmptyState({ Icon, text }) {
  return (
    <div className="rounded-xl py-10 flex flex-col items-center text-center px-6" style={{ background: "var(--surface)", border: "1px dashed var(--border)" }}>
      <Icon size={28} style={{ color: "var(--muted)" }} className="mb-2.5" />
      <p style={{ color: "var(--muted)" }} className="text-sm">{text}</p>
    </div>
  );
}

export function ConfigField({ label, children }) {
  return (
    <div>
      <label style={{ color: "var(--muted)" }} className="text-xs font-medium uppercase tracking-wide mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

export function RateField({ label, value, onChange, suffix = "$" }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <label style={{ color: "var(--muted)" }} className="text-[10px] block mb-0.5">{label}</label>
      <div className="flex items-center gap-1">
        {suffix === "$" && <span style={{ color: "var(--muted)" }} className="text-xs">$</span>}
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent outline-none text-sm font-semibold"
          style={{ color: "var(--text)", fontFamily: "var(--font-display)" }}
        />
        {suffix !== "$" && <span style={{ color: "var(--muted)" }} className="text-xs">{suffix}</span>}
      </div>
    </div>
  );
}
