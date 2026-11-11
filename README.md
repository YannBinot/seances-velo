# Séances vélo

Minuteur de séances de home trainer, conçu pour un téléphone Android en **écran partagé** : l'appli du vélo (puissance, cardio) occupe une moitié de l'écran, « Séances vélo » l'autre.

👉 **Appli en ligne : https://yannbinot.github.io/seances-velo/**
(À ouvrir dans Chrome sur Android, puis menu ⋮ et « Installer l'application ».)

Fonctions principales :
- Bibliothèque de séances, avec import par copier-coller ou par le menu Partager d'Android.
- Écran de séance : watts cibles, compte à rebours, zone, % du FTP, FC attendue, consigne et étape suivante. Il reste lisible sur un demi-écran.
- Enchaînement automatique des étapes, bips 3-2-1, annonces vocales, écran maintenu allumé.
- Historique avec notes, et résumé à copier pour l'analyse.
- Fonctionne hors ligne une fois installée.

---

## 1. Choix techniques en bref

| Choix | Pourquoi |
|---|---|
| **PWA** (Progressive Web App) plutôt qu'une appli native | Pas de SDK Android, pas de compilation, pas de Play Store. Une page web, une fois installée, se comporte comme une appli : icône, plein écran, écran partagé, hors ligne. |
| **HTML + CSS + JavaScript « vanilla »**, sans framework ni build | Environ 600 lignes au total. On ouvre le fichier, on le modifie, on pousse. Rien à installer pour développer. |
| **Données dans le téléphone** (`localStorage`) | Ni serveur, ni compte, ni base de données. Chaque téléphone garde ses propres séances et son historique. |
| **GitHub Pages** pour l'hébergement | Gratuit, en HTTPS (obligatoire pour une PWA), mis à jour à chaque `git push`. |

---

## 2. Organisation des fichiers

```
index.html            Structure de tous les écrans (une seule page)
style.css             Apparence : thème sombre, mise en page adaptative
app.js                Logique : navigation, minuteur, son, voix, stockage
parser.js             Lecture et validation des séances au format JSON
sessions.js           Séances fournies par défaut
manifest.webmanifest  Carte d'identité de l'appli pour Android (nom, icônes, partage)
sw.js                 Service worker : cache hors ligne
icons/                Icônes PNG (192, 512, maskable)
.nojekyll             Dit à GitHub Pages de servir les fichiers tels quels
```

Les scripts sont chargés dans cet ordre, par de simples balises `<script>` : `sessions.js` → `parser.js` → `app.js`. Il n'y a ni modules ni bundler. Chaque fichier expose une constante globale (`BUILTIN_SESSIONS`, `Parser`) que le suivant utilise.

---

## 3. Les technologies, une par une

### HTML : une seule page, plusieurs écrans
`index.html` contient tous les écrans dans des balises `<main class="view">` : accueil, détail, import, historique, réglages. L'écran de séance est une `<section>` à part. Un seul écran est visible à la fois, les autres portent l'attribut `hidden`.

**Navigation par l'ancre de l'URL** (`#detail/vo2-5x4`, `#import`, `#ride`…) : `app.js` écoute l'événement `hashchange` et affiche le bon écran (fonction `route()`). Cette approche a deux avantages :
- le bouton **Retour** d'Android fonctionne naturellement ;
- aucune bibliothèque de routage n'est nécessaire.

### CSS : lisible d'un coup d'œil, même en demi-écran
- **Variables CSS** (`--z1` à `--z5`) : une couleur par zone de puissance. L'écran de séance reçoit `--zc` (couleur de la zone en cours), et tout s'y accorde : bandeau, watts, fond, barre de progression.
- **`color-mix()`** : teinte légèrement le fond avec la couleur de la zone, pour qu'on la perçoive même du coin de l'œil.
- **Grid** : l'écran de séance est une grille verticale (en-tête / chiffres / infos / boutons). La ligne des chiffres prend toute la place restante (`1fr`).
- **Container queries** (`container-type: size`, unités `cqh` / `cqw`) : c'est l'élément central de la mise en page en écran partagé. La taille des gros chiffres se calcule sur la **place réellement disponible** pour la zone des chiffres, pas sur la taille de l'écran. En demi-écran haut/bas comme en plein écran, les watts et le chrono remplissent l'espace sans déborder. Quand la zone est large et basse (côte à côte, ou paysage), `@container (min-aspect-ratio: 2/1)` place les watts et le chrono sur une même ligne.
- **Media queries sur la hauteur** (`max-height: 420px`, `330px`, `260px`) : plus la fenêtre est basse, plus on retire d'éléments secondaires (consigne, étape suivante, temps total) pour garder l'essentiel.
- **`env(safe-area-inset-*)`** : évite l'encoche et la barre de navigation.
- **Polices Google Fonts** : *Barlow Condensed* (chiffres étroits, donc plus grands à largeur égale) et *Inter* pour le texte.

### JavaScript : la logique (`app.js`)

**Le minuteur, basé sur l'heure réelle.** Un minuteur naïf ajoute 1 seconde à chaque tic. Il dérive, et il s'arrête si Android met l'appli en pause. Ici, la position dans la séance se **calcule** à chaque instant :

```js
position = base + (Date.now() - startedAt) / 1000
```

- `base` est le temps déjà fait au moment du dernier démarrage, saut ou pause ; `startedAt` est l'heure du démarrage.
- L'étape en cours se déduit de la position, à partir du tableau des débuts d'étapes (`starts[]`).
- Un `setInterval` toutes les 200 ms ne sert qu'à **rafraîchir l'affichage** et à détecter les passages de seuil (3-2-1, changement d'étape).
- `base` et `startedAt` sont enregistrés dans le `localStorage`. Si la page est rechargée ou si Android tue l'appli, la séance reprend exactement au bon endroit.
- Après une longue interruption (écart supérieur à 3 s entre deux tics), on n'émet pas les bips manqués, pour éviter une rafale.

**Le reste de app.js :**
- affichage de la bibliothèque et des listes d'étapes, dont un mini profil coloré de chaque séance ;
- calcul des watts : `Math.round(FTP × % / 100)`. Les séances sont écrites en % du FTP, donc changer le FTP met tout à jour ;
- import, modification et suppression des séances ;
- historique et génération du résumé texte.

### Les API du navigateur utilisées

| API | Rôle dans l'appli |
|---|---|
| **Screen Wake Lock** (`navigator.wakeLock`) | Garde l'écran allumé pendant la séance. Le verrou est redemandé quand l'appli revient au premier plan (`visibilitychange`). |
| **Web Audio** (`AudioContext`, oscillateur) | Génère les bips sans fichier son. Le navigateur exige un geste de l'utilisateur pour activer le son : il est débloqué au premier appui sur « Démarrer ». |
| **Web Speech** (`speechSynthesis`) | Annonces vocales en français : « Répétition 2 sur 5, 290 à 295 watts, 4 minutes », plus une annonce 10 s avant chaque étape. Utile quand on regarde l'autre moitié de l'écran. |
| **localStorage** | Stockage des séances, du FTP, des réglages, de l'historique et de la séance en cours. Clés préfixées `sv.`. |
| **Clipboard** (`navigator.clipboard`) | Coller une séance, copier le JSON, copier le résumé de fin de séance. |
| **Service Worker** (`sw.js`) | Fonctionnement hors ligne (voir plus bas). |
| **Web Share Target** (manifest) | Fait apparaître « Séances vélo » dans le menu **Partager** d'Android. |

### La PWA : manifest + service worker
- **`manifest.webmanifest`** indique à Android le nom, les icônes, l'affichage en `standalone` (sans barre d'adresse) et les couleurs. Son bloc `share_target` déclare que l'appli accepte du texte partagé. Android ouvre alors `index.html?text=…`, et `app.js` (fonction `handleShare`) place ce texte dans l'écran d'import.
- **`sw.js`** est un petit programme qui s'intercale entre l'appli et le réseau :
  - à l'installation, il met en cache tous les fichiers de l'appli ;
  - pour les fichiers de l'appli, il essaie **d'abord le réseau** (pour recevoir les mises à jour), puis se rabat sur **le cache** hors ligne ;
  - pour les polices Google, il sert **d'abord le cache**, et ne les télécharge qu'une fois.
  - Quand le nom du cache change (`CACHE = "seances-velo-vX.Y.Z"`), les anciens caches sont supprimés.

### Le format des séances et le parser (`parser.js`)
Les séances sont écrites en JSON, dans un format compact pensé pour être produit par un assistant IA ou à la main :

```json
{
  "id": "vo2-6x4",
  "nom": "VO2max — 6 × 4 min",
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
```

- **Une étape** : `["Nom", minutes, %FTP_min, %FTP_max, "FC attendue", "Consigne"]`. Les minutes peuvent être décimales (`0.5` = 30 s). La forme objet est aussi acceptée : `{"nom", "min", "sec", "pct", "fc", "consigne"}`.
- **Blocs standards** : `"ECHAUFFEMENT"` et `"RETOUR_CALME"` (alias `WU` / `CD`) sont remplacés par leurs étapes.
- **Répétitions** : `{"repeter": n, "etapes": [...]}`. Dans les noms, `{i}` et `{n}` deviennent le numéro de la répétition et le total. La dernière récupération est retirée automatiquement (`"sans_derniere_recup": false` pour la garder).
- **Plusieurs séances** : un tableau `[{...}, {...}]`.

Le parser fonctionne en trois temps :
1. **Extraction** (`extractJson`) : il cherche un bloc ```` ```json ````, sinon le premier `{` ou `[`. Il corrige au passage les guillemets typographiques et les virgules en trop, fréquents quand on copie depuis une conversation.
2. **Expansion** (`parseStep`) : il déroule les blocs et les répétitions de façon récursive, pour obtenir une liste plate d'étapes `{name, sec, lo, hi, hr, cue}`.
3. **Validation** (`pushStep`) : il vérifie que la durée est positive et que le % du FTP est compris entre 20 et 300. Les messages d'erreur sont en français et pointent l'étape fautive.

L'appli stocke le **JSON d'origine** et le re-analyse à chaque lecture. Ainsi, « Modifier » et « Copier le JSON » rendent la séance telle qu'elle a été écrite, répétitions comprises.

---

## 4. Développer et publier

**Tester sur PC :**
```bash
npx http-server .        # puis ouvrir l'adresse affichée dans Chrome
```
Dans les outils de développement de Chrome (F12), le mode appareil permet de simuler la taille d'un téléphone. Avec une hauteur d'environ 400 px, on se met dans les conditions d'un demi-écran.

**Publier une mise à jour :**
1. Augmenter `VERSION` dans `app.js` et `CACHE` dans `sw.js`. Sinon, les téléphones peuvent garder l'ancienne version en cache.
2. `git commit` puis `git push` : GitHub Pages republie en une à deux minutes.
3. Sur le téléphone, fermer l'appli et la rouvrir.

**Données :** tout est dans le `localStorage` du téléphone. Réglages → « Copier toutes les données » permet d'en faire une sauvegarde texte.

---

## 5. Pistes

- Planning hebdomadaire (séance du jour).
- Lecture de l'historique Strava pour comparer les séances.
- Puissance et cardio en direct en Bluetooth (Web Bluetooth, protocole FTMS). Cette piste est limitée : les capteurs n'acceptent souvent qu'une connexion à la fois, déjà prise par l'appli du vélo.
- Alertes quand la puissance sort de la cible.
