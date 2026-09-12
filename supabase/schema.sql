-- ============================================================
-- Esquema de base de datos para la app de notificaciones de inversión
-- Ejecutar esto en: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- Empresas que el usuario sigue
create table if not exists companies (
  id bigint generated always as identity primary key,
  name text not null,               -- nombre visible, ej "Apple"
  ticker text,                       -- ej "AAPL" (opcional)
  search_terms text not null,        -- términos usados para buscar en RSS, ej "Apple|AAPL"
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Noticias/notificaciones ya procesadas
create table if not exists notifications (
  id bigint generated always as identity primary key,
  company_id bigint references companies(id) on delete set null,
  title text not null,
  summary text,
  source_name text,                 -- ej "Reuters"
  source_url text not null,
  published_at timestamptz not null,
  importance text not null default 'low',   -- 'high' | 'low'
  importance_score numeric,          -- puntuación interna (debug/transparencia)
  importance_reason text,            -- por qué se clasificó así (regla o IA)
  dedupe_key text not null unique,   -- hash de url+titulo para evitar duplicados
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_published on notifications(published_at desc);
create index if not exists idx_notifications_importance on notifications(importance);

-- Suscripciones push del navegador/móvil (una por dispositivo instalado)
create table if not exists push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Configuración general (fila única)
create table if not exists settings (
  id int primary key default 1,
  only_notify_important boolean not null default true,
  last_check_at timestamptz,
  constraint single_row check (id = 1)
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- Empresas de ejemplo para empezar (bórralas o edítalas desde la app)
insert into companies (name, ticker, search_terms) values
  ('Apple', 'AAPL', 'Apple|AAPL'),
  ('Tesla', 'TSLA', 'Tesla|TSLA'),
  ('NVIDIA', 'NVDA', 'NVIDIA|NVDA')
on conflict do nothing;

-- ============================================================
-- Row Level Security: permitimos lectura pública (frontend usa
-- la "anon key", segura para exponer) y solo el backend
-- (con la "service_role key", secreta) puede escribir.
-- ============================================================
alter table companies enable row level security;
alter table notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table settings enable row level security;

create policy "public read companies" on companies for select using (true);
create policy "public read notifications" on notifications for select using (true);
create policy "public read settings" on settings for select using (true);

-- El frontend necesita poder añadir/quitar empresas y guardar su
-- suscripción push y cambiar ajustes, así que permitimos esas
-- operaciones con la anon key también (no hay login de usuario en v1).
create policy "public insert companies" on companies for insert with check (true);
create policy "public update companies" on companies for update using (true);
create policy "public delete companies" on companies for delete using (true);
create policy "public insert push_subscriptions" on push_subscriptions for insert with check (true);
create policy "public update settings" on settings for update using (true);
