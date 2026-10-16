# Cantus pour iPhone (.ipa)

Une vraie app iOS, avec l'icône Cantus sur l'écran d'accueil. Pas besoin de Mac : un Mac de
GitHub compile le `.ipa`, et vous l'installez depuis Windows.

## Comment c'est construit

- L'app native (Swift, `Cantus/App.swift`) affiche **cantus-app.fr** dans un moteur web
  WKWebView. C'est le même code et la même « base de données » GitHub (`partitions/`, `paroles/`,
  `categories.json`, `public_playlists.json`…), et le mode admin écrit toujours dans le dépôt.
  Une mise à jour du site (avec `version.json`) arrive donc aussi dans l'app, sans réinstaller.
- **Hors-ligne** : le service worker du site (`sw.js`) fonctionne dans l'app grâce aux
  *App-Bound Domains*. Le shell, les PDF et les paroles déjà ouverts ou téléchargés restent
  disponibles sans réseau. Le tout premier lancement doit se faire en ligne ; sinon un écran
  natif « Réessayer » s'affiche.
- **Design iOS propre à l'app** (la PWA du site garde son design ; les deux restent
  compatibles, mode Live compris) :
  - barre d'onglets et barres de navigation natives en **Liquid Glass** (iOS 26 ; style
    translucide classique avant) : Bibliothèque, Playlists, Messes, Favoris (avec Historique),
    Live ; boutons Réglages, « + » (nouvelle playlist/messe, importer) et Dashboard admin ;
  - habillage `Cantus/skin.css` d'après la maquette Figma « Cantus » : fond crème et vert
    profond (thème sombre « forêt de nuit »), titres Onest et texte DM Sans (polices
    embarquées dans `Cantus/fonts/`, licence SIL OFL), vignettes de couleur par catégorie,
    puces de catégories, réglages et dialogues en feuilles qui montent du bas ; le thème suit
    celui de l'iPhone au premier lancement ;
  - les barres disparaissent en plein écran (partition, éditeurs) avec la barre d'état ;
  - second appui sur un onglet pour remonter en haut, dernier onglet rouvert au lancement.
- **Ajouts natifs**, injectés par `Cantus/bridge.js` sans modifier `index.html` (la PWA du
  site ne change pas) :
  - retour haptique à chaque appui sur un bouton, et `navigator.vibrate` relié au moteur haptique ;
  - affichage bord à bord avec les zones sûres (`viewport-fit=cover`) ;
  - barre d'état qui suit le thème clair/sombre ;
  - écran maintenu allumé pendant le jeu des partitions ;
  - démarrage sans flash blanc (écran de lancement noir avec le logo, puis fondu) ;
  - export de playlists via la feuille de partage iOS ;
  - liens externes ouverts dans Safari ;
  - pas de zoom ni de menu au toucher long ;
  - accès à la caméra (QR codes, tourne-page à la tête).
- `project.yml` décrit le projet Xcode. [XcodeGen](https://github.com/yonaskolb/XcodeGen) le
  génère sur le runner macOS, donc aucun `.xcodeproj` n'est versionné.

## 1. Obtenir le .ipa

Le workflow `.github/workflows/ios.yml` se lance à chaque push qui touche `iOS/`. Vous pouvez
aussi le lancer à la main : **GitHub → Actions → « iOS (.ipa) » → Run workflow**. La compilation
prend environ 5 minutes.

Récupérez ensuite le fichier, au choix :

- **Release** (le plus simple, même depuis l'iPhone) :
  <https://github.com/Cyprdu/cantus/releases/tag/ios-latest>, puis téléchargez `Cantus.ipa`.
- **Artefact** : ouvrez le run dans l'onglet Actions, téléchargez `Cantus-ipa` en bas de la page,
  puis dézippez-le.

Le `.ipa` n'est pas signé : c'est l'outil d'installation qui le signe avec votre identifiant Apple.

## 2a. Installer avec Sideloadly (Windows, le plus direct)

1. Installez **iTunes** et **iCloud** en version « site Apple », pas celles du Microsoft Store :
   Sideloadly en a besoin pour voir l'iPhone.
2. Installez [Sideloadly](https://sideloadly.io).
3. Branchez l'iPhone en USB, déverrouillez-le et appuyez sur « Se fier à cet ordinateur ».
4. Dans Sideloadly, glissez `Cantus.ipa`, saisissez votre identifiant Apple, puis cliquez sur **Start**.
5. Sur l'iPhone, allez dans **Réglages → Général → VPN et gestion de l'appareil**, choisissez votre
   identifiant Apple, puis **Faire confiance**.
6. Sur iOS 16 ou plus récent, activez **Réglages → Confidentialité et sécurité → Mode développeur**.
   L'iPhone redémarre.

L'icône Cantus apparaît sur l'écran d'accueil.

## 2b. Ou avec AltStore

1. Installez [AltServer pour Windows](https://altstore.io) (il faut aussi iTunes et iCloud
   en version « site Apple »), puis installez AltStore sur l'iPhone depuis l'icône AltServer.
2. Faites confiance au profil et activez le mode développeur, comme aux étapes 5 et 6 ci-dessus.
3. Sur l'iPhone, téléchargez `Cantus.ipa` depuis la release, puis ouvrez **AltStore → My Apps → +**
   et choisissez le fichier.

## Limites de l'identifiant Apple gratuit

- L'app **expire au bout de 7 jours**. Réinstallez-la, ou laissez AltStore/Sideloadly la
  rafraîchir automatiquement (même Wi-Fi que le PC, AltServer ou Sideloadly lancé). Vos données
  (partitions hors-ligne, playlists, réglages) sont conservées tant que vous ne supprimez pas l'app.
- 3 apps « sideloadées » au maximum par appareil.
- Avec un **compte Apple Developer** (99 €/an), la signature dure 1 an et la distribution peut
  passer par TestFlight. Il faut alors ajouter un certificat et un profil de provisionnement au
  workflow ; ce n'est pas fait ici.

## Modifier l'app

- **Contenu et interface** : on modifie le site (`index.html`), comme d'habitude. L'app suit,
  sans recompiler.
- **Partie native** : on modifie `iOS/Cantus/App.swift` ou `iOS/Cantus/bridge.js`, puis on
  pousse. Le workflow produit un nouveau `.ipa`.
- **Icône** : elle est générée depuis `favicon.svg`. Pour la refaire (ImageMagick, depuis la
  racine du dépôt) :

  ```bash
  magick -background none -density 1200 favicon.svg -resize 680x680 -background "#090909" -gravity center -extent 1024x1024 -alpha remove -alpha off -depth 8 iOS/Cantus/Assets.xcassets/AppIcon.appiconset/icon-1024.png
  ```
