# Relais du Mode Live (Cloudflare, gratuit)

Petit serveur qui remplace l'ancien échange de QR codes WebRTC du Mode Live :
l'hôte crée un salon, obtient un **code de 5 caractères** (ex. `K7RQX`, sans 0/O ni 1/I),
les autres le saisissent dans **Mode Live → Rejoindre** (ou scannent le QR code avec
l'appareil photo, qui ouvre `https://cantus-app.fr/?live=K7RQX`).

- Un **Worker** reçoit les requêtes ; un **Durable Object** (stockage SQLite) par salon relaie
  les messages en WebSocket (API *Hibernation* : rien n'est facturé pendant les silences).
- L'hôte reste la seule source de vérité (file, chant en direct, leaders). Le relais garde
  seulement le dernier état diffusé pour les arrivants, et efface le salon **2 h après le
  départ du dernier participant** (ou tout de suite quand l'hôte quitte le direct).
- Seules les pages servies depuis `cantus-app.fr` (et `localhost` / `127.0.0.1` pour les tests)
  peuvent l'utiliser.

## Quotas gratuits (offre Workers Free, vérifiés en octobre 2026)

Source : [tarifs Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)
et [limites Workers](https://developers.cloudflare.com/workers/platform/limits/).
Au-delà d'un quota, les requêtes échouent jusqu'au lendemain (remise à zéro à minuit UTC,
soit 1 h ou 2 h du matin à Paris) : **aucune facture possible** sans passer soi-même à l'offre payante.

| Ressource | Gratuit par jour | Consommation Cantus |
| --- | --- | --- |
| Requêtes Worker | 100 000 | 1 par création de salon + 1 par (re)connexion |
| Requêtes Durable Objects | 100 000 | messages WebSocket **reçus** comptés 1 pour 20 ; messages envoyés gratuits |
| Durée Durable Objects | 13 000 Go-s | quasi nulle grâce à l'hibernation (les « ping » sont répondus sans réveiller l'objet) |
| Lignes SQLite écrites | 100 000 | quelques-unes par arrivée et par changement de la file |
| Lignes SQLite lues | 5 millions | négligeable |
| Stockage | 5 Go au total | quelques Ko par salon, effacés à l'expiration |

Ordre de grandeur : 20 personnes connectées pendant 3 h (ping toutes les 25 s + quelques
centaines d'actions) ≈ 1 000 requêtes, soit 1 % du quota du jour.

## Déploiement depuis Windows (une seule fois)

Pré-requis : [Node.js](https://nodejs.org) (déjà installé si `node -v` répond) et le compte
Cloudflare gratuit (celui déjà utilisé pour le Worker ECAM convient).

1. Ouvrir PowerShell dans ce dossier :
   ```powershell
   cd C:\Users\cypri\Documents\CODE\Cantus\live-server
   npm install
   ```
2. Se connecter à Cloudflare (ouvre le navigateur, cliquer « Allow ») — inutile si
   `npx wrangler whoami` affiche déjà votre compte :
   ```powershell
   npx wrangler login
   ```
3. Déployer :
   ```powershell
   npx wrangler deploy
   ```
   Wrangler affiche l'adresse du relais, du type
   `https://cantus-live.<votre-sous-domaine>.workers.dev`.
4. Dans `index.html`, remplacer l'adresse provisoire de `LIVE_RELAY_URL` par celle-ci :
   ```js
   : 'https://cantus-live.REMPLACER.workers.dev';
   ```
   puis pousser le site comme d'habitude (avec la mise à jour de `version.json`).

Pour une mise à jour du relais plus tard : refaire seulement l'étape 3.
Journal en direct du relais déployé : `npx wrangler tail`.

## Tester en local

```powershell
npx wrangler dev          # relais sur http://127.0.0.1:8787
node test.mjs             # (autre fenêtre) vérification automatique du relais → « OK »
```

Puis servir le site depuis la racine du dépôt (par exemple `npx serve -l 8000 ..` ou
`python -m http.server 8000`) et ouvrir `http://localhost:8000` dans deux onglets : en local,
`index.html` utilise automatiquement le relais `http://127.0.0.1:8787`.

## Protocole (pour mémoire)

- `POST /room` → `{ code, key }` (`key` : secret de l'hôte).
- WebSocket `/room/<CODE>?key=<key>` pour l'hôte, `/room/<CODE>?cid=<id d'appareil>` pour les
  autres (le même `cid` garde le même numéro de participant après une coupure).
- Invité → hôte : message transmis tel quel avec `_from: <numéro>`. Hôte → invités : diffusé à
  tous, ou à un seul si `_to: <numéro>`. Le relais envoie lui-même `youAre` (numéro attribué),
  `bye` (départ, à l'hôte) et rejoue les `hello` à l'hôte qui se reconnecte.
- `"ping"` → `"pong"`. Codes de fermeture : `4404` salon inconnu/expiré, `4001` direct fermé par
  l'hôte, `4000` connexion remplacée par une plus récente.
