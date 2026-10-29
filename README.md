# Crystallume · 晶影

浏览器中的原子、团簇与晶体可视化与项目管理工具 —— 既可作为本地单机应用，也可部署为多用户服务器。
Visualise and manage atoms, clusters and crystals in the browser — as a local app or a multi-user server.

> 名字来自 crystal（晶体）+ lume（光）：晶体与光影。本项目曾名 AtomScope；旧版保存的项目文件（`atomscope.project/1`、`*.atomscope.json`）、
> `ATOMSCOPE_*` 环境变量、`~/.atomscope` 数据目录（及云模式的 `atomscope.db`）、`atomscope.plugins` 插件入口点、
> `import atomscope`（等同于 `import crystallume`）、`window.atomscope` 和嵌入用的 `atomscope:*` 消息仍然可用。
> Named after crystal + lume (light). Formerly AtomScope: project files, `ATOMSCOPE_*` variables, the `~/.atomscope` data
> directory (and a cloud server's `atomscope.db`), `atomscope.plugins` entry points, `import atomscope` (the same as
> `import crystallume`), `window.atomscope` and `atomscope:*` embedding messages from that version keep working.

[中文](#中文) · [English](#english) · 插件与 API / Plugins & APIs: [`docs/PLUGINS.md`](docs/PLUGINS.md) · 数据格式 / Data formats: [`docs/SCHEMA.md`](docs/SCHEMA.md)

---

## 中文

### 安装

需要 Python ≥ 3.10。运行时依赖只有 `fastapi`、`uvicorn`、`numpy`、`python-multipart`。

```bash
pip install .            # 或开发模式: pip install -e ".[test]"
crystallume --version
```

### 本地模式（单用户）

```bash
crystallume serve --open                 # http://127.0.0.1:8765
crystallume serve --port 9000 --data ~/my-atoms
```

* 不需要登录；所有项目保存在 `<数据目录>/projects/`（默认 `~/.crystallume/projects/`），**每个项目一个文件夹**：
  ```
  projects/
    perovskite-study-p_8f3a91c2d4/
      project.json            # 完整项目文档 (crystallume.project/1)
      structures/s_1.xyz      # 每个结构的 extxyz 副本，方便其他软件直接打开
      thumbnail.jpg           # 项目缩略图
    .trash/                   # 删除的项目会被移到这里，可恢复
  ```
* 把任何 `.json` 项目文件（或结构 JSON）丢进 `projects/` 目录，下次刷新列表时会自动导入。
* 可以直接复制、重命名项目文件夹；复制的文件夹会自动获得新的项目 ID。
* **网络安全提示：** 本地模式没有登录，默认只监听 `127.0.0.1`。若用 `--host 0.0.0.0` 让局域网访问，能访问该地址的任何人都可以读取、修改和删除你的项目（启动时会打印警告）。
  这种情况请改用 `--mode cloud`，或设置 `CRYSTALLUME_TOKEN=<随机长字符串>` 要求令牌（界面中以用户名 `local` 和该令牌登录；API 发送 `Authorization: Bearer <令牌>`）。
  令牌错误与登录失败一起计数（每个地址 5 分钟内 10 次后返回 `429`）；过短或常见占位值（如 `change-me`）会在启动时警告。
* 其他网页不能借你的浏览器写入本地服务器：来自其他网站的写请求返回 `403`（`CRYSTALLUME_CORS_ORIGINS` 中的来源除外），JSON 请求必须带 `Content-Type: application/json`。
  未设令牌且只监听 `127.0.0.1` 时，服务器只响应 `localhost` 类主机名（防 DNS 重绑定）；需要用其他名字访问时设置 `CRYSTALLUME_ALLOWED_HOSTS=名字` 或 `CRYSTALLUME_TOKEN`。

### 服务器 / 云模式（多用户）

```bash
crystallume serve --mode cloud --host 0.0.0.0 --port 8765 --data /srv/crystallume
crystallume serve --mode cloud --host 0.0.0.0 --no-registration     # 禁止自助注册
crystallume user create alice --data /srv/crystallume               # 管理员创建账号（会提示输入密码）
```

* 账号、令牌和项目保存在 `<数据目录>/crystallume.db`（SQLite；改名前的数据目录继续使用其中的 `atomscope.db`）。密码使用 scrypt 加盐哈希；数据库中只保存令牌的 HMAC。
* 项目相关接口和服务器端分析（`POST /api/v1/analysis/*`）需要 `Authorization: Bearer <token>`；用户之间的项目完全隔离。
* 分析请求有工作量上限（原子数、周期镜像数、原子对数），请求体在流式传输时同样受大小限制。
* 监听 `0.0.0.0` 时，启动信息会打印本机局域网地址，方便同一网络中的其他电脑访问。
* 对公网开放时请放在 HTTPS 反向代理（nginx、Caddy、Traefik）之后。
* 前端与 API 不在同一域名时使用 `--cors https://your-frontend.example.org`。
* 默认值：监听回环地址（`127.0.0.1`）时允许自助注册；监听其他地址（如 `0.0.0.0`）时**默认关闭注册**，由管理员用 `crystallume user create` 建账号（`CRYSTALLUME_ALLOW_REGISTRATION` 可覆盖）。
  登录令牌闲置 30 天后失效（`CRYSTALLUME_TOKEN_TTL_DAYS`，`0` = 永不过期）；构建接口单次最多生成 200 000 个原子（`CRYSTALLUME_MAX_ATOMS`）。
* 多人或多标签页同时编辑同一项目时不会互相覆盖：项目响应带 `ETag`，保存时带 `If-Match`，若项目已在别处被修改则返回 `409`，界面会让你选择重新加载、另存副本或覆盖（见 [`docs/SCHEMA.md`](docs/SCHEMA.md)）。

### Docker

```bash
docker compose up -d                     # 云模式，数据保存在 volume "atomscope_atomscope-data"（沿用改名前的名字）
docker compose exec crystallume crystallume user create alice
# 或者
docker build -t crystallume .
docker run -p 8765:8765 -v crystallume-data:/data crystallume                  # 云模式
# 本地模式：项目以文件夹形式保存在 ./crystallume-data/projects/，只在本机可访问
mkdir -p crystallume-data
docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/crystallume-data:/data" \
  -e CRYSTALLUME_MODE=local -e CRYSTALLUME_TOKEN=<随机长字符串> crystallume
```

* 镜像默认以 uid 1000 运行；挂载本机目录时请先创建它，并用 `--user "$(id -u):$(id -g)"` 让容器以你的身份读写（否则 Docker 会以 root 身份创建目录，容器无法写入而退出）。
* 本地模式没有账号：`-p 127.0.0.1:8765:8765` 只在本机发布端口；令牌即登录密码（用户名 `local`）。
* 从 AtomScope 升级：compose 服务已改名为 `crystallume`，请运行一次 `docker compose up -d --remove-orphans`，让旧的 `atomscope`
  容器停止并让出端口。`docker-compose.yml` 固定了改名前的项目名 `atomscope`，所以即使检出目录改名为 `crystallume` 或重新克隆，
  也继续使用原来的数据卷 `atomscope_atomscope-data`。若旧检出目录不叫 `atomscope`（如 `atomscope-main`），旧项目名就是那个目录名：
  请在 compose 文件旁的 `.env` 中写入 `COMPOSE_PROJECT_NAME=<旧目录名>`（或运行 `docker compose -p <旧目录名> ...`），否则会使用一个新的空数据卷，
  旧容器也不会被停止。用 `docker run` 时继续挂载原来的卷（如 `-v atomscope-data:/data`）；原来的 `-e ATOMSCOPE_*` 参数仍然有效。

### 子路径部署（反向代理）

把 Crystallume 放在已有网站的子路径下（例如 `https://lab.example.org/crystallume/`）：

```bash
crystallume serve --mode cloud --root-path /crystallume        # 或 CRYSTALLUME_ROOT_PATH=/crystallume
```

```nginx
location /crystallume/ {
    proxy_pass http://127.0.0.1:8765/;          # 去掉前缀转发；保留前缀（proxy_pass http://127.0.0.1:8765;）也可以
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;                  # 与 CRYSTALLUME_MAX_UPLOAD_MB 一致
}
```

前端的 API 地址、插件模块和静态资源都使用相对路径，因此在子路径下无需额外配置；访问 `/crystallume`（无结尾斜杠）会自动跳转到 `/crystallume/`。
要把界面嵌入其他网站的 `<iframe>`，设置 `CRYSTALLUME_FRAME_ANCESTORS="'self' https://your-site"`。
登录与注册的频率限制按客户端地址计算：代理不在本机（例如另一个容器）时，设置 `CRYSTALLUME_FORWARDED_ALLOW_IPS=<代理地址>`（或代理所在的网段，如 Docker 网络 `172.28.0.0/16`；同 `--forwarded-allow-ips`），
让服务器采用代理传来的 `X-Forwarded-For`；否则所有用户都显示为代理的地址，一个人输错密码就会让所有人暂时无法登录。
不要设为 `*`：那样任何能直接连到该端口的客户端都可以自己填写 `X-Forwarded-For`、伪造地址来绕过频率限制。

### 配置（命令行参数优先于环境变量）

| 环境变量 | 说明 | 默认值 |
|---|---|---|
| `CRYSTALLUME_HOST` / `CRYSTALLUME_PORT` | 监听地址 / 端口 | `127.0.0.1` / `8765` |
| `CRYSTALLUME_MODE` | `local` 或 `cloud` | `local` |
| `CRYSTALLUME_DATA_DIR` | 数据目录 | `~/.crystallume` |
| `CRYSTALLUME_PLUGIN_DIRS` | 插件目录（`:` 或 `,` 分隔） | — |
| `CRYSTALLUME_ALLOW_REGISTRATION` | 云模式下是否允许注册 | 监听回环地址时 `true`，否则 `false` |
| `CRYSTALLUME_TOKEN` | 本地模式：要求此令牌才能访问 | —（不需要登录） |
| `CRYSTALLUME_TOKEN_TTL_DAYS` | 云模式登录令牌闲置多少天后失效（`0` = 永不） | `30` |
| `CRYSTALLUME_MAX_ATOMS` | 构建接口生成的原子数上限 | `200000` |
| `CRYSTALLUME_SECRET` | 服务器密钥（用于令牌哈希） | 自动生成并保存到 `secret.key` |
| `CRYSTALLUME_CORS_ORIGINS` | 允许的跨域来源（逗号分隔） | — |
| `CRYSTALLUME_FRAME_ANCESTORS` | 允许嵌入本界面的网站（CSP `frame-ancestors`） | —（仅同源） |
| `CRYSTALLUME_ROOT_PATH` | 子路径前缀（同 `--root-path`） | — |
| `CRYSTALLUME_FORWARDED_ALLOW_IPS` | 信任其 `X-Forwarded-For/-Proto` 的反向代理地址或网段（逗号分隔，可写 CIDR；不要用 `*`，否则客户端可伪造地址；同 `--forwarded-allow-ips`） | —（仅 `127.0.0.1`） |
| `CRYSTALLUME_ALLOWED_HOSTS` | 无令牌、只监听回环地址的本地服务器额外接受的主机名（逗号分隔，`*` = 任意） | —（仅 localhost 类名称） |
| `CRYSTALLUME_MAX_PROJECT_MB` / `CRYSTALLUME_MAX_UPLOAD_MB` | 项目 / 上传大小上限 | `50` / `100` |
| `CRYSTALLUME_WEB_DIR` | 使用其他目录中的前端 | 包内 `crystallume/web` |
| `CRYSTALLUME_LOG_LEVEL` | 日志级别 | `info` |

### Python API

```python
import crystallume as cl
from crystallume import build, analysis

s = cl.read("POSCAR")                       # 自动识别格式；多帧文件 → s.frames
s = cl.read("traj.xyz", index=-1)           # 只读最后一帧
cl.write("out.cif", s)                      # 按扩展名选择格式
text = cl.to_text(s, "extxyz")

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
sto = build.crystal("perovskite", ["Sr", "Ti", "O"])
au55 = build.cluster("icosahedron", "Au", 3)          # Mackay 二十面体，3 层 = 55 个原子
caf = build.molecule("caffeine")

bonds = analysis.neighbors(cu)              # [(i, j, 距离, (ox, oy, oz)), ...]，支持周期性边界
cn = analysis.coordination_numbers(cu)
r, g = analysis.rdf(cu, rmax=6.0, nbins=120)
print(analysis.summary(sto))                # 化学式、体积、密度、晶胞参数……

cl.view(sto)                                # 后台启动本地服务器并在浏览器中打开

client = cl.Client("http://127.0.0.1:8765")        # 仅用标准库的 REST 客户端
client.login("alice", "secret")                     # 云模式
p = client.create_project("铜", structures=[cu])
client.coordination(cu)["average"]                  # 每个 REST 接口都有对应方法
client.analysis("hello-com", cu)                    # 运行服务器上的插件分析
client.convert("in.cif", "poscar", "out.vasp")      # 服务器端转换（含插件格式）

plugins = cl.load_plugins(["./plugins"])            # 在 Python 中加载插件：read/write 立即支持插件格式
chain = plugins.builders["hello-chain"].func(n=12)
```

`Structure` 常用方法：`to_dict/from_dict`、`copy`、`formula`、`composition`、`repeat`、`wrap`、`center(vacuum=)`、
`translate`、`frac_positions`、`volume`、`density`、`get_distance(i, j, mic=)`、`get_angle`、`get_dihedral`、
`append`、`extend`、`delete`、`select(elements=)`、`bounding_box`、`get_frame`、`iter_frames`。

支持的文件格式：`xyz`/`extxyz`（多帧、Lattice、Properties）、`poscar`（VASP 4/5、Direct/Cartesian、选择性动力学、负缩放因子）、
`cif`（读取时自动展开对称操作；写出为 P1）、`pdb`（CRYST1、MODEL 多帧）、`json`（Crystallume 结构格式）。插件可以添加更多格式。

### REST API 概览

所有接口位于 `/api/v1` 下，交互式文档见 `/docs`。错误统一返回 `{"detail": "..."}`。

| 分类 | 接口 |
|---|---|
| 元信息 | `GET /health`、`GET /info`、`GET /elements`、`GET /formats`、`GET /plugins` |
| 认证 | `POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me` |
| 项目 | `GET/POST /projects`、`GET/PUT/PATCH/DELETE /projects/{id}`、`POST /projects/{id}/duplicate`、`GET /projects/{id}/download`、`POST /projects/import` |
| 文件 | `POST /io/parse`、`POST /io/export`、`POST /io/convert` |
| 构建 | `GET /build/prototypes`、`POST /build/crystal`、`POST /build/cluster`、`POST /build/supercell`、`GET /build/molecules`、`GET /build/molecule/{name}`、`GET /build/custom`、`POST /build/custom/{name}` |
| 分析 | `POST /analysis/bonds`、`/analysis/summary`、`/analysis/coordination`、`/analysis/rdf`、`GET /analysis/custom`、`POST /analysis/custom/{name}` |
| 插件路由 | `/api/v1/ext/...`（由插件提供） |

```bash
curl -s localhost:8765/api/v1/build/crystal -H 'content-type: application/json' \
     -d '{"prototype":"fcc","elements":["Cu"],"a":3.61,"supercell":[2,2,2]}'
curl -s -F file=@POSCAR localhost:8765/api/v1/io/parse
```

数据格式（Structure / Project JSON）见 [`docs/SCHEMA.md`](docs/SCHEMA.md)。

### 插件开发

完整的扩展文档（插件生命周期、每个注册表的条目格式与必填字段、参数表单格式、全部事件、全部场景参数及取值范围、预设格式、iframe 嵌入协议、`plugins.json`）见 **[`docs/PLUGINS.md`](docs/PLUGINS.md)**。最快的开始方式：

```bash
crystallume plugins new my-plugin --dir ./plugins      # 生成 plugin.py 与 static/my-plugin.js
crystallume serve --plugins ./plugins
```

插件是一个包含 `register(ctx)` 函数的 Python 模块（可选 `PLUGIN = {"name", "version", "description"}`）。发现方式：

1. 插件目录：`crystallume serve --plugins DIR`（或 `CRYSTALLUME_PLUGIN_DIRS`）——目录中每个包含 `plugin.py` 的子文件夹，以及每个 `*.py` 文件；
2. 已安装的包：在 `pyproject.toml` 中声明入口点组 `crystallume.plugins`：
   ```toml
   [project.entry-points."crystallume.plugins"]
   myplugin = "my_package.crystallume_plugin"
   ```

加载失败的插件会被记录并在 `/api/v1/plugins` 中以 `status: "error"` 列出，不会导致服务器崩溃；网页界面启动时会给出一次提示，“帮助 → Scripting & API → Server” 中可以看到每个插件的状态和错误。

```python
from fastapi import APIRouter
from crystallume import PluginContext, Structure

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
    ctx.add_preset("lighting", {"id": "sunset", "name": "Sunset", ...})    # lighting | colorScheme | look（旧名 style）
    ctx.add_router(router)                                                 # 挂载到 /api/v1/ext
    ctx.add_static("static")                                               # /plugins/hello/...
    ctx.add_frontend_module("hello.js")                                    # 前端会动态 import（相对地址 plugins/hello/hello.js）
```

插件的格式、构建器和分析在网页界面中自动出现：文件导入/导出与“粘贴”中的 `(server)` 格式、导出菜单与命令面板中的 “Export …”、构建面板的 Plugins 页、结构面板的 Analyses 卡片；命令行同样可用（见下文）。

`add_preset` 的字典会原样传给前端。自带的网页界面识别以下形状：`lighting` → `{id, name, key, fill, rim, hemi, ambient, env, extra}`（灯光含 `intensity`、`color`、`azimuth`、`elevation`）；
`colorScheme` → `{id, name, colors: {"Fe": "#e06633", ...}, default: "#b0b6bd"}`；`look`（即 `style`）→ `{id, name, scene: {...}, swatch}`。

前端模块导出 `export default function activate(api)`（可以是 async），`api` 就是 `window.crystallume`：可用 `registerFormat`、`registerStyle`、`registerMaterial`、`registerColorScheme`、
`registerLightingPreset`、`registerEnvironmentMap`、`registerLook`、`registerSample`、`registerAnalysis`、`registerCommand`、`registerStorage`、`registerPanel`、`registerInspectorTab`。
每次注册都会检查必填字段、同名时在控制台警告（传 `{replace: true}` 表示有意替换），并返回一个用于撤销注册的函数（若该条目替换了同名条目，例如内置外观，撤销后会恢复原条目）。完整示例见 [`examples/plugins/hello_plugin`](examples/plugins/hello_plugin)：

```bash
crystallume serve --plugins examples/plugins
curl localhost:8765/api/v1/ext/hello
crystallume plugins --plugins examples/plugins
```

### 命令行

```bash
crystallume serve [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...] \
                  [--no-registration] [--open] [--cors ORIGIN ...] [--root-path /PREFIX]
crystallume convert input.cif POSCAR                    # 按扩展名/文件名判断格式；--from/--to 显式指定
crystallume build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o cu.xyz
crystallume build cluster icosahedron Au --size 3 -o au55.xyz
crystallume build molecule caffeine -o caffeine.pdb
crystallume build custom hello-chain --param n=12 --param element=Ag -o chain.xyz --plugins ./plugins
crystallume analyze rdf structure.cif --param rmax=6       # 内置 summary / coordination / rdf，或插件分析（输出 JSON）
crystallume analyze hello-com chain.xyz --plugins ./plugins
crystallume info structure.cif [--bonds] [--json]
crystallume user create NAME [--password PW] [--data DIR]    # 另有 user list / passwd / delete
crystallume plugins [--plugins DIR] [--json]              # 列出插件及其状态
crystallume plugins new NAME [--dir DIR]                  # 生成一个可直接加载的插件骨架
crystallume formats
python -m crystallume ...                                # 等价
```

`convert`、`info`、`formats`、`build`、`analyze` 会先加载插件（`--plugins DIR`，否则使用 `CRYSTALLUME_PLUGIN_DIRS`，以及已安装的入口点插件），因此插件格式在命令行中同样可用，例如 `crystallume convert t.hello out.xyz --plugins examples/plugins`。

### 网页界面

`crystallume serve` 打开的界面也可以不经后端直接作为静态网页使用（见下文“静态部署”）。主要功能：

| 区域 | 内容 |
|---|---|
| **样式 Style** | 19 种一键“外观”（Paper 纸本、Illustration 墨线卡通、Poster 海报、Line art 线稿、Morandi 莫兰迪、Crystal 彩色玻璃、Midnight 深蓝幻灯片、Publication、VESTA、QuteMol、Clay、Glass、Metallic、Dark、Neon、X-ray、Pearl、Golden hour、Blueprint）；6 种表示法（球棍、空间填充、原子球、Licorice、线框、配位多面体）；15 种配色（Jmol、VESTA、CPK、Pastel、Muted、Modern 现代、Morandi 莫兰迪、Vivid 鲜明、Soft 柔和粉彩、Greyscale 灰度、单色、按序号、按高度、按配位数、按原子属性）及逐元素改色/隐藏；14 种材质（Satin、Glossy、Matte、Metallic、Glass 透射、Crystal 浅色背景玻璃、Pearl 薄膜干涉、Clay、Classic Phong、Cel 卡通、Poster 双色卡通、Flat、Glow 自发光、X-ray 菲涅尔）；半径表、原子/键尺寸、键着色、细分质量 |
| **光照 Light** | 14 种布光（Studio、Headlight、Three-point、Soft daylight、Dramatic、Golden hour、Cool lab、Soft studio、Window light、Night、Poster、Flat、Neon、Environment）；主光/补光/轮廓光的强度、方位、高度、颜色；天空光、环境反射；软阴影与阴影地面；灯光跟随相机；曝光与 7 种色调映射 |
| **效果 Effects** | 环境光遮蔽（GTAO）、墨线描边（深度+法线边缘检测）、深度雾化、泛光、景深、暗角 |
| **场景 Scene** | 背景（纯色/线性/径向渐变/透明）、晶胞线（单胞/外框/全部）、超胞显示、原子回卷、边界原子、跨边界补全配位、成键容差与逐元素对开关、标签、透视/正交、轨道/自由旋转、坐标轴、转台 |
| **项目 Projects** | 存储位置：本浏览器（IndexedDB，离线）、服务器文件夹（local 模式）、云端账户（cloud 模式）、本地文件夹（File System Access API，项目即 `.crystallume.json` 文件）、Claude 云端（作为 claude.ai Artifact 运行时）。自动保存、复制、删除、导入/下载项目文件 |
| **资源库 / 构建** | 18 个示例（晶体、二维材料、纳米团簇、分子、轨迹）；晶体原型构建器（16 种）、团簇构建器（7 种）、分子、粘贴文本、服务器插件构建器 |
| **结构 Structure** | 化学式、晶胞参数、体积、密度、空间群；选择/删除/替换元素（可撤销）；距离/键角/二面角测量；配位统计；径向分布函数 g(r) |
| **导出** | PNG（1×/2×/4×、透明背景）、glTF `.glb`（Blender/PowerPoint/AR）、XYZ、extXYZ、POSCAR、CIF、PDB、JSON、项目文件 |

交互：左键旋转、右键平移、滚轮缩放、单击选择（Shift 多选）、双击居中；把文件拖进窗口或直接粘贴文本即可打开。
`Ctrl/⌘ K` 打开命令面板，`?` 查看全部快捷键，“帮助 → Take the tour” 有 1 分钟新手引导。

#### JavaScript API 与前端扩展

整个界面可通过 `window.crystallume` 脚本化，插件拿到的也是同一个对象：

```js
const s = crystallume.build.crystal('perovskite', { elements: ['Ba', 'Ti', 'O'], a: 4.01, repeat: [3, 3, 3] });
crystallume.load(s);
crystallume.applyLook('qutemol');
crystallume.set('post.outline.enabled', true);      // 任意场景参数（点路径）
crystallume.view('c');
const png = await crystallume.screenshot({ scale: 3, transparent: true });
crystallume.selectSameElement('O');                 // 也有 selectAll()、selectNeighbors()
const g = await crystallume.analyze('rdf', { rmax: 6 });   // 内置、JS 插件或服务器插件的分析
crystallume.registerColorScheme({ id: 'o-red', name: 'Oxygen highlight', colorFor: (el) => el === 'O' ? '#f24' : '#bbb' });
crystallume.help();                                 // 在控制台以表格列出注册表、命令、场景参数和事件
```

“帮助 → Scripting & API” 提供快速上手示例、实时生成的参考（点击即可复制调用代码，例如 `crystallume.applyLook('neon')`）以及服务器 API 文档与插件状态；命令面板中的 “Copy current scene as script” 会把当前场景复制为 `crystallume.patch({...})` 脚本。

可扩展的注册表：`formats`、`styles`（表示法）、`materials`、`colorSchemes`、`lighting`、`environmentMaps`、`looks`、`samples`、`analyses`、`prototypes`、
`clusters`、`commands`、`storage`（存储后端，例如 S3/WebDAV）、`panels.left` / `panels.inspector`（界面面板）。每个表示法、外观、布光、配色、示例和可写格式都会自动出现在命令面板中。

嵌入到其他网页时可用 `postMessage`：`{type: 'crystallume:load', text, format}`、`crystallume:look`、`crystallume:set`、`crystallume:view`、`crystallume:screenshot`，
以及 `{type: 'crystallume:call', method, args}`（白名单方法，返回 `{result}`）、`{type: 'crystallume:get', what: 'scene' | 'summary' | 'selection'}`、
`{type: 'crystallume:subscribe', events: ['selection']}`（事件以 `{type: 'crystallume:event', name, detail}` 发回父页面）。协议细节见 [`docs/PLUGINS.md`](docs/PLUGINS.md#6-embedding-postmessage)。

#### 静态部署

前端没有构建步骤，依赖（three.js r170）已随包附带，可离线运行：

```bash
python scripts/build_artifact.py --out dist/web      # 复制成独立静态站点
python -m http.server -d dist/web 8080               # 或放到 GitHub Pages / S3 / nginx
```

不带后端时，项目保存在浏览器或本地文件夹；带后端时自动出现“服务器文件夹/云端”存储与插件。
静态部署也可以加载前端插件：把模块放在站点目录中并写入 `plugins.json`（`[{"name": "hello", "url": "plugins/hello/hello.js"}]`），
或用 `python scripts/build_artifact.py --plugin examples/plugins/hello_plugin` 自动复制并生成；本地调试时也可以用 `?plugin=<同源地址>` 临时加载。

#### 作为 claude.ai Artifact 运行

```bash
python scripts/build_artifact.py --fragment --out dist/artifact   # 入口页不带 <html>/<head>，由宿主提供文档骨架
```

把 `dist/artifact/index.html` 作为 Artifact 页面发布，并把同一目录下的其他文件（`js/`、`css/`、`vendor/`、`plugins.json`）作为附带文件一起发布
（例如让 Claude 发布这个文件夹）。页面需要声明以下运行时能力：

| 能力 | 用途 | 缺少时 |
|---|---|---|
| `db` | “Claude 云端”存储：项目私有地保存在 `data/users/<用户 id>/` 下，按块写入（每个文档不超过 256 KiB） | 没有 Claude 云端，项目只保存在浏览器中 |
| `user` | 识别当前用户，使每个人只看到自己的项目 | 同上 |
| `downloads` | 导出 PNG、glTF、结构文件和下载项目文件（非白名单扩展名会打包为 `.zip`） | 导出按钮和下载项被隐藏 |

在 Artifact 中不能弹出系统对话框或新窗口，所有确认都使用应用内对话框；宿主在 `<html>` 上设置的 `data-theme` 会被跟随（切换回宿主主题即恢复跟随）。

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
crystallume --version
```

### Local mode (single user)

```bash
crystallume serve --open                 # http://127.0.0.1:8765
crystallume serve --port 9000 --data ~/my-atoms
```

* No login. Projects live in `<data>/projects/` (default `~/.crystallume/projects/`), **one folder per project**:
  ```
  projects/
    perovskite-study-p_8f3a91c2d4/
      project.json            # the full project document (crystallume.project/1)
      structures/s_1.xyz      # extended-XYZ copy of every structure, for other tools
      thumbnail.jpg           # project thumbnail
    .trash/                   # deleted projects are moved here (recoverable)
  ```
* Drop any `.json` project (or structure JSON) into `projects/` and it is imported on the next listing.
* Folders may be copied or renamed freely; a copied folder automatically receives a new project id.
* **Network warning:** local mode has no login and listens on `127.0.0.1` by default. With `--host 0.0.0.0`, anyone who can
  reach the address can read, change and delete your projects (the start-up banner warns about it). Use `--mode cloud`
  instead, or set `CRYSTALLUME_TOKEN=<long random string>` to require a token (sign in as user `local` with that token in the
  UI; API clients send `Authorization: Bearer <token>`). Wrong tokens count as failed sign-ins (`429` after 10 in 5 minutes
  per address), and a short or placeholder token (such as `change-me`) is warned about at start-up.
* Other web pages cannot use your browser to write to a local server: writes sent by another site get `403` (unless it is
  listed in `CRYSTALLUME_CORS_ORIGINS`), and JSON bodies must be sent as `Content-Type: application/json`. Without a token and
  bound to `127.0.0.1`, the server only answers to `localhost` names (against DNS rebinding); to open it under another name
  set `CRYSTALLUME_ALLOWED_HOSTS=<name>` or `CRYSTALLUME_TOKEN`.

### Server / cloud mode (multi-user)

```bash
crystallume serve --mode cloud --host 0.0.0.0 --port 8765 --data /srv/crystallume
crystallume serve --mode cloud --host 0.0.0.0 --no-registration     # no self sign-up
crystallume user create alice --data /srv/crystallume               # admin creates accounts (prompts for a password)
```

* Accounts, tokens and projects are stored in `<data>/crystallume.db` (SQLite; a data directory from before the rename
  keeps using its `atomscope.db`). Passwords are salted scrypt hashes; only an HMAC of each API token is stored.
* Project routes and server-side analyses (`POST /api/v1/analysis/*`) require `Authorization: Bearer <token>`; users never see each other's projects.
* Analyses are bounded (atoms, periodic images, atom pairs), and request bodies are size-limited even when streamed without a length.
* With `--host 0.0.0.0` the start-up banner prints the LAN addresses.
* Put the server behind an HTTPS reverse proxy (nginx, Caddy, Traefik) when exposing it publicly.
* Use `--cors https://your-frontend.example.org` when the UI is served from another origin.
* Defaults: self-registration is on when the server listens on a loopback address and **off** on any other address
  (e.g. `0.0.0.0`) — create accounts with `crystallume user create` (override with `CRYSTALLUME_ALLOW_REGISTRATION`).
  Sign-in tokens expire after 30 idle days (`CRYSTALLUME_TOKEN_TTL_DAYS`, `0` = never); builder endpoints produce at most
  200 000 atoms (`CRYSTALLUME_MAX_ATOMS`).
* Concurrent edits never overwrite each other silently: project responses carry an `ETag`, saves send `If-Match`, and a
  project changed elsewhere answers `409` — the UI then offers reload, save a copy or overwrite (see [`docs/SCHEMA.md`](docs/SCHEMA.md)).

### Docker

```bash
docker compose up -d                     # cloud mode, data in the "atomscope_atomscope-data" volume (name from before the rename)
docker compose exec crystallume crystallume user create alice
# or
docker build -t crystallume .
docker run -p 8765:8765 -v crystallume-data:/data crystallume                  # cloud mode
# local mode: projects as folders in ./crystallume-data/projects/, reachable from this machine only
mkdir -p crystallume-data
docker run -p 127.0.0.1:8765:8765 --user "$(id -u):$(id -g)" -v "$PWD/crystallume-data:/data" \
  -e CRYSTALLUME_MODE=local -e CRYSTALLUME_TOKEN=<long random string> crystallume
```

* The image runs as uid 1000. Create a bind-mounted folder first and pass `--user "$(id -u):$(id -g)"` so the container
  reads and writes it as you (otherwise Docker creates it owned by root and the server exits: permission denied).
* Local mode has no accounts: `-p 127.0.0.1:8765:8765` publishes the port on this machine only, and the token is the
  sign-in password (user `local`).
* Upgrading from AtomScope: the compose service is now `crystallume`; run `docker compose up -d --remove-orphans` once so
  the old `atomscope` container stops and frees the port. `docker-compose.yml` pins the pre-rename project name
  `atomscope`, so the data volume stays `atomscope_atomscope-data` even when the checkout folder is renamed to
  `crystallume` or freshly cloned. If your old checkout folder had another name (e.g. `atomscope-main`), that name was
  the project name: put `COMPOSE_PROJECT_NAME=<old folder name>` in a `.env` file next to the compose file (or run
  `docker compose -p <old folder name> ...`), otherwise compose starts on a new, empty volume and leaves the old container
  running. With `docker run`, keep mounting your existing volume (e.g. `-v atomscope-data:/data`); old `-e ATOMSCOPE_*`
  options still apply.

### Serving under a sub-path (reverse proxy)

To run Crystallume under a path of an existing site (e.g. `https://lab.example.org/crystallume/`):

```bash
crystallume serve --mode cloud --root-path /crystallume        # or CRYSTALLUME_ROOT_PATH=/crystallume
```

```nginx
location /crystallume/ {
    proxy_pass http://127.0.0.1:8765/;          # strips the prefix; keeping it (proxy_pass http://127.0.0.1:8765;) works too
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;                  # match CRYSTALLUME_MAX_UPLOAD_MB
}
```

The frontend uses relative URLs for the API, plugin modules and assets, so nothing else needs configuring; `/crystallume`
without the trailing slash redirects to `/crystallume/`. To embed the UI in an `<iframe>` on another site, set
`CRYSTALLUME_FRAME_ANCESTORS="'self' https://your-site"`.
Sign-in and sign-up rate limits count per client address. When the proxy is not on the same host (another container, a load
balancer), set `CRYSTALLUME_FORWARDED_ALLOW_IPS=<proxy address>` or the proxy's network such as the Docker subnet
`172.28.0.0/16` (or `--forwarded-allow-ips`) so the server uses the `X-Forwarded-For` header the proxy sends; otherwise
every user appears as the proxy, and one person's typos lock everyone out. Do not use `*`: any client that can reach the
port directly could then write its own `X-Forwarded-For` and pick a fresh address to dodge the limits.

### Configuration (CLI flags override environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `CRYSTALLUME_HOST` / `CRYSTALLUME_PORT` | bind address / port | `127.0.0.1` / `8765` |
| `CRYSTALLUME_MODE` | `local` or `cloud` | `local` |
| `CRYSTALLUME_DATA_DIR` | data directory | `~/.crystallume` |
| `CRYSTALLUME_PLUGIN_DIRS` | plugin directories (`:` or `,` separated) | — |
| `CRYSTALLUME_ALLOW_REGISTRATION` | allow self-registration in cloud mode | `true` on a loopback address, else `false` |
| `CRYSTALLUME_TOKEN` | local mode: require this bearer token | — (no login) |
| `CRYSTALLUME_TOKEN_TTL_DAYS` | cloud sign-ins expire after this many idle days (`0` = never) | `30` |
| `CRYSTALLUME_MAX_ATOMS` | atom limit of the builder endpoints | `200000` |
| `CRYSTALLUME_SECRET` | server secret (token hashing) | generated, stored in `secret.key` |
| `CRYSTALLUME_CORS_ORIGINS` | allowed CORS origins (comma separated) | — |
| `CRYSTALLUME_FRAME_ANCESTORS` | sites allowed to embed the UI (CSP `frame-ancestors`) | — (same origin) |
| `CRYSTALLUME_ROOT_PATH` | URL prefix behind a reverse proxy (as `--root-path`) | — |
| `CRYSTALLUME_FORWARDED_ALLOW_IPS` | reverse-proxy addresses or CIDR networks whose `X-Forwarded-For/-Proto` are trusted (comma separated; avoid `*`, which lets clients forge their address; as `--forwarded-allow-ips`) | — (`127.0.0.1` only) |
| `CRYSTALLUME_ALLOWED_HOSTS` | extra host names a token-less local server on a loopback address answers to (comma separated, `*` = any) | — (localhost names) |
| `CRYSTALLUME_MAX_PROJECT_MB` / `CRYSTALLUME_MAX_UPLOAD_MB` | size limits | `50` / `100` |
| `CRYSTALLUME_WEB_DIR` | serve the frontend from another directory | packaged `crystallume/web` |
| `CRYSTALLUME_LOG_LEVEL` | log level | `info` |

### Python API

```python
import crystallume as cl
from crystallume import build, analysis

s = cl.read("POSCAR")                       # format auto-detected; multi-frame files → s.frames
s = cl.read("traj.xyz", index=-1)           # last frame only
cl.write("out.cif", s)                      # format from the extension
text = cl.to_text(s, "extxyz")

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
sto = build.crystal("perovskite", ["Sr", "Ti", "O"])
au55 = build.cluster("icosahedron", "Au", 3)          # Mackay icosahedron, 3 shells = 55 atoms
caf = build.molecule("caffeine")

bonds = analysis.neighbors(cu)              # [(i, j, distance, (ox, oy, oz)), ...], PBC-aware, O(N)
cn = analysis.coordination_numbers(cu)
r, g = analysis.rdf(cu, rmax=6.0, nbins=120)
print(analysis.summary(sto))                # formula, volume, density, cell parameters ...

cl.view(sto)                                # start a local server in the background and open the browser

client = cl.Client("http://127.0.0.1:8765")        # stdlib-only REST client
client.login("alice", "secret")                     # cloud mode
p = client.create_project("Copper", structures=[cu])
client.coordination(cu)["average"]                  # every REST endpoint has a method
client.analysis("hello-com", cu)                    # run a plugin analysis on the server
client.convert("in.cif", "poscar", "out.vasp")      # server-side conversion (plugin formats too)

plugins = cl.load_plugins(["./plugins"])            # plugins in Python: read/write handle their formats now
chain = plugins.builders["hello-chain"].func(n=12)
```

`Structure` highlights: `to_dict/from_dict`, `copy`, `formula`, `composition`, `repeat`, `wrap`, `center(vacuum=)`,
`translate`, `frac_positions`, `volume`, `density`, `get_distance(i, j, mic=)`, `get_angle`, `get_dihedral`,
`append`, `extend`, `delete`, `select(elements=)`, `bounding_box`, `get_frame`, `iter_frames`.

File formats: `xyz`/`extxyz` (multi-frame, Lattice, Properties), `poscar` (VASP 4/5, Direct/Cartesian, selective dynamics,
negative scale), `cif` (symmetry operators expanded on read; P1 on write), `pdb` (CRYST1, MODEL frames), `json`
(Crystallume structure JSON). Plugins can add more.

### REST API overview

Everything lives under `/api/v1`; interactive docs at `/docs`. Errors are `{"detail": "..."}`.

| Area | Endpoints |
|---|---|
| Meta | `GET /health`, `GET /info`, `GET /elements`, `GET /formats`, `GET /plugins` |
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Projects | `GET/POST /projects`, `GET/PUT/PATCH/DELETE /projects/{id}`, `POST /projects/{id}/duplicate`, `GET /projects/{id}/download`, `POST /projects/import` |
| Files | `POST /io/parse`, `POST /io/export`, `POST /io/convert` |
| Build | `GET /build/prototypes`, `POST /build/crystal`, `POST /build/cluster`, `POST /build/supercell`, `GET /build/molecules`, `GET /build/molecule/{name}`, `GET /build/custom`, `POST /build/custom/{name}` |
| Analysis | `POST /analysis/bonds`, `/analysis/summary`, `/analysis/coordination`, `/analysis/rdf`, `GET /analysis/custom`, `POST /analysis/custom/{name}` |
| Plugin routes | `/api/v1/ext/...` (added by plugins) |

```bash
curl -s localhost:8765/api/v1/build/crystal -H 'content-type: application/json' \
     -d '{"prototype":"fcc","elements":["Cu"],"a":3.61,"supercell":[2,2,2]}'
curl -s -F file=@POSCAR localhost:8765/api/v1/io/parse
```

The Structure / Project JSON contracts are documented in [`docs/SCHEMA.md`](docs/SCHEMA.md).

### Writing plugins

The full extension guide — plugin lifecycle, every registry's entry shape and required fields, the parameter schema,
all events, every scene setting with its range, preset shapes, the iframe embedding protocol and `plugins.json` — is in
**[`docs/PLUGINS.md`](docs/PLUGINS.md)**. The quickest start:

```bash
crystallume plugins new my-plugin --dir ./plugins      # writes plugin.py and static/my-plugin.js
crystallume serve --plugins ./plugins
```

A plugin is a Python module with `register(ctx)` (and optionally `PLUGIN = {"name", "version", "description"}`). Discovery:

1. plugin directories — `crystallume serve --plugins DIR` (or `CRYSTALLUME_PLUGIN_DIRS`): every sub-folder containing
   `plugin.py` and every `*.py` file;
2. installed packages — entry-point group `crystallume.plugins`:
   ```toml
   [project.entry-points."crystallume.plugins"]
   myplugin = "my_package.crystallume_plugin"
   ```

A plugin that fails to load is logged and listed with `status: "error"` in `/api/v1/plugins`; it never crashes the server.
The web UI shows one notice at start-up, and Help › Scripting & API › Server lists every plugin with its status and error.

```python
from fastapi import APIRouter
from crystallume import PluginContext, Structure

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
    ctx.add_preset("lighting", {"id": "sunset", "name": "Sunset", ...})    # lighting | colorScheme | look (older name: style)
    ctx.add_router(router)                                                 # mounted under /api/v1/ext
    ctx.add_static("static")                                               # served at /plugins/hello/...
    ctx.add_frontend_module("hello.js")                                    # imported by the web UI (relative URL plugins/hello/hello.js)
```

Plugin formats, builders and analyses show up in the web UI by themselves: `(server)` formats in import, export and
Paste, "Export …" in the Export menu and command palette, the Build panel's Plugins tab and cards under Analyses in the
Structure panel. The command line uses them too (see below).

`add_preset` dicts are passed to the UI unchanged. The bundled web UI understands: `lighting` → `{id, name, key, fill, rim, hemi, ambient, env, extra}`
(lights take `intensity`, `color`, `azimuth`, `elevation`); `colorScheme` → `{id, name, colors: {"Fe": "#e06633", ...}, default: "#b0b6bd"}`;
`look` (alias `style`) → `{id, name, scene: {...}, swatch}`.

Frontend modules export `export default function activate(api)` (it may be async); `api` is `window.crystallume` with
`registerFormat`, `registerStyle`, `registerMaterial`, `registerColorScheme`, `registerLightingPreset`, `registerEnvironmentMap`,
`registerLook`, `registerSample`, `registerAnalysis`, `registerCommand`, `registerStorage`, `registerPanel` and `registerInspectorTab`.
Each call checks the required fields, warns in the console when it replaces an entry with the same id (pass `{replace: true}`
to do that on purpose) and returns a function that removes the entry (an entry it replaced, such as a built-in look,
comes back). See the complete example in
[`examples/plugins/hello_plugin`](examples/plugins/hello_plugin):

```bash
crystallume serve --plugins examples/plugins
curl localhost:8765/api/v1/ext/hello
crystallume plugins --plugins examples/plugins
```

### Command line

```bash
crystallume serve [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...] \
                  [--no-registration] [--open] [--cors ORIGIN ...] [--root-path /PREFIX]
crystallume convert input.cif POSCAR                    # formats from extension/file name; or --from/--to
crystallume build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o cu.xyz
crystallume build cluster icosahedron Au --size 3 -o au55.xyz
crystallume build molecule caffeine -o caffeine.pdb
crystallume build custom hello-chain --param n=12 --param element=Ag -o chain.xyz --plugins ./plugins
crystallume analyze rdf structure.cif --param rmax=6       # built-in summary / coordination / rdf, or a plugin analysis (JSON)
crystallume analyze hello-com chain.xyz --plugins ./plugins
crystallume info structure.cif [--bonds] [--json]
crystallume user create NAME [--password PW] [--data DIR]    # also: user list / passwd / delete
crystallume plugins [--plugins DIR] [--json]              # plugins and their status
crystallume plugins new NAME [--dir DIR]                  # scaffold a plugin that loads right away
crystallume formats
python -m crystallume ...                                # same thing
```

`convert`, `info`, `formats`, `build` and `analyze` load plugins first (`--plugins DIR`, else `CRYSTALLUME_PLUGIN_DIRS`, plus
installed entry-point plugins), so plugin formats work on the command line too, e.g.
`crystallume convert t.hello out.xyz --plugins examples/plugins`.

### Web interface

The UI served by `crystallume serve` also works as a plain static site without the backend (see "Static hosting").

| Area | What is in it |
|---|---|
| **Style** | 19 one-click looks (Paper, Illustration/ink, Poster, Line art, Morandi, Crystal, Midnight, Publication, VESTA, QuteMol, Clay, Glass, Metallic, Dark, Neon, X-ray, Pearl, Golden hour, Blueprint); 6 representations (ball & stick, space-filling, atomic spheres, licorice, wireframe, coordination polyhedra); 15 colour schemes (Jmol, VESTA, CPK, pastel, muted, Modern, Morandi, vivid, soft pastel, greyscale, single colour, by index, by height, by coordination, by per-atom property) plus per-element colour/visibility; 14 materials (satin, glossy, matte, metallic, transmissive glass, crystal glass for light backgrounds, iridescent pearl, clay, classic Phong, cel, two-tone poster cel, flat, glow, Fresnel X-ray); radius tables, sizes, bond colouring, tessellation quality |
| **Light** | 14 rigs (Studio, Headlight, Three-point, Soft daylight, Dramatic, Golden hour, Cool lab, Soft studio, Window light, Night, Poster, Flat, Neon, Environment); key/fill/rim intensity, azimuth, elevation and colour; sky light and environment reflections; soft shadows and a shadow floor; camera-locked or world-fixed lights; exposure and 7 tone-mapping operators |
| **Effects** | Ambient occlusion (GTAO), ink outlines (depth + normal edges), depth cueing, bloom, depth of field, vignette |
| **Scene** | Background (solid, linear/radial gradient, transparent), cell edges (unit/outline/all), display supercell, wrapping, boundary atoms, bonded images across the boundary, bond tolerance and per-pair switches, labels, perspective/orthographic, orbit/free rotation, axis gizmo, turntable |
| **Projects** | Storage: this browser (IndexedDB, offline), server folder (local mode), cloud account (cloud mode), a local folder (File System Access API — projects are `.crystallume.json` files), Claude cloud (when running as a claude.ai artifact). Autosave, duplicate, delete, import/download project files |
| **Library / Build** | 18 samples (crystals, 2D materials, nanoclusters, molecules, a trajectory); crystal prototypes (16), cluster shapes (7), molecules, paste-a-file, server plugin builders |
| **Structure** | Formula, cell, volume, density, space group; select / delete / replace elements (undoable); distance, angle and dihedral measurements; coordination statistics; radial distribution g(r) |
| **Export** | PNG (1×/2×/4×, transparent), glTF `.glb` (Blender, PowerPoint, AR), XYZ, extXYZ, POSCAR, CIF, PDB, JSON, project file |

Mouse: drag to rotate, right-drag to pan, scroll to zoom, click to select (Shift adds), double-click to centre. Drop files on the window or paste file text to open it.
`Ctrl/⌘ K` opens the command palette, `?` lists shortcuts, Help → Take the tour gives a one-minute walkthrough.

#### JavaScript API and frontend extensions

The whole UI is scriptable through `window.crystallume` (plugins receive the same object):

```js
const s = crystallume.build.crystal('perovskite', { elements: ['Ba', 'Ti', 'O'], a: 4.01, repeat: [3, 3, 3] });
crystallume.load(s);
crystallume.applyLook('qutemol');
crystallume.set('post.outline.enabled', true);      // any scene setting by dotted path
crystallume.view('c');
const png = await crystallume.screenshot({ scale: 3, transparent: true });
crystallume.selectSameElement('O');                 // also selectAll(), selectNeighbors()
const g = await crystallume.analyze('rdf', { rmax: 6 });   // built-in, JS plugin or server plugin analyses
crystallume.registerColorScheme({ id: 'o-red', name: 'Oxygen highlight', colorFor: (el) => el === 'O' ? '#f24' : '#bbb' });
crystallume.help();                                 // console tables of registries, commands, scene paths and events
```

Help › Scripting & API has a quick start, a live reference (click an entry to copy a call such as
`crystallume.applyLook('neon')`) and the server's API docs and plugin status. The palette command
"Copy current scene as script" copies the scene as a `crystallume.patch({...})` script.

Extensible registries: `formats`, `styles` (representations), `materials`, `colorSchemes`, `lighting`, `environmentMaps`, `looks`, `samples`,
`analyses`, `prototypes`, `clusters`, `commands`, `storage` (backends such as S3 or WebDAV), `panels.left` / `panels.inspector` (UI panels).
Every representation, look, lighting preset, colour scheme, sample and writable format also appears in the command palette.

When embedded in an iframe, drive it with `postMessage`: `{type: 'crystallume:load', text, format}`, `crystallume:look`, `crystallume:set`,
`crystallume:view`, `crystallume:screenshot`, plus `{type: 'crystallume:call', method, args}` (allow-listed methods, replies `{result}`),
`{type: 'crystallume:get', what: 'scene' | 'summary' | 'selection'}` and `{type: 'crystallume:subscribe', events: ['selection']}`
(events come back as `{type: 'crystallume:event', name, detail}`). See [`docs/PLUGINS.md`](docs/PLUGINS.md#6-embedding-postmessage).

#### Static hosting

The frontend has no build step and ships with its dependency (three.js r170), so it runs offline:

```bash
python scripts/build_artifact.py --out dist/web      # copy as a standalone static site
python -m http.server -d dist/web 8080               # or GitHub Pages / S3 / nginx
```

Without the backend, projects live in the browser or a local folder; with it, server-folder/cloud storage and plugins appear automatically.
Static sites can load frontend plugins too: put the module in the site and list it in `plugins.json`
(`[{"name": "hello", "url": "plugins/hello/hello.js"}]`), or let `python scripts/build_artifact.py --plugin examples/plugins/hello_plugin`
copy it and write the file. While developing, `?plugin=<same-origin URL>` loads one temporarily.

#### Running as a claude.ai artifact

```bash
python scripts/build_artifact.py --fragment --out dist/artifact   # entry page without <html>/<head>: the host adds them
```

Publish `dist/artifact/index.html` as the artifact page together with the other files of that folder (`js/`, `css/`,
`vendor/`, `plugins.json`) as its supporting files — for example, ask Claude to publish the folder. The page must declare
these runtime capabilities:

| Capability | Used for | Without it |
|---|---|---|
| `db` | “Claude cloud” storage: projects are kept privately under `data/users/<user id>/`, written in chunks (each document stays under 256 KiB) | no Claude cloud; projects stay in the browser |
| `user` | knowing who is viewing, so everyone sees only their own projects | same as above |
| `downloads` | exporting PNG, glTF and structure files and downloading project files (other extensions are wrapped in a `.zip`) | Export and the download items are hidden |

Inside an artifact the app never opens system dialogs or new windows (all confirmations are in-app), and it follows the
`data-theme` the host sets on `<html>` (switching back to the host's theme returns to following it).

### Development

```bash
pip install -e ".[test]"
pytest -q
```
