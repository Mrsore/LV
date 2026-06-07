# Récupération des fichiers PocketBase (images d'items)

`download-pocketbase-images.mjs` télécharge les fichiers d'une collection
PocketBase via l'API HTTPS, sans dépendance externe (Node 18+, idéalement 20/22).

> ⚠️ À lancer **sur ta machine** (ou tout environnement dont le réseau peut
> joindre `*.pockethost.cloud`). L'environnement Claude Code sur le web bloque
> ce domaine ainsi que le port SFTP 2022, la connexion y est donc impossible.

## Pourquoi pas le SFTP ?

Le port SFTP **2022** de PocketHost sert à gérer les fichiers bruts du serveur.
Pour simplement **récupérer des fichiers**, l'API PocketBase en HTTPS est plus
simple et c'est la voie recommandée :

```
https://<instance>.pockethost.cloud/api/files/{collection}/{recordId}/{filename}
```

## Utilisation

```bash
# Collection publique
node scripts/download-pocketbase-images.mjs items

# Collection protégée (compte admin / superuser PocketBase)
PB_ADMIN_EMAIL="toi@example.com" \
PB_ADMIN_PASSWORD="ton-mot-de-passe-admin" \
node scripts/download-pocketbase-images.mjs items

# Tout via options explicites
node scripts/download-pocketbase-images.mjs \
  --url https://mildly-haunted-fax-machine.pockethost.cloud \
  --collection items \
  --out ./downloads/items \
  --admin-email toi@example.com \
  --admin-password 'secret'
```

Les fichiers sont enregistrés sous `./downloads/<collection>/<recordId>/<filename>`.

## Options

| Option CLI | Variable d'env | Défaut |
|---|---|---|
| `--url` | `PB_URL` | l'instance PocketHost |
| `--collection` (ou 1er argument) | `PB_COLLECTION` | `items` |
| `--out` | `PB_OUT` | `./downloads` |
| `--thumb` | `PB_THUMB` | *(vide → original)* ; ex. `0x300` |
| `--admin-email` | `PB_ADMIN_EMAIL` | — |
| `--admin-password` | `PB_ADMIN_PASSWORD` | — |
| `--auth-collection` | `PB_AUTH_COLLECTION` | — |
| `--auth-identity` | `PB_AUTH_IDENTITY` | — |
| `--auth-password` | `PB_AUTH_PASSWORD` | — |

> 🔐 Préfère les **variables d'environnement** pour les mots de passe plutôt
> que la ligne de commande (qui peut rester dans l'historique du shell).

## Notes

- Le script lit le schéma de la collection (si l'accès admin le permet) pour
  cibler précisément les champs de type *file* ; sinon il détecte les fichiers
  par extension (`.png`, `.jpg`, `.webp`, …).
- Pagination automatique (200 enregistrements par page).
- Une erreur sur un fichier n'interrompt pas le reste du téléchargement.
