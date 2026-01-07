const LS_KEYS = {
  entries: "projetoJunho.entries.v2",
  settings: "projetoJunho.settings.v1",
};

const DEFAULT_SETTINGS = {
  goalWeight: 85.0,
  goalDate: "2026-06-04",
  startWeight: 105.0,
  startDate: todayISO(),
};

let chart = null;
let stepsChart = null;

const el = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseNum(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

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

/**
 * MIGRAÇÃO AUTOMÁTICA:
 * - v1 guardava workout: "A"/"B"/"none"
 * - v2 usa workoutType: "strengthA"/"strengthB"/"none" + (min/rpe)
 * Também tenta importar dados do storage antigo se existirem.
 */
function loadEntries() {
  // Primeiro tenta o formato v2
  const rawV2 = localStorage.getItem(LS_KEYS.entries);
  if (rawV2) {
    try {
      const arr = JSON.parse(rawV2);
      return normalizeEntries(arr);
    } catch {
      // cai abaixo
    }
  }

  // Tenta procurar um storage antigo (v1) se existir
  const legacyKey = "projetoJunho.entries.v1";
  const rawLegacy = localStorage.getItem(legacyKey);
  if (rawLegacy) {
    try {
      const arr = JSON.parse(rawLegacy);
      const normalized = normalizeEntries(arr);
      // guarda já em v2 para não perder
      saveEntries(normalized);
      return normalized;
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeEntries(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((e) => {
      // migração de workout antigo
      let workoutType = e.workoutType;
      if (!workoutType && e.workout) {
        if (e.workout === "A") workoutType = "strengthA";
        else if (e.workout === "B") workoutType = "strengthB";
        else workoutType = "none";
      }

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
      };
    })
    .filter((e) => typeof e.date === "string" && e.date.length >= 10)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function saveEntries(entries) {
  localStorage.setItem(LS_KEYS.entries, JSON.stringify(entries));
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

function computeMetrics(entries, settings) {
  const last7 = lastNDaysEntries(entries, 7);
  const avg7w = avg(last7.map((e) => e.weight).filter((x) => x !== null));
  const avg7s = avg(last7.map((e) => e.steps).filter((x) => x !== null));

  const today = todayISO();
  const daysLeft = dateDiffDays(today, settings.goalDate);

  // current weight proxy
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
  const change14 = (avgLast14 !== null && avgFirst14 !== null) ? (avgLast14 - avgFirst14) : null; // negative is good
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

  if (needed !== null && needed <= 1.0) {
    headline = "Ritmo sustentável (bom)";
    cls = "ok";
  }
  if (needed !== null && needed > 1.0) {
    headline = "Meta agressiva";
    cls = "warn";
  }
  if (needed !== null && needed > 1.3) {
    headline = "Muito agressivo";
    cls = "bad";
  }

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
    delBtn.onclick = () => {
      const ok = confirm(`Apagar o registo de ${e.date}?`);
      if (!ok) return;
      state.entries = deleteEntry(state.entries, e.date);
      saveEntries(state.entries);
      refresh();
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
  const data = entries.filter((e) => e.steps !== null);

  const labels = data.map((e) => e.date);
  const steps = data.map((e) => e.steps);

  // média móvel 7 dias (opcional, ajuda muito)
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

function exportJSON(entries, settings) {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings,
    entries,
    version: "v2",
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `projeto-junho-backup-${todayISO()}.json`);
}

function exportCSV(entries) {
  const header = ["date","weight","steps","workoutType","workoutMin","workoutRpe","extras","sleep","notes"];
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
    ];
    row[8] = `"${row[8]}"`;
    lines.push(row.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `projeto-junho-${todayISO()}.csv`);
}

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

const state = {
  settings: loadSettings(),
  entries: loadEntries(),
};

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

function init() {
  el("date").value = todayISO();
  applySettingsToUI();

  el("entryForm").addEventListener("submit", (ev) => {
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
    };

    state.entries = upsertEntry(state.entries, entry);
    saveEntries(state.entries);
    clearForm();
    refresh();
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

      if (importedSettings) {
        state.settings = { ...DEFAULT_SETTINGS, ...importedSettings };
        saveSettings(state.settings);
        applySettingsToUI();
      }

      saveEntries(state.entries);
      refresh();
      alert("Import feito com sucesso.");
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

    // também remove a key antiga se existir
    localStorage.removeItem("projetoJunho.entries.v1");

    state.entries = [];
    state.settings = { ...DEFAULT_SETTINGS, startDate: todayISO() };
    applySettingsToUI();
    refresh();
  };

  refresh();
}

init();
