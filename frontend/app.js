const cfg = window.INVNOTIF_CONFIG;
const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

const feedEl = document.getElementById("feed");
const emptyStateEl = document.getElementById("empty-state");
const lastCheckEl = document.getElementById("last-check");
const onlyImportantToggle = document.getElementById("only-important-toggle");

let currentFilter = "all";
let allNotifications = [];
let companiesById = {};

// ---------------- Utilidades ----------------
function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// ---------------- Render del feed ----------------
function renderFeed() {
  const filtered = allNotifications.filter((n) => currentFilter === "all" || n.importance === currentFilter);
  feedEl.innerHTML = "";
  emptyStateEl.hidden = filtered.length > 0;

  for (const n of filtered) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = n.source_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = `feed-item importance-${n.importance}`;

    const company = companiesById[n.company_id];
    a.innerHTML = `
      <div class="feed-item-meta">
        <span class="company-tag">${company ? company.name : "General"}</span>
        <span>·</span>
        <span>${timeAgo(n.published_at)}</span>
        ${n.importance === "high" ? '<span class="importance-tag">· Importante</span>' : ""}
      </div>
      <div class="feed-item-title">${n.title}</div>
      <div class="feed-item-source">${n.source_name || ""}</div>
    `;
    li.appendChild(a);
    feedEl.appendChild(li);
  }
}

async function loadNotifications() {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("Error cargando noticias:", error.message);
    return;
  }
  allNotifications = data || [];
  renderFeed();
}

async function loadSettings() {
  const { data } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (data) {
    onlyImportantToggle.checked = data.only_notify_important;
    if (data.last_check_at) {
      lastCheckEl.textContent = `Última revisión: ${timeAgo(data.last_check_at)}`;
    }
  }
}

// ---------------- Filtros ----------------
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((c) => c.classList.remove("is-active"));
    chip.classList.add("is-active");
    currentFilter = chip.dataset.filter;
    renderFeed();
  });
});

onlyImportantToggle.addEventListener("change", async () => {
  await supabase.from("settings").update({ only_notify_important: onlyImportantToggle.checked }).eq("id", 1);
});

// ---------------- Panel de ajustes ----------------
const settingsOverlay = document.getElementById("settings-overlay");
document.getElementById("btn-settings").addEventListener("click", () => {
  settingsOverlay.hidden = false;
});
document.getElementById("btn-close-settings").addEventListener("click", () => {
  settingsOverlay.hidden = true;
});
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay) settingsOverlay.hidden = true;
});

// ---------------- Gestión de empresas ----------------
async function loadCompanies() {
  const { data, error } = await supabase.from("companies").select("*").order("name");
  if (error) {
    console.error("Error cargando empresas:", error.message);
    return;
  }
  companiesById = Object.fromEntries((data || []).map((c) => [c.id, c]));

  const listEl = document.getElementById("company-list");
  listEl.innerHTML = "";
  for (const c of data || []) {
    const li = document.createElement("li");
    li.innerHTML = `
      <span>${c.name}${c.ticker ? `<span class="ticker">${c.ticker}</span>` : ""}</span>
      <button class="remove-company" data-id="${c.id}">Quitar</button>
    `;
    listEl.appendChild(li);
  }
  listEl.querySelectorAll(".remove-company").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.from("companies").delete().eq("id", btn.dataset.id);
      await loadCompanies();
    });
  });

  // El feed necesita companiesById actualizado
  renderFeed();
}

document.getElementById("add-company-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("new-company-name");
  const tickerInput = document.getElementById("new-company-ticker");
  const name = nameInput.value.trim();
  const ticker = tickerInput.value.trim();
  if (!name) return;

  const searchTerms = ticker ? `${name}|${ticker}` : name;
  const { error } = await supabase.from("companies").insert({ name, ticker: ticker || null, search_terms: searchTerms });
  if (error) {
    alert("No se pudo añadir la empresa: " + error.message);
    return;
  }
  nameInput.value = "";
  tickerInput.value = "";
  await loadCompanies();
});

// ---------------- Notificaciones push ----------------
const pushStatusEl = document.getElementById("push-status");
const btnEnablePush = document.getElementById("btn-enable-push");

async function refreshPushStatus() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushStatusEl.textContent = "Este navegador no soporta notificaciones push.";
    btnEnablePush.disabled = true;
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  pushStatusEl.textContent = existing ? "Notificaciones activadas en este dispositivo." : "Todavía no activadas en este dispositivo.";
}

btnEnablePush.addEventListener("click", async () => {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      pushStatusEl.textContent = "Permiso denegado. Actívalo desde los ajustes del navegador.";
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY),
    });
    const json = subscription.toJSON();
    const { error } = await supabase.from("push_subscriptions").insert({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    });
    if (error && !error.message.includes("duplicate")) throw error;
    pushStatusEl.textContent = "¡Notificaciones activadas en este dispositivo!";
  } catch (err) {
    console.error(err);
    pushStatusEl.textContent = "No se pudo activar: " + err.message;
  }
});

// ---------------- Arranque ----------------
async function init() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("sw.js");
    } catch (err) {
      console.error("Error registrando service worker:", err);
    }
  }
  await Promise.all([loadCompanies(), loadNotifications(), loadSettings()]);
  await refreshPushStatus();

  // Refresco periódico del feed mientras la app está abierta
  setInterval(loadNotifications, 60000);
}

init();
