# Estacionamiento App

Aplicación web mobile-first para la gestión de un estacionamiento: registro de
entradas y salidas, cálculo automático de tarifas por tramo, estado de
ocupación en tiempo real, y reportes (diario / semanal / quincenal / mensual)
exportables a Excel.

## Requisitos

- Node.js 18+

## Desarrollo local

```bash
npm install
npm run dev
```

Abrí la URL que muestra la terminal (por defecto `http://localhost:5173`).
Para probarla como la usaría un empleado desde el celular, abrí esa misma URL
desde el navegador del teléfono estando en la misma red Wi-Fi (Vite te va a
mostrar también una URL de tipo `http://192.168.x.x:5173`).

## Build de producción

```bash
npm run build
npm run preview   # para previsualizar el build localmente
```

El resultado queda en `dist/`, listo para hostear en cualquier servicio de
archivos estáticos (Vercel, Netlify, GitHub Pages, etc.).

El code-splitting por tab (`ReportesTab`, `SalidaTab`, etc.) mantiene esos
chunks livianos, pero el chunk principal (`index-*.js`) pesa ~663 kB (~204 kB
gzip) porque incluye `@supabase/supabase-js` como import síncrono (vía
`src/supabaseClient.js` → `src/storage.js` → `App.jsx`). Sin esa librería el
chunk principal rondaría los ~442 kB que dejó el code-splitting; el resto es
el costo del cliente de Supabase.

## Backend (Supabase)

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

Para levantar tu propio backend:

1. **Crear un proyecto** en [supabase.com](https://supabase.com) (tier free
   alcanza).
2. **Habilitar el provider de Email** en Authentication → Providers (viene
   habilitado por defecto en proyectos nuevos).
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
4. **Copiar las credenciales**: `.env.example` a `.env`

   ```bash
   cp .env.example .env
   ```

   y completar las dos variables con los valores de Settings → API del
   proyecto Supabase:

   ```
   VITE_SUPABASE_URL=<Project URL>
   VITE_SUPABASE_ANON_KEY=<anon public key>
   ```

5. **Correr la app**:

   ```bash
   npm run dev
   ```

`.env` está en `.gitignore` — las claves nunca se suben al repo.

### Roles y permisos

La app requiere iniciar sesión (Supabase Auth, email/contraseña). Hay dos
roles:

- **usuario**: acceso a Entrada, Salida y Estado.
- **admin**: acceso total, incluyendo Reportes y Config (donde además puede
  gestionar el rol de otros usuarios).

No hay alta de cuentas autogestionada desde la app (evita exponer una
service role key en el cliente). Para dar de alta a alguien:

1. Supabase → Authentication → Users → **Add user** (con email y
   contraseña, o mandale un invite link).
2. Al iniciar sesión por primera vez, el trigger crea su fila en
   `profiles` con `role = 'usuario'`.
3. Para que sea admin, otro admin lo cambia desde Config → Usuarios y
   roles, o corriendo en el SQL editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'la persona@ejemplo.com';
   ```

   (el primer admin del proyecto se tiene que promover así, a mano, la
   primera vez).

> **Limitación conocida:** la restricción por rol es a nivel de interfaz
> (qué pestañas se muestran) y de la tabla `profiles`; las policies RLS de
> `vehicles`/`config` siguen siendo "cualquier usuario autenticado puede
> leer/escribir todo", así que un usuario sin acceso a Reportes/Config en
> la UI técnicamente puede leer esas tablas completas igual. Separar por
> rol a nivel de RLS (por ejemplo, restringir `config` a solo admins) es un
> trabajo aparte si se necesita ese nivel de aislamiento.

## Deploy (Render)

El repo incluye `render.yaml` (Blueprint) en la raíz, listo para que Render
levante el sitio como static site.

1. **Si el repo todavía no está en GitHub, subilo primero** (paso manual,
   previo a esto).
2. En [Render](https://dashboard.render.com) ir a **New → Blueprint** y
   conectar el repositorio de GitHub. Render detecta `render.yaml`
   automáticamente y configura el build (`npm install && npm run build`) y el
   publish path (`dist`) solo.
3. **Completar las variables de entorno** en el dashboard de Render
   (Environment del servicio): `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`,
   con los mismos valores que usás en `.env` local. En `render.yaml` están
   declaradas como `sync: false`, es decir que no viajan en el archivo — hay
   que cargarlas a mano en el dashboard la primera vez.
4. Cada push a la rama conectada dispara un deploy automático en Render. No
   hace falta configurar GitHub Actions ni ningún otro paso de CI/CD. Ver
   `CONTRIBUTING.md` para el flujo de ramas: `develop` despliega a staging
   (`estacionamiento-app-staging`), `master` despliega a producción
   (`estacionamiento-app`).

## Estructura

```
src/
  App.jsx       # toda la lógica y UI de la aplicación
  storage.js    # capa de persistencia (Supabase, esquema 3FN: vehiculos/visitas/egresos/tarifas_por_tipo)
  supabaseClient.js # cliente de Supabase (usa VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
  main.jsx      # punto de entrada de React
  index.css     # Tailwind
```

## Configuración

Capacidad total, tarifas (media hora, hora, media estadía, estadía completa,
semanal, mensual) y umbrales de tramo se configuran desde la pestaña
**Config** dentro de la app — no hace falta tocar código.
