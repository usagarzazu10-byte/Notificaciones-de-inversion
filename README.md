# Señal — Notificaciones de inversión

App configurable para seguir noticias de las empresas que elijas, con
clasificación de importancia (reglas + IA) y notificaciones push al
móvil. Todo el stack usado es gratuito.

## Arquitectura

- **`backend/`** — script Node.js que busca noticias (Google News RSS),
  las clasifica y las guarda. Se ejecuta automáticamente cada 30 min
  vía GitHub Actions, aunque tu móvil esté apagado.
- **`supabase/schema.sql`** — base de datos (empresas, noticias, ajustes).
- **`frontend/`** — la PWA (app web instalable) que ves y usas en el móvil.

Cuando enciendes el móvil, la app simplemente pide "todas las noticias
guardadas" a la base de datos — no importa cuánto tiempo haya estado
apagado, no se pierde nada.

---

## Paso 1 — Crear el proyecto en Supabase (base de datos gratuita)

1. Ve a [supabase.com](https://supabase.com) → crea una cuenta gratis → "New project".
2. Cuando esté listo, ve a **SQL Editor** → "New query", pega todo el
   contenido de `supabase/schema.sql` y ejecútalo (▶). Esto crea las
   tablas y añade 3 empresas de ejemplo (Apple, Tesla, NVIDIA).
3. Ve a **Project Settings → API**. Copia:
   - `Project URL` → lo necesitarás dos veces
   - `anon public key` → para el frontend
   - `service_role key` → para el backend (¡es secreta, no la publiques!)

## Paso 2 — Generar las claves VAPID (para las notificaciones push)

En tu ordenador (con Node instalado), ejecuta:

```bash
npx web-push generate-vapid-keys
```

Te da un `Public Key` y un `Private Key`. Guárdalos.

## Paso 3 — (Opcional pero recomendado) Clave de Anthropic para la IA

Si quieres que la IA ayude a clasificar los casos ambiguos, consigue
una API key en [console.anthropic.com](https://console.anthropic.com).
Sin esta clave, la app sigue funcionando solo con las reglas de
palabras clave (algo menos precisa en casos ambiguos, que se marcarán
como no importantes por defecto).

## Paso 4 — Subir el proyecto a GitHub

1. Crea un repositorio nuevo en tu cuenta de GitHub (puede ser privado).
2. Sube esta carpeta entera (`git init`, `git add .`, `git commit`, `git push`,
   o directamente arrastrando los archivos desde la web de GitHub).

## Paso 5 — Configurar los secrets de GitHub Actions

En tu repositorio: **Settings → Secrets and variables → Actions → New
repository secret**. Añade estos 6 secrets:

| Nombre | Valor |
|---|---|
| `SUPABASE_URL` | tu Project URL de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | tu service_role key (la secreta) |
| `ANTHROPIC_API_KEY` | tu clave de Anthropic (opcional) |
| `VAPID_PUBLIC_KEY` | la pública generada en el paso 2 |
| `VAPID_PRIVATE_KEY` | la privada generada en el paso 2 |
| `VAPID_SUBJECT` | `mailto:tu-email@ejemplo.com` |

El workflow (`.github/workflows/check-news.yml`) ya está listo: se
ejecuta cada 30 minutos automáticamente en cuanto hagas el push, y
también puedes lanzarlo a mano desde la pestaña **Actions → Revisar
noticias de inversión → Run workflow**.

## Paso 6 — Configurar y publicar el frontend

1. Edita `frontend/config.js` con tu `SUPABASE_URL`, tu `anon public
   key` y tu `VAPID_PUBLIC_KEY` (los mismos valores de antes, la anon
   key y la VAPID pública están pensadas para ser visibles).
2. Publícalo gratis con **GitHub Pages**:
   - Repositorio → **Settings → Pages**
   - Source: "Deploy from a branch" → selecciona tu rama y la carpeta
     `/frontend` (o mueve el contenido de `frontend/` a `/docs` si tu
     plan de Pages lo pide así)
   - Guarda. En 1-2 minutos tendrás una URL tipo
     `https://tu-usuario.github.io/tu-repo/`

## Paso 7 — Instalar la app en el móvil

1. Abre esa URL desde el navegador de tu móvil (Chrome en Android
   funciona mejor para push; en iPhone usa Safari).
2. Menú del navegador → **"Añadir a pantalla de inicio"**.
3. Ábrela desde el icono nuevo → entra en Ajustes (⚙) → **"Activar
   notificaciones"**.
4. Añade o quita empresas desde el mismo panel de ajustes.

A partir de aquí, cada 30 minutos GitHub revisa noticias en segundo
plano (sin que tu móvil esté encendido), y si algo se clasifica como
importante te llega un push. Al abrir la app, o al tocar la
notificación, verás/irás directamente a la noticia original.

---

## Notas y límites a tener en cuenta

- **Google News RSS** es gratuito y no requiere clave, pero no es una
  API oficial — si Google cambia el formato podría dejar de funcionar;
  el código está aislado en `fetchNewsForCompany()` en
  `backend/fetch_and_classify.js` para poder sustituirlo fácilmente por
  otra fuente (ej. Finnhub, Marketaux) si hace falta.
- **Push en iPhone**: funciona desde iOS 16.4+, pero solo si la app
  está "añadida a pantalla de inicio" (no vale abrirla solo en Safari).
- **Límites gratuitos**: GitHub Actions (2000 min/mes gratis en repos
  privados, ilimitado en públicos), Supabase (500MB de base de datos,
  más que de sobra para esto), todo dentro de lo normal para un uso
  personal.
