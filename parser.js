// Lecture des séances envoyées par Claude.
// Accepte : un objet séance, un tableau de séances, ou {"seances": [...]},
// éventuellement entouré de texte ou d'un bloc ```json.
//
// Une étape peut s'écrire :
//   ["Nom", minutes, pct_min, pct_max, "FC", "consigne"]   (pct_max, FC, consigne facultatifs)
//   {"nom": "...", "min": 4, "sec": 30, "pct": [115, 117], "fc": "...", "consigne": "..."}
//   "ECHAUFFEMENT" / "RETOUR_CALME"                           (blocs standards)
//   {"repeter": 5, "etapes": [...]}                           ({i} et {n} dans les noms = numéro et total)
const Parser = (() => {
  const BLOCKS = {
    ECHAUFFEMENT: [
      ["Échauffement", 5, 56, 56, "< 115", "Très facile"],
      ["Échauffement", 5, 69, 69, "115–125", "Facile"],
      ["Échauffement", 5, 83, 83, "125–130", "Point de contrôle : si FC > 140, passe en séance facile"],
      ["Accélération", 1, 107, 107, "vers 140", "Dur, sans être à fond"],
      ["Récupération", 1, 56, 56, "redescend", "Facile"],
      ["Accélération", 1, 107, 107, "vers 145", "Dur, sans être à fond"],
      ["Récupération", 3, 52, 52, "< 125", "Très facile"]
    ],
    RETOUR_CALME: [["Retour au calme", 10, 45, 56, "redescend", "Très facile, cadence libre"]]
  };
  const ALIASES = { WU: "ECHAUFFEMENT", WARMUP: "ECHAUFFEMENT", ECHAUFFEMENT: "ECHAUFFEMENT",
    CD: "RETOUR_CALME", COOLDOWN: "RETOUR_CALME", RETOUR_CALME: "RETOUR_CALME", RETOUR_AU_CALME: "RETOUR_CALME" };

  const pick = (o, ...keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k]; return undefined; };
  const num = v => typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN);
  const blockKey = s => ALIASES[String(s).trim().replace(/^@/, "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[\s-]+/g, "_")];

  // Trouve le JSON dans un texte quelconque.
  function extractJson(text) {
    text = String(text || "").trim();
    if (!text) throw new Error("Rien à lire : colle la réponse de Claude.");
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [];
    if (fence) candidates.push(fence[1]);
    candidates.push(text);
    for (const c of candidates) {
      try { return JSON.parse(c); } catch (e) { /* on essaie autre chose */ }
      const start = c.search(/[\[{]/);
      if (start < 0) continue;
      const open = c[start], close = open === "{" ? "}" : "]";
      const end = c.lastIndexOf(close);
      if (end > start) {
        const slice = c.slice(start, end + 1)
          .replace(/[“”]/g, '"')            // guillemets typographiques
          .replace(/,\s*([\]}])/g, "$1");   // virgules en trop
        try { return JSON.parse(slice); } catch (e) { /* suite */ }
      }
    }
    throw new Error("Je ne trouve pas de JSON valide dans le texte collé.");
  }

  function parseStep(raw, where, out, ctx) {
    if (typeof raw === "string") {
      const k = blockKey(raw);
      if (!k) throw new Error(`${where} : bloc « ${raw} » inconnu (utilise ECHAUFFEMENT ou RETOUR_CALME).`);
      BLOCKS[k].forEach((s, j) => parseStep(s, `${where}.${j + 1}`, out, ctx));
      return;
    }
    if (Array.isArray(raw)) {
      const [name, minutes, lo, hi, hr, cue] = raw;
      return pushStep({ name, sec: num(minutes) * 60, lo: num(lo), hi: hi === undefined || hi === null || hi === "" ? num(lo) : num(hi), hr, cue }, where, out, ctx);
    }
    if (raw && typeof raw === "object") {
      const rep = pick(raw, "repeter", "répéter", "repeat", "repetitions", "x");
      const inner = pick(raw, "etapes", "étapes", "steps");
      if (rep !== undefined && Array.isArray(inner)) {
        const n = num(rep);
        if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error(`${where} : "repeter" doit être un entier entre 1 et 50.`);
        const skipLast = pick(raw, "sans_derniere_recup", "sansDerniereRecup") !== false; // par défaut on retire la dernière récup
        for (let i = 1; i <= n; i++) {
          const sub = [];
          inner.forEach((s, j) => parseStep(s, `${where}.${j + 1}`, sub, { i, n }));
          if (i === n && skipLast && inner.length > 1 && sub.length > 1 && /r[ée]cup/i.test(sub[sub.length - 1].name)) sub.pop();
          out.push(...sub);
        }
        return;
      }
      let pct = pick(raw, "pct", "ftp", "%ftp");
      let lo, hi;
      if (Array.isArray(pct)) { lo = num(pct[0]); hi = num(pct[pct.length - 1]); }
      else if (pct !== undefined) { lo = hi = num(pct); }
      else { lo = num(pick(raw, "pct_min", "min_pct", "lo")); hi = num(pick(raw, "pct_max", "max_pct", "hi") ?? lo); }
      const minutes = num(pick(raw, "min", "minutes", "duree", "durée") ?? 0);
      const seconds = num(pick(raw, "sec", "secondes", "s") ?? 0);
      return pushStep({ name: pick(raw, "nom", "name"), sec: (isNaN(minutes) ? NaN : minutes * 60) + (isNaN(seconds) ? NaN : seconds),
        lo, hi, hr: pick(raw, "fc", "hr", "FC"), cue: pick(raw, "consigne", "cue", "note") }, where, out, ctx);
    }
    throw new Error(`${where} : étape illisible.`);
  }

  function pushStep(s, where, out, ctx) {
    let name = String(s.name ?? "").trim() || "Étape";
    if (ctx) name = name.replace(/\{i\}/g, ctx.i).replace(/\{n\}/g, ctx.n);
    if (!(s.sec > 0) || s.sec > 6 * 3600) throw new Error(`${where} (${name}) : durée invalide.`);
    if (!(s.lo >= 20 && s.lo <= 300) || !(s.hi >= 20 && s.hi <= 300)) throw new Error(`${where} (${name}) : % du FTP invalide (attendu entre 20 et 300).`);
    out.push({ name, sec: Math.round(s.sec), lo: Math.min(s.lo, s.hi), hi: Math.max(s.lo, s.hi),
      hr: s.hr == null ? "" : String(s.hr), cue: s.cue == null ? "" : String(s.cue) });
  }

  function slug(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "seance";
  }

  function parseSession(raw, where) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${where} : une séance doit être un objet {"nom": ..., "etapes": [...]}.`);
    const name = pick(raw, "nom", "name", "titre", "title");
    const stepsRaw = pick(raw, "etapes", "étapes", "steps");
    if (!name) throw new Error(`${where} : il manque "nom".`);
    if (!Array.isArray(stepsRaw) || !stepsRaw.length) throw new Error(`${where} (${name}) : il manque "etapes".`);
    const steps = [];
    stepsRaw.forEach((s, j) => parseStep(s, `${name} › étape ${j + 1}`, steps, null));
    return {
      id: String(pick(raw, "id") || slug(name)),
      name: String(name),
      type: pick(raw, "type") ? String(pick(raw, "type")) : "",
      date: pick(raw, "date") ? String(pick(raw, "date")) : "",
      notes: pick(raw, "notes", "description") ? String(pick(raw, "notes", "description")) : "",
      steps,
      source: raw // on garde l'original pour l'export / la modification
    };
  }

  function parse(text) {
    const data = typeof text === "string" ? extractJson(text) : text;
    let list;
    if (Array.isArray(data)) list = data;
    else if (data && (data.seances || data["séances"] || data.sessions)) list = data.seances || data["séances"] || data.sessions;
    else list = [data];
    if (!list.length) throw new Error("Aucune séance trouvée.");
    return list.map((s, i) => parseSession(s, `Séance ${i + 1}`));
  }

  return { parse, extractJson, BLOCKS };
})();

if (typeof module !== "undefined") module.exports = Parser;
