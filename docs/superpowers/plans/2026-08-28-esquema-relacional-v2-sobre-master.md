# Esquema Relacional sobre master (con Auth y tarifas por tipo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el blob JSON único en `kv_store` por un esquema relacional (`vehicles` + `config`) para arreglar el pisado de datos entre dispositivos — igual que en `docs/superpowers/specs/2026-08-28-esquema-relacional-design.md` — pero implementado sobre el `master` real del repo, que ya tiene autenticación (Supabase Auth + roles admin/usuario) y tarifas por tipo de vehículo que la rama anterior (`mejoras-plataforma`) nunca tuvo.

**Por qué esta rama nueva:** el trabajo original de este mismo día se hizo sobre la rama `mejoras-plataforma`, que se había separado de `master` en el commit `250f600` y nunca se enteró de lo que pasó después: `master` agregó autenticación real (`src/lib/auth.js`, `src/components/LoginScreen.jsx`, `src/components/UserManagement.jsx`, tabla `profiles` con RLS), tarifas por tipo de vehículo (`DEFAULT_CONFIG.rates` pasó de plano a `{ auto, moto, camioneta }`), mejoras de reportes y un servicio de staging — pero **nunca resolvió el bug original**: `src/storage.js` en `master` sigue siendo el mismo blob `kv_store` con `get(key)/set(key,value)`. Esta rama (`persistencia-relacional`, creada desde `origin/master`) rehace el arreglo relacional sobre el código real.

**Architecture:** Igual que el diseño original — `vehicles` (una fila por vehículo) + `config` (una fila singleton) en vez de un blob JSON, con `storage.js` exponiendo operaciones por fila y Supabase Realtime para sincronizar dispositivos. La diferencia con el diseño original: las políticas RLS quedan restringidas a `auth.role() = 'authenticated'` (no `anon`), igual que ya está `kv_store` en `master`, y se preserva intacta la sección de `profiles`/roles del `schema.sql`. `App.jsx` conserva todo el flujo de sesión/login/roles de `master` tal cual — solo se reemplaza el bloque `data`/`persist` (blob completo) por `vehicles`/`config` separados + updates optimistas + realtime.

**Tech Stack:** React 18 + Vite, `@supabase/supabase-js`, Supabase Auth, Postgres (Supabase). Sin test framework — se verifica con `npm run build` + prueba manual.

**Base real de este plan:** rama `persistencia-relacional`, creada desde `origin/master` (commit `2443348`). Las credenciales de Supabase para desarrollo local ya están en `.env` (proyecto real del usuario, con datos reales migrados a mano por el usuario en una corrida anterior de `supabase/migrate_kv_to_relational.sql` — antes de que existiera esta versión adaptada del script; los datos reales viven en `vehicles`/`config` de ese proyecto y hay que confirmarlos, no volver a migrar).

---

## Contexto de archivos en `master` (leídos antes de planificar)

- `src/App.jsx` (287 líneas) — tiene: chequeo de sesión (`supabase.auth.getSession`/`onAuthStateChange`), fetch de `profile` vía `fetchProfile`, gate de tabs por rol (`TABS_POR_ROL`), y el bloque viejo `data`/`persist` sobre `storage.get(STORAGE_KEY)`/`storage.set(STORAGE_KEY, ...)`. `registrarSalida` ya selecciona `data.config.rates[v.tipo] || data.config.rates.auto` antes de llamar `calcularMonto`.
- `src/storage.js` — interfaz vieja `{ get(key), set(key,value), delete(key) }` sobre `kv_store`, sin cambios respecto a antes de la rama `mejoras-plataforma`.
- `src/constants.js` — `DEFAULT_CONFIG.rates` YA tiene la forma `{ auto: {...}, moto: {...}, camioneta: {...} }` (no plana). Sigue exportando `STORAGE_KEY` y `DEFAULT_DATA`, usados solo por `App.jsx`.
- `src/lib/auth.js`, `src/components/LoginScreen.jsx`, `src/components/UserManagement.jsx`, `src/components/ConfigTab.jsx`, `src/components/Nav.jsx` — **no se tocan en este plan**. `ConfigTab` ya tiene selector de tipo de vehículo y le pasa `config` completo a `onSave` tal cual antes; `Nav.jsx` ya recibe `userEmail`/`onLogout`/`role`.
- `supabase/schema.sql` — crea `kv_store` con RLS restringido a `authenticated` (`revoke all ... from anon`), más una sección completa de `profiles`/roles (trigger `handle_new_user`, función `is_admin()`, policies). La sección de roles **se preserva intacta**, solo se reemplaza el bloque de `kv_store` por `vehicles`+`config`.
- El proyecto Supabase real del usuario (credenciales en `.env`) ya tiene la tabla `profiles` aplicada (confirmado: `GET /rest/v1/profiles` con la anon key da 401 "permission denied", consistente con el grant solo a `authenticated`) y ya tiene `vehicles`/`config` con datos reales migrados a mano — no hay que volver a correr la migración en ese proyecto, solo confirmarla.

---

# Task 1: Esquema SQL nuevo (`supabase/schema.sql`), auth-aware

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Paso 1:** Reemplazar el contenido completo de `supabase/schema.sql` por:

```sql
-- Ejecutar una sola vez en el SQL editor de Supabase al crear un proyecto
-- nuevo (este repo no tiene un runner de migraciones automatizado). Ver
-- docs/superpowers/specs/2026-08-28-esquema-relacional-design.md.
--
-- Si ya tenías un proyecto con la tabla kv_store (esquema anterior) y datos
-- reales cargados, NO corras el bloque de vehicles/config de abajo tal
-- cual para migrar: usá supabase/migrate_kv_to_relational.sql en su lugar,
-- que crea las mismas tablas y además migra los datos existentes. La
-- sección de "Roles y permisos" de este archivo es la misma en ambos casos
-- (si ya la corriste una vez, no hace falta repetirla).

create table vehicles (
  id text primary key,
  patente text not null,
  tipo text not null,
  hora_ingreso timestamptz not null,
  hora_salida timestamptz,
  monto numeric,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now()
);

-- Impide que dos dispositivos registren la misma patente "dentro" a la vez.
create unique index vehicles_patente_dentro_uk
  on vehicles (patente) where estado = 'dentro';

create table config (
  id int primary key default 1,
  total_espacios int not null,
  rates jsonb not null,
  umbrales jsonb not null,
  updated_at timestamptz not null default now(),
  check (id = 1)
);

alter table vehicles enable row level security;
alter table config enable row level security;

grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.config to authenticated;
revoke all on public.vehicles from anon;
revoke all on public.config from anon;

drop policy if exists "allow authenticated read/write vehicles" on vehicles;
create policy "allow authenticated read/write vehicles"
  on vehicles for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "allow authenticated read/write config" on config;
create policy "allow authenticated read/write config"
  on config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Habilita eventos de tiempo real (INSERT/UPDATE/DELETE) para que la app
-- sincronice cambios entre dispositivos sin recargar.
alter publication supabase_realtime add table vehicles, config;

-- Necesario para que los eventos DELETE de Realtime incluyan la fila
-- completa (por defecto Postgres solo manda la primary key en el DELETE).
alter table vehicles replica identity full;
alter table config replica identity full;

-- ---------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------
-- Ejecutar esta sección una sola vez (agregada en una fase posterior a la
-- creación inicial de kv_store, ver arriba). Requiere que el proveedor de
-- autenticación "Email" esté habilitado en Authentication > Providers.
--
-- Cada fila de auth.users obtiene automáticamente una fila en
-- public.profiles con role='usuario' (via trigger). Para promover a alguien
-- a administrador, correr a mano:
--   update public.profiles set role = 'admin' where email = 'tu-mail@ejemplo.com';

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'usuario' check (role in ('admin', 'usuario')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Función helper "security definer": corre con privilegios del dueño
-- (postgres), que no está sujeto a RLS, así que evita la recursión infinita
-- que se produce si una policy de profiles vuelve a consultar profiles
-- directamente (error 42P17).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

grant execute on function public.is_admin() to authenticated;

drop policy if exists "profiles: select own or admin" on public.profiles;
create policy "profiles: select own or admin"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles: admin updates role" on public.profiles;
create policy "profiles: admin updates role"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

grant select, update on public.profiles to authenticated;

-- Crea el perfil automáticamente cuando se registra un usuario nuevo
-- (signup o alta manual desde Authentication > Users en el dashboard).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

Nota: la sección "Roles y permisos" es EXACTAMENTE la misma que ya existe en `master` — no se modifica ni una línea, solo se reemplaza el bloque de `kv_store` que estaba antes por el de `vehicles`+`config`.

- [ ] **Paso 2:** Commit:

```bash
git add supabase/schema.sql
git commit -m "feat: esquema relacional vehicles+config con RLS authenticated, reemplaza kv_store"
```

---

# Task 2: Script de migración (`supabase/migrate_kv_to_relational.sql`), auth-aware

**Files:**
- Create: `supabase/migrate_kv_to_relational.sql`

- [ ] **Paso 1:** Crear `supabase/migrate_kv_to_relational.sql`:

```sql
-- Correr UNA SOLA VEZ en el SQL editor de Supabase, en proyectos que ya
-- tenían el esquema anterior (tabla kv_store con un blob JSON bajo la key
-- "estacionamiento-datos") Y ya tienen la sección de Roles y permisos de
-- supabase/schema.sql aplicada (tabla profiles, etc. — este script no la
-- toca). Crea el esquema relacional nuevo (vehicles + config) y migra los
-- datos existentes. Ver docs/superpowers/specs/2026-08-28-esquema-relacional-design.md.
--
-- Para proyectos nuevos sin datos previos, usá supabase/schema.sql en vez
-- de este archivo.

create table vehicles (
  id text primary key,
  patente text not null,
  tipo text not null,
  hora_ingreso timestamptz not null,
  hora_salida timestamptz,
  monto numeric,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now()
);

create unique index vehicles_patente_dentro_uk
  on vehicles (patente) where estado = 'dentro';

create table config (
  id int primary key default 1,
  total_espacios int not null,
  rates jsonb not null,
  umbrales jsonb not null,
  updated_at timestamptz not null default now(),
  check (id = 1)
);

alter table vehicles enable row level security;
alter table config enable row level security;

grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.config to authenticated;
revoke all on public.vehicles from anon;
revoke all on public.config from anon;

create policy "allow authenticated read/write vehicles"
  on vehicles for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "allow authenticated read/write config"
  on config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter publication supabase_realtime add table vehicles, config;

alter table vehicles replica identity full;
alter table config replica identity full;

-- Migra la fila única de kv_store al esquema nuevo. Funciona sin cambios
-- tanto si config.rates ya está en formato por tipo ({auto:{...}, ...})
-- como en el formato plano viejo, porque la columna destino es jsonb y
-- guarda la forma que tenga el blob tal cual — la normalización a formato
-- por tipo la hace App.jsx en tiempo de lectura (ver Task 5).
insert into config (id, total_espacios, rates, umbrales)
select 1, (v->'config'->>'totalEspacios')::int, v->'config'->'rates', v->'config'->'umbrales'
from (select value::jsonb as v from kv_store where key = 'estacionamiento-datos') s;

insert into vehicles (id, patente, tipo, hora_ingreso, hora_salida, monto, estado)
select
  e->>'id', e->>'patente', e->>'tipo',
  to_timestamp((e->>'horaIngreso')::bigint / 1000.0),
  case when e->>'horaSalida' is not null then to_timestamp((e->>'horaSalida')::bigint / 1000.0) end,
  (e->>'monto')::numeric, e->>'estado'
from (select value::jsonb as v from kv_store where key = 'estacionamiento-datos') s,
     jsonb_array_elements(s.v->'vehicles') e;

-- Verificá los conteos antes de seguir:
--   select count(*) from vehicles;
--   select * from config;
--
-- Recién cuando confirmes que está todo bien, borrá el kv_store viejo a mano:
--   drop table kv_store;
```

- [ ] **Paso 2:** Commit:

```bash
git add supabase/migrate_kv_to_relational.sql
git commit -m "feat: script de migracion de kv_store al esquema relacional (auth-aware)"
```

---

# Task 3: Reescribir `src/storage.js`

**Files:**
- Modify: `src/storage.js`

- [ ] **Paso 1:** Reemplazar el contenido completo de `src/storage.js` por:

```js
/**
 * Capa de almacenamiento sobre Supabase (tablas vehicles + config).
 * Traduce entre las filas de Postgres (snake_case, timestamptz) y los
 * objetos que usa la UI (camelCase, timestamps numéricos en ms). El cliente
 * de Supabase ya adjunta el JWT de la sesión activa en cada request, así
 * que las policies RLS "authenticated" del esquema se aplican solas — este
 * archivo no necesita saber nada de sesión/auth.
 */
import { supabase } from "./supabaseClient";

function vehicleFromRow(row) {
  return {
    id: row.id,
    patente: row.patente,
    tipo: row.tipo,
    horaIngreso: new Date(row.hora_ingreso).getTime(),
    horaSalida: row.hora_salida ? new Date(row.hora_salida).getTime() : null,
    monto: row.monto === null ? null : Number(row.monto),
    estado: row.estado,
  };
}

function vehicleToRow(vehicle) {
  return {
    id: vehicle.id,
    patente: vehicle.patente,
    tipo: vehicle.tipo,
    hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
    hora_salida: vehicle.horaSalida ? new Date(vehicle.horaSalida).toISOString() : null,
    monto: vehicle.monto,
    estado: vehicle.estado,
  };
}

function vehiclePatchToRow(patch) {
  const row = {};
  if ("horaSalida" in patch) {
    row.hora_salida = patch.horaSalida ? new Date(patch.horaSalida).toISOString() : null;
  }
  if ("monto" in patch) row.monto = patch.monto;
  if ("estado" in patch) row.estado = patch.estado;
  return row;
}

function configFromRow(row) {
  return { totalEspacios: row.total_espacios, rates: row.rates, umbrales: row.umbrales };
}

function configToRow(config) {
  return { id: 1, total_espacios: config.totalEspacios, rates: config.rates, umbrales: config.umbrales };
}

export const storage = {
  async getVehicles() {
    const { data, error } = await supabase
      .from("vehicles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(vehicleFromRow);
  },

  async insertVehicle(vehicle) {
    const { error } = await supabase.from("vehicles").insert(vehicleToRow(vehicle));
    if (error) {
      if (error.code === "23505") {
        const dupError = new Error(`${vehicle.patente} ya está registrado dentro`);
        dupError.code = "DUPLICATE_PATENTE";
        throw dupError;
      }
      throw error;
    }
    return vehicle;
  },

  async updateVehicle(id, patch) {
    const { error } = await supabase.from("vehicles").update(vehiclePatchToRow(patch)).eq("id", id);
    if (error) throw error;
  },

  async deleteAllVehicles() {
    const { error } = await supabase.from("vehicles").delete().neq("id", "");
    if (error) throw error;
  },

  async getConfig() {
    const { data, error } = await supabase.from("config").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data ? configFromRow(data) : null;
  },

  async setConfig(config) {
    const { error } = await supabase.from("config").upsert(configToRow(config));
    if (error) throw error;
  },

  subscribeToChanges({ onVehicleChange, onConfigChange }) {
    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: vehicleFromRow(payload.old) });
        } else {
          onVehicleChange({ eventType: payload.eventType, vehicle: vehicleFromRow(payload.new) });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, (payload) => {
        if (payload.eventType !== "DELETE") {
          onConfigChange(configFromRow(payload.new));
        }
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};
```

- [ ] **Paso 2:** `npm run build` — puede fallar por referencias viejas en `App.jsx`/`constants.js` (`storage.get`, `STORAGE_KEY`, `DEFAULT_DATA`); confirmar que el error (si lo hay) es solo eso, no un problema de `storage.js`.
- [ ] **Paso 3:** Commit (solo `src/storage.js`):

```bash
git add src/storage.js
git commit -m "feat: storage.js con operaciones de dominio sobre vehicles+config"
```

---

# Task 4: Limpiar `src/constants.js`

**Files:**
- Modify: `src/constants.js`

- [ ] **Paso 1:** En `src/constants.js`, quitar únicamente las líneas de `STORAGE_KEY` y `DEFAULT_DATA` (ya no se usan). El resto del archivo (incluyendo `DEFAULT_CONFIG` con tarifas por tipo y `TIPOS`) queda exactamente igual. El archivo debe quedar así:

```js
import { Car, Bike, Truck } from "lucide-react";

export const DEFAULT_CONFIG = {
  nombre: "Mi Estacionamiento",
  totalEspacios: 40,
  rates: {
    auto: {
      mediaHora: 1500,
      hora: 2500,
      mediaEstadia: 8000,
      estadiaCompleta: 14000,
      semanal: 70000,
      mensual: 220000,
    },
    moto: {
      mediaHora: 800,
      hora: 1300,
      mediaEstadia: 4500,
      estadiaCompleta: 8000,
      semanal: 40000,
      mensual: 130000,
    },
    camioneta: {
      mediaHora: 2000,
      hora: 3200,
      mediaEstadia: 10500,
      estadiaCompleta: 18000,
      semanal: 90000,
      mensual: 280000,
    },
  },
  umbrales: {
    mediaEstadiaHoras: 6,
    estadiaCompletaHoras: 24,
  },
};

export const TIPOS = [
  { id: "auto", label: "Auto", Icon: Car },
  { id: "moto", label: "Moto", Icon: Bike },
  { id: "camioneta", label: "Camioneta", Icon: Truck },
];
```

- [ ] **Paso 2:** Commit:

```bash
git add src/constants.js
git commit -m "refactor: quitar STORAGE_KEY y DEFAULT_DATA de constants.js"
```

---

# Task 5: Reescribir `src/App.jsx` (preservando sesión/roles)

**Files:**
- Modify: `src/App.jsx`

- [ ] **Paso 1:** Reemplazar el contenido completo de `src/App.jsx` por:

```jsx
import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import {
  AlertTriangle, ParkingSquare
} from "lucide-react";
import { storage } from "./storage";
import { supabase } from "./supabaseClient";
import { DEFAULT_CONFIG, TIPOS } from "./constants";
import {
  fmtMoney, calcularMonto,
} from "./lib/format";
import { signOut, fetchProfile, TABS_POR_ROL, ROLES } from "./lib/auth";
import RootStyles from "./components/RootStyles";
import { TopBar, BottomNav } from "./components/Nav";
import LoginScreen from "./components/LoginScreen";

const EntradaTab = lazy(() => import("./components/EntradaTab"));
const SalidaTab = lazy(() => import("./components/SalidaTab"));
const EstadoTab = lazy(() => import("./components/EstadoTab"));
const ReportesTab = lazy(() => import("./components/ReportesTab"));
const ConfigTab = lazy(() => import("./components/ConfigTab"));

/** Combina la config guardada con los defaults, tarifa por tipo incluida. */
function mergeConfig(config) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    rates: TIPOS.reduce((acc, { id }) => {
      acc[id] = { ...DEFAULT_CONFIG.rates[id], ...(config?.rates?.[id] || {}) };
      return acc;
    }, {}),
    umbrales: { ...DEFAULT_CONFIG.umbrales, ...(config?.umbrales || {}) },
  };
}

function LoadingScreen({ text }) {
  return (
    <div style={{ background: "var(--bg)" }} className="min-h-screen flex items-center justify-center">
      <RootStyles />
      <div className="text-center">
        <ParkingSquare className="animate-pulse mx-auto mb-3" size={40} style={{ color: "var(--accent)" }} />
        <p style={{ color: "var(--muted)" }} className="text-sm">{text}</p>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = todavía no se chequeó
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [vehicles, setVehicles] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState(false);
  const [tab, setTab] = useState("entrada");
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSession(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    setProfileLoading(true);
    fetchProfile(session.user.id)
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
  }, [session]);

  useEffect(() => {
    if (!session) {
      setVehicles([]);
      setConfig(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [vehiclesRes, configRes] = await Promise.all([
          storage.getVehicles(),
          storage.getConfig(),
        ]);
        setVehicles(vehiclesRes);
        if (configRes) {
          setConfig(mergeConfig(configRes));
        } else {
          setConfig(DEFAULT_CONFIG);
          await storage.setConfig(DEFAULT_CONFIG);
        }
      } catch (e) {
        setVehicles([]);
        setConfig(DEFAULT_CONFIG);
      } finally {
        setLoading(false);
      }
    })();
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = storage.subscribeToChanges({
      onVehicleChange: ({ eventType, vehicle }) => {
        setVehicles((prev) => {
          if (eventType === "DELETE") {
            return prev.filter((v) => v.id !== vehicle.id);
          }
          const idx = prev.findIndex((v) => v.id === vehicle.id);
          if (idx === -1) return [vehicle, ...prev];
          const next = [...prev];
          next[idx] = vehicle;
          return next;
        });
      },
      onConfigChange: (configRow) => setConfig(mergeConfig(configRow)),
    });
    return unsubscribe;
  }, [session?.user?.id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  if (session === undefined || (session && profileLoading)) {
    return <LoadingScreen text="Cargando…" />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  if (!profile) {
    return (
      <div style={{ background: "var(--bg)" }} className="min-h-screen flex items-center justify-center px-6">
        <RootStyles />
        <div className="text-center">
          <AlertTriangle className="mx-auto mb-3" size={32} style={{ color: "var(--danger)" }} />
          <p className="text-sm mb-4">No se encontró tu perfil de usuario. Pedile a un administrador que revise tu cuenta.</p>
          <button onClick={() => signOut()} className="px-4 py-2 rounded-lg text-xs font-semibold" style={{ background: "var(--surface2)", color: "var(--text)" }}>
            Cerrar sesión
          </button>
        </div>
      </div>
    );
  }

  if (loading || !config) {
    return <LoadingScreen text="Cargando estacionamiento…" />;
  }

  const role = profile.role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.USUARIO;
  const allowedTabs = TABS_POR_ROL[role];
  const activeTab = allowedTabs.includes(tab) ? tab : allowedTabs[0];

  const vehiculosDentro = vehicles.filter((v) => v.estado === "dentro");
  const ocupados = vehiculosDentro.length;
  const disponibles = Math.max(0, config.totalEspacios - ocupados);
  const ocupacionPct = Math.min(100, Math.round((ocupados / Math.max(1, config.totalEspacios)) * 100));

  const registrarIngreso = async (patente, tipo) => {
    const pat = patente.trim().toUpperCase();
    if (!pat) return showToast("Ingresá una patente");
    if (vehiculosDentro.some((v) => v.patente === pat)) {
      return showToast(`${pat} ya está registrado dentro`);
    }
    if (disponibles <= 0) return showToast("No hay espacio disponible");
    const vehicle = {
      id: `${pat}-${Date.now()}`,
      patente: pat,
      tipo,
      horaIngreso: Date.now(),
      horaSalida: null,
      monto: null,
      estado: "dentro",
    };
    setVehicles((prev) => [vehicle, ...prev]);
    try {
      await storage.insertVehicle(vehicle);
      setSaveError(false);
      showToast(`Ingreso registrado: ${pat}`);
    } catch (e) {
      setVehicles((prev) => prev.filter((v) => v.id !== vehicle.id));
      if (e.code === "DUPLICATE_PATENTE") {
        showToast(`${pat} ya está registrado dentro`);
      } else {
        setSaveError(true);
      }
    }
  };

  const registrarSalida = async (id) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    const minutos = (Date.now() - v.horaIngreso) / 60000;
    const rates = config.rates[v.tipo] || config.rates.auto;
    const monto = calcularMonto(minutos, rates, config.umbrales);
    const patch = { horaSalida: Date.now(), monto, estado: "afuera" };
    setVehicles((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    try {
      await storage.updateVehicle(id, patch);
      setSaveError(false);
      showToast(`Salida registrada: ${v.patente} · ${fmtMoney(monto)}`);
    } catch (e) {
      setVehicles((prev) => prev.map((x) => (x.id === id ? v : x)));
      setSaveError(true);
    }
  };

  const updateConfig = async (newConfig) => {
    const prevConfig = config;
    setConfig(newConfig);
    try {
      await storage.setConfig(newConfig);
      setSaveError(false);
    } catch (e) {
      setConfig(prevConfig);
      setSaveError(true);
    }
  };

  const resetDemo = async () => {
    setVehicles([]);
    setConfig(DEFAULT_CONFIG);
    try {
      await storage.deleteAllVehicles();
      await storage.setConfig(DEFAULT_CONFIG);
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
    showToast("Datos reiniciados");
  };

  const borrarTodo = async () => {
    setVehicles([]);
    try {
      await storage.deleteAllVehicles();
      setSaveError(false);
    } catch (e) {
      setSaveError(true);
    }
    showToast("Historial borrado");
  };

  return (
    <div style={{ background: "var(--bg)", color: "var(--text)" }} className="min-h-screen flex flex-col font-sans">
      <RootStyles />
      <TopBar
        config={config}
        ocupados={ocupados}
        disponibles={disponibles}
        ocupacionPct={ocupacionPct}
        userEmail={profile.email}
        onLogout={signOut}
      />

      <main className="flex-1 overflow-y-auto pb-24 px-4 pt-4 max-w-md w-full mx-auto">
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-20">
              <ParkingSquare className="animate-pulse" size={32} style={{ color: "var(--accent)" }} />
            </div>
          }
        >
          {activeTab === "entrada" && (
            <EntradaTab onRegistrar={registrarIngreso} disponibles={disponibles} />
          )}
          {activeTab === "salida" && (
            <SalidaTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              rates={config.rates}
              umbrales={config.umbrales}
              onSalida={registrarSalida}
            />
          )}
          {activeTab === "estado" && (
            <EstadoTab
              vehiculosDentro={vehiculosDentro}
              now={now}
              totalEspacios={config.totalEspacios}
              disponibles={disponibles}
            />
          )}
          {activeTab === "reportes" && (
            <ReportesTab vehicles={vehicles} now={now} />
          )}
          {activeTab === "config" && (
            <ConfigTab
              config={config}
              onSave={updateConfig}
              onResetDemo={resetDemo}
              onBorrarTodo={borrarTodo}
              currentUserId={profile.id}
            />
          )}
        </Suspense>
      </main>

      <BottomNav tab={activeTab} setTab={setTab} disponibles={disponibles} role={role} />

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 bottom-24 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium z-50"
          style={{ background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)" }}
        >
          {toast}
        </div>
      )}
      {saveError && (
        <div
          className="fixed top-16 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 z-50"
          style={{ background: "var(--danger)", color: "#fff" }}
        >
          <AlertTriangle size={13} /> No se pudo guardar
        </div>
      )}
    </div>
  );
}
```

- [ ] **Paso 2:** `npm run build` sin errores.
- [ ] **Paso 3:** Commit (solo `src/App.jsx`):

```bash
git add src/App.jsx
git commit -m "feat: App.jsx usa vehicles+config separados, preserva sesion/roles"
```

---

# Task 6: Actualizar `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Paso 1:** Reemplazar el párrafo:

```markdown
Los datos (autos registrados, configuración de tarifas) se guardan en
Supabase — ver `src/storage.js` y `src/supabaseClient.js` — así que se
sincronizan entre todos los dispositivos que usen la app (todos leen y
escriben la misma fila en la tabla `kv_store`).
```

por:

```markdown
Los datos (autos registrados, configuración de tarifas) se guardan en
Supabase — ver `src/storage.js` y `src/supabaseClient.js` — en dos tablas:
`vehicles` (una fila por vehículo) y `config` (una fila con la configuración
del estacionamiento). Cada acción (registrar ingreso, registrar salida,
guardar configuración) escribe solo su propia fila, así que dos dispositivos
usando la app al mismo tiempo no pueden pisarse los datos entre sí. Los
cambios además se sincronizan en tiempo real entre dispositivos vía Supabase
Realtime, sin necesidad de recargar la página.
```

- [ ] **Paso 2:** Reemplazar el paso 3 de la lista numerada (correr el SQL):

```markdown
3. **Correr el SQL** de `supabase/schema.sql` en el SQL editor del proyecto
   (Supabase → SQL Editor → pegar el contenido del archivo → Run). Crea:
   - la tabla `kv_store` (datos de la app), con RLS restringido a usuarios
     autenticados (`auth.role() = 'authenticated'`);
   - la tabla `profiles` (id, email, role), con un trigger que crea
     automáticamente el perfil de cada usuario nuevo con `role = 'usuario'`,
     y policies de RLS para que cada quien vea su propio perfil (los admin
     ven y editan el rol de todos).
```

por:

```markdown
3. **Correr el SQL**:
   - Proyecto nuevo, sin datos previos: `supabase/schema.sql` en el SQL
     editor del proyecto (Supabase → SQL Editor → pegar el contenido del
     archivo → Run). Crea:
     - las tablas `vehicles` (un vehículo por fila) y `config` (una fila
       con la configuración del estacionamiento), con RLS restringido a
       usuarios autenticados (`auth.role() = 'authenticated'`) y Realtime
       habilitado;
     - la tabla `profiles` (id, email, role), con un trigger que crea
       automáticamente el perfil de cada usuario nuevo con `role = 'usuario'`,
       y policies de RLS para que cada quien vea su propio perfil (los admin
       ven y editan el rol de todos).
   - Proyecto existente con datos reales en la tabla `kv_store` (esquema
     anterior) que ya tiene la sección de Roles aplicada: usar
     `supabase/migrate_kv_to_relational.sql` en su lugar, que crea
     `vehicles`+`config` y además migra los datos existentes. El archivo
     incluye instrucciones para verificar la migración antes de borrar
     `kv_store`.
```

- [ ] **Paso 3:** Borrar por completo este bloque (limitación de concurrencia, ya resuelta):

```markdown
> **Limitación conocida (concurrencia):** la app lee y escribe todo el blob
> de datos como un único JSON, sin suscripción realtime ni resolución de
> conflictos. Si dos empleados editan desde dispositivos distintos casi al
> mismo tiempo, gana el último `write` y se pierden los cambios del otro
> (last-write-wins). Queda pendiente para un trabajo futuro.
```

- [ ] **Paso 4:** En el otro bloque de limitación conocida (el de aislamiento por rol a nivel de datos), actualizar la mención de `kv_store` por `vehicles`/`config` — reemplazar:

```markdown
> **Limitación conocida:** la restricción por rol es a nivel de interfaz
> (qué pestañas se muestran) y de la tabla `profiles`; la tabla `kv_store`
> sigue guardando todo (vehículos + configuración) como un único blob JSON
> por fila, así que cualquier usuario autenticado técnicamente puede leer
> ese blob completo aunque la UI no le muestre Reportes/Config. Separar
> `kv_store` en tablas por dominio con RLS granular es un trabajo aparte si
> se necesita ese nivel de aislamiento.
```

por:

```markdown
> **Limitación conocida:** la restricción por rol es a nivel de interfaz
> (qué pestañas se muestran) y de la tabla `profiles`; las policies RLS de
> `vehicles`/`config` siguen siendo "cualquier usuario autenticado puede
> leer/escribir todo", así que un usuario sin acceso a Reportes/Config en
> la UI técnicamente puede leer esas tablas completas igual. Separar por
> rol a nivel de RLS (por ejemplo, restringir `config` a solo admins) es un
> trabajo aparte si se necesita ese nivel de aislamiento.
```

- [ ] **Paso 5:** En la sección **Estructura**, actualizar:

```markdown
  storage.js    # capa de persistencia (hoy: Supabase, tabla kv_store)
```

por:

```markdown
  storage.js    # capa de persistencia (Supabase, tablas vehicles + config)
```

- [ ] **Paso 6:** Commit (solo `README.md`):

```bash
git add README.md
git commit -m "docs: actualizar README con el esquema relacional auth-aware"
```

---

# Task 7: Verificación manual end-to-end (con el proyecto Supabase real)

**Files:** ninguno (solo verificación)

- [ ] **Paso 1:** Confirmar que `.env` tiene `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` del proyecto real (ya configurado).
- [ ] **Paso 2:** Confirmar en el SQL editor de ese proyecto que `vehicles`/`config` ya existen con datos (la migración ya se corrió a mano antes de este plan) — `select count(*) from vehicles;`, `select * from config;`.
- [ ] **Paso 3:** `npm run dev`, iniciar sesión con un usuario real del proyecto.
- [ ] **Paso 4:** Abrir la app en dos pestañas (dos sesiones logueadas). En la pestaña A, registrar un ingreso con una patente de prueba. Confirmar que aparece en la pestaña B sin recargar (Realtime).
- [ ] **Paso 5:** En la pestaña B, registrar un ingreso con otra patente sin recargar. Confirmar que ambos vehículos siguen presentes en las dos pestañas (el caso que antes causaba el pisado de datos).
- [ ] **Paso 6:** Intentar registrar la misma patente de nuevo desde la otra pestaña mientras sigue "dentro" — confirmar el toast "ya está registrado dentro" (índice único).
- [ ] **Paso 7:** Registrar la salida de un vehículo y confirmar que el monto cobrado usa la tarifa del tipo de vehículo correcto (probar con auto y con moto, que tienen tarifas distintas).
- [ ] **Paso 8:** Si el usuario logueado es admin, ir a Config, cambiar una tarifa de un tipo específico, guardar, y confirmar que la otra pestaña actualiza sin recargar.
- [ ] **Paso 9:** Si todo funciona, no hace falta commit adicional.

---

## Self-review (cobertura contra lo pedido)

- Esquema relacional con RLS auth-aware (no anon) → Task 1, preserva la sección de Roles intacta.
- Migración de datos existentes, compatible con tarifas por tipo (jsonb sin reshape) → Task 2.
- `storage.js` con operaciones de dominio → Task 3 (idéntico al diseño original, no depende de auth).
- Limpieza de constantes no usadas, sin tocar `DEFAULT_CONFIG` por tipo → Task 4.
- `App.jsx` preserva sesión/login/roles de `master` y solo reemplaza el bloque de persistencia → Task 5.
- Documentación actualizada, incluyendo la limitación de aislamiento por rol que sigue vigente (no se resuelve en este plan) → Task 6.
- Verificación real contra el proyecto Supabase del usuario, con dos sesiones logueadas → Task 7.
- Sin placeholders: cada paso de código trae el contenido completo del archivo o el texto exacto a reemplazar.
