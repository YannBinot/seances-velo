// Séances d'origine, écrites dans le même format que celui que Claude produit.
// Étape : [nom, minutes, %FTP_min, %FTP_max, FC_attendue, consigne]
// "ECHAUFFEMENT" et "RETOUR_CALME" sont des blocs standards (voir parser.js).
const BUILTIN_SESSIONS = [
  {
    id: "vo2-5x4",
    nom: "VO2max — 5 × 4 min",
    type: "vo2",
    notes: "Cadence 90–100 rpm. Arrête la série si une répétition tombe sous 275 W.",
    etapes: [
      "ECHAUFFEMENT",
      ["Répétition 1/5", 4, 113, 115, "155–162", "Très dur · 90–100 rpm"],
      ["Récupération", 4, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 2/5", 4, 115, 117, "160–165", "Très dur · 90–100 rpm"],
      ["Récupération", 4, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 3/5", 4, 115, 117, "162–167", "Très dur · 90–100 rpm"],
      ["Récupération", 4, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 4/5", 4, 115, 117, "163–168", "Très dur · 90–100 rpm"],
      ["Récupération", 4, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 5/5", 4, 115, 119, "165–170", "Très dur · arrête si < 275 W"],
      "RETOUR_CALME"
    ]
  },
  {
    id: "seuil-3x10",
    nom: "Seuil — 3 × 10 min",
    type: "seuil",
    etapes: [
      "ECHAUFFEMENT",
      ["Répétition 1/3", 10, 95, 97, "~145", "Dur et contrôlé · 85–95 rpm"],
      ["Récupération", 5, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 2/3", 10, 95, 97, "~150", "Dur et contrôlé · 85–95 rpm"],
      ["Récupération", 5, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 3/3", 10, 97, 101, "~155", "Dur et contrôlé · 85–95 rpm"],
      "RETOUR_CALME"
    ]
  },
  {
    id: "col-2x20",
    nom: "Col — 2 × 20 min",
    type: "col",
    etapes: [
      ["Échauffement", 5, 56, 56, "< 115", "Très facile"],
      ["Échauffement", 5, 69, 69, "115–125", "Facile"],
      ["Échauffement", 5, 83, 83, "125–130", "Point de contrôle : si FC > 140, passe en séance facile"],
      ["Récupération", 3, 52, 52, "< 125", "Très facile"],
      ["Répétition 1/2", 20, 88, 93, "145–155", "Régulier comme dans un col · 75–85 rpm"],
      ["Récupération", 5, 48, 54, "< 135", "Très facile, récupère vraiment"],
      ["Répétition 2/2", 20, 88, 93, "150–158", "Régulier comme dans un col · 75–85 rpm"],
      "RETOUR_CALME"
    ]
  },
  {
    id: "recup-45",
    nom: "Récupération — 45 min",
    type: "recup",
    etapes: [
      ["Récupération", 45, 56, 63, "< 125", "Mode ERG · ne dépasse pas 160 W"]
    ]
  }
];
