# Normalización 3FN de `vehicles` (vehiculos/visitas/egresos/tarifas) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la tabla única `vehicles` (con `hora_salida`/`monto` nullable y `tipo` como texto libre) y el `config` con `rates`/`umbrales` en jsonb, por un esquema en 3FN: `tipos_vehiculo`, `vehiculos`, `visitas`, `egresos` y `tarifas_por_tipo` (historial append-only), sin ninguna columna nullable en el flujo normal.

**Architecture:** Igual que el diseño — ver `docs/superpowers/specs/2026-08-28-normalizacion-vehicles-3fn-design.md`. `egresos` es una fila hija que solo existe cuando el vehículo salió (en vez de columnas nullable en la tabla principal). `vehiculos` separa la identidad del auto de cada `visita`. `tarifas_por_tipo` es append-only (nunca se actualiza, solo se insertan filas nuevas con `vigente_desde`), y una vista `tarifas_vigentes` resuelve la tarifa activa. `storage.js` arma en JS el objeto plano que ya consume la UI (join client-side de `visitas`+`vehiculos`+`egresos`, y `config`+`tarifas_vigentes`), así que **`App.jsx` y todos los componentes de tabs quedan sin cambios** — es el único consumidor de `storage.js` (confirmado con `grep storage\. src/`).

**Tech Stack:** React 18 + Vite, `@supabase/supabase-js`, Postgres (Supabase), función `cerrar_visita` en plpgsql para la transacción atómica de salida. Sin test framework — se verifica con `npm run build` + prueba manual (igual que el resto del repo).

---

## Contexto de archivos (leídos antes de planificar)

- `supabase/schema.sql` — hoy crea `vehicles` (`id`, `patente`, `tipo` texto libre, `hora_ingreso`, `hora_salida` nullable, `monto` nullable, `estado`) y `config` (`total_espacios`, `rates` jsonb, `umbrales` jsonb), con RLS `authenticated`, Realtime y `replica identity full`. Termina con la sección "Roles y permisos" (`profiles`, `is_admin()`, trigger `handle_new_user`) — **esa sección no se toca**.
- `src/storage.js` — capa de traducción snake_case/timestamptz ↔ camelCase/ms sobre `vehicles`+`config`. Único consumidor: `src/App.jsx` (confirmado, no hay otro `import { storage }` en el repo).
- `src/App.jsx` — orquesta sesión/roles (sin cambios en este plan) y llama `storage.getVehicles()`, `storage.getConfig()`, `storage.insertVehicle(vehicle)`, `storage.updateVehicle(id, patch)` (patch siempre `{horaSalida, monto, estado: "afuera"}`, es el único call site), `storage.setConfig(config)`, `storage.deleteAllVehicles()`, `storage.subscribeToChanges({onVehicleChange, onConfigChange})`. El callback `onVehicleChange({eventType, vehicle})` solo usa `vehicle.id` en la rama `DELETE`; en las demás ramas necesita el objeto completo. `onConfigChange(configPlano)` hace `setConfig(mergeConfig(configPlano))`.
- `src/constants.js` — `DEFAULT_CONFIG.rates` tiene exactamente las claves `auto`/`moto`/`camioneta` (van a matchear los `id` de `tipos_vehiculo`); `DEFAULT_CONFIG.umbrales` tiene `mediaEstadiaHoras`/`estadiaCompletaHoras`. `TIPOS` exporta los mismos tres ids. **No se toca.**
- `src/components/ConfigTab.jsx` — arma `local.rates[tipoActivo][concepto]` y `local.umbrales[key]`, llama `onSave(local)` con el objeto completo. **No se toca.**
- El proyecto Supabase real del usuario ya tiene datos en `vehicles`/`config` (no en `kv_store`, esa migración ya se hizo). El script de migración de esta tarea parte de esas tablas.

---

# Task 1: Esquema SQL nuevo (`supabase/schema.sql`)

**Files:**
- Modify: `supabase/schema.sql`

- [ ] **Paso 1:** Reemplazar el contenido completo de `supabase/schema.sql` por:

```sql
-- Ejecutar una sola vez en el SQL editor de Supabase al crear un proyecto
-- nuevo (este repo no tiene un runner de migraciones automatizado). Ver
-- docs/superpowers/specs/2026-08-28-normalizacion-vehicles-3fn-design.md.
--
-- Si ya tenías un proyecto con las tablas vehicles/config (esquema anterior:
-- una sola tabla vehicles con hora_salida/monto nullable, config con
-- rates/umbrales en jsonb) y datos reales cargados, NO corras el bloque de
-- abajo tal cual para migrar: usá supabase/migrate_vehicles_to_3fn.sql en su
-- lugar, que crea las mismas tablas y además migra los datos existentes. La
-- sección de "Roles y permisos" de este archivo es la misma en ambos casos
-- (si ya la corriste una vez, no hace falta repetirla).

create table tipos_vehiculo (
  id text primary key,
  nombre text not null
);

insert into tipos_vehiculo (id, nombre) values
  ('auto', 'Auto'),
  ('moto', 'Moto'),
  ('camioneta', 'Camioneta');

create table vehiculos (
  patente text primary key,
  tipo_id text not null references tipos_vehiculo (id),
  created_at timestamptz not null default now()
);

create table visitas (
  id text primary key,
  vehiculo_id text not null references vehiculos (patente),
  hora_ingreso timestamptz not null,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now()
);

-- Impide que la misma patente tenga dos visitas "dentro" a la vez.
create unique index visitas_vehiculo_dentro_uk
  on visitas (vehiculo_id) where estado = 'dentro';

-- Solo existe una fila acá cuando el vehículo salió: hora_salida y monto
-- nunca son null, porque la fila simplemente no existe hasta que hay salida.
create table egresos (
  visita_id text primary key references visitas (id) on delete cascade,
  hora_salida timestamptz not null,
  monto numeric not null,
  created_at timestamptz not null default now()
);

-- Tarifas: append-only. Cada guardado desde Config inserta filas nuevas con
-- vigente_desde = now(), nunca actualiza ni borra — da historial completo de
-- cambios de tarifas sin necesitar una columna vigente_hasta (se infiere por
-- el siguiente registro en el tiempo).
create table tarifas_por_tipo (
  tipo_id text not null references tipos_vehiculo (id),
  concepto text not null check (concepto in (
    'mediaHora', 'hora', 'mediaEstadia', 'estadiaCompleta', 'semanal', 'mensual'
  )),
  vigente_desde timestamptz not null default now(),
  monto numeric not null,
  primary key (tipo_id, concepto, vigente_desde)
);

-- Resuelve la tarifa vigente hoy para cada (tipo, concepto): la de mayor
-- vigente_desde que ya empezó a regir. security_invoker=true hace que la
-- vista respete las policies RLS de tarifas_por_tipo para quien consulta, en
-- vez de las del dueño de la vista.
create view tarifas_vigentes
  with (security_invoker = true) as
  select distinct on (tipo_id, concepto) tipo_id, concepto, monto, vigente_desde
  from tarifas_por_tipo
  where vigente_desde <= now()
  order by tipo_id, concepto, vigente_desde desc;

create table config (
  id int primary key default 1,
  total_espacios int not null,
  umbral_media_estadia_horas int not null,
  umbral_estadia_completa_horas int not null,
  updated_at timestamptz not null default now(),
  check (id = 1)
);

alter table tipos_vehiculo enable row level security;
alter table vehiculos enable row level security;
alter table visitas enable row level security;
alter table egresos enable row level security;
alter table tarifas_por_tipo enable row level security;
alter table config enable row level security;

grant select on public.tipos_vehiculo to authenticated;
grant select, insert, update, delete on public.vehiculos to authenticated;
grant select, insert, update, delete on public.visitas to authenticated;
grant select, insert, update, delete on public.egresos to authenticated;
grant select, insert on public.tarifas_por_tipo to authenticated;
grant select on public.tarifas_vigentes to authenticated;
grant select, insert, update, delete on public.config to authenticated;

revoke all on public.tipos_vehiculo from anon;
revoke all on public.vehiculos from anon;
revoke all on public.visitas from anon;
revoke all on public.egresos from anon;
revoke all on public.tarifas_por_tipo from anon;
revoke all on public.tarifas_vigentes from anon;
revoke all on public.config from anon;

drop policy if exists "allow authenticated read tipos_vehiculo" on tipos_vehiculo;
create policy "allow authenticated read tipos_vehiculo"
  on tipos_vehiculo for select
  using (auth.role() = 'authenticated');

drop policy if exists "allow authenticated read/write vehiculos" on vehiculos;
create policy "allow authenticated read/write vehiculos"
  on vehiculos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "allow authenticated read/write visitas" on visitas;
create policy "allow authenticated read/write visitas"
  on visitas for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "allow authenticated read/write egresos" on egresos;
create policy "allow authenticated read/write egresos"
  on egresos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "allow authenticated read/write tarifas_por_tipo" on tarifas_por_tipo;
create policy "allow authenticated read/write tarifas_por_tipo"
  on tarifas_por_tipo for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "allow authenticated read/write config" on config;
create policy "allow authenticated read/write config"
  on config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Cierra una visita de forma atómica: crea el egreso y marca la visita como
-- "afuera" en una sola transacción, para que nunca queden desincronizados
-- (ej. si el cliente se cae entre los dos pasos). security invoker: corre
-- con los privilegios del usuario autenticado que la llama, así que las
-- policies RLS de egresos/visitas se siguen aplicando igual.
create or replace function public.cerrar_visita(
  p_visita_id text,
  p_hora_salida timestamptz,
  p_monto numeric
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.egresos (visita_id, hora_salida, monto)
  values (p_visita_id, p_hora_salida, p_monto);

  update public.visitas
  set estado = 'afuera'
  where id = p_visita_id;
end;
$$;

grant execute on function public.cerrar_visita(text, timestamptz, numeric) to authenticated;

-- Habilita eventos de tiempo real (INSERT/UPDATE/DELETE) para que la app
-- sincronice cambios entre dispositivos sin recargar. No hace falta
-- replica identity full: los handlers de storage.js solo necesitan el id
-- (primary key) de la fila vieja en los eventos DELETE, y eso siempre viene
-- incluido por default.
alter publication supabase_realtime add table vehiculos, visitas, egresos, tarifas_por_tipo, config;

-- ---------------------------------------------------------------------
-- Roles y permisos
-- ---------------------------------------------------------------------
-- Ejecutar esta sección una sola vez (agregada en una fase posterior a la
-- creación inicial de kv_store, ver historial de este archivo en git). Requiere
-- que el proveedor de autenticación "Email" esté habilitado en
-- Authentication > Providers.
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

- [ ] **Paso 2:** Commit:

```bash
git add supabase/schema.sql
git commit -m "feat: esquema 3FN vehiculos/visitas/egresos/tarifas_por_tipo, reemplaza vehicles"
```

---

# Task 2: Script de migración de datos reales (`supabase/migrate_vehicles_to_3fn.sql`)

**Files:**
- Create: `supabase/migrate_vehicles_to_3fn.sql`

- [ ] **Paso 1:** Crear `supabase/migrate_vehicles_to_3fn.sql`:

```sql
-- Correr UNA SOLA VEZ en el SQL editor de Supabase, en proyectos que ya
-- tenían el esquema anterior (una sola tabla `vehicles` con hora_salida/
-- monto nullable, `config` con rates/umbrales en jsonb) Y ya tienen la
-- sección de Roles y permisos de supabase/schema.sql aplicada (tabla
-- profiles, etc. — este script no la toca). Crea el esquema 3FN nuevo
-- (tipos_vehiculo, vehiculos, visitas, egresos, tarifas_por_tipo) y migra
-- los datos existentes desde vehicles/config. Ver
-- docs/superpowers/specs/2026-08-28-normalizacion-vehicles-3fn-design.md.
--
-- Para proyectos nuevos sin datos previos, usá supabase/schema.sql en vez
-- de este archivo.

-- Saca del medio las tablas viejas (mismo nombre que las nuevas de abajo)
-- sin borrar datos, para poder migrar desde ellas.
alter table vehicles rename to vehicles_old_3fn;
alter table config rename to config_old_3fn;
alter publication supabase_realtime drop table vehicles_old_3fn, config_old_3fn;

create table tipos_vehiculo (
  id text primary key,
  nombre text not null
);

insert into tipos_vehiculo (id, nombre) values
  ('auto', 'Auto'),
  ('moto', 'Moto'),
  ('camioneta', 'Camioneta');

create table vehiculos (
  patente text primary key,
  tipo_id text not null references tipos_vehiculo (id),
  created_at timestamptz not null default now()
);

create table visitas (
  id text primary key,
  vehiculo_id text not null references vehiculos (patente),
  hora_ingreso timestamptz not null,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now()
);

create unique index visitas_vehiculo_dentro_uk
  on visitas (vehiculo_id) where estado = 'dentro';

create table egresos (
  visita_id text primary key references visitas (id) on delete cascade,
  hora_salida timestamptz not null,
  monto numeric not null,
  created_at timestamptz not null default now()
);

create table tarifas_por_tipo (
  tipo_id text not null references tipos_vehiculo (id),
  concepto text not null check (concepto in (
    'mediaHora', 'hora', 'mediaEstadia', 'estadiaCompleta', 'semanal', 'mensual'
  )),
  vigente_desde timestamptz not null default now(),
  monto numeric not null,
  primary key (tipo_id, concepto, vigente_desde)
);

create view tarifas_vigentes
  with (security_invoker = true) as
  select distinct on (tipo_id, concepto) tipo_id, concepto, monto, vigente_desde
  from tarifas_por_tipo
  where vigente_desde <= now()
  order by tipo_id, concepto, vigente_desde desc;

create table config (
  id int primary key default 1,
  total_espacios int not null,
  umbral_media_estadia_horas int not null,
  umbral_estadia_completa_horas int not null,
  updated_at timestamptz not null default now(),
  check (id = 1)
);

alter table tipos_vehiculo enable row level security;
alter table vehiculos enable row level security;
alter table visitas enable row level security;
alter table egresos enable row level security;
alter table tarifas_por_tipo enable row level security;
alter table config enable row level security;

grant select on public.tipos_vehiculo to authenticated;
grant select, insert, update, delete on public.vehiculos to authenticated;
grant select, insert, update, delete on public.visitas to authenticated;
grant select, insert, update, delete on public.egresos to authenticated;
grant select, insert on public.tarifas_por_tipo to authenticated;
grant select on public.tarifas_vigentes to authenticated;
grant select, insert, update, delete on public.config to authenticated;

revoke all on public.tipos_vehiculo from anon;
revoke all on public.vehiculos from anon;
revoke all on public.visitas from anon;
revoke all on public.egresos from anon;
revoke all on public.tarifas_por_tipo from anon;
revoke all on public.tarifas_vigentes from anon;
revoke all on public.config from anon;

create policy "allow authenticated read tipos_vehiculo"
  on tipos_vehiculo for select
  using (auth.role() = 'authenticated');

create policy "allow authenticated read/write vehiculos"
  on vehiculos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "allow authenticated read/write visitas"
  on visitas for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "allow authenticated read/write egresos"
  on egresos for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "allow authenticated read/write tarifas_por_tipo"
  on tarifas_por_tipo for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "allow authenticated read/write config"
  on config for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create or replace function public.cerrar_visita(
  p_visita_id text,
  p_hora_salida timestamptz,
  p_monto numeric
)
returns void
language plpgsql
security invoker
as $$
begin
  insert into public.egresos (visita_id, hora_salida, monto)
  values (p_visita_id, p_hora_salida, p_monto);

  update public.visitas
  set estado = 'afuera'
  where id = p_visita_id;
end;
$$;

grant execute on function public.cerrar_visita(text, timestamptz, numeric) to authenticated;

alter publication supabase_realtime add table vehiculos, visitas, egresos, tarifas_por_tipo, config;

-- Migra vehiculos: una fila por patente distinta, con el tipo de su fila
-- más reciente en la tabla vieja.
insert into vehiculos (patente, tipo_id)
select distinct on (patente) patente, tipo
from vehicles_old_3fn
order by patente, created_at desc;

-- Migra visitas: una fila por cada fila vieja de vehicles.
insert into visitas (id, vehiculo_id, hora_ingreso, estado, created_at)
select id, patente, hora_ingreso, estado, created_at
from vehicles_old_3fn;

-- Migra egresos: solo para las filas que ya tenían hora_salida/monto.
insert into egresos (visita_id, hora_salida, monto)
select id, hora_salida, monto
from vehicles_old_3fn
where hora_salida is not null and monto is not null;

-- Migra tarifas_por_tipo desde config.rates (jsonb por tipo), con
-- vigente_desde = now() para toda la tanda migrada.
insert into tarifas_por_tipo (tipo_id, concepto, monto, vigente_desde)
select t1.tipo_key, t2.concepto_key, t2.concepto_val::numeric, now()
from config_old_3fn
cross join lateral jsonb_each_text(config_old_3fn.rates) as t1(tipo_key, tipo_val)
cross join lateral jsonb_each_text(t1.tipo_val::jsonb) as t2(concepto_key, concepto_val);

-- Migra config: total_espacios directo, umbrales (jsonb) a columnas.
insert into config (id, total_espacios, umbral_media_estadia_horas, umbral_estadia_completa_horas)
select 1, total_espacios, (umbrales->>'mediaEstadiaHoras')::int, (umbrales->>'estadiaCompletaHoras')::int
from config_old_3fn;

-- Verificá antes de seguir:
--   select count(*) from vehiculos;
--   select count(*) from visitas;
--   select count(*) from egresos;
--   select * from tarifas_vigentes order by tipo_id, concepto;
--   select * from config;
-- Comparalos contra:
--   select count(distinct patente) from vehicles_old_3fn;
--   select count(*) from vehicles_old_3fn;
--   select count(*) from vehicles_old_3fn where hora_salida is not null;
--
-- Recién cuando confirmes que está todo bien, borrá las tablas viejas a mano:
--   drop table vehicles_old_3fn;
--   drop table config_old_3fn;
```

- [ ] **Paso 2:** Commit:

```bash
git add supabase/migrate_vehicles_to_3fn.sql
git commit -m "feat: script de migracion de vehicles/config al esquema 3FN"
```

---

# Task 3: Reescribir `src/storage.js`

**Files:**
- Modify: `src/storage.js`

- [ ] **Paso 1:** Reemplazar el contenido completo de `src/storage.js` por:

```js
/**
 * Capa de almacenamiento sobre Supabase (tablas tipos_vehiculo, vehiculos,
 * visitas, egresos, tarifas_por_tipo, config). Arma en JS el objeto plano
 * que consume la UI —un vehículo: {id, patente, tipo, horaIngreso,
 * horaSalida, monto, estado}; una config: {totalEspacios, rates, umbrales}—
 * a partir de varias tablas relacionales, así que el resto de la app no
 * necesita saber que el dato está normalizado. El cliente de Supabase ya
 * adjunta el JWT de la sesión activa en cada request, así que las policies
 * RLS "authenticated" del esquema se aplican solas.
 */
import { supabase } from "./supabaseClient";

function flattenVehicle(visita, vehiculo, egreso) {
  return {
    id: visita.id,
    patente: vehiculo.patente,
    tipo: vehiculo.tipo_id,
    horaIngreso: new Date(visita.hora_ingreso).getTime(),
    horaSalida: egreso ? new Date(egreso.hora_salida).getTime() : null,
    monto: egreso ? Number(egreso.monto) : null,
    estado: visita.estado,
  };
}

function configFromRows(configRow, tarifaRows) {
  const rates = {};
  for (const t of tarifaRows) {
    if (!rates[t.tipo_id]) rates[t.tipo_id] = {};
    rates[t.tipo_id][t.concepto] = Number(t.monto);
  }
  return {
    totalEspacios: configRow.total_espacios,
    rates,
    umbrales: {
      mediaEstadiaHoras: configRow.umbral_media_estadia_horas,
      estadiaCompletaHoras: configRow.umbral_estadia_completa_horas,
    },
  };
}

async function getVehicleById(id) {
  const { data: visita, error: eV } = await supabase.from("visitas").select("*").eq("id", id).single();
  if (eV) throw eV;
  const [{ data: vehiculo, error: eA }, { data: egreso, error: eE }] = await Promise.all([
    supabase.from("vehiculos").select("*").eq("patente", visita.vehiculo_id).single(),
    supabase.from("egresos").select("*").eq("visita_id", id).maybeSingle(),
  ]);
  if (eA) throw eA;
  if (eE) throw eE;
  return flattenVehicle(visita, vehiculo, egreso);
}

export const storage = {
  async getVehicles() {
    const [{ data: visitas, error: eV }, { data: vehiculos, error: eA }, { data: egresos, error: eE }] =
      await Promise.all([
        supabase.from("visitas").select("*").order("created_at", { ascending: false }),
        supabase.from("vehiculos").select("*"),
        supabase.from("egresos").select("*"),
      ]);
    if (eV) throw eV;
    if (eA) throw eA;
    if (eE) throw eE;

    const vehiculoByPatente = new Map(vehiculos.map((v) => [v.patente, v]));
    const egresoByVisitaId = new Map(egresos.map((e) => [e.visita_id, e]));

    return visitas.map((visita) =>
      flattenVehicle(visita, vehiculoByPatente.get(visita.vehiculo_id), egresoByVisitaId.get(visita.id))
    );
  },

  async insertVehicle(vehicle) {
    const { error: upsertError } = await supabase
      .from("vehiculos")
      .upsert({ patente: vehicle.patente, tipo_id: vehicle.tipo }, { onConflict: "patente" });
    if (upsertError) throw upsertError;

    const { error } = await supabase.from("visitas").insert({
      id: vehicle.id,
      vehiculo_id: vehicle.patente,
      hora_ingreso: new Date(vehicle.horaIngreso).toISOString(),
      estado: "dentro",
    });
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
    const { error } = await supabase.rpc("cerrar_visita", {
      p_visita_id: id,
      p_hora_salida: new Date(patch.horaSalida).toISOString(),
      p_monto: patch.monto,
    });
    if (error) throw error;
  },

  async deleteAllVehicles() {
    const { error } = await supabase.from("visitas").delete().neq("id", "");
    if (error) throw error;
  },

  async getConfig() {
    const { data: configRow, error: eC } = await supabase.from("config").select("*").eq("id", 1).maybeSingle();
    if (eC) throw eC;
    if (!configRow) return null;
    const { data: tarifas, error: eT } = await supabase.from("tarifas_vigentes").select("*");
    if (eT) throw eT;
    return configFromRows(configRow, tarifas);
  },

  async setConfig(config) {
    const { error: eC } = await supabase.from("config").upsert({
      id: 1,
      total_espacios: config.totalEspacios,
      umbral_media_estadia_horas: config.umbrales.mediaEstadiaHoras,
      umbral_estadia_completa_horas: config.umbrales.estadiaCompletaHoras,
    });
    if (eC) throw eC;

    const vigenteDesde = new Date().toISOString();
    const tarifaRows = Object.entries(config.rates).flatMap(([tipoId, conceptos]) =>
      Object.entries(conceptos).map(([concepto, monto]) => ({
        tipo_id: tipoId,
        concepto,
        monto,
        vigente_desde: vigenteDesde,
      }))
    );
    const { error: eT } = await supabase.from("tarifas_por_tipo").insert(tarifaRows);
    if (eT) throw eT;
  },

  subscribeToChanges({ onVehicleChange, onConfigChange }) {
    const refreshConfig = async () => {
      const config = await storage.getConfig();
      if (config) onConfigChange(config);
    };

    const channel = supabase
      .channel("parking-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "visitas" }, (payload) => {
        if (payload.eventType === "DELETE") {
          onVehicleChange({ eventType: "DELETE", vehicle: { id: payload.old.id } });
          return;
        }
        getVehicleById(payload.new.id).then((vehicle) =>
          onVehicleChange({ eventType: payload.eventType, vehicle })
        );
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "egresos" }, (payload) => {
        getVehicleById(payload.new.visita_id).then((vehicle) =>
          onVehicleChange({ eventType: "UPDATE", vehicle })
        );
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "config" }, () => {
        refreshConfig();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tarifas_por_tipo" }, () => {
        refreshConfig();
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  },
};
```

- [ ] **Paso 2:** `npm run build` desde `estacionamiento-app/` — no debería fallar (App.jsx, ConfigTab.jsx, constants.js no cambian, y el contrato de `storage` es el mismo: mismas funciones, mismos nombres de argumentos, mismo shape de objetos de entrada/salida).

Run: `npm run build`
Expected: build exitoso, sin errores de referencias rotas.

- [ ] **Paso 3:** Commit:

```bash
git add src/storage.js
git commit -m "feat: storage.js arma vehiculos/visitas/egresos/tarifas en el shape plano que usa la UI"
```

---

# Task 4: Migrar los datos reales y verificar

**Files:** ninguno (solo verificación contra el proyecto Supabase real)

- [ ] **Paso 1:** Confirmar que `.env` tiene `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` del proyecto real (ya configurado en corridas anteriores).
- [ ] **Paso 2:** Antes de correr nada, hacer un respaldo rápido desde el SQL editor: `select count(*) from vehicles;` y `select * from config;` — anotar los números para comparar después.
- [ ] **Paso 3:** Correr `supabase/migrate_vehicles_to_3fn.sql` completo en el SQL editor del proyecto real.
- [ ] **Paso 4:** Verificar los conteos indicados al final del script (comentarios del Paso 1 de Task 2): `vehiculos`, `visitas`, `egresos`, `tarifas_vigentes`, `config`, comparados contra `vehicles_old_3fn`/`config_old_3fn`.
- [ ] **Paso 5:** Si los conteos cierran, borrar las tablas viejas a mano:

```sql
drop table vehicles_old_3fn;
drop table config_old_3fn;
```

- [ ] **Paso 6:** `npm run dev`, iniciar sesión con un usuario real del proyecto. Confirmar que la lista de vehículos y la config cargan igual que antes de la migración (mismos ocupados/disponibles, mismas tarifas).

---

# Task 5: Actualizar `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Paso 1:** Reemplazar el párrafo que describe la persistencia (buscar el que menciona `vehicles`/`config` y "sincronizan entre todos los dispositivos") por:

```markdown
Los datos (autos registrados, configuración de tarifas) se guardan en
Supabase — ver `src/storage.js` y `src/supabaseClient.js` — en un esquema
normalizado (3FN): `vehiculos` (identidad del auto), `visitas` (cada
estadía), `egresos` (solo existe si el vehículo ya salió — así
`hora_salida`/`monto` nunca son nulos) y `tarifas_por_tipo` (historial
completo de tarifas, nunca se sobreescribe). Cada acción (registrar ingreso,
registrar salida, guardar configuración) escribe solo sus propias filas, así
que dos dispositivos usando la app al mismo tiempo no pueden pisarse los
datos entre sí. Los cambios además se sincronizan en tiempo real entre
dispositivos vía Supabase Realtime, sin necesidad de recargar la página.
```

- [ ] **Paso 2:** En el paso "Correr el SQL" de las instrucciones de setup, reemplazar las referencias a `vehicles`/`config`/`supabase/migrate_kv_to_relational.sql` por:

```markdown
3. **Correr el SQL**:
   - Proyecto nuevo, sin datos previos: `supabase/schema.sql` en el SQL
     editor del proyecto (Supabase → SQL Editor → pegar el contenido del
     archivo → Run). Crea:
     - las tablas `tipos_vehiculo`, `vehiculos`, `visitas`, `egresos` y
       `tarifas_por_tipo` (esquema 3FN, sin columnas nullable en el flujo
       normal), con RLS restringido a usuarios autenticados
       (`auth.role() = 'authenticated'`) y Realtime habilitado;
     - la tabla `profiles` (id, email, role), con un trigger que crea
       automáticamente el perfil de cada usuario nuevo con `role = 'usuario'`,
       y policies de RLS para que cada quien vea su propio perfil (los admin
       ven y editan el rol de todos).
   - Proyecto existente con datos reales en las tablas `vehicles`/`config`
     (esquema anterior) que ya tiene la sección de Roles aplicada: usar
     `supabase/migrate_vehicles_to_3fn.sql` en su lugar, que crea el esquema
     3FN y además migra los datos existentes. El archivo incluye
     instrucciones para verificar la migración antes de borrar las tablas
     viejas.
```

- [ ] **Paso 3:** En la sección **Estructura**, actualizar la línea de `storage.js`:

```markdown
  storage.js    # capa de persistencia (Supabase, esquema 3FN: vehiculos/visitas/egresos/tarifas_por_tipo)
```

- [ ] **Paso 4:** Commit:

```bash
git add README.md
git commit -m "docs: actualizar README con el esquema 3FN"
```

---

# Task 6: Verificación manual end-to-end

**Files:** ninguno (solo verificación)

- [ ] **Paso 1:** `npm run dev`, abrir la app en dos pestañas con sesión iniciada.
- [ ] **Paso 2:** Pestaña A: registrar un ingreso con una patente de prueba nueva (ej. `TEST123`, tipo moto). Confirmar que aparece en la pestaña B sin recargar (Realtime vía `visitas` INSERT).
- [ ] **Paso 3:** Intentar registrar la misma patente de nuevo desde la pestaña B mientras sigue "dentro" — confirmar el toast "ya está registrado dentro" (índice único `visitas_vehiculo_dentro_uk`).
- [ ] **Paso 4:** Registrar la salida de `TEST123` desde la pestaña A. Confirmar: el monto cobrado usa la tarifa de moto (no la de auto), y la pestaña B refleja el cambio a "afuera" sin recargar (Realtime vía `egresos` INSERT).
- [ ] **Paso 5:** Si el usuario logueado es admin: ir a Config, cambiar una tarifa de un tipo específico, guardar, confirmar que la otra pestaña actualiza sin recargar (Realtime vía `tarifas_por_tipo` INSERT). Verificar en el SQL editor que la tarifa vieja sigue en `tarifas_por_tipo` (no se borró) y que `tarifas_vigentes` muestra la nueva.
- [ ] **Paso 6:** Registrar el ingreso de `TEST123` de nuevo (mismo auto, nueva visita) y confirmar que aparece con su patente/tipo correctos — valida que `vehiculos`/`visitas` están bien relacionadas.
- [ ] **Paso 7:** Desde Config (admin), usar "Borrar historial de vehículos" y confirmar que la lista queda vacía en ambas pestañas.
- [ ] **Paso 8:** Si todo funciona, no hace falta commit adicional.

---

## Self-review (cobertura contra el spec)

- Esquema 3FN sin nulls en el flujo normal (`egresos` como fila hija opcional) → Task 1.
- `tipo` como FK a catálogo (`tipos_vehiculo`) → Task 1.
- Identidad del vehículo separada de cada estadía (`vehiculos`/`visitas`) → Task 1.
- Tarifas append-only con historial completo (`tarifas_por_tipo` + vista `tarifas_vigentes`) → Task 1.
- `config.umbrales` sin jsonb, columnas `not null` → Task 1.
- Migración de los datos reales existentes (no del `kv_store` viejo, sino de `vehicles`/`config` ya migrados) → Task 2 y Task 4.
- `storage.js` mantiene el mismo contrato (`getVehicles`, `insertVehicle`, `updateVehicle`, `deleteAllVehicles`, `getConfig`, `setConfig`, `subscribeToChanges`), verificado contra el único consumidor (`App.jsx`) → Task 3.
- Fuera de alcance explícito del spec (datos adicionales en `vehiculos`, UI de historial de tarifas, RLS granular por rol) — no se agregan tareas para esto, consistente con lo acordado.
- Documentación actualizada → Task 5.
- Verificación end-to-end con Realtime, duplicados, tarifas por tipo, historial de tarifas y borrado → Task 6.
- Sin placeholders: cada paso de código trae el contenido completo del archivo o el bloque SQL exacto a ejecutar.
