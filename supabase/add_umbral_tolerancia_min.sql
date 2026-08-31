-- Correr UNA SOLA VEZ en el SQL editor de Supabase, en proyectos que ya
-- tienen la tabla `config` del esquema relacional (ver supabase/schema.sql).
-- Agrega la columna de tolerancia de cobro (minutos de gracia antes de
-- pasar al tramo/bloque de tarifa siguiente). Ver
-- docs/superpowers/specs/2026-08-30-tolerancia-cobro-design.md.
--
-- Importante: correr esto ANTES de deployar el código que empieza a leer y
-- escribir `umbral_tolerancia_min` (la app hace `select("*")` así que
-- tolera leer antes de que exista la columna, pero `setConfig` va a fallar
-- al intentar escribirla si la columna todavía no existe).

alter table config
  add column if not exists umbral_tolerancia_min int not null default 15;
