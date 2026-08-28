# Flujo de trabajo

1. **Crear la rama de trabajo desde `develop`**, no desde `master`:

   ```bash
   git checkout develop
   git pull
   git checkout -b <nombre-de-la-rama>
   ```

2. **Mergear esa rama a `develop`** (vía PR o merge directo). Cada push a
   `develop` dispara el deploy automático del servicio de staging en Render
   (`estacionamiento-app-staging`, ver `render.yaml`).
3. **Probar en staging** que la funcionalidad se comporta como se espera.
4. **Recién con el OK de la prueba en staging**, promover `develop` a
   `master` (merge o PR de `develop` → `master`). Cada push a `master`
   dispara el deploy automático de producción (`estacionamiento-app`).

No se mergea directo a `master` sin pasar por `develop` + staging primero.
