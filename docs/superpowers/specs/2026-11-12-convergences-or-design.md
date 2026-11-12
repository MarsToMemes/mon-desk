# Convergences de l'or — design

Date : 2026-11-12 · Branche : `feat/convergences`

## But
Repérer et afficher, dans l'espace Or, les moments où plusieurs familles de signaux s'alignent dans le même sens sur l'or (intraday). C'est un repérage, pas une consigne d'achat ou de vente.

## Familles (un vote ▲ +1 / ▼ −1 / — 0 chacune, avec une raison en clair)
| Famille | ▲ | ▼ |
|---|---|---|
| Cassure | la dernière bougie 15 min **clôturée** passe au-dessus d'un niveau du jour (veille, Asie, ouvertures, rond tous les 50 $) qu'elle était sous à la clôture précédente | l'inverse |
| Moteurs | effet(DXY)+effet(US10Y) > 0 et l'argent ne contredit pas | < 0 et l'argent ne contredit pas |
| Flux | (OI 1 h > +0,3 % et prix 1 h > +0,1 %) ou purge des shorts (shorts liquidés 1 h ≥ 2 × longs et ≥ 50 k$), sauf funding moyen > +0,03 % | symétrique (OI ↑ et prix ↓, ou purge des longs), sauf funding < −0,03 % |
| Tendance | 1 h : clôture > MM20 > MM50, et 4 h : clôture > MM20 | l'inverse |
| Agent IA | scénario haussier de la dernière lecture déclenché depuis < 4 h et cible pas encore atteinte | scénario baissier idem |

`effet()` est celui de `gold.js` (seuils 0,05 % ; 1 pb pour le taux).

## Niveau de convergence
- **Forte** : ≥ 4 votes dans un sens, 0 contre.
- **Convergence** : 3 votes dans un sens, ≤ 1 contre.
- Sinon **aucune** (décompte affiché : n ▲ · n ▼ · n neutres).

## Affichage
- Bloc `orconv` « Convergence » dans l'espace Or (à droite du graphique) : jauge ▲/▼ et niveau, 5 lignes ✓/✗/— avec la raison, heure du calcul, rappel « repérage, pas un conseil ».
- Calcul officiel à chaque clôture 15 min ; aperçu en direct entre deux clôtures (marqué « aperçu »).
- Marqueur ▲ (or) / ▼ (rouge) sur le graphique, sur la bougie où une convergence **apparaît** (pas tant qu'elle dure).
- Historique du jour : heure, sens, niveau, prix, puis variation 15 min / 1 h / 4 h après (en $ et %). Gardé dans le navigateur (`CK.lsj("or:conv")`, 3 jours), couvre les moments où le Desk était ouvert.

## Garde-fous
- Marché de l'or fermé (week-end, pause 23 h–0 h) : « marché fermé », aucun marquage.
- Annonce d'importance forte (`S.cal`, `imp:"hi"`) dans les 30 min : bandeau « Annonce imminente : signaux moins fiables ».

## Technique
- Nouveau `conv.js` (`CK.conv`), calculs purs `CK.conv.calc` testés (`tests/conv.test.mjs`).
- Données : bougies OKX `XAU-USDT-SWAP` 15 min (60 s), 1 h et 4 h (5 min) ; niveaux 30 min, funding, OI 1 h via `CK.gold.etat()` ; `S.mk`, `S.liqHist`, `S.cal`, `S.agent`.
- `gold.js` : `etat()` et `marqueurs(list)` (marqueurs posés sur la bougie de l'unité affichée).
- Grille de l'espace Or : orchart (8) + orconv (4) ; orflux (8) + ormoteurs (4) ; events (4) + news (8). `LAYV` 11.
