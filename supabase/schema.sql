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
  numero_ticket int generated always as identity,
  estado text not null check (estado in ('dentro', 'afuera')),
  created_at timestamptz not null default now(),
  unique (numero_ticket)
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
  nombre text not null default 'Mi Estacionamiento',
  direccion text,
  telefono text,
  logo_url text,
  total_espacios int not null,
  umbral_media_estadia_horas int not null,
  umbral_estadia_completa_horas int not null,
  umbral_tolerancia_min int not null default 15,
  imprimir_ingreso boolean not null default false,
  imprimir_egreso boolean not null default false,
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
  where id = p_visita_id
    and estado = 'dentro';

  if not found then
    raise exception 'visita % no está dentro (ya salió o no existe)', p_visita_id;
  end if;
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

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "authenticated write logos" on storage.objects for all
  using (bucket_id = 'logos' and auth.role() = 'authenticated')
  with check (bucket_id = 'logos' and auth.role() = 'authenticated');

create policy "public read logos" on storage.objects for select using (bucket_id = 'logos');
