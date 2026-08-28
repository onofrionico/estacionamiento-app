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
