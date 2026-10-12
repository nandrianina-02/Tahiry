#!/usr/bin/env bash
# Sauvegarde la base MongoDB de Tahiry via mongodump.
# Nécessite que mongodump soit installé (fait partie de MongoDB Database Tools :
# https://www.mongodb.com/try/download/database-tools) et que MONGODB_URI soit
# défini (dans .env ou l'environnement).
#
# Utilisation :
#   npm run backup
#   ou directement : bash scripts/backup.sh
#
# Conserve les 14 dernières sauvegardes (rotation simple), un dossier par date.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs -d '\n' 2>/dev/null || grep -v '^#' .env | xargs)
fi

if [ -z "${MONGODB_URI:-}" ]; then
  echo "[ERREUR] MONGODB_URI n'est pas défini (vérifie ton fichier .env)." >&2
  exit 1
fi

if ! command -v mongodump &> /dev/null; then
  echo "[ERREUR] mongodump introuvable. Installe MongoDB Database Tools :" >&2
  echo "         https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
fi

BACKUP_ROOT="./backups"
STAMP=$(date +%Y-%m-%d_%H-%M-%S)
DEST="$BACKUP_ROOT/$STAMP"

mkdir -p "$DEST"
echo "[INFO] Sauvegarde en cours vers $DEST ..."
mongodump --uri="$MONGODB_URI" --out="$DEST"
echo "[OK] Sauvegarde terminée : $DEST"

# Rotation : ne garde que les 14 sauvegardes les plus récentes
cd "$BACKUP_ROOT"
ls -1t | tail -n +15 | while read -r old; do
  echo "[INFO] Suppression de l'ancienne sauvegarde : $old"
  rm -rf "$old"
done

echo "[OK] Rotation terminée. Sauvegardes conservées :"
ls -1t
