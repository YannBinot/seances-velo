"use strict";
const VERSION = "1.0.0";

/* ---------- utilitaires ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, def) { try { const v = localStorage.getItem("sv." + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem("sv." + k, JSON.stringify(v)); } catch (e) { toast("Impossible d'enregistrer (stockage plein ?)"); } },
  del(k) { try { localStorage.removeItem("sv." + k); } catch (e) {} }
};
function toast(msg, ms = 2200) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms);
}
async function copy(text, okMsg = "Copié") {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(okMsg); } catch (e2) { toast("Copie impossible"); }
    ta.remove();
  }
}

/* ---------- état persistant ---------- */
let ftp = store.get("ftp", 252);
let settings = Object.assign({ beep: true, voice: true, pre: true }, store.get("settings", {}));
let library = store.get("sessions", null);           // séances au format brut (comme Claude les écrit)
if (!Array.isArray(library)) { library = JSON.parse(JSON.stringify(BUILTIN_SESSIONS)); store.set("sessions", library); }
let journal = store.get("history", []);

function sessions() {
  const out = [];
  for (const raw of library) {
    try { out.push(Parser.parse(raw)[0]); } catch (e) { console.warn("Séance illisible", raw, e); }
  }
  return out;
}
const findSession = id => sessions().find(s => s.id === id);
const saveLibrary = () => store.set("sessions", library);
const idOf = r => { try { return Parser.parse(r)[0].id; } catch (e) { return null; } };
const rawOf = id => library.find(r => idOf(r) === id);

/* ---------- calculs ---------- */
const zoneOf = p => p < 60 ? 1 : p < 76 ? 2 : p < 90 ? 3 : p < 106 ? 4 : 5;
const W = p => Math.round(ftp * p / 100);
const wattsTxt = s => s.lo === s.hi ? `${W(s.lo)}` : `${W(s.lo)}–${W(s.hi)}`;
const pctTxt = s => s.lo === s.hi ? `${s.lo} %` : `${s.lo}–${s.hi} %`;
const total = steps => steps.reduce((a, s) => a + s.sec, 0);
const clock = sec => { sec = Math.max(0, Math.ceil(sec - 1e-6)); const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; };
const dur = sec => { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : s ? `${m}:${String(s).padStart(2, "0")}` : `${m} min`; };
const stepDur = sec => sec % 60 ? (sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`) : `${sec / 60} min`;

function profile(steps) {   // mini graphique de la séance
  const tot = total(steps), max = Math.max(120, ...steps.map(s => s.hi));
  return `<div class="profile">${steps.map(s => `<i style="flex-grow:${s.sec / tot};height:${Math.max(8, s.hi / max * 100)}%;background:var(--z${zoneOf(s.hi)})"></i>`).join("")}</div>`;
}

/* ---------- navigation (hash) ---------- */
let navigated = false;
const go = h => { navigated = true; location.hash = h; };
function back() { if (navigated && window.history.length > 1) window.history.back(); else location.hash = ""; }
function route() {
  const [view, arg] = location.hash.replace(/^#/, "").split("/").map(decodeURIComponent);
  document.querySelectorAll(".view").forEach(v => v.hidden = true);
  $("v-ride").hidden = true;
  document.body.classList.toggle("riding", view === "ride");
  if (view === "ride" && ride) { $("v-ride").hidden = false; renderRide(); keepAwake(true); return; }
  keepAwake(false);
  if (view === "detail" && findSession(arg)) { showDetail(arg); $("v-detail").hidden = false; }
  else if (view === "import") { showImport(arg); $("v-import").hidden = false; }
  else if (view === "history") { showHistory(); $("v-history").hidden = false; }
  else if (view === "settings") { showSettings(); $("v-settings").hidden = false; }
  else { showHome(); $("v-home").hidden = false; }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) go(g.dataset.go);
  if (e.target.closest("[data-back]")) back();
});

/* ---------- accueil ---------- */
function showHome() {
  $("ftp").value = ftp;
  const list = sessions();
  $("lib").innerHTML = list.length ? list.map(s => `
    <li><button data-id="${esc(s.id)}">
      <span class="l-name">${esc(s.name)}</span>
      <span class="l-meta">${dur(total(s.steps))}${s.date ? " · " + esc(s.date) : ""}</span>
      ${profile(s.steps)}
    </button></li>`).join("") : `<li class="muted">Aucune séance. Ajoute celle que Claude t'a proposée.</li>`;
  const r = store.get("ride", null);
  const rs = r && findSession(r.id);
  $("resume").hidden = !rs;
  if (rs) $("resume").innerHTML = `Séance en cours : <b>${esc(rs.name)}</b> — reprendre ›`;
}
$("lib").addEventListener("click", e => { const b = e.target.closest("button[data-id]"); if (b) go("detail/" + encodeURIComponent(b.dataset.id)); });
$("resume").addEventListener("click", () => { const r = store.get("ride", null); if (r) { openRide(r.id, r); } });
function setFtp(v) { v = +v; if (v >= 100 && v <= 500) { ftp = Math.round(v); store.set("ftp", ftp); toast(`FTP : ${ftp} W`); } }
$("ftp").addEventListener("change", e => { setFtp(e.target.value); showHome(); });

/* ---------- détail ---------- */
let detailId = null;
function stepsHtml(steps, cur = -1) {
  return steps.map((s, i) => `<li class="${i < cur ? "done" : i === cur ? "cur" : ""}" style="--zc:var(--z${zoneOf(s.hi)})">
    <button data-i="${i}"><span class="dot"></span><span class="sn">${esc(s.name)}<small>${esc(s.hr ? "♥ " + s.hr : "")}</small></span>
    <span class="w">${wattsTxt(s)} W</span><span class="d">${stepDur(s.sec)}</span></button></li>`).join("");
}
function showDetail(id) {
  detailId = id; const s = findSession(id);
  $("d-name").textContent = s.name;
  $("d-meta").textContent = `${dur(total(s.steps))} · ${s.steps.length} étapes · FTP ${ftp} W${s.date ? " · prévue le " + s.date : ""}`;
  $("d-notes").textContent = s.notes; $("d-notes").hidden = !s.notes;
  $("d-steps").innerHTML = stepsHtml(s.steps);
}
$("d-start").addEventListener("click", () => openRide(detailId));
$("d-edit").addEventListener("click", () => go("import/" + encodeURIComponent(detailId)));
$("d-copy").addEventListener("click", () => { copy(pretty(rawOf(detailId)), "JSON copié"); });
$("d-del").addEventListener("click", () => {
  const s = findSession(detailId);
  if (!confirm(`Supprimer « ${s.name} » ?`)) return;
  library = library.filter(r => idOf(r) !== detailId);
  saveLibrary(); toast("Séance supprimée"); location.hash = "";
});

/* JSON lisible : une étape par ligne */
function pretty(raw) {
  return JSON.stringify(raw, null, 2).replace(/\[\s*\n([^\[\]{}]*?)\n\s*\]/g, (m, inner) => "[" + inner.trim().split(/,\s*\n\s*/).join(", ") + "]");
}

/* ---------- import / édition ---------- */
let pending = null, editingId = null;
function showImport(id) {
  editingId = id && findSession(id) ? id : null;
  $("i-title").textContent = editingId ? "Modifier la séance" : "Ajouter une séance";
  if (editingId) { $("i-text").value = pretty(rawOf(editingId)); }
  else if (!showImport.keep) $("i-text").value = "";
  showImport.keep = false;
  pending = null; $("i-save").disabled = true; $("i-preview").innerHTML = ""; $("i-msg").hidden = true;
  if ($("i-text").value) check();
}
function check() {
  const msg = $("i-msg");
  try {
    pending = Parser.parse($("i-text").value);
    msg.className = "msg ok"; msg.hidden = false;
    msg.textContent = pending.length > 1 ? `${pending.length} séances reconnues.` : "Séance reconnue.";
    $("i-preview").innerHTML = pending.map(s => `<div class="card"><b>${esc(s.name)}</b> <span class="muted">· ${dur(total(s.steps))} · ${s.steps.length} étapes</span>${profile(s.steps)}<ol class="steps mini">${stepsHtml(s.steps)}</ol></div>`).join("");
    $("i-save").disabled = false;
  } catch (e) {
    pending = null; $("i-save").disabled = true; $("i-preview").innerHTML = "";
    msg.className = "msg err"; msg.hidden = false; msg.textContent = e.message;
  }
}
$("i-check").addEventListener("click", check);
$("i-text").addEventListener("input", () => { clearTimeout(check.t); check.t = setTimeout(check, 500); });
$("i-paste").addEventListener("click", async () => {
  try { $("i-text").value = await navigator.clipboard.readText(); check(); }
  catch (e) { toast("Accès refusé : appuie longuement dans la zone de texte puis « Coller »", 3500); }
});
$("i-save").addEventListener("click", () => {
  if (!pending) return;
  if (editingId) library = library.filter(r => idOf(r) !== editingId);
  for (const s of pending) {
    const raw = Object.assign({ id: s.id }, s.source);
    const existing = library.findIndex(r => idOf(r) === s.id);
    if (existing >= 0) {
      if (!confirm(`« ${s.name} » existe déjà. La remplacer ?`)) { raw.id = s.id + "-" + Date.now().toString(36); library.unshift(raw); continue; }
      library[existing] = raw;
    } else library.unshift(raw);
  }
  saveLibrary();
  toast(pending.length > 1 ? `${pending.length} séances enregistrées` : "Séance enregistrée");
  const one = pending.length === 1 ? (library.find(r => idOf(r) === pending[0].id) ? pending[0].id : null) : null;
  location.hash = one ? "detail/" + encodeURIComponent(one) : "";
});

/* ---------- historique ---------- */
function showHistory() {
  $("hist").innerHTML = journal.length ? journal.slice().reverse().map((h, ri) => {
    const i = journal.length - 1 - ri;
    return `<li class="card"><div class="h-top"><b>${esc(h.name)}</b><span class="muted">${new Date(h.at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span></div>
      <div class="muted">${dur(h.done)}${h.complete ? "" : ` sur ${dur(h.total)} (partielle)`} · FTP ${h.ftp} W</div>
      ${h.notes ? `<p class="notes">${esc(h.notes)}</p>` : ""}
      <div class="actions"><button class="btn sm" data-copy="${i}">Copier pour Claude</button><button class="btn sm danger" data-del="${i}">Supprimer</button></div></li>`;
  }).join("") : `<li class="muted">Aucune séance enregistrée pour l'instant.</li>`;
}
$("hist").addEventListener("click", e => {
  const c = e.target.closest("[data-copy]"), d = e.target.closest("[data-del]");
  if (c) copy(summary(journal[+c.dataset.copy]), "Résumé copié");
  if (d && confirm("Supprimer cette entrée ?")) { journal.splice(+d.dataset.del, 1); store.set("history", journal); showHistory(); }
});
function summary(h) {
  const d = new Date(h.at).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return `Séance « ${h.name} » faite le ${d} (FTP ${h.ftp} W) : ${h.complete ? "complète" : `partielle, ${dur(h.done)} sur ${dur(h.total)}`}, ${dur(h.done)}.` +
    (h.notes ? `\nMes notes : ${h.notes}` : "") + `\nPeux-tu l'analyser avec mes données Strava ?`;
}

/* ---------- réglages ---------- */
const PROMPT = `Pour mes séances de home trainer, j'utilise une appli qui lit tes séances. Quand tu me proposes une séance, termine ta réponse par un bloc \`\`\`json contenant UNIQUEMENT la séance, dans ce format :

{
  "id": "vo2-6x4",
  "nom": "VO2max — 6 × 4 min",
  "date": "2026-11-13",
  "notes": "Consignes générales (facultatif)",
  "etapes": [
    "ECHAUFFEMENT",
    {"repeter": 6, "etapes": [
      ["Répétition {i}/{n}", 4, 115, 117, "160–168", "Très dur · 90–100 rpm"],
      ["Récupération", 4, 48, 54, "< 135", "Très facile"]
    ]},
    "RETOUR_CALME"
  ]
}

Règles :
- Une étape = ["Nom", minutes, %FTP_min, %FTP_max, "FC attendue", "Consigne courte"]. Les minutes peuvent être décimales (0.5 = 30 s). Mets les % du FTP, pas les watts : l'appli calcule les watts avec mon FTP.
- "ECHAUFFEMENT" = mon échauffement commun de 21 min (5 min à 56 %, 5 à 69 %, 5 à 83 % avec contrôle FC < 140, 2 accélérations de 1 min à 107 %, 3 min à 52 %). "RETOUR_CALME" = 10 min à 45–56 %. Tu peux aussi écrire un échauffement différent étape par étape.
- {"repeter": n, "etapes": [...]} répète un bloc ; {i} et {n} sont remplacés par le numéro et le total. La dernière récupération du bloc est retirée automatiquement.
- Si une répétition doit avoir une cible différente (ex. la dernière plus dure), écris les étapes une par une au lieu d'utiliser "repeter".
- Consignes courtes (moins de 60 caractères) : elles s'affichent sur un demi-écran de téléphone.
- "id" : court, sans espaces ; même id = la séance remplace l'ancienne.
- Plusieurs séances d'un coup : un tableau [ {...}, {...} ].`;

function showSettings() {
  $("s-ftp").value = ftp; $("s-beep").checked = settings.beep; $("s-voice").checked = settings.voice; $("s-pre").checked = settings.pre;
  $("s-version").textContent = VERSION;
}
$("s-ftp").addEventListener("change", e => setFtp(e.target.value));
for (const k of ["beep", "voice", "pre"]) $("s-" + k).addEventListener("change", e => { settings[k] = e.target.checked; store.set("settings", settings); });
$("s-test").addEventListener("click", () => { unlockAudio(); beep(660); setTimeout(() => beep(1046, .35), 400); say("Répétition 1 sur 5. " + W(115) + " watts, pendant 4 minutes.", true); });
$("s-prompt").addEventListener("click", () => copy(PROMPT, "Instructions copiées : colle-les dans Claude"));
$("s-export").addEventListener("click", () => copy(JSON.stringify({ version: VERSION, ftp, settings, seances: library, historique: journal }, null, 1), "Données copiées"));
$("s-restore").addEventListener("click", () => {
  if (!confirm("Remettre les 4 séances d'origine (tes séances ajoutées sont conservées) ?")) return;
  const ids = new Set(library.map(r => r.id));
  for (const b of BUILTIN_SESSIONS) if (!ids.has(b.id)) library.push(JSON.parse(JSON.stringify(b)));
  saveLibrary(); toast("Séances d'origine restaurées");
});

/* ---------- son, voix, écran allumé ---------- */
let actx = null, wake = null, wantAwake = false;
function unlockAudio() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch (e) {}
}
function beep(freq = 880, d = .12, vol = .35) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + d); o.start(t); o.stop(t + d);
  } catch (e) {}
}
let frVoice = null;
function pickVoice() { try { const v = speechSynthesis.getVoices(); frVoice = v.find(x => /^fr[-_]FR/i.test(x.lang)) || v.find(x => /^fr/i.test(x.lang)) || null; } catch (e) {} }
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, force = false) {
  if ((!settings.voice && !force) || !("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "fr-FR"; if (frVoice) u.voice = frVoice; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch (e) {}
}
const spoken = s => s.name.replace(/(\d+)\s*\/\s*(\d+)/g, "$1 sur $2");
const spokenWatts = s => s.lo === s.hi ? `${W(s.lo)} watts` : `${W(s.lo)} à ${W(s.hi)} watts`;
const spokenDur = sec => { const m = Math.floor(sec / 60), s = sec % 60;
  return [m ? `${m} minute${m > 1 ? "s" : ""}` : "", s ? `${s} secondes` : ""].filter(Boolean).join(" "); };

async function keepAwake(on) {
  wantAwake = on;
  try {
    if (on && !wake && "wakeLock" in navigator && document.visibilityState === "visible") {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    } else if (!on && wake) { await wake.release(); wake = null; }
  } catch (e) {}
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { if (wantAwake) keepAwake(true); if (ride) tick(); }
});

/* ---------- moteur de séance ----------
   La position est un temps (s) depuis le début de la séance : base + (maintenant − startedAt).
   Ça reste juste même si le téléphone met l'appli en pause ou si la page est rechargée. */
let ride = null;   // {id, s (séance), starts[], tot, base, startedAt|null, lastPos}
let timer = null;

function openRide(id, saved) {
  const s = findSession(id); if (!s) { toast("Séance introuvable"); return; }
  const starts = []; let acc = 0; for (const st of s.steps) { starts.push(acc); acc += st.sec; }
  ride = { id, s, starts, tot: acc, base: 0, startedAt: null, lastPos: 0 };
  if (saved && saved.id === id) {
    ride.base = saved.base || 0; ride.startedAt = saved.startedAt || null;
    if (ride.startedAt) startTimer();
    ride.lastPos = pos();
  }
  $("r-end").hidden = true; $("r-sheet").hidden = true;
  $("r-steps").innerHTML = stepsHtml(s.steps);
  persistRide();
  go("ride");
  if (location.hash === "#ride") route();
}
const pos = () => !ride ? 0 : Math.min(ride.tot, ride.base + (ride.startedAt ? (Date.now() - ride.startedAt) / 1000 : 0));
const idxAt = p => { let i = 0; while (i + 1 < ride.starts.length && ride.starts[i + 1] <= p) i++; return i; };
const running = () => !!(ride && ride.startedAt);
function persistRide() { if (ride) store.set("ride", { id: ride.id, base: ride.base, startedAt: ride.startedAt }); }

function startTimer() { clearInterval(timer); timer = setInterval(tick, 200); }
function play() {
  unlockAudio();
  if (running()) { ride.base = pos(); ride.startedAt = null; clearInterval(timer); }
  else {
    if (pos() >= ride.tot) seek(0);
    ride.startedAt = Date.now(); startTimer();
    if (ride.base < 1) { const s = ride.s.steps[0]; say(`C'est parti. ${spoken(s)}, ${spokenWatts(s)}, ${spokenDur(s.sec)}.`); }
  }
  ride.lastPos = pos(); persistRide(); renderRide();
}
function seek(p) {
  ride.base = Math.max(0, Math.min(ride.tot, p));
  if (ride.startedAt) ride.startedAt = Date.now();
  ride.lastPos = ride.base; persistRide(); renderRide();
}
function tick() {
  if (!ride) return;
  const p = pos(), prev = ride.lastPos; ride.lastPos = p;
  if (p - prev > 0 && p - prev < 3) {        // pas de rafale de bips après une longue mise en veille
    if (settings.beep) for (const t of [3, 2, 1]) if (prev < ride.tot - t && ride.tot - t <= p) beep(660);
    ride.starts.forEach((b, i) => {
      if (i === 0) return;
      const s = ride.s.steps[i];
      if (settings.pre && prev < b - 10 && b - 10 <= p && ride.s.steps[i - 1].sec > 20)
        say(`Dans 10 secondes : ${spoken(s)}, ${spokenWatts(s)}.`);
      if (settings.beep) for (const t of [3, 2, 1]) if (prev < b - t && b - t <= p) beep(660);
      if (prev < b && b <= p) {
        if (settings.beep) beep(1046, .4);
        say(`${spoken(s)}. ${spokenWatts(s)}, ${spokenDur(s.sec)}.${s.cue && s.cue.length < 50 ? " " + s.cue.replace(/·/g, ",") : ""}`);
      }
    });
  }
  if (p >= ride.tot && running()) { finish(true); return; }
  renderRide();
}

function renderRide() {
  if (!ride || $("v-ride").hidden) return;
  const p = pos(), i = idxAt(p), s = ride.s.steps[i], st = ride.s.steps, z = zoneOf(s.hi);
  const inStep = p - ride.starts[i], left = s.sec - inStep;
  const el = $("v-ride");
  el.style.setProperty("--zc", `var(--z${z})`);
  $("r-name").textContent = s.name;
  $("r-count").textContent = `${i + 1}/${st.length}`;
  $("r-watts").textContent = wattsTxt(s);
  el.classList.toggle("range", s.lo !== s.hi);
  $("r-time").textContent = clock(left);
  $("r-time").classList.toggle("warn", running() && left <= 3.05);
  $("r-pct").textContent = pctTxt(s); $("r-zone").textContent = z; $("r-hr").textContent = s.hr || "—";
  $("r-cue").textContent = s.cue; $("r-cue").hidden = !s.cue;
  const n = st[i + 1];
  $("r-next").innerHTML = n ? `${esc(n.name)} · <span style="color:var(--z${zoneOf(n.hi)})">${wattsTxt(n)} W</span> · ${stepDur(n.sec)}` : "Fin de séance";
  $("r-sbar").style.width = `${Math.min(100, inStep / s.sec * 100)}%`;
  $("r-tbar").style.width = `${Math.min(100, p / ride.tot * 100)}%`;
  $("r-el").textContent = `${dur(p)} écoulé`; $("r-rem").textContent = `reste ${dur(ride.tot - p)}`;
  $("r-play").textContent = running() ? "Pause" : p > 0 ? "Reprendre" : "Démarrer";
  $("r-play").classList.toggle("paused", !running() && p > 0);
  if (renderRide.lastIdx !== i || renderRide.lastId !== ride.id) {
    renderRide.lastIdx = i; renderRide.lastId = ride.id;
    [...$("r-steps").children].forEach((li, j) => li.className = j < i ? "done" : j === i ? "cur" : "");
  }
}

function finish(complete) {
  const p = pos();
  ride.base = p; ride.startedAt = null; clearInterval(timer); persistRide();
  if (complete) { beep(1046, .7); say("Séance terminée. Bravo !"); }
  ride.result = { complete, done: Math.round(p) };
  $("r-end-sum").textContent = `${ride.s.name} · ${dur(p)}${complete ? "" : ` sur ${dur(ride.tot)}`}`;
  $("r-notes").value = "";
  $("r-end").hidden = false; renderRide();
}
function closeRide() {
  clearInterval(timer); ride = null; store.del("ride"); keepAwake(false); location.hash = "";
}
function saveResult() {
  const h = { at: new Date().toISOString(), id: ride.id, name: ride.s.name, done: ride.result.done, total: ride.tot,
    complete: ride.result.complete, ftp, notes: $("r-notes").value.trim() };
  journal.push(h); store.set("history", journal);
  return h;
}

$("r-play").addEventListener("click", play);
$("r-skip").addEventListener("click", () => { const i = idxAt(pos()); if (i < ride.starts.length - 1) seek(ride.starts[i + 1]); });
$("r-prev").addEventListener("click", () => { const p = pos(), i = idxAt(p); seek(p - ride.starts[i] > 5 || i === 0 ? ride.starts[i] : ride.starts[i - 1]); });
$("r-list").addEventListener("click", () => { $("r-sheet").hidden = false; const c = $("r-steps").querySelector(".cur"); if (c) c.scrollIntoView({ block: "center" }); });
$("r-sheet-close").addEventListener("click", () => $("r-sheet").hidden = true);
$("r-steps").addEventListener("click", e => { const b = e.target.closest("button[data-i]"); if (b) { seek(ride.starts[+b.dataset.i]); $("r-sheet").hidden = true; } });
$("r-close").addEventListener("click", () => {
  const p = pos();
  if (p < 60) { if (!running() || confirm("Quitter la séance ?")) closeRide(); return; }
  if (confirm("Arrêter la séance ? Tu pourras l'enregistrer comme partielle.")) finish(false);
});
$("r-save").addEventListener("click", () => { saveResult(); toast("Séance enregistrée dans l'historique"); closeRide(); });
$("r-copysum").addEventListener("click", () => { const h = saveResult(); copy(summary(h), "Résumé copié : colle-le dans Claude"); closeRide(); });

/* ---------- partage depuis l'appli Claude (Web Share Target) ---------- */
(function handleShare() {
  const q = new URLSearchParams(location.search);
  if (!q.has("text") && !q.has("title") && !q.has("url")) return;
  const text = [q.get("text"), q.get("title"), q.get("url")].filter(Boolean).join("\n");
  window.history.replaceState(null, "", location.pathname + "#import");
  $("i-text").value = text; showImport.keep = true;
})();

/* ---------- démarrage ---------- */
(function boot() {
  // une séance en cours (page rechargée, appli tuée par Android) ? on la reprend
  const saved = store.get("ride", null);
  if (saved && findSession(saved.id) && location.hash === "#ride") { openRide(saved.id, saved); }
  else if (location.hash === "#ride") location.hash = "";
  route();
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
