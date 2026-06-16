#!/bin/bash
REPO_HASH=$(echo "$PWD" | md5sum | cut -c1-8)
FLAG="/tmp/.claude-rules-shown-${REPO_HASH}"
if [ ! -f "$FLAG" ]; then
  touch "$FLAG"
  cat << 'RULES'
⚠️ RÈGLES CRITIQUES — début de session :
1. SYNC          git fetch origin master && git rebase origin/master (AVANT toute modif)
2. BRANCHE       Travailler sur claude/<nom> — JAMAIS sur master
3. APRÈS COMMIT  Lien PR + commandes dev + commandes prod (hash + mongodump conditionnel)
4. SCHÉMA DB     STOP → demander mongodump AVANT tout changement des collections examples/estimations
5. DEV D'ABORD   Tester sur pallet-estimator-dev (port 3005) avant prod
RULES
fi
