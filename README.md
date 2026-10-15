# AtomScope

浏览器中的原子、团簇与晶体可视化与项目管理工具 —— 既可作为本地单机应用，也可部署为多用户服务器。
Visualise and manage atoms, clusters and crystals in the browser — as a local app or a multi-user server.

[中文](#中文) · [English](#english)

---

## 中文

### 安装

需要 Python ≥ 3.10。运行时依赖只有 `fastapi`、`uvicorn`、`numpy`、`python-multipart`。

```bash
pip install .            # 或开发模式: pip install -e ".[test]"
atomscope --version
```

### 本地模式（单用户）

```bash
atomscope serve --open                 # http://127.0.0.1:8765
atomscope serve --port 9000 --data ~/my-atoms
```

* 不需要登录；所有项目保存在 `<数据目录>/projects/`（默认 `~/.atomscope/projects/`），**每个项目一个文件夹**：
  ```
  projects/
    perovskite-study-p_8f3a91c2d4/
      project.json            # 完整项目文档 (atomscope.project/1)
      structures/s_1.xyz      # 每个结构的 extxyz 副本，方便其他软件直接打开
      thumbnail.jpg           # 项目缩略图
    .trash/                   # 删除的项目会被移到这里，可恢复
  ```
* 把任何 `.json` 项目文件（或结构 JSON）丢进 `projects/` 目录，下次刷新列表时会自动导入。
* 可以直接复制、重命名项目文件夹；复制的文件夹会自动获得新的项目 ID。

### 服务器 / 云模式（多用户）

```bash
atomscope serve --mode cloud --host 0.0.0.0 --port 8765 --data /srv/atomscope
atomscope serve --mode cloud --host 0.0.0.0 --no-registration     # 禁止自助注册
atomscope user create alice --data /srv/atomscope                 # 管理员创建账号（会提示输入密码）
```

* 账号、令牌和项目保存在 `<数据目录>/atomscope.db`（SQLite）。密码使用 scrypt 加盐哈希；数据库中只保存令牌的 HMAC。
* 项目相关接口需要 `Authorization: Bearer <token>`；用户之间的项目完全隔离。
* 监听 `0.0.0.0` 时，启动信息会打印本机局域网地址，方便同一网络中的其他电脑访问。
* 对公网开放时请放在 HTTPS 反向代理（nginx、Caddy、Traefik）之后。
* 前端与 API 不在同一域名时使用 `--cors https://your-frontend.example.org`。

### Docker

```bash
docker compose up -d                     # 云模式，数据保存在 volume "atomscope-data"
docker compose exec atomscope atomscope user create alice
# 或者
docker build -t atomscope .
docker run -p 8765:8765 -v atomscope-data:/data atomscope
docker run -p 8765:8765 -e ATOMSCOPE_MODE=local -v $PWD/projects:/data atomscope
```

### 配置（命令行参数优先于环境变量）

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `ATOMSCOPE_HOST` / `ATOMSCOPE_PORT` | 监听地址 / 端口 | `127.0.0.1` / `8765` |
| `ATOMSCOPE_MODE` | `local` 或 `cloud` | `local` |
| `ATOMSCOPE_DATA_DIR` | 数据目录 | `~/.atomscope` |
| `ATOMSCOPE_PLUGIN_DIRS` | 插件目录（`:` 或 `,` 分隔） | — |
| `ATOMSCOPE_ALLOW_REGISTRATION` | 云模式下是否允许注册 | `true` |
| `ATOMSCOPE_SECRET` | 服务器密钥（用于令牌哈希） | 自动生成并保存到 `secret.key` |
| `ATOMSCOPE_CORS_ORIGINS` | 允许的跨域来源（逗号分隔） | — |
| `ATOMSCOPE_MAX_PROJECT_MB` / `ATOMSCOPE_MAX_UPLOAD_MB` | 项目 / 上传大小上限 | `50` / `100` |
| `ATOMSCOPE_WEB_DIR` | 使用其他目录中的前端 | 包内 `atomscope/web` |

### Python API

```python
import atomscope as ats
from atomscope import build, analysis

s = ats.read("POSCAR")                      # 自动识别格式；多帧文件 → s.frames
s = ats.read("traj.xyz", index=-1)          # 只读最后一帧
ats.write("out.cif", s)                     # 按扩展名选择格式
text = ats.to_text(s, "extxyz")

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
sto = build.crystal("perovskite", ["Sr", "Ti", "O"])
au55 = build.cluster("icosahedron", "Au", 3)          # Mackay 二十面体，3 层 = 55 个原子
caf = build.molecule("caffeine")

bonds = analysis.neighbors(cu)              # [(i, j, 距离, (ox, oy, oz)), ...]，支持周期性边界
cn = analysis.coordination_numbers(cu)
r, g = analysis.rdf(cu, rmax=6.0, nbins=120)
print(analysis.summary(sto))                # 化学式、体积、密度、晶胞参数……

ats.view(sto)                               # 后台启动本地服务器并在浏览器中打开

client = ats.Client("http://127.0.0.1:8765")       # 仅用标准库的 REST 客户端
client.login("alice", "secret")                     # 云模式
p = client.create_project("铜", structures=[cu])
```

`Structure` 常用方法：`to_dict/from_dict`、`copy`、`formula`、`composition`、`repeat`、`wrap`、`center(vacuum=)`、
`translate`、`frac_positions`、`volume`、`density`、`get_distance(i, j, mic=)`、`get_angle`、`get_dihedral`、
`append`、`extend`、`delete`、`select(elements=)`、`bounding_box`、`get_frame`、`iter_frames`。

支持的文件格式：`xyz`/`extxyz`（多帧、Lattice、Properties）、`poscar`（VASP 4/5、Direct/Cartesian、选择性动力学、负缩放因子）、
`cif`（读取时自动展开对称操作；写出为 P1）、`pdb`（CRYST1、MODEL 多帧）、`json`（AtomScope 结构格式）。插件可以添加更多格式。

### REST API 概览

所有接口位于 `/api/v1` 下，交互式文档见 `/docs`。错误统一返回 `{"detail": "..."}`。

| 分类 | 接口 |
|---|---|
| 元信息 | `GET /health`、`GET /info`、`GET /elements`、`GET /formats`、`GET /plugins` |
| 认证 | `POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me` |
| 项目 | `GET/POST /projects`、`GET/PUT/PATCH/DELETE /projects/{id}`、`POST /projects/{id}/duplicate`、`GET /projects/{id}/download`、`POST /projects/import` |
| 文件 | `POST /io/parse`、`POST /io/export`、`POST /io/convert` |
| 构建 | `GET /build/prototypes`、`POST /build/crystal`、`POST /build/cluster`、`POST /build/supercell`、`GET /build/molecules`、`GET /build/molecule/{name}`、`POST /build/custom/{name}` |
| 分析 | `POST /analysis/bonds`、`/analysis/summary`、`/analysis/coordination`、`/analysis/rdf`、`/analysis/custom/{name}` |

```bash
curl -s localhost:8765/api/v1/build/crystal -H 'content-type: application/json' \
     -d '{"prototype":"fcc","elements":["Cu"],"a":3.61,"supercell":[2,2,2]}'
curl -s -F file=@POSCAR localhost:8765/api/v1/io/parse
```

数据格式（Structure / Project JSON）见 [`docs/SCHEMA.md`](docs/SCHEMA.md)。

### 插件开发

插件是一个包含 `register(ctx)` 函数的 Python 模块（可选 `PLUGIN = {"name", "version", "description"}`）。发现方式：

1. 插件目录：`atomscope serve --plugins DIR`（或 `ATOMSCOPE_PLUGIN_DIRS`）——目录中每个包含 `plugin.py` 的子文件夹，以及每个 `*.py` 文件；
2. 已安装的包：在 `pyproject.toml` 中声明入口点组 `atomscope.plugins`：
   ```toml
   [project.entry-points."atomscope.plugins"]
   myplugin = "my_package.atomscope_plugin"
   ```

加载失败的插件会被记录并在 `/api/v1/plugins` 中以 `status: "error"` 列出，不会导致服务器崩溃。

```python
from fastapi import APIRouter
from atomscope import PluginContext, Structure

PLUGIN = {"name": "hello", "version": "1.0.0", "description": "示例插件"}
router = APIRouter()

@router.get("/hello")
def hello():
    return {"message": "Hello"}

def register(ctx: PluginContext):
    ctx.register_reader("hello", read_hello, extensions=[".hello"])        # 文件读取
    ctx.register_writer("hello", write_hello, extensions=[".hello"])       # 文件写出
    ctx.register_builder("hello-chain", build_chain, {"label": "原子链", "params": [...]})  # POST /api/v1/build/custom/hello-chain
    ctx.register_analysis("hello-com", center_of_mass)                     # POST /api/v1/analysis/custom/hello-com
    ctx.add_preset("lighting", {"id": "sunset", "name": "Sunset", ...})    # lighting | colorScheme | style
    ctx.add_router(router)                                                 # 挂载到 /api/v1/ext
    ctx.add_static("static")                                               # /plugins/hello/...
    ctx.add_frontend_module("hello.js")                                    # 前端会动态 import
```

`add_preset` 的字典会原样传给前端。自带的网页界面识别以下形状：`lighting` → `{id, name, key, fill, rim, hemi, ambient, env}`（灯光含 `intensity`、`color`、`azimuth`、`elevation`）；
`colorScheme` → `{id, name, colors: {"Fe": "#e06633", ...}, default: "#b0b6bd"}`；`style` → `{id, name, scene: {...}, swatch}`。

前端模块导出 `export default function activate(api)`，`api` 提供 `registerLightingPreset`、`registerColorScheme({id, name, colorFor(symbol, index, ctx)})`、
`registerCommand({id, title, run})` 和 `toast(msg)`。完整示例见 [`examples/plugins/hello_plugin`](examples/plugins/hello_plugin)：

```bash
atomscope serve --plugins examples/plugins
curl localhost:8765/api/v1/ext/hello
atomscope plugins --plugins examples/plugins
```

### 命令行

```bash
atomscope serve [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...] \
                [--no-registration] [--open] [--cors ORIGIN ...]
atomscope convert input.cif POSCAR                    # 按扩展名/文件名判断格式；--from/--to 显式指定
atomscope build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o cu.xyz
atomscope build cluster icosahedron Au --size 3 -o au55.xyz
atomscope build molecule caffeine -o caffeine.pdb
atomscope info structure.cif [--bonds] [--json]
atomscope user create NAME [--password PW] [--data DIR]    # 另有 user list / passwd / delete
atomscope plugins [--plugins DIR]
atomscope formats
python -m atomscope ...                                # 等价
```

### 网页界面

`atomscope serve` 打开的界面也可以不经后端直接作为静态网页使用（见下文“静态部署”）。主要功能：

| 区域 | 内容 |
|---|---|
| **样式 Style** | 13 种一键“外观”（Publication、VESTA、Illustration 墨线卡通、QuteMol、Clay、Glass、Metallic、Dark、Neon、X-ray、Pearl、Golden hour、Blueprint）；6 种表示法（球棍、空间填充、原子球、Licorice、线框、配位多面体）；10 种配色（Jmol、VESTA、CPK、Pastel、Muted、单色、按序号、按高度、按配位数、按原子属性）及逐元素改色/隐藏；12 种材质（Satin、Glossy、Matte、Metallic、Glass 透射、Pearl 薄膜干涉、Clay、Classic Phong、Cel 卡通、Flat、Glow 自发光、X-ray 菲涅尔）；半径表、原子/键尺寸、键着色、细分质量 |
| **光照 Light** | 10 种布光（Studio、Headlight、Three-point、Soft daylight、Dramatic、Golden hour、Cool lab、Flat、Neon、Environment only）；主光/补光/轮廓光的强度、方位、高度、颜色；天空光、环境反射；软阴影与阴影地面；灯光跟随相机；曝光与 7 种色调映射 |
| **效果 Effects** | 环境光遮蔽（GTAO）、墨线描边（深度+法线边缘检测）、深度雾化、泛光、景深、暗角 |
| **场景 Scene** | 背景（纯色/线性/径向渐变/透明）、晶胞线（单胞/外框/全部）、超胞显示、原子回卷、边界原子、跨边界补全配位、成键容差与逐元素对开关、标签、透视/正交、轨道/自由旋转、坐标轴、转台 |
| **项目 Projects** | 存储位置：本浏览器（IndexedDB，离线）、服务器文件夹（local 模式）、云端账户（cloud 模式）、本地文件夹（File System Access API，项目即 `.atomscope.json` 文件）、Claude 云端（作为 claude.ai Artifact 运行时）。自动保存、复制、删除、导入/下载项目文件 |
| **资源库 / 构建** | 18 个示例（晶体、二维材料、纳米团簇、分子、轨迹）；晶体原型构建器（16 种）、团簇构建器（7 种）、分子、粘贴文本、服务器插件构建器 |
| **结构 Structure** | 化学式、晶胞参数、体积、密度、空间群；选择/删除/替换元素（可撤销）；距离/键角/二面角测量；配位统计；径向分布函数 g(r) |
| **导出** | PNG（1×/2×/4×、透明背景）、glTF `.glb`（Blender/PowerPoint/AR）、XYZ、extXYZ、POSCAR、CIF、PDB、JSON、项目文件 |

交互：左键旋转、右键平移、滚轮缩放、单击选择（Shift 多选）、双击居中；把文件拖进窗口或直接粘贴文本即可打开。
`Ctrl/⌘ K` 打开命令面板，`?` 查看全部快捷键，“帮助 → Take the tour” 有 1 分钟新手引导。

#### JavaScript API 与前端扩展

整个界面可通过 `window.atomscope` 脚本化，插件拿到的也是同一个对象：

```js
const s = atomscope.build.crystal('perovskite', { elements: ['Ba', 'Ti', 'O'], a: 4.01, repeat: [3, 3, 3] });
atomscope.load(s);
atomscope.applyLook('qutemol');
atomscope.set('post.outline.enabled', true);      // 任意场景参数（点路径）
atomscope.view('c');
const png = await atomscope.screenshot({ scale: 3, transparent: true });
atomscope.registry.colorSchemes.register({ id: 'o-red', name: 'Oxygen highlight', colorFor: (el) => el === 'O' ? '#f24' : '#bbb' });
```

可扩展的注册表：`formats`、`styles`（表示法）、`materials`、`colorSchemes`、`lighting`、`looks`、`samples`、`prototypes`、
`clusters`、`commands`、`storage`（存储后端，例如 S3/WebDAV）、`panels.left` / `panels.inspector`（界面面板）。
嵌入到其他网页时可用 `postMessage`：`{type: 'atomscope:load', text, format}`、`atomscope:look`、`atomscope:set`、`atomscope:view`、`atomscope:screenshot`。

#### 静态部署

前端没有构建步骤，依赖（three.js r170）已随包附带，可离线运行：

```bash
python scripts/build_artifact.py --out dist/web      # 复制成独立静态站点
python -m http.server -d dist/web 8080               # 或放到 GitHub Pages / S3 / nginx
```

不带后端时，项目保存在浏览器或本地文件夹；带后端时自动出现“服务器文件夹/云端”存储与插件。

### 开发与测试

```bash
pip install -e ".[test]"
pytest -q
```

---

## English

### Install

Python ≥ 3.10. Runtime dependencies are only `fastapi`, `uvicorn`, `numpy` and `python-multipart`.

```bash
pip install .            # or for development: pip install -e ".[test]"
atomscope --version
```

### Local mode (single user)

```bash
atomscope serve --open                 # http://127.0.0.1:8765
atomscope serve --port 9000 --data ~/my-atoms
```

* No login. Projects live in `<data>/projects/` (default `~/.atomscope/projects/`), **one folder per project**:
  ```
  projects/
    perovskite-study-p_8f3a91c2d4/
      project.json            # the full project document (atomscope.project/1)
      structures/s_1.xyz      # extended-XYZ copy of every structure, for other tools
      thumbnail.jpg           # project thumbnail
    .trash/                   # deleted projects are moved here (recoverable)
  ```
* Drop any `.json` project (or structure JSON) into `projects/` and it is imported on the next listing.
* Folders may be copied or renamed freely; a copied folder automatically receives a new project id.

### Server / cloud mode (multi-user)

```bash
atomscope serve --mode cloud --host 0.0.0.0 --port 8765 --data /srv/atomscope
atomscope serve --mode cloud --host 0.0.0.0 --no-registration     # no self sign-up
atomscope user create alice --data /srv/atomscope                 # admin creates accounts (prompts for a password)
```

* Accounts, tokens and projects are stored in `<data>/atomscope.db` (SQLite). Passwords are salted scrypt hashes;
  only an HMAC of each API token is stored.
* Project routes require `Authorization: Bearer <token>`; users never see each other's projects.
* With `--host 0.0.0.0` the start-up banner prints the LAN addresses.
* Put the server behind an HTTPS reverse proxy (nginx, Caddy, Traefik) when exposing it publicly.
* Use `--cors https://your-frontend.example.org` when the UI is served from another origin.

### Docker

```bash
docker compose up -d                     # cloud mode, data in the "atomscope-data" volume
docker compose exec atomscope atomscope user create alice
# or
docker build -t atomscope .
docker run -p 8765:8765 -v atomscope-data:/data atomscope
docker run -p 8765:8765 -e ATOMSCOPE_MODE=local -v $PWD/projects:/data atomscope
```

### Configuration (CLI flags override environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `ATOMSCOPE_HOST` / `ATOMSCOPE_PORT` | bind address / port | `127.0.0.1` / `8765` |
| `ATOMSCOPE_MODE` | `local` or `cloud` | `local` |
| `ATOMSCOPE_DATA_DIR` | data directory | `~/.atomscope` |
| `ATOMSCOPE_PLUGIN_DIRS` | plugin directories (`:` or `,` separated) | — |
| `ATOMSCOPE_ALLOW_REGISTRATION` | allow self-registration in cloud mode | `true` |
| `ATOMSCOPE_SECRET` | server secret (token hashing) | generated, stored in `secret.key` |
| `ATOMSCOPE_CORS_ORIGINS` | allowed CORS origins (comma separated) | — |
| `ATOMSCOPE_MAX_PROJECT_MB` / `ATOMSCOPE_MAX_UPLOAD_MB` | size limits | `50` / `100` |
| `ATOMSCOPE_WEB_DIR` | serve the frontend from another directory | packaged `atomscope/web` |

### Python API

```python
import atomscope as ats
from atomscope import build, analysis

s = ats.read("POSCAR")                      # format auto-detected; multi-frame files → s.frames
s = ats.read("traj.xyz", index=-1)          # last frame only
ats.write("out.cif", s)                     # format from the extension
text = ats.to_text(s, "extxyz")

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
sto = build.crystal("perovskite", ["Sr", "Ti", "O"])
au55 = build.cluster("icosahedron", "Au", 3)          # Mackay icosahedron, 3 shells = 55 atoms
caf = build.molecule("caffeine")

bonds = analysis.neighbors(cu)              # [(i, j, distance, (ox, oy, oz)), ...], PBC-aware, O(N)
cn = analysis.coordination_numbers(cu)
r, g = analysis.rdf(cu, rmax=6.0, nbins=120)
print(analysis.summary(sto))                # formula, volume, density, cell parameters ...

ats.view(sto)                               # start a local server in the background and open the browser

client = ats.Client("http://127.0.0.1:8765")       # stdlib-only REST client
client.login("alice", "secret")                     # cloud mode
p = client.create_project("Copper", structures=[cu])
```

`Structure` highlights: `to_dict/from_dict`, `copy`, `formula`, `composition`, `repeat`, `wrap`, `center(vacuum=)`,
`translate`, `frac_positions`, `volume`, `density`, `get_distance(i, j, mic=)`, `get_angle`, `get_dihedral`,
`append`, `extend`, `delete`, `select(elements=)`, `bounding_box`, `get_frame`, `iter_frames`.

File formats: `xyz`/`extxyz` (multi-frame, Lattice, Properties), `poscar` (VASP 4/5, Direct/Cartesian, selective dynamics,
negative scale), `cif` (symmetry operators expanded on read; P1 on write), `pdb` (CRYST1, MODEL frames), `json`
(AtomScope structure JSON). Plugins can add more.

### REST API overview

Everything lives under `/api/v1`; interactive docs at `/docs`. Errors are `{"detail": "..."}`.

| Area | Endpoints |
|---|---|
| Meta | `GET /health`, `GET /info`, `GET /elements`, `GET /formats`, `GET /plugins` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Projects | `GET/POST /projects`, `GET/PUT/PATCH/DELETE /projects/{id}`, `POST /projects/{id}/duplicate`, `GET /projects/{id}/download`, `POST /projects/import` |
| Files | `POST /io/parse`, `POST /io/export`, `POST /io/convert` |
| Build | `GET /build/prototypes`, `POST /build/crystal`, `POST /build/cluster`, `POST /build/supercell`, `GET /build/molecules`, `GET /build/molecule/{name}`, `POST /build/custom/{name}` |
| Analysis | `POST /analysis/bonds`, `/analysis/summary`, `/analysis/coordination`, `/analysis/rdf`, `/analysis/custom/{name}` |

```bash
curl -s localhost:8765/api/v1/build/crystal -H 'content-type: application/json' \
     -d '{"prototype":"fcc","elements":["Cu"],"a":3.61,"supercell":[2,2,2]}'
curl -s -F file=@POSCAR localhost:8765/api/v1/io/parse
```

The Structure / Project JSON contracts are documented in [`docs/SCHEMA.md`](docs/SCHEMA.md).

### Writing plugins

A plugin is a Python module with `register(ctx)` (and optionally `PLUGIN = {"name", "version", "description"}`). Discovery:

1. plugin directories — `atomscope serve --plugins DIR` (or `ATOMSCOPE_PLUGIN_DIRS`): every sub-folder containing
   `plugin.py` and every `*.py` file;
2. installed packages — entry-point group `atomscope.plugins`:
   ```toml
   [project.entry-points."atomscope.plugins"]
   myplugin = "my_package.atomscope_plugin"
   ```

A plugin that fails to load is logged and listed with `status: "error"` in `/api/v1/plugins`; it never crashes the server.

```python
from fastapi import APIRouter
from atomscope import PluginContext, Structure

PLUGIN = {"name": "hello", "version": "1.0.0", "description": "Example plugin"}
router = APIRouter()

@router.get("/hello")
def hello():
    return {"message": "Hello"}

def register(ctx: PluginContext):
    ctx.register_reader("hello", read_hello, extensions=[".hello"])        # file reader: text -> Structure
    ctx.register_writer("hello", write_hello, extensions=[".hello"])       # file writer: Structure -> text
    ctx.register_builder("hello-chain", build_chain, {"label": "Chain", "params": [...]})  # POST /api/v1/build/custom/hello-chain
    ctx.register_analysis("hello-com", center_of_mass)                     # POST /api/v1/analysis/custom/hello-com
    ctx.add_preset("lighting", {"id": "sunset", "name": "Sunset", ...})    # lighting | colorScheme | style
    ctx.add_router(router)                                                 # mounted under /api/v1/ext
    ctx.add_static("static")                                               # served at /plugins/hello/...
    ctx.add_frontend_module("hello.js")                                    # dynamic-imported by the web UI
```

`add_preset` dicts are passed to the UI unchanged. The bundled web UI understands: `lighting` → `{id, name, key, fill, rim, hemi, ambient, env}`
(lights take `intensity`, `color`, `azimuth`, `elevation`); `colorScheme` → `{id, name, colors: {"Fe": "#e06633", ...}, default: "#b0b6bd"}`;
`style` → `{id, name, scene: {...}, swatch}`.

Frontend modules export `export default function activate(api)`; `api` offers `registerLightingPreset`,
`registerColorScheme({id, name, colorFor(symbol, index, ctx)})`, `registerCommand({id, title, run})` and `toast(msg)`.
See the complete example in [`examples/plugins/hello_plugin`](examples/plugins/hello_plugin):

```bash
atomscope serve --plugins examples/plugins
curl localhost:8765/api/v1/ext/hello
atomscope plugins --plugins examples/plugins
```

### Command line

```bash
atomscope serve [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...] \
                [--no-registration] [--open] [--cors ORIGIN ...]
atomscope convert input.cif POSCAR                    # formats from extension/file name; or --from/--to
atomscope build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o cu.xyz
atomscope build cluster icosahedron Au --size 3 -o au55.xyz
atomscope build molecule caffeine -o caffeine.pdb
atomscope info structure.cif [--bonds] [--json]
atomscope user create NAME [--password PW] [--data DIR]    # also: user list / passwd / delete
atomscope plugins [--plugins DIR]
atomscope formats
python -m atomscope ...                                # same thing
```

### Web interface

The UI served by `atomscope serve` also works as a plain static site without the backend (see "Static hosting").

| Area | What is in it |
|---|---|
| **Style** | 13 one-click looks (Publication, VESTA, Illustration/ink, QuteMol, Clay, Glass, Metallic, Dark, Neon, X-ray, Pearl, Golden hour, Blueprint); 6 representations (ball & stick, space-filling, atomic spheres, licorice, wireframe, coordination polyhedra); 10 colour schemes (Jmol, VESTA, CPK, pastel, muted, single colour, by index, by height, by coordination, by per-atom property) plus per-element colour/visibility; 12 materials (satin, glossy, matte, metallic, transmissive glass, iridescent pearl, clay, classic Phong, cel, flat, glow, Fresnel X-ray); radius tables, sizes, bond colouring, tessellation quality |
| **Light** | 10 rigs (Studio, Headlight, Three-point, Soft daylight, Dramatic, Golden hour, Cool lab, Flat, Neon, Environment only); key/fill/rim intensity, azimuth, elevation and colour; sky light and environment reflections; soft shadows and a shadow floor; camera-locked or world-fixed lights; exposure and 7 tone-mapping operators |
| **Effects** | Ambient occlusion (GTAO), ink outlines (depth + normal edges), depth cueing, bloom, depth of field, vignette |
| **Scene** | Background (solid, linear/radial gradient, transparent), cell edges (unit/outline/all), display supercell, wrapping, boundary atoms, bonded images across the boundary, bond tolerance and per-pair switches, labels, perspective/orthographic, orbit/free rotation, axis gizmo, turntable |
| **Projects** | Storage: this browser (IndexedDB, offline), server folder (local mode), cloud account (cloud mode), a local folder (File System Access API — projects are `.atomscope.json` files), Claude cloud (when running as a claude.ai artifact). Autosave, duplicate, delete, import/download project files |
| **Library / Build** | 18 samples (crystals, 2D materials, nanoclusters, molecules, a trajectory); crystal prototypes (16), cluster shapes (7), molecules, paste-a-file, server plugin builders |
| **Structure** | Formula, cell, volume, density, space group; select / delete / replace elements (undoable); distance, angle and dihedral measurements; coordination statistics; radial distribution g(r) |
| **Export** | PNG (1×/2×/4×, transparent), glTF `.glb` (Blender, PowerPoint, AR), XYZ, extXYZ, POSCAR, CIF, PDB, JSON, project file |

Mouse: drag to rotate, right-drag to pan, scroll to zoom, click to select (Shift adds), double-click to centre. Drop files on the window or paste file text to open it.
`Ctrl/⌘ K` opens the command palette, `?` lists shortcuts, Help → Take the tour gives a one-minute walkthrough.

#### JavaScript API and frontend extensions

The whole UI is scriptable through `window.atomscope` (plugins receive the same object):

```js
const s = atomscope.build.crystal('perovskite', { elements: ['Ba', 'Ti', 'O'], a: 4.01, repeat: [3, 3, 3] });
atomscope.load(s);
atomscope.applyLook('qutemol');
atomscope.set('post.outline.enabled', true);      // any scene setting by dotted path
atomscope.view('c');
const png = await atomscope.screenshot({ scale: 3, transparent: true });
atomscope.registry.colorSchemes.register({ id: 'o-red', name: 'Oxygen highlight', colorFor: (el) => el === 'O' ? '#f24' : '#bbb' });
```

Extensible registries: `formats`, `styles` (representations), `materials`, `colorSchemes`, `lighting`, `looks`, `samples`, `prototypes`,
`clusters`, `commands`, `storage` (backends such as S3 or WebDAV), `panels.left` / `panels.inspector` (UI panels).
When embedded in an iframe, drive it with `postMessage`: `{type: 'atomscope:load', text, format}`, `atomscope:look`, `atomscope:set`, `atomscope:view`, `atomscope:screenshot`.

#### Static hosting

The frontend has no build step and ships with its dependency (three.js r170), so it runs offline:

```bash
python scripts/build_artifact.py --out dist/web      # copy as a standalone static site
python -m http.server -d dist/web 8080               # or GitHub Pages / S3 / nginx
```

Without the backend, projects live in the browser or a local folder; with it, server-folder/cloud storage and plugins appear automatically.

### Development

```bash
pip install -e ".[test]"
pytest -q
```
