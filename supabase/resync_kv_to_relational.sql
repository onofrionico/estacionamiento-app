-- Re-sincroniza vehicles/config desde kv_store cuando las tablas YA existen
-- (por ejemplo, corriste migrate_kv_to_relational.sql una vez, pero la app
-- vieja siguió escribiendo en kv_store mientras tanto porque el deploy con
-- el código nuevo todavía no salió). A diferencia de
-- migrate_kv_to_relational.sql, este script NO crea tablas — asume que
-- vehicles/config/profiles ya existen — y usa upsert (on conflict) en vez
-- de insert, así que se puede correr las veces que haga falta sin duplicar
-- filas ni fallar por "relation already exists".
--
-- Correr en el SQL editor de Supabase, en el proyecto donde ya corriste
-- migrate_kv_to_relational.sql anteriormente.

insert into config (id, total_espacios, rates, umbrales)
select 1, (v->'config'->>'totalEspacios')::int, v->'config'->'rates', v->'config'->'umbrales'
from (select value::jsonb as v from kv_store where key = 'estacionamiento-datos') s
on conflict (id) do update set
  total_espacios = excluded.total_espacios,
  rates = excluded.rates,
  umbrales = excluded.umbrales,
  updated_at = now();

insert into vehicles (id, patente, tipo, hora_ingreso, hora_salida, monto, estado)
select
  e->>'id', e->>'patente', e->>'tipo',
  to_timestamp((e->>'horaIngreso')::bigint / 1000.0),
  case when e->>'horaSalida' is not null then to_timestamp((e->>'horaSalida')::bigint / 1000.0) end,
  (e->>'monto')::numeric, e->>'estado'
from (select value::jsonb as v from kv_store where key = 'estacionamiento-datos') s,
     jsonb_array_elements(s.v->'vehicles') e
on conflict (id) do update set
  hora_salida = excluded.hora_salida,
  monto = excluded.monto,
  estado = excluded.estado;

-- Verificá antes de dar por terminada la migración:
--   select count(*) from vehicles;
--   select * from config;
