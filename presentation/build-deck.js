/**
 * Génère la version PowerPoint éditable du deck MédiaLens.
 * Lancer :  NODE_PATH=$(npm root -g) node build-deck.js
 * Sortie  :  MediaLens-InferLoop-J1.pptx
 *
 * Miroir du index.html (style Swiss Grid). Police Calibri = équivalent
 * PowerPoint de Barlow. Règles pptxgenjs : jamais de '#' dans les couleurs,
 * factory pour toute ombre (l'objet est muté en place).
 */
const pptxgen = require("pptxgenjs");
const pptx = new pptxgen();

pptx.defineLayout({ name: "W16x9", width: 10, height: 5.625 });
pptx.layout = "W16x9";

// --- Palette Swiss Grid (sans '#') ---
const C = {
  bg: "f5f5f2", surface: "ffffff", border: "d0d0cc",
  ink: "111110", sub: "777770", accent: "e63329", dark: "1a1a18",
  light: "f5f5f2", greyBar: "777770",
};
const FONT = "Calibri";
const W = 10, ML = 0.66, MR = 0.66, CW = W - ML - MR;

// Factory d'ombre (jamais partagée entre appels)
const mkShadow = () => ({ type: "outer", blur: 8, offset: 2, angle: 90, color: "000000", opacity: 0.08 });

// --- Helpers communs -------------------------------------------------------
function base(slide, { num, dark = false } = {}) {
  slide.background = { color: dark ? C.dark : C.bg };
  // filet horizontal en haut
  slide.addShape("line", { x: ML, y: 0.42, w: CW, h: 0, line: { color: dark ? "3a3a36" : C.border, width: 0.75 } });
  if (num) slide.addText(num + " / 09", {
    x: W - MR - 1.2, y: 0.28, w: 1.2, h: 0.25, align: "right",
    fontFace: FONT, fontSize: 9, bold: true, color: dark ? "8a8a82" : C.sub, charSpacing: 2, margin: 0,
  });
  slide.addText("MédiaLens · InferLoop J1", {
    x: ML, y: 5.25, w: 5, h: 0.3, fontFace: FONT, fontSize: 8, bold: true,
    color: dark ? "8a8a82" : C.sub, charSpacing: 3, margin: 0,
  });
}
function eyebrow(slide, txt, y = 0.62, dark = false) {
  slide.addShape("rect", { x: ML, y: y + 0.09, w: 0.28, h: 0.03, fill: { color: dark ? "ff8a82" : C.accent } });
  slide.addText(txt.toUpperCase(), {
    x: ML + 0.36, y, w: 7, h: 0.3, fontFace: FONT, fontSize: 11, bold: true,
    color: dark ? "ff8a82" : C.accent, charSpacing: 4, margin: 0,
  });
}
function title(slide, txt, y = 0.95, size = 32, dark = false) {
  slide.addText(txt, {
    x: ML, y, w: CW, h: 0.8, fontFace: FONT, fontSize: size, bold: true,
    color: dark ? C.light : C.ink, margin: 0, lineSpacingMultiple: 1.0,
  });
}
function card(slide, x, y, w, h, { k, big, p, accentLeft = false }) {
  slide.addShape("rect", { x, y, w, h, fill: { color: C.surface }, line: { color: C.border, width: 0.75 }, shadow: mkShadow() });
  if (accentLeft) slide.addShape("rect", { x, y, w: 0.05, h, fill: { color: C.accent } });
  const px = x + 0.18;
  slide.addText((k || "").toUpperCase(), { x: px, y: y + 0.15, w: w - 0.36, h: 0.28, fontFace: FONT, fontSize: 10.5, bold: true, color: C.accent, charSpacing: 2, margin: 0 });
  let ty = y + 0.5;
  if (big) { slide.addText(big, { x: px, y: ty, w: w - 0.32, h: 0.6, fontFace: FONT, fontSize: 30, bold: true, color: C.ink, margin: 0 }); ty += 0.72; }
  if (p) slide.addText(p, { x: px, y: ty, w: w - 0.34, h: h - (ty - y) - 0.15, fontFace: FONT, fontSize: 12.5, color: C.sub, margin: 0, lineSpacingMultiple: 1.05 });
}
function stat(slide, x, y, v, l, dark = false, color = C.accent) {
  slide.addText(v, { x, y, w: 2.4, h: 0.7, fontFace: FONT, fontSize: 40, bold: true, color, margin: 0 });
  slide.addText(l.toUpperCase(), { x, y: y + 0.72, w: 2.4, h: 0.3, fontFace: FONT, fontSize: 10.5, bold: true, color: dark ? "b8b8b0" : C.sub, charSpacing: 2, margin: 0 });
}

// Graphe latence — barres verticales dessinées + ligne de seuil SLA.
// p99 en rouge (chiffre héros), SLA en ligne pointillée (pas une barre) pour
// montrer d'un coup qu'on est SOUS le budget.
function drawLatencyBars(slide) {
  const xL = 1.05, xR = 5.55, yBase = 4.5, yTop = 2.15, maxV = 560;
  const plotH = yBase - yTop;
  const y = (v) => yBase - (v / maxV) * plotH;
  slide.addShape("line", { x: xL - 0.1, y: yBase, w: (xR - xL) + 0.2, h: 0, line: { color: C.ink, width: 1 } });
  const bars = [["p50", 240, C.ink], ["p95", 290, C.ink], ["p99", 343, C.accent]];
  const slot = (xR - xL) / bars.length, bw = 0.85;
  bars.forEach(([lab, v, col], i) => {
    const cx = xL + slot * (i + 0.5), bx = cx - bw / 2, by = y(v);
    slide.addShape("rect", { x: bx, y: by, w: bw, h: yBase - by, fill: { color: col } });
    slide.addText(String(v), { x: cx - 0.6, y: by - 0.35, w: 1.2, h: 0.3, align: "center", fontFace: FONT, fontSize: 14, bold: true, color: col, margin: 0 });
    slide.addText(lab, { x: cx - 0.6, y: yBase + 0.07, w: 1.2, h: 0.3, align: "center", fontFace: FONT, fontSize: 12.5, bold: true, color: C.ink, margin: 0 });
  });
  const ySLA = y(500);
  slide.addShape("line", { x: xL - 0.1, y: ySLA, w: (xR - xL) + 0.2, h: 0, line: { color: C.accent, width: 1.75, dashType: "dash" } });
  slide.addText("SLA · 500 ms", { x: xL - 0.1, y: ySLA - 0.32, w: 2.4, h: 0.28, fontFace: FONT, fontSize: 11.5, bold: true, color: C.accent, charSpacing: 1, margin: 0 });
}

// Graphe F1 — barres horizontales dessinées. economie en rouge (point faible),
// faits_divers en gris, top 3 en encre ; ligne de repère à la moyenne 0.71.
function drawF1Bars(slide) {
  const xLab = ML, xBar0 = 1.75, xMax = 5.55, maxV = 1.0;
  const rows = [["sport", 0.88, C.ink], ["culture", 0.83, C.ink], ["politique", 0.80, C.ink], ["faits_divers", 0.64, C.greyBar], ["economie", 0.41, C.accent]];
  const yTop = 2.05, rowH = 0.55, bh = 0.33;
  const len = (v) => (v / maxV) * (xMax - xBar0);
  rows.forEach(([lab, v, col], i) => {
    const ry = yTop + i * rowH;
    slide.addText(lab, { x: xLab, y: ry + bh / 2 - 0.14, w: xBar0 - xLab - 0.1, h: 0.28, align: "right", fontFace: FONT, fontSize: 11.5, bold: true, color: C.ink, margin: 0 });
    slide.addShape("rect", { x: xBar0, y: ry, w: len(v), h: bh, fill: { color: col } });
    slide.addText(v.toFixed(2), { x: xBar0 + len(v) + 0.07, y: ry + bh / 2 - 0.13, w: 0.6, h: 0.26, fontFace: FONT, fontSize: 12, bold: true, color: col, margin: 0 });
  });
  const xRef = xBar0 + len(0.71);
  const yBot = yTop + rows.length * rowH - 0.1;
  slide.addShape("line", { x: xRef, y: yTop - 0.1, w: 0, h: yBot - (yTop - 0.1), line: { color: C.sub, width: 1.25, dashType: "dash" } });
  slide.addText("moy. 0.71", { x: xRef - 0.5, y: yTop - 0.38, w: 1.1, h: 0.24, align: "center", fontFace: FONT, fontSize: 10.5, bold: true, color: C.sub, margin: 0 });
}

// === SLIDE 1 — Titre =======================================================
let s = pptx.addSlide(); base(s);
eyebrow(s, "InferLoop · Jour 1", 1.7);
s.addText("MédiaLens", { x: ML, y: 2.0, w: CW, h: 1.2, fontFace: FONT, fontSize: 72, bold: true, color: C.ink, margin: 0 });
s.addText("Classifieur d'articles de presse française — API zero-shot.", { x: ML, y: 3.25, w: 8, h: 0.4, fontFace: FONT, fontSize: 17, color: C.ink, margin: 0 });
["FastAPI", "mDeBERTa-v3", "Zero-shot NLI", "Docker"].forEach((t, i) => {
  const x = ML + i * 1.55;
  s.addText(t.toUpperCase(), { x, y: 3.8, w: 1.45, h: 0.36, align: "center", valign: "middle", fontFace: FONT, fontSize: 10, bold: true, color: C.ink, charSpacing: 2, line: { color: C.dark, width: 1 }, margin: 0 });
});

// === SLIDE 2 — Contexte ====================================================
s = pptx.addSlide(); base(s, { num: "02" });
eyebrow(s, "Le point de départ");
title(s, "Un modèle sans ses poids");
s.addText([
  { text: "Adrien a laissé un CamemBERT fine-tuné (macro-F1 0.87)… mais le fichier de poids ", options: { color: C.sub } },
  { text: "pytorch_model.bin (~443 Mo)", options: { color: C.ink, bold: true } },
  { text: " n'est pas fourni. Impossible de le charger tel quel.", options: { color: C.sub } },
], { x: ML, y: 1.75, w: 8.4, h: 0.8, fontFace: FONT, fontSize: 15, margin: 0, lineSpacingMultiple: 1.15 });
const cw3 = (CW - 0.4) / 3, cy = 2.75, ch = 1.9;
card(s, ML, cy, cw3, ch, { k: "Latence", big: "< 500 ms", p: "p99 exigé par Chloé (SLA business)" });
card(s, ML + cw3 + 0.2, cy, cw3, ch, { k: "Santé", big: "/health", p: "l'API doit dire si le modèle est chargé" });
card(s, ML + 2 * (cw3 + 0.2), cy, cw3, ch, { k: "Déploiement", big: "Docker", p: "tout lancer en une seule commande" });

// === SLIDE 3 — Stratégie ===================================================
s = pptx.addSlide(); base(s, { num: "03" });
eyebrow(s, "La stratégie");
title(s, "Zero-shot, sans réentraîner");
s.addText([
  { text: "Sans les poids, on ne réentraîne pas en 24 h. On classe en ", options: { color: C.sub } },
  { text: "zero-shot NLI", options: { color: C.ink, bold: true } },
  { text: " : le modèle décide si un article « parle de » chaque catégorie, sans avoir jamais vu le corpus MédiaLens.", options: { color: C.sub } },
], { x: ML, y: 1.75, w: 8.4, h: 0.8, fontFace: FONT, fontSize: 15, margin: 0, lineSpacingMultiple: 1.15 });
const cw2 = (CW - 0.3) / 2, cy3 = 2.85, ch3 = 1.85;
card(s, ML, cy3, cw2, ch3, { k: "Le modèle retenu", big: "mDeBERTa-v3", p: "NLI multilingue (base-mnli-xnli), prêt à l'emploi sur nos 5 catégories.", accentLeft: true });
card(s, ML + cw2 + 0.3, cy3, cw2, ch3, { k: "Les 5 catégories", p: "politique · economie · sport · culture · faits_divers" });

// === SLIDE 4 — Pourquoi mDeBERTa ==========================================
s = pptx.addSlide(); base(s, { num: "04" });
eyebrow(s, "Le modèle");
title(s, "Pourquoi mDeBERTa-v3");
const cw4 = (CW - 0.6) / 4, cy4 = 1.95, ch4 = 2.0;
card(s, ML + 0 * (cw4 + 0.2), cy4, cw4, ch4, { k: "Français natif", p: "Entraîné sur XNLI — le français fait partie du socle, pas une traduction." });
card(s, ML + 1 * (cw4 + 0.2), cy4, cw4, ch4, { k: "Léger", big: "~280M", p: "paramètres → image Docker contenue" });
card(s, ML + 2 * (cw4 + 0.2), cy4, cw4, ch4, { k: "Prêt à l'emploi", p: "Zero-shot : aucun fine-tuning, aucun corpus requis." });
card(s, ML + 3 * (cw4 + 0.2), cy4, cw4, ch4, { k: "Réglage clé", big: "+8 pts", p: "de F1 grâce au gabarit d'hypothèse en français", accentLeft: true });
s.addText([
  { text: "Gabarit : ", options: { color: C.sub } },
  { text: "« Cet article parle de {} »", options: { color: C.ink, bold: true } },
  { text: " au lieu du défaut anglais — validé sur 3 configurations.", options: { color: C.sub } },
], { x: ML, y: 4.15, w: 8.6, h: 0.4, fontFace: FONT, fontSize: 14, margin: 0 });

// === SLIDE 5 — Preuve latence =============================================
s = pptx.addSlide(); base(s, { num: "05" });
eyebrow(s, "Preuve #1 · Latence");
title(s, "p99 à 343 ms, sous le SLA");
drawLatencyBars(s);
stat(s, 6.2, 2.0, "343 ms", "p99 mesuré", false, C.accent);
stat(s, 6.2, 3.0, "500 ms", "SLA exigé", false, C.ink);
s.addText("Le modèle est chargé une seule fois au démarrage (lifespan) : la première requête n'est jamais pénalisée.", { x: 6.2, y: 3.95, w: 3.2, h: 0.8, fontFace: FONT, fontSize: 12.5, color: C.sub, margin: 0, lineSpacingMultiple: 1.1 });
s.addText("Reproductible · python -m scripts.benchmark", { x: 6.2, y: 4.75, w: 3.3, h: 0.25, fontFace: FONT, fontSize: 10.5, italic: true, color: C.sub, margin: 0 });

// === SLIDE 6 — Preuve qualité =============================================
s = pptx.addSlide(); base(s, { num: "06" });
eyebrow(s, "Preuve #2 · Qualité");
title(s, "0.71 de macro-F1 en zero-shot");
drawF1Bars(s);
stat(s, 6.2, 1.95, "0.731", "Accuracy", false, C.accent);
stat(s, 8.1, 1.95, "0.713", "Macro-F1", false, C.accent);
s.addShape("rect", { x: 6.2, y: 3.1, w: 3.2, h: 1.6, fill: { color: C.surface }, line: { color: C.border, width: 0.75 }, shadow: mkShadow() });
s.addText("POINT FAIBLE ASSUMÉ", { x: 6.38, y: 3.28, w: 2.9, h: 0.3, fontFace: FONT, fontSize: 10.5, bold: true, color: C.accent, charSpacing: 2, margin: 0 });
s.addText([
  { text: "economie", options: { bold: true, color: C.ink } },
  { text: " (F1 0.41, recall 0.31) — confondu avec politique et faits_divers, comme le notait déjà Adrien.", options: { color: C.sub } },
], { x: 6.38, y: 3.6, w: 2.9, h: 1.0, fontFace: FONT, fontSize: 12, margin: 0, lineSpacingMultiple: 1.05 });

// === SLIDE 7 — Architecture ===============================================
s = pptx.addSlide(); base(s, { num: "07" });
eyebrow(s, "Architecture");
title(s, "Prête pour la production");
const rows = [
  ["API", "FastAPI", "POST /infer · GET /health · GET /"],
  ["ML", "Inference", "mDeBERTa chargé au lifespan, mis en cache"],
  ["Ops", "Docker", "image CPU, modèle pré-téléchargé au build"],
  ["QA", "pytest", "8 tests — endpoints, validation, logique"],
];
let ry = 1.95;
rows.forEach(([n, t, d]) => {
  s.addShape("line", { x: ML, y: ry, w: 4.7, h: 0, line: { color: C.border, width: 0.75 } });
  s.addText(n, { x: ML, y: ry + 0.1, w: 0.6, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: C.accent, margin: 0 });
  s.addText(t, { x: ML + 0.65, y: ry + 0.1, w: 1.5, h: 0.35, fontFace: FONT, fontSize: 15, bold: true, color: C.ink, margin: 0 });
  s.addText(d, { x: ML + 2.15, y: ry + 0.12, w: 2.55, h: 0.5, fontFace: FONT, fontSize: 11, color: C.sub, margin: 0, lineSpacingMultiple: 1.0 });
  ry += 0.72;
});
s.addShape("line", { x: ML, y: ry, w: 4.7, h: 0, line: { color: C.border, width: 0.75 } });
// chip JSON
s.addShape("rect", { x: 5.7, y: 1.95, w: 3.7, h: 1.75, fill: { color: C.dark } });
s.addText([
  { text: "POST /infer\n", options: { bold: true, color: "ffffff" } },
  { text: "→ { ", options: { color: "f5f5f2" } },
  { text: '"titre"', options: { color: "8fd3ff" } },
  { text: ": \"…\", ", options: { color: "f5f5f2" } },
  { text: '"texte"', options: { color: "8fd3ff" } },
  { text: ": \"…\" }\n\n", options: { color: "f5f5f2" } },
  { text: "← { ", options: { color: "f5f5f2" } },
  { text: '"categorie"', options: { color: "ff8a82" } },
  { text: ': "sport", ', options: { color: "f5f5f2" } },
  { text: '"score"', options: { color: "ff8a82" } },
  { text: ": 0.908, ", options: { color: "f5f5f2" } },
  { text: '"latence_ms"', options: { color: "ff8a82" } },
  { text: ": 250 }", options: { color: "f5f5f2" } },
], { x: 5.9, y: 2.1, w: 3.4, h: 1.5, fontFace: "Consolas", fontSize: 11.5, margin: 0, lineSpacingMultiple: 1.15 });
s.addShape("rect", { x: 5.7, y: 3.85, w: 3.7, h: 0.5, fill: { color: C.ink } });
s.addText("$ docker compose up --build", { x: 5.9, y: 3.95, w: 3.4, h: 0.3, fontFace: "Consolas", fontSize: 12, color: "f5f5f2", margin: 0 });

// === SLIDE 8 — Limites =====================================================
s = pptx.addSlide(); base(s, { num: "08" });
eyebrow(s, "Lucidité");
title(s, "Ce qu'on assume, ce qui suit");
const lim = [
  ["01", "Écart au fine-tuné", "~15 pts de F1 sous le modèle d'Adrien — prix du zero-shot, sans entraînement corpus."],
  ["02", "economie sous-détectée", "recall 0.31 — piste J2 : labels ciblés ou quelques exemples (few-shot)."],
  ["03", "Articles courts", "< 50 mots moins fiables — déjà signalé dans la note d'Adrien."],
  ["04", "Pas de monitoring drift", "aucune détection de dérive sur les articles récents — chantier Jour 2."],
];
let ly = 1.95;
lim.forEach(([n, t, d]) => {
  s.addShape("line", { x: ML, y: ly, w: CW, h: 0, line: { color: C.border, width: 0.75 } });
  s.addText(n, { x: ML, y: ly + 0.12, w: 0.6, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: C.accent, margin: 0 });
  s.addText(t, { x: ML + 0.6, y: ly + 0.12, w: 3.1, h: 0.4, fontFace: FONT, fontSize: 15, bold: true, color: C.ink, margin: 0 });
  s.addText(d, { x: ML + 3.8, y: ly + 0.14, w: CW - 3.8, h: 0.5, fontFace: FONT, fontSize: 12.5, color: C.sub, margin: 0, lineSpacingMultiple: 1.0 });
  ly += 0.72;
});
s.addShape("line", { x: ML, y: ly, w: CW, h: 0, line: { color: C.border, width: 0.75 } });

// === SLIDE 9 — Clôture =====================================================
s = pptx.addSlide(); base(s, { num: "09", dark: true });
eyebrow(s, "InferLoop · Jour 1", 1.75, true);
s.addText("Zero-shot, mais mesuré, validé\net prêt pour la production.", { x: ML, y: 2.15, w: 8.5, h: 1.3, fontFace: FONT, fontSize: 38, bold: true, color: C.light, margin: 0, lineSpacingMultiple: 1.05 });
s.addText("SLA tenu · pipeline validée sur 475 articles · livrable Docker en une commande.", { x: ML, y: 3.7, w: 8.5, h: 0.5, fontFace: FONT, fontSize: 15, color: "b8b8b0", margin: 0 });

// --- Écriture --------------------------------------------------------------
pptx.writeFile({ fileName: "MediaLens-InferLoop-J1.pptx" }).then((f) => {
  console.log("OK — écrit :", f);
});
