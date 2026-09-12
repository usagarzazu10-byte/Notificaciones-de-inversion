-- Ejecuta SOLO esto en tu SQL Editor de Supabase (si ya habías creado
-- la base de datos con la versión anterior de schema.sql). Añade el
-- permiso que falta para poder marcar/desmarcar una noticia como
-- importante desde la app.

create policy "public update notifications" on notifications for update using (true);
