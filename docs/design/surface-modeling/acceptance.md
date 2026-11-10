# 表面建模功能：端到端验收场景

本文写给开发、测试和验收的人：每个场景给出前置条件、界面操作（面板、分区、控件用规格里的英文名字）、等价的 Python API 与 CLI、
带数值和容差的期望结果、对用户决定 U1–U6 的合规检查，以及覆盖每一步的规格章节。§3 规定哪些场景变成自动测试，§4 列出规格没覆盖或相互冲突的地方。

## 0. 依据、约定与数值来源

### 0.1 依据与版本

- 简报 `design/00-architecture.md` v2。**文首 U1–U6 优先于一切**，下文凡与模块规格冲突处都按 U1–U6 写，并在 §4 登记。
- 模块规格（文件头版本；M1、M2、M5、M6 在本文写作期间修订，最后一次核对 12:18）：

  | 规格 | 本文所用版本 | 说明 |
  |---|---|---|
  | F0-D、F0-A、M3、M4 | v2 | 定稿 |
  | M1 | **v2**（11:51 写完） | 用了 K5（命名只有一套机制）、K13 与 D13（预设标签）、§3.5.4 的改名规则、§5.3 Supercell 的控件、读数、撤销标签与 toast |
  | M2 | **v2**（11:47 写完） | 控件名、文案、`info.surface` 字段、K9（默认 4 层）、K11（真空必填、V = 0 = 体相堆垛）、K12（`pbc = T T T`、按元素分块）、K15、K17、§3.13 命名都按 v2 写 |
  | M5 | **v2**（12:12 读到的全文，含修订记录） | K3/K4（微面三重位）、K6（化合物表面的空位名）、K7 与 §3.5（按类的接近方向）、K9（有效半径定键长）、K12（覆盖度以 1×1 胞为分母）、K14（幽灵不开会话）；§3.11 警告文案、§3.12 批量规则、§4.5 命名、§5 控件与文案、§5.7 撤销标签与 toast、§6 API 与 CLI、§7.3 原型位点表都按 v2 全文核对 |
  | M6 | **v2**（12:17 读到 §0–§10、附录与修订记录；文件仍在小改） | `pbc = T T T`、真空必填（允许 0，无 `periodic`）、`info.surface.interface`、命令 `build.layers`、§3.6 的类数（±θ 各算一类）与取向变体、§3.8.3 锚原子与错位预设、§4.4 命名、§5.2–5.4 控件、预览与 toast、§6.1/§6.4 API 与 CLI |
  | 第 0 波 API 账本 `design/ledger-F0.md` | 冻结版（12:13） | 账本文首：模块规格与账本不一致时以账本为准。本文据此用了命令 ID、标题与参数名（L-F0-52：`surface.cleave` 的参数是 `miller`，没有 `surface.supercell`）、测试桥与各模块的 op 文件（L-F0-27）、POSCAR 读写与唯一的 CONTCAR 夹具（L-F0-23、L-F0-27） |

  v1 中与 U1–U4 冲突、已被 v2 或账本改掉的地方列在 §4.2；仍未解决、或 v2 之间新出现的冲突列在 §4.1。

- 调研报告 `maps/01`–`07`、审查 `reviews/*.md`（引用时写"M5 领域审查 #7"这样的编号）。
- 仓库 HEAD `1bb366f`（只读；本文没有修改仓库和规格）。

### 0.2 数值来源

所有期望值都由解析式或本人写的 numpy 原型算出，脚本在
`/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/proto/xcheck/acc/`：

| 脚本 | 内容 |
|---|---|
| `slabkit.py` | 独立实现的切面器（自写，不是 M2 原型的移植）：平移搜索求原胞 → 整数面内基（120°/钝角约定、右手）→ 0.3 Å 周期单链分层 → 两级指纹去重终止面 → 断键数（smart 金属规则）→ slab 组装（`pbc = T T T`、总真空、居中、顶层首原子在面内原点、F0-D K14 的 `canonical_order`、tags、固定底层）→ 面内超胞；体相取自仓库 `facet.build.crystal`（只读导入） |
| `scen.py` | 场景 S1–S13 的 slab 数字；位点分类调用 M5 原型 `proto/m5/sites.py`，放置高度调用 `proto/m5/place.py` 并用自写的接触抬升 `lift()` 复核 |
| `pt211_place.py` | Pt(211) 空位按 M5 规格（三维外接圆心、局部法向）放 O，修正 M5 v1 原型的偏差（§4.2 G-16） |
| `v2_heights.py` | 按 M5 v2 K9 的有效金属半径（slab 里金属–金属键长中位数的一半）重算全部吸附高度与键长 |
| `tio2_vac_check.py`、`shift_invariance.py` | TiO2(110) 氧空位的位点计数随面内原点变化（§4.1 G-15）；其余 11 个 slab 的平移不变性 |
| `s1_poscar.py` | S1 最终 POSCAR 的头部、标志与坐标 |
| `contcar_rt.py` | S14 的 CONTCAR 夹具 `contcar_pt111.vasp`（同目录）、用仓库现有 Python 读写器往返、规范形比较 |
| `iface.py` | S15 三个界面的构建（自写） |
| `m6v2_counts.py` | 用 M6 v2 原型 `proto/m6v2/match_v2.py`（只读导入）重算 S15 的匹配类数：graphene/Ni(111) 561 类、8 个 Pareto；MoS2/Au(111) 148 类、12 个；tBLG 任意扭转 21 类；目标 21.8° ± 0.5° 2 类 |

M5 原型的位点计数在本文所有理想 slab 上与 M5 v2 §7.3 的原型位点表一致（按每个 1×1 胞折算）；M6 v2 原型的类数、首行与 Pareto 行与 M6 v2 §3.6.5、§3.15 相同（v1 原型 `proto/m6/match2d.py` 把 ±θ 孪生并成一类，给 549、144）。

### 0.3 公共前置条件

- 所有模块合入分支 `claude/clever-thompson-5wtccp` 之后执行。
- 网页：**静态版**（P1：网页端全部在浏览器里算，不依赖服务器）：`python3 -m http.server 8765 --directory facet/web`，打开 `http://127.0.0.1:8765/index.html`，
  等 `document.body.dataset.ready === 'true'`（`web/js/main.js:65`）。另在 `facet serve` 下抽查一次 S1（服务器模式不得改变结果）。
- 每个场景从**新会话**开始（新标签页；`localStorage` 清空），以便检查 U4 的"真空框初始为空"。
- 体相一律在 Build 面板（Shift+3）用原型加**显式**晶格常数建（表 0.4）。原因：F0-D §3.15.2 的参考表在 JS 端落地前，两种语言的默认晶格常数不同（JS 任何 fcc 元素都是 3.615 Å）。
- Python：`import facet as cl; from facet import build; from facet.analysis import adsorption_sites, find_layers`。
- CLI：`facet …`（M7 统一前按各模块 §6.5 的提议写；`--vacuum` 一律必填，见 U4）。

### 0.4 体相与晶格常数

| 代号 | Build 面板原型 / 元素 | Python | 参数 |
|---|---|---|---|
| Pt | Face-centred cubic / Pt | `build.crystal("fcc", "Pt", a=3.92)` | a = 3.92 Å（4 原子惯用胞） |
| Cu | fcc / Cu | `build.crystal("fcc", "Cu", a=3.615)` | 3.615 |
| Ag | fcc / Ag | `build.crystal("fcc", "Ag", a=4.09)` | 4.09 |
| Ni | fcc / Ni | `build.crystal("fcc", "Ni", a=3.52)` | 3.52 |
| Au | fcc / Au | `build.crystal("fcc", "Au", a=4.08)` | 4.08 |
| Fe | Body-centred cubic / Fe | `build.crystal("bcc", "Fe", a=2.866)` | 2.866 |
| Ru | Hexagonal close-packed / Ru | `build.crystal("hcp", "Ru", a=2.71, c=4.28)` | a = 2.71, c = 4.28 |
| TiO2 | Rutile / Ti, O | `build.crystal("rutile", ["Ti", "O"], a=4.594, c=2.959, u=0.305)` | 6 原子 |
| STO | Cubic perovskite / Sr, Ti, O | `build.crystal("perovskite", "Sr Ti O", a=3.905)` | 5 原子 |
| CeO2 | Fluorite / Ce, O | `build.crystal("fluorite", ["Ce", "O"], a=5.411)` | 12 原子 |
| ZnO | Wurtzite / Zn, O | `build.crystal("wurtzite", ["Zn", "O"], a=3.25, c=5.207, u=0.382)` | u 按 F0-D §3.15.2 定为 0.382 |
| NaCl | Rock salt / Na, Cl | `build.crystal("rocksalt", ["Na", "Cl"], a=5.64)` | 8 原子 |
| G | Graphene (2D) / C | `build.crystal("graphene", "C", a=2.46)` | c = 15 Å，`pbc = [T, T, F]` |
| MoS2 | MoS2 2H monolayer / Mo, S | `build.crystal("mos2", ["Mo", "S"], a=3.16, c=18)` | X–X 3.17 Å，`pbc = [T, T, F]`，c 按 F0-D 两边 18 |

### 0.5 容差等级（期望表的"容差"列引用这些代号）

| 代号 | 含义 |
|---|---|
| **E** | 精确：整数、字符串（名称、标签、文案）、布尔、约束标志、原子顺序 |
| **A4** | 解析量按 4 位小数给出：长度 ±1e-4 Å，角度 ±0.01°，面积 ±1e-3 Å² |
| **A3** | 由接触抬升或匹配给出的高度、键长、应变：±1e-3 Å，±0.001 % |
| **P6** | 两种语言之间、与金标原子列表之间：位置 ≤ 1e-6 Å（同顺序），晶胞 ≤ 1e-8 Å（M2 §7.3、M5 v2 §7.3） |
| **D** | 界面显示值：按规格的显示位数逐字比较（如 `2.10 Å`） |
| **F8** | 文件往返：坐标差 ≤ 1e-8 Å（F0-D §7.2 的 U1 验收），并且 §S14 定义的**规范形逐字节相同** |
| **T** | 性能预算：各模块 §7 的预算；CI 放宽 ×3（F0-D §7.6），软件 GL 再 ×2（F0-A §7.5） |

### 0.6 U1–U6 合规检查项（每个场景末尾按编号引用）

| 编号 | 检查 | 依据 |
|---|---|---|
| U1-a | 打开文件不弹任何关于 slab 的提示或对话框；pbc 与坐标与文件完全相同；toast 只有 `Loaded <file> — N atoms`（读取器有问题时才附备注） | U1；F0-D §5.1 |
| U1-b | 没有 slab 模式、slab 徽章或 slab 专属菜单；Surface 面板的分区对任何结构都在，条件不满足时就地说明原因；分区 `badge` 只放参数（如 `(1 1 1)`） | U1；F0-A §5.2 |
| U1-c | 显示：沿有真空的轴以间隙为切口包裹，底层不在真空顶部多画一份，跨晶胞边界的 slab 画成一块；只改显示，不改结构 | U1；F0-A §3.8.2 |
| U1-d | 层分析、位点的上下表面用同一个间隙切口 | U1；M3 §3.3、M5 §3.1 |
| U2-a | Facet 生成的 slab 与界面 `pbc = [true, true, true]`；a ∥ x，c ⊥ 表面且 ∥ z，真空沿 c | U2、C5 |
| U2-b | 内置二维原型保持 `[T, T, F]`；导入文件保留文件的 pbc；改真空不改 pbc | U2 |
| U3 | Surface › Interface 分区、`build.make_interface`、REST、CLI 都在（S15） | U3 |
| U4-a | 真空输入框第一次出现时为空、没有占位数字，主按钮（Create slab / Apply / Create）在填写前不可用；切面与界面构建里填 0 合法（M2 v2 对已有结构的 Set vacuum 拒绝 0，§4.1 G-33） | U4；F0-A §5.6 `numberInput({required})`；M2 §5.2 |
| U4-b | 会话内可保留用户自己上次填的值（模块变量）；刷新页面后又为空；不写 `localStorage`、偏好或项目 | U4 |
| U4-c | Python、JS、REST、CLI 中切面、改真空、界面构建的 `vacuum` 必填、无默认：Python 缺省时 `TypeError`（仅限关键字的必填参数），REST 422，CLI 退出码 2；`SURFACE_DEFAULTS` 两种语言都没有 `vacuum` 键 | U4；F0-D §3.16 |
| U4-d | 真空 = slab 与下一个周期像之间的总间隙：c ⊥ 表面时 `c = 厚度 + V`；居中时最底原子 `z = V/2` | U4、M2 K11 |
| U4-e | 其他默认：4 层（金属低指数面）、六方网格 120°、居中 | U4 |
| U5-a | 界面位置：Surface 面板（Shift+5）的 Cleave / Slab / Layers / Adsorbates（/ Interface）分区，Structure 面板的 Cell / Transform 分区；命令面板可用 MS 名称搜到 | U5/D1；F0-A §5.8 |
| U5-b | 放吸附物原位修改 slab、一步撤销；要保留原 slab 用 Duplicate | U5/D2 |
| U5-c | extxyz 写 ASE `move_mask`，不写 `selective_dynamics:L:3`；读取两者都认 | U5/D5；F0-D K4 |
| U5-d | D7 的缺陷已修：JS 读写 POSCAR 的 SD、props 不共享、`info.warnings`、二面角 IUPAC 符号 | U5/D7 |
| U6 | 本文 §4 的缺口由负责人按简报原则裁决并记录，开发不等待用户 | U6 |

### 0.7 记号

- 界面路径写成 `Surface › Cleave › Plane`；按钮、标签、toast 用规格原文（英文）。
- "顶层""第 n 层"从顶层数起（与 Layers 分区、`tags` 相同，M3 K4）；Python 数组层号 0 = 最底层。
- 原子序号：界面与文案从 1 起，API 从 0 起。

---

## 1. 共用的检查（每个生成 slab 的场景都要过）

| 编号 | 检查 | 期望 | 容差 | 规格 |
|---|---|---|---|---|
| C-1 | Create 前项目里的结构数 n；Create 后 | n + 1，体相保留（`addStructure(…, {replaceProject: false})`）；新结构为活动结构 | E | P4；F0-A §3.3、A-D5；M2 §5.5 |
| C-2 | 切面结果 | `pbc = [T,T,T]`；`cell[0] = (a, 0, 0)`；`cell[1]` 的 z 分量 0；`cell[2] = (0, 0, c)`（V > 0 时；V = 0 时 c 为倾斜的体相格矢） | E（零分量 ≤ 1e-12） | U2-a；M2 v2 K11、K12 |
| C-3 | 撤销 | Create 是一个撤销步，toast 的 Undo 只撤销它自己；撤销后项目结构数回到 n，体相成为活动结构 | E | P3；F0-A §3.4 |
| C-4 | 预览 | `Preview: Slab` 期间 `app.dirty` 不变、历史不增、自动保存与缩略图不含预览；状态栏 `Preview · N atoms`；Cancel/Esc 后截图与预览前相同 | E | F0-A §3.6、A-D1 |
| C-5 | 原子顺序 | 先按体相元素首次出现顺序分块，块内按层从下到上（F0-D K14 `canonical_order`）；因此导出 POSCAR 时 Export notes 里没有 N1 | E | F0-D §3.10.3；M2 v2 K12 |
| C-6 | `tags` | 从顶层 1 起；`find_layers(slab).from_top + 1 == tags` | E | C4；M2 §3.12；M3 K4 |
| C-7 | `info` | `info.source = "builder:surface"`；`info.surface` 至少有 `version = 2`、`kind = "cleave"`、`autoName`（键名见 §4.1 G-32）、`miller`、`layers`、`thickness`、`vacuum`、`stacking`、`termination.count`、`tasker`、`period`、`layersPerPeriod`、`layerTolerance`、`normal = [0,0,1]`、`axis = 2`、`asBuilt`（`composition`、`stoichiometric`、`supercell`、`fixed`）；有面内超胞时 `info.supercellMatrix`；`info.spacegroup` 不存在；可 JSON 序列化 | E / A4 | C6、C7；M2 §4.2 |
| C-8 | 命名 | 两种语言逐字相同，乘号 `×`（U+00D7）、根号 `√`、度 `°`、层间点 `·` | E | C9；M2 §3.13 |
| C-9 | 两种语言 | 同一参数下 Python `surface()` 与 JS `buildSurface()` 的符号、顺序、坐标、晶胞、tags、标志、`info.surface`、名称、`info.warnings` 相同 | P6 | P1；M2 §7.3 |

---

## 2. 场景

### S1 Pt(111) p(3×3) 4 层，底 2 层固定，CO 放 fcc 空位和顶位，导出带 Selective dynamics 的 POSCAR

**前置条件**：新会话；体相 Pt（表 0.4）。

**界面步骤**

1. Build 面板：`Face-centred cubic`，Elements `Pt`，`a` = 3.92 → Build。项目里有 `Pt` 惯用胞（4 原子，Fm-3m）。
2. Shift+5 打开 Surface 面板（F0-A §5.2）。分区顺序 Cleave、Slab、Layers、Adsorbates、Interface；Cleave、Slab 展开（U1-b）。
3. `Surface › Cleave`（M2 §5.2）：
   - Bulk 行 `Bulk: <Pt 的名字> · 4 atoms · Fm-3m`；`Plane` 默认 `(1 1 1)`（立方晶胞），三格；读数行 `(1 1 1) of the current cell · d = 2.263 Å`；
   - `Minimal surface cell` 默认开，旁注 `The 4-atom input cell was reduced to its 1-atom primitive cell.`；信息行 `Surface cell 2.772 × 2.772 Å, γ = 120° · 6.65 Å² · a ∥ [u v w], b ∥ [u v w]`、`Layer spacing 2.263 Å · 1 layer per period`；
   - `Termination` 上方 `Tasker type 1 surface (every layer is neutral)`，只有一项，折叠成一行 `Pt · 3 bonds/cell · Non-polar · CN 9`；
   - `Thickness` `[Layers | Periods | Å]` = Layers 4（默认，U4-e，M2 v2 K9），右侧 `6.79 Å · 4 periods · = 4 × d(111) of the input cell`；没有 H1/H2 提示（每周期 1 层）。
4. `Vacuum`：框为空，后缀文字 `total gap; 0 for none`（不是占位数字）；摘要第二行 `6.79 Å thick · vacuum not set`；`Create slab` 不可用，`title` 为 `Enter the vacuum (total gap in Å; 0 for none).`；
   `Preview` 的 `Slab` 选项也不可用（tip `Enter the vacuum to preview the slab.`）（U4-a）。输入 `15`。
5. `Fix layers` 打开，数值 2、`Bottom`（M2 §3.12.3 的默认），`Directions` = `All`。
6. `Surface supercell` 选 `p(3×3)`（预设来自 M1 `wood_presets`），矩阵显示 `[3 0; 0 3]`、`×9`。
7. 摘要（`role=status`）：`Pt(111) p(3×3) 4L — 36 atoms (Pt36)` / `6.79 Å thick + 15.0 Å vacuum · cell 8.32 × 8.32 × 21.79 Å, γ = 120°` / `Stoichiometric · Non-polar (all layers are neutral)`。
8. `Preview` 切到 `Slab`：侧视（层水平、a 向右），预览条 `Preview: Cleave surface` 带 `Create`/`Cancel`（C-4）。切回 `Planes`：体相里画出 (111) 切口平面（A 层叠加，不进 PNG），相机恢复到预览前（M2 §5.4）。
9. `Create slab` → toast `Created Pt(111) p(3×3) 4L (36 atoms)` + Undo（C-1）。
10. `Surface › Layers`（M3 §5.1）：标题 `4 layers · 36 atoms`；4 行 `Pt 9`，z = 14.29 / 12.03 / 9.76 / 7.50，Δ = 2.26；第 3、4 行显示 🔒 与 `Free`；
    `Structure › Constraints` 显示 `18 of 36 atoms fixed`。视图里底两层有蓝色固定光环（M3 K12）。
11. `Surface › Adsorbates › Sites`（M5 §5.2）：`Side` = Top，`Site atoms` = Auto → `Find sites`。摘要 `9 site atoms (Pt) · 54 sites in 4 classes`（M5 v2 §5.2 的措辞）；
    类列表 `top (Pt) 9`、`bridge (Pt2) 27`、`fcc (Pt3) 9`、`hcp (Pt3) 9`；标记在 B 层，形状按类型。
12. `Adsorbate` 块：搜索框输入 `CO` → 选 `CO  Carbon monoxide`，`Binding` = `C-down (η1-C)`，提示 `Usually on top, bridge or hollow sites`。
13. 点类 `fcc (Pt3)` → `Placement`：`Site: fcc (Pt3)  1 of 9`；`Height` = Auto，只读结果 `C–Pt 2.10 Å · 1.36 Å above the site`（M5 v2：有效半径 1.3859 × 新系数 0.98，数字恰与 v1 相同）；
    幽灵 CO 用 F0-A `ghostLayer`（普通叠加层，不开会话、不进历史，M5 v2 K14）。
    `Place` → toast `Added CO on fcc (Pt3)`，名称变为 `Pt(111) p(3×3) 4L + CO`。
14. 点类 `top (Pt)`：读数 `C–Pt 1.85 Å · 1.85 Å above the site`。与 CO #1 面内相距 1.60 Å 的 3 个顶位预览时出现 W2 `C1 is 1.67 Å from C37 of CO #1 (they would be bonded below 1.75 Å)`
    与 W5（`O2 is 1.67 Å from O38 of CO #1 (closer than 2.43 Å)`、`C1 is 1.73 Å from O38 of CO #1 (closer than 2.58 Å)`、`O2 is 2.27 Å from C37 of CO #1 (closer than 2.58 Å)`；M5 v2 §3.11 的文案，界面最多显示 3 条），
    相距 3.20 Å、4.23 Å 的 6 个顶位没有警告。`Coverage` 块 `Fill to θ` 填 0.22 → `Fill`（M5 v2 §3.12.2：目标 round(0.22 × 9) = 2 个，只加 1 个，取离 CO #1 最远的顶位，面内 4.23 Å），
    toast `Added 1 CO (θ = 0.22 ML per 1×1 cell)`。手动做法（E2E-1 用它）：`Next site` 翻到没有 ⚠ 的顶位 → `Place`，toast `Added CO on top (Pt)`，这时 S1-7 只断言面内距离 ∈ {3.2007, 4.2341} 且没有警告。
    名称 `Pt(111) p(3×3) 4L + 2CO`；`Coverage` 块 `θ = 0.22 ML (per 1×1 cell) · 0.22 per site atom`（M5 v2 K12、§5.6）。
15. 导出：File › Export › POSCAR（或命令面板，或 `facet.exportText('poscar')`）→ toast `Saved <name>.vasp`，没有 `Details`/`Notes` 按钮。
16. 导出 extxyz：toast 无警告。
17. 撤销三次（Ctrl/⌘+Z）：依次撤掉第二个 CO、第一个 CO、Create；体相回到活动结构，项目只剩 1 个结构。

**Python**

```python
pt = build.crystal("fcc", "Pt", a=3.92)
slab = build.surface(pt, (1, 1, 1), vacuum=15.0, layers=4, supercell=(3, 3), fix_bottom=2)   # vacuum 仅限关键字且必填
sites = adsorption_sites(slab)                                  # SiteSet：9/27/9/9
build.add_adsorbate(slab, "CO", site="fcc")                    # 原位；fcc 类的第一个位点
build.add_adsorbates(slab, "CO", site_class="top (Pt)", coverage=0.22)  # 填到 θ = 0.22：只加 1 个，离已有 CO 最远的顶位（M5 v2 §3.12.2；`count=` 的语义见 §4.1 G-38）
cl.write("POSCAR", slab, format="poscar")                       # 无 ExportWarning
cl.write("slab.extxyz", slab)
```

**CLI**

```
facet build crystal fcc Pt --a 3.92 -o Pt.json
facet build surface Pt.json --hkl 1 1 1 --layers 4 --vacuum 15 --supercell 3 3 --fix-bottom 2 -o slab.json
facet sites slab.json
facet adsorb slab.json CO --site "fcc (Pt3)" -o slab_co.json
facet adsorb slab_co.json CO --site "top (Pt)" --coverage 0.22 -o slab_2co.json
facet convert slab_2co.json POSCAR
```

stderr：`wrote 36 atoms (Pt36) to slab.json`；最后一步没有 `facet: warning:`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S1-1 | 表面网格、层间距、终止面 | a = b = 2.7719 Å，γ = 120.00°，面积 6.6538 Å²；d(111) = 2.2632 Å（a/√3），每周期 1 层；1 个终止面 `Pt`，断键 3/胞，非极性 | A4 / E | 解析；M2 §0.3、§3.7 |
| S1-2 | slab | 36 原子 Pt36；4 层 × Pt9；层间距 2.2632（×3）；a = b = 8.3156 Å，γ = 120°，c = 21.7896 Å（∥ z，c = 6.7896 + 15，U4-d）；厚度 6.7896 Å；层高 7.5000 / 9.7632 / 12.0264 / 14.2896 Å | A4 | 解析；`scen.py` |
| S1-3 | tags 与约束 | tags 4×9（1 = 顶层）；`selective_dynamics`：18 个 `[F,F,F]`（tags 3、4），18 个 `[T,T,T]` | E | C3、C4；M2 §3.12；M3 §3.12.2 |
| S1-4 | 名称与来源 | `name == "Pt(111) p(3×3) 4L"`，且等于自动名哨兵（M2 v2 叫 `info.surface.autoName`，M1 v2、M5 v2 叫 `info.surface.name`，§4.1 G-32；裁决前测试只断言 `name`）；`info.supercellMatrix = [[3,0,0],[0,3,0],[0,0,1]]`；`info.surface`：`layers = 4`、`vacuum = 15.0`、`stacking = "vacuum"`、`thickness = 6.789639`、`period = 2.263213`、`layersPerPeriod = 1`、`layerTolerance = 0.3`、`tasker = 1`、`termination.count = 1`、`termination.brokenBonds = 3`、`asBuilt.supercell = [[3,0],[0,3]]`、`asBuilt.fixed = {layers: 2, from: "bottom", axes: "abc"}`、`asBuilt.stoichiometric = true` | E / A4 | M2 v2 §3.13、§4.2 |
| S1-5 | 位点 | 9 个表面原子；top 9、bridge 27（2.7719 Å）、fcc 9、hcp 9，共 54；fcc 位正下方（横向 < 1e-3 Å）是第 3 层原子（深 4.5264 Å），hcp 位正下方是第 2 层原子（深 2.2632 Å） | E / A4 | M5 §3.4–3.5、§7.3 |
| S1-6 | CO@fcc | 目标键长 d = f·(r_C + r_Pt,eff)，f = 0.98（M5 v2 库，hollow），r_Pt,eff = 2.7719/2 = 1.3859（K9：slab 金属–金属键长中位数的一半）→ d = 2.1030 Å；C 在顶层上方 √(d² − ρ²) = 1.3644 Å（ρ = 1.6003），z = 15.6540 Å；Pt–C 2.1030 ×3；O 在 C 正上方 1.1283 Å（z = 16.7823）。v1（f 0.99、Cordero 1.36）：2.0988 / 1.3579 | A3 | 解析；M5 v2 §3.10.2–3.10.6 |
| S1-7 | CO@top | `Fill`/`coverage=0.22` 选中离第一个 CO 面内最小像距离 4.2341 Å 的顶位（三档距离 1.6003/3.2007/4.2341 各 3 个，并列取位点序最小者）；d = 0.86 × 2.1459 = 1.8455 Å，C z = 16.1351、O z = 17.2634；C–C 4.2613 Å；无警告。v1：1.8444 | A3 / E | M5 v2 §3.10、§3.11、§3.12 |
| S1-6′ | 系数再校准时 | T13 再改库系数 f 时：断言"结合原子到系综每个原子的距离 = f·(r_A + r_M,eff) ± 1e-3，高度 = √(d² − ρ²) ± 1e-3"，f 从测试时读到的 `adsorbates.json` 取，不抄数字（M5 v2 §3.10.5 的做法） | A3 | M5 v2 K9 |
| S1-8 | 吸附后 | 40 原子，内存顺序 Pt36、C2、O2（追加后一次稳定 `sort_by_species`）；`adsorbate_id` 依次 0×36、1、2、1、2；CO 的 tags = 0、SD `[T,T,T]`；`info.surface.adsorbates` 两条（`site.label` 为 `fcc (Pt3)`、`top (Pt)`）；`info.spacegroup` 不存在；名称 `Pt(111) p(3×3) 4L + 2CO` | E | M5 §4.3–4.5；F0-D §10.6 |
| S1-9 | POSCAR | 注释行 `Pt(111) p(3×3) 4L + 2CO`；物种行 `Pt C O`，计数 `36 2 2`；`Selective dynamics`；`Direct`；40 行坐标：第 1–18 行 `F F F`，第 19–40 行 `T T T`；底层 f_c = 0.344200，顶层 0.655800；C 的 f_c = 0.718417（fcc）、0.740496（top），O 0.770198、0.792277（v1 高度下为 0.718118、0.740445、0.769900、0.792227）；Export notes 为空（无 W、无 N1）；没有 `-0.0000…` 记号（§4.1 G-11） | E / A4 | F0-D §3.10.2、§3.12.2；`s1_poscar.py` |
| S1-10 | extxyz | 有 `move_mask:L:1` 列（18 个 F，ASE 约定 T = 可动）、`tags:I:1`、`adsorbate_id:I:1`，`info.surface` 以 `_JSON` 写出；**没有** `selective_dynamics:L:3` 列；无 W5/W6 | E | U5-c；F0-D K4、§3.11.4 |
| S1-11 | 撤销 | 三步撤销标签依次 `Fill CO to θ = 0.22`（手动做法为 `Add CO`）、`Add CO`、`Cleave Pt(111) p(3×3) 4L`；第三步后项目 1 个结构 | E | F0-A §3.4；M5 v2 §5.7；M2 v2 §5.4 |
| S1-12 | 两种语言 | JS 与 Python 的 slab、位点类表与 `ensemble`、两次放置的坐标 | P6 | M2 §7.3、M5 v2 §7.3 |

**U 合规**：U2-a（C-2）、U4-a（步骤 4）、U4-c（`build.surface(pt, (1,1,1), layers=4)` 不给 vacuum → `TypeError`；CLI 省略 `--vacuum` → 退出码 2）、U4-d（S1-2）、U4-e（4 层、120°、居中）、U1-b（Layers、Adsorbates 分区对体相也在，只给就地说明）、U5-a、U5-b（两次放置各一步，原位）、U5-c（S1-10）。

**覆盖的规格**：F0-A §3.3–3.6、§5.2、§5.6–5.8、US1/US2/US4；M2 §3.1–3.13、§5.2–5.5、§6.1、§6.5；M3 §3.12、§5.1、§5.3.3；M5 §3.2–3.12、§4.3–4.5、§5.2–5.7、§6.1、§6.5；F0-D §3.10、§3.11.4、§3.12。

---

### S2 Cu(100) c(2×2)-O，4 重空位

**前置条件**：体相 Cu（a = 3.615 Å）。

**界面步骤**

1. Build：fcc / Cu / `a` = 3.615。
2. `Surface › Cleave`：`Plane` 输入 `1 0 0`；信息行 `Surface cell 2.556 × 2.556 Å, γ = 90° · 6.53 Å²`、`Layer spacing 1.808 Å · 1 layer per period`；终止面一项 `Cu · 4 bonds/cell · Non-polar`。
3. `Thickness` = 4 layers；`Vacuum` 输入 15；`Fix layers` 开（2，Bottom）；`Surface supercell` 保持 `p(1×1)` → `Create slab`（4 原子，用于检查 C3）。
4. `Surface › Slab › Surface supercell…`（M2 v2 K17：打开 `Structure › Cell › Supercell`，预设相对 slab 的 1×1 网格）→ `Matrix` 预设 `c(2×2) = (√2×√2)R45°`（`[1 1; -1 1]`），
   读数 `Mesh: square (a = b = 2.556 Å, γ = 90°)`、`c(2×2) = (√2×√2)R45° · 2× its area · 4 → 8 atoms`，虚线新晶胞 → `Create supercell`。
   toast `Made a c(2×2) supercell: 8 atoms`（M1 v2 D13：从预设创建用预设标签；§3.6.5、§5.3）。名称：M2 v2 §3.13 的 `surface_name` 给 `Cu(100) (√2×√2)R45° 4L`，
   M1 v2 §1.1（D13）写 `Cu(100) c(2×2) 4L`，两者冲突（§4.1 G-39）。
5. `Adsorbates › Sites` → `Find sites`：`2 site atoms (Cu) · 8 sites in 3 classes`：`top (Cu) 2`、`bridge (Cu2) 4`、`hollow (Cu4) 2`。
6. `Adsorbate` 块 `Element…` 或搜索 `O` → `O  Oxygen`；点类 `hollow (Cu4)` → 读数 `Cu–O 1.94 Å · 0.70 Å above the site`（v1：1.98/0.81）→ `Place`。
   `Coverage`：θ = 0.50 ML（1 个 O / 2 个 1×1 胞）。
7. 另一路径（同一会话里先 `Duplicate` 4 原子的 p(1×1) slab）：`Surface supercell…` 选 `p(2×2)` → `Create supercell`（16 原子）→ `Find sites`（4/8/4）→ 选类 `hollow (Cu4)` →
   `Coverage › Fill to θ` = 0.50、`Min. separation` = 0 → `Fill` → toast `Added 2 O (θ = 0.50 ML per 1×1 cell)`，撤销标签 `Fill O to θ = 0.50`（M5 v2 §5.7）。

**Python**

```python
cu = build.crystal("fcc", "Cu", a=3.615)
s1 = build.surface(cu, (1, 0, 0), vacuum=15.0, layers=4, fix_bottom=2)          # p(1×1)
c2 = build.make_supercell(s1, [[1, 1], [-1, 1]])                                 # M1；或 surface(..., supercell="c(2x2)")
build.add_adsorbate(c2, "O", site="hollow")
p2 = build.make_supercell(s1, [[2, 0], [0, 2]])
build.add_adsorbates(p2, "O", site_class="hollow (Cu4)", coverage=0.5)
```

**CLI**

```
facet build surface Cu.json --hkl 1 0 0 --layers 4 --vacuum 15 --fix-bottom 2 --wood "c(2x2)" -o cu_c2x2.json
facet adsorb cu_c2x2.json O --site hollow -o cu_c2x2_O.json
facet transform cu_1x1.json --surface-cell p2x2 -o cu_p2x2.json
facet adsorb cu_p2x2.json O --site hollow --coverage 0.5 -o cu_p2x2_O.json
```

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S2-1 | 网格与层 | a = b = 2.5562 Å，γ = 90°，面积 6.5341 Å²；d(100) = 1.8075 Å；1 个终止面（4 断键/胞） | A4 / E | 解析 |
| S2-2 | p(1×1) 4L | 4 原子；c = 5.4225 + 15 = 20.4225 Å；底两层 `[F,F,F]` | A4 / E | M2 §3.12 |
| S2-3 | c(2×2) 超胞 | 8 原子，a = b = 3.6150 Å，γ = 90°，c 不变；4 个 `[F,F,F]`、4 个 `[T,T,T]`，**没有**收紧备注（C3：面内矩阵精确保持）；名称在两条路径（Cleave 的 `Surface supercell` 与 `Cell › Supercell`）上相同，是 `Cu(100) (√2×√2)R45° 4L`（M2 v2）或 `Cu(100) c(2×2) 4L`（M1 v2 D13）之一，G-39 裁决后固定；`info.supercellMatrix` = 相对 1×1 的 `[[1,1,0],[-1,1,0],[0,0,1]]` | A4 / E | C3；F0-D §3.8.3；M1 §3.3–3.5；M2 §3.13 |
| S2-4 | 位点 | top 2、bridge 4（2.5562 Å）、hollow (Cu4) 2；4 重空位正下方是第 2 层 Cu（深 1.8075 Å） | E / A4 | M5 v2 §7.3 |
| S2-5 | O@hollow | d = 1.0 × (0.66 + r_Cu,eff)，r_Cu,eff = 2.5562/2 = 1.2781 → 1.9381 Å；高 √(d² − 1.8075²) = 0.6994 Å；Cu–O 1.9381 ×4，与正下方第 2 层 Cu 2.5069 Å；O–O（周期像）3.6150 Å；θ = 0.50 ML；9 原子。v1：1.98 / 0.8083 / 2.6158 | A3 | 解析；`v2_heights.py`；M5 v2 K9 |
| S2-6 | p(2×2) + Fill | 16 原子，位点 4/8/4；Fill 选中两个对角 4 重空位，O–O 最小像距离 3.6150 Å（即 c(2×2)）；18 原子 | A4 / E | M5 §3.12 |
| S2-7 | 1/n 覆盖度超胞 | 在 p(1×1) slab 上 `Cells for 1/n coverage` n = 2：第一项 `c(2×2)`（即 `(√2×√2)R45°`），间距 3.62 Å；超胞在 1×1 网格上枚举（M5 v2 K12） | E / D | M5 v2 K12 |

**U 合规**：U2-a、U4-a（Cleave 的 Vacuum 框）、U4-c、U5-a（面内超胞在 Structure › Cell，Slab 分区只是入口）、U5-b。

**覆盖的规格**：M1 §3.3–3.6、§5.3；M2 v2 K17、§5.6；F0-D §3.8.3；M5 §3.4、§3.9、§3.12、§5.6。

---

### S3 Ag(111) (√3×√3)R30°

**前置条件**：体相 Ag（a = 4.09 Å）。

**界面步骤**

1. Build：fcc / Ag / 4.09。`Surface › Cleave`：(1 1 1)，4 layers，`Vacuum` 15，`Fix layers` 开、值 2、`Bottom`、`Directions` = `Along c only`（标志 `T T F`），`p(1×1)` → `Create slab`。
2. `Surface › Slab › Surface supercell…` → `Structure › Cell › Supercell › Matrix`，预设 `(√3×√3)R30°`（按 120° 网格填成 `[2 1; -1 1]`），读数 `Mesh: hexagonal (a = b = 2.892 Å, γ = 120°)`、`4 atoms → 12 atoms` → `Create supercell`。
   toast `Made a (√3×√3)R30° supercell: 12 atoms`；撤销标签 `Make (√3×√3)R30° supercell`（M1 §5.3）。直接在 Cleave 里选 `Surface supercell` = `(√3×√3)R30°` 必须得到相同的结构与名字（M2 v2 K17）。
3. `Adsorbates › Sites › Find sites`：`3 site atoms (Ag) · 18 sites in 4 classes`。
4. `Element…` 输入 `Cl`（或搜索 `Cl`），选 `fcc (Ag3)` → `Place`。θ = 0.33 ML（1 / 3 个 1×1 胞）。
5. 在 p(1×1) slab 的副本上：`Coverage › Cells for 1/n coverage`，n = 3 → 第一行 `(√3×√3)R30° · 5.01 Å apart` → `Apply`。

**Python**

```python
ag = build.crystal("fcc", "Ag", a=4.09)
s1 = build.surface(ag, (1, 1, 1), vacuum=15.0, layers=4, fix_bottom=2, fix_axes="c")
s3 = build.make_supercell(s1, [[2, 1], [-1, 1]])
build.add_adsorbate(s3, "Cl", site="fcc")
build.coverage_supercells(s1, 3)[0]["wood"]          # "(√3×√3)R30°"
```

**CLI**：`facet build surface Ag.json --hkl 1 1 1 --layers 4 --vacuum 15 --fix-bottom 2 --axes c --wood "sqrt3xsqrt3R30" -o ag.json`；
`facet adsorb ag.json Cl --site fcc -o ag_cl.json`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S3-1 | p(1×1) | 网格 2.8921 Å、120°，d = 2.3614 Å；4 原子；厚度 7.0841，c = 22.0841 Å；底两层 `[T,T,F]` | A4 / E | 解析 |
| S3-2 | √3 超胞 | 12 原子，a = b = 5.0092 Å，γ = 120°；6 个原子 `[T,T,F]` 原样保持，无收紧备注；名称 `Ag(111) (√3×√3)R30° 4L`，自动名哨兵同步更新（两条路径相同；键名见 §4.1 G-32） | A4 / E | C3；M1 v2 K5；M2 v2 §3.13、K17 |
| S3-3 | 位点 | top 3、bridge 9（2.8921）、fcc 3、hcp 3 | E | M5 v2 §7.3 |
| S3-4 | Cl@fcc | d = 1.0 × (1.02 + r_Ag,eff)，r_Ag,eff = 2.8921/2 = 1.4460 → 2.4660 Å；高 1.8147 Å（ρ = 1.6697）；Ag–Cl 2.4660 ×3；13 原子；名称 `… + Cl`；θ = 1/3。v1：2.4700 / 1.8201 | A3 / E | 解析；M5 v2 K9、§4.5 |
| S3-5 | 1/3 超胞建议 | 第一项 `(√3×√3)R30°`，`separation` = 5.0092 Å（√3 × 2.8921） | E / A4 | M5 §3.12 |

**U 合规**：U2-a、U4-a、U4-e（120°）、U5-a。**覆盖**：M1 §3.5–3.6、§5.3；M2 v2 K17、§5.2；M3 §3.12.3（`Along c only` 的命名）；M5 §3.12、§5.6。

---

### S4 Ru(0001)：hcp 与 fcc 空位

**前置条件**：体相 Ru（a = 2.71，c = 4.28 Å）。

**界面步骤**

1. Build：Hexagonal close-packed / Ru / a 2.71 / c 4.28。
2. `Surface › Cleave`：`Plane` 自动显示四格 `h k i l`，默认 `(0 0 0 1)`，`i` 只读；信息行 `Layer spacing 2.140 Å · 2 layers per period`；终止面一项 `Ru · 3 bonds/cell · Non-polar`（两个切口等价，6₃ 螺旋）。
3. 4 layers（= 2 个周期），`Vacuum` 15，`Fix layers` 2（Bottom），`Surface supercell` `p(2×2)` → Create。名称 `Ru(0001) p(2×2) 4L`。
4. `Structure › Tools › Duplicate` 两次，得到 3 个相同 slab（D2）。
5. 第 1 份：`Adsorbates › Find sites` → 类 `fcc (Ru3)`、`hcp (Ru3)` 分开列出；放 `N` 到 `fcc (Ru3)`。第 2 份：放 `N` 到 `hcp (Ru3)`。
6. 第 3 份：`Surface › Layers` 点第 3 行 → 选区卡片 `Fix ▾ → Fix z only`（M3 S5）。

**Python**

```python
ru = build.crystal("hcp", "Ru", a=2.71, c=4.28)
slab = build.surface(ru, (0, 0, 0, 1), vacuum=15.0, layers=4, supercell=(2, 2), fix_bottom=2)
a, b = slab.copy(), slab.copy()
build.add_adsorbate(a, "N", site="fcc"); build.add_adsorbate(b, "N", site="hcp")
c = slab.copy(); c.fix(find_layers(c).top_layer(3), axes="c")
```

**CLI**：`facet build surface Ru.json --hkil 0 0 0 1 --layers 4 --vacuum 15 --supercell 2 2 --fix-bottom 2 -o ru.json`；
`facet adsorb ru.json N --site fcc -o ru_n_fcc.json`；`facet adsorb ru.json N --site hcp -o ru_n_hcp.json`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S4-1 | 网格与层 | 2.7100 Å、120°，面积 6.3603 Å²；周期 4.2800 Å，每周期 2 层，层间距 2.1400 Å；1 个终止面 | A4 / E | 解析；M2 §0.3 |
| S4-2 | slab | 16 原子；a = b = 5.4200 Å；厚度 6.4200，c = 21.4200 Å；4 层 × Ru4；8 个 `[F,F,F]` | A4 / E | M2 §3.12 |
| S4-3 | 位点 | top 4、bridge 12（2.7100）、fcc (Ru3) 4、hcp (Ru3) 4 | E | M5 v2 §7.3 |
| S4-4 | hcp 与 fcc 的几何区别 | hcp：正下方（横向 < 0.3 Å）有 Ru，深 2.1400 Å（第 2 层）；fcc：任何深度都**没有** Ru 在正下方（hcp 堆垛 ABAB 中 C 位为空，M2 领域审查 #10 更正了 M2 v1 的 S3 写法） | E / A4 | M5 §3.5 |
| S4-5 | N 的高度 | d = 0.95 × (0.71 + r_Ru,eff)，r_Ru,eff = 2.71/2 = 1.355 → 1.9617 Å（M5 v2 K9 的 "2.06 → 1.96"）；两种空位都高 1.1834 Å（ρ = 1.5646），Ru–N 1.9617 ×3；hcp 上 N 与第 2 层 Ru 3.3234 Å。v1：2.0615 / 1.3423 | A3 | 解析；`v2_heights.py`；M5 v2 K9 |
| S4-6 | 部分约束 | 第 3 行 4 个原子 `[T,T,F]`；选区卡片与悬停卡显示 `fixed along c (z)`（a、b 在 xy 面内、c ∥ z，按 M3 §3.12.3 可精确称为 z） | E | C3；M3 §3.12.3、§5.3.1 |

**U 合规**：U2-a、U4-a、U5-b（Duplicate）。**覆盖**：F0-A §5.6 `millerInput`、US9；M2 §3.1、§3.7；M3 §5.3；M5 §3.5、§3.9。

---

### S5 fcc(110)：短桥与长桥（Pt(110)）

**前置条件**：体相 Pt。

**界面步骤**

1. `Surface › Cleave`：`Plane` `1 1 0`；信息行 `Surface cell 2.772 × 3.920 Å, γ = 90°`、`Layer spacing 1.386 Å · 1 layer per period`；终止面一项（6 断键/胞）。
2. `Thickness` 6 layers（显式；默认 4 层只有 4.16 Å 厚，M2 v2 会给 H2 提示），`Vacuum` 15，`Fix layers` 3（Bottom），`p(2×2)` → Create。名称 `Pt(110) p(2×2) 6L`。
3. `View along normal`（按 N）俯视：a 从左到右；`viewAlong([0, -1, 0])` 侧视时顶面朝上（F0-A §3.14.1）。
4. `Adsorbates › Find sites` → 类 `top (Pt)`、`short bridge (Pt2)`、`long bridge (Pt2)`、`hollow (Pt4)`，以及 (111) 微面上的 `fcc (Pt3)`、`hcp (Pt3)`（M5 v2 K4(b)）。
5. CO 放 `short bridge (Pt2)`；O 放 `long bridge (Pt2)`；（Duplicate 后）O 放 `hollow (Pt4)`。

**Python**：`slab = build.surface(pt, (1, 1, 0), vacuum=15.0, layers=6, supercell=(2, 2), fix_bottom=3)`；
`build.add_adsorbate(slab, "CO", site="shortbridge")`；`build.add_adsorbate(slab, "O", site="longbridge")`。
**CLI**：`facet build surface Pt.json --hkl 1 1 0 --layers 6 --vacuum 15 --supercell 2 2 --fix-bottom 3 -o pt110.json`；`facet adsorb pt110.json CO --site shortbridge …`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S5-1 | 网格与层 | 矩形 2.7719 × 3.9200 Å（短边沿 a），面积 10.8657 Å²；d(110) = 1.3859 Å；1 个终止面 | A4 / E | 解析 a/(2√2) |
| S5-2 | slab | 24 原子；a = 5.5437、b = 7.8400 Å；厚度 6.9296，c = 21.9296 Å；6 层 × Pt4；12 个 `[F,F,F]` | A4 / E | M2 §3.12 |
| S5-3 | 位点（M5 v2 `auto`） | top 4；short bridge (Pt2) 4（2.7719 Å，沿 a）；long bridge (Pt2) 4（3.9200 Å，跨槽，沿 b）；hollow (Pt4) 4（正下方第 2 层 Pt，深 1.3859 Å）；(111) 微面三重位 fcc 8、hcp 8（两个顶行原子 + 一个槽底原子，边长都是 2.7719）；共 32。M5 v1 没有微面位（16 个） | E / A4 | M5 v2 K4(b)；M5 领域审查 #7 |
| S5-4 | CO@短桥 | d = 0.94 × (0.76 + 1.3859) = 2.0172 Å，沿垂直于桥轴的方向（此处即表面法向）；高 1.4657 Å；Pt–C 2.0172 ×2。v1：2.014 / 1.4613 | A3 | M5 v2 K7、K9、§4.1 |
| S5-4′ | O@微面 fcc | Pt–O 2.0459 ×3，高 1.041 Å（M5 v2 §3.10.6 的原型值） | A3 | M5 v2 §3.10.6 |
| S5-5 | O@长桥 | d = 0.66 + 1.3859 = 2.0459 Å；高 √(d² − 1.96²) = 0.5867 Å；Pt–O 2.0459 ×2，与第 2 层 2 个 Pt 2.4108 Å。v1：0.4887 / 2.3313 | A3 | 解析；`v2_heights.py` |
| S5-6 | O@4 重空位 | 由正下方第 2 层 Pt 决定：高 2.0459 − 1.3859 = 0.6600 Å，与 4 个顶层 Pt 2.4897 Å。v1：0.6341 / 2.4828 | A3 | M5 §3.9 |

**U 合规**：U2-a、U4-a、U4-e（默认 4 层；这里显式改成 6 层是用户选择）。**覆盖**：F0-A §3.14.1；M2 §3.3–3.4、§3.10；M5 v2 K4、K7、K9。

---

### S6 fcc(211)：台阶与台面位点（Pt(211)）

**前置条件**：体相 Pt。

**界面步骤**

1. `Surface › Cleave`：`Plane` `2 1 1`；信息行 `Surface cell 2.772 × 6.790 Å, γ = 90°`、`Layer spacing 0.800 Å · 1 layer per period`；默认 4 layers，下方 H2 提示
   `Atomic layers are only 0.80 Å apart: 4 layers is only 2.40 Å thick.` 与一键按钮（M2 v2 K9：建议 9 层，不改默认值）；终止面一项（10 断键/胞，`CN 7/9/10 · 3 exposed layers`）。
2. `Thickness` 改为 12 layers，`Vacuum` 15 → Create。名称 `Pt(211) 12L`。
3. `Surface › Layers`：12 行，每行 `Pt 1`，Δ = 0.80（"一行一排"，M3 §1.3）；`Fix by height` `deeper than` 4.4 `Å below the top` → Apply（固定下部；不用 4.0，第 6 行深 4.0008 Å，正好压线）。
4. `Adsorbates › Find sites` → 顶位按配位数分 `top (Pt) CN 7`（台阶边）、`CN 9`（台面）、`CN 10`（台阶底）；空位 `fcc`/`hcp`（台面）与 `hollow (Pt4)`（台阶）。
5. O 放 `hollow (Pt4)`；（Duplicate 后）O 放 `fcc (Pt3) CN 9·10·10`；CO 放 `top (Pt) CN 7`。

**Python**：`s = build.surface(pt, (2, 1, 1), vacuum=15.0, layers=12)`；`s.fix_height(4.4)`；`build.add_adsorbate(s, "O", site="hollow (Pt4)")`。
**CLI**：`facet build surface Pt.json --hkl 2 1 1 --layers 12 --vacuum 15 -o pt211.json`；`facet edit fix pt211.json --depth 4.4 -o pt211f.json`；`facet sites pt211f.json`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S6-1 | 网格与层 | 矩形 2.7719 × 6.7896 Å（b = √3 a），面积 18.820 Å²；d = 0.8002 Å（a/(2√6)）；1 个终止面，断键 10/胞 | A4 / E | 解析；M2 §0.3 |
| S6-2 | slab | 12 原子；厚度 8.8018 Å，c = 23.8018 Å；12 层 × 1 原子 | A4 / E | M2 §3.12 |
| S6-3 | 按高度固定 | 深于顶层 4.4 Å 的原子：第 7–12 行（深 4.80…8.80 Å）共 6 个 `[F,F,F]`，其余 `[T,T,T]`（设定语义） | E | M3 §3.12.2 `fix_height`、K9 |
| S6-4 | 位点 | 3 个表面原子（台阶边、台面、台阶底）；top 3 类（CN 7 / 9 / 10 各 1）；bridge 8（6 类：CN 7·7 ×1、7·9 ×2、7·10 ×1、9·9 ×1、9·10 ×2、10·10 ×1，长度都是 2.7719）；hollow 5（`fcc (Pt3) CN 7·9·9`、`fcc (Pt3) CN 9·10·10`、`hcp (Pt3) CN 7·7·9`、`hcp (Pt3) CN 9·9·10`、`hollow (Pt4)`） | E | M5 §3.5、§7.3 |
| S6-5 | 局部法向 | 台面三重空位倾 19.47°（(211)∠(111)），台阶 4 重位倾 35.26°（(211)∠(100)） | ±0.1° | 解析；M5 §7.2 `test_local_normal` |
| S6-6 | O@台阶 4 重位 | (100) 微面，外接圆半径 1.96 Å；沿局部法向高 √(2.0459² − 1.96²) = 0.5867 Å，Pt–O 2.0459 ×4（沿全局法向只有 2 根）。v1 半径下 0.4887 / 2.020。M5 v2 §3.5 的“系综成键”指边界边成键，4 重位的 4 条边（2.7719 Å）都成键，所以用局部法向；K7 摘要“两两成键”的措辞与之不一致，见 §4.1 G-34 | A3 | `pt211_place.py`、`v2_heights.py`；M5 K7 |
| S6-7 | O@台面三重位 | (111) 微面，ρ = 1.6003；沿局部法向高 1.2747 Å，Pt–O 2.0459 ×3（同 Pt(111) fcc 的 O）。v1：1.2326 / 2.020 | A3 | 同上 |
| S6-8 | CO@台阶边顶位 | 沿全局法向，C 高 1.8455 Å（v1：1.8444） | A3 | M5 v2 §3.10 |

**U 合规**：U2-a、U4-a、U4-e（默认 4 层不变，只给提示）。**覆盖**：M2 v2 K9、§3.10；M3 §1.3、§3.12.2、§5.1；M5 v2 K7、§3.5（CN 修饰）、§3.9。

---

### S7 bcc Fe(110)

**界面步骤**：Build：bcc / Fe / 2.866 → `Cleave` `1 1 0`（信息行 `Surface cell 2.482 × 2.482 Å, γ = 109.47°`，菱形网格）→ 4 layers、`Vacuum` 15、`p(2×2)` → Create（`Fe(110) p(2×2) 4L`）→
`Find sites` → 放 `H` 到 `hollow (Fe3)`。

**Python**：`build.surface(fe, (1, 1, 0), vacuum=15.0, layers=4, supercell=(2, 2))`；`build.add_adsorbate(s, "H", site="hollow")`。
**CLI**：`facet build surface Fe.json --hkl 1 1 0 --layers 4 --vacuum 15 --supercell 2 2 -o fe110.json`。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S7-1 | 网格与层 | 菱形 2.4820 × 2.4820 Å，γ = 109.47°（钝角约定，M2 K4），面积 5.8082 Å²；d(110) = 2.0266 Å（a/√2）；1 个终止面（4 断键/胞） | A4 / E | 解析 |
| S7-2 | slab | 16 原子；a = b = 4.9641 Å，γ = 109.47°；厚度 6.0797，c = 21.0797 Å | A4 | M2 §3.12 |
| S7-3 | 位点 | top 4、short bridge (Fe2) 8（2.4820）、long bridge (Fe2) 4（2.8660）、hollow (Fe3) 8（准三重，边长 2.482/2.482/2.866，最长/最短 1.155 > 1.1，**没有** fcc/hcp 子类型） | E / A4 | M5 §3.5、§7.3 |
| S7-4 | H@准三重位 | r_Fe,eff = 2.4820/2 = 1.2410（slab 金属–金属键长中位数，含 2.866 Å 的次近邻仍是 2.482）；d = 1.09 × (0.31 + 1.2410) = 1.6906 Å（M5 v2 库 H hollow 1.09）；外接圆半径 1.5199 Å；高 0.7403 Å；H–Fe 1.6906 ×3，与菱形第 4 个顶层 Fe 2.6392 Å。v1（1.11、Cordero）：0.9815 / 1.8093 / 2.7167 | A3 | `v2_heights.py`；M5 v2 K9、§4.1 |

**U 合规**：U2-a、U4-a、U4-e（120° 约定只对六方网格；菱形取钝角）。**覆盖**：M1 §3.11.1；M2 §3.4；M5 §3.5、§3.9。

---

### S8 金红石 TiO2(110)：化学计量的桥氧终止 + 一个氧空位

**前置条件**：体相 TiO2（a = 4.594，c = 2.959，u = 0.305）。

**界面步骤**

1. `Surface › Cleave`：`Plane` `1 1 0`；信息行 `Surface cell 2.959 × 6.497 Å, γ = 90° · 19.22 Å²`、`… · 3 layers per period`；层堆叠图（M2 §5.3）一周期三层，自下而上 `Ti2O2 · 4 atoms`、`O · 1 atom`、`O · 1 atom`，间距 1.27 / 0.71 / 1.27。
2. 终止面列表上方是晶面的 Tasker 说明（Tasker type 2，M2 v2 K14）；三项依次（M2 v2 K7 的排序键）：`O·Ti2O2 · 2 bonds/cell · Non-polar`（默认，带 `Stoichiometric slabs are symmetric`，配位 `2c-O, 5c-Ti`）、
   `Ti2O2 · 3 bonds/cell · Polar`、`O·O · 3 bonds/cell · Polar`。默认 4 layers 时出现 H1 `4 layers is 1⅓ periods, so the slab is not stoichiometric.` 与按钮 `Use 2 periods (6 layers)`。
3. `Thickness` `[Periods]` = 3 → 读数 `9 layers`；`Vacuum` 15；`Surface supercell` `p(2×1)` → Create。名称 `TiO2(110) p(2×1) O·Ti2O2-term 9L`。摘要 `Stoichiometric`，非极性。
4. `Surface › Layers`：`Group` = `Stoichiometric units` → 3 行三层组（`O2 · Ti4O4 · O2`）；`Fix [bottom] [1] unit` → Apply（固定最下面一个三层组）。
5. `Adsorbates › Find sites`：摘要 `4 site atoms (…) · 16 sites in 6 classes`（括号里多元素的写法 M5 §5.2 未定义，§4.1 G-25）。
6. 造氧空位：Layers 第 1 行（2 个桥氧）点击 → 选中 2 个；Ctrl/⌘ 点掉其中一个 → 按 Delete（或 `Atom Selection…`：`Element is O` 且 `Layer from top = 1` → Select，再 Ctrl/⌘ 点掉一个）。toast `Deleted 1 atom` + Undo。
7. `Find sites` → 表面原子变为 5；`Atom Selection…`：`Element is Ti` AND `Layer from top = 2` AND `Coordination number < 6` → 计数行。

**Python**

```python
tio2 = build.crystal("rutile", ["Ti", "O"], a=4.594, c=2.959, u=0.305)
slab = build.surface(tio2, (1, 1, 0), vacuum=15.0, periods=3, supercell=(2, 1))   # termination=0 = O·Ti2O2
slab.fix_layers(bottom=1, group="units")
top_o = find_layers(slab).top_layer(1); slab.delete([top_o[0]])                     # F0-D remap
sel = cl.analysis.select_where(slab, {"version": 1, "match": "all", "conditions": [
      {"prop": "element", "op": "is", "value": ["Ti"]}, {"prop": "layer", "op": "=", "value": 2, "from": "top"},
      {"prop": "cn", "op": "<", "value": 6}]})
```

**CLI**：`facet terminations TiO2.json --hkl 1 1 0`（打印 M2 §6.5 的表）；`facet build surface TiO2.json --hkl 1 1 0 --periods 3 --vacuum 15 --supercell 2 1 -o tio2.json`；
`facet edit fix tio2.json --bottom 1 --group units -o tio2f.json`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S8-1 | 网格与面 | 2.9590 × 6.4969 Å，面积 19.224 Å²；周期 3.2484 Å；一周期 3 面，间隙 1.2669 / 0.7147 / 1.2669 Å | A4 | 解析 a/√2；M2 §0.3 |
| S8-2 | 终止面 | 3 类，顺序固定：`O·Ti2O2`（切在 0.7147 Å 间隙，顶层为 Ti2O2 层上方 1.2669 Å 的桥氧）2 断键/胞、非极性；`Ti2O2` 3 断键、极性（顶层有 Ti⁴⁺，排在前）；`O·O` 3 断键、极性；晶面 Tasker 2 | E | M2 v2 K7、K14；m2v2 原型 |
| S8-3 | slab | 36 原子 Ti12O24；9 层，自下而上 O2 / Ti4O4 / O2 / O2 / Ti4O4 / O2 / O2 / Ti4O4 / O2，间距 1.2669、1.2669、0.7147 循环；a = 5.9180、b = 6.4969 Å；厚度 9.0307，c = 24.0307 Å；化学计量且上下对称 | A4 / E | M2 §0.3 slab 表 |
| S8-4 | 按单元固定 | 3 个三层组；固定最下面一组 = 12 原子（Ti4O8）`[F,F,F]`；等价于 `Fix bottom 3 layers` | E | M3 §3.6、§3.12.2 |
| S8-5 | 位点（无空位） | 4 个表面原子（O_br ×2、Ti5c ×2）；top (O) 2、top (Ti) 2、bridge (O2) 2（2.959）、bridge (Ti2) 2（2.959）、bridge (TiO) 4（3.487）、hollow (Ti2O2) 4；对 25 种面内平移不变 | E | M5 v2 §7.3；`shift_invariance.py` |
| S8-6 | 删除 | 35 原子 Ti12O23；一个撤销步；选区与测量随 `indexMap` 重排；12 个固定原子的标志不变；`info.spacegroup` 不存在；名称不变；`info.surface.asBuilt.composition` 仍是 Ti12O24（K19），Slab 分区的 `slab_report` 行显示 `Ti12O23 · not stoichiometric (bulk TiO2): 1 O missing per cell · edited since cleaving` 一类的实时信息 | E | F0-A §3.2；F0-D §3.3、§3.7；M2 v2 K19、§5.6 |
| S8-7 | 空位后的位点 | 5 个表面原子：O_br 1 + Ti 4（失去桥氧的 2 个 Ti 等价，Ti 分 1 + 2 + 1 三类）；hollow 6；有 `short bridge (Ti2)` 类（2.959 Å，两端为失去桥氧的 Ti）；**bridge 总数必须与面内原点无关**（M5 v1 原型在 32 种平移下一半给 13、一半给 15，§4.1 G-15；定稿值以修正后的金标为准） | E | M5 §3.6、§7.2 `test_sites_vacancy` |
| S8-8 | 配位数查询 | 空位前 2（Ti5c），空位后 4（Ti5c ×2 + 被还原的 Ti ×2）；smart 规则不计 Ti–Ti | E | M3 §3.7、§3.11 |

**U 合规**：U2-a、U4-a、U5-d（删除走统一 remap，props 不错位）。**覆盖**：M2 v2 §3.6–3.11、K19、§5.2–5.3、§5.6、§6.5；M3 §3.6、§3.11、§5.1–5.2；F0-A §3.2、§5.4；F0-D §3.3、§3.7；M5 §3.6、§7.2。

---

### S9 SrTiO3(001)：SrO 与 TiO2 两种终止面，对称 7 层

**前置条件**：体相 SrTiO3（a = 3.905 Å）。

**界面步骤**

1. `Surface › Cleave`：`Plane` `0 0 1`；信息行 `Surface cell 3.905 × 3.905 Å, γ = 90°`、`Layer spacing 1.953 Å · 2 layers per period`；
   `Tasker type 1 surface (every layer is neutral)`；`Termination` 两项 `TiO2 · 5 bonds/cell · Non-polar`（排第一：顶层阳离子 Ti⁴⁺ 价态更高，M2 v2 K7）、`SrO · 5 bonds/cell · Non-polar`。
2. 选 `TiO2`；`Symmetric slab` 打开；`Thickness` 7 layers；`Vacuum` 15 → 摘要 `Symmetric: top and bottom are both TiO2 · Not stoichiometric: Sr3Ti4O11 per cell (bulk SrTiO3), excess TiO2`、`Non-polar` → Create。
3. 回到体相（Cleave 分区的 `Cleave <bulk> again`，M2 v2 的 M2-S5），选 `SrO`，其余不变 → Create。**检查 U4-b**：第二次打开 Cleave 时 `Vacuum` 框显示用户上次填的 15（会话内记忆）。
4. 第三次：`Symmetric slab` 关，8 layers（TiO2 顶）→ Create。
5. 在 TiO2 终止的 7 层上：`Surface › Layers` → `Fix [middle ▾] [3] layers` → Apply（等价：切面时 `Fix layers` 3、`Middle`，M2 v2 K13）。
6. `Adsorbates › Placement` 的 `Both sides`：7 层两种都可用（tip 写反演）；8 层不可用（tip `Needs a slab whose top and bottom are related by symmetry`）。
7. 刷新页面重新建体相并打开 Cleave：`Vacuum` 框又是空的（U4-b）。

**Python**

```python
sto = build.crystal("perovskite", "Sr Ti O", a=3.905)
t7 = build.surface(sto, (0, 0, 1), vacuum=15.0, termination="TiO2", symmetric=True, layers=7)
s7 = build.surface(sto, (0, 0, 1), vacuum=15.0, termination="SrO", symmetric=True, layers=7)
s8 = build.surface(sto, (0, 0, 1), vacuum=15.0, termination="TiO2", layers=8)
t7.fix_layers(middle=3)                     # 或 surface(..., fix_middle=3)
```

**CLI**：`facet terminations STO.json --hkl 0 0 1`；`facet build surface STO.json --hkl 0 0 1 --termination TiO2 --symmetric --layers 7 --vacuum 15 -o sto_t7.json`。

**期望结果**

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S9-1 | 网格与面 | 3.9050 Å 方形，面积 15.249 Å²；周期 3.9050，面 TiO2、SrO 交替，间距 1.9525 Å；2 个终止面，都是 Tasker 1、5 断键/胞 | A4 / E | 解析；M2 §0.3 |
| S9-2 | TiO2 终止 7L | 18 原子 Sr3Ti4O11；层 TiO2/SrO/TiO2/SrO/TiO2/SrO/TiO2；厚度 11.7150，c = 26.7150 Å；名称 `SrTiO3(001) TiO2-term 7L`；`info.surface.symmetric = true`、`asBuilt.stoichiometric = false`、`asBuilt.excess = "TiO2"`；警告 W8 | A4 / E | M2 v2 §3.11、§3.13、§3.20、§4.2 |
| S9-3 | SrO 终止 7L | 17 原子 Sr4Ti3O10；名称 `SrTiO3(001) SrO-term 7L`；`asBuilt.excess = "SrO"` | E | 同上 |
| S9-4 | 化学计量 8L | 20 原子 Sr4Ti4O12；厚度 13.6675 Å；名称 `SrTiO3(001) TiO2/SrO-term 8L`；`asBuilt.stoichiometric = true`、`symmetric = false`；摘要提示偶极修正 | A4 / E | 同上 |
| S9-5 | 固定中间 3 层 | TiO2 终止 7L：第 3–5 行（TiO2、SrO、TiO2）共 8 原子（Ti2SrO5）`[F,F,F]`；SrO 终止 7L 同操作为 7 原子（Sr2TiO4） | E | M3 §3.12.2、S4 |
| S9-6 | 位点 | TiO2 终止：3 个表面原子；top (O) 2、top (Ti) 1、bridge (O2) 4（2.761）、bridge (TiO) 4（1.9525）、hollow (O4) 1（正下方是次表层 Sr）；SrO 终止：top (O) 1、top (Sr) 1、bridge (SrO) 4（2.761）、hollow (Sr2O2) 2 | E / A4 | M5 v2 §7.3 |
| S9-7 | 上下对称操作 | 两个 7L 都找到反演；8L 返回 none，`both_sides=True` 报 E14 `both_sides needs a symmetric slab: …` | E | M5 §3.11.1 |

**U 合规**：U4-a、U4-b（步骤 3、7）、U2-a、U1-b（终止面列表对任何体相都在）。**覆盖**：M2 v2 §3.7–3.13、§5.2、§5.5、K13；M3 §3.12.2；M5 §3.11。

---

### S10 CeO2(111)，O 终止

**界面步骤**：Build：Fluorite / Ce, O / 5.411 → `Cleave` `1 1 1` → `Termination` 三项，第一项 `O·Ce · 2 bonds/cell · Non-polar`（化学计量、O 终止；配位 `3c-O, 7c-Ce`）；默认 4 层时有 H1 与按钮 `Use 3 periods (9 layers)` →
`Thickness` `[Periods]` 3（= 9 layers）、`Vacuum` 15、`p(1×1)` → Create（`CeO2(111) O·Ce-term 9L`）→ `Layers` `Group: Stoichiometric units` → 3 行 O–Ce–O，`Fix [bottom] [1] unit` →
`Slab › Surface supercell…` → `Structure › Cell › Supercell` 预设 `p(2×2)` → `Create supercell` → `Adsorbates › Find sites`。

**Python**：`s = build.surface(ceo2, (1, 1, 1), vacuum=15.0, periods=3)`；`s.fix_layers(bottom=1, group="units")`；`s2 = build.make_supercell(s, [[2, 0], [0, 2]])`；`adsorption_sites(s2)`。
**CLI**：`facet build surface CeO2.json --hkl 1 1 1 --periods 3 --vacuum 15 -o ceo2.json`；`facet transform ceo2.json --surface-cell p2x2 -o ceo2_22.json`；`facet sites ceo2_22.json`。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S10-1 | 网格与面 | 3.8262 Å、120°，面积 12.678 Å²；周期 3.1240 Å；一周期 O / Ce / O，间距 0.7810、0.7810，三层组之间 1.5620 Å | A4 | 解析 a/√3、a/(4√3) |
| S10-2 | 终止面 | 3 类：`O·Ce`（切在 1.5620 Å 间隙）2 断键/胞、非极性、排第一；`Ce`、`O·O` 各 4 断键、极性 | E | M2 §0.3；m2v2 原型 |
| S10-3 | slab | 9 原子 Ce3O6；9 层 O/Ce/O ×3；厚度 7.8101，c = 22.8101 Å；顶、底都是 O，化学计量且对称 | A4 / E | M2 §3.11–3.12 |
| S10-4 | 固定 | 最下面一个三层组 3 原子（CeO2）`[F,F,F]`；p(2×2) 后 12 个，仍精确 | E | M3 §3.6；C3 |
| S10-5 | 位点（p(2×2)，36 原子） | 4 个表面原子（顶层 O）；top (O) 4、bridge (O2) 12（3.8262 Å）、两类三重 O3 空位各 4：一类正下方是 Ce（深 0.7810 Å），标签 `hollow (O3) over Ce`；一类正下方是三层组下面的 O（深 1.5620 Å），标签 `hollow (O3) over O`（M5 v2 K6：化合物表面不用 fcc/hcp；v1 为 `hcp (O3) over Ce`、`fcc (O3)`） | E / A4 | M5 v2 K6、§7.3 |

**U 合规**：U2-a、U4-a。**覆盖**：M2 v2 §3.7–3.12、K9；M1 §5.3；M3 §3.6；M5 v2 K3（`auto` 排除被顶层 O 覆盖的 Ce）、K6。

---

### S11 ZnO (1 0 -1 0)，以四指数输入

**界面步骤**

1. Build：Wurtzite / Zn, O / a 3.25 / c 5.207 / u 0.382。
2. `Surface › Cleave`：`Plane` 自动四格 `h k i l`，`i` 只读（tip `i = −(h + k)`）。输入 h = 1、k = 0、l = 0 → `i` 显示 `-1`，读数行 `(1 0 1̄ 0) of the current cell`。
3. 粘贴 `1 0 0 0` 到第一格：就地错误 `Plane: in (h k i l), i must be −(h + k) = -1.`（`p.err-text role=alert`，`aria-invalid`），`Create slab` 不可用；粘贴 `(1 0 1̄ 0)` 或 `1 0 −1 0`（U+2212）都被识别（F0-A US9）。
4. 信息行 `Surface cell 3.250 × 5.207 Å, γ = 90° · 16.92 Å²`（晶向用四指数 `[u v t w]`）、`… 2 layers per period`；`Termination` 两项 `ZnO-A · 2 bonds/cell · Non-polar`（默认）、`ZnO-B · 4 bonds/cell · Non-polar`；
   默认 4 层时 H2 `4 layers is only 3.75 Å thick.`。
5. `Thickness` 6 layers（3 个周期）、`Vacuum` 15 → Create（`ZnO(10-10) ZnO-A-term 6L`）。

**Python**：`build.surface(zno, (1, 0, -1, 0), vacuum=15.0, layers=6)`；`build.surface(zno, (1, 0, 0, 0), …)` → `ValueError("miller: in (h k i l), i must be −(h + k) = -1.")`。
**CLI**：`facet build surface ZnO.json --hkil 1 0 -1 0 --layers 6 --vacuum 15 -o zno.json`。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S11-1 | 指数 | `info.surface.miller = [1, 0, 0]`、`hkil = [1, 0, -1, 0]`、`millerInput = [1, 0, -1, 0]`；名称里写 `(10-10)` | E | M2 §3.1、§3.13、§4.2；F0-A §3.15 |
| S11-2 | 网格与面 | 矩形 3.2500 × 5.2070 Å，面积 16.923 Å²；周期 2.8146 Å（a√3/2）；每周期 2 个 ZnO 面，间隙 0.9382 / 1.8764 Å（与 u 无关） | A4 | 解析 |
| S11-3 | 终止面 | 2 类：ZnO-A（切在 1.8764 Å 间隙，2 断键）、ZnO-B（0.9382 Å 间隙，4 断键），都非极性 | E | M2 §0.3 |
| S11-4 | slab | 12 原子 Zn6O6；6 层 × ZnO，间距 0.9382、1.8764 交替；厚度 6.5674，c = 21.5674 Å；顶层 Zn–O 二聚体 1.9891 Å（= u·c） | A4 | `scen.py` |
| S11-5 | 位点 | 2 个表面原子；top (O)、top (Zn)、bridge (O2) 3.25、bridge (Zn2) 3.25、short bridge (ZnO) 1.989、long bridge (ZnO) 3.218、`hollow (Zn2O2)`、`hollow (Zn2O2) over O`（M5 v2 K6 的 over 修饰；v1 原型为 `#1`、`#2`） | E / A4 | M5 v2 §7.3 |
| S11-6 | 厚度对照 | 4 层 3.7528 Å（8 原子）、8 层 9.3819 Å（16 原子） | A4 | M2 §3.10 |

**U 合规**：U2-a、U4-a。**覆盖**：F0-A §3.14.4、§3.15、§5.6；M2 §3.1、§3.7；M5 v2 §7.3。

---

### S12 NaCl(100)

**界面步骤**：Build：Rock salt / Na, Cl / 5.64 → `Cleave` `1 0 0`：终止面一项 `NaCl · 2 bonds/cell · Non-polar`；
关掉 `Minimal surface cell` 时信息行改为 5.640 Å 方形并说明是最小网格面积的 2 倍（措辞见 §4.1 G-24），再打开 → 4 layers、`Vacuum` 15 → Create（`NaCl(100) 4L`）。
另做一次 `Vacuum` = 0（U4 允许）→ 摘要第二行 `no vacuum (bulk stacking)`，`Position` 灰显，Create 可用（NaCl(100) 每周期 1 层，任何层数都是整周期；对照：SrTiO3(001) 7 层 + V = 0 时 Create 不可用，就地显示 E12b）。

**Python**：`build.surface(nacl, (1, 0, 0), vacuum=15.0, layers=4)`；`build.surface(nacl, (1, 0, 0), vacuum=0.0, layers=4)`；`build.surface(sto, (0, 0, 1), vacuum=0.0, layers=7)` → `ValueError`（E12b `a vacuum of 0 Å needs a whole number of periods (this slab has 3.5); …`）。
**CLI**：`facet build surface NaCl.json --hkl 1 0 0 --layers 4 --vacuum 0 -o nacl_v0.json`。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S12-1 | 网格与面 | 最小网格 3.9881 Å 方形，面积 15.905 Å²（输入胞网格 5.64 Å，面积 2 倍）；d = 2.8200 Å；每层 Na1Cl1，中性；1 个终止面 | A4 / E | 解析 |
| S12-2 | slab（V = 15） | 8 原子 Na4Cl4；4 层，间距 2.8200；厚度 8.4600，c = 23.4600 Å | A4 | M2 §3.12 |
| S12-3 | 位点 | top (Cl) 1、top (Na) 1、bridge (NaCl) 4（2.82）、hollow (Na2Cl2) 2 | E | `scen.py`（M5 表里是惯用面 4 原子/层的倍数） |
| S12-4 | V = 0 | 体相延续：c = 4 × c₀（倾斜的体相格矢，不正交），晶胞体积 179.41 Å³（= 5.64³，8 原子），最短原子间距 2.8200 Å（= 体相），没有重叠；底层原子 z = 0；`pbc = [T,T,T]`；`info.surface.vacuum = 0`、`stacking = "bulk"` | A4 / E | U4（允许 0）；M2 v2 K11、§3.12.4 |
| S12-5 | 小真空 | V > 0 时跨晶胞边界的最近接触 d_x：d_x < 0.75·d_min 报错，< d_min 给 W12（d_min = 2.82 Å）；0 < V < 10 时提示 H5 `Most DFT slab studies use 10–20 Å of vacuum.`（不写 `info.warnings`） | E | M2 v2 K11、§3.20 |

**U 合规**：U4-a（0 合法）、U2-a。**覆盖**：M2 v2 §3.2、§3.12、K11；M2 领域审查 #3。

---

### S13 石墨烯（本来就是 slab）：改真空、(√3×√3)R30° 超胞、吸附原子

**前置条件**：内置石墨烯（a = 2.46，c = 15，`pbc = [T, T, F]`，2 原子，z = 7.5 Å）。

**界面步骤**

1. Build：Graphene (2D) / C / 2.46 → Build。
2. Shift+5：`Cleave` 分区就地说明 `Cleave needs a crystal that is periodic along a, b and c; this one is periodic along a and b only.`，按钮 `Open Slab section`（M2 v2 E2：只看声明的 pbc，不是 slab 识别，U1-b）。
3. `Surface › Slab`：信息行 `Vacuum gap 15.00 Å along c (not periodic) · 0.00 Å of atoms`；`Vacuum` 框为空（U4-a，当前间隙只在信息行里，M2 v2 §5.6）→ 输入 20；`Position` = Centre → 预览（P-swap）→ `Apply`。
   toast `Vacuum set to 20 Å (c = 20.00 Å)` + Undo；撤销标签 `Set vacuum to 20 Å`。填 0 时就地显示 E12d `a vacuum of 0 Å is only possible when cleaving …`，`Apply` 不可用。
4. `Slab › Surface supercell…` → `Structure › Cell › Supercell` 预设 `(√3×√3)R30°` → `Create supercell`（M2 v2 K17：唯一实现；入口形式见 §4.1 G-36）。
5. `Adsorbates › Find sites`：`6 site atoms (C) · 18 sites in 3 classes`。
6. `Adsorbate › Element…` 输入 `Li` → 选类 `hollow (C6)` → 读数 `Li–C 2.04 Å · 1.46 Å above the site`（C 不是金属，K9 的有效半径不适用，仍用 Cordero）→ `Place`。
7. 导出 POSCAR：toast `Saved … ` 带 `Notes`；Export notes 里 N2 `POSCAR is always periodic: c was not periodic and is written as a cell vector with a 18.5 Å gap between periodic images`。

**Python**

```python
g = build.crystal("graphene", "C", a=2.46)
g.set_vacuum(20.0)                                  # 总间隙；不改 pbc
g3 = build.make_supercell(g, [[2, 1], [-1, 1]])
build.add_adsorbate(g3, "Li", site="hollow")
```

**CLI**：`facet build crystal graphene C --a 2.46 -o g.json`；`facet edit vacuum g.json --vacuum 20 -o g20.json`；
`facet transform g20.json --surface-cell sqrt3 -o g3.json`；`facet adsorb g3.json Li --site hollow -o g3li.json`。
（不要用 `build crystal graphene --vacuum 10`：现有的这个参数是**每侧**真空，c = 2 × 10，§4.1 G-12。）

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S13-1 | 改真空 | c = 20.0000 Å，原子 z = 10.0000 Å（居中，U4-d），面内坐标不变；`pbc` 仍为 `[T, T, F]`；只保留当前帧；`info.surface` 新建 `kind = "vacuum"` 块（只是来源记录，不是 slab 标记） | A4 / E | U2-b；M2 v2 K15、§3.14、§4.2 |
| S13-2 | √3 超胞 | 6 原子；a = b = 4.2608 Å（√3 × 2.46），γ = 120°，c = 20；名称按 M1 K5 的通用规则（不是 M2 自动名）在末尾加 `(√3×√3)R30°`；`info.supercellMatrix` = `[[2,1,0],[-1,1,0],[0,0,1]]` | A4 / E | M1 v2 K5、§3.5 |
| S13-3 | 位点 | top (C) 6、bridge (C2) 9（1.4203 Å）、hollow (C6) 3；单层没有 fcc/hcp 歧义 | E | M5 v2 §7.3 |
| S13-4 | Li@hollow | 高 1.4644 Å，Li–C 2.0400 ×6（系数 1.0 × (1.28 + 0.76)，ρ = 1.4203）；7 原子；θ = 0.33 ML（1 / 3 个 1×1 胞，M5 v2 K12），另显示每个 C 0.17；名称 `<S13-2 的名字> + Li`（M5 v2 §4.5：没有自动名哨兵时把编辑前的名字当作哨兵写入，再接后缀）；`adsorbate_id` = 1 | A3 / E | 解析；M5 v2 K9、K12、§4.5 |
| S13-5 | 4×4 对照 | `p(4×4)`：32 原子，位点 32/48/16 | E | M5 v2 §7.3 |
| S13-6 | POSCAR | 一条说明 N2（间隙 = 20 − 1.4644 = 18.5 Å，一位小数）；没有警告 | E | F0-D §3.12.2 N2 |

**U 合规**：U1-b（步骤 2）、U2-b（S13-1）、U4-a、U4-c（`g.set_vacuum()` 无参数 → `TypeError`；JS `setVacuum()` → E12a）。**覆盖**：M1 v2 K5、§5.3；M2 v2 §3.14、§5.6、K15、K17；M5 §2.1 L5、§3.9；F0-D §3.12.2。

---

### S14 VASP CONTCAR：导入（Selective dynamics、底层在分数 z = 0）、编辑、再导出

**夹具** `tests/data/surface/contcar_pt111.vasp`（F0-D §7.1 指定的唯一 CONTCAR 夹具；生成规则写进 `scripts/gen_surface_fixtures.py`，原型输出见
`proto/xcheck/acc/contcar_pt111.vasp`）：Pt(111) p(3×3) 4L（同 S1 的 slab），VASP 5 格式，注释行 `Pt(111) p(3x3) 4L relaxed`，比例 `1.00000000000000`，
晶格 `a = (8.3155757467537992, 0, 0)`、`b = (−4.1577878733768996, 7.2014998437825444, 0)`、`c = (0, 0, 21.7896391656699997)`，`Pt` / `36`，`Selective dynamics`，`Direct`；
原子按层从下到上，第 1–18 行 `F F F`、第 19–36 行 `T T T`；底层 9 个原子 f_c = 0，其中第 4、8 行被 VASP 包到 `0.9999900000000000`；坐标 16 位小数、没有 `-0.0000…`；
末尾空行加 36 行全零速度。

**界面步骤**

1. 把夹具拖进窗口（或 File › Open）。只出现 toast `Loaded contcar_pt111.vasp — 36 atoms`；没有对话框（U1-a）。`Structure` 面板 `Periodic T T T`。
2. 视图：两个 f_c = 0.99999 的原子画在底层（不在真空顶部，U1-c）；`viewer.model.n` 等于把夹具改成 `pbc = [T,T,F]` 后的绘制数。悬停其中一个：卡片显示存储坐标 z = 21.7894 Å（frac 0.99999）并另起一行注明画出的像（F0-A A-D18）。
3. `Surface › Layers`：4 行 `Pt 9`，Δ = 2.26，没有 straddle 提示（M3 K15）；第 3、4 行 🔒（来自文件的标志）。
4. **不做编辑**导出 POSCAR → 无警告、无说明。
5. 编辑：(a) 点 Layers 第 2 行 → 选区卡片 `Fix ▾ → Fix z only`；(b) `Adsorbates › Find sites`（摘要与 S1 理想 slab 相同：`9 site atoms (Pt) · 54 sites in 4 classes`）→ CO 放到某个 `top (Pt)`；
   (c) 点一个不在 CO 下面的顶层 Pt → Delete。
6. 导出 POSCAR。
7. 撤销三次 → 再导出 POSCAR。
8. 导出 extxyz（第 6 步状态下）。

**Python**

```python
s = cl.read("contcar_pt111.vasp")
assert s.pbc == [True, True, True]
cl.write("rt.vasp", s)                                            # 第 4 步
L = find_layers(s)
s.fix(L.top_layer(2), axes="c")                                   # Fix z only → [T,T,F]
build.add_adsorbate(s, "CO", site="ontop")                        # C、O 追加在 Pt 之后，Pt 下标不变
k = far_top_atom(s, L.top_layer(1))                               # 离 CO 最远的顶层 Pt（测试辅助函数，最小像面内距离）
s.delete([k])                                                     # F0-D remap，标志随原子
cl.write("edited.vasp", s)
```

**CLI**：`facet convert contcar_pt111.vasp rt.vasp`（第 4 步）；`facet edit fix contcar_pt111.vasp --layers 2 --axes c --keep-other -o e1.vasp`；
`facet adsorb e1.vasp CO --site ontop -o e2.vasp`；`facet layers e2.vasp`（打印 4 层，吸附物 2 个原子被排除）。

**"内容逐字节等价"的定义（规范形，测试按它比较）**：每行按空白切成记号；注释行原样（空白归一）；数值记号解析为浮点后用 10 位小数重写，`-0.0000000000` 写成 `0.0000000000`；
比例因子与晶格同样处理；物种行、计数行原样；有 SD 时写一行 `Selective dynamics`；坐标模式只取首字母大写；每个原子一行 3 个坐标 + 3 个标志（取首字母大写）；
速度块若全为零则视为不存在，否则逐行比较。**未编辑的往返要求：两份规范形逐字节相同**，并且每个坐标差 ≤ 1e-8 Å（F0-D §7.2）。
仓库现状的 Python 读写器（HEAD）按此定义已经等价（`contcar_rt.py`），但原样文本有三处不同：数值末位变化（`0.9999900000000000` → `0.9999899999999999`）、出现 3 个 `-0.0000000000000000`、
全零速度块被丢掉——三处都由规范形吸收；负零与"非零速度块会丢"另作缺陷处理（§4.1 G-11）。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S14-1 | 导入 | 36 原子；`pbc = [T,T,T]`；坐标与文件相同（f_c = 0 与 0.99999 都不动）；`props.selective_dynamics` 36 项，18 个 `[F,F,F]`；无 `info.warnings`；没有任何对话框 | E / F8 | U1-a；F0-D §3.10.1、§5.1 |
| S14-2 | 显示 | 底层 9 个原子画在 z ≈ 0 一侧；绘制数与 TTF 对照相同；两个包裹原子不出现在真空顶部 | E | U1-c；F0-A §3.8.2、§7.4 第 6 条 |
| S14-3 | 层与间隙 | `find_vacuum_gap` 沿 c：宽 14.9998 Å（21.7894 − 6.7896）；`find_layers`：4 层 × 9，底层平均高度 ≈ 0（切口在间隙中点，与显示同一切口，U1-d） | A4 / E | F0-D §3.13；M3 §3.3 |
| S14-4 | 未编辑往返 | 规范形逐字节相同；第 1–18 行 `F F F`、第 19–36 行 `T T T`，顺序不变；Export notes 为空；Python 与 JS 都满足 | E / F8 | F0-D §7.2 U1 验收；§4.1 G-11 |
| S14-5 | 编辑后的约束 | 第 2 行 9 个原子 `[T,T,F]`；位点与 S1 理想 slab 相同（54 个） | E | M3 §5.3.1；M5 §7.2 `test_sites_contcar` |
| S14-6 | 编辑后导出 | 37 原子；物种 `Pt C O`、计数 `35 1 1`；标志按行：18 × `F F F`（与输入第 1–18 行同一批原子、同顺序、坐标不变）、9 × `T T F`、8 × `T T T`、C、O 各 `T T T`；未动的 35 个 Pt 坐标与输入差 ≤ 1e-8 Å，包裹原子仍是 0.99999；CO 的 C z = 8.6351 Å（f_c 0.396296）、O z = 9.7634 Å（0.448077）（M5 v2；v1 为 8.6340 / 9.7623）；没有 tags 键（文件里没有，M5 不新建）、`adsorbate_id` 新建（Pt 0、CO 1） | E / A4 / F8 | C3；M5 §4.3；F0-D §3.10.2 |
| S14-7 | 撤销后 | 撤销三次后导出，与原文件规范形逐字节相同 | E / F8 | P3 |
| S14-8 | extxyz | 有部分约束，所以写 `move_mask:L:3`，并给出导出警告 W6（`Extended XYZ stores these constraints as ASE FixCartesian masks because 9 atom(s) are only partly fixed; …`）；toast 不自动消失；仍不写 `selective_dynamics:L:3` | E | F0-D K4、§3.12.2 W6；U5-c |

**U 合规**：U1-a、U1-c、U1-d、U2-b（导入保留文件的 T T T）、U5-c、U5-d（JS 读 SD）。**覆盖**：F0-D §3.10、§3.12、§3.13、§7.2；F0-A §3.8.2、A-D18；M3 §3.3、K15、§5.3；M5 §3.1、§4.3。

---

### S15 界面与异质结

所有界面结果：新结构（P4），`pbc = [T,T,T]`（U2-a，即使两层输入都是 TTF 的二维原型，M6 v2 §0 第 6 条），a ∥ x，c ∥ z，基底在前、覆盖层在后，新属性 `interface_layer`（1 = 基底），
来源写在 `info.surface.interface`（`info.surface.kind = "interface"`），`info.source = "builder:interface"`，空间群清除；基底保留 tags、覆盖层 tags 置 0。
`Vacuum` 框为空、`Create` 不可用，直到填写（U4-a；允许 0 = 两个界面的超晶格，没有 `periodic` 参数）；`make_interface(…)` 不给 `vacuum` → `TypeError`（U4-c）。
命令是 `build.layers`（`Build layers…`，MS 名 Build Layers，M6 v2 §0 第 7 条）。

#### S15a 石墨烯 / Ni(111)（1×1）

**前置条件**：用 S1 的流程建 `Ni(111) 4L`（fcc Ni a = 3.52，(1 1 1)，4 layers，`Vacuum` 15，`Fix layers` 2 Bottom，p(1×1)，4 原子）；Build 面板建石墨烯（2 原子）。

**界面步骤**

1. `Surface › Interface`（M6 v2 §5.2）：`Layers (bottom → top)` 中 `Substrate` 选 `Ni(111) 4L`（读数 `2.489 × 2.489 Å, 120°, 4 atoms per cell`），`Overlayer` 选石墨烯（`2.460 × 2.460 Å, 120°, 2 atoms per cell`）。
2. `Match`：`Search`，`Max strain` 3 %，`Max area` 400 Å²，`Twist` `Any` → 状态行 `561 matches · 8 best trade-offs`；第一项 `6 atoms · 5.4 Å² · 0.0°` / `Mismatch 1.18% · (1×1) on (1×1)`；
   `Selected` 行 `Substrate (1×1) · Overlayer (1×1) · Twist 0.0° · Orientation 0.0° (1 of 6)`（M6 v2 §3.6.6 实现后为 `1 of 2 distinct`）与 `Strain  overlayer εxx +1.18% εyy +1.18% εxy 0.00% · substrate 0`。
3. `Build`：`Apply strain to` = Overlayer；`Interlayer distance` 菜单列出 `vdW contact — 3.33 Å, set by Ni–C`、`Covalent contact — 2.00 Å, set by Ni–C`，选 `Custom`、输入 2.10；
   `Registry shift` 右侧菜单依次选 `Top`、`fcc hollow`、`hcp hollow`（`Top` 时 u, v = (0, 0)，两个空位各是 (1/3, 2/3)、(2/3, 1/3) 之一，哪个是 hcp 由次表层原子决定，M6 v2 §3.8.3）；
   `Vacuum` 为空时摘要末尾是 `vacuum not set`、`Create` 不可用（U4-a）→ 输入 15；`Keep constraints` ✓。`Top` 时摘要 `6 atoms · a = b = 2.489 Å, γ = 120° · closest contact 2.10 Å (C–Ni)`。
4. 选给出 top-fcc 的那个预设（状态行 `anchor C on top, second C on fcc hollow`，M6-S1）→ `Create` → toast `Built graphene/Ni(111) — 6 atoms` + Undo，撤销标签 `Add graphene/Ni(111)`（M6 v2 §4.4、§5.4）。
5. 导出 POSCAR。

**Python**：`ni = build.surface(build.crystal("fcc", "Ni", a=3.52), (1, 1, 1), vacuum=15.0, layers=4, fix_bottom=2)`；`gr = build.crystal("graphene", "C", a=2.46)`；
`res = build.interface_matches(ni, gr)`（`res["total"] == 561`、`res["paretoCount"] == 8`）；`s = build.make_interface(ni, gr, match=0, distance=2.10, shift="top", vacuum=15.0)`，另两次 `shift="fcc"`、`shift="hcp"`。
**CLI**：`facet build interface ni111.json g.json --list`（列表不需要 `--vacuum`）；`facet build interface ni111.json g.json --pick 1 --distance 2.10 --shift-site top --vacuum 15 -o POSCAR`；构建时省略 `--vacuum` → 退出码 2（M6 v2 §6.4）。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S15a-1 | 匹配表 | 561 类（M6 v2：±θ 各算一类），8 个 Pareto；第 1 类 6 原子、面积 5.365 Å²、θ = 0°、主伸长 +1.180 %/+1.180 %、6 个取向变体（分成 2 组物理上不同的取向，M6 v2 §3.6.6）；第 2、3 类 42 原子 ±21.787°（同为 +1.180 %）；Pareto 第 2、3 项 164 原子 ±10.893°、−0.644 % | E / A3 | M6 v2 §3.6.4–3.6.6、§3.15；`m6v2_counts.py` |
| S15a-2 | 结构 | 6 原子（Ni4 C2）；a = b = 2.4890 Å，γ = 120°；C–C 1.4370 Å（1.4203 × 1.01180）；石墨烯在 Ni 顶层上方 2.1000 Å；c = 8.1968 + 15 = 23.1968 Å（Ni 厚 6.0968） | A4 | `iface.py` |
| S15a-3 | 三种错位 | 锚 C（覆盖层中 z 最小、下标最小的 C）恰在所选预设上（横向 < 1e-3 Å）；`Top`、`fcc hollow`、`hcp hollow` 三个结果的配位集合恰为 {top-fcc、top-hcp、fcc-hcp}：含 top 的两种最近接触 2.1000 Å（C 在顶层 Ni 正上方），fcc-hcp 2.5446 Å；第二个 C 落在 fcc 还是 hcp 取决于取向变体（`variant`），所以测试只断言集合与锚 C（配位记录见 §4.1 G-21） | E / A4 | `iface.py`；M6 v2 §3.8.3、§3.6.6 |
| S15a-4 | 属性 | `interface_layer`：Ni 1、C 2；Ni 的 `[F,F,F]` ×2 原样带入，C `[T,T,T]`；tags：Ni 原值 1–4，C 0；`info.surface.interface` 里覆盖层的主应变 [0.0118, 0.0118] | E / A3 | M6 v2 §0 第 6 条、§4.1–4.2 |
| S15a-5 | POSCAR | `Ni C` / `4 2`，`Selective dynamics`，2 行 `F F F` | E | M6 v2 §3.8.2 |
| S15a-6 | Cu(111) 对照 | Cu a = 3.615（F0-D 的默认值）：1×1 失配 +3.91 %（M6 v2 的例子用 a = 3.61，写的是 3.77 %），默认 3 % 下不出现在列表里，列表下方提示 `The 1×1 on 1×1 match needs 3.91% strain. [Use it anyway]`；`interface_matches` 返回 `hint1x1 = {"mismatch": 0.0391}` | A3 / E | M6 v2 §5.2、§6.1（M6-F14） |

#### S15b MoS2 / Au(111)，(√19×√19)R23.4° 配 MoS2 4×4

**前置条件**：`Au(111) 4L`（fcc Au 4.08，(1 1 1)，4 layers，`Vacuum` 15，p(1×1)）；MoS2 单层（a = 3.16，c = 18，3 原子）。

**界面步骤**：`Interface`：`Substrate` Au(111) 4L，`Overlayer` MoS2 → `Search` 默认 → `148 matches · 12 best trade-offs`；第 1、2 项 `103 atoms · … · 13.9°` / `Mismatch 1.29% · …`；
选第 3 项 `124 atoms · 136.9 Å² · 23.4°` / `Mismatch 0.51% · (4×4) on (√19×√19)R23.4°` → `Interlayer distance` Custom 2.80 → `Vacuum` 15 → Create →
toast `Built MoS2 p(4×4)/Au(111) (√19×√19)R23.4° — 124 atoms`（M6 v2 §5.4 的原例）。

**Python**：`s = build.make_interface(au, mos2, match=2, distance=2.80, vacuum=15.0)`（0 起；或传入列表里 `atoms == 124 and twist > 0` 的那一项）。
**CLI**：`facet build interface au111.json mos2.json --pick 3 --distance 2.80 --vacuum 15 -o mos2_au.vasp`。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S15b-1 | 匹配表 | 148 类，12 个 Pareto；第 1、2 类 103 原子 ±13.898°、+1.285 %；第 3、4 类 124 原子 ±23.413°、−0.511 %，+23.413° 那一类的基底矩阵 `[[5,2],[-2,3]]`（det 19）、覆盖层 `[[4,0],[0,4]]` | E / A3 | M6 v2 §3.15；`m6v2_counts.py` |
| S15b-2 | 结构 | 124 原子（Au76 Mo16 S32）；a = b = 12.5754 Å（√19 × 2.8850），γ = 120°；扭转 +23.413°；MoS2 面内各向同性应变 −0.511 %，Mo–S 2.4168 → 2.4097 Å（z 分量不变，S–S 高 3.17 Å）；最近 S–Au 2.8000 Å；c = 13.0368 + 15 = 28.0368 Å | A4 / A3 | `iface.py` |
| S15b-3 | 名称 | `MoS2 p(4×4)/Au(111) (√19×√19)R23.4°`（两层名字不同，不加扭转后缀；v1 为 `MoS2/Au(111) (√19×√19)R23.4° 23.4° twist`）；`info.surface.interface.label = "MoS2/Au(111)"`；S15a 的名称为 `graphene/Ni(111)` | E | M6 v2 §4.4 |

#### S15c 扭转双层石墨烯 21.8°

**界面步骤**：`Interface`：`Substrate` 与 `Overlayer` 都选同一个石墨烯 → `Max strain` 0 %，`Twist` `Target` 21.8 ± 0.5 → `2 matches`（±21.787°，各 28 原子）→ 选 +21.787° →
`Interlayer distance` Custom 3.35 → `Vacuum` 15 → Create。另：`Twist` `Any`、400 Å² → 21 类，第 1 类是 4 原子 AA 堆垛（0°），第 2、3 类 28 原子 ±21.787°。

**Python**：`build.make_interface(gr, gr, twist=21.8, twist_tolerance=0.5, max_strain=0.0, distance=3.35, vacuum=15.0)`。
**CLI**：`facet build interface g.json g.json --twist 21.8 --twist-tol 0.5 --max-strain 0 --distance 3.35 --vacuum 15 -o tblg.vasp`。

| # | 检查 | 期望 | 容差 | 来源 |
|---|---|---|---|---|
| S15c-1 | 公度角 | θ = 21.7868°（cos θ = 13/14，m = 1）；两层都是 √7 超胞（`[[3,1],[-1,2]]` 与 `[[3,2],[-2,1]]`），应变 0（\|ε\| < 1e-9） | ±1e-4° / E | 解析；M6 §7.1 |
| S15c-2 | 结构 | 28 原子（每层 14）；a = b = 6.5085 Å（√7 × 2.46），γ = 120°；层间 3.3500 Å，锚点处 AA 对位（最近 C–C 3.3500）；c = 3.35 + 15 = 18.35 Å；`pbc = [T,T,T]` | A4 / E | `iface.py`；U2-a |
| S15c-3 | 名称 | `graphene (√7×√7)R19.1°/graphene (√7×√7)R19.1° 21.8° twist`（两层同名才加扭转后缀，一位小数） | E | M6 v2 §4.4 |

**S15 的 U 合规**：U2-a、U3、U4-a、U4-c。**覆盖**：M6 v2 §0、§3.2、§3.6、§3.8–3.9、§4.1–4.4、§5.2–5.4、§6.1、§6.4；F0-D §3.5.3 `concat_structures`。原子顺序按 M6 v2 §10.1 的决定：基底在前、覆盖层在后，不用 `canonical_order`（§4.2 G-7）。

---

### S16 性能

两种规模：**S16a** Pt(111) p(6×6) 6L（216 原子）；**S16b** Pt(111) p(41×41) 6L（10 086 原子，"1 万原子 slab"）。界面操作与 S1 相同（只改 `Surface supercell` 与层数；S16b 的 Find sites 超过 3 000 原子时不自动重算，要点按钮，M5 §5.2）。

| # | 对象 | 期望 | 预算（JS 浏览器 / Python） | 来源 |
|---|---|---|---|---|
| S16-1 | S16a 结构 | 216 原子，6 × Pt36；a = 16.6312 Å；c = 11.3161 + 15 = 26.3161 Å；`Fix layers` 3（Bottom）→ 108 个固定 | E / A4 | 解析 |
| S16-2 | S16a 位点 | 36 个表面原子；top 36、bridge 108、fcc 36、hcp 36，4 类 | E | M5 v2 §7.3 |
| S16-3 | S16a 耗时 | 组装 ≤ 5 ms / ≤ 10 ms；`findLayers` < 1 ms；Find sites ≤ 30 ms / ≤ 0.3 s；一次放置 ≤ 2 ms / ≤ 20 ms；按层固定 ≤ 5 ms；上下对称操作 ≤ 20 ms / ≤ 0.2 s；预览与面板交互无可感知延迟 | T | M2 §7.5、M3 §7.5、M5 §7.5 |
| S16-4 | S16b 结构 | 10 086 原子；a = 113.6462 Å；6 × Pt1681 | E / A4 | 解析 |
| S16-5 | S16b 切面 | 组装 ≤ 60 ms / ≤ 150 ms；Create（含撤销快照）≤ 300 ms；`set_vacuum` ≤ 30 ms / ≤ 50 ms | T | M2 §7.5 |
| S16-6 | S16b 层与约束 | `findLayers` ≤ 20 ms；按层固定 ≤ 30 ms；`surfaceAtoms` ≤ 120 ms | T | M3 §7.5 |
| S16-7 | S16b 位点 | top 1681、bridge 5043、fcc 1681、hcp 1681；Find sites ≤ 400 ms / ≤ 4 s；`Place on all 1681 equivalent sites`（CO）≤ 300 ms（M5 的 1 600 位点预算按比例 ≤ 315 ms） | E / T | M5 §7.5 |
| S16-8 | S16b 编辑与历史 | 交替固定/移动 50 次：每次 ≤ 60 ms，`history.bytes` ≤ 64 MiB；移动 1 000 个原子时每次预览更新 ≤ 3 ms（CPU）；撤销快照 ≤ 2 ms | T | F0-A §7.5、US5 |
| S16-9 | S16b 读写 | POSCAR / extxyz 读或写（JS，含标志）≤ 60 ms；`remap` ≤ 15 ms；真空间隙三轴 ≤ 15 ms | T | F0-D §7.6 |
| S16-10 | S16b 作基底 | `Interface` 的 `Substrate cell` 选 `Keep the input cell` 叠石墨烯：构建 ≤ 300 ms（JS）/ ≤ 1 s（Python） | T | M6 v2 §3.13.3 |

**U 合规**：U4-a（大体系也不预填真空）；性能不随 slab/非 slab 改变路径（U1-b）。

---

## 3. 哪些场景变成自动测试

### 3.1 总表

| 场景 | Python 单元测试（快，默认运行） | 跨语言金标 `tests/data/surface/acceptance/` | Playwright 冒烟（`slow`） | 手动演示检查 |
|---|---|---|---|---|
| S1 Pt(111) p(3×3) + 2CO | `test_s01_*`；REST、CLI 版本 | `s01_pt111_p3x3_2co.json`（完整原子列表） | E2E-1 | MD-1、MD-7 |
| S2 Cu(100) c(2×2)-O | `test_s02_*` | `s02_cu100_c2x2_o.json` | — | — |
| S3 Ag(111) √3 | `test_s03_*` | `s03_ag111_sqrt3.json` | — | — |
| S4 Ru(0001) | `test_s04_*` | `s04_ru0001_hollows.json` | — | — |
| S5 fcc(110) | `test_s05_*` | `s05_pt110_bridges.json` | — | MD-2 |
| S6 fcc(211) | `test_s06_*` | `s06_pt211_steps.json` | — | MD-2 |
| S7 Fe(110) | `test_s07_*` | `s07_fe110.json` | — | — |
| S8 TiO2(110) + 空位 | `test_s08_*`（空位计数在 G-15 修正后固化） | `s08_tio2_110_vacancy.json`（完整原子列表） | — | MD-3 |
| S9 SrTiO3(001) | `test_s09_*` | `s09_srtio3_001.json`（完整原子列表） | E2E-3 | — |
| S10 CeO2(111) | `test_s10_*` | `s10_ceo2_111.json` | — | — |
| S11 ZnO(10-10) | `test_s11_*`（含 E4 文案） | `s11_zno_10m10_hkil.json` | E2E-3 的第 8 步 | — |
| S12 NaCl(100) | `test_s12_*`（含 V = 0） | `s12_nacl_100.json` | — | — |
| S13 石墨烯 | `test_s13_*` | `s13_graphene_sqrt3_li.json`（完整原子列表） | E2E-4 | — |
| S14 CONTCAR | `test_s14_*`（两种语言的规范形往返） | `s14_contcar_roundtrip.json` + 夹具 `contcar_pt111.vasp` | E2E-2 | MD-4 |
| S15 界面 | `test_s15_*`（匹配表与构建） | `s15_interfaces.json`（三个构建的完整原子列表） | E2E-5 | MD-5 |
| S16 性能 | `tests/test_surface_perf.py`（`slow`，2× 预算断言） | — | E2E-6（`slow`） | MD-6 |

规则：

- **金标文件**用 F0-D K12 的公共外壳 `facet.cases/1`（F0-D §7.1、账本 L-F0-27），新增一个 op `pipeline`，按账本的 op 归属放在 `tests/ops/acceptance.py` 与 `tests/js/ops/acceptance.mjs`（M7 的任务，不改 `tests/cases.py`）；`input.recipe` 给体相原型与参数（账本的配方输入，S16 这类大结构不存坐标），或 `input.file`（S14 用唯一的夹具 `tests/data/surface/contcar_pt111.vasp`），
  `args.steps` 依次列出 `surface`、`setVacuum`、`makeSupercell`、`fixLayers`、`fix`、`fixHeight`、`delete`、`sites`、`addAdsorbate`、`addAdsorbates`、`read`、`write`、
  `interfaceMatches`、`makeInterface`，每步可 `save` 一个中间结果；`expect` 用公共比较器（`structure`、`value`、`text`、`warnings`、`error`）。
  Python 由 `tests/test_cases.py`、JS 由 `tests/js/cases.test.mjs` 各跑一遍（不需要 Node 的那一半总是运行）；`tests/test_js_parity.py` 另对全部原子列表做 P6 比较。
- 期望值的来源按简报 §6：解析解（本文各表的"解析"项）> 本文原型数字 > 开发期 ASE/pymatgen 核对后固化。生成脚本 `scripts/gen_acceptance_fixtures.py` 只在开发期运行。
- `test_sNN_*`（`tests/test_acceptance_surface.py`）走**公开 API**（`facet.build`、`analysis`、`Structure` 方法、`cl.read/write`），另有
  `tests/test_acceptance_cli.py`（用 `subprocess` 跑 S1、S9、S14 的 CLI 序列，检查 stdout/stderr 与退出码，含 U4-c：省略 `--vacuum` 退出码 2）与
  `tests/test_acceptance_rest.py`（`TestClient` 跑 S1：`/build/surface` → `/analysis/sites` → `/build/adsorbate` → `/io/export`；U4-c：缺 `vacuum` → 422）。
- S8 的空位计数（G-15）、自动名哨兵的键名（G-32）、c(2×2) 预设得到的名字（G-39）标为 `xfail(strict=True, reason="§4.1 G-nn")`，裁决并更新金标后去掉标记；
  吸附高度在 M5 v2 T13 校准系数之前一律按 S1-6′ 的公式断言（G-35）。

### 3.2 Playwright 冒烟测试

**运行方式**（与 F0-A §7.4、M2 §7.4、M3 §7.4、M5 §7.4 的 Playwright 项合并，§4.1 G-19）：

- 用 Node 版 Playwright（本机预装 1.63.0：`/opt/node22/lib/node_modules/playwright`，另有 `/opt/node-tools/node_modules/playwright`）和预装 Chromium（`/opt/pw-browsers/chromium`）。
  测试文件 `tests/e2e/*.spec.mjs`，共用 `tests/e2e/harness.mjs`；pytest 包装 `tests/test_e2e.py`（标记 `slow`，`pytest -m slow` 时运行），
  它启动 `python -m http.server <空闲端口> --directory facet/web`（静态版，P1），把地址放进 `FACET_E2E_URL`，再逐个运行 `node tests/e2e/<name>.spec.mjs`，
  断言退出码 0。找不到 Node、Playwright 或 Chromium 时跳过；`FACET_REQUIRE_E2E=1` 时失败。
- `harness.mjs`：`chromium.launch({ headless: true, executablePath: process.env.FACET_CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })`
  （以 root 运行时必须 `--no-sandbox`；SwiftShader 参数与 `scratchpad/viewerprobe/probe.js` 相同）；视口 1280×800；收集 `pageerror` 与 `console.error`，测试结束时必须为空；
  `page.goto(URL)` 后 `waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60000 })`；
  `section(name)` = 标题为 name 的 `details.sec`；控件一律按可访问名称定位（`getByRole`/`getByLabel`，名称取各模块 §5 的控件表；F0-A §5.11 要求每个输入有 `aria-label`）；
  每个关键步骤 `page.screenshot({ path: 'tests/e2e/out/<spec>-<step>.png' })`，供审查。
- 数值断言读 `window.facet`（`structure`、`project`、`exportText`、`exportReport`、`analysis.*`）；界面断言读可访问文本。
- 共用工具 `tests/e2e/poscar_canon.mjs` 与 Python `tests/poscar_canon.py`：S14 的规范形，两份实现由 `tests/test_js_parity.py` 对夹具与 3 个导出样例互相核对。

**E2E-1 切面 → 固定 → 吸附 → 导出（S1）**

1. `facet.load(facet.build.crystal('fcc', { elements: ['Pt'], a: 3.92 }))`；记 `n0 = facet.project.structures.length`。
2. 按 Shift+5。断言 `section('Cleave')`、`section('Slab')`、`section('Layers')`、`section('Adsorbates')`、`section('Interface')` 都存在；所有分区标题文本不含 `slab`/`bulk` 字样的徽章（U1-b）。
3. Cleave：`Plane` 三个框的值为 `1`、`1`、`1`；`getByLabel('Vacuum')` 的值为 `''`，`placeholder` 不含数字；`getByRole('button', { name: 'Create slab' })` 为 disabled（U4-a）。
4. 断言摘要含 `vacuum not set`、`Preview` 的 `Slab` 选项 disabled；填 `Vacuum` = `15`；勾 `Fix layers`，断言其数值框为 `2`、`Bottom` 为按下状态；`Surface supercell` 选 `p(3×3)`。
5. 断言摘要（`section('Cleave').getByRole('status')`）含 `Pt(111) p(3×3) 4L — 36 atoms` 与 `8.32 × 8.32 × 21.79 Å`。
6. 记 `h0 = facet.app.history.length`、`d0 = facet.app.dirty`；点 `Preview` 的 `Slab`：断言 `getByRole('region', { name: 'Preview' })` 可见、状态栏含 `Preview · 36 atoms`、
   `history.length === h0`、`dirty === d0`；截图 `preview`；点 `Planes`，断言预览条消失。
7. 点 `Create slab`：toast 含 `Created Pt(111) p(3×3) 4L (36 atoms)`；`project.structures.length === n0 + 1`；活动结构 36 原子、`pbc` 全 `true`、`cell[2]` 与 `[0, 0, 21.7896]` 差 ≤ 1e-4、
   `cell[0][1]`、`cell[0][2]`、`cell[1][2]`、`cell[2][0]`、`cell[2][1]` 绝对值 ≤ 1e-12；`selective_dynamics` 中全 `false` 的 18 项；`tags` 计数 {1: 9, 2: 9, 3: 9, 4: 9}。
8. Layers：4 行，文本依次含 `14.29`、`12.03`、`9.76`、`7.50` 与 `Pt 9`；第 3、4 行的按钮为 `Free`。
9. Adsorbates：点 `Find sites`；摘要为 `9 site atoms (Pt) · 54 sites in 4 classes`；类列表（`role=listbox`）的 4 项 `aria-label` 为 `top (Pt), 9 sites`、`bridge (Pt2), 27 sites`、`fcc (Pt3), 9 sites`、`hcp (Pt3), 9 sites`。
10. 搜索框填 `CO`，选 `CO  Carbon monoxide`；点类 `fcc (Pt3)`；Placement 读数匹配 `/^C–Pt (\d\.\d\d) Å · (\d\.\d\d) Å above the site$/`，两个数与
    页面里 `(await import('/js/build/adsorbates.js')).placeAdsorbate(…)`（M5 v2 §6.2 的纯函数）对同一位点算出的键长、高度在 ±0.005 内一致（当前库系数下为 `2.10`、`1.36`；不写死数字，避免 T13 再校准后改测试）；点 `Place`；toast 含 `Added CO on fcc (Pt3)`；
    放置后 C 到 3 个系综 Pt 的距离两两相差 ≤ 1e-3 Å，且等于读数的键长 ±0.005。
11. 点类 `top (Pt)`；最多 9 次：若 Placement 里有 `p.hint.warn` 就点 `getByRole('button', { name: 'Next site' })`；然后点 `Place`；toast 含 `Added CO on top (Pt)`；
    结构名为 `Pt(111) p(3×3) 4L + 2CO`；`facet.structure.symbols` 末 4 项为 `C, C, O, O`。
12. `t = await facet.exportText('poscar')`：第 6、7 行记号为 `Pt C O` 与 `36 2 2`；第 8 行 `Selective dynamics`；40 个坐标行，前 18 行以 `F F F` 结尾，其余以 `T T T` 结尾；
    `facet.exportReport('poscar')` 为 `{ warnings: [], notes: [] }`。
13. `facet.exportText('extxyz')` 第 2 行含 `move_mask:L:1`，不含 `selective_dynamics`。
14. `facet.screenshot()` 与 `facet.screenshot({ markers: true })` 的像素差 > 0（标记默认不进 PNG）；截图 `sites`。
15. Ctrl+Z 三次：`project.structures.length === n0`，活动结构 4 原子。

**E2E-2 CONTCAR 往返（S14）**

1. `const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => facet.command('file.open'))]); await fc.setFiles('tests/data/surface/contcar_pt111.vasp')`。
2. 断言：`page.locator('dialog[open]')` 数为 0；toast 文本恰为 `Loaded contcar_pt111.vasp — 36 atoms`；`facet.structure.pbc` 为 `[true, true, true]`；
   每个原子的分数坐标与夹具差 ≤ 1e-12（夹具在 node 里用 `poscar_canon.mjs` 的解析函数读出）。
3. 显示：对两个 f_c = 0.99999 的原子，`facet.viewer.model` 中 `src` 指向它们的绘制副本的 z 都 < 0.01 Å（画在底层，不在顶部）；截图 `contcar`。
4. `canon(await facet.exportText('poscar')) === canon(fixtureText)`；`exportReport('poscar')` 为空。
5. Layers 第 2 行点击 → 选区卡片 `Fix` 的下拉 → `Fix z only`；Adsorbates `Find sites` 摘要 `9 site atoms (Pt) · 54 sites in 4 classes`；`CO` → 类 `top (Pt)` → `Place`；
   `facet.select([k])`（k = 不在 CO 下面的第一个顶层原子）→ 按 Delete。
6. 导出 POSCAR：物种 `Pt C O`、计数 `35 1 1`；标志序列为 18 × `F F F`、9 × `T T F`、8 × `T T T`、2 × `T T T`；前 18 个坐标行的规范形与夹具前 18 行相同；
   `exportReport('extxyz').warnings[0]` 以 `Extended XYZ stores these constraints as ASE FixCartesian masks` 开头。
7. Ctrl+Z 三次，`canon(exportText('poscar')) === canon(fixtureText)`。

**E2E-3 SrTiO3 终止面、对称 7 层与真空记忆（S9，加 S11 的四指数）**

1. 载入 STO 体相；Shift+5；`Plane` 填 `0 0 1`；`Termination` 的 `radiogroup` 有 2 项 `TiO2`、`SrO`。
2. 选 `TiO2`、勾 `Symmetric slab`、`Thickness` 7；`Vacuum` 为空且 `Create slab` disabled → 填 15；摘要含 `Sr3Ti4O11` 与 `excess TiO2` → `Create slab`；名称 `SrTiO3(001) TiO2-term 7L`，18 原子。
3. 回到体相（Projects 面板点体相条目）；Cleave 的 `Vacuum` 显示 `15`（会话内记忆，U4-b）；选 `SrO` → Create；名称 `SrTiO3(001) SrO-term 7L`，17 原子。
4. Layers：`Fix` 模式选 `middle`、数值 3 → `Apply`；`selective_dynamics` 中全 `false` 的 7 项。
5. Adsorbates › Placement：`Both sides` 可用。
6. `page.reload()`；载入 STO；Cleave 的 `Vacuum` 为 `''`；`Object.keys(localStorage)` 的值里没有出现 `"vacuum"`（U4-b）。
7. 用 `facet.command('surface.cleave', { … })` 不给 `vacuum`：抛出 `{ code: 'invalid-params' }`，`message` 含 `vacuum`（不区分大小写；账本 L-F0-52 的包装函数校验 `required: true`），项目不变（U4-c）。
8. 载入 ZnO（wurtzite，u 0.382）：`Plane` 显示 4 个框，第 3 个 `aria-readonly="true"`；粘贴 `1 0 0 0` 到第一个框 → `role=alert` 文本 `Plane: in (h k i l), i must be −(h + k) = -1.`；
   改为 h = 1、k = 0、l = 0 → `i` 显示 `-1`，读数行含 `of the current cell`。

**E2E-4 石墨烯（S13）**

1. 载入内置石墨烯（`pbc = [T, T, F]`）；Shift+5；Cleave 分区文本含 `this one is periodic along a and b only`（M2 v2 E2），有按钮 `Open Slab section`。
2. Slab：信息行含 `Vacuum gap 15.00 Å along c`；`Vacuum` 为空、`Apply` disabled；先填 0 → 就地错误含 `only possible when cleaving`、`Apply` 仍 disabled；改填 20 → `Apply`；toast 含 `Vacuum set to 20 Å`；
   `cell[2][2]` = 20 ± 1e-6；`pbc` 仍为 `[true, true, false]`；原子 z = 10 ± 1e-6。
3. Slab 分区点 `Surface supercell…` → `Structure › Cell › Supercell` 展开并获得焦点；`Matrix` 预设选 `(√3×√3)R30°` → `Create supercell`；6 原子；`|cell[0]|` = 4.2608 ± 1e-4；`pbc` 仍为 `[true, true, false]`。
4. Adsorbates：`Find sites` → `6 site atoms (C) · 18 sites in 3 classes`；`Element…` 填 `Li`；类 `hollow (C6)`；读数 `Li–C 2.04 Å · 1.46 Å above the site`；`Place` → 7 原子。
5. `exportReport('poscar').notes` 恰有 1 条，含 `POSCAR is always periodic` 与 `18.5 Å`；`warnings` 为空。

**E2E-5 界面（S15c、S15a）**

1. 载入石墨烯；Shift+5，展开 `Interface`；`Substrate`、`Overlayer` 都选它；`Max strain` 0；`Twist` 选 `Target`，填 21.8 与 0.5；等状态行（`aria-live`）出现 `2 matches`（≤ 10 s）。
2. 选第一项；`Interlayer distance` 选 `Custom`、填 3.35；`Vacuum` 为空时 `Create` disabled → 填 15 → `Create`；新结构 28 原子、`pbc` 全 `true`、`|cell[0]|` = 6.5085 ± 1e-4、`cell[2][2]` = 18.35 ± 1e-4。
3. 用命令建 Ni(111)：`facet.command('surface.cleave', { miller: [1, 1, 1], layers: 4, vacuum: 15, fixBottom: 2 })`（体相 Ni 3.52）；`Substrate` 选它、`Overlayer` 选石墨烯；
   `Max strain` 3、`Max area` 400、`Twist` `Any`；状态行出现 `561 matches · 8 best trade-offs`（≤ 15 s，软件 GL 不影响搜索）；第一项文本含 `6 atoms`。
4. 距离 `Custom` 2.10，`Vacuum` 15 → `Create`：6 原子；`exportText('poscar')` 含 `Selective dynamics` 与 2 个 `F F F` 行。

**E2E-6 性能（S16，`slow`）**

在页面里用 `performance.now()` 计时（不经界面，只测计算）：`facet.build.surface(bulkPt, { miller: [1, 1, 1], layers: 6, vacuum: 15, supercell: [[41, 0], [0, 41]] })` → 10 086 原子，≤ 120 ms；
`facet.analysis.layers(s)` ≤ 40 ms；`facet.analysis.sites(s)` ≤ 800 ms 且 `counts` = {top: 1681, bridge: 5043, hollow: 3362}；`facet.load(s)` 后
50 次交替 `facet.edit.fixLayers({ bottom: 2 })`/`({ bottom: 3 })` 每次 ≤ 120 ms、`app.history.bytes` ≤ 64 MiB（断言用 2× 预算，CI 再放宽到 3×）。

### 3.3 手动演示检查（每次发布前由人走一遍，截图入审查）

| 编号 | 内容 | 看什么 |
|---|---|---|
| MD-1 | S1 全流程 | Planes 预览中 (111) 切口平面与厚度框；层堆叠图；位点标记形状（top 球、bridge 棒、hollow 多边形）与颜色、悬停放大与 tooltip；幽灵 CO；固定光环蓝色；N 俯视 a 向右、Shift+N 看底面；按 G 后双击 CO、拖到 fcc 位：高度不变、松开后历史只多一步 `Move 2 atoms`（F0-A US1、M4 K4） |
| MD-2 | S5、S6 | 侧视时顶面朝上（F0-A §3.14.1）；(211) 台阶 4 重位的幽灵沿倾斜 35° 的局部法向；长桥跨槽 |
| MD-3 | S8 | 删桥氧后露出的 Ti；Atom Selection 卡片非模态、Esc 关卡片但保留选区；层表 `Group` 切换 |
| MD-4 | S14 | CONTCAR 画成一整块；悬停卡显示存储坐标与像；导入时完全没有提示 |
| MD-5 | S15 | 结果列表键盘导航与 120 ms 预览、搜索进度与 `Stop`、真空未填时的预览条 `Build layers — vacuum not set (shown with 10 Å)`、graphene/Cu 的 1×1 提示与 `Use it anyway` |
| MD-6 | S16 与窄屏 | 216 原子上一切操作无可感知延迟；390×844 视口：面板为底部抽屉、预览条、行高 ≥ 44 px；读屏播报摘要与预览开始/结束 |
| MD-7 | 命令面板 | 搜 `Cleave Surface`、`Build Vacuum Slab`、`Supercell`、`Redefine Lattice`、`Modify Constraints`、`Atom Selection`、`Add Adsorbate`、`Find Adsorption Sites`、`Build Layers` 都能找到并显示 MS 名称（F0-A US7） |
| MD-8 | 服务器模式 | `facet serve` 下重复 S1；`Client.surface`、`Client.add_adsorbate`、`Client.layers` 的结果与本地 API 相同；云模式下 `/analysis/*` 要登录、`/build/*` 公开 |

---

## 4. 缺口与冲突清单

"负责"指需要改规格或实现的模块；按 U6，由负责人裁决并在该模块的修订记录里注明。§4.1 是开发前仍要裁决的问题（含 v2 之间新出现的冲突），
§4.2 是 v1 时登记、已被 v2 规格或第 0 波账本解决的问题，留作核对记录。编号沿用，不重排。

### 4.1 仍未解决或新出现的问题

| ID | 类型 | 问题 | 涉及场景 | 建议的解决办法 | 负责 |
|---|---|---|---|---|---|
| G-11 | 缺陷 | POSCAR 写出：① frac→cart→frac 的舍入产生 `-0.0000000000000000`（Python `%20.16f`）/`-0.0000000000`（JS `toFixed(10)`），HEAD 往返夹具出现 3 处；② 末位噪声 `0.99999 → 0.9999899999999999`；③ 账本 L-F0-23 仍把速度块（O-5）列为"可选"：全零速度块被丢弃，非零速度块（MD 的 CONTCAR）也会丢 | S1、S14 | ① 写出前把 \|x\| < 0.5×10⁻ᵈ 的值写成 0（d 为写出的小数位）；② 接受，用 §S14 的规范形定义"内容逐字节等价"，夹具往返测试两种语言都比规范形；③ O-5 升为"应该"：非零速度块读入 `props.velocities` 并写回，丢弃时给一条导出说明 | F0-D |
| G-12 | 未覆盖（U4） | 现有 `build.crystal(…, vacuum=)` 与 CLI `build crystal --vacuum` 对二维原型是**每侧**真空（`c = thickness + 2·vacuum`，`build/crystal.py`），与 U4"真空一律指总间隙"相悖；账本只给 `Structure.center(vacuum)` 写明"每侧"（L-F0-07），默认参数任务（L-F0-29）没有处理这个参数 | S13 | 保留参数，帮助与 docstring 改为 "vacuum on each side (Å); the gap between periodic images is twice this"，并发 `DeprecationWarning` 指向 `set_vacuum`；或改成总间隙并写进 CHANGELOG。负责人二选一 | F0-D（L-F0-29 的任务），M7 写文档 |
| G-15 | 缺陷 | M5 原型在 TiO2(110) p(2×1) 氧空位 slab 上的位点**随面内原点变化**：32 种平移中一半 13 个桥、一半 15 个（多出 `short bridge (TiO)` 1.948 Å 与 `long bridge (TiO)` 3.487 Å）；理想 slab 在 25 种平移下都不变（`tio2_vac_check.py`、`shift_invariance.py`）。M5 v2 §3.4 仍用"该位点原子 Delaunay 边长的中位数"决定桥的保留，§7.2 `test_sites_invariance` 仍只用一般平移 | S8 | 桥的保留判据改用键图的近邻距离（不依赖剖分）；平铺与归属之前先把表面原子平移到规范原点；`test_sites_invariance` 增加 (0, ½)、(¼, ½)、(½, ½) 平移与空位用例；S8-7 的计数在修正后固化 | M5 |
| G-17 | 冲突（U4，剩 F0-A 部分） | M2 v2 已把 Slab 分区的 `Vacuum` 框改为空（§5.6）；F0-A US3 及其 e2e 第 3 条仍写"改真空时原子笛卡尔坐标不变"，而 `Position` 默认 `Centre`（U4"居中"）会移动原子 | S13、E2E-4 | F0-A US3 与其 e2e 改为"选 `Keep` 时笛卡尔坐标不变" | F0-A |
| G-18 | 冲突 | 两条"在表面上方放原子"的路径默认键长不同：M4 v2 `Transform › Add atom › Above selection` = 1.0 × Cordero 共价半径之和（`place_bond_factor`），M5 v2 = 库系数 × (r_A + r_eff)。O 在 Cu(100) 4 重位：M4 1.98 Å、M5 1.94 Å；H 在 Pt(111) fcc：M4 1.67 Å、M5 1.85 Å | S2、S13 | M4 对库里有的元素调用 M5 的目标距离函数（M5 §3.10.3），读数注明来源；或两边都显示 "f × (r_A + r_M)" | M4、M5（M7 核对） |
| G-19 | 未覆盖 | 规格写的是 Python 版端到端文件（M2 §9 T12 `tests/e2e/test_surface_e2e.py`、M1 v2 `tests/e2e/test_cell_tools.py`、M5 v2 §7.4 `tests/e2e/test_adsorbates.py`），环境里只有 Node 版 Playwright 1.63 与 `/opt/pw-browsers/chromium`，没有 Python `playwright`；以 root 运行需 `--no-sandbox`；账本没有端到端条目；可访问名称没有统一登记 | §3.2 | 按 §3.2 用 Node 版、pytest 包装、`slow` 标记；各模块 §5 的控件表（含 `aria-label`）是可访问名称的唯一来源，改名必须同时改 e2e | M7（与 F0-D 测试桥） |
| G-21 | 未覆盖（部分） | M6 v2 已写死锚原子（基底 z 最大、覆盖层 z 最小的非吸附物原子，并列取最小下标）、错位单位（基底 1×1 参考网格）、预设名（`Top`/`Bridge`/`fcc hollow`/`hcp hollow`，§3.8.3）与物理上不同的取向变体（§3.6.6）；但第二个 C 落在 fcc 还是 hcp 取决于所选变体，报告配位的状态行 `anchor C on top, second C on fcc hollow` 只是"应该"（M6-S1），`info.surface.interface` 也不记录配位 | S15a | 状态行升为"必须"，并在 `info.surface.interface.registry` 记录覆盖层最下层每个原子的配位（top/bridge/fcc/hcp）；验收按 S15a-3 只断言集合与锚 C | M6 |
| G-24 | 未覆盖 | M2 v2 的提示 `the surface cell is a 2 × 2 multiple …` 只对平方数面积比成立；NaCl(100)、fcc(100) 的面积比是 2 | S12 | 通用文案 `Using the input cell: the surface cell has 2 times the area of the smallest one`，能写 Wood 记号时附上 `(√2×√2)R45°` | M2 |
| G-25 | 未覆盖 | 位点摘要 `4 site atoms (Pt)` 在多元素表面上的写法未定义（M5 v2 §5.2 只给单元素例子） | S8–S12 | 用与类标签相同的组成写法，如 `4 site atoms (Ti2O2)` | M5 |
| G-28 | 未覆盖 | CLI 没有删除原子的命令（S8、S14 的删除只能用 Python）；M4 K8 的 `facet edit` 组是"应该" | S8、S14 | M7 决定是否提供 `facet edit delete FILE --atoms SPEC`；不提供就在文档里写 Python 写法 | M4、M7 |
| G-30 | 未定 | 体相名两种语言不同（Python `Pt fcc`，JS `Pt (Face-centred cubic)`；账本 L-F0-29：本期不动，M7 定），`info.surface.bulk.name` 与 Bulk 行因此不同 | C-9 | 跨语言比较暂时排除 `bulk.name`；M7 统一名字后恢复 | M7 |
| G-32 | 冲突（新） | 自动名哨兵的键名：M2 v2 §3.13、§4.2 写 `info.surface.autoName`（"唯一的自动名键"，并请 M5 改用它）；M1 v2 K5、§3.5.4 与 M5 v2 K10、§4.5、§10 用 `info.surface.name`，M5 v2 还写"v1 的 `baseName`、`autoName` 删除"——照字面实现，M5 放吸附物时会删掉 M2 写的哨兵；M6 v2 §4.1 仍提 M5 的 `baseName/autoName` | S1、S2、S3、S13、S15 | 只留一个键。建议 `info.surface.autoName`（M2 是 `info.surface` 的属主，v1 → v2 的迁移也落在它上面）：M1 §3.5.4、M5 K10/§4.5/§10、M6 §4.1 改名，M5 要删的只是 v1 自己的 `baseName`；`test_adsorbate_naming` 与 M1 T5 的命名金标用同一个键。裁决前验收只断言 `structure.name` | M2（裁决）、M1、M5、M6 |
| G-33 | 冲突（U4） | U4 写"允许 0"；M2 v2 K11、§3.14、Q10 让已有结构的 `set_vacuum(0)` 报 E12d（`a vacuum of 0 Å is only possible when cleaving …`），只有切面（以及 M6 构建界面）时 V = 0 有定义 | S12、S13、E2E-4 | 负责人按 U6 确认 M2 的决定，并在 M2 修订记录写明"U4 的'允许 0'指切面与界面构建；已有结构请用 V = 0 切面或 `oriented_cell`"；本文按现行 M2 v2（E12d）写期望 | M2（负责人确认） |
| G-34 | 措辞（新，次要） | M5 v2 K7 摘要写"只有系综原子两两成键（真实微面）……才启用"局部法向，§3.5 的算法写"hollow 所有边界边在 G 中相连"。按"两两成键"，4 重位（对角线 3.92 Å 不成键）会退回全局法向，Pt(211) 台阶 4 重位上的 O 只成 2 根键；按 §3.5 则 4 根都是 2.0459 Å（S6-6；M5 §7.2 `test_local_normal_class` 也这样断言） | S5、S6 | K7 的措辞改为"边界边成键"，以 §3.5 为准 | M5 |
| G-35 | 未定（新） | 吸附高度还会变：M5 v2 K9（有效半径）与新系数改了全部高度（与 v1 差 ≤ 0.1 Å），T13 还要再校准系数；其他规格与原型仍引用 v1 的数字（如 M4"键长默认 1.98 Å"） | S1–S7、S13 | 测试一律按 S1-6′ 的式子现算（f 从 `adsorbates.json` 读），不抄数字；T13 改系数时同时更新本文"当前库系数下"的数值；其他规格引用高度时注明"按 M5 §3.10" | M5（T13）、M7 |
| G-36 | 冲突（新） | 表面超胞的入口：M1 v2（文首范围、K15、§5.3）把同一个超胞编辑器**嵌入** `Surface › Slab › Surface supercell`；M2 v2 §5.6 写 `Surface supercell…` 是按钮，**打开** `Structure › Cell › Supercell` | S2、S3、S13、E2E-4 | 二选一。建议按 M2 v2（跳到 Cell › Supercell 并聚焦，与 U5-a"面内超胞在 Structure › Cell"一致），M1 的"嵌入"改为"Slab 分区放跳转按钮"；本文与 E2E-4 第 3 步按 M2 v2 写 | M1、M2 |
| G-37 | 冲突（新） | M6 v2 §4.1 合并吸附物记录时仍改写 `firstAtom`（`firstAtom ← firstAtom + N_基底超胞`），而 M5 v2 §4.4 已删除该字段、§10 也请 M6 别写；同段"M5 的 `baseName/autoName` 不复制"指的是 M5 v2 已没有的键 | S15 | 删去 `firstAtom` 的两处改写；"不复制"改为"不复制自动名哨兵（G-32 定的键），新结构的名字由 M6 §4.4 给出" | M6 |
| G-38 | 未覆盖（新） | `plan_adsorbates(count=)`、CLI `--count N`、REST `count` 的语义没有定义：是"本次新增 N 个"还是"该面总数达到 N"（M5 v2 §3.12.2 只写了 coverage 的 `need = target − N_ads`）；同一个调用 `count=1` 在 S1 里会给 1 个或 0 个新 CO | S1 | 定为"本次新增 N 个"，选位规则与 §3.12.2 相同（种子 = 已有吸附物，最远点，平局取位点序最小者），与 `coverage` 互斥，写进 §3.12.2 与 CLI 帮助。本文 S1 用 `coverage=0.22`，不受影响 | M5 |
| G-39 | 冲突（新） | c(2×2) 预设得到的名字：M1 v2 D13（§1.1 第 2 条、§3.5.4、§3.6.5）"从预设创建时用预设标签"，写 `Cu(100) c(2×2) 4L`（M2 自动名）/ `Cu(100) 4L c(2×2)`（通用规则）、toast `Made a c(2×2) supercell: 8 atoms`；M2 v2 §3.13 的 `surface_name` 只读 `info.supercellMatrix`，给 `Cu(100) (√2×√2)R45° 4L`（M2 §1 S2 的例子），而 M1 K5 规定 M2 自动名结构的新名由 M2 的处理器给出。同一操作从 Cleave 的 `Surface supercell` 与从 Cell › Supercell 因此可能得到不同的名字（违反 M2 K17） | S2 | 建议 M2 自动名一律用 `surface_name` 的计算标签（简报 C9 的范例 `(√2×√2)R45°`），预设标签只出现在读数与 toast 里（`Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms`）；或在 `info.surface.asBuilt` 记下预设标签供 `surface_name` 使用。两条路径的名字由同一个测试核对 | M1、M2 |

### 4.2 已被 v2 规格或账本解决（核对记录）

| ID | v1 时的问题 | 解决依据 | 验收里怎么体现 |
|---|---|---|---|
| G-1 | M2 v1 的 slab 与 `set_vacuum` 结果一律 `pbc = [T,T,F]` | M2 v2 K12、K15：slab `T T T`；`set_vacuum`/`add_vacuum`/`center_slab`/`flip_slab` 从不改 pbc（石墨烯仍 `T T F`） | C-2、S13-1、S14 |
| G-2 | 默认真空 15 Å（M2 v1、M6 v1 的函数默认值、REST、CLI、控件、`app.prefs`） | M2 v2 K11、M6 v2 §5.2/§6.1/§6.4：真空必填、无默认，界面框为空，会话记忆只用模块变量；账本 L-F0-52 命令参数 `vacuum` 为 `required: true`；`SURFACE_DEFAULTS` 没有 `vacuum` | U4-a…U4-c |
| G-3 | M2 v1 假设导入时已识别 slab、改了 pbc | M2 v2 §3.14 用 `surface_normal`/`find_surface_gap`（账本 L-F0-16、L-F0-17 采用 F0-A 的切口与签名），只有显式编辑才 `make_contiguous` | S14 |
| G-4 | M6 v1"可砍" | M6 v2 §2.1、§9：U3 不可砍，REST、CLI、Interface 分区都是"必须" | S15、U3 |
| G-5 | 命令 ID 与参数名不一致 | 账本 L-F0-52 的命令表（以账本为准）：`surface.cleave` 的参数是 `miller`（不是 F0-A US8 的 `hkl`）；没有 `surface.supercell`（用 `cell.supercell`）；`sites.find`、`adsorbate.add`、`tool.sitePick`、`build.layers` 等 ID 固定；标题句首大写，MS 名放 `aliases`。残留：M5 v2 §5.8 新增的 `sites.toggle`（Shift+S）与 `adsorbate.add` 的 Shift+A 由 M7 查键冲突 | E2E-3 第 7 步、E2E-5 第 3 步、MD-7 |
| G-6 | 两条面内超胞路径、两套预设与命名 | M2 v2 K17 与 M1 v2 K5、K15：一个实现（M1 `make_supercell`，相对 1×1 网格的 `wood_presets`）、一套命名机制。残留：哨兵键名 G-32、c(2×2) 的名字 G-39、入口形式 G-36 | S2、S3、S13 |
| G-7 | 原子顺序 | 账本 L-F0-23：`canonical_order` 只是"建议"。M2 v2 K12 按元素分块（POSCAR 顺序 = 内存顺序）；M6 v2 §10.1 明确不采用，保持"基底在前、覆盖层在后"，POSCAR 由写出器分块 | S1-8、S9、S14 断言内存顺序 = POSCAR 顺序；S15 断言基底在前 |
| G-8 | 默认厚度怎样解释"4 层" | M2 v2 K9：默认 4 层；不成整周期时给 H1/H2 提示与按钮（如 `Use 2 periods (6 layers)`），不自动改 | S1、S6、S8 |
| G-9 | 极性终止面的排序 | M2 v2 K7 的排序键：非极性 > 断键少 > 顶层阳离子电荷高 > 阴离子多 > 切口序号 | S8-2 |
| G-10 | `vacuum = 0` | M2 v2 K11：V = 0 = 体相堆垛，c = (L/m)·c₀，只允许整周期（E12b）；已有结构上的 0 见 G-33 | S12-4 |
| G-13 | 化合物表面三重位的名称 | M5 v2 K6：fcc/hcp 只用于金属密排三角，其余写 `hollow (X3) over Y` | S10、S11 |
| G-14 | fcc(110) 的微面三重位 | M5 v2 K4、§3.4：`auto` 补上金属、两两成键、近正三角形的微面三重位 | S5-3、S5-4′ |
| G-16 | M5 v1 原型 `place()` 用全局法向与二维外接圆心 | M5 v2 §3.4（三维外接圆心的平均）、§3.5（按类的局部法向）；v2 原型 `checks_place.py` 给台阶 4 重位 4 × Pt–O | S6-6、S6-7（`pt211_place.py` 的数值） |
| G-20 | 金标格式不统一 | 账本 L-F0-27：所有跨语言用例用 `facet.cases/1` 外壳，op 放各模块自己的 `tests/ops/<module>.py`、`tests/js/ops/<module>.mjs`，用例放 `tests/data/<area>/`，另有配方输入；M5 v2 §7.3、M6 v2 §7.2 的金标按此套外壳 | §3.1 |
| G-22 | 界面结果没有顶层 `info.surface`，名称未定 | M6 v2 §4.2：`info.surface.kind = "interface"` 与 `info.surface.interface`；§4.4 名称定稿 | S15b-3、S15c-3 |
| G-23 | 默认层间距（contact + Bondi）受质疑 | M6 v2 §3.9：默认 vdW 接触（Bondi，缺的元素用 Mantina），另有 Covalent contact、Bulk spacing、Custom，菜单写出控制距离的原子对 | S15 一律用 `Custom`；默认值由 M6 §7.6 的基准另行核对 |
| G-26 | `info.surface.adsorbates[].firstAtom` 在排序后失效 | M5 v2 §4.4 删除该字段（M6 v2 仍写它，见 G-37） | S1-8 |
| G-27 | 删原子或放吸附物后 `info.surface` 的组成等字段过期 | M2 v2 K19：生成时的数据移入 `asBuilt`，实时信息由 `slab_report` 给出 | S8-6 |
| G-29 | M2 v1 的 W1（"看起来已经是 slab"）写进 `info.warnings` | M2 v2 删除 W1 与 E3；Cleave 分区对 `T T F` 结构只给 E2 的就地文案（只看声明的 pbc） | S13 第 2 步、E2E-4 第 1 步 |
| G-31 | CONTCAR 夹具只有文字描述 | 账本 L-F0-27 把唯一夹具 `tests/data/surface/contcar_pt111.vasp` 列入 F0-D T0 的文件（36 原子、底 2 层 `F F F`、两个底层原子在 f = 0.99999、末尾有速度块）；内容按 §S14 的规则生成（`contcar_rt.py`：底层第 4、8 个原子 0.99999，其余底层 0，全零速度块，没有 `-0.000…`） | S14 |
