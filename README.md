# Dernier Robot

Traverse cinq secteurs, affronte les gardiens et construis ton robot à chaque montée de niveau. Ramasse des bonus, esquive les salves et choisis entre puissance et réparation.

**Android 7.0+ avec Android System WebView à jour · 100 % hors ligne dans l’APK · Sans compte · Sans publicité · MIT**

- [Jouer sur la page du jeu](https://zachiran42.github.io/dernier-robot/)
- [Télécharger l’APK signé de test](docs/downloads/dernier-robot-1.1.0.apk)
- [Signaler un problème](https://github.com/Zachiran42/dernier-robot/issues)

## Jouer

1. Glisse pour bouger. Les tirs sont automatiques ; utilise Esquive pour traverser le danger.
2. Ramasse l’expérience et choisis une augment à chaque montée de niveau.
3. Après un secteur, choisis ta route : puissance et risque, réparation ou bonus temporaires.

TÉLÉPHONE · Joystick au doigt + Esquive · CLAVIER · Flèches / ZQSD · ESPACE esquive · CHOIX · 1 / 2 / 3 · ÉCHAP pause

La progression reste stockée localement. Les règles de la version1.1 changent : les anciennes parties en cours redémarrent, les déblocages et améliorations permanentes sont conservés.

## Installer sur Android

Télécharger l’APK depuis ce dépôt ou sa page. Ouvrir le fichier sur Android et autoriser l’installation pour l’application utilisée pour le téléchargement si Android le demande. L’APK 1.1.0 est une version de test signée avec une clé de développement. Une signature de production stable est recommandée avant une distribution durable.

## Développer et compiler

Jeu écrit en JavaScript Canvas, embarqué dans une petite activité Android Java. Aucun framework, aucune dépendance de jeu distante et aucun serveur. Le dossier docs/ est à la fois la page GitHub Pages et le contenu local embarqué dans l’APK.

Prérequis : JDK 17, Android SDK 35 et Build Tools 35.0.0. Ouvrir dans Android Studio ou configurer ANDROID_HOME, puis :

~~~sh
chmod +x gradlew && ./gradlew assembleDebug
# Windows : .\gradlew.bat assembleDebug
~~~

APK : app/build/outputs/apk/debug/app-debug.apk. Le wrapper télécharge Gradle 8.11.1 au premier lancement. La compilation nécessite Internet pour les outils ; le jeu installé fonctionne en mode avion.

~~~sh
node --test tests/*.test.cjs
# Prévisualisation : servir docs/ avec un serveur HTTP statique.
~~~

## GitHub Pages

La page est dans docs/. Dans Settings → Pages, choisir « Deploy from a branch », branche main, dossier /docs. Le workflow Android valide le code et produit un APK de test en artefact à chaque push.

## Confidentialité et licence

Aucune permission INTERNET dans le manifeste Android. Pas de télémétrie ni d’achats. Sauvegardes Android automatiques désactivées. Les visites de la démo web restent soumises au fonctionnement de GitHub Pages. Voir [la politique détaillée](docs/privacy.html).

Le code, les graphismes procéduraux et les textes originaux sont sous [licence MIT](LICENSE). Le wrapper Gradle et les outils de compilation tiers conservent leurs propres licences.

## Version 1.1.0

Version enrichie avec commandes et difficulté revues. Le comportement tactile et les performances peuvent varier selon le WebView Android de l’appareil.

## Nouveautés 1.1.0

La survie de 90 secondes devient une tentative sur cinq secteurs avec un gardien au troisième et un boss final. Ajout des tireurs et chargeurs, de l’esquive à recharge, de dix augments combinables et de cinq bonus ramassables. Entre les secteurs : augment contre ennemis renforcés, soin sans gain de puissance, ou bouclier/aimant contre davantage de coureurs.
