// Uso: node list_tables.mjs
// Lee SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY del entorno y muestra
// qué tablas/rutas expone la API de Supabase ahora mismo.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
const data = await res.json();
const paths = Object.keys(data.paths || {});
console.log("SUPABASE_URL:", url);
console.log("Status OpenAPI root:", res.status);
console.log("Tablas/rutas visibles por PostgREST:", paths);

const res2 = await fetch(`${url}/rest/v1/companies?select=*&limit=3`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
console.log("Status /companies:", res2.status);
console.log("Body /companies:", await res2.text());
