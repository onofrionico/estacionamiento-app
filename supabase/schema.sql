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
