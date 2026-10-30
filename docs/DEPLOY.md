# Running Crystallume

Crystallume runs in four ways:

| Mode | Good for | Start it with |
|---|---|---|
| [Local](#local-mode) | one person on their own computer | `crystallume serve --open` |
| [Cloud](#cloud-mode) | a group sharing one server, with accounts | `crystallume serve --mode cloud` |
| [Docker](#docker) | either of the above, in a container | `docker compose up -d` |
| [Static](#static-website-no-server) | any web host, or a claude.ai artifact; no server needed | `python scripts/build_artifact.py` |

Install first with `pip install .` in this folder. Crystallume needs Python 3.10 or newer, and only four
packages: fastapi, uvicorn, numpy and python-multipart.

## Local mode

```bash
crystallume serve --open                          # http://127.0.0.1:8765
crystallume serve --port 9000 --data ~/my-atoms   # another port and data folder
```

There is no login. Each project is a folder in `~/.crystallume/projects/` (or `<data folder>/projects/`):

```
projects/
  perovskite-study-p_8f3a91c2d4/
    project.json            # the whole project (see SCHEMA.md)
    structures/s_1.xyz      # each structure as extended XYZ, for other programs
    thumbnail.jpg
  .trash/                   # deleted projects go here, so you can restore them
```

- You can copy or rename project folders. A copied folder gets a new project id.
- Drop a project `.json` (or a structure JSON) into `projects/` and it appears in the list.

### Keep it private

A local server listens on `127.0.0.1`, so only your computer can reach it. If you open it to your network
with `--host 0.0.0.0`, anyone who can reach it can read, change and delete your projects; the server warns
about this when it starts. Use [cloud mode](#cloud-mode) instead, or require a token:

```bash
CRYSTALLUME_TOKEN=<long random string> crystallume serve --host 0.0.0.0
```

In the app, sign in as user `local` with the token as the password. API clients send
`Authorization: Bearer <token>`.

The server also protects you in these ways:

- Wrong tokens count as failed sign-ins. After 10 failures in 5 minutes from one address it answers `429`.
  It warns at start-up about a short token or a placeholder such as `change-me`.
- Other websites cannot use your browser to change your projects. Write requests from another site get `403`,
  unless that site is listed in `CRYSTALLUME_CORS_ORIGINS`, and JSON must be sent as `application/json`.
- Without a token, a server on `127.0.0.1` only answers to `localhost` names, which blocks DNS rebinding.
  To reach it under another name, set `CRYSTALLUME_ALLOWED_HOSTS=<name>` or a token.

## Cloud mode

```bash
crystallume serve --mode cloud --host 0.0.0.0 --data /srv/crystallume
crystallume user create alice --data /srv/crystallume     # asks for a password
```

- Everyone signs in and sees only their own projects.
- Accounts and projects are stored in `<data folder>/crystallume.db` (SQLite). Passwords are stored as salted
  scrypt hashes, and only an HMAC of each sign-in token is kept.
- **Sign-up** is open when the server listens on a loopback address and **closed** on any other address,
  such as `0.0.0.0`. Create accounts with `crystallume user create` (there are also `user list`,
  `user passwd` and `user delete`). Change the default with `CRYSTALLUME_ALLOW_REGISTRATION`, or turn sign-up
  off with `--no-registration`.
- Sign-ins expire after 30 days without use (`CRYSTALLUME_TOKEN_TTL_DAYS`; `0` means never).
- Project routes and server-side analyses need `Authorization: Bearer <token>`.
- Analyses, uploads and request bodies have size limits. Builders make at most 200 000 atoms
  (`CRYSTALLUME_MAX_ATOMS`).
- **Edits never overwrite each other silently.** When two people, or two tabs, change the same project, a save
  based on an old version is refused with `409`. The app then offers to reload, save a copy or overwrite.
  The protocol is described in [SCHEMA.md](SCHEMA.md#concurrent-edits-etag-if-match-409).
- With `--host 0.0.0.0`, the start-up message shows this computer's network addresses.
- On the public internet, put the server behind an HTTPS reverse proxy such as nginx, Caddy or Traefik.
  If the app is served from another origin, add `--cors https://your-app.example.org`.

## Docker

```bash
docker compose up -d                                       # cloud mode; data in a Docker volume
docker compose exec crystallume crystallume user create alice
```

Or with plain Docker:

```bash
docker build -t crystallume .
docker run -p 8765:8765 -v crystallume-data:/data crystallume          # cloud mode

# local mode: projects as folders in ./crystallume-data/projects/, reachable from this computer only
mkdir -p crystallume-data
docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/crystallume-data:/data" \
  -e CRYSTALLUME_MODE=local -e CRYSTALLUME_TOKEN=<long random string> crystallume
```

- The image runs as user id 1000. Create a mounted folder before you start, and pass
  `--user "$(id -u):$(id -g)"` so the container uses it as you. Otherwise Docker creates the folder owned
  by root and the server stops with "permission denied".
- In local mode the token is the sign-in password (user `local`).
- The compose file stores data in the `atomscope_atomscope-data` volume, a name kept from before the rename.
  See [Upgrading from AtomScope](#upgrading-from-atomscope).

## Behind a reverse proxy

To serve Crystallume under a path of another site, say `https://lab.example.org/crystallume/`:

```bash
crystallume serve --mode cloud --root-path /crystallume        # or CRYSTALLUME_ROOT_PATH=/crystallume
```

```nginx
location /crystallume/ {
    proxy_pass http://127.0.0.1:8765/;        # strips the prefix; keeping it (no final /) works too
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;                # match CRYSTALLUME_MAX_UPLOAD_MB
}
```

- The app uses relative URLs, so nothing else needs changing. `/crystallume` redirects to `/crystallume/`.
- **Set the proxy's address** when the proxy runs on another host or in another container:
  `CRYSTALLUME_FORWARDED_ALLOW_IPS=<address or network>` (for example the Docker network `172.28.0.0/16`),
  or `--forwarded-allow-ips`. Sign-in limits count per client address. Without this setting every user seems
  to come from the proxy, and one person's wrong passwords lock everyone out. Never use `*`: any client that
  reaches the port directly could then fake its address to dodge the limits.
- To show the app in an `<iframe>` on another site, set `CRYSTALLUME_FRAME_ANCESTORS="'self' https://your-site"`.

## Static website (no server)

The web app has no build step and includes three.js, so it runs as plain files, even offline:

```bash
python scripts/build_artifact.py --out dist/web
python -m http.server -d dist/web 8080          # or GitHub Pages, S3, nginx, …
```

Projects are then saved in the browser or in a folder on your computer.

Frontend plugins work here too. List them in `plugins.json` next to `index.html`
(`[{"name": "hello", "url": "plugins/hello/hello.js"}]`), or let
`python scripts/build_artifact.py --plugin examples/plugins/hello_plugin` copy one in and write the file.
While developing, `?plugin=<URL on the same site>` loads one plugin for that visit.

### As a claude.ai artifact

```bash
python scripts/build_artifact.py --fragment --out dist/artifact     # the page without <html> and <head>
```

Publish `dist/artifact/index.html` as the artifact page, with the rest of the folder (`js/`, `css/`,
`vendor/`, `plugins.json`) as its supporting files. For example, ask Claude to publish the folder.
The page should declare these capabilities:

| Capability | What it gives | Without it |
|---|---|---|
| `db` | "Claude cloud" storage: private projects, saved in chunks under `data/users/<user id>/` | projects stay in the browser |
| `user` | who is viewing, so everyone sees only their own projects | projects stay in the browser |
| `downloads` | downloads of PNG, glTF, structure and project files (other file types are zipped) | export and download items are hidden |

Inside an artifact the app never opens system dialogs or new windows; all confirmations are in the app.
It follows the light or dark theme the host page sets.

## Settings

Command-line flags win over environment variables.

| Variable | Meaning | Default |
|---|---|---|
| `CRYSTALLUME_HOST` / `CRYSTALLUME_PORT` | address and port to listen on | `127.0.0.1` / `8765` |
| `CRYSTALLUME_MODE` | `local` or `cloud` | `local` |
| `CRYSTALLUME_DATA_DIR` | data folder | `~/.crystallume` |
| `CRYSTALLUME_PLUGIN_DIRS` | plugin folders, separated by `:` or `,` | — |
| `CRYSTALLUME_ALLOW_REGISTRATION` | allow sign-up in cloud mode | `true` on a loopback address, else `false` |
| `CRYSTALLUME_TOKEN` | local mode: require this token | — (no sign-in) |
| `CRYSTALLUME_TOKEN_TTL_DAYS` | cloud sign-ins expire after this many unused days (`0` = never) | `30` |
| `CRYSTALLUME_MAX_ATOMS` | most atoms a builder may make | `200000` |
| `CRYSTALLUME_SECRET` | server secret, used to hash tokens | generated and kept in `secret.key` |
| `CRYSTALLUME_CORS_ORIGINS` | other origins allowed to call the API, comma separated | — |
| `CRYSTALLUME_FRAME_ANCESTORS` | sites allowed to show the app in an iframe (CSP `frame-ancestors`) | — (same site only) |
| `CRYSTALLUME_ROOT_PATH` | URL prefix behind a reverse proxy (`--root-path`) | — |
| `CRYSTALLUME_FORWARDED_ALLOW_IPS` | reverse-proxy addresses or networks whose `X-Forwarded-For` and `X-Forwarded-Proto` headers are trusted, comma separated (`--forwarded-allow-ips`; avoid `*`) | — (`127.0.0.1` only) |
| `CRYSTALLUME_ALLOWED_HOSTS` | extra host names a token-less local server on a loopback address answers to, comma separated (`*` = any) | — (localhost names) |
| `CRYSTALLUME_MAX_PROJECT_MB` / `CRYSTALLUME_MAX_UPLOAD_MB` | size limits for projects and uploads | `50` / `100` |
| `CRYSTALLUME_WEB_DIR` | serve the web app from another folder (`--web-dir`) | the packaged `crystallume/web` |
| `CRYSTALLUME_LOG_LEVEL` | log level (`--log-level`) | `info` |

## REST API

Everything is under `/api/v1`. A running server shows interactive docs at `/docs`.
Errors look like `{"detail": "..."}`.

| Area | Endpoints |
|---|---|
| About the server | `GET /health`, `GET /info`, `GET /elements`, `GET /formats`, `GET /plugins` |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Projects | `GET/POST /projects`, `GET/PUT/PATCH/DELETE /projects/{id}`, `POST /projects/{id}/duplicate`, `GET /projects/{id}/download`, `POST /projects/import` |
| Files | `POST /io/parse`, `POST /io/export`, `POST /io/convert` |
| Building | `GET /build/prototypes`, `POST /build/crystal`, `POST /build/cluster`, `POST /build/supercell`, `GET /build/molecules`, `GET /build/molecule/{name}`, `GET /build/custom`, `POST /build/custom/{name}` |
| Analysis | `POST /analysis/bonds`, `POST /analysis/summary`, `POST /analysis/coordination`, `POST /analysis/rdf`, `GET /analysis/custom`, `POST /analysis/custom/{name}` |
| Plugins | `/api/v1/ext/...`, added by plugins |

```bash
curl -s localhost:8765/api/v1/build/crystal -H 'content-type: application/json' \
     -d '{"prototype":"fcc","elements":["Cu"],"a":3.61,"supercell":[2,2,2]}'
curl -s -F file=@POSCAR localhost:8765/api/v1/io/parse
```

From Python, `crystallume.Client` has a method for every endpoint; see
[PLUGINS.md §7](PLUGINS.md#7-python-api-rest-client-and-cli).

## Upgrading from AtomScope

Crystallume used to be called AtomScope. Everything from that version still works: project files
(`atomscope.project/1`, `*.atomscope.json`), `ATOMSCOPE_*` settings, the `~/.atomscope` data folder (and a
cloud server's `atomscope.db`), `atomscope.plugins` entry points, `import atomscope`, `window.atomscope` and
`atomscope:*` embedding messages.

With Docker Compose:

- The service is now called `crystallume`. Run `docker compose up -d --remove-orphans` once, so the old
  `atomscope` container stops and frees the port.
- `docker-compose.yml` keeps the old project name `atomscope`, so your data stays in the
  `atomscope_atomscope-data` volume, even if you rename the folder or clone it again.
- If your old checkout folder had another name, such as `atomscope-main`, that name was the project name.
  Put `COMPOSE_PROJECT_NAME=<old folder name>` in a `.env` file next to the compose file, or run
  `docker compose -p <old folder name> …`. Otherwise compose starts with a new, empty volume and leaves the
  old container running.
- With `docker run`, keep mounting your old volume (for example `-v atomscope-data:/data`); `-e ATOMSCOPE_*`
  options still work.
