# 第 1–5 波开发计划（表面建模）

状态：定稿（2026-11-09），供开发团队与编排脚本使用。`plan.md`（本文，给人看）与 `plan.json`（给编排脚本）由同一份数据生成，内容一致：
`plan.json` 的每个 `brief` 就是本文各任务下的说明原文；`files` 字段用本文 §2.2 的 `路径#段名` 记法。
第 0 波（F0-D、F0-A）按 `plan-w0.md` 进行，不在本文范围；本文从第 0 波全部合入并完成波末审查之后开始。

## 0. 依据与读法

- **约束顺序**（与 `dev-handbook.md` 相同）：简报 `00-architecture.md` 文首 U1–U6 ＞ 负责人决定 `lead-decisions.md`（L-01…L-19，引用时写"负责人决定 L-nn"）＞ 接口账本 `ledger-F0.md`（L-F0-nn、R1–R17）与 `ledger-features.md`（L-X-nn、L-Mk-nn、R-F01…R-F39、V-F01…V-F15）＞ 模块规格 `specs/<ID>.md`（§9 开发拆分、§5 界面、§6 API、§7 测试）＞ 验收 `acceptance.md`（S1–S16、C-1…C-9、E2E-1…6、MD-1…8）。本文只在它们没有写到的地方做计划层面的决定（§2.6 的 P-nn），并在相应任务里写明。
- **开工条件**：第 0 波六个子批次 W0.1–W0.6 全部合入并通过第 0 波审查（ledger-F0 §7：F0-A-core 加上 F0-D T3、T7）。第 1 波的 W1.1 从那时的 `claude/clever-thompson-5wtccp` 开出。
- **任务编号**：沿用各规格 §9 的编号（如 M2-T3）。拆开的任务加小写字母（M1-T5a/T5b、M3-T2a/T2b 等）；本计划新增的任务：W1-S0（段落脚手架）、M2-T4n 与 M6-T4n（命名提前）、M2-T7c（启用分析金标）、W1-X1/W2-X1/W4-X1（跨模块回归）、W3-E2E（第 3 波验收 E2E）、M7-T1…M7-T7（收尾）。对照表见 §2.7。
- **读任务说明**：每个任务的【依据】给出要实现的规格节与账本条目；【文件】列出本任务独占的文件（带 `#段名` 的只占该段）；【测试】给出要写的 Python、JS（`node --test`，经 pytest 桥运行）与金标；有界面的任务有【界面检查】，写明在 Chromium 里必须看到什么。账本与规格不一致处，任务说明已按账本写；仍要以账本原文为准。

## 1. 总览

### 1.1 分波与子批次

| 波 | 子批次 | 链数 | 内容 |
|---|---|---|---|
| W1 | W1.1 | 5 | 脚手架与无依赖的起步：共享文件的段落标记、M1 整数运算与 cellops 骨架、M2 共用数据、两组解析金标、M1 契约测试。 |
| W1 | W1.2 | 4 | M1-α 的晶格核心、M3 层分析与键图、M2 Miller 规范化与常量、M1 金标配方。 |
| W1 | W1.3 | 4 | M1 超胞族与原胞并行；M2 惯用胞提示与命名核心（提前给 M1 用）；M3 约束封装与平价测试。 |
| W1 | W1.4 | 5 | M1 连续形变与 info 处理器/自动名接线；M2 切面分析两语言并行；M3 的 REST/CLI。 |
| W1 | W1.5 | 6 | M2 slab 组装两语言、改真空工具；M1 网页第一部分（Lattice parameters 与共享超胞编辑器）、REST/CLI 与金标。 |
| W1 | W1.6 | 6 | M2 的 Cleave/Slab 分区与 REST/CLI、slab 完整金标与平价；M1 的其余分区、命令、菜单与公共 API。 |
| W1 | W1.7 | 5 | 第 1 波收尾：文档、Playwright 冒烟（M1、M2 与验收子集）、M1 性能、跨模块回归。 |
| W2 | W2.1 | 5 | M3 暴露原子；M4 几何核心、片段与编辑坐标系、移动工具的交互数学、测试夹具，彼此不共享文件。 |
| W2 | W2.2 | 4 | M3 选择与查询引擎；M4 设定几何、放置核心（含 add_atom/extend）与移动工具。 |
| W2 | W2.3 | 4 | M3 的 App 接口、命令、公共 API、约束标记与配色；M4 的应用层编辑与命令、Transform 分区骨架、跨语言平价与 CLI。 |
| W2 | W2.4 | 6 | 第 2 波的界面：Layers 分区、约束界面、Atom Selection、Transform 两部分、选区卡片/测量/右键/双击与剪贴板。 |
| W2 | W2.5 | 4 | 第 2 波收尾：文档与应用内帮助、Playwright 冒烟（M3、M4 与验收子集）、性能、跨模块回归。 |
| W3 | W3.1 | 3 | M5 无依赖或只依赖前两波的起步：吸附物库、二维 Delaunay、基底坐标系与位点原子（含测试夹具）。 |
| W3 | W3.2 | 6 | 位点生成与分类、放置核心（接上 M4 的默认键长）、结构集成、位点标记与 Pick site 工具、上下表面对称操作与 M3 交叉测试、参考数据校准。 |
| W3 | W3.3 | 4 | 批量放置与覆盖度；Adsorbates 分区的位点、吸附物与放置三块；性能与第一轮跨语言平价。 |
| W3 | W3.4 | 3 | Adsorbates 分区的 Coverage、Placed 列表与批量操作；M5 的 REST/客户端/CLI；第二轮平价。 |
| W3 | W3.5 | 3 | 第 3 波收尾：文档与应用内帮助、M5 的 Playwright 冒烟、M1–M5 合起来的验收 E2E。 |
| W4 | W4.1 | 3 | M6 的数据与常量、界面命名、解析金标（只写期望），给匹配与构建的并行开发打底。 |
| W4 | W4.2 | 4 | 匹配核心与构建两语言四条链并行（构建用手写的匹配结果做单元测试，W4.3 再端到端核对）。 |
| W4 | W4.3 | 3 | 金标在最终函数上重新生成与跨语言平价；M6 的 REST/客户端/CLI；Interface 分区骨架、选层与搜索。 |
| W4 | W4.4 | 3 | Interface 分区的构建选项、预览与创建；Manual 矩阵、Registry、命令与公共 API；M6 性能基准。 |
| W4 | W4.5 | 3 | 第 4 波收尾：文档与应用内帮助、Interface 的 Playwright 冒烟、跨模块回归。 |
| W5 | W5.1 | 3 | 接口审计与就地修正、体相名统一（负责人决定 L-11）、性能总检查。 |
| W5 | W5.2 | 4 | 验收自动测试、最终端到端与演示截图、文档定稿、版本 0.4.0 与 CHANGELOG、清理段落标记。 |

合计 24 个子批次、100 条链、114 个任务（W1 7 个子批次 / 35 条链；W2 5 个子批次 / 23 条链；W3 5 个子批次 / 19 条链；W4 5 个子批次 / 16 条链；W5 2 个子批次 / 7 条链）。

### 1.2 关键路径

子批次之间串行，子批次内的链并行；关键路径就是每一波里最长的依赖链：

- **第 1 波（7 个子批次）**：M1-T1 整数运算（W1.1）→ M1-T2 晶格与 Gauss 约化（W1.2）→ M1-T4 原胞（W1.3）→ M2-T3/T6a 切面分析（W1.4，还要 M3-T1/T3a 的层分析与键图）→ M2-T4/T6b slab 组装（W1.5）→ M2-T9 Cleave 分区（W1.6）→ Playwright 与文档（W1.7）。并行的支线：M1-T3a → T3b/T10 → T7a → T7b（M1 网页），M3-T1 → T4 → T11a，M2-T4n 命名核心（W1.3，M1-T10 与 M2-T4 都等它）。
- **第 2 波（5 个）**：M4-T1/T2（W2.1）→ M4-T3/T4（W2.2）→ M4-T6a（W2.3）→ M4-T7a/T7b/T7c、T6b（W2.4）→ W2.5；M3 同样长：T3b → T5 → T6/T7 → T8/T9/T10 → T13。
- **第 3 波（5 个）**：M5-T2/T3（W3.1）→ M5-T4（W3.2）→ M5-T7（W3.3）→ M5-T9b 与 T10a（W3.4）→ W3.5。
- **第 4 波（5 个）**：M6-T0（W4.1）→ M6-T1/T2/T4/T5（W4.2）→ M6-T7a 与 T3b、T6（W4.3）→ M6-T7b/T7c（W4.4）→ W4.5。
- **第 5 波（2 个）**：审计、体相名、性能（W5.1）→ 验收测试、端到端、文档、发布（W5.2）。

全程 24 个子批次加 5 次波末审查。缩短的余地（需负责人决定，默认不做）：把 M5 的早期任务 T1、T2、T13 挪到 W2.1（规格允许、文件不冲突），W3 可省一个子批次；W1.3 里让 M2-T3/T6a 先用替身（M2 §9 允许）与 M1-T4 并行，W1 可省一个子批次，但替身的返工风险高。

### 1.3 节奏

- **子批次**：各链在自己的 worktree（`scratchpad/wt/<链 id>`，分支 `sm/<链 id>`）由开发代理按 `tasks` 的顺序完成，一个任务一个提交；每个任务由一名独立核查代理核对【依据】与【测试】；有阻断或重要问题时由修复代理处理；集成代理按 `mergeOrder` 逐条合并到 `claude/clever-thompson-5wtccp`，每合并一条跑一次全量测试，全部合并后跑本子批次的出口检查，通过后推送。
- **波末**：领域、工程、界面三视角对抗审查本波全部改动，修复确认的问题后才开始下一波（与第 0 波相同）。各波最后一个子批次都有本波的文档与 Playwright 冒烟（负责人决定 L-06），审查以它们的截图为准。
- **链的大小**：一条链约等于一个 L 任务或三个 S 任务；L+M 的链只在两个任务共用同一批文件、拆开会互相等待时才这样排（如 M3-T1 → T3a、M3-T6 → T7、M4-T7c + T6b）。

## 2. 共用约定（所有链都要遵守）

### 2.1 子批次内的独立性

同一子批次的链互不依赖：一条链用到的别的模块的代码，必须在此前的子批次已经合入。账本把某个函数的提供方定在同一子批次的另一条链时，本计划已把任务挪开（见 §2.6）。
链内可以依赖本链前面的任务。没有任何链需要在本子批次里等待另一条链的结果；需要"另一条链的结果合入后才能测"的断言，放到后面子批次的平价、跨模块或 e2e 链里。

### 2.2 文件归属与段落

- **规则**：同一子批次内，一个文件只归一条链。例外只有两种，都写成 `路径#名字`：
  1. **段落**：文件里用标记围起来的一段，链只在自己的段内增改（标记由 W1-S0 或该文件的建立者放好）；
  2. **命名行段**：已有文件里按函数、常量或渲染块命名的一段（下面第二张表），链只改这一段。
  以 `/` 结尾的条目表示整个目录。`plan.json` 的 `files` 与本文各任务的【文件】用同一记法，校验脚本按它检查冲突（§9）。
- **段落标记**：Python `# --- surface-modeling <段名> ---` … `# --- end <段名> ---`；JS `// --- surface-modeling <段名> ---` … `// --- end <段名> ---`；CSS `/* --- surface-modeling <段名> --- */` … `/* --- end <段名> --- */`。相邻两段之间至少隔一行不变的内容。段内放该段的代码以及它需要的 import（Python 模块级 import 与 JS 顶层 `import` 都可以写在段内），不要去改文件开头的公共 import 区。
- **为什么这样做**：在 `scratchpad/gitmergetest` 里实测：两条分支各在相邻两段之内插入，`git merge` 自动合并；两条分支都在同一文件末尾追加，合并冲突。段落让"多条链改同一个热点文件"变成可自动合并。
- **仍然冲突时**：集成代理保留双方内容、按模块顺序排列，在集成报告里记一条；不得删掉任何一方的改动。
- **HEAD 行号**：规格里的 `文件:行号` 是 HEAD 1bb366f 的，第 0 波之后已经移动；命名行段一律按函数名、常量名或渲染块定位。
- **W5 清理**：段落标记只是开发期的归属手段，W5.2 的 M7-T7 删除全部标记与 `tests/test_segments.py`。

**段落表**（W1-S0 在第 1 波开头放好前 10 组；新文件的段由建立者放）：

| 文件 | 位置 | 段名 | 建立者 |
|---|---|---|---|
| `crystallume/core/defaults.py`、`crystallume/web/js/core/defaults.js` | `SURFACE_DEFAULTS` 源码表内、F0 键之后 | `M1`、`M2`、`M3`、`M4`、`M5-adsorbates`、`M5-sites`、`M6` | W1-S0 |
| `crystallume/core/structure.py`、`crystallume/web/js/core/structure.js` | `class Structure` 体的末尾（方法区） | `M1-T3a`、`M1-T3b`、`M1-T4`、`M2`、`M3`、`M4-geometry`、`M4-placement` | W1-S0 |
| `crystallume/core/naming.py`、`crystallume/web/js/core/naming.js` | 文件末尾 | `M1`、`M2`、`M6` | W1-S0 |
| `crystallume/core/lattice.py`、`crystallume/web/js/core/lattice.js` | 文件末尾 | `M1`、`M2` | W1-S0 |
| `crystallume/build/__init__.py` | 导入区之后与 `__all__` 列表末尾各一对（同名） | `M1`、`M2`、`M5-T1`、`M5-T5`、`M5-T6`、`M5-T7`、`M6` | W1-S0 |
| `crystallume/analysis/__init__.py` | 导入区之后与 `__all__` 列表末尾各一对（同名） | `M1`、`M3`、`M4`、`M5-sites`、`M5-topbottom`、`M6` | W1-S0 |
| `crystallume/web/js/main.js` | 面板 import 之后（含 F0-A 的 `ui/panels/surface.js`），每段只放模块入口的 `import` 行 | `M1-sections`、`M1-commands`、`M2-cleave`、`M2-slab`、`M3-commands`、`M3-layers`、`M3-constraints`、`M3-atomselection`、`M4-move`、`M4-commands`、`M4-transform`、`M4-clipboard`、`M4-place`、`M5-adsorbates`、`M5-sitepick`、`M6-interface` | W1-S0 |
| `crystallume/web/css/app.css` | 文件末尾（各段自带自己的 media 查询） | `M1`、`M2-cleave`、`M2-slab`、`M3-markers`、`M3-layers`、`M3-constraints`、`M3-atomselection`、`M4-move`、`M4-transform`、`M4-place`、`M4-card`、`M5-markers`、`M5-panel`、`M6` | W1-S0 |
| `crystallume/web/js/ui/icons.js` | 图标表内 | `M3`、`M4`、`M5` | W1-S0 |
| `crystallume/web/js/app.js` | `class App` 体的末尾 | `M2`、`M3`、`M4` | W1-S0 |
| `crystallume/core/intmath.py`、`crystallume/web/js/core/intmath.js` | 新文件，末尾 | `M2` | M1-T1 |
| `crystallume/core/cellops.py`、`crystallume/web/js/core/cellops.js` | 新文件骨架 | `M1-T3a`、`M1-T3b`、`M1-T10` | M1-T1 |
| `crystallume/build/surface.py` | 新文件骨架 | `M2-T2`、`M2-T3`、`M2-T3b`、`M2-T4`、`M2-T5` | M2-T2 |
| `crystallume/web/js/build/surface.js` | 新文件骨架 | `M2-T2`、`M2-T6a`、`M2-T3b`、`M2-T6b`、`M2-T5` | M2-T2 |
| `crystallume/core/infohandlers.py`、`crystallume/web/js/core/infohandlers.js` | 新文件 | `M1`、`M5` | M1-T10 |
| `crystallume/web/js/ui/panels/transform.js` | 新文件骨架（每段自带 import 小块） | `M4-T7a`、`M4-T7b` | M4-T6a |
| `crystallume/analysis/sites.py`、`crystallume/web/js/core/sites.js` | 新文件骨架 | `M5-T3`、`M5-T4`、`M5-T11` | M5-T3 |
| `crystallume/build/adsorbate.py`、`crystallume/web/js/build/adsorbates.js` | 新文件骨架 | `M5-T1`、`M5-T5`、`M5-T6`、`M5-T7` | M5-T1 |
| `crystallume/web/js/ui/panels/surface-interface.js` | 新文件骨架 | `M6-T7b`、`M6-T7c` | M6-T7a |

**命名行段表**：

| 记法 | 范围 | 使用者 |
|---|---|---|
| `crystallume/web/js/app.js#beginStructureEdit` | `beginStructureEdit` 方法体（P-04，条件性） | M2-T9（W1.6） |
| `crystallume/web/js/main.js#edit.applyPreview` | `edit.applyPreview` 命令的 `run`（P-04，条件性） | M2-T9（W1.6） |
| `crystallume/web/js/ui/panels/structure.js#tools-row` | 摘要之后的 Tools 行与摘要提示行（HEAD `structure.js:172-185` 一带） | M1-T7c（W1.6） |
| `crystallume/web/js/app.js#select` | `select` 方法（只在第 0 波未支持 intersect 模式时改） | M3-T6（W2.3） |
| `crystallume/web/js/app.js#PATH_LABELS` | `PATH_LABELS` 数组（HEAD `app.js:70-79`） | M3-T7（W2.3） |
| `crystallume/web/js/app.js#entry-serialization` | 项目条目的序列化/反序列化函数（只在不保留 `entry.layers` 时改） | M3-T6（W2.3） |
| `crystallume/web/js/render/viewer.js#HIGHLIGHT_COLORS` | `HIGHLIGHT_COLORS` 常量（只在仍有红色 `fixed` 时改） | M3-T7（W2.3） |
| `crystallume/web/js/app.js#_onAtomDblClick` | `_onAtomDblClick` 方法体（HEAD `app.js:754-765`） | M4-T7c（W2.4） |
| `crystallume/web/js/ui/selectioncard.js#value-rows` | 距离/角度/二面角数值行（不是动作区） | M4-T7c（W2.4） |
| `crystallume/web/js/ui/panels/structure.js#measurements-row` | Measurements 列表的行渲染 | M4-T7c（W2.4） |
| `crystallume/web/js/ui/shell.js#paste-listener` | 粘贴监听（HEAD `shell.js:976-984`） | M4-T6b（W2.4） |
| `crystallume/web/js/ui/paramform.js#elementInput` | `elementInput`（HEAD `paramform.js:13-19`） | M4-T7b（W2.4） |
| `crystallume/core/structure.py#PROP_DEFAULTS`、`crystallume/web/js/core/structure.js#PROP_DEFAULTS` | 两份 `PROP_DEFAULTS` 源码表 | M6-T0（W4.1） |
| `crystallume/web/js/ui/panels/projects.js#context-menu` | 项目列表条目的右键菜单构造 | M6-T7c（W4.4） |
| `crystallume/web/js/ui/shell.js#help-tour` | 帮助、快捷键对话框（Mouse 行）、提示栏与导览的文案 | 每波的文档链 |
| `crystallume/web/js/app.js#VERSION` | `export const VERSION` 一行 | M7-T7（W5.2） |
| `crystallume/web/js/app.js#segments` | `class App` 末尾由 W1-S0 放的三对段落标记（只删标记行） | M7-T7（W5.2） |

### 2.3 测试放置

- Python 测试放 `tests/test_*.py`；JS 单元测试放 `tests/js/*.test.mjs`，由第 0 波的 `tests/test_js_unit.py` 按文件名自动收集（不要改这个运行器）。没有 Node 时跳过，`CRYSTALLUME_REQUIRE_NODE=1` 时失败。
- **共享用例**一律用 `crystallume.cases/1` 外壳（ledger-F0 L-F0-27），放在 `tests/data/<area>/…`。op 与配方放在各模块自己的 op 文件里；为了让同一模块的两条链并行，op 文件可以按任务拆成 `tests/ops/<模块>_<主题>.py` 与 `tests/js/ops/<模块>_<主题>.mjs`（两者都按文件名自动导入，P-02）。
- **先写期望**：金标先于实现写好，每个用例带 `skip` 理由（写明哪个任务注册 op）；两种语言的 op 都合入之后由指定的任务去掉 skip（P-03）。
- **跨语言平价**放在每个模块自己的 `tests/test_m<N>_parity.py`，不改共用的 `tests/test_js_parity.py`（P-02）。比较 `info.surface` 时排除 `bulk.name`（负责人决定 L-11，W5.1 解除）与网页的 `bulk.entryId`。
- **性能**：Python 性能测试标 `slow`（不新增标记）；JS 性能测试放 `tests/js/perf/*.perf.mjs`，由 `tests/test_js_perf.py`（`slow`，W1.7 建立）运行，不进默认收集（P-10）。
- **端到端**：Node 版 Playwright（负责人决定 L-06），`tests/e2e/*.spec.mjs`，共用 `tests/e2e/harness.mjs`，由 `tests/test_e2e.py` 包装、标 `slow`；选择器只用各规格 §5 控件表里的 `aria-label`，改名必须同时改 e2e。每个子批次只有一条 e2e 链维护 harness 与包装（它的 `files` 里列出）。
- **测试文件名**：不要用别人已经占用的名字（例：`tests/test_constraints.py` 归 F0-D，M3 用 `tests/test_fix_free.py`；`tests/test_adsorbates.py` 归 M3，M5 的库测试用 `tests/test_adsorbate_library.py`；JS 的晶格测试 M1 用 `lattice_tools.test.mjs`、M2 用 `lattice_hint.test.mjs`）。
- **开发期参考数据**：ASE 3.29 在 `scratchpad/proto/m1/refvenv/bin/python`；原型在 `scratchpad/proto/<模块>v2/`。生成参考数据的脚本放 `scripts/dev/` 或 `scripts/gen_*.py`，不进包、测试不依赖它们（P2）；需要 pymatgen 时只在 scratchpad 里另建 venv，不装进仓库。

### 2.4 文件束

- **API 文件束**（REST、客户端、CLI 及其测试；结构交错，不分段，每个子批次最多一条链拥有）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`。拥有它的链：W1.4 M3-T11a、W1.5 M1-T6、W1.6 M2-T8、W2.1 M3-T3b（只改其中四个文件）、W2.3 M4-T8a、W3.4 M5-T10a、W4.1 M6-T0（只改 `config.py`）、W4.3 M6-T6、W5.1 M7-T1。
- **文档束**：`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`，外加命名行段 `crystallume/web/js/ui/shell.js#help-tour`（帮助、快捷键对话框 Mouse 行、提示栏与导览）。每波最后一个子批次的文档链拥有；各波把条目写进 `CHANGELOG.md` 的 Unreleased 一节（若第 0 波还没有建这个文件，就由 W1.7 的文档链建立），W5.2 的 M7-T7 整理成 0.4.0。
- **e2e 共用文件**：`tests/e2e/harness.mjs`、`tests/test_e2e.py`。

### 2.5 界面检查与端口

- 有界面工作的链在 `plan.json` 里有唯一的端口（8820 起，全计划不重复）；端口为 0 的链没有界面工作。
- 启动：`cd <worktree> && $DEVPY -m crystallume serve --port <端口> &`，用完关掉；静态模式检查：`python3 -m http.server <端口> --directory crystallume/web`（P1：网页端全部在浏览器里算，静态版必须可用）。两种模式至少各打开一次。
- Chromium：`require('playwright')` 可直接用，以 root 运行加 `--no-sandbox`；不要运行 `playwright install`。自己看的截图用 `deviceScaleFactor: 1`，存 `scratchpad/shots/<链 id>/`；交审查的 e2e 截图存 `tests/e2e/out/`。
- 每次界面检查都要确认：`document.body.dataset.ready === 'true'`、没有 `pageerror` 与 `console.error`、新控件有 `aria-label`、U1-b（没有 slab 模式或徽章）与 U4-a（真空框为空、无占位数字）成立。

### 2.6 计划层面的决定

| 编号 | 决定 | 内容与理由 |
|---|---|---|
| P-01 | 段落归属与 W1-S0 脚手架 | §2.2；W1.1 的第一条链在 10 组热点文件里放好全部段落，之后各波的并行链只在自己的段内改。W5.2 清理。 |
| P-02 | 测试与 op 文件按模块或任务拆开 | L-F0-27 的细化：`tests/ops/<模块>_<主题>.py`；平价测试按模块分文件；避免并行链改同一个测试文件。 |
| P-03 | 金标一律 `crystallume.cases/1`，先写期望后去 skip | 覆盖 M2 §7.2、M5 §7.1 写的自定义格式（L-F0-27 优先于规格）；M2-T7a、M3-T2a、M4-T9a、M6-T3a 先写，平价任务去 skip。 |
| P-04 | 预览条与 mod+Enter 对"新增结构"会话的语义 | 规格与账本未覆盖的缺口（M6 §5.4 已指出：P-swap 会话的预览条按钮与 `edit.applyPreview` 调用无参 `commit()` 会替换活动结构，违背 P4）。默认做法：M2-T9 先核对第 0 波实现；若确有此问题，在 `beginStructureEdit` 加会话选项 `commitArgs`（预览条与 mod+Enter 调用 `ses.commit(ses.commitArgs)`），Cleave 与 Interface 会话传 `{ addAsNew: true, name }`。**需负责人确认。** |
| P-05 | M1 的命名与 info 处理器钩子 | L-X-07 第 4 条要求 M1 的晶胞操作调用 M2 的命名函数，而它们原定在 W1.5 才交付。做法：M1-T1 在 `core/cellops.*` 放 `begin_cell_op`/`finish_cell_op` 桩，T3a/T3b/T4 只调用钩子，M1-T10（W1.4）填实（`apply_info_handlers` → `refresh_auto_name` → `rename_after_cell_change`）；`reference_mesh` 因要用 `normalize_surface_info`，从 M1-T4 移到 M1-T10。 |
| P-06 | M2 命名核心提前为 M2-T4n（W1.3） | L-M2-07 的八个函数从 M2-T4/T6b 拆出，两种语言一次交付；M2-T4/T6b 只在 `naming.*#M2` 段内做必要修正。 |
| P-07 | 每个模块的 `SURFACE_DEFAULTS` 键由该模块第一个触及 defaults 的任务一次加入 | M1-T2、M2-T1、M3-T1、M4-T1、M5-T1（`adsorbate_*`）与 M5-T3（`site_*`）、M6-T0；仍满足 L-X-08 的"同一键只由一个模块添加、两份同时改、逐键测试"。 |
| P-08 | M4 的任务内容按账本重新分配 | `edit_frame` 从 T1 移到 T2（L-M4-04 的提供方是 T2–T4，使 T1 与 T2 可并行）；`add_atom`/`extend` 的放置参数归 T4（L-M4-02）；账本里的 M4 任务号与规格 §9 不一致，对照见 §2.7。 |
| P-09 | M1 的 Cell 插槽与命令文件 | 按 M1 §5.1 注册 5 个分区 `cell.parameters`…`cell.orientation`（L-M1-16 的 `{id: 'cell', slot: 'cell'}` 视为插槽说明）；`cell.*` 命令与执行函数随分区任务（T7a、T7b）放 `web/js/commands/cell.js`；T7c 只做菜单、选区动作、Tools 行迁移；`defineApi` 放 `web/js/api/cellapi.js`（T8a）。 |
| P-10 | 性能测试的放置 | Python 用 `slow`；JS 放 `tests/js/perf/*.perf.mjs`，由 `tests/test_js_perf.py` 运行，不进默认收集。 |
| P-11 | 选区动作顺序 | Fix ▾ 35（ledger-F0 §6 M3）、Move… 60、Rotate… 61（L-M4-07）、`sel.markAdsorbate` 70、M4 的其余动作 72–76（M4 §5.3）、`cell.atomToOrigin` 80（只进菜单）；M5 的动作取 77–79；M7-T1 在 W5.1 核对配额。 |
| P-12 | 体相名统一的写法（L-11） | 建议统一为 Python 现行写法 `<式> <原型键>`（如 `Pt fcc`，与 M2 §5.2 的 Bulk 行示例一致），在 W5.1 实现。**需负责人确认写法。** |
| P-13 | M5 的早期任务留在第 3 波 | 按负责人的分波（W3 = M5）；若要缩短第 3 波，可把 M5-T1、T2、T13 挪到 W2.1（无依赖、文件不冲突）。 |
| P-14 | 各波的 e2e 与验收子集 | 每波最后一个子批次写本波模块的 Playwright 冒烟，并把 acceptance §3.2 中已能运行的 E2E 步骤先实现为 `tests/e2e/wN_acceptance.spec.mjs`；W5.2 汇总成最终的 E2E-1…E2E-5（E2E-6 在 W5.1）。 |
| P-15 | 跨模块回归链 | W1-X1、W2-X1、W4-X1 把模块之间的接缝（名字、记录、约束、切口）钉成测试；发现缺陷只写 `xfail(strict=True)` 并交负责人，不在回归链里改源码。 |
| P-16 | 验收文本里已被账本改掉的写法 | acceptance 的 CLI 行按 R-F13 改写（`--surface-cell 3x3` 代替 `--supercell 3 3`、`--index`、`--from`/`--format`）；E2E-4 第 3 步按负责人决定 L-16 改为 Slab 分区内嵌的超胞编辑器；MD-5 的 `shown with 10 Å` 按 R-F32 作废；S2-3、S3-2 的名字按 L-19 取 `Cu(100) (√2×√2)R45° 4L` 一类；G-15、G-32、G-39 已由 L-03、L-12、L-19 裁决，不再 xfail。 |
| P-17 | 两处小的归属调整 | M3 §3.6 的单元分组（`group="units"`）随 `find_layers` 在 M3-T1 交付（L-M3-01 把 `group` 列在 T1 的签名里）；`/analysis/layers` 的 `surface: true` 在 W1.4 先返回说明性 400，W2.1 由 M3-T3b 补成正式行为。 |

### 2.7 任务编号与拆分对照

| 模块 | 规格任务 | 本计划的调整 |
|---|---|---|
| M1 | T1–T12（规格 §9） | T5 → T5a（W1.2 配方）+ T5b（W1.5 金标）；T8 → T8a（W1.6 公共 API）+ T8b（W1.7 文档）；`reference_mesh` 从 T4 移到 T10；T7c 的 13 个命令中 5 个归 T7a、8 个归 T7b（P-09） |
| M2 | T1–T12（T1c 取消，R-F03；T13–T15 为第二期，不在本期） | 新增 T4n（命名核心，W1.3）与 T7c（启用分析金标，W1.5）；T3b（应该）放在 W1.6 的平价链 |
| M3 | T1–T14 | §3.6 单元分组从 T5 移到 T1；T2 → T2a（W1.1 金标）+ T2b（W1.3 平价）；T12 → T12a（W1.7，核心文档）+ T12b（W2.5）；T14 放在 W3.2 |
| M4 | T1–T9（规格 §9；账本里的 M4 T5 = 规格 T4 放置，账本 T2 = 规格 T4 的 `add_atom`/`extend`，账本 T6 = 规格 T6b 剪贴板，账本 T7–T10 = 规格 T5、T6a、T7a–c 的网页部分，账本 T11 = 规格 T8 的 CLI） | T5 → T5a（交互数学）+ T5b（工具）；T8 → T8a（CLI）+ T8b（文档）；T9 → T9a（夹具）+ T9b（平价）+ T9c（e2e 与性能）；`edit_frame` 从 T1 移到 T2（P-08） |
| M5 | T1–T14 | T9 → T9a（W3.3）+ T9b（W3.4）；T10 → T10a（API）+ T10b（文档）；T12 → T12a/T12b（平价）+ T12c（e2e）；L-05 的 M4 默认键长接线并入 T5 |
| M6 | T0–T8（含 T7a–c） | T3 → T3a（W4.1 解析金标）+ T3b（W4.3 最终金标与平价）；`interface_name` 提前为 T4n（W4.1）；T8 → T8a（性能）+ T8b（文档）+ T8c（e2e） |
| M7 | 无规格；按任务要求定义 | T1 API 审计、T2 文档定稿、T3 验收测试、T4 端到端与演示截图、T5 性能总检查、T6 体相名统一（L-11）、T7 版本与 CHANGELOG |

### 2.8 每个子批次的通用出口检查

每个子批次的 `exitChecks` 第一条都是：集成分支上全量 Python 测试（含 pytest 桥运行的 `tests/js/*.test.mjs`）通过、`CRYSTALLUME_REQUIRE_NODE=1` 下通过、`tests/test_segments.py` 通过、`git status` 干净。有界面改动的子批次另有一条：静态模式与 `crystallume serve` 下应用都能启动且控制台无错误。其余各条是本子批次特有的测试文件与 acceptance 检查项（编号见 `acceptance.md` §1、§2、§3.2）。

## 3. 第 1 波：M1 晶胞工具 + M3 层分析核心 + M2 切面与 slab

### W1.1

脚手架与无依赖的起步：共享文件的段落标记、M1 整数运算与 cellops 骨架、M2 共用数据、两组解析金标、M1 契约测试。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-scaffold` | 8820 | W1-S0 共享文件的段落标记（脚手架，不改行为）、M1-T12 M1 对第 0 波接口的契约测试 | `crystallume/core/defaults.py`、`crystallume/web/js/core/defaults.js`、`crystallume/core/structure.py`、`crystallume/web/js/core/structure.js`、`crystallume/core/naming.py`、`crystallume/web/js/core/naming.js`、`crystallume/core/lattice.py`、`crystallume/web/js/core/lattice.js`、`crystallume/build/__init__.py`、`crystallume/analysis/__init__.py`、`crystallume/web/js/main.js`、`crystallume/web/css/app.css`、`crystallume/web/js/ui/icons.js`、`crystallume/web/js/app.js`、`tests/test_segments.py`、`tests/test_m1_contracts.py`、`tests/js/m1_contracts.test.mjs` |
| `w1-m1-intmath` | — | M1-T1 整数运算（双语言）与 cellops 骨架 | `crystallume/core/intmath.py`、`crystallume/web/js/core/intmath.js`、`crystallume/core/cellops.py`、`crystallume/web/js/core/cellops.js`、`tests/test_intmath.py`、`tests/js/intmath.test.mjs` |
| `w1-m2-data` | — | M2-T2 共用数据模块 webdata、氧化态与元素集合；build/surface 骨架 | `crystallume/core/webdata.py`、`crystallume/web/js/core/webdata.js`、`crystallume/web/data/oxidation_states.json`、`scripts/gen_oxidation_states.py`、`crystallume/build/surface.py`、`crystallume/web/js/build/surface.js`、`crystallume/core/elements.py`、`crystallume/web/js/core/elements.js`、`tests/test_webdata.py`、`tests/test_oxidation_states.py`、`tests/js/webdata.test.mjs`、`tests/js/oxidation_states.test.mjs` |
| `w1-m2-golden` | — | M2-T7a 切面与 slab 的解析金标（只写期望） | `tests/data/surface/cleave/`、`tests/test_cleave_golden_shape.py`、`tests/ops/m2_recipes.py`、`tests/js/ops/m2_recipes.mjs` |
| `w1-m3-golden` | — | M3-T2a 层分析的金标与生成脚本（只写期望） | `scripts/gen_layer_fixtures.py`、`tests/data/surface/layers/`、`tests/test_layers_golden_shape.py` |

**合并顺序**：`w1-scaffold` → `w1-m1-intmath` → `w1-m2-data` → `w1-m2-golden` → `w1-m3-golden`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- W1-S0：`tests/test_segments.py` 核对 plan.md §2.2 表中 10 组文件的段落标记（成对、各一次、顺序正确）；全量测试结果与合并前相同（脚手架不改行为）
- M1-T12：`tests/test_m1_contracts.py` 与 `tests/js/m1_contracts.test.mjs` 通过；若有 `xfail(strict=True, reason="F0: …")`，差异已列进集成报告交负责人
- M1-T1：`tests/test_intmath.py`、`tests/js/intmath.test.mjs` 通过（`hnf_matrices_2d(6)` 12 个矩阵与次序；对角矩阵的格点顺序与 F0-D `repeat` 相同）；`core/cellops.*` 骨架可导入、钩子桩存在
- M2-T2：`tests/test_webdata.py`、`tests/test_oxidation_states.py`、对应 JS 测试通过；`METALS`/`ANIONS`/电负性两语言逐项相同（L-M2-06）；`oxidation_states.json` 仓库里只有一份
- 金标：`tests/data/surface/cleave/` 与 `tests/data/surface/layers/` 被 `tests/test_cases.py` 与 `tests/js/cases.test.mjs` 读到，全部为带理由的 skip，不失败；外壳格式测试通过
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`；打开 CONTCAR 夹具没有任何提示（U1-a）

#### W1-S0 共享文件的段落标记（脚手架，不改行为）（链 `w1-scaffold`）

【目标】在第 1–4 波会被多条并行链同时修改的 10 组文件里插入 plan.md §2.2 表列出的段落标记，使各链只在自己的段内增改，git 合并互不冲突（实测：不同段内的插入自动合并，同一插入点会冲突）。不改任何已有代码行，行为不变。

【依据】plan.md §2.2（段落表、标记格式、位置规则）；ledger-F0 §0.4、ledger-features §0.4（文件归属）；L-X-08（SURFACE_DEFAULTS 按模块分段）；ledger-F0 L-F0-49/L-F0-52（模块入口文件只在 `main.js` 加一行 import）。

【实现】

- 标记格式：Python `# --- surface-modeling <段名> ---` 与 `# --- end <段名> ---`；JS `// --- surface-modeling <段名> ---` 与 `// --- end <段名> ---`；CSS `/* --- surface-modeling <段名> --- */` 与 `/* --- end <段名> --- */`。每对标记之间为空；相邻两段之间保留一个空行（让每段的插入点互不相邻）。

- 位置与段名（按表中顺序连续排列）：

  1. `core/defaults.py`、`web/js/core/defaults.js`：`SURFACE_DEFAULTS` 源码表内、F0 键之后：M1、M2、M3、M4、M5-adsorbates、M5-sites、M6。若 F0-D 的实现把键写在多处（值表、说明表、类型表），每处都放同名段。

  2. `core/structure.py`、`web/js/core/structure.js`：`class Structure` 体的末尾：M1-T3a、M1-T3b、M1-T4、M2、M3、M4-geometry、M4-placement。

  3. `core/naming.py`、`web/js/core/naming.js` 末尾：M1、M2、M6。

  4. `core/lattice.py`、`web/js/core/lattice.js` 末尾：M1、M2。

  5. `build/__init__.py`：导入区之后一组、`__all__` 列表末尾一组（同名）：M1、M2、M5-T1、M5-T5、M5-T6、M5-T7、M6。

  6. `analysis/__init__.py`：同上：M1、M3、M4、M5-sites、M5-topbottom、M6。

  7. `web/js/main.js`：面板 import 之后（含 F0-A T10 的 `./ui/panels/surface.js`）：M1-sections、M1-commands、M2-cleave、M2-slab、M3-commands、M3-layers、M3-constraints、M3-atomselection、M4-move、M4-commands、M4-transform、M4-clipboard、M4-place、M5-adsorbates、M5-sitepick、M6-interface。

  8. `web/css/app.css` 末尾：M1、M2-cleave、M2-slab、M3-markers、M3-layers、M3-constraints、M3-atomselection、M4-move、M4-transform、M4-place、M4-card、M5-markers、M5-panel、M6。

  9. `web/js/ui/icons.js` 图标表内：M3、M4、M5。

  10. `web/js/app.js`：`class App` 体的末尾：M2、M3、M4。

- 新增 `tests/test_segments.py`：清单写成测试里的常量（与上表一致），逐文件断言每段的开始与结束标记各出现一次、成对、顺序与表一致。W5 的 M7-T7 会同时删除标记与本测试。

【U 与负责人决定】U1（只加注释、不改任何行为，也不引入任何 slab 分类）；负责人决定：无直接相关项（L-06 的 aria-label 选择器不受影响）。

【文件】（只插标记）`crystallume/core/defaults.py`、`crystallume/web/js/core/defaults.js`、`crystallume/core/structure.py`、`crystallume/web/js/core/structure.js`、`crystallume/core/naming.py`、`crystallume/web/js/core/naming.js`、`crystallume/core/lattice.py`、`crystallume/web/js/core/lattice.js`、`crystallume/build/__init__.py`、`crystallume/analysis/__init__.py`、`crystallume/web/js/main.js`、`crystallume/web/css/app.css`、`crystallume/web/js/ui/icons.js`、`crystallume/web/js/app.js`；新建 `tests/test_segments.py`。同链的 M1-T12 另占 `tests/test_m1_contracts.py`、`tests/js/m1_contracts.test.mjs`。

【测试】`tests/test_segments.py`；全量 pytest 与 node 测试照常通过。

【界面检查】（Chromium，本链端口）静态模式与 `crystallume serve` 下应用照常启动（`document.body.dataset.ready === 'true'`），控制台无错误；Surface 面板（Shift+5）、Structure 面板与改动前一样。

【注意】某文件的结构若与预期不同（例如 `SURFACE_DEFAULTS` 不是字面量表、`class App` 不在 `app.js`），选最接近的等价位置，并在报告里写清每段的实际位置；不要顺手整理代码。

#### M1-T12 M1 对第 0 波接口的契约测试（链 `w1-scaffold`）

【目标】对 M1 用到的每个 F0-D/F0-A 接口各写一次签名与返回字段断言，让第 0 波实现与账本的偏差在第 1 波开头就暴露。

【依据】M1 §7.1 末段（契约测试清单）、§10；ledger-F0 §6 M1 第 1–10 条（改名后的名字），以及 L-F0-03（`_remap`/`remap`）、L-F0-04（`_set_source`、追踪器）、L-F0-06（`write_frame`/`writeFrame`、`keep_frame(index=0)`、`set_positions(..., mark=)`）、L-F0-07（`_adopt(other, *, src=None)`）、L-F0-10（`mark_edited`）、L-F0-13（`apply_basis_change`、`transform_move_flags`）、L-F0-15–18（`find_vacuum_gap`、`display_cuts`、`gap_cut`、`unwrap_along_gap(f, cut)`、`surface_normal(s, *, frame, require_gap, exclude)`、`require_gap`、`vacuum_axis`、`vacuum_gap_hint`、`make_contiguous(s, axis, *, cut)`、`contiguous_shifts`）、L-F0-19（`wrap_fractional`）、L-F0-26（`close_contacts`）、L-F0-48（`imatrixInput` 的 `presets(ctx)`/`area`/`warn`/`positive: false`）、L-F0-49（`openSection`）、L-F0-53（`defineApi`）、L-F0-54（`startTask(label, {cancel})`）。

【实现】只写测试，不改源码。Python `tests/test_m1_contracts.py`：`inspect.signature` 断言仅限关键字参数与默认值；在 CONTCAR 夹具 `tests/data/surface/contcar_pt111.vasp` 上各调用一次并断言返回字段（`GapCut` 的 `lo`、`surface_normal` 的 `axis`/`cut`/`surface`/`vacuum_axes` 等）。JS `tests/js/m1_contracts.test.mjs`：导入 `core/vacuum.js`、`core/structure.js`、`core/constraints.js`、`core/lattice.js`、`ui/inputs.js`、`api/namespaces.js` 的导出并断言是函数；纯函数各调用一次；DOM 相关的只断言导出存在，不渲染。

【U 与负责人决定】U6（发现的偏差交负责人裁决、开发不等待）；负责人决定：无直接相关项。

【文件】`tests/test_m1_contracts.py`、`tests/js/m1_contracts.test.mjs`。

【测试】即上。某接口与账本不符时，测试仍按账本写，标 `xfail(strict=True, reason="F0: <差异>")`（JS 用 `test.todo` 并在名字里写差异），并在报告里逐条列出，交负责人决定是否回修第 0 波。

#### M1-T1 整数运算（双语言）与 cellops 骨架（链 `w1-m1-intmath`）

【目标】双语言整数运算 `core/intmath.*`；同时建立 M1 后续任务共用的 `core/cellops.*` 骨架（段落、`CellOpResult`、两个钩子桩），让 W1.3 的 M1-T3a 与 M1-T4 能并行。

【依据】M1 §3.2、§3.17（E-SC0、E-SC0b）；ledger-features L-M1-01（全部签名；除法 floor 语义；JS 每个乘积查 `Number.isSafeInteger`，否则 `RangeError('integer overflow in lattice arithmetic')`）、L-M1-08（`CellOpResult` 字段；`cellops.js` 不 import `structure.js`）、L-M1-14、L-X-07 机制第 4 条（命名在 `apply_info_handlers` 之后）、§0.4（intmath 由 M1 T1 建立，M2 T1 追加）；plan.md P-05。

【实现】

- `crystallume/core/intmath.py`、`web/js/core/intmath.js`：`egcd`、`int_det3`、`int_adjugate3`、`is_unimodular`、`as_int_matrix(m, *, what="matrix", plane=(0, 1))`、`hermite_normal_form`、`hermite_normal_form_2d`、`supercell_lattice_points(P)`（陪集代表按新分数坐标整数键的字典序，(0,0,0) 在首；det < 0 时按 −P 枚举）、`hnf_matrices_2d(n)`（i 升序、j 升序）。文件末尾留空段 `M2`（M2-T1 用）。

- `crystallume/core/cellops.py`、`web/js/core/cellops.js` 骨架：模块文档字符串；Python `CellOpResult` dataclass（L-M1-08 的字段），JS 工厂 `cellOpResult(fields)`；段 `M1-T3a`、`M1-T3b`、`M1-T10`。在段 `M1-T10` 内放两个桩：`begin_cell_op(structure) -> dict`（返回 `{"name": structure.name}`）与 `finish_cell_op(structure, ctx, before) -> None`（只调用 `mark_edited(structure, ctx["mark"])`），JS 为 `beginCellOp`/`finishCellOp`；文档字符串写明 M1-T10 会把它们改为 `auto_name_state` → `apply_info_handlers(ctx)` → `refresh_auto_name`（返回 False 时 `rename_after_cell_change`）。

【U 与负责人决定】U2/C1（`supercell_lattice_points` 决定超胞的原子顺序，对角矩阵必须与 `repeat` 相同）；负责人决定 L-12、L-19 只体现在钩子的文档字符串里（实现归 M1-T10）。

【文件】`crystallume/core/intmath.py`、`crystallume/web/js/core/intmath.js`、`crystallume/core/cellops.py`、`crystallume/web/js/core/cellops.js`（新建骨架）、`tests/test_intmath.py`、`tests/js/intmath.test.mjs`。

【测试】M1 §7.1 "格点"与"HNF / egcd"两行全部用例：对角 (2,2,2)、(3,1,2)、(1,1,1) 与 F0-D `repeat` 的原子顺序相同；7 个矩阵（含 `[[1,0,0],[0,1,0],[37,0,1]]`、det 16 的 MS BN 矩阵）的个数、在胞内、互不同余；det < 0 与 −P 的点集相同；`hermite_normal_form_2d`；`hnf_matrices_2d(6)` 的 12 个矩阵与次序；负数输入；秩不足报错；JS 同一组用例加溢出保护。两语言读同一个 JSON 常量块，结果逐项相同。

【注意】骨架里不要实现任何晶胞操作；钩子桩的签名在文档字符串里写死，T3a/T3b/T4 都按它调用。

#### M2-T2 共用数据模块 webdata、氧化态与元素集合；build/surface 骨架（链 `w1-m2-data`）

【目标】交付 M2/M5/M6 共用的数据模块 `webdata`、形式氧化态表与估算、Python 的 `METALS`/`ANIONS` 与电负性对齐，并建立 `build/surface.*` 的分段骨架。

【依据】M2 §3.9.1、§9 T2；M5 §4.2（`webdata` 的接口与代码原样）；ledger-features L-M2-06、R-F30、R-F31、§0.4、§10.2 第 9 条；ledger-F0 L-F0-22、L-F0-56、§6 M2 第 3、6 条；V-F11 第 2 条（启动顺序改用 `registerBootTask`，M2 不改 `main.js`）；V-F14 第 1 条。

【实现】

- `crystallume/core/webdata.py`：`load_web_data(name)`（`importlib.resources` 读 `crystallume/web/data/<name>`，包数据已含 `web/**/*`）；`web/js/core/webdata.js`：`loadWebData`、`webData`、`setWebData`（浏览器 `fetch(new URL('../../data/<name>', import.meta.url))`，Node 测试经 `setWebData` 注入用 `fs` 读到的 JSON）。

- `crystallume/web/data/oxidation_states.json`：按 M2 §3.9.1 开发期生成并冻结；生成脚本 `scripts/gen_oxidation_states.py`（运行时不依赖）。

- `load_oxidation_states`、`estimate_oxidation_states(composition)`（JS 同名 camelCase；JS 表未加载时调用抛错，不静默返回 unknown，M2 §7.3）放在 `build/surface.py` 与 `web/js/build/surface.js` 的段 `M2-T2` 内。启动任务 `registerBootTask('oxidation-states', loadOxidationStates)` 由 M2-T9 注册，本任务不碰 `main.js`。

- 建立 `build/surface.py` 骨架：段 `M2-T2`、`M2-T3`、`M2-T3b`、`M2-T4`、`M2-T5`；`web/js/build/surface.js`：段 `M2-T2`、`M2-T6a`、`M2-T3b`、`M2-T6b`、`M2-T5`。每段开头自带自己的 import 小块（Python 的模块级 import、JS 的顶层 `import` 都可以放在段内）。

- `core/elements.py` 加 `METALS`、`ANIONS`（与 JS 逐项相同）；电负性：Python 用 JS `PAULING` 的值，JS 补 Pm、Rn、Am–Lr（M5 §10 F0-D 表）；`web/js/core/elements.js` 只补电负性缺项。

【U 与负责人决定】U5（D1：Cleave 分区要等氧化态表加载后才可用，启动任务由 M2-T9 注册）；负责人决定：无直接相关项。

【文件】`crystallume/core/webdata.py`、`crystallume/web/js/core/webdata.js`、`crystallume/web/data/oxidation_states.json`、`scripts/gen_oxidation_states.py`、`crystallume/build/surface.py`（新建骨架）、`crystallume/web/js/build/surface.js`（新建骨架）、`crystallume/core/elements.py`、`crystallume/web/js/core/elements.js`、`tests/test_webdata.py`、`tests/test_oxidation_states.py`、`tests/js/webdata.test.mjs`、`tests/js/oxidation_states.test.mjs`。

【测试】M2 §7.1"氧化态"一行（SrTiO3、TiO2、ZnO、CeO2、Al2O3、NaCl、GaAs 精确；Fe3O4、Co3O4 平均并给 W11；TaON；CaCO3（C +4）；TiH2（H −1）；Pt、PtTi 为 0；§3.9.1 的 40 种化合物 Charge unknown 为 0；缺表元素 → None；JS 未加载时抛错）；`METALS`、`ANIONS`、电负性两语言逐项相同；`load_web_data` 在已安装包里能读到；同一 JSON 只存一份。

【注意】本任务不在 `build/__init__.py` 导出任何东西（M2-T4 在 W1.5 导出）。

#### M2-T7a 切面与 slab 的解析金标（只写期望）（链 `w1-m2-golden`）

【目标】先写切面与 slab 的解析金标与真实输入，供 W1.4–W1.6 的 Python 与 JS 实现各自对照。

【依据】M2 §7.2（金标与真实输入清单）、§0.3（原型实测表）；acceptance §0.4（体相与显式晶格常数）、§0.5（容差代号）与 S1-1/S1-2、S2-1/S2-2、S3-1、S4-1/S4-2、S5-1/S5-2、S6-1/S6-2、S7-1/S7-2、S8-1–S8-3、S9-1–S9-4、S10-1–S10-3、S11-1–S11-4/S11-6、S12-1/S12-2/S12-4、S13-1 的解析期望；ledger-F0 L-F0-27（一律用 `crystallume.cases/1` 外壳与配方输入，覆盖 M2 §7.2 写的 `{input, op, params, expected}` 格式，plan.md P-03）；ledger-features L-X-01（`info.surface` 字段）、L-X-07（名字）；负责人决定 L-19（`Cu(100) (√2×√2)R45° 4L`）、L-13（已有结构 `set_vacuum(0)` → E12d）；U2、U4。

【实现】

- 三个子目录：`tests/data/surface/cleave/analysis/`（op `terminations`：网格长度与夹角、面积、d_hkl、每周期层数、每层组成、终止面数与标签、断键数、Tasker 类型）；`.../cleave/slab/`（op `surface`：原子数、层数、厚度、`c = 厚度 + V`、`pbc = [T,T,T]`、tags 1…L、约束计数、`info.surface` 的关键键、名字逐字）；`.../cleave/tools/`（ops `setVacuum`、`flipSlab`、`standardizeSlab`：CONTCAR 夹具改真空到 15/20 Å、石墨烯 T T F 改真空后 pbc 不变、真空沿 a、`set_vacuum(0)` → E12d 的错误比较器）。另放 `.../cleave/inputs/`（MP 风格原胞 POSCAR：Pt、Fe、菱方刚玉；σ = 0.01–0.02 Å 固定种子的带噪声体相；LaFeO3 Pbnm；锐钛矿；SiC 4H/6H；左手 CONTCAR；带漂浮分子的 CONTCAR）。

- 每个用例写 `skip` 理由：`op terminations is registered by M2-T3 (Python) and M2-T6a (JS)` 等；skip 由 M2-T7c（W1.5，analysis 与 tools）与 M2-T7b-lite（W1.6，slab）去掉。

- 输入优先用配方（`input.recipe`，如 `{"name": "bulk", "args": {"prototype": "fcc", "elements": ["Pt"], "a": 3.92}}`）。本任务在新文件 `tests/ops/m2_recipes.py` 与 `tests/js/ops/m2_recipes.mjs` 注册全仓库共用的通用配方 `bulk`（任意原型 + 显式晶格常数；Python 调用 `build.crystal`，JS 调用 `web/js/build/crystal.js`），并写一个核对用例证明两语言给出同一结构；其他模块复用 `bulk`，不得重复注册（L-F0-27：重名注册报错）。配方名与参数写在 `tests/data/surface/cleave/README.md`。

- 期望只用解析式或 acceptance/规格里已核对过的数字；名字、标签逐字。

【U 与负责人决定】U2（slab 期望一律 pbc T T T）、U4（V 必填、总间隙、V = 0 合法）；负责人决定 L-13、L-19。

【文件】`tests/data/surface/cleave/`（整个新目录）、`tests/test_cleave_golden_shape.py`、`tests/ops/m2_recipes.py`、`tests/js/ops/m2_recipes.mjs`。

【测试】`tests/test_cleave_golden_shape.py`：每个用例有 id、op、input、expect、skip 理由，配方名都在 README 里；`tests/test_cases.py` 与 `tests/js/cases.test.mjs` 读到后全部按 skip 处理。

【注意】不依赖 ASE/pymatgen 运行；要交叉核对时用 ASE 参考环境 `scratchpad/proto/m1/refvenv/bin/python`（ASE 3.29；ASE 的 `vacuum` 是每侧，换算成总间隙再比），核对结果写进报告，不进仓库。

#### M3-T2a 层分析的金标与生成脚本（只写期望）（链 `w1-m3-golden`）

【目标】层分析、吸附物识别与暴露原子的金标数据，供 M3-T1/T3a（W1.2）与 M3-T3b（W2.1）对照。

【依据】M3 §7.1 全表（案例与期望，解析值优先）、§3.3（U1：切口与显示同一个）；acceptance S14-3；ledger-F0 L-F0-27（外壳与配方）；ledger-F0 §6 M3 第 2 条；U1、U2。

【实现】`scripts/gen_layer_fixtures.py`（开发期运行，测试不依赖它）按 M3 §7.1 解析构造 slab：fcc/hcp/bcc 低指数面按层坐标直接写出；氧化物用仓库现有体相原型加旋转与裁剪；以 pbc T T T 为主，每组另留一份 T T F 对照。输出 `tests/data/surface/layers/*.json`（`crystallume.cases/1`，ops `findLayers`、`findAdsorbates`、`bondGraph`、`surfaceAtoms`）。期望：`atomLayer`、层高（atol 1e-6）、`period`/`vacuum`/`coords`/`normalSource`、提示文案、吸附物及来源、κ* 与暴露原子。每个用例带 skip：`op findLayers is registered by M3-T1`、`op surfaceAtoms is registered by M3-T3b (wave 2)` 等。

【U 与负责人决定】U1（切口与显示同一个）、U2（以 pbc T T T 为主）；负责人决定：无直接相关项。

【文件】`scripts/gen_layer_fixtures.py`、`tests/data/surface/layers/`、`tests/test_layers_golden_shape.py`。

【测试】外壳格式测试 `tests/test_layers_golden_shape.py`；`tests/test_cases.py`、`tests/js/cases.test.mjs` 全部按 skip 处理、不失败。

【注意】v1 原型 "pt111 6x6 6L" 实为 864 原子（M3 §7.5 注）；216 原子案例按 p(6×6) 的原胞网格构造。

### W1.2

M1-α 的晶格核心、M3 层分析与键图、M2 Miller 规范化与常量、M1 金标配方。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-m1-lattice` | — | M1-T2 浮点晶格运算、网格标签与命名辅助（双语言，M1-α 核心） | `crystallume/core/lattice.py#M1`、`crystallume/web/js/core/lattice.js#M1`、`crystallume/core/naming.py#M1`、`crystallume/web/js/core/naming.js#M1`、`crystallume/core/defaults.py#M1`、`crystallume/web/js/core/defaults.js#M1`、`tests/data/surface/m1_niggli_ase329.json`、`scripts/dev/make_niggli_reference.py`、`tests/test_lattice_tools.py`、`tests/js/lattice_tools.test.mjs`、`tests/test_naming_m1.py`、`tests/js/naming_m1.test.mjs` |
| `w1-m3-layers` | — | M3-T1 层分析核心 find_layers（双语言）与 M3 的常量、M3-T3a 化学键图、吸附物识别与标记（双语言） | `crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`crystallume/analysis/neighbors.py`、`crystallume/web/js/core/bondgraph.js`、`crystallume/analysis/__init__.py#M3`、`crystallume/core/structure.py#M3`、`crystallume/web/js/core/structure.js#M3`、`crystallume/core/defaults.py#M3`、`crystallume/web/js/core/defaults.js#M3`、`tests/data/surface/layers/`、`tests/ops/m3_layers.py`、`tests/js/ops/m3_layers.mjs`、`tests/test_layers.py`、`tests/js/layers.test.mjs`、`tests/test_bond_graph.py`、`tests/js/bondgraph.test.mjs`、`tests/test_adsorbates.py`、`tests/js/adsorbates_m3.test.mjs` |
| `w1-m2-miller` | — | M2-T1 整数基、Miller 规范化与 M2 的常量（双语言） | `crystallume/core/intmath.py#M2`、`crystallume/web/js/core/intmath.js#M2`、`crystallume/core/defaults.py#M2`、`crystallume/web/js/core/defaults.js#M2`、`tests/test_plane_basis.py`、`tests/js/plane_basis.test.mjs`、`tests/test_surface_defaults_m2.py` |
| `w1-m1-recipes` | — | M1-T5a M1 金标的配方构造器与生成器骨架 | `tests/m1_recipes.py`、`tests/js/m1_recipes.mjs`、`tests/ops/m1.py`、`tests/js/ops/m1.mjs`、`tests/data/surface/make_m1_cases.py`、`tests/data/surface/m1_recipes_check.json` |

**合并顺序**：`w1-m1-lattice` → `w1-m3-layers` → `w1-m2-miller` → `w1-m1-recipes`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M1-T2：`tests/test_lattice_tools.py`、`tests/js/lattice_tools.test.mjs`、`tests/test_naming_m1.py`、`tests/js/naming_m1.test.mjs` 通过；`gauss_reduce_2d(angle=None)` 满足 |u|² ≤ (1+τ)|v|²、|u·v| ≤ (½+τ)|u|²（L-M1-02）；`format_decimal(2.125, 2) == "2.13"`、`-0.004 → "0.00"`（两语言，附录 A-2）
- M3-T1/T3a：`tests/test_layers.py`、`tests/test_bond_graph.py`、`tests/test_adsorbates.py` 与 JS 对应测试通过；`tests/data/surface/layers/` 中 findLayers、findAdsorbates、bondGraph 用例在两语言都运行通过（skip 已去掉）
- 验收 S14-3：CONTCAR 夹具上 `find_layers` 为 4 层 × 9、底层平均高度 ≈ 0，切口与显示同一个（U1-d），Python 与 JS 相同
- L-X-08：M1、M2、M3 的键两语言逐键相等；两语言都没有 `vacuum`、`layers`、`position`、`offset` 键；`slab_layers == 4`（U4-e）
- M1-T5a：`tests/data/surface/m1_recipes_check.json` 两语言通过（同名配方坐标逐位相同），xorshift32 前 1000 个数两语言相同

#### M1-T2 浮点晶格运算、网格标签与命名辅助（双语言，M1-α 核心）（链 `w1-m1-lattice`）

【目标】双语言浮点晶格运算与命名辅助（里程碑 M1-α 的核心），并一次加入 M1 的全部 `SURFACE_DEFAULTS` 键（plan.md P-07）。

【依据】M1 §3.5（§3.5.4 的改名函数按 L-M1-15 改名为 `rename_after_cell_change` 并去掉 `label` 参数；§3.5.5 归 M1-T3a）、§3.6.1–3.6.3、§3.6.5、§3.8.1–3.8.2、§3.10.1、§3.11.1–3.11.2、§3.14、§3.17；ledger-features L-M1-02（Gauss 冻结契约：`angle="obtuse"` 缺省、`angle=None` 分支按 §1.1 冻结，平局"半数向零"，τ = `gauss_tolerance` = 1e-9）、L-M1-03、L-M1-04、L-M1-05（`kind` 英式拼写；单位阵 `p(1×1)`；矩阵写法 `[2 1, -1 3]`）、L-M1-06（预设 id 表；六方网格上 `c4x2` = `(2×√3)rect`、`c2x2` 不适用；E-MS1 的两句文案）、L-M1-15（`round_half_up`、`format_decimal`、`format_sig3`、`format_angle`；`rename_after_cell_change(name, P, *, cell, previous=None)`，没有 `label` 参数）、L-X-08 的 M1 行（含 `reference_mesh_tolerance` = 0.3 Å、`conventional_*` 只由 M1 加）、R-F01、R-F03、R-F18、R-F20、R-F37、§10.1 第 1、8、10 条；负责人决定 L-19（名字里的网格标签只由矩阵算出；预设标签只进读数与 toast）；V-F10。

【实现】

- `core/lattice.py` 与 `web/js/core/lattice.js` 的段 `M1`：`gauss_reduce_2d`、`closest_in_plane`、`niggli_reduce_cell`、`check_cellpar`、`cellpar_to_cell(..., handed=1)`、`standard_frame(cell, convention="a-x")`、`oriented_cellpar_to_cell`、`d_spacing`、`strain_tensor`、`classify_mesh`、`mesh_type`、`wood_label`、`matrix_label`、`mesh_label`、`supercell_label(P, cell, *, reference=None, style="bulk")`、`WOOD_PRESETS`、`wood_presets(mesh, *, reference=None)`、`parse_mesh_spec(text)`（只看语法）、`surface_mesh_matrix(spec, a, b, *, n=1, m=1, N=None, reference=None)`、`conventional_lattice(cell)`、`miller_basis_note(cell, hkl)`。

- `core/naming.py` 与 `web/js/core/naming.js` 的段 `M1`：四个数字格式化函数与 `rename_after_cell_change`。进入名字、标签、文案的数字一律用它们，不得用 `toFixed`、f-string、`round()`。

- `core/defaults.py` 与 `web/js/core/defaults.js` 的段 `M1`：L-X-08 M1 行的全部键（值按 M1 §3.1 表）；非标量 Python 用元组/`MappingProxyType`，JS 逐层深冻结。

【U 与负责人决定】U4（M1 的 `SURFACE_DEFAULTS` 段不得有任何真空间隙值）；负责人决定 L-19（名字里的网格标签只由矩阵算出）。

【文件】`crystallume/core/lattice.py#M1`、`crystallume/web/js/core/lattice.js#M1`、`crystallume/core/naming.py#M1`、`crystallume/web/js/core/naming.js#M1`、`crystallume/core/defaults.py#M1`、`crystallume/web/js/core/defaults.js#M1`、`tests/data/surface/m1_niggli_ase329.json`、`scripts/dev/make_niggli_reference.py`、`tests/test_lattice_tools.py`、`tests/js/lattice_tools.test.mjs`、`tests/test_naming_m1.py`、`tests/js/naming_m1.test.mjs`。

【测试】M1 §7.1 的"Wood 标签"（20 例 + D8 的 12 例）、"网格与预设"（噪声 1e-5…1e-3 Å 下 √3 300/300；单轴 0.05…4 % 三者一致；√N 的解 N = 19、21、49）、"parse_mesh_spec"（§3.6.3 全部写法与失败文案，两语言同一张表）、"Gauss"（2000 个随机基；bcc(110)；60° → 120°；`angle=None`；平行输入报错）、"Niggli"（`m1_niggli_ase329.json` 的 210 个基到 1e-6；若该文件不存在，用 ASE 参考环境 `scratchpad/proto/m1/refvenv/bin/python` 生成并入库，脚本放 `scripts/dev/make_niggli_reference.py`）、"晶胞参数"中的校验 5 例、"惯用胞"（7 个度规用例、正交晶格 → None、`miller_basis_note` 的六方 R）、"常量"。命名：`format_sig3`（2、√3、2√3、3√3、1.5、1234.5 → "1235"）、`format_angle`（30、19.1、26.6、23.4、10.9）、附录 A-2 的 11 个数两语言相同；`rename_after_cell_change` 的 `Cu fcc` diag(2,2,2) → `Cu fcc 2×2×2`、`Ru hcp` `[[2,1,0],[-1,1,0],[0,0,2]]` → `Ru hcp (√3×√3)R30° ×2`、幺模总矩阵去掉标签。

【注意】`scripts/dev/` 下的开发脚本不进包、测试不依赖；本任务不碰 `core/cellops.*`。

#### M3-T1 层分析核心 find_layers（双语言）与 M3 的常量（链 `w1-m3-layers`）

【目标】双语言层分析核心 `find_layers`/`Layers`（含导出的 `cluster_heights` 与 `select_layers`），一次加入 M3 的全部 `SURFACE_DEFAULTS` 键（plan.md P-07），并启用 M3-T2a 的 findLayers 金标。

【依据】M3 §3.1–3.6（§3.6 化学计量单元分组 `group="units"`：L-M3-01 把 `group` 列在 `find_layers` 的签名里、提供方为 M3 T1，因此从 M3 §9 的 T5 移到这里）、§3.14（JS 缓存）、§3.16（层部分的报错文案）、§4；ledger-features L-M3-01（R-F07：`None`/`"auto"` 有表面时沿表面法向、否则沿 c 面法向且不报错；`"normal"` 没有表面时报错；`"a"/"b"/"c"` = 另两根矢量所张面的法向，与真空无关；`tolerance=None` → `info.surface.layerTolerance` → `SURFACE_DEFAULTS.layer_tolerance`；层号 0 = 最底层，`from_top` 0 = 顶层）、L-M3-02（`cluster_heights(heights, tolerance) -> ndarray` 纯函数，两语言）、L-M3-06（`select_layers` 的六种选择器，`middle` 的奇偶报错）、L-X-08 M3 行（全部键）、§10.3 第 2 条；ledger-F0 §6 M3 第 2、3 条与 V-F12 第 1、2 条（沿 slab 轴一律 `sn = surface_normal(s, require_gap=True)`、`unwrap_along_gap(f, sn["cut"])`，窗口 [cut.lo, cut.lo + 1)，与显示同一切口；没有间隙时报 `vacuum_gap_hint(s)`）；U1（不按 slab/非 slab 分支）、U2。

【实现】新文件 `crystallume/analysis/layers.py` 与 `web/js/core/layers.js`：`resolve_direction`、`period_along`、高度与切口、线性单链聚类、层统计与提示、`group="units"`（按 `info.surface.bulk.reducedFormula` 或参与原子的约化组成动态规划分组；少于 2 个成比例的组退回原子面并给提示）、`Layers` 与 `to_dict()`、JS `layersToJSON` 与 `findLayersCached`（按 M3 §3.14 的失效规则：SD 不失效，`adsorbate_id`/`tags`/`info.surface.layerTolerance`/换帧/撤销后的新对象失效）、`select_layers`；`analysis/__init__.py` 段 `M3` 导出；defaults 段 `M3`。注册 op `findLayers`（Python `tests/ops/m3_layers.py`，JS `tests/js/ops/m3_layers.mjs`），并去掉 `tests/data/surface/layers/` 中 findLayers 用例的 skip。

【U 与负责人决定】U1（不按 slab/非 slab 分支；切口与显示同一个）、U2；负责人决定：无直接相关项。

【文件】`crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`crystallume/analysis/__init__.py#M3`、`crystallume/core/defaults.py#M3`、`crystallume/web/js/core/defaults.js#M3`、`tests/ops/m3_layers.py`、`tests/js/ops/m3_layers.mjs`、`tests/data/surface/layers/`（只改 skip）、`tests/test_layers.py`、`tests/js/layers.test.mjs`。

【测试】M3 §7.2 Python/JS 的方向解析各分支与报错、左手晶胞、`'z'` 与 `'c'` 在标准 slab 上相同、`'normal'` 等于 `surface_normal`；周期判定（d111、无理方向、`P < 2·tol`）；真空切口与 `display_cuts` 相同；环上并列（体相切在晶胞边界）；`indices` 子集与越界；统计与提示文案；平均高度按原子序号累加；`group = "units"` 的 M3 §3.6 原型结果（TiO2(110) [O, Ti2O2, O] × 3；去顶层桥氧后 2 个整单元 + 顶部 1 个不完整单元；CeO2(111) [O, Ce, O] × 3；刚玉 [Al, O3, Al] × 6；金属每面一个单元；MoS2 单层不分组）；`select_layers` 六种选择器；acceptance S14-3。

#### M3-T3a 化学键图、吸附物识别与标记（双语言）（链 `w1-m3-layers`）

【目标】双语言化学键图与吸附物识别、标记，供 M2 终止面分析（W1.4）与 M4/M5 复用。

【依据】M3 §3.7、§3.8、§3.13；ledger-features L-M3-03（`bond_graph(structure, *, metal_pairs="all", indices=None)`、`coordination_numbers(s, metal_pairs=…)`、`periodic_components(graph, indices) -> list[(members, periodic)]` 导出）、L-M3-04（`find_adsorbates(structure, *, direction=None, tolerance=None, details=False)`、`promote_adsorbates`、`mark_adsorbates`、`unmark_adsorbates`、`tags_convention(s) -> "ase" | "oc20" | None`）、L-X-05（R-ADS；`promote_adsorbates` 是第 1 条的唯一实现）、R-F21（只有 M3 的标记入口，标记不写记录）、R-F25、§10.3 第 1、3、4 条；ledger-F0 L-F0-55（smart 规则与显示同一定义）、L-F0-14（`next_adsorbate_id`）；`METALS`/`ANIONS` 从 `crystallume/core/elements` 导入（M2-T2 已合入）。

【实现】`analysis/neighbors.py` 追加 `bond_graph`（CSR、按像计数、smart、`indices` 子图、与显示设置无关）、`coordination_numbers`、`periodic_components`；新文件 `web/js/core/bondgraph.js`（同名 camelCase，不改 `core/bonds.js`）；`analysis/layers.py`/`core/layers.js` 追加吸附物识别（来源 `adsorbate_id`/`tags`/`tags-oc20`/`geometry`）与标记函数；需要的 Structure 薄方法放 `core/structure.py` 与 `web/js/core/structure.js` 的段 `M3`。注册 ops `findAdsorbates`、`bondGraph`（同上两个 op 文件），去掉对应用例的 skip。

【U 与负责人决定】U1（吸附物识别只读，不改结构）；负责人决定：无直接相关项（R-ADS 由账本 L-X-05 规定）。

【文件】`crystallume/analysis/neighbors.py`、`crystallume/web/js/core/bondgraph.js`、`crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`crystallume/core/structure.py#M3`、`crystallume/web/js/core/structure.js#M3`、`tests/ops/m3_layers.py`、`tests/js/ops/m3_layers.mjs`、`tests/data/surface/layers/`（只改 skip）、`tests/test_bond_graph.py`、`tests/js/bondgraph.test.mjs`、`tests/test_adsorbates.py`、`tests/js/adsorbates_m3.test.mjs`。

【测试】M3 §7.2 的键图（判据边界 d 恰为阈值不成键、按像计数、smart、`indices` 子图、与显示设置无关）与吸附物（三种来源、OC20、tag 0 周期层、桥位 OH 回归、周期块丢弃、2-core、替位判别、自由分子、团簇不猜）各条；网页默认场景 `disabledPairs = ["Pt-Pt"]` 时 `cn` 与 Python 相同（M3 §7.1 末行）；`promote_adsorbates` 的编号顺序。

#### M2-T1 整数基、Miller 规范化与 M2 的常量（双语言）（链 `w1-m2-miller`）

【目标】双语言整数基 `plane_basis` 与 Miller 规范化，并加入 M2 的 `SURFACE_DEFAULTS` 键（按账本改名）。

【依据】M2 §3.0、§3.1（不含 §3.1.1）、§3.3；ledger-features L-M2-01、§0.4（`plane_basis`、`normalize_miller`、`miller_to_primitive` 追加在 `core/intmath.*`）、L-X-08 M2 行（**[改]** `slab_layers` = 4、`slab_position` = "center"、`slab_offset` = 0.0、`termination_match_tolerance` = 0.10、`termination_near_match_factor` = 2.5；删除 `supercell_max_entry`；`max_vacuum` = 1000.0 全仓库共用；`conventional_*` 不由 M2 加）、§10.2 第 10 条；U4（不设默认真空；默认 4 层、居中）。

【实现】`core/intmath.py` 与 `web/js/core/intmath.js` 的段 `M2`：`plane_basis(hkl)`（M2 §3.3：v1·hkl = v2·hkl = 0、v3·hkl = 1、det = handedness；JS 每步 `Number.isSafeInteger`）、`normalize_miller`（公因子约化与提示 N1；四指数校验与 F0-A 文案一致；上限 30，> 12 软提示；全 0 报错）、`miller_to_primitive`；defaults 段 `M2`：L-X-08 M2 行的全部键（值按 M2 §3.0 表）。

【U 与负责人决定】U4（没有 `vacuum` 键；默认 4 层、居中）；负责人决定：无直接相关项。

【文件】`crystallume/core/intmath.py#M2`、`crystallume/web/js/core/intmath.js#M2`、`crystallume/core/defaults.py#M2`、`crystallume/web/js/core/defaults.js#M2`、`tests/test_plane_basis.py`、`tests/js/plane_basis.test.mjs`、`tests/test_surface_defaults_m2.py`。

【测试】M2 §7.1"整数基"（(hkl) ∈ [−6, 6]³ 互质、handedness ±1）与"Miller 与惯用胞"中关于规范化的条（N1、四指数、上限、全 0）；`tests/test_surface_defaults_m2.py`：M2 键两语言逐键相等，两语言都没有 `vacuum`、`layers`、`position`、`offset`、`supercell_max_entry` 键（L-X-08 末条），`slab_layers == 4`。

#### M1-T5a M1 金标的配方构造器与生成器骨架（链 `w1-m1-recipes`）

【目标】M1 金标用的配方构造器（大结构不存坐标，两语言给出逐位相同的结构）与生成器骨架；M1-T5b（W1.5）用它生成期望。

【依据】M1 §7.2（配方示例 `{"recipe": "fcc111", "layers": 25, "supercell": [20, 20], "noise": {"sigma": 0.005, "seed": 11}, "delete": "top:25"}`；噪声用 xorshift32 的均匀分布 `σ·√3·(2u − 1)`，只用整数位运算与乘加，不用 Box–Muller）；ledger-F0 L-F0-27（配方输入 `{"recipe": …}`；Python `@recipe`、JS `recipe(name, fn)`；配方与 op 放在模块自己的 op 文件；两语言同名配方用一个用例核对）。

【实现】通用的体相配方 `bulk` 已由 M2-T7a（W1.1）注册，本任务复用、不重复注册。Python `tests/m1_recipes.py`（`fcc111`、`fcc100`、`fcc110`、`hcp0001`、`bcc110` 等按层坐标直接写出的 slab，`noise`、`delete`（`top:N`）、`supercell`、`vacuum`；只用 numpy 与仓库体相原型，不依赖 M2），在 `tests/ops/m1.py` 用 `@recipe` 注册；JS `tests/js/m1_recipes.mjs`，在 `tests/js/ops/m1.mjs` 用 `recipe(name, fn)` 注册；生成器骨架 `tests/data/surface/make_m1_cases.py`（命令行：按 M1 §7.2 的类别生成 `tests/data/surface/m1_cases.json`，期望部分留给 T5b）；核对用例 `tests/data/surface/m1_recipes_check.json`。

【U 与负责人决定】U2（配方生成的 slab 用 pbc T T T）；负责人决定：无直接相关项。

【文件】`tests/m1_recipes.py`、`tests/js/m1_recipes.mjs`、`tests/ops/m1.py`、`tests/js/ops/m1.mjs`、`tests/data/surface/make_m1_cases.py`、`tests/data/surface/m1_recipes_check.json`。

【测试】`m1_recipes_check.json` 两语言各跑一次（同名配方的坐标、晶胞、props 逐位相同）；xorshift32 前 1000 个数两语言相同。

【注意】配方名写进 `tests/data/surface/README.md` 以外的本模块说明里（文件头注释），不改 F0-D 的 README。

### W1.3

M1 超胞族与原胞并行；M2 惯用胞提示与命名核心（提前给 M1 用）；M3 约束封装与平价测试。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-m1-supercell` | — | M1-T3a 超胞族的结构操作（双语言） | `crystallume/core/cellops.py#M1-T3a`、`crystallume/web/js/core/cellops.js#M1-T3a`、`crystallume/core/structure.py#M1-T3a`、`crystallume/web/js/core/structure.js#M1-T3a`、`crystallume/build/__init__.py#M1`、`tests/test_cellops.py`、`tests/js/cellops.test.mjs` |
| `w1-m1-translations` | — | M1-T4 平移对称性与原胞（双语言） | `crystallume/analysis/translations.py`、`crystallume/web/js/core/translations.js`、`crystallume/analysis/__init__.py#M1`、`crystallume/core/structure.py#M1-T4`、`crystallume/web/js/core/structure.js#M1-T4`、`tests/test_translations.py`、`tests/js/translations.test.mjs` |
| `w1-m2-naming` | — | M2-T1b 惯用胞提示 conventional_cell_hint（双语言）、M2-T4n 命名核心（双语言纯函数，从 M2-T4/T6b 提前拆出） | `crystallume/core/lattice.py#M2`、`crystallume/web/js/core/lattice.js#M2`、`crystallume/core/naming.py#M2`、`crystallume/web/js/core/naming.js#M2`、`tests/test_lattice_hint.py`、`tests/js/lattice_hint.test.mjs`、`tests/test_naming_surface.py`、`tests/js/naming_surface.test.mjs` |
| `w1-m3-constraints` | — | M3-T4 约束封装 fix/free/fix_layers/fix_height 与 set_tags_from_layers（双语言）、M3-T2b M3 层分析的跨语言平价测试 | `crystallume/core/structure.py#M3`、`crystallume/web/js/core/structure.js#M3`、`crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`tests/test_fix_free.py`、`tests/js/fix-free.test.mjs`、`tests/test_m3_parity.py` |

**合并顺序**：`w1-m1-supercell` → `w1-m1-translations` → `w1-m2-naming` → `w1-m3-constraints`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M1-T3a：`tests/test_cellops.py`、`tests/js/cellops.test.mjs` 通过；`make_supercell(diag, wrap=False)` 与 `repeat` 在无 `info.surface`、无 `adsorbate_id` 的单帧结构上逐项相同（R-F24）；面内矩阵精确保持 `[T,T,F]`/`[F,F,T]`（C3）
- M1-T4：`tests/test_translations.py`、`tests/js/translations.test.mjs` 通过；1 万原子去顶层 2/5/25 原子的原胞搜索 < 0.5 s（Python）；`PrimitiveResult.matrix is None`（R-F02）
- M2-T4n：`tests/test_naming_surface.py`、`tests/js/naming_surface.test.mjs` 通过：L-X-07 表的全部例子两语言逐字相同（`Cu(100) (√2×√2)R45° 4L`，L-19）；只有 `autoName` 一个哨兵（L-12）
- M2-T1b：`tests/test_lattice_hint.py`、`tests/js/lattice_hint.test.mjs` 通过；fcc/bcc 上与 F0-A `centered_cell_hint`、M1 `conventional_lattice` 同一矩阵（R-F19）
- M3：`tests/test_fix_free.py`、`tests/js/fix-free.test.mjs`、`tests/test_m3_parity.py` 通过（层金标两语言逐项相同）

#### M1-T3a 超胞族的结构操作（双语言）（链 `w1-m1-supercell`）

【目标】超胞族的结构操作（双语言）：`make_supercell`（全仓库唯一的超胞实现）、`redefine_lattice`、`make_right_handed`、`reduce_cell`、`conventional_cell` 与包裹规则；Structure 薄方法；`build.make_supercell`、`build.niggli_reduce`。

【依据】M1 §3.3（含 §3.3.1 包裹 K3）、§3.4、§3.5.5（`update_supercell_matrix`）、§3.7、§3.11.3、§3.14 的 `conventional_cell`、§4、§3.17；ledger-features L-M1-08（P 为 3×3、三个重复数或 2×2 面内矩阵；原子顺序按像优先 q·N + a；E-SC1/2/3/5、E-FR；`label` 只填 `CellOpResult.label`；与 `repeat` 的关系 R-F24）、L-M1-09（惯用胞在有真空轴时的说明 `Conventional cell needs a cell without a vacuum gap (this one has one along c).`，V-F01）、L-M1-13、L-X-02、L-X-06、§10.1 第 4 条；ledger-F0 §6 M1 第 2、4、7 条（真空轴包裹用 `display_cuts(out)[k_vac]`、`shift_k = floor(f_k − cut.lo)`；写回经 `_adopt`/`writeFrame`）、L-F0-13（`apply_basis_change`）、L-F0-10（`mark_edited`：对角 `"repeat"`，其余 `"cell"`）；V-F10 第 2 条；C3、C7；U1。

【实现】`core/cellops.py` 与 `web/js/core/cellops.js` 的段 `M1-T3a`。每个结构操作开头 `before = begin_cell_op(s)`、结尾 `finish_cell_op(out, ctx, before)`（ctx 字段按 L-M1-14：`kind`、`old`、`new`、`matrix`、`src`、`images`、`id_offset`、`lattice_points`、`mark`）。这两个钩子现在是 M1-T1 的桩，M1-T10 在 W1.4 填实：**本任务不实现 info 处理器与自动名**（plan.md P-05）。`adsorbate_id` 按像重编号（v + q·V）。薄方法 `Structure.make_supercell`（新对象）、`redefine_lattice`、`make_right_handed`、`reduce_cell`、`get_conventional_cell` 放 `core/structure.py`、`web/js/core/structure.js` 的段 `M1-T3a`；`build/__init__.py` 段 `M1` 导出 `make_supercell`、`niggli_reduce`（ASE 同名）。

【U 与负责人决定】U1（不分类）、U2（超胞保持 pbc）；负责人决定 L-19（`label` 只进读数与 toast）。

【文件】`crystallume/core/cellops.py#M1-T3a`、`crystallume/web/js/core/cellops.js#M1-T3a`、`crystallume/core/structure.py#M1-T3a`、`crystallume/web/js/core/structure.js#M1-T3a`、`crystallume/build/__init__.py#M1`、`tests/test_cellops.py`、`tests/js/cellops.test.mjs`。

【测试】M1 §7.1 的"make_supercell""包裹（K3）""约化"与"惯用胞"中的结构操作：与 `repeat` 逐项相同（wrap 真/假）；Pt(111) p(3×3) 配方（M1-T5a）36 原子、18 固定、tags 平铺、无备注；√3：12 原子、a′ = √3·2.7719、γ = 120°；`[T,T,F]`/`[F,F,T]` 精确、`[T,F,F]` 收紧并写备注；`adsorbate_id` 重编号；det 0、过大、非整数、混入非周期轴、无晶胞、多帧的文案；手性（右手 + det −1 → E-SC2，含 `negate one row, or swap two rows`；左手 + det −1 得右手；左手 + det +3 得左手并附 N-LH）；底层 z = −0.01 的 T T T slab 经 √3、3×3×1、60°→120° 后 z 集合不变且连续；`changed_axes` 的 6 个矩阵；`reduce_cell` 的 60° → 120°、c 倾斜 `3a − 2b` 被移除、TTT p(8×8) auto 保持 c、CONTCAR 不变。名字与 `info.surface` 的断言留给 M1-T10 与 M1-T5b。

#### M1-T4 平移对称性与原胞（双语言）（链 `w1-m1-translations`）

【目标】平移对称性搜索与原胞（双语言）；Python 向量化与批量预筛为必须（E11-1）；JS 分块可取消。

【依据】M1 §3.12（3.12.1–3.12.4）、§3.17；ledger-features L-M1-12（`identity_classes`、`find_translations(structure, tolerance=None, axes=None, *, props=None)`、`TranslationGroup`、`primitive_cell(...)`；`PrimitiveResult` 带 `transform = {num, den}`（新 = T @ 旧）与整数 `supercell_matrix`（旧 = S @ 新），`matrix` 恒为 None，R-F02；`props=None` = `translation_identity_props`（不含 labels、adsorbate_id），`props=()` = 只看元素；`axes=None` = 真空轴以外的周期轴，`"all"` = 全部；容差范围 [1e-4 Å, 0.25 × 最小晶面间距)，否则 E-PC1）、L-M1-13（`Structure.get_primitive_cell`）、§10.1 第 2 条。

【实现】新文件 `crystallume/analysis/translations.py`（`analysis/__init__.py` 段 `M1` 导出）与 `web/js/core/translations.js`（平铺分箱表、`findTranslationsAsync(s, opts, { signal, onProgress })`）；`primitive_cell` 生成结构时调用 `cellops.begin_cell_op`/`finish_cell_op`（M1-T1 的桩，T10 填实）；`Structure.get_primitive_cell` 放 `core/structure.py`、`web/js/core/structure.js` 的段 `M1-T4`。**`reference_mesh` 不在本任务**：它要用 M2 的 `normalize_surface_info`，移到 M1-T10（plan.md P-05）。

【U 与负责人决定】U1（有真空间隙时原胞只在面内搜索，D20；不按 slab 分类）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/translations.py`、`crystallume/web/js/core/translations.js`、`crystallume/analysis/__init__.py#M1`、`crystallume/core/structure.py#M1-T4`、`crystallume/web/js/core/structure.js#M1-T4`、`tests/test_translations.py`、`tests/js/translations.test.mjs`。

【测试】M1 §7.1"原胞"一行的全部用例：无标签带噪声的 4 种 slab、P1 CIF、唯一 labels、磁矩聚类与边界值、AFM、8 种体相、TTT p(8×8)、双 slab、CONTCAR 2×2、R 心刚玉；1 万原子去顶层 2/5/25 个原子（在序列末尾）< 0.5 s；σ = 0.02 Å 在 0.05 Å 下报 N-PC1、在 0.1 Å 下约化；`average=True` 降低误差；`orbit_of` 与 `image_shift`；`transform` 与 `supercell_matrix` 互逆；JS `findTranslationsAsync` 与同步版本相同、`AbortSignal` 可取消。

#### M2-T1b 惯用胞提示 conventional_cell_hint（双语言）（链 `w1-m2-naming`）

【目标】惯用胞提示 `conventional_cell_hint(cell)`（双语言，纯度量）。

【依据】M2 §3.1.1；ledger-features L-M2-01、R-F19（立方/四方/六方一律委托 M1 `conventional_lattice`；本函数只额外识别 oF/oI/oC/mC 的标准原胞设置；F0-A 的 `centered_cell_hint` 不动，三者在 fcc/bcc 上给同一矩阵）。

【实现】`core/lattice.py` 与 `web/js/core/lattice.js` 的段 `M2`。

【U 与负责人决定】U1（惯用胞提示只是度量提示，不是分类）；负责人决定：无直接相关项。

【文件】`crystallume/core/lattice.py#M2`、`crystallume/web/js/core/lattice.js#M2`、`tests/test_lattice_hint.py`、`tests/js/lattice_hint.test.mjs`。

【测试】M2 §7.1"Miller 与惯用胞"中 `conventional_cell_hint` 的各条：fcc/bcc/体心四方/菱方/底心单斜原胞上的 kind 与 Q；6 种惯用胞返回 None；Pt、Fe 原胞上 (100)、(110)、(211) 两种基的换算（F0-A §3.14.4 的表）；MP 风格刚玉菱方原胞在 Conventional 基输入 (0 0 0 1) 的换算；与 F0-A、M1 在 fcc/bcc 上同一矩阵。

#### M2-T4n 命名核心（双语言纯函数，从 M2-T4/T6b 提前拆出）（链 `w1-m2-naming`）

【目标】把 M2 的命名函数提前到 W1.3 交付，因为 M1 的晶胞操作（M1-T10，W1.4）在编辑前后要调用 `auto_name_state`/`refresh_auto_name`，M2 的切面（W1.5）要调用 `surface_name`（ledger-features L-X-07 机制第 4 条；plan.md P-06）。

【依据】ledger-features L-X-07（机制与 `surface_name` 伪代码、`adsorbate_suffix` 规则、每个生成器的例子）、L-M2-07、L-X-01（字段表；`normalize_surface_info` 的 v1 → v2 兼容，只删 M5 v1 的 `baseName`；读取方容忍任何字段缺失、`kind` 缺失或未知按 `"adsorbates"`）、R-F15、R-F33（`surface_label(x)` 接受 Structure 或 `info.surface` 字典）、§0.3（化学式用 `display_formula` 的顺序，不用 `get_formula`）、§10.0 第 3、4 条、§10.2 第 1、2 条；负责人决定 L-12（只有 `info.surface.autoName`，没有 `baseName`）、L-19；M2 §3.13；C9。

【实现】`core/naming.py` 与 `web/js/core/naming.js` 的段 `M2`：`reduced_formula`、`surface_label`、`surface_name`（`kind == "interface"` 分支暂时返回 None，留注释"M6-T4n 接 `interface_name`"）、`adsorbate_suffix`、`normalize_surface_info`、`is_auto_named`、`auto_name_state`、`refresh_auto_name(structure, before, *, cell_change=None)`；网格段用 M1 的 `mesh_label`/`matrix_label`（`core/lattice`），数字用 L-M1-15 的格式化函数。

【U 与负责人决定】U1（`kind: "vacuum"` 只是来源记录）；负责人决定 L-12（只有 `autoName`）、L-19。

【文件】`crystallume/core/naming.py#M2`、`crystallume/web/js/core/naming.js#M2`、`tests/test_naming_surface.py`、`tests/js/naming_surface.test.mjs`。

【测试】用手写的 `info.surface` 字典（L-X-01 字段）覆盖 L-X-07 表的全部例子：`Pt(111) 4L`、`Pt(111) p(3×3) 4L`、`SrTiO3(001) TiO2-term 7L`、`SrTiO3(001) TiO2/SrO-term 8L`、`Cu(100) (√2×√2)R45° 4L`、`Ag(111) (1×√3)rect 4L`、`Ag(111) [2 1, -1 3] 4L`、`ZnO(10-10) ZnO-A-term 8L`、`TiO2(110) O·Ti2O2-term 9L`、`Pt(1 1 12) 4L`；`refresh_auto_name` 的四个分支（无块 → False；`before["auto"]` 为假 → 置 null；cleave → `surface_name`；其他 kind → 去掉旧后缀、`cell_change` 时 `rename_after_cell_change`、接新后缀，例 `CONTCAR + CO` 经 2×2×1 → `CONTCAR 2×2×1 + 4CO`）；`adsorbate_suffix` 的合并与计数（`2CO + O`）；v1 块读成 v2；两语言逐字相同。

#### M3-T4 约束封装 fix/free/fix_layers/fix_height 与 set_tags_from_layers（双语言）（链 `w1-m3-constraints`）

【目标】双语言约束封装：`fix`、`free`、`fix_layers`、`fix_height`、`fixed_indices`，以及新的 Python `set_tags_from_layers`。

【依据】M3 §3.12（3.12.1–3.12.3）、§5.7（toast 文案只作返回说明的参考）；ledger-features L-M3-07（`fix_layers(bottom=, middle=, all_but_top=, axes=, replace=True, group=)`；R-F09：`axes` 列出**被固定**的方向，`"abc"` 子集或可精确换算的 x/y/z；"中间 N 层"要求 L − N 为偶数，文案与 M2 `fix_middle` 相同）、L-M3-08、§10.3 第 5、6 条；ledger-F0 L-F0-13 与 §6 M3 第 1 条（`move_flags`、`set_move_flags`、`clear_constraints`、`constraint_summary`、`axis_labels`、`cartesian_name` 由 F0-D 提供，本任务不写进 `core/constraints`）；C3。

【实现】Structure 方法放 `core/structure.py`、`web/js/core/structure.js` 的段 `M3`；JS 的 `fixLayers`/`fixHeight` 纯函数放 `web/js/core/layers.js`；报告版（返回改动个数与说明）放 `analysis/layers.py`。

【U 与负责人决定】U5/D7（约束读写的旧缺陷已在第 0 波修好，本任务按 C3）；负责人决定：无直接相关项。

【文件】`crystallume/core/structure.py#M3`、`crystallume/web/js/core/structure.js#M3`、`crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`tests/test_fix_free.py`、`tests/js/fix-free.test.mjs`。

【测试】M3 §7.2"约束"一条全部（`fix`/`free` 语义、Free all 删键、部分 free 保留键、无变化返回 0、`fix_layers` 设定语义（目标层恰好固定 axes）与累加、`fix_height` 两种方式、全部固定的警告、中段元素检查、内层数组不共享）；`test_cleave_fix_equals_fix_layers` 的 M3 一半（在 M3 夹具上按构建层号固定与 `fix_layers(bottom=2)` 结果相同；M2 一半在 W1.6 补上）。文件名不用 `test_constraints.py`（归 F0-D）。

#### M3-T2b M3 层分析的跨语言平价测试（链 `w1-m3-constraints`）

【目标】M3 已交付部分的跨语言平价测试。

【依据】M3 §7.2"跨语言"一段；ledger-F0 L-F0-27；plan.md P-02（各模块自己的平价测试文件，不改共用的 `tests/test_js_parity.py`）。

【实现】`tests/test_m3_parity.py`：对 `tests/data/surface/layers/` 每个已启用的金标，Python 与 JS 的 `atomLayer`、`atomFromTop`、`excluded`、吸附物与来源、键图逐条相同；层高沿晶轴逐位相同，hkl/矢量方向 atol 1e-9；`Layers.to_dict()` 与 `layersToJSON()` 逐键（不取整）；M3 的 `SURFACE_DEFAULTS` 键两语言相同；10 个典型错误的报错文本相同；用一次 Node 进程批量执行（`js` fixture）。

【U 与负责人决定】U1（两语言的切口相同）；负责人决定：无直接相关项（层结果不含体相名，L-11 不涉及）。

【文件】`tests/test_m3_parity.py`。

【测试】即上；没有 Node 时跳过，`CRYSTALLUME_REQUIRE_NODE=1` 时失败。

### W1.4

M1 连续形变与 info 处理器/自动名接线；M2 切面分析两语言并行；M3 的 REST/CLI。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-m1-deform` | — | M1-T3b 连续形变与刚性操作（双语言） | `crystallume/core/cellops.py#M1-T3b`、`crystallume/web/js/core/cellops.js#M1-T3b`、`crystallume/core/structure.py#M1-T3b`、`crystallume/web/js/core/structure.js#M1-T3b`、`tests/test_cellops_deform.py`、`tests/js/cellops_deform.test.mjs` |
| `w1-m1-infohandlers` | — | M1-T10 info 处理器注册表、自动名接线与 reference_mesh | `crystallume/core/infohandlers.py`、`crystallume/web/js/core/infohandlers.js`、`crystallume/core/cellops.py#M1-T10`、`crystallume/web/js/core/cellops.js#M1-T10`、`tests/test_infohandlers.py`、`tests/js/infohandlers.test.mjs`、`tests/test_reference_mesh.py`、`tests/js/reference_mesh.test.mjs` |
| `w1-m2-analysis-py` | — | M2-T3 Python 切面分析（终止面、分层、极性） | `crystallume/build/surface.py#M2-T3`、`tests/test_surface_analysis.py`、`tests/ops/m2_analysis.py` |
| `w1-m2-analysis-js` | — | M2-T6a JS 切面分析（按规格独立实现，分块可取消） | `crystallume/web/js/build/surface.js#M2-T6a`、`tests/js/surface_analysis.test.mjs`、`tests/js/ops/m2_analysis.mjs` |
| `w1-m3-api` | — | M3-T11a M3 的 REST、客户端与 CLI（layers、edit fix/free） | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py` |

**合并顺序**：`w1-m1-infohandlers` → `w1-m1-deform` → `w1-m2-analysis-py` → `w1-m2-analysis-js` → `w1-m3-api`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M1-T10：`tests/test_infohandlers.py`、`tests/test_reference_mesh.py` 与 JS 对应测试通过；手写 kind cleave 块上 √3 超胞后名字为 `Pt(111) (√3×√3)R30° 4L`、再叠 p(3×3) 为 `(3√3×3√3)R30°`；`reference_mesh` 只在 kind cleave/interface 时信任 `info.supercellMatrix`（R-F17）
- M1-T3b：`tests/test_cellops_deform.py`、`tests/js/cellops_deform.test.mjs` 通过（Keep the vacuum gap：c 21.79 → 30 高度不变；双轴 +2 %）
- M2-T3/T6a：`tests/test_surface_analysis.py`、`tests/js/surface_analysis.test.mjs` 通过；`tests/data/surface/cleave/analysis/` 的期望在两语言各自的单元测试里成立
- 验收（分析部分，Python 与 JS）：S1-1、S8-1/S8-2、S9-1、S10-1/S10-2、S11-1–S11-3、S12-1
- M3-T11a：`/api/v1/analysis/layers` 在 `ROUTE_METHODS` 中并有客户端方法；`crystallume layers` 与 `crystallume edit fix/free` 的 `tests/test_cli.py` 用例通过；未知字段 → 422（`extra="forbid"`）

#### M1-T3b 连续形变与刚性操作（双语言）（链 `w1-m1-deform`）

【目标】双语言连续形变与刚性操作：`set_cell`、`set_lattice_parameters`（Keep the vacuum gap）、`deform`、`apply_strain`、`reorient`（所有帧）、`permute_cell_axes`、`shift_origin`、`wrap_into_cell`。

【依据】M1 §3.8.3–3.8.4、§3.9、§3.10.2–3.10.3、§3.13、§3.17；ledger-features L-M1-10（`keep_vacuum="auto" | True | False`；E-ST5 文案用 `vacuum_gap_hint`（经 `require_gap`）；沿真空轴展开 `unwrap_along_gap(f_k, surface_normal(s, require_gap=True)["cut"])`，窗口 [cut.lo, cut.lo + 1)；改变真空轴矢量且保持笛卡尔坐标前 `make_contiguous(s, k)`；写晶胞经 `write_frame`/`_adopt`，之后 `mark_edited(s, "cell")`，纯转动时 `"rotate"`）、L-M1-11（`permute_cell_axes(structure, k)`：所有帧的晶胞行、pbc、`selective_dynamics`、`info.supercellMatrix` 的行与列一起轮换，`info.surface.axis ← 2`，笛卡尔坐标不动，不调用 `mark_edited`；`reorient` 先轮换再 `standard_frame`；`wrap_into_cell(keep_slab=True)` 沿真空轴用 `display_cuts`）、L-M1-13、R-F12（`deform` 没有其他模块消费）、§10.1 第 10 条；ledger-F0 §6 M1 第 2、7、8 条；V-F10 第 3、4 条。

【实现】`core/cellops.py` 与 `web/js/core/cellops.js` 的段 `M1-T3b`；结构操作首尾调用 `begin_cell_op`/`finish_cell_op`（与 T3a 同一约定；M1-T10 在同一批次填实钩子）；`shift_origin` 内联平移（M4 的 `translate(..., frac=)` 要到 W2 才有）；薄方法放 `core/structure.py`、`web/js/core/structure.js` 的段 `M1-T3b`（`set_cell(cell, scale_atoms=False)` 与 ASE 同名同义）。

【U 与负责人决定】U1（Keep the vacuum gap 对任何有真空间隙的结构都可用）、U4（`keep_vacuum` 不是真空值）；负责人决定：无直接相关项。

【文件】`crystallume/core/cellops.py#M1-T3b`、`crystallume/web/js/core/cellops.js#M1-T3b`、`crystallume/core/structure.py#M1-T3b`、`crystallume/web/js/core/structure.js#M1-T3b`、`tests/test_cellops_deform.py`、`tests/js/cellops_deform.test.mjs`。

【测试】M1 §7.1 的"晶胞参数"（旋转过的 hcp；保持笛卡尔；左手保持；Keep the vacuum gap：c 21.79 → 30 高度不变、a 2.7719 → 2.80 面内分数与高度不变；VASP 包裹的 CONTCAR 保持笛卡尔改 c → 间隙 23.20 Å；联动规则 90° 不联动）、"set_cell"（手性翻转 + scale_atoms 报 E-SC7；纯旋转 → `"rotate"`；非整数关系删除 `supercellMatrix`）、"应变"（双轴 +2 %；各向同性 −1 %；单轴 c +3 %；张量体积比 = det F；εxy 语义；Keep：间隙 15.0000 不变、厚度 6.7896 → 6.9254；`keep_vacuum="auto"` 体相为假、slab 为真；`{"hkl": [1,1,1]}`；tensor 给 percent 报错）、"重定向"、"平移原点与包裹"各行。名字与 info 处理器的断言留给 M1-T5b（W1.5）。

#### M1-T10 info 处理器注册表、自动名接线与 reference_mesh（链 `w1-m1-infohandlers`）

【目标】info 处理器注册表与 M1 的 `surface` 几何处理器（新文件 `core/infohandlers.*`）；把 `apply_info_handlers` 与自动名接进 cellops 的两个钩子；实现 `reference_mesh`（从 M1-T4 移来，plan.md P-05）。

【依据】M1 §3.15、§3.4、§3.5.4、§3.6.4；ledger-features L-M1-14（注册表、`ctx` 字段含新增的 `lattice_points` 与 `id_map`；内置处理器只有 M1 的 `surface` 几何处理器与 M5 的 `surface.adsorbates`；静态注册；重复注册 → `register_info_handler: 'surface' is already registered`）、L-M1-07（`reference_mesh(structure, *, exclude=None, tolerance=None, max_atoms=None, frame=None)` 的四个来源 record/interface/translations/current，最后 `gauss_reduce_2d(angle="obtuse")`；来源 3 从不写进 `info.supercellMatrix`；JS 按（结构、`rev`）缓存，给了 `exclude` 时不缓存）、L-X-07 机制第 1、2、4 条（命名在 `apply_info_handlers` **之后**；返回 False 时 `rename_after_cell_change`）、R-F17、§10.1 第 3、6、7 条；负责人决定 L-12、L-19。依赖：M2-T4n（`auto_name_state`、`refresh_auto_name`、`normalize_surface_info`，W1.3 已合入）、M1-T4（`primitive_cell`，W1.3）。

【实现】新文件 `crystallume/core/infohandlers.py`、`web/js/core/infohandlers.js`：注册表、`update_surface_geometry`、`surface` 处理器；文件内建段 `M1` 与 `M5`（M5-T6 在 W3.2 注册 `surface.adsorbates`）。`cellops.*` 段 `M1-T10`：把 `begin_cell_op` 改为返回 `auto_name_state(s)`；`finish_cell_op` 改为 `mark_edited` → `apply_info_handlers(ctx)` → `refresh_auto_name(s, before, cell_change=…)`，返回 False 时 `s.name = rename_after_cell_change(...)`；重新导出三个注册表函数；`reference_mesh`/`referenceMesh`。

【U 与负责人决定】U1；负责人决定 L-12（只有 `autoName`）、L-19（预设标签不进名字）。

【文件】`crystallume/core/infohandlers.py`、`crystallume/web/js/core/infohandlers.js`、`crystallume/core/cellops.py#M1-T10`、`crystallume/web/js/core/cellops.js#M1-T10`、`tests/test_infohandlers.py`、`tests/js/infohandlers.test.mjs`、`tests/test_reference_mesh.py`、`tests/js/reference_mesh.test.mjs`。

【测试】M1 §7.1"info 处理器"（假处理器的调用顺序与 ctx 字段；`surface` 处理器的 `normal`/`axis` 在重定向、轮换、超胞、基变换下；没注册时不改未知字段）、"派生信息"（T3a/T4 操作的 `mark_edited` kind）、"reference_mesh"（`supercellMatrix` 来源只在 kind cleave/interface 时信任；无记录的 p(2×2) → K = 2I；p(3×3) + CO（adsorbate_id）→ K = 3I；> 5000 原子 → current）。命名：手写 kind cleave 块上 √3 → `Pt(111) (√3×√3)R30° 4L`、再 p(3×3) 累计 → `Pt(111) (3√3×3√3)R30° 4L`、p(3×3) 后求原胞 → `Pt(111) 4L`；`Cu fcc` diag(2,2,2) → `Cu fcc 2×2×2`；改过名的 `my slab` diag(2,2,1) → `my slab 2×2×1`。T3b 的操作在合入后由 M1-T5b 覆盖。

#### M2-T3 Python 切面分析（终止面、分层、极性）（链 `w1-m2-analysis-py`）

【目标】Python 切面分析：`surface_analysis`、`terminations`、`SurfaceAnalysis.to_dict()`、`suggested_layers`，含分层合并与 τ_eff。

【依据】M2 §3.1–3.9（输入校验、原胞步骤 K1、整数基、面内约化 120°/钝角约定与 c₀ K4、取向单胞 OUC、原子层与起伏层合并 K5、切口/指纹/不等价终止面 K6–K8、断键数、电荷/化学计量/极性 K14）、§3.10 的 `suggested_layers`、§3.18–3.20、§7.5；ledger-features L-M2-01、L-M2-02（分析部分签名）；ledger-F0 §6 M2 第 2、8 条（没有表面时 `require_gap`；`canonical_order`）；依赖 M1 `primitive_cell`、`find_translations`、`gauss_reduce_2d`（缺省 `"obtuse"`）、`closest_in_plane`，M3 `find_layers`、`bond_graph`、`coordination_numbers`、`cluster_heights`，M2-T1/T1b/T2；U1。

【实现】`build/surface.py` 的段 `M2-T3`（numpy 向量化，满足 M2 §7.5 的预算：OUC ≤ 20 原子 ≤ 30 ms、135 原子 ≤ 150 ms）；注册 Python op `terminations`（及 `surfaceAnalysis`）于新文件 `tests/ops/m2_analysis.py`；金标的 skip 由 M2-T7c（W1.5）在 JS 版也合入后去掉。

【U 与负责人决定】U1（终止面分析不判断是不是 slab）；负责人决定：无直接相关项。

【文件】`crystallume/build/surface.py#M2-T3`、`tests/test_surface_analysis.py`、`tests/ops/m2_analysis.py`。

【测试】M2 §7.1 的"原胞步骤"、"OUC 不变量"（随机 (hkl) ∈ [−3, 3]³ × {Pt, SrTiO3, TiO2, ZnO, CeO2, GaAs} 共 1740 例：面积 × 周期 = 原胞体积、法向在 +hkl 侧、γ ∈ [90°, 120°]、0 个 E7、τ_eff 下单链重新分层 = 2m 层）、"分层与合并"、"原子层与终止面"、"带噪声的体相"、"惯用胞 ≡ 原胞"、"手性"各行；在 `tests/test_surface_analysis.py` 里直接读 `tests/data/surface/cleave/analysis/` 的用例文件调用 Python 实现（不依赖 skip 状态），覆盖 acceptance S1-1、S8-1、S8-2、S9-1、S10-1、S10-2、S11-1–S11-3、S12-1 的分析部分。

#### M2-T6a JS 切面分析（按规格独立实现，分块可取消）（链 `w1-m2-analysis-js`）

【目标】JS 版切面分析，按 M2 规格（不是照抄 Python 代码）独立实现，两边都对照同一组金标，以便尽早发现规格歧义。

【依据】与 M2-T3 相同的规格节：M2 §3.1–3.10、§3.18–3.20、§5.4 末段（OUC > 500 原子时按切口分块执行，每块 ≤ 16 ms，参数再变时丢弃未完成的结果）、§7.5（OUC 2000 原子 ≤ 2 s）；ledger-features L-M2-01、L-M2-02；M1/M3 的 JS 版本（`core/translations.js`、`core/lattice.js`、`core/layers.js`、`core/bondgraph.js`）；M2-T2 的 `estimateOxidationStates`（表未加载时抛错）。

【实现】`web/js/build/surface.js` 的段 `M2-T6a`：`surfaceAnalysis`、`terminations`（返回与 Python `to_dict()` 同键 camelCase 的对象）、`suggestedLayers`；异步分块版本带 `AbortSignal`。注册 JS op `terminations` 于新文件 `tests/js/ops/m2_analysis.mjs`。

【U 与负责人决定】U1；负责人决定：无直接相关项（两语言分歧按简报原则裁决，U6）。

【文件】`crystallume/web/js/build/surface.js#M2-T6a`、`tests/js/surface_analysis.test.mjs`、`tests/js/ops/m2_analysis.mjs`。

【测试】在 `tests/js/surface_analysis.test.mjs` 里读 `tests/data/surface/cleave/analysis/` 的用例文件并对 JS 实现逐项断言；M2 §7.1 中可以在 JS 侧复现的各组（OUC 不变量抽样 200 例、分层与合并、终止面标签与断键数、带噪声体相的固定种子）；分块版本与同步版本结果相同、可取消。

【注意】两语言的 JSON 逐项相同由 M2-T7c（W1.5）的平价测试检查；本任务发现规格歧义时按简报原则决定并写进报告，同批的 M2-T3 也会看到同一份报告。

#### M3-T11a M3 的 REST、客户端与 CLI（layers、edit fix/free）（链 `w1-m3-api`）

【目标】M3 的 Python 外部接口：REST `POST /api/v1/analysis/layers`、客户端 `layers`、CLI `crystallume layers` 与 `crystallume edit fix/free`，并建立 `crystallume edit` 子命令组与全仓库唯一的 `--atoms SPEC` 解析函数。

【依据】M3 §6.3–6.5、§7.3；ledger-features L-M3-10（**[改]** `--frame` → `--index N`，`--to` → `--format`，写结构的命令加 `--from`；`LayersRequest` `extra="forbid"`）、§0.3 的 CLI 与 REST 规则（警告 `crystallume: warning: …`、提示 `crystallume: note: …` 到 stderr；`ValueError` 退出码 1、参数错误 2；不用 `nargs="+"`）、R-F13、R-F14、§10.3 第 7 条；负责人决定 L-10（`--atoms` 的解析函数在 `cli.py` 里只有一个，M4 的 `edit delete` 复用）；04 报告 §2。

【实现】`server/models.py`（`LayersRequest`）、`server/routes/analysis.py`（路由；`skipAdsorbates` 或 `surface` 为真时 `_guard_work(s, 5.0, settings)`；原子数上限 400）、`client.py`（`layers(...)` 与文档字符串）、`cli.py`（只读命令 `layers`：表格到 stdout、`--json`、提示到 stderr；`edit` 组与 `fix`/`free`；`parse_atom_spec`）；`tests/test_client.py` 的 `ROUTE_METHODS` 加一条。

【U 与负责人决定】U4 不涉及；负责人决定 L-10（`--atoms SPEC` 只有一个解析函数，M4 的 `edit delete` 复用）。

【文件】API 文件束（plan.md §2.4，本批次只归本链）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`。

【测试】M3 §7.3 全部：`/analysis/layers` 200（auto、`{"hkl"}`、`skipAdsorbates`、`group: units`、`surface`（暴露原子要到 W2.1 的 M3-T3b 才有：本任务先让 `surface: true` 与 CLI `layers --surface` 返回 400/退出码 1，文案 `surface atoms are not available yet`，并在报告中列出；M3-T3b 在 W2.1 把它们改成正式行为并补测试）、400（无晶胞用 `'c'`、体相用 `'normal'`、体相 + `surface`）、422（容差 0 或 −1、方向矢量长度 2、未知字段）、云模式未登录被拒、响应回显参数；原子数上限；`ROUTE_METHODS` 与一次真实调用；CLI：`layers` 表格、`--json`、提示到 stderr；`edit fix --bottom 2 -o POSCAR` 读回 SD；`--layers 1`；`--depth 3.5`；`edit free --all`；省略 `-o` 写 stdout；`--vector` 与 `--direction` 互斥（退出码 2）；多帧读最后一帧。

### W1.5

M2 slab 组装两语言、改真空工具；M1 网页第一部分（Lattice parameters 与共享超胞编辑器）、REST/CLI 与金标。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-m1-cellui` | 8821 | M1-T7a 网页：Cell 插槽状态模型、Lattice parameters 与共享超胞编辑器 | `crystallume/web/js/ui/cellsections.js`、`crystallume/web/js/ui/cellsupercell.js`、`crystallume/web/js/commands/cell.js`、`crystallume/web/js/main.js#M1-sections`、`crystallume/web/css/app.css#M1`、`tests/js/cellui.test.mjs` |
| `w1-m1-api` | — | M1-T6 M1 的 REST、客户端与 CLI（supercell、transform） | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py` |
| `w1-m1-golden` | — | M1-T5b M1 金标生成与跨语言平价 | `tests/data/surface/make_m1_cases.py`、`tests/data/surface/m1_cases.json`、`tests/ops/m1.py`、`tests/js/ops/m1.mjs`、`tests/test_m1_parity.py` |
| `w1-m2-assembly-py` | — | M2-T4 Python slab 组装、固定、来源信息与命名 | `crystallume/build/surface.py#M2-T4`、`crystallume/build/__init__.py#M2`、`crystallume/core/naming.py#M2`、`tests/test_surface.py`、`tests/ops/m2_slab.py` |
| `w1-m2-assembly-js` | — | M2-T6b JS slab 组装、命名与晶面多边形 | `crystallume/web/js/build/surface.js#M2-T6b`、`crystallume/web/js/core/naming.js#M2`、`tests/js/surface.test.mjs`、`tests/js/ops/m2_slab.mjs` |
| `w1-m2-vacuum-tools` | — | M2-T5 已有结构的工具：set_vacuum、add_vacuum、center_slab、flip_slab、standardize_slab（双语言）、M2-T7c 启用切面分析金标与 terminations 的跨语言平价 | `crystallume/core/structure.py#M2`、`crystallume/web/js/core/structure.js#M2`、`crystallume/build/surface.py#M2-T5`、`crystallume/web/js/build/surface.js#M2-T5`、`tests/test_vacuum_tools.py`、`tests/js/vacuum_tools.test.mjs`、`tests/ops/m2_tools.py`、`tests/js/ops/m2_tools.mjs`、`tests/data/surface/cleave/tools/`、`tests/data/surface/cleave/analysis/`、`tests/test_m2_parity.py` |

**合并顺序**：`w1-m2-assembly-py` → `w1-m2-assembly-js` → `w1-m2-vacuum-tools` → `w1-m1-golden` → `w1-m1-api` → `w1-m1-cellui`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M2-T4/T6b：`tests/test_surface.py`、`tests/js/surface.test.mjs` 通过；`build.surface(pt, (1,1,1), layers=4)` 不给 `vacuum` → `TypeError`，`vacuum=None` → E12a（U4-c）
- 验收（Python 与 JS 的单元测试）：C-2、C-5、C-6、C-7、C-8；S1-1–S1-4（含 CLI 前的 Python 部分）、S9-2–S9-4、S11-4、S11-6、S12-2、S12-4、S12-5、S2-2/S2-3（`Cu(100) (√2×√2)R45° 4L`）、S3-1/S3-2
- M2-T5/T7c：`tests/test_vacuum_tools.py`、`tests/js/vacuum_tools.test.mjs` 通过；S13-1（石墨烯改真空 c = 20、pbc 仍 T T F、新建 `kind: "vacuum"` 块）、S14-1–S14-3；已有结构 `set_vacuum(0)` → E12d（L-13）；`tests/test_m2_parity.py`（terminations JSON 两语言逐项相同，含随机 hkl）通过，analysis 与 tools 金标已启用
- M1-T5b：`tests/data/surface/m1_cases.json` 两语言通过；`tests/test_m1_parity.py` 通过
- M1-T6：`/build/supercell`（扩展）、`/build/transform` 在 `ROUTE_METHODS` 中；`crystallume transform` 的 `tests/test_cli.py` 用例通过
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`；Structure 面板 Cell 插槽出现 Lattice parameters 与 Supercell 两个分区（默认折叠），超胞预览与 Create 可用、Undo 只撤销自己

#### M1-T7a 网页：Cell 插槽状态模型、Lattice parameters 与共享超胞编辑器（链 `w1-m1-cellui`）

【目标】Structure 面板 Cell 插槽的状态模型、Lattice parameters 分区、Supercell 分区与共享超胞编辑器 `supercellEditor`（供 M2 Slab 分区内嵌，负责人决定 L-16），以及这两个分区用到的命令与执行函数。

【依据】M1 §5.0、§5.1、§5.2、§5.3、§5.7（本任务的 5 个命令）、§5.9–5.10、§3.16；ledger-features L-M1-16（共享编辑器 `supercellEditor(el, app, { owner, surface = false })`，在 `el` 里渲染、随宿主分区重绘；两种挂载执行同一个 `cell.supercell`，`surface: true` 时 2×2 矩阵按真空轴嵌入；预设相对 `reference_mesh`；toast `Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms`，预设标签与计算标签相同时只写一次，L-19）、L-M1-08（命令参数 `matrix | repeat | preset | spec` 恰好一个，`N`/`n`/`m`、`relativeTo`、`wrap`；网页的对角重复走 `make_supercell(diag, wrap=False)`，R-F24）、§10.1 第 5、6 条；ledger-F0 L-F0-30/31/35（`editActive`、`replaceActiveStructure`、P-swap 会话 `sameAtoms`/`src`/`latticeChanged`/`imageShift`）、L-F0-38（`cellOutlineLayer`）、L-F0-47/48（`imatrixInput` 的 `presets(ctx)`、`area`、`warn`、`positive: false`；`numberInput`、`vec3Input`）、L-F0-49（`registerPanelSection`、单独重绘、`openSection`）、L-F0-52（命令包装函数里的参数校验、`estimate`、`LIMITS`）、L-F0-54；plan.md P-09（Cell 插槽按 M1 §5.1 注册分区 `cell.parameters`、`cell.supercell`，其余三个由 T7b 加）；U1（badge 不放 slab/bulk 分类）、U5、P3、P4。

【实现】新文件 `web/js/ui/cellsections.js`（状态模型 drafts/签名/读数就地更新/重绘后重新接线；注册 `cell.parameters`、`cell.supercell` 两个分区，slot `cell`）、`web/js/ui/cellsupercell.js`（`supercellEditor`：Repeat/Matrix、预设菜单（参考网格 ≠ 当前网格时菜单头部 `Presets relative to: 1×1 cell / this cell`、√N…、Rectangular…）、Wood 文本行、读数、虚线新晶胞、Preview（P-swap）、`Create supercell`/`Redefine lattice`、确认与上限、撤销标签与 toast；导出执行函数 `runSupercell(app, params)`）、`web/js/commands/cell.js`（新：`cell.parameters`、`cell.setVectors`（hidden）、`cell.supercell`、`cell.redefine`、`cell.bakeRepeat`，参数 schema 按 M1 §5.7，执行函数与分区共用；其余 8 个命令由 M1-T7b 加在同一文件）、`main.js` 段 `M1-sections`（import `cellsections.js` 与 `commands/cell.js`）、`css/app.css` 段 `M1`。

【U 与负责人决定】U1（badge 不放分类）、U5（Structure 面板 Cell 分区，D1）；负责人决定 L-16（共享编辑器供 Slab 分区内嵌）、L-19（toast 写法）。

【文件】`crystallume/web/js/ui/cellsections.js`、`crystallume/web/js/ui/cellsupercell.js`、`crystallume/web/js/commands/cell.js`、`crystallume/web/js/main.js#M1-sections`、`crystallume/web/css/app.css#M1`、`tests/js/cellui.test.mjs`。

【测试】`tests/js/cellui.test.mjs`（纯逻辑：预设菜单项与 `applicable`/`why`、读数文案、`runSupercell` 的参数解析、toast 与撤销标签；不依赖 DOM）；状态模型的 M1 §5.0 第 6 条用 Playwright 在界面检查里做，并把脚本留在报告里供 W1.7 的 e2e 链复用。

【界面检查】（Chromium，本链端口）Build 面板建 Pt fcc（a = 3.92）与一个 4 层 Pt(111) 夹具（`tests/m1_recipes.py` 的 `fcc111` 导出成 JSON 后用 `crystallume.load`）。Structure 面板 Cell 插槽有 Lattice parameters、Supercell 两个分区，默认折叠；Supercell → Matrix → 预设 `(√3×√3)R30°`：虚线晶胞出现，读数 `New cell: (√3×√3)R30° … · 4 → 12 atoms`；Preview 出现预览条 `Preview: …`、状态栏 `Preview · 12 atoms`、历史长度不变；`Create supercell` → 12 原子、toast `Made a (√3×√3)R30° supercell: 12 atoms` 的 Undo 恢复 4 原子；Lattice parameters 改 c（Keep the vacuum gap 开）slab 高度不变；γ = 190 → 内联错误、Apply 不可用；在矩阵里输入 → 选一个原子 → 切换显示样式 → 输入与预览仍在。截图存 `scratchpad/shots/w1-m1-cellui/`。

#### M1-T6 M1 的 REST、客户端与 CLI（supercell、transform）（链 `w1-m1-api`）

【目标】M1 的外部接口：扩展 `POST /api/v1/build/supercell`、新增 `POST /api/v1/build/transform`、客户端 `supercell/transform/transform_detailed`、CLI `crystallume transform`。

【依据】M1 §6.3–6.5；ledger-features L-M1-17（**[改]** 单帧 `repeat` 走 `make_supercell(diag, wrap=False)`，多帧照旧 `repeat`；`/build/transform` 的操作名 `supercell`、`redefine`、`right-handed`、`lattice-parameters`、`set-cell`、`strain`、`strain-tensor`、`reduce`、`primitive`、`conventional`、`reorient`、`shift-origin`、`wrap`；新模型 `extra="forbid"`；CLI `crystallume transform INPUT [--from FMT] [--index N] [-o OUT] [--format FMT] [--plugins DIR] OPS...`，修饰选项作用于紧邻的前一个操作；表面超胞 `--surface-cell SPEC [--relative-to current]`）、L-M1-08（`repeat`、`matrix`、`preset`、`spec` 恰好一个）、§0.3 REST/CLI 规则、R-F13、R-F14、R-F24、§10.1 第 11 条；服务器原胞上限 `primitive_atoms_server`（M1 键）。

【实现】`server/models.py`（按模式拆分的应变模型、响应模型）、`server/routes/build.py`、`client.py`、`cli.py`；`tests/test_client.py` 的 `ROUTE_METHODS`；`tests/test_hardening.py` 的估算 = 实际。

【U 与负责人决定】U4（`keep_vacuum` 不是间隙值）；负责人决定 L-19（名字只由矩阵算出）。

【文件】API 文件束（plan.md §2.4）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`。

【测试】`tests/test_server.py`（每个操作至少一次 200；恰好一个参数的校验 422/400；多帧 `repeat` 与单帧路径；原胞上限）、`tests/test_client.py`、`tests/test_cli.py`（`transform` 的操作串与修饰选项、`--surface-cell 3x3`、`--index`、警告到 stderr、退出码）、`tests/test_hardening.py`（估算 = 实际原子数）。

#### M1-T5b M1 金标生成与跨语言平价（链 `w1-m1-golden`）

【目标】用实现后的 Python 生成 M1 的跨语言金标，与 v2 原型交叉核对，并补上 T3b 等操作的命名与 info 断言。

【依据】M1 §7.2（类别：`points`、`gauss`（≥ 500 个非退化基 × 三种 `angle`，生成器先剔除 |a × b| ≤ 1e-8·|a||b|）、`niggli`（≥ 180）、`wood`（≥ 100）、`presets`（≥ 75，含变形网格）、`parse_mesh_spec`、`reference_mesh`、`supercell`（6 种结构 × 矩阵，含 `src`、`shift`）、`reduce_cell`、`lattice_parameters`（含 Keep the vacuum gap）、`strain`、`reorient`、`rename_after_cell_change` 与 `supercell_label`、`identity_classes`、`check_cellpar`、`vacuum_axis`、`conventional_lattice`、`translations`（含 `orbit_of`、`transform`））；比较规则：整数矩阵、标签、`src`、群与生成元逐项相等，坐标与晶胞 1e-9 Å（面上原子允许差一个新晶格矢量，比较前包裹）；ledger-F0 L-F0-27；plan.md P-02、P-03。

【实现】完成 `tests/data/surface/make_m1_cases.py`（开发期运行，产物入库）→ `tests/data/surface/m1_cases.json`（`crystallume.cases/1`）；在 `tests/ops/m1.py`、`tests/js/ops/m1.mjs` 注册对应 op（配方已由 M1-T5a 注册）；`tests/test_m1_parity.py`：一次 Node 调用批量执行并按上面的规则比较；期望由 Python 实现生成后与 `scratchpad/proto/m1v2/` 的原型交叉核对（核对结论写进报告）。补充 T3b 操作（`set_lattice_parameters`、`apply_strain`、`reorient`、`shift_origin`、`wrap_into_cell`）在 kind cleave 块与无块结构上的名字与 `info.surface.normal`/`axis`。

【U 与负责人决定】U2；负责人决定 L-12、L-19（命名类别的期望）。

【文件】`tests/data/surface/make_m1_cases.py`、`tests/data/surface/m1_cases.json`、`tests/ops/m1.py`、`tests/js/ops/m1.mjs`、`tests/test_m1_parity.py`。

【测试】即上：`tests/test_cases.py`、`tests/js/cases.test.mjs` 运行 `m1_cases.json` 全部通过；`tests/test_m1_parity.py` 通过。

#### M2-T4 Python slab 组装、固定、来源信息与命名（链 `w1-m2-assembly-py`）

【目标】Python slab 组装：`surface`、`estimate_surface_atoms`、`oriented_cell`、V = 0、跨边界接触检查、原子顺序、固定、`info.surface`（含 `asBuilt`、v1 迁移）与名字。

【依据】M2 §3.10–3.13、§3.16、§3.20、§4；ledger-features L-M2-02（**[改]** `supercell=` 接受 2×2 矩阵、对角简写或文本（M1 `surface_mesh_matrix`），删除 `wood` 参数与 M2 自己的预设表、50/2500 限额，R-F03、R-F04、R-F38；`fix_middle` 要求 L − N 为偶数，`fix_axes` 为字符串按 R-F09 的语法）、L-X-01（`info.surface` 字段表：`version: 2`、`kind: "cleave"`、`autoName`、`miller`、`layers`、`thickness`、`vacuum`、`stacking`、`termination.count`、`tasker`（顶层键，R-F35）、`period`、`layersPerPeriod`、`layerTolerance`、`normal`、`axis`、`asBuilt`…；浮点 `round_half_up(x, 6)`；保留不认识的键）、L-X-02（`info.supercellMatrix`）、L-X-07（`name = autoName = surface_name(s)`；给了 `name=` 时 `autoName = null`）、§1.5 R-F05（`vacuum` 仅限关键字、必填、总间隙；0 = 体相堆垛；上限 `max_vacuum`）、§10.2 第 4、5、6 条；负责人决定 L-08（输入胞的网格倍数提示 `Using the input cell: the surface cell has N times the area of the smallest one, <Wood>.`）、L-19；ledger-F0 §6 M2 第 8 条；依赖 M1 `cellops.make_supercell`（取 `src`）、`standard_frame`、`supercell_label`、`surface_mesh_matrix`，M2-T3、M2-T4n；U2、U4、C5、C9。

【实现】`build/surface.py` 的段 `M2-T4`；`build/__init__.py` 段 `M2` 导出 `surface`、`surface_analysis`、`terminations`、`oriented_cell`、`estimate_surface_atoms`（`build.surface` 是函数；子模块经 `crystallume.build.surface` 的 sys.modules 仍可导入）；命名需要修正时只改 `core/naming.py` 的段 `M2`（JS 由 M2-T6b 同步）；L-08 的文案生成函数作为内部函数放在本段（JS 同名同义）。注册 Python op `surface` 于新文件 `tests/ops/m2_slab.py`（配方 `bulk` 已由 M2-T7a 注册，不重复注册）。

【U 与负责人决定】U2（pbc T T T、标准取向）、U4（`vacuum` 仅限关键字、必填、总间隙；0 = 体相堆垛；默认 4 层、居中）；负责人决定 L-08、L-19。

【文件】`crystallume/build/surface.py#M2-T4`、`crystallume/build/__init__.py#M2`、`crystallume/core/naming.py#M2`、`tests/test_surface.py`、`tests/ops/m2_slab.py`。

【测试】M2 §7.1 的"组装"（`pbc == [T,T,T]`、元素按体相顺序分块且块内层号不减、锚点 (0, 0)、a ∥ x、c ∥ z、底层高 V/2 或 offset、`find_layers(slab).from_top + 1 == tags`）、"真空必填（U4）"、"V = 0 与小真空"、"厚度"、"对称"、"化学计量与极性"、"固定"（默认 N：Pt 4 层 2、金红石 6 层 3、CeO2 9 层 3、SrTiO3 8 层 4；E14；W13）、"超胞"（c(2×2)、√3、√7、2√3、(1×√3)rect、(2×√3)rect；det ≤ 0、超范围、不相容；六方网格上的 `c(4×2)` 被拒）、"命名"、"props / info"、"估算"（每个金标 `estimate_surface_atoms(...) == len(surface(...))`）、"报错"（E1–E16 至少一次，逐字）；在测试里直接读 `tests/data/surface/cleave/slab/` 的用例并调用 Python 实现。

#### M2-T6b JS slab 组装、命名与晶面多边形（链 `w1-m2-assembly-js`）

【目标】JS 版 slab 组装与命名：`buildSurface`、`orientedCell`、`estimateSurfaceAtoms`、名字，以及 Planes 预览用的纯函数 `planePolygons`。

【依据】与 M2-T4 相同的规格节（M2 §3.10–3.13、§3.16、§3.20、§4）与账本条目（L-M2-02：JS `buildSurface` 没有 `wood`，`supercell` 接受矩阵、对角简写或文本；L-X-01；L-X-07；§1.5 R-F05：`vacuum` 缺失 → E12a）；M2 §5.4（`planePolygons(cell, hkl, heights, block)`：输入胞分数坐标中平面为 h f1 + k f2 + l f3 = z / d_hkl，与块的 12 条棱求交、按平面内角度排序后转笛卡尔）；M1 JS（`core/cellops.js` 的 `makeSupercell` 取 `src`）；M2-T6a、M2-T4n 的 JS 部分；负责人决定 L-08、L-19。

【实现】`web/js/build/surface.js` 的段 `M2-T6b`；名字需要修正时只改 `core/naming.js` 的段 `M2`（与 M2-T4 的 Python 修改逐字同步，冲突时以 L-X-07 为准并在报告里说明）。注册 JS op `surface` 于新文件 `tests/js/ops/m2_slab.mjs`（配方 `bulk` 已由 M2-T7a 注册）。

【U 与负责人决定】U2、U4（JS 缺 `vacuum` → E12a）；负责人决定 L-08、L-19。

【文件】`crystallume/web/js/build/surface.js#M2-T6b`、`crystallume/web/js/core/naming.js#M2`、`tests/js/surface.test.mjs`、`tests/js/ops/m2_slab.mjs`。

【测试】`tests/js/surface.test.mjs`：读 `tests/data/surface/cleave/slab/` 的用例并对 JS 实现逐项断言；组装、真空必填、V = 0、固定、超胞、命名、报错各组的 JS 版；`planePolygons` 在 20 个平面上 ≤ 1 ms、多边形顶点数与面积的解析值；`estimateSurfaceAtoms == buildSurface(...).length`。

#### M2-T5 已有结构的工具：set_vacuum、add_vacuum、center_slab、flip_slab、standardize_slab（双语言）（链 `w1-m2-vacuum-tools`）

【目标】双语言的改真空工具与 slab 工具：`set_vacuum`、`add_vacuum`、`center_slab`、`flip_slab`、`slab_extent`、`slab_report`、`surface_top`、`standardize_slab`（M6 的层准备用）。

【依据】M2 §3.14、§3.15、§6.1.1；ledger-features L-M2-03（**[改]** 没有块时建 `kind: "vacuum"` 块，`autoName = s.name`，不改名；`set_vacuum(0)` 对已有结构报 E12d，负责人决定 L-13）、L-M2-04（`flip_slab` 用 `auto_name_state`/`refresh_auto_name(s, before)`；`miller`/`hkil`/`bulkNormal` 取反；超胞记录 p(1×1) → I、p(3×3) → diag(3,3)、√3 → `[[1,-1],[1,2]]`）、L-M2-05（`standardize_slab`：轴轮换、左手重标号、接上、c 正交、a ∥ x、底层 z = 0，R-F22）、§10.2 第 7、8 条；ledger-F0 §6 M2 第 1、2 条与 V-F11 第 1、3 条（`contiguous_shifts(s, 2, cut=…)` 给每个原子的整数平移，即网页 `imageShift`；`make_contiguous(s, 2, cut=sn["cut"])`；没有表面时 `require_gap(s)`，文案 `vacuum_gap_hint`）；依赖 M1 `standard_frame`、`gauss_reduce_2d`、`permute_cell_axes`（M1-T3b，W1.4）；U1（`kind: "vacuum"` 只是来源记录，不是 slab 标记）、U2（改真空不改 pbc）、U4（`vacuum` 必填、总间隙）。

【实现】Structure 方法放 `core/structure.py`、`web/js/core/structure.js` 的段 `M2`；`slab_report`、`surface_top`、`standardize_slab` 放 `build/surface.py`、`web/js/build/surface.js` 的段 `M2-T5`。注册 ops `setVacuum`、`flipSlab`、`standardizeSlab`（`tests/ops/m2_tools.py`、`tests/js/ops/m2_tools.mjs`），去掉 `tests/data/surface/cleave/tools/` 的 skip。

【U 与负责人决定】U1（`kind: "vacuum"` 不是 slab 标记）、U2（改真空不改 pbc）、U4（总间隙、必填）；负责人决定 L-13（已有结构 `set_vacuum(0)` → E12d）。

【文件】`crystallume/core/structure.py#M2`、`crystallume/web/js/core/structure.js#M2`、`crystallume/build/surface.py#M2-T5`、`crystallume/web/js/build/surface.js#M2-T5`、`tests/test_vacuum_tools.py`、`tests/js/vacuum_tools.test.mjs`、`tests/ops/m2_tools.py`、`tests/js/ops/m2_tools.mjs`、`tests/data/surface/cleave/tools/`。

【测试】M2 §7.1 的"真空工具"（CONTCAR 夹具：间隙 15.000、SD 原样、pbc 仍 T T T；倾斜 c；真空沿 a 的置换；左手晶胞 + 顶位 H：H 仍在顶上、W18；石墨烯 T T F：pbc 仍 T T F；MoS2；漂浮 H2：W19、间隙从 H2 量起；体相 W14；bottom/keep/offset；`add_vacuum` 正负；`center_slab` 不改晶胞；`set_vacuum(0)` → E12d；多帧被丢弃；`imageShift` 与 `contiguous_shifts` 相同）、"翻转"、"M6 接口"各行；acceptance S13-1、S14-1–S14-3。

#### M2-T7c 启用切面分析金标与 terminations 的跨语言平价（链 `w1-m2-vacuum-tools`）

【目标】在 Python（M2-T3）与 JS（M2-T6a）的分析都合入之后，启用分析类金标并加上 `terminations` 的跨语言平价测试（从 M2-T7b 拆出，plan.md P-03）。

【依据】M2 §7.3（随机 (hkl) ∈ [−3, 3]³ 在 Pt、SrTiO3、TiO2 上比较 `terminations` 的 JSON：层、τ_eff、切口、类、标签、断键数、极性、Tasker；氧化态加载顺序：表已加载的 JS 与 Python 结果完全相同，JS 未加载时调用抛错）；ledger-features §10.0 第 9 条（比较 `info.surface` 时排除 `bulk.name`（负责人决定 L-11）与网页的 `bulk.entryId`）；ledger-F0 L-F0-27。

【实现】去掉 `tests/data/surface/cleave/analysis/` 的 skip；新文件 `tests/test_m2_parity.py`（一次 Node 调用批量执行；本任务只放 terminations 与氧化态两组，W1.6 的 M2-T7b 在同一文件追加 slab 的比较）。

【U 与负责人决定】U1；负责人决定 L-11（比较 `info.surface` 时排除 `bulk.name`）。

【文件】`tests/data/surface/cleave/analysis/`（只改 skip）、`tests/test_m2_parity.py`。

【测试】即上。两语言不一致时不要改金标凑数：在报告里写明哪一边偏离规格，负责人安排修复。

### W1.6

M2 的 Cleave/Slab 分区与 REST/CLI、slab 完整金标与平价；M1 的其余分区、命令、菜单与公共 API。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-m1-cellui2` | 8822 | M1-T7b 网页：Strain、Reduce/primitive/conventional、Orientation & origin 分区 | `crystallume/web/js/ui/cellsections.js`、`crystallume/web/js/commands/cell.js`、`crystallume/web/css/app.css#M1`、`tests/js/cellui2.test.mjs` |
| `w1-m1-commands` | 8823 | M1-T7c 右键菜单、选区动作与 Tools 行迁移、M1-T8a M1 的 JS 公共 API（defineApi） | `crystallume/web/js/ui/cellmenus.js`、`crystallume/web/js/api/cellapi.js`、`crystallume/web/js/main.js#M1-commands`、`crystallume/web/js/ui/panels/structure.js#tools-row`、`tests/js/cellapi.test.mjs` |
| `w1-m2-cleave-ui` | 8824 | M2-T9 Surface › Cleave 分区（终止面列表、层堆叠图、晶面叠加、预览与 Create） | `crystallume/web/js/ui/panels/surface-cleave.js`、`crystallume/web/js/main.js#M2-cleave`、`crystallume/web/css/app.css#M2-cleave`、`crystallume/web/js/app.js#M2`、`crystallume/web/js/app.js#beginStructureEdit`、`crystallume/web/js/main.js#edit.applyPreview`、`tests/js/cleave_ui.test.mjs` |
| `w1-m2-slab-ui` | 8825 | M2-T10 Surface › Slab 分区（改真空、内嵌超胞编辑器、翻转、居中） | `crystallume/web/js/ui/panels/surface-slab.js`、`crystallume/web/js/main.js#M2-slab`、`crystallume/web/css/app.css#M2-slab`、`tests/js/slab_ui.test.mjs`、`tests/js/supercell_two_mounts.test.mjs` |
| `w1-m2-api` | — | M2-T8 M2 的 REST、客户端与 CLI（build surface、terminations、edit vacuum/flip/center-slab） | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py` |
| `w1-m2-parity` | — | M2-T7b-lite slab 完整原子列表金标并启用全部切面金标、M2-T7b M2 跨语言平价、命名两条路径、固定两条路径与性能测试、M2-T3b （应该）表面配位与暴露层（双语言） | `scripts/gen_surface_fixtures.py`、`tests/data/surface/cleave/`、`tests/test_m2_parity.py`、`tests/test_surface_perf.py`、`tests/test_cleave_naming_paths.py`、`tests/test_cleave_fix_equals_fix_layers.py`、`crystallume/build/surface.py#M2-T3b`、`crystallume/web/js/build/surface.js#M2-T3b`、`tests/test_surface_coordination.py`、`tests/js/surface_coordination.test.mjs` |

**合并顺序**：`w1-m2-parity` → `w1-m2-api` → `w1-m1-cellui2` → `w1-m1-commands` → `w1-m2-cleave-ui` → `w1-m2-slab-ui`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M2 平价：`tests/test_m2_parity.py` 全部金标两语言逐项相同（P6：坐标 1e-6 同顺序、晶胞 1e-8、tags、SD、`info.surface` 排除 `bulk.name` 与 `bulk.entryId`、名字与 `warnings` 逐字）——验收 C-9；9 个完整原子列表用例通过；`tests/data/surface/cleave/` 不再有 skip
- L-19：`tests/test_cleave_naming_paths.py` 通过（切面 `supercell="c(2×2)"` 与切面后 `make_supercell` 得到同一名字 `Cu(100) (√2×√2)R45° 4L`，两语言）；R-F09：`test_cleave_fix_equals_fix_layers` 两半都通过
- M2-T8：`/build/surface`、`/build/vacuum`、`/analysis/terminations` 在 `ROUTE_METHODS` 中；REST 缺 `vacuum` → 422，CLI 省略 `--vacuum` → 退出码 2（U4-c）；acceptance S1 的 CLI 前两行（改用 `--surface-cell 3x3`，plan.md P-16）stderr 为 `wrote 36 atoms (Pt36) to slab.json`
- 界面：Surface 面板 Cleave 分区真空框为空、Create slab 与 Preview › Slab 在填写前不可用（U4-a）；会话内记住用户填的值、刷新后为空且 `localStorage` 不含真空（U4-b）；Create 后项目结构数 +1、体相保留、Undo 只撤销 Create（C-1、C-3）；预览期间 `app.dirty` 与历史不变（C-4）
- 界面：Slab 分区内嵌 `supercellEditor`（L-16），与 Structure › Cell › Supercell 得到同一名字、toast 与撤销标签（`tests/js/supercell_two_mounts.test.mjs`）；Cell 插槽 5 个分区齐全；命令面板能搜到 `Cleave Surface`、`Build Vacuum Slab`、`Supercell`、`Redefine Lattice`、`Lattice Parameters`（MD-7 的 M1/M2 部分）
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M1-T7b 网页：Strain、Reduce/primitive/conventional、Orientation & origin 分区（链 `w1-m1-cellui2`）

【目标】Cell 插槽的其余三个分区与它们的命令：Strain、Reduce, primitive & conventional、Orientation & origin；原胞搜索在网页分块执行并显示进度与 Cancel。

【依据】M1 §5.1（分区表）、§5.4–5.6、§5.7（本任务的 8 个命令：`cell.rightHanded`、`cell.reorient`、`cell.strain`、`cell.reduce`、`cell.primitive`、`cell.conventional`、`cell.shiftOrigin`、`cell.wrap`）、§3.16（> 5000 原子分块，每约 16 ms 让出主线程）、§3.17、§5.9；ledger-features L-M1-09（惯用胞在有真空轴时的说明，V-F01）、L-M1-10、L-M1-11、L-M1-12、L-M1-16；ledger-F0 L-F0-54（`app.startTask(label, { cancel })`，M1 写的 `app.busy` 改名）、L-F0-48（`vec3Input({frames: ['fractional', 'cartesian']})`、`millerInput`）、L-F0-35（P-swap 预览 `sameAtoms: true`）；plan.md P-09；U1（Orientation 分区的 badge 只放 `left-handed`）。

【实现】在 `web/js/ui/cellsections.js` 注册三个分区 `cell.strain`（order 30）、`cell.reduce`（40）、`cell.orientation`（50），沿用 M1-T7a 的状态模型；在 `web/js/commands/cell.js` 加上述 8 个命令（参数 schema 按 M1 §5.7，执行函数与分区共用，`estimate`）；原胞 `Find` 在 > 5000 原子时用 `findTranslationsAsync` + `startTask` 进度与 Cancel，超过 `primitive_atoms_web` 禁用并给 M1 §5.5 的文案；Wrap into cell 与 Make N×N×N supercell real 的新位置在 Orientation/Supercell 分区（旧 Tools 行的移除由 M1-T7c 做）。

【U 与负责人决定】U1（Orientation 分区 badge 只放 `left-handed`；惯用胞说明不写 bulk）、U5；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/cellsections.js`、`crystallume/web/js/commands/cell.js`、`crystallume/web/css/app.css#M1`、`tests/js/cellui2.test.mjs`。

【测试】`tests/js/cellui2.test.mjs`：读数文案（`Niggli-reduced cell: …`、`Found 36 lattice translations: …`、`This is a cubic F lattice; …`、`Already in the standard orientation.`）、命令参数校验（tensor 模式给 percent 报 `invalid-params`）。

【界面检查】（Chromium，本链端口）4 层 Pt(111) 夹具上 Strain Biaxial +2 %（Keep the vacuum gap 默认勾选）→ Apply → 读数 `a 2.772 → 2.828 Å (+2.00 %) … c 21.790 Å (unchanged)`，导出 POSCAR 的 a 增大 2 %、c 不变；Reduce 分区读数随展开计算；Primitive cell 在 1 万原子夹具上 Find：进度条出现、期间能旋转视图、Cancel 可用；Orientation & origin：`Re-orient to standard` 在已标准时禁用；Shift origin 实时预览；`Wrap atoms into cell` 0 个时提示 `All atoms are already inside the cell.` 且不记历史。截图存 `scratchpad/shots/w1-m1-cellui2/`。

#### M1-T7c 右键菜单、选区动作与 Tools 行迁移（链 `w1-m1-commands`）

【目标】M1 的菜单入口：空白处右键菜单的 `Lattice parameters…`、`Supercell…`，选区动作 `cell.atomToOrigin`，Structure 面板 Tools 行按钮迁移与摘要提示行。

【依据】M1 §5.1（Tools 行迁移：Wrap into cell 与 Make N×N×N supercell real 移到分区，摘要保留一行 `The view repeats the cell 3×3×1. [Make it real]`，Tools 只留 Duplicate）、§5.8（`registerSelectionAction({id: 'cell.atomToOrigin', label: 'Move to origin', short: 'Origin', icon: 'crosshair', order: 80, card: false, menu: true, …})`）、§5.9；ledger-F0 L-F0-50（`registerSelectionAction` 的 `menu: 'blank'`：空白处菜单经注册表加入，不改 `ui/shell.js`）、L-F0-49；plan.md P-09。

【实现】新文件 `web/js/ui/cellmenus.js`（空白处菜单项与 `cell.atomToOrigin`，执行时 `commands.run('cell.parameters')`、`commands.run('cell.supercell')`、`commands.run('cell.shiftOrigin', …)`，按 id 晚绑定）；`ui/panels/structure.js` 中摘要之后的 Tools 行与摘要提示行（W0 之后按渲染函数定位；HEAD 1bb366f 在 `structure.js:172-185` 一带）；`main.js` 段 `M1-commands` import `cellmenus.js` 与 `api/cellapi.js`。

【U 与负责人决定】U1（菜单不按 slab 分类）、U5（D1）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/cellmenus.js`、`crystallume/web/js/ui/panels/structure.js#tools-row`、`crystallume/web/js/main.js#M1-commands`。

【测试】`tests/js/cellapi.test.mjs` 中的菜单项注册断言（id、order、`when`）。

【界面检查】（Chromium，本链端口）空白处右键出现分隔线与 `Lattice parameters…`、`Supercell…`，点击后打开并聚焦对应分区；恰好选中 1 个原子时右键有 `Move to origin`；显示重复 3×3×1 时 Structure 摘要出现 `The view repeats the cell 3×3×1. [Make it real]`，点击后变成真实超胞且显示重复复位为 1×1×1；Tools 行只剩 Duplicate。

#### M1-T8a M1 的 JS 公共 API（defineApi）（链 `w1-m1-commands`）

【目标】M1 的 `window.crystallume` 成员（从 M1-T8 拆出 API 部分，文档在 W1.7）。

【依据】M1 §6.2；ledger-features L-M1-16（公共 API 清单：`edit.makeSupercell`、`edit.redefineLattice`、`edit.makeRightHanded`、`edit.setLatticeParameters`、`edit.setCell`、`edit.strain`、`edit.reduceCell`、`edit.primitiveCell`、`edit.conventionalCell`、`edit.reorient`、`edit.shiftOrigin`、`edit.wrap`；`build.makeSupercell(s, P, { wrap }) → Structure`（不加入项目，R-F36）；`analysis.translations`、`analysis.primitiveCell`、`analysis.referenceMesh`；`lattice.*` 追加 `gaussReduce2d` … `hermiteNormalForm2d`）、L-M1-08；ledger-F0 L-F0-53（`defineApi(path, fn, {owner: 'M1'})`，不改 `api/public.js`）、§6 M1 第 10 条。

【实现】新文件 `web/js/api/cellapi.js`：`edit.*` 一律经 `commands.run('cell.*', params)`（可撤销，按 id 晚绑定）；`build.makeSupercell`、`analysis.*`、`lattice.*` 直接调用核心函数。

【U 与负责人决定】U5（P6：功能处处可用，JS API 与命令同一条执行路径）；负责人决定 L-19。

【文件】`crystallume/web/js/api/cellapi.js`、`tests/js/cellapi.test.mjs`。

【测试】`tests/js/cellapi.test.mjs`：每个成员已注册、`owner` 为 M1；`build.makeSupercell` 返回新结构且不改输入；`lattice.*` 的函数与 `core/lattice.js` 同一引用。

【界面检查】（同链端口）控制台 `crystallume.edit.makeSupercell({ preset: 'sqrt3' })` 可撤销；`crystallume.build.makeSupercell(crystallume.structure, [[2,0,0],[0,2,0],[0,0,1]])` 返回新结构、项目结构数不变；`crystallume.reference()` 里能看到这些成员。

#### M2-T9 Surface › Cleave 分区（终止面列表、层堆叠图、晶面叠加、预览与 Create）（链 `w1-m2-cleave-ui`）

【目标】Surface 面板的 Cleave 分区与 `surface.cleave` 命令、相应的公共 API。

【依据】M2 §5.1–5.5、§5.7（`surface.cleave` 行）、§5.8、§5.9、§3.20（界面文案）；ledger-features L-M2-08（分区 `registerPanelSection('surface', { id: 'cleave', order: 10 })`；真空为空时不开 P-swap 会话，Create 不可用，tip `Enter the vacuum (total gap in Å; 0 for none).`；Create = `ses.commit({ addAsNew: true, name })` 或 `addStructure(slab, { replaceProject: false })`；L-08 的提示；命令参数 `spec`（不是 `wood`）与 `supercell`（imatrix 2×2）最多给一个、`fixAxes` 字符串、`vacuum: {type: 'float', unit: 'Å', min: 0, required: true}`；公共 API `build.surface(bulk?, params)`、`build.terminations(bulk?, params)`、`surface.cleave(params)`）、§10.2 第 3、4 条；ledger-F0 L-F0-56（`registerBootTask('oxidation-states', loadOxidationStates)`，V-F11 第 2 条）、L-F0-35（P-swap 会话、`commitLabel: 'Create'`、没有 `banner`）、L-F0-38（`planeLayer`）、L-F0-45（`viewAlong`）、L-F0-48（`millerInput({describe})`、`numberInput({required: true})`、`imatrixInput`）、L-F0-52、L-F0-53；负责人决定 L-08、L-19；U1（分区总在，条件不满足时 `available()` 就地说明；badge 只放晶面）、U4（真空框初始为空、不预填，会话内只记用户自己填的值，存在模块变量里，不进偏好、项目、`localStorage`）、U5、P3、P4。

【实现】新文件 `web/js/ui/panels/surface-cleave.js`：Bulk 行、Plane（120° 六方自动四格）、Indices（This cell/Conventional cell）、View along normal、Minimal surface cell、网格信息行与 L-08 提示、Termination 单选卡片、层堆叠图（SVG，`role="img"` 与文本替代，点击间隙选切口）、Thickness（Layers/Periods/Å，默认 4 层）、Symmetric slab、Fix layers、Vacuum、Position/Offset、Surface supercell（M1 `wood_presets` 相对 1×1 网格）、Name 与 ↺、摘要（`role=status aria-live=polite`）、Preview（Planes 用三个 `planeLayer`，生命周期按 M2 §5.4；Slab 用 P-swap，会话开始保存相机、首次侧视 `viewAlong([0,-1,0], {up: [0,0,1]})`，cancel/switch 时恢复相机）、Create slab、Advanced；分析与组装的防抖与分块（§5.4）；命令 `surface.cleave`（覆盖 F0-A 的回退）；`registerBootTask`；`defineApi`；`main.js` 段 `M2-cleave`；`css/app.css` 段 `M2-cleave`。

- **P-04（条件性）**：先确认 W0 实现的预览条主按钮与 `edit.applyPreview`（mod+Enter）对 P-swap 会话调用什么。若调用无参 `commit()`（替换活动结构），就在 `app.js` 的 `beginStructureEdit` 增加会话选项 `commitArgs`（缺省 `{}`，会话对象上可写），预览条按钮与 `edit.applyPreview` 改为 `ses.commit(ses.commitArgs)`；Cleave 会话传 `commitArgs: { addAsNew: true, name }` 并随参数更新名字。改动只在这两处（以函数名定位）与 `app.js` 段 `M2`，补一条 node 测试；若 W0 已正确处理则不改，并在报告里写明。

【U 与负责人决定】U1、U4（真空框为空、不预填、会话内只记用户填的值）、U5；负责人决定 L-08、L-19；P-04（需负责人确认）。

【文件】`crystallume/web/js/ui/panels/surface-cleave.js`、`crystallume/web/js/main.js#M2-cleave`、`crystallume/web/css/app.css#M2-cleave`、`crystallume/web/js/app.js#M2`、`crystallume/web/js/app.js#beginStructureEdit`（条件性）、`crystallume/web/js/main.js#edit.applyPreview`（条件性）、`tests/js/cleave_ui.test.mjs`。

【测试】`tests/js/cleave_ui.test.mjs`：纯逻辑（摘要三行的文案、L-08 文案、真空校验与 E12a/E12b/H5 的就地文案、命令参数校验：缺 `vacuum` → `{code: 'invalid-params'}` 且 message 含 `vacuum`、`spec` 与 `supercell` 同给报错）；P-04 修补时的会话测试。

【界面检查】（Chromium，本链端口；静态模式与 serve 各一次）acceptance S1 第 1–9 步与 E2E-1 第 2–7 步：Shift+5 出现 Cleave、Slab（以及 F0-A 的其余分区壳）；Plane 默认 `1 1 1`，读数 `(1 1 1) of the current cell · d = 2.263 Å`；`Vacuum` 为空且无占位数字，`Create slab` 与 Preview 的 `Slab` 不可用，摘要含 `vacuum not set`；填 15、Fix layers 2 Bottom、Surface supercell `p(3×3)` 后摘要 `Pt(111) p(3×3) 4L — 36 atoms (Pt36)` 与 `8.32 × 8.32 × 21.79 Å`；Preview › Slab 侧视、预览条 `Preview: Cleave surface`、状态栏 `Preview · 36 atoms`、历史与 dirty 不变；切回 Planes 相机恢复；Create → toast `Created Pt(111) p(3×3) 4L (36 atoms)`，项目 +1 结构，Ctrl+Z 只撤销它；mod+Enter 在预览中同样新增结构而不是替换体相（P-04）；SrTiO3 (0 0 1) 的 Termination 有 `TiO2`、`SrO` 两项；ZnO 的 Plane 四格且 i 只读，粘贴 `1 0 0 0` 时报 `Plane: in (h k i l), i must be −(h + k) = -1.`。截图（含 Planes 叠加层与层堆叠图）存 `scratchpad/shots/w1-m2-cleave-ui/`。

#### M2-T10 Surface › Slab 分区（改真空、内嵌超胞编辑器、翻转、居中）（链 `w1-m2-slab-ui`）

【目标】Surface 面板的 Slab 分区：改真空的预览与应用、实时报告、内嵌的表面超胞编辑器、Flip slab、Centre slab，以及相应命令与公共 API。

【依据】M2 §5.6、§5.7（`surface.vacuum`、`surface.setVacuum`、`surface.flip`、`surface.center`）、§5.8、§5.9；ledger-features L-M2-08（**[改]** 负责人决定 L-16：分区内嵌 M1 的 `supercellEditor(el, app, { owner: 'surface.slab', surface: true })`，不另写编辑器、不另算预设，取代 M2 §5.6 写的"打开 Structure › Cell › Supercell"按钮；公共 API `edit.setVacuum`、`edit.addVacuum`、`edit.centerSlab`、`edit.flipSlab`）、L-M2-03、L-M2-04、§10.2 第 3、7 条；ledger-F0 L-F0-30（`editActive` 的 `imageShift`、`cameraTransform`、`latticeChanged`、`singleFrame`）、L-F0-35（P-swap，`commitLabel: 'Apply'`）、L-F0-52（`surface.setVacuum` 的守卫 `requireVacuumGap`，T T F 放行）；负责人决定 L-13（填 0 时就地显示 E12d、Apply 不可用）、L-19；U1（信息行只描述事实）、U2（改真空不改 pbc）、U4（Vacuum 框初始为空，信息行里的当前间隙是测量值，不填进输入框）、P3。

【实现】新文件 `web/js/ui/panels/surface-slab.js`（`registerPanelSection('surface', { id: 'slab', order: 20 })`；信息行用 `slab_extent()`/`slab_report()`；Vacuum → `beginStructureEdit('Set vacuum', {kind: 'structure', owner: 'surface.slab', commitLabel: 'Apply'})` 与 `preview(work.setVacuum(...), {sameAtoms: true, latticeChanged: true, imageShift})`，Apply 时 `commit({label: 'Set vacuum to 15 Å', toast: 'Vacuum set to 15 Å (c = 21.79 Å)'})`；Position Centre/Bottom/Keep 与 Offset；内嵌超胞编辑器；Flip（先在副本上算 `imageShift` 与 R，再 `editActive('Flip slab', …, {latticeChanged: true, cameraTransform: R, imageShift, singleFrame: true})`）、Centre）；四个命令；`defineApi`；`main.js` 段 `M2-slab`；`css/app.css` 段 `M2-slab`。

【U 与负责人决定】U1、U2、U4、U5；负责人决定 L-13、L-16、L-19。

【文件】`crystallume/web/js/ui/panels/surface-slab.js`、`crystallume/web/js/main.js#M2-slab`、`crystallume/web/css/app.css#M2-slab`、`tests/js/slab_ui.test.mjs`、`tests/js/supercell_two_mounts.test.mjs`。

【测试】`tests/js/slab_ui.test.mjs`（信息行文案：`No vacuum gap of 5 Å or more was found. …`、`the atoms cross the cell edge`、W19；toast 文案；命令参数校验缺 `vacuum` → `invalid-params`）；`tests/js/supercell_two_mounts.test.mjs`（L-M1-16 的 `test_supercell_two_mounts`：同一结构上 `owner: 'cell.supercell'` 与 `owner: 'surface.slab'` 两种挂载经同一执行函数得到相同名字、toast 与撤销标签）。

【界面检查】（Chromium，本链端口）E2E-4 第 1–3 步（按 L-16 改写）：载入内置石墨烯（pbc T T F），Shift+5；Cleave 分区文本含 `this one is periodic along a and b only` 与按钮 `Open Slab section`；Slab 信息行 `Vacuum gap 15.00 Å along c`；`Vacuum` 为空、Apply 不可用；填 0 → 就地错误含 `only possible when cleaving`、Apply 仍不可用；填 20 → Apply → toast `Vacuum set to 20 Å`，`cell[2][2]` = 20、pbc 仍 `[true, true, false]`、原子 z = 10；内嵌编辑器预设 `(√3×√3)R30°` → `Create supercell` → 6 原子、|a| = 4.2608 Å、pbc 不变、名字与 Cell › Supercell 路径相同；CONTCAR 夹具上 Flip slab 的 toast 与 Centre slab 后测量保留。截图存 `scratchpad/shots/w1-m2-slab-ui/`。

#### M2-T8 M2 的 REST、客户端与 CLI（build surface、terminations、edit vacuum/flip/center-slab）（链 `w1-m2-api`）

【目标】M2 的外部接口：REST `/build/surface`、`/build/vacuum`、`/analysis/terminations`，客户端方法，CLI `crystallume build surface`、`crystallume terminations`、`crystallume edit vacuum|flip|center-slab`。

【依据】M2 §6.3–6.5；ledger-features L-M2-09（**[改]** 三个新模型 `extra="forbid"`；`vacuum: float = Field(..., ge=0, le=1000)`；`supercell: list[Row2] | Row2 | str | None`（文本经 M1 语法）；`fixAxes: str`（R-F09 语法，非法 → 400）；客户端 `surface(self, structure, miller, *, vacuum, **kw)`、`set_vacuum(self, structure, vacuum, **kw)`、`terminations(self, structure, miller, **kw)`；CLI 选项按账本原文：`--vacuum` 必填（`required=True`）、`--surface-cell SPEC`，删除 `--supercell`、`--supercell-matrix`、`--wood`；只读的 `terminations` 用 `--format` 表示输入格式）、§0.3、R-F13、R-F14、§10.2 第 11 条；M2 §3.16（服务器构建前估算原子数，云模式公开限额 `max_cleave_bulk_atoms_public`）；U4-c。

【实现】`server/models.py`、`server/routes/build.py`、`server/routes/analysis.py`、（可选用户依赖）`server/auth.py`/`server/deps.py`、`client.py`、`cli.py`（`build surface` 加到现有 `build` 组；`terminations` 顶层只读命令；`edit vacuum`、`edit flip`、`edit center-slab` 加到 M3-T11a 建立的 `edit` 组）；`ROUTE_METHODS` 三条。

【U 与负责人决定】U4-c（REST 缺 `vacuum` → 422，CLI 省略 `--vacuum` → 退出码 2）；负责人决定：无直接相关项（CLI 选项按账本 R-F13）。

【文件】API 文件束（plan.md §2.4）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`。

【测试】REST：200、缺 `vacuum` 422、`vacuum` > 1000 422、未知字段 422、科学错误 400（E12d、E9 等）、云模式公开限额；`tests/test_hardening.py` 估算 = 实际；客户端 `ROUTE_METHODS` 与真实调用；CLI：acceptance S1 的前两行（`crystallume build crystal fcc Pt --a 3.92 -o Pt.json`、`crystallume build surface Pt.json --hkl 1 1 1 --layers 4 --vacuum 15 --surface-cell 3x3 --fix-bottom 2 -o slab.json`，stderr `wrote 36 atoms (Pt36) to slab.json`）、省略 `--vacuum` 退出码 2、`terminations --json`、`edit vacuum` 读回 c 与 pbc。

#### M2-T7b-lite slab 完整原子列表金标并启用全部切面金标（链 `w1-m2-parity`）

【目标】生成 9 个完整原子列表金标，并去掉 `tests/data/surface/cleave/slab/` 的 skip，让 Python 与 JS 的 slab 组装都对照同一份完整数据。

【依据】M2 §7.2（9 个用例：Pt(111) p(3×3) 4L 固定 2 层、SrTiO3 TiO2 对称 7L、TiO2(110) 3 周期、ZnO(10-10) A 4 周期、Cu(100) c(2×2)、Ag(111) √3、LaFeO3(001) 1 周期、Pt(111) 4L V = 0、CONTCAR `set_vacuum(15)`；规定顺序，1e-6 Å）；ledger-F0 L-F0-27；plan.md P-03。

【实现】`scripts/gen_surface_fixtures.py`（开发期运行：先用解析式写期望，再用 Python 实现补全原子列表）→ `tests/data/surface/cleave/full/*.json`；去掉 `cleave/slab/` 的 skip。开发期可在 ASE 参考环境 `scratchpad/proto/m1/refvenv/bin/python` 中与 ASE `surface()` 交叉核对（`primitive=False`、同一 (hkl)，比较 d、网格面积、每周期原子数、刚体运动与置换下的坐标；ASE 的 vacuum 为每侧），结论写进报告。

【U 与负责人决定】U2（完整原子列表 pbc T T T）、U4（V = 0 用例）；负责人决定：无直接相关项。

【文件】`scripts/gen_surface_fixtures.py`、`tests/data/surface/cleave/`。

【测试】`tests/test_cases.py` 与 `tests/js/cases.test.mjs` 跑通全部切面金标（不再有 skip）。

#### M2-T7b M2 跨语言平价、命名两条路径、固定两条路径与性能测试（链 `w1-m2-parity`）

【目标】M2 的跨语言平价（验收 C-9）、L-19 的命名两条路径、R-F09 的固定两条路径与性能预算测试。

【依据】M2 §7.3（每个金标两语言各跑：符号、坐标 1e-6 同顺序、晶胞 1e-8、pbc、tags、SD、`info.surface`（数值 1e-6；排除 `bulk.entryId` 与 `bulk.name`，负责人决定 L-11）、名称逐字、`warnings` 逐字）、§7.5（`tests/test_surface_perf.py`，`slow`，216 与 10 000 原子组装、135 原子分析、1 万原子 `set_vacuum`，断言 2 倍余量）；acceptance C-9、S2-3、S3-2；ledger-features R-F09、§10.3 第 6 条；负责人决定 L-19。

【实现】在 `tests/test_m2_parity.py` 追加 slab、tools、full 三组的比较；`tests/test_cleave_naming_paths.py`：`surface(..., supercell="c(2×2)")` 与"先切面再 `make_supercell(面内 c(2×2))`"得到同一名字 `Cu(100) (√2×√2)R45° 4L`，Ag(111) √3 同理（两语言）；`tests/test_cleave_fix_equals_fix_layers.py`：未弛豫 slab 上 `surface(..., fix_bottom=2)` 与 `fix_layers(bottom=2)` 结果相同（M2 一半；M3 一半已在 W1.3）；`tests/test_surface_perf.py`（`slow`）。

【U 与负责人决定】U2、U4；负责人决定 L-11（排除 `bulk.name`）、L-19（两条路径同名）。

【文件】`tests/test_m2_parity.py`、`tests/test_cleave_naming_paths.py`、`tests/test_cleave_fix_equals_fix_layers.py`、`tests/test_surface_perf.py`。

【测试】即上；`pytest -m slow tests/test_surface_perf.py` 在本机通过（CI 允许 ×3）。

#### M2-T3b （应该）表面配位与暴露层（双语言）（链 `w1-m2-parity`）

【目标】终止面的表面配位摘要 `termination.coordination` 与 `exposedLayers`（应该项），两语言。

【依据】M2 §3.8、§5.2（Termination 卡片的配位摘要 `2c-O, 5c-Ti` 或 `CN 7/9/10 · 3 exposed layers`）、§7.1"表面配位（应该）"；ledger-features L-M3-03（M3 `coordination_numbers(s, metal_pairs="smart")`）；ledger-F0 L-F0-55。

【实现】`build/surface.py` 与 `web/js/build/surface.js` 的段 `M2-T3b`，由分析结果调用（不改 T3/T6a 的段：在 `SurfaceAnalysis`/JS 结果上追加字段的函数放在本段，由分析函数末尾的一个钩子调用；若必须改动分析段的一行调用，改动限一行并在报告里说明）。

【U 与负责人决定】U1；负责人决定：无直接相关项。

【文件】`crystallume/build/surface.py#M2-T3b`、`crystallume/web/js/build/surface.js#M2-T3b`、`tests/test_surface_coordination.py`、`tests/js/surface_coordination.test.mjs`。

【测试】M2 §7.1"表面配位（应该）"：Pt(111)/(100)/(110)/(211)、金红石(110) 三个终止面、CeO2(111)、SrTiO3 的 CN 与 `exposedLayers`；预算每个终止面 Python ≤ 20 ms、JS ≤ 10 ms。

### W1.7

第 1 波收尾：文档、Playwright 冒烟（M1、M2 与验收子集）、M1 性能、跨模块回归。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w1-docs` | 8826 | M1-T8b M1 文档、M2-T11 M2 文档、应用内帮助与导览、M3-T12a M3 核心（层分析、约束、REST/CLI）的文档 | `README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour` |
| `w1-e2e-cell` | 8827 | M1-T9 M1 的 Playwright 冒烟测试 | `tests/e2e/cell_tools.spec.mjs` |
| `w1-e2e-surface` | 8828 | M2-T12 M2 的 Playwright 冒烟测试与第 1 波验收子集 | `tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/surface.spec.mjs`、`tests/e2e/w1_acceptance.spec.mjs` |
| `w1-perf` | — | M1-T11 M1 性能预算测试与 JS 性能测试的运行器 | `tests/test_translations_perf.py`、`tests/js/perf/translations.perf.mjs`、`tests/test_js_perf.py`、`crystallume/analysis/translations.py`、`crystallume/web/js/core/translations.js` |
| `w1-xmodule` | — | W1-X1 第 1 波跨模块回归测试（M1 × M2 × M3） | `tests/test_w1_crossmodule.py`、`tests/js/w1_crossmodule.test.mjs` |

**合并顺序**：`w1-xmodule` → `w1-perf` → `w1-e2e-surface` → `w1-e2e-cell` → `w1-docs`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- Playwright（`$DEVPY -m pytest -m slow tests/test_e2e.py`）：`tests/e2e/cell_tools.spec.mjs`（M1 §7.3 第 1–7 条）、`tests/e2e/surface.spec.mjs`（M2 §7.4 第 1–5 条）、`tests/e2e/w1_acceptance.spec.mjs`（E2E-1 第 1–7 步与切面后的导出断言、E2E-3 第 1–3、6–8 步、E2E-4 第 1–3 步按 L-16 改写）全部通过，无 `pageerror`/`console.error`；截图在 `tests/e2e/out/`
- 跨模块：`tests/test_w1_crossmodule.py`、`tests/js/w1_crossmodule.test.mjs` 通过：S2-3、S3-2（两条路径同名）、S11-6、S12-4、S12-5、S13-1、S13-2、S14-3、C-6（全部切面金标 `find_layers(slab).from_top + 1 == tags`）
- 性能：`pytest -m slow tests/test_translations_perf.py` 与 `tests/test_js_perf.py` 通过（M1 §7.4 预算，CI ×3）
- 文档：README、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md` 写入 M1、M2、M3 核心的接口与数据；文档里的每个 Python/CLI 例子能运行（由文档链在报告中列出已运行的例子）；`CHANGELOG.md` 的 Unreleased 一节更新
- 第 1 波整体：验收 S1-1–S1-4、S2-1–S2-3、S3-1–S3-2、S4-1/S4-2、S5-1/S5-2、S6-1/S6-2、S7-1/S7-2、S8-1–S8-3、S9-1–S9-4、S10-1–S10-3、S11-1–S11-4/S11-6、S12-1/S12-2/S12-4/S12-5、S13-1/S13-2、S14-1–S14-4 在 Python 与 JS 中成立；随后进入波末三视角审查

#### M1-T8b M1 文档（链 `w1-docs`）

【目标】M1 的用户与开发文档（从 M1-T8 拆出的文档部分）。

【依据】M1 §6（Python、JS、REST、客户端、CLI）、§3.15、§4；ledger-features L-M1-01…17、L-X-02；简报 §5（文档清单）；plan.md P-14。

【实现】`docs/PLUGINS.md`：M1 的 Python API（`make_supercell`、`set_cell` 与 ASE 的同名同义、`set_lattice_parameters`、`apply_strain`（百分数）、`reduce_cell`、`primitive_cell`、`reference_mesh` …）、JS `crystallume.edit.*`、`build.makeSupercell`、`analysis.*`、`lattice.*`、REST `/build/supercell` 与 `/build/transform`、客户端、CLI `crystallume transform`；`docs/SCHEMA.md`：`info.supercellMatrix` 与旧键 `info.supercell`（L-X-02）、info 处理器注册表的约定；`docs/DEPLOY.md`：REST 表两行；README：Structure 面板 Cell 分区一段。数字、乘号、根号按 C9 写。

【U 与负责人决定】U1（文档不写 slab 模式）、U4（真空是总间隙、无默认）；负责人决定 L-19。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`（Unreleased）。

【测试】把文档里的 Python 例子在开发环境里逐个运行，CLI 例子在临时目录运行，结果写进报告。

#### M2-T11 M2 文档、应用内帮助与导览（链 `w1-docs`）

【目标】M2 的文档、应用内帮助与导览。

【依据】M2 §9 T11、§6、§4.2；ledger-features L-M2-01…09、L-X-01（`info.surface` 字段表与维护规则、`kind` 的四种取值）、§0.3（真空语义）、§1.5；负责人决定 L-02（`build.crystal(..., vacuum=)` 与 CLI `build crystal --vacuum` 对二维原型是每侧：文档写明 `vacuum on each side (Å); the gap between periodic images is twice this`，新代码用 `set_vacuum`）、L-13、L-16；U1（文档不写"slab 模式"，只写"有真空间隙的结构"）、U4（真空是总间隙、必填、无默认值）。

【实现】README（Surface 面板 Cleave、Slab 两个分区的用法）、`docs/PLUGINS.md`（Python/JS/REST/CLI；真空语义与 `center(vacuum=)` 每侧的区别）、`docs/SCHEMA.md`（`info.surface` 字段表与维护语义、`tags`）、`docs/DEPLOY.md`（REST 表与云模式限额）；应用内帮助与导览：在 `ui/shell.js` 的帮助/导览文案里加入 Surface 面板的 Cleave、Slab（以符号定位，不改其他行）。

【U 与负责人决定】U1、U4；负责人决定 L-02（二维原型的每侧真空）、L-13、L-16。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour`。

【测试】文档例子逐个运行；导览与帮助在界面检查中查看。

【界面检查】（Chromium，本链端口）帮助对话框与导览里出现 Surface 面板（Shift+5）、Cleave、Slab 的说明，文案为英文、不出现 slab 模式之类的说法。

#### M3-T12a M3 核心（层分析、约束、REST/CLI）的文档（链 `w1-docs`）

【目标】第 1 波交付的 M3 核心的文档（M3 的界面文档在 W2.5 的 M3-T12b）。

【依据】M3 §6.1、§6.3–6.5、§3.12.3、§4；ledger-features L-M3-01…08、L-M3-10、L-X-05（R-ADS、`tags` 与 `adsorbate_id`）；C3、C4。

【实现】`docs/PLUGINS.md`：`find_layers`（方向语义、容差来源、层号约定）、`bond_graph`、`find_adsorbates`、`promote_adsorbates`、`mark_adsorbates`、约束方法（`fix`、`free`、`fix_layers`、`fix_height`、`set_tags_from_layers`）、REST `/analysis/layers`、客户端 `layers`、CLI `crystallume layers`、`crystallume edit fix/free`（`--atoms SPEC` 写法 `0-35,40`）；`docs/SCHEMA.md`：约束规则（True = 可动，C3）、`axis_labels` 的 x/y/z 规则、`tags`/`adsorbate_id` 约定；`docs/DEPLOY.md`：REST 表一行。

【U 与负责人决定】U1；负责人决定 L-10（`--atoms SPEC` 的写法）。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`。

【测试】文档例子逐个运行，结果写进报告。

#### M1-T9 M1 的 Playwright 冒烟测试（链 `w1-e2e-cell`）

【目标】M1 网页的端到端冒烟测试（Node 版 Playwright，由 pytest 包装，`slow`）。

【依据】M1 §7.3 第 1–7 条；acceptance §3.2（运行方式：`tests/e2e/*.spec.mjs`、共用 `tests/e2e/harness.mjs`、`tests/test_e2e.py` 包装、静态版 `http.server`、`CRYSTALLUME_E2E_URL`、`chromium.launch({ headless: true, args: ['--no-sandbox', …] })`、视口 1280×800、收集 `pageerror` 与 `console.error`、等待 `document.body.dataset.ready === 'true'`、截图到 `tests/e2e/out/`）；负责人决定 L-06（Node 版 Playwright；各模块 §5 控件表里的 `aria-label` 是选择器的唯一来源）；L-16、L-19。

【实现】`tests/e2e/cell_tools.spec.mjs`：1）4 层 Pt(111) 夹具 → Supercell › Presets `(√3×√3)R30°` → 虚线晶胞 → Create → 12 原子、名字更新、toast 的 Undo 恢复 4 原子；2）状态模型（矩阵输入 → 选原子 → 切换显示样式 → 输入与预览仍在）；3）Lattice parameters 改 c（Keep 开）高度不变、γ = 190 报错且 Apply 不可用；4）Strain Biaxial +2 % → 导出 POSCAR 的 a +2 %、c 不变；5）CONTCAR 夹具 → Supercell 2×2×1 → 导出 POSCAR 的 SD 行正确、slab 仍一块；6）1 万原子 Primitive cell：进度条出现、主线程不冻结（期间 `page.mouse` 拖动视图有响应）、可取消；7）命令面板搜 `Redefine Lattice`、`Lattice Parameters`、`Conventional Cell` 命中别名。harness 与包装由 `w1-e2e-surface` 链维护，本链不改；需要 harness 新功能时在报告里写明。

【U 与负责人决定】U1、U4-a；负责人决定 L-06、L-16、L-19。

【文件】`tests/e2e/cell_tools.spec.mjs`。

【测试】`$DEVPY -m pytest -m slow tests/test_e2e.py -k cell_tools` 通过，截图交审查。

【界面检查】（Chromium，本链端口）同上各步骤的截图存 `tests/e2e/out/cell_tools-*.png`。

#### M2-T12 M2 的 Playwright 冒烟测试与第 1 波验收子集（链 `w1-e2e-surface`）

【目标】M2 的端到端冒烟测试，以及第 1 波已能运行的验收 E2E 子集；维护共用的 harness 与 pytest 包装。

【依据】M2 §7.4 第 1–5 条；acceptance §3.2（E2E-1 第 1–7 步；E2E-3 第 1–3、6–8 步；E2E-4 第 1–3 步）；负责人决定 L-06、L-16（E2E-4 第 3 步改为 Slab 分区内嵌的超胞编辑器，不再"跳到 Structure › Cell"）、L-19；plan.md P-14、P-16。

【实现】

- harness 与包装：若 W0 的 w0-a-t12 已建立 `tests/e2e/harness.mjs` 与 `tests/test_e2e.py`，确认包装会自动收集 `tests/e2e/*.spec.mjs`（逐个 `node tests/e2e/<name>.spec.mjs`、断言退出码 0；找不到 Node/Playwright/Chromium 时跳过，`CRYSTALLUME_REQUIRE_E2E=1` 时失败）；没有就按 acceptance §3.2 建立；只做必要的修改。

- `tests/e2e/surface.spec.mjs`：M2 §7.4 第 1–5 条（Create 在填真空前不可用 → 15 → Create → POSCAR 含 `Selective dynamics`、36 原子、18 行 `F F F`、项目 2 个结构、Undo 只删 slab；SrTiO3 TiO2 对称 → `excess TiO2` → 名称 `SrTiO3(001) TiO2-term 7L`；CONTCAR 夹具 → 底层画在底部（截图）→ Slab 真空框为空、信息行有当前间隙 → 20 → Apply → c = 厚度 + 20、SD 不变、pbc T T T；MP 风格 Pt 原胞 POSCAR → 惯用胞提示 → Conventional cell → (1 0 0) → 方形网格；Planes 叠加层可见，Preview 切到 Slab 再切回后体相与相机恢复、无撤销条目）。

- `tests/e2e/w1_acceptance.spec.mjs`：E2E-1 第 1–7 步，导出断言改为切面后的 slab（36 行、18 个 `F F F`，extxyz 含 `move_mask:L:1`、不含 `selective_dynamics`）；E2E-3 第 1–3、6–8 步（第 4 步 Layers 与第 5 步 Both sides 分别在 W2、W3 补）；E2E-4 第 1–3 步（L-16 改写）。

【U 与负责人决定】U1-a/U1-c、U2、U4-a/U4-b；负责人决定 L-06、L-16、L-19。

【文件】`tests/e2e/harness.mjs`、`tests/test_e2e.py`（仅必要修改）、`tests/e2e/surface.spec.mjs`、`tests/e2e/w1_acceptance.spec.mjs`。

【测试】`$DEVPY -m pytest -m slow tests/test_e2e.py` 全部通过；截图在 `tests/e2e/out/`。

【界面检查】（Chromium，本链端口）同上，截图交审查。

#### M1-T11 M1 性能预算测试与 JS 性能测试的运行器（链 `w1-perf`）

【目标】M1 的性能预算测试（原胞搜索为主），并建立全仓库共用的 JS 性能测试运行器。

【依据】M1 §3.12.3、§3.16、§7.4（预算表；CI 允许 ×3）；plan.md P-10（JS 性能测试放 `tests/js/perf/*.perf.mjs`，由 `tests/test_js_perf.py`（`slow`）运行，不进默认的 `tests/js/*.test.mjs` 收集；Python 性能测试一律用 `slow` 标记，不新增 `perf` 标记）。

【实现】`tests/test_js_perf.py`（`slow`；收集 `tests/js/perf/*.perf.mjs` 并经 `run_node_tests` 运行）；`tests/js/perf/translations.perf.mjs`（216 原子 < 5 ms、1 万原子 < 150 ms、5 万原子 < 1 s 分块且每段 ≤ 16 ms、缺陷在末尾的 1 万原子用例）；`tests/test_translations_perf.py`（`slow`；面内 216 原子 < 30 ms、1 万 < 0.5 s、5 万 < 3 s；三轴 `axes="all"` 1 万 < 2 s）；超预算时只在 `analysis/translations.py`/`core/translations.js` 内优化（预筛、分箱），不改接口。

【U 与负责人决定】无直接相关的 U 项与负责人决定（只测性能）。

【文件】`tests/test_translations_perf.py`、`tests/js/perf/translations.perf.mjs`、`tests/test_js_perf.py`、`crystallume/analysis/translations.py`、`crystallume/web/js/core/translations.js`。

【测试】`$DEVPY -m pytest -m slow tests/test_translations_perf.py tests/test_js_perf.py` 通过；实测数字写进报告。

#### W1-X1 第 1 波跨模块回归测试（M1 × M2 × M3）（链 `w1-xmodule`）

【目标】把第 1 波三个模块之间的接缝用测试钉住：切面记录、超胞、改真空、翻转、层分析与约束连在一起时的数据与名字。

【依据】ledger-features L-X-01、L-X-02、L-X-06（后续操作对数据的影响总表）、L-X-07（名字的例子）、L-M1-07（`reference_mesh` 的 record 来源）、L-M2-03/04；acceptance C-6、S2-3、S3-2、S11-6、S12-4、S12-5、S13-1、S13-2、S14-3；负责人决定 L-12、L-19。

【实现】`tests/test_w1_crossmodule.py` 与 `tests/js/w1_crossmodule.test.mjs`（同一组场景两语言）：切面得到的 slab 上 `reference_mesh` 来自 record 且 K = 面内超胞块；`Pt(111) 4L` → √3 → `Pt(111) (√3×√3)R30° 4L`，p(3×3) 后求原胞回到 `Pt(111) 4L`；超胞后 `set_vacuum` 保留 `supercellMatrix`；`flip_slab` 后超胞记录与 1×1 网格夹角 120°；`set_vacuum` 在无块结构上建 `kind: "vacuum"` 块且不改名、`CONTCAR` 仍是 `CONTCAR`；石墨烯改真空后 √3 超胞按 M1 的通用规则改名（S13-2）；全部切面金标满足 `find_layers(slab).from_top + 1 == tags`（C-6）；`fix_layers` 在切面 slab 上的设定语义；Strain（keep_vacuum auto）在 slab 上保持真空宽度。

【U 与负责人决定】U1、U2、U4；负责人决定 L-12、L-19。

【文件】`tests/test_w1_crossmodule.py`、`tests/js/w1_crossmodule.test.mjs`。

【测试】即上。发现缺陷时不在本链修源码：写成 `xfail(strict=True, reason="<模块>: <问题>")` 并在报告里交负责人安排修复。

## 4. 第 2 波：M3 其余部分（Layers 分区、几何选择、Atom Selection、约束界面与标记）+ M4 原子操作

### W2.1

M3 暴露原子；M4 几何核心、片段与编辑坐标系、移动工具的交互数学、测试夹具，彼此不共享文件。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w2-m3-surface-atoms` | — | M3-T3b 暴露原子 surface_atoms（双语言）并补全 layers 的 surface 选项 | `crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`tests/test_surface_atoms.py`、`tests/js/surface_atoms.test.mjs`、`tests/ops/m3_surface.py`、`tests/js/ops/m3_surface.mjs`、`tests/data/surface/layers/`、`tests/test_m3_parity.py`、`crystallume/server/routes/analysis.py`、`crystallume/cli.py`、`tests/test_server.py`、`tests/test_cli.py` |
| `w2-m4-geometry` | — | M4-T1 几何核心：平移、旋转、镜像、移到、质心（双语言）与 M4 的常量 | `crystallume/analysis/geometry.py`、`crystallume/web/js/core/geometry.js`、`crystallume/core/structure.py#M4-geometry`、`crystallume/web/js/core/structure.js#M4-geometry`、`crystallume/core/defaults.py#M4`、`crystallume/web/js/core/defaults.js#M4`、`tests/test_manipulate.py`、`tests/js/manipulate.test.mjs` |
| `w2-m4-fragments` | — | M4-T2 编辑坐标系、基底与分子、moving_group、unwrap_group（双语言） | `crystallume/analysis/fragments.py`、`crystallume/web/js/core/fragments.js`、`crystallume/analysis/__init__.py#M4`、`tests/test_fragments.py`、`tests/js/fragments.test.mjs` |
| `w2-m4-movemath` | — | M4-T5a 移动工具的交互数学（纯函数） | `crystallume/web/js/render/tools/movemath.js`、`tests/js/movemath.test.mjs` |
| `w2-m4-fixtures` | — | M4-T9a M4 的测试夹具与 ASE 参考数据 | `scripts/dev/make_ase_reference.py`、`tests/data/manipulate/`、`tests/test_manipulate_golden_shape.py` |

**合并顺序**：`w2-m3-surface-atoms` → `w2-m4-geometry` → `w2-m4-fragments` → `w2-m4-movemath` → `w2-m4-fixtures`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M3-T3b：`tests/test_surface_atoms.py`、`tests/js/surface_atoms.test.mjs` 通过；`tests/data/surface/layers/` 的 surfaceAtoms 用例启用并两语言相同（`tests/test_m3_parity.py`）；κ* 与晶格常数无关（atol 1e-6）；`/analysis/layers` 的 `surface: true` 与 `crystallume layers --surface` 正式可用
- M4-T1：`tests/test_manipulate.py`、`tests/js/manipulate.test.mjs` 通过（`rotate('x', 'y')` 把 (1,0,0) 变为 (0,1,0)；`rotate(90, 'z', 'COM', True)` 按 ASE 解释为 `rotate_cell=True`；部分原子平移清除 `info.spacegroup`，整体平移保留，C7）
- M4-T2：`tests/test_fragments.py`、`tests/js/fragments.test.mjs` 通过；`edit_frame` 与显示同一切口（`display_cuts`，U1）；`bond_graph` 与显示设置无关（D1/E2）
- M4-T5a：`tests/js/movemath.test.mjs` 通过（表面平面内拖动高度不变、侧对退回屏幕平面、六方逆变分量取整）
- M4-T9a：`tests/data/manipulate/` 外壳正确、全部带理由 skip；`ase_reference.json` 注明 ASE 3.29

#### M3-T3b 暴露原子 surface_atoms（双语言）并补全 layers 的 surface 选项（链 `w2-m3-surface-atoms`）

【目标】双语言暴露原子 `surface_atoms`（闭式判据、二维网格、`details`），并把 W1.4 暂时返回 400 的 REST `surface: true` 与 CLI `crystallume layers --surface` 改成正式行为。

【依据】M3 §3.9、§3.16、§6.3（`surface` 与 `probe` 字段）、§6.5（`--surface`、`--probe K`）、§7.1（暴露度金属系列、Pt(211) 台阶边、TiO2/ZnO 位移等）；ledger-features L-M3-05（`surface_atoms(structure, side="top", *, probe=None, direction=None, tolerance=None, skip_adsorbates=True, details=False)`）、R-F06（*surface atoms* 只指暴露原子；M5 的叫 *site atoms*）、L-M3-10；ledger-F0 L-F0-17（没有间隙时报 `vacuum_gap_hint`）；M3 的 `surface_probe`、`surface_borderline` 键已在 W1.2 加入（L-X-08）。

【实现】`analysis/layers.py` 与 `web/js/core/layers.js` 追加 `surface_atoms`/`surfaceAtoms`；注册 op `surfaceAtoms`（`tests/ops/m3_surface.py`、`tests/js/ops/m3_surface.mjs`），去掉 `tests/data/surface/layers/` 中该 op 的 skip，在 `tests/test_m3_parity.py` 追加暴露原子与 κ* 的比较；REST `/analysis/layers` 的 `surface: true` 返回两侧暴露原子（`surfaceAtoms: {top, bottom, radius, probe, borderline}`），`_guard_work`；CLI `layers --surface` 追加暴露原子输出。

【U 与负责人决定】U1（暴露原子用与显示同一切口；没有间隙时只给说明）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/layers.py`、`crystallume/web/js/core/layers.js`、`tests/test_surface_atoms.py`、`tests/js/surface_atoms.test.mjs`、`tests/ops/m3_surface.py`、`tests/js/ops/m3_surface.mjs`、`tests/data/surface/layers/`（只改 skip）、`tests/test_m3_parity.py`、`crystallume/server/routes/analysis.py`、`crystallume/cli.py`、`tests/test_server.py`、`tests/test_cli.py`（本批次只有本链改这四个 API 文件）。

【测试】M3 §7.2 暴露原子一条（闭式与逐原子模拟一致：随机 slab 上与暴力下落比较；`side='bottom'/'both'`；体相报错；1×1 Ru 的面内像；`details` 的 κ* 与 borderline）；§7.1 的暴露度金属系列（fcc(211)/(100)/(110)/(111) 取 Ni/Cu/Rh/Pd/Pt/Au/Ag；bcc(100)/(110)/(111) 取 Fe/Mo/W；κ* = 2/√3 − 1、√2 − 1、1、√3 − 1、2 等）；REST `surface: true` 200、体相 + `surface` 400；CLI `layers --surface`。

#### M4-T1 几何核心：平移、旋转、镜像、移到、质心（双语言）与 M4 的常量（链 `w2-m4-geometry`）

【目标】双语言的刚体编辑方法与几何辅助函数，并一次加入 M4 的全部 `SURFACE_DEFAULTS` 键（plan.md P-07）。

【依据】M4 §3.1、§3.7（含 §3.7.6 旋转周期网络与不带晶胞旋转时删除 `info.surface.normal` 的规则）、§3.14、§6.1–6.3；ledger-features L-M4-01（`translate(vector, *, indices=None, frac=False)`、`move_to(position, *, indices=None, anchor="centroid", frac=False, mic=True)`、`rotate(a, v, center=(0, 0, 0), rotate_cell=False, *, indices=None, mic=False)`（ASE 形式）、`mirror`、`get_centroid(indices=None, *, mic=False, weights=None)`、`get_distance/get_angle/get_dihedral(..., *, images=None)`；移动部分原子 `set_positions(..., mark="positions")`；多帧时 `rotate`、`mirror`、`move_to` 报单帧句式，`translate` 保持所有帧）、L-M4-03（`rotation_matrix(axis, angle)` 右手 Rodrigues、`align_rotation(src, dst)`；`p' = R @ p`、`P' = P @ R.T`；轴长 < 1e-12 报错）、L-X-08 M4 行（**[改]** `site_contact_tol` → `place_contact_tol`；`bond_*` 用 M3 的，`mic_tie` 用 F0 的）、§10.4；ledger-F0 §6 M4 第 1、4、5 条（`mic_vector` 是 F0-D T9 的，本任务不实现；`keep_frame(index=0)` 已提供）；V-F13；C7；plan.md P-08（`edit_frame` 移到 M4-T2，`add_atom`/`extend` 移到 M4-T4）。

【实现】`analysis/geometry.py` 与 `web/js/core/geometry.js` 追加 `rotation_matrix`、`align_rotation`；Structure 方法放 `core/structure.py`、`web/js/core/structure.js` 的段 `M4-geometry`；JS 的 `getDistance/getAngle/getDihedral` 支持 `images`；defaults 段 `M4`。

【U 与负责人决定】U1（表面法向来自真空间隙，不按 slab 分类）、U5/D7（二面角符号已在第 0 波修好）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/geometry.py`、`crystallume/web/js/core/geometry.js`、`crystallume/core/structure.py#M4-geometry`、`crystallume/web/js/core/structure.js#M4-geometry`、`crystallume/core/defaults.py#M4`、`crystallume/web/js/core/defaults.js#M4`、`tests/test_manipulate.py`、`tests/js/manipulate.test.mjs`。

【测试】M4 §7.1 第 3、4 条（`translate` 的子集、`frac=True`、全帧与 C7；`rotate(90, 'z')` 与 `rotate('z', 90)`；`rotate('x', 'y')` 把 (1,0,0) 变为 (0,1,0)；反平行的确定性轴；`center` 各形式；`axis='a'`、`'normal'`；`rotate(90, 'z', 'COM', True)` 为 `rotate_cell=True`，晶胞与 `info.surface.normal` 一起旋转、约束不变；`indices` 与 `rotate_cell` 同给报错；多帧抛错；旋转全部原子而不转晶胞时删除 `info.surface.normal` 并警告）；M4 键两语言逐键相等。

#### M4-T2 编辑坐标系、基底与分子、moving_group、unwrap_group（双语言）（链 `w2-m4-fragments`）

【目标】双语言的编辑坐标系与片段函数：`edit_frame`、`vacuum_aware_vector`、`substrate_mask`、`molecule_of`、`moving_group` v2、`unwrap_group` v2（含向量化快速路径）、`component`、`chain_images`。

【依据】M4 §3.2（编辑坐标系）、§3.3、§3.4–3.6、§3.7.1、§3.14；ledger-features L-M4-04（提供方 M4 T2–T4；**[改]** `fragments` 里不定义 `BondGraph`/`bond_graph`，用 M3 的 `bond_graph(metal_pairs="all")`（L-M3-03）；`METALS` 从 `core/elements` 导入；`edit_frame(s)`：`cuts = display_cuts(s)`，有切口的轴 `shift_i,k = −floor(f_i,k − cuts[k].lo)`、不取最小像，其余周期轴为 `mic_axes`；`substrate_mask` 以 M3 `find_adsorbates` 为第一来源；`moving_group` 基底优先，约束不决定移动哪一侧）、§10.4 第 3 条；ledger-F0 §6 M4 第 2 条（与显示逐字同一切口，U1）、L-F0-20（`mic_vector`）；plan.md P-08（`edit_frame` 从 M4 §9 的 T1 移到这里）。

【实现】新文件 `crystallume/analysis/fragments.py` 与 `web/js/core/fragments.js`；若按 M4 §6.2 需要从 `crystallume.analysis` 导出，放 `analysis/__init__.py` 的段 `M4`。

【U 与负责人决定】U1（编辑坐标系与显示同一切口）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/fragments.py`、`crystallume/web/js/core/fragments.js`、`crystallume/analysis/__init__.py#M4`、`tests/test_fragments.py`、`tests/js/fragments.test.mjs`。

【测试】M4 §7.1 第 2 条（CONTCAR 底层 f = 0.99995 → 编辑坐标 −0.001 Å；跨 c 边界；盒中分子；体相）、第 8–11 条（`bond_graph` 与显示设置无关；`substrate_mask` 五种来源；`moving_group` 的 §3.6.5 表 21 个场景（读 `tests/data/manipulate/moving_group.json` 若 M4-T9a 已合入，否则在测试里内联同一表）；`unwrap_group` 恢复键长、SrTiO3 7L 与 Pt(111) p(6×6) 6L/10 Å、8L/15 Å 展开后 z 范围等于存储坐标、> 5000 原子快速路径与 BFS 结果相同）；M4 §7.2 第 9 条的纯逻辑部分（双击 O 选中 {C, O} 的 `moleculeOf`）。

#### M4-T5a 移动工具的交互数学（纯函数）（链 `w2-m4-movemath`）

【目标】移动工具的交互数学：纯函数模块 `render/tools/movemath.js`，不依赖 DOM 与 three.js 场景（从 M4-T5 拆出，供 W2.2 的移动工具使用）。

【依据】M4 §3.11（轴拖动、平面拖动、表面平面内直接拖动保持高度、侧对时退回屏幕平面、环旋转与跨 ±180° 累加、视线与轴平行时返回 null、Lattice 框架下逆变分量取整与精细增量）、§5.1（修饰键：Shift 精细、Ctrl/⌘ 取整）、§7.2 第 1、2 条；ledger-F0 L-F0-40（`ray`、`pointOnPlane`、`pointOnLine`、`worldPerPixel` 的语义，本模块只接收它们算好的射线与比例）。

【实现】`web/js/render/tools/movemath.js`：拖动增量、旋转角、取整与吸附、手柄的屏幕空间命中测试（给定投影函数，箭头/方块/环/中心的命中与优先级、侧对时隐藏）。

【U 与负责人决定】U1（表面平面 = 有真空间隙时的表面）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/render/tools/movemath.js`、`tests/js/movemath.test.mjs`。

【测试】M4 §7.2 第 1、2 条全部：轴拖动 1.5 Å、偏离轴的指针、平面拖动、视线与法向成 30°/60° 时表面平面内拖动高度不变、侧对退回屏幕平面、环 30°、跨 ±180° 累加、平行时 null、六方 Lattice 框架的逆变分量取整与精细增量；命中优先级。

#### M4-T9a M4 的测试夹具与 ASE 参考数据（链 `w2-m4-fixtures`）

【目标】M4 的跨语言夹具与 ASE 参考数据（从 M4-T9 拆出的"夹具先行"部分）。

【依据】M4 §7（所有夹具用 pbc T T T 的 slab，另含 pbc T T F 的石墨烯与无晶胞分子各一组）、§7.1 第 5 条（`set_distance` 与 ASE 一致的 8 个组合；参考值由 `scripts/dev/make_ase_reference.py` 生成并固化在 `tests/data/manipulate/ase_reference.json`，注明 ASE 3.29）、§3.6.5（`moving_group` 的 21 个场景）、§7.3（夹具字段）；ledger-F0 L-F0-27（`crystallume.cases/1`、配方）；P2（运行时不依赖 ASE）。

【实现】`scripts/dev/make_ase_reference.py`（只在 ASE 参考环境 `scratchpad/proto/m1/refvenv/bin/python` 下运行，不进 CI、不进包）→ `tests/data/manipulate/ase_reference.json`；`tests/data/manipulate/moving_group.json`（21 个场景：C 为 `F F T`、整只 CO 冻结、Pt4/MgO 有无 tags、反序吸附原子、晶格内键、苯环 `ring` 等）；其余夹具 `tests/data/manipulate/*.json`（`crystallume.cases/1`；ops `editFrame`、`translate`、`rotate`、`setDistance`、`setAngle`、`setDihedral`、`movingGroup`、`unwrapGroup`、`sitePoint`、`addAtom`、`extend`、`bondGraph`、`parseElement`），全部带 skip：`op <name> is registered by M4-T9b (W2.3)`。

【U 与负责人决定】U2（夹具 pbc T T T）；负责人决定：无直接相关项。

【文件】`scripts/dev/make_ase_reference.py`、`tests/data/manipulate/`、`tests/test_manipulate_golden_shape.py`。

【测试】外壳格式测试；全部用例按 skip 处理、不失败。

### W2.2

M3 选择与查询引擎；M4 设定几何、放置核心（含 add_atom/extend）与移动工具。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w2-m3-selection` | — | M3-T5 几何选择与查询引擎（双语言） | `crystallume/analysis/selection.py`、`crystallume/web/js/core/selection.js`、`crystallume/analysis/__init__.py#M3`、`tests/test_selection.py`、`tests/js/selection.test.mjs`、`tests/ops/m3_selection.py`、`tests/js/ops/m3_selection.mjs`、`tests/data/surface/selection/`、`tests/test_m3_parity.py` |
| `w2-m4-setgeometry` | — | M4-T3 设定距离、角度、二面角（双语言，ASE 语义 + GUI 语义） | `crystallume/core/structure.py#M4-geometry`、`crystallume/web/js/core/structure.js#M4-geometry`、`tests/test_set_geometry.py`、`tests/js/set_geometry.test.mjs` |
| `w2-m4-placement` | — | M4-T4 放置核心：site_point、add_atom、extend 的放置参数（双语言） | `crystallume/analysis/placement.py`、`crystallume/web/js/core/placement.js`、`crystallume/core/structure.py#M4-placement`、`crystallume/web/js/core/structure.js#M4-placement`、`tests/test_placement.py`、`tests/js/placement.test.mjs` |
| `w2-m4-movetool` | 8829 | M4-T5b 移动工具（手柄、HUD、表面平面拖动、吸附目标） | `crystallume/web/js/render/tools/move.js`、`crystallume/web/js/ui/icons.js#M4`、`crystallume/web/css/app.css#M4-move`、`crystallume/web/js/main.js#M4-move`、`tests/js/movetool.test.mjs` |

**合并顺序**：`w2-m3-selection` → `w2-m4-setgeometry` → `w2-m4-placement` → `w2-m4-movetool`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M3-T5：`tests/test_selection.py`、`tests/js/selection.test.mjs` 通过；`QUERY_PROPS` 与选择结果两语言相同（`tests/test_m3_parity.py`）；验收 S8-8（配位数查询：空位前 2、空位后 4，smart 规则不计 Ti–Ti）
- M4-T3：`tests/test_set_geometry.py` 与 ASE 参考逐项一致（`fix`、`mask`、`indices`、`add`、`factor`、`mic` 的 8 个组合）；二面角符号符合 IUPAC（D7）
- M4-T4：`tests/test_placement.py`、`tests/js/placement.test.mjs` 通过；`add_atom(adsorbate=True)` 先 promote 再写新 id（R-ADS，L-X-05）；默认键长读数 `(covalent radii)`（L-05 的 M5 一支在 W3.2 接上）
- M4-T5b：`tests/js/movetool.test.mjs` 通过（工具契约：按在未选原子上不认领、按下不动即松开按点击处理、Esc 取消且不清选区）
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`；按 G 进入移动工具，拖动后撤销按钮显示 `Undo Move 2 atoms`

#### M3-T5 几何选择与查询引擎（双语言）（链 `w2-m3-selection`）

【目标】双语言的几何选择函数与 Atom Selection 的查询引擎（查询 JSON、解析、求值与组合模式）。

【依据】M3 §3.10、§3.11（3.11.1 查询 JSON：Python、JS、REST、`crystallume.selectWhere` 共用，写进 `docs/SCHEMA.md`；3.11.2 `combine_selection(current, matches, mode)` 的五种模式）、§3.16；ledger-features L-M3-06（`select_height`、`select_fractional`、`select_within`、`select_where`；`select_layers` 已在 W1.2）；ledger-F0 §6 M3 第 7 条（球形选择与 `distance` 查询用 F0-D T9 的 `mic_vector`）；`QUERY_PROPS` 两语言相同；`cn` 用 M3 `coordination_numbers(metal_pairs="smart")`；`surface` 用 M3-T3b 的 `surface_atoms`。注意：§3.6 的单元分组已在 W1.2 随 `find_layers` 交付（plan.md 对 M3 §9 的调整）。

【实现】新文件 `crystallume/analysis/selection.py` 与 `web/js/core/selection.js`（`QUERY_PROPS`、`parse_query`、各属性与运算符、all/any、`version`、`layers`/`bonds` 字段、报错文案）；`analysis/__init__.py` 段 `M3` 导出；查询金标 `tests/data/surface/selection/*.json`（`crystallume.cases/1`，op `selectWhere`）与两语言 op 文件；在 `tests/test_m3_parity.py` 追加选择结果与 `QUERY_PROPS` 的比较。

【U 与负责人决定】U1（`surface` 条件用暴露原子，不判断 slab）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/selection.py`、`crystallume/web/js/core/selection.js`、`crystallume/analysis/__init__.py#M3`、`tests/test_selection.py`、`tests/js/selection.test.mjs`、`tests/ops/m3_selection.py`、`tests/js/ops/m3_selection.mjs`、`tests/data/surface/selection/`、`tests/test_m3_parity.py`。

【测试】M3 §7.2 的选择函数（环绕分数区间、非周期轴报错、球形选择跨边界与斜晶胞（三斜胞里与暴力枚举 ±3 像比较）、中心原子包含在内、`centroid`）与查询（每个属性与运算符、all/any、五种模式、空条件、`version`、报错文案、1e-5 Å 的边界：保存再打开结果不变）；acceptance S8-8。

#### M4-T3 设定距离、角度、二面角（双语言，ASE 语义 + GUI 语义）（链 `w2-m4-setgeometry`）

【目标】双语言的设定几何：`set_distance`、`set_angle`、`set_dihedral`、`rotate_dihedral`（ASE 语义 + `mic`/`images`/`move`/`toward`），`get_*` 的 `images`；（应该）`get/set_tilt`、`get/set_azimuth`。

【依据】M4 §3.8、§3.14；ledger-features L-M4-01（签名原文：`set_distance(a0, a1, distance, fix=0.5, mic=False, mask=None, indices=None, add=False, factor=False, *, move=None, images=None)`、`set_angle(a1, a2, a3, angle, mask=None, indices=None, add=False, *, mic=False, images=None, move=None, toward=None)`、`set_dihedral(...)`；`move=` 给出时用 GUI 语义的编辑坐标系 `edit_frame`（M4-T2）与 `moving_group`；`mic=True` 为所有周期轴上的精确最小像，L-F0-20）；ledger-F0 L-F0-21（二面角 IUPAC 符号，D7）。

【实现】Structure 方法放 `core/structure.py`、`web/js/core/structure.js` 的段 `M4-geometry`（与 M4-T1 同段，W2.1 已合入）。

【U 与负责人决定】U5/D7（IUPAC 二面角符号）；负责人决定：无直接相关项。

【文件】`crystallume/core/structure.py#M4-geometry`、`crystallume/web/js/core/structure.js#M4-geometry`、`tests/test_set_geometry.py`、`tests/js/set_geometry.test.mjs`。

【测试】M4 §7.1 第 5–7 条：与 `tests/data/manipulate/ase_reference.json` 完全一致（`fix` 0/0.5/1、`mask`、`indices`、`add`、`factor`、`mic` 的 8 个组合）；`set_angle`、`set_dihedral` 与 ASE 对照；二面角符号（5 组随机点）；`add=True`；共线报错；`mask` 与 `indices` 同给报错；共线起点的 `toward`（180° → 150° 朝 +a）；跨面的 `images`（CO 跨 a 面，角设到 150°/170° 后 C–O 保持 1.1500 Å、O 的存储像不变；`set_dihedral` 后键长变化 < 1e-12 Å）。

#### M4-T4 放置核心：site_point、add_atom、extend 的放置参数（双语言）（链 `w2-m4-placement`）

【目标】双语言的放置核心：`site_point`、`surface_side`、`anchor_point`、`orient_rotation`、`parse_element`，以及 `add_atom`/`addAtom` 与 `extend` 的仅限关键字放置参数。

【依据】M4 §3.9（接触抬升闭式解 `t* = max_j [h_j + sqrt(d² − ρ_j²)]`）、§3.10.5 的数据规则、§6.1–6.3；ledger-features L-M4-02（`add_atom(self, symbol, position, props=None, *, frac=False, adsorbate=False) -> int`；`extend(other, *, offset, rotation, center, position, anchor="centroid", normal, orient, mic, frame, adsorbate, keep_props=True, renumber_adsorbates=True)`；**[改]** `adsorbate=True` 遵守 R-ADS：`tags_convention == "oc20"` 时新原子 `tags = 2` 否则 0；编辑前按元素分块时插入后 `sort_by_species()`；每个载荷成键片段一个新 id（从 `next_adsorbate_id` 起）；先 `promote_adsorbates`；`other` 的约束在晶胞不同时经 `apply_basis_change` 换算）、L-M4-05（`site_point(structure, atoms, *, images=None, bond=None, height=None, side="auto", symbol=None) -> SitePoint`；默认键长：本任务只实现共价半径一支 `d = place_bond_factor·(r_cov(X) + r_cov(M))`，读数 `bond 1.98 Å (covalent radii)`；吸附物库一支（负责人决定 L-05）由 M5-T5 在 W3.2 接上；找不到可接触的原子时回退 `add_height`）、L-X-05、R-F10、R-F11（M5 不经 `extend(adsorbate=True)` 插入）、§10.4 第 1、2 条；负责人决定 L-05、L-15（规格里写死的键长数字只作示例，测试按式子现算）；ledger-F0 L-F0-07（F0-D 的 `extend` 与 JS `extend`）、L-F0-14；plan.md P-08。

【实现】新文件 `crystallume/analysis/placement.py` 与 `web/js/core/placement.js`；`add_atom`、`extend` 的放置参数放 `core/structure.py`、`web/js/core/structure.js` 的段 `M4-placement`（不改 F0-D 已冻结的前几个参数）。

【U 与负责人决定】U5（D2：原位修改）；负责人决定 L-05（默认键长的两支；本任务做共价半径一支）、L-15。

【文件】`crystallume/analysis/placement.py`、`crystallume/web/js/core/placement.js`、`crystallume/core/structure.py#M4-placement`、`crystallume/web/js/core/structure.js#M4-placement`、`tests/test_placement.py`、`tests/js/placement.test.mjs`。

【测试】M4 §7.1 第 12–14 条：`site_point` 的 §3.9.3 表全部行（顶/桥/hcp/fcc、O/H/C/N 的共价半径默认键长、底面、CONTCAR、Pt(211) 三排；Cu(100) c(2×2) 的显式像得到四重空位；找不到接触原子时带 `fallback`；单层石墨烯默认 `top`）；`add_atom` 返回下标、SD 存在时新原子 [T,T,T]、tags 0、occupancy 1.0、不存在的键不被创建、`frac=True`、`parse_element` 的 11 个输入、`adsorbate=True` 先 promote 再写 id、导出 POSCAR 带 SD；`extend` 的 `position` + `anchor`（binding/contact/bottom）、`orient`（binding_down、flat：NH3 的 N 在下、苯平躺）、`rotation`、`offset`、props 并集、`adsorbate=True` 重置 SD/tags 并写 id、`adsorbate=False` 时 id 按 M5 规则重编号与记录复制、不同晶胞的约束换算、`frame=`。

#### M4-T5b 移动工具（手柄、HUD、表面平面拖动、吸附目标）（链 `w2-m4-movetool`）

【目标】工具栏的 Move 工具（G）：B 层手柄、屏幕空间拾取、表面平面拖动、取整与吸附、触屏与笔、HUD 与提示栏，以及供 M5 使用的吸附目标接口。

【依据】M4 §3.11、§5.1（工具栏、HUD、修饰键表、提示栏、快捷键对话框 Mouse 行）、§5.5（撤销标签 `Move N atoms`/`Rotate N atoms`，拖动不发 toast）、§5.6、§5.8、§5.9（手柄 B 层、字母 C 层、`never` 导出；`m4-moving` 高亮 `{light: '#d9822b', dark: '#ffb366'}`）；ledger-features L-M4-07（`tools.register({ id: 'move', key: 'G', toolbar: true, selects: true, cursor: 'grab', touch: 'claim', … })`；吸附目标 `registerSnapTargets(provider: (structure) → [{ position: [x, y, z], label }]) → unregister`，从 `render/tools/move.js` 导出并经 `crystallume.tools.get('move')` 暴露，移动工具在 12 px 内吸附）；ledger-F0 L-F0-35（拖动会话 `beginStructureEdit(…, {kind: 'positions', transient: true})`、P-pos 提交 `singleFrame`）、L-F0-38/40/41（叠加层、`pick`/`pointOnLine`/`pointOnPlane`/`worldPerPixel`、工具注册表与延迟认领、`hover(hit, e)`、`begin()`）、L-F0-43/44（`homeOffsets(structure, display, {cuts})`、测量引用 v2）、§6 M4 第 3 条（`banner` → `transient`；`selectFallback` 删除）；M4-T5a 的 `movemath.js`、M4-T2 的 `unwrapGroup`/`movingGroup`；U1（表面平面 = 有真空间隙时的表面，不按 slab 分类）。

【实现】新文件 `web/js/render/tools/move.js`；图标 `move`、`paste` 放 `ui/icons.js` 的段 `M4`；样式放 `css/app.css` 段 `M4-move`；`main.js` 段 `M4-move` 导入。

【U 与负责人决定】U1、U5（工具栏 Move 工具，D1）、P3（拖动一次一步撤销）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/render/tools/move.js`、`crystallume/web/js/ui/icons.js#M4`、`crystallume/web/css/app.css#M4-move`、`crystallume/web/js/main.js#M4-move`、`tests/js/movetool.test.mjs`。

【测试】M4 §7.2 第 3、4 条：工具契约（按在未选原子上 `down` 返回 false → 框选；按在已选原子上不动就松开 → `up` 返回 false 按点击处理；Shift/⌘ 在按下与拖动中的含义；第二根手指取消；Esc 取消且不清选区）；测量键的三个场景（底层原子跨 f = 1；原子跨 a 面；CO 拖进真空使切口移动：键改指存储像、测量保留不画），与 F0-A `homeOffsets` 一起测。

【界面检查】（Chromium，本链端口）载入 Pt(111) p(3×3) 4L + 顶位 CO 的 JSON 夹具（M4-T9a 的夹具或手工生成）：选中 C、O → 按 G → 工具栏 Move 按下、HUD `Move · 2 atoms` 与提示栏文案出现；拖 CO 100 px → 松开：撤销按钮 `Undo Move 2 atoms`，C 的高度不变（表面内拖动）、C–O 不变；Ctrl/⌘+Z 恢复坐标到 1e-6 Å；拖动中按 Esc：坐标与撤销栈不变、选区仍在；移动工具里点击未选原子：选区被替换；在空白处拖：框选；拖箭头沿轴移动、拖环旋转（HUD `Rotate 30.0° about n`）。截图存 `scratchpad/shots/w2-m4-movetool/`。

### W2.3

M3 的 App 接口、命令、公共 API、约束标记与配色；M4 的应用层编辑与命令、Transform 分区骨架、跨语言平价与 CLI。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w2-m3-app` | 8830 | M3-T6 M3 的 App 接口、命令与公共 API、M3-T7 约束标记、图例与配色方案 | `crystallume/web/js/app.js#M3`、`crystallume/web/js/app.js#select`、`crystallume/web/js/app.js#PATH_LABELS`、`crystallume/web/js/app.js#entry-serialization`、`crystallume/web/js/commands/layers.js`、`crystallume/web/js/main.js#M3-commands`、`crystallume/web/js/render/colors.js`、`crystallume/web/js/render/settings.js`、`crystallume/web/js/ui/panels/appearance.js`、`crystallume/web/js/render/viewer.js#HIGHLIGHT_COLORS`、`crystallume/web/css/app.css#M3-markers`、`tests/js/m3_app.test.mjs`、`tests/js/m3_markers.test.mjs` |
| `w2-m4-edits` | 8831 | M4-T6a 应用层编辑、命令、公共 API 与 Transform 分区骨架 | `crystallume/web/js/core/edits.js`、`crystallume/web/js/app.js#M4`、`crystallume/web/js/commands/atoms.js`、`crystallume/web/js/main.js#M4-commands`、`crystallume/web/js/ui/panels/transform.js`、`crystallume/web/js/main.js#M4-transform`、`tests/js/edits.test.mjs` |
| `w2-m4-parity` | — | M4-T9b M4 跨语言平价 | `tests/test_m4_parity.py`、`tests/ops/m4.py`、`tests/js/ops/m4.mjs`、`tests/data/manipulate/` |
| `w2-m4-cli` | — | M4-T8a crystallume edit 的 M4 子命令（含 edit delete） | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py` |

**合并顺序**：`w2-m4-cli` → `w2-m4-parity` → `w2-m3-app` → `w2-m4-edits`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M3-T6/T7：`tests/js/m3_app.test.mjs`、`tests/js/m3_markers.test.mjs` 通过；Shift+L/Shift+U 固定/放开选区（toast `Fixed 18 atoms` 的 Undo 只撤销自己）；固定光环为 `CONSTRAINT_COLOR`、默认不进 PNG（`export: 'marker'`）；`crystallume.edit.fixLayers({ bottom: 2 })` 可撤销
- M4-T6a：`tests/js/edits.test.mjs` 通过；`crystallume.command('edit.translate', { vector: [0, 0, 1] })` 一步撤销；Structure 面板出现 Transform 分区骨架（5 个标签页）
- M4-T9b：`tests/test_m4_parity.py` 通过；`tests/data/manipulate/` 不再有 skip（`mic_vector` 的用例归 F0-D，若有则保持 skip 并注明）
- M4-T8a：`crystallume edit translate|rotate|set-distance|set-angle|set-dihedral|add-atom|merge|delete` 的 `tests/test_cli.py` 用例通过；`edit delete --atoms 40` 越界 → 退出码 1、`atom index 40 out of range (structure has 36 atoms)`（负责人决定 L-10）
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`；命令面板搜 `Modify Constraints`、`Translate`、`Rotate` 能找到并显示 MS 名称

#### M3-T6 M3 的 App 接口、命令与公共 API（链 `w2-m3-app`）

【目标】M3 在网页端的应用层接口、命令与 `window.crystallume` 成员。

【依据】M3 §5.6（命令表；`sel.query` 与 `sel.within` 由 M3-T10 注册）、§5.7（撤销标签与 toast）、§6.2；ledger-features L-M3-09（`app.setConstraints(indices, op, opts)`、`app.layerOptions()`/`setLayerOptions(patch)`、`app.layers()`、`app.adsorbates()`、`app.markAdsorbates(indices, { unmark })`、`app.selectWhere(query, { mode })`；`editActive(…, { rebuild: 'appearance' | 'none' })`；公共 API（`defineApi`，owner `M3`）：`analysis.layers`、`analysis.adsorbates`、`analysis.surfaceAtoms`、`analysis.cn`，顶层 `matchQuery`、`selectWhere`、`selectLayers`、`selectWithin`，`edit.fix`、`edit.free`、`edit.freeAll`、`edit.fixLayers`、`edit.fixHeight`、`edit.markAdsorbates`、`edit.unmarkAdsorbates`、`edit.setTagsFromLayers`；R-F21：`edit.markAdsorbates` 是唯一的标记入口）、L-M3-08；ledger-F0 L-F0-30（`rebuild` 只接受 `'full' | 'appearance' | 'none'`，R10）、L-F0-52（命令包装与 `edits`、覆盖 F0-A 的回退）、L-F0-53、§6 M3 第 5、8 条；快捷键 Shift+L（Lock）、Shift+U（Unlock）。

【实现】`app.js` 的段 `M3`：上述 App 方法；`app.select` 的 intersect 模式（第 0 波未支持时改 `app.js` 的 `select` 方法本身，只加这一种模式）；层参数存 `entry.layers`（只在 W0 的项目条目序列化不保留未知键时，改 `app.js` 的条目序列化函数并测试保存再打开后保留）。新文件 `web/js/commands/layers.js`：M3 §5.6 的命令（`sel.fix`、`sel.fixZ`、`sel.fixXY`、`sel.free`、`constraints.freeAll`、`constraints.selectFixed`、`constraints.edit`（`openSection('structure', 'constraints')`，按 id 晚绑定）、`layers.open`、`layers.selectTop/selectBottom`、`layers.fix`、`layers.fixHeight`、`layers.writeTags`、`layers.showTop`、`sel.layer`、`sel.adsorbates`、`sel.surface`、`sel.markAdsorbate`/`sel.unmarkAdsorbate`），`when` 只做 O(1) 检查，参数与 API 共用一个校验函数；`defineApi` 注册；`main.js` 段 `M3-commands` 导入。

【U 与负责人决定】U5（D1：Layers、Constraints 的入口）、P3；负责人决定：无直接相关项。

【文件】`crystallume/web/js/app.js#M3`、`crystallume/web/js/app.js#select`（条件性）、`crystallume/web/js/app.js#entry-serialization`（条件性）、`crystallume/web/js/commands/layers.js`、`crystallume/web/js/main.js#M3-commands`、`tests/js/m3_app.test.mjs`。

【测试】`tests/js/m3_app.test.mjs`：撤销标签与 toast 文案（M3 §5.7 表）、无变化时不入历史、`setLayerOptions` 的签名与 `entry.layers` 持久化、命令参数校验（`axes` 语法、`n` ≥ 1）、`defineApi` 的成员与 owner。

【界面检查】（Chromium，本链端口）选 18 个原子按 Shift+L → toast `Fixed 18 atoms` + Undo；Shift+U → `Freed 18 atoms`；命令面板 `Fix layers…` 无参数时打开 Surface › Layers（W2.4 前是 F0-A 的分区壳）；`crystallume.edit.fixLayers({ bottom: 2 })` 可撤销；`crystallume.analysis.layers()` 返回与 Python 同键的对象。

#### M3-T7 约束标记、图例与配色方案（链 `w2-m3-app`）

【目标】固定原子的光环、（应该）轴标与图例、显示开关，以及（应该）`layer` 与 `constraint` 两套配色方案。

【依据】M3 §5.4（光环：完全固定 `setHighlight('fixed', idx, { color: CONSTRAINT_COLOR, grow: 1.12, strength: 1.4, export: 'marker' })`，部分固定 `strength: 0.7`；`CONSTRAINT_COLOR = { light: '#2563eb', dark: '#7aa2ff' }` 按背景明暗选；光环层次 1.12 < 1.18 < 1.25 < 1.32；`display.constraints.show`/`badges`；导出策略 `marker`）、§5.5（配色 `layer`：Okabe–Ito 8 色循环；`constraint`：完全固定 `#d43c3c`、部分 `#f0a030`、可动 `#b8bec6`）、§5.7 末段（`PATH_LABELS` 加 `['display.constraints', 'Constraints display']`，放在 `['display', 'Display']` 之前）；ledger-F0 L-F0-37/39（`setHighlight` 的 `{light, dark}` 与 `strength`）、L-F0-51（`app.registerColorExtra('layers', …)` 与 `ctx.extras`）、§6 M3 第 5 条（光环名字与颜色归 M3；`shell.floatingCard` 不在 F0-A-core）。

【实现】`app.js` 的段 `M3`：在 `structure` 与 `scene` 事件后重算两个下标集合并调用 `setHighlight`；`app.js` 的 `PATH_LABELS` 一项；`render/settings.js` 的 `display.constraints`；`ui/panels/appearance.js` 的 Scene 标签 Display 区开关 `Show constraints`（副标题 `Rings on fixed atoms`）；（应该）轴标叠加层 `viewer.overlays.add({ id: 'm3-badges', tier: 'canvas', export: 'marker' })`（≤ 300 个绘制原子时画）与图例两项；`render/colors.js` 注册两套配色；命令 `view.constraints` 放 `commands/layers.js`（本链所有）；只在 W0 的 `HIGHLIGHT_COLORS` 仍有红色 `fixed` 时改 `render/viewer.js` 的这一常量；样式放 `css/app.css` 段 `M3-markers`。

【U 与负责人决定】U1（标记不表示 slab）、U5；负责人决定：无直接相关项。

【文件】`crystallume/web/js/app.js#M3`、`crystallume/web/js/app.js#PATH_LABELS`、`crystallume/web/js/render/settings.js`、`crystallume/web/js/ui/panels/appearance.js`、`crystallume/web/js/render/colors.js`、`crystallume/web/js/render/viewer.js#HIGHLIGHT_COLORS`（条件性）、`crystallume/web/css/app.css#M3-markers`、`tests/js/m3_markers.test.mjs`。

【测试】`tests/js/m3_markers.test.mjs`：光环下标集合随约束变化、两种强度、颜色按背景明暗、`layer` 配色与层列表一致（读 `findLayersCached`）、颜色签名包含层参数。

【界面检查】（同链端口）固定底两层后视图里出现蓝色光环（部分固定的更淡）；Scene 标签 `Show constraints` 关掉后光环消失、撤销标签 `Constraints display`；默认导出 PNG 不含光环，勾选 F0-A 的 `Include markers` 后才含；Appearance 选 `Layer (top = 1)` 配色后各层颜色不同、图例显示 `1 (top)`、`2` …；`prefers-reduced-motion` 下无动画。截图存 `scratchpad/shots/w2-m3-app/`。

#### M4-T6a 应用层编辑、命令、公共 API 与 Transform 分区骨架（链 `w2-m4-edits`）

【目标】M4 的应用层编辑（计划函数、近距离接触、周期网络警告）、App 方法、命令与公共 API，并建立 Transform 分区的分段骨架供 W2.4 的两条链并行。

【依据】M4 §3.7.3（点选副本表）、§3.10.3–3.10.4、§3.12、§3.13、§5.2（Transform 分区：`registerPanelSection('structure', {id: 'transform', slot: 'transform', title: 'Transform', order: 10, …})`，新文件 `ui/panels/transform.js`，不改 `ui/panels/structure.js`；顶部 `seg` Move、Rotate、Geometry、Add atom、Insert）、§5.5、§5.7（命令表，`tool.move` 由 M4-T5b、剪贴板命令由 M4-T6b 注册）、§6.4；ledger-features L-M4-07（公共 API（`defineApi`，owner `M4`）：`edit.translate`、`edit.moveAlongNormal`、`edit.moveTo`、`edit.rotate`、`edit.align`、`edit.setDistance`、`edit.setAngle`、`edit.setDihedral`、`edit.setTilt`、`edit.setAzimuth`、`edit.setGeometry`、`edit.movingGroup`、`edit.addAtom`、`edit.insert`；`analysis.sitePoint`；`edit.copy`/`cut`/`paste`/`clipboard` 归 M4-T6b）；ledger-F0 L-F0-30/35（`editActive`、P-pos/P-ghost 会话）、L-F0-52（`estimate`、`edits: true`、`LIMITS.maxAtoms`）、§6 M4 第 3、6 条；C11（多帧只用当前帧）。

【实现】新文件 `web/js/core/edits.js`（计划函数，含 `planPaste`、`pasteDefault`、近距离接触、周期网络警告）；`app.js` 的段 `M4`：App 方法（经 `editActive`/会话）；新文件 `web/js/commands/atoms.js`：除 `tool.move` 与剪贴板以外的 M4 命令（参数 schema、别名、`estimate`）与 `defineApi`；`main.js` 段 `M4-commands`。新文件 `web/js/ui/panels/transform.js` 的骨架：分区注册、`seg` 与模块状态、两个段 `M4-T7a`（Move/Rotate/Geometry）与 `M4-T7b`（Add atom/Insert），每段自带 import 小块，段内先放"尚未实现"的占位；`main.js` 段 `M4-transform` 导入它。

【U 与负责人决定】U5（D2：原位编辑）、P3；负责人决定 L-05（加原子的默认键长来源由 M4-T4/M5-T5 决定）。

【文件】`crystallume/web/js/core/edits.js`、`crystallume/web/js/app.js#M4`、`crystallume/web/js/commands/atoms.js`、`crystallume/web/js/main.js#M4-commands`、`crystallume/web/js/ui/panels/transform.js`（骨架）、`crystallume/web/js/main.js#M4-transform`、`tests/js/edits.test.mjs`。

【测试】M4 §7.2 第 5 条（`planPaste` 各模式；Ctrl V 默认的三种分支；偏移取 1×1 网格格矢且不与周期像重合；没有网格时最小 3.0 Å；从顶面复制粘到底面时载荷翻转）与第 10 条（C11：多帧结构上计划函数只用当前帧）；命令参数校验与 `whyNot` 文案（M4 §5.7）。

【界面检查】（Chromium，本链端口）`crystallume.command('edit.translate', { vector: [0, 0, 1] })` → 撤销标签 `Move N atoms`、toast `Moved N atoms by 1.000 Å`；`edit.rotate` 带参数可撤销；会话中执行编辑命令被拒（`Apply or cancel the preview first.`）；Structure 面板出现 Transform 分区与 5 个标签页（内容为占位）。

#### M4-T9b M4 跨语言平价（链 `w2-m4-parity`）

【目标】M4 核心函数的跨语言平价（从 M4-T9 拆出）。

【依据】M4 §7.3（每个夹具：输入结构、操作、参数、期望（符号、坐标到 1e-8 Å、props、`info` 中是否还有 `spacegroup`）；两种语言跑同一批：`edit_frame`、`translate`（含 frac）、`rotate`（6 种轴/中心形式与两矢量形式）、`set_distance/angle/dihedral`（`move=None/'auto'/'last'/'both'/[…]`、`mic`、`images`）、`moving_group`（21 个场景）、`unwrap_group`（含厚 slab）、`site_point`（§3.9.3 表）、`add_atom`、`extend`、`bond_graph`（216 原子 slab 逐条相同）、`parse_element`、`METALS`、M4 的 `SURFACE_DEFAULTS` 键）；ledger-F0 L-F0-27；plan.md P-02、P-03。

【实现】在 `tests/ops/m4.py` 与 `tests/js/ops/m4.mjs` 注册 M4-T9a 用到的 ops，去掉 `tests/data/manipulate/` 的 skip（`mic_vector` 是 F0-D 的，若夹具里有就保持 skip 并注明）；`tests/test_m4_parity.py` 一次 Node 调用批量比较。

【U 与负责人决定】U2；负责人决定：无直接相关项。

【文件】`tests/test_m4_parity.py`、`tests/ops/m4.py`、`tests/js/ops/m4.mjs`、`tests/data/manipulate/`（只改 skip）。

【测试】即上。两语言不一致时不改期望：在报告里写明偏离规格的一边。

#### M4-T8a crystallume edit 的 M4 子命令（含 edit delete）（链 `w2-m4-cli`）

【目标】M4 的 CLI：`crystallume edit translate|rotate|set-distance|set-angle|set-dihedral|add-atom|merge`，以及负责人决定 L-10 的 `crystallume edit delete`。M4 不加 REST（M4 K8）。

【依据】M4 §6.6；ledger-features L-M4-08（**[改]** 按 §0.3 补上 `[--from FMT] [--index N] -o OUT [--format FMT]`；`edit delete IN --atoms SPEC …`：删除这些原子（`Structure.delete`），吸附物记录按 L-X-04 的删除规则保留、孤儿由 M5 回收；stderr `crystallume: note: deleted 1 atom (35 left)`；`SPEC` 与 M3 `edit fix --atoms` 同一写法，复用 M3-T11a 的 `parse_atom_spec`；越界 → 退出码 1，`atom index 40 out of range (structure has 36 atoms)`）、§0.3 CLI 规则（`nargs=3`，不用 `nargs="+"`）、R-F13、§10.4 第 5 条；负责人决定 L-10。

【实现】`cli.py` 的 `edit` 组追加上述子命令（读写走 `read(..., index=-1)` 与 `_write_or_print`；`set-*` 默认 `--move auto`）；`tests/test_cli.py`。

【U 与负责人决定】U4 不涉及；负责人决定 L-10（`crystallume edit delete`）。

【文件】API 文件束（plan.md §2.4）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`（本批次实际只改 `cli.py` 与 `tests/test_cli.py`）。

【测试】每个子命令一次正常路径与读回；`edit delete` 的 note 与越界；`--atoms "0-8,12"` 的闭区间；`edit add-atom --above` 的默认键长读数与 Python `site_point` 相同；退出码 1/2。

### W2.4

第 2 波的界面：Layers 分区、约束界面、Atom Selection、Transform 两部分、选区卡片/测量/右键/双击与剪贴板。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w2-m3-layers-ui` | 8832 | M3-T8 Surface › Layers 分区 | `crystallume/web/js/ui/panels/surface-layers.js`、`crystallume/web/css/app.css#M3-layers`、`crystallume/web/js/main.js#M3-layers`、`tests/js/layers_ui.test.mjs` |
| `w2-m3-constraints-ui` | 8833 | M3-T9 约束界面：Fix ▾、右键菜单、Structure › Constraints 分区、悬停行 | `crystallume/web/js/ui/constraints.js`、`crystallume/web/js/ui/icons.js#M3`、`crystallume/web/js/main.js#M3-constraints`、`crystallume/web/css/app.css#M3-constraints`、`tests/js/constraints_ui.test.mjs` |
| `w2-m3-atomselection` | 8834 | M3-T10 Atom Selection 工具（非模态查询卡片） | `crystallume/web/js/ui/atomselection.js`、`crystallume/web/css/app.css#M3-atomselection`、`crystallume/web/js/main.js#M3-atomselection`、`tests/js/atomselection.test.mjs` |
| `w2-m4-transform` | 8835 | M4-T7a Transform 分区：Move、Rotate、Geometry | `crystallume/web/js/ui/panels/transform.js#M4-T7a`、`crystallume/web/css/app.css#M4-transform`、`tests/js/transform_ui.test.mjs` |
| `w2-m4-addatom` | 8836 | M4-T7b Add atom、Insert、幽灵预览与放置工具 | `crystallume/web/js/ui/panels/transform.js#M4-T7b`、`crystallume/web/js/render/tools/place.js`、`crystallume/web/js/ui/paramform.js#elementInput`、`crystallume/web/js/main.js#M4-place`、`crystallume/web/css/app.css#M4-place`、`tests/js/addatom_ui.test.mjs` |
| `w2-m4-card-clipboard` | 8837 | M4-T7c 选区卡片数值行、测量列表、M4 的选区动作与右键菜单、双击选分子、M4-T6b 剪贴板：复制、剪切、粘贴（含上方粘贴与作为新结构） | `crystallume/web/js/ui/selectioncard.js#value-rows`、`crystallume/web/js/ui/panels/structure.js#measurements-row`、`crystallume/web/js/app.js#_onAtomDblClick`、`crystallume/web/js/ui/atomactions.js`、`crystallume/web/js/io/clipboard.js`、`crystallume/web/js/ui/clipboard.js`、`crystallume/web/js/ui/shell.js#paste-listener`、`crystallume/web/js/main.js#M4-clipboard`、`crystallume/web/css/app.css#M4-card`、`tests/js/clipboard.test.mjs`、`tests/js/atomactions.test.mjs` |

**合并顺序**：`w2-m3-constraints-ui` → `w2-m3-layers-ui` → `w2-m3-atomselection` → `w2-m4-transform` → `w2-m4-addatom` → `w2-m4-card-clipboard`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- 验收 S1-10（Layers 4 行，z = 14.29 / 12.03 / 9.76 / 7.50，Δ = 2.26，第 3、4 行 🔒 与 `Free`；Structure › Constraints 显示 `18 of 36 atoms fixed`；底两层蓝色光环）、S4-6（选区卡片与悬停卡显示 `fixed along c (z)`）、S6-3、S8-4、S9-5、S10-4（界面与 API 两条路径）
- M3 §7.4 第 1、2、4、6 条在 Chromium 中成立（Fix bottom 2 → POSCAR 18 行 `F F F` → Ctrl+Z 后 SD 消失；Atom Selection `Element is Pt` + `Layer from top = 1` → `9 atoms match` → Select；Esc 关卡片保留选区；悬停层行出现层光环）
- M4 §7.4 第 4–7 条（选区卡片 `Set…` 1.9 → 1.900 Å、CO 整体移动；Ctrl C → 选 3 个 Pt → 右键 `Paste above selection` → 新 CO 键长与复制时相同、POSCAR 新原子 `T T T`；粘贴外来 CIF 文本仍导入为新结构）与双击 O 只选中 {C, O}（D1/E5）
- `tests/js/atomselection.test.mjs`、`tests/js/clipboard.test.mjs`、`tests/js/transform_ui.test.mjs`、`tests/js/addatom_ui.test.mjs`、`tests/js/layers_ui.test.mjs`、`tests/js/constraints_ui.test.mjs`、`tests/js/atomactions.test.mjs` 通过
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`；手机视口 390×844 下 Layers 行高 ≥ 44 px、Atom Selection 为底部 sheet

#### M3-T8 Surface › Layers 分区（链 `w2-m3-layers-ui`）

【目标】Surface 面板的 Layers 分区（M3 §5.1 全部，含应该项：分组、只显示顶部 N 层、Δd 与起伏列）。

【依据】M3 §5.1（布局、控件表、层行、交互、提示与空状态、刷新）、§5.7、§5.8（层表 `role="grid"`、roving tabindex、每行第一个单元格按钮的 `aria-label`）；ledger-features L-M3-09（`registerPanelSection('surface', { id: 'layers', order: 30 })`）；ledger-F0 L-F0-39（`setHighlight('layer', atoms, { export: 'never' })`）、L-F0-42（`setVisibility('layers', …)`，状态栏 "N hidden · Show all" 由 F0-A 提供）、L-F0-48（`vec3Input`、`millerInput`）、L-F0-49（`openSection(…, {focus})`）；M3-T6 的 `app.layers()`、`setLayerOptions`、`setConstraints`；U1（分区对任何结构都在，需要真空的控件在条件不满足时就地说明）。

【实现】新文件 `web/js/ui/panels/surface-layers.js`；样式放 `css/app.css` 段 `M3-layers`；`main.js` 段 `M3-layers` 导入。Fix 控件 `Fix [bottom ▾ | middle | all but the top] [N] layers  Axes [...]  Apply`（设定语义，一次撤销）、Fix by height、Select top/bottom N、Colour by layer（按钮，不做开关）、Show only the top N layers（应该）、Select by height…（打开 Atom Selection 预填条件：调用 `commands.run('sel.query', {query})`，按 id 晚绑定）；超过 100 行只渲染前 100 行；吸附物行始终显示。

【U 与负责人决定】U1（分区对任何结构都在，需要真空的控件就地说明）、U5；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/panels/surface-layers.js`、`crystallume/web/css/app.css#M3-layers`、`crystallume/web/js/main.js#M3-layers`、`tests/js/layers_ui.test.mjs`。

【测试】`tests/js/layers_ui.test.mjs`：纯逻辑（行文案与 `aria-label`、默认 N = max(1, ⌊行数/2⌋) 与按单元取整、提示与空状态文案、超过 100 行的截断）。

【界面检查】（Chromium，本链端口）Pt(111) p(3×3) 4L（pbc T T T）→ Shift+5 → Layers 标题 `4 layers · 36 atoms`、4 行 `Pt 9`、z = 14.29/12.03/9.76/7.50、Δ = 2.26；`Fix [bottom] [2]` Apply → 第 3、4 行 🔒 与 `Free`，`crystallume.exportText('poscar')` 含 `Selective dynamics` 与 18 行 `F F F`，Ctrl+Z 后 SD 消失；悬停层行出现层光环、移出消失；SrTiO3 TiO2 对称 7L 上 `Fix middle 3` → 7 个 `[F,F,F]`；CONTCAR 夹具 4 行、无 straddle 提示；MoS2 上的 S 吸附原子标记后 Adsorbates 行显示 `S 1 (from adsorbate ids)`；键盘方向键在行间移动。截图存 `scratchpad/shots/w2-m3-layers-ui/`。

#### M3-T9 约束界面：Fix ▾、右键菜单、Structure › Constraints 分区、悬停行（链 `w2-m3-constraints-ui`）

【目标】约束的界面入口：选区卡片的 Fix ▾ 分体按钮与 Mark/Unmark adsorbate、右键菜单（原子与空白处）、Structure › Constraints 分区、悬停卡的一行。

【依据】M3 §5.3（5.3.1 选区卡片、5.3.2 右键菜单、5.3.3 Constraints 分区（含收紧警告的 Dismiss 一次撤销）、5.3.4 悬停卡片）、§5.7、§5.8；ledger-features L-M3-09（`registerPanelSection('structure', { id: 'constraints', slot: 'transform', order: 20 })`；选区动作 Fix ▾ order 35、`sel.markAdsorbate` order 70）；ledger-F0 L-F0-50（`registerSelectionAction` 的 `items`、`rows`、`menu: 'blank' | 'both'`、`enabled`、label 函数）、`registerAtomInfo`（代替 `registerHoverLine`）、§6 M3 第 5 条（**Fix ▾ 的 order 用 35**，不是 15）、L-F0-13（`constraint_summary`、`axis_labels`）；不直接改 `ui/selectioncard.js`、`ui/shell.js`、`ui/panels/structure.js`；图标 `lockPartial`（未知图标会静默变成 `info`，测试检查图标名）。

【实现】新文件 `web/js/ui/constraints.js`；`ui/icons.js` 段 `M3` 加 `lockPartial`；`main.js` 段 `M3-constraints`；样式放 `css/app.css` 段 `M3-constraints`。

【U 与负责人决定】U5（D1：Structure › Constraints 分区）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/constraints.js`、`crystallume/web/js/ui/icons.js#M3`、`crystallume/web/js/main.js#M3-constraints`、`crystallume/web/css/app.css#M3-constraints`、`tests/js/constraints_ui.test.mjs`。

【测试】`tests/js/constraints_ui.test.mjs`：动作文案随选区切换（全部固定时主按钮为 Free）、菜单项的显示条件与 kbd（Shift+L/Shift+U）、Constraints 摘要（`22 of 36 atoms fixed`、`18 fully fixed · 4 fixed along c (z) · 14 free`）、没有约束与全 T 时的文案、图标名存在。

【界面检查】（Chromium，本链端口）选中底两层 → 选区卡片 Fix ▾ → `Fix z only` → 卡片信息行 `12 fixed · 6 free` 一类；单个原子的卡片与悬停卡显示 `constraint  T T F · fixed along c (z)` 与 `layer 2/4 · fixed c (z)`（S4-6）；右键 `Fix 12 selected atoms`、`Free atom`；空白处右键 `Select fixed atoms`、`Atom Selection…`；Structure › Constraints 显示 `18 of 36 atoms fixed`，Fixed axes 三个切换按钮的标签用 `axis_labels`（a、b (y)、c (z)）；斜晶胞改 a 使部分约束被收紧后，分区出现警告与 Dismiss。截图存 `scratchpad/shots/w2-m3-constraints-ui/`。

#### M3-T10 Atom Selection 工具（非模态查询卡片）（链 `w2-m3-atomselection`）

【目标】非模态的 Atom Selection 查询卡片（M3 §5.2 全部；应该项：拖动与位置记忆、Copy as script），以及打开它的命令 `sel.query` 与 `sel.within`。

【依据】M3 §5.2（打开方式、布局：桌面 340 px、手机 ≤ 920 px 时底部 sheet 且与选区卡片互斥、无遮罩；属性下拉的分组与 `prop`；运算符与值控件；实时预览（防抖 120 ms，> 5 万原子 300 ms；大结构且含 `surface`/`adsorbate`/`cn` 时按 Preview）；错误行文案；Select 只发一次选区事件；Esc 关卡片不清选区；会话记忆与 Copy as script）、§5.6（`sel.query` 没有默认快捷键）、§5.8（`role="dialog" aria-modal="false" aria-label="Atom selection"`）；ledger-features L-M3-06、L-M3-09；ledger-F0 L-F0-39（`setHighlight('query', matches, { export: 'never' })`，颜色 `{ light: '#0f9d8a', dark: '#3fd1bb' }`）、§6 M3 第 5 条（`shell.floatingCard` 不在 F0-A-core，M3 自己实现卡片）；M3-T5 的 `select_where`/`selectWhere`、M3-T6 的 `app.selectWhere`。

【实现】新文件 `web/js/ui/atomselection.js`（卡片、把行与查询互转的纯函数 `rowsToQuery`/`queryToRows`、模式组合）；命令 `sel.query`（参数 `query` 为 JSON 字符串，经 `parseQuery` 校验）与 `sel.within`；位置存 `localStorage`（读写包 try/catch）；样式放 `css/app.css` 段 `M3-atomselection`；`main.js` 段 `M3-atomselection`。

【U 与负责人决定】U5（非模态工具，视图仍可用）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/atomselection.js`、`crystallume/web/css/app.css#M3-atomselection`、`crystallume/web/js/main.js#M3-atomselection`、`tests/js/atomselection.test.mjs`。

【测试】`tests/js/atomselection.test.mjs`：`rowsToQuery`/`queryToRows` 往返、错误文案（`Layer: enter a whole number from 1 to 4.`、`Distance: enter a radius from 0 to 50 Å.`、`Distance from the selection: select atoms first.`）、模式组合，不依赖 DOM。

【界面检查】（Chromium，本链端口）命令面板 `Atom Selection…`（MS 名称可搜到）打开卡片，视图仍可旋转与点选；条件 `Element is Pt` + `Layer from top = 1` → 计数行 `9 atoms match · the selection will have 9 atoms`、视图里查询高亮；Select → 选区 9 个；Esc 关闭卡片、选区仍在；`Distance within 3.0 Å of atom #i` 预填来自右键 `Select atoms within…`；390×844 视口下为底部 sheet 且选区卡片隐藏；Copy as script 复制 `crystallume.selectWhere(...)`。截图存 `scratchpad/shots/w2-m3-atomselection/`。

#### M4-T7a Transform 分区：Move、Rotate、Geometry（链 `w2-m4-transform`）

【目标】Structure 面板 Transform 分区的 Move、Rotate、Geometry 三个子表单（应该项 Tilt/Azimuth）。

【依据】M4 §2.2、§5.2（P-pos 预览：第一次改值时 `beginStructureEdit(label, {kind: 'positions', owner: 'transform'})`，标题旁 `Previewing — Apply or Cancel`，Enter = Apply，Esc = Cancel，`onEnd(reason)` 时显示 `Preview cancelled` 并保留输入；Geometry 的来源下拉、`Atoms that move` 的 seg（`Fragment (auto)`、`Last atom only`、`Both sides`、`Custom…`）、`Swap ends`、说明行最多 6 个原子之后 `+N more`、tip `Fragments follow covalent-radius bonds, not the bond display settings.`）、§5.5（撤销标签与 toast）、§5.8、§5.9（`m4-moving` 高亮）；ledger-F0 L-F0-35（P-pos 与 `singleFrame`）、L-F0-48（`vec3Input` Å/frac 切换、`numberInput`）、L-F0-49；M4-T6a 的分区骨架（本任务只改段 `M4-T7a`）、M4-T1/T2/T3 的核心函数。

【实现】`web/js/ui/panels/transform.js` 的段 `M4-T7a`（含段内 import 小块）；样式放 `css/app.css` 段 `M4-transform`。

【U 与负责人决定】U5（Transform 分区，D1）、P3；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/panels/transform.js#M4-T7a`、`crystallume/web/css/app.css#M4-transform`、`tests/js/transform_ui.test.mjs`。

【测试】`tests/js/transform_ui.test.mjs`：说明行的规则名与截断、撤销标签与 toast 文案、Custom… 拾取的状态机（纯逻辑）。

【界面检查】（Chromium，本链端口）选 C、Pt（反序）→ Transform › Geometry → Distance 1.9 → 预览中标题旁 `Previewing — Apply or Cancel` → Apply → 距离 1.900 Å、CO 整体移动、Pt 不动、撤销标签 `Set distance to 1.900 Å`；Move 子表单 Å/frac 切换后数值换算正确；Rotate 30° about z 的 toast `Rotated 2 atoms by 30.0° about z`；Esc 取消预览且输入保留；会话被撤销取消时显示 `Preview cancelled`。截图存 `scratchpad/shots/w2-m4-transform/`。

#### M4-T7b Add atom、Insert、幽灵预览与放置工具（链 `w2-m4-addatom`）

【目标】Transform 分区的 Add atom 与 Insert 子表单、P-ghost 预览、位点读数；（应该）`place` 工具与 Paste special 卡；`elementInput` 的 `allowDummy`。

【依据】M4 §2.2、§2.4、§2.6、§3.9.6、§5.2（Add atom：元素输入改用 `parseElement`；位置 seg `Above selection`/`Cartesian`/`Fractional`/`Click in view`（应该）；Above 时 `Bond length`/`Height` 切换、`Side` 读数、位点读数、`Mark as adsorbate` 勾选框；Insert：结构下拉 `name · formula · N atoms`、无可选结构时 `Add a molecule with Build › Molecule, then insert it here.`、锚点下拉、`Orient`（应该））、§5.5；ledger-features L-M4-05（读数注明 `(covalent radii)`；吸附物库一支在 W3.2 由 M5-T5 接上，届时读数为 `(adsorbate library)`）、L-M4-02；负责人决定 L-05、L-15；ledger-F0 L-F0-35（P-ghost：`kind: 'ghost'`、`commit(fn, opts)` → `editActive`）、L-F0-41（`place` 工具）；M4-T6a 的分区骨架（本任务只改段 `M4-T7b`）、M4-T4 的 `site_point`/`addAtom`/`extend`。

【实现】`web/js/ui/panels/transform.js` 的段 `M4-T7b`（含段内 import 小块）；新文件 `web/js/render/tools/place.js`（应该）；`ui/paramform.js` 的 `elementInput` 加 `allowDummy` 并改用 `parseElement`（只改该函数）；`main.js` 段 `M4-place`；样式放 `css/app.css` 段 `M4-place`。

【U 与负责人决定】U5（D2）；负责人决定 L-05（读数注明来源）、L-15。

【文件】`crystallume/web/js/ui/panels/transform.js#M4-T7b`、`crystallume/web/js/render/tools/place.js`、`crystallume/web/js/ui/paramform.js#elementInput`、`crystallume/web/js/main.js#M4-place`、`crystallume/web/css/app.css#M4-place`、`tests/js/addatom_ui.test.mjs`。

【测试】`tests/js/addatom_ui.test.mjs`：`parseElement` 在元素输入里的 11 个输入（含 X 作为 dummy）、读数文案、Insert 下拉的禁用规则。

【界面检查】（Chromium，本链端口）选 3 个顶层 Pt → Add atom › Above selection、元素 O → 幽灵 O 出现在三重位上方、读数 `bond 1.98 Å (covalent radii)` 一类（数字按式子现算）与 `above the top surface`；Apply → toast `Added O #37`、一步撤销；勾选 `Mark as adsorbate` 时新原子有新的 `adsorbate_id`；Insert 一个 Water 分子 → `Inserted Water (3 atoms)`；放置工具（若实现）点击视图放置。截图存 `scratchpad/shots/w2-m4-addatom/`。

#### M4-T7c 选区卡片数值行、测量列表、M4 的选区动作与右键菜单、双击选分子（链 `w2-m4-card-clipboard`）

【目标】选区卡片的 `Set…` 数值行、Measurements 行的铅笔、M4 的选区动作与右键菜单项、双击选分子与命令 `sel.molecule`。

【依据】M4 §2.3、§3.5.3、§5.3（2–4 个原子时数值来自 `definingPositions`；`Set…` 输入框 `aria-label` 为 `Distance in Å`/`Angle in degrees`/`Dihedral in degrees`，旁边 `Moves 2 atoms`）、§5.4（原子：`Select molecule`、`Move selection`、`Copy`、`Cut`、`Paste above ${sym} #${src}`、`Add atom above…`；空白处：`Paste as new structure`、`Paste here`（可选）、`Add atom here…`（应该））、§5.7（`sel.molecule`）；ledger-features L-M4-07（选区动作顺序 **Move… 60、Rotate… 61**，其余按 M4 §5.3 用 72–76；M7 在 W5 核对配额，plan.md P-11）；ledger-F0 L-F0-50（`registerSelectionAction`）、L-F0-21（二面角）；M4-T2 的 `moleculeOf`、M4-T6a 的命令。

【实现】`ui/selectioncard.js` 的数值行（不是动作区；以渲染数值行的函数定位）；`ui/panels/structure.js` 的 Measurements 行渲染加铅笔；`app.js` 的 `_onAtomDblClick` 改用 `moleculeOf`（只改该方法）；新文件 `web/js/ui/atomactions.js`（M4 的 `registerSelectionAction` 动作与菜单项、命令 `sel.molecule`）；样式放 `css/app.css` 段 `M4-card`。

【U 与负责人决定】U5、P3；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/selectioncard.js#value-rows`、`crystallume/web/js/ui/panels/structure.js#measurements-row`、`crystallume/web/js/app.js#_onAtomDblClick`、`crystallume/web/js/ui/atomactions.js`、`crystallume/web/css/app.css#M4-card`、`tests/js/atomactions.test.mjs`。

【测试】`tests/js/atomactions.test.mjs`：M4 §7.2 第 8 条（键跨 a 面时卡片与 `Set…` 用同一组副本；二面角显示符号与 Python 一致）、第 9 条（真实 `buildDisplayModel` 上 Pt(111) p(3×3) + 顶位 CO + fcc CO，smart 开与关时双击 O 都只选中 {C, O}；双击表面 Pt 选中整个网络）；动作的 order 与 `when`。

【界面检查】（Chromium，本链端口）选 C、Pt（反序）→ 卡片 `Set…` 输入 1.9 回车 → 距离 1.900、CO 整体移动、Pt 不动；双击 O → 选区恰为 {C, O}；Measurements 行铅笔打开同一输入；右键原子菜单出现 M4 的各项。

#### M4-T6b 剪贴板：复制、剪切、粘贴（含上方粘贴与作为新结构）（链 `w2-m4-card-clipboard`）

【目标】原子剪贴板：编码/解码/校验、`copy`/`cut`/`paste` 事件与 Shift 标志、粘贴监听改为先问剪贴板模块、相应命令与公共 API。

【依据】M4 §2.5、§3.10（3.10.1–3.10.2 载荷与校验；3.10.5 数据规则）、§5.5（`Cut 2 atoms (CO)`、`Pasted 2 atoms (CO)`、`Pasted CO as a new structure`）、§5.6（Ctrl/⌘ C/X/V、Ctrl/⌘+Shift+V 只在命令的 `kbd` 里显示，不注册为 `key`）、§5.7（`edit.copy`、`edit.cut`、`edit.paste`、`edit.pasteNew`、`edit.pasteSpecial`（应该））；ledger-features L-M4-06（`CLIP_MIME = 'application/x-crystallume-atoms+json'`、`encodeClipboard(structure, indices, meta) → { json, text, payload }`、`decodeClipboard({ json, text }, memory) → payload | null`；表面放置的粘贴按 R-ADS；完整的源吸附物复制其 `info.surface.adsorbates` 记录（`id` 改为新 id、`site = null`、`bonds = []`，不写 `firstAtom`，R-F34）；目标没有 `info.surface` 时建 `kind: "adsorbates"` 块，`autoName = 目标名`，M4 不改名）、L-M4-07（`edit.copy`/`cut`/`paste`/`clipboard` 的 `defineApi`）、§10.4 第 4 条；ledger-F0 L-F0-24（extxyz 里的 `crystallume_clip=<id>` 按普通字符串往返）；简报 §4（不要把 Ctrl/⌘ C/V/X 注册为命令，会破坏粘贴导入）；M4 §9：`ui/shell.js` 只改粘贴监听。

【实现】新文件 `web/js/io/clipboard.js`、`web/js/ui/clipboard.js`；`ui/shell.js` 的粘贴监听（HEAD `shell.js:976-984`，W0 之后以监听函数定位）改为先交给 `ui/clipboard.js`，拿不到 Crystallume 载荷时照旧导入；命令与 `defineApi` 放 `ui/clipboard.js`；`main.js` 段 `M4-clipboard`。

【U 与负责人决定】U5（D2：粘贴原位修改；作为新结构粘贴走 `addStructure`）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/io/clipboard.js`、`crystallume/web/js/ui/clipboard.js`、`crystallume/web/js/ui/shell.js#paste-listener`、`crystallume/web/js/main.js#M4-clipboard`、`tests/js/clipboard.test.mjs`。

【测试】M4 §7.2 第 6、7 条：往返（自定义类型、仅文本 + 内存、仅带标记的 extxyz、无标记文本返回 null）；载荷里跨面的分子已展开；伪造载荷（坐标 NaN、原子数超限、`anchor` 越界、`type` 不符）被当作普通文本；Shift 标志在 keyup/blur/粘贴后清除；会话中粘贴被拦；从固定底层复制的 Pt 粘到表面上方后为 [T,T,T]、tags 0、有新 id；`Keep constraints and tags` 保留原值；`same` 模式保留；完整吸附物的记录被复制改 id；CONTCAR 上已有 CO 时第一次粘贴先 promote。

【界面检查】（同链端口）Ctrl C → 选 3 个 Pt → 右键 `Paste above selection` → 新 CO 离三个 Pt 都是复制时的键长 → 导出 POSCAR：SD 存在、新原子 `T T T`、底两层 `F F F`；另一个 slab 上 Ctrl V（`surface` 模式）锚定键长保持；粘贴外来的 CIF 文本仍导入为新结构；Ctrl/⌘+Shift+V 作为新结构粘贴。截图存 `scratchpad/shots/w2-m4-card-clipboard/`。

### W2.5

第 2 波收尾：文档与应用内帮助、Playwright 冒烟（M3、M4 与验收子集）、性能、跨模块回归。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w2-docs` | 8838 | M3-T12b M3 界面与查询的文档、快捷键对话框与提示栏、M4-T8b M4 的文档、快捷键对话框 Mouse 行与导览 | `README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour` |
| `w2-e2e-layers` | 8839 | M3-T13 M3 的 Playwright 冒烟、第 2 波验收子集与层分析性能 | `tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/layers.spec.mjs`、`tests/e2e/w2_acceptance.spec.mjs`、`tests/poscar_canon.py`、`tests/e2e/poscar_canon.mjs`、`tests/js/perf/layers.perf.mjs` |
| `w2-e2e-manipulate` | 8840 | M4-T9c M4 的 Playwright 冒烟与性能 | `tests/e2e/manipulate.spec.mjs`、`tests/js/perf/movetool.perf.mjs`、`tests/test_manipulate_perf.py` |
| `w2-xmodule` | — | W2-X1 第 2 波跨模块回归测试（M2 × M3 × M4） | `tests/test_w2_crossmodule.py`、`tests/js/w2_crossmodule.test.mjs` |

**合并顺序**：`w2-xmodule` → `w2-e2e-layers` → `w2-e2e-manipulate` → `w2-docs`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- Playwright（`pytest -m slow tests/test_e2e.py`）：`tests/e2e/layers.spec.mjs`（M3 §7.4 第 1–6 条）、`tests/e2e/manipulate.spec.mjs`（M4 §7.4 第 1–9 条）、`tests/e2e/w2_acceptance.spec.mjs`（E2E-2 第 1–4 步与第 5 步的 Layers 部分、E2E-3 第 4 步）通过，截图在 `tests/e2e/out/`
- 性能（`slow`）：`tests/js/perf/layers.perf.mjs`、`tests/js/perf/movetool.perf.mjs`、`tests/test_manipulate_perf.py` 在 M3 §7.5 与 M4 §7.5 的预算内（CI ×3）
- 跨模块：`tests/test_w2_crossmodule.py`、`tests/js/w2_crossmodule.test.mjs` 通过：S6-3、S8-4、S8-6、S8-8、S9-5、S10-4、S4-6；固定后移动、标记后粘贴的 R-ADS 规则
- 文档：README、`docs/PLUGINS.md`（含"与 ASE 的差异"一节）、`docs/SCHEMA.md`（约束规则、查询 JSON、`adsorbate_id`、剪贴板载荷 `crystallume.atoms/1`）、快捷键对话框 Mouse 行与提示栏、导览更新；文档例子能运行；随后进入波末三视角审查

#### M3-T12b M3 界面与查询的文档、快捷键对话框与提示栏（链 `w2-docs`）

【目标】M3 第 2 波部分的文档与应用内文案。

【依据】M3 §9 T12、§3.11.1（查询 JSON 写进 `docs/SCHEMA.md`）、§5.6（快捷键 Shift+L、Shift+U）、§6.2；ledger-features L-M3-05、L-M3-06、L-M3-09；简报 §5。

【实现】README（Layers 分区、约束、Atom Selection）、`docs/PLUGINS.md`（JS API：`crystallume.edit.fix/free/...`、`analysis.layers/adsorbates/surfaceAtoms/cn`、`selectWhere`、`matchQuery`；`entry.layers`；`display.constraints`；默认值对照表）、`docs/SCHEMA.md`（约束规则、tags、查询 JSON）、`docs/DEPLOY.md`（若实现了可选的 `/analysis/select`）、快捷键对话框鼠标段与提示栏的手写部分（`ui/shell.js`，以符号定位）、CHANGELOG。

【U 与负责人决定】U1、U5；负责人决定：无直接相关项。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour`。

【测试】文档里的例子在开发环境里逐个运行。

【界面检查】（Chromium，本链端口）快捷键对话框列出 Shift+L、Shift+U、G（Move tool）与 Mouse 行；帮助与导览提到 Layers 分区与 Atom Selection。

#### M4-T8b M4 的文档、快捷键对话框 Mouse 行与导览（链 `w2-docs`）

【目标】M4 的文档与应用内文案（从 M4-T8 拆出的文档部分）。

【依据】M4 §5.1（Mouse 行：`['Drag a selected atom', 'Move the selection (Move tool; along the surface when there is a vacuum gap)']`、`['Drag an arrow, square or ring', 'Move along an axis, in a plane, or rotate']`）、§5.6（README "Mouse and keys" 的 Move tool 一句）、§6、§10 M7 一节（"与 ASE 的差异"：`mask` 与 `indices` 同给报错、`set_angle/set_dihedral` 支持 `mic`/`images`、`move=` 的 GUI 语义）；ledger-features L-M4-01…08；简报 §5。

【实现】README（Move tool 与 Transform 分区、剪贴板）、`docs/PLUGINS.md`（Python 方法、JS `edit.*`、`registerSnapTargets`、"与 ASE 的差异"一节、CLI `crystallume edit …` 含 `edit delete`）、`docs/SCHEMA.md`（`adsorbate_id` 规则、剪贴板载荷 `crystallume.atoms/1`）、快捷键对话框 Mouse 行与提示栏、导览（`ui/shell.js`，以符号定位）、CHANGELOG。

【U 与负责人决定】U1（Move tool 的说明写"有真空间隙时沿表面"）；负责人决定 L-10。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour`。

【测试】文档例子与 CLI 例子逐个运行。

【界面检查】（同链端口）快捷键对话框的 Mouse 行与 README 一致；移动工具的提示栏文案与 M4 §5.1 相同。

#### M3-T13 M3 的 Playwright 冒烟、第 2 波验收子集与层分析性能（链 `w2-e2e-layers`）

【目标】M3 的端到端冒烟与性能基准，以及第 2 波已能运行的验收 E2E 子集；本批次维护 harness 与 pytest 包装。

【依据】M3 §7.4 第 1–6 条、§7.5（预算表；"只在用户触发时计算"的门槛 `analysis_lazy_atoms` = 2 万原子；超预算的退路：O(N) 分桶）；acceptance §3.2 E2E-2（第 1–4 步与第 5 步的 Layers 部分：第 2 行 → `Fix z only`）、E2E-3 第 4 步（Layers `Fix` middle 3 → 7 个全 `false`）；`tests/poscar_canon.py` 与 `tests/e2e/poscar_canon.mjs`（S14 的规范形，负责人决定 L-01；若 W0 已提供等价工具就复用并只加薄封装）；负责人决定 L-06；plan.md P-10、P-14。

【实现】`tests/e2e/layers.spec.mjs`；`tests/e2e/w2_acceptance.spec.mjs`；`tests/poscar_canon.py`、`tests/e2e/poscar_canon.mjs`（两份实现由一个 pytest 用例对夹具与 3 个导出样例互相核对）；`tests/js/perf/layers.perf.mjs`（由 `tests/test_js_perf.py` 收集）；harness/包装只做必要修改。

【U 与负责人决定】U1-a/U1-c；负责人决定 L-01（规范形）、L-06。

【文件】`tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/layers.spec.mjs`、`tests/e2e/w2_acceptance.spec.mjs`、`tests/poscar_canon.py`、`tests/e2e/poscar_canon.mjs`、`tests/js/perf/layers.perf.mjs`。

【测试】`pytest -m slow tests/test_e2e.py tests/test_js_perf.py`。

【界面检查】（Chromium，本链端口）M3 §7.4：Fix bottom 2 → POSCAR 18 行 `F F F` → Ctrl+Z 后 SD 消失；Atom Selection 9 atoms match；固定后截图有标记像素，`screenshot({ markers: false })` 与关掉标记时导出的 PNG 一致（比较前关 AO 或用容差）；悬停层行出现光环；CONTCAR 夹具层表 4 行、悬停底层原子显示存储坐标；MoS2 上 Mark as adsorbate。E2E-2：打开 CONTCAR 无对话框、toast 恰为 `Loaded contcar_pt111.vasp — 36 atoms`、f_c = 0.99999 的两个原子画在底层、规范形往返相同。截图交审查。

#### M4-T9c M4 的 Playwright 冒烟与性能（链 `w2-e2e-manipulate`）

【目标】M4 的端到端冒烟与性能测试（从 M4-T9 拆出）。

【依据】M4 §7.4 第 1–9 条（默认显示设置）、§7.1 第 15 条（1 万原子 slab 上 `bond_graph + substrate_mask + moving_group` ≤ 1 s、`unwrap_group(全部)` ≤ 50 ms）、§7.5（拖动与提交的预算）；acceptance MD-1 中移动工具的部分（按 G 后双击 CO、拖到 fcc 位：高度不变、松开后历史只多一步 `Move 2 atoms`）；负责人决定 L-06。

【实现】`tests/e2e/manipulate.spec.mjs`（夹具 Pt(111) p(3×3) 4L + 顶位 CO 的 JSON）；`tests/js/perf/movetool.perf.mjs`（216 原子与 1 万原子的每次 pointermove 计算时间；不测 GPU 帧率，只测 M4 的计算部分）；`tests/test_manipulate_perf.py`（`slow`）。harness 与包装由 `w2-e2e-layers` 维护，本链不改。

【U 与负责人决定】U1、P3；负责人决定 L-06。

【文件】`tests/e2e/manipulate.spec.mjs`、`tests/js/perf/movetool.perf.mjs`、`tests/test_manipulate_perf.py`。

【测试】`pytest -m slow tests/test_e2e.py -k manipulate tests/test_manipulate_perf.py tests/test_js_perf.py`。

【界面检查】（Chromium，本链端口）M4 §7.4 全部 9 条：双击 O 选中 {C, O} → G → 拖 100 px → `Undo Move 2 atoms`、C 高度不变；拖动中 Esc；点击未选原子替换选区、空白处拖框选；`Set…` 1.9；Ctrl C → Paste above selection → POSCAR 新原子 `T T T`；另一 slab 上 Ctrl V；粘贴 CIF 文本导入为新结构；CONTCAR 夹具上测量 Pt–Pt 后移动该底层原子 0.1 Å，测量仍在且数值连续；触屏模拟一指拖手柄移动、空白处转相机。截图交审查。

#### W2-X1 第 2 波跨模块回归测试（M2 × M3 × M4）（链 `w2-xmodule`）

【目标】用测试钉住第 2 波模块之间、以及与第 1 波之间的接缝。

【依据】ledger-features L-X-05（R-ADS）、L-X-06（后续操作对数据的影响总表）、L-M4-02、L-M4-04、L-M3-04、L-M3-07；acceptance S4-6、S6-3、S8-4、S8-6、S8-8、S9-5、S10-4；C3、C7。

【实现】`tests/test_w2_crossmodule.py` 与 `tests/js/w2_crossmodule.test.mjs`（同一组场景两语言）：固定底层后 `moving_group` 不因约束改变移动哪一侧、约束标志保持；`select_layers` 后 `translate`；M3 `mark_adsorbates` 后 M4 粘贴/`extend(adsorbate=True)` 的 id 规则（先 promote、新 id 从 `next_adsorbate_id`）；`set_tags_from_layers` 后 `substrate_mask` 的来源变为 tags；查询 `adsorbate`/`adsorbateId` 能选到 M4 新加的吸附原子；切面 slab（M2）上的验收：S6-3（Pt(211) 深于顶层 4.4 Å 的 6 个原子固定）、S8-4（按单元固定 12 原子 Ti4O8）、S8-6（删桥氧后 35 原子、一个撤销步、固定标志不变、`info.spacegroup` 不存在、名字不变、`asBuilt.composition` 仍为 Ti12O24、`slab_report` 文案）、S8-8、S9-5、S10-4、S4-6。

【U 与负责人决定】U5/D7；负责人决定：无直接相关项（R-ADS 按账本）。

【文件】`tests/test_w2_crossmodule.py`、`tests/js/w2_crossmodule.test.mjs`。

【测试】即上。发现缺陷时写成 `xfail(strict=True, reason="<模块>: <问题>")` 并在报告里交负责人，不在本链改源码。

## 5. 第 3 波：M5 吸附物（库、位点识别、放置、覆盖度、Adsorbates 分区）

### W3.1

M5 无依赖或只依赖前两波的起步：吸附物库、二维 Delaunay、基底坐标系与位点原子（含测试夹具）。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w3-m5-library` | — | M5-T1 吸附物库、校验与加载（双语言）；build/adsorbate 骨架 | `crystallume/web/data/adsorbates.json`、`scripts/gen_adsorbates.py`、`crystallume/build/adsorbate.py`、`crystallume/web/js/build/adsorbates.js`、`crystallume/build/__init__.py#M5-T1`、`crystallume/core/defaults.py#M5-adsorbates`、`crystallume/web/js/core/defaults.js#M5-adsorbates`、`tests/test_adsorbate_library.py`、`tests/js/adsorbate_library.test.mjs` |
| `w3-m5-delaunay` | — | M5-T2 二维 Delaunay 三角剖分（两语言逐行同构） | `crystallume/core/delaunay.py`、`crystallume/web/js/core/delaunay.js`、`tests/test_delaunay.py`、`tests/js/delaunay.test.mjs` |
| `w3-m5-frame` | — | M5-T3 基底、表面坐标系与位点原子（双语言）；sites 骨架与 slab 夹具 | `crystallume/analysis/sites.py`、`crystallume/web/js/core/sites.js`、`crystallume/analysis/__init__.py#M5-sites`、`crystallume/core/defaults.py#M5-sites`、`crystallume/web/js/core/defaults.js#M5-sites`、`tests/surface_fixtures.py`、`tests/data/surface/slabs/`、`tests/test_sites_frame.py`、`tests/js/sites_frame.test.mjs` |

**合并顺序**：`w3-m5-frame` → `w3-m5-library` → `w3-m5-delaunay`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M5-T1：`tests/test_adsorbate_library.py`、`tests/js/adsorbate_library.test.mjs` 通过（52 个条目、§4.1 的 8 条校验、查找与 E20 建议、自定义框架规则）；`adsorbates.json` 经 `webdata` 读取（L-M2-06、R-F30）
- M5-T2：`tests/test_delaunay.py`、`tests/js/delaunay.test.mjs` 通过（空圆性质、三角形数 2n − 2 − h、12×12 方格 242、蜂窝 338 点 624、输入打乱后合并结果相同）
- M5-T3：`tests/test_sites_frame.py`、`tests/js/sites_frame.test.mjs` 通过（恰好一半原子跨边界、CONTCAR 底层 0.9999、真空沿 a、法向 −y 时与理想 slab 相同；`surface_normal(s, exclude=吸附物 ∪ 漂浮片段)`，R-F27）；`tests/surface_fixtures.py --write` 产物与函数一致
- L-X-08：M5 两段键两语言逐键相等；没有 `coverage_translation_tolerance`（用 M1 的 `reference_mesh_tolerance`）

#### M5-T1 吸附物库、校验与加载（双语言）；build/adsorbate 骨架（链 `w3-m5-library`）

【目标】吸附物库 `adsorbates.json`（52 个条目）与它的 schema、校验、查找、`Adsorbate` 对象与自动框架；建立 `build/adsorbate.py` 与 `web/js/build/adsorbates.js` 的分段骨架；加入 M5 的 `adsorbate_*` 键。

【依据】M5 §2.1、§3.9（自动框架与 `reference`）、§4.1（库文件、条目表、8 条校验）、§4.2（加载：经共用数据模块 `webdata`；实现归 M2 T2，已在 W1.1 合入，V-F14 第 1 条）、§4.7（`adsorbate_*` 键）、§6.1/§6.2 的库部分；ledger-features L-M5-01（schema `crystallume.adsorbates/1`）、R-F30、R-F31（启动任务 `registerBootTask('adsorbates', loadAdsorbateLibrary)` 由 M5-T9a 在分区文件里注册）、L-X-08 M5 行；V-F05（`Adsorbate.to_structure` 的注释：放进盒子时 `vacuum` 是周期像之间沿每根晶格矢量的总间隙，pbc T T T，`vacuum=None` 表示不装箱，不是默认值）；U4。

【实现】`crystallume/web/data/adsorbates.json`（按 M5 §4.1 表；生成器 `scripts/gen_adsorbates.py` 扩展自 v1 原型 `scratchpad/proto/m5/library.py`，开发期运行）；新文件 `crystallume/build/adsorbate.py` 与 `web/js/build/adsorbates.js`：骨架段 `M5-T1`（库）、`M5-T5`（放置）、`M5-T6`（结构集成）、`M5-T7`（批量与覆盖度），每段自带 import 小块；段 `M5-T1` 内实现加载包装（Python `load_web_data`，JS `loadAdsorbateLibrary()`/`adsorbateLibrary()`）、校验、查找（id、别名、化学式、元素符号；E20 的建议）、`Adsorbate`、`adsorbate_from_structure`、`Adsorbate.to_structure`；`build/__init__.py` 段 `M5-T1` 导出；defaults 段 `M5-adsorbates`（`adsorbate_*` 全部键）。

【U 与负责人决定】U4（`to_structure` 的 `vacuum` 是总间隙、不是默认值，V-F05）；负责人决定：无直接相关项。

【文件】`crystallume/web/data/adsorbates.json`、`scripts/gen_adsorbates.py`、`crystallume/build/adsorbate.py`（新建骨架）、`crystallume/web/js/build/adsorbates.js`（新建骨架）、`crystallume/build/__init__.py#M5-T1`、`crystallume/core/defaults.py#M5-adsorbates`、`crystallume/web/js/core/defaults.js#M5-adsorbates`、`tests/test_adsorbate_library.py`、`tests/js/adsorbate_library.test.mjs`。

【测试】`test_adsorbate_library`（8 条校验、52 个条目）、`test_adsorbate_lookup`（id、别名、化学式、元素符号、E20 建议）、`test_adsorbate_frame_custom`（§3.9 规则：水、甲醇、苯、乙烯、CO2、CH4）的两语言版本；JS 在 Node 下经 `setWebData` 加载；`adsorbate_*` 键两语言相等。

【注意】测试文件名用 `test_adsorbate_library.py`（M3 已有 `tests/test_adsorbates.py`，plan.md P-02）。

#### M5-T2 二维 Delaunay 三角剖分（两语言逐行同构）（链 `w3-m5-delaunay`）

【目标】位点识别用的二维 Delaunay（周期平铺之前的平面剖分），Python 与 JS 逐行同构。

【依据】M5 §3.3（3.3.2 算法与算术顺序写死；P1）、§7.2（`test_delaunay_random`、`test_delaunay_degenerate`）、§7.3（Delaunay 单独做三角形集合完全相等的比较）；ledger-features L-M5-02（文件 `core/delaunay.py`、`web/js/core/delaunay.js`）；P2（不用 scipy）。

【实现】新文件 `crystallume/core/delaunay.py` 与 `web/js/core/delaunay.js`（蛇形插入网格 `site_order_cell` 的值由调用方传入，本模块不读 defaults）。

【U 与负责人决定】无直接相关的 U 项与负责人决定（纯几何）。

【文件】`crystallume/core/delaunay.py`、`crystallume/web/js/core/delaunay.js`、`tests/test_delaunay.py`、`tests/js/delaunay.test.mjs`。

【测试】2000 个随机点：空圆性质（抽查 300 个三角形）、三角形数 = 2n − 2 − h；12×12 正方格子 242 个三角形；蜂窝 338 点 624 个三角形；输入顺序打乱后合并结果相同；两语言对同一组点（JSON 常量）给出相同的三角形集合（跨语言比较放到 M5-T12a，本任务两边各自断言同一期望）。

#### M5-T3 基底、表面坐标系与位点原子（双语言）；sites 骨架与 slab 夹具（链 `w3-m5-frame`）

【目标】位点识别的前半部分：基底视图、表面坐标系、有限片段、位点原子的五种方法与遮挡剔除；建立 `analysis/sites.py` 与 `web/js/core/sites.js` 的分段骨架、M5 的 `site_*` 键与全模块共用的 slab 夹具。

【依据】M5 §3.1（前提、基底与表面坐标系，E1）、§3.2（位点原子：`auto` v2、exposed、layers、window、selected；遮挡剔除 D12、E14）、§3.16（E1–E3 等文案）、§4.7（`site_*` 与 `coverage_min_separation`）、§7.1（`tests/surface_fixtures.py` 与 `python -m tests.surface_fixtures --write` → `tests/data/surface/slabs/*.json`；派生夹具固定存档）；ledger-features L-M5-02（`site_atoms` 的名字，R-F06：不得把任何函数命名为 `surface_atoms`）、R-F27 与 V-F14 第 2 条（`surface_normal(s, frame=…, exclude=ads ∪ loose)`；E3 文案 `vacuum_gap_hint(s, exclude=…)`；不建基底视图来求法向）、L-X-08（删除 `coverage_translation_tolerance`）、§10.5 第 9 条；ledger-F0 R16（显示不排除吸附物）、§6 M5 第 0、1 条；M3 的 `bond_graph`、`coordination_numbers`、`find_adsorbates`、`surface_atoms`、`cluster_heights`、`periodic_components`；U1（上下表面用与显示同一个切口，U1-d）。

【实现】新文件 `crystallume/analysis/sites.py` 与 `web/js/core/sites.js`：骨架段 `M5-T3`、`M5-T4`、`M5-T11`；段 `M5-T3` 内实现 `view`、`surface_setup`、有限片段、位点原子方法、遮挡剔除与 `site_atoms`；`analysis/__init__.py` 段 `M5-sites` 导出 `site_atoms`（M5-T4 之后在同段追加其余名字）；defaults 段 `M5-sites`；`tests/surface_fixtures.py`（从原型 `slabs.py` 移植的 `pt111(n, layers)`、`cu100`、`fcc110`、`fcc211`、`bcc110`、`bcc100`、`bcc111`、`hcp0001`、`graphene`、`mos2`、`tio2_110`、`rutile_110(M)`、`ceo2_111`、`nacl_100`、`sto_001(layers, term)`、`zno_10m10`、`corundum_0001`、`supercell(s, M)` 与派生夹具）。

【U 与负责人决定】U1（上下表面用与显示同一切口；没有间隙时只给 `vacuum_gap_hint`）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/sites.py`（新建骨架）、`crystallume/web/js/core/sites.js`（新建骨架）、`crystallume/analysis/__init__.py#M5-sites`、`crystallume/core/defaults.py#M5-sites`、`crystallume/web/js/core/defaults.js#M5-sites`、`tests/surface_fixtures.py`、`tests/data/surface/slabs/`、`tests/test_sites_frame.py`、`tests/js/sites_frame.test.mjs`。

【测试】`test_sites_frame`（恰好一半原子跨边界、CONTCAR 底层 0.9999、真空沿 a、法向沿 −y：位点原子与理想 slab 相同、框架中逐位相同）、`test_sites_vacuum_with_adsorbates`（10 Å 真空两面各一个 CO 仍能建立框架）、`test_sites_methods`（五种方法在 Pt(110)、Pt(211)、TiO2(110)、CeO2(111) 上的位点原子数）、`test_sites_occlusion`（fcc(111) 4L `layers=4`、hcp(0001) `layers=3`、Cu(100) 6L `layers=3`，精确与 0.01 Å 噪声：剔除 4 个、W4）、`test_sites_supported_cluster`（Pt4/Pt(111)：台面 13 + 团簇 4；Pt4/TiO2 `include_adsorbates`）、`test_sites_gas_molecule`（6 Å 上方的 CO 被排除）、`test_sites_errors` 中 E1–E3 的文案；夹具 JSON 与函数一致。

### W3.2

位点生成与分类、放置核心（接上 M4 的默认键长）、结构集成、位点标记与 Pick site 工具、上下表面对称操作与 M3 交叉测试、参考数据校准。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w3-m5-sites` | — | M5-T4 位点生成与分类（双语言） | `crystallume/analysis/sites.py#M5-T4`、`crystallume/web/js/core/sites.js#M5-T4`、`crystallume/analysis/__init__.py#M5-sites`、`tests/surface_fixtures.py`、`tests/data/surface/slabs/`、`tests/data/surface/sites/`、`tests/ops/m5_sites.py`、`tests/js/ops/m5_sites.mjs`、`tests/test_sites.py`、`tests/js/sites.test.mjs` |
| `w3-m5-placement` | — | M5-T5 放置核心 place_adsorbate 与目标距离（双语言）；接上 M4 的默认键长 | `crystallume/build/adsorbate.py#M5-T5`、`crystallume/web/js/build/adsorbates.js#M5-T5`、`crystallume/build/__init__.py#M5-T5`、`crystallume/analysis/placement.py`、`crystallume/web/js/core/placement.js`、`tests/test_place_adsorbate.py`、`tests/js/place_adsorbate.test.mjs` |
| `w3-m5-integration` | — | M5-T6 结构集成：apply_placements、记录、命名、删除与超胞处理器（双语言） | `crystallume/build/adsorbate.py#M5-T6`、`crystallume/web/js/build/adsorbates.js#M5-T6`、`crystallume/build/__init__.py#M5-T6`、`crystallume/core/infohandlers.py#M5`、`crystallume/web/js/core/infohandlers.js#M5`、`tests/test_adsorbate_integration.py`、`tests/js/adsorbate_integration.test.mjs` |
| `w3-m5-markers` | 8841 | M5-T8 位点标记叠加层与 Pick site 工具 | `crystallume/web/js/render/sitemarkers.js`、`crystallume/web/js/render/tools/sitepick.js`、`crystallume/web/js/main.js#M5-sitepick`、`crystallume/web/css/app.css#M5-markers`、`crystallume/web/js/ui/icons.js#M5`、`tests/data/surface/sitemarkers/`、`tests/js/sitemarkers.test.mjs` |
| `w3-m5-topbottom` | — | M5-T11 上下表面对称操作 find_top_bottom_operation（双语言）、M3-T14 M3 与 M5 的交叉测试 | `crystallume/analysis/sites.py#M5-T11`、`crystallume/web/js/core/sites.js#M5-T11`、`crystallume/analysis/__init__.py#M5-topbottom`、`tests/test_top_bottom.py`、`tests/js/top_bottom.test.mjs`、`tests/test_sites_m3_cross.py` |
| `w3-m5-calibration` | — | M5-T13 参考数据与吸附物系数校准 | `crystallume/web/data/adsorbates.json`、`tests/data/surface/adsorb/reference.json`、`scripts/calibrate_adsorbates.py`、`tests/test_adsorbate_reference.py` |

**合并顺序**：`w3-m5-sites` → `w3-m5-topbottom` → `w3-m5-integration` → `w3-m5-placement` → `w3-m5-calibration` → `w3-m5-markers`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M5-T4：`tests/test_sites.py`、`tests/js/sites.test.mjs` 通过；M5 §7.3 原型位点表的全部计数与类标签；`test_sites_invariance` 含 (0, ½)、(¼, ½)、(½, ½) 平移与空位用例（负责人决定 L-03）；多元素摘要 `4 site atoms (Ti2O2)`（L-09）
- 验收（Python 与 JS 的单元测试）：S1-5、S2-4、S3-3、S4-3/S4-4、S5-3、S6-4/S6-5、S7-3、S8-5、S8-7（G-15 已按 L-03 修正，不再 xfail）、S9-6、S10-5、S11-5、S12-3、S13-3、S13-5
- M5-T5：`tests/test_place_adsorbate.py` 通过；高度一律按 M5 §3.10 的式子从 `adsorbates.json` 读系数现算（L-15）；`test_m4_m5_single_atom_height`（≤ 1e-9 Å，R-F11）与 `test_m4_default_bond_from_library`（L-05）通过；验收 S1-6（S1-6′ 式）、S2-5、S3-4、S4-5、S5-4/S5-4′/S5-5/S5-6、S6-6–S6-8、S7-4、S13-4
- M5-T6：`tests/test_adsorbate_integration.py` 通过（R-ADS、插入顺序 Pt×36, C, C, O, O、记录无 `firstAtom`、名字只用 `autoName`（L-12）、超胞复制记录）；验收 S1-8、S1-9、S1-10（Python 导出）
- M5-T11/M3-T14：`tests/test_top_bottom.py` 与 `tests/test_sites_m3_cross.py` 通过；验收 S9-7
- M5-T13：`tests/data/surface/adsorb/reference.json` 每项带出处；`adsorbates.json` 的 8 条校验仍通过
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`；位点标记（夹具 SiteSet）按类型显示形状，PNG 默认不含标记

#### M5-T4 位点生成与分类（双语言）（链 `w3-m5-sites`）

【目标】位点识别的后半部分：周期平铺、外接圆心合并、归属与自检、过滤、微面三重位、按类的接近方向、子类型与标签、指纹与分类、组成与颜色、已占用与邻近吸附物、`assign_sites`、`nearest_sites`、`site_presets`、`SiteSet` 与序列化。

【依据】M5 §3.3.1、§3.3.3、§3.4–3.8、§3.15、§3.16、§4.8（`crystallume.sites/1`）、§5.2 的摘要写法、§7.1（金标格式改用 `crystallume.cases/1`，plan.md P-03）、§7.2（`test_sites_counts`、`test_sites_invariance`、`test_sites_microfacet`、`test_subtype_v2`、`test_local_normal_class`、`test_classify_order`、`test_labels_stable_after_placement`、`test_sites_vacancy`、`test_sites_adsorbates_and_occupancy`、`test_fingerprint_boundary`、`test_assign_sites`）、§7.3（原型位点表；类序与 `#n` 由按规格写的实现重新生成）；ledger-features L-M5-02（导出名单：`adsorption_sites`、`site_atoms`、`find_sites`、`assign_sites`、`site_presets`、`SiteSet`、`Site`、`SiteClass`）、L-M5-03（**[新]** `nearest_sites(site_set, points)`，供 M6 的配位记录用，负责人决定 L-07）、§10.5 第 4、5 条；负责人决定 L-03（桥位保留判据改用键图近邻距离，平铺与归属之前把表面原子平移到规范原点）、L-09（多元素表面 `4 site atoms (Ti2O2)`）、L-14（"hollow 的所有边界边在键图中相连"即启用局部法向，以 M5 §3.5 为准）；M5-T2 的 Delaunay、M5-T3 的框架；M1 `gauss_reduce_2d`（缺省 `"obtuse"`）。

【实现】`analysis/sites.py` 与 `web/js/core/sites.js` 的段 `M5-T4`；`analysis/__init__.py` 段 `M5-sites` 追加导出；金标 `tests/data/surface/sites/*.json`（op `adsorptionSites`）与两语言 op 文件；按需扩展 `tests/surface_fixtures.py` 与 `tests/data/surface/slabs/`。

【U 与负责人决定】U1；负责人决定 L-03、L-07（`nearest_sites`）、L-09、L-14。

【文件】`crystallume/analysis/sites.py#M5-T4`、`crystallume/web/js/core/sites.js#M5-T4`、`crystallume/analysis/__init__.py#M5-sites`、`tests/surface_fixtures.py`、`tests/data/surface/slabs/`、`tests/data/surface/sites/`、`tests/ops/m5_sites.py`、`tests/js/ops/m5_sites.mjs`、`tests/test_sites.py`、`tests/js/sites.test.mjs`。

【测试】上列 M5 §7.2 的位点测试全部；`test_sites_invariance` 加 (0, ½)、(¼, ½)、(½, ½) 平移与空位用例；TiO2(110) 2×1 去掉一个 O_br：Ti 分为 1 + 2 + 1、空位处 `short bridge (Ti2)`；acceptance 的位点检查 S1-5…S13-5（见本批次出口检查）。

#### M5-T5 放置核心 place_adsorbate 与目标距离（双语言）；接上 M4 的默认键长（链 `w3-m5-placement`）

【目标】双语言的放置核心 `place_adsorbate`（纯函数，返回 `Placement`）与目标距离 `adsorbate_target_distance`，并把 M4 `site_point` 的缺省键长接到吸附物库（负责人决定 L-05）。

【依据】M5 §3.9（框架约定、位点框架与取向）、§3.10（有效半径 K9：slab 金属–金属键长中位数的一半；目标距离：环境键、阴离子下限、`pairBondLengths`；接触抬升；bond/height 模式；双齿与平躺）、§3.11（冲突 W1–W5）、§3.16、§6.1/§6.2 的放置部分；ledger-features L-M5-05（`place_adsorbate(slab, adsorbate, height=None, position=None, *, site=None, frac=None, mode=None, side="top", bond_length=None, bond_factor=None, rotation=0.0, tilt=0.0, binding=None, mol_index=None, keep_orientation=None, sites=None, clash=None, frame=None) -> Placement`；键长参数一律 `bond_length`/`bondLength`，`distance` 只指位点偏移；**[新]** `adsorbate_target_distance(structure, element, atom, *, site_kind="top", mode=None, library=None) -> dict | None`）、L-M4-05（M4 `site_point` 的默认键长：库里的单原子元素逐个接触原子取 `adsorbate_target_distance(...)["distance"]`，`site_kind` 由所选原子数定（1 → top、2 → bridge、≥ 3 → hollow），读数 `bond 1.94 Å (adsorbate library)`；一致性 `test_m4_m5_single_atom_height`：同一位点同一键长两者高度差 ≤ 1e-9 Å）、R-F11、§10.5 第 4 条；负责人决定 L-05、L-15（测试按 M5 §3.10 的式子从 `adsorbates.json` 读系数现算，不抄数字）；M5 §9 允许本任务先用手写位点（不依赖 M5-T4 的输出）。

【实现】`build/adsorbate.py` 与 `web/js/build/adsorbates.js` 的段 `M5-T5`；`build/__init__.py` 段 `M5-T5` 导出；在 M4 的 `analysis/placement.py` 与 `web/js/core/placement.js` 里只改 `site_point` 取缺省键长的一处（调用 `adsorbate_target_distance`，库里没有的元素保留共价半径一支与读数 `(covalent radii)`）。

【U 与负责人决定】U5（D2）；负责人决定 L-05、L-15。

【文件】`crystallume/build/adsorbate.py#M5-T5`、`crystallume/web/js/build/adsorbates.js#M5-T5`、`crystallume/build/__init__.py#M5-T5`、`crystallume/analysis/placement.py`、`crystallume/web/js/core/placement.js`、`tests/test_place_adsorbate.py`、`tests/js/place_adsorbate.test.mjs`。

【测试】`test_place_analytic`（O/Pt(111) fcc、CO top、O/Cu(100) hollow，±1e-4，按有效半径现算）、`test_place_modes`、`test_place_bidentate`/`test_place_flat`、`test_place_env`、`test_slab_radii`（Pt 1.386、Cu 1.278、Ru 1.353、W 1.370 ± 1e-3；Ti 1.288）、`test_anion_floor`、`test_place_lift`/`test_place_fallback`、`test_clash`、`test_w5_coads`、`test_ase_compat`（`add_adsorbate(slab, mol, 1.8, "fcc", mol_index=0)` 不转动分子；ASE 形式的位置参数由 M5-T6 的 `add_adsorbate` 提供时在那边测）、`test_format_decimal`、`test_m4_m5_single_atom_height`（Pt(111) top/bridge/fcc/hcp 与 Cu(100) 4 重位）、`test_m4_default_bond_from_library`（O 在 Cu(100) 4 重位、H 在 Pt(111) fcc，M4 与 M5 同一高度）。

#### M5-T6 结构集成：apply_placements、记录、命名、删除与超胞处理器（双语言）（链 `w3-m5-integration`）

【目标】把放置结果写进结构：`apply_placements`（R-ADS、按块插入、一次 remap、源映射）、`info.surface.adsorbates` 记录（`definition`、孤儿回收）、自动名、`remove_adsorbates` 与部分删除、多帧；`add_adsorbate` 便捷函数；在 info 处理器注册表里注册 `surface.adsorbates`（M1 的超胞、原胞时复制/改写记录）。

【依据】M5 §4.3–4.6；ledger-features L-M5-05（`apply_placements(slab, placements) -> AdsorbResult`（原位；`{src, ids, records, warnings, new_atoms}`）的步骤：`promote_adsorbates` → 每个放置一个 id（从 `next_adsorbate_id`）→ 一次 `_remap` 插入（`added_props` 写 `adsorbate_id`、`tags`（键存在时 0，`tags_convention == "oc20"` 时 2）、`initial_magmoms`（键存在时））→ 原来按元素分块时 `sort_by_species()` → `mark_edited(s, "atoms")` → 追加记录（没有 `info.surface` 时建 `{version: 2, kind: "adsorbates", autoName: 原名, adsorbates: []}`）→ 回收孤儿记录 → `refresh_auto_name(s, before)`；`remove_adsorbates(slab, ids=None)`；多帧 Python 先 `keep_frame(frame)` 写备注；`add_adsorbate(slab, adsorbate, height=None, position=None, *, both_sides=False, **placement)` 含 ASE 形式）、L-X-04（记录字段，**没有 `firstAtom`**；超胞时按像复制记录，id 加 `q·V`，`site.point` 加该像的平移，`frac` 按新晶胞重算；原胞用 `id_map`）、L-X-05、L-X-07、L-M1-14（处理器注册在 `core/infohandlers.*` 的段 `M5`，静态注册）、R-F10、R-F11、R-F15、R-F21（标记吸附物用 M3 的 `mark_adsorbates`，M5 没有 `mark_adsorbate`/`edit.markAdsorbate`/`adsorbate.mark`）、§10.5 第 1、6 条；负责人决定 L-12（只用 `autoName`；M5 v2 写的 `info.surface.name` 与 v1 的 `baseName` 作废）；ledger-F0 §6 M5 第 5 条；C4、C7、C11。

【实现】`build/adsorbate.py` 与 `web/js/build/adsorbates.js` 的段 `M5-T6`；`build/__init__.py` 段 `M5-T6` 导出；`core/infohandlers.py`、`web/js/core/infohandlers.js` 的段 `M5`。本任务的放置输入用 `Placement` 对象（M5 §6.1 的字段），测试里手写，不依赖同批 M5-T5 的计算。

【U 与负责人决定】U5（D2：放吸附物原位修改 slab）；负责人决定 L-12（只用 `autoName`）。

【文件】`crystallume/build/adsorbate.py#M5-T6`、`crystallume/web/js/build/adsorbates.js#M5-T6`、`crystallume/build/__init__.py#M5-T6`、`crystallume/core/infohandlers.py#M5`、`crystallume/web/js/core/infohandlers.js#M5`、`tests/test_adsorbate_integration.py`、`tests/js/adsorbate_integration.test.mjs`。

【测试】`test_props_and_info`、`test_promote_on_first_place`（CONTCAR + 没有 id 的 CO：放一个 O 后旧 CO id 1、新 O id 2，基底位点不变）、`test_insertion_order`（Pt(111) 放两个 CO → symbols Pt×36, C, C, O, O；POSCAR 无 Export note；不分块的 slab 追加在末尾；`src` 正确）、`test_adsorbate_naming`（改用 `autoName`：后缀、删除后恢复、用户改名后不再改、`CONTCAR + CO`）、`test_partial_deletion`、`test_poscar_roundtrip`（CO 两行 `T T T`、底层 `F F F`，按空白切分比较）、`test_extxyz_roundtrip`、`test_multiframe`（W9）、`test_supercell_copies_records`（M1 超胞 2×2×1 后记录 ×4、id 与 `site.point` 正确，名字 `… 2×2×1 + 4CO`）；验收 S1-8、S1-9、S1-10 的 Python 部分。

#### M5-T8 位点标记叠加层与 Pick site 工具（链 `w3-m5-markers`）

【目标】位点标记（按类型的形状与颜色、悬停与选中状态、按显示复制与拾取映射）与 Pick site 工具；它们不依赖 Adsorbates 分区，分区在 W3.3 接上。

【依据】M5 §5.3（形状：top 球半径 0.28 Å；bridge 沿桥轴的短棒长 0.7 Å、半径 0.10 Å；hollow 位点平面内的正 k 边形薄片外接圆半径 0.32 Å，k > 6 时画圆；位置 `point + site_marker_height·normal`，由 `drawnCopies(points, model, {repeat: true})` 按显示包裹与显示超胞复制；每类一个 `InstancedMesh`；Select 工具下标记不可拾取；Pick site：单击 = 选位点（`click` 返回 true）、Shift+单击 = 多选、双击 = 放置（`overlaydblclick`）、右键 = 标记菜单（`overlaycontext`）、Esc 回到 Select；悬停 ×1.5、选中加白色描边环、已占用 40% 不透明度；副本总数 > 100 000 时只拾取 (0, 0) 像；导出 `marker`）、§5.9；ledger-features L-M5-09（`viewer.overlays.add({ id: 'adsorption-sites', tier: 'top', export: 'marker', pickable: true, pickIn: ['site-pick'], … })`；`tools.register({ id: 'site-pick', icon: 'target', toolbar: false, selects: false, cursor: 'crosshair', touch: 'claim', … })`）；ledger-F0 §6 M5 第 2、3 条（`handler.hover(hit, e)`、`click(e, hit) → boolean`、`claims: () => false`；`markerLayer({ tier: 'top', export: 'marker', pickIn: ['site-pick'] })`；先用 `markerLayer` 交付球形版本也可以）、L-F0-37/38/40/41；M5-T3 的 `site_marker_height` 键。

【实现】新文件 `web/js/render/sitemarkers.js`（`showSiteMarkers(app, siteSet, opts)`、`hideSiteMarkers(app)`、实例数据与颜色、拾取映射）、`web/js/render/tools/sitepick.js`（工具与回调注册 `setSitePickHandlers({ onSelect, onPlace, onContext, onHover })`，M5-T9a 设置这些回调）；`main.js` 段 `M5-sitepick`；样式放 `css/app.css` 段 `M5-markers`（悬停提示等）；需要新图标时放 `ui/icons.js` 段 `M5`（`target` 由 F0-A 提供）；夹具 `tests/data/surface/sitemarkers/pt111_p3x3.sites.json`（手写的 `crystallume.sites/1`）。

【U 与负责人决定】U1（标记不表示 slab）；负责人决定：无直接相关项。

【文件】`crystallume/web/js/render/sitemarkers.js`、`crystallume/web/js/render/tools/sitepick.js`、`crystallume/web/js/main.js#M5-sitepick`、`crystallume/web/css/app.css#M5-markers`、`crystallume/web/js/ui/icons.js#M5`、`tests/data/surface/sitemarkers/`、`tests/js/sitemarkers.test.mjs`。

【测试】`tests/js/sitemarkers.test.mjs`：从 SiteSet 生成的实例数据（每类数量、形状参数）、副本到位点下标的映射、解析射线–球求交的拾取、> 100 000 副本时只拾取 (0, 0) 像、单击/双击/右键的回调分派（不依赖 WebGL）。

【界面检查】（Chromium，本链端口）载入 Pt(111) p(3×3) 4L 夹具，在控制台 `(await import('/js/render/sitemarkers.js')).showSiteMarkers(crystallume.app, <夹具 SiteSet>)`：top 球、bridge 棒、fcc/hcp 三角片出现在表面上方，颜色按类；显示超胞 2×2×1 时标记一起复制；悬停放大；切到 site-pick 工具（`crystallume.app.setTool('site-pick')` 或 F0-A 的等价调用）后单击选中位点（白色描边）、双击触发 `onPlace` 回调（打印日志）；Select 工具下点击表面原子照常选原子；默认导出 PNG 不含标记，勾选 `Include markers` 后才含。截图存 `scratchpad/shots/w3-m5-markers/`。

#### M5-T11 上下表面对称操作 find_top_bottom_operation（双语言）（链 `w3-m5-topbottom`）

【目标】找出把 slab 上表面映到下表面的对称操作（Both sides 放置、两面覆盖度用）。

【依据】M5 §3.13（表面坐标系、只用基底、剪枝、缓存键；M2 本期不提供，K11）、§7.2 `test_both_sides` 的算法部分、§7.3 末段（`checks_tb.py` 的期望：Pt(111) 4L、绕 x 转 90°、顶面有 CO（只用基底）、SrTiO3 TiO2 7L、TiO2(110)、CeO2(111) → inversion；MoS2 → mirror；SrTiO3 6L → none）；ledger-features L-M5-04；M1 `gauss_reduce_2d`；M5-T3 的框架。

【实现】`analysis/sites.py` 与 `web/js/core/sites.js` 的段 `M5-T11`；`analysis/__init__.py` 段 `M5-topbottom` 导出 `find_top_bottom_operation`。

【U 与负责人决定】U1（只用基底，切口与显示同一个）；负责人决定：无直接相关项。

【文件】`crystallume/analysis/sites.py#M5-T11`、`crystallume/web/js/core/sites.js#M5-T11`、`crystallume/analysis/__init__.py#M5-topbottom`、`tests/test_top_bottom.py`、`tests/js/top_bottom.test.mjs`。

【测试】上面的 8 个场景两语言；216 原子 ≤ 5 ms（JS）/ ≤ 0.1 s（Python）的粗测（正式预算在 M5-T14）。

#### M3-T14 M3 与 M5 的交叉测试（链 `w3-m5-topbottom`）

【目标】在 M5 的场景表上逐项核对 M3 被 M5 依赖的三个函数。

【依据】M3 §9 T14（`surface_atoms` 的 `exposed` 方法、`find_layers(s, "normal", skip_adsorbates=True)`、`bond_graph(metal_pairs="smart")` 在 M5 的场景表上逐项核对）、§3.7–3.9；M5 §3.2（`exposed` 方法与 M3 的关系）、§7.1 的夹具；ledger-features R-F06、L-M3-03/05。

【实现】`tests/test_sites_m3_cross.py`：读 `tests/surface_fixtures.py` 的全部夹具，断言 M5 的 `site_atoms(method="exposed")` 与 M3 `surface_atoms` 一致、M5 的层号与 M3 `find_layers(s, "normal", skip_adsorbates=True)` 一致、smart 配位数一致。

【U 与负责人决定】U1；负责人决定：无直接相关项。

【文件】`tests/test_sites_m3_cross.py`。

【测试】即上。

#### M5-T13 参考数据与吸附物系数校准（链 `w3-m5-calibration`）

【目标】吸附物库的参考数据（每个条目的 CCCBDB 页面与核对表）、金属与氧化物表面的参考键长（带出处），以及据此校准的 `cation` 系数与 `pairBondLengths`。

【依据】M5 §9 T13、§3.10（系数的含义）、§4.1（条目字段）；ledger-features L-M5-01；负责人决定 L-15（测试不抄数字：本任务改系数不会破坏 M5-T5 的测试，因为它们读 `adsorbates.json` 现算；acceptance 里"当前库系数下"的数字只是示例）；P2（开发期脚本不进包、测试不依赖）。

【实现】`tests/data/surface/adsorb/reference.json`（Pt、Ru、Cu、Ag、Fe 或 W，与 TiO2、RuO2 或 CeO2 的参考键长，每项带来源）；`scripts/calibrate_adsorbates.py`（开发期运行；M5-T5 合入前用 v2 原型 `scratchpad/proto/m5v2/v2place.py` 计算，误差表写进报告，不写成仓库里的报告文件）；更新 `crystallume/web/data/adsorbates.json` 的系数与几何（保持 52 个条目与 8 条校验）。

【U 与负责人决定】U6（系数取值由负责人按校准结果定案）；负责人决定 L-15。

【文件】`crystallume/web/data/adsorbates.json`、`tests/data/surface/adsorb/reference.json`、`scripts/calibrate_adsorbates.py`、`tests/test_adsorbate_reference.py`。

【测试】`tests/test_adsorbate_reference.py`：`reference.json` 的每项有来源与数值；`adsorbates.json` 仍通过 M5-T1 的校验。

### W3.3

批量放置与覆盖度；Adsorbates 分区的位点、吸附物与放置三块；性能与第一轮跨语言平价。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w3-m5-coverage` | — | M5-T7 批量放置、两面、覆盖度与 1/n 超胞、批量生成（双语言） | `crystallume/build/adsorbate.py#M5-T7`、`crystallume/web/js/build/adsorbates.js#M5-T7`、`crystallume/build/__init__.py#M5-T7`、`tests/test_adsorbate_batch.py`、`tests/js/adsorbate_batch.test.mjs` |
| `w3-m5-panel` | 8842 | M5-T9a Surface › Adsorbates 分区（一）：Sites、Adsorbate、Placement 三块与命令 | `crystallume/web/js/ui/panels/surface-adsorbates.js`、`crystallume/web/js/main.js#M5-adsorbates`、`crystallume/web/css/app.css#M5-panel`、`tests/js/adsorbates_ui.test.mjs` |
| `w3-m5-perf` | — | M5-T14 M5 性能：向量化与基准 | `crystallume/analysis/sites.py`、`crystallume/web/js/core/sites.js`、`crystallume/build/adsorbate.py#M5-T5`、`crystallume/web/js/build/adsorbates.js#M5-T5`、`tests/test_sites_perf.py`、`tests/js/perf/sites.perf.mjs` |
| `w3-m5-parity` | — | M5-T12a M5 跨语言平价（一）与 M2 集成金标 | `tests/test_m5_parity.py`、`tests/data/surface/sites_m2/`、`tests/ops/m5_parity.py`、`tests/js/ops/m5_parity.mjs` |

**合并顺序**：`w3-m5-coverage` → `w3-m5-perf` → `w3-m5-parity` → `w3-m5-panel`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M5-T7：`tests/test_adsorbate_batch.py` 与 JS 对应测试通过；`count=N` 为本次新增 N 个（负责人决定 L-18）；覆盖度的 1×1 胞来自 `reference_mesh(s, exclude=…)`、`source` 为 `record` 而不是 `info`（R-F17）；验收 S1-7、S2-6、S2-7、S3-5、S9-7
- M5-T12a：`tests/test_m5_parity.py` 通过（位点类表与每个位点的字段、`place_adsorbate`、`apply_placements`、`find_top_bottom_operation`、`assign_sites`、Delaunay 三角形集合；比较排除 `bulk.name`，L-11）；M2 集成金标（用 `build.surface` 生成的 slab 与夹具版位点计数相同）
- M5-T14：`pytest -m slow tests/test_sites_perf.py tests/test_js_perf.py` 在 M5 §7.5 的 3 倍预算内；验收 S16-2、S16-3（位点与放置部分）
- 界面：Adsorbates 分区 Find sites → `9 site atoms (Pt) · 54 sites in 4 classes`；类列表 `aria-label` 为 `top (Pt), 9 sites` 等；选 CO 与 fcc 类后读数与 `placeAdsorbate` 一致（±0.005）；Place → toast `Added CO on fcc (Pt3)`，一步撤销；放置前后 Delete 与 Export 一直可用（没有预览会话，K14）；Pick site 双击放置
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M5-T7 批量放置、两面、覆盖度与 1/n 超胞、批量生成（双语言）（链 `w3-m5-coverage`）

【目标】`plan_adsorbates`（所有等价位点、填充到覆盖度、阻塞跳过、`count`）、两面放置、`add_adsorbates`、覆盖度 `adsorbate_coverage` 与 `coverage_supercells`、批量生成 `adsorption_structures`（应该：`substitution_structures`、`vacancy_structures`）。

【依据】M5 §3.12（3.12.1 所有等价位点与跳过；3.12.2 填充：种子 = 已有吸附物，逐个取 `argmax dmin`，平局取位点序最小者，低于 `min_separation` 时停止并给 W8；3.12.4 批量生成）、§3.14（覆盖度 K12：分母为 1×1 胞）、§6.1/§6.2 对应部分；ledger-features L-M5-05（`plan_adsorbates(slab, adsorbate, *, site_class=None, sites=None, coverage=None, count=None, per="cell", cells=None, min_separation=None, skip_occupied=True, skip_blocked=True, both_sides=False, mirror_existing=False, **placement) -> Plan`；`add_adsorbates(slab, adsorbate, **plan)`；**[新]** `count=N` 是本次新增 N 个，与 `all`、`coverage`、`each` 互斥（E24），负责人决定 L-18）、L-M5-06（1×1 胞一律 `reference_mesh(s, exclude=吸附物 ∪ 漂浮片段)`，`N_cells = |det K|`；`source` ∈ `user`/`record`/`interface`/`translations`/`current`；`current` 且位点原子数 > 1 时提示 `Is this the 1×1 cell? Enter the number of 1×1 cells if not.`；1/n 超胞候选 `hnf_matrices_2d(n)`、点群去重、`gauss_reduce_2d`、`wood_label`；只有 `P = M_red · K⁻¹` 为整数时 `applicable`）、L-M5-07（批量结构的名字 `… + CO@fcc (Pt3)`、`… Au@top (Pt) CN 7`、`… vac@top (O)`，`info.surface.autoName = null`）、L-X-07、R-F17；M5-T11 的 `find_top_bottom_operation`。

【实现】`build/adsorbate.py` 与 `web/js/build/adsorbates.js` 的段 `M5-T7`；`build/__init__.py` 段 `M5-T7` 导出。

【U 与负责人决定】U5（D2）、P4（批量生成的是新结构）；负责人决定 L-18。

【文件】`crystallume/build/adsorbate.py#M5-T7`、`crystallume/web/js/build/adsorbates.js#M5-T7`、`crystallume/build/__init__.py#M5-T7`、`tests/test_adsorbate_batch.py`、`tests/js/adsorbate_batch.test.mjs`。

【测试】`test_plan_skip_blocked`（top 位有 CO 时 O 放 9 个 fcc：放 6 个、skipped 3；`skip_blocked=False` 放 9 个）、`test_both_sides`（Pt(111) 4L 上下 O 等高且仍有反演；绕 x 转 90° 同样可用；顶面已有 CO 时 W15；SrTiO3 6L → E14）、`test_coverage_theta`、`test_coverage_fill`（Cu(100) p(2×2) θ = 0.5 → 两个 O 相距 3.615；Pt(111) p(2×2) θ = 0.5、min sep 3.0 → 1 个 + W8；已有吸附物作种子）、`test_coverage_supercells`（方格 n = 2/4/8/9、六方 n = 3/7；p(3×3) slab 上 n = 3 的 √3 项 `applicable = false`）、`test_adsorption_structures`、`test_count_adds_n`（L-18：S1 上 `count=1` 总是新增 1 个）；验收 S1-7、S2-6、S2-7、S3-5、S9-7。

#### M5-T9a Surface › Adsorbates 分区（一）：Sites、Adsorbate、Placement 三块与命令（链 `w3-m5-panel`）

【目标】Adsorbates 分区的前三块（Sites、Adsorbate、Placement）、幽灵预览、位点标记与 Pick site 的接线、命令与公共 API 的单个放置部分（Coverage 与 Placed 列表、批量操作在 W3.4 的 M5-T9b）。

【依据】M5 §5.1、§5.2、§5.4、§5.5（"Place on all equivalent sites" 由 M5-T9b 做）、§5.7、§5.8（本任务的命令：`sites.find`、`adsorbate.add`、`tool.sitePick`、`sites.toggle`、`adsorbate.select`、`adsorbate.remove`、`adsorbate.fromSelection`；右键菜单与选区动作（选区动作 order 取 77–79，plan.md P-11）；原子信息）、§5.9、§5.10（缓存与失效，`EditResult.map` 重映射）；ledger-features L-M5-09（`registerPanelSection('surface', { id: 'adsorbates', order: 40 })`；位点摘要按负责人决定 L-09；悬停与选中位点的幽灵用 `ghostLayer`，**不开会话**；吸附目标 `crystallume.tools.get('move').registerSnapTargets`；`sites` 只是 `app` 的内部事件，不改 `api/public.js`，R-F26；**没有** `adsorbate.mark` 与 `edit.markAdsorbate`，分区里的 "Mark as adsorbate" 调用 M3 的 `sel.markAdsorbate`，R-F21；公共 API（`defineApi`，owner `M5`）本任务注册 `build.adsorbates()`、`build.adsorbate(name, { mode })`、`analysis.sites(s?, opts)`、`analysis.assignSites(s?, opts)`、`edit.addAdsorbate(name | Adsorbate, opts)`、`edit.removeAdsorbates(ids?)`、`surface.showSites(on, opts)`）、R-F31（`registerBootTask('adsorbates', loadAdsorbateLibrary)`；失败不阻止启动，分区显示原因与 Retry）；ledger-F0 §6 M5 第 4、6、7、8 条（放置用 `editActive(..., { singleFrame: true })`）、L-F0-49/50（`requireCell`、`requireVacuumGap`、`emptyActions`、`registerSelectionAction`、`registerAtomInfo`）；M5-T8 的 `sitemarkers.js`/`sitepick.js`；U1（`available()` 只说缺什么，不说"不是 slab"）、U5（原位修改 slab，要保留原 slab 用 Duplicate）、P3。

【实现】新文件 `web/js/ui/panels/surface-adsorbates.js`（本任务实现分区注册、三块、命令、`defineApi`、启动任务、吸附目标、原子信息行与选区动作；Coverage 与 Placed 两块留空壳给 M5-T9b）；`main.js` 段 `M5-adsorbates`；样式放 `css/app.css` 段 `M5-panel`。快捷键 Shift+S（`sites.toggle`）、Shift+A（`adsorbate.add`）按提议注册，M7 在 W5.1 复核冲突。

【U 与负责人决定】U1、U5（D1、D2）、P3；负责人决定 L-09；Shift+A、Shift+S 由 M7 复核。

【文件】`crystallume/web/js/ui/panels/surface-adsorbates.js`、`crystallume/web/js/main.js#M5-adsorbates`、`crystallume/web/css/app.css#M5-panel`、`tests/js/adsorbates_ui.test.mjs`。

【测试】`tests/js/adsorbates_ui.test.mjs`：摘要与类列表 `aria-label` 文案（含多元素 `4 site atoms (Ti2O2)`）、读数 `C–Pt 2.10 Å · 1.36 Å above the site` 的格式（数字由 `placeAdsorbate` 现算）、缓存键与失效规则、命令参数校验与 `whyNot`。

【界面检查】（Chromium，本链端口）E2E-1 第 9–10 步：Pt(111) p(3×3) 4L 切面后 Adsorbates › Find sites → 摘要 `9 site atoms (Pt) · 54 sites in 4 classes`、类列表 4 项；搜索 `CO` 选 `CO  Carbon monoxide`、`Binding` 为 `C-down (η1-C)`；点类 `fcc (Pt3)` → Placement 读数与 `(await import('/js/build/adsorbates.js')).placeAdsorbate(…)` 一致（±0.005）、幽灵 CO 出现；此时 Delete 与 Export 菜单可用；Place → toast `Added CO on fcc (Pt3)`、撤销标签 `Undo Add CO`、名字 `Pt(111) p(3×3) 4L + CO`；Undo 后打开 Pick site，双击一个 top 标记 → 直接放置（`Added CO on top (Pt)`），单击另一个标记只选中位点；没有晶胞/没有真空的结构上分区就地说明原因。截图存 `scratchpad/shots/w3-m5-panel/`。

#### M5-T14 M5 性能：向量化与基准（链 `w3-m5-perf`）

【目标】让位点识别与放置达到 M5 §7.5 的预算：Python 向量化（共用键图、网格查询、上下对称操作的逐原子核对），JS 1 万原子全流水线基准，弛豫结构基准。

【依据】M5 §3.15、§7.5（预算表；只断言 3 倍预算以内；Python 端为了预算必须：配位数与有效半径共用一次键图；指纹、子类型、遮挡用网格查询；Delaunay 用边距筛选后的点；上下对称操作的逐原子核对向量化）；acceptance S16-2、S16-3、S16-7；plan.md P-10。

【实现】只在 `analysis/sites.py`、`web/js/core/sites.js`（本批次整份归本链）与 `build/adsorbate.*` 的段 `M5-T5` 内优化，不改接口与结果（优化前后在全部金标上逐项相同）；`tests/test_sites_perf.py`（`slow`）；`tests/js/perf/sites.perf.mjs`（由 `tests/test_js_perf.py` 收集）。

【U 与负责人决定】无直接相关的 U 项与负责人决定（只做不改结果的优化）。

【文件】`crystallume/analysis/sites.py`、`crystallume/web/js/core/sites.js`、`crystallume/build/adsorbate.py#M5-T5`、`crystallume/web/js/build/adsorbates.js#M5-T5`、`tests/test_sites_perf.py`、`tests/js/perf/sites.perf.mjs`。

【测试】预算：Pt(111) p(6×6) 6L 216 原子找位点 JS ≤ 30 ms / Python ≤ 0.3 s；约 1 万原子（p(40×40) 6L）JS ≤ 400 ms / Python ≤ 4 s；弛豫 1 万原子 JS ≤ 800 ms / Python ≤ 8 s；单次放置 JS ≤ 2 ms / Python ≤ 20 ms；1600 个位点 × CO JS ≤ 300 ms；上下对称操作 1 万原子 JS ≤ 100 ms / Python ≤ 2 s；实测数字写进报告。

#### M5-T12a M5 跨语言平价（一）与 M2 集成金标（链 `w3-m5-parity`）

【目标】M5 已交付核心（位点、放置、集成、上下对称操作、归属、Delaunay）的跨语言平价，以及用 M2 `build.surface` 生成的 slab 做的集成金标。

【依据】M5 §7.3（比较规则：类表（顺序、标签、kind、fold、subtype、composition、count、color、localNormal、context）完全相等；每个位点的 `ensemble`、`images`、`occupied` 完全相等，`point`、`position`、`normal`、`frac` 差 ≤ 1e-6；`place_adsorbate` 的 `positions` ≤ 1e-6 Å、`height`、`warnings` 字符串相等；`apply_placements` 后的 symbols、props、记录、名称完全相等；`find_top_bottom_operation`、`assign_sites` 完全相等；Delaunay 三角形集合完全相等；一次 Node 进程批量）、§7.1 末句（M2 交付后加一组集成金标：用 `build.surface` 生成同样的 slab，断言位点计数与夹具版相同）；ledger-features §10.0 第 9 条（排除 `bulk.name`，L-11）；plan.md P-02、P-03。

【实现】`tests/test_m5_parity.py`；集成金标 `tests/data/surface/sites_m2/*.json`（配方调用 `build.surface`，显式晶格常数按 acceptance §0.4）与它的 ops `tests/ops/m5_parity.py`、`tests/js/ops/m5_parity.mjs`。

【U 与负责人决定】U1；负责人决定 L-11（排除 `bulk.name`）。

【文件】`tests/test_m5_parity.py`、`tests/data/surface/sites_m2/`、`tests/ops/m5_parity.py`、`tests/js/ops/m5_parity.mjs`。

【测试】即上。两语言不一致时不改期望：在报告里写明偏离规格的一边。

### W3.4

Adsorbates 分区的 Coverage、Placed 列表与批量操作；M5 的 REST/客户端/CLI；第二轮平价。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w3-m5-panel2` | 8843 | M5-T9b Surface › Adsorbates 分区（二）：Coverage、Placed adsorbates 与批量操作 | `crystallume/web/js/ui/panels/surface-adsorbates.js`、`crystallume/web/css/app.css#M5-panel`、`tests/js/adsorbates_ui2.test.mjs` |
| `w3-m5-api` | — | M5-T10a M5 的 REST、客户端与 CLI（sites、adsorb） | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py` |
| `w3-m5-parity2` | — | M5-T12b M5 跨语言平价（二）：批量与覆盖度 | `tests/test_m5_parity.py` |

**合并顺序**：`w3-m5-api` → `w3-m5-parity2` → `w3-m5-panel2`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M5-T10a：`/analysis/sites`（登录）、`/build/adsorbate`（公开；需要位点识别或对称操作的请求在云模式下需登录，K17）、`GET /build/adsorbates` 在 `ROUTE_METHODS` 中；新模型 `extra="forbid"`；CLI `crystallume sites`、`crystallume adsorb`（`--count` 帮助按 L-18、`--site-index`）通过；acceptance S1 的 CLI 序列（按 R-F13 改写）stderr 无 `crystallume: warning:`
- M5-T12b：`tests/test_m5_parity.py` 的批量与覆盖度部分通过
- 界面：Coverage 块 `θ = 0.22 ML (per 1×1 cell) · 0.22 per site atom`；Fill to θ 0.22 → `Added 1 CO (θ = 0.22 ML per 1×1 cell)`（S1-7）；`Place on all 9 equivalent sites` 的计数与跳过 toast；Cells for 1/n coverage n = 3 在 Ag(111) p(1×1) 上 `(√3×√3)R30°` 的 Apply 一步撤销（S3-5）；Placed 列表 `CO #1 · fcc (Pt3) · top`；`Create one structure per class…` 一次加 4 个结构
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M5-T9b Surface › Adsorbates 分区（二）：Coverage、Placed adsorbates 与批量操作（链 `w3-m5-panel2`）

【目标】Adsorbates 分区的 Coverage 块、Placed adsorbates 列表与批量操作（Place on all equivalent sites、Fill、Create one structure per class…），以及对应命令与公共 API。

【依据】M5 §5.5（`Place on all equivalent sites`：文案带数量、已占用的已去掉，放置后 toast 给出跳过数，超过 100 个先确认；鼠标停在按钮上显示整批幽灵，≤ 500 个吸附物）、§5.6（Coverage：θ 与分母下拉、`1×1 cells` 数值框与来源 tip、`Is this the 1×1 cell?`、Fill to θ、Min. separation、`Cells for 1/n coverage` 最多 6 行，`applicable` 为假时灰显；Apply 调用 M1 的原位超胞并在已有吸附物时确认 `The adsorbates will be repeated too.`，然后自动重算位点；Placed 列表的行文案、`now on hcp (Pt3) (placed on fcc, moved 1.6 Å)`、`(edited)`、没有记录的组显示 `CO #3`、悬停高亮 `adsorbate-hover`）、§5.2（`Create one structure per class…`：> 20 个结构时确认；`addStructure(s, {replaceProject: false})`；toast `Created 4 structures (one per site class)`）、§5.7、§5.8（`adsorbate.all`、`adsorbate.fill`、`adsorbate.eachClass`）；ledger-features L-M5-05/06/07、L-M5-09（公共 API 本任务注册 `edit.addAdsorbates(...)`、`build.adsorptionStructures(name, opts)`、`surface.coverage(opts)`）、L-M1-08（Apply = `commands.run('cell.supercell', { matrix: embed(P), relativeTo: 'current' })`）、L-X-04（没有记录的组按 `<式> #<id>` 显示）；负责人决定 L-18；U5（原位修改）、P4（批量生成的结构是新结构）。

【实现】`web/js/ui/panels/surface-adsorbates.js`（本批次整份归本链）补齐两块与批量操作；样式 `css/app.css` 段 `M5-panel`。

【U 与负责人决定】U5（原位修改）、P4；负责人决定 L-18。

【文件】`crystallume/web/js/ui/panels/surface-adsorbates.js`、`crystallume/web/css/app.css#M5-panel`、`tests/js/adsorbates_ui2.test.mjs`。

【测试】`tests/js/adsorbates_ui2.test.mjs`：θ 读数、来源 tip 与 `Is this the 1×1 cell?` 的条件、Placed 行文案、批量 toast（`Added 4 CO on fcc (Pt3) — skipped 3 sites next to CO #1`）、确认阈值。

【界面检查】（Chromium，本链端口）S1 第 14 步：放好 fcc 上的 CO 后，类 `top (Pt)`、Coverage `Fill to θ` 0.22 → `Fill` → toast `Added 1 CO (θ = 0.22 ML per 1×1 cell)`，名字 `Pt(111) p(3×3) 4L + 2CO`，`θ = 0.22 ML (per 1×1 cell) · 0.22 per site atom`；Placed 列表两行；`Place on all … equivalent sites` 悬停显示整批幽灵；Ag(111) p(1×1) 4L 上 Cells for 1/n coverage n = 3 → `(√3×√3)R30° · … apart [Apply]` → 一步撤销的超胞并重算位点；`Create one structure per class…` → 项目多 4 个结构、原 slab 不变；Remove all 有确认。截图存 `scratchpad/shots/w3-m5-panel2/`。

#### M5-T10a M5 的 REST、客户端与 CLI（sites、adsorb）（链 `w3-m5-api`）

【目标】M5 的外部接口：REST 三个端点、客户端三个方法、CLI `crystallume sites` 与 `crystallume adsorb`。

【依据】M5 §6.3–6.5、§7.2 的 REST/客户端/CLI 段；ledger-features L-M5-10（`POST /api/v1/analysis/sites`（登录）、`POST /api/v1/build/adsorbate`（公开；需要位点识别或对称操作的请求在云模式下需登录，K17）、`GET /api/v1/build/adsorbates`；模型 `extra="forbid"`；`bondLength`（键长）与 `sites.distance`（位点偏移）分开；客户端 `adsorption_sites(self, structure, **params) -> dict`、`add_adsorbate(self, structure, adsorbate, **params) -> Structure | list[Structure]`、`adsorbates(self) -> dict`；CLI 按账本原文：`sites` 的 `--format`（输入）与 `--json`，`adsorb` 的 `--from`/`--format`、`--site-index K`（`--index` 是帧选择）、`--each-class -o DIR/` 写 `index.json`、`--substitute EL | --vacancy`、`--list`；`--count N` 的帮助 `add N more adsorbates; those already on the surface are kept and act as seeds`）、§0.3、R-F13、R-F14、§10.5 第 2、9 条；负责人决定 L-18。

【实现】`server/models.py`、`server/routes/analysis.py`、`server/routes/build.py`、`server/auth.py`（条件登录依赖）、`client.py`、`cli.py`；`ROUTE_METHODS` 三条。

【U 与负责人决定】U4 不涉及；负责人决定 L-18（`--count` 的帮助文案）。

【文件】API 文件束（plan.md §2.4）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`。

【测试】`test_sites_endpoint`（200、400 无真空、422 未知字段/越界、云模式未登录 401、`detail: classes`、`maxSites` 截断）、`test_adsorb_endpoint`（200、400 E10/E12/E14、原子数上限 400、`each` 返回列表）；`tests/test_hardening.py`（匿名 + 1 万原子 + `coverage` 在云模式下 401，本地 `max_atoms=100` 时 400）；客户端三条；CLI：`sites --json`、`sites --assign`、`adsorb … -o` 读回、`adsorb --each-class -o DIR/` 的文件与 `index.json`、`adsorb --list`、`--count 1` 新增 1 个、错误返回 1；acceptance S1 的 CLI 序列（`--surface-cell 3x3` 等按账本改写）。

#### M5-T12b M5 跨语言平价（二）：批量与覆盖度（链 `w3-m5-parity2`）

【目标】把 M5-T7 的批量与覆盖度加进跨语言平价。

【依据】M5 §7.3（`plan_adsorbates` 的放置与 `skipped`、`adsorbate_coverage`、`coverage_supercells` 完全相等，浮点 ≤ 1e-6）；ledger-features L-M5-05/06/07、§10.0 第 9 条（排除 `bulk.name`）。

【实现】在 `tests/test_m5_parity.py` 追加：Pt(111) p(3×3) 与 Cu(100) p(2×2) 上的 Fill、Place on all、两面、`count`、1/n 超胞候选与 `adsorption_structures` 的名字。

【U 与负责人决定】负责人决定 L-11、L-18；U5。

【文件】`tests/test_m5_parity.py`。

【测试】即上。

### W3.5

第 3 波收尾：文档与应用内帮助、M5 的 Playwright 冒烟、M1–M5 合起来的验收 E2E。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w3-docs` | 8844 | M5-T10b M5 的文档、应用内帮助与导览 | `README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour` |
| `w3-e2e-adsorbates` | 8845 | M5-T12c M5 的 Playwright 冒烟 | `tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/adsorbates.spec.mjs` |
| `w3-e2e-acceptance` | 8846 | W3-E2E 第 3 波验收 E2E（M1–M5 合起来） | `tests/e2e/w3_acceptance.spec.mjs` |

**合并顺序**：`w3-e2e-adsorbates` → `w3-e2e-acceptance` → `w3-docs`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- Playwright：`tests/e2e/adsorbates.spec.mjs`（M5 §7.4 第 1–7 步，改为 Node 版，L-06）与 `tests/e2e/w3_acceptance.spec.mjs`（E2E-1 全部 15 步、E2E-2 全部 7 步、E2E-3 第 5 步、E2E-4 第 4–5 步）通过，截图在 `tests/e2e/out/`
- 验收 S1 全部（S1-1–S1-12）、S2、S3、S13、S14（S14-1–S14-8）在 Python、JS 与界面三条路径成立
- 文档：README、`docs/PLUGINS.md`（M5 §6.2 对照表、平躺芳香分子的构型名）、`docs/SCHEMA.md`（`props.adsorbate_id`、`info.surface.adsorbates` 含 `definition` 与 `tagsConvention`、`crystallume.sites/1`、`crystallume.adsorbates/1`、`web/data/*.json` 的读取约定）、`docs/DEPLOY.md`（REST 三行与登录规则 K17）、应用内帮助与导览；随后进入波末三视角审查

#### M5-T10b M5 的文档、应用内帮助与导览（链 `w3-docs`）

【目标】M5 的文档与应用内文案（从 M5-T10 拆出的文档部分）。

【依据】M5 §10 M7 一节（`docs/SCHEMA.md` 写入 `props.adsorbate_id`、`info.surface.adsorbates`（含 `definition`、`tagsConvention`）、`crystallume.sites/1`、`crystallume.adsorbates/1`、`web/data/*.json` 的读取约定；`docs/PLUGINS.md` 写入 §6.2 的对照表与平躺芳香分子的构型名对照 G8；REST 表加三行；`/build/*` 中需要分析的请求的登录规则 K17 写进 `docs/DEPLOY.md`）、§6；ledger-features L-M5-01…10、L-X-04、L-X-05；负责人决定 L-05（M4 与 M5 的默认键长同一来源）、L-15、L-18；U5（放吸附物原位修改，Duplicate 保留原 slab）。

【实现】README（Adsorbates 分区、位点标记与 Pick site）、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、应用内帮助与导览（`ui/shell.js`，以符号定位）、CHANGELOG。

【U 与负责人决定】U5；负责人决定 L-05、L-15、L-18。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour`。

【测试】文档里的 Python 与 CLI 例子逐个运行，结果写进报告。

【界面检查】（Chromium，本链端口）帮助与导览提到 Adsorbates 分区、Find sites、Pick site（单击选位点、双击放置）、Shift+S；快捷键对话框列出 Shift+A、Shift+S（以 W3.3 注册的为准）。

#### M5-T12c M5 的 Playwright 冒烟（链 `w3-e2e-adsorbates`）

【目标】M5 的端到端冒烟（从 M5-T12 拆出；M5 §7.4 写的 Python 版 `tests/e2e/test_adsorbates.py` 按负责人决定 L-06 改为 Node 版）；本批次维护 harness 与 pytest 包装。

【依据】M5 §7.4 第 1–7 步（加载底两层已固定的 `pt111_p3x3_4L.json` 夹具；Find sites 摘要；选 CO 与 `fcc (Pt3)`、读数含 `C–Pt`；此时 Delete 与 Export 可用；Place → toast 与撤销标签 `Undo Add CO`；导出 POSCAR：`Selective dynamics`、最后两行 `T T T`、底层 `F F F`、物种行 `Pt C O`；Undo 后 Pick site 双击放置、单击只选位点；`Create one structure per class…` → +4 个结构；标记不在截图中，除非勾选 Include markers）；负责人决定 L-06、L-15（读数数字不写死，对照 `placeAdsorbate` 现算）。

【实现】`tests/e2e/adsorbates.spec.mjs`；harness/包装只做必要修改。

【U 与负责人决定】U5-b；负责人决定 L-06、L-15。

【文件】`tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/adsorbates.spec.mjs`。

【测试】`pytest -m slow tests/test_e2e.py -k adsorbates`。

【界面检查】（Chromium，本链端口）同上各步截图交审查。

#### W3-E2E 第 3 波验收 E2E（M1–M5 合起来）（链 `w3-e2e-acceptance`）

【目标】在 M1–M5 都合入后跑通 acceptance §3.2 的 E2E-1（全部 15 步）、E2E-2（全部 7 步）、E2E-3 第 5 步、E2E-4 第 4–5 步。

【依据】acceptance §3.2（E2E-1…E2E-4 的步骤与断言）、S1、S13、S14 的期望表；负责人决定 L-06、L-15（E2E-1 第 10 步的数字按 `placeAdsorbate` 现算）、L-16（E2E-4 第 3 步用内嵌编辑器）、L-18；plan.md P-14、P-16；U1-a、U1-c、U4-a、U4-b、U5-b、U5-c。

【实现】`tests/e2e/w3_acceptance.spec.mjs`（用 `w2-e2e-layers` 建立的 `tests/e2e/poscar_canon.mjs` 做 S14 的规范形比较）；harness 由 `w3-e2e-adsorbates` 维护，本链不改。

【U 与负责人决定】U1-a、U1-c、U4-a、U4-b、U5-b、U5-c；负责人决定 L-06、L-15、L-16、L-18。

【文件】`tests/e2e/w3_acceptance.spec.mjs`。

【测试】`pytest -m slow tests/test_e2e.py -k w3_acceptance`。

【界面检查】（Chromium，本链端口）E2E-1 第 12 步导出 POSCAR 第 6、7 行为 `Pt C O` 与 `36 2 2`、第 8 行 `Selective dynamics`、前 18 行 `F F F`；第 13 步 extxyz 含 `move_mask:L:1`、不含 `selective_dynamics`；第 14 步 `screenshot()` 与 `screenshot({ markers: true })` 像素不同；第 15 步 Ctrl+Z 三次回到 4 原子体相；E2E-2 第 6 步标志序列 18 × `F F F`、9 × `T T F`、8 × `T T T`、2 × `T T T`，`exportReport('extxyz').warnings[0]` 以 `Extended XYZ stores these constraints as ASE FixCartesian masks` 开头；E2E-4 第 4–5 步 `6 site atoms (C) · 18 sites in 3 classes`、Li 放置、`exportReport('poscar').notes` 恰 1 条含 `POSCAR is always periodic` 与 `18.5 Å`。截图交审查。

## 6. 第 4 波：M6 界面与异质结（晶格匹配、层的准备、构建、Interface 分区）

### W4.1

M6 的数据与常量、界面命名、解析金标（只写期望），给匹配与构建的并行开发打底。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w4-m6-data` | — | M6-T0 M6 的数据与常量（双语言） | `crystallume/core/defaults.py#M6`、`crystallume/web/js/core/defaults.js#M6`、`crystallume/core/structure.py#PROP_DEFAULTS`、`crystallume/web/js/core/structure.js#PROP_DEFAULTS`、`crystallume/core/elements.py`、`crystallume/web/js/core/elements.js`、`crystallume/config.py`、`tests/test_m6_data.py`、`tests/js/m6_data.test.mjs` |
| `w4-m6-naming` | — | M6-T4n 界面命名 interface_name（双语言，从 M6-T4/T5 提前拆出） | `crystallume/core/naming.py#M6`、`crystallume/web/js/core/naming.js#M6`、`crystallume/core/naming.py#M2`、`crystallume/web/js/core/naming.js#M2`、`tests/test_interface_name.py`、`tests/js/interface_name.test.mjs` |
| `w4-m6-golden` | — | M6-T3a 界面的解析金标（只写期望） | `tests/data/surface/interface/`、`tests/test_interface_golden_shape.py`、`tests/ops/m6_recipes.py`、`tests/js/ops/m6_recipes.mjs` |

**合并顺序**：`w4-m6-data` → `w4-m6-naming` → `w4-m6-golden`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M6-T0：`tests/test_m6_data.py`、`tests/js/m6_data.test.mjs` 通过：`interface_*` 键两语言相等，没有 `interface_vacuum`、`interface_preview_vacuum`、`interface_vacuum_max`、`interface_confirm_atoms`（L-X-08）；`PROP_DEFAULTS` 两份都有 `interface_layer: 0`；`CATION_RADII` 两语言逐项相同；`hbn` 原型 a = 2.504 Å、pbc T T F（F0-D T10 已交付，只核对）
- M6-T4n：`tests/test_interface_name.py`、`tests/js/interface_name.test.mjs` 通过：`graphene/Ni(111)`、`MoS2 p(4×4)/Au(111) (√19×√19)R23.4°`、M1 p(2×2) 之后 `MoS2 p(8×8)/Au(111) (2√19×2√19)R23.4°`、`hBN/graphene/Ni(111)`；`surface_name` 的 interface 分支已接上（L-X-07）
- M6-T3a：`tests/data/surface/interface/` 外壳正确、全部带理由 skip

#### M6-T0 M6 的数据与常量（双语言）（链 `w4-m6-data`）

【目标】M6 需要的常量、默认属性、阳离子半径与服务器设置。

【依据】M6 §3.9.2、§3.11（键表；**[改]** 删除 `interface_preview_vacuum`（U4，R-F32）、`interface_vacuum_max`（用 M2 的 `max_vacuum` = 1000 Å）、`interface_confirm_atoms`（用 F0-A `LIMITS.confirmAtoms` = 30 000））、§4.1、§6.3、M6-F15；ledger-features L-M6-05（`CATION_RADII`、`cation_radius(symbol)`/`cationRadius(sym)` 两份逐项相同；两份 `PROP_DEFAULTS` 源码表加 `interface_layer: 0`（L-F0-02 的扩展规则：同时改两份并加逐键测试，不在运行时赋值）；`SURFACE_DEFAULTS` 的 `interface_*`；服务器设置 `max_interface_work`、`max_interface_vector_pairs`（`config.py`，含环境变量与文件头的表）；**[改]** `hbn` 原型已由 F0-D T10 交付，只核对 a = 2.504 Å 与 pbc T T F；`METALS`/`ANIONS` 由 M2 T2 提供，M6 不加）、L-X-08 M6 行、§10.6 第 6 条；U4。

【实现】defaults 段 `M6`；`core/structure.py` 与 `web/js/core/structure.js` 的 `PROP_DEFAULTS` 源码表各加一项（只改这两张表）；`core/elements.py`、`web/js/core/elements.js` 加 `CATION_RADII` 与函数；`config.py` 加两个设置。

【U 与负责人决定】U3（M6 完整交付）、U4（不加任何真空默认值；删除预览占位真空）；负责人决定：无直接相关项。

【文件】`crystallume/core/defaults.py#M6`、`crystallume/web/js/core/defaults.js#M6`、`crystallume/core/structure.py#PROP_DEFAULTS`、`crystallume/web/js/core/structure.js#PROP_DEFAULTS`、`crystallume/core/elements.py`、`crystallume/web/js/core/elements.js`、`crystallume/config.py`、`tests/test_m6_data.py`、`tests/js/m6_data.test.mjs`。

【测试】键与值两语言逐键相等；被删除的键不存在；`PROP_DEFAULTS["interface_layer"] == 0` 两语言；`CATION_RADII` 逐项相同；`hbn` 原型参数；`Settings` 读环境变量。

#### M6-T4n 界面命名 interface_name（双语言，从 M6-T4/T5 提前拆出）（链 `w4-m6-naming`）

【目标】界面的名字函数 `interface_name`，并把 M2 `surface_name` 的 `kind == "interface"` 分支接上，使 M1 之后的超胞与 M5 的吸附物后缀都能重算界面名。

【依据】M6 §4.4；ledger-features L-M6-04（伪代码原文：两层 `L(o) + W(o) + "/" + L(s) + W(s)`，同一材料且扭转 ≥ 0.05° 时加 `" " + format_decimal(|twist|, 1) + "° twist"`；三层及以上下面的叠层不带网格段；`interface.label`；`W(X)` 用 `mesh_label(M @ X.matrixRef, X.refMesh)`；例：`graphene/Ni(111)`、`MoS2 p(4×4)/Au(111) (√19×√19)R23.4°`，M1 做 p(2×2) 后 `MoS2 p(8×8)/Au(111) (2√19×2√19)R23.4°`）、L-X-07（`surface_name` 对 kind interface 调用它，再接吸附物后缀）、L-X-03（`info.surface.interface` 的字段）、R-F18（`format_decimal`，不是 `format_fixed`）、R-F20（矩阵写法 `[2 1, -1 3]`）、§10.6 第 7 条；负责人决定 L-12、L-17。

【实现】`core/naming.py` 与 `web/js/core/naming.js` 的段 `M6`：`interface_name(surface, supercell_matrix=None)`/`interfaceName(surface, supercellMatrix = null)`；段 `M2` 里 `surface_name` 的 interface 分支改为调用它（只改这一个分支）。

【U 与负责人决定】U3；负责人决定 L-12、L-17（不复制自动名哨兵）。

【文件】`crystallume/core/naming.py#M6`、`crystallume/web/js/core/naming.js#M6`、`crystallume/core/naming.py#M2`、`crystallume/web/js/core/naming.js#M2`、`tests/test_interface_name.py`、`tests/js/interface_name.test.mjs`。

【测试】用手写的 `info.surface`（kind interface，L-X-03 字段）覆盖 L-M6-04 与 L-X-07 表里 M6 的全部例子（`graphene/Ni(111)`、`graphene p(3×3)/Pt(111) (√7×√7)R19.1°`、`MoS2 p(4×4)/Au(111) (√19×√19)R23.4°`、`graphene p(10×10)/Ir(111) p(9×9)`、`graphene (√7×√7)R19.1°/graphene (√7×√7)R19.1° 21.8° twist`、`hBN/graphene/Ni(111)`、带 CO 的基底 `… + CO`）；`supercell_matrix` 给出时的重算；两语言逐字相同。

#### M6-T3a 界面的解析金标（只写期望）（链 `w4-m6-golden`）

【目标】晶格匹配与界面构建的解析金标，供 W4.2 的四条实现链对照（从 M6-T3 拆出；完整原子列表与跨语言平价在 W4.3 的 M6-T3b）。

【依据】M6 §3.15（场景逐个走通的数字）、§7.2；acceptance S15a-1/2/3/5、S15b-1/2/3、S15c-1/2/3（graphene/Ni(111) 561 类、8 个 Pareto；MoS2/Au(111) 148 类、12 个；tBLG 任意扭转 21 类、目标 21.8° ± 0.5° 2 类；28 原子、|cell[0]| = 6.5085 Å、c = 18.35 Å 等）与 §0.2 的 `m6v2_counts.py` 说明；ledger-features R-F01（M6 的金标在最终函数上重新生成：本任务只写解析与已核对的计数，类序与首行由 M6-T3b 用最终实现生成）；ledger-F0 L-F0-27；plan.md P-03。

【实现】`tests/data/surface/interface/*.json`（`crystallume.cases/1`；ops `interfaceMatches`、`makeInterface`；输入用配方：内置石墨烯、MoS2 原型用 M2-T7a 的 `bulk`，Ni(111)/Au(111) 用本任务在 `tests/ops/m6_recipes.py` 与 `tests/js/ops/m6_recipes.mjs` 注册的 `cleavedSlab` 配方（调用 `build.surface`/`buildSurface`，显式参数）），全部带 skip：`op <name> is registered by M6-T3b (W4.3)`。

【U 与负责人决定】U2（结果 pbc T T T）、U3、U4（`vacuum` 必填，0 = 超晶格）；负责人决定 L-07（S15a-3 只断言集合与锚 C）。

【文件】`tests/data/surface/interface/`、`tests/test_interface_golden_shape.py`、`tests/ops/m6_recipes.py`、`tests/js/ops/m6_recipes.mjs`。

【测试】外壳格式测试；全部按 skip 处理、不失败。

### W4.2

匹配核心与构建两语言四条链并行（构建用手写的匹配结果做单元测试，W4.3 再端到端核对）。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w4-m6-match-py` | — | M6-T1 晶格匹配核心（Python） | `crystallume/analysis/latticematch.py`、`crystallume/analysis/__init__.py#M6`、`tests/test_latticematch.py` |
| `w4-m6-match-js` | — | M6-T2 晶格匹配核心（JS，含分片异步搜索） | `crystallume/web/js/core/latticematch.js`、`tests/js/latticematch.test.mjs` |
| `w4-m6-build-py` | — | M6-T4 界面构建（Python）：prepare_layer、make_interface、层间距与配位记录 | `crystallume/build/interface.py`、`crystallume/build/__init__.py#M6`、`tests/test_interface.py` |
| `w4-m6-build-js` | — | M6-T5 界面构建（JS） | `crystallume/web/js/build/interface.js`、`tests/js/interface.test.mjs` |

**合并顺序**：`w4-m6-match-py` → `w4-m6-match-js` → `w4-m6-build-py` → `w4-m6-build-js`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M6-T1/T2：`tests/test_latticematch.py`、`tests/js/latticematch.test.mjs` 通过；全仓库没有 `reduce_basis_shortest`、`SWAP_REL`、`TIE_EPS`、私有 `hnf_2d`（R-F01、R-F12）；λ1 预筛与二分的相对余量 ≥ 2·`gauss_tolerance` 有单元测试断言
- M6-T4/T5：`tests/test_interface.py`、`tests/js/interface.test.mjs` 通过；`make_interface` 缺 `vacuum` → `TypeError`（Python）/E-VAC（JS），上限 1000 Å，0 = 超晶格（R-F05）；结果 `pbc = [T,T,T]`（U2）；`info.surface.kind == "interface"`、`version == 2`、`autoName`，没有顶层 `info.interface`（R-F16）；吸附物记录合并时不改写 `firstAtom`（L-17）
- 验收（Python 与 JS 的单元测试，匹配结果由手写或 `match_from_matrices` 给出）：S15a-2、S15a-4、S15a-5、S15c-2 的结构与属性部分

#### M6-T1 晶格匹配核心（Python）（链 `w4-m6-match-py`）

【目标】Python 晶格匹配核心：`Mesh2D`、`lattice_rotations`、ZSL 引擎（内联去重与短矢量缓存）、重合矢量引擎（K̂、计数上限、精确包围盒）、后处理（分块归类、规范变体、代表、Pareto、排序）、手动/保持基底模式、`auto_twist_area`、`match_from_matrices`。

【依据】M6 §3.3–3.7、§3.11（常量与内部常数）、§3.12（等价安全算术规则，第 10 条改用 `format_decimal`）、§3.13、§3.14、§7.1 的匹配部分；ledger-features L-M6-01（签名原文；**[改]** 最短基约化一律 `gauss_reduce_2d(u, v, angle=None)`，删除 `reduce_basis_shortest` 与 `SWAP_REL`/`TIE_EPS`；规范形用 M1 `hermite_normal_form_2d`；子格枚举用 M1 `hnf_matrices_2d`；λ1 预筛与二分带 ≥ 2·`gauss_tolerance` 的相对余量）、R-F01（附录 A-1：换用 M1 的约化后 graphene/斜方 435 类、MoS2/斜方 147 类、graphene/Ni(111) 549 类逐项相同、顺序相同）、R-F12、§10.6 第 1 条；原型 `scratchpad/proto/m6v2/match_v2.py`（v2 规则）与 `scratchpad/proto/m6/match2d.py`（实现按规格，不照搬原型，M6 附录 C）。

【实现】新文件 `crystallume/analysis/latticematch.py`；`analysis/__init__.py` 段 `M6` 导出。

【U 与负责人决定】U3；负责人决定：无直接相关项（约化规则由账本 R-F01 定）。

【文件】`crystallume/analysis/latticematch.py`、`crystallume/analysis/__init__.py#M6`、`tests/test_latticematch.py`。

【测试】M6 §7.1 的匹配部分（两个引擎、计数上限与 `max_work`、遍历顺序、畸变网格、手动与 Keep 模式、Pareto 与排序、`auto_twist_area`）；graphene/Ni(111) `max_strain=0.03, max_area=400` 的类数与 Pareto 数与 acceptance S15a-1 一致（561/8）；MoS2/Au(111) 148/12；tBLG 任意扭转 21 类、21.8° ± 0.5° 2 类；预筛余量的断言。

#### M6-T2 晶格匹配核心（JS，含分片异步搜索）（链 `w4-m6-match-js`）

【目标】JS 版晶格匹配核心，含生成器 `matchSteps` 与 `matchMeshesAsync`（分片、AbortSignal、进度）。

【依据】与 M6-T1 相同的规格节与账本条目（M6 §3.3–3.7、§3.11–3.14；ledger-features L-M6-01：`Mesh2D`、`latticeRotations`、`matchMeshes(sub, ovl, opts)`、`matchMeshesAsync(sub, ovl, opts, { signal, onProgress, sliceMs = 12 })`、`matchFromMatrices`、`autoTwistArea`；删除私有约化，R-F01）；M6 §3.12（两语言等价的算术规则：运算顺序写死）；原型 `scratchpad/proto/m6/match2d.mjs`、`scratchpad/proto/m6v2/rot_v2.mjs`。

【实现】新文件 `crystallume/web/js/core/latticematch.js`（按规格与两份原型独立实现，与 M6-T1 对照同一组期望）。

【U 与负责人决定】U3；负责人决定：无直接相关项。

【文件】`crystallume/web/js/core/latticematch.js`、`tests/js/latticematch.test.mjs`。

【测试】与 M6-T1 相同的用例的 JS 版；`matchMeshesAsync` 与同步版本结果相同、可中止、`onProgress` 单调；每片 ≤ `sliceMs`（粗测）。两语言逐项相同由 M6-T3b 检查。

#### M6-T4 界面构建（Python）：prepare_layer、make_interface、层间距与配位记录（链 `w4-m6-build-py`）

【目标】Python 界面构建：`prepare_layer`、`interface_matches`、`make_interface`、`estimate_interface_atoms`、`interface_distances`；接触规则与分箱；`info.surface`、props、吸附物记录、警告、`return_parts`；配位记录与状态行（负责人决定 L-07）。

【依据】M6 §3.2、§3.8–3.10、§3.14、§4；ledger-features L-M6-02（`prepare_layer(structure, *, flip=False, primitive=True, frame=None)` 的 7 步：前提与 `vacuum_gap_hint` 文案（V-F02、V-F03）、`standardize_slab`（M2，R-F22）、c 长度 `t + 2·PREP_PAD`、`reference_mesh(s, exclude=吸附物)`（L-M1-07）、`primitive_cell(...).supercell_matrix` 的面内块作 K（R-F02）、翻转、promote）、L-M6-03（签名原文；`vacuum` 必填、总间隙、≤ `max_vacuum` 1000 Å、0 = 超晶格；每层面内超胞用 `cellops.make_supercell(layer, embed(M @ T))`；形变在副本上保持面内分数坐标与 z（不调用 M1 `deform`，R-F12）；`concat_structures([S2′, O2′], cell=…, pbc=[T, T, T], renumber_adsorbates=True)`；`props.interface_layer`、`tags`、SD 按 M6 §4.1；`info.surface` 按 L-X-03；吸附物记录合并**没有 `firstAtom`**、不复制 `autoName`（L-17、R-F34）；`mark_edited(out, "atoms")`；`info.source = "builder:interface"`；名字 `surface_name`；**配位记录**：`sites = adsorption_sites(S2, side="top")`（S2 为层叠前的基底副本）、覆盖层最下层用 M3 `cluster_heights` 求、对每个原子 `nearest_sites(sites, [r_j])`（M5，L-M5-03），`lateral ≤ site_moved_threshold` 时取 `subtype ?? kind`，写入 `info.surface.interface.registry = {preset, sites}`；状态行 `anchor C on top, second C on fcc hollow` 的规则；`adsorption_sites` 报错时 `registry.sites = null`、状态行 `no adsorption sites found on the substrate`）、L-X-03、L-X-04、L-X-05、R-F05、R-F16、§10.6 第 2–5 条；ledger-F0 §6 M6 第 1–10 条；U2、U4、C3（标志按各层应变后的晶胞换算）。

【实现】新文件 `crystallume/build/interface.py`（Python 用 `build.make_interface`，`build.interface` 是子模块）；`build/__init__.py` 段 `M6` 导出。`interface_matches` 是对 `match_meshes` 的薄封装（同批 M6-T1 实现，端到端测试在 W4.3 的 M6-T3b）；本任务的单元测试用手写的匹配结果（M6 §6.1 的字段）调用内部构建函数，不依赖 M6-T1 的代码。

【U 与负责人决定】U1（前提只说缺什么）、U2、U3、U4；负责人决定 L-07、L-17。

【文件】`crystallume/build/interface.py`、`crystallume/build/__init__.py#M6`、`tests/test_interface.py`。

【测试】M6 §7.1 的构建部分（层准备的左手晶胞、真空沿 a、跨边界；层间距三种方法与 Custom 的界；错位预设；应变分配；props、SD、tags 规则；`info.surface` 字段；吸附物记录合并；警告文案；`return_parts` 的名字与 `autoName = null`；配位记录与状态行）；E-VAC、E-MATCH、`match 250 is out of range (200 matches; raise max_results)` 的文案。

#### M6-T5 界面构建（JS）（链 `w4-m6-build-js`）

【目标】JS 版界面构建：`prepareLayer`、`interfaceMatches`、`interfaceMatchesAsync`、`makeInterface`、`estimateInterfaceAtoms`、`interfaceDistances`。

【依据】与 M6-T4 相同的规格节与账本条目（M6 §3.2、§3.8–3.10、§4；ledger-features L-M6-02、L-M6-03：JS `makeInterface(sub, ovl, { vacuum, … })`，`vacuum == null` → E-VAC；`interfaceMatchesAsync(sub, ovl, opts, { signal, onProgress, sliceMs = 12 })`）；JS 侧依赖 M1 `core/cellops.js`、M2 `standardizeSlab`、M3 `clusterHeights`、M5 `adsorptionSites`/`nearestSites`、F0-D `concatStructures`。

【实现】新文件 `crystallume/web/js/build/interface.js`（与 M6-T4 对照同一组期望；`interfaceMatches` 对 `matchMeshes` 的封装在 W4.3 端到端核对）。

【U 与负责人决定】U2、U3、U4；负责人决定 L-07、L-17。

【文件】`crystallume/web/js/build/interface.js`、`tests/js/interface.test.mjs`。

【测试】与 M6-T4 相同用例的 JS 版（手写匹配结果）；两语言逐项相同由 M6-T3b 检查。

### W4.3

金标在最终函数上重新生成与跨语言平价；M6 的 REST/客户端/CLI；Interface 分区骨架、选层与搜索。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w4-m6-parity` | — | M6-T3b 界面金标在最终函数上生成、跨语言平价与端到端核对 | `tests/data/surface/interface/`、`tests/test_m6_parity.py`、`tests/ops/m6.py`、`tests/js/ops/m6.mjs`、`scripts/dev/check_interface_pmg.py` |
| `w4-m6-api` | — | M6-T6 M6 的 REST、客户端、CLI、服务器上限与条件登录 | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py` |
| `w4-m6-ui-search` | 8847 | M6-T7a Surface › Interface 分区（一）：骨架、选层、匹配参数与异步搜索 | `crystallume/web/js/ui/panels/surface-interface.js`、`crystallume/web/js/main.js#M6-interface`、`crystallume/web/css/app.css#M6`、`tests/js/interface_ui.test.mjs` |

**合并顺序**：`w4-m6-parity` → `w4-m6-api` → `w4-m6-ui-search`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M6-T3b：`tests/test_m6_parity.py` 通过；`tests/data/surface/interface/` 不再有 skip；acceptance S15a-1–S15a-5、S15b-1–S15b-3、S15c-1–S15c-3 在 Python 与 JS 中成立（S15a-3 只断言集合与锚 C，L-07）
- M6-T6：`/analysis/interface`（登录）、`/build/interface`（需要搜索时登录，只给两个矩阵时公开）在 `ROUTE_METHODS` 中；`vacuum` 缺失 422、> 1000 422；CLI `crystallume build interface …` 省略 `--vacuum` 退出码 2（`--list` 除外），状态行作为 `crystallume: note:` 打到 stderr
- 界面：Surface › Interface 分区存在（order 50）；两层都选石墨烯、`Max strain` 0、`Twist` Target 21.8 ± 0.5 → 状态行 `2 matches`（≤ 10 s）；Ni(111) + 石墨烯、`Max strain` 3、`Max area` 400、`Twist` Any → `561 matches · 8 best trade-offs`（≤ 15 s），第一项含 `6 atoms`；搜索期间可 Stop、不锁住编辑（不用 `startTask`）
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M6-T3b 界面金标在最终函数上生成、跨语言平价与端到端核对（链 `w4-m6-parity`）

【目标】在 M6-T1/T2/T4/T5 合入后，用最终函数重新生成匹配表与构建结果的金标，启用全部界面金标，做跨语言平价与 `interface_matches` → `make_interface` 的端到端核对。

【依据】M6 §7.2（`tests/data/surface/interface_*.json` 的内容；遍历顺序、两个引擎、畸变网格用例）；ledger-features R-F01（金标在最终函数上重新生成）、L-M6-01、L-M6-03、§10.0 第 9 条（排除 `bulk.name`，L-11）；acceptance S15a、S15b、S15c 的期望表（三个构建的完整原子列表）；ledger-F0 L-F0-27；plan.md P-02、P-03；开发期 pymatgen 交叉核对脚本 `scripts/dev/check_interface_pmg.py`（不进包；需要 pymatgen 时在 scratchpad 里另建 venv，不装进仓库）。

【实现】在 `tests/ops/m6.py`、`tests/js/ops/m6.mjs` 注册 ops `interfaceMatches`、`makeInterface`；去掉 `tests/data/surface/interface/` 的 skip 并补上三个完整原子列表与类序、首行、Pareto 行；`tests/test_m6_parity.py`（一次 Node 调用批量比较匹配表与构建结果）。

【U 与负责人决定】U3；负责人决定 L-07、L-11。

【文件】`tests/data/surface/interface/`、`tests/test_m6_parity.py`、`tests/ops/m6.py`、`tests/js/ops/m6.mjs`、`scripts/dev/check_interface_pmg.py`。

【测试】即上；S15a-1–S15c-3。

#### M6-T6 M6 的 REST、客户端、CLI、服务器上限与条件登录（链 `w4-m6-api`）

【目标】M6 的外部接口：两个路由（含"需要搜索才要求登录"的条件依赖与服务器上限）、客户端两个方法、CLI `crystallume build interface`。

【依据】M6 §6.3–6.4、§7.3；ledger-features L-M6-07（`POST /api/v1/analysis/interface`（登录）、`POST /api/v1/build/interface`（需要搜索时登录；只给两个矩阵时公开）；**[改]** `InterfaceBuildRequest.vacuum: float = Field(..., ge=0, le=1000)`；新模型 `extra="forbid"`；`shift`、`shiftCart` 长度 2、`distance` 数值 0.5–20 Å；客户端 `interface_matches(self, substrate, overlayer, **search) -> dict`、`build_interface(self, substrate, overlayer, *, vacuum: float, **options) -> Structure`；CLI 选项按账本原文，`--vacuum` 为 `required=True`，只有 `--list` 不构建、不需要它）、L-M6-03（状态行作为 note）、§0.3、R-F05、R-F13、R-F14；M6-T0 的 `max_interface_work`、`max_interface_vector_pairs`；U4-c。

【实现】`server/models.py`、`server/routes/analysis.py`、`server/routes/build.py`、`server/auth.py`/`server/deps.py`（条件登录依赖）、`client.py`、`cli.py`（`build interface` 加进 `build` 组）；`ROUTE_METHODS` 两条。

【U 与负责人决定】U3、U4-c；负责人决定 L-07（状态行作为 CLI note）。

【文件】API 文件束（plan.md §2.4）：`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`。

【测试】M6 §7.3（200、422 缺 `vacuum`/越界/未知字段、400 科学错误、云模式下搜索请求未登录 401、只给矩阵时匿名可用、服务器上限 400）；`tests/test_hardening.py`；客户端两条；CLI：`--list --json`、`--pick N`、`--variant K`、`--keep-input-cell`、省略 `--vacuum` 退出码 2、stderr 的配位 note。

#### M6-T7a Surface › Interface 分区（一）：骨架、选层、匹配参数与异步搜索（链 `w4-m6-ui-search`）

【目标】Interface 分区的骨架与搜索部分：分区注册、模块级控制器与缓存、两层选择器（含禁用原因）、匹配参数（Search 模式）、异步搜索与状态行、结果列表；为 W4.4 的两条链建立文件内的段。

【依据】M6 §5.1、§5.2（层选择器、网格行、数字输入的界与内联错误、结果列表 `role="listbox"` 与 `aria-label`、最多 200 项、Pareto 标记 "Best"、1×1 提示与 `Use it anyway`）、§5.3（控制器、搜索只由输入事件或 `rev` 变化触发、400 ms 防抖并取消上一轮、缓存键、过期判定 `The layers changed. Search again.`、进度只在状态行且**不调用 `app.startTask`**）、§5.6；ledger-features L-M6-06（`registerPanelSection('surface', { id: 'interface', order: 50, … })`；`available()` 的文案按 V-F03：`Load a structure with a unit cell first.`）、L-M6-01（`matchMeshesAsync`）、L-M6-03（`interfaceMatchesAsync`）、V-F02、V-F03；ledger-F0 L-F0-49、L-F0-48（`numberInput`）、L-F0-54（不用 `startTask`）；U1（层选择器按项目顺序，不把 slab 排前；badge 只放匹配的网格）、U3。

【实现】新文件 `web/js/ui/panels/surface-interface.js`：骨架段 `M6-T7b`（构建选项、预览与创建）、`M6-T7c`（Manual 矩阵、Registry 菜单、命令与公共 API、右键菜单、偏好与无障碍），本任务实现段外的部分；`main.js` 段 `M6-interface`；样式 `css/app.css` 段 `M6`。

【U 与负责人决定】U1（层选择器不把 slab 排前、不标记 slab）、U3；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/panels/surface-interface.js`（新建，含段落）、`crystallume/web/js/main.js#M6-interface`、`crystallume/web/css/app.css#M6`、`tests/js/interface_ui.test.mjs`。

【测试】`tests/js/interface_ui.test.mjs`：控制器状态机（输入变化 → 防抖 → 取消上一轮 → 结果；`rev` 变化 → 过期）、结果项 `aria-label`（`6 atoms, area 5.4 square ångströms, twist 0 degrees, mismatch 1.18 percent, substrate 1 by 1, overlayer 1 by 1`）、禁用原因文案。

【界面检查】（Chromium，本链端口）E2E-5 第 1 步与第 3 步的搜索部分：载入石墨烯，Shift+5 展开 Interface，两层都选它、`Max strain` 0、`Twist` Target 21.8 ± 0.5 → 状态行（`aria-live`）≤ 10 s 出现 `2 matches`；用命令建 Ni(111)（`surface.cleave`，体相 Ni 3.52），Substrate 选它、Overlayer 选石墨烯、`Max strain` 3、`Max area` 400、`Twist` Any → `561 matches · 8 best trade-offs`（≤ 15 s），第一项含 `6 atoms`；搜索中 `Stop` 可用、期间能删除原子与导出（没有 busy 锁）；键盘 ↑/↓ 在结果间移动；改动某一层后状态行 `The layers changed. Search again.`。截图存 `scratchpad/shots/w4-m6-ui-search/`。

### W4.4

Interface 分区的构建选项、预览与创建；Manual 矩阵、Registry、命令与公共 API；M6 性能基准。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w4-m6-ui-build` | 8848 | M6-T7b Interface 分区（二）：构建选项、预览与 Create | `crystallume/web/js/ui/panels/surface-interface.js#M6-T7b`、`tests/js/interface_build_ui.test.mjs` |
| `w4-m6-ui-manual` | 8849 | M6-T7c Interface 分区（三）：Manual 矩阵、Registry 与位点菜单、命令、公共 API、右键菜单 | `crystallume/web/js/ui/panels/surface-interface.js#M6-T7c`、`crystallume/web/js/ui/panels/projects.js#context-menu`、`tests/js/interface_manual_ui.test.mjs` |
| `w4-m6-perf` | — | M6-T8a M6 性能基准与预算测试 | `tests/test_interface_perf.py`、`tests/js/perf/interface.perf.mjs`、`tests/perf/bench_interface.py` |

**合并顺序**：`w4-m6-ui-build` → `w4-m6-ui-manual` → `w4-m6-perf`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- 界面：`Vacuum` 为空时不开预览会话、Create 不可用（tip `Enter the vacuum (total gap in Å; 0 for none).`），填写后才开 P-swap 预览，清空即取消（R-F32、V-F04）；Create 一步撤销、新增结构（P4）；状态行报告配位（L-07，必须）；E2E-5 第 2、4 步
- 命令：`crystallume.command('build.layers', { … })` 不给 `vacuum` → `invalid-params`；只给两个矩阵时 `estimate` 返回精确原子数；超过 `LIMITS.maxAtoms` → `too-large` 文案；命令面板搜 `Build Layers`、`Heterostructure` 能找到
- 性能（`slow`）：`tests/test_interface_perf.py`、`tests/js/perf/interface.perf.mjs` 在 M6 §3.13 与 §7.5 的预算内；验收 S16-10
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M6-T7b Interface 分区（二）：构建选项、预览与 Create（链 `w4-m6-ui-build`）

【目标】Interface 分区的 Build 部分与预览、创建：应变分配、层间距菜单、错位、真空与 "Use interlayer distance"、保留约束/标签、分离结构（S10）、P-swap 预览、Create/Cancel、toast 与配位状态行；（应该）"Stack another layer…"。

【依据】M6 §5.2 的 Build 块（距离菜单同时显示两种接触规则的值与控制对；值 > 3.8 或 < 1.8 Å 时 `This value is unusual for a contact; check it.`；Substrate share 滑块 `aria-valuetext="50% on the substrate"`）、§5.4（**按 V-F04 改写**：真空未填时不开预览会话、不用任何占位真空，列表、详情与 `cellOutlineLayer` 的面内轮廓照常显示，状态行 `vacuum not set`，Create 不可用；填了真空后 `beginStructureEdit('Build layers', { kind: 'structure', owner: 'surface.interface', commitLabel: 'Create', onEnd })` 并预览，第一次预览后 `viewer.fitView()` 一次；清空真空即取消会话；Create = `ses.commit({ addAsNew: true, name })`，`return_parts` 的两个结构在同一历史条目里加入；toast `Built … — N atoms` 经 `toastUndo`；大结构确认用 `LIMITS.confirmAtoms` 30 000）；ledger-features L-M6-06、L-M6-03（状态行句式）、R-F32；负责人决定 L-07；U4（`Vacuum` 用 `numberInput({ required: true, min: 0, max: 1000, unit: 'Å' })`，初始为空、无占位数字，会话内记住用户填的值、不写偏好与 `localStorage`；"Use interlayer distance" 是显式操作，不算预填）、P3、P4。

【实现】只改 `web/js/ui/panels/surface-interface.js` 的段 `M6-T7b`（含段内 import 小块）。

【U 与负责人决定】U3、U4（真空框为空、不预填、为空时不开预览）、P3、P4；负责人决定 L-07。

【文件】`crystallume/web/js/ui/panels/surface-interface.js#M6-T7b`、`tests/js/interface_build_ui.test.mjs`。

【测试】`tests/js/interface_build_ui.test.mjs`：会话只在真空已填时存在的状态机、状态行句式（`anchor C on top, second C on fcc hollow`；只剩一个原子与多原子分组两种）、距离菜单的异常值提示、toast 文案。

【界面检查】（Chromium，本链端口）E2E-5 第 2、4 步：tBLG 选第一项、`Interlayer distance` 选 Custom 填 3.35；`Vacuum` 为空时没有预览条、Create 不可用；填 15 → 预览条 `Preview: Build layers`、Create → 新结构 28 原子、pbc 全 true、|cell[0]| = 6.5085 Å、`cell[2][2]` = 18.35 Å；Ni(111) + 石墨烯距离 Custom 2.10、Vacuum 15 → Create → 6 原子，`exportText('poscar')` 含 `Selective dynamics` 与 2 个 `F F F` 行；状态行报告锚 C 的配位；Ctrl+Z 只撤销 Create；刷新页面后真空框为空。截图存 `scratchpad/shots/w4-m6-ui-build/`。

#### M6-T7c Interface 分区（三）：Manual 矩阵、Registry 与位点菜单、命令、公共 API、右键菜单（链 `w4-m6-ui-manual`）

【目标】Manual 模式、Registry 预设与 M5 位点菜单（S1）、命令 `build.layers`/`build.stackLayer` 与参数 schema、公共 API、项目列表右键菜单（S7）、偏好（S8，不含真空）、触屏与无障碍。

【依据】M6 §5.2（Manual：两个 `imatrixInput({ size: 2, max: 1000, maxDet: 1_000_000, presets })`，预设 1×1、√3×√3R30°、2×2、√7×√7R19.1°、c(2×2) 用 M1 `woodPresets(mesh)` 相对参考网格换算到匹配网格，下方即时显示面积、原子数、扭转与失配；Registry 菜单只列基底存在的预设）、§5.5（`build.layers` 的 `aliases`、`ms`；带参数时无界面构建并加入项目、一步撤销；`estimate` 只在给了两个矩阵时返回精确原子数；`run` 自己搜索与估算，超限抛 `{ code: 'too-large', message: 'Build layers: this would make 250,000 atoms; the limit is 200,000.' }`；`substrate`/`overlayer` 为项目中结构的 id 或名称，否则 `Build layers: no structure named 'X' in the project.`；`build.stackLayer` 的 `whyNot`；项目列表右键 `Use as substrate`/`Use as overlayer`）、§5.6；ledger-features L-M6-06（命令参数 `vacuum: {type: 'float', unit: 'Å', min: 0, max: 1000, required: true}`；公共 API（`defineApi`，owner `M6`）：`build.interface(substrate, overlayer, opts)`（返回新结构、不加入项目、`opts.vacuum` 必填）、`analysis.interfaceMatches(...)`、`analysis.interfaceMatchesAsync(...)`）、L-M5-03（`site_presets`、`adsorption_sites` 的位点菜单）；ledger-F0 L-F0-52、L-F0-53；U4、U5。

【实现】只改 `web/js/ui/panels/surface-interface.js` 的段 `M6-T7c`（含段内 import 小块）；项目列表右键菜单在 `ui/panels/projects.js` 的菜单构造处加两项（以符号定位，只加这两项）。

【U 与负责人决定】U3、U4（命令参数 `vacuum` 必填）、U5；负责人决定：无直接相关项。

【文件】`crystallume/web/js/ui/panels/surface-interface.js#M6-T7c`、`crystallume/web/js/ui/panels/projects.js#context-menu`、`tests/js/interface_manual_ui.test.mjs`。

【测试】`tests/js/interface_manual_ui.test.mjs`：命令参数校验（缺 `vacuum` → `invalid-params`、名字找不到的文案）、`estimate`、Manual 读数、预设换算。

【界面检查】（Chromium，本链端口）Manual 模式选 1×1 与 √3 预设，面积、原子数、失配即时更新；Registry 菜单在 Ni(111) 上有 Top/Bridge/fcc hollow/hcp hollow，`More sites…` 列出 M5 的位点；`crystallume.command('build.layers', { substrate: 'Ni(111) 4L', overlayer: 'graphene' })` 不给 vacuum → `invalid-params`；给 vacuum 15 → 新增结构、一步撤销；命令面板搜 `Build Layers`、`Heterostructure`、`Moiré` 能找到；项目列表右键 `Use as substrate` 把该结构填进 Substrate。截图存 `scratchpad/shots/w4-m6-ui-manual/`。

#### M6-T8a M6 性能基准与预算测试（链 `w4-m6-perf`）

【目标】M6 的性能预算测试与基准脚本（从 M6-T8 拆出）。

【依据】M6 §3.13（预算）、§7.5（`tests/perf/bench_interface.mjs`、`tests/perf/bench_interface.py`，不进常规测试）；acceptance S16-10（Keep the input cell 的 10 086 原子基底上叠石墨烯：构建 ≤ 300 ms（JS）/ ≤ 1 s（Python））；plan.md P-10（JS 基准放 `tests/js/perf/interface.perf.mjs`，由 `tests/test_js_perf.py` 收集；Python 预算测试 `tests/test_interface_perf.py` 用 `slow`）。

【实现】`tests/test_interface_perf.py`（`slow`）、`tests/js/perf/interface.perf.mjs`、`tests/perf/bench_interface.py`（手动运行的基准，打印表格）。超预算时不改实现，把实测与差距写进报告交负责人（实现文件本批次不归本链）。

【U 与负责人决定】U3；负责人决定：无直接相关项。

【文件】`tests/test_interface_perf.py`、`tests/js/perf/interface.perf.mjs`、`tests/perf/bench_interface.py`。

【测试】`pytest -m slow tests/test_interface_perf.py tests/test_js_perf.py`。

### W4.5

第 4 波收尾：文档与应用内帮助、Interface 的 Playwright 冒烟、跨模块回归。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w4-docs` | 8850 | M6-T8b M6 的文档、应用内帮助与导览 | `README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour` |
| `w4-e2e-interface` | 8851 | M6-T8c M6 的 Playwright 冒烟（E2E-5） | `tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/interface.spec.mjs` |
| `w4-xmodule` | — | W4-X1 第 4 波跨模块回归测试（M6 × M1/M2/M3/M5） | `tests/test_w4_crossmodule.py`、`tests/js/w4_crossmodule.test.mjs` |

**合并顺序**：`w4-xmodule` → `w4-e2e-interface` → `w4-docs`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- Playwright：`tests/e2e/interface.spec.mjs`（acceptance E2E-5 全部 4 步与 M6 §7.4）通过，截图在 `tests/e2e/out/`；MD-5 按 R-F32 改写后可手动走通（没有 `shown with 10 Å` 的占位预览）
- 跨模块：`tests/test_w4_crossmodule.py`、`tests/js/w4_crossmodule.test.mjs` 通过（界面上的 M1 超胞改名、M2 改真空保留 `interface`/`adsorbates` 键、M5 在界面上放吸附物、带吸附物的基底 `… + CO`、S15a-6）
- 文档：`docs/PLUGINS.md`（JS/Python API、REST、CLI，`make_interface` 与 `build.interface` 的差别）、`docs/SCHEMA.md`（`props.interface_layer`、`info.surface.kind = "interface"`、`info.surface.interface` 含 `registry`）、`docs/DEPLOY.md`（REST 两行与两个环境变量）、README、应用内帮助（mismatch 与 strain 的区别、默认层间距的适用范围）与导览；随后进入波末三视角审查

#### M6-T8b M6 的文档、应用内帮助与导览（链 `w4-docs`）

【目标】M6 的文档与应用内文案（从 M6-T8 拆出的文档部分）。

【依据】M6 §9 T8（`docs/PLUGINS.md`：JS/Python API、REST、CLI，`make_interface` 与 `build.interface` 的差别；`docs/SCHEMA.md`：`props.interface_layer`、`info.surface.kind = "interface"`、`info.surface.interface`；`docs/DEPLOY.md`：REST 表与两个环境变量；README；应用内帮助："mismatch"与"strain"的区别、默认层间距的适用范围；导览）、§10.6（M7 的统一事项：应变类输入在 CLI 与 M1 `apply_strain` 中是百分数，在 Python/REST/JS 的 `max_strain` 中是分数）；ledger-features L-M6-01…07、L-X-03（`registry = {preset, sites}`）；负责人决定 L-07；U3、U4。

【实现】上述文档与 `ui/shell.js` 的帮助/导览文案（以符号定位）；CHANGELOG。

【U 与负责人决定】U3、U4；负责人决定 L-07。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`CHANGELOG.md`、`crystallume/web/js/ui/shell.js#help-tour`。

【测试】文档例子逐个运行（Python、CLI 的 `build interface --list`）。

【界面检查】（Chromium，本链端口）帮助里有 mismatch 与 strain 的区别、默认层间距的说明；导览提到 Interface 分区。

#### M6-T8c M6 的 Playwright 冒烟（E2E-5）（链 `w4-e2e-interface`）

【目标】Interface 的端到端冒烟：acceptance E2E-5 全部 4 步与 M6 §7.4；本批次维护 harness 与 pytest 包装。

【依据】acceptance §3.2 E2E-5、S15a、S15c 的期望；M6 §7.4；ledger-features R-F32（真空为空时不开预览会话；MD-5 的 `Build layers — vacuum not set (shown with 10 Å)` 作废）；负责人决定 L-06、L-07；U4-a。

【实现】`tests/e2e/interface.spec.mjs`（搜索计时 ≤ 10 s / ≤ 15 s 的断言用 `waitForFunction` 的 timeout）；harness/包装只做必要修改。

【U 与负责人决定】U3、U4-a；负责人决定 L-06、L-07。

【文件】`tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/interface.spec.mjs`。

【测试】`pytest -m slow tests/test_e2e.py -k interface`。

【界面检查】（Chromium，本链端口）E2E-5：tBLG 2 matches → Custom 3.35 → Vacuum 为空时 Create 不可用且无预览条 → 15 → Create → 28 原子；Ni(111) + 石墨烯 561 matches · 8 best trade-offs → 2.10、15 → 6 原子、POSCAR 两个 `F F F` 行；截图交审查。

#### W4-X1 第 4 波跨模块回归测试（M6 × M1/M2/M3/M5）（链 `w4-xmodule`）

【目标】用测试钉住界面结构与其他模块的接缝。

【依据】ledger-features L-M6-04（之后 M1 做 p(2×2) → `MoS2 p(8×8)/Au(111) (2√19×2√19)R23.4°`）、L-X-01（kind interface 的块：M2 Slab 工具照常更新顶层 `vacuum`、`thickness`、`position` 并保留 `interface`、`adsorbates`，M6 §10.4 的请求）、L-X-04（界面上的吸附物记录）、L-X-06、L-X-07（带 CO 的 p(6×6) 基底 Keep the input cell → `graphene …/Pt(111) p(6×6) + CO`；`return_parts` 的名字）、L-M1-07（`reference_mesh` 的 interface 来源）；acceptance S15a-6（Cu(111) 对照）、S15a-4、S15a-5。

【实现】`tests/test_w4_crossmodule.py` 与 `tests/js/w4_crossmodule.test.mjs`（同一组场景两语言）。

【U 与负责人决定】U3；负责人决定 L-12、L-17。

【文件】`tests/test_w4_crossmodule.py`、`tests/js/w4_crossmodule.test.mjs`。

【测试】即上。发现缺陷时写成 `xfail(strict=True, reason="<模块>: <问题>")` 并在报告里交负责人，不在本链改源码。

## 7. 第 5 波：收尾（M7：接口审计、体相名统一、性能、验收测试、端到端、文档、版本与 CHANGELOG）

### W5.1

接口审计与就地修正、体相名统一（负责人决定 L-11）、性能总检查。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w5-api-audit` | 8852 | M7-T1 API 审计：清单测试、命名与选项统一、快捷键与动作配额 | `crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`、`crystallume/core/`、`crystallume/analysis/`、`crystallume/build/__init__.py`、`crystallume/build/surface.py`、`crystallume/build/adsorbate.py`、`crystallume/build/interface.py`、`crystallume/web/js/core/`、`crystallume/web/js/build/surface.js`、`crystallume/web/js/build/adsorbates.js`、`crystallume/web/js/build/interface.js`、`crystallume/web/js/commands/`、`crystallume/web/js/api/cellapi.js`、`crystallume/web/js/render/tools/`、`crystallume/web/js/render/sitemarkers.js`、`crystallume/web/js/io/clipboard.js`、`crystallume/web/js/ui/cellsections.js`、`crystallume/web/js/ui/cellsupercell.js`、`crystallume/web/js/ui/cellmenus.js`、`crystallume/web/js/ui/constraints.js`、`crystallume/web/js/ui/atomselection.js`、`crystallume/web/js/ui/atomactions.js`、`crystallume/web/js/ui/clipboard.js`、`crystallume/web/js/ui/panels/surface-cleave.js`、`crystallume/web/js/ui/panels/surface-slab.js`、`crystallume/web/js/ui/panels/surface-layers.js`、`crystallume/web/js/ui/panels/surface-adsorbates.js`、`crystallume/web/js/ui/panels/surface-interface.js`、`crystallume/web/js/ui/panels/transform.js`、`tests/data/api_inventory.json`、`tests/test_api_inventory.py`、`tests/js/api_inventory.test.mjs` |
| `w5-bulk-name` | 8853 | M7-T6 体相名两种语言统一（负责人决定 L-11） | `crystallume/build/crystal.py`、`crystallume/web/js/build/crystal.js`、`crystallume/web/js/build/reference.js`、`crystallume/web/js/ui/panels/build.js`、`scripts/gen_reference_data.py`、`tests/test_build.py`、`tests/data/surface/`、`tests/test_m2_parity.py`、`tests/test_m5_parity.py`、`tests/test_m6_parity.py`、`tests/test_bulk_name.py` |
| `w5-perf` | 8854 | M7-T5 性能总检查（S16 与 E2E-6） | `tests/test_surface_perf.py`、`tests/test_perf_budgets.py`、`tests/e2e/perf.spec.mjs`、`tests/js/perf/pipeline.perf.mjs` |

**合并顺序**：`w5-bulk-name` → `w5-api-audit` → `w5-perf`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 通过；`git status` 干净
- M7-T1：`tests/test_api_inventory.py`、`tests/js/api_inventory.test.mjs` 通过（两本账本的名字、签名（仅限关键字）、REST 路由与 `ROUTE_METHODS`、新模型 `extra="forbid"`、CLI 选项约定、命令 id 与 MS 别名、选区动作顺序、`SURFACE_DEFAULTS` 各段的键全部在代码里；账本里"已解决的冲突"列出的旧名字都不存在）；快捷键冲突检查（G、N、Shift+N、Shift+5、Shift+L、Shift+U、Shift+A、Shift+S、mod+Enter）无冲突；MD-7 的 9 个 MS 名称都能在命令面板搜到
- M7-T6：`tests/test_bulk_name.py` 通过（同一原型与参数下 Python 与 JS 的体相名逐字相同）；各模块平价测试不再排除 `bulk.name`（L-11 解除）
- M7-T5：`pytest -m slow tests/test_perf_budgets.py tests/test_surface_perf.py tests/test_js_perf.py` 与 `tests/e2e/perf.spec.mjs`（E2E-6）在预算内（断言 2 倍预算，CI 再 ×3）；验收 S16-1–S16-10；超预算项已列给负责人
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M7-T1 API 审计：清单测试、命名与选项统一、快捷键与动作配额（链 `w5-api-audit`）

【目标】对照两本账本审计全部公开接口（Python、JS、REST、客户端、CLI、命令、快捷键、选区动作），把清单固化成测试，并在本链拥有的接口文件里就地修正偏差。

【依据】简报 §5（API 约定）、§4（可用与保留的快捷键：不注册 Ctrl/⌘ C/V/X，不用 E、Q、Alt+字母）；ledger-F0 §0.3、L-F0-52（命令表）、L-F0-53；ledger-features §0.3（命名、仅限关键字、REST `extra="forbid"` 与错误码、CLI 约定 R-F13）、§0.5、§1（每条"已解决的冲突"里被废弃的名字不得作为别名保留）、各 L-Mk-nn 条目、§10.0、§10.5 第 10 条（`sites.toggle` Shift+S 与 `adsorbate.add` Shift+A 的冲突检查）；acceptance §0.6、MD-7；plan.md P-11（选区动作顺序 Fix ▾ 35、Move… 60、Rotate… 61、`sel.markAdsorbate` 70、M4 72–76、`cell.atomToOrigin` 80；在桌面与手机上 Fix ▾ 都在前五个可见动作之内）；M6 §10.6（应变类输入在 CLI 与 `apply_strain` 中是百分数、在 `max_strain` 中是分数，文档写清，不改语义）。

【实现】`tests/data/api_inventory.json`（由脚本从两本账本抽取后人工核对：每个名字、签名、所在文件、语言、REST 路由、CLI 子命令与选项、命令 id/别名/键、选区动作 id/order）；`tests/test_api_inventory.py` 与 `tests/js/api_inventory.test.mjs` 逐项断言；偏差在本链拥有的文件里修正（名字、选项、`extra="forbid"`、`nargs`、错误码、缺失的客户端方法与 `ROUTE_METHODS`、命令别名、键冲突的重新分配需负责人确认，在报告里列出）；不能在本链文件里修的写成 `xfail(strict=True, reason=…)` 并交负责人。

【U 与负责人决定】U1–U6（acceptance §0.6 的合规项都要有对应的名字与选项）；负责人决定 L-06（aria-label）、L-10、L-18；键的重新分配需负责人确认。

【文件】`crystallume/server/models.py`、`crystallume/server/routes/build.py`、`crystallume/server/routes/analysis.py`、`crystallume/server/auth.py`、`crystallume/server/deps.py`、`crystallume/client.py`、`crystallume/cli.py`、`crystallume/config.py`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/test_hardening.py`、`tests/test_limits.py`、`crystallume/core/`、`crystallume/analysis/`、`crystallume/build/__init__.py`、`crystallume/build/surface.py`、`crystallume/build/adsorbate.py`、`crystallume/build/interface.py`、`crystallume/web/js/core/`、`crystallume/web/js/build/surface.js`、`crystallume/web/js/build/adsorbates.js`、`crystallume/web/js/build/interface.js`、`crystallume/web/js/commands/`、`crystallume/web/js/api/cellapi.js`、`crystallume/web/js/render/tools/`、`crystallume/web/js/render/sitemarkers.js`、`crystallume/web/js/io/clipboard.js`、`crystallume/web/js/ui/cellsections.js`、`crystallume/web/js/ui/cellsupercell.js`、`crystallume/web/js/ui/cellmenus.js`、`crystallume/web/js/ui/constraints.js`、`crystallume/web/js/ui/atomselection.js`、`crystallume/web/js/ui/atomactions.js`、`crystallume/web/js/ui/clipboard.js`、`crystallume/web/js/ui/panels/surface-cleave.js`、`crystallume/web/js/ui/panels/surface-slab.js`、`crystallume/web/js/ui/panels/surface-layers.js`、`crystallume/web/js/ui/panels/surface-adsorbates.js`、`crystallume/web/js/ui/panels/surface-interface.js`、`crystallume/web/js/ui/panels/transform.js`、`tests/data/api_inventory.json`、`tests/test_api_inventory.py`、`tests/js/api_inventory.test.mjs`（目录条目以 `/` 结尾；体相名相关的 `crystallume/build/crystal.py`、`crystallume/web/js/build/crystal.js`、`crystallume/web/js/ui/panels/build.js` 归 `w5-bulk-name`，本链不改）。

【测试】即上；全量测试通过。

【界面检查】（Chromium，本链端口）命令面板搜 `Cleave Surface`、`Build Vacuum Slab`、`Supercell`、`Redefine Lattice`、`Modify Constraints`、`Atom Selection`、`Add Adsorbate`、`Find Adsorption Sites`、`Build Layers` 都能找到并显示 MS 名称（MD-7）；快捷键对话框里没有重复的键；选区卡片前五个可见动作在桌面与 390×844 视口下都包含 Fix ▾。

#### M7-T6 体相名两种语言统一（负责人决定 L-11）（链 `w5-bulk-name`）

【目标】让 Python 与 JS 的体相构建器给出逐字相同的结构名，并解除各模块跨语言比较里对 `info.surface.bulk.name` 的排除。

【依据】负责人决定 L-11（收尾阶段统一；此前比较排除 `bulk.name`）；acceptance §4.1 G-30（Python `Pt fcc`、JS `Pt (Face-centred cubic)`）、C-9；ledger-F0 L-F0-29（默认参数表对齐，名字留给 M7）；M2 §5.2 的 Bulk 行示例 `Bulk: Pt fcc · 4 atoms · Fm-3m`；plan.md P-12（建议统一为 Python 现行写法 `<式> <原型键>`，如 `Pt fcc`；若负责人选另一种写法，按负责人的写）。

【实现】`build/crystal.py`、`web/js/build/crystal.js`（及 `web/js/build/reference.js`、`scripts/gen_reference_data.py` 中与名字有关的部分）、`web/js/ui/panels/build.js`（Build 面板显示名，如有）；`tests/test_bulk_name.py`（全部原型 × 代表性参数，两语言逐字相同）；去掉 `tests/test_m2_parity.py`、`tests/test_m5_parity.py`、`tests/test_m6_parity.py` 中对 `bulk.name` 的排除；金标里存了体相名的期望（`tests/data/surface/**`）一并更新；已存项目里的旧名字不改（只影响新建的体相），并在报告里给出 CHANGELOG 的一句话交 `w5-release`。

【U 与负责人决定】U6；负责人决定 L-11（P-12 的写法需负责人确认）。

【文件】`crystallume/build/crystal.py`、`crystallume/web/js/build/crystal.js`、`crystallume/web/js/build/reference.js`、`crystallume/web/js/ui/panels/build.js`、`scripts/gen_reference_data.py`、`tests/test_build.py`、`tests/data/surface/`、`tests/test_m2_parity.py`、`tests/test_m5_parity.py`、`tests/test_m6_parity.py`、`tests/test_bulk_name.py`。

【测试】即上；全量测试与平价测试通过。

【界面检查】（Chromium，本链端口）Build 面板建 Pt fcc 后，结构名与 Python `build.crystal("fcc", "Pt", a=3.92).name` 相同；Surface › Cleave 的 Bulk 行显示同一名字。

#### M7-T5 性能总检查（S16 与 E2E-6）（链 `w5-perf`）

【目标】把各模块的性能预算合成一次总检查：S16a（216 原子）与 S16b（10 086 原子）的全流程，以及浏览器内的 E2E-6。

【依据】acceptance S16（S16-1–S16-10 的期望表）、§3.1（`tests/test_surface_perf.py`，`slow`，2× 预算断言）、§3.2 E2E-6（页面里用 `performance.now()` 计时：`crystallume.build.surface(bulkPt, { miller: [1, 1, 1], layers: 6, vacuum: 15, supercell: [[41, 0], [0, 41]] })` 10 086 原子 ≤ 120 ms；`crystallume.analysis.layers(s)` ≤ 40 ms；`crystallume.analysis.sites(s)` ≤ 800 ms 且计数 top 1681、bridge 5043、hollow 3362；50 次交替 `fixLayers` 每次 ≤ 120 ms、`app.history.bytes` ≤ 64 MiB；断言用 2× 预算，CI 再 ×3）、各模块 §7 的预算表（M1 §7.4、M2 §7.5、M3 §7.5、M4 §7.5、M5 §7.5、M6 §3.13）；简报 §6（每个模块写出性能预算）；plan.md P-10。

【实现】`tests/test_perf_budgets.py`（`slow`，S16a/S16b 的 Python 部分）、在 `tests/test_surface_perf.py` 补 S16 的切面部分、`tests/js/perf/pipeline.perf.mjs`（JS 全流水线）、`tests/e2e/perf.spec.mjs`（E2E-6，`slow`）。只测与报告；超预算项写清实测、预算、所在函数，交负责人在波末审查后安排修复（本链不改实现文件）。

【U 与负责人决定】U6（超预算项由负责人在波末审查后安排）；负责人决定：无直接相关项。

【文件】`tests/test_surface_perf.py`、`tests/test_perf_budgets.py`、`tests/js/perf/pipeline.perf.mjs`、`tests/e2e/perf.spec.mjs`。

【测试】`pytest -m slow tests/test_perf_budgets.py tests/test_surface_perf.py tests/test_js_perf.py tests/test_e2e.py -k perf`。

【界面检查】（Chromium，本链端口）E2E-6 的计时在本机硬件 GL 与软件 GL（SwiftShader，再放宽 2 倍）下各跑一次，结果写进报告。

### W5.2

验收自动测试、最终端到端与演示截图、文档定稿、版本 0.4.0 与 CHANGELOG、清理段落标记。

| 链 | 端口 | 任务 | 独占的文件 |
|---|---|---|---|
| `w5-acceptance` | — | M7-T3 验收场景的自动测试（S1–S16） | `tests/test_acceptance_surface.py`、`tests/test_acceptance_cli.py`、`tests/test_acceptance_rest.py`、`tests/data/surface/acceptance/`、`tests/ops/acceptance.py`、`tests/js/ops/acceptance.mjs`、`scripts/gen_acceptance_fixtures.py` |
| `w5-e2e` | 8855 | M7-T4 最终端到端（E2E-1…E2E-5）与演示截图（MD-1…MD-8） | `tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/e2e1_cleave_fix_adsorb_export.spec.mjs`、`tests/e2e/e2e2_contcar_roundtrip.spec.mjs`、`tests/e2e/e2e3_srtio3_terminations.spec.mjs`、`tests/e2e/e2e4_graphene.spec.mjs`、`tests/e2e/e2e5_interfaces.spec.mjs`、`tests/e2e/w1_acceptance.spec.mjs`、`tests/e2e/w2_acceptance.spec.mjs`、`tests/e2e/w3_acceptance.spec.mjs`、`tests/e2e/demo_walkthrough.spec.mjs` |
| `w5-docs` | 8856 | M7-T2 文档定稿：README、PLUGINS、SCHEMA、DEPLOY、应用内帮助、快捷键对话框与导览 | `README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`crystallume/web/js/ui/shell.js#help-tour`、`tests/test_docs_examples.py` |
| `w5-release` | 8857 | M7-T7 版本 0.4.0、CHANGELOG 与段落标记清理 | `crystallume/_version.py`、`crystallume/web/js/app.js#VERSION`、`docker-compose.yml`、`CHANGELOG.md`、`tests/test_segments.py`、`crystallume/core/defaults.py`、`crystallume/web/js/core/defaults.js`、`crystallume/core/structure.py`、`crystallume/web/js/core/structure.js`、`crystallume/core/naming.py`、`crystallume/web/js/core/naming.js`、`crystallume/core/lattice.py`、`crystallume/web/js/core/lattice.js`、`crystallume/core/intmath.py`、`crystallume/web/js/core/intmath.js`、`crystallume/core/cellops.py`、`crystallume/web/js/core/cellops.js`、`crystallume/core/infohandlers.py`、`crystallume/web/js/core/infohandlers.js`、`crystallume/build/__init__.py`、`crystallume/analysis/__init__.py`、`crystallume/build/surface.py`、`crystallume/web/js/build/surface.js`、`crystallume/analysis/sites.py`、`crystallume/web/js/core/sites.js`、`crystallume/build/adsorbate.py`、`crystallume/web/js/build/adsorbates.js`、`crystallume/web/js/ui/panels/transform.js`、`crystallume/web/js/ui/panels/surface-interface.js`、`crystallume/web/js/main.js`、`crystallume/web/css/app.css`、`crystallume/web/js/ui/icons.js`、`crystallume/web/js/app.js#segments` |

**合并顺序**：`w5-acceptance` → `w5-e2e` → `w5-docs` → `w5-release`

**出口检查**：

- 通用：在集成分支上 `$DEVPY -m pytest -q -p no:cacheprovider` 全部通过（含 `tests/test_js_unit.py` 收集的 `tests/js/*.test.mjs`）；`CRYSTALLUME_REQUIRE_NODE=1` 下同样通过；`tests/test_segments.py` 已随段落标记一起删除；`git status` 干净
- 验收：`tests/test_acceptance_surface.py`（`test_s01`…`test_s16`）、`tests/test_acceptance_cli.py`（S1、S9、S14 的 CLI 序列，含省略 `--vacuum` 退出码 2）、`tests/test_acceptance_rest.py`（S1：`/build/surface` → `/analysis/sites` → `/build/adsorbate` → `/io/export`；缺 `vacuum` → 422）全部通过；`tests/data/surface/acceptance/` 的 `pipeline` 金标两语言通过（P6）；G-15、G-32、G-39 已按 L-03、L-12、L-19 裁决，不再有 xfail
- 端到端：`CRYSTALLUME_REQUIRE_NODE=1 CRYSTALLUME_REQUIRE_E2E=1 $DEVPY -m pytest -m slow` 全部通过：E2E-1…E2E-6（acceptance §3.2，E2E-4 第 3 步按 L-16、MD-5 按 R-F32 改写）；MD-1…MD-8 的截图已交审查（`scratchpad/shots/w5-e2e/`）
- U1–U6 合规：acceptance §0.6 的 U1-a…U6 逐条在 E2E 或验收测试里有对应断言（由 `w5-acceptance` 在报告里列出对照表）
- 发布：`crystallume.__version__ == "0.4.0"`，`tests/test_version.py` 通过（`app.js` 的 VERSION 与 compose 镜像标签一致）；`CHANGELOG.md` 有 0.4.0 一节，列出行为变化（JS 读写 POSCAR 的 SD、extxyz 写 `move_mask`、`build.crystal(vacuum=)` 的 `DeprecationWarning`（L-02）、体相名统一（L-11）、`repeat` 与 `make_supercell` 的关系等）；文档里的例子全部能运行
- 界面：应用在静态模式（`python3 -m http.server <端口> --directory crystallume/web`）与 `crystallume serve` 下都能启动，`document.body.dataset.ready === 'true'`，控制台无 `pageerror`/`console.error`

#### M7-T3 验收场景的自动测试（S1–S16）（链 `w5-acceptance`）

【目标】把 acceptance.md 的场景变成自动测试：Python 公开 API 的 `test_sNN_*`、CLI 与 REST 的版本、两语言的 `pipeline` 金标。

【依据】acceptance §3.1（总表与规则：金标用 `crystallume.cases/1` 外壳并新增 op `pipeline`，放在 `tests/ops/acceptance.py` 与 `tests/js/ops/acceptance.mjs`，不改 `tests/cases.py`；`input.recipe` 或 `input.file`（S14 用 `tests/data/surface/contcar_pt111.vasp`）；`args.steps` 依次列出 `surface`、`setVacuum`、`makeSupercell`、`fixLayers`、`fix`、`fixHeight`、`delete`、`sites`、`addAdsorbate`、`addAdsorbates`、`read`、`write`、`interfaceMatches`、`makeInterface`，每步可 `save`；`expect` 用公共比较器；期望值来源顺序：解析解 > 本文原型数字 > 开发期 ASE/pymatgen 核对后固化）、§1（C-1…C-9）、§2（S1–S16 的期望表与容差 §0.5）、§0.6（U1–U6 合规项）；负责人决定 L-03、L-12、L-15（吸附高度按 S1-6′ 的式子现算）、L-18、L-19；plan.md P-16（CLI 序列按 ledger-features R-F13 改写：`--surface-cell`、`--index`、`--from`/`--format`）。

【实现】`tests/test_acceptance_surface.py`、`tests/test_acceptance_cli.py`（`subprocess` 跑 S1、S9、S14 的 CLI 序列，检查 stdout/stderr 与退出码）、`tests/test_acceptance_rest.py`（`TestClient` 跑 S1）、`tests/data/surface/acceptance/*.json`（S1、S8、S9、S13、S14、S15 存完整原子列表，其余存解析期望）、`tests/ops/acceptance.py`、`tests/js/ops/acceptance.mjs`、`scripts/gen_acceptance_fixtures.py`（开发期运行）。报告里附 U1-a…U6 与测试的对照表。

【U 与负责人决定】U1–U6（报告附对照表）；负责人决定 L-03、L-12、L-15、L-18、L-19。

【文件】`tests/test_acceptance_surface.py`、`tests/test_acceptance_cli.py`、`tests/test_acceptance_rest.py`、`tests/data/surface/acceptance/`、`tests/ops/acceptance.py`、`tests/js/ops/acceptance.mjs`、`scripts/gen_acceptance_fixtures.py`。

【测试】即上，全部通过（S16 的计时部分标 `slow`）。发现缺陷时写成 `xfail(strict=True, reason="<模块>: <问题>")` 并交负责人。

#### M7-T4 最终端到端（E2E-1…E2E-5）与演示截图（MD-1…MD-8）（链 `w5-e2e`）

【目标】按 acceptance §3.2 定稿全部 Playwright 冒烟（E2E-1…E2E-5；E2E-6 在 W5.1 的 `w5-perf`），合并各波的临时验收 spec，并为 MD-1…MD-8 生成交审查的截图。

【依据】acceptance §3.2（运行方式：`tests/e2e/*.spec.mjs`、共用 `harness.mjs`、`--no-sandbox --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`、视口 1280×800、收集 `pageerror` 与 `console.error`、`section(name)` 与可访问名称定位、截图 `tests/e2e/out/<spec>-<step>.png`、数值断言读 `window.crystallume`）与 E2E-1…E2E-5 的步骤；§3.3（MD-1…MD-8 的看点）；负责人决定 L-06、L-15、L-16（E2E-4 第 3 步用内嵌编辑器）、L-18；ledger-features R-F32（MD-5 没有 10 Å 占位预览）；plan.md P-14、P-16。

【实现】五个 spec 文件 `tests/e2e/e2e1_cleave_fix_adsorb_export.spec.mjs` … `e2e5_interfaces.spec.mjs`（复用 W1–W4 的 spec 中已写好的步骤后删除 `w1/w2/w3_acceptance.spec.mjs`）；`harness.mjs` 按 §3.2 补齐（`CRYSTALLUME_CHROMIUM` 环境变量、SwiftShader 参数）；`tests/test_e2e.py` 支持 `CRYSTALLUME_REQUIRE_E2E=1`；`tests/e2e/demo_walkthrough.spec.mjs` 按 MD-1…MD-8 的看点脚本化走一遍并截图到 `scratchpad/shots/w5-e2e/`（需要人眼判断的项在报告里逐条写明看什么），390×844 窄屏一次（MD-6）。

【U 与负责人决定】U1–U6；负责人决定 L-06、L-15、L-16、L-18。

【文件】`tests/e2e/harness.mjs`、`tests/test_e2e.py`、`tests/e2e/e2e1_cleave_fix_adsorb_export.spec.mjs`、`tests/e2e/e2e2_contcar_roundtrip.spec.mjs`、`tests/e2e/e2e3_srtio3_terminations.spec.mjs`、`tests/e2e/e2e4_graphene.spec.mjs`、`tests/e2e/e2e5_interfaces.spec.mjs`、`tests/e2e/w1_acceptance.spec.mjs`、`tests/e2e/w2_acceptance.spec.mjs`、`tests/e2e/w3_acceptance.spec.mjs`（删除）、`tests/e2e/demo_walkthrough.spec.mjs`。

【测试】`CRYSTALLUME_REQUIRE_E2E=1 $DEVPY -m pytest -m slow tests/test_e2e.py`。

【界面检查】（Chromium，本链端口）E2E-1…E2E-5 全部步骤；MD-1（S1 全流程的叠加层、标记形状、幽灵 CO、固定光环、N 与 Shift+N、G 拖动只多一步撤销）、MD-2（S5、S6 侧视顶面朝上、(211) 台阶局部法向）、MD-3（S8 删桥氧、Atom Selection 非模态）、MD-4（CONTCAR 一整块、悬停卡、导入无提示）、MD-5（键盘导航与 120 ms 预览、Stop、真空未填时没有预览）、MD-6（216 原子无可感知延迟；窄屏底部抽屉、行高 ≥ 44 px）、MD-7、MD-8（`crystallume serve` 下重复 S1，客户端结果与本地相同）的截图交审查。

#### M7-T2 文档定稿：README、PLUGINS、SCHEMA、DEPLOY、应用内帮助、快捷键对话框与导览（链 `w5-docs`）

【目标】把各波的文档合成一份前后一致的定稿，并让文档里的例子可以自动核对。

【依据】简报 §5（文档清单：README、`docs/PLUGINS.md`（JS/Python API、REST）、`docs/SCHEMA.md`（props、`info.surface`）、`docs/DEPLOY.md`（REST 表）、应用内帮助、快捷键对话框和导览）、P7（应用界面英文、文档沿用现有的简明英文风格）；两本账本的全部公开条目（以 W5.1 的 `tests/data/api_inventory.json` 为准）；ledger-features §0.3（真空语义）、L-X-01…08；负责人决定 L-02（二维原型的每侧真空）、L-11、L-13、L-16；U1–U6（文档不出现 slab 模式、不写默认真空）。

【实现】README（功能总览、Mouse and keys 一节：G、N、Shift+N、Shift+5、Shift+L、Shift+U、Shift+A、Shift+S 以 W5.1 审计后的为准）、`docs/PLUGINS.md`（完整的 JS/Python/REST/客户端/CLI 表，`defineApi` 的命名空间）、`docs/SCHEMA.md`（props 与 `info.surface` 全表、`crystallume.sites/1`、`crystallume.adsorbates/1`、`crystallume.atoms/1`、查询 JSON）、`docs/DEPLOY.md`（全部 REST 行、限额与环境变量、云模式登录规则）、应用内帮助、快捷键对话框、导览（`ui/shell.js`，以符号定位）；`tests/test_docs_examples.py`（抽取文档中的 Python 代码块与 CLI 例子在临时目录运行；标 `slow`）。CHANGELOG 由 `w5-release` 负责，本链不改。

【U 与负责人决定】U1–U6（文档不出现 slab 模式与默认真空）；负责人决定 L-02、L-11、L-13、L-16。

【文件】`README.md`、`docs/PLUGINS.md`、`docs/SCHEMA.md`、`docs/DEPLOY.md`、`crystallume/web/js/ui/shell.js#help-tour`、`tests/test_docs_examples.py`。

【测试】`pytest -m slow tests/test_docs_examples.py`。

【界面检查】（Chromium，本链端口）快捷键对话框与 README 的 Mouse and keys 一致；导览走一遍 Surface 面板五个分区与 Structure 面板的 Cell、Transform、Constraints 分区；帮助里没有 slab 模式与默认真空的说法。

#### M7-T7 版本 0.4.0、CHANGELOG 与段落标记清理（链 `w5-release`）

【目标】发布准备：版本号升到 0.4.0、整理 CHANGELOG、删除 W1-S0 引入的段落标记与它的测试。

【依据】F0-D §4.5（行为变化写进 CHANGELOG，版本进 0.4）；`tests/test_version.py`（`app.js` 的 `VERSION` 与 `docker-compose.yml` 的镜像标签必须等于 `crystallume.__version__`）；负责人决定 L-02、L-11；plan.md P-01（段落标记只是开发期的归属手段，W5 清理）。

【实现】`crystallume/_version.py` → `0.4.0`；`web/js/app.js` 的 `export const VERSION` 一行；`docker-compose.yml` 的镜像标签；`CHANGELOG.md`：把各波 Unreleased 的条目整理成 0.4.0 一节（新功能按模块；行为变化：JS 读写 POSCAR 的 Selective dynamics、extxyz 写 `move_mask` 不再写 `selective_dynamics:L:3`、`build.crystal(..., vacuum=)` 每侧真空的 `DeprecationWarning`、Build 面板 `Cell height c (Å)`、体相名统一、`repeat` 与 `make_supercell` 的关系、`info.warning` → `info.warnings`、二面角符号）；删除全部 `--- surface-modeling … ---` 与 `--- end … ---` 标记行（只删注释行，不动代码）与 `tests/test_segments.py`。

【U 与负责人决定】U6；负责人决定 L-02、L-11（CHANGELOG 的行为变化）。

【文件】`crystallume/_version.py`、`crystallume/web/js/app.js#VERSION`、`docker-compose.yml`、`CHANGELOG.md`、`tests/test_segments.py`、`crystallume/core/defaults.py`、`crystallume/web/js/core/defaults.js`、`crystallume/core/structure.py`、`crystallume/web/js/core/structure.js`、`crystallume/core/naming.py`、`crystallume/web/js/core/naming.js`、`crystallume/core/lattice.py`、`crystallume/web/js/core/lattice.js`、`crystallume/core/intmath.py`、`crystallume/web/js/core/intmath.js`、`crystallume/core/cellops.py`、`crystallume/web/js/core/cellops.js`、`crystallume/core/infohandlers.py`、`crystallume/web/js/core/infohandlers.js`、`crystallume/build/__init__.py`、`crystallume/analysis/__init__.py`、`crystallume/build/surface.py`、`crystallume/web/js/build/surface.js`、`crystallume/analysis/sites.py`、`crystallume/web/js/core/sites.js`、`crystallume/build/adsorbate.py`、`crystallume/web/js/build/adsorbates.js`、`crystallume/web/js/ui/panels/transform.js`、`crystallume/web/js/ui/panels/surface-interface.js`、`crystallume/web/js/main.js`、`crystallume/web/css/app.css`、`crystallume/web/js/ui/icons.js`、`crystallume/web/js/app.js#segments`（`tests/test_segments.py` 删除；其余带段落的文件只删标记行，`app.js#segments` 指 `class App` 末尾的三对标记）。

【测试】`tests/test_version.py`；全量测试（含 node）通过；`grep -r "surface-modeling" crystallume tests` 无结果。

【界面检查】（Chromium，本链端口）应用的关于/帮助里显示 0.4.0；删除标记后应用照常启动、各面板与分区正常。

## 8. 风险与需要负责人确认的事项

### 8.1 主要风险

| 风险 | 说明与对策 |
|---|---|
| 段落纪律 | 开发代理越出自己的段或命名行段，会让并行链在合并时冲突。对策：W1-S0 的 `tests/test_segments.py`；核查代理检查 diff 只落在【文件】列出的范围；集成代理按 §2.2 处理残余冲突。 |
| 第 0 波与账本的偏差 | 第 1 波起的所有任务按账本写；第 0 波实现若有出入（会话的提交语义、项目条目序列化、e2e harness 是否自动收集等），会在第 1 波各处冒出来。对策：W1.1 的 M1-T12 契约测试先暴露；P-04 等条件性修补写在具体任务里。 |
| 两语言在同一子批次分头实现 | M2-T3/T6a、M2-T4/T6b、M6-T1/T2、M6-T4/T5 两边同时按规格实现，可能对规格有不同理解。对策：先写共同的解析金标（W1.1、W4.1），紧接着的子批次做平价（M2-T7c/T7b、M6-T3b）；分歧按简报原则裁决并记录，不改金标凑数。 |
| 第 1 波最长（7 个子批次、35 条链） | M1、M2、M3 三个模块互相依赖（原胞、层分析、命名）。对策：M2-T4n、M1-T10 的提前与钩子设计（P-05、P-06）；若进度紧，可接受 M2 §9 允许的替身方案（§1.2）。 |
| 大的界面任务 | M2-T9、M3-T8、M3-T10、M4-T7a、M5-T9a、M6-T7a 都是 L；界面检查与 e2e 才能发现交互问题。对策：每个界面任务都有写明的 Chromium 检查与截图；各波最后的 e2e 链按 acceptance 步骤复核。 |
| 性能预算 | M1 原胞（1 万原子）、M2 分析（2000 原子 OUC）、M5 位点（1 万原子）、M6 搜索与 S16 的浏览器预算。对策：每波都有性能链；W5.1 总检查；超预算交波末审查安排修复。 |
| 自动名机制跨四个模块 | `autoName` 与 `refresh_auto_name`（L-12、L-19）在 M1、M2、M5、M6 都要正确调用，任何一处漏调都会让名字与数据不一致。对策：命名核心提前、各波跨模块回归（W1-X1、W4-X1）与验收 S1、S2、S3、S13、S15 的名字断言。 |
| 串行时间长 | 24 个子批次加 5 次审查；任何一个子批次的阻断都推迟后面全部工作。对策：§1.2 的两个可选缩短方案；阻断问题按 U6 由负责人当场裁决。 |

### 8.2 需要负责人确认（开发不等待，按默认做法进行）

1. **P-04** 预览条与 mod+Enter 的"新增结构"语义：默认在 W1.6 由 M2-T9 加 `commitArgs` 会话选项（只在第 0 波实现确有问题时）。
2. **P-12** 体相名统一为哪种写法：默认 `Pt fcc`（Python 现行写法）。
3. **快捷键** Shift+A（`adsorbate.add`）与 Shift+S（`sites.toggle`）：默认按 M5 的提议注册，W5.1 的 M7-T1 复核（ledger-features §10.5 第 10 条）。
4. **是否采用缩短方案**（§1.2）：默认不采用。
5. **Cell 插槽的分区形式**（P-09）：默认 5 个分区；若负责人要账本字面的单一分区 `cell`，M1-T7a 在其中放 5 个子分区，深链 id 不变。

## 9. 校验

`plan.json` 用 `python3 -I -c "import json; json.load(open('/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/design/plan.json'))"` 读入通过。
文件归属由 `/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/planwork/check_plan.py` 检查（用法：`python3 -I check_plan.py plan.json`）：格式与键名完全符合约定；任务、链 id 唯一；有界面工作的链端口唯一且 ≥ 8820；`mergeOrder` 与链一一对应；每个子批次内没有一个文件同时归两条链（同一路径不带段、同一段、整文件与其中某段、目录与其下文件，都算冲突）。本次运行结果：

```
W1: 7 sub-waves, 35 chains, 45 tasks
W2: 5 sub-waves, 23 chains, 26 tasks
W3: 5 sub-waves, 19 chains, 20 tasks
W4: 5 sub-waves, 16 chains, 16 tasks
W5: 2 sub-waves, 7 chains, 7 tasks
total: 24 sub-waves, 100 chains, 114 tasks, 38 UI ports
OK: format valid; ids unique; ports unique; merge orders match; no file owned by two chains in a sub-wave
```

另外两项核对：生成脚本（同目录 `build.py`）检查每个 `路径#名字` 都在 §2.2 的段落表或命名行段表里；对校验脚本做了反向测试——人为加入"整文件归两条链""整文件与其中一段""同一段归两条链""目录与其下文件""重复端口""mergeOrder 少一条链""多余键名"七种错误，全部被检出。
