# Running Facet

Facet runs in four ways:

| Mode | Good for | Start it with |
|---|---|---|
| [Local](#local-mode) | one person on their own computer | `facet serve --open` |
| [Cloud](#cloud-mode) | a group sharing one server, with accounts | `facet serve --mode cloud` |
| [Docker](#docker) | either of the above, in a container | `docker compose up -d` |
| [Static](#static-website-no-server) | any web host, or a claude.ai artifact; no server needed | `python scripts/build_artifact.py` |

Install first with `pip install .` in this folder. Facet needs Python 3.10 or newer, and only four
packages: fastapi, uvicorn, numpy and python-multipart.

## Local mode

```bash
facet serve --open                          # http://127.0.0.1:8765
facet serve --port 9000 --data ~/my-atoms   # another port and data folder
```

There is no login. Each project is a folder in `~/.facet/projects/` (or `<data folder>/projects/`):

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
FACET_TOKEN=<long random string> facet serve --host 0.0.0.0
```

In the app, sign in as user `local` with the token as the password. API clients send
`Authorization: Bearer <token>`.

The server also protects you in these ways:

- Wrong tokens count as failed sign-ins. After 10 failures in 5 minutes from one address it answers `429`.
  It warns at start-up about a short token or a placeholder such as `change-me`.
- Other websites cannot use your browser to change your projects. Write requests from another site get `403`,
  unless that site is listed in `FACET_CORS_ORIGINS`, and JSON must be sent as `application/json`.
- Without a token, a server on `127.0.0.1` only answers to `localhost` names, which blocks DNS rebinding.
  To reach it under another name, set `FACET_ALLOWED_HOSTS=<name>` or a token.

## Cloud mode

```bash
facet serve --mode cloud --host 0.0.0.0 --data /srv/facet
facet user create alice --data /srv/facet     # asks for a password
```

- Everyone signs in and sees only their own projects.
- Accounts and projects are stored in `<data folder>/facet.db` (SQLite). Passwords are stored as salted
  scrypt hashes, and only an HMAC of each sign-in token is kept.
- **Sign-up** is open when the server listens on a loopback address and **closed** on any other address,
  such as `0.0.0.0`. Create accounts with `facet user create` (there are also `user list`,
  `user passwd` and `user delete`). Change the default with `FACET_ALLOW_REGISTRATION`, or turn sign-up
  off with `--no-registration`.
- Sign-ins expire after 30 days without use (`FACET_TOKEN_TTL_DAYS`; `0` means never).
- Project routes and server-side analyses need `Authorization: Bearer <token>`.
- Analyses, uploads and request bodies have size limits. Builders make at most 200 000 atoms
  (`FACET_MAX_ATOMS`).
- **Edits never overwrite each other silently.** When two people, or two tabs, change the same project, a save
  based on an old version is refused with `409`. The app then offers to reload, save a copy or overwrite.
  The protocol is described in [SCHEMA.md](SCHEMA.md#concurrent-edits-etag-if-match-409).
- With `--host 0.0.0.0`, the start-up message shows this computer's network addresses.
- On the public internet, put the server behind an HTTPS reverse proxy such as nginx, Caddy or Traefik.
  If the app is served from another origin, add `--cors https://your-app.example.org`.

## Docker

The image is published at `ghcr.io/gonggroup/facet` for amd64 and arm64 computers. `latest` follows the main
branch; version tags such as `0.4.0` stay fixed.

```bash
docker run -d -p 8765:8765 -v facet-data:/data --name facet ghcr.io/gonggroup/facet     # cloud mode
docker exec facet facet user create alice

# local mode: projects as folders in ./facet-data/projects/, reachable from this computer only
mkdir -p facet-data
docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/facet-data:/data" \
  -e FACET_MODE=local -e FACET_TOKEN=<long random string> ghcr.io/gonggroup/facet
```

Or with Docker Compose, from a checkout:

```bash
docker compose up -d                                       # cloud mode; data in a Docker volume
docker compose exec facet facet user create alice
```

Compose pulls the published image, and builds it from the checkout when it cannot. To build it yourself, run
`docker build -t facet .`.

- While the image is private, sign in first: `docker login ghcr.io` with a GitHub user name and a token that
  may read packages.
- To update, pull the image again (`docker pull ghcr.io/gonggroup/facet`, or `docker compose pull`) and start
  a new container on the same volume.

- The image runs as user id 1000. Create a mounted folder before you start, and pass
  `--user "$(id -u):$(id -g)"` so the container uses it as you. Otherwise Docker creates the folder owned
  by root and the server stops with "permission denied".
- In local mode the token is the sign-in password (user `local`).
- The compose file stores data in the `atomscope_atomscope-data` volume, a name kept from the app's first name.
  See [Upgrading from Crystallume or AtomScope](#upgrading-from-crystallume-or-atomscope).

### How the image is published

`.github/workflows/docker.yml` runs on every push: it runs the tests, builds the image and starts it once.
A push to `main` also publishes `latest` and the package version (`facet/_version.py`); a tag such as `v0.4.0`
publishes `0.4.0` and `0.4`. The tag has to match the package version.

## Behind a reverse proxy

To serve Facet under a path of another site, say `https://lab.example.org/facet/`:

```bash
facet serve --mode cloud --root-path /facet        # or FACET_ROOT_PATH=/facet
```

```nginx
location /facet/ {
    proxy_pass http://127.0.0.1:8765/;        # strips the prefix; keeping it (no final /) works too
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;                # match FACET_MAX_UPLOAD_MB
}
```

- The app uses relative URLs, so nothing else needs changing. `/facet` redirects to `/facet/`.
- **Set the proxy's address** when the proxy runs on another host or in another container:
  `FACET_FORWARDED_ALLOW_IPS=<address or network>` (for example the Docker network `172.28.0.0/16`),
  or `--forwarded-allow-ips`. Sign-in limits count per client address. Without this setting every user seems
  to come from the proxy, and one person's wrong passwords lock everyone out. Never use `*`: any client that
  reaches the port directly could then fake its address to dodge the limits.
- To show the app in an `<iframe>` on another site, set `FACET_FRAME_ANCESTORS="'self' https://your-site"`.

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
| `FACET_HOST` / `FACET_PORT` | address and port to listen on | `127.0.0.1` / `8765` |
| `FACET_MODE` | `local` or `cloud` | `local` |
| `FACET_DATA_DIR` | data folder | `~/.facet` |
| `FACET_PLUGIN_DIRS` | plugin folders, separated by `:` or `,` | — |
| `FACET_ALLOW_REGISTRATION` | allow sign-up in cloud mode | `true` on a loopback address, else `false` |
| `FACET_TOKEN` | local mode: require this token | — (no sign-in) |
| `FACET_TOKEN_TTL_DAYS` | cloud sign-ins expire after this many unused days (`0` = never) | `30` |
| `FACET_MAX_ATOMS` | most atoms a builder may make | `200000` |
| `FACET_SECRET` | server secret, used to hash tokens | generated and kept in `secret.key` |
| `FACET_CORS_ORIGINS` | other origins allowed to call the API, comma separated | — |
| `FACET_FRAME_ANCESTORS` | sites allowed to show the app in an iframe (CSP `frame-ancestors`) | — (same site only) |
| `FACET_ROOT_PATH` | URL prefix behind a reverse proxy (`--root-path`) | — |
| `FACET_FORWARDED_ALLOW_IPS` | reverse-proxy addresses or networks whose `X-Forwarded-For` and `X-Forwarded-Proto` headers are trusted, comma separated (`--forwarded-allow-ips`; avoid `*`) | — (`127.0.0.1` only) |
| `FACET_ALLOWED_HOSTS` | extra host names a token-less local server on a loopback address answers to, comma separated (`*` = any) | — (localhost names) |
| `FACET_MAX_PROJECT_MB` / `FACET_MAX_UPLOAD_MB` | size limits for projects and uploads | `50` / `100` |
| `FACET_WEB_DIR` | serve the web app from another folder (`--web-dir`) | the packaged `facet/web` |
| `FACET_LOG_LEVEL` | log level (`--log-level`) | `info` |

## REST API

Everything is under `/api/v1`. A running server shows interactive docs at `/docs`.
Errors look like `{"detail": "..."}`.

| Area | Endpoints |
|---|---|
| About the server | `GET /health`, `GET /info`, `GET /elements`, `GET /formats`, `GET /plugins` |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Projects | `GET/POST /projects`, `GET/PUT/PATCH/DELETE /projects/{id}`, `POST /projects/{id}/duplicate`, `GET /projects/{id}/download`, `POST /projects/import` |
| Files | `POST /io/parse`, `POST /io/export`, `POST /io/convert` |
| Building | `GET /build/prototypes`, `POST /build/crystal`, `POST /build/cluster`, `POST /build/supercell`, `POST /build/surface`, `POST /build/vacuum`, `GET /build/molecules`, `GET /build/molecule/{name}`, `GET /build/custom`, `POST /build/custom/{name}` |
| Analysis | `POST /analysis/bonds`, `POST /analysis/summary`, `POST /analysis/coordination`, `POST /analysis/rdf`, `POST /analysis/terminations`, `GET /analysis/custom`, `POST /analysis/custom/{name}` |
| Plugins | `/api/v1/ext/...`, added by plugins |

```bash
curl -s localhost:8765/api/v1/build/crystal -H 'content-type: application/json' \
     -d '{"prototype":"fcc","elements":["Cu"],"a":3.61,"supercell":[2,2,2]}'
curl -s -F file=@POSCAR localhost:8765/api/v1/io/parse
```

From Python, `facet.Client` has a method for every endpoint; see
[PLUGINS.md §7](PLUGINS.md#7-python-api-rest-client-and-cli).

## Upgrading from Crystallume or AtomScope

Facet used to be called Crystallume, and before that AtomScope. Everything from those versions still works:

| | Crystallume | AtomScope |
|---|---|---|
| Project and structure files | `crystallume.project/1`, `*.crystallume.json` | `atomscope.project/1`, `*.atomscope.json` |
| Settings | `CRYSTALLUME_*` | `ATOMSCOPE_*` |
| Data folder, cloud database | `~/.crystallume`, `crystallume.db` | `~/.atomscope`, `atomscope.db` |
| Plugins | `crystallume.plugins` entry points | `atomscope.plugins` entry points |
| Python | `import crystallume`, the `crystallume` command | `import atomscope` |
| Web page | `window.crystallume`, `crystallume:*` messages | `window.atomscope`, `atomscope:*` messages |

When the same setting is given under several names, `FACET_*` wins, then `CRYSTALLUME_*`, then `ATOMSCOPE_*`.
An existing data folder keeps being used: `~/.facet` first, then `~/.crystallume`, then `~/.atomscope`.
New files are written with the `facet.*` names, so older versions cannot open them.

With Docker Compose:

- The service is now called `facet`. Run `docker compose up -d --remove-orphans` once, so the old
  `crystallume` or `atomscope` container stops and frees the port.
- `docker-compose.yml` keeps the first project name, `atomscope`, so your data stays in the
  `atomscope_atomscope-data` volume, even if you rename the folder or clone it again.
- If your AtomScope checkout folder had another name, such as `atomscope-main`, that name was the project
  name. Put `COMPOSE_PROJECT_NAME=<old folder name>` in a `.env` file next to the compose file, or run
  `docker compose -p <old folder name> …`. Otherwise compose starts with a new, empty volume and leaves the
  old container running.
- With `docker run`, keep mounting your old volume (for example `-v atomscope-data:/data`); `-e CRYSTALLUME_*`
  and `-e ATOMSCOPE_*` options still work.
