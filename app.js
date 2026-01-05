const LS_KEYS = {
  entries: "projetoJunho.entries.v1",
  settings: "projetoJunho.settings.v1",
};

const DEFAULT_SETTINGS = {
  goalWeight: 85.0,
  goalDate: "2026-06-04",
  startWeight: 105.0,
  startDate: todayISO(),
};

let chart = null;

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

function loadEntries() {
  const raw = localStorage.getItem(LS_KEYS.entries);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // normalize + sort
    return arr
      .map((e) => ({
        date: e.date,
        weight: parseNum(e.weight),
        steps: parseNum(e.steps),
        workout: e.workout || "none",
        extras: parseNum(e.extras),
        sleep: parseNum(e.sleep),
        notes: String(e.notes || ""),
      }))
      .filter((e) => typeof e.date === "string" && e.date.length >= 10)
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
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
  // assumes entries sorted by date
  const byDate = entries.slice().sort((a, b) => a.date.localeCompare(b.date));
  const tail = byDate.slice(-Math.max(n, 0));
  return tail;
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

function computeMetrics(entries, settings) {
  const last7 = lastNDaysEntries(entries, 7);
  const avg7w = avg(last7.map((e) => e.weight).filter((x) => x !== null));
  const avg7s = avg(last7.map((e) => e.steps).filter((x) => x !== null));

  const today = todayISO();
  const daysLeft = dateDiffDays(today, settings.goalDate);

  // current weight proxy: avg7w, else last known weight, else startWeight
  let currentWeight = avg7w;
  if (currentWeight === null) {
    const lastWithWeight = [...entries].reverse().find((e) => e.weight !== null);
    currentWeight = lastWithWeight?.weight ?? settings.startWeight;
  }

  // pace: kg/week needed to reach goal
  const weeksLeft = daysLeft > 0 ? daysLeft / 7 : 0;
  const kgToGo = currentWeight - settings.goalWeight;
  const neededPerWeek = weeksLeft > 0 ? (kgToGo / weeksLeft) : null;

  // recent trend (approx): last 14 days avg - previous 14 days avg
  const last28 = lastNDaysEntries(entries, 28);
  const first14 = last28.slice(0, Math.max(0, last28.length - 14));
  const last14 = last28.slice(-14);

  const avgFirst14 = avg(first14.map((e) => e.weight).filter((x) => x !== null));
  const avgLast14 = avg(last14.map((e) => e.weight).filter((x) => x !== null));
  const change14 = (avgLast14 !== null && avgFirst14 !== null) ? (avgLast14 - avgFirst14) : null; // negative is good
  const perWeek14 = change14 !== null ? (change14 / 2) : null; // 2 weeks

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
  const recent = metrics.perWeek14; // negative means losing

  const neededTxt = needed === null ? "—" : `${fmt(needed, 2)} kg/sem (aprox.)`;
  const recentTxt = recent === null ? "—" : `${fmt(recent, 2)} kg/sem (últ. 14 dias)`;

  // Interpret
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
    // needed is positive kg/week to lose; recent is negative for losing
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

  const rows = [...entries].reverse(); // newest first
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
    tr.appendChild(td(e.workout === "none" ? "" : e.workout));
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

  // 7-day moving average (simple)
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
      plugins: {
        legend: { display: true },
        tooltip: { enabled: true },
      },
    },
  });
}

function exportJSON(entries, settings) {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings,
    entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  downloadBlob(blob, `projeto-junho-backup-${todayISO()}.json`);
}

function exportCSV(entries) {
  const header = ["date","weight","steps","workout","extras","sleep","notes"];
  const lines = [header.join(",")];

  for (const e of entries) {
    const row = [
      e.date,
      e.weight ?? "",
      e.steps ?? "",
      e.workout ?? "none",
      e.extras ?? "",
      e.sleep ?? "",
      (e.notes ?? "").replaceAll('"','""'),
    ];
    // quote notes
    row[6] = `"${row[6]}"`;
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
  el("workout").value = e.workout ?? "none";
  el("extras").value = e.extras ?? "";
  el("sleep").value = e.sleep ?? "";
  el("notes").value = e.notes ?? "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearForm() {
  el("date").value = todayISO();
  el("weight").value = "";
  el("steps").value = "";
  el("workout").value = "none";
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
}

function init() {
  // defaults
  el("date").value = todayISO();
  applySettingsToUI();

  // form submit
  el("entryForm").addEventListener("submit", (ev) => {
    ev.preventDefault();

    const entry = {
      date: el("date").value,
      weight: parseNum(el("weight").value),
      steps: parseNum(el("steps").value),
      workout: el("workout").value,
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

  // settings
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

  // export/import
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

      state.entries = importedEntries
        .map((e) => ({
          date: e.date,
          weight: parseNum(e.weight),
          steps: parseNum(e.steps),
          workout: e.workout || "none",
          extras: parseNum(e.extras),
          sleep: parseNum(e.sleep),
          notes: String(e.notes || ""),
        }))
        .filter((e) => typeof e.date === "string" && e.date.length >= 10)
        .sort((a, b) => a.date.localeCompare(b.date));

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
    state.entries = [];
    state.settings = { ...DEFAULT_SETTINGS, startDate: todayISO() };
    applySettingsToUI();
    refresh();
  };

  refresh();
}

init();
