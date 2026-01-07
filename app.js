// ==========================
// 1) CONFIG
// ==========================

const LS_KEYS = {
  entries: "projetoJunho.entries.v3",
  settings: "projetoJunho.settings.v1",
};

const LEGACY_ENTRIES_KEYS = [
  "projetoJunho.entries.v2",
  "projetoJunho.entries.v1",
];

const SUPABASE_URL = "https://iiyusrqrghqpcucipryc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlpeXVzcnFyZ2hxcGN1Y2lwcnljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NDA1OTcsImV4cCI6MjA4MzMxNjU5N30.bJgg3kle6ICOeI1zH2R2Akyurnq0tUfoImdmzyr7jzI";
const SITE_URL = "https://andrefbm.github.io/projeto-junho/";
const SUPABASE_TABLE = "entries";

const DEFAULT_SETTINGS = {
  goalWeight: 85.0,
  goalDate: "2026-06-04",
  startWeight: 105.0,
  startDate: todayISO(),
};

let chart = null;
let stepsChart = null;

const el = (id) => document.getElementById(id);

// IMPORTANT: não usar o nome "supabase" aqui para evitar conflito com globals
const sb = (window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;


// ==========================
// 2) HELPERS
// ==========================

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function nowISO() {
  return new Date().toISOString();
}

function parseNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function avg(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function dateDiffDays(aISO, bISO) {
  const a = new Date(aISO + "T00:00:00");
  const b = new Date(bISO + "T00:00:00");
  const ms = b - a;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function fmt(n, digits = 1) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function toMillis(iso) {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? t : 0;
}

function formatWorkoutType(v) {
  const map = {
    none: "",
    strengthA: "Força A",
    strengthB: "Força B",
    walk: "Caminhada",
    run: "Corrida",
    bike: "Bicicleta",
    mobility: "Mobilidade",
    other: "Outro",
  };
  return map[v] ?? String(v ?? "");
}


// ==========================
// 3) SETTINGS
// ==========================

function loadSettings() {
  const raw = localStorage.getItem(LS_KEYS.settings);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const s = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings));
}


// ==========================
// 4) ENTRIES + MIGRAÇÃO
// ==========================

function normalizeEntries(arr) {
  if (!Array.isArray(arr)) return [];

  return arr
    .map((e) => {
      let workoutType = e.workoutType;
      if (!workoutType && e.workout) {
        if (e.workout === "A") workoutType = "strengthA";
        else if (e.workout === "B") workoutType = "strengthB";
        else workoutType = "none";
      }

      const updatedAt =
        (typeof e.updatedAt === "string" && e.updatedAt) ? e.updatedAt :
        (typeof e.updated_at === "string" && e.updated_at) ? e.updated_at :
        null;

      return {
        date: e.date,
        weight: parseNum(e.weight),
        steps: parseNum(e.steps),

        workoutType: workoutType || "none",
        workoutMin: parseNum(e.workoutMin),
        workoutRpe: parseNum(e.workoutRpe),

        extras: parseNum(e.extras),
        sleep: parseNum(e.sleep),

        notes: String(e.notes || ""),

        updatedAt,
      };
    })
    .filter((e) => typeof e.date === "string" && e.date.length >= 10)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function saveEntries(entries) {
  localStorage.setItem(LS_KEYS.entries, JSON.stringify(entries));
}

function loadEntries() {
  const raw = localStorage.getItem(LS_KEYS.entries);
  if (raw) {
    try {
      return normalizeEntries(JSON.parse(raw));
    } catch {}
  }

  for (const key of LEGACY_ENTRIES_KEYS) {
    const legacy = localStorage.getItem(key);
    if (!legacy) continue;
    try {
      const normalized = normalizeEntries(JSON.parse(legacy));
      saveEntries(normalized);
      return normalized;
    } catch {}
  }

  return [];
}

function upsertEntry(entries, entry) {
  const idx = entries.findIndex((e) => e.date === entry.date);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

function deleteEntry(entries, date) {
  return entries.filter((e) => e.date !== date);
}

function lastNDaysEntries(entries, n) {
  const byDate = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
  return byDate.slice(-Math.max(n, 0));
}


// ==========================
// 5) UI
// ==========================

function computeMetrics(entries, settings) {
  const last7 = lastNDaysEntries(entries, 7);
  const avg7w = avg(last7.map((e) => e.weight).filter((x) => x !== null));
  const avg7s = avg(last7.map((e) => e.steps).filter((x) => x !== null));

  const today = todayISO();
  const daysLeft = dateDiffDays(today, settings.goalDate);

  let currentWeight = avg7w;
  if (currentWeight === null) {
    const lastWithWeight = [...entries].reverse().find((e) => e.weight !== null);
    currentWeight = lastWithWeight?.weight ?? settings.startWeight;
  }

  const weeksLeft = daysLeft > 0 ? daysLeft / 7 : 0;
  const kgToGo = currentWeight - settings.goalWeight;
  const neededPerWeek = weeksLeft > 0 ? (kgToGo / weeksLeft) : null;

  const last28 = lastNDaysEntries(entries, 28);
  const first14 = last28.slice(0, Math.max(0, last28.length - 14));
  const last14 = last28.slice(-14);

  const avgFirst14 = avg(first14.map((e) => e.weight).filter((x) => x !== null));
  const avgLast14 = avg(last14.map((e) => e.weight).filter((x) => x !== null));
  const change14 = (avgLast14 !== null && avgFirst14 !== null) ? (avgLast14 - avgFirst14) : null;
  const perWeek14 = change14 !== null ? (change14 / 2) : null;

  return { avg7w, avg7s, daysLeft, currentWeight, neededPerWeek, perWeek14 };
}

function setStatus(metrics, settings) {
  const box = el("status");
  const daysLeft = metrics.daysLeft;

  if (daysLeft <= 0) {
    box.className = "status warn";
    box.innerHTML = `A data alvo (<strong>${settings.goalDate}</strong>) já passou. Atualiza nas settings.`;
    return;
  }

  const needed = metrics.neededPerWeek;
  const recent = metrics.perWeek14;

  const neededTxt = needed === null ? "—" : `${fmt(needed, 2)} kg/sem (aprox.)`;
  const recentTxt = recent === null ? "—" : `${fmt(recent, 2)} kg/sem (últ. 14 dias)`;

  let cls = "warn";
  let headline = "Ajuste leve recomendado";
  let detail = "";

  if (needed !== null && needed <= 1.0) { headline = "Ritmo sustentável (bom)"; cls = "ok"; }
  if (needed !== null && needed > 1.0)  { headline = "Meta agressiva"; cls = "warn"; }
  if (needed !== null && needed > 1.3)  { headline = "Muito agressivo"; cls = "bad"; }

  if (recent !== null && needed !== null) {
    const recentLoss = -recent;
    if (recentLoss >= needed * 0.9) {
      detail = "Estás perto (ou acima) do ritmo necessário. Mantém consistência.";
      cls = (cls === "bad") ? "warn" : "ok";
    } else if (recentLoss >= needed * 0.6) {
      detail = "Estás abaixo do ritmo. O mais eficiente é cortar extras ou subir passos.";
      cls = (cls === "bad") ? "bad" : "warn";
    } else {
      detail = "Sem tendência suficiente (ou poucos dados). Foca em registar + reduzir extras.";
      cls = (cls === "bad") ? "bad" : "warn";
    }
  } else {
    detail = "Regista pelo menos 7–14 dias para termos tendência fiável.";
  }

  box.className = `status ${cls}`;
  box.innerHTML = `
    <div><strong>${headline}</strong></div>
    <div class="muted">
      Peso atual (proxy): <strong>${fmt(metrics.currentWeight, 1)} kg</strong><br/>
      Necessário para a meta: <strong>${neededTxt}</strong><br/>
      Tendência recente: <strong>${recentTxt}</strong><br/>
      ${detail}
    </div>
  `;
}

function renderMini(metrics) {
  el("avg7w").textContent = metrics.avg7w === null ? "—" : `${fmt(metrics.avg7w, 1)} kg`;
  el("avg7s").textContent = metrics.avg7s === null ? "—" : `${Math.round(metrics.avg7s)} passos`;
  el("daysLeft").textContent = Number.isFinite(metrics.daysLeft) ? `${metrics.daysLeft}` : "—";
}

function renderTable(entries) {
  const tbody = el("tbody");
  tbody.innerHTML = "";

  const rows = [...entries].reverse();
  for (const e of rows) {
    const tr = document.createElement("tr");

    const td = (txt) => {
      const cell = document.createElement("td");
      cell.textContent = txt;
      return cell;
    };

    tr.appendChild(td(e.date));
    tr.appendChild(td(e.weight === null ? "" : fmt(e.weight, 1)));
    tr.appendChild(td(e.steps === null ? "" : String(e.steps)));
    tr.appendChild(td(formatWorkoutType(e.workoutType)));
    tr.appendChild(td(e.workoutMin === null ? "" : String(e.workoutMin)));
    tr.appendChild(td(e.workoutRpe === null ? "" : String(e.workoutRpe)));
    tr.appendChild(td(e.extras === null ? "" : String(e.extras)));
    tr.appendChild(td(e.sleep === null ? "" : fmt(e.sleep, 1)));
    tr.appendChild(td(e.notes || ""));

    const actions = document.createElement("td");
    actions.style.whiteSpace = "nowrap";

    const editBtn = document.createElement("button");
    editBtn.className = "miniBtn";
    editBtn.textContent = "Editar";
    editBtn.onclick = () => fillForm(e);

    const delBtn = document.createElement("button");
    delBtn.className = "miniBtn danger";
    delBtn.textContent = "Apagar";
    delBtn.onclick = async () => {
      const ok = confirm(`Apagar o registo de ${e.date}?`);
      if (!ok) return;

      state.entries = deleteEntry(state.entries, e.date);
      saveEntries(state.entries);
      refresh();

      try { await deleteEntryFromCloud(e.date); }
      catch (err) { console.warn("Cloud delete falhou:", err); }
    };

    actions.appendChild(editBtn);
    actions.appendChild(document.createTextNode(" "));
    actions.appendChild(delBtn);

    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

function renderChart(entries) {
  const ctx = el("weightChart");
  if (!ctx) return;

  const data = entries.filter((e) => e.weight !== null);
  const labels = data.map((e) => e.date);
  const weights = data.map((e) => e.weight);

  const wMA = weights.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = weights.slice(start, i + 1);
    const a = avg(slice);
    return a === null ? null : Number(a.toFixed(2));
  });

  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Peso (kg)", data: weights, tension: 0.25 },
        { label: "Média móvel 7 dias", data: wMA, tension: 0.25 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { title: { display: true, text: "kg" } },
        x: { title: { display: true, text: "data" } },
      },
      plugins: { legend: { display: true } },
    },
  });
}

function renderStepsChart(entries) {
  const ctx = el("stepsChart");
  if (!ctx) return;

  const data = entries.filter((e) => e.steps !== null);
  const labels = data.map((e) => e.date);
  const steps = data.map((e) => e.steps);

  const sMA = steps.map((_, i) => {
    const start = Math.max(0, i - 6);
    const slice = steps.slice(start, i + 1);
    const a = avg(slice);
    return a === null ? null : Math.round(a);
  });

  if (stepsChart) stepsChart.destroy();
  stepsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Passos", data: steps, tension: 0.25 },
        { label: "Média móvel 7 dias", data: sMA, tension: 0.25 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { title: { display: true, text: "passos" } },
        x: { title: { display: true, text: "data" } },
      },
      plugins: { legend: { display: true } },
    },
  });
}


// ==========================
// 6) EXPORT / IMPORT
// ==========================

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportJSON(entries, settings) {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings,
    entries,
    version: "v3",
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `projeto-junho-backup-${todayISO()}.json`);
}

function exportCSV(entries) {
  const header = ["date","weight","steps","workoutType","workoutMin","workoutRpe","extras","sleep","notes","updatedAt"];
  const lines = [header.join(",")];

  for (const e of entries) {
    const row = [
      e.date,
      e.weight ?? "",
      e.steps ?? "",
      e.workoutType ?? "none",
      e.workoutMin ?? "",
      e.workoutRpe ?? "",
      e.extras ?? "",
      e.sleep ?? "",
      (e.notes ?? "").replaceAll('"','""'),
      e.updatedAt ?? "",
    ];
    row[8] = `"${row[8]}"`;
    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `projeto-junho-${todayISO()}.csv`);
}


// ==========================
// 7) FORM
// ==========================

function fillForm(e) {
  el("date").value = e.date;
  el("weight").value = e.weight ?? "";
  el("steps").value = e.steps ?? "";
  el("workoutType").value = e.workoutType ?? "none";
  el("workoutMin").value = e.workoutMin ?? "";
  el("workoutRpe").value = e.workoutRpe ?? "";
  el("extras").value = e.extras ?? "";
  el("sleep").value = e.sleep ?? "";
  el("notes").value = e.notes ?? "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearForm() {
  el("date").value = todayISO();
  el("weight").value = "";
  el("steps").value = "";
  el("workoutType").value = "none";
  el("workoutMin").value = "";
  el("workoutRpe").value = "";
  el("extras").value = "";
  el("sleep").value = "";
  el("notes").value = "";
}


// ==========================
// 8) STATE
// ==========================

const state = {
  settings: loadSettings(),
  entries: loadEntries(),
};


// ==========================
// 9) AUTH + SYNC
// ==========================

function setAuthStatus(msg) {
  const s = el("authStatus");
  if (s) s.textContent = msg;
}

function supabaseEnabled() {
  return !!sb && !!SUPABASE_ANON_KEY;
}

async function getUser() {
  if (!supabaseEnabled()) return null;
  const { data, error } = await sb.auth.getUser();
  if (error) return null;
  return data?.user ?? null;
}

async function signInMagicLink(email) {
  if (!supabaseEnabled()) throw new Error("Supabase não configurado.");
  console.log("[auth] signInWithOtp ->", email);

  const { data, error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: SITE_URL },
  });

  if (error) {
    console.error("[auth] erro:", error);
    throw error;
  }

  console.log("[auth] ok:", data);
}

function mergeLocalAndRemote(localEntries, remoteRows) {
  const map = new Map();

  for (const e of localEntries) {
    map.set(e.date, { t: toMillis(e.updatedAt), entry: e });
  }

  for (const r of remoteRows) {
    const remoteEntry = normalizeEntries([{
      ...(r.payload || {}),
      date: r.date,
      updatedAt: r.updated_at || null,
    }])[0];

    const t = toMillis(r.updated_at);
    const cur = map.get(r.date);

    if (!cur || t > cur.t) {
      map.set(r.date, { t, entry: remoteEntry });
    }
  }

  return [...map.values()].map(x => x.entry).sort((a,b) => a.date.localeCompare(b.date));
}

async function syncDown() {
  const user = await getUser();
  if (!user) return;

  const { data, error } = await sb
    .from(SUPABASE_TABLE)
    .select("date,payload,updated_at")
    .eq("user_id", user.id)
    .order("date", { ascending: true });

  if (error) throw error;

  state.entries = mergeLocalAndRemote(state.entries, data || []);
  saveEntries(state.entries);
  refresh();
}

async function upsertEntryToCloud(entry) {
  const user = await getUser();
  if (!user) return;

  const updatedAt = entry.updatedAt || nowISO();
  const row = {
    user_id: user.id,
    date: entry.date,
    payload: { ...entry, updatedAt },
    updated_at: updatedAt,
  };

  const { error } = await sb
    .from(SUPABASE_TABLE)
    .upsert(row, { onConflict: "user_id,date" });

  if (error) throw error;
}

async function deleteEntryFromCloud(date) {
  const user = await getUser();
  if (!user) return;

  const { error } = await sb
    .from(SUPABASE_TABLE)
    .delete()
    .eq("user_id", user.id)
    .eq("date", date);

  if (error) throw error;
}

async function syncUpAll() {
  const user = await getUser();
  if (!user) return;

  for (const e of state.entries) {
    await upsertEntryToCloud(e);
  }
}

async function doFullSync() {
  if (!supabaseEnabled()) return;
  await syncDown();
  await syncUpAll();
}

function initAuthUI() {
  const emailInput = el("authEmail");
  const loginBtn = el("loginBtn");
  const syncBtn = el("syncBtn");
  const logoutBtn = el("logoutBtn");

  if (!supabaseEnabled()) {
    setAuthStatus("Supabase não configurado.");
    loginBtn && (loginBtn.disabled = true);
    syncBtn && (syncBtn.disabled = true);
    logoutBtn && (logoutBtn.disabled = true);
    return;
  }

  loginBtn?.addEventListener("click", async () => {
    const email = (emailInput?.value || "").trim();
    if (!email) return alert("Escreve o email.");

    try {
      await signInMagicLink(email);
      setAuthStatus("Magic link enviado. Abre o email e clica no link.");
    } catch (err) {
      console.error(err);
      setAuthStatus(`Falhou: ${err?.message || "erro"}`);
      alert(`Falhou o envio do magic link: ${err?.message || "erro"}`);
    }
  });

  syncBtn?.addEventListener("click", async () => {
    try {
      setAuthStatus("A sincronizar...");
      await doFullSync();
      const user = await getUser();
      setAuthStatus(user ? `Autenticado: ${user.email} (sync ok)` : "Não autenticado.");
    } catch (err) {
      console.error(err);
      const user = await getUser();
      setAuthStatus(user ? `Autenticado: ${user.email} (sync falhou)` : "Não autenticado.");
      alert(`Sync falhou: ${err?.message || "erro"}`);
    }
  });

  logoutBtn?.addEventListener("click", async () => {
    await sb.auth.signOut();
    setAuthStatus("Não autenticado.");
  });

  sb.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      setAuthStatus(`Autenticado: ${session.user.email} (a sincronizar...)`);
      try {
        await doFullSync();
        setAuthStatus(`Autenticado: ${session.user.email} (sync ok)`);
      } catch (err) {
        console.error(err);
        setAuthStatus(`Autenticado: ${session.user.email} (sync falhou)`);
      }
    } else {
      setAuthStatus("Não autenticado.");
    }
  });

  getUser().then((u) => {
    if (u) {
      setAuthStatus(`Autenticado: ${u.email}`);
      doFullSync().catch((e) => console.warn("Sync inicial falhou:", e));
    } else {
      setAuthStatus("Não autenticado.");
    }
  });
}


// ==========================
// 10) SETTINGS + REFRESH
// ==========================

function applySettingsToUI() {
  el("goalWeight").value = state.settings.goalWeight;
  el("goalDate").value = state.settings.goalDate;
  el("startWeight").value = state.settings.startWeight;
  el("startDate").value = state.settings.startDate;
}

function readSettingsFromUI() {
  return {
    goalWeight: parseNum(el("goalWeight").value) ?? DEFAULT_SETTINGS.goalWeight,
    goalDate: el("goalDate").value || DEFAULT_SETTINGS.goalDate,
    startWeight: parseNum(el("startWeight").value) ?? DEFAULT_SETTINGS.startWeight,
    startDate: el("startDate").value || DEFAULT_SETTINGS.startDate,
  };
}

function refresh() {
  const metrics = computeMetrics(state.entries, state.settings);
  renderMini(metrics);
  setStatus(metrics, state.settings);
  renderTable(state.entries);
  renderChart(state.entries);
  renderStepsChart(state.entries);
}


// ==========================
// 11) INIT
// ==========================

function init() {
  el("date").value = todayISO();
  applySettingsToUI();

  initAuthUI();

  el("entryForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();

    const entry = {
      date: el("date").value,
      weight: parseNum(el("weight").value),
      steps: parseNum(el("steps").value),

      workoutType: el("workoutType").value,
      workoutMin: parseNum(el("workoutMin").value),
      workoutRpe: parseNum(el("workoutRpe").value),

      extras: parseNum(el("extras").value),
      sleep: parseNum(el("sleep").value),

      notes: el("notes").value.trim(),

      updatedAt: nowISO(),
    };

    state.entries = upsertEntry(state.entries, entry);
    saveEntries(state.entries);
    clearForm();
    refresh();

    try { await upsertEntryToCloud(entry); }
    catch (err) { console.warn("Cloud upsert falhou:", err); }
  });

  el("resetBtn").onclick = clearForm;

  el("saveSettingsBtn").onclick = () => {
    state.settings = readSettingsFromUI();
    saveSettings(state.settings);
    refresh();
    alert("Settings guardadas.");
  };

  el("resetSettingsBtn").onclick = () => {
    state.settings = { ...DEFAULT_SETTINGS, startDate: todayISO() };
    saveSettings(state.settings);
    applySettingsToUI();
    refresh();
    alert("Settings repostas.");
  };

  el("exportJsonBtn").onclick = () => exportJSON(state.entries, state.settings);
  el("exportCsvBtn").onclick = () => exportCSV(state.entries);

  el("importJsonBtn").onclick = () => el("importFile").click();
  el("importFile").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      const importedEntries = Array.isArray(payload.entries) ? payload.entries : [];
      const importedSettings = payload.settings && typeof payload.settings === "object" ? payload.settings : null;

      state.entries = normalizeEntries(importedEntries);
      saveEntries(state.entries);

      if (importedSettings) {
        state.settings = { ...DEFAULT_SETTINGS, ...importedSettings };
        saveSettings(state.settings);
        applySettingsToUI();
      }

      refresh();
      alert("Import feito com sucesso.");

      try { await doFullSync(); } catch (e) { console.warn("Sync pós-import falhou:", e); }
    } catch (err) {
      console.error(err);
      alert("Falhou o import. Confirma se é um JSON exportado pela app.");
    } finally {
      ev.target.value = "";
    }
  });

  el("wipeBtn").onclick = () => {
    const ok = confirm("Isto apaga TODOS os registos locais e settings. Tens a certeza?");
    if (!ok) return;

    localStorage.removeItem(LS_KEYS.entries);
    localStorage.removeItem(LS_KEYS.settings);
    for (const k of LEGACY_ENTRIES_KEYS) localStorage.removeItem(k);

    state.entries = [];
    state.settings = { ...DEFAULT_SETTINGS, startDate: todayISO() };
    applySettingsToUI();
    refresh();
  };

  refresh();
}

init();
