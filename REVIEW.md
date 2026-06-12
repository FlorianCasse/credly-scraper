# Audit complet — credly-scraper

**Date :** 2026-06-11
**Périmètre :** sécurité, performance, architecture, UX, UI, accessibilité, gestion d'erreurs, qualité des tests.
**Fichiers audités :** `server.js`, `script.js`, `index.html`, `style.css`, `credly_badge_downloader.sh`, `.github/workflows/deploy.yml`, `README.md`, `.env.example`, `.gitignore`.

**Note :** le finding CRITICAL de l'ancien rapport (`security-review-credly-scraper.md` — mot de passe en dur) est **déjà corrigé** sur cette branche (commit #37 : env vars obligatoires, fail-fast au démarrage).

Vérification après chaque correctif : `npm test` (une fois l'infra créée — M3), `npm run lint` (`node --check` + `bash -n`), pas de build (site statique sans bundler).

---

## CRITICAL

_Aucun. Pas de secret exposé, auth requise sur toutes les routes serveur._

---

## MAJOR

### M1 — XSS via `innerHTML` avec des données contrôlées par des tiers (Credly)
- **Fichiers :** `script.js` — `createBadgeCard()` (~l.410), `createCommonCard()` (~l.502), `renderByCertification()` (~l.549), `exportCertificationCSV` non concerné.
- **Détail :** les noms de badges (`badge_template.name`), les émetteurs (`issuer_org_name`), les display names (`first_name`/`last_name` saisis par les utilisateurs Credly) et `badge.image_url` sont interpolés dans `innerHTML` sans échappement. Un profil Credly malveillant scrappé par un utilisateur authentifié peut exécuter du JS dans sa session.
- **Correctif :** échappement HTML systématique (`escapeHTML`) des données tierces interpolées, suppression des attributs `data-url`/`data-index` inutilisés (les listeners utilisent déjà des closures).
- **Statut :** ✅ corrigé

### M2 — Liste des profils prédéfinis dupliquée serveur/client et **déjà désynchronisée**
- **Fichiers :** `server.js` (`getAllPredefinedUsernames`, ~l.413) vs `script.js` (`PREDEFINED_PROFILES`, ~l.48).
- **Détail :** le serveur (prewarm du cache) a sa propre copie en dur. Elle a déjà divergé : côté serveur, Germany n'a que 1 profil (21 côté client), Netherlands manque 4 profils et en contient 1 retiré (`wesley-geelhoed`), Nordics absent. Le prewarm chauffe donc le cache pour les mauvais profils.
- **Correctif :** source de vérité unique `predefined-profiles.js` (export UMD : `module.exports` côté Node, global côté navigateur), consommée par `server.js` et `index.html`/`script.js`. Le prewarm couvre maintenant les 91 profils (au lieu de ~64).
- **Statut :** ✅ corrigé

### M3 — Aucun test, aucun lint, aucun script de vérification
- **Fichiers :** `package.json` (seul script : `start`).
- **Détail :** zéro test automatisé sur la logique serveur (validation des profils, cache LRU/TTL, limiteur de concurrence, normalisation d'URL, auth) ; aucun lint. Toute régression passe inaperçue.
- **Correctif :** helpers exportés depuis `server.js` (démarrage conditionné à `require.main === module`, `DATA_FILE` surchargeable par env pour l'isolation des tests), suite `tests/server.test.js` en `node:test` pur (11 tests : auth Basic, validation `/api/credly` et `/api/batch-badges`, CRUD profils avec doublons, cache, limiteur de concurrence, normalisation, fusion prédéfinis+custom) ; scripts npm `test` et `lint` (`node --check` ×3 + `bash -n`).
- **Statut :** ✅ corrigé

### M4 — GitHub Pages publie une copie publique, non authentifiée et cassée du site
- **Fichiers :** `.github/workflows/deploy.yml` ; vérifié en ligne : `https://floriancasse.github.io/credly-scraper/` répond 200 sans auth.
- **Détail :** le site a été volontairement mis derrière HTTP Basic Auth (#36), mais le workflow déploie tout le repo sur GitHub Pages, publiquement. La copie est non fonctionnelle (aucun backend `/api`, donc fetch cassé) mais expose une UI publique listant l'outil et son contenu, en contradiction directe avec la décision de gating.
- **Correctif :** workflow supprimé. ⚠️ **Action manuelle requise :** désactiver GitHub Pages dans les settings du repo (ou `gh api -X DELETE repos/FlorianCasse/credly-scraper/pages`) pour dépublier la copie existante — non fait automatiquement car action destructive côté GitHub.
- **Statut :** ✅ corrigé (workflow) / ⚠️ dépublication Pages à faire manuellement

---

## MINOR

### m1 — `express.static(__dirname)` sert les fichiers internes du projet
- **Fichier :** `server.js:55`.
- **Détail :** `GET /server.js`, `/package-lock.json`, `/README.md`, `/data/custom-profiles.json` sont servis. Pas de secret exposé (`.env` est un dotfile, ignoré par défaut), et le repo est public — mais la surface est inutile.
- **Correctif :** allowlist explicite des assets front (`index.html`, `style.css`, `script.js`, `predefined-profiles.js`) + test de non-régression.
- **Statut :** ✅ corrigé

### m2 — Comparaison non constant-time du mot de passe admin
- **Fichier :** `server.js:347, 381` (`password !== PASSWORD`).
- **Détail :** la Basic Auth utilise `timingSafeEqual` mais pas les routes profils.
- **Correctif :** réutiliser `safeEqual()` (+ garde `typeof string` contre les payloads non-string).
- **Statut :** ✅ corrigé

### m3 — Script CDN JSZip sans SRI
- **Fichier :** `index.html:94`.
- **Détail :** compromission de cdnjs = exécution de JS arbitraire dans une app authentifiée.
- **Correctif :** attributs `integrity` + `crossorigin`.
- **Statut :** à corriger

### m4 — `window.open(url, '_blank')` sans `noopener`
- **Fichier :** `script.js` (`createBadgeCard`).
- **Correctif :** `window.open(url, '_blank', 'noopener,noreferrer')`.
- **Statut :** à corriger

### m5 — Écriture non atomique de `data/custom-profiles.json`
- **Fichier :** `server.js` (`writeProfiles`).
- **Détail :** `writeFileSync` direct : un crash en cours d'écriture corrompt le fichier (et `readProfiles()` retournerait `{}` en silence = perte de données).
- **Correctif :** écrire dans un fichier temporaire puis `renameSync` (atomique sur le même volume).
- **Statut :** à corriger

### m6 — `JSON.parse(event.data)` sans try/catch dans le handler SSE
- **Fichier :** `script.js` (`handleFetchBadges`, `eventSource.onmessage`).
- **Détail :** un événement malformé jette une exception non gérée et le profil est silencieusement perdu.
- **Statut :** à corriger

### m7 — Accessibilité : messages dynamiques, onglets et images sans sémantique
- **Fichiers :** `index.html`, `script.js`.
- **Détail :** `#error-message`/`#info-message` sans `role`/`aria-live` (les lecteurs d'écran ratent les erreurs) ; onglets sans `role="tab"`/`aria-selected` ; canvas de badges sans nom accessible ; spinner sans `aria-hidden`.
- **Correctif :** `role="alert"`/`role="status"` sur les messages, `role="img"` + `aria-label` sur les conteneurs d'images, `aria-selected` sur les onglets.
- **Statut :** à corriger

### m8 — README et footer décrivent des fonctionnalités supprimées
- **Fichiers :** `README.md` (« Self-service profile registration — modal dialog », supprimé en #38), section déploiement Pages.
- **Statut :** à corriger

### m9 — Pas de rate limiting sur les tentatives d'authentification
- **Fichier :** `server.js` (middleware Basic Auth, `POST/DELETE /api/profiles`).
- **Détail :** brute-force possible sur `SITE_PASSWORD`/`APP_PASSWORD`.
- **Statut :** ⚠️ **documenté, non corrigé volontairement** — le serveur tourne derrière nginx ; un limiteur par IP sans `trust proxy` correctement configuré (inconnu ici) bloquerait tous les utilisateurs d'un coup (toutes les requêtes ont l'IP du proxy). À traiter côté nginx (`limit_req`) ou avec la config proxy réelle.

### m10 — `extractUsername` n'exclut pas `?`/`#` (incohérent avec `normalizeProfileUrl`)
- **Fichier :** `script.js` (`extractUsername`).
- **Détail :** `https://www.credly.com/users/foo?x=1` donne le username `foo?x=1` → requêtes Credly cassées, alors que `normalizeProfileUrl` gère le cas.
- **Statut :** à corriger

---

## NITPICK (non corrigés — hors périmètre selon les règles de l'audit)

- **n1** — ~120 lignes de CSS mort (`.modal*`, `.add-profile-btn`, `.custom-profile*`) : l'UI correspondante a été supprimée en #38.
- **n2** — `createConcurrencyLimiter` dupliqué à l'identique client/serveur (pas de système de modules côté front pour le partager proprement sans bundler).
- **n3** — `lang="en"` mais libellés mélangés FR/EN (« #Individus … », notes QBR en anglais).
- **n4** — Contraste faible : `.qbr-empty` (#999 sur blanc ≈ 2,8:1) et `.qbr-country-name` (#666).
- **n5** — `/api/cache-stats` expose des métriques internes (déjà derrière la Basic Auth, impact nul).
- **n6** — `credly_badge_downloader.sh` duplique la logique de pagination/sanitisation de la web app ; `((counter++))` avec `set -e` est fragile (retourne 1 quand counter passe de 0 à... non applicable ici car counter démarre à 1, mais le pattern est risqué) ; pipeline `while read` en subshell donc `counter` non propagé après la boucle (sans effet ici).
- **n7** — L'animation `slideIn`/`transition: all` sur `.badge-card` est coûteuse avec des centaines de cartes ; pas de `prefers-reduced-motion`.
- **n8** — `security-review-credly-scraper.md` est obsolète (décrit un état du code antérieur à #37) ; conservé comme archive historique.

---

## Itérations

- **Itération 1 (2026-06-11) :** audit initial — 4 major, 10 minor, 8 nitpick. Correctifs en cours dans l'ordre de sévérité.
