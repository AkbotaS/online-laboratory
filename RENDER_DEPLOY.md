# Render deployment

The project runs as a Node.js Web Service. Render provides `PORT`; the server binds to `0.0.0.0` whenever `PORT` is set. Local runs keep the `127.0.0.1:4173` default.

## Service commands

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`

## Environment variables

- `ADMIN_USERNAME`: 3–40 Latin letters, digits, dots, hyphens, or underscores.
- `ADMIN_PASSWORD`: at least 12 characters. The value is never logged or stored in source; the server stores only a scrypt hash.
- `OPENAI_API_KEY`: optional. The lab and assessment APIs work without it; only AI mentor requests need the key.
- `ONLINE_LAB_DATA_DIR`: optional. On Render the server defaults this to `/var/data`; locally it uses `data/` in the project.

## Keep accounts and results after restarts

Render's default filesystem is ephemeral. In the existing Web Service, open **Disks**, add a persistent disk mounted at `/var/data`, and save. This requires a paid Web Service plan. The server stores account, curriculum, and analytics files under `/var/data/learning-analytics` after that disk is attached. Keep the service at one instance because a Render disk is attached to one instance.

On the first start with an empty data directory, the server copies `seed/curriculum.json` into the data directory. It seeds only when the curriculum file is absent. Existing curriculum, account, and analytics files are not replaced. `data/` remains excluded from Git so student names, password hashes, and results are not committed.

After GitHub deploys the new `main` commit, check **Events** for `Online Laboratory listening on 0.0.0.0:<port>`, then open `/api/health`. It should return `ok: true` and `adminConfigured: true`. If admin setup is false, check the username format and the 12-character minimum; no credential value is printed in the logs.
