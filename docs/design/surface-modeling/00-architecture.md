# 表面建模：共用架构与约定（设计简报 v2）

## U. 用户已拍板的决定（2026-11-09，优先于本文件其他任何内容）

审查者和修订者：凡是规格与下面几条冲突的，一律按下面改，并在"修订记录"里注明"按用户决定 U1–U4 修改"。

- **U1（原 D3）导入时识别 slab：要做，但要无感。** 不弹提示，不改 pbc，不改导出的文件内容。
  只在内部提供真空间隙检测（建议签名 `find_vacuum_gap(structure, axis=None)` / `findVacuumGap(...)`：
  返回沿某晶轴贯穿整个晶胞的最大空隙的位置和宽度，没有则返回空），用于三件事：
  1. 显示：沿有真空间隙的轴，以间隙为切口来包裹原子、只在这个切口处不复制边界原子，
     使底层原子不再在真空顶部多画一份，跨晶胞边界的 slab 也不会被拆成两半；
  2. 层分析与吸附位点：用间隙判断哪边是上表面、哪边是下表面；
  3. slab 工具（改真空、重新居中等）。
  **slab 与非 slab 不做任何其他区分**：没有"slab 模式"、没有 slab 标记或徽章、没有不同的菜单或面板行为；
  需要真空间隙的工具对任何有间隙的结构都可用，没有间隙时给出说明。
- **U2（修订 C5）slab 的周期性。** Crystallume 生成的 slab（切面、界面、改真空）一律保持 `pbc = [true, true, true]`，
  与 VASP 和 Materials Studio 一致；仍采用标准取向：a 沿 x，c 垂直于表面且平行于 z，真空沿 c。
  现有的二维原型（石墨烯等，`pbc = [T, T, F]`）保持原样；导入的文件保留文件里声明的 pbc。
- **U3（原 D4）界面与异质结（M6）纳入本期**，作为第 4 波开发，不可砍；M6 规格必须与其他模块同样完整
  （包括界面、预览、API、测试、开发拆分）。
- **U4（原 D6）不设默认真空。** 界面里的真空输入框初始为空，填写前"创建"按钮不可用（允许填 0）；
  当前会话内可以保留用户自己上次填的值，但绝不预填。Python API 和 CLI 里，切面、界面构建和改真空的 `vacuum` 都是必填参数，
  没有默认值。真空一律指"slab 与下一个周期像之间的总间隙"（与 MS 一致；注意现有 `center(vacuum=)` 是单侧，
  新参数不能与它混淆，命名和文档要写清楚）。其余默认值照原推荐：4 层、六方表面网格夹角 120°、slab 居中。
- **U5 其余决定全部按推荐方案定案**：D1 新增 Surface 面板（Cleave / Slab / Layers / Adsorbates 分区）+ Structure 面板的 Cell 和 Transform 分区；
  D2 放吸附物原位修改 slab（配合 Duplicate）；D5 extxyz 写 ASE 的 `move_mask`，不再写 `selective_dynamics:L:3`（读取时两者都认）；
  D7 影响新功能的现有缺陷必须修，二面角符号和 JS/Python 默认参数差异也一并修。
- **U6 流程**：设计完成后直接进入开发，不再等待用户审核。开发阶段遇到规格没覆盖的问题，由负责人按本文件原则决定并记录。

---

本文件是所有模块设计者的共同依据。模块规格里引用本文件的条目时写编号，例如"按 C3""见 D1"。
事实来源是 `design/maps/` 下的 7 份调研报告（01 数据模型、02 网页编辑、03 视图、04 Python/服务器/CLI、
05 文件读写、06 Materials Studio、07 ASE/pymatgen 算法），引用代码时给出 `文件:行号`。

---

## 0. 目标与范围

**目标**：在 Crystallume 里打通催化和表界面研究最常用的建模闭环：
体相 → 切面（hkl）→ slab（层数、终止面、真空、表面超胞）→ 固定底层 → 放吸附物 → 导出 VASP 等可用的文件。
对标 Materials Studio 的 Build › Surfaces › Cleave Surface、Build › Crystals › Build Vacuum Slab、
Supercell / Redefine Lattice / Lattice Parameters、Modify › Constraints、Edit › Atom Selection、
测量/修改几何、Build Layers，以及 Adsorption Locator 里"把分子放到表面"这一步的手动版。

**模块（ID 固定，后续文档都用这些 ID）**

| ID | 名称 | 内容 |
|---|---|---|
| F0-D | 数据与读写地基 | props 不变量与统一 remap、修现有数据缺陷、约束与 tags 在 POSCAR/extxyz/JSON 中的读写、导出警告、slab 周期性、跨语言测试桥 |
| F0-A | 应用、视图与界面地基 | 编辑原语（原位编辑、预览会话、新增结构）、叠加层三层体系、工具钩子与拾取、高亮与可见性、沿任意方向观察、新输入控件、新面板外壳 |
| M1 | 晶胞与晶格工具 | 任意整数矩阵超胞、重定义晶格、晶胞参数编辑、应变、晶格约化、平移对称性求原胞、重定向、平移原点 |
| M2 | 切面与 slab | (hkl)/(hkil)、最小表面网格、层与终止面、厚度、对称 slab、真空、表面超胞、取向、来源信息、预览、已有 slab 的真空调整 |
| M3 | 层、几何选择与约束界面 | 层分析 API 与层列表、按层/坐标/球形区域选择、Atom Selection 查询、固定/放开原子、约束标记 |
| M4 | 原子操作 | 移动工具（拖动平移/旋转）、数值平移/旋转、设定键长/键角/二面角、添加原子、复制/剪切/粘贴、合并结构 |
| M5 | 吸附物 | 吸附物库、吸附位点识别、位点标记、放置（高度、取向、双齿）、覆盖度、标记与记录 |
| M6 | 界面与异质结 | Build Layers：两层叠加、晶格匹配、应变分配、层间距、错位与扭转、真空 |
| M7 | API、文档与测试总纲 | 汇总所有 Python/JS/REST/客户端/CLI 接口，统一命名与限额，文档，测试与验收场景（收尾阶段做） |

**不在本期范围**（但设计时要留接口）：对称性检测与标准化（spglib）、计算输入文件（INCAR/KPOINTS 等）、
结果分析（体数据、DOS 等）、溶剂层与无定形填充、纳米管。凡是"等价"判断（等价终止面、等价位点），
本期用几何指纹实现，接口要允许以后换成基于对称操作的版本。

---

## 1. 总原则

- **P1 两种语言等价。** 每个算法在 Python（numpy）和网页端 JavaScript（无依赖）各实现一份。原子顺序、
  晶胞取向、命名、取整和容差都在规格里写死，由跨语言测试保证一致。网页端一律在浏览器里计算，
  静态网页版（没有服务器）也必须可用（网页端不调用服务器的内置构建器，见 04 报告）。
- **P2 不加运行时依赖。** 不引入 scipy、spglib、ASE、pymatgen。开发时可以用 ASE/pymatgen 生成参考数据，
  但要固化成测试数据文件，测试运行时不依赖它们。ASE 是 LGPL，pymatgen 是 MIT：只借鉴算法，不复制代码。
- **P3 一个编辑一个撤销步骤。** 预览不进入历史，也不把项目标记为未保存。拖动从按下到松开算一步。
- **P4 生成新结构与原位编辑分开。** 切面和界面构建把结果作为**新结构**加入项目，原来的体相保留。
  矩阵超胞、晶胞参数、应变、真空、约束、移动原子、放吸附物都**原位修改**当前结构，可撤销
  （是否另存一份由用户用现有的 Duplicate 决定，见 D2）。
- **P5 只用 Float64 结构坐标计算。** 视图里绘制用的坐标是 Float32，并且经过了包裹和周期像（03 报告 §2.3），
  只能用 `src`/`img` 映射回结构原子，不能拿来算几何。
- **P6 功能处处可用。** 每个功能都提供：界面、命令面板命令、JS 公共 API（`window.crystallume`）、
  Python API；凡是有意义的，再加 REST 端点、客户端方法和 CLI。
- **P7 文案。** 应用界面用英文（与现有界面一致），文档沿用现有的简明英文风格；设计文档用中文，标识符用英文。

---

## 2. 数据约定

- **C1 坐标与矩阵。** 晶胞的行是晶格矢量，`cart = frac @ cell`。超胞矩阵 `P` 是整数，每一行是新晶格矢量在旧基下的坐标：
  `new_cell = P @ cell`，`f_new = f_old @ inv(P)`。形变 `F` 作用于行矢量：`cell' = cell @ Fᵀ`，应变 `F = I + ε`。
  长度单位 Å，角度单位度。对角矩阵超胞的原子顺序必须与现有 `repeat` 完全一致。
- **C2 逐原子属性（props）不变量**（05 报告 §6.4）：
  - I1 每个键的数组长度恒等于原子数（JS 目前不检查，F0-D 补上）；
  - I2 原子之间、结构之间不共享可变值（JS `clone()` 共享 props、Python `repeat` 共享嵌套列表，都是现有缺陷）；
  - I3 所有改变原子集合的操作都由**源映射** `src[j]`（新原子 j 来自旧原子 `src[j]`，新增原子为 null）
    加上**统一的 remap 函数**完成：Python `Structure._remap(src, defaults)`，JS `structure.remap(src)`；
    默认值表 `PROP_DEFAULTS` 两种语言各一份、内容相同。
  - 每个改变原子集合的函数都必须能给出源映射（供 props 重排，也供网页端 `replaceActiveStructure(..., {indexMap})`
    重映射选区和测量）。具体机制由 F0-D 定。
- **C3 约束。** `props.selective_dynamics`：N 个 `[bool, bool, bool]`，**True 表示沿晶格矢量 a/b/c 方向可动**
  （VASP 语义，与 ASE `move_mask`、pymatgen 的真值含义一致）。缺少该键 = 全部可动；条目从不为 null。
  从文件读入的全 T 数组保留（保证 SD 行往返不丢）；用户清除全部约束时删除该键。
  基变换规则：完全固定和完全可动在任何晶胞操作下都保持；部分约束只在"可动方向张成的空间能由新晶格矢量的子集张成"时保持，
  否则给出警告并按 F0-D 定的规则处理。面内变换 `[[m11, m12, 0], [m21, m22, 0], [0, 0, n]]`
  （√3×√3R30°、c(2×2)、p(2×1) 等）保持 `[T, T, F]` 和 `[F, F, T]`。
  界面上开关标为 a/b/c；当 a、b 在 xy 平面且 c ∥ z 时显示为 x/y/z。
- **C4 标签。** `props.tags`（整数），沿用 ASE 约定：1 = 顶层，2 = 次层……，0 = 吸附物或未标记。切面时写入层号（从顶层数起）；
  之后不自动重算（层由实时的层分析给出）。吸附物分组用另一个整数属性 `props.adsorbate_id`
  （0 = 不是吸附物，1…n = 第几个吸附物）。新增原子默认 `tags = 0`。
- **C5 slab 的周期性与取向（已按 U1、U2 修订）。** Crystallume 生成的 slab 保持 `pbc = [true, true, true]`，真空沿 c，
  c 垂直于表面且与 z 平行，a 沿 x（标准取向）。"pbc T T T 时底层原子在真空顶部多画一份"的显示问题（03 报告 §2.3）
  由内部的真空间隙检测在显示层解决（U1），不靠改 pbc。slab 与非 slab 不做其他区分。
- **C6 来源信息。** `info.surface`（JSON 对象）记录切面参数，至少包括：体相名称与化学式、`miller`（以及六方时的 `hkil`）、
  是否用了原胞、终止面（序号、标签、顶层与底层组成）、层数、厚度（Å）、真空（Å）、表面超胞矩阵、是否对称、
  层聚类容差、法向。矩阵超胞记录 `info.supercellMatrix`。extxyz 用 ASE 的 `_JSON` 形式写出这些嵌套值（05 报告 §6.3）。
  具体字段表由 M2 定，M5、M6 往里追加。
- **C7 空间群标签。** 凡是生成新结构、改变原子集合或改变晶格形状的操作（切面、非对角矩阵超胞、改晶胞角度、应变、
  增删原子、放吸附物、合并结构），一律清除 `info.spacegroup` 与 `info.spacegroupNumber`，统一调用
  `invalidate_symmetry_info(info)` / `invalidateSymmetryInfo(info)`。纯平移、包裹、刚性重定向和对角超胞保留。
- **C8 警告。** 统一用 `info.warnings`（字符串列表）。JS 现在写 `info.warning`（字符串），F0-D 统一，读取时兼容旧键。
- **C9 命名。** 新功能生成的结构名在两种语言里由同一规则产生，乘号统一用 `×`，Wood 记号用 Unicode，例如
  `Pt(111) p(3×3) 4L`、`SrTiO3(001) TiO2-term 7L`、`Cu(100) (√2×√2)R45°`。M2 给出完整规则。
- **C10 容差。** 位置比较不小于 1e-5 Å（存档数据只保留 1e-6 Å，01 报告 §0）。所有容差和默认值（层聚类容差、真空、
  层数、位点高度等）集中定义在每种语言的一个常量对象里（`SURFACE_DEFAULTS`），两种语言数值相同，由测试核对。
- **C11 多帧结构。** 改变原子集合或晶格的操作、以及移动原子，只作用于当前帧并丢弃其余帧；执行时用带 Undo 的提示说明。
- **C12 部分占位。** 保留 `props.occupancy` 并照常复制；切面等操作在结果的 `info.warnings` 里说明。

---

## 3. 代码布局与命名

| 内容 | Python | JavaScript |
|---|---|---|
| 精确整数运算（扩展 gcd、整数行列式、伴随矩阵、Hermite 标准形、超胞内的格点、平面内的格矢） | 新 `crystallume/core/intmath.py`（纯 Python int） | 新 `crystallume/web/js/core/intmath.js`（检查 `Number.isSafeInteger`） |
| 浮点晶格运算（倒格子、晶面法向与间距、hkl↔hkil、2D Gauss 约化、Niggli、LLL、带容差的分数坐标包裹） | 扩展 `crystallume/core/lattice.py` | 新 `crystallume/web/js/core/lattice.js`（重新导出 `util.js` 里的晶格函数） |
| 层分析 | 新 `crystallume/analysis/layers.py` | 新 `crystallume/web/js/core/layers.js` |
| 平移对称性、原胞、最小表面网格 | 新 `crystallume/analysis/translations.py` | 新 `crystallume/web/js/core/translations.js` |
| 吸附位点 | 新 `crystallume/analysis/sites.py` | 新 `crystallume/web/js/core/sites.js` |
| 生成器 | 新 `build/surface.py`、`build/adsorbate.py`、`build/interface.py` | 新 `web/js/build/surface.js`、`build/adsorbates.js`、`build/interface.js` |
| 不改变"是哪个结构"的编辑 | `core/structure.py` 的新方法 | `core/structure.js` 的新方法 |
| 网页编辑原语 | — | `web/js/app.js` |
| 叠加层、工具 | — | 新 `web/js/render/overlays.js`、`web/js/render/tools/`（如 `move.js`） |
| 输入控件 | — | 新 `web/js/ui/inputs.js`（并接入 `paramform.js`） |
| 新面板 | — | 新 `web/js/ui/panels/surface.js` |

- 命名：Python 用 snake_case，JS 用同一组词的 camelCase（`make_supercell` ↔ `makeSupercell`、`find_layers` ↔ `findLayers`）；
  有 ASE 名称的沿用 ASE（`make_supercell`、`set_cell(cell, scale_atoms=)`、`surface`、`add_adsorbate`、`add_vacuum`、`niggli_reduce`）。
  不要沿用旧的不对称命名（`append`/`addAtom` 等）。原位修改返回 `self`/`this`；生成新结构返回新对象。
- 共享数据（如吸附物库）尽量只保留一份：放在 `crystallume/web/data/*.json`，Python 用 `importlib.resources` 读取
  （包数据已包含 `web/**/*`），浏览器用 `fetch(new URL(..., import.meta.url))`，Node 测试里用 `fs` 读取。最终方案由 M5 定。
- 跨模块 API（先在此约定签名，实现归属见括号）：
  - `find_layers(structure, direction=None|"normal"|"a"|"b"|"c"|"x"|"y"|"z"|vector, tolerance=SURFACE_DEFAULTS.layer_tolerance)`
    → 每个原子的层号（0 = 最底层）、每层的高度、原子列表和组成；可选择从顶层计数（M3 实现，M2/M5 使用）。
  - `find_translations(structure, tolerance, axes=(0, 1, 2))` 与 `primitive_cell(structure, tolerance)` → 原胞、源映射和变换矩阵；
    限定面内两个方向时用于最小表面网格（M1 实现，M2 使用）。
  - `make_supercell(structure, P)`（2×2 面内矩阵可扩展为 3×3）与 `gauss_reduce_2d`、`niggli_reduce`（M1 实现，M2/M5/M6 使用）。
  - `set_vacuum` / `add_vacuum`（M2 实现）。

---

## 4. 网页端集成约定

- **编辑原语（F0-A 实现）：**
  - `app.editActive(label, fn, {indexMap})`：原位编辑，深拷贝快照，一次撤销；
  - `app.beginStructureEdit(label)` → `{preview(structure 或 positions), commit(), cancel()}`：拖动和实时预览用，预览期间不写历史、不标记未保存、不触发相机自动重新取景；
  - `app.addStructure(s, {replaceProject: false})`：保证不会替换整个项目（现在对未改动的启动示例调用会替换项目，切面会丢掉体相，02 报告）；
  - toast 上的 Undo 只撤销它自己那一步（现在撤销的是栈顶）；
  - 让 `structureKey` 能感知 props/info 的变化（现在不能，02 报告）。
- **不用模态框做表面工具。** 模态框的遮罩挡住 3D 视图，无法实时预览。表面工具放在侧边面板里，参数一变就预览：
  生成新结构的操作用"幽灵预览"或临时显示预览结构（`app.structure` 不变），面板里有明确的 Create/Cancel；
  原位操作用 `beginStructureEdit` 的 preview。模态框只用于确认和简短输入。
- **叠加层（F0-A 实现，03 报告 §5.2）：** A 层在场景内（需要深度：晶面预览、幽灵结构、固定原子光环、晶胞轮廓预览）；
  B 层在后期处理之后（不受描边/环境光遮蔽影响：拖动手柄、可点击的位点标记、悬停标记）；C 层是 2D 画布或 DOM（文字）。
  每层有导出策略：标记类叠加默认不进 PNG（可选包含），glTF 一律不含。提供合并拾取 `pick()`（返回命中距离，叠加物优先于其后的原子）、
  工具钩子（左键按下/移动/松开/取消；所有工具都保留右键旋转）、`ray()`/`pointOnPlane()`、逐原子可见性掩码、
  `viewer.setHighlight(name, indices, {color, grow})`，以及不会被主题色覆盖的新光环种类。
- **观察方向：** `viewAlong(vector | {uvw} | {hkl} | 'normal')`，建立在已有的 `setViewDirection` 上。
- **可用快捷键**（02 报告 §7）：D G H I J K N O S W、0、Shift+字母（F 除外）、Shift+5…9。不要把 Ctrl/⌘ C/V/X 注册为命令
  （会破坏粘贴导入；剪贴板用 copy/cut/paste 事件实现）；不要用 E、Q（按住型修饰键）和 Alt+字母（macOS 上失效）。
  预留：G = 移动工具，N = 沿表面法向看，Shift+5 = 新面板。其余由各模块提议，M7 汇总查冲突。
- **界面放置（推荐方案，见 D1）：**
  - 新增左侧面板 **Surface**（Shift+5），按工作流分区：**Cleave**（切面）· **Slab**（真空、表面超胞）· **Layers**（层列表、选择、固定）· **Adsorbates**（位点、吸附物、覆盖度）；
  - 通用晶胞工具（矩阵超胞、重定义晶格、晶胞参数、应变、约化、原胞）放在 Structure 面板新的 **Cell** 分区，因为体相同样要用；
  - 原子操作：工具栏的 Move 工具 + 选区卡片按钮（Fix/Free、Move…、Rotate…）+ Structure 面板新的 **Transform** 分区（数值输入）；
  - 命令面板里同时用 Materials Studio 的名字注册（Cleave Surface…、Build Vacuum Slab…、Supercell…、Redefine Lattice…、
    Lattice Parameters…、Modify Constraints…、Atom Selection…、Add Adsorbate…、Find Adsorption Sites），方便 MS 用户搜索。
- **输入控件（F0-A 实现）：** 三维矢量（笛卡尔/分数切换）、Miller 指数（六方晶胞自动显示 hkil）、整数 2×2/3×3 矩阵（显示行列式，带预设）、
  带单位的数值；校验样式在 `paramForm` 之外也能用；参数 schema 新增 `vector`、`miller`、`imatrix` 类型，与 Python/CLI 同步。
- 嵌入页可以带参数调用任意命令，所以命令参数必须校验（02 报告）。

---

## 5. API 约定

- REST：结构 → 结构放在 `/build/*`（云模式下公开），结构 → 数据放在 `/analysis/*`（需要登录）。科学代码的 ValueError → 400，
  schema 不符 → 422。服务器在构建前估算原子数，超过 `CRYSTALLUME_MAX_ATOMS` 就拒绝。每个端点都要有客户端方法
  （`tests/test_client.py` 的 `ROUTE_METHODS` 检查）。
- CLI（M7 统一）：例如 `crystallume build surface BULK --hkl 1 1 1 --layers 4 --vacuum 15 --supercell 3 3 -o POSCAR`、
  `crystallume transform`、`crystallume layers`、`crystallume sites`、`crystallume adsorb`。
- JS 公共 API：`crystallume.build.surface(...)`、`crystallume.build.adsorbates()`、`crystallume.analysis.layers(s?)`、
  `crystallume.analysis.sites(s?)`，以及走编辑原语、可撤销的 `crystallume.edit.*`（fix、free、translate、rotate、setCell、makeSupercell……）。
- 文档：README、`docs/PLUGINS.md`（JS/Python API、REST）、`docs/SCHEMA.md`（props、`info.surface`）、`docs/DEPLOY.md`（REST 表）、
  应用内帮助、快捷键对话框和导览。

---

## 6. 测试约定

- 采用 04 报告 §6 的跨语言测试桥（原型在 `scratchpad/python-api/parity/`）：`tests/js_bridge.py`、`tests/conftest.py` 里的 `js` fixture、
  `tests/test_js_parity.py`、`tests/js/*.test.mjs`（`node --test`），并加 `crystallume/web/js/package.json` = `{"type": "module"}`。
  没有 Node 时跳过；`CRYSTALLUME_REQUIRE_NODE=1` 时失败。
- 金标数据放在 `tests/data/surface/*.json`（输入、操作、参数、期望），两种语言都对照。期望值优先用解析解
  （层间距 d_hkl、面内格矢长度与夹角、每层原子数、面积），其次用开发时经 ASE/pymatgen 交叉核对后固化的数据。
- 端到端：用预装的 Chromium 和 Playwright 做少量冒烟测试（切面建 slab、固定底层、放吸附物、导出带 SD 的 POSCAR），
  标记为慢测试，可选运行；截图交给审查。
- 每个模块写出性能预算（例如浏览器里多少原子以内多少毫秒）。

---

## 7. 用户决策（全部已定案，见文首 U1–U6；以下保留原始选项供参考）

- **D1 界面放置**：新 Surface 面板 + Structure 面板的 Cell/Transform 分区（推荐） / 全部并入现有 Build 和 Structure 面板 / 仿 MS 的菜单加非模态浮动窗口。
- **D2 放吸附物**：原位修改 slab，配合 Duplicate（推荐） / 每次生成新结构。
- **D3 导入时识别 slab**：已决定，见 U1（无感、不改 pbc、不区分 slab 与非 slab）。
- **D4 界面模块 M6**：已决定，见 U3（本期第 4 波开发，不可砍）。
- **D5 extxyz 约束**：改写 ASE 的 `move_mask`，不再写 `selective_dynamics:L:3`（推荐） / 两者都写。
- **D6 默认值**：已决定，见 U4（不设默认真空；4 层、120°、居中）。
- **D7 现有缺陷**：影响新功能的（props 共享、addAtom、extend 填 null、warning 键、POSCAR SD、`structureKey`）必须修；
  二面角符号和 JS/Python 默认参数差异建议一并修。

---

## 8. 模块依赖

- F0-D、F0-A 是所有模块的前提（第 0 波）。
- M1 → M2（矩阵超胞、约化、原胞、`set_cell`）、M5（覆盖度用的超胞）、M6（面内矩阵）。
- M3 的 `find_layers` → M2（终止面）、M5（表面原子）。
- M2 → M5、M6；M4 → M5（放置复用移动/合并逻辑）。
- M7 汇总所有模块。

---

## 9. 模块规格模板（每个模块都按这个结构写，中文，标识符和界面文案用英文）

1. 用户故事与 Materials Studio 对照：MS 怎么做、我们怎么做、不同之处及理由。
2. 功能清单：分"必须 / 应该 / 可选"，每项写清行为细节和默认值。
3. 算法：伪代码、容差、复杂度、边界情况与失败时的报错文案。
4. 数据：读写哪些 props/info、源映射、命名、多帧与部分占位的处理。
5. 界面：位置、控件、默认值、英文文案、预览、撤销标签、快捷键、命令面板命令、右键菜单与选区卡片、触屏、无障碍、错误提示。
6. API：Python 签名、JS 签名、REST（请求/响应模型）、客户端方法、CLI。
7. 测试：单元测试、跨语言金标、端到端、性能预算。
8. 风险与开放问题（需要用户决定的标出来）。
9. 开发拆分：给开发团队的子任务清单（每项的输入、输出、依赖、涉及文件、规模估计、可否与其他子任务并行）。
