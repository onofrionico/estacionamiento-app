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
  where id = p_visita_id
    and estado = 'dentro';

  if not found then
    raise exception 'visita % no está dentro (ya salió o no existe)', p_visita_id;
  end if;
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
