// tests/conv.test.mjs — convergences de l'or (node --test tests/*.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ["../gold.js", "../conv.js"]) vm.runInContext(readFileSync(new URL(f, import.meta.url), "utf8"), ctx);
const C = ctx.window.CK.conv.calc, G = ctx.window.CK.gold.calc;
const k = (t, c) => ({ t, o: c, h: c, l: c, c });

test("cassure haussière à la clôture", () => {
  const v = C.voteCassure([k(0, 3895), k(9e5, 3905)], [{ nom: "Niveau rond 3900", prix: 3900, type: "rond" }]);
  assert.equal(v.v, 1);
});
test("cassure baissière, niveau le plus proche retenu", () => {
  const L = [{ nom: "A", prix: 3910, type: "veille" }, { nom: "B", prix: 3902, type: "jour" }];
  const v = C.voteCassure([k(0, 3915), k(9e5, 3900)], L);
  assert.equal(v.v, -1);
  assert.match(v.txt, /\(B\)/);
});
test("pas de cassure, et les ronds de 10 $ ignorés", () => {
  assert.equal(C.voteCassure([k(0, 3895), k(9e5, 3897)], [{ nom: "R", prix: 3900, type: "rond" }]).v, 0);
  assert.equal(C.voteCassure([k(0, 3905), k(9e5, 3915)], [{ nom: "r10", prix: 3910, type: "rond10" }]).v, 0);
});
test("moteurs", () => {
  assert.equal(C.voteMoteurs({ DXY: { c: 100, ch: -0.3 }, US10Y: { c: 4.5, ch: 0 }, SILVER: { c: 50, ch: 0.5 } }, G.effet).v, 1);
  assert.equal(C.voteMoteurs({ DXY: { c: 100, ch: 0.3 }, US10Y: { c: 4.5, ch: 1 } }, G.effet).v, -1);
  assert.equal(C.voteMoteurs({ DXY: { c: 100, ch: -0.3 }, SILVER: { c: 50, ch: -1 } }, G.effet).v, 0); // l'argent contredit
});
test("flux", () => {
  assert.equal(C.voteFlux({ oi1h: 0.5, px1h: 0.2, fund: [0.0001] }).v, 1);
  assert.equal(C.voteFlux({ oi1h: 0.5, px1h: 0.2, fund: [0.0005] }).v, 0); // funding surchargé
  assert.equal(C.voteFlux({ oi1h: 0.5, px1h: -0.2, fund: [0] }).v, -1);
  assert.equal(C.voteFlux({ liqS: 120000, liqL: 2000 }).v, 1); // purge des shorts
  assert.equal(C.voteFlux({}).v, 0);
});
test("tendance 1 h et 4 h", () => {
  const up = Array.from({ length: 60 }, (_, i) => 3800 + i), dn = up.slice().reverse();
  assert.equal(C.voteTendance(up, up.slice(0, 30)).v, 1);
  assert.equal(C.voteTendance(dn, dn.slice(0, 30)).v, -1);
  assert.equal(C.voteTendance(up.slice(0, 10), up).v, 0);
});
test("agent", () => {
  const now = 10 * 36e5;
  assert.equal(C.voteAgent({ hausse: { dec: now - 36e5 } }, now).v, 1);
  assert.equal(C.voteAgent({ hausse: { dec: now - 36e5, ok: now } }, now).v, 0);   // cible atteinte
  assert.equal(C.voteAgent({ baisse: { dec: now - 5 * 36e5 } }, now).v, 0);         // trop ancien
  assert.equal(C.voteAgent({ baisse: { dec: now - 60000 } }, now).v, -1);
});
test("combinaison", () => {
  const V = (a) => a.map((v) => ({ v }));
  assert.equal(C.combine(V([1, 1, 1, 1, 0])).force, "forte");
  assert.equal(C.combine(V([1, 1, 1, -1, 0])).force, "convergence");
  assert.equal(C.combine(V([1, 1, 1, -1, -1])).sens, 0);
  assert.equal(C.combine(V([-1, -1, -1, -1, 1])).sens, -1);
  assert.equal(C.combine(V([-1, -1, -1, -1, 1])).force, "convergence");
  assert.equal(C.combine(V([1, 1, 0, 0, 0])).sens, 0);
});
test("apparition d'une convergence", () => {
  assert.equal(C.nouvelle(null, { sens: 1 }), true);
  assert.equal(C.nouvelle({ sens: 1 }, { sens: 1 }), false);
  assert.equal(C.nouvelle({ sens: 0 }, { sens: -1 }), true);
  assert.equal(C.nouvelle({ sens: 1 }, { sens: 0 }), false);
});
test("variation après", () => {
  const K = [k(0, 100), k(9e5, 101), k(18e5, 103)];
  const a = C.apres(K, 9e5, 100, 9e5); // 15 min après la clôture de 00:00 → clôture de la bougie 00:15
  assert.equal(a.d, 1);
  assert.equal(C.apres(K, 9e5, 100, 36e5), null);
});
