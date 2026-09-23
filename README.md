# Cantus

Bibliothèque et planificateur de chants pour un groupe de louange : consultation des partitions en plein écran, préparation du déroulé d'une messe, playlists, mode Live pour synchroniser plusieurs appareils pendant un événement, et gestion du contenu directement depuis l'application.

C'est une PWA (Progressive Web App) **100% statique, sans build ni backend** : tout tient dans `index.html`, et le dépôt GitHub lui-même sert de base de données (les partitions sont des fichiers, l'admin les ajoute/modifie via l'API GitHub depuis l'app).

## Fonctionnalités

- **Bibliothèque** de partitions PDF classées par catégorie (Louange, Adoration, Esprit Saint, Communion, Marie, Polyphonique, Chants de l'Emmanuel, Autre), avec recherche et favoris.
- **Visionneuse plein écran** : zoom (molette, pincement, boutons), mode page double sur grand écran, tourne-page tactile ou par boutons, reconnaissance faciale (pencher la tête pour tourner la page), pédale externe (ESP32), sortie de veille désactivée pendant la lecture.
- **Mode Paroles** : bascule à tout moment entre la partition (PDF) et les paroles seules, en grand texte défilant — pratique pour les chanteurs qui n'ont pas besoin de la portée.
- **Playlists** et **Messes** : prépare un déroulé de chants pour une messe, avec récupération automatique des lectures du jour (API AELF) insérées comme n'importe quel autre élément du déroulé.
- **Mode Live** : raccourcis vers les playlists de l'appareil pour n'ajouter que leurs chants (divisés par catégorie si la playlist l'est). Un appareil "hôte" partage en direct le chant en cours à d'autres appareils du groupe, connectés en pair-à-pair (WebRTC, appairage par QR code) — chacun peut suivre sur son propre écran et s'envoyer des messages courts pendant le service.
- **Mode hors-ligne** : téléchargement des partitions en cache local (Service Worker) pour une consultation sans connexion.
- **Mode administrateur** : avec un token GitHub (Personal Access Token), importer, renommer, déplacer ou supprimer une partition et ses paroles directement depuis l'app — les changements sont commités sur le dépôt.

## Stack technique

Aucune dépendance de build : un seul fichier HTML avec CSS et JavaScript vanilla inline, quelques librairies chargées depuis des CDN :

- [pdf.js](https://mozilla.github.io/pdf.js/) — rendu des partitions PDF
- [Sortable.js](https://sortablejs.github.io/Sortable/) — réordonnancement des chants dans une messe/playlist
- [lz-string](https://pieroxy.net/blog/pages/lz-string/index.html) — compression des liens de partage (messe/playlist encodées dans l'URL)
- [QRious](https://github.com/neocotic/qrious) / [jsQR](https://github.com/cozmo/jsQR) — génération et lecture de QR code (appairage Mode Live)
- [MediaPipe Face Mesh](https://developers.google.com/mediapipe) — reconnaissance faciale pour le tourne-page
- API GitHub (Contents + Git Trees) — catalogue et écriture du contenu
- API [AELF](https://api.aelf.org/) — lectures du jour

## Structure du dépôt

```
index.html          L'application (tout est dedans : HTML, CSS, JS)
sw.js                Service Worker (cache applicatif + mode hors-ligne)
manifest.json         Manifeste PWA
version.json           Version courante, sert à déclencher la notification de mise à jour
favicon.ico / .svg, favico.ico   Icônes
partitions/<catégorie>/<nom>.pdf   Les partitions (source de vérité de la bibliothèque)
paroles/<catégorie>/<nom>.txt      Paroles associées (même chemin relatif que le PDF, extension .txt)
outils/restaurer_ids.py   Remet les identifiants (A20, LC5, P3…) devant les noms de partitions (voir ids_partitions.json)
autre/               Fichiers hérités d'anciennes versions, non utilisés par l'app actuelle
```

### Comment la bibliothèque est construite

`index.html` ne lit **aucun catalogue statique** : au chargement, il interroge l'API GitHub (`git/trees`) pour lister tous les PDF sous `partitions/`, et construit la bibliothèque à partir de ces chemins (catégorie = sous-dossier, nom = nom de fichier). Les fichiers de paroles sous `paroles/` sont associés automatiquement à leur partition par la même convention de nom de chemin — aucune base de données ni champ à synchroniser à la main.

### Mode administrateur

Un administrateur entre un Personal Access Token GitHub (avec droit d'écriture sur le dépôt) dans les Paramètres ; il est chiffré et stocké uniquement sur l'appareil. Une fois actif, toutes les tâches d'administration passent par le **Dashboard Admin** (plein écran, pensé pour tablette), accessible depuis les Paramètres ou l'icône à côté de la roue crantée :

- **Partitions** : importer (au choix *locale*, sur cet appareil seulement, ou *générale*, commitée sur GitHub sous `partitions/` et `paroles/`), renommer, changer de catégorie, corriger les paroles, supprimer.
- **Catégories** (`categories.json`) : ajouter, renommer, supprimer.
- **Playlists publiques** (`public_playlists.json`) : photo obligatoire (publiée sous `covers/playlists/`), option « diviser par catégorie », accès libre ou par code à 8 chiffres.
- **Messes publiques** (`public_messes.json`) : même logique que les playlists (déroulé complet avec notes et lectures AELF, accès libre ou par code).

Les utilisateurs importent une playlist ou une messe publique depuis le bouton « Importer » de l'onglet correspondant (code d'accès, fichier .json, ou contenu public sans code), ou via un lien `?code=…`.

Sans mode administrateur, un import de partition reste local à l'appareil (stocké dans le cache du navigateur), sans toucher au dépôt.

## Déploiement

Le dépôt est fait pour être servi tel quel par n'importe quel hébergement statique (GitHub Pages, Netlify, etc.) : pas de build, `index.html` à la racine comme point d'entrée. Après un changement, mettre à jour `version.json` déclenche la notification "mise à jour disponible" chez les utilisateurs qui ont déjà l'app installée.

## Développement local

Aucune installation nécessaire : servir le dossier avec n'importe quel serveur statique (par exemple `npx serve` ou l'extension Live Server) et ouvrir `index.html`. Un vrai serveur HTTP (pas `file://`) est nécessaire pour que le Service Worker et les appels à l'API GitHub fonctionnent correctement.
