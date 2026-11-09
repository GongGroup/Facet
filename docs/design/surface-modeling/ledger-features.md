# 功能模块 API 账本：M1 晶胞 · M2 切面 · M3 层与约束 · M4 原子操作 · M5 吸附物 · M6 界面（冻结版）

状态：**冻结**（2026-11-09）。开发按本账本实现。
优先级：简报文首 U1–U6 ＞ `lead-decisions.md`（负责人决定 L-01…L-19）＞ `ledger-F0.md`（第 0 波条目）＞ 本账本 ＞ 模块规格。模块规格与本账本不一致时**以本账本为准**；本账本引用的第 0 波名字一律按 `ledger-F0.md`（下称 F0 账本，条目记 L-F0-nn）。负责人决定已逐条并入本账本（§1.13）；引用时写全称"负责人决定 L-nn"，以免与本账本的 `L-X-nn`、`L-Mk-nn` 混淆。
本账本只裁决**跨模块与公开接口**的名字、签名、语义、文件归属、任务归属与数据契约；某一模块内部的算法细节（本账本没有写到的）按该模块规格执行。

---

## 0. 总则

### 0.1 依据与版本

| 文档 | 读取时版本 | 说明 |
|---|---|---|
| `design/00-architecture.md` | v2，文首 U1–U6 | 约束一切 |
| `design/lead-decisions.md` | 12:32 版（L-01 … L-19） | 负责人对 `acceptance.md` §4.1 缺口的裁决；优先于两本账本，已逐条并入（§1.13） |
| `design/acceptance.md` | 12:30 版 | 只核对 §4.1 的缺口（G-11 … G-39）与本账本的关系（§1.13） |
| `design/ledger-F0.md` | 冻结版（L-F0-01 … L-F0-56，R1–R17；12:13 版，定稿前复读 §0、§6、§7 与本账本引用的全部 28 个条目，脚本核对见附录 A-3） | 第 0 波的名字；本账本不改动其中任何条目 |
| `specs/M1.md` | v2（11:51） | 提供方 |
| `specs/M2.md` | v2（11:47） | 提供方 |
| `specs/M3.md` | v2（11:09） | 提供方 |
| `specs/M4.md` | v2（10:42） | 提供方 |
| `specs/M5.md` | v2（12:12 版，§0–§10 齐全；定稿前复读，未再变） | 提供方 |
| `specs/M6.md` | v2（12:17 版，§0–§10 与附录齐全；定稿前复读，未再变） | 提供方 |
| `reviews/M1-engineering.md`、`M2-engineering.md`、`M5-engineering.md`、`M6-engineering.md` | — | 接口冲突清单（M1 #6–#8、M2 #7、#10、#11、#24、M5 #9、#10、#18–#20、#25、M6 #4、#5、#14、#16、#18–#22） |
| 仓库 | HEAD `1bb366f`（只读核对） | `文件:行号` 均为该版本 |

本账本的核对脚本在 `scratchpad/proto/xcheck/features/`（附录 A），均已运行。

### 0.2 条目格式

每条：**ID**（`L-X-nn` 为跨模块数据契约与规则，`L-Mk-nn` 为模块 Mk 提供的条目）· **提供方**（模块与任务）· **Python** · **JavaScript** · **语义**（输入、输出、错误与文案、单位、容差、默认值）· **文件** · **消费方**（谁用、做什么）· **已解决的冲突**（各规格用过的其他名字或语义，选了哪一个、为什么）。
标 **[改]** 的是本账本相对提供方规格的改动；标 **[新]** 的是提供方规格里没有、由本账本补上的条目或参数；没有标的照提供方规格原文实现（引用节号）。

### 0.3 通用约定（在 F0 账本 §0.3 之上）

- **命名**：Python snake_case，JS 同一组词的 camelCase；同一个概念只有一个名字（下文"已解决的冲突"列出被废弃的别名，**不得**作为别名保留）。
- **关键字参数**：所有新选项在 Python 中仅限关键字（04 报告 §2.1），JS 用选项对象；位置参数只保留 ASE 兼容所需的（M4 K1、M5 `add_adsorbate` 的 ASE 形式）。
- **真空**（U4，§1 R-F05）：凡是名为 `vacuum` 的参数都指"slab（或叠层）与其下一个周期像之间、沿表面法向的**总间隙**（Å）"，必填、无默认值、从不预填；`SURFACE_DEFAULTS` 中不得有任何以真空间隙为值的键（含"仅供预览"的键）。现有的 `Structure.center(vacuum=)` 与 `build.crystal(..., vacuum=)`（二维原型，`c = 厚度 + 2·vacuum`，`build/crystal.py:329-331`）都是**每侧**的量，保持不变，文档写明差别（负责人决定 L-02，§1.5）。
- **数字进入名字、标签与文案**：一律用 L-M1-15 的 `round_half_up`/`format_decimal`/`format_sig3`/`format_angle`；不得用 `toFixed`、`f"{x:.1f}"`、`round()`（二进制恰为半数时两种语言结果不同，附录 A-2）。
- **化学式**：约化式用 M2 的 `reduced_formula`（L-M2-07）；不约化的式子用现有 `crystallume.project.display_formula(symbols)` 与 JS `structure.formula()` 的同一顺序（Pauling，C 与 H 同在时 Hill；F0 账本 E-38）；不用 Python `Structure.get_formula()`（含 C 时一律 Hill）。
- **`info.surface` 的读写**：读取方必须容忍任何字段缺失、`kind` 缺失或未知；写入方必须保留不认识的键（L-X-01）。
- **帧**：Python `frame=None` → 第 0 帧，JS 缺省当前帧（F0 账本 §0.3）；改变晶格或原子集合的操作只作用于一帧并丢弃其余帧（C11）：网页 `editActive(..., {singleFrame: true})`，Python 核心函数在多帧输入上报 `<what> needs a single-frame structure (this one has 40 frames); select one frame first`（M1 §3.1 的句式，所有模块共用）。
- **REST**：结构 → 结构在 `/build/*`，结构 → 数据在 `/analysis/*`；字段 camelCase；**本期新增的请求模型一律 `model_config = ConfigDict(extra="forbid")`**（拼错的字段 → 422；已有模型不收紧，§1 R-F14）；科学代码的 `ValueError`/`TypeError` → 400，schema → 422；原子数超 `max_atoms` → 400 `This would create about N atoms (limit L).`（`server/routes/build.py:28-29`）。每个端点都有客户端方法并进 `tests/test_client.py` 的 `ROUTE_METHODS`。
- **CLI**（§1 R-F13，M7 收尾时只做汇总、不改这些规则）：写结构的命令（`build …`、`transform`、`edit …`、`adsorb`）用 `--from FMT`（输入格式）、`-o/--output OUT`、`--format FMT`（输出格式，与现有 `build` 组一致，`cli.py:462-463`）；只读的命令（`layers`、`sites`、`terminations`，与现有 `info`、`analyze` 一致）用 `--format FMT` 表示**输入**格式、`--json` 输出 JSON；帧选择一律 `--index N`（单个整数，缺省 −1 = 最后一帧，与 `convert --index` 同名）；警告 `crystallume: warning: …`、提示 `crystallume: note: …` 打到 stderr；`ValueError` 退出码 1，参数错误退出码 2；多值参数用 `nargs=2/3/4` 或可重复的单值参数，不用 `nargs="+"`。
- **网页**：公共 API 成员一律经 F0 账本 L-F0-53 的 `defineApi(path, fn, {owner})` 注册，**不改** `api/public.js`；分区经 L-F0-49 `registerPanelSection`；命令经 L-F0-52 `commands.register`（在模块自己的文件里，`main.js` 只为每个模块入口文件加一行 `import`）；启动前要加载的数据经 L-F0-56 `registerBootTask`；不新增公共事件（`api/public.js` 的 `EVENTS` 不变，模块内部事件只在 `app` 上发）。
- **错误文案**：核心函数的 `ValueError`/JS `Error` 文本两种语言逐字相同、小写开头、无句末句号；界面显示时首字母大写加句号（F0 账本 §0.3）。

### 0.4 文件归属（本账本新增或改变归属的文件；其余按各模块 §9）

| 文件 | 建立者 | 之后追加者（不改已冻结的签名） |
|---|---|---|
| `crystallume/core/intmath.py`、`web/js/core/intmath.js` | M1 T1 | M2 T1（`plane_basis`、`normalize_miller`、`miller_to_primitive`） |
| `crystallume/core/lattice.py`、`web/js/core/lattice.js` | F0-D T7 → F0-A T7a | M1 T2（L-M1-02…07 的晶格函数、`mesh_label`）、M2 T1b（`conventional_cell_hint`） |
| `crystallume/core/naming.py`、`web/js/core/naming.js` | F0-D T1/T2 | M1 T2（L-M1-15 的数字格式化、`rename_after_cell_change`）、M2 T4/T6b（`reduced_formula`、`surface_label`、`adsorbate_suffix`、`surface_name`、`refresh_auto_name`）、M6 T4/T5（`interface_name`） |
| `crystallume/core/infohandlers.py`、`web/js/core/infohandlers.js`（**[新]** 文件） | M1 T10（注册表、`update_surface_geometry`、`surface` 几何处理器） | M2 T4/T5（`surface` 处理器的 M2 字段段落）、M5 T6（`surface.adsorbates` 处理器） |
| `crystallume/core/cellops.py`、`web/js/core/cellops.js` | M1 T3a | M1 T3b、T10（从 `infohandlers` 重新导出注册表函数） |
| `crystallume/core/webdata.py`、`web/js/core/webdata.js`（**[改]** 归属） | **M2 T2**（代码按 M5 §4.2 原样） | 无（M5 T1 只加 `web/data/adsorbates.json`） |
| `crystallume/core/elements.py` 的 `METALS`、`ANIONS`、电负性表对齐（**[改]**） | **M2 T2**（F0 账本 L-F0-22 已定） | 无；M3、M4、M5、M6 一律从这里导入 |
| `crystallume/web/data/oxidation_states.json` | M2 T2 | 无 |
| `crystallume/web/data/adsorbates.json` | M5 T1 | M5 T13（系数与几何） |
| `crystallume/analysis/layers.py`、`web/js/core/layers.js` | M3 T1 | M3 T3a（**[新]** `cluster_heights`、`tags_convention`）、M3 T3b、T4 |
| `crystallume/analysis/neighbors.py`（追加）、`web/js/core/bondgraph.js` | M3 T3a（**[新]** `periodic_components` 也在这里） | 无 |
| `crystallume/analysis/latticematch.py`、`web/js/core/latticematch.js` | M6 T1/T2 | 无 |
| `crystallume/core/defaults.py`、`web/js/core/defaults.js` | F0-D T7 | 每个模块在自己的任务里追加自己的键（L-X-08），两份同时改 |

### 0.5 本账本的裁决一览（详见第 1 章与各条"已解决的冲突"）

| # | 冲突 | 裁决 | 条目 |
|---|---|---|---|
| R-F01 | `gauss_reduce_2d` 的三种期望：M2 钝角约定、M5 `(rows) → (u, v, T)` + round-half-up、M6 私有 `reduce_basis_shortest`（`\|u\| ≤ \|v\|`） | **只有 M1 的一个函数**：`gauss_reduce_2d(a, b, *, angle="obtuse" \| "acute" \| None) → (u, v, M)`，平局"半数向零"；M2、M5 用缺省 `"obtuse"`，M6 用 `angle=None`；删除 M6 的 `reduce_basis_shortest`（核对：附录 A-1，三个场景的匹配类表逐项相同） | L-M1-02 |
| R-F02 | `primitive_cell` 的矩阵方向：M1 v1 `matrix`（输入胞 = matrix @ 原胞）vs M6 期待"新基 = P @ 旧基" | 两个字段：`transform = {num, den}`（新 = T @ 旧，C1 方向）、`supercell_matrix`（整数，旧 = S @ 新）；`PrimitiveResult.matrix = None`；M6 的 K = `supercell_matrix` 的面内块 | L-M1-12 |
| R-F03 | Wood 文本解析：M2 要 `parse_mesh_spec(text, a, b) → 2×2`，M1 有 `parse_mesh_spec(text) → dict` 与 `surface_mesh_matrix(spec, a, b, …)` | 解析只看语法（`parse_mesh_spec(text)`），落到网格上只用 `surface_mesh_matrix(spec, a, b, …)`；M2 的 T1c 取消；六方网格上 `c(4×2)` = `(2×√3)rect`（M1 v2），`c(2×2)` 不适用 | L-M1-06 |
| R-F04 | 两个超胞工具、同名预设给出不同的胞（M1 vs M2 v1）；同一超胞两个名字（`Pt(111) 4L (√3×√3)R30°` vs `Pt(111) (√3×√3)R30° 4L`） | 一个实现（M1 `cellops.make_supercell`）、一张预设表（M1 `WOOD_PRESETS`，相对 1×1 参考网格）、一个编辑器组件 `supercellEditor`（**负责人决定 L-16**：Structure › Cell › Supercell 挂完整 3×3 版本，Surface › Slab 分区内嵌同一组件的面内版本）；名字由 L-X-07 的自动名机制给出（`Pt(111) (√3×√3)R30° 4L`），名字里的网格标签只由矩阵算出（不用预设自己的标签，负责人决定 L-19） | L-M1-06、L-M1-08、L-M1-16、L-X-07 |
| R-F05 | 真空参数：名字与语义、0 的含义、上限、预览占位 | `vacuum` = 总间隙、必填、无默认；上限一律 `SURFACE_DEFAULTS.max_vacuum` = 1000 Å；切面 0 = 体相堆垛、界面 0 = 超晶格、`set_vacuum(0)` 报 E12d；M6 的 `interface_preview_vacuum`（10 Å 预览占位）与 `interface_vacuum_max`（200 Å）删除；M1 的保持真空选项叫 `keep_vacuum="auto" \| True \| False` | §1.5、L-M2-03、L-M6-03 |
| R-F06 | 表面原子：M3 `surface_atoms`（探针暴露）vs M5 自己的位点原子 | 两个概念两个名字：`surface_atoms`（M3，"暴露原子"，界面与文档里的 *surface atoms*）与 `site_atoms`（M5，"定义吸附位点的原子"，`method="exposed"` 时调用 M3）；M5 不得把任何函数命名为 `surface_atoms` | L-M3-05、L-M5-02 |
| R-F07 | `find_layers` 与 `'normal'` 的含义 | `None`/`"auto"` = 有表面时沿表面法向、否则沿 c 面法向（不报错）；`"normal"` = 表面法向，没有表面时报错；`"a"/"b"/"c"` = 另两根晶格矢量所张面的法向（与真空无关）；`tolerance=None` = `info.surface.layerTolerance` → `SURFACE_DEFAULTS.layer_tolerance`；层号 0 = 最底层，`from_top` 0 = 顶层 | L-M3-01 |
| R-F08 | `set_vacuum`/`center_slab` 的归属 | 全部归 M2（`set_vacuum`、`add_vacuum`、`center_slab`、`flip_slab`、`slab_extent`、`slab_report`、`standardize_slab`）；M3 不提供 Centre slab；M6 的层准备调用 `standardize_slab` | L-M2-03…05 |
| R-F09 | 固定底层的选项：M2 `fix_bottom/fix_middle/fix_axes` vs M3 `fix_layers(bottom=, middle=, axes=)` | 两个入口、同一套取值：`fix_axes` 与 `axes` 都列出**被固定**的方向、同一语法（`"abc"` 子集或可精确换算的 x/y/z）；"中间 N 层"在两处都要求 `L − N` 为偶数；切面时由构建层号直接写（M2），已有结构走 M3 的设定语义；两者在未弛豫 slab 上结果相同（测试） | L-M2-02、L-M3-07 |
| R-F10 | 吸附物编号：`next_adsorbate_id`、第一次写 id 前 promote、新原子的 tags 与顺序 | 一套规则 R-ADS（L-X-05），M3、M4、M5、M6 共用：先 `promote_adsorbates`，新 id 从 `next_adsorbate_id` 递增，新原子 `tags = 0`（OC20 约定的 slab 为 2），原来按元素分块的保持分块 | L-X-05 |
| R-F11 | M4 合并 vs M5 放置的复用 | M5 不经 M4 的 `extend(adsorbate=True)` 插入（要一放置一 id、按块插入、一次 remap），两者都直接建在 F0-D 的 `remap`/`extend` 上并都遵守 R-ADS；几何上单原子放置的接触抬升在两个模块中必须给出同一高度（测试）；M5 复用 M4 的移动工具与 `registerSnapTargets` | L-X-05、L-M4-05、L-M5-05 |
| R-F12 | `hnf_matrices_2d` 与 `deform` 的消费方 | `hnf_matrices_2d(n)`（i 升序、j 升序）给 M5 覆盖度、M6 ZSL、M2 可选 T15；M6 的规范形用 M1 `hermite_normal_form_2d`（删去 M6 私有 `hnf_2d`）；`deform` 只有 M1 自己的 Strain 工具使用，M1 §10 写的"M6 应变分配用 `deform`"撤回（M6 在副本上直接施加面内线性映射，结果相同） | L-M1-01、L-M1-10 |
| R-F13 | CLI 选项：`--format` 一处是输入一处是输出、`--to`/`--from`、`--frame`/`--index`、`--wood`/`--supercell`/`--surface-cell` | 见 §0.3 CLI；表面超胞一律 `--surface-cell SPEC`（M1 语法） | 各模块 CLI 条目 |
| R-F14 | 新 REST 模型的多余字段策略：M1/M5 `forbid`、M2 沿用忽略、M6 待定 | 新模型一律 `extra="forbid"` | §0.3 |
| R-F15 | 自动名的哨兵：M1 v2、M5 v2、M6 v2 用 `info.surface.name`，M2 v2 用 `info.surface.autoName`（另有 `baseName`） | **只有** `info.surface.autoName`（负责人决定 L-12），没有 `baseName`：切面与界面的名字由 `surface_name` 从数据算出，其他结构的名字基段 = 编辑前的名字去掉编辑前的吸附物后缀（M5 v2 §4.5 的写法，推广到 M1 的晶胞操作）；统一由 M2 的 `auto_name_state`/`refresh_auto_name` 维护；`info.surface.name` 与 M5 v1 的 `baseName` 只在读取 v1 数据时处理 | L-X-01、L-X-07 |
| R-F16 | 界面来源记录：顶层 `info.interface`（M1 v2 K16、M6 v1）vs `info.surface.interface`（M6 v2、C6） | `info.surface.interface`，`info.surface.kind = "interface"`；没有顶层 `info.interface` 键 | L-X-03 |
| R-F17 | 1×1 参考网格三种定义（M1 §3.6.4、M5 §3.14.2、M6 §3.2.2） | 一个函数 `reference_mesh`（M1）：只在 `kind ∈ {cleave, interface}` 时信任 `info.supercellMatrix`，否则在基底上做只看元素的面内平移搜索（容差 0.3 Å），再否则当前网格 | L-M1-07 |
| R-F18 | 数字格式化四套名字（M1 `round_half_up`/`fmt_*`、M5 `q_d`/`format_decimal`、M6 `format_fixed`） | `round_half_up`、`format_decimal`、`format_sig3`、`format_angle`（`core/naming`，M1 T2） | L-M1-15 |
| R-F19 | 惯用胞识别三个函数（F0-A `centered_cell_hint`、M1 `conventional_lattice`、M2 `conventional_cell_hint`） | 立方/四方/六方一律以 M1 `conventional_lattice` 为准；M2 `conventional_cell_hint` 只额外识别 oF/oI/oC/mC 的标准原胞设置；F0-A 的函数不动且在 fcc/bcc 上与前两者同一矩阵（测试） | L-M1-09、L-M2-01 |
| R-F20 | 网格标签：单位阵写 `p(1×1)`/`(1×1)`/省略，非 Wood 时 `[2 1, -1 3]` 或 `[[s11,s12],[s21,s22]]` | `mesh_label(M, a, b)` = `wood_label` ?? `matrix_label`（单位阵 `p(1×1)`，矩阵 `[2 1, -1 3]`）；名字里单位阵省略 | L-M1-05 |
| R-F21 | 标记吸附物两个公开入口：M3 `mark_adsorbates`/`edit.markAdsorbates` 与 M5 `mark_adsorbate`/`edit.markAdsorbate`（带记录） | 只留 M3 的；标记不写记录，没有记录的组按 `<式> #<id>` 显示；M5 的两个删除 | L-M3-04、L-X-04 |
| R-F22 | M6 的层准备自写轴置换/展开/标准取向，左手晶胞时会改用另一面 | 层准备调用 M2 `standardize_slab`（含左手重标号），再做 M6 自己的 c 长度、约化与翻转 | L-M2-05、L-M6-02 |
| R-F23 | `SURFACE_DEFAULTS` 的重名与过于宽泛的键名 | 见 L-X-08（`conventional_*` 只由 M1 加；M2 的 `layers`/`position`/`offset` 改名 `slab_layers`/`slab_position`/`slab_offset`；M4 `site_contact_tol` 改名 `place_contact_tol`；M5 `coverage_translation_tolerance` → M1 `reference_mesh_tolerance`；M2 `supercell_max_entry` 删除） | L-X-08 |
| R-F24 | `repeat` 与 `make_supercell(diag)`：`repeat` 不重编号 `adsorbate_id`、不调用 info 处理器 | 网页、REST 单帧路径与 `cell.bakeRepeat` 一律用 `make_supercell(diag, wrap=False)`；`repeat` 保留为低层旧接口（只在多帧时由 REST 使用），文档写明它不维护吸附物 | L-M1-08 |
| R-F25 | M3 被请求而未列出的导出：`cluster_heights`、`periodic_components`、`tags_convention`（M5 v2 §10） | M3 T3a 提供 | L-M3-02…04 |
| R-F26 | M5 要在 `api/public.js` 的 `EVENTS` 加 `sites` | 不加公共事件（L-F0-53 不改 `api/public.js`）；`sites` 只是 `app` 的内部事件 | L-M5-09 |
| R-F27 … R-F38 | 交叉检查新发现的 12 处冲突（`exclude`、`contiguous_shifts`、`vacuum_axis`/`_adopt`、`webdata` 归属、吸附物库的加载、M6 的预览占位真空、`surface_label` 的参数、`firstAtom`、`tasker`、`build.supercell` 同名、`rename_after_supercell`、`wood`/`spec`） | 见 §1.12 | 各条 |
| R-F39 | 负责人决定 L-01…L-19 与本账本 | 全部采纳：改动或补充了本账本条目的有 L-02、L-05、L-07、L-08、L-09、L-10、L-11、L-12、L-16、L-18、L-19；L-13、L-17、L-19 的命名部分与本账本原来的裁决一致；其余不涉及功能模块的接口（逐条见 §1.13） | §1.13 |

---

## 1. 冲突裁决（任务清单中的已知冲突与交叉检查新发现的冲突）

每条写：各方的说法 → 裁决 → 理由与证据。条目里的"已解决的冲突"只引用这里的编号。

### 1.1 R-F01 `gauss_reduce_2d` 的三种期望

- **各方**：M1 v2 §3.11.1 冻结 `gauss_reduce_2d(a, b, *, angle="obtuse")`，平局"半数向零"，`angle=None` 专为 M6 保留（不做角度与符号规范化）；M2 v2 K4 用 `angle="obtuse"`（γ ∈ [90°, 120°]）；M5 v1 请求 `gauss_reduce_2d(rows) → (u, v, T)` 与 round-half-up（M5 v2 §3.3.1 已改用 M1 的签名）；M6 v2 §3.3(a) 坚持私有 `reduce_basis_shortest(u, v)`（交换判据 `|v|² < |u|²(1 − 1e-10)`、`round_ties_to_zero`），理由是 M1 **v1** 的钝角约定会让 `|u| > |v|`、改变匹配表（M6 工程审查 #4 的 `m1_gauss_swap.py`）。
- **裁决**：全仓库只有 M1 的一个函数；M6 调用 `gauss_reduce_2d(u, v, angle=None)`，`latticematch` 里不再有 `reduce_basis_shortest`（Python、JS 都删除，也不导出）。M6 的 `Mesh2D.T` 属性名不变（它就是返回的 `M`）。
- **理由与证据**：M6 的反对理由只针对 `angle="obtuse"`；`angle=None` 分支就是 Lagrange–Gauss，保证 `|u|² ≤ (1 + τ)|v|²`、`|u·v| ≤ (½ + τ)|u|²`（τ = `gauss_tolerance` = 1e-9）。附录 A-1：把 M6 v1 原型引擎的约化换成 M1 的 `angle=None` 伪代码后，graphene/斜方 435 类、MoS2/斜方 147 类、graphene/Ni(111) 549 类，**逐项相同、顺序相同**；2 万个随机基（实际 19 999 个）中 18 309 个（91.5%）的整数矩阵相同，其余 1 690 个只在长度并列（两种结果的约化长度相对差 ≤ 9.99e-10）时选了另一组同样满足约化条件的基，M1 的结果全部满足 `|u|² ≤ (1 + τ)|v|²`、`|u·v| ≤ (½ + τ)|u|²`。M6 的 λ1 预筛与二分必须带不小于 `2·gauss_tolerance` 的相对余量（M6 T1 的单元测试断言）。M6 的金标在最终函数上重新生成。

### 1.2 R-F02 `primitive_cell` 的矩阵方向

- **各方**：M1 v1 的 `matrix` 是"输入胞 = matrix @ 原胞"，与 `CellOpResult.matrix`（新 = matrix @ 旧，C1）同名反向；M6 v1/v2 把它当"新 = P @ 旧"用（M6 v2 §3.2.1 第 6 步仍写 `r.matrix`）；M1 工程审查 #7。
- **裁决**：`PrimitiveResult.transform = {"num": 3×3 int, "den": int}`（新 = (num/den) @ 旧，C1 方向）；`PrimitiveResult.supercell_matrix`（整数，**旧 = S @ 新**，det = 群阶）；`PrimitiveResult.matrix` 恒为 `None`（有理矩阵不放进整数字段）。M6 的 K（"输入胞 = K @ 原胞"）= `supercell_matrix` 的面内 2×2 块；`fromInput` = `transform`。
- **理由**：一个字段名只有一个方向；`supercell_matrix` 正好是 M1 K4 的 `info.supercellMatrix` 语义（当前 = M @ 母胞），可以直接组合。

### 1.3 R-F03 Wood 文本解析与表面网格矩阵

- **各方**：M2 v2 §3.12.1/§10.3 请求 `parse_mesh_spec(text, a, b) → 2×2`（"M1 现有的 `surface_mesh_matrix` 只接受预设 id"——这是 M1 v1 的情况）；M1 v2 §3.6.3 已提供 `parse_mesh_spec(text) → dict`（纯语法）与 `surface_mesh_matrix(spec, a, b, *, n, m, N, reference)`（接受预设 id、`p(3×3)`、`3x3`、Wood、`rect`、矩阵文本）。另：M2 v2 说"M1 对六方网格拒绝 `c2x2`/`c4x2`"，而 M1 v2 的预设表里六方上的 `c4x2` = `(2×√3)rect`。
- **裁决**：M2 一律调用 `surface_mesh_matrix(spec, a, b, reference=…)` 得到 2×2 矩阵；`parse_mesh_spec` 只给语法结果（界面高亮、CLI 早期报错用）。M2 的 T1c 取消。六方网格：`c(4×2)` 适用（= `(2×√3)rect`，`[[2,0],[1,2]]`），`c(2×2)` 不适用（`c(2×2) does not fit this surface mesh (hexagonal)`）。失败文案只有 M1 的两句（L-M1-06）。
- **理由**：一套语法一处实现；M1 v2 已经覆盖 M2 要的全部写法。

### 1.4 R-F04 两个超胞工具、同名预设、两个名字

- **各方**：M1 K15（一个编辑器、M2 嵌入）；M2 v2 K17（切面时调用 M1 `make_supercell` 再转回标准取向；已有结构一律走 M1 `cell.supercell`；Slab 分区按钮深链到 Cell 分区）；验收 G-36（建议深链）与**负责人决定 L-16（嵌入）**、验收 G-39 与**负责人决定 L-19**；M2 v1 的预设表与 50/2500 限额；M1 v2 `Pt(111) 4L → (√3×√3)R30° → Pt(111) 4L (√3×√3)R30°` 与 M2 `Pt(111) (√3×√3)R30° 4L`；M1 D13（从预设创建时名字用预设自己的标签，如 `Cu(100) 4L c(2×2)`）vs 简报 C9 的例子 `Cu(100) (√2×√2)R45°` 与 M2 §3.13 的 `Cu(100) (√2×√2)R45° 4L`。
- **裁决**：
  1. 实现：只有 M1 `cellops.make_supercell`（L-M1-08）；切面时的 `supercell=` 也调用它，然后由 M2 转回标准取向并按 M2 的原子顺序重排（L-M2-02）。
  2. 预设：只有 M1 的 `WOOD_PRESETS`/`wood_presets`，**相对 1×1 参考网格**（`reference_mesh`，L-M1-07），`relativeTo: 'current'` 可选；M2 不再有预设表与自己的元素/行列式上限（矩阵元素上限 = M1 `max_matrix_entry`，原子数由估算与 `LIMITS.maxAtoms` 把关）。
  3. 编辑器（**[改]** 负责人决定 L-16，取代本账本早先的"深链"）：**一个组件、两处挂载**。M1 `web/js/ui/cellsupercell.js` 导出 `supercellEditor(el, app, { owner, surface = false })`（M1 §5.1 末条；在 `el` 里渲染，随宿主分区的 `render` 重绘，不返回值）：`Structure › Cell › Supercell` 挂 `surface: false`（完整 3×3）；`Surface › Slab` 分区内嵌 `surface: true`（只允许面内 2×2 矩阵，嵌入真空轴以外的两轴；表面预设在最前；标题用表面用语 `Surface supercell`）。两处执行同一个 `cell.supercell` 命令，共用同一张预设表、同一套限额、命名、toast 与撤销标签，由同一个测试核对（`test_supercell_two_mounts`：同一结构、同一预设，两处得到同一 `info.supercellMatrix` 与同一名字）。Slab 分区不跳转到 Cell 分区，也不另写编辑器。
  4. 名字：自动名的结构由 `surface_name` 重算（L-X-07），得到 `Pt(111) (√3×√3)R30° 4L`；名字里的网格标签**只由矩阵算出**（`mesh_label`，L-M1-05），用 `c(2×2)` 预设得到的 Cu(100) 胞也写 `Cu(100) (√2×√2)R45° 4L`；预设自己的标签只用于读数、toast 与 `CellOpResult.label`（M1 D13 在名字上的部分撤回；负责人决定 L-19）。toast 同时写预设标签与计算出的标签：`Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms`；两者相同（或没有用预设）时只写一次：`Made a (√3×√3)R30° supercell: 12 atoms`（M1 §5.3 的例子）。
  5. 取向：切面时带超胞的结果是标准取向（U2：a ∥ x）；切面后在原位做超胞（M1）不转动原子（P4 的原位编辑、测量与选区不跳），两者名字、`info.supercellMatrix` 相同，相差一个刚性转动与元素块内的顺序；需要 a ∥ x 时用 M1 `reorient`。
- **理由**：同一操作同一结果（P1、C9）；名字只依赖数据（矩阵与来源信息），不依赖走了哪个按钮。

### 1.5 R-F05 真空参数（U4）

| 场合 | 参数 | 0 的含义 | 上限 | 缺失时 |
|---|---|---|---|---|
| M2 `surface(…, vacuum=)`、`SurfaceAnalysis.slab(vacuum=)`、`surfaces(…, vacuum=)` | `vacuum`（仅限关键字，必填） | 按体相堆垛延续（只允许整周期，E12b），`info.surface.stacking = "bulk"` | `max_vacuum` = 1000 Å | Python 自己的 `TypeError`；`vacuum=None` → E12a |
| M2 `oriented_cell(…)` | 无（= `surface(…, vacuum=0)`） | — | — | — |
| M2 `set_vacuum(vacuum, …)` | `vacuum`（位置参数，必填） | E12d（报错并说明原因；界面上可以填 0，就地显示 E12d，Apply 不可用。**负责人决定 L-13**：U4 的"允许 0"指切面与界面构建，已有结构请用 V = 0 切面或 `oriented_cell`） | 1000 Å | `TypeError` / E12a |
| M2 `add_vacuum(amount, …)` | `amount`（可负；结果 ≤ 0 → E12） | — | 结果 ≤ 1000 Å | 必填 |
| M6 `make_interface(…, vacuum=)` | `vacuum`（仅限关键字，必填） | 超晶格（两个界面），允许 | 1000 Å（**[改]**：不是 200） | Python `TypeError`；JS E-VAC |
| M5 `Adsorbate.to_structure(cell=None, *, vacuum=None)` | `vacuum` 只用于"装箱"模式 | — | 1000 Å | `vacuum=None` = 不装箱（不是默认真空） |
| M1 `set_lattice_parameters`/`deform`/`apply_strain` | `keep_vacuum="auto" \| True \| False`（不是间隙值） | — | — | — |
| 现有 `Structure.center(vacuum=)`、`build.crystal(…, vacuum=)` | 每侧的量，保持原义（**负责人决定 L-02**，F0-D T10 实现、M7 写文档）：docstring 与 CLI `build crystal --vacuum` 的帮助写 `vacuum on each side (Å); the gap between periodic images is twice this`；`build.crystal(..., vacuum=)` 给了值时发 `DeprecationWarning`，建议新代码用 `set_vacuum`（总间隙）；Build 面板二维原型的输入框改名 `Cell height c (Å)` | — | — | — |

- 文案（两种语言、REST、CLI 相同）：E12a `vacuum is required: the total gap in Å between the slab and its periodic image (0 for none)`；M6 用同一句，把 `the slab` 换成 `the stack`。界面的 Create/Apply 按钮 tip：`Enter the vacuum (total gap in Å; 0 for none).`
- docstring 与 `docs/PLUGINS.md`：`vacuum: total gap between the slab (or stack) and its periodic image along the surface normal, in Å — not per side as in ASE surface() or Structure.center(vacuum=)`。
- 界面：输入框初始为空、主按钮不可用；会话内可记住**用户自己上次填的值**（模块级变量），不写 `app.prefs`、不写项目、不写 `localStorage`；**预览也不得用任何占位真空**：真空为空时不开 P-swap 会话（M2 显示晶面叠加层，M6 显示列表、详情与晶胞轮廓），填好真空后才预览；用户清空真空框时取消会话。
- REST：`vacuum: float = Field(..., ge=0, le=1000)`（缺失 → 422）。CLI：`--vacuum` 为 `required=True`（M6 的 `--list` 例外，不构建）。
- `SURFACE_DEFAULTS` 没有 `vacuum`、`interface_vacuum`、`interface_preview_vacuum`、`interface_vacuum_max`；测试断言两种语言都没有这些键。

### 1.6 R-F06 表面原子与位点原子

- **各方**：M3 v2 K5、§3.9 `surface_atoms`（探针 κR 的闭式暴露判据）；M5 v2 K3/K4 `site_atoms`（`auto` v2：顶层 ∪ 欠配位且未被覆盖的上半部原子，再补密堆微面三重位）；M3 v1 曾要求"M5 必须用 `surface_atoms`"（M3 v2 §10.4-6 撤回）。
- **裁决**：两个概念、两个函数、两个名字。界面与文档里 *Surface atoms* / "表面原子" 只指 M3 的暴露原子（Layers 分区的 Select surface atoms、查询属性 `surface`）；M5 的叫 *Site atoms* / "位点原子"（Adsorbates 分区的 `9 site atoms (Pt)`；多元素表面的组成与类标签同一写法，如 `4 site atoms (Ti2O2)`，负责人决定 L-09）。M5 的 `method="exposed"` 调用 `surface_atoms(s, side, probe=κ, skip_adsorbates=True, details=True)`；`probe` 是相对半径 R 的比例（不是 Å）。

### 1.7 R-F07 `find_layers` 与 `'normal'`

- **各方**：简报 §3 的 `find_layers(structure, direction=None|"normal"|…, tolerance=SURFACE_DEFAULTS.layer_tolerance)`；M3 v1 的 `'normal'` 是 `'c'` 的别名；M3 v2 K2/K3；M5 v1、M6 用 `"normal"`；M2 用 `"c"`。
- **裁决**（L-M3-01）：`None`/`"auto"` → `surface_normal(s, require_gap=True)` 有结果时用它的法向与轴，否则 c 面法向（无晶胞时 ẑ），**不报错**；`"normal"` → 同上但没有表面时报 `direction 'normal' needs a vacuum gap or a non-periodic axis; use 'c'`；`"a"/"b"/"c"` → 另两根晶格矢量所张平面的法向（取 `n̂·a_k > 0`），与真空无关；`"x"/"y"/"z"`、矢量、`{"hkl"}`、`{"hkil"}`、`{"uvw"}` 照 M3 §3.1。`tolerance=None` 依次取有限正数的 `info.surface.layerTolerance`、`SURFACE_DEFAULTS.layer_tolerance`（0.3 Å）。沿 slab 轴的切口一律是 `surface_normal(...).cut`（= `display_cuts(s)[axis]`），按 `unwrap_along_gap(f, cut)` 展开（F0 账本 L-F0-16）。返回 `index`（0 = 最底层）与 `from_top`（0 = 顶层）；界面、CLI、查询 JSON 与 tags 用"顶层 = 1"。

### 1.8 R-F08 `set_vacuum`/`center_slab` 的归属

- 归 M2（`core/structure.*` 的方法与 `build/surface.*` 的函数，L-M2-03…05）。M3 v2 K15 已撤回 Centre slab 按钮；M1 的提示 N-WR1 指向"居中 slab"（不写按钮路径）；M6 不调用 `set_vacuum`，层准备调用 `standardize_slab`（R-F22）；F0 账本 L-F0-52 命令表里的 `surface.vacuum`、`surface.setVacuum`、`surface.flip`、`surface.center` 都由 M2 实现。

### 1.9 R-F09 固定底层的选项

| | 切面时（M2 `surface`） | 已有结构（M3 `fix_layers`） |
|---|---|---|
| 选择 | `fix_bottom=N`（0 = 不固定）或 `fix_middle=N`（二选一） | `bottom=N` / `top=N` / `middle=N` / `all_but_top=N` / `top_layers=[…]` / `layer_indices=[…]`（恰好一个） |
| 轴 | `fix_axes="abc"`（**被固定**的方向） | `axes="abc"`（**被固定**的方向） |
| 轴的语法 | 同一语法：`"abc"` 的非空子集，或 `"z"`、`"xy"`、`"xyz"` 等可经 `cartesian_to_lattice_flags` 精确换算的笛卡尔名（M3 §3.12.3） | 同左 |
| "中间 N 层" | **[改]** 要求 `L − N` 为偶数，否则 `fix_middle 2 can't be centred in 7 layers; use an odd number`（L 为偶数时写 `an even number`） | `middle 2 can't be centred in 7 layers; use an odd number`（同一规则） |
| 层的来源 | 构建层号（与 `tags` 严格一致，不重新聚类） | `find_layers`（设定语义：目标恰好固定 `axes`，slab 其余放开，吸附物不动） |
| REST / CLI | `fixBottom`、`fixMiddle`、`fixAxes: str`（**[改]**：不是 `Literal`，按上面语法校验）；`--fix-bottom N \| --fix-middle N --axes AXES` | `crystallume edit fix FILE --bottom N … --axes AXES` |

两者在未弛豫的 slab 上结果相同（测试 `test_cleave_fix_equals_fix_layers`）。M3 v1 §10.3-4 的"切面时调用 `fix_layers`"撤回（M2 v2 K13，M3 确认）。

### 1.10 R-F10 吸附物编号与 R-F11 M4/M5 的复用

- **各方**：F0 账本 L-F0-14 `next_adsorbate_id`；M3 §3.13 `promote_adsorbates`；M4 K6/K10、§3.10.5（表面放置：新片段新 id、SD 重置、tags 0、追加在末尾，粘贴完整源吸附物时复制记录）；M4 §3.9.8"M5 放吸附物可直接用 `extend(..., adsorbate=True)`"；M5 v2 K10、§4.3（`apply_placements`：promote、一放置一 id、按块插入、`sort_by_species`、OC20 tags 2，直接用 F0-D `_remap`）。
- **裁决**：L-X-05 的 R-ADS 是唯一规则，M3（标记）、M4（表面放置）、M5（放置）、M6（合并）都遵守；M5 不经 M4 的 `extend(adsorbate=True)`（M4 按成键片段分 id，两个相邻的放置会被并成一个 id；M5 一次 remap 插入整批），两者都直接建在 F0-D 的 `_remap`/`extend`/`sort_by_species` 上。**[改] M4**：表面放置的新原子在 OC20 约定的结构上写 `tags = 2`；原来按元素分块时插入后 `sort_by_species()`（与 M5 相同，导出 POSCAR 不再出 N1 说明）。几何：M4 `site_point(…, bond=d)` 与 M5 `place_adsorbate(单原子, bond_length=d)` 在同一位点给出同一高度（两者都是闭式接触抬升 `t = max_j [h_j + sqrt(d² − ρ_j²)]`；测试 `test_m4_m5_single_atom_height`）；默认键长（**[改]** 负责人决定 L-05）：要放的元素是吸附物库里的单原子条目（`adsorbate(el)` 按元素符号能查到）时，M4 的 `Add atom › Above selection` 与 Place 工具调用 M5 的 `adsorbate_target_distance`（L-M5-05，即 M5 §3.10.3 的目标距离），读数写 `bond 1.94 Å (adsorbate library)`；库里没有的元素用 `place_bond_factor`（1.0）× 共价半径之和，读数写 `bond 1.98 Å (covalent radii)`。O 在 Cu(100) 4 重位、H 在 Pt(111) fcc 因此两条路径给出同一高度（验收 G-18）。M5 复用 M4 的移动工具与 `crystallume.tools.get('move').registerSnapTargets`。

### 1.11 R-F12 `hnf_matrices_2d`、`hermite_normal_form_2d` 与 `deform`

- `hnf_matrices_2d(n)`：全部 `[[i, j], [0, n/i]]`（i | n，0 ≤ j < n/i），按 (i 升序, j 升序)；消费方 M5 `coverage_supercells`、M6 ZSL、M2 可选 T15。
- `hermite_normal_form_2d(M) → (a, b, c)`（`[[a, b], [0, c]]`，a, c > 0，0 ≤ b < c，扩展 gcd 用 floor 语义）：M6 §3.3(c) 说"M1 没有提供"而自写 `hnf_2d`——M1 v2 §3.2 已提供，M6 改用它。
- `deform(s, F, *, keep_vacuum="auto")`：消费方只有 M1 的 Strain 工具、`apply_strain`、REST/CLI。M1 v2 §10 的"M6 应变分配用 `deform(F)`"撤回：M6 v2 §3.8.1 第 4 步在私有副本上保持面内分数坐标、z 不变地施加 `V^{−w}` / `V^{1−w}R`，与 `deform(F ⊕ 1, keep_vacuum=True)` 结果相同，且不必在副本上走 `mark_edited` 与 info 处理器。

### 1.12 其余交叉检查发现（R-F13…R-F38）

| # | 冲突（证据） | 裁决 |
|---|---|---|
| R-F13 | CLI：M5 `adsorb --format`（输入）`--to`（输出）、M3 `edit fix … --to`、M2 `edit vacuum … --format`（输出）、M1 `transform --index`、M3 `layers --frame`、M2 `build surface --supercell NX NY \| --supercell-matrix … \| --wood TEXT`、M1 `--surface-cell SPEC` | §0.3 的 CLI 规则；表面超胞只有 `--surface-cell SPEC`（接受预设 id、Wood、`p(3×3)`、`3x3`、`"2 1; -1 1"`） |
| R-F14 | REST 多余字段：M1、M5 `forbid`，M2 默认忽略，M6 待 M7 | 新模型一律 `forbid`；扩展的旧模型（`SupercellRequest`）不收紧 |
| R-F15 | 自动名哨兵（M1 v2 K5/§3.5.4、M5 v2 §4.5、M6 v2 §4.2 用 `info.surface.name`；M2 v2 §3.13 用 `autoName` + `baseName`；M2 工程审查 #24 建议 `autoName`；M5 工程审查 #19 建议只用一个哨兵） | **只有 `autoName`**（负责人决定 L-12；M2 是字段表的所有者，C6），**没有 `baseName`**；验收 G-32。非切面、非界面结构的名字基段由编辑前的名字去掉编辑前的后缀得到（M5 v2 §4.5），M1 的晶胞操作在去后缀之后、接新后缀之前做 `rename_after_cell_change`，超胞标签因此不会丢（L-X-07 机制第 2 条；例 `CONTCAR + CO` → 2×2×1 → `CONTCAR 2×2×1 + 4CO`） |
| R-F16 | `info.interface` vs `info.surface.interface` | `info.surface.interface`（C6"M5、M6 往里追加"；M6 工程审查 #14：顶层键让 M5 的记录与自动名失效） |
| R-F17 | 1×1 参考网格三种定义 | L-M1-07 |
| R-F18 | 数字格式化四套名字 | L-M1-15 |
| R-F19 | 惯用胞识别三个函数 | L-M1-09、L-M2-01 |
| R-F20 | 网格标签写法 | L-M1-05 |
| R-F21 | 标记吸附物两个入口 | L-M3-04 |
| R-F22 | M6 层准备不处理左手晶胞：`standard_frame` 后 c 指向 −z，第 5 步把 c 换成 +ẑ，结果用的是原来的**底面** | L-M6-02 调用 `standardize_slab`（M2 §3.14 第 3 步的左手重标号） |
| R-F23 | `SURFACE_DEFAULTS` 重名（M1 与 M2 都加 `conventional_length_tolerance`/`conventional_angle_tolerance`）、宽泛键名（M2 `layers`、`position`、`offset`）、前缀错位（M4 的 `site_contact_tol` 用了 M5 的前缀）、两套确认阈值（M6 `interface_confirm_atoms` 50 000 vs F0 `LIMITS.confirmAtoms` 30 000） | L-X-08 |
| R-F24 | `repeat` 不重编号 `adsorbate_id`（L-F0-07 未列）、不调用 info 处理器；M1 E20 的"`make_supercell(diag, wrap=False)` 与 `repeat` 的名字与 info 相同"在带 `info.surface` 的结构上不成立 | L-M1-08 |
| R-F25 | M3 未导出 M5 需要的三个函数 | L-M3-02、L-M3-03、L-M3-04 |
| R-F26 | M5 改 `api/public.js` 的 `EVENTS` | 不加；L-M5-09 |
| R-F27 | M5 v2 §3.1 在"只含基底的视图"上调用 `surface_normal`；F0 账本 R16 已给分析函数加 `exclude` | M5 用 `surface_normal(s, frame=…, exclude=ads ∪ loose)`；视图只用于 M5 自己的几何（L-M5-02） |
| R-F28 | M2 v2 请求 `make_contiguous(..., return_shifts=True)` | F0 账本 R17 已给只读的 `contiguous_shifts`；M2 用它求 `imageShift` |
| R-F29 | M1 v2 请求把 `vacuum_axis` 加进 F0-D 的文件、请求 `_adopt` | F0 账本 R17：两者都由 F0-D 提供（`vacuum_axis` 在 `analysis/vacuum.py`，`_adopt(other, *, src=None)` 在 `core/structure.*`）；M1 不再实现 |
| R-F30 | 共用数据模块 `webdata`：M5 v2 说归 F0-D 第 0 波（任务 F0-D-W），M2 v2 说由 M2 T2 在第 1 波先交付，F0 账本未列 | **M2 T2**（第 1 波，代码按 M5 §4.2 原样）；M5 T1 只交付库文件与校验 |
| R-F31 | M5 的吸附物库：M5 v2 §4.2"打开面板时才加载、不阻塞启动"vs F0 账本 L-F0-56 把 M5 列为启动任务的消费方 | M5 注册 `registerBootTask('adsorbates', loadAdsorbateLibrary)`：ready 之后同步的 `adsorbateLibrary()` 不为 null，脚本与嵌入页行为确定；失败按 L-F0-56 的规则不阻止启动、分区显示原因与 Retry |
| R-F32 | M6 预览占位真空 10 Å（M6 v2 §5.4、`interface_preview_vacuum`）vs M2 v2 §5.4"任何临时真空值都等于预填（U4）"；F0 账本 L-F0-35 没有 `canApply`，预览条与 mod+Enter 会把占位值提交 | 按 M2 的规则：真空为空时 M6 不开预览会话（M6 v2 R12 的退路"只显示晶胞轮廓与摘要"） |
| R-F33 | `surface_label(info)`（M6 v2 §4.4、§10.4）vs `surface_label(structure)`（M2 v2 §6.1） | 接受两者：`surface_label(x)`，x 为 Structure 或一个 `info.surface` 字典（L-M2-07） |
| R-F34 | 记录字段 `firstAtom`：M5 v2 删除，M6 v2 §4.1 仍按 `firstAtom + q·N` 改写 | 没有 `firstAtom`；M6 只改写 `id` |
| R-F35 | M6 读 `info.surface.polarity.tasker`（M6 v2 §4.2 W12） | M2 字段为 `info.surface.tasker`（晶面的 Tasker 类型）；`asBuilt.polarity` 是创建时的极性 |
| R-F36 | JS 公共 `crystallume.build.supercell(s, P)`（M1 v2 §6.2）与 Python 现有 `build.supercell(s, nx, ny, nz)`（= `repeat`）同名不同义 | JS 公共名改为 `crystallume.build.makeSupercell(s, P, {wrap})`，与 Python `build.make_supercell` 同词 |
| R-F37 | `rename_after_supercell`（F0 账本 L-F0-12 消费方说明、M2 v2 §3.13、M5 v2 §10）vs M1 v2 的 `rename_after_cell_change` | 只有 `rename_after_cell_change`（L-M1-15）；`supercell_label`、`wood_label`、`matrix_label`、`mesh_label` 在 `core/lattice.*`，不在 `core/naming` |
| R-F38 | M2 命令参数 `wood`（字符串）与 JS `buildSurface({wood})`；Python `surface()` 没有 `wood`；M1 命令/REST 的同一概念叫 `spec` | 文本形式一律叫 `spec`（命令参数、REST 的 `supercell` 字段接受文本）；JS `buildSurface` 删除 `wood`，`supercell` 接受矩阵、对角简写或文本（与 Python 相同） |


### 1.13 R-F39 负责人决定（`lead-decisions.md`，L-01 … L-19）的落实

负责人决定优先于本账本（文首）。下表逐条写出它在本账本里落在哪里；"一致"表示本账本原来的裁决与之相同，只补了引用。表中读数里的数字（如 `bond 1.94 Å`）只是示例，测试一律按 M5 §3.10 的式子现算（负责人决定 L-15）。

| 负责人决定 | 缺口 | 本账本的落实 | 条目 |
|---|---|---|---|
| L-01 POSCAR 的 `-0.0`、末位噪声、速度块 | G-11 | 不涉及功能模块的接口；功能模块的金标比较 POSCAR 时用 S14 的规范形 | — |
| L-02 二维原型的 `build.crystal(..., vacuum=)` 是每侧 | G-12 | 保持原义、帮助文案、`DeprecationWarning`、Build 面板 `Cell height c (Å)`（F0-D T10） | §0.3、§1.5 |
| L-03 TiO2 空位 slab 的位点随原点变化 | G-15 | M5 内部算法（键图近邻判据、规范原点），接口不变；`test_sites_invariance` 加 (0, ½)、(¼, ½)、(½, ½) 平移与空位用例 | L-M5-02 |
| L-04 F0-A US3 的 `Keep` | G-17 | 不涉及 | — |
| L-05 两条"放在表面上方"的路径同一键长 | G-18 | **[新]** M5 `adsorbate_target_distance`；M4 的缺省键长对库里的元素调用它，读数注明来源 | §1.10、L-M4-05、L-M5-05 |
| L-06 端到端测试 | G-19 | 各模块 §5 控件表的 `aria-label` 是 e2e 选择器的唯一来源，改名同时改 e2e（§10 共同条款） | §10 |
| L-07 界面配位 | G-21 | `info.surface.interface.registry = {preset, sites}`；**[新]** M5 `nearest_sites`；状态行为必须 | L-X-03、L-M5-03、L-M6-03、L-M6-06 |
| L-08 表面网格倍数提示 | G-24 | `Using the input cell: the surface cell has N times the area of the smallest one, <Wood>.` | L-M2-08 |
| L-09 多元素位点摘要 | G-25 | `4 site atoms (Ti2O2)` | §1.6、L-M5-09 |
| L-10 CLI 删除原子 | G-28 | **[新]** `crystallume edit delete IN --atoms SPEC … -o OUT` | L-M4-08 |
| L-11 体相名两种语言不同 | G-30 | 跨语言比较排除 `info.surface.bulk.name` | L-X-01 |
| L-12 自动名哨兵 | G-32 | 只有 `autoName`，**删去**本账本早先的 `baseName`；`auto_name_state` + `refresh_auto_name(s, before, …)` | R-F15、L-X-01、L-X-07、L-M2-07 |
| L-13 已有结构 `set_vacuum(0)` | G-33 | 一致（E12d） | §1.5、L-M2-03 |
| L-14 局部法向的措辞 | G-34 | M5 内部，以 M5 §3.5 为准；接口不变 | — |
| L-15 吸附高度的数值 | G-35 | 测试现算；本账本的数字只作示例 | 本表说明 |
| L-16 表面超胞的入口 | G-36 | **嵌入**同一组件 `supercellEditor`，删去本账本早先的深链与 `tab: 'surface'` | R-F04、L-M1-16、L-M2-08 |
| L-17 M6 改写 `firstAtom` | G-37 | 一致（没有 `firstAtom`）；不复制自动名哨兵 | L-X-04、L-M6-03 |
| L-18 `count` 的语义 | G-38 | 本次新增 N 个，选位同 M5 §3.12.2，与 `coverage` 互斥（E24） | L-M5-05、L-M5-10 |
| L-19 预设得到的名字 | G-39 | 一致（名字只由矩阵算出）；toast `Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms` | R-F04、L-X-07、L-M1-16 |

---

## 2. 数据契约与跨模块规则（L-X-01 … L-X-08）

### L-X-01 `info.surface`：完整字段表与维护规则

- **提供方**：M2 T4（切面写入）、M2 T5（改真空工具写入/更新）；追加：M1 T10（`surface` 几何处理器）、M5 T6（`adsorbates`、`kind: "adsorbates"`）、M6 T4/T5（`kind: "interface"`、`interface`）。**文件**：`build/surface.*`、`core/structure.*`（M2 方法）、`core/infohandlers.*`、`build/adsorbate(s).*`、`build/interface.*`。
- **格式**：JSON 对象，键 camelCase，只含 JSON 值（无 NaN）；生成器写入的浮点数取 `round_half_up(x, 6)`（L-M1-15）；extxyz 经 `_JSON` 往返（L-F0-24），JSON 原样保存，POSCAR/CIF/PDB 丢失且不报警告（F0 K9）。**读取方必须容忍任何字段缺失**（例如只有 `adsorbates` 的块）；**写入方必须保留不认识的键**。
- **`kind`**（**[改]**：M2 v2 只有前两种）：

  | 值 | 谁创建 | 含义 | 块里至少有 |
  |---|---|---|---|
  | `"cleave"` | M2 `surface`/`oriented_cell`/`surfaces` | 切面来源 | 下表全部"切面"键 |
  | `"vacuum"` | M2 `set_vacuum`/`add_vacuum`/`center_slab` 在没有 `info.surface` 的结构上 | 改真空的来源记录（**不是 slab 标记**，U1） | `version, kind, axis, normal, thickness, vacuum, position, offset, stacking, autoName` |
  | `"interface"` | M6 `make_interface`（含 `return_parts`） | 界面来源 | `version, kind, autoName, axis, normal, thickness, vacuum, position, interface, adsorbates` |
  | `"adsorbates"` | M5 第一次放置吸附物、M4 第一次复制吸附物记录，都在没有 `info.surface` 的结构上 | 只为存放吸附物记录与自动名 | `version, kind, autoName, adsorbates` |

  `kind` 一经写入不再改变；缺失或未知的 `kind` 按 `"adsorbates"` 读（名字按 L-X-07 的"其他 kind"规则）。只有 `kind == "cleave"` 触发切面专用逻辑（`surface_label`、`flip_slab` 的指数取反、`reference_mesh` 的来源 1），只有 `kind == "interface"` 触发界面专用逻辑。
- **字段表**（"维护"列：之后谁改它；没写的 = 创建后不再改，是创建时的来源信息）：

  | 键 | 类型 | kind | 维护 | 说明 |
  |---|---|---|---|---|
  | `version` | int | 全部 | — | 本块格式版本 = **2**（M6 v2 示例里的 `1` 改为 2）；v1 块（`version` 为 1 或缺失）按下文"v1 兼容"读取 |
  | `kind` | str | 全部 | — | 见上 |
  | `autoName` | str \| null | 全部 | `refresh_auto_name`（L-X-07）：M1 晶胞操作、M2 `flip_slab`、M5 放置/删除、M6 构建 | 自动名的唯一哨兵（**[改]**：不是 `name`；负责人决定 L-12）；建块时写建块前的 `structure.name`；`structure.name ≠ autoName` 时在下一次刷新置 null，此后不再自动改名。**没有** `baseName` 键 |
  | `axis` | int | cleave、vacuum、interface | M1 `surface` 处理器、M2 改真空工具 | 真空轴；F0 `surface_normal` 只把它当作经过校验的提示（L-F0-17） |
  | `normal` | float[3] | 同上 | M1 处理器（旋转时 `R @ normal`；基变换后按新晶胞重算或删除）、M4（`rotate_cell=True` 时旋转，只转原子时删除） | **说明性**；任何计算都不读它 |
  | `thickness` | float Å | 同上 | M2 改真空工具 | 顶层与底层原子中心沿法向的距离；其他编辑后可能过期，实时值用 `slab_extent()` |
  | `vacuum` | float Å | 同上 | M2 改真空工具 | 总间隙（U4）；实时值用 `slab_extent()["gap"]` |
  | `stacking` | `"vacuum"` \| `"bulk"` | cleave、vacuum | M2 改真空工具（写 `"vacuum"`） | `"bulk"` = V = 0 的体相堆垛（L-M2-02） |
  | `position` / `offset` | str / float | cleave、vacuum、interface | M2 改真空工具 | `"center"` \| `"bottom"` \| `"keep"`；贴底时底层离晶胞底面的距离 |
  | `adsorbates` | list | 任意 | L-X-04 | 吸附物记录 |
  | `generator` | str | cleave、interface | — | 如 `"crystallume 0.4.0"`（跨语言比较时两边取自同一版本源） |
  | `interface` | object | interface | —（来源记录） | L-X-03 |
  | `bulk` | object | cleave | — | `{name, formula, reducedFormula, natoms, cell, spacegroup, source}`；网页另写 `entryId`（跨语言比较时排除）；`name` 两种语言暂不相同（Python `Pt fcc`、JS `Pt (Face-centred cubic)`），M7 统一之前跨语言比较也排除 `bulk.name`（负责人决定 L-11） |
  | `miller` | int[3] | cleave | M2 `flip_slab`（取反） | 约化后，相对输入体相晶胞 |
  | `millerInput` | int[3 或 4] | cleave | M2 `flip_slab`（取反） | 用户原样输入（与 `miller` 不同时才写） |
  | `millerBasis` | `"input"` \| `"conventional"` | cleave | — | |
  | `millerConventional` | int[3] | cleave | M2 `flip_slab`（取反） | 识别出惯用胞时（名字优先用它） |
  | `conventional` | `{kind, toConventional}` | cleave | — | `conventional_cell_hint` 的结果（L-M2-01） |
  | `hkil` | int[4] | cleave | M2 `flip_slab`（取反） | 体相（或其惯用胞）为 120° 六方时 |
  | `primitive` / `translationTolerance` / `millerPrimitive` | bool / float / int[3] | cleave | — | 原胞步骤 |
  | `orientation` | float[3][3] | cleave | — | 1×1 表面胞的 a、b 与 c₀，以输入胞分数坐标表示 |
  | `directions` | `{a, b, aUvtw?, bUvtw?}` | cleave | M2 `flip_slab`（重算） | 1×1 网格 a、b 的晶向 |
  | `bulkNormal` | float[3] | cleave | M2 `flip_slab`（取反） | 体相坐标系里顶面的外法向 |
  | `period` / `layersPerPeriod` | float / int | cleave | — | 法向重复周期 d（Å）与每周期层数 m |
  | `layerTolerance` | float | cleave | — | τ_eff；M3 `find_layers` 的缺省容差（L-M3-01） |
  | `layerGrouping` | `"planes"` \| `"merged"` \| `"user"` | cleave | — | |
  | `meshParams` | `{a, b, gamma, area, type}` | cleave | — | 创建时的 1×1 表面胞；当前的 1×1 网格一律用 `reference_mesh`（L-M1-07） |
  | `termination` | object | cleave | M2 `flip_slab`（交换 top/bottom） | M2 §4.2 的结构（`index, count, label, cut, top, bottom, topComposition, bottomComposition, brokenBonds, polar, exposedLayers, coordination`） |
  | `tasker` | 1 \| 2 \| 3 \| null | cleave | — | **晶面**的 Tasker 类型（M6 W12 读它，**[改]**：不是 `polarity.tasker`） |
  | `layers` | int | cleave | — | 创建时的原子层数 L（名字里的 `4L`） |
  | `thicknessSpec` | `{mode, value}` | cleave | — | |
  | `symmetric` / `symmetryCheck` | bool / str | cleave | — | |
  | `flipped` | bool | cleave | M2 `flip_slab` | 翻转次数的奇偶 |
  | `asBuilt` | object | cleave | **从不更新** | `{composition, stoichiometric, excess, polarity: {polar, dipole, dipoleDensity, netCharge, charges, chargesSource}, supercell, fixed: {layers, from, axes}}`；实时值用 `slab_report()` |

- **v1 兼容**（只在读取时，不在导入时改写数据，U1）：`name` 视为 `autoName`；M5 v1 的 `baseName` 读取时忽略，第一次写这个块时删除（负责人决定 L-12；M5 v1 的 `autoName` 与 v2 的哨兵同义，保留）；`supercell`、`wood`、`composition`、`stoichiometric`、`excess`、`polarity`、`fixedLayers`、`fixedAxes` 视为 `asBuilt` 下的同名项；M6 原型的 `bulkFormula` 视为 `bulk.reducedFormula`。M2/M5/M6 第一次写这个块时把它改写为 v2。读取兼容由 M2 的 `normalize_surface_info(surface: dict) -> dict`（**[新]**，纯函数，返回新字典，`core/naming.*`，M2 T4/T6b）统一完成，其他模块读取前调用它。
- **之后的编辑**：见 L-X-06 总表。
- **消费方**：F0-D `surface_normal`（只读 `axis`）；M1 `reference_mesh`（`kind`）、`surface` 处理器；M3（`layerTolerance`、`bulk.reducedFormula`、`period`、`layersPerPeriod`；不读 `normal`/`axis`，M3 EM6）；M5（`adsorbates`、`termination` 的显示、命名）；M6（`kind`、`bulk.reducedFormula`、`miller`、`hkil`、`millerConventional`、`tasker`、`interface`）；M2 自己的 `surface_name`、`slab_report`、`flip_slab`。
- **已解决的冲突**：R-F15（`name` → `autoName`）、R-F16（`interface` 位置）、R-F35（`tasker`）；M2 v2 §10.5"M6 结果不写顶层 `info.surface`"作废（M6 v2 已写）；M5 v2 §4.4"首次放置创建 `{"adsorbates": []}`" → 带 `version`、`kind: "adsorbates"`、`autoName` 的块；M2 v2 的 `baseName`（M5 写）删除（负责人决定 L-12）。

### L-X-02 `info.supercellMatrix` 与旧键 `info.supercell`

- **提供方**：F0-D T1/T2（`repeat`，L-F0-07）、M1 T3a（`update_supercell_matrix`，M1 §3.5.5）、M2 T4（切面写入）与 T5（轴置换、翻转）。M6 不写（见下）。
- **语义**：整数 3×3 矩阵 M（行 = 当前晶胞矢量在**母胞**基下的坐标），`当前晶胞 = M @ 母胞`（C1）。母胞：
  - `info.surface.kind == "cleave"`：切面得到的 1×1 slab；
  - `info.surface.kind == "interface"`：`info.surface.interface.cell`（M6 构建时的晶胞）；
  - 其他：第一次做超胞类操作之前的晶胞。
  晶胞参数、应变、改真空、重定向这些连续形变之后关系照样成立（母胞同样被形变），键不变。
- **写入与更新**：
  - M2 切面：表面超胞 S ≠ I 时写 `[[s11, s12, 0], [s21, s22, 0], [0, 0, 1]]`（相对 1×1 slab）；S = I 时不写。
  - M1：超胞、重定义、右手化、约化、惯用胞 `M ← P @ prev`；原胞 `M ← T @ prev`，结果为整数时写入、否则删除；`prev = info.supercellMatrix ?? diag(info.supercell) ?? I`（D17）。
  - 轴置换（M1 `reorient` 的轮换、M2 `set_vacuum` 第 2 步）：行与列按同一置换（L-M1-11 的 `permute_cell_axes`）；M2 `set_vacuum` 第 3 步左手重标号（交换 a、b）同样交换行与列。
  - M2 `flip_slab`：面内块 `S_new = M2·D·S_old·D·M1x⁻¹`（M2 §3.15）。
  - `set_cell(scale_atoms=False)` 到一个与旧晶胞不是整数关系的晶胞：删除。
  - 结果为单位阵：删除 `supercellMatrix` 与 `supercell`；幺模但不是单位阵：保留。
  - M6：结果**不写**（= I，相对 `interface.cell`）；之后 M1 的超胞照常左乘。
- **`info.supercell`**（旧键 `[nx, ny, nz]`）：M 为对角时写 `diag(M)`，否则删除（E20）；`supercellMatrix` 缺失时作 `prev` 的初值。
- **消费方**：L-M1-07 `reference_mesh`（唯一的"1×1 网格"来源）、M1 命名、M2 `surface_name` 的网格段、M6 逐次叠层（当前胞相对 `interface.cell` 的关系）。
- **已解决的冲突**：M2 v2 §4.2、§10.5 与 M6 v2 §3.2.2 的"1×1 网格 = `inv(info.supercellMatrix[:2,:2]) @ [a; b]`"、M6 v2 的"没有时用 `info.surface.supercell`" → 一律调用 `reference_mesh`（它检查 `kind` 与面内形式；`asBuilt.supercell` 只是创建时的值，不作来源）；M1 v2 §3.6.4"有面内形式的 `supercellMatrix` 就用"→ 只在 `kind ∈ {cleave, interface}` 时信任（R-F17：体相母胞的面内网格不是 1×1 表面网格，M5 v2 §3.14.2）；M2 v1 的"`set_vacuum` 轴置换时删除"→ 置换行列（M1 规则）。

### L-X-03 `info.surface.interface`（任务清单所说的 `info.interface`）

- **提供方**：M6 T4/T5。**文件**：`build/interface.py`、`web/js/build/interface.js`。**没有**顶层 `info.interface` 键（R-F16）。
- **所在的块**：`info.surface = {version: 2, kind: "interface", autoName, axis: 2, normal: [0, 0, 1], thickness, vacuum, position: "center", interface: {…}, adsorbates: [...]}`（M2 的 slab 几何键不写在顶层）。
- **字段**（M6 v2 §4.2，浮点数 `round_half_up(x, 6)`，全部为 JSON 数）：

  | 键 | 类型 | 说明 |
  |---|---|---|
  | `version` | int | 2 |
  | `label` | str | `"{L_o}/{L_s}"`，如 `"MoS2/Au(111)"`（L-M6-04） |
  | `cell` | float[3][3] | 构建时的晶胞（`info.supercellMatrix` 的母胞） |
  | `layers` | object[] | 自下而上；逐次叠层时追加 |
  | `layers[k].index` / `role` | int / `"substrate"` \| `"overlayer"` | 1 起 |
  | `layers[k].name` / `label` / `reducedFormula` | str | 输入结构名、层标签、约化式 |
  | `layers[k].atoms` / `inputAtoms` / `primitive` | int / int / bool | 本层在结果中的原子数、输入胞原子数、是否约化 |
  | `layers[k].inputMatrix` | int[2][2] | 输入胞面内基 = inputMatrix @ 匹配网格基 |
  | `layers[k].matchMesh` / `refMesh` / `refMatrix` | float[2][2] / float[2][2] / int[2][2] | 匹配网格、参考（1×1）网格（L-M1-07）、匹配网格 = refMatrix @ 参考网格 |
  | `layers[k].matrix` / `matrixRef` / `index2d` / `wood` | int[2][2] / int[2][2] / int / str | 超格矩阵（相对匹配网格 / 参考网格）、指数、`mesh_label(matrixRef, refMesh)`（L-M1-05，单位阵 `p(1×1)`） |
  | `layers[k].flipped` / `rotation` / `twist` | bool / float ° / float °（仅覆盖层） | |
  | `layers[k].strain` | `{tensor, principal, angle, areal, greenLagrange, maxShear}` | 所选分配下本层的实际应变 |
  | `layers[k].zRange` / `polar` | float[2] / bool | `polar` = 该层 `surface.tasker == 3` |
  | `layers[k].surface` | object \| null | 该层输入的 `info.surface` 深拷贝（去掉 `adsorbates` 与 `autoName`，经 `normalize_surface_info`；不复制自动名哨兵，负责人决定 L-17） |
  | `layers[k].match` | object | 只在非底层：`{engine, key, rank, atoms, area, mismatch, variant, variants, distinctVariants, pareto, meshes, search}` |
  | `strainTo` / `strainWeight` / `effectiveWeight` | str / float / float | |
  | `distance` / `distanceMethod` / `distanceSetBy` | float Å / `"vdw"` \| `"covalent"` \| `"bulk"` \| `"value"` / `{symbols, lateral}` | 层间距 |
  | `shift` / `anchor` | float[2] / int[2] | 错位（基底参考网格分数）、两层**输入结构**中的锚原子下标 |
  | `registry` | object | **[改]**（负责人决定 L-07；M6 v2 是预设名字符串）`{preset, sites}`：`preset` = 所选预设名（`"top"`、`"bridge"`、`"short bridge"`、`"long bridge"`、`"fcc hollow"`、`"hcp hollow"`、`"hollow"`）或 null（手填错位、`shift_cart`）；`sites` = 覆盖层**最下层**每个原子一项 `{atom, element, site, label, lateral}`，按结果下标升序：`atom` 结果中的下标；`site` ∈ `"top"`、`"bridge"`、`"fcc"`、`"hcp"`、`"hollow"`、null（离最近的位点超过 `site_moved_threshold`）；`label` 为 M5 的类标签（如 `"fcc (Ni3)"`）；`lateral` 为到该位点的面内距离（Å）。算法见 L-M6-03 |
  | `vacuum` | float Å | 构建时的总间隙（之后的改真空只更新顶层 `info.surface.vacuum`） |
  | `closestContact` / `periodicContact` | `{distance, symbols}` | 最近接触、跨晶胞边界的最近接触 |
  | `part` | `"substrate"` \| `"overlayer"` | 只在 `return_parts` 的两个分离结构上 |

- **维护**：来源记录，创建后**从不改写**；当前胞与 `interface.cell` 的关系由 `info.supercellMatrix` 给出；名字由 L-X-07 重算。逐次叠层（M6-S3）把下面的 `layers` 继承下来并追加新层；若新的一层把应变施加到基底，下面各层的 `strain` 按复合形变更新（M6 §4.2）。
- **消费方**：M6 自己（逐次叠层、命名、参考网格）；M1 `reference_mesh`（来源 2）；M2 改真空工具（只更新顶层 `vacuum`、`thickness`、`position`、`offset`，保留 `interface`）；M5（`adsorbates`）。
- **已解决的冲突**：R-F16；M1 v2 K16"M6 注册 `interface` 处理器"→ 不注册（记录不随编辑改写）；R-F34（`firstAtom`）；M6 v2 示例的顶层 `"name"` → `autoName`，`"version": 1` → 2；`wood` 字段与匹配表里的 `"(1×1)"` → `mesh_label` 的 `"p(1×1)"`（R-F20）。

### L-X-04 吸附物记录 `info.surface.adsorbates[]`

- **提供方**：M5 T6（写入、删除、回收孤儿）；改写者：M5 T6 在 `core/infohandlers.*` 注册的 `surface.adsorbates` 处理器（M1 的超胞、原胞时调用）、M4（粘贴/插入完整的源吸附物时复制）、M6（合并两层时改写 id 后合并）。
- **字段**（M5 v2 §4.4）：

  | 字段 | 类型 | 维护 | 说明 |
  |---|---|---|---|
  | `id` | int | **随 `adsorbate_id` 一起改写**（唯一被维护的字段） | 等于这组原子的 `adsorbate_id` |
  | `adsorbate` / `name` / `formula` / `mode` / `custom` | str \| null / str / str / str \| null / bool | 来源 | 库 id；显示名；化学式（名字后缀用）；模式；自定义为 true |
  | `definition` | object \| null | 来源 | `custom` 为真时必填：`{symbols, positions（局部框架）, binding, kind, reference}`，≤ 200 原子 |
  | `binding` | int[] | 来源 | 吸附物内部的结合原子下标 |
  | `side` | `"top"` \| `"bottom"` | 来源 | 放置时的面；实时的所在面由 M5 按几何判定（M5 §3.8），翻转、轴置换后不改写 |
  | `site` | object \| null | 来源（超胞复制时见下） | `{label, class, kind, fold, subtype, point, frac, normal, ensemble, axis}`；按坐标放置为 `{point, frac, axis}`；M4 复制来的为 null |
  | `heightMode` / `height` / `bondFactor` / `bondLength` / `rotation` / `tilt` | | 来源 | |
  | `bonds` | `[[吸附物内下标, 对方元素, 距离], …]` | 来源 | 不存全局下标 |
  | `warnings` / `mirrorOf` / `tagsConvention` / `version` | | 来源 | |

  **没有** `firstAtom`（M5 v2 已删；M4、M6 也不得写或改写它）。
- **规则**：
  - 记录除 `id` 外都是放置时的来源信息，**任何后续编辑都不改写**；实时的位点归属、所在面、键长由 M5 `assign_sites`（L-M5-03）给出。
  - **M1 超胞**（`surface.adsorbates` 处理器，`ctx.kind == "supercell"`）：对像 q = 0…|det P|−1（q = 0 是原来的那一份），每条记录复制一份，`id ← id + q·V`（V = 操作前的最大 `adsorbate_id`，与 L-X-05 的重编号同一规则），`site.point ← site.point + n_q @ 旧晶胞`（n_q 为第 q 个格点，`supercell_lattice_points(P)` 的顺序），`site.frac` 按新晶胞重算并包裹到 [0, 1)，q ≥ 1 的副本 `site.ensemble ← null`；其余字段原样。
  - **M1 原胞**（`ctx.kind == "primitive"`）：按 `ctx.id_map`（**[新]** 上下文字段：旧 id → 新 id，L-M1-14）改写；不在 `id_map` 中的记录删除。
  - **M4 粘贴/插入**：只为**完整的**源吸附物复制记录（`id` 改为新 id，`site = null`，`bonds = []`）；目标没有 `info.surface` 时建 `kind: "adsorbates"` 的块（L-X-01）。
  - **M6 合并**：两层各自经 M1 超胞（处理器已按像复制），覆盖层的记录再 `id ← id + next_adsorbate_id(基底超胞) − 1`，与基底的合并为结果的 `adsorbates`。
  - **删除原子**（F0 Delete）：记录保留；全部原子都没了的记录（孤儿）在下一次 M5 编辑时删除；只删了一部分时 M5 列表注明 `(edited)`，名字后缀按实际原子。
  - **没有记录的吸附物组**（M3 标记、M3 promote、M4 不带源记录的表面放置）是合法的：M5 列表与名字后缀把它们显示为 `<display_formula> #<id>`（如 `CO #3`）。
- **消费方**：M5（列表、覆盖度、两面放置、批量生成、命名）；M2 `surface_name`（后缀，经 `adsorbate_suffix`）；M4、M6（改写）。
- **已解决的冲突**：R-F21（M5 的 `mark_adsorbate` 带记录 → 删除）；R-F34；M5 v2 §4.3 对 M1 的请求（复制记录、平移 `point`、重算 `frac`）→ 由 M5 自己注册的处理器完成，M1 只负责调用（M1 不了解记录的字段，K16）。

### L-X-05 逐原子属性 `tags`、`adsorbate_id`、`interface_layer` 与吸附物规则 R-ADS

- **提供方**：F0-D（存储、默认值、`next_adsorbate_id`、`extend`/`concat_structures` 的重编号，L-F0-02、L-F0-14）；规则 R-ADS 由本账本规定，M3 T3a、M4 T（粘贴/插入/加原子）、M5 T6、M6 T4/T5 实现。
- **`props.tags`**（int，C4）：1 = 写入时 slab 的顶层，2 = 次层……，0 = 吸附物或未标记。**只有下列操作写 tags**：M2 切面（= 构建层号，从顶层数）；M3 `set_tags_from_layers`（显式重算，吸附物为 0）；R-ADS 的新原子（0，或 2）；M6 覆盖层（0，`keep_overlayer_tags=True` 时保留）；M2 `flip_slab`（`t > 0 → max_tag + 1 − t`）。其他操作复制或保留，**从不自动重算**（实时层号用 M3 `find_layers`）。OC20 约定（0 次表层、1 表面、2 吸附物）由 M3 `tags_convention`（L-M3-04）识别。
- **`props.adsorbate_id`**（int）：0 = 不是吸附物，k ≥ 1 = 第 k 个吸附物组；同一结构内每组一个 id，允许有空号（删除不重编号）。重编号只发生在：M1 超胞（像 q 上 `v → v + q·V`，V = 操作前的最大值）、M1 原胞（代表保留原值后按首次出现紧凑编号 1…n，旧 → 新写进处理器的 `ctx.id_map`）、F0-D `extend`/`concat_structures`（后来者的非零值加 `next_adsorbate_id(前者) − 1`）、M4 非表面放置的粘贴（完整的源吸附物 `g → g + max(目标)`，不完整的 → 0）。M2 切面删除这个键。
- **`props.interface_layer`**（int，M6）：叠层中自下而上 1…n；之后新增的原子为 0（`PROP_DEFAULTS`，M6 T0 同时改两份源码表）；M1 的操作照常复制；M3 不使用。
- **R-ADS**（凡是把原子作为吸附物加到表面上的编辑：M3 标记、M4 表面放置的加原子/粘贴/插入、M5 放置、M6 合并）：
  1. 结构里还没有 `adsorbate_id > 0` 而本次要写入或合并进非零 id 时，先对该结构（M6：对每个还没有 id 的层副本）调用 M3 `promote_adsorbates`（把已识别的吸附物按成键片段编号），否则已有的吸附物会被当成基底。
  2. 新 id 从 `next_adsorbate_id(s)` 起递增：M5 每个放置一个（两面放置的镜像另给）；M4 每个插入载荷中的成键片段一个；M3 每个被标记的成键组一个。
  3. 新原子：`selective_dynamics = [T, T, T]`、`tags`、`occupancy` 只在键已存在时写（由 `PROP_DEFAULTS` 补）；`tags` = 2 若 `tags_convention(s) == "oc20"`，否则 0（**[改] M4**：原为恒 0）；其他 props 取 `PROP_DEFAULTS`。
  4. 插入顺序：编辑前结构是按元素分块的（`poscar_order(symbols, None, props.poscar_species)` 为恒等）→ 插入后在同一编辑步内稳定地 `sort_by_species()`（新原子落到同元素块末尾，新元素排在最后）；否则追加在末尾（**[改] M4**：原为一律追加）。源映射由追踪器给出（网页 `editActive` 不传 `indexMap`）。
  5. 插入调用 `mark_edited(s, "atoms")`；只标记（M3）不调用。
  6. 记录：M5 放置追加记录（L-X-04）；M4 只为完整的源吸附物复制记录；M3 不写记录。
  7. 网页：`editActive(label, fn, { singleFrame: true })`。
- **消费方**：M3（`find_adsorbates` 的第一来源是 `adsorbate_id`）、M4（基底掩码、`moving_group`）、M5（位点、覆盖度、列表、命名）、M6（锚原子跳过 `adsorbate_id > 0`）、F0-A（吸附物按组包裹）。
- **已解决的冲突**：R-F10、R-F11；M4 v2 K6 的"tags 0、追加在末尾"→ 第 3、4 条；M6 v2 §4.1 用 `concat_structures(renumber_adsorbates=True)` 与本条一致，另加第 1 条。

### L-X-06 后续操作对数据的影响（总表）

"处理器" = M1 的 info 处理器（L-M1-14）；"刷新" = `refresh_auto_name`（L-X-07）。

| 操作（提供方） | `tags` | `adsorbate_id` | `info.surface` | 吸附物记录 | `info.supercellMatrix` | 名字 |
|---|---|---|---|---|---|---|
| 切面 `surface`/`oriented_cell`/`surfaces`（M2） | 构建层号 1…L | 删除键 | 新建 `kind: "cleave"` | 无 | S ≠ I 时 embed(S) | `surface_name`；`autoName = name`（给了 `name=` 时 null） |
| `set_vacuum`/`add_vacuum`/`center_slab`（M2） | 不变 | 不变 | 更新 `vacuum, thickness, position, offset, stacking`；轴置换后 `axis = 2`；没有块时新建 `kind: "vacuum"`（`autoName = name`） | 不变 | 轴置换：行列同置换；左手重标号：交换 a、b 的行列 | 不变 |
| `flip_slab`（M2） | `t → max + 1 − t` | 不变 | 指数取反、`directions` 重算、`termination` 交换、`flipped` 取反、`axis = 2`、`normal = [0,0,1]` | 不变 | `S_new` | 刷新 |
| `standardize_slab`（M2，返回副本） | 不变 | 不变 | 不写新字段（保留输入的块） | 不变 | 同 `set_vacuum` | 不变 |
| `make_supercell`（M1；含 Surface supercell、`cell.bakeRepeat`、`/build/supercell` 单帧） | 逐像复制 | 像 q：`v + q·V` | 处理器（几何：`axis`、`normal`） | 逐像复制（L-X-04） | `P @ prev` | 刷新（`cell_change`）；刷新返回 False 时 `rename_after_cell_change` |
| `repeat`（F0-D，旧接口） | 逐像复制 | **不重编号** | 不调用处理器 | 不复制 | `diag @ prev` | `add_repeat_suffix` |
| 重定义、右手化、约化、惯用胞（M1） | 不变 | 不变 | 处理器（basis） | 不变 | `C @ prev` | 同超胞 |
| 原胞（M1） | 代表的值 | 紧凑重编号（`id_map`） | 处理器（primitive） | 按 `id_map` 改写、删除 | `T @ prev`（整数时），否则删除 | 同超胞 |
| `set_cell`、晶胞参数、应变、`deform`（M1） | 不变 | 不变 | 处理器（deform：`axis`/`normal`） | 不变 | 不变；`set_cell` 到非整数关系的晶胞时删除 | 不变 |
| `reorient`（M1） | 不变 | 不变 | 处理器（rotation：`normal ← R normal`；轮换时 `axis = 2`） | 不变 | 轮换时行列置换 | 不变 |
| `shift_origin`、`wrap_into_cell`（M1） | 不变 | 不变 | 不调用 | 不变 | 不变 | 不变 |
| `fix`/`free`/`fix_layers`/`fix_height`（M3） | 不变 | 不变 | 不变 | 不变 | 不变 | 不变 |
| `mark_adsorbates`/`promote_adsorbates`/`unmark_adsorbates`（M3） | 不变 | 写 / 置 0 | 不变 | 不写、不删（孤儿由 M5 回收） | 不变 | 不变 |
| `set_tags_from_layers`（M3） | 重算（顶层 1 起，吸附物 0） | 不变 | 不变 | 不变 | 不变 | 不变 |
| 移动、旋转、设定几何（M4） | 不变 | 不变 | `normal`：见 L-X-01 | 不变 | 不变 | 不变 |
| 表面放置的加原子/粘贴/插入（M4） | R-ADS | R-ADS | 没有块且要复制记录时新建 `kind: "adsorbates"`（`autoName = name`） | 只复制完整的源吸附物的 | 不变 | 不变 |
| 非表面放置的粘贴/插入/`extend`（M4、F0-D） | 原值 | 完整源吸附物 `g → g + max` / 不完整 → 0 | 不变 | 复制完整的 | 不变 | 不变 |
| 删除原子（F0-A Delete、F0-D `delete`） | — | 其余不变 | 不变 | 不变（孤儿） | 不变 | 不变 |
| 放置/删除吸附物（M5） | R-ADS | R-ADS | 没有块时新建 `kind: "adsorbates"`（`autoName = 原名`） | 追加/删除，回收孤儿 | 不变 | 刷新 |
| 每类一个结构、替位、空位（M5，新结构） | 同放置 / 不变 | 同放置 / 不变 | 复制 slab 的块 | 复制 + 新记录 | 复制 | `<slab 名> + CO@fcc (Pt3)` 等，`autoName = null` |
| `make_interface`（M6，新结构） | 基底原值、覆盖层 0 | 每层超胞重编号 + 覆盖层偏移（R-ADS 第 1 条） | 新建 `kind: "interface"`（L-X-03） | 两层合并（L-X-04） | 不写 | `surface_name`（`interface_name` + 后缀）；`autoName = name` |
| 读入（F0-D） | 文件有就保留 | 同左 | extxyz `_JSON`、JSON 保留；**导入时不做任何识别或改写**（U1） | 同 `info.surface` | 保留 | 文件名 |
| 导出（F0-D） | extxyz、JSON | extxyz、JSON | extxyz、JSON；POSCAR/CIF/PDB 丢失，不报警告 | 同左 | 同左 | POSCAR 注释行 |

### L-X-07 命名（C9）：机制与每个生成器的规则

- **提供方**：M2 T4/T6b（`surface_name`、`adsorbate_suffix`、`reduced_formula`、`surface_label`、`normalize_surface_info`、`is_auto_named`、`auto_name_state`、`refresh_auto_name`）、M1 T2（数字格式化、`rename_after_cell_change`、网格标签）、M6 T4/T5（`interface_name`）。**文件**：`core/naming.py`、`web/js/core/naming.js`（网格标签在 `core/lattice.*`）。
- **Python / JS**：
  ```python
  def surface_name(structure) -> str | None                  # kind cleave / interface：由数据算出；其他 kind、没有块 → None
  def adsorbate_suffix(structure) -> str                      # "" | "CO" | "2CO + O"
  def is_auto_named(structure) -> bool                        # info.surface 存在、autoName 非空且 == structure.name
  def auto_name_state(structure) -> dict                      # [新] {"name": str, "suffix": str, "auto": bool}；编辑之前调用
  def refresh_auto_name(structure, before: dict, *, cell_change: dict | None = None) -> bool
      # before = 编辑前的 auto_name_state(s)；cell_change = {"matrix": P (3×3 int), "cell": 旧晶胞, "previous": 旧的累计矩阵或 None}
  ```
  ```js
  surfaceName(s) → string | null ; adsorbateSuffix(s) → string ; isAutoNamed(s) → boolean
  autoNameState(s) → { name, suffix, auto } ; refreshAutoName(s, before, { cellChange = null }) → boolean
  ```
- **机制**（**[改]** 负责人决定 L-12：哨兵**只有** `info.surface.autoName`；没有 `baseName`；`refresh_auto_name` 的 `was_auto` 参数换成 `before`）：
  1. 调用方在编辑**之前**取 `before = auto_name_state(s)`：`name = s.name`，`suffix = adsorbate_suffix(s)`；`auto` 为真当且仅当没有 `info.surface`、块里没有 `autoName` 键（采用当前名，即 M5 v2 §4.5 的"不存在时视为编辑前的名字"），或 `autoName == s.name`；`autoName` 为 null 或与名字不同 → 假。
  2. `refresh_auto_name(s, before, *, cell_change=None)`：
     - 没有 `info.surface` → 返回 False（调用方照非自动名的规则处理，M1 用 `rename_after_cell_change`）；
     - `before["auto"]` 为假 → `autoName` 非空且 `≠ s.name` 时置 null；返回 False；
     - `kind ∈ {"cleave", "interface"}` → `name = surface_name(s)`，为 None 时返回 False；
     - 其他 kind → `base = before["name"]`；`before["suffix"]` 非空且 `base` 以 `" + " + before["suffix"]` 结尾 → 去掉这一段；给了 `cell_change` → `base ← rename_after_cell_change(base, P, cell=…, previous=…)`；`name = base`，当前 `adsorbate_suffix(s)` 非空时接 `" + " + 后缀`；
     - 然后 `s.name = info.surface.autoName = name`，返回 True。
  3. 建块的操作写 `autoName = 建块前的 s.name`：M2 改真空工具的 `kind: "vacuum"`、M4 复制记录与 M5 第一次放置的 `kind: "adsorbates"`。M2 `surface` 与 M6 `make_interface` 生成时直接写 `name = autoName = surface_name(s)`；给了 `name=` 时 `autoName = null`。
  4. 调用方：M1 的超胞、重定义、右手化、约化、原胞、惯用胞（**在 `apply_info_handlers` 之后**调用，名字才能看到改写过的记录与 id；返回 False 时照 M1 §3.5.4 用 `rename_after_cell_change(name, …)`）；M2 `flip_slab`；M5 放置、删除。M3、M4 的编辑不改名（它们之后的第一次上述操作会把名字补齐）；F0 的 Delete 不改名。
- **`surface_name(s)`**：
  ```text
  sf = normalize_surface_info(s.info.surface)；没有 → None
  base:
    kind == "cleave"   → " ".join(非空项 [ reduced_formula(bulk) + miller_token(idx), mesh_token, term_token, f"{layers}L" ])
        idx = millerConventional（惯用胞为六方时用其四指数）?? hkil（体相为 120° 六方时）?? miller
        miller_token = "(" + 连写 + ")"（全部 |x| ≤ 9，负号用 ASCII "-"，如 (1-10)、(10-10)）；否则空格分隔 "(1 1 12)"
        mesh_token = info.supercellMatrix 不存在或为 I → ""；面内形式 → mesh_label(S2, ref_a, ref_b)（S2 = 面内 2×2 块，ref = inv(S2) @ 当前 [a; b]）；
                     否则 matrix_label(3×3)
        term_token = 终止面类数 ≤ 1 → ""；top == bottom → f"{top}-term"；否则 f"{top}/{bottom}-term"
    kind == "interface" → interface_name(sf, info.supercellMatrix)            （L-M6-04）
    其他               → None（名字由 refresh_auto_name 从编辑前的名字推出，见机制第 2 条）
  base 为 None → None；suffix = adsorbate_suffix(s)；return suffix ? base + " + " + suffix : base
  ```
- **`adsorbate_suffix(s)`**：按 `adsorbate_id` 升序取各组（> 0）；组的式子 = 有同 id 的记录且记录 `formula` 的组成（解析"元素符号 + 可选计数"）与该组实际组成相同 ? 记录的 `formula` : `display_formula(组内符号)`；相同式子合并计数、按首次出现排序、计数 > 1 时前置阿拉伯数字，组之间用 `" + "`。没有组 → `""`。
- **数字**：名字里的长度比 `s√r`、角度 `R19.1°`、扭转角都按 L-M1-15（`format_angle`、`format_decimal`）；乘号 `×`（U+00D7，`naming.TIMES`）、根号 `√`、度 `°`、层间点 `·`（U+00B7）；文件名由现有 `slug` 处理（`web/js/core/util.js:148`）。
- **每个生成器**：

  | 生成器 | 规则 | 例 |
  |---|---|---|
  | M2 `surface`、`surfaces`、`SurfaceAnalysis.slab`、`oriented_cell` | `surface_name`（kind cleave）；`name=` 覆盖时 `autoName = null` | `Pt(111) 4L`、`Pt(111) p(3×3) 4L`、`SrTiO3(001) TiO2-term 7L`、`SrTiO3(001) TiO2/SrO-term 8L`、`Cu(100) (√2×√2)R45° 4L`、`Ag(111) (1×√3)rect 4L`、`Ag(111) [2 1, -1 3] 4L`、`ZnO(10-10) ZnO-A-term 8L`、`TiO2(110) O·Ti2O2-term 9L`、`Pt(1 1 12) 4L`、MP 原胞 POSCAR 上输入 (1 0 0) → `Pt(-111) 4L` |
  | M2 `flip_slab` | 刷新 | `ZnO(0001) Zn/O-term 16L` → `ZnO(000-1) O/Zn-term 16L` |
  | M2 `set_vacuum`/`add_vacuum`/`center_slab` | 不改名；没有块时建 `kind: "vacuum"` 块（`autoName = 原名`） | `CONTCAR` 仍是 `CONTCAR` |
  | M1 晶胞操作，自动名 | 刷新 | `Pt(111) 4L` →√3→ `Pt(111) (√3×√3)R30° 4L` →p(3×3)×√3 累计→ `Pt(111) (3√3×3√3)R30° 4L`；p(3×3) 后求原胞 → `Pt(111) 4L`；Cu(100) 4L 用 `c(2×2)` 预设 → `Cu(100) (√2×√2)R45° 4L`（负责人决定 L-19）；`CONTCAR + CO`（`kind: "adsorbates"` 块）2×2×1 → `CONTCAR 2×2×1 + 4CO` |
  | M1 晶胞操作，非自动名（没有 `info.surface`，或用户改过名） | `rename_after_cell_change`（M1 §3.5.4，风格 `"bulk"`；总矩阵幺模时去掉标签） | `Cu fcc` diag(2,2,2) → `Cu fcc 2×2×2`；`Ru hcp` `[[2,1,0],[-1,1,0],[0,0,2]]` → `Ru hcp (√3×√3)R30° ×2`；改过名的 `my slab` diag(2,2,1) → `my slab 2×2×1` |
  | F0-D `repeat` | `add_repeat_suffix`（L-F0-12） | `Cu fcc 2×2×1` |
  | M5 放置/删除 | 刷新（没有块时建 `kind: "adsorbates"` 块，`autoName = 原名`） | `Pt(111) p(3×3) 4L + 2CO`、`… + 2CO + O`、`CONTCAR + CO`；删掉全部吸附物后回到 `Pt(111) p(3×3) 4L`、`CONTCAR` |
  | M5 `adsorption_structures` | `f"{slab.name} + {formula}@{class label}"`，`autoName = null` | `Pt(111) p(3×3) 4L + CO@fcc (Pt3)` |
  | M5 `substitution_structures` / `vacancy_structures` | `f"{slab.name} {element}@{class label}"` / `f"{slab.name} vac@{class label}"`，`autoName = null` | `… Au@top (Pt) CN 7`、`… vac@top (O)` |
  | M5 `Adsorbate.to_structure` | 吸附物的 `name` | `CO` |
  | M6 `make_interface` | `surface_name`（kind interface：`interface_name` + 吸附物后缀）；`name=` 覆盖时 `autoName = null` | `graphene/Ni(111)`、`graphene p(3×3)/Pt(111) (√7×√7)R19.1°`、`MoS2 p(4×4)/Au(111) (√19×√19)R23.4°`、`graphene p(10×10)/Ir(111) p(9×9)`、`graphene (√7×√7)R19.1°/graphene (√7×√7)R19.1° 21.8° twist`、`hBN/graphene/Ni(111)`、带 CO 的 p(6×6) 基底（Keep the input cell）→ `graphene …/Pt(111) p(6×6) + CO` |
  | M6 `return_parts` | `name + " (substrate part)"` / `" (overlayer part)"`，`autoName = null` | |
  | M2 `standardize_slab`、M6 `prepare_layer`（副本） | 不改名 | |

- **已解决的冲突**：R-F04（名字只由矩阵与来源信息决定；M1 D13 的"预设自己的标签"只用于读数与 toast，负责人决定 L-19）；R-F15（负责人决定 L-12：M2 v2 §3.13 的 `base = info.surface.baseName（M5 写）` 与 §10.5"M5 仍写 `baseName`"作废；M1 v2 K5/§3.5.4、M5 v2 K10/§4.5/§10、M6 v2 §4.1 的 `info.surface.name` → `autoName`；`refresh_auto_name` 的 `was_auto` 参数 → `before`）；R-F18；R-F20；M5 v2 §4.5 的"去掉旧后缀再接新后缀"保留，并推广到 M1 的晶胞操作（先去后缀、再 `rename_after_cell_change`、再接新后缀）；M5 v2 §4.5 的 Hill 式（`get_formula`）→ `display_formula`（§0.3 化学式）；M6 v2 §4.4 的 `format_fixed` → `format_decimal`，非 Wood 写法 `"[[s11,s12],[s21,s22]]"` → `matrix_label` 的 `[2 1, -1 3]`。

### L-X-08 `SURFACE_DEFAULTS`：功能模块的键

- **提供方**：各模块在自己的任务里同时改 `core/defaults.py` 与 `web/js/core/defaults.js`（L-F0-11 的扩展规则），测试逐键核对。非标量的值：Python 用元组与 `MappingProxyType`，JS 深冻结（`Object.freeze` 只冻一层，嵌套数组与对象要逐层冻结）。
- **键名规则**：每个模块的键带本模块的前缀或明确的领域词，不得使用宽泛的单词（`position`、`offset`、`layers`）；同一个键只由一个模块添加；其他模块只引用。

| 模块（任务） | 键（Python；JS 为 camelCase） | 本账本的改动 |
|---|---|---|
| F0-D T7 | `vacuum_gap_min`、`surface_hint_gap_min`、`block_gap_min`、`small_block_fraction`、`gap_wrap_eps`、`position_tolerance`、`flag_tolerance`、`overlap_distance`、`mic_tie` | — |
| M1 T2/T3a/T4 | `translation_tolerance`、`translation_tolerance_min`、`translation_tolerance_max_fraction`、`translation_identity_props`、`translation_identity_tolerances`、`translation_screen_atoms`、`translation_learned_max`、`gauss_tolerance`、`niggli_epsilon`、`mesh_length_tolerance`、`mesh_angle_tolerance`、`mesh_distorted_length`、`mesh_distorted_angle`、`mesh_reduced_tolerance`、`max_matrix_entry`、`max_supercell_det`、`preview_atoms_live`、`preview_atoms_supercell`、`reference_mesh_atoms`、**`reference_mesh_tolerance` = 0.3 Å**、`primitive_atoms_web`、`primitive_atoms_server`、`strain_percent_max`、`strain_percent_warn`、`conventional_length_tolerance`、`conventional_angle_tolerance` | **[新]** `reference_mesh_tolerance`（取代 M5 的 `coverage_translation_tolerance`）；`conventional_*` 只由 M1 加（M2 引用） |
| M2 T1 | **`slab_layers`** = 4、`plane_resolution`、`plane_resolution_min`、`sublayer_gap`、`sublayer_tilt`、`layer_tolerance_margin`、**`termination_match_tolerance`** = 0.10、**`termination_near_match_factor`** = 2.5、**`slab_position`** = `"center"`、**`slab_offset`** = 0.0、`small_spacing`、`thin_slab`、`suggested_thickness`、`max_cleave_bulk_atoms`、`max_cleave_bulk_atoms_public`、`max_cleave_cell_atoms`、`max_layers`、`max_thickness`、**`max_vacuum`** = 1000.0（全仓库共用）、`polar_threshold`、`contact_error_fraction`、`contact_warn_fraction`、`dft_vacuum_hint`、`translation_probe_factors` | **[改]** `layers` → `slab_layers`、`position` → `slab_position`、`offset` → `slab_offset`、`match_tolerance` → `termination_match_tolerance`、`near_match_factor` → `termination_near_match_factor`；`supercell_max_entry` 删除（用 M1 `max_matrix_entry`）；`conventional_*` 不再由 M2 加 |
| M3 T1/T3a/T3b/T5 | `layer_tolerance`、`layer_tolerance_max`、`layer_borderline`、`layer_rumple_min`、`period_max_index`、`period_min`、`surface_probe`、`surface_borderline`、`bond_scale`、`bond_min`、`bond_max`、`select_radius_max`、`analysis_lazy_atoms` | — |
| M4 T1/T2 | `place_bond_factor`、`add_height`、**`place_contact_tol`**、`paste_gap`、`paste_offset_min`、`overlap_tol`、`snap_translate`、`snap_rotate`、`fine_factor`、`contact_factor`、`unwrap_bond_limit`、`lowest_tie`、`clipboard_max_atoms` | **[改]** `site_contact_tol` → `place_contact_tol`（`site_` 是 M5 的前缀）；`bond_*` 用 M3 的，`mic_tie` 用 F0 的 |
| M5 T1/T3/T5 | M5 v2 §4.7 表中的 `site_*`、`adsorbate_*`、`coverage_min_separation` | **[改]** 删除 `coverage_translation_tolerance`（用 M1 `reference_mesh_tolerance`） |
| M6 T0 | M6 v2 §3.11 表中的 `interface_*` | **[改]** 删除 `interface_preview_vacuum`（U4）、`interface_vacuum_max`（用 `max_vacuum`）、`interface_confirm_atoms`（用 F0-A `LIMITS.confirmAtoms` = 30 000） |

- 测试断言（两种语言）：没有 `vacuum`、`interface_vacuum`、`interface_preview_vacuum`、`interface_vacuum_max`、`layers`、`position`、`offset` 这些键。

---

## 3. M1 晶胞与晶格工具提供的条目（L-M1-01 … L-M1-17）

M1 自己用到的第 0 波接口按 F0 账本：`_adopt`（L-F0-07）、`write_frame`（L-F0-06）、`mark_edited`（L-F0-10）、`apply_basis_change`（L-F0-13）、`vacuum_axis`/`surface_normal`/`require_gap`（L-F0-17）、`display_cuts`/`unwrap_along_gap`（L-F0-16）、`make_contiguous`/`contiguous_shifts`（L-F0-18）、`startTask`（L-F0-54）。

### L-M1-01 整数运算

- **提供方**：M1 T1。**文件**：`crystallume/core/intmath.py`、`web/js/core/intmath.js`（M2 T1 之后追加 `plane_basis`）。
- **Python**：
  ```python
  def egcd(a: int, b: int) -> tuple[int, int, int]                     # a·x + b·y = g ≥ 0
  def int_det3(m) -> int
  def int_adjugate3(m) -> list[list[int]]                              # m @ adj = det·I
  def is_unimodular(m) -> bool
  def as_int_matrix(m, *, what: str = "matrix", plane=(0, 1)) -> list[list[int]]   # 长度 3 → 对角；2×2 → 嵌入 plane 两轴；3×3
  def hermite_normal_form(rows) -> list[list[int]]                     # 行式，k ≥ 3 行，秩 3
  def hermite_normal_form_2d(m) -> tuple[int, int, int]                # [[a, b], [0, c]]，a, c > 0，0 ≤ b < c
  def supercell_lattice_points(P) -> list[tuple[int, int, int]]        # |det P| 个陪集代表，新分数坐标整数键的字典序，(0,0,0) 在首位；det < 0 时按 −P 枚举
  def hnf_matrices_2d(n: int) -> list[list[list[int]]]                 # 全部 [[i, j], [0, n/i]]，i | n，0 ≤ j < n/i；(i 升序, j 升序)
  ```
- **JS**：`egcd`、`intDet3`、`intAdjugate3`、`isUnimodular`、`asIntMatrix(m, { what, plane })`、`hermiteNormalForm`、`hermiteNormalForm2d → [a, b, c]`、`supercellLatticePoints`、`hnfMatrices2d`。
- **语义**：纯整数运算（Python `int`；JS 每个乘积检查 `Number.isSafeInteger`，否则 `RangeError('integer overflow in lattice arithmetic')`）；除法向下取整（floor 语义）。`as_int_matrix` 的错误：形状 E-SC0、非整数或越界 E-SC0b（`|p − round(p)| ≤ 1e-8`，`|p| ≤ max_matrix_entry`），文案见 M1 §3.17。
- **消费方**：M1（超胞格点、原胞 HNF、c(m×n) 判定）；M2（`plane_basis` 用 `egcd`、`int_det3`、`int_adjugate3`；`hermite_normal_form`）；M5（`hnf_matrices_2d`，1/n 覆盖度超胞）；M6（`hnf_matrices_2d` 的子格枚举、`hermite_normal_form_2d` 作"同一子格"的规范键）。
- **已解决的冲突**：M2 v1 的 `hnf_rows` → `hermite_normal_form`（不设别名）；M5 v1 的 `hnf_2d(n)` → `hnf_matrices_2d`；M6 v2 §3.3(c) 的私有 `hnf_2d(M)`（"M1 没有提供"）→ `hermite_normal_form_2d`（R-F12）。

### L-M1-02 二维 Gauss 约化 `gauss_reduce_2d`（冻结契约）

- **提供方**：M1 T2（里程碑 M1-α）。**文件**：`core/lattice.py`、`web/js/core/lattice.js`。
- **Python**：`gauss_reduce_2d(a, b, *, angle: str | None = "obtuse") -> tuple[np.ndarray, np.ndarray, list[list[int]]]`
- **JS**：`gaussReduce2d(a, b, { angle = 'obtuse' } = {}) → { u, v, M }`（`angle` 可为 `null`）
- **语义**（M1 §3.11.1 逐字）：`a`、`b` 为同一平面内的两个 2 维或 3 维矢量（Å），返回同维的 `u`、`v` 与整数矩阵 `M`：`[u; v] = M @ [a; b]`，`det M = +1`（保持手性）。主循环：`u·u > v·v·(1 + τ)` 时 `(u, v) ← (v, −u)`；`x = (u·v)/(u·u)`，`|x| > ½ + τ` 时 `μ = sign(x)·floor(|x| + ½ − τ)`，否则 0（恰为半数时向零）；`μ = 0` 结束；至多 10 000 次。τ = `SURFACE_DEFAULTS.gauss_tolerance`（1e-9，相对）。
  - `angle=None`：主循环后直接返回，保证 `|u|² ≤ (1 + τ)|v|²`、`|u·v| ≤ (½ + τ)|u|²`（M6 用）。
  - `angle="obtuse"`（缺省）/`"acute"`：再按 M1 §3.11.1 做角度约定（六方型平局取 `v ∓ u`，否则交换次序，此时可能 `|u| > |v|`）与符号规范化（`u` 与输入 `a` 同向）。
- **错误**：`|a × b| ≤ 1e-8·|a||b|` → E-RD1（M1 §3.17）。
- **消费方**：M1（`classify_mesh`、`reduce_cell` 的二维路径、原胞的面内约化、`reference_mesh`）；M2（K4：1×1 面内基，钝角约定 γ ∈ [90°, 120°]；`flip_slab` 的超胞记录）；M5（Delaunay 平铺基、1/n 覆盖度超胞、上下对称操作，缺省 `"obtuse"`）；M6（`Mesh2D` 的约化基、子格表，**`angle=None`**）。
- **已解决的冲突**：R-F01（M5 v1 的 `gauss_reduce_2d(rows) → (u, v, T)` 与 round-half-up；M6 的 `reduce_basis_shortest` 与 `round_ties_to_zero`、`SWAP_REL`、`TIE_EPS`；M6 v2 §10.3 的"不用"）。

### L-M1-03 最近格点与三维约化

- **提供方**：M1 T2。**文件**：`core/lattice.*`；`build/__init__.py`。
- **Python**：`closest_in_plane(vector, u, v) -> tuple[int, int]`；`niggli_reduce_cell(cell, *, eps: float | None = None) -> tuple[np.ndarray, np.ndarray]`（约化后的晶胞、`C`，约化胞 = C @ cell，det C = +1）；`build.niggli_reduce(structure) -> Structure`（ASE 同名，= `copy().reduce_cell(mode="3d")`，不重建取向）。
- **JS**：`closestInPlane(vector, u, v) → [p, q]`；`niggliReduceCell(cell, { eps } = {}) → { cell, C }`。
- **语义**：`closest_in_plane` 求使 `vector − (p·u + q·v)` 的面内分量最短的整数 (p, q)，并列按（距离取 9 位、`|p| + |q|`、p、q）；Niggli 按 M1 §3.11.2（ε 缺省 `1e-5·V^(2/3)` Å²）。
- **消费方**：M2（c₀ = 面内分量最小的堆垛矢量）；M1（`reduce_cell`、惯用胞）。M4 v2 §10 的"最小像先约化"已由 F0 账本 L-F0-20 自带的约化代替，M4 不依赖本条。
- **已解决的冲突**：M4 v2 §10 写的 `niggli_reduce(cell)` → 晶胞用 `niggli_reduce_cell`，结构用 `build.niggli_reduce`。

### L-M1-04 晶胞参数、标准取向、面间距与应变张量

- **提供方**：M1 T2。**文件**：`core/lattice.*`。
- **Python**：`check_cellpar(a, b, c, alpha, beta, gamma) -> None`；`cellpar_to_cell(a, b, c, alpha=90.0, beta=90.0, gamma=90.0, *, handed: int = 1) -> np.ndarray`；`standard_frame(cell, convention: str = "a-x") -> np.ndarray`；`oriented_cellpar_to_cell(cellpar, reference) -> np.ndarray`；`d_spacing(cell, hkl) -> float`；`strain_tensor(mode: str, percent=None, *, structure=None, direction=None, tensor=None) -> np.ndarray`。
- **JS**：`checkCellpar`、`cellparToCell(a, b, c, alpha, beta, gamma, { handed = 1 } = {})`、`standardFrame(cell, convention = 'a-x')`、`orientedCellparToCell(cellpar, ref)`、`dSpacing(cell, hkl)`、`strainTensor(mode, percent, { structure, direction, tensor } = {})`。
- **语义**：`standard_frame` 返回真转动 R（det +1），`cell @ Rᵀ` 中 a ∥ +x、b 在 xy 平面且 y 分量 ≥ 0；`"c-z"`：c ∥ +z、a 在 xz 平面（M1 §3.8.2）。左手晶胞经 `"a-x"` 后 c 的 z 分量为负（调用方负责，见 L-M2-05）。其余按 M1 §3.8、§3.10.1；`strain_tensor` 的 `tensor` 是**张量分量 εij**（百分数），不是 Voigt 工程剪切。
- **消费方**：M2（`standard_frame`：切面结果与 `set_vacuum` 的重定向）；M6（经 `standardize_slab`）；M1 自己的 Lattice parameters/Strain；F0-A 的 `cellFromParams` 现有调用者不变（E-36）。
- **已解决的冲突**：无。

### L-M1-05 网格分类与标签：`classify_mesh`、`mesh_type`、`wood_label`、`matrix_label`、`mesh_label`、`supercell_label`

- **提供方**：M1 T2。**文件**：`core/lattice.*`（**不在** `core/naming`，R-F37）。
- **Python**：
  ```python
  def classify_mesh(a, b) -> dict           # {kind, distorted, distortion, base, W, ideal}
  def mesh_type(a, b) -> str                # = classify_mesh(a, b)["kind"]
  def wood_label(M, a, b) -> str | None     # M：2×2 整数，det > 0；单位阵 → "p(1×1)"
  def matrix_label(M) -> str                # 2×2 → "[2 1, -1 3]"；3×3 → "[2 1 0, -1 1 0, 0 0 1]"（ASCII 减号）
  def mesh_label(M, a, b) -> str            # [新] = wood_label(M, a, b) ?? matrix_label(M)
  def supercell_label(P, cell, *, reference=None, style: str = "bulk") -> str
  ```
- **JS**：`classifyMesh`、`meshType`、`woodLabel`、`matrixLabel`、`meshLabel`、`supercellLabel(P, cell, { reference, style })`。
- **语义**：
  - `kind` 取值固定为 `"hexagonal"`、`"square"`、`"rectangular"`、`"centred-rectangular"`、`"oblique"`（英式拼写；M6 v2 §3.8.3 的 `centered rectangular` 改为它）。窄档 1e-3（相对）/0.1°，不成功再用"变形"档 3 %/2°（K13）。
  - `wood_label`：先确定基、在理想化网格上计算（与基无关）；对角 → `p(m×n)`（方形、六方上 m ≥ n）；Wood 搜索 → `p(p×q)` 或 `(p×q)Rθ°`；六方的正交胞 → `(n×m√3)rect`；方形/矩形上的有心胞且没有 Wood 形式 → `c(m×n)`；否则 None。数字按 L-M1-15（`format_sig3`、`format_angle`）。
  - `supercell_label`：P 为面内形式（真空轴 k 的行与列为 e_k）→ `mesh_label(面内块, reference 或 cell 的面内两行)`，`P_kk ≠ 1` 时追加 ` ×P_kk`；P 对角且不是面内形式（或 `style == "bulk"` 的对角）→ `format_repeat`（`n1×n2×n3`）；`style == "surface"` 且对角、`P_kk == 1` → `p(n1×n2)`；其余 → `matrix_label(P)`。
- **消费方**：M2（`meshParams.type`、`surface_name` 的网格段）；M5（覆盖度超胞的 `wood`）；M6（每层的 `wood`、名字、预设按 `mesh_type`）；M1 读数与命名。
- **已解决的冲突**：R-F20（单位阵：`p(1×1)`；名字里省略由 L-X-07 处理；M2 v2 §6.1.1 的 `mesh_label` 单位阵 `"(1×1)"` 与 M6 匹配表的 `"(1×1)"` → `"p(1×1)"`；M6 的 `"[[s11,s12],[s21,s22]]"` → `matrix_label`）；M2 v2 §6.1 把 `mesh_label` 放在 `build/surface` → 放在 `core/lattice`，由 M1 提供（M2 不再导出它）。

### L-M1-06 预设表与 Wood 文本：`WOOD_PRESETS`、`wood_presets`、`parse_mesh_spec`、`surface_mesh_matrix`

- **提供方**：M1 T2。**文件**：`core/lattice.*`。
- **Python**：
  ```python
  WOOD_PRESETS: Mapping[str, dict]          # id → {label, definition, meshes, det, params}
  def wood_presets(mesh, *, reference=None) -> list[dict]
      # mesh：两根矢量、3×3 晶胞（取真空轴以外的两行）或网格类型字符串；reference：reference_mesh() 的结果（缺省 = mesh 本身）
      # → [{id, label, value (P_cur 2×2 | None), hint, applicable, why, params}]
  def parse_mesh_spec(text: str) -> dict    # {kind: "preset" | "diagonal" | "wood" | "rect" | "matrix", …}，只看语法
  def surface_mesh_matrix(spec, a, b, *, n=1, m=1, N=None, reference=None) -> list[list[int]]
  ```
- **JS**：`WOOD_PRESETS`、`woodPresets(mesh, { reference } = {})`、`parseMeshSpec(text)`、`surfaceMeshMatrix(spec, a, b, { n, m, N, reference } = {})`。
- **语义**（M1 §3.6）：预设 id：`p2x1 p1x2 p2x2 p3x3 p4x4 c2x2 c4x2 sqrt2 2sqrt2 2sqrt2xsqrt2 sqrt5 sqrt3 2sqrt3 sqrt7 sqrt13 sqrtN rect orthohex conventional`；预设在参考网格的理想化基上按几何定义求矩阵，再换算到当前网格 `P_cur = M_ref · K⁻¹`，不是整数时 `applicable = false`。六方网格上 `c4x2` = `(2×√3)rect`（`[[2,0],[1,2]]`），`c2x2` 不适用。`spec` 接受：预设 id、`p(3×3)`/`(3×3)`/`3x3`/`p3x3`、`c(2×2)`、Wood（`(√3×√3)R30°`、`sqrt3xsqrt3R30`，角度与几何定义相差 ≤ 0.1° 才接受）、`(1×√3)rect`/`1xsqrt3rect`、矩阵文本（`2 1; -1 1`、`[[2,1],[-1,1]]`，经 F0-A `parseIndices`）。
- **错误**（E-MS1，两句，全仓库只此两句）：`"<spec>" is not a surface cell (use p(3×3), (√3×√3)R30°, c(2×2), (1×√3)rect or a 2×2 matrix)`；`<label> does not fit this surface mesh (<type>)`（`<type>` 为 `mesh_type` 的值）。
- **消费方**：M1 超胞编辑器与 `cell.supercell` 的 `preset`/`spec`；M2 切面时的 `supercell=` 文本（L-M2-02）；REST `spec`、CLI `--surface-cell`（M1、M2 共用）。
- **已解决的冲突**：R-F03、R-F04；M2 v2 §5.6 的 `woodPresets(mesh, {primitive: K})` → `wood_presets(mesh, reference=reference_mesh(s))`；M2 v2 §10.3 请求的"心矩形网格的 rect `[[1,1],[-1,1]]`"本期不加（直接输入矩阵即可，名字为 `mesh_label` 的结果）；M2 E11 中 `does not fit this surface cell` 的写法 → 上面的 `surface mesh`。

### L-M1-07 1×1 参考网格 `reference_mesh`（全仓库唯一的"1×1 网格"）

- **提供方**：M1 T4。**文件**：`core/cellops.py`、`web/js/core/cellops.js`。
- **Python**：`reference_mesh(structure, *, exclude=None, tolerance=None, max_atoms=None, frame=None) -> dict`
  → `{"a": ndarray(3), "b": ndarray(3), "K": [[int, int], [int, int]], "source": "record" | "interface" | "translations" | "current", "axis": k, "axes": (i, j)}`（当前面内基 = K @ [a; b]）
- **JS**：`referenceMesh(s, { exclude, tolerance, maxAtoms, frame } = {}) → { a, b, K, source, axis, axes }`
- **语义**（**[改]**：统一 M1 §3.6.4、M5 §3.14.2、M6 §3.2.2）：
  ```text
  k = vacuum_axis(s, frame=frame) ?? 2；(i, j) = (k+1, k+2) mod 3；sf = normalize_surface_info(info.surface)
  1. "record"：sf.kind == "cleave"；M = info.supercellMatrix ?? I；M 是面内形式（第 k 行、第 k 列为 e_k）
               → K = M 的 (i, j) 块；ref = inv(K) @ [a_i; a_j]            （M 不是面内形式 → 跳到 3）
  2. "interface"：sf.kind == "interface" 且 sf.interface.layers[0].matrixRef 存在；M 同上且为面内形式
               → K = M_ij @ layers[0].matrixRef；ref = inv(K) @ [a_i; a_j]  （叠层的参考网格 = 最底层的 1×1，M6 §3.2.2）
  3. "translations"：原子数 ≤ max_atoms（缺省 reference_mesh_atoms = 5 000）
               sub = 全部原子 − exclude（缺省 exclude = adsorbate_id > 0 的原子）；tol = min(tolerance ?? reference_mesh_tolerance (0.3 Å), 0.24·h_min)
               r = primitive_cell(sub 的视图, tolerance=tol, axes=(i, j), props=())   # 只看元素（不看约束、tags、磁矩）
               群阶 > 1 → ref = r 的面内两行；K = r.supercell_matrix 的 (i, j) 块
  4. "current"：ref = [a_i; a_j]；K = I
  最后：(u, v, W) = gauss_reduce_2d(ref, angle="obtuse")；ref ← (u, v)；K ← K @ inv(W)
  ```
  来源 3 只用于读数、预设、覆盖度与名字，从不写进 `info.supercellMatrix`（不为导入的结构编造来源）。JS 按（结构、`rev`）缓存（给了 `exclude` 时不缓存）。
- **消费方**：M1（预设、读数 `This cell: p(3×3) of the 1×1 cell (from the cleave record)`）；M2 Slab 分区内嵌的超胞编辑器（L-M1-16，负责人决定 L-16）；M5（覆盖度：`N_cells = |det K|`，`A1 = (a, b)`，`exclude = 吸附物 ∪ 漂浮片段`；M5 的 `cells=n` 用户覆盖仍在 M5 内）；M6（`prepare_layer` 的 `refMesh`/`refMatrix`，`exclude = adsorbate_id > 0` 的原子，没有该键时 M3 `find_adsorbates` 的结果）。
- **已解决的冲突**：R-F17（M1 v2 信任任何面内 `supercellMatrix`、默认身份属性、0.05 Å；M5 v2 只信 `kind == "cleave"`、0.3 Å、`coverage_translation_tolerance`；M6 v2 另有 `info.surface.supercell` 回退与 `reduce_basis_shortest`）；M2 v2 §4.2 的 `inv(info.supercellMatrix[:2,:2]) @ [a; b]` 只是来源 1 的特例（真空沿 c 时）。

### L-M1-08 超胞 `make_supercell`（唯一的超胞实现）与 `CellOpResult`

- **提供方**：M1 T3a。**文件**：`core/cellops.*`（实现）、`core/structure.*`（薄方法）、`build/__init__.py`。
- **Python**：
  ```python
  @dataclass
  class CellOpResult:
      structure: Structure; src: np.ndarray | None; index_map: np.ndarray | None; image_shift: np.ndarray | None
      matrix: list | None            # 新 = matrix @ 旧（C1）；原胞、重定向为 None
      label: str | None; notes: list[str]; changed: bool; lattice_changed: bool
      rotation: np.ndarray | None; moved: int
  def make_supercell(structure, P, *, wrap: bool = True, label: str | None = None) -> CellOpResult      # cellops，纯函数
  Structure.make_supercell(self, P, *, wrap=True) -> Structure                                          # 新对象
  build.make_supercell(structure, P, *, wrap=True) -> Structure
  ```
- **JS**：`makeSupercell(s, P, { wrap = true, label = null } = {}) → { structure, src, indexMap, imageShift, matrix, label, notes, changed, latticeChanged, rotation, moved }`（`core/cellops.js`，不 import `structure.js`）；`Structure.prototype.makeSupercell(P, { wrap = true } = {}) → Structure`。
- **语义**（M1 §3.3）：P 为 3×3 整数、三个重复数或 2×2 面内矩阵（嵌入真空轴以外的两轴）；`det = 0` E-SC1；`|det| > max_supercell_det` E-SC3；把右手胞变成左手 E-SC2；非周期轴混入 E-SC5；多帧 E-FR。原子顺序**按像优先**（像 q 的原子 a 的新下标 = q·N + a，q = 0 为 (0,0,0)）。包裹（K3，**[改]** 按 F0 账本的切口）：只包裹 `changed_axes(P)`；真空轴 k 上用 `cut = display_cuts(out)[k]`，`shift_k = floor(f_k − cut.lo)`，`cut` 为 None 时退回 `floor(f_k + 1e-12)`；其余轴 `floor(f + 1e-12)`。然后依次：`apply_basis_change`、`adsorbate_id` 按像重编号、`mark_edited(out, "repeat" if 对角 else "cell")`、`update_supercell_matrix`（L-X-02）、`apply_info_handlers({kind: "supercell", …})`（L-M1-14）、命名（L-X-07）。`label` 只填 `CellOpResult.label`（读数与 toast），**名字里的标签只由矩阵算出**。notes：N-SC1、N-SC2、N-LH、N-WR1（文案见 M1 §3.17；N-WR1 改为 `The slab crosses the cell boundary along c and was kept in one piece; centre the slab to move it to the middle.`，不写按钮路径）。
- **与 `repeat` 的关系**（**[改]**，R-F24）：`make_supercell(diag, wrap=False)` 与 F0-D `repeat` 在**没有 `info.surface`、没有 `adsorbate_id`** 的单帧结构上坐标、props、info、名字逐项相同（E20 的测试限于这类结构）；`repeat` 不重编号 `adsorbate_id`、不调用 info 处理器，是低层旧接口。网页（Supercell 分区、`cell.bakeRepeat`）与 REST `/build/supercell` 的单帧 `repeat` 请求一律走 `make_supercell(diag, wrap=False)`；多帧的 `repeat` 请求照旧走 `repeat`（平铺每一帧）。
- **网页**：命令 `cell.supercell`（参数 `matrix | repeat | preset | spec` 恰好一个，`N`、`n`、`m`、`relativeTo: 'reference' | 'current'`、`wrap`；M1 §5.7）；公共 API `crystallume.edit.makeSupercell(matrixOrRepeat | { preset, N, n, m } | { spec }, { wrap, relativeTo })`（可撤销）与 **`crystallume.build.makeSupercell(s, P, { wrap }) → Structure`**（**[改]**，不加入项目）。
- **消费方**：M2（切面时的表面超胞，用 cellops 版本取 `src`；Slab 分区内嵌的超胞编辑器经 `cell.supercell` 命令调用它）；M5（Coverage › Apply：`commands.run('cell.supercell', {matrix})`）；M6（每层的面内超胞，`P = embed(M @ T)`）；M1 自己的界面、REST、CLI。
- **已解决的冲突**：R-F04、R-F24、R-F36（JS 公共名 `build.supercell` → `build.makeSupercell`；Python 现有 `build.supercell(s, nx, ny, nz)` 不变，= `repeat`）；M2 v1 的自有超胞实现、预设表与 50/2500 限额删除；M2 E11 的 `det < 0` 文案 → M1 E-SC2。

### L-M1-09 重定义、右手化、约化、惯用胞与 `conventional_lattice`、`miller_basis_note`

- **提供方**：M1 T2（`conventional_lattice`、`miller_basis_note`）、T3a（结构操作）。**文件**：`core/lattice.*`、`core/cellops.*`、`core/structure.*`。
- **Python**：
  ```python
  def redefine_lattice(structure, U, *, wrap=True) -> CellOpResult
  def make_right_handed(structure) -> CellOpResult
  def reduce_cell(structure, *, mode: str = "auto", angle: str = "obtuse", wrap=True) -> CellOpResult   # mode: auto | 2d | 3d
  def conventional_cell(structure, *, wrap=True) -> CellOpResult
  def conventional_lattice(cell) -> tuple[str, list[list[int]]] | None    # (kind, Q)，惯用胞 = Q @ cell；kind ∈ cubic P/I/F、hexagonal P/R、tetragonal P/I
  def miller_basis_note(cell, hkl) -> str | None
  Structure.redefine_lattice(U, *, wrap=True) / make_right_handed() / reduce_cell(...) -> self ；Structure.get_conventional_cell() -> Structure
  ```
- **JS**：同名 camelCase（`conventionalLattice(cell) → { kind, Q } | null`、`millerBasisNote(cell, hkl)`）。
- **语义**：M1 §3.7、§3.11.3、§3.14。`reduce_cell` 的 `auto`：有真空轴（`vacuum_axis`，L-F0-17）→ 二维路径，否则 Niggli。惯用胞在有真空轴时不可用，界面说明 **[改]** `Conventional cell needs a cell without a vacuum gap (this one has one along c).`（不写"for bulk crystals"，U1）。
- **消费方**：M2（`conventional_cell_hint` 对立方、四方、六方委托 `conventional_lattice`，L-M2-01）；F0-A 的 `millerInput` 读数（`miller_basis_note`，与 `centered_cell_hint` 在 fcc/bcc 上同一矩阵，测试核对）；M1 界面。
- **已解决的冲突**：R-F19；M1 v2 §3.14 的界面文案（U1 措辞）。

### L-M1-10 连续形变：`set_cell`、`set_lattice_parameters`、`deform`、`apply_strain`

- **提供方**：M1 T3b。**文件**：`core/cellops.*`、`core/structure.*`。
- **Python**：
  ```python
  def set_cell(structure, cell, *, scale_atoms: bool = False) -> CellOpResult
  def set_lattice_parameters(structure, *, a=None, b=None, c=None, alpha=None, beta=None, gamma=None,
                             scale_atoms: bool = True, keep_vacuum="auto") -> CellOpResult
  def deform(structure, F, *, keep_vacuum="auto") -> CellOpResult
  def apply_strain(structure, percent=None, *, mode: str = "isotropic", direction=None, tensor=None, keep_vacuum="auto") -> CellOpResult
  Structure.set_cell(self, cell, scale_atoms=False) -> self    # ASE 同名同义
  ```
- **JS**：`setCell(s, cell, { scaleAtoms })`、`setLatticeParameters(s, { a, b, c, alpha, beta, gamma }, { scaleAtoms = true, keepVacuum = 'auto' })`、`deform(s, F, { keepVacuum })`、`applyStrain(s, { percent, mode, direction, tensor, keepVacuum })`。
- **语义**：M1 §3.8、§3.10。`keep_vacuum` ∈ `"auto" | True | False`（JS `'auto' | true | false`）：`"auto"` = 有真空轴时为真；为真而没有真空轴时 E-ST5，**[改]** 文案改用 `vacuum_gap_hint(s)`（经 `require_gap`，L-F0-17）。**[改]** 沿真空轴的展开用 `unwrap_along_gap(f_k, cut)`，`cut = surface_normal(s, require_gap=True)["cut"]`（窗口 `[cut.lo, cut.lo + 1)`，不是"间隙中点"）；改变真空轴矢量且保持笛卡尔坐标前先 `make_contiguous(s, k)`（L-F0-18）。写晶胞一律经 `write_frame`/`_adopt`，之后 `mark_edited(s, "cell")`，纯转动时 `"rotate"`。
- **消费方**：M1 的 Lattice parameters、Strain 分区与 REST/CLI。**`deform` 没有其他模块的消费方**（R-F12：M6 不调用）。
- **已解决的冲突**：R-F12；F0 账本 §6 M1 第 1–3 条（已并入）。

### L-M1-11 刚性操作与轴轮换：`reorient`、`permute_cell_axes`、`shift_origin`、`wrap_into_cell`

- **提供方**：M1 T3b。**文件**：`core/cellops.*`、`core/structure.*`。
- **Python**：
  ```python
  def reorient(structure, *, convention: str = "a-x") -> CellOpResult
  def permute_cell_axes(structure, k: int) -> Structure          # [新] 原位；把轴 k 轮换到 c：perm = [(k+1)%3, (k+2)%3, k]（det +1）
  def shift_origin(structure, origin, *, fractional=True, axes=None, wrap=True) -> CellOpResult
  def wrap_into_cell(structure, *, keep_slab: bool = True) -> CellOpResult
  ```
- **JS**：`reorient(s, { convention })`、`permuteCellAxes(s, k) → s`、`shiftOrigin(s, origin, { fractional, axes, wrap })`、`wrapIntoCell(s, { keepSlab })`。
- **语义**：`permute_cell_axes`（M2 v2 §10.3 的请求，从 M1 §3.13 抽出）：所有帧的晶胞行按 perm 重排，`pbc ← pbc[perm]`，`selective_dynamics` 各行按 perm 重排（精确），`info.supercellMatrix` 的行与列按 perm 重排，`info.surface.axis ← 2`（存在时）；笛卡尔坐标不动；**不调用** `mark_edited`（调用方按自己的操作调用：`reorient` 用 `"rotate"`，`set_vacuum` 用 `"cell"`）；JS `touch()`；`k == 2` 时不变。`reorient` 先在需要时 `permute_cell_axes`，再 `standard_frame` 转动所有帧、旋转 `info.surface.normal`（经处理器）。`wrap_into_cell(keep_slab=True)` 沿真空轴用 `display_cuts` 的切口（所有帧同一组整数，F0 L-F0-18 的约定）。
- **消费方**：M2 `set_vacuum` 第 2 步（`permute_cell_axes`）；M1 界面、REST、CLI。
- **已解决的冲突**：M2 v1 的"`set_vacuum` 轴置换时删除 `supercellMatrix`"→ 置换行列；M2 v2 §10.3 的请求采纳，名字定为 `permute_cell_axes`。

### L-M1-12 平移对称性与原胞：`identity_classes`、`find_translations`、`primitive_cell`

- **提供方**：M1 T4。**文件**：`crystallume/analysis/translations.py`（加入 `analysis.__all__`）、`web/js/core/translations.js`。
- **Python**：
  ```python
  @dataclass
  class TranslationGroup:
      denominator: int; vectors: list[tuple[int, int, int]]; generators: list[tuple[int, int, int]]
      permutations: list[np.ndarray]; props_used: list[str]
      order: int            # property
      translations: np.ndarray  # property，(order, 3)，[0, 1)
  def identity_classes(structure, props=None) -> tuple[np.ndarray, list[str]]
  def find_translations(structure, tolerance: float | None = None, axes=None, *, props=None) -> TranslationGroup
  @dataclass
  class PrimitiveResult(CellOpResult):
      translations: TranslationGroup; orbit_of: np.ndarray
      transform: dict          # {"num": 3×3 int, "den": int}：新 = (num/den) @ 旧（C1 方向）
      supercell_matrix: list[list[int]]   # 旧 = S @ 新（整数，det = 群阶）；CellOpResult.matrix 恒为 None
  def primitive_cell(structure, tolerance=None, axes=None, *, props=None, reduce: bool = True, average: bool = False) -> PrimitiveResult
  Structure.get_primitive_cell(self, tolerance=None, *, axes=None, props=None, reduce=True, average=False) -> Structure
  ```
- **JS**：`identityClasses(s, props)`、`findTranslations(s, { tolerance, axes, props })`、`findTranslationsAsync(s, opts, { signal, onProgress })`、`primitiveCell(s, { tolerance, axes, props, reduce, average })`（返回同键对象，`supercellMatrix`、`transform`、`orbitOf`）。
- **语义**：M1 §3.12。`props=None` = `SURFACE_DEFAULTS.translation_identity_props`（`occupancy`、`initial_magmoms`、`initial_charges`、`masses`、`selective_dynamics`、`tags`、`poscar_species`；**不含** `labels`、`adsorbate_id`）；`props=()` = 只看元素。`axes=None` = 真空轴以外的周期轴，`"all"` = 全部周期轴，元组 = 指定。`tolerance` 范围 `[1e-4 Å, 0.25 × 最小晶面间距)`，否则 E-PC1。
- **消费方**：M2（K1：OUC 的三维原胞，`props` = M2 会保留的属性；`axes=(0, 1)` 的最小表面网格）；M6（`axes=(0, 1)`，`props = translation_identity_props + ("interface_layer",)`）；L-M1-07 `reference_mesh`（`props=()`）；M5 只经 `reference_mesh`（M5 v2 §3.14.2 的直接调用改掉）。
- **已解决的冲突**：R-F02；M2 v1 的 `keys=` 与 M6 v1 的 `respect_props=` → `props=`；M6 v2 §3.2.1 第 6 步的注释"M1 默认含 labels"→ 不含（参数本身写法正确）；M6 v2 的 `r.matrix`（"输入胞 = K @ 原胞"）→ `r.supercell_matrix`。

### L-M1-13 `Structure` 上的原位薄方法

- **提供方**：M1 T3a/T3b。**文件**：`core/structure.py`、`web/js/core/structure.js`。
- **签名**（M1 §6.1/§6.2，参数与 cellops 版本一致）：`make_supercell`（新对象）、`get_primitive_cell`（新对象）、`get_conventional_cell`（新对象）、`redefine_lattice`、`make_right_handed`、`reduce_cell`、`set_cell`、`set_lattice_parameters`、`deform`、`apply_strain`、`reorient`、`shift_origin`、`wrap_into_cell`（原位，返回 self/this）。原位方法 = `r = cellops.op(self, …)` 后 `self._adopt(r.structure)`（F0 账本 L-F0-07，`src` 由 `r.src` 给出），notes 不暴露。
- **消费方**：脚本用户；M2/M5/M6 调用 cellops 版本（需要 `src`、notes）。
- **已解决的冲突**：M1 v2 R7 的后备 `_adopt` 不需要（F0-D 提供）。

### L-M1-14 info 处理器注册表 `register_info_handler`、`apply_info_handlers`、`update_surface_geometry`

- **提供方**：M1 T10。**文件**：**[新]** `crystallume/core/infohandlers.py`、`web/js/core/infohandlers.js`（注册表与内置处理器都在这里，导入时静态注册，没有导入顺序问题）；`core/cellops.*` 重新导出三个函数。
- **Python**：
  ```python
  def register_info_handler(key: str, fn, *, replace: bool = False) -> None     # key：info 的顶层键或点分路径
  def apply_info_handlers(ctx: dict) -> None
  def update_surface_geometry(surface: dict, ctx: dict) -> dict
  ```
- **JS**：`registerInfoHandler(key, fn, { replace })`、`applyInfoHandlers(ctx)`、`updateSurfaceGeometry(surface, ctx)`。
- **语义**：对 `ctx.new.info` 中存在的每个已注册键，按"父键先于子键、同级按注册顺序"调用 `fn(value, ctx) → 新值`（`None` = 删除该键）；处理器是纯 JSON 变换，两种语言同名同义；重复注册且 `replace` 为假 → `ValueError` `register_info_handler: 'surface' is already registered`。
  - `ctx`：`{kind: "supercell" | "basis" | "primitive" | "rotation" | "deform", old, new, matrix, transform, rotation, deformation, src, images, id_offset, perm}` + **[新]** `lattice_points`（超胞：`supercell_lattice_points(P)`，供记录平移）与 `id_map`（原胞：旧 `adsorbate_id` → 新）。
  - 内置处理器：
    - `surface`（M1 T10）= `update_surface_geometry`：`rotation` → `normal ← R @ normal`；`basis`/`supercell`/`primitive`/`deform` → 找另两根新矢量都与 `normal` 垂直（1e-6）的轴写入 `axis` 并按新晶胞重算 `normal`（朝 +a_k），找不到则删除 `axis` 与 `normal`；轮换 → `axis = 2`。**不改**其他字段（M2 v2 已把其余字段定为创建时的值或交给 `refresh_auto_name`）。
    - `surface.adsorbates`（M5 T6）：L-X-04 的超胞、原胞规则。
  - 命名不在处理器里做：M1 在操作前取 `before = auto_name_state(s)`，在 `apply_info_handlers` 之后调用 `refresh_auto_name(s, before, cell_change=…)`（L-X-07）。
- **消费方**：M1 的每个基变换与刚性操作；M5（注册处理器）。
- **已解决的冲突**：M1 v2 K16 的"M2 注册 `surface`（`replace=True`）更新 `supercell`、`wood`、组成、`name`"→ 不需要（这些字段在 M2 v2 中已是 `asBuilt`/`autoName`）；"M6 注册 `interface`"→ 不注册（L-X-03）；处理器放在独立文件里静态注册（M1 v2 放在 `core/cellops`，需要各模块导入后才生效，Python 中未导入 `build.adsorbate` 就会漏掉记录）。

### L-M1-15 命名辅助与数字格式化

- **提供方**：M1 T2。**文件**：`core/naming.py`、`web/js/core/naming.js`（F0-D 建立的文件，追加）。
- **Python**：
  ```python
  def round_half_up(x: float, digits: int = 0) -> float        # sign(x)·floor(|x|·10^d + 0.5)/10^d
  def format_decimal(x: float, digits: int) -> str              # s = floor(|x|·10^d + 0.5)；s = 0 时无负号；整数拼出小数点
  def format_sig3(x: float) -> str                              # x = 0 → "0"；d = max(0, 2 − floor(log10|x|))；format_decimal(x, d)
  def format_angle(t: float) -> str                             # |t − round_half_up(t)| < 0.05 → 整数，否则一位小数
  def rename_after_cell_change(name: str, P, *, cell, previous=None) -> str     # [改] 去掉 label 参数
  ```
- **JS**：`roundHalfUp`、`formatDecimal`、`formatSig3`、`formatAngle`、`renameAfterCellChange(name, P, { cell, previous })`。
- **语义**：数字格式化两种语言逐字相同（附录 A-2：`2.125 → "2.13"`、`0.625 → "0.63"`、`−0.004 → "0.00"`、`21.25 → "21.3"`，而 `f"{x:.2f}"` 给 `2.12`、`0.62`、`-0.00`、`21.2`）。`rename_after_cell_change` 按 M1 §3.5.4（在名字里找旧标签整体替换，找不到就追加；总矩阵幺模时去掉标签；风格 `"bulk"`）。
- **消费方**：所有进入名字、标签、文案的数（M1、M2、M3 的读数、M5 的标签与警告、M6 的名字与扭转角）；`refresh_auto_name`（L-X-07）。
- **已解决的冲突**：R-F18（M1 `fmt_sig3`/`fmt_angle`/`fmt_len` → `format_sig3`/`format_angle`/`format_decimal`；M5 `q_d` → `round_half_up`，M5 不再追加 `format_decimal`；M6 `format_fixed` → `format_decimal`）；R-F37；M1 D13 的 `label` 参数（R-F04）。

### L-M1-16 网页：分区、命令与公共 API

- **提供方**：M1 T7a–T7c、T8。**文件**：`web/js/ui/cellsections.js`、`web/js/ui/cellsupercell.js`、`web/js/commands/cell.js`（`main.js` 加一行 import）。
- **分区**：`registerPanelSection('structure', { id: 'cell', slot: 'cell', order: 10, … })`。
- **共享超胞编辑器**（**[改]** 负责人决定 L-16，R-F04 第 3 条；取代早先的 `tab: 'surface'` 深链）：`web/js/ui/cellsupercell.js` 导出 `supercellEditor(el, app, { owner, surface = false })`（在 `el` 里渲染，随宿主分区重绘）。Cell › Supercell 用 `surface: false`；M2 的 Slab 分区内嵌 `surface: true`（`owner: 'surface.slab'`）。两种挂载执行同一个 `cell.supercell` 命令（`surface: true` 时 2×2 矩阵按真空轴嵌入 3×3），共用 `wood_presets`（相对 `reference_mesh`）、限额（`max_matrix_entry`、`max_supercell_det`、`LIMITS.maxAtoms`）、名字（L-X-07）、toast（`Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms`，负责人决定 L-19）与撤销标签；测试 `test_supercell_two_mounts`。
- **命令**：M1 §5.7 的 13 个 `cell.*`（`cell.supercell`、`cell.redefine`、`cell.parameters`、`cell.reorient` 的 ID 由 F0 账本 L-F0-52 固定）。进度用 `app.startTask(label, { cancel })`（L-F0-54；M1 v2 写的 `app.busy(label)` 改名）。
- **公共 API**（`defineApi`，owner `M1`）：`edit.makeSupercell`、`edit.redefineLattice`、`edit.makeRightHanded`、`edit.setLatticeParameters`、`edit.setCell`、`edit.strain`、`edit.reduceCell`、`edit.primitiveCell`、`edit.conventionalCell`、`edit.reorient`、`edit.shiftOrigin`、`edit.wrap`；`build.makeSupercell`；`analysis.translations`、`analysis.primitiveCell`、`analysis.referenceMesh`；`lattice.*` 追加 `gaussReduce2d, niggliReduceCell, woodLabel, meshLabel, woodPresets, classifyMesh, meshType, parseMeshSpec, surfaceMeshMatrix, supercellLabel, matrixLabel, standardFrame, checkCellpar, cellparToCell, dSpacing, strainTensor, conventionalLattice, millerBasisNote, latticePoints, hnfMatrices2d, hermiteNormalForm2d`。
- **已解决的冲突**：R-F36；F0 账本 §6 M1 第 7、10、11 条。

### L-M1-17 REST、客户端、CLI

- **提供方**：M1 T6。**文件**：`server/models.py`、`server/routes/build.py`、`client.py`、`cli.py`。
- **REST**（M1 §6.3）：`POST /api/v1/build/supercell`（扩展；`repeat`、`matrix`、`preset`、`spec` 恰好一个；**[改]** 单帧的 `repeat` 走 `make_supercell(diag, wrap=False)`）、`POST /api/v1/build/transform`（新；操作名 `supercell`、`redefine`、`right-handed`、`lattice-parameters`、`set-cell`、`strain`、`strain-tensor`、`reduce`、`primitive`、`conventional`、`reorient`、`shift-origin`、`wrap`；新模型 `extra="forbid"`）。
- **客户端**：`supercell(self, structure, repeat=None, *, matrix=None, preset=None, spec=None, N=None, n=1, m=1, relative_to="reference", wrap=True)`、`transform(self, structure, operations)`、`transform_detailed(self, structure, operations) -> dict`。
- **CLI**：`crystallume transform INPUT [--from FMT] [--index N] [-o OUT] [--format FMT] [--plugins DIR] OPS...`（修饰选项作用于紧邻的前一个操作，M1 §6.5）；表面超胞 `--surface-cell SPEC [--relative-to current]`。
- **已解决的冲突**：R-F13（`--index` 只接受单个整数；输入格式 `--from`、输出格式 `--format`）。

---

## 4. M2 切面与 slab 提供的条目（L-M2-01 … L-M2-09）

### L-M2-01 Miller 指数规范化、整数基与惯用胞提示

- **提供方**：M2 T1（`plane_basis`、`normalize_miller`）、T1b（`conventional_cell_hint`）。**文件**：`core/intmath.*`（追加 `plane_basis`）、`build/surface.*`、`core/lattice.*`（追加 `conventional_cell_hint`）。
- **Python**：
  ```python
  def plane_basis(hkl, handedness: int) -> list[list[int]]        # [v1; v2; v3]，v1·hkl = v2·hkl = 0，v3·hkl = 1，det = handedness
  def normalize_miller(bulk, miller, *, miller_basis: str = "input") -> dict
      # {"miller", "miller_input", "miller_basis", "miller_conventional", "conventional", "hkil", "notes"}
  def conventional_cell_hint(cell) -> dict | None                 # {"kind": "cF"|"cI"|"hR"|"tI"|"oF"|"oI"|"oC"|"mC", "to_conventional": 3×3 int}
  ```
- **JS**：`planeBasis(hkl, handedness)`、`normalizeMiller(bulk, miller, { millerBasis })`、`conventionalCellHint(cell) → { kind, toConventional } | null`。
- **语义**：M2 §3.1、§3.1.1、§3.3。`miller` 接受 3 或 4 个整数；四指数只在 120° 六方晶胞（`is_hexagonal_cell`，L-F0-46）或惯用胞为六方（hR）时接受；范围与文案沿用 F0-A `miller` 类型（硬上限 30、超过 12 软提示，L-F0-47）。存进 `info.surface` 时键为 camelCase（`toConventional`）。
- **与 M1 的一致性**（**[改]**，R-F19）：`conventional_cell_hint` 是**独立的新函数**，不修改、不扩展、不给 F0-A 的 `centered_cell_hint` 加别名（L-F0-46 的返回形状 `{kind: "fcc" | "bcc", to_conventional}` 冻结）；三者对同一晶胞给出的惯用胞矩阵必须相同：`centered_cell_hint` 的 fcc/bcc = `conventional_cell_hint` 的 cF/cI = M1 `conventional_lattice` 的 cubic F/I；M1 `conventional_lattice` 先调用 `conventional_cell_hint`，命中 cF、cI、hR、tI 时直接采用它的 Q（kind 映射为 `cubic F`、`cubic I`、`hexagonal R`、`tetragonal I`），否则做 M1 §3.14 的度规搜索（测试：标准设置与随机幺模基上两者的 Q 生成同一格且对标准设置逐项相同）。
- **消费方**：M2 切面；M1 `conventional_lattice`、`miller_basis_note`（因而 F0-A 的 Miller 读数）。
- **已解决的冲突**：R-F19；M2 v2 §3.1.1"同一函数、加别名"→ 两个函数。

### L-M2-02 切面：`surface`、`surface_analysis`、`terminations`、`oriented_cell`、`surfaces`、`estimate_surface_atoms`

- **提供方**：M2 T3（分析，Python）、T4（组装与命名，Python）、T6a/T6b（JS）。**文件**：`crystallume/build/surface.py`（`build/__init__.py` 导出）、`web/js/build/surface.js`。
- **Python**：
  ```python
  def surface(bulk: Structure, miller: Sequence[int], *, vacuum: float,
              layers: int | None = None, periods: int | None = None, thickness: float | None = None,
              termination: int | str = 0, cut: int | None = None, symmetric: bool = False,
              position: str = "center", offset: float = 0.0,
              supercell: Sequence[Sequence[int]] | Sequence[int] | str | None = None,
              primitive: bool = True, miller_basis: str = "input", translation_tolerance: float | None = None,
              fix_bottom: int = 0, fix_middle: int = 0, fix_axes: str = "abc",
              layer_tolerance: float | None = None, charges: Mapping[str, float] | None = None,
              keep_molecules: bool = False, name: str | None = None) -> Structure
  def surface_analysis(bulk, miller, *, primitive=True, miller_basis="input", translation_tolerance=None,
                       layer_tolerance=None, charges=None, keep_molecules=False) -> SurfaceAnalysis   # M2 §6.1 的数据类
  def terminations(bulk, miller, **analysis_kwargs) -> dict                       # = surface_analysis(...).to_dict()，即 REST 响应
  def estimate_surface_atoms(bulk, miller, **surface_kwargs) -> int               # 不需要 vacuum（给了也忽略）
  def oriented_cell(bulk, miller, *, periods=1, termination=0, cut=None, primitive=True, miller_basis="input",
                    translation_tolerance=None, layer_tolerance=None) -> Structure   # = surface(..., vacuum=0, periods=periods)
  def surfaces(bulk, miller, *, vacuum: float, **surface_kwargs) -> list[Structure]   # 可选 M2-C5
  ```
- **JS**：`surfaceAnalysis(bulk, opts)`、`terminations(bulk, opts)`、`buildSurface(bulk, { miller, vacuum, layers, periods, thickness, termination = 0, cut = null, symmetric = false, position = 'center', offset = 0, supercell = null, primitive = true, millerBasis = 'input', translationTolerance = null, fixBottom = 0, fixMiddle = 0, fixAxes = 'abc', layerTolerance = null, charges = null, keepMolecules = false, name = null } = {}) → Structure`（**[改]** 没有 `wood`）、`estimateSurfaceAtoms(bulk, opts)`、`orientedCell(bulk, opts)`、`surfaces(bulk, opts)`。
- **语义**（M2 §3，**以下几点为准**）：
  - 结果是**新结构**（P4）：`pbc = [T, T, T]`（U2，含 V = 0）；标准取向（a ∥ x，法向 ∥ +z，V > 0 时 c ⊥ 表面；V = 0 时 c = (L/m)·c₀ 倾斜，`stacking = "bulk"`）；V > 0 时居中（`position="center"`，底层原子高 V/2）或贴底（`offset`）；不改动 `bulk`；`source_map` 指向输入体相（F0-D `_remap`/`_set_source`）。
  - `vacuum` 见 §1.5；`layers`/`periods`/`thickness` 最多给一个，都不给时 `SURFACE_DEFAULTS.slab_layers` = 4 层（U4）。
  - `supercell`：2×2 整数矩阵、对角简写 `(n, m)`、或文本（**[改]**：经 M1 `surface_mesh_matrix(spec, a₁, b₁)` 在 1×1 slab 网格上求矩阵，R-F03；不再有 `wood` 参数与 M2 自己的预设）。实现：1×1 slab 组装后 `cellops.make_supercell(slab, embed(S))`（L-M1-08；写 `info.supercellMatrix`），再 `standard_frame("a-x")` 转回 a ∥ x（`mark_edited(s, "rotate", rotation=R)`）、面内包裹、按 M2 §3.12.2 一次重排。矩阵的错误一律是 M1 的文案（E-SC0/E-SC0b/E-SC1/E-SC2/E-SC3），元素上限 `max_matrix_entry`，原子数由 `estimate_surface_atoms` 与 `max_atoms` 把关（**[改]**：删去 M2 E11 的"between -50 and 50"与"swap the two rows"两句）。
  - 原子顺序（K12）：`(元素在体相中首次出现的名次, 层号 ℓ（从下到上）, 超胞像序, 原胞原子序号)`，稳定排序；`tags` = 从顶层数的构建层号（1 = 顶层）；`adsorbate_id` 删除；体相的 `selective_dynamics` 删除（非全 T 时 W5），再按 `fix_bottom`/`fix_middle` 直接写（R-F09：`fix_axes` 语法同 M3 `axes`，"中间 N 层"要求 `L − N` 为偶数）。
  - `info`：从新的 info 开始（`source = "builder:surface"`，体相备注的深拷贝 + 本模块备注）；`info.surface` 按 L-X-01（`kind: "cleave"`）；名字 `surface_name`（L-X-07），`name=` 覆盖时 `autoName = null`。
  - 校验：`find_layers(slab, "c", info.surface.layerTolerance).count == L` 且 `from_top + 1 == tags`（测试断言；运行时不一致只记 W17）。
  - 错误与警告：M2 §3.20 的 E1–E16、W2–W19、N1–N5（E11 见上）；`symmetric=True` 找不到对称 slab 时 E9。
- **消费方**：公共 API；M3（`layerTolerance`、`bulk.reducedFormula`）；M5、M6 的测试夹具与用户故事；M6-C2（可选：覆盖层取自体相时调用 `surface`）。
- **已解决的冲突**：R-F03、R-F04、R-F09、R-F38；M3 v1 §10.3-1/2/4（层数与 tags 用 M3 的结果、固定底层经 `fix_layers`）→ M2 v2 K5/K13 的构建层号，M3 确认。

### L-M2-03 改真空工具：`set_vacuum`、`add_vacuum`、`center_slab`、`slab_extent`、`slab_report`、`surface_top`

- **提供方**：M2 T5。**文件**：`core/structure.py`、`web/js/core/structure.js`（方法）、`build/surface.*`（`slab_report`、`surface_top`）。
- **Python**：
  ```python
  Structure.set_vacuum(self, vacuum: float, *, position: str = "center", offset: float = 0.0,
                       orthogonal: bool = True, reorient: bool = True, axis: str | int | None = None) -> Structure
  Structure.add_vacuum(self, amount: float, *, axis: str | int | None = None) -> Structure
  Structure.center_slab(self, *, axis: str | int | None = None) -> Structure
  Structure.slab_extent(self, *, axis: str | int | None = None, exclude_adsorbates: bool = False) -> dict
      # {axis, normal, bottom, top, thickness, gap, straddles, floating}
  def slab_report(structure) -> dict        # {composition, formula, stoichiometric, excess, missing, netCharge, dipole, chargesSource, editedSinceCleaving}
  def surface_top(structure) -> float       # = slab_extent(exclude_adsorbates=True)["top"]
  ```
- **JS**：`setVacuum(vacuum, { position = 'center', offset = 0, orthogonal = true, reorient = true, axis } = {})`（`vacuum` 缺失抛 E12a）、`addVacuum(amount, { axis })`、`centerSlab({ axis })`、`slabExtent({ axis, excludeAdsorbates = false })`；`slabReport(s)`、`surfaceTop(s)`（`build/surface.js`）。
- **语义**（M2 §3.14，**[改]** 按 F0 账本的名字）：
  1. 轴与切口：`axis` 给出时用它；否则 `sn = surface_normal(s)`（L-F0-17）：`sn.source ∈ {info, vacuum, pbc}` → `k = sn.axis`、`cut = sn.cut`；`"ab-plane"`（没有真空间隙）→ `k = 2`、W14，切口取 c 方向最宽的空隙：`g = find_vacuum_gap(s, 2, min_width=0)`，窗口起点 `lo = g.center − 1 if g.center > 0.5 else g.center`（数值，L-F0-16 允许）。声明的非周期轴 ≥ 2 → E12e。
  2. `k ≠ 2` → M1 `permute_cell_axes(s, k)`（L-M1-11），W16。
  3. `reorient` 且 `det(cell) < 0` → 面内交换 a、b（晶胞行、pbc、SD 列、`supercellMatrix` 行列），W18。
  4. 接上：`pbc[2]` 为真 → 先 `shifts = contiguous_shifts(s, 2, cut=cut)`，再 `make_contiguous(s, 2, cut=cut)`（L-F0-18；网页 `imageShift(i) = [0, 0, shifts[i]]`，轴置换后的轴号）；为假 → 用笛卡尔高度。
  5–10. 同 M2 §3.14（漂浮原子组 W19、新 c、`apply_basis_change`、位置、`standard_frame` 重定向与 `mark_edited(s, "rotate", rotation=R)`、面内包裹、接触检查）。
  11. **pbc 不变**（只随第 2、3 步置换）；改了晶胞时 `mark_edited(s, "cell")`。
  12. `info.surface`：有则更新 `vacuum, thickness, position, offset, stacking, axis`；没有则新建 `kind: "vacuum"` 块（L-X-01，`autoName = s.name`）；**不改名**。
  - `set_vacuum(0)` → E12d（界面可以填 0，就地显示 E12d、Apply 不可用；U4 的"允许填 0"指切面与界面构建，负责人决定 L-13，见 §1.5、§9）；`add_vacuum` = `set_vacuum(当前间隙 + amount, position="keep", orthogonal=False, reorient=False)`；`center_slab` = 私有 `_place_slab(gap=None, position="center", orthogonal=False, reorient=False)`（晶胞不变，只平移；不调用 `mark_edited`）。现有 `Structure.center(vacuum=)`（每侧）不变，docstring 互相引用。
  - 多帧：只保留当前帧（JS）/ 第 0 帧（Python），其余丢弃并写备注（C11）。
- **网页**：Slab 分区（`registerPanelSection('surface', { id: 'slab', order: 20 })`）；命令 `surface.vacuum`（Build vacuum slab…）、`surface.setVacuum`（Set vacuum…）、`surface.flip`、`surface.center`（L-F0-52 的表）；`editActive(label, fn, { imageShift, latticeChanged, cameraTransform, singleFrame: true })`；真空输入 `numberInput({ required: true, min: 0, unit: 'Å' })` 初始为空；公共 API `edit.setVacuum(vacuum, opts)`、`edit.addVacuum(amount, opts)`、`edit.centerSlab()`、`edit.flipSlab()`。
- **消费方**：用户与脚本；M1 的 N-WR1 指向"居中 slab"；M3 不再调用 `center_slab`（M3 K15）；M4 不再需要 `surface_top`（M4 v2 §10，`surface_top` 保留为公开辅助函数）；M6 用 L-M2-05 而不是本条。
- **已解决的冲突**：R-F08、R-F28（`return_shifts` → `contiguous_shifts`）；F0 账本 §6 M2 第 3、4 条；M2 v2 第 5 步的 `make_contiguous(s, 2, gap=…)` → `cut=`。

### L-M2-04 翻转 `flip_slab`

- **提供方**：M2 T5。**文件**：`core/structure.*`。
- **Python**：`Structure.flip_slab(self) -> Structure`。**JS**：`flipSlab() → this`。
- **语义**：M2 §3.15：`sn.surface` 为假 → E15；绕 a 转 180°（真转动）；面内基 `gauss_reduce_2d(…, "obtuse")`；约束 `apply_basis_change`（精确）；`tags`：`t > 0 → max + 1 − t`；`info.supercellMatrix` 的 `S_new`；`kind == "cleave"` 时 `miller`、`hkil`、`millerConventional`、`millerInput`、`bulkNormal` 取反，`directions` 重算，`termination` 的 top/bottom 交换，`flipped` 取反，`normal = [0, 0, 1]`，`axis = 2`；吸附物记录不改写（L-X-04）；先取 `before = auto_name_state(s)`，最后 `refresh_auto_name(s, before)`。网页：先在副本上算出 `imageShift` 与 R，再 `editActive('Flip slab', s => s.flipSlab(), { latticeChanged: true, cameraTransform: R, imageShift, singleFrame: true })`。
- **消费方**：用户；M6-C1（可选三明治）。
- **已解决的冲突**：无（M2 v2 K18 已采纳工程 #9）。

### L-M2-05 `standardize_slab`（M6 的层准备用）

- **提供方**：M2 T5。**文件**：`build/surface.*`。
- **Python**：`standardize_slab(structure) -> Structure`（新对象）。**JS**：`standardizeSlab(s) → Structure`。
- **语义**：`s.copy()` 后执行 `set_vacuum` 的第 1–5、7、9、10 步（轴置换、左手重标号、接上、c 正交、标准取向、面内包裹），**保持当前间隙**（c·n̂ 不变），底层原子移到 z = 0；**不改 pbc**、不写 `info.surface` 的新字段（保留输入的块）、不改名；结果的上表面 = 输入按 F0 规则判定的上表面（+a_k 一侧），左手输入也一样。`surface_normal(s).surface` 为假 → `ValueError(f"'{s.name}': {vacuum_gap_hint(s)}")`。
- **消费方**：**M6 `prepare_layer` 的第 1–5 步**（R-F22，L-M6-02）。
- **已解决的冲突**：M6 v2 §10.4 撤回了 `standardize_slab` 并自写准备步骤 → 恢复为 M6 的依赖（自写版本在左手晶胞上会用另一面）；M6 工程审查 #5 的"二选一"取前者。

### L-M2-06 共用数据：`webdata`、氧化态、元素集合与电负性表

- **提供方**：M2 T2（第 1 波）。**文件**：`crystallume/core/webdata.py`、`web/js/core/webdata.js`（**[改]** 归属：M5 v2 说 F0-D，F0 账本未列，R-F30）；`crystallume/web/data/oxidation_states.json`；`crystallume/core/elements.py`（`METALS`、`ANIONS`、电负性）；`web/js/core/elements.js`（只补电负性缺项）。
- **Python**：`load_web_data(name: str) -> Any`（M5 §4.2 的代码原样：文件名须匹配 `^[a-z0-9_]+\.json$`，否则 `ValueError("invalid data file name 'x'")`；缓存、返回深拷贝）；`load_oxidation_states() -> dict`；`estimate_oxidation_states(symbols) -> dict[str, float] | None`；`METALS: frozenset[str]`、`ANIONS: frozenset[str]`（与 JS `core/elements.js:160-166` 逐项相同，测试核对）。
- **JS**：`loadWebData(name) → Promise`、`webData(name) → value | null`、`setWebData(name, value)`（M5 §4.2 原样）；`loadOxidationStates() → Promise`、`estimateOxidationStates(symbols)`（表未加载且未给 `charges` 时抛错）。启动：`registerBootTask('oxidation-states', loadOxidationStates)`（L-F0-56；M2 不改 `main.js` 的启动顺序）。
- **电负性**（**[新]**，M5 v2 §10 F0-D 行的"请求（更正）"，F0 账本未列）：Python 的 Pauling 电负性表与 JS `PAULING` 逐项相同，JS 补上 Pm、Rn、Am–Lr；`display_formula` 与 JS `formula()` 的元素顺序因此在全部元素上一致。
- **消费方**：M2（极性、Tasker）；M3 T3a（`METALS`/`ANIONS`：smart 规则）；M4（`METALS`：基底判定，不得在 `analysis/fragments.py` 另定义）；M5（`webdata` 读吸附物库、`METALS`/`ANIONS`）；M6（`METALS`/`ANIONS`：离子型层的阳离子半径）。
- **已解决的冲突**：R-F30；F0-D v2 §10 的"`METALS` 由 M4 在 `analysis/fragments.py` 定义"→ F0 账本 L-F0-22 已改为 M2 T2，本条一致；M6 v2 T0 的"M2/M4 未加时由 M6 加"作废。

### L-M2-07 命名函数：`reduced_formula`、`surface_label`、`surface_name`、`adsorbate_suffix`、`normalize_surface_info`、`is_auto_named`、`auto_name_state`、`refresh_auto_name`

- **提供方**：M2 T4（Python）、T6b（JS）。**文件**：`core/naming.py`、`web/js/core/naming.js`。
- **Python**：
  ```python
  def reduced_formula(symbols_or_composition) -> str     # 约化（除以 gcd），display_formula 的元素顺序（Pauling；C 与 H 同在时 Hill）
  def surface_label(x) -> str | None                     # x：Structure 或 info.surface 字典；"Ni(111)"、"ZnO(10-10)"；没有块或 kind ≠ "cleave" → None
  def normalize_surface_info(surface: dict) -> dict      # v1 → v2 的读取兼容（L-X-01），返回新字典
  def surface_name(structure) -> str | None              # L-X-07
  def adsorbate_suffix(structure) -> str                 # L-X-07
  def is_auto_named(structure) -> bool
  def auto_name_state(structure) -> dict                 # [新] {"name", "suffix", "auto"}；编辑之前调用（L-X-07）
  def refresh_auto_name(structure, before: dict, *, cell_change: dict | None = None) -> bool   # [改] was_auto → before
  ```
- **JS**：`reducedFormula`、`surfaceLabel`、`normalizeSurfaceInfo`、`surfaceName`、`adsorbateSuffix`、`isAutoNamed`、`autoNameState(s) → { name, suffix, auto }`、`refreshAutoName(s, before, { cellChange })`。
- **语义**：L-X-07；`surface_label(x)` = `surface_name` 的第一段（`reduced_formula(bulk) + miller_token(idx)`，翻转后的指数同样生效）。
- **消费方**：M1（`auto_name_state`、`refresh_auto_name`）；M5（`adsorbate_suffix`、`auto_name_state`、`refresh_auto_name`，**不再**自己拼名字，也不写 `baseName`）；M6（`surface_label`、`reduced_formula`、`interface_name` 内部、`refresh_auto_name`）；M2 自己。
- **已解决的冲突**：R-F15（负责人决定 L-12）、R-F33；M6 工程审查 #18 的"`display_formula(reduce=True)` 不存在"→ `reduced_formula`；M5 v2 `adsorbate_suffix` 的归属 → 由 M2 在第 1 波实现（M1 的超胞在第 1、2 波就需要它），M5 `build/adsorbate.*` 只重新导出。

### L-M2-08 网页：Cleave、Slab 分区与公共 API

- **提供方**：M2 T9、T10。**文件**：`web/js/ui/panels/surface-cleave.js`、`web/js/ui/panels/surface-slab.js`（新）。
- **分区**：`registerPanelSection('surface', { id: 'cleave', order: 10 })`、`{ id: 'slab', order: 20 }`。Cleave 的真空为空时不开 P-swap 会话（只用 `planeLayer` 叠加层与层堆叠图），Create 不可用、tip `Enter the vacuum (total gap in Å; 0 for none).`；Create 后 `ses.commit({ addAsNew: true, name })` 或 `addStructure(slab, { replaceProject: false })`。Slab 分区**内嵌** M1 的 `supercellEditor(el, app, { owner: 'surface.slab', surface: true })`（**[改]** 负责人决定 L-16，L-M1-16），不另写编辑器、不另算预设（预设相对 `reference_mesh`）。**[改]** 信息行的网格倍数提示（负责人决定 L-08）：`Using the input cell: the surface cell has N times the area of the smallest one.`，`wood_label` 有结果时在句号前附上 `, <Wood>`，如 `Using the input cell: the surface cell has 2 times the area of the smallest one, (√2×√2)R45°.`、`… has 4 times the area of the smallest one, p(2×2).`（取代 M2 v2 的 `the surface cell is a 2 × 2 multiple of the smallest one`）。
- **命令**：`surface.cleave` 参数（M2 §5.7）中**[改]** `wood`（string）→ `spec`（string，M1 的语法），`supercell`（imatrix 2×2）保留，两者最多给一个；`fixAxes` 为 string（按 R-F09 的语法校验）；`vacuum: {type: 'float', unit: 'Å', min: 0, required: true}`（L-F0-52 V3）。
- **公共 API**（`defineApi`，owner `M2`）：`build.surface(bulk?, params)`、`build.terminations(bulk?, params)`、`surface.cleave(params)`、`edit.setVacuum`、`edit.addVacuum`、`edit.centerSlab`、`edit.flipSlab`。
- **已解决的冲突**：R-F04（嵌入，负责人决定 L-16）、R-F38；F0 账本 §6 M2 第 6 条（`banner` → 不传）；验收 G-24（负责人决定 L-08）。

### L-M2-09 REST、客户端、CLI

- **提供方**：M2 T8。**文件**：`server/models.py`、`server/routes/build.py`、`server/routes/analysis.py`、`client.py`、`cli.py`。
- **REST**（M2 §6.3）：`POST /api/v1/build/surface`（`SurfaceRequest`）、`POST /api/v1/build/vacuum`（`VacuumRequest`）、`POST /api/v1/analysis/terminations`（`TerminationsRequest`）。**[改]**：三个新模型 `extra="forbid"`；`vacuum: float = Field(..., ge=0, le=1000)`；`supercell: list[Row2] (2×2) | Row2 | str | None`（文本经 M1 语法）；`fixAxes: str`（R-F09 语法，非法 → 400）；`position` 字面量不变。
- **客户端**：`surface(self, structure, miller, *, vacuum, **kw)`、`set_vacuum(self, structure, vacuum, **kw)`、`terminations(self, structure, miller, **kw)`；`ROUTE_METHODS` 三条。
- **CLI**（**[改]** 按 §0.3）：
  ```
  crystallume build surface BULK (--hkl H K L | --hkil H K I L) --vacuum V [--from FMT] [--index N]
          [--layers N | --periods N | --thickness A] [--conventional-indices] [--termination N|LABEL] [--cut K] [--symmetric]
          [--position center|bottom] [--offset A] [--surface-cell SPEC] [--no-primitive] [--translation-tol T]
          [--fix-bottom N | --fix-middle N] [--axes AXES] [--layer-tol A] [--charges "Sr=2,Ti=4,O=-2"] [--keep-molecules]
          [--name NAME] [-o OUT] [--format FMT]
  crystallume terminations BULK (--hkl H K L | --hkil H K I L) [--format FMT] [--index N] [--conventional-indices]
          [--no-primitive] [--translation-tol T] [--layer-tol A] [--charges …] [--json]
  crystallume edit vacuum IN --vacuum V [--axis a|b|c] [--position center|bottom|keep] [--offset A]
          [--keep-c-direction] [--no-reorient] [--from FMT] [--index N] [-o OUT] [--format FMT]
  crystallume edit flip IN [--from FMT] [--index N] [-o OUT] [--format FMT]
  crystallume edit center-slab IN [--from FMT] [--index N] [-o OUT] [--format FMT]
  ```
  `--supercell NX NY`、`--supercell-matrix …`、`--wood TEXT` 删除（`--surface-cell 3x3`、`--surface-cell "2 1; -1 1"`、`--surface-cell "(√3×√3)R30°"` 代替）；`terminations` 的输入格式是 `--format`（只读命令）。
- **已解决的冲突**：R-F13、R-F14。

---

## 5. M3 层、几何选择与约束提供的条目（L-M3-01 … L-M3-10）

### L-M3-01 方向解析与层分析：`find_layers`、`Layers`

- **提供方**：M3 T1。**文件**：`crystallume/analysis/layers.py`（`analysis.__all__`）、`web/js/core/layers.js`。
- **Python**：
  ```python
  def find_layers(structure, direction=None, tolerance=None, *, indices=None, skip_adsorbates=False,
                  group="planes") -> Layers          # Layers 的字段按 M3 §6.1（index, from_top, height, offset, heights, spans, atoms, composition,
                                                       # rows, planes, normal, direction, normal_source, axis, tolerance, group, coords, period, vacuum,
                                                       # straddles, spans_period, excluded, adsorbates, warnings；count、layer(k)、top_layer(k)、select(...)、to_dict()）
  ```
- **JS**：`findLayers(s, { direction = null, tolerance = null, indices = null, skipAdsorbates = false, group = 'planes' } = {})`、`findLayersCached(s, opts)`、`layersToJSON(result)`（与 `Layers.to_dict()` 逐键相同、不取整）。
- **语义**：方向见 §1.7（R-F07）；聚类为线性单链、严格 `gap > tol`；容差 `0 < tol ≤ layer_tolerance_max`（5 Å）；高度 `h_i = (x·n0 + y·n1) + z·n2` 的运算顺序写死。**[改]** 沿 slab 轴的周期情形：`sn = surface_normal(s, require_gap=True)` 且 `sn.axis == axis` → `f' = unwrap_along_gap(f_axis, sn.cut)`（L-F0-16，窗口 `[cut.lo, cut.lo + 1)`），`offset_i = f_i − f'_i`；非 slab 的周期方向照 M3 §3.3 的环上规则；无理方向 `coords = "wrapped"`。`group="units"` 按 `info.surface.bulk.reducedFormula`（缺失时用参与原子的约化组成）分组。`skip_adsorbates` 的吸附物来自 `find_adsorbates`（L-M3-04）。Python 不缓存；JS 按结构、内容摘要与解析后的参数缓存（不含 `selective_dynamics`）。
- **错误**：M3 §3.16（`direction 'normal' needs a vacuum gap or a non-periodic axis; use 'c'`、`tolerance must be > 0 Å (got 0)` 等）。
- **消费方**：M2（构建后的校验 `find_layers(slab, "c", info.surface.layerTolerance)`；终止面枚举用 OUC 的周期模式）；M5（不直接调用：位点的层号用 L-M3-02 在自己的面坐标里算）；M6（空位预设的次表层 `find_layers(s, "normal", skip_adsorbates=True)`）；M3 自己的选择与固定；公共 API。
- **已解决的冲突**：R-F07；简报 §3 的 `tolerance=SURFACE_DEFAULTS.layer_tolerance` → `None`（先读 `info.surface.layerTolerance`）；M3 v2 §3.3 的"`find_vacuum_gap(min_width=0)` + 中点映射到 (−0.5, 0.5]"→ 上面的切口（F0 账本 §6 M3 第 2 条）。

### L-M3-02 一维单链聚类 `cluster_heights`（**[新]** 导出，M5 v2 §10 请求）

- **提供方**：M3 T1（把 §3.4 的聚类核心导出为纯函数）。**文件**：`analysis/layers.py`、`core/layers.js`。
- **Python**：`cluster_heights(heights, tolerance: float, *, descending: bool = False) -> np.ndarray`（int，长度 = len(heights)）
- **JS**：`clusterHeights(heights, tolerance, { descending = false } = {}) → Int32Array`
- **语义**：按高度稳定排序（同值按下标），相邻差 `> tolerance` 处开新簇；簇号 0 = 最低（`descending=True` 时 0 = 最高）；`tolerance` 须为有限正数，否则 M3 §3.16 的容差文案。与 `find_layers` 内部的聚类逐位相同（同一实现）。
- **消费方**：M5 `site_atoms` 的 `auto`/`layers` 方法（`descending=True` 得到"0 = 该面最外层"）、上下对称操作的层判定。
- **已解决的冲突**：R-F25。

### L-M3-03 化学键图：`bond_graph`、`coordination_numbers`、`periodic_components`

- **提供方**：M3 T3a（第 1 波）。**文件**：`crystallume/analysis/neighbors.py`（追加）、`web/js/core/bondgraph.js`（新）。
- **Python**：
  ```python
  @dataclass(frozen=True)
  class BondGraph:
      indptr: np.ndarray; neighbors: np.ndarray; offsets: np.ndarray; distances: np.ndarray
      def degree(self) -> np.ndarray: ...
  def bond_graph(structure, *, metal_pairs: str = "all", indices=None) -> BondGraph          # metal_pairs: "all" | "smart"
  def coordination_numbers(structure, *, metal_pairs: str = "smart", graph=None) -> np.ndarray
  def periodic_components(graph: BondGraph, indices=None) -> list[tuple[list[int], bool]]   # [新]
  ```
- **JS**：`bondGraph(s, { metalPairs = 'all', indices = null } = {}) → { indptr, neighbors, offsets, distances }`、`bondGraphCached`、`coordinationNumbers(s, { metalPairs = 'smart', graph } = {}) → Int32Array`、`periodicComponents(graph, indices = null) → [{ members, periodic }]`。
- **语义**：判据 `bond_min < d < min(bond_max, bond_scale·(r_i + r_j))`（0.4 / 5.0 / 1.15，F0 统一的 Cordero 共价半径，未知元素 0.5 Å）；按周期像逐条计数（边带整数像偏移）；距离 `sqrt(dx*dx + dy*dy + dz*dz)`；不读显示设置。smart 规则与 F0-A 显示的 smart 键（L-F0-55）同一定义（`METALS`/`ANIONS` 来自 L-M2-06）。`periodic_components`：在 `indices`（缺省全部）诱导的子图上求连通块（按像偏移做 BFS），`periodic` = 该块到达了自身的一个非零平移像（无限延伸的网络）；块按最小成员下标排序，成员升序。
- **消费方**：M2（断键数与配位）；M4（基底掩码、片段、`moving_group`；**不再**自写 `bond_graph`）；M5（smart 配位数、有效半径、有限片段 `loose`）；M3 自己（吸附物识别、查询 `cn`）。
- **已解决的冲突**：R-F25；M4 v2 §6.2 的 `analysis/fragments.py` 里的 `BondGraph(NamedTuple)`（没有 `distances`）→ 用本条。

### L-M3-04 吸附物识别与标记：`find_adsorbates`、`promote_adsorbates`、`mark_adsorbates`、`unmark_adsorbates`、`tags_convention`

- **提供方**：M3 T3a。**文件**：`analysis/layers.py`、`core/layers.js`、`core/structure.*`（方法）。
- **Python**：
  ```python
  def find_adsorbates(structure, *, direction=None, tolerance=None, details=False) -> tuple[list[int], str] | dict
      # source ∈ "adsorbate_id" | "tags-oc20" | "tags" | "geometry" | "none"
  def promote_adsorbates(structure) -> int              # 原位；没有 adsorbate_id > 0 时把识别出的吸附物按成键片段编号 1, 2, …；返回块数
  def mark_adsorbates(structure, indices) -> int        # 原位；先 promote，再按成键组分配 next_adsorbate_id(...) 起的新 id；返回新组数
  def unmark_adsorbates(structure, indices=None) -> int # 原位；置 0（键保留）；返回改变的原子数
  def tags_convention(structure) -> str | None          # [新] "oc20" | "ase" | None
  Structure.mark_adsorbates(self, indices) -> Structure ; Structure.unmark_adsorbates(self, indices=None) -> Structure
  ```
- **JS**：`findAdsorbates(s, { direction, tolerance, details = false })`、`promoteAdsorbates(s)`、`markAdsorbates(s, indices)`、`unmarkAdsorbates(s, indices = null)`、`tagsConvention(s)`。
- **语义**：识别顺序 `adsorbate_id` > tags（OC20 约定、ASE 约定）> 几何猜测 > 无（M3 §3.8）。`tags_convention`：没有 `tags` 键 → None；M3 §3.8 第 2a 条成立（值域 ⊆ {0, 1, 2}、含 2、含 0 或 1，且 tag 2 的原子不构成无限延伸的块）→ `"oc20"`；否则 → `"ase"`。标记与取消标记**不写吸附物记录**、不删记录、不调用 `mark_edited`（R-ADS 第 5、6 条）。
- **消费方**：M2（`slab_extent(exclude_adsorbates=True)`）；M4（基底掩码第一来源；第一次写 id 前 `promote_adsorbates`）；M5（吸附物与基底、R-ADS 的 promote、新原子的 tags；**"Mark as adsorbate"就是本条**）；M6（参考网格的 `exclude`、合并前对层副本 promote）；M1 无。
- **已解决的冲突**：R-F21（M5 v2 的 `mark_adsorbate(slab, indices, name)` 与 `crystallume.edit.markAdsorbate` 删除，名字参数不提供）；R-F25（`tags_convention`）。

### L-M3-05 暴露原子 `surface_atoms`

- **提供方**：M3 T3b（第 2 波早期）。**文件**：`analysis/layers.py`、`core/layers.js`。
- **Python**：`surface_atoms(structure, side="top", *, probe=None, direction=None, tolerance=None, skip_adsorbates=True, details=False) -> list[int] | dict`
- **JS**：`surfaceAtoms(s, { side = 'top', probe = null, direction, tolerance, skipAdsorbates = true, details = false } = {})`
- **语义**：M3 §3.9 的闭式探针判据；`probe` 是相对统一原子半径 R 的比例（缺省 `surface_probe` = 0.70），**不是 Å**；`details` 给 `{top, bottom, radius, probe, probeRadius, exposure, borderline}`；没有表面时用 `vacuum_gap_hint` 的文案（经 `require_gap`）。
- **消费方**：M5 `site_atoms(method="exposed")`、密堆微面三重位的补全；M4 移动工具的吸附目标（应该项）；查询属性 `surface`。
- **已解决的冲突**：R-F06。

### L-M3-06 几何选择与查询：`select_layers`、`select_height`、`select_fractional`、`select_within`、`select_where`

- **提供方**：M3 T1（`select_layers`）、T5（其余与查询引擎）。**文件**：`analysis/layers.py`（`select_layers`）、`crystallume/analysis/selection.py`、`web/js/core/selection.js`。
- **签名**：M3 §6.1/§6.2 原文（`select_height(s, lo=None, hi=None, *, relative_to="absolute", …)`、`select_fractional(s, axis, lo, hi)`、`select_within(s, centers=None, radius=3.0, *, point=None, centroid=False)`、`parse_query(query)`、`select_where(s, query, *, selection=None)`、`combine_selection(current, matches, mode="replace")`、`QUERY_VERSION = 1`、`QUERY_PROPS`；JS 同名 camelCase）。
- **语义**：只读，返回升序下标；长度比较带 `position_tolerance`；`select_within` 用 F0-D 的精确最小像（L-F0-20）；`select_fractional` 用 `wrap_fractional`（L-F0-19）。查询 JSON 的属性含 `adsorbate`（`adsorbate_id > 0`）与 `adsorbateId`（M5 需要）。
- **消费方**：M5（Atom Selection 选吸附物）；M4（"Select fragment"之外的选择）；公共 API。
- **已解决的冲突**：无。

### L-M3-07 约束封装：`fix`、`free`、`fix_layers`、`fix_height`、`fixed_indices`

- **提供方**：M3 T4。**文件**：`core/structure.*`（方法）、`analysis/layers.py`（报告版）、`core/layers.js`（JS 纯函数 `fixLayers`、`fixHeight`）。
- **Python**：
  ```python
  Structure.fix(self, indices, axes="abc") -> Structure
  Structure.free(self, indices=None, axes="abc") -> Structure          # indices=None 且三个轴 → clear_constraints（删键）
  Structure.fix_layers(self, *, bottom=None, top=None, middle=None, all_but_top=None, top_layers=None, layer_indices=None,
                       axes="abc", replace=True, group="planes", direction=None, tolerance=None, skip_adsorbates=True) -> Structure
  Structure.fix_height(self, depth=None, *, bottom_thickness=None, axes="abc", replace=True, direction=None, tolerance=None,
                       skip_adsorbates=True) -> Structure
  Structure.fixed_indices(self, kind="any") -> list[int]
  def fix_layers(structure, **selector_and_options) -> dict           # 报告 {fixed, freed, changed, previouslyConstrained, warnings}
  def fix_height(structure, depth=None, *, bottom_thickness=None, **options) -> dict
  ```
- **JS**：`Structure.prototype.fix(indices, { axes = 'abc' } = {})`、`free(indices = null, { axes = 'abc' } = {})`、`fixedIndices(kind = 'any')`；`fixLayers(s, opts) → report`、`fixHeight(s, opts) → report`（`core/layers.js` 纯函数）。
- **语义**：建在 F0-D `move_flags`/`set_move_flags`/`clear_constraints`/`cartesian_to_lattice_flags` 上（L-F0-13）；`axes` 列出**被固定**的方向，语法：`"abc"` 的非空子集，或含 x/y/z 的名字（`"z"`、`"xy"`、`"xyz"`）经 `cartesian_to_lattice_flags` 精确换算，不精确时报 M3 §3.16 的文案；按层/按高度是设定语义（K9），`replace=False` 为累加；`middle=N` 要求 `L − N` 为偶数。`constraint_summary`、`move_flags`、`axis_labels`、`cartesian_name` 是 F0-D 的（M3 不重复定义）。
- **消费方**：M2 切面时**不**调用（直接按构建层号写，R-F09），但结果必须与 `fix_layers(bottom=N, axes=…)` 相同；CLI `edit fix`；网页 Layers 分区与选区动作。
- **已解决的冲突**：R-F09；F0 账本 §6 M3 第 1 条（`constraint_counts` → `constraint_summary`）。

### L-M3-08 按层写 tags：`set_tags_from_layers`（**[新]** Python 接口）

- **提供方**：M3 T6（网页）、T4（Python，**[新]**）。**文件**：`analysis/layers.py`、`core/layers.js`、`core/structure.*`。
- **Python**：`set_tags_from_layers(structure, *, group="planes", direction=None, tolerance=None, skip_adsorbates=True) -> int`（原位；返回写入的原子数）；`Structure.set_tags_from_layers(self, **same) -> Structure`。
- **JS**：`setTagsFromLayers(s, { group, direction, tolerance, skipAdsorbates }) → number`。
- **语义**：`tags` = `find_layers(...)` 的 `from_top + 1`（行 = 原子面或单元），吸附物与未聚类的原子 0；不调用 `mark_edited`；网页命令 `layers.writeTags`、公共 API `edit.setTagsFromLayers({ group })`（M3 §5.6、§6.2 已有，Python 侧 M3 §6.1 缺，P6 补上）。
- **消费方**：M4 的建议（导入的 slab 先写 tags，让基底识别走 tags）；需要 ASE tags 的用户。
- **已解决的冲突**：M3 v2 §6.1 缺 Python 入口（P6）。

### L-M3-09 网页：Layers 分区、约束界面、命令与公共 API

- **提供方**：M3 T6–T10。**文件**：M3 §9（`ui/panels/surface-layers.js`、`ui/constraints.js`、`ui/atomselection.js`、`app.js` 的 M3 段）；**不改** `api/public.js`。
- **要点**（F0 账本 §6 M3 已列的不重复）：`registerPanelSection('surface', { id: 'layers', order: 30 })`、`registerPanelSection('structure', { id: 'constraints', slot: 'transform', order: 20 })`；选区动作 Fix ▾（order 35）、`sel.markAdsorbate`（order 70）；`registerAtomInfo` 的悬停行；`app.setConstraints(indices, op, opts)`、`app.layerOptions()`/`setLayerOptions(patch)`、`app.layers()`、`app.adsorbates()`、`app.markAdsorbates(indices, { unmark })`、`app.selectWhere(query, { mode })`；`editActive(…, { rebuild: 'appearance' \| 'none' })`。
- **公共 API**（`defineApi`，owner `M3`）：`analysis.layers`、`analysis.adsorbates`、`analysis.surfaceAtoms`、`analysis.cn`；顶层 `matchQuery`、`selectWhere`、`selectLayers`、`selectWithin`；`edit.fix`、`edit.free`、`edit.freeAll`、`edit.fixLayers`、`edit.fixHeight`、`edit.markAdsorbates`、`edit.unmarkAdsorbates`、`edit.setTagsFromLayers`。
- **已解决的冲突**：R-F21（`edit.markAdsorbates` 是唯一的标记入口）；F0 账本 §6 M3 第 5、8 条。

### L-M3-10 REST、客户端、CLI

- **提供方**：M3 T11a。
- **REST**：`POST /api/v1/analysis/layers`（`LayersRequest`，**[改]** `extra="forbid"`；`skipAdsorbates: bool = True`）；可选 `POST /api/v1/analysis/select`。**客户端**：`layers(self, structure, direction=None, tolerance=None, skip_adsorbates=True, group="planes", surface=False, probe=None) -> dict`。
- **CLI**（**[改]** 按 §0.3）：
  ```
  crystallume layers FILE [--format FMT] [--index N] [--direction {auto,normal,a,b,c,x,y,z}] [--vector X Y Z]
                          [--hkl H K L | --hkil H K I L] [--layer-tol T] [--include-adsorbates] [--group {planes,units}]
                          [--surface] [--probe K] [--json]
  crystallume edit fix FILE (--bottom N | --top N | --middle N | --all-but-top N | --layers 1,2 | --depth D | --bottom-thickness T
                            | --atoms SPEC) [--axes AXES] [--keep-other] [--group {planes,units}] [--direction …] [--layer-tol T]
                            [--from FMT] [--index N] [-o OUT] [--format FMT]
  crystallume edit free FILE (--all | --atoms SPEC) [--axes AXES] [--from FMT] [--index N] [-o OUT] [--format FMT]
  ```
  `--frame N` → `--index N`；`--to FMT` → `--format FMT`；`SPEC` 为 0 起的下标（`0-35,40`），`--layers` 的层号从顶层 1 起。
- **已解决的冲突**：R-F13、R-F14。

---

## 6. M4 原子操作提供的条目（L-M4-01 … L-M4-08）

M4 用到的第 0 波接口按 F0 账本 §6 M4（`mic_vector`/`micVector` 由 F0-D T9 交付；`keep_frame(index=0)`；JS `extend` 由 F0-D T2 实现；`edit_frame` 用 `display_cuts`）。

### L-M4-01 `Structure` 的几何编辑方法

- **提供方**：M4 T1–T3。**文件**：`core/structure.py`、`web/js/core/structure.js`。
- **Python**（M4 §6.1；ASE 的名字、参数顺序与默认值，新参数仅限关键字）：`translate(vector, *, indices=None, frac=False)`、`move_to(position, *, indices=None, anchor="centroid", frac=False, mic=True)`、`rotate(a, v, center=(0, 0, 0), rotate_cell=False, *, indices=None, mic=False)`、`mirror(normal, center=(0, 0, 0), *, indices=None, mic=False)`、`get_centroid(indices=None, *, mic=False, weights=None)`、`set_distance(a0, a1, distance, fix=0.5, mic=False, mask=None, indices=None, add=False, factor=False, *, move=None, images=None)`、`set_angle(a1, a2, a3, angle, mask=None, indices=None, add=False, *, mic=False, images=None, move=None, toward=None)`、`set_dihedral(a1, a2, a3, a4, angle, mask=None, indices=None, *, add=False, mic=False, images=None, move=None)`、`rotate_dihedral(...)`、`get_tilt/get_azimuth/set_tilt/set_azimuth`（应该）、`get_distance/get_angle/get_dihedral(..., *, images=None)`（扩）。原位方法返回 self。
- **JS**：M4 §6.3 的同名 camelCase（选项对象）。
- **语义**：M4 §3；`mic=True` = 所有周期轴上的精确最小像（L-F0-20）；`move=` 给出时用 GUI 语义的编辑坐标系（`edit_frame`，L-M4-04）；移动部分原子 `set_positions(..., mark="positions")`；多帧时 `rotate`、`mirror`、`move_to`、`set_*` 报 §0.3 的单帧句式，`translate` 保持所有帧。
- **消费方**：用户与脚本；M1 `shift_origin`（`translate(t, frac=…)`）。
- **已解决的冲突**：M4 v2 的 `keep_frame(self, i)`（无缺省）→ F0 的 `keep_frame(index=0)`。

### L-M4-02 加原子与合并：`add_atom`、`extend` 的放置参数

- **提供方**：M4 T2（在 F0-D 的 `append`/`addAtom`/`extend` 上追加仅限关键字的参数，不改前面的参数）。**文件**：同上。
- **Python**：
  ```python
  def add_atom(self, symbol, position, props=None, *, frac=False, adsorbate=False) -> int          # 返回新下标（"原位返回 self"的例外）
  def extend(self, other, *, offset=None, rotation=None, center=None, position=None, anchor="centroid", normal=None,
             orient=None, mic=False, frame=None, adsorbate=False, keep_props=True, renumber_adsorbates=True) -> Structure
  ```
- **JS**：`addAtom(symbol, xyz, props = {}, { frac = false, adsorbate = false } = {}) → index`；`extend(other, { offset, rotation, center, position, anchor = 'centroid', normal, orient, mic = false, frame, adsorbate = false, keepProps = true, renumberAdsorbates = true } = {}) → this`。
- **语义**：M4 §3.9.7、§3.9.8、§3.10.5；`adsorbate=True`（表面放置）遵守 R-ADS（L-X-05）：**[改]** 新原子 `tags = 2`（`tags_convention == "oc20"` 时）否则 0；编辑前按元素分块时插入后 `sort_by_species()`；每个载荷成键片段一个新 id（从 `next_adsorbate_id` 起）；先 `promote_adsorbates`。`keep_props=False` 只重置约束与 tags、不写 id。`adsorbate=False` 时 F0-D 的 `renumber_adsorbates=True` 语义保留（后来者的非零 id 加 `next_adsorbate_id(self) − 1`）。`other` 的约束在晶胞不同时经 `apply_basis_change` 换算。
- **消费方**：M4 自己的粘贴、插入、加原子；**M5 不经此插入吸附物**（R-F11，M5 用 F0-D 的 `_remap`）；M6 不用（用 `concat_structures`）。
- **已解决的冲突**：R-F10、R-F11；M4 §3.9.8 末句"M5 放吸附物可直接用 `extend(..., adsorbate=True)`"撤回。

### L-M4-03 几何辅助：`rotation_matrix`、`align_rotation`

- **提供方**：M4 T1。**文件**：`crystallume/analysis/geometry.py`、`web/js/core/geometry.js`（F0-D T9 建立，M4 追加；`mic_vector`/`micVector` 是 F0-D 的）。
- **Python**：`rotation_matrix(axis, angle) -> ndarray(3, 3)`（右手 Rodrigues，度）、`align_rotation(src, dst) -> ndarray(3, 3)`（两矢量形式）。**JS**：`rotationMatrix(axis, angleDeg)`、`alignRotation(src, dst)`。
- **语义**：旋转矩阵作用于列矢量 `p' = R @ p`，行矢量数组 `P' = P @ R.T`（M4 §3.1）；轴长 < 1e-12 报错。
- **消费方**：M4；M5（可选：取向中的"把 A 转到 B"）。
- **已解决的冲突**：M4 v2 T1 的 `mic_vector` 归 F0-D T9（F0 账本 R11）。

### L-M4-04 编辑坐标系与片段：`edit_frame`、`vacuum_aware_vector`、`substrate_mask`、`molecule_of`、`moving_group`、`unwrap_group`、`component`、`chain_images`

- **提供方**：M4 T2–T4。**文件**：`crystallume/analysis/fragments.py`、`web/js/core/fragments.js`。
- **签名**：M4 §6.2/§6.3 原文，**[改]** 去掉 `fragments` 里的 `BondGraph`/`bond_graph`（用 M3 的 L-M3-03，`metal_pairs="all"`）；`METALS` 从 `core/elements` 导入（L-M2-06）。
- **语义**：`edit_frame(s)`：`cuts = display_cuts(s)`，有切口的轴 `shift_i,k = −floor(f_i,k − cuts[k].lo)`、不取最小像；其余周期轴为 `mic_axes`（F0 账本 §6 M4 第 2 条）。`substrate_mask` 以 M3 `find_adsorbates` 为第一来源；`moving_group` 按 M4 §3.6（基底优先，约束不决定移动哪一侧）。
- **消费方**：M4 的移动工具、数值变换、设定几何、粘贴；M5（可选：`molecule_of`、`unwrap_group` 用于自定义吸附物"Use selection"）。
- **已解决的冲突**：L-M3-03 的冲突说明。

### L-M4-05 放置：`site_point`、`surface_side`、`anchor_point`、`orient_rotation`、`parse_element`

- **提供方**：M4 T5。**文件**：`crystallume/analysis/placement.py`、`web/js/core/placement.js`。
- **Python**：`site_point(structure, atoms, *, images=None, bond=None, height=None, side="auto", symbol=None) -> SitePoint`（`SitePoint(point, normal, side, height, bond, contacts, label)`）、`surface_side(structure, points, side="auto")`、`anchor_point(structure, mode="binding", *, normal=None)`、`orient_rotation(structure, mode, normal, *, anchor)`、`parse_element(text) -> str`。**JS**：`sitePoint(s, atoms, { bond, height, side, symbol })`、`surfaceSide`、`anchorPoint`、`orientRotation`、`parseElement`。
- **语义**：M4 §3.9：接触抬升的闭式解 `t* = max_j [h_j + sqrt(d² − ρ_j²)]`（j 为面内距离 ρ_j < d 的基底原子，取离 c 最近的像），默认键长（**[改]** 负责人决定 L-05）：X 是吸附物库里的单原子条目时逐个接触原子取 `d_j = adsorbate_target_distance(s, X, j, site_kind=k)["distance"]`（L-M5-05；`k` 由所选原子数定：1 → `"top"`，2 → `"bridge"`，≥ 3 → `"hollow"`），闭式解相应写成 `t* = max_j [h_j + sqrt(d_j² − ρ_j²)]`，读数 `bond 1.94 Å (adsorbate library)`；否则 `d = place_bond_factor·(r_cov(X) + r_cov(M))`，读数 `bond 1.98 Å (covalent radii)`；用户填了键长时用用户的值；找不到可接触的原子时回退 `add_height`。M4 T5（第 2 波）先实现共价半径一支；M5 T5（第 3 波）提供 `adsorbate_target_distance` 并在同一任务里把 M4 `site_point` 取缺省键长的一处接上（测试 `test_m4_default_bond_from_library`：O 在 Cu(100) 4 重位、H 在 Pt(111) fcc，M4 与 M5 同一高度）。位点标签（`top`/`bridge`/`3-fold hollow (fcc|hcp)`/`4-fold hollow`）只用于读数，位点的分类与等价性属于 M5。
- **一致性**（**[新]**，R-F11）：对同一个单原子吸附物、同一个位点点 c、同一个键长 d，M4 `site_point(…, bond=d)` 的高度与 M5 `place_adsorbate(…, bond_length=d)` 的高度相差 ≤ 1e-9 Å（测试 `test_m4_m5_single_atom_height`，Pt(111) 的 top/bridge/fcc/hcp 与 Cu(100) 4 重位）。
- **消费方**：M4 的 Add atom（上方）、Place 工具、粘贴/插入的"上方"模式；公共 API `analysis.sitePoint`。
- **已解决的冲突**：R-F11。

### L-M4-06 剪贴板

- **提供方**：M4 T6。**文件**：`web/js/io/clipboard.js`、`web/js/core/edits.js`。
- **JS**：`CLIP_MIME = 'application/x-crystallume-atoms+json'`、`encodeClipboard(structure, indices, meta) → { json, text, payload }`、`decodeClipboard({ json, text }, memory) → payload | null`、`planPaste`、`pasteDefault`。
- **语义**：M4 §3.10；表面放置的粘贴按 R-ADS；完整的源吸附物复制其 `info.surface.adsorbates` 记录（`id` 改为新 id、`site = null`、`bonds = []`、`side` 为新的面；**不写 `firstAtom`**，R-F34）；目标没有 `info.surface` 时建 `kind: "adsorbates"` 的块（`autoName = 目标名`；M4 不改名，L-X-07）。extxyz 文本里的 `crystallume_clip=<id>` 按普通字符串往返（L-F0-24）。
- **消费方**：M4；M5（复制来的记录在列表里显示，`site = null` 时不显示"placed on"）。
- **已解决的冲突**：R-F34。

### L-M4-07 网页：移动工具、放置工具、Transform 分区与公共 API

- **提供方**：M4 T7–T10。**文件**：`web/js/render/tools/move.js`、`render/tools/place.js`、`ui/panels/transform.js` 等（M4 §9）。
- **要点**：`tools.register({ id: 'move', key: 'G', toolbar: true, selects: true, cursor: 'grab', touch: 'claim', … })`（L-F0-41）；`registerPanelSection('structure', { id: 'transform', slot: 'transform', order: 10 })`；选区动作 Move…（60）、Rotate…（61）；**吸附目标** `crystallume.tools.get('move').registerSnapTargets(provider: (structure) → [{ position: [x, y, z], label }]) → unregister`（M5 注册当前位点集合的 `position`）。
- **公共 API**（`defineApi`，owner `M4`）：M4 §6.4 的 `edit.translate`、`edit.moveAlongNormal`、`edit.moveTo`、`edit.rotate`、`edit.align`、`edit.setDistance`、`edit.setAngle`、`edit.setDihedral`、`edit.setTilt`、`edit.setAzimuth`、`edit.setGeometry`、`edit.movingGroup`、`edit.addAtom`、`edit.copy`、`edit.cut`、`edit.paste`、`edit.insert`、`edit.clipboard`；`analysis.sitePoint`。
- **已解决的冲突**：F0 账本 §6 M4 第 3、6 条。

### L-M4-08 CLI（应该）

- **提供方**：M4 T11。
- **CLI**（M4 §6.6，**[改]** 补上 §0.3 的输入输出选项）：`crystallume edit translate|rotate|set-distance|set-angle|set-dihedral|add-atom|merge IN … [--from FMT] [--index N] -o OUT [--format FMT]`；**[新]**（负责人决定 L-10，第 2 波，随 `edit` 组）`crystallume edit delete IN --atoms SPEC [--from FMT] [--index N] -o OUT [--format FMT]`：删除这些原子（`Structure.delete`，吸附物记录按 L-X-04 的"删除原子"规则保留、孤儿由 M5 回收），stderr `crystallume: note: deleted 1 atom (35 left)`；`SPEC` 与 M3 `edit fix --atoms` 同一写法（0 起的下标，`"0-35, 40"`，范围含两端）；越界 → 退出码 1，`atom index 40 out of range (structure has 36 atoms)`（与现有 `frame index … out of range` 同一句式，`core/structure.py:356`）。不加 REST（M4 K8）。
- **已解决的冲突**：R-F13（`edit` 组与 M2、M3 共用同一套输入输出选项）。

---

## 7. M5 吸附物提供的条目（L-M5-01 … L-M5-10）

### L-M5-01 吸附物库：`adsorbates.json`、加载与查找

- **提供方**：M5 T1（第 2 波起即可开工）。**文件**：`crystallume/web/data/adsorbates.json`（schema `crystallume.adsorbates/1`，52 个条目，M5 §4.1）、`build/adsorbate.py`（库部分）、`web/js/build/adsorbates.js`（库部分）。读取经 L-M2-06 的 `webdata`（**[改]** 不是 F0-D 的任务）。
- **Python**：`ADSORBATES: Mapping[str, dict]`（只读元数据视图）、`adsorbate_library() -> dict`（惰性、缓存、深拷贝；校验失败 `RuntimeError`）、`adsorbate_names() -> list[str]`、`adsorbate(name, mode=None, *, library=None) -> Adsorbate`、`adsorbate_from_dict(entry, mode=None)`、`adsorbate_from_structure(structure, binding=0, *, indices=None, kind=None, keep_orientation=False, normal=None, name=None)`；`Adsorbate`（M5 §6.1 的字段）的 `to_structure(cell=None, *, vacuum=None) -> Structure`。
- **JS**：`loadAdsorbateLibrary() → Promise<Library>`、`adsorbateLibrary() → Library | null`、`setAdsorbateLibrary(lib)`、`listAdsorbates(lib)`、`adsorbate(name, { mode, library })`（库未加载时抛 `The adsorbate library is not loaded yet.`）、`adsorbateFromDict`、`adsorbateFromStructure`。
- **语义**：查找顺序：与 `id` 完全相同 → 与元素符号完全相同（单原子）→ 不区分大小写匹配 `id`、`aliases`、`formula`、`name`；未知 → E20。**[改]** `to_structure`：`cell` 与 `vacuum` 都缺省 → 分子（无晶胞，`pbc = [F, F, F]`）；给 `cell` → 放进该晶胞（pbc 同输入的晶胞所属结构，缺省 `[T, T, T]`）；给 `vacuum` → **装箱：沿三根晶胞矢量与周期像之间的总间隙都是 `vacuum` Å**（盒长 = 分子在该方向的厚度 + `vacuum`，分子居中，`pbc = [T, T, T]`），不是"每侧 `vacuum`"（U4）；`0 ≤ vacuum ≤ max_vacuum`。网页启动：`registerBootTask('adsorbates', loadAdsorbateLibrary)`（L-F0-56，R-F31）。
- **消费方**：M5 放置与界面；脚本；M6 无。
- **已解决的冲突**：R-F30、R-F31；M5 v2 §6.1 `to_structure` 的"`vacuum` Å on every side"→ 总间隙（§9 合规）。

### L-M5-02 位点识别：`adsorption_sites`、`site_atoms`、`find_sites`、`SiteSet`、`crystallume.sites/1`

- **提供方**：M5 T3、T4。**文件**：`crystallume/analysis/sites.py`（`analysis.__all__` 导出 `adsorption_sites`、`site_atoms`、`find_sites`、`find_top_bottom_operation`、`assign_sites`、`site_presets`、`SiteSet`、`Site`、`SiteClass`）、`web/js/core/sites.js`、`core/delaunay.py`、`web/js/core/delaunay.js`。
- **Python**：`adsorption_sites(structure, *, side="top", method="auto", layers=None, window=None, probe=None, indices=None, exclude=None, include_adsorbates=False, fingerprint_adsorbates=False, top_normal="surface", kinds=("top", "bridge", "hollow"), tolerance=None, distance=None, frame=None, symmetry="fingerprint") -> SiteSet`；`site_atoms(structure, *, side="top", method="auto", …, details=False)`；`find_sites(site_set, key, side=None) -> list[Site]`（= `SiteSet.find`）。数据类按 M5 v2 §6.1。
- **JS**：`adsorptionSites(s, opts) → SiteSet`、`siteAtoms(s, opts)`、`findSites(siteSet, key, side)`、`siteSetToJSON(siteSet, { detail })`、`surfaceSetup(s, side, opts)`。
- **语义**（M5 §3）：
  - **[改]** 法向与切口：`ads = find_adsorbates(s).indices`（L-M3-04）∪ 有限片段 `loose`（L-M3-03 `periodic_components` 在基底子图上的非周期块，原子数 ≤ 基底的一半）；`sn = surface_normal(s, frame=frame, exclude=ads ∪ loose)`（L-F0-17 的 `exclude`，R-F27），`sn.surface` 为假 → E3（文案 `vacuum_gap_hint(s, exclude=…)`）；展开 `m_t = −floor(f_t − sn.cut.lo)`（= `unwrap_along_gap`）。只含基底的 `view(s, sub)` 仍用于 M5 自己的几何（配位数、Delaunay、指纹），不再用来求法向。
  - 位点原子 `method`：`auto`（缺省，M5 §3.2.1；层号用 L-M3-02 `cluster_heights(h, layer_tolerance, descending=True)`）、`exposed`（L-M3-05 `surface_atoms`）、`indices`、`layers`、`window`。M5 的概念叫**位点原子**，不叫"表面原子"（R-F06）。
  - 数字与标签一律用 L-M1-15（`format_decimal` 等）；`Site.point` 在 M5 §3.1 的展开坐标里，可能与存储坐标差整数个 `a_k`。
  - `crystallume.sites/1` 的字段按 M5 v2 §4.8（camelCase，坐标 6 位小数，`detail: "classes"` 时省略逐位点数组）。
- **消费方**：M5 放置；M6-S1（位点菜单与错位报告）；M4 的吸附目标（经 M5 注册）；公共 API。
- **已解决的冲突**：R-F06、R-F27；M5 v1 的 `findAdsorptionSites`、`getAdsorbate(lib, name)` → 上面的同词名字（M5 v2 已改）。

### L-M5-03 位点归属与预设：`assign_sites`、`site_presets`

- **提供方**：M5 T4。**文件**：同 L-M5-02。
- **Python**：`assign_sites(structure, *, side="both", site_set=None) -> list[dict]`；**[新]** `nearest_sites(site_set, points) -> list[dict]`（负责人决定 L-07 的界面配位记录要用；每个笛卡尔点一项 `{"site": Site.index, "class": int, "label": str, "kind": str, "subtype": str | None, "lateral": float, "height": float}`）；`site_presets(structure, *, side="top") -> dict[str, list[float]]`（`{"ontop", "bridge", "fcc", "hcp", "hollow", "shortbridge", "longbridge"}` → 面内两轴的分数坐标；没有对应类的键省略）。**JS**：`assignSites(s, { side, siteSet })`、`nearestSites(siteSet, points)`、`sitePresets(s, { side })`。
- **语义**：M5 §3.8（每个吸附物的结合原子最近的位点类、横向偏移、离位点的高度；`moved` 由 `site_moved_threshold` 判定）；`nearest_sites` 就是 `assign_sites` 内部的"最近位点"一步，单独导出：在位点集合里取点的面内投影最近的位点（面内最小像，并列取位点序在前者），`lateral` = 到 `Site.point` 的面内最小像距离（Å），`height` = 沿该位点 `normal` 的有符号距离；`assign_sites` 必须调用它（一处实现）。`site_presets` 取每个 ASE 关键字对应的第一个类的代表位点。
- **消费方**：M5 列表；**M6-S1**（"Snap to site"：在基底 slab 上调用 `site_presets` 或 `adsorption_sites(...).classes`）；**M6 构建后的配位记录**（`nearest_sites`，L-M6-03，负责人决定 L-07）。M6 的必须项预设（Top/Bridge/fcc/hcp/Hollow，M6 §3.8.3）是 M6 自己的几何规则；两者在 Pt(111)、Ru(0001)、Cu(100) 上给出同一组 fcc/hcp 分配（测试 `test_m6_presets_match_m5`）。
- **已解决的冲突**：M6 v1 期望的 `find_sites(slab, *, kinds=None) -> [{kind, position}]` → `site_presets`（M5 工程审查 #20）。

### L-M5-04 上下表面对称操作 `find_top_bottom_operation`

- **提供方**：M5 T11。**文件**：同 L-M5-02。
- **Python**：`find_top_bottom_operation(structure, tolerance=0.1, *, include_adsorbates=False, frame=None) -> dict | None`（`{"rotation": 3×3, "translation": [3], "kind": "inversion" | "mirror" | "rotation"}`，行矢量约定 `r' = r @ R + t`）。**JS**：`findTopBottomOperation(s, { tolerance = 0.1, includeAdsorbates = false, frame })`。
- **语义**：M5 §3.13（表面坐标系中、只用基底；二维点群候选 `ops2` 的次序写死；结果按基底摘要缓存）。
- **消费方**：M5 的两面放置；M2 可选 T14（`equivalence="operations"`，第二期）。
- **已解决的冲突**：无。

### L-M5-05 放置：`place_adsorbate`、`plan_adsorbates`、`apply_placements`、`add_adsorbate`、`add_adsorbates`、`remove_adsorbates`

- **提供方**：M5 T5、T6、T7。**文件**：`build/adsorbate.py`（`build/__init__.py` 导出）、`web/js/build/adsorbates.js`。
- **Python**（M5 v2 §6.1，三层：规划 → 应用 → 便捷）：
  ```python
  def place_adsorbate(slab, adsorbate, height=None, position=None, *, site=None, frac=None, mode=None, side="top",
                      bond_length=None, bond_factor=None, rotation=0.0, tilt=0.0, binding=None, mol_index=None,
                      keep_orientation=None, sites=None, clash=None, frame=None) -> Placement          # 纯函数
  def plan_adsorbates(slab, adsorbate, *, site_class=None, sites=None, coverage=None, count=None, per="cell", cells=None,
                      min_separation=None, skip_occupied=True, skip_blocked=True, both_sides=False, mirror_existing=False,
                      **placement) -> Plan                                                                # 纯函数
  def apply_placements(slab, placements) -> AdsorbResult                                                  # 原位；{src, ids, records, warnings, new_atoms}
  def add_adsorbate(slab, adsorbate, height=None, position=None, *, both_sides=False, **placement) -> Structure
  def add_adsorbates(slab, adsorbate, **plan) -> Structure
  def remove_adsorbates(slab, ids=None) -> Structure
  class AdsorbateWarning(UserWarning)
  ```
- **JS**：`placeAdsorbate`、`planAdsorbates`、`applyPlacements(structure, placements) → { src, ids, records, warnings, newAtoms }`、`addAdsorbate`、`addAdsorbates`、`removeAdsorbates(structure, ids) → { src, removed }`。**[改]** 没有 `mark_adsorbate`/`markAdsorbate`（R-F21：标记用 M3 `mark_adsorbates`，不写记录）。
- **语义**：
  - **[新]** `adsorbate_target_distance(structure, element, atom, *, site_kind="top", mode=None, library=None) -> dict | None`（JS `adsorbateTargetDistance(s, element, atom, { siteKind = 'top', mode, library })`；负责人决定 L-05）：M5 §3.10.3 的目标距离 T(a, j)，a = `adsorbate(element, mode)` 的结合原子（查不到或不是单原子条目 → None），j = `atom`（基底原子下标），`site_kind` ∈ `"top"`、`"bridge"`、`"hollow"`（`bondFactor` 的列）；返回 `{"distance": Å, "factor": float | None, "env": "metal" | "cation" | "covalent", "rEff": Å, "nonbonded": bool}`（`pairBondLengths` 给出绝对值时 `factor = None`）；`env`、`r_eff` 在基底子图上按 M5 §3.10.2 计算，按结构的 `rev` 缓存。消费方：M4 的默认键长（L-M4-05）。
  - **`count`**（**[新]** 语义，负责人决定 L-18）：`count=N` 是本次**新增** N 个，不是"该面总数达到 N"；选位与 `coverage` 同一循环（M5 §3.12.2：`need = N`；种子 = 该面已有吸附物的结合原子，没有时先取 `cand[0]`；逐个取 `argmax dmin`，平局取位点序最小者；低于 `min_separation` 时停止并给 W8）；与 `all`、`coverage`、`each` 互斥（E24）。M5 §3.12.2、REST `count` 字段与 CLI 帮助同一说法：`--count N  add N more adsorbates; those already on the surface are kept and act as seeds`。
  - 键长参数一律叫 `bond_length`/`bondLength`；`distance` 只指 `adsorption_sites` 的 pymatgen 兼容位点偏移（`position = point + distance·normal`）。高度模式 `auto`（接触抬升，目标键长 = 系数 × 有效半径之和，M5 §3.10）、`bond`、`height`；单原子情形与 M4 `site_point` 同一高度（L-M4-05）。
  - `apply_placements` 遵守 R-ADS（L-X-05）：`promote_adsorbates` → 每个放置一个 id（从 `next_adsorbate_id`）→ 一次 `_remap` 插入（`added_props` 写 `adsorbate_id`，`tags`（键存在时 0 或 `tags_convention == "oc20"` 时 2）、`initial_magmoms`（键存在时））→ 原来按元素分块时 `sort_by_species()` → `mark_edited(s, "atoms")` → 追加记录（L-X-04；没有 `info.surface` 时建 `kind: "adsorbates"` 的块）→ 回收孤儿记录 → `refresh_auto_name(s, before)`（L-X-07；`before = auto_name_state(s)` 在编辑前取）。`src` 由追踪器给出（Python `track_changes()` 包住；网页 `editActive(…, { singleFrame: true })`，不传 `indexMap`）。
  - `remove_adsorbates`：删除这些 id 的原子（`_remap(keep)`）与记录、`mark_edited(s, "atoms")`、刷新名字。
  - 多帧：Python 先 `keep_frame(frame)` 并写备注；网页 `singleFrame: true`。
- **消费方**：用户、脚本、REST；M5 自己的批量生成。
- **已解决的冲突**：R-F10、R-F11、R-F21；M5 v1 的 `distance`（键长）→ `bond_length`。

### L-M5-06 覆盖度：`adsorbate_coverage`、`coverage_supercells`

- **提供方**：M5 T7。**文件**：同 L-M5-05。
- **Python**：`adsorbate_coverage(slab, *, side="top", per="cell", cells=None, site_set=None) -> dict`（`{theta, per, denominator, source, cells, perCell, perSiteAtom, adsorbates}`）；`coverage_supercells(slab, n, *, max_results=6, cells=None) -> list[dict]`（`{matrix, matrix3, relative, wood, separation, areaRatio, applicable, why}`）。**JS**：`adsorbateCoverage(s, opts)`、`coverageSupercells(s, n, opts)`。
- **语义**：**[改]** 1×1 表面胞一律取自 `reference_mesh(s, exclude=吸附物 ∪ 漂浮片段)`（L-M1-07）：`N_cells = |det K|`，`A1 = (a, b)`；`cells=n`（用户给出）优先；`source` ∈ `"user" | "record" | "interface" | "translations" | "current"`（M5 v2 的 `"info"` 改为 `"record"`），`"current"` 且位点原子数 > 1 时提示 `Is this the 1×1 cell? Enter the number of 1×1 cells if not.`。1/n 超胞：候选 `hnf_matrices_2d(n)`（L-M1-01），点群去重 `M·g` 与 M′ 生成同一子格，约化用 `gauss_reduce_2d`（缺省 `"obtuse"`），标签 `wood_label(M, A1_0, A1_1)`；只有当前晶胞的超格（`P = M_red · K⁻¹` 为整数）才 `applicable`，Apply = `commands.run('cell.supercell', { matrix: embed(P), relativeTo: 'current' })`（L-M1-08）。
- **消费方**：M5 Coverage 块、REST、CLI。
- **已解决的冲突**：R-F17；M5 v2 §3.14.2 自己的来源规则与 `coverage_translation_tolerance` → `reference_mesh` 与 `reference_mesh_tolerance`。

### L-M5-07 批量生成：`adsorption_structures`、`substitution_structures`、`vacancy_structures`

- **提供方**：M5 T7。**文件**：同 L-M5-05。
- **Python**：`adsorption_structures(slab, adsorbate, *, classes=None, kinds=None, side="top", both_sides=False, site_set=None, **placement) -> list[Structure]`；`substitution_structures(slab, element, *, classes=None, side="top", site_set=None)`（应该）；`vacancy_structures(slab, *, classes=None, side="top", site_set=None)`（应该）。**JS** 同名 camelCase。
- **语义**：M5 §3.12.4；每个结果是 `slab.copy()` 上的放置/替换/删除（原 slab 不变，P4）；名字按 L-X-07（`… + CO@fcc (Pt3)`、`… Au@top (Pt) CN 7`、`… vac@top (O)`），**[改]** `info.surface.autoName = null`（这些名字是描述性的，不是自动名；M5 v2 写的"`out.info.surface.name` 同步"作废）。网页经 `addStructure(s, { replaceProject: false })` 加入项目（同一历史条目，一次撤销）。
- **消费方**：用户、REST（`each`）、CLI（`--each-class`）。
- **已解决的冲突**：R-F15。

### L-M5-08 `adsorbate_suffix` 的重新导出

- `build.adsorbate.adsorbate_suffix` / JS `adsorbateSuffix` = L-M2-07 的同名函数（M2 在 `core/naming` 实现，M5 只重新导出，不另写规则）。

### L-M5-09 网页：Adsorbates 分区、位点标记、Pick site 工具、命令与公共 API

- **提供方**：M5 T8、T9。**文件**：`web/js/ui/panels/surface-adsorbates.js`、`web/js/render/sitemarkers.js`、`web/js/render/tools/sitepick.js`；**不改** `api/public.js`、`ui/shell.js`、`ui/selectioncard.js`、`main.js` 的启动顺序。
- **位点摘要**（负责人决定 L-09）：`9 site atoms (Pt) · 54 sites in 4 classes`；多元素表面的组成与类标签括号里的写法相同（如 `hollow (Ti2O2)`）：`4 site atoms (Ti2O2) · …`。
- **要点**：`registerPanelSection('surface', { id: 'adsorbates', order: 40 })`；标记 `viewer.overlays.add({ id: 'adsorption-sites', tier: 'top', export: 'marker', pickable: true, pickIn: ['site-pick'], … })` + `drawnCopies(points, model, { repeat: true })`；悬停与选中位点的幽灵用 `ghostLayer`（**不开会话**，L-F0-35/38）；工具 `tools.register({ id: 'site-pick', icon: 'target', toolbar: false, selects: false, cursor: 'crosshair', touch: 'claim', … })`；吸附目标经 `crystallume.tools.get('move').registerSnapTargets`；`registerSelectionAction`、`registerAtomInfo`。
- **命令**：`sites.find`、`adsorbate.add`、`tool.sitePick`（ID 由 L-F0-52 固定）及 `sites.toggle`、`adsorbate.all`、`adsorbate.fill`、`adsorbate.eachClass`、`adsorbate.select`、`adsorbate.remove`、`adsorbate.fromSelection`；**[改]** 删除 `adsorbate.mark`（与 M3 的 `sel.markAdsorbate` 重复；分区里的"Mark as adsorbate"按钮调用后者）。
- **公共 API**（`defineApi`，owner `M5`）：`build.adsorbates()`、`build.adsorbate(name, { mode })`、`build.adsorptionStructures(name, opts)`、`analysis.sites(s?, opts)`、`analysis.assignSites(s?, opts)`、`edit.addAdsorbate(name | Adsorbate, opts)`、`edit.addAdsorbates(...)`、`edit.removeAdsorbates(ids?)`、`surface.showSites(on, opts)`、`surface.coverage(opts)`；**[改]** 没有 `edit.markAdsorbate`。
- **事件**：**[改]** `sites` 只是 `app` 的内部事件，不加入 `api/public.js` 的 `EVENTS`（R-F26）；嵌入页用 `crystallume.analysis.sites()` 取结果。
- **已解决的冲突**：R-F21、R-F26、R-F31。

### L-M5-10 REST、客户端、CLI

- **提供方**：M5 T10。
- **REST**（M5 v2 §6.3）：`POST /api/v1/analysis/sites`（登录）、`POST /api/v1/build/adsorbate`（公开；需要位点识别或对称操作的请求在云模式下需登录，K17）、`GET /api/v1/build/adsorbates`；模型 `extra="forbid"`；`bondLength`（键长）与 `sites.distance`（位点偏移）分开。
- **客户端**：`adsorption_sites(self, structure, **params) -> dict`、`add_adsorbate(self, structure, adsorbate, **params) -> Structure | list[Structure]`、`adsorbates(self) -> dict`；`ROUTE_METHODS` 三条。
- **CLI**（**[改]** 按 §0.3）：
  ```
  crystallume sites SLAB [--format FMT] [--index N] [--side top|bottom|both] [--method auto|exposed|layers|window] [--layers N]
                         [--window Å] [--probe K] [--kind K]... [--tolerance Å] [--distinguish-adsorbates] [--assign] [--all] [--json] [--plugins DIR]
  crystallume adsorb SLAB ADSORBATE [--from FMT] [--index N] [--mode MODE]
                         (--site SITE [--site-index K] | --position X Y | --frac U V | --each-class [--class LABEL]...)
                         [--all | --coverage THETA [--per cell|site-atom|EL] [--min-separation Å] | --count N]
                         [--side top|bottom] [--both-sides] [--height Å | --bond-length Å] [--bond-factor F] [--rotation DEG] [--tilt DEG]
                         [--method …] [--no-skip-blocked] [-o OUT | -o DIR/] [--format FMT] [--plugins DIR]
  crystallume adsorb SLAB (--substitute EL | --vacancy) [--class LABEL]... -o DIR/ [--format FMT]
  crystallume adsorb --list [--category C] [--json]
  ```
  `--count N` 的帮助按 L-M5-05（本次新增 N 个，负责人决定 L-18）。`adsorb` 的输入格式 `--format` → `--from`、输出格式 `--to` → `--format`；选同类第 K 个位点的 `--index K` 改名 `--site-index K`（`--index` 是帧选择）。
- **已解决的冲突**：R-F13、R-F14。

---

## 8. M6 界面与异质结提供的条目（L-M6-01 … L-M6-07）

### L-M6-01 晶格匹配核心：`Mesh2D`、`lattice_rotations`、`match_meshes`、`match_from_matrices`、`auto_twist_area`

- **提供方**：M6 T1（Python）、T2（JS）。**文件**：`crystallume/analysis/latticematch.py`（`analysis.__all__`）、`web/js/core/latticematch.js`。
- **Python**：
  ```python
  class Mesh2D:
      def __init__(self, basis, natoms: int = 1): ...      # 属性 u, v, T, area, natoms, k, rotations；(u, v, T) = gauss_reduce_2d(basis[0], basis[1], angle=None)
  def lattice_rotations(u, v) -> tuple[int, list[tuple[float, list[list[int]]]]]
  def match_meshes(substrate: Mesh2D, overlayer: Mesh2D, *, max_strain=0.03, max_area=400.0, max_atoms=None, twist=None,
                   twist_tolerance=0.5, max_aspect=4.0, engine="auto", substrate_matrix=None, max_results=200, sort="atoms",
                   max_work=None, max_vector_pairs=None) -> dict
  def match_from_matrices(substrate, overlayer, substrate_matrix, overlayer_matrix) -> dict
  def auto_twist_area(substrate, overlayer, *, twist, twist_tolerance=0.5, max_strain=0.03, max_vector_pairs=None) -> dict
  ```
- **JS**：`Mesh2D`、`latticeRotations`、`matchMeshes(sub, ovl, opts)`、`matchMeshesAsync(sub, ovl, opts, { signal, onProgress, sliceMs = 12 })`、`matchFromMatrices`、`autoTwistArea`。
- **语义**：M6 §3.3–§3.7、§3.11–§3.12，**[改]**：最短基约化一律 `gauss_reduce_2d(u, v, angle=None)`（L-M1-02），**删除** `reduce_basis_shortest`（Python、JS、导出、`SWAP_REL`/`TIE_EPS` 常量；R-F01）；λ1 预筛与二分的比较带不小于 `2·gauss_tolerance` 的相对余量。规范形用 M1 `hermite_normal_form_2d`（删除私有 `hnf_2d`）；子格枚举用 M1 `hnf_matrices_2d`。§3.12 的等价安全算术规则照旧（其第 10 条改为 L-M1-15 的 `format_decimal`）。
- **消费方**：M6 自己（`interface_matches`、界面）；公共 API。
- **已解决的冲突**：R-F01、R-F12、R-F18。

### L-M6-02 层的准备 `prepare_layer`

- **提供方**：M6 T4/T5。**文件**：`build/interface.py`、`web/js/build/interface.js`。
- **Python**：`prepare_layer(structure, *, flip=False, primitive=True, frame=None) -> PreparedLayer`（`{structure, mesh, inputMatrix: K, refMesh, refMatrix: P, flipped, rotation: R, axisPerm, sourceMap, warnings}`）。**JS**：`prepareLayer(s, { flip, primitive, frame })`。
- **语义**（**[改]** M6 v2 §3.2.1 的第 1–5 步改为调用 M2）：
  1. 前提：没有晶胞 → E1；`surface_normal(s)` 为 None 或 `surface` 为假 → `ValueError(f"'{name}': {vacuum_gap_hint(s)}")`（多根真空轴、没有间隙都由这句话说明，不写"not a slab"）；面内两轴不周期 → E3（`'X' must be periodic along its two in-plane cell vectors`）。
  2. `s = standardize_slab(structure.get_frame(frame))`（L-M2-05：轴轮换、左手重标号、接上、c 正交、a ∥ x、底层 z = 0；上表面 = F0 规则判定的上表面）。
  3. M6 自己：c 长度改为 `t + 2·PREP_PAD`（c 仍 ∥ z，`apply_basis_change` 精确）、z 平移 `PREP_PAD`；副本 `pbc = [T, T, T]`（输入不变，U1）。
  4. 参考网格：`ref = reference_mesh(s, exclude=吸附物)`（L-M1-07；`exclude` = `adsorbate_id > 0` 的原子，没有该键时 M3 `find_adsorbates` 的结果）；`refMesh = (ref.a, ref.b)`，P 由匹配网格基在 ref 中的坐标给出（非整数 → W7、P = I）。
  5. 约化（`primitive`）：`r = primitive_cell(s, axes=(0, 1), props=translation_identity_props + ("interface_layer",))`；K = `r.supercell_matrix` 的面内块（**[改]**：不是 `r.matrix`，R-F02）；位移检查 W6 照旧。
  6. 翻转（`flip`）：绕 x 的 C2，`apply_basis_change`（精确）；`interface_layer` 反转。
  7. 若基底或覆盖层的输入还没有 `adsorbate_id > 0` 而另一层有，先对其副本 `promote_adsorbates`（R-ADS 第 1 条）。
- **消费方**：`interface_matches`、`make_interface`、界面。
- **已解决的冲突**：R-F02、R-F17、R-F22；M6 v2 §3.2.2 自己的 `reference_mesh` 与 `info.surface.supercell` 回退 → L-M1-07；E2/E4 的文案（§9 合规）。

### L-M6-03 匹配与构建：`interface_matches`、`make_interface`、`estimate_interface_atoms`、`interface_distances`

- **提供方**：M6 T4/T5。**文件**：`build/interface.py`（`build/__init__.py` 导出；Python 用 `build.make_interface`，`build.interface` 是子模块）、`web/js/build/interface.js`。
- **Python**：
  ```python
  def interface_matches(substrate, overlayer, *, max_strain=0.03, max_area: float | str = 400.0, max_atoms=None, twist=None,
                        twist_tolerance=0.5, max_aspect=4.0, engine="auto", flip=False, flip_substrate=False, primitive=True,
                        substrate_matrix=None, max_results=200, sort="atoms", max_work=None, max_vector_pairs=None, frame=None) -> dict
  def make_interface(substrate, overlayer, *, vacuum: float, match: int | dict = 0, variant: int = 0,
                     substrate_matrix=None, overlayer_matrix=None, strain_to: str = "overlayer", strain_weight: float = 0.5,
                     distance: float | str = "vdw", shift: tuple[float, float] | str = (0.0, 0.0), shift_cart=None, anchor=None,
                     flip=False, flip_substrate=False, primitive=True, keep_constraints=True, keep_overlayer_tags=False,
                     name=None, frame=None, return_parts=False, **search) -> Structure | tuple[Structure, Structure, Structure]
  def estimate_interface_atoms(substrate, overlayer, match: int | dict = 0, *, substrate_matrix=None, overlayer_matrix=None,
                               variant=0, **search) -> int
  def interface_distances(substrate, overlayer, match: int | dict = 0, *, variant=0, shift=(0.0, 0.0), shift_cart=None, anchor=None,
                          strain_to="overlayer", strain_weight=0.5, substrate_matrix=None, overlayer_matrix=None, **search) -> dict
  ```
- **JS**：`interfaceMatches`、`interfaceMatchesAsync(sub, ovl, opts, { signal, onProgress, sliceMs = 12 })`、`makeInterface(sub, ovl, { vacuum, … })`（`vacuum == null` → E-VAC）、`estimateInterfaceAtoms`、`interfaceDistances`。
- **语义**（M6 §3.8，**以下几点为准**）：
  - `vacuum` 见 §1.5（必填、总间隙、允许 0 = 超晶格、`≤ max_vacuum` = 1000 Å，**[改]** 不是 200）。
  - 每层面内超胞用 M1 `cellops.make_supercell(layer, embed(M @ T))`（原子顺序、`adsorbate_id` 按像重编号、记录按像复制都由 M1 与 M5 的处理器完成）；形变在副本上保持面内分数坐标、z 不变（不调用 M1 `deform`，R-F12）；合并 `concat_structures([S2′, O2′], cell=…, pbc=[T, T, T], renumber_adsorbates=True)`（L-F0-08，基底在前）。
  - 数据：`props.interface_layer`、`tags`（基底原值、覆盖层 0）、`selective_dynamics` 按 M6 §4.1；`info.surface` 按 L-X-03（`kind: "interface"`，**`autoName`** 不是 `name`，`version: 2`）；吸附物记录按 L-X-04 合并（**没有 `firstAtom`**）；`mark_edited(out, "atoms")`；`info.source = "builder:interface"`；名字 `surface_name`（L-X-07、L-M6-04）。
  - **配位记录与状态行**（**[改]** 负责人决定 L-07：M6-S1 的报告升为必须）：`sites = adsorption_sites(S2, side="top")`（L-M5-02），S2 是**层叠之前**的基底副本（M6 §3.8.1 第 5 步之后的 S2：面内胞已是公共胞 C，c 仍是准备时的 `t + 2·PREP_PAD`，间隙 20 Å，所以 V = 0 的超晶格也求得出位点）；覆盖层原子取同一坐标系里第 6 步之后的位置，下标换成结果中的下标（覆盖层第 k 个原子 → `len(S2) + k`）。覆盖层最下层 = 覆盖层中 `adsorbate_id = 0` 的原子按 M3 `cluster_heights(z, layer_tolerance)`（L-M3-02）聚类后 z 最小的一簇；对其中每个原子（结果下标升序）取 `nearest_sites(sites, [r_j])`（L-M5-03）：`lateral ≤ site_moved_threshold`（0.5 Å）时 `site` = `subtype`（`fcc`/`hcp`）?? `kind`（`top`/`bridge`/`hollow`），否则 null；写入 `info.surface.interface.registry = {preset, sites}`（L-X-03）。状态行（必须，网页与 CLI 的 stderr note 同一句）：先写锚原子 `anchor C on top`，其余原子按 (元素, 位点) 分组、按首次出现排序接在后面——只剩一个原子时 `, second C on fcc hollow`，否则 `, 5 S on top, 6 S on bridge, 4 S between sites`；位点名 `top`、`bridge`、`fcc hollow`、`hcp hollow`、`hollow`，null 写 `between sites`。`adsorption_sites` 报错时 `registry.sites = null`，状态行写 `no adsorption sites found on the substrate`，构建照常完成。
  - `return_parts=True` 返回 `(interface, substrate_part, overlayer_part)`，后两者的名字加 ` (substrate part)`/` (overlayer part)`、`info.surface.interface.part`、`autoName = null`。
  - `interface_matches` 无匹配返回 `matches: []`；`make_interface` 报 E-MATCH；`match` 越界 `match 250 is out of range (200 matches; raise max_results)`。
- **消费方**：用户、脚本、REST、界面。
- **已解决的冲突**：R-F05、R-F12、R-F15、R-F16、R-F34（负责人决定 L-17：合并时不改写 `firstAtom`，也不复制自动名哨兵，新结构的名字按 M6 §4.4 / L-M6-04）；验收 G-21（负责人决定 L-07）；M6 v1 的 `periodic` 参数已删（真空即第二界面）。

### L-M6-04 界面命名 `interface_name`

- **提供方**：M6 T4/T5。**文件**：`core/naming.py`、`web/js/core/naming.js`（追加；`surface_name` 对 `kind == "interface"` 调用它，L-X-07）。
- **Python**：`interface_name(surface: dict, supercell_matrix=None) -> str`。**JS**：`interfaceName(surface, supercellMatrix = null)`。
- **语义**（M6 §4.4，**[改]** 让 M1 之后的超胞也能重算）：
  ```text
  M = supercell_matrix 的面内 2×2 块（缺省 I）；layers = interface.layers（自下而上），o = layers[-1]（本次的覆盖层）
  L(X) = 切面层：surface_label(X.surface)；graphene/hBN 原型："graphene"/"hBN"；否则 reduced_formula(X 的组成)
  W(X) = M @ X.matrixRef 为单位阵 → ""；否则 " " + mesh_label(M @ X.matrixRef, X.refMesh 的两行)   （L-M1-05：对角 → p(m×n)、Wood、rect、c(m×n)，否则 [2 1, -1 3]）
  两层（len(layers) == 2，s = layers[0]）：name = L(o) + W(o) + "/" + L(s) + W(s)
      + （L(o) == L(s) 且 |o.twist| ≥ 0.05° ? " " + format_decimal(|o.twist|, 1) + "° twist" : ""）
  逐次叠层（len(layers) ≥ 3）：下面的叠层作基底、不带网格段：name = L(o) + W(o) + "/" + "/".join(L(layers[k]) for k = len−2, …, 0)
  interface.label = "/".join(L(layers[k]) for k = len−1, …, 0)        （不含网格段，如 "hBN/graphene/Ni(111)"）
  ```
  例：`graphene/Ni(111)`、`MoS2 p(4×4)/Au(111) (√19×√19)R23.4°`；之后 M1 做 p(2×2) → `MoS2 p(8×8)/Au(111) (2√19×2√19)R23.4°`。
- **消费方**：`surface_name`（因而 M1 的刷新与 M5 的后缀）。
- **已解决的冲突**：R-F18（`format_fixed` → `format_decimal`）、R-F20（矩阵写法）；M6 v2 未定义"之后的超胞如何改名"（M1 的通用改名会把 `(√19×√19)R23.4°` 换成 `(2√19×2√19)R23.4°` 却留下 `p(4×4)`）→ 本条。

### L-M6-05 数据：阳离子半径、`hbn` 原型、`interface_layer`

- **提供方**：M6 T0。**文件**：`core/elements.py`、`web/js/core/elements.js`（`CATION_RADII`、`cation_radius(symbol)`/`cationRadius(sym)`，两份逐项相同）；两份 `PROP_DEFAULTS` 源码表加 `interface_layer: 0`（L-F0-02 的扩展规则）；`SURFACE_DEFAULTS` 的 `interface_*`（L-X-08）；服务器设置 `max_interface_work`、`max_interface_vector_pairs`（`config.py`）。
- **[改]** `hbn` 原型：F0-D T10（L-F0-29，"Python 加 `hbn`"，JS 已有）已在第 0 波交付；M6-F15 只核对参数（a = 2.504 Å，`pbc = [T, T, F]`），不重复实现。Python `METALS`/`ANIONS` 由 M2 T2 提供（L-M2-06），M6 T0 不加。
- **消费方**：M6 的层间距（`vdw`/`covalent` 接触半径）。
- **已解决的冲突**：M6 v2 T0 与 F0-D T10 重复的 `hbn`、与 M2 T2 重复的 `METALS`/`ANIONS`。

### L-M6-06 网页：Interface 分区、命令与公共 API

- **提供方**：M6 T7a–T7c。**文件**：`web/js/ui/panels/surface-interface.js`（新）、`css/app.css`；**不改** `api/public.js`。
- **要点**：`registerPanelSection('surface', { id: 'interface', order: 50, … })`；搜索在主线程分片运行（`matchMeshesAsync`），进度只在分区状态行（不用 `startTask`，L-F0-54 已注明）；Create 之后状态行报告配位（L-M6-03 的句子，**必须**，负责人决定 L-07）；**[改]** 真空为空时**不开 P-swap 会话**（列表、详情与晶胞轮廓照常显示，Create 不可用，tip `Enter the vacuum (total gap in Å; 0 for none).`），填好真空后才 `beginStructureEdit('Build layers', { kind: 'structure', owner: 'surface.interface', commitLabel: 'Create', onEnd })` 并预览；清空真空即取消会话（R-F32）；Create = `ses.commit({ addAsNew: true, name })`；`return_parts` 的两个结构在同一历史条目里加入；大结构确认用 F0-A 的 `LIMITS.confirmAtoms`（30 000）。
- **命令**：`build.layers`（L-F0-52）、`build.stackLayer`（M6 自加）；参数 schema 中 `vacuum: {type: 'float', unit: 'Å', min: 0, max: 1000, required: true}`。
- **公共 API**（`defineApi`，owner `M6`）：`build.interface(substrate, overlayer, opts)`（返回新结构，不加入项目，`opts.vacuum` 必填）、`analysis.interfaceMatches(...)`、`analysis.interfaceMatchesAsync(...)`。
- **已解决的冲突**：R-F32；M6 v2 §10.2 请求的 F0-A `onApply`/`canApply` 不需要（会话只在真空已填时存在）。

### L-M6-07 REST、客户端、CLI

- **提供方**：M6 T6。
- **REST**（M6 v2 §6.3）：`POST /api/v1/analysis/interface`（登录）、`POST /api/v1/build/interface`（需要搜索时登录；只给两个矩阵时公开）；**[改]** `InterfaceBuildRequest.vacuum: float = Field(..., ge=0, le=1000)`；新模型 `extra="forbid"`；`shift`、`shiftCart` 长度 2、`distance` 数值 0.5–20 Å。
- **客户端**：`interface_matches(self, substrate, overlayer, **search) -> dict`、`build_interface(self, substrate, overlayer, *, vacuum: float, **options) -> Structure`；`ROUTE_METHODS` 两条。
- **CLI**（按 §0.3）：`crystallume build interface SUBSTRATE OVERLAYER --vacuum Å [--from FMT] [--index N] [--list [--json]] [--pick N] [--variant K] [--max-strain PCT] [--max-area A2|auto] [--max-atoms N] [--twist DEG] [--twist-tol DEG] [--max-aspect R] [--engine auto|zsl|twist] [--flip] [--flip-substrate] [--no-primitive] [--substrate-matrix A B C D | --keep-input-cell] [--overlayer-matrix A B C D] [--strain-to overlayer|substrate|both] [--strain-weight W] [--distance vdw|covalent|bulk|Å] [--shift U V | --shift-site top|bridge|short-bridge|long-bridge|fcc|hcp|hollow] [--no-constraints] [--keep-overlayer-tags] [--parts] [--name NAME] [-o OUT] [--format FMT]`；`--vacuum` 为 `required=True`，只有 `--list` 不构建、不需要它。
- **已解决的冲突**：R-F05、R-F13、R-F14。

---

## 9. 合规检查（U1–U6 与 F0 账本的名字）

逐份检查 M1–M6 的当前稿（全文检索 `slab`、`not a slab`、`bulk crystals`、`pbc`、`T, T, F`、`vacuum`、`15 Å`、`10 Å`、`200`、`default`、`prefill`、`需要用户决定`、F0 账本已改名的旧名字）。

### 9.1 总表

| 决定 | M1 | M2 | M3 | M4 | M5 | M6 |
|---|---|---|---|---|---|---|
| U1 导入无感、不改 pbc、不做 slab 分类、没有间隙时给说明 | **V-F01**（一句分类式文案） | 合规（v2 删去 E3/W1；`kind: "vacuum"` 只是来源记录） | 合规（K15 删去 straddle 提示） | 合规（"Only for slabs"已删） | 合规（E3 用 `vacuum_gap_hint`） | **V-F02**（E4 判定"not a slab"）；V-F03 措辞 |
| U2 生成的 slab `pbc = [T, T, T]`，标准取向 | 不生成 slab；超胞保持 pbc | 合规（含 V = 0） | 不生成 | 不生成 | 合规（批量结构复制 slab）；装箱模式见 V-F05 | 合规 |
| U3 M6 完整 | — | — | — | — | — | 合规：§0–§10、测试、开发拆分齐全，不可砍（v2 文首） |
| U4 不设默认真空、总间隙、必填、不预填 | 合规（`keep_vacuum` 不是间隙值） | 合规（`set_vacuum(0)` 报 E12d：可以填、就地说明，§1.5） | 不涉及 | 不涉及 | **V-F05**（装箱的 `vacuum` 写成每侧） | **V-F04**（预览占位 10 Å） |
| U5 D1 面板与分区、D2 原位放置、D5、D7 | 合规（Cell 插槽） | 合规（Cleave、Slab） | 合规（Layers、Constraints） | 合规（Transform、Move 工具） | 合规（Adsorbates；原位修改） | 合规（Interface，order 50） |
| U6 不再等用户审核 | 合规（§8.3 只是告知） | 合规（§8.2 决定记录） | 合规 | **V-F06**（§8.2 标题与"推荐/备选"写法） | 合规 | 合规（§8.1 已定；§8.3 告知） |
| F0 账本的名字 | V-F10 | V-F11 | V-F12 | V-F13 | V-F14 | V-F15 |

### 9.2 U1–U6 违规与替换文本

- **V-F01**（M1 §3.14，`M1.md:737`，U1）：
  原文：`有真空轴的结构上 Conventional cell 不可用（分区说明 \`Conventional cells are for bulk crystals; this structure has a vacuum gap along c.\`）。`
  替换为：`有真空轴的结构上 Conventional cell 不可用（分区说明 \`Conventional cell needs a cell without a vacuum gap (this one has one along c).\`）。`
  理由：原文把结构归类为"不是 bulk crystal"；新文案只说明工具的前提（与 F0 账本 V1 同一处理）。
- **V-F02**（M6 §3.2.3 E4，`M6.md:240`，U1）：
  原文：`| E4 两根以上真空轴 | \`'X' has vacuum along a and c; it is a wire or a molecule in a box, not a slab or a 2D material\` | "Vacuum along a and c: this is not a slab or a 2D material." |`
  替换为：`| E4 两根以上真空轴 | \`'X': vacuum gaps along a and c: surface tools need a vacuum gap along one cell vector only\`（= \`f"'{name}': {vacuum_gap_hint(s)}"\`，L-F0-17） | "Vacuum gaps along a and c: the interface builder needs a vacuum gap along one cell vector only." |`
- **V-F03**（M6 §3.2.3 E1、E2、E3 与 §5.1，措辞，建议照改）：
  - E1 界面 `"X has no unit cell. Choose a slab or a 2D material."` → `"X has no unit cell."`
  - E2 API `'X' has no vacuum gap of 5 Å or more along a periodic cell vector (the widest is 3.3 Å along c); cleave a surface or add vacuum first` → `'X': no vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first`（= `vacuum_gap_hint`，F0 账本 V2 去掉了 "periodic"）；界面 `"No vacuum gap — cleave a surface or add vacuum first (the widest gap is 3.3 Å along c)."` → `"No vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first."`
  - E3 界面 `"X must be periodic in two directions (a slab or a 2D material)."` → `"X must be periodic along its two in-plane cell vectors."`；API `'X' is not periodic along two in-plane directions` → `'X' must be periodic along its two in-plane cell vectors`
  - §5.1 `available()` 的 `"Load a slab or a 2D material first."` → `"Load a structure with a unit cell first."`
- **V-F04**（M6 §5.4、§3.11、§7，U4）：
  原文（§5.4）：`- **真空未填时**：预览用只供显示的 \`interface_preview_vacuum\`（10 Å）建结构，预览条标签为 "Build layers — vacuum not set (shown with 10 Å)"，状态行写 "vacuum not set"；Create（分区里的和预览条上的）都不可用，tip "Enter the vacuum (total gap in Å; 0 for none)."（U4）。显示用的 10 Å 间隙大于 F0-D 的 5 Å 阈值，所以 U1 的显示切口落在真空里而不是层间隙里（工程 #2）。填了真空后预览用真实值重建。`
  替换为：`- **真空未填时**：不开预览会话，也不用任何占位真空建结构（U4：临时值等于预填）；匹配列表、详情与 \`cellOutlineLayer\` 的面内晶胞轮廓照常显示，状态行写 "vacuum not set"，Create 不可用，tip "Enter the vacuum (total gap in Å; 0 for none)."。填了真空后才 \`beginStructureEdit\` 并预览；用户清空真空框时取消会话（与 M2 Cleave 相同）。`
  §3.11 表删除 `interface_preview_vacuum` 一行；§5.4 末段关于 `onApply`/`canApply` 的请求与 §8 R12、§10.2 对应行改为"不需要：预览会话只在真空已填时存在"。
- **V-F05**（M5 §6.1 `Adsorbate.to_structure` 注释，`M5.md:1472`，U4）：
  原文：`# molecule (cell None, vacuum None), in the given cell, or centred in a box with \`vacuum\` Å on every side (L12; no default, U4)`
  替换为：`# molecule (cell None, vacuum None), in the given cell, or centred in a box whose periodic images are \`vacuum\` Å apart along every cell vector (total gap, U4; pbc T T T; vacuum=None means no box, not a default)`
- **V-F06**（M4 §8.2，`M4.md:1322`，U6）：
  原文标题：`### 8.2 需要用户决定的问题（均已按推荐方案设计，U6）`
  替换为：`### 8.2 决定记录（U6：按推荐方案定案，开发不等待）`；各条的"推荐："改为"定案："，"备选……"句移到"未采纳的意见"。

### 9.3 与 F0 账本名字不符之处（替换文本）

- **V-F10 M1**：
  1. §3.1 `- 放在 F0-D 的 \`analysis/vacuum.py\` / \`core/vacuum.js\`（M1 的任务追加，§10），M2、M3 共用。` → `- 由 F0-D T7 提供（L-F0-17：\`vacuum_axis(s) = surface_normal(s, require_gap=True)["axis"]\`）；M1 不追加。`
  2. §3.3.1（`M1.md:256`）`k == k_vac 且 find_vacuum_gap(out, k, min_width=0) = g 非空 → shift_k ← floor(f_k − gap_cut(g))   （整体放在 [cut, cut+1)，slab 不被拆开）` → `k == k_vac 且 cut = display_cuts(out)[k] 非空 → shift_k ← floor(f_k − cut.lo)   （整体放在 [cut.lo, cut.lo + 1)，slab 不被拆开）`
  3. §3.10.3（`M1.md:550`）`沿 k 的展开改用 F0-D 的 \`unwrap_along_gap\`（切口在间隙中点）` → `沿 k 的展开用 \`unwrap_along_gap(f_k, surface_normal(s, require_gap=True)["cut"])\`（窗口 [cut.lo, cut.lo + 1)）`
  4. §3.17 E-ST5 `keep_vacuum needs a vacuum gap of at least 5 Å or a single non-periodic axis` → `vacuum_gap_hint(s)` 的文案（经 `require_gap`）。
  5. `app.busy(label) → { set(fraction), end() }`（§10 F0-A 表、§3.16、§5.5、§9 T7b）→ `app.startTask(label, { cancel }) → { set(labelOrFraction), end(), cancelled }`（L-F0-54）。
  6. §10 F0-D 表 `gap_cut(gap) ; unwrap_along_gap(frac, gap) ; make_contiguous(structure, axis, *, gap=None, frame=None)` → `gap_cut(s, axis, *, frame, hint, exclude) ; display_cuts(s) ; unwrap_along_gap(frac, cut) ; make_contiguous(s, axis, *, cut=None, frame=None) ; contiguous_shifts(s, axis, *, cut=None, frame=None)`；请求 1 `_adopt(other)` → 已由 F0-D 提供 `_adopt(other, *, src=None)`。
  7. §10 F0-A 表 `surfaceNormal(structure, { frame })`（F0-A）→ F0-D 的 `surfaceNormal(s, { frame, requireGap, exclude })`（`core/vacuum.js`，`core/lattice.js` 重新导出）。
- **V-F11 M2**：
  1. §3.14 第 5 步（`M2.md:753`）`pbc[2] 为真 → F0-D make_contiguous(s, 2, gap=切口)，切口 = sn.cut（W14 时为最宽间隙）；返回每个原子的整数平移 s_i（网页 imageShift）` → `pbc[2] 为真 → shifts = contiguous_shifts(s, 2, cut=切口)；make_contiguous(s, 2, cut=切口)；切口 = sn.cut（W14 时为窗口起点 lo，见 L-M2-03）；shifts 即网页 imageShift 的 c 分量`；`M2.md:779` 与 §10.1 的 `return_shifts=True` 请求删除。
  2. §10.2 启动顺序一行 `main.js 在注册 Cleave 分区与发出 crystallume ready 之前 await loadOxidationStates()（§3.9.1；T2 改 main.js，与 F0-A 的启动代码协调）` → `registerBootTask('oxidation-states', loadOxidationStates)`（L-F0-56；M2 不改 \`main.js\`）。
  3. §6.1.1 `surface_normal(s).surface 为假 → ValueError(f"'{s.name}' has no vacuum gap or non-periodic axis; cleave a surface first")` → `surface_normal(s).surface 为假 → ValueError(f"'{s.name}': {vacuum_gap_hint(s)}")`。
  4. §3.14 第 1 步、§10.2 把 `surface_normal` 记为 F0-A 的 → F0-D T7（L-F0-17）；Python 在 `crystallume.analysis`。
- **V-F12 M3**：
  1. §3.3 表 `periodic，方向是 slab 轴` 一行：`slab = surface_normal(s, require_gap=True) 非空且 slab.axis == axis：gap = find_vacuum_gap(s, axis, min_width=0)（F0-D，全部原子参与）；f' = unwrap_along_gap(f_axis, gap)（F0-D：f − floor(f − cut)，cut 为间隙中点映射到 (−0.5, 0.5]）` → `sn = surface_normal(s, require_gap=True) 非空且 sn.axis == axis：f' = unwrap_along_gap(f_axis, sn.cut)（L-F0-16，窗口 [cut.lo, cut.lo + 1)）`；同节"与显示同一个切口"一段中的 `unwrap_along_gap(f, find_vacuum_gap(s, k))` → `display_cuts(s)[k]`。
  2. §3.16（`M3.md:618`）`没有间隙时用 F0-A \`requireVacuumGap\` 的同一文案（\`No vacuum gap found along a, b or c. …\`，E27）` → `没有间隙时报 \`vacuum_gap_hint(s)\`（L-F0-17，经 \`require_gap\`）`。
  3. §10.1 第 4 条 `constraint_counts` → `constraint_summary`；第 8 条 `version` → `rev`；§10.2 `registerHoverLine` → `registerAtomInfo`；§9 T6 的 `api/public.js` → `defineApi`（F0 账本 §6 M3 已列）。
- **V-F13 M4**：
  1. §3.14（`M4.md:885`）`F0-A \`requireVacuumGap\`：\`No vacuum gap found along a, b or c. Add one with Build vacuum slab…, or cleave a surface first.\`` → `F0-A \`requireVacuumGap\`（L-F0-49）：\`vacuumGapHint(s)\` 首字母大写加句号（如 \`No vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first.\`），空状态动作 \`Build vacuum slab…\``。
  2. §6.2 把 `mic_vector`、`minimum_image_vectors` 列为 M4 的 → F0-D T9（L-F0-20）；§6.1 `keep_frame(self, i)` → F0-D 的 `keep_frame(self, index=0)`；§6.2 `fragments` 里的 `BondGraph`/`bond_graph` → M3 的（L-M3-03）；`METALS` → `core/elements`（L-M2-06）。
  3. §10 F0-D 的 D-CR1、D-CR2 → 已由 F0 账本解决（`keep_frame`、`find_vacuum_gap`/`surface_normal`）。
- **V-F14 M5**：
  1. §4.2 标题与第一条 `实现归 F0-D 第 0 波` / `由 F0-D 实现（§10，任务 F0-D-W，规模 S）` → `实现归 M2 T2（第 1 波），代码按本节原样`（F0 账本没有这个任务，R-F30）；§9 末句与 §10 F0-D 表第一行同改。
  2. §3.1 `sn = surface_normal(view(s, sub), frame=frame)` → `sn = surface_normal(s, frame=frame, exclude=ads ∪ loose)`；E3 文案 `vacuum_gap_hint(s, exclude=ads ∪ loose)`（F0 账本 R16）；§10 F0-D 表"切口排除原子（可选）"一行 → 已提供；"显示也传 `adsorbate_id > 0` 的原子" → 不采纳（R16）。
  3. §9 T9 `api/public.js 追加（EVENTS 的 sites）` → 不改 `api/public.js`（L-F0-53）；`sites` 只是 `app` 的内部事件。
- **V-F15 M6**：
  1. §3.2.1 第 1、3 步 `gs ← F0-D find_vacuum_gaps(s)…；g ← F0-D find_surface_gap(s)…`、`f_c ← F0-D unwrap_along_gap(f_c, gap)` → 由 `standardize_slab`（L-M2-05）完成；若单独调用，写作 `sn = require_gap(s)`、`unwrap_along_gap(f_c, sn["cut"])`。
  2. §10.1 表 `unwrap_along_gap(f, gap)` → `unwrap_along_gap(f, cut)`；`find_vacuum_gap(s, axis, *, min_width=0)` 只用于报告最宽空隙。
  3. §10.2 的 `onApply`/`canApply` 请求 → F0 账本没有，M6 不需要（V-F04）。

---

## 10. 消费方改动说明（M1–M6）

逐个模块列出：为符合本账本（含 §1.13 并入的负责人决定），该模块的规格与实现相对其 v2 稿要改的地方。F0 名字的替换文本在 §9.3 与 F0 账本 §6，这里只引用、不重复。各模块后续修订已改成下列写法的，视为完成；开发按本账本条目实现，不等规格改完。

### 10.0 所有模块共同

1. **名字与签名**一律按本账本条目；"已解决的冲突"里列出的旧名字不作为别名保留（§0.3）。新的公共 API 成员经 `defineApi`（L-F0-53），命令经 `commands.register`（L-F0-52），分区经 `registerPanelSection`（L-F0-49），启动数据经 `registerBootTask`（L-F0-56）；不改 `api/public.js` 与 `main.js` 的启动顺序。
2. **数字进入名字、标签、文案**一律用 L-M1-15（`round_half_up`、`format_decimal`、`format_sig3`、`format_angle`），不用 `toFixed`、f-string、`round()`（附录 A-2）。
3. **`info.surface`**：读之前经 `normalize_surface_info`；容忍任何键缺失、`kind` 缺失或未知；写时保留不认识的键；浮点数 `round_half_up(x, 6)`（L-X-01）。
4. **自动名**：会改变名字组成部分的编辑，在编辑前取 `before = auto_name_state(s)`，编辑后调用 `refresh_auto_name(s, before, …)`；只有 `info.surface.autoName` 一个哨兵，没有 `baseName`（L-X-07，负责人决定 L-12）。
5. **吸附物**：凡是把原子作为吸附物加到表面上的编辑都按 R-ADS（L-X-05）；记录没有 `firstAtom`（L-X-04）。
6. **真空**：参数名 `vacuum` = 总间隙、必填、无默认、不预填；`SURFACE_DEFAULTS` 里没有任何真空间隙值（§1.5、L-X-08）；每个模块只在自己的任务里加自己的键（L-X-08 的表）。
7. **REST / CLI**：新请求模型 `extra="forbid"`；CLI 的输入输出选项、`--index N`、`--surface-cell SPEC` 按 §0.3（R-F13、R-F14）。
8. **端到端测试**（负责人决定 L-06）：Node 版 Playwright、由 pytest 包装、标记 `slow`；各模块规格 §5 控件表里的 `aria-label` 是选择器的唯一来源，改名必须同时改 e2e。
9. **跨语言金标**：比较 `info.surface` 时排除 `bulk.name`（负责人决定 L-11）与网页的 `bulk.entryId`；吸附高度、键长按 M5 §3.10 的式子现算，不抄数字（负责人决定 L-15）。

### 10.1 M1（晶胞与晶格工具）

1. `gauss_reduce_2d(a, b, *, angle="obtuse" | "acute" | None) -> (u, v, M)` 的 `angle=None` 分支按 §1.1 冻结（M6 依赖它的平局与容差，附录 A-1）；M2、M5 用缺省 `"obtuse"`（L-M1-02）。
2. `PrimitiveResult` 加 `transform = {num, den}`（新 = T @ 旧）与 `supercell_matrix`（旧 = S @ 新，整数），`matrix` 恒为 `None`（R-F02，L-M1-12）。
3. 1×1 网格只有 `reference_mesh(s, *, exclude=None)` 一处：只在 `kind ∈ {cleave, interface}` 时信任 `info.supercellMatrix`；新键 `reference_mesh_tolerance` = 0.3 Å（R-F17，L-M1-07，L-X-08）。§3.6.4 改为引用它。
4. 超胞只有 `cellops.make_supercell`：网页、REST 单帧与 `cell.bakeRepeat` 的对角重复走 `make_supercell(diag, wrap=False)`（R-F24）；JS 公共名 `crystallume.build.makeSupercell(s, P, { wrap })`（R-F36，L-M1-08）。
5. **超胞编辑器**（负责人决定 L-16）：`web/js/ui/cellsupercell.js` 导出 `supercellEditor(el, app, { owner, surface = false })` 供 M2 的 Slab 分区内嵌（M1 §5.1 已这样写，保留）；删除本账本早先的 `openSection(…, { tab: 'surface' })` 深链；测试 `test_supercell_two_mounts`（L-M1-16）。
6. **名字**（负责人决定 L-19、L-12）：D13"从预设创建时名字用预设自己的标签"撤回，名字里的网格标签只由矩阵算出；toast 写 `Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms`（相同时只写一次）；`rename_after_cell_change(name, P, *, cell, previous=None)` 去掉 `label` 参数（L-M1-15）；K5、§3.5.4 的 `info.surface.name` → `autoName`，并改为"操作前 `auto_name_state`，`apply_info_handlers` 之后 `refresh_auto_name(s, before, cell_change=…)`，返回 False 时 `rename_after_cell_change`"（L-X-07）。
7. info 处理器放进新文件 `core/infohandlers.*`（静态注册）；`ctx` 加 `lattice_points` 与 `id_map`；内置的只有 `surface` 几何处理器与 M5 的 `surface.adsorbates`；K16 的"M2 注册 `surface`（replace）""M6 注册 `interface`"删除（L-M1-14）。
8. 数字格式化函数改名 `round_half_up`、`format_decimal`、`format_sig3`、`format_angle`（原 `fmt_*`，R-F18）；网格标签 `mesh_label` = `wood_label ?? matrix_label`，单位阵 `p(1×1)`，矩阵写法 `[2 1, -1 3]`（R-F20，L-M1-05）；预设相对 1×1 参考网格，`parse_mesh_spec(text)` 只做语法、落到网格上用 `surface_mesh_matrix`（R-F03，L-M1-06）。
9. `hnf_matrices_2d(n)` 的次序（i 升序、j 升序）与 `hermite_normal_form_2d` 写进 §3.2 的导出表（M5、M6 用）；§10"M6 应变分配用 `deform`"撤回（R-F12）。
10. `SURFACE_DEFAULTS`：`conventional_*` 只由 M1 加（M2 引用）；保持真空的选项叫 `keep_vacuum="auto" | True | False`（R-F05、R-F23）。
11. 文案与 F0 名字：V-F01（惯用胞的说明）、V-F10 的 7 处替换；CLI `--surface-cell SPEC [--relative-to current]`、`--index N` 单个整数（L-M1-17）。

### 10.2 M2（切面与 slab）

1. **命名**（负责人决定 L-12）：§3.13 伪代码"否则：`base = info.surface.baseName`（M5 写）?? None"→"其他 kind → None（名字由 `refresh_auto_name` 从编辑前的名字推出）"；§3.13 末段与 §10.5 的"对没有 M2 来源的结构 M5 仍写 `baseName`"删除；新增 `auto_name_state(s)`，`refresh_auto_name` 的签名改为 `(structure, before, *, cell_change=None)`（L-X-07、L-M2-07）。§4.2 字段表的 `autoName` 行保持"唯一的自动名键"。
2. `info.surface` 的 `kind` 表加 `"interface"`（M6）与 `"adsorbates"`（M5、M4）；`tasker` 是顶层键（M6 读它，不是 `polarity.tasker`）；新函数 `normalize_surface_info`（v1 → v2 读取兼容，含删除 M5 v1 的 `baseName`）（L-X-01，R-F35）。
3. **Slab 分区**（负责人决定 L-16）：§5.6 示意图里的 `Surface supercell…   (opens Structure › Cell › Supercell with the in-plane presets)` 一行改为内嵌的编辑器（控件与布局即 M1 §5.3 的 `surface: true` 形态），"Surface supercell"一条改为"内嵌 M1 的 `supercellEditor(el, app, { owner: 'surface.slab', surface: true })`；预设相对 `reference_mesh`；命名由 M1 的 `cell.supercell` 经 `refresh_auto_name` 完成"（L-M2-08）。
4. **网格倍数提示**（负责人决定 L-08）：§1.1 S8 与 §5.2 Minimal surface cell 一行的 `Using the input cell: the surface cell is a 2 × 2 multiple of the smallest one.` → `Using the input cell: the surface cell has N times the area of the smallest one, <Wood>.`（`wood_label` 为 None 时省去 `, <Wood>`）。
5. `surface(..., supercell=)` 接受 2×2 矩阵、对角简写或文本（M1 `surface_mesh_matrix`）；删除 `wood` 参数、M2 自己的预设表与 50/2500 限额、E11 的两句；命令参数 `wood` → `spec`；JS `buildSurface` 没有 `wood`（R-F03、R-F04、R-F38，L-M2-02、L-M2-08）。
6. `fix_middle`：`L − N` 须为偶数（与 M3 同一规则与文案）；`fix_axes` 为字符串、按 R-F09 的语法校验（REST 也不用 `Literal`）。
7. `set_vacuum(0)` 维持 E12d，修订记录写明"U4 的'允许 0'指切面与界面构建；已有结构请用 V = 0 切面或 `oriented_cell`"（负责人决定 L-13）；改真空工具在没有块时建 `kind: "vacuum"` 块，`autoName = s.name`，不改名（L-M2-03）。
8. `standardize_slab` 恢复为 M6 的依赖（L-M2-05，R-F22）；`flip_slab` 用 `auto_name_state`/`refresh_auto_name(s, before)`（L-M2-04）。
9. 第 1 波交付共用数据：`webdata`（代码按 M5 §4.2）、`oxidation_states.json`、`METALS`/`ANIONS`、电负性表对齐（L-M2-06，R-F30）；`conventional_cell_hint` 是独立函数，`conventional_*` 键不由 M2 加（R-F19，L-X-08）。
10. `SURFACE_DEFAULTS` 改名：`layers` → `slab_layers`、`position` → `slab_position`、`offset` → `slab_offset`、`match_tolerance` → `termination_match_tolerance`、`near_match_factor` → `termination_near_match_factor`；删 `supercell_max_entry`（L-X-08）。
11. `surface_label(x)` 接受 Structure 或 `info.surface` 字典（R-F33）；F0 名字 V-F11 的 4 处；CLI 删除 `--supercell`、`--supercell-matrix`、`--wood`，用 `--surface-cell SPEC`，输入输出选项按 §0.3（L-M2-09）。

### 10.3 M3（层、几何选择与约束）

1. T3a 导出 `cluster_heights`（L-M3-02）、`periodic_components`（L-M3-03）、`tags_convention`（L-M3-04）（R-F25）；M5、M6 依赖前两者，M4、M5 依赖第三个。
2. `find_layers` 的方向语义按 R-F07：`None`/`"auto"` 不报错，`"normal"` 没有表面时报错，`"a"/"b"/"c"` 是另两根矢量所张面的法向；`tolerance=None` 先读 `info.surface.layerTolerance`（L-M3-01）。
3. `mark_adsorbates`/`edit.markAdsorbates` 是唯一的标记入口，标记不写记录（R-F21）；`promote_adsorbates` 是 R-ADS 第 1 条的唯一实现（L-X-05）。
4. 概念名：*Surface atoms* 只指 `surface_atoms`（暴露原子），M5 的叫 *Site atoms*（R-F06）。
5. 新增 Python `set_tags_from_layers`（L-M3-08）。
6. `fix_layers(middle=N)` 的奇偶规则与 `axes` 语法与 M2 的 `fix_middle`/`fix_axes` 相同；测试 `test_cleave_fix_equals_fix_layers`（R-F09）。
7. CLI：`layers --frame` → `--index`，`edit fix/free --to` → `--format`，写结构的命令加 `--from`；`--atoms SPEC`（`"0-35, 40"`）的解析函数在 `cli.py` 里只有一个，M4 的 `edit delete` 复用它（负责人决定 L-10）；`LayersRequest` `extra="forbid"`（L-M3-10）。
8. F0 名字 V-F12 的 3 处。

### 10.4 M4（原子操作）

1. R-ADS（L-X-05、L-M4-02）：表面放置的新原子在 OC20 约定的结构上 `tags = 2`；编辑前按元素分块时插入后 `sort_by_species()`；每个载荷成键片段一个新 id；先 `promote_adsorbates`。K6 与 §3.10.5 的"tags 0、追加在末尾"按此改。
2. **默认键长**（负责人决定 L-05）：`Add atom › Above selection` 与 Place 工具对吸附物库里的单原子元素用 M5 `adsorbate_target_distance`，读数注明 `(adsorbate library)`；其余元素 `place_bond_factor` × 共价半径之和，读数注明 `(covalent radii)`。M4 T5 先实现后一支，M5 T5 接上前一支（L-M4-05）。M4 规格里写死的键长与高度数字（如"键长默认 1.98 Å"）改为"按 M5 §3.10 现算"（负责人决定 L-15）。
3. `site_contact_tol` → `place_contact_tol`（L-X-08）；`fragments` 里不再定义 `BondGraph`/`bond_graph`（用 M3 的），`METALS` 从 `core/elements` 导入（L-M4-04）。
4. 剪贴板：只为完整的源吸附物复制记录（`site = null`、`bonds = []`，不写 `firstAtom`）；目标没有块时建 `kind: "adsorbates"`、`autoName = 目标名`；M4 不改名（L-M4-06）。
5. **新 CLI**（负责人决定 L-10，第 2 波）：`crystallume edit delete IN --atoms SPEC [--from FMT] [--index N] -o OUT [--format FMT]`；`edit` 组其余命令补上 §0.3 的输入输出选项（L-M4-08）。
6. 一致性测试 `test_m4_m5_single_atom_height`（R-F11）；吸附目标的提供接口 `registerSnapTargets`（L-M4-07）；§8.2 的标题与写法（V-F06）；F0 名字 V-F13。

### 10.5 M5（吸附物）

1. **自动名**（负责人决定 L-12）：K10、§4.5、§10 的 `info.surface.name` → `info.surface.autoName`；§4.5"v1 的 `baseName`、`autoName` 删除"→"只删除 v1 的 `baseName`"；§4.5 的伪代码就是 L-X-07 机制第 2 条的"其他 kind"分支，由 M2 的 `auto_name_state`/`refresh_auto_name` 实现，M5 只在放置、删除前后调用；第一次放置在没有块的结构上建 `{version: 2, kind: "adsorbates", autoName: 原名, adsorbates: []}`；批量生成的结构 `autoName = null`（L-M5-07）。
2. **`count`**（负责人决定 L-18）：§3.12.2 增写"`count=N` = 本次新增 N 个，`need = N`，其余同 coverage 的循环"，CLI 帮助 `add N more adsorbates; those already on the surface are kept and act as seeds`（L-M5-05、L-M5-10）。
3. **位点摘要**（负责人决定 L-09）：§5.2 写明多元素表面 `4 site atoms (Ti2O2)`（L-M5-09）。
4. **新导出**：`nearest_sites(site_set, points)`（`assign_sites` 内部的最近位点一步，M6 的配位记录用，负责人决定 L-07，L-M5-03）；`adsorbate_target_distance(structure, element, atom, *, site_kind, mode, library)`（M4 的默认键长用，负责人决定 L-05，L-M5-05）。M5 T5 同时把 M4 `site_point` 的缺省键长接上（测试 `test_m4_default_bond_from_library`）。
5. 位点的原点不变性（负责人决定 L-03）：桥位保留判据用键图近邻距离，平铺与归属前把表面原子平移到规范原点；`test_sites_invariance` 加 (0, ½)、(¼, ½)、(½, ½) 平移与空位用例。K7 的局部法向措辞改为"hollow 的所有边界边在键图中相连"（负责人决定 L-14）。
6. 删除 `mark_adsorbate`、`edit.markAdsorbate`、命令 `adsorbate.mark`（R-F21）；没有记录的吸附物组显示为 `<式> #<id>`（L-X-04）。
7. 覆盖度的 1×1 胞用 `reference_mesh(s, exclude=…)`，删除 `coverage_translation_tolerance`；`source` 的 `"info"` → `"record"`（R-F17，L-M5-06）。
8. `webdata` 由 M2 T2 交付（M5 §4.2 标题改）；吸附物库经 `registerBootTask('adsorbates', loadAdsorbateLibrary)` 加载（R-F30、R-F31）；`sites` 不是公共事件（R-F26）；`format_decimal` 由 M1 提供，M5 不再追加（R-F18）。
9. `surface_normal(s, frame=…, exclude=ads ∪ loose)`（R-F27，V-F14）；`Adsorbate.to_structure` 的装箱注释（V-F05）；CLI 的 `--from`、`--format`、`--site-index`（L-M5-10）。
10. 交给 M7：`sites.toggle`（Shift+S）与 `adsorbate.add`（Shift+A）的快捷键冲突检查（验收 G-5 的残留）。

### 10.6 M6（界面与异质结）

1. 删除私有 `reduce_basis_shortest`（Python、JS、导出、`SWAP_REL`/`TIE_EPS`），改用 `gauss_reduce_2d(u, v, angle=None)`；λ1 预筛与二分带 `2·gauss_tolerance` 的相对余量；金标在最终函数上重新生成（R-F01，L-M6-01，附录 A-1）。私有 `hnf_2d` → M1 `hermite_normal_form_2d`（R-F12）。
2. `prepare_layer` 第 1–5 步改为 `standardize_slab`（R-F22）；K = `primitive_cell(...).supercell_matrix` 的面内块（R-F02）；参考网格 `reference_mesh`（R-F17）（L-M6-02）。
3. **配位记录**（负责人决定 L-07）：§4.2 示例的 `"registry": "top"` → `"registry": {"preset": "top", "sites": [{"atom": 6, "element": "C", "site": "top", "label": "top (Ni)", "lateral": 0.0}, {"atom": 7, "element": "C", "site": "fcc", "label": "fcc (Ni3)", "lateral": 0.0}]}`（示例下标按实际构建）；字段说明"`registry` 是所选预设名或 null"改为 L-X-03 的定义；M6-S1 中"构建后报告锚原子与其余接触原子所在的位点"一句升为必须、并入 M6-F7（"Snap to site"位点菜单仍是应该）；§10.5 的 M5 依赖加 `nearest_sites`（L-M6-03、L-M6-06）。
4. **合并吸附物记录**（负责人决定 L-17）：§4.1 删去 `firstAtom ← firstAtom + q·N_layer` 与 `firstAtom ← firstAtom + N_基底超胞` 两处；"M5 的 `baseName/autoName` 不复制"改为"不复制自动名哨兵（`autoName`），新结构的名字按 §4.4"（L-X-04）。
5. `info.surface`：`version: 2`、`autoName`（不是 `name`）、没有顶层 `info.interface`（R-F15、R-F16，L-X-03）；网格标签 `p(1×1)`（R-F20）；M6 不注册 info 处理器（L-M1-14）。
6. 真空：上限 1000 Å（`max_vacuum`，不是 200）；真空为空时不开预览会话（V-F04、R-F32）；删除键 `interface_preview_vacuum`、`interface_vacuum_max`、`interface_confirm_atoms`（L-X-08）。
7. 命名按 L-M6-04（之后 M1 做超胞也能重算；`format_decimal`）；W12 读 `info.surface.tasker`（R-F35）。
8. U1 文案 V-F02、V-F03；F0 名字 V-F15；`hbn` 原型由 F0-D 提供、`METALS`/`ANIONS` 由 M2 提供（L-M6-05）。
9. 依赖顺序：配位记录用到 M5 的 `adsorption_sites` 与 `nearest_sites`（第 3 波），M6（第 4 波）在 M5 合入之后开发，与波次计划一致。

---

## 附录 A：本账本的核对脚本（`scratchpad/proto/xcheck/features/`，均已运行）

| # | 文件 | 内容 | 结果 |
|---|---|---|---|
| A-1 | `gauss_none_vs_m6.py`、`gauss_tie_size.py` | M1 `gauss_reduce_2d(angle=None)`（按 M1 v2 §3.11.1 逐行写的伪代码）与 M6 私有约化（`proto/m6/lat2d.gauss_reduce`）：① 2 万个随机基（含六方/正方子格、长度相差 ~1e-10 的近等长基）比较 (u, v, T)；② 把 M6 v1 原型引擎 `proto/m6/match2d.find_matches` 的约化换成前者后比较匹配类表 | ① 19 999 个基中 18 309 个 T 相同，1 690 个不同，全部是长度并列（两种结果的约化长度相对差 ≤ 9.99e-10）；M1 结果全部满足 `\|u\|² ≤ (1+τ)\|v\|²`、`\|u·v\| ≤ (½+τ)\|u\|²`（τ = 1e-9）；② graphene/斜方 435 类、MoS2/斜方 147 类、graphene/Ni(111) 549 类，逐项相同、顺序相同（R-F01） |
| A-2 | `fmt_check.py` | `format_decimal`/`round_half_up` 的 Python 与 JS（Node 22）实现在 11 个数上的输出，并与 f-string、`toFixed` 对比 | 两种语言全部相同；与默认格式化不同之处：`2.125 → "2.13"`（f-string `2.12`）、`0.625 → "0.63"`（f-string `0.62`）、`−0.004 → "0.00"`（f-string 与 `toFixed` 都是 `-0.00`）、`21.25 → "21.3"`（f-string `21.2`）（R-F18，L-M1-15） |
| A-3 | `f0_names_check.py` | 本账本里与 `L-F0-nn` 同行出现的标识符是否都在 F0 账本中；被引用的 `L-F0-nn` 是否都存在 | 引用的 28 个 `L-F0-nn` 全部存在；同行出现而 F0 账本没有的标识符全部是功能模块自己的名字（`make_supercell`、`periodic_components` 等），没有写错的 F0 名字；另逐个核对了本账本用到的 50 个 F0 名字（`display_cuts`、`require_gap`、`vacuum_axis`、`contiguous_shifts`、`_adopt`、`registerBootTask` 等）都在 F0 账本中 |
