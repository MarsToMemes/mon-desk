// tests/gold.test.mjs — calculs de l'espace Or (node --test tests/*.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../gold.js", import.meta.url), "utf8");
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const C = ctx.window.CK.gold.calc;
const T = (s) => Date.parse(s);

test("minuit de Paris en hiver (UTC+1)", () => {
  assert.equal(C.parisMidnight(T("2026-11-12T15:00:00Z")), T("2026-11-11T23:00:00Z"));
});
test("minuit de Paris en été (UTC+2)", () => {
  assert.equal(C.parisMidnight(T("2026-07-01T10:00:00Z")), T("2026-06-30T22:00:00Z"));
});
test("sessions de l'or (heure de Paris)", () => {
  assert.equal(C.session(T("2026-11-12T02:00:00Z")).k, "asie");    // jeudi 03:00
  assert.equal(C.session(T("2026-11-12T09:00:00Z")).k, "londres"); // jeudi 10:00
  assert.equal(C.session(T("2026-11-12T15:00:00Z")).k, "newyork"); // jeudi 16:00
  assert.equal(C.session(T("2026-11-12T22:30:00Z")).k, "pause");   // jeudi 23:30
  assert.equal(C.session(T("2026-11-13T22:30:00Z")).k, "ferme");   // vendredi 23:30
  assert.equal(C.session(T("2026-11-14T12:00:00Z")).k, "ferme");   // samedi
  assert.equal(C.session(T("2026-11-15T23:30:00Z")).k, "hors");    // lundi 00:30 Paris (avant l'Asie)
});

/* Bougies 30 min plates à 4000 du mercredi 00:00 Paris au jeudi 16:00 Paris, avec des extrêmes placés */
function bougies() {
  const t0 = T("2026-11-10T23:00:00Z"), now = T("2026-11-12T15:00:00Z"), K = [];
  for (let t = t0; t < now; t += 1800000) K.push({ t, o: 4000, h: 4000, l: 4000, c: 4000 });
  const at = (iso) => K.find((k) => k.t === T(iso));
  at("2026-11-11T10:00:00Z").h = 4100;  // haut de la veille (mercredi)
  at("2026-11-11T16:00:00Z").l = 3900;  // bas de la veille
  at("2026-11-11T23:00:00Z").o = 4005;  // ouverture du jour (jeudi 00:00 Paris)
  at("2026-11-12T03:00:00Z").h = 4050;  // haut de l'Asie (04:00 Paris)
  at("2026-11-12T05:00:00Z").l = 3950;  // bas de l'Asie
  at("2026-11-12T08:00:00Z").o = 4011;  // ouverture de Londres (09:00 Paris)
  at("2026-11-12T13:30:00Z").o = 4022;  // ouverture de New York (14:30 Paris)
  return { K, now };
}
test("niveaux intraday", () => {
  const { K, now } = bougies();
  const L = C.niveaux(K, 4000, now);
  const get = (nom) => (L.find((l) => l.nom === nom) || {}).prix;
  assert.equal(get("Haut de la veille"), 4100);
  assert.equal(get("Bas de la veille"), 3900);
  assert.equal(get("Ouverture du jour"), 4005);
  assert.equal(get("Haut de l'Asie"), 4050);
  assert.equal(get("Bas de l'Asie"), 3950);
  assert.equal(get("Ouverture de Londres"), 4011);
  assert.equal(get("Ouverture de New York"), 4022);
  const ronds = L.filter((l) => l.type === "rond").map((l) => l.prix).sort((a, b) => a - b);
  assert.deepEqual([...ronds], [3900, 3950, 4000, 4050, 4100]);
  const r10 = L.filter((l) => l.type === "rond10").map((l) => l.prix).sort((a, b) => a - b);
  assert.deepEqual([...r10], [3980, 3990, 4010, 4020]);
});
test("veille = dernier jour ouvré (lundi → vendredi)", () => {
  const t0 = T("2026-11-12T23:00:00Z"), now = T("2026-11-16T10:00:00Z"), K = []; // ven 00:00 → lun 11:00 Paris
  for (let t = t0; t < now; t += 1800000) K.push({ t, o: 4000, h: 4000, l: 4000, c: 4000 });
  K.find((k) => k.t === T("2026-11-13T12:00:00Z")).h = 4200; // vendredi
  K.find((k) => k.t === T("2026-11-15T12:00:00Z")).h = 4300; // dimanche (ignoré)
  const L = C.niveaux(K, 4000, now);
  assert.equal(L.find((l) => l.nom === "Haut de la veille").prix, 4200);
});
test("niveaux les plus proches", () => {
  const { K, now } = bougies();
  const p = C.proches(C.niveaux(K, 4001, now), 4001);
  assert.equal(p.haut.prix, 4005);
  assert.equal(p.bas.prix, 4000);
});
test("effet des moteurs sur l'or", () => {
  assert.equal(C.effet("DXY", { c: 100, ch: 0.3 }), -1);
  assert.equal(C.effet("DXY", { c: 100, ch: -0.3 }), 1);
  assert.equal(C.effet("DXY", { c: 100, ch: 0.01 }), 0);
  assert.equal(C.effet("US10Y", { c: 4.5, ch: 1 }), -1);     // +4,5 pb
  assert.equal(C.effet("US10Y", { c: 4.5, ch: 0.1 }), 0);    // +0,45 pb
  assert.equal(C.effet("SILVER", { c: 50, ch: -1 }), -1);
  assert.equal(C.effet("DXY", null), 0);
});
test("bougies OKX remises dans l'ordre", () => {
  const K = C.parseK([["2000", "2", "3", "1", "2.5"], ["1000", "1", "2", "0.5", "1.5"]]);
  assert.equal(K[0].t, 1000);
  assert.equal(K[1].c, 2.5);
});
