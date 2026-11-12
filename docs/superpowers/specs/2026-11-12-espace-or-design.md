# Espace « Or » — design

Date : 2026-11-12 · Branche : `feat/espace-or`

## But

L'utilisateur trade surtout l'or, en **intraday / scalp**. Le Desk doit s'ouvrir sur un espace dédié à l'or qui réunit : graphique avec niveaux du jour, moteurs de l'or, flux et positionnement du perpétuel, agenda et news macro. Le BTC reste dans le Desk ; l'or passe en premier.

Déjà fait avant cette spec : l'or ouvre la barre du haut (`LEAD_STRIP` dans `core.js`, rafraîchi toutes les 20 s via `loadGold()`), la watchlist ne garde que BTC.

## Écran

Nouvel espace `or`, nom « Or », touche 1, couleur `#E9C46A`. Les autres espaces se décalent d'une touche.

Grille (12 colonnes) :

| Bloc (`data-mod`) | Position | Contenu |
|---|---|---|
| `orchart` | x 0, y 0, w 8 | Graphique or |
| `ormoteurs` | x 8, y 0, w 4 | Moteurs de l'or |
| `orflux` | x 0, y suivant, w 8 | Flux & positionnement |
| `events` | x 8, même ligne, w 4 | Agenda éco (bloc existant) |
| `news` | pleine largeur, dessous | News macro (bloc existant) |

Les hauteurs `h` suivent celles des blocs comparables existants (`liq` 84, `events` 50). Le bloc reste déplaçable via « Disposition ». `LAYV` est incrémenté pour que les navigateurs prennent la nouvelle disposition.

### 1. Graphique or (`orchart`)
- Bougies du perpétuel OKX `XAU-USDT-SWAP`, unités 5 min / 15 min / 1 h (sélecteur, 15 min par défaut, choix mémorisé via `CK.ls`).
- Rendu avec Lightweight Charts (même chargement que `veille.js` : `loadLWC`).
- Niveaux tracés en lignes pointillées avec étiquette :
  - plus haut et plus bas d'hier (journée = 00:00 → 24:00 heure de Paris) ;
  - ouverture du jour (00:00 Paris) ;
  - plus haut et plus bas de la session d'Asie (01:00 → 09:00 Paris) ;
  - ouverture de Londres (09:00 Paris) et de New York (14:30 Paris), une fois passées ;
  - niveaux ronds : multiples de 50 $ dans la fenêtre visible, et de 10 $ à moins de 0,5 % du prix.
- En-tête : prix en direct, variation depuis l'ouverture du jour, distance (en $ et en %) au premier niveau au-dessus et en dessous, heure de Paris et session en cours (Asie / Londres / New York / hors séance).
- Bouton « Ouvrir dans TradingView » : `CK.openChart("OANDA:XAUUSD","Or")` (fonction existante).
- Week-end (samedi, et dimanche avant 23:00 Paris) : bandeau « Marché de l'or fermé, le perpétuel OKX continue de coter ».

### 2. Moteurs de l'or (`ormoteurs`)
Quatre lignes : Dollar (DXY), Taux US 10 ans, Argent, Ratio or/argent. Pour chacune : valeur, variation du jour, et une pastille d'effet sur l'or :
- Dollar en hausse → pression baissière sur l'or (rouge), en baisse → haussière (vert) ;
- Taux 10 ans en hausse → baissière, en baisse → haussière ;
- Argent : même sens que sa variation (confirmation du mouvement des métaux) ;
- Ratio or/argent : affiché sans pastille (information).
Variation sous 0,05 % (ou 1 pb pour le taux) → pastille neutre.

### 3. Flux & positionnement (`orflux`)
- **Funding** du perpétuel or : OKX, Binance, Bybit (taux actuel, annualisé en info-bulle).
- **Open interest** total (en $) et variation sur 1 h, à partir d'OKX (et Binance/Bybit quand disponibles).
- **Liquidations or en direct** : liste des dernières (côté long/short, montant en $, plateforme, heure), total long/short sur 1 h. Seuil d'affichage : 1 000 $.

### 4–5. Agenda et news
Blocs existants `events` et `news`, réutilisés sans modification.

## Ouverture du Desk

Si aucun espace n'a été mémorisé (`CK.ls("view")` vide), le Desk s'ouvre sur `or` au lieu de `home`. Sinon il rouvre le dernier espace utilisé (comportement actuel). L'accueil reste accessible par la touche 0.

## Architecture

- **Nouveau fichier `gold.js`** : module `CK.gold` (fonction auto-exécutée, comme les autres), contient graphique, niveaux, moteurs et flux. Moins de 500 lignes. Démarré depuis `CK.boot` (`core.js`), ajouté à la liste `JS` de `build.mjs` (après `veille`).
- **Retouches** :
  - `layout.js` : `or` dans `VIEWS0` (en 2e position, après `home`) ; `DEFAULTS.or` ; `orchart`, `ormoteurs`, `orflux` dans `NAMES` et `MIN` ; `LAYV` +1 ; vue par défaut `or` quand rien n'est mémorisé.
  - `worlds.js` : entrée `{v:"or",name:"Or",col:"#E9C46A",desc:…}` en tête de `W0`.
  - `page.html` : trois `<section class="mod" data-mod="…">` sur le modèle existant.
  - `core.js` : `or:true` dans `espaces` de `DEF`, modules `orchart/ormoteurs/orflux:true`, démarrage `CK.gold.boot()`, export de `loadGold` partagé (une seule requête TradingView sert la barre et l'espace).
  - `net.js` : source « Or (perpétuel) » dans `SRC` pour l'espace Connexions.
  - `worlds.css` : styles en fin de fichier, classes préfixées `or-…`, thèmes sombre et clair, responsive (blocs empilés sous 900 px).
- Le code crypto existant (prix, screener, liquidations BTC, agent) n'est pas modifié dans sa logique.

## Données

Toutes publiques, sans clé, appelables depuis le navigateur (testées le 2026-11-12) :

| Donnée | Source | Rythme |
|---|---|---|
| Prix en direct | WebSocket OKX `tickers` `XAU-USDT-SWAP` | temps réel |
| Bougies | OKX `/api/v5/market/candles?instId=XAU-USDT-SWAP&bar=5m|15m|1H` | à chaque nouvelle bougie, au plus 1 fois / 30 s |
| Bougies de la veille / Asie | OKX `history-candles` 15m | 1 fois au chargement puis toutes les 10 min |
| DXY, US10Y, argent | scanner TradingView (`TVC:DXY`, `TVC:US10Y`, `TVC:SILVER`) | 20 s, onglet visible et espace ouvert |
| Funding | OKX `funding-rate`, Binance `premiumIndex?symbol=XAUUSDT`, Bybit `tickers?symbol=XAUUSDT` | 60 s |
| Open interest | OKX `open-interest?instId=XAU-USDT-SWAP` (+ Binance, Bybit) | 60 s |
| Liquidations | OKX WS `liquidation-orders` (filtre `XAU-USDT-SWAP`), Binance WS `!forceOrder@arr` (filtre `XAUUSDT`), Bybit WS `allLiquidation.XAUUSDT` | temps réel |

Les requêtes passent par `fetchJSON` (journal `CK.NET`). Les WebSockets existantes sont réutilisées quand elles le permettent (abonnement supplémentaire) plutôt que d'en ouvrir de nouvelles.

## Pannes

- Chaque bloc gère ses erreurs seul : message « Source indisponible, nouvel essai dans un instant » et nouvel essai au rythme normal, sans bloquer les autres blocs.
- Graphique sans bougies OKX → message + bouton TradingView.
- Tout texte externe passe par `esc()`, tout lien par `safeUrl()`. Stockage via `CK.ls` / `CK.lsj`.

## Vérification

1. `node build.mjs` passe (« scripts valides »).
2. Navigateur (http://localhost:5173), stockage local vidé : le Desk s'ouvre sur l'espace Or.
3. Les cinq blocs se remplissent ; niveaux visibles sur le graphique ; changement d'unité 5 min / 15 min / 1 h.
4. Moteurs : valeurs cohérentes avec la barre du haut.
5. Console : aucune nouvelle erreur (l'erreur CORS FinancialJuice connue mise à part).
6. Thème clair et largeur mobile (375 px) lisibles.
7. Les autres espaces (Journée, Signaux, Screener, Liquidations, News, Agent, Connexions) fonctionnent comme avant.

## Hors périmètre

Agent IA dédié à l'or (demande de déployer son propre relais Cloudflare), carnet d'ordres agrégé de l'or, alertes de prix spécifiques.
