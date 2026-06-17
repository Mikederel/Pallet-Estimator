# CLAUDE.md — Pallet Estimator

## ⚠️ RÈGLES CRITIQUES (à lire en début de chaque session)
1. **Sync avant la première modif** — `git fetch origin master && git rebase origin/master`. Le container cloud peut être cloné avant un merge récent ; sans ça, Claude travaille sur une version périmée.
2. **Jamais pousser sur master** — toujours travailler sur la branche de session `claude/<nom>` assignée au démarrage. Ne pas réutiliser une branche d'une session précédente.
3. **Séquence complète après chaque commit** — donner le lien PR pré-rempli + commandes serveur dev + commandes prod (hash de retour + backup DB conditionnel). L'utilisateur ne doit jamais deviner quoi faire après un commit.
4. **Stop si changement de schéma DB** — si le changement touche les collections `examples` / `estimations` (format de doc, champ obligatoire, migration) : demander un `mongodump` AVANT d'écrire du code. Attendre la confirmation explicite.
5. **Dev d'abord, jamais prod directement** — tester sur `pallet-estimator-dev` (port 3005) avant toute promotion en production.

---

## 1. Ce que fait cette application
Estimateur de palettes. À partir d'une **liste de matériel** (texte libre, avec dimensions / quantités), l'app interroge **Claude (Opus 4.8)** avec des **exemples concrets** (few-shot) stockés dans MongoDB et renvoie un **nombre de palettes** estimé + un raisonnement + une ventilation par groupe. Sortie structurée JSON (validée par Zod).

## 2. Environnements
⚠️ Toujours travailler sur dev d'abord. Ne jamais modifier la production directement.

| | Production | Dev |
|---|---|---|
| URL / accès | `http://<serveur>:3004` | `http://localhost:3005` |
| Dossier serveur | `/home/cardano/pallet-estimator` | `/home/cardano/pallet-estimator-dev` |
| Branche git | `master` | `master` |
| Port | `3004` | `3005` |
| Base de données | `pallet-estimator` | `pallet-estimator-dev` |
| Processus PM2 | `pallet-estimator` | `pallet-estimator-dev` |

⚠️ **Adapter les chemins** ci-dessus si tes apps vivent ailleurs (ex. `~/apps/...`, comme `calendar-app`). MongoDB local : `mongodb://127.0.0.1:27017`.

🔑 **Clé API requise** : `ANTHROPIC_API_KEY` dans un `.env` (non commité) sur chaque serveur — voir `.env.example`. C'est une clé distincte de Claude Code ; l'obtenir sur console.anthropic.com.

## 3. Commandes pour démarrer / arrêter
```bash
# Démarrer (production, port 3004)
pm2 start ecosystem.config.cjs

# Démarrer (dev, port 3005)
pm2 start ecosystem.dev.config.cjs

# Logs
pm2 logs pallet-estimator-dev

# Charger les exemples de calibration depuis ./examples-data (un dossier par job)
npm run ingest
```
💡 Après chaque `pm2 start` / `restart` : **`pm2 save`** (persiste la liste des processus pour survie au reboot). À faire dev ET prod.

## 4. Règles Git
- Branche de travail Claude : toujours pousser sur `claude/<nom>`, **jamais sur master**.
- Début de session : `git fetch origin master && git rebase origin/master` avant la première modif.
- Claude gère commit + push automatiquement. L'utilisateur ne commit jamais manuellement.
- Pas de `reset --hard` / `push --force` en routine (uniquement pour jeter des commits faits par erreur sur une base périmée).

## 5. Workflow complet
**Étape 1 — Demander un changement à Claude.** Claude code, commit et push sur `claude/<nom>`. Après chaque commit, Claude donne : lien PR + commandes dev + commandes prod.

**Étape 2 — Tester sur dev** (après merge du PR sur `master`) :
```bash
cd /home/cardano/pallet-estimator-dev
git pull origin master
npm install                       # seulement si les dépendances ont changé
pm2 restart pallet-estimator-dev
pm2 save
# → tester sur http://localhost:3005
```

**Étape 3 — Rollback dev** (si ça ne marche pas) :
```bash
git log --oneline -10
git checkout <hash>
pm2 restart pallet-estimator-dev && pm2 save
```

**Étape 4 — Mettre en production (procédure sécuritaire) :**
```bash
cd /home/cardano/pallet-estimator
# 1A. Toujours — sauvegarder le hash de retour
git rev-parse HEAD > ~/backups/last-prod-hash-pallet.txt
cat ~/backups/last-prod-hash-pallet.txt
# 1B. Seulement si le changement touche les données — backup DB horodaté
mongodump --db pallet-estimator --out ~/backups/$(date +%Y%m%d-%H%M%S)-prod
# Déploiement
git pull origin master
npm install                       # seulement si les dépendances ont changé
pm2 restart pallet-estimator
pm2 save
```
💡 Inclure le `mongodump` (1B) si le changement touche un schéma/format de stockage ou migre des documents. L'omettre pour un changement UI/CSS, frontend seul, ou ajout d'endpoints en lecture. En cas de doute → inclure.

**Étape 5 — Rollback production :**
```bash
# Cas A — code seul (DB intacte)
git checkout <hash-d-avant>       # voir ~/backups/last-prod-hash-pallet.txt
pm2 restart pallet-estimator && pm2 save
# Cas B — code ET base de données
git checkout <hash-d-avant>
mongorestore --db pallet-estimator --drop ~/backups/<TIMESTAMP>-prod/pallet-estimator
pm2 restart pallet-estimator && pm2 save
```

## 6. Sauvegarde base de données
Claude doit STOPPER et demander un backup si le changement : ajoute/renomme/supprime un champ dans `examples` ou `estimations`, change le format de stockage, ou migre des documents existants.
```bash
# Dev
mongodump --db pallet-estimator-dev --out ~/backups/$(date +%Y%m%d-%H%M%S)-dev
# Prod
mongodump --db pallet-estimator --out ~/backups/$(date +%Y%m%d-%H%M%S)-prod
# Restaurer (--drop vide d'abord, puis réinjecte)
mongorestore --db pallet-estimator-dev --drop ~/backups/<TIMESTAMP>-dev/pallet-estimator-dev
```

## 7. Changements majeurs — bonnes pratiques
Par étapes (un morceau à la fois, push, tester) · feature flag pour cacher le risque · dev d'abord · jamais UI + backend + DB en même temps.

## 8. Commandes utiles
```bash
pm2 list
pm2 logs pallet-estimator-dev
git log --oneline -10
git status
curl localhost:3005/api/health
```

## 9. Stack technique (où est quoi)
- **Express (ESM)** — `src/server.js` (routes `/api/estimate`, `/api/examples`, `/api/health`)
- **MongoDB** (driver `mongodb`) — `src/db.js` ; collections `examples` (few-shot) + `estimations` (historique)
- **Claude** via `@anthropic-ai/sdk` — `src/estimator.js` : modèle `claude-opus-4-8`, sortie structurée Zod, thinking adaptatif, prompt few-shot mis en cache (`cache_control`)
- **Prompt few-shot** — `src/prompt.js`
- **Frontend statique** — `public/index.html`
- **PM2** — `ecosystem.config.cjs` (prod :3004) / `ecosystem.dev.config.cjs` (dev :3005)
