#!/usr/bin/env node
// Télécharge les fichiers (images d'items, etc.) d'une collection PocketBase
// via l'API HTTPS — sans dépendance externe (Node 18+ requis pour fetch).
//
// À exécuter sur une machine dont le réseau peut joindre le serveur PocketHost
// (l'environnement Claude Code sur le web bloque ce domaine et le port SFTP 2022).
//
// Usage rapide :
//   PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \
//   node scripts/download-pocketbase-images.mjs items
//
// Ou en passant tout en options :
//   node scripts/download-pocketbase-images.mjs \
//     --url https://mildly-haunted-fax-machine.pockethost.cloud \
//     --collection items \
//     --out ./downloads/items \
//     --admin-email you@example.com --admin-password 'secret'
//
// Variables d'environnement reconnues :
//   PB_URL, PB_COLLECTION, PB_OUT,
//   PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD  (compte superuser/admin)
//   PB_AUTH_COLLECTION / PB_AUTH_IDENTITY / PB_AUTH_PASSWORD (auth utilisateur)
//   PB_THUMB  (ex. "100x100" pour télécharger les miniatures au lieu de l'original)

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// --------------------------- Configuration -------------------------------

const DEFAULTS = {
  url: "https://mildly-haunted-fax-machine.pockethost.cloud",
  collection: "items",
  out: "./downloads",
  perPage: 200,
  thumb: "", // ex. "0x300" pour des miniatures (PocketBase génère le thumb)
};

// Extensions considérées comme des fichiers téléchargeables (heuristique de
// secours quand le schéma de la collection n'est pas lisible).
const FILE_EXT = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico|pdf|mp4|webm|mp3|wav)$/i;

// --------------------------- Parsing des args ----------------------------

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { opts, positional };
}

const { opts, positional } = parseArgs(process.argv.slice(2));

const cfg = {
  url: (opts.url || process.env.PB_URL || DEFAULTS.url).replace(/\/+$/, ""),
  collection:
    opts.collection || positional[0] || process.env.PB_COLLECTION || DEFAULTS.collection,
  out: opts.out || process.env.PB_OUT || DEFAULTS.out,
  thumb: opts.thumb || process.env.PB_THUMB || DEFAULTS.thumb,
  adminEmail: opts["admin-email"] || process.env.PB_ADMIN_EMAIL,
  adminPassword: opts["admin-password"] || process.env.PB_ADMIN_PASSWORD,
  authCollection: opts["auth-collection"] || process.env.PB_AUTH_COLLECTION,
  authIdentity: opts["auth-identity"] || process.env.PB_AUTH_IDENTITY,
  authPassword: opts["auth-password"] || process.env.PB_AUTH_PASSWORD,
};

// --------------------------- Helpers API ---------------------------------

let authToken = "";

function authHeaders() {
  return authToken ? { Authorization: authToken } : {};
}

async function pbFetch(path, init = {}) {
  const res = await fetch(`${cfg.url}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  return res;
}

async function authenticate() {
  // 1) Superuser / admin (PocketBase >= 0.23 : collection _superusers ;
  //    versions antérieures : endpoint /api/admins). On tente les deux.
  if (cfg.adminEmail && cfg.adminPassword) {
    const attempts = [
      ["/api/collections/_superusers/auth-with-password", {
        identity: cfg.adminEmail,
        password: cfg.adminPassword,
      }],
      ["/api/admins/auth-with-password", {
        identity: cfg.adminEmail,
        password: cfg.adminPassword,
      }],
    ];
    for (const [path, body] of attempts) {
      const res = await pbFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        authToken = data.token;
        console.log(`✓ Authentifié en admin via ${path}`);
        return;
      }
    }
    throw new Error("Échec de l'authentification admin (vérifie email/mot de passe).");
  }

  // 2) Utilisateur d'une collection auth classique.
  if (cfg.authCollection && cfg.authIdentity && cfg.authPassword) {
    const res = await pbFetch(
      `/api/collections/${encodeURIComponent(cfg.authCollection)}/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: cfg.authIdentity, password: cfg.authPassword }),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Échec de l'authentification utilisateur (${res.status}) : ${await res.text()}`,
      );
    }
    const data = await res.json();
    authToken = data.token;
    console.log(`✓ Authentifié en tant qu'utilisateur de "${cfg.authCollection}"`);
    return;
  }

  console.log("ℹ Aucun identifiant fourni — tentative en accès public (anonyme).");
}

// Récupère les noms des champs de type "file" via le schéma (nécessite admin).
async function getFileFields() {
  const res = await pbFetch(`/api/collections/${encodeURIComponent(cfg.collection)}`);
  if (!res.ok) return null; // pas d'accès au schéma -> heuristique
  const col = await res.json();
  const fields = col.schema || col.fields || [];
  return fields.filter((f) => f.type === "file").map((f) => f.name);
}

// Pour un enregistrement, renvoie [{field, filename}] des fichiers à télécharger.
function collectFiles(record, fileFields) {
  const out = [];
  const fieldNames = fileFields ?? Object.keys(record);
  for (const name of fieldNames) {
    const val = record[name];
    if (typeof val === "string" && (fileFields || FILE_EXT.test(val))) {
      if (val) out.push({ field: name, filename: val });
    } else if (Array.isArray(val)) {
      for (const v of val) {
        if (typeof v === "string" && v && (fileFields || FILE_EXT.test(v))) {
          out.push({ field: name, filename: v });
        }
      }
    }
  }
  return out;
}

async function downloadFile(recordId, filename, destPath) {
  const q = cfg.thumb ? `?thumb=${encodeURIComponent(cfg.thumb)}` : "";
  const url = `/api/files/${encodeURIComponent(cfg.collection)}/${encodeURIComponent(
    recordId,
  )}/${encodeURIComponent(filename)}${q}`;
  const res = await pbFetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} sur ${filename}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, buf);
  return buf.length;
}

// --------------------------- Programme principal -------------------------

async function main() {
  console.log(`PocketBase : ${cfg.url}`);
  console.log(`Collection : ${cfg.collection}`);
  console.log(`Sortie     : ${cfg.out}\n`);

  await authenticate();

  const fileFields = await getFileFields();
  if (fileFields) {
    console.log(
      fileFields.length
        ? `Champs fichier détectés : ${fileFields.join(", ")}`
        : "⚠ Aucun champ de type 'file' dans cette collection.",
    );
  } else {
    console.log("ℹ Schéma non lisible — détection des fichiers par extension.");
  }

  let page = 1;
  let totalRecords = 0;
  let totalFiles = 0;
  let totalBytes = 0;
  let totalPages = 1;

  do {
    const res = await pbFetch(
      `/api/collections/${encodeURIComponent(cfg.collection)}/records` +
        `?page=${page}&perPage=${DEFAULTS.perPage}`,
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Lecture des records échouée (HTTP ${res.status}) : ${body}\n` +
          "→ La collection est probablement protégée : fournis des identifiants admin " +
          "(PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD).",
      );
    }
    const data = await res.json();
    totalPages = data.totalPages || 1;

    for (const record of data.items) {
      totalRecords++;
      const files = collectFiles(record, fileFields);
      for (const { field, filename } of files) {
        const destPath = join(cfg.out, cfg.collection, record.id, filename);
        try {
          const size = await downloadFile(record.id, filename, destPath);
          totalFiles++;
          totalBytes += size;
          console.log(`  ✓ ${record.id}/${field}/${filename} (${size} o)`);
        } catch (e) {
          console.warn(`  ✗ ${record.id}/${filename} : ${e.message}`);
        }
      }
    }

    console.log(`Page ${page}/${totalPages} traitée.`);
    page++;
  } while (page <= totalPages);

  console.log(
    `\nTerminé : ${totalFiles} fichier(s) (${(totalBytes / 1024 / 1024).toFixed(
      2,
    )} Mo) depuis ${totalRecords} enregistrement(s) → ${cfg.out}/${cfg.collection}/`,
  );
}

main().catch((e) => {
  console.error(`\nErreur : ${e.message}`);
  process.exit(1);
});
