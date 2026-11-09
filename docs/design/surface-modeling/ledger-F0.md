# 第 0 波 API 账本：F0-D 数据与读写地基 · F0-A 应用、视图与界面地基（冻结版）

状态：**冻结**（2026-11-09）。开发按本账本实现。模块规格与本账本不一致时**以本账本为准**；本账本与简报文首的用户决定 U1–U6 不一致时以 U1–U6 为准。
本账本只裁决跨模块的名字、签名、语义、文件归属与任务归属；某一模块内部的算法细节，本账本没有写到的，按该模块规格执行。

## 0. 总则

### 0.1 依据与版本

| 文档 | 版本（读取时） | 说明 |
|---|---|---|
| `design/00-architecture.md` | v2，文首 U1–U6 | 约束一切 |
| `specs/F0-D.md` | **v2**（11:02 定稿） | 本账本的数据侧来源 |
| `specs/F0-A.md` | **v2**（11:10 定稿） | 本账本的界面侧来源；它的 §10.1"F0-D 需改"四处由本账本裁决 |
| `specs/M3.md` | **v2**（11:09） | 消费方 |
| `specs/M4.md` | **v2**（10:42） | 消费方 |
| `specs/M1.md`、`M2.md` | 先读 **v1**（09:45–09:47），定稿前复读 **v2**（M2 11:47、M1 11:51，含 §10） | 消费方；§6 按 v2 文本写 |
| `specs/M5.md`、`M6.md` | 先读 **v1**；定稿前复读正在写的 **v2**（M5 12:04 只有 §0–§7，M6 12:07 只有 §0–§5，二者都还没有 §10） | 消费方；§10 需求取自 v1，v2 已有章节中出现的新需求（M5 的 `exclude`、M6 的 `find_surface_gap` 用法）已并入；§6 按 v1 + v2 已有章节写 |
| `reviews/*`、`maps/01–07` | — | 联合不一致表取自 `reviews/F0-D-engineering.md` 第 2 条；缺陷取自报告与审查 |
| 仓库 | HEAD `1bb366f`（只读核对） | 所有 `文件:行号` 均为该版本 |

本账本新增的核对脚本在 `scratchpad/proto/xcheck/`（附录 A），均已运行。

### 0.2 条目格式

每条 `L-F0-nn`：**提供方**（模块与第 0 波任务）· **Python** · **JavaScript** · **语义**（输入、输出、错误与文案、单位、容差、默认值）· **文件** · **消费方**（谁用、做什么）· **已解决的冲突**（各规格用过的其他名字或语义，选了哪一个、为什么）。
标 **[改]** 的是本账本相对 F0-D v2 / F0-A v2 原文的改动或补充；没有标的照两份规格原文实现（引用节号）。

### 0.3 通用约定（适用于全部条目）

- **命名**：Python snake_case，JS 同一组词的 camelCase；常量两边同名大写（`PROP_DEFAULTS`）；`SURFACE_DEFAULTS` 的键 Python snake_case、JS camelCase（`vacuum_gap_min` ↔ `vacuumGapMin`，按"下划线后字母大写"机械互转，测试逐键核对）。
- **返回值**：原位修改返回 `self`/`this`；派生返回新对象；纯函数不改输入。Python 返回 `dict` 的结构体，JS 返回同键名（camelCase）的普通对象。
- **错误**：Python 用 `ValueError`（参数值）、`IndexError`（下标）、`TypeError`（类型）；JS 对应 `Error`、`RangeError`、`TypeError`。**文案两种语言逐字相同**，小写开头、无句末句号（报告 04 §3.4）；界面显示时首字母大写、加句号；REST 把 `ValueError` 映射为 400、schema 不符为 422（简报 §5）。网页界面专用文案（F0-A §5.12）句首大写带句号。
- **备注文案**（`info.warnings`）：小写开头、无句末句号、数字用阿拉伯数字、格式名用 `POSCAR`、`CIF`、`Extended XYZ`；与通道无关（不写只有网页才有的按钮名，F0-D §3.6）。
- **单位**：长度 Å，角度度，分数坐标无量纲；矩阵行是晶格矢量，`cart = frac @ cell`（C1）。
- **容差**：一律取自 `SURFACE_DEFAULTS`（L-F0-11），不得在模块里另写字面量；比较阈值时带容差（`x ≥ thr − position_tolerance`）。
- **帧**：Python 的 `frame` 参数缺省为 0；JS 缺省为当前帧 `structure.frame`（两边的既有约定，F0-D K10）。
- **"不改结构"的保证**（U1）：本账本中凡标"只读"的函数都不修改坐标、pbc、晶胞、props、info；只有显式编辑（列明的调用方）才移动原子。

### 0.4 文件归属与合并顺序（[改]：在两份规格 §9 的基础上补齐）

| 文件 | 第 0 波归属 | 之后追加者 |
|---|---|---|
| `crystallume/core/structure.py`、`web/js/core/structure.js` | F0-D T1 / T2 | M1、M2、M3、M4 追加方法（不改本账本冻结的签名） |
| `crystallume/core/constraints.py`、`web/js/core/constraints.js` | F0-D T3（**含** `move_flags`、`set_move_flags`、`clear_constraints`、`constraint_summary`、`axis_labels`、`cartesian_name`，见 L-F0-13） | 无 |
| `crystallume/core/defaults.py`、`web/js/core/defaults.js` | F0-D T7 建立（含 F0-A 的键） | 各模块在自己的任务里追加键，两份同时改 |
| `crystallume/analysis/vacuum.py`、`web/js/core/vacuum.js` | **F0-D T7 全部**（含 `surface_normal`，[改]：原属 F0-A T7a） | 无 |
| `crystallume/core/lattice.py`、`web/js/core/lattice.js` | F0-D T7 建立 → F0-A T7a 追加 | M1 追加 |
| `crystallume/analysis/geometry.py`、`web/js/core/geometry.js` | **F0-D T9**（二面角 + [改] 精确最小像） | M4 追加 `rotation_matrix`、`align_rotation`、`edit_frame` 等 |
| `web/js/core/bonds.js` | **F0-D T9**（[改] 只改第 96 行的像范围上限，L-F0-20） | M3 新建 `core/bondgraph.js`，不改本文件 |
| `crystallume/server/routes/build.py` | **F0-D T6**（[改] 只改 32-39、95 行的原子数估算）；F0-A T8（126-147 行，插件参数） | M1、M2、M5、M6 加路由 |
| `web/js/api/namespaces.js`（新） | **F0-A T2**（[改] L-F0-53） | 各模块调用 `defineApi`，不改 `api/public.js` |
| `web/js/render/display.js` | F0-A T5（含 [改] smart 键规则、外观面板一行修正） | 无 |
| `web/js/ui/overlays.js` | **F0-A T2**（toast 多动作；[改] F0-A 规格写的 `ui/toast.js` 不存在，toast 在 `ui/overlays.js:20`） | 无 |
| 其余 | 按 F0-D §9.3 与 F0-A §9 | — |

合并顺序（两份规格合并后）：F0-D T0 → T7 → T3 → T1 ∥ T2 → F0-A T7a → F0-A T5 → F0-A T4a → T4b → T7b → T6；F0-A T1 → T2 → T3a → T3b；T10 → T9；F0-A T8 在 T7a 之后；F0-D T4 ∥ T5 → T6 → T8；F0-D T9、T10 任意批次（`viewer.js` 与 F0-A 改不同行段，F0-A 先合）。
F0-D 合入前 F0-A 用的临时实现（F0-A §10.1 末）在 F0-D 合入的同一个合并请求里删除。

### 0.5 本账本的主要裁决（详见各条"已解决的冲突"）

| # | 冲突 | 裁决 |
|---|---|---|
| R1 | 切口：F0-D v2 `gap_cut(gap) → float`（中点映射到 (−0.5, 0.5]）、`unwrap_along_gap(f, gap)` vs F0-A v2 `gapCut(s, axis, {hint}) → GapCut`、`unwrapAlongGap(f, cut)` | 采用 **F0-A 的算法与签名**（L-F0-16）：F0-D 的规则会把整块 slab 画到晶胞外、把单层石墨烯画到晶胞顶面（F0-A §3.8.2 表）；U1 要求三种用途同一个切口 |
| R2 | `find_surface_gap`：F0-D（≥ 5 Å，否则 `info.surface.axis` 上任意宽度）vs F0-A（`surface_normal` 的 `cut`，提示须 ≥ 2 Å 且仍是最宽真空） | F0-A（L-F0-17）：过期提示不会把 1 Å 的面内"间隙"当成表面 |
| R3 | `surface_normal` 归属与 `require_gap`（M3 v2 要的参数） | 整个真空模块归 F0-D T7（避免 T7 与 F0-A T7a 互相依赖）；`surface_normal(..., require_gap=False)` 加关键字参数，另加函数 `require_gap(s)`（L-F0-17） |
| R4 | 真空模块的分数坐标包裹：F0-D `wrap_fractional`（1e-12 并截负）vs F0-A `wrap01`（1e-6，= 显示的现行规则） | 真空模块统一用 `wrap01`（`gap_wrap_eps = 1e-6`）；`Structure.wrap` 仍用 `wrap_fractional`（1e-12）。核对：F0-D 的 403 个间隙情形结果 0 处不同（附录 A） |
| R5 | 并列容差：F0-A 原型 1e-6 Å vs 规格正文 `positionTolerance` 1e-5 Å | 1e-5 Å（`position_tolerance`），阈值比较也带容差；F0-A 的 89 个金标情形 0 处不同（附录 A） |
| R6 | 约束读取函数：F0-D `get_move_mask()` vs M2/M3 `move_flags` | `move_flags`（晶格系标志叫 flags、笛卡尔叫 mask，与 `transform_move_flags`/`lattice_to_cartesian_mask` 一致）；`set_move_flags`、`clear_constraints` 恢复；`constraint_counts`、`constraint_axis_names` 不提供（由 `constraint_summary`、`axis_labels` 覆盖）（L-F0-13） |
| R7 | `axis_labels`/`cartesian_name` 归属：F0-D v2 说归 M3，M3 v2 说放进 F0-D | F0-D T3 实现（规则按 M3 v2 §3.12.3），`core/constraints` 只有一个归属任务 |
| R8 | 修改计数：`rev`（F0-D、F0-A、M1）vs `version`（工程审查、M2 v1、M3 v2） | `rev` + `touch()` |
| R9 | `editActive` 在克隆上运行（F0-D §10.1）vs 原位 + 事前快照（F0-A） | 原位（F0-A）；追踪器 `t = s.trackChanges(); fn(s); t.stop(s)` |
| R10 | `rebuild` 取值：M3 v1 `'props'` vs F0-A `'appearance'` | `'full' \| 'appearance' \| 'none'`；`'props'` 不接受（抛错） |
| R11 | 精确最小像：M4 v2 T1（第 2 波）实现 | [改] 提前到 **F0-D T9**（第 0 波）：现有 `get_distance(mic=True)` 在斜晶胞上错（附录 A 复现 9.99 Å 而非 2.77 Å），M3 的球形选择与 M4 同在第 2 波，不应互相等待；算法按 M4 v2 §3.2.2 并补上不依赖 M1 的约化（L-F0-20） |
| R12 | JS 写晶胞：F0-D 只给 `setPositions`，M1 打算直接改 `_base`/`_baseCell` | [改] 新增 `write_frame`/`writeFrame` 低层原语；`setPositions` 增加 `mark` 选项，使刚性重定向不误删空间群（L-F0-06） |
| R13 | M3 要 `registerHoverLine`、选区动作的 `items`/`rows`/`menu: 'blank'`、配色 `extras` | 悬停行用 F0-A 的 `registerAtomInfo`；其余三项 [改] 补进 F0-A T10/T4a（L-F0-50、L-F0-51） |
| R14 | `crystallume.edit.*` 等成员由各模块直接改 `api/public.js` | [改] `defineApi(path, fn)` 注册（L-F0-53），避免 7 个任务改同一个文件 |
| R15 | 网页 smart 键：只要有 C/H/O 就关掉所有金属–金属键（`render/display.js:16-21`） | [改] F0-A T5 改为按键判断的 smart 规则（与 M3 `bond_graph(metal_pairs="smart")` 同一定义，L-F0-55） |
| R16 | M5 v2 要 `gap_cut`/`surface_normal` 加 `exclude`，并建议显示也排除吸附物 | 分析函数加 `exclude=None`（L-F0-15–17）；**显示不排除**（保留 F0-A v2 已验证的漂浮分子规则；排除带 id 的吸附物会让拖进真空的分子在中点翻到 slab 下方，即 F0-A v1 的缺陷）。两者只在吸附物把真空挤到门槛以下且没有 `info.surface.axis` 提示时不同 |
| R17 | M1 v2 要 `_adopt(other)`；M2 v2 要 `make_contiguous(..., return_shifts=True)`；M1 v2 要 `vacuum_axis` 由 M1 追加到 F0-D 的文件 | `_adopt(other, *, src=None)` 归 F0-D T1/T2（L-F0-07）；整数平移由新的只读函数 `contiguous_shifts` 给出（返回类型不随参数变化，L-F0-18）；`vacuum_axis` 由 F0-D T7 提供（= `surface_normal(..., require_gap=True)` 的轴，L-F0-17），真空模块仍只有一个归属任务 |

---

## 1. F0-D 提供的条目（L-F0-01 … L-F0-29）

### L-F0-01 逐原子属性不变量与逐值复制

- **提供方**：F0-D T1（Python）、T2（JS）。**文件**：`crystallume/core/structure.py`、`crystallume/web/js/core/structure.js`。
- **Python**：`copy_value(v) -> Any`
- **JS**：`export function copyValue(v)`
- **语义**（F0-D §3.1，照原文）：
  - I1：构造器、`set_prop`/`setProp`、`_remap`/`remap` 严格检查每个键的长度，不符抛 `ValueError` / `RangeError`：`property 'x' has 5 values but there are 6 atoms`。
  - I2：`copy_value`：`None`/bool/数/字符串原样；元素全为标量的列表浅拷贝；其他（嵌套、dict）深拷贝（Python `copy.deepcopy`，JS `structuredClone`，不可用时 JSON 往返）。复制发生在 `set_prop`、构造器、remap、`copy`/`clone`、`toJSON`。JS 构造器复制传入的坐标与帧数组。
  - 反序列化修复（两种语言相同；备注写入 `info.warnings`）：非列表的 prop 删除 `property 'x' is not a per-atom list and was removed`；类型化数组转普通数组；长度不符时补默认值或截断 `property 'x' had 5 values for 6 atoms and was padded with defaults` / `… and was truncated`；附加帧行数不符时丢帧 `frame 3 has 35 positions for 36 atoms and was dropped`；第 0 帧行数不符报错 `invalid structure: positions must have 36 rows to match symbols (got 35)`。
- **消费方**：所有模块（任何读写 props 的代码）；F0-A 撤销快照（打包前读 props）；M3 的约束编辑（每次新建内层列表）。
- **已解决的冲突**：JS `clone()` 不再经 `toJSON`/`fromJSON`、不再取整到 1e-10、保持当前帧（F0-D §3.5.2）。

### L-F0-02 `PROP_DEFAULTS` 与按键规范化器

- **提供方**：F0-D T1/T2。**文件**：同上。
- **Python**：`PROP_DEFAULTS: Mapping[str, Any]`（`MappingProxyType`，序列值为元组）、`PROP_SYMBOL_DEFAULT: tuple[str, ...]`、`PROP_SHAPED_ZERO: tuple[str, ...]`、`RESULT_PROPS: tuple[str, ...]`、`default_for(key: str, symbol: str, column: list | None) -> Any`
- **JS**：`PROP_DEFAULTS`（深冻结）、`PROP_SYMBOL_DEFAULT`、`PROP_SHAPED_ZERO`、`RESULT_PROPS`、`defaultFor(key, symbol, column)`
- **语义**（F0-D §3.2，照原文）：

  | 键 | 新原子默认 | 规范化（构造、`set_prop`、`added_props` 生效） | 不合法时（合并为一条备注） |
  |---|---|---|---|
  | `selective_dynamics` | `[True, True, True]`（可动，C3） | 长度 3 的 bool/0/1/`FLAG_RE` 串，或单个值（= 三个相同）→ `[bool, bool, bool]` 新列表 | `[T,T,T]`，`selective_dynamics: 2 invalid value(s) were replaced by T T T (free)` |
  | `tags`、`adsorbate_id` | `0` | bool/整数/整数值浮点 → `int` | `0`，`tags: 1 invalid value(s) were replaced by 0` |
  | `occupancy` | `1.0` | 有限数 → `float` | `1.0`，同格式 |
  | `residue_names`/`residue`、`residue_ids`、`chain_ids` | `"MOL"`、`1`、`"A"` | — | — |
  | `labels`、`label`、`atom_names`（`PROP_SYMBOL_DEFAULT`） | 新原子的元素符号 | — | — |
  | `masses` | 元素标准原子量（`crystallume/data/elements.json`） | — | — |
  | `poscar_species` | 同元素第一个块的标签，无则元素符号 | — | — |
  | `momenta`、`velocities`、`initial_magmoms`、`initial_charges`（`PROP_SHAPED_ZERO`） | 与该列已有行同形状的 0 | — | — |
  | 其他键 | `None`/`null`（写出器视为缺失） | — | — |

  取值顺序（`default_for`）：调用方给的值 → 本次的 `defaults` 覆盖表 → 上表。`RESULT_PROPS = ("energies", "forces", "stresses", "charges", "magmoms", "born_effective_charges", "dipoles")` 不在默认表里（编辑后由 L-F0-10 删除）。
- **扩展规则**：新键只能由提出它的模块在**自己的任务里同时改两份源码表**，并加逐键相等测试；不允许运行时赋值。已知的追加：M6 `interface_layer: 0`。
- **消费方**：M2（`tags`）、M3（`selective_dynamics`）、M4（加原子、粘贴）、M5（`tags = 0`、`adsorbate_id`）、M6（`interface_layer`）。
- **已解决的冲突**：M6 v1 的 `PROP_DEFAULTS["interface_layer"] = 0`（运行时赋值）→ 改两份源码表；M5 v1 的"两边都没有的键不创建"与本条一致。

### L-F0-03 统一 remap 原语

- **提供方**：F0-D T1/T2。**文件**：同上。
- **Python**：
  ```python
  Structure._remap(self, src, *, symbols=None, new_symbols=None, positions=None, new_positions=None,
                   frames="keep", added_props=None, defaults=None) -> Structure      # 原位，返回 self
  ```
- **JS**：
  ```js
  remap(src, { symbols = null, newSymbols = null, positions = null, newPositions = null,
               frames = 'keep', addedProps = {}, defaults = null } = {}) → this
  ```
- **语义**（F0-D §3.3）：`src` 长度 m，元素为 `[0, n)` 的整数或 `-1`/`None`/`null`（新原子）。新原子的符号与坐标二选一：`new_symbols`/`new_positions`（只含新原子，按 −1 出现顺序，**推荐**）或 `symbols`/`positions`（完整 m 行）；`positions` 指第 0 帧。`frames`：`"keep"`（每帧按 `src` 取行，新原子在每帧用 `new_positions`）或显式列表（Python `[{"positions": (m,3) ndarray, "cell": ndarray | None}]`，JS `[{positions: Float64Array(3m), cell}]`；`[]` = 丢弃所有帧）。`added_props = {key: [新原子的值]}`；`defaults` 是本次的覆盖表。晶胞、pbc、info、name 不变；派生信息由调用方经 `mark_edited` 处理（L-F0-10）。组合 `source_map` 与追踪会话（L-F0-04）；JS 调用 `touch()`。
- **错误**：越界 `IndexError`/`RangeError` `source index 7 out of range (structure has 5 atoms)`；新原子缺符号或坐标 `ValueError` `new atoms need symbols and positions`；多帧且给了 `positions` 而 `frames == "keep"`：`remap: pass frames explicitly (or call keep_frame first) when the structure has several frames`。
- **复杂度/预算**：O(m·p)；JS 1 万原子 ≤ 15 ms，Python ≤ 80 ms（F0-D §7.6）。
- **消费方**：M1（`frames=[]`）、M2（切面结果）、M4（加原子、粘贴、删除）、M5（放吸附物）、M6（合并）。
- **已解决的冲突**：M4 v2 写 `_remap(src, defaults) -> None` → 返回 `self`；M6 v1 写 `defaults=PROP_DEFAULTS` → `defaults` 是覆盖表，`PROP_DEFAULTS` 总是生效，不必传；M1/M2/M5 v1 没有 `new_symbols`/`new_positions` → 可选参数，旧写法仍有效。

### L-F0-04 源映射与追踪会话

- **提供方**：F0-D T1/T2。**文件**：同上。
- **Python**：
  ```python
  Structure.source_map -> np.ndarray[int64] | None        # 只读属性
  Structure.track_changes(self) -> ChangeTracker
  class ChangeTracker:                                     # 也是上下文管理器，退出时 stop()
      def stop(self, result=None) -> np.ndarray | None     # 起点 → result（缺省为发起结构）的映射；result 不在会话中时 None
      src: np.ndarray | None                               # 最近一次 stop() 的结果
  Structure._set_source(self, parent, src) -> Structure    # 构建器从数组构造结果时声明谱系并接续 parent 的会话
  invert_source_map(src, n_old: int) -> np.ndarray[int64]  # 旧 → 新，−1 = 被删；一对多取第一个（(0,0,0) 像）
  compose_source_maps(first, second) -> np.ndarray[int64]
  ```
- **JS**：`get sourceMap() → Int32Array | null`；`trackChanges() → { stop(result = origin) → Int32Array | null, src }`；`setSource(parent, src) → this`；`invertSourceMap(src, nOld) → Int32Array`；`composeSourceMaps(first, second) → Int32Array`。
- **语义**（F0-D §3.4，K1/K2）：`source_map` = 自诞生以来的**累计**映射（构造、`from_dict`/`fromJSON`、`copy`/`clone`、`get_frame` 后为 `None`；派生时相对输入；之后每次 remap 组合）。不序列化、不进撤销快照。会话跟随派生结构。
- **错误**：`compose_source_maps` 不衔接：`source maps do not chain: the second map refers to atom 5 but the first has 3 entries`（`ValueError`/`RangeError`）。
- **消费方**：F0-A `editActive`（原位：`t = s.trackChanges(); fn(s); src = t.stop(s)`，L-F0-30）、`replaceActiveStructure(r, {src: r.sourceMap})`；M1/M2/M6 的构建器（`_set_source`）；M4、M5（编辑后选区与测量重映射）。
- **已解决的冲突**：F0-D §10.1 第 1 条要 `editActive` 在克隆上运行 `fn` → 采用 F0-A 的原位写法（R9）；因此 `stop(s)` 在 `editActive` 里永不为 `null`，F0-D 写的"拿不到映射时开发版抛错"只适用于 `replaceActiveStructure` 收到无谱系结构且未给 `indexMap` 的情形（见 L-F0-31）。v1 的"最近一次映射"语义作废。

### L-F0-05 修改计数 `rev` / `touch()`（数据侧）

- **提供方**：F0-D T2。**文件**：`web/js/core/structure.js`。Python 不需要（没有界面缓存）。
- **JS**：`Structure.prototype.rev: number`（构造时 0，不序列化、不进快照）；`touch() → this`（`rev++`）。
- **语义**（F0-D K13）：下列方法各调用一次 `touch()`：`remap`（因而 `deleteAtoms`、`addAtom`、`extend`、`sortBySpecies`、`select` 的结果构造）、`setProp`、`removeProp`、`setPositions`、`writeFrame`、`translate`、`wrap`、`setSymbols`、`setPbc`、`keepFrame`、`markEdited`、`makeContiguous`、`applyBasisChange`；M1–M6 新增的原位方法同样必须调用（经 `markEdited`、`writeFrame` 或直接 `touch()`）。直接给属性赋值不递增（文档写明，脚本改完调用 `crystallume.edit.touch()`，L-F0-34）。
- **消费方**：F0-A `structureKey`（L-F0-34）、真空模块的缓存（L-F0-16）、各面板签名；M3/M5 的缓存可用它作键。
- **已解决的冲突**：工程审查建议 `version`、M2 v1 写 `version++`、M3 v2 §10.1-8 写"名字统一为 `version`" → 一律 `rev` + `touch()`（R8；F0-D K13、F0-A A-D4、M1 已按此写，改动最少）。

### L-F0-06 帧与坐标写入（[改]：新增 `write_frame`/`writeFrame` 与 `mark` 选项）

- **提供方**：F0-D T1/T2。**文件**：同上。
- **Python**：
  ```python
  Structure.get_frame(self, index: int) -> Structure                       # 派生（恒等映射）；index ≠ 0 时对结果 mark_edited(new, "positions")
  Structure.keep_frame(self, index: int = 0) -> Structure                  # 原位：第 index 帧成为第 0 帧，丢弃其余帧；index ≠ 0 时 mark_edited(self, "positions")
  Structure.set_positions(self, positions, *, indices=None, frame=0, mark="positions") -> Structure
  Structure.write_frame(self, frame: int, *, positions=None, cell=...) -> Structure   # [改] 低层原语；cell 缺省为哨兵 ...（不变），None = 无晶胞（第 0 帧）或沿用基础晶胞（i > 0）
  ```
- **JS**：
  ```js
  getFrame(i) → Structure
  keepFrame(i = this.frame) → this
  setPositions(positions /* Float64Array(3n) | { indices, positions: Float64Array(3·len) } */, { frame = 'current', mark = 'positions' } = {}) → this
  writeFrame(frame /* 'current' | 整数 */, { positions /* Float64Array(3n)，省略=不变 */, cell /* 3×3 | null，省略=不变 */ } = {}) → this   // [改]
  ```
- **语义**：
  - `set_positions`/`setPositions`：写某帧全部或部分原子的笛卡尔坐标（Å）；保持 JS `positions`/`_base`/`frames[i]` 的别名关系（今天 `positions === _base` 只在第 0 帧成立，`structure.js:141-146`）。写完调用 `mark_edited(self, mark)`；`mark` ∈ `EDIT_KINDS` 或 `None`/`null`（不调用，只 `touch()`）。**[改]** `mark` 是新增选项：M1 的刚性重定向写坐标时传 `mark=None`，再调用 `mark_edited(s, "rotate", rotation=R)`，否则 `"positions"` 会误删空间群（C7）。
  - `write_frame`/`writeFrame`（**[改] 新增**）：只写数据、维护别名、`touch()`，**不调用** `mark_edited`。`frame = 0` 写结构的坐标与晶胞（JS `_base`/`_baseCell` 与当前别名）；`frame = i > 0` 写第 i 帧（`cell = None`/`null` 表示该帧沿用基础晶胞）。供 M1 的 `set_cell`/应变/约化、M2 的 `set_vacuum` 写晶胞（**不得直接改 `_base`、`_baseCell`、`frames[i]`**）。Python 侧等价于给 `positions`/`cell`/`frames[i-1]` 赋值，提供它是为了两种语言的调用代码一致。
- **错误**：帧号越界 `IndexError`/`RangeError` `frame 5 out of range (structure has 3 frames)`；坐标形状不符 `ValueError`/`RangeError` `set_positions: expected 36 rows of 3 coordinates, got 35`（`write_frame` 同格式）；`indices` 越界用 L-F0-07 的下标文案；非有限数 `positions must be finite numbers`；`mark` 非法用 L-F0-10 的文案。
- **消费方**：F0-A（P-pos 提交、`singleFrame`）；M1（`write_frame` + `mark_edited("cell" | "rotate")`）；M2（`set_vacuum`）；M4（移动原子，`mark="positions"`）；M5（C11 丢帧 `keepFrame`）。
- **已解决的冲突**：M4 v2 写 `keep_frame(self, i)`（无缺省）→ 缺省 0；M1 v1 打算直接改 `_base`/`_baseCell`（`M1.md:969`）→ `writeFrame`；F0-D 只有 `setPositions`、对晶胞没有原语 → 补 `writeFrame`（R12）。

### L-F0-07 改变原子集合与序列化的既有方法（改造）

- **提供方**：F0-D T1/T2。**文件**：同上。
- **签名与语义**（F0-D §3.5，照原文；表中只列跨模块会用到的契约）：

  | Python | JS | 契约 |
  |---|---|---|
  | `append(symbol, position, **props) -> Structure` | `addAtom(symbol, xyz, props = {}) → 新下标` | 经 remap；新原子 props 取默认值（不再是 `None`）；`mark_edited("atoms")`。M4 给 JS `addAtom` 加第 4 个参数 `{frac, adsorbate}`、Python 加 `add_atom(...)`，不改前三个参数 |
  | `extend(other, *, renumber_adsorbates=True) -> Structure` | `extend(other, { renumberAdsorbates = true } = {}) → this`（JS 新增） | 帧数相同则拼接，否则丢弃 self 的帧并写备注；`other` 的约束按两边晶胞换算（`transform_move_flags`，收紧时写备注）；`adsorbate_id` 重新编号；`mark_edited("atoms")`；`other` 不是 Structure 时 `TypeError` `extend expects a Structure` |
  | `delete(indices) -> Structure` | `deleteAtoms(indices) → this` | 下标为 `−n ≤ i < n` 的整数，否则 `IndexError`/`RangeError` `atom index 7 out of range (structure has 5 atoms)`（**行为变化**：今天越界取模）；重复只删一次；所有帧；删了原子则 `mark_edited("atoms")` |
  | `select(elements=None, indices=None, mask=None) -> Structure` | `select({ elements, indices, mask } = {}) → Structure`（JS 新增） | 条件取"与"；派生，`source_map` 相对 self；严格子集时 `mark_edited(new, "atoms")` |
  | `repeat(nx, ny=1, nz=1) -> Structure` | `repeat(nx, ny = 1, nz = 1) → Structure` | 计数须为 ≥ 1 的整数值，否则 `repeat counts must be whole numbers >= 1 (got 1.5)`；平铺**所有帧**（JS 改）；原子顺序：像序 i 最慢、k 最快、原原子在前（两语言相同，C1）；名字 `add_repeat_suffix`；写 `info.supercell`（旧键，覆盖）并维护 `info.supercellMatrix`（存在时左乘 `diag(nx,ny,nz)`，否则写 `diag`）；`mark_edited(new, "repeat")` |
  | `set_symbols(indices, symbol) -> Structure`（新） | `setSymbols(indices, symbol) → this` | 下标检查同 `delete`；`normalize_symbol`；`labels`/`label`/`atom_names` 同步为新符号；`mark_edited("symbols")` |
  | `sort_by_species(order=None) -> Structure`（新） | `sortBySpecies(order = null) → this` | `order` 须为元素符号序列，否则 `TypeError` `order must be a list of element symbols, e.g. ['Pt', 'C', 'O']`（JS 文案用双引号 `["Pt", "C", "O"]`）；所有帧一起重排；不调用 `mark_edited` |
  | `set_pbc(pbc) -> Structure`（新） | `setPbc(pbc) → this` | 只改 pbc，**不移动原子、不改晶胞**（U1/U2）；JS 规范化 `normalizePbc(pbc, hasCell)`（布尔 → 三份，长度 3 → 布尔，`null` → 按有无晶胞，其他 `TypeError` `pbc must be a boolean or three booleans`）；确有变化时 `mark_edited("pbc")`；**没有界面入口** |
  | `set_prop(key, values) -> Structure`（改：返回 self）、`remove_prop(key) -> Structure`（新） | `setProp(key, values) → this`、`removeProp(key) → this`（新） | 长度检查 + 规范化 + 逐值复制；不调用 `mark_edited` |
  | `copy() -> Structure` | `clone() → Structure` | 深拷贝；JS 保持当前帧、不取整；`source_map = None`；接续会话 |
  | `_adopt(other, *, src=None) -> Structure`（**[改] 新增**，M1 v2 请求） | `_adopt(other, { src = null } = {}) → this` | 把 `other` 的全部状态（symbols、positions、frames、cell、pbc、props、info、name、当前帧）搬进 self，**接管所有权、不复制**（调用后不得再用 `other`）；维护 JS 帧别名（`_base`/`_baseCell`）；映射 `S = src ?? other.source_map`（新 → self 的旧原子）按 `_remap(S)` 的规则组合进 self 的 `source_map` 与所有追踪会话，`S` 为 `None` 时视为无关结构（`source_map = None`，会话里 `stop()` 得 `None`）；不调用 `mark_edited`（由调用方按操作类型调用）；JS `touch()`。用于"纯函数算出新结构、原位写回"（M1 `cellops` 的薄方法、`editActive((s) => s._adopt(r))`） |
  | `from_dict(d)`、`to_dict()` | `Structure.fromJSON(o)`、`toJSON({ precision = 6, copy = true } = {})` | 反序列化修复（L-F0-01）；`normalize_warnings`；JS `fromJSON(Structure)` 返回副本；`toJSON({copy: false})` 仅供立即 `JSON.stringify` 的调用方 |
  | `wrap() -> Structure` | `wrap() → this` | 处理**所有帧**（JS 改），各帧用自己的晶胞；`wrap_fractional`（L-F0-19）；只沿周期轴；不调用 `mark_edited` |
  | `center(vacuum=None, axis=(0,1,2))` | — | 语义不变：**`vacuum` 是每侧的量**（U4 注明：与新 API 的"总间隙" `vacuum` 不同，文档写清）；改了晶胞长度时 `mark_edited("cell")` |
  | `translate(vector)` | `translate(v)` | 不变（全部原子、全部帧）；不调用 `mark_edited`。M4 在第 2 波加 `indices`/`frac`（给 `indices` 时必须 `mark_edited("positions")`） |

- **消费方**：M1（`repeat` 的 `supercellMatrix`、`select`、`_adopt`）、M2（`sort_by_species`、`select`）、M4（`append`/`addAtom`、`extend`、`delete`）、M5（`extend`、`sort_by_species`）、M6（`extend`、`concat_structures`）。
- **已解决的冲突**：M4 v2 说"F0-D 只改 Python `extend`、M4 新增 JS `extend`" → **F0-D T2 实现 JS `extend`**；M4 在第 2 波往两种语言的 `extend` 追加仅限关键字的放置参数（`offset`、`rotation`、`center`、`position`、`anchor`、`normal`、`orient`、`mic`、`frame`、`adsorbate`、`keep_props`），**必须保留** `renumber_adsorbates=True` 的缺省与语义。

### L-F0-08 合并 `concat_structures`

- **提供方**：F0-D T1/T2。**文件**：同上。
- **Python**：`concat_structures(parts, *, cell=None, pbc=None, defaults=None, renumber_adsorbates=True) -> Structure`
- **JS**：`concatStructures(parts, { cell = null, pbc = null, defaults = null, renumberAdsorbates = true } = {}) → Structure`
- **语义**（F0-D §3.5.3）：结果由 `parts[0].copy()` 派生（`source_map` 相对 `parts[0]`，接续它的会话）；晶胞与 pbc 取参数或 `parts[0]`；每个 part 的约束按 `transform_move_flags(part 晶胞或 I → cell 或 I)` 换算（只收紧，收紧时写 L-F0-13 的备注）；`adsorbate_id` 重新编号；一次 remap，`frames=[]`；任何 part 有多帧时写备注 `frames were dropped when the structures were combined`；info 取 `parts[0]` 的深拷贝；`mark_edited(result, "atoms")`。**第 p 个 part 在结果中占连续区间 `[offset_p, offset_p + len(parts[p]))`，`offset_p` 为前面各 part 原子数之和**（不另返回映射）。
- **错误**：`parts` 为空：`ValueError` `concat_structures needs at least one structure`；元素不是 Structure：`TypeError` `concat_structures expects Structure objects`。
- **消费方**：M4（合并结构）、M6（基底 + 覆盖层，`defaults={"interface_layer": …}` 或 `added_props`）。
- **已解决的冲突**：M6 v1 要求"返回各部分的源映射" → 用上面的连续区间规则代替（结果类型不随参数变化）；M6 的 `defaults=PROP_DEFAULTS` → 不必传。

### L-F0-09 备注 `info.warnings`

- **提供方**：F0-D T1/T2（函数）、T8（网页显示）。**文件**：`core/structure.py`、`core/structure.js`。
- **Python**：`add_warning(info: dict, msg: str) -> dict`、`get_warnings(info: dict) -> list[str]`、`new_warnings(before: list[str], after: list[str]) -> list[str]`、`normalize_warnings(info: dict) -> dict`
- **JS**：`addWarning(info, msg) → info`、`getWarnings(info) → string[]`、`newWarnings(before, after) → string[]`、`normalizeWarnings(info) → info`
- **语义**（F0-D §3.6，K7）：唯一规范键 `info.warnings`（字符串列表，插入顺序，去重）= 结构的**持久备注**。`add_warning` 忽略空串，`warnings` 不是列表时视为空。`get_warnings` 另追加旧键 `warning`（字符串）。`new_warnings` 返回 `after` 中不在 `before` 的项（保持顺序）。`normalize_warnings` 把旧键 `warning` **整条**并入后删除（`from_dict`/`fromJSON` 调用）。toast 只显示本步新增（L-F0-30、L-F0-32）；extxyz 不写 `warnings`；JSON 保存。保持原子身份的派生（`copy`、`repeat`、`select`、`get_frame`、`concat_structures`）继承备注；M2 切面、M6 界面从空备注开始。
- **消费方**：所有模块写数据注意事项（M1 收紧约束、M2 极性/部分占位、M5、M6 应变）；F0-A 的 toast；M3 Constraints 分区显示以 `selective dynamics:` 开头的条目。
- **已解决的冲突**：JS 现状 `info.warning`（字符串，`"; "` 连接）→ 迁移（C8）；M6 v1 写 `add_warning(...) -> None` → 返回 `info`。

### L-F0-10 编辑后的派生信息失效 `mark_edited`

- **提供方**：F0-D T1/T2。**文件**：`core/structure.py`、`core/structure.js`。
- **Python**：
  ```python
  SYMMETRY_INFO_KEYS = ("spacegroup", "spacegroupNumber", "formulaSum")
  RESULT_INFO = ("energy", "free_energy", "stress", "virial", "dipole", "magmom", "polarization", "dielectric_tensor")
  BUILD_INFO_KEYS = ("prototype", "a", "c", "u", "thickness")
  CARTESIAN_VECTOR_PROPS = ("velocities", "momenta", "initial_magmoms")
  EDIT_KINDS = ("order", "translate", "rotate", "positions", "atoms", "symbols", "repeat", "cell", "pbc")
  def invalidate_symmetry_info(info: dict) -> dict
  def invalidate_build_info(info: dict) -> dict
  def invalidate_results(structure) -> list[str]
  def rotate_vector_props(structure, rotation) -> Structure        # 行矢量 v' = v @ R.T
  def mark_edited(structure, kind: str, *, rotation=None) -> Structure
  ```
- **JS**：同名常量；`invalidateSymmetryInfo(info) → info`、`invalidateBuildInfo(info) → info`、`invalidateResults(s) → string[]`、`rotateVectorProps(s, R) → s`、`markEdited(s, kind, { rotation } = {}) → s`（另调用 `touch()`）。
- **语义**（F0-D §3.7 的表，两种语言同一张表，逐行测试）：

  | `kind` | 用于 | 空间群 | 计算结果 | 构建参数 | 其他 |
  |---|---|---|---|---|---|
  | `order` | 纯重排 | 保留 | 保留 | 保留 | 不必调用 |
  | `translate` | 整体平移、包裹、`make_contiguous`、不改晶胞的 `center` | 保留 | 保留 | 保留 | 不必调用 |
  | `rotate` | 原子与晶胞的刚性旋转（M1 重定向、M2 标准取向） | 保留（C7） | 删除 | 保留 | 给了 `rotation` 时 `rotate_vector_props` |
  | `positions` | 移动部分原子 | 删除 | 删除 | 保留 | — |
  | `atoms` | 增删原子、合并、放吸附物、粘贴 | 删除 | 删除 | 保留 | — |
  | `symbols` | 换元素 | 删除 | 删除 | 保留 | — |
  | `repeat` | 对角超胞 | 保留（C7） | 删除 | 保留 | — |
  | `cell` | 非对角超胞、`set_cell`、应变、晶胞参数、约化、原胞、重定义、改真空、`center(vacuum=)` | 删除 | 删除 | 删除 | 原子不动的基变换另调 `apply_basis_change`（L-F0-13） |
  | `pbc` | `set_pbc` 改变了 pbc | 保留 | 删除 | 保留 | — |

  `invalidate_results` 删了东西时写备注 `calculated results (energy, forces) were removed because the structure changed`（括号里列出被删的键，`RESULT_INFO` 在前）。改约束、tags、`adsorbate_id`、labels 不调用 `mark_edited`。
- **错误**：`kind` 不在 `EDIT_KINDS`：`ValueError`/`RangeError` `mark_edited: unknown kind 'foo' (use order, translate, rotate, positions, atoms, symbols, repeat, cell or pbc)`。
- **消费方**：M1（`cell`、`rotate`+`rotation`）、M2（新 slab 从新 info 开始；改真空 `cell`）、M4（`positions`、`atoms`）、M5（`atoms`）、M6（`concat_structures` 已调用）；F0-A 的 `deleteSelected`/`replaceSelected`（经 `deleteAtoms`/`setSymbols` 已调用，另显式调用 `invalidateSymmetryInfo` 以防 F0-D 合入前的临时实现）。
- **已解决的冲突**：M1/M4/M5/M6 v1 只请求 `invalidate_symmetry_info` → 统一入口 `mark_edited`（`invalidate_symmetry_info` 仍导出，简报 C7 的名字）；M6 v1 写返回 `None` → 返回 `info`；工程审查"对角超胞保留 forces"未采纳（F0-D 文末）。

### L-F0-11 常量对象 `SURFACE_DEFAULTS`

- **提供方**：F0-D T7 建立（含下表全部第 0 波的键）。**文件**：`crystallume/core/defaults.py`、`crystallume/web/js/core/defaults.js`。
- **Python**：
  ```python
  class Defaults(collections.abc.Mapping):            # 只读：d.key 与 d["key"] 都可用
      def __getattr__(self, key) -> float             # 未知键 AttributeError("SURFACE_DEFAULTS has no key 'x'")
      def __getitem__(self, key) -> float             # 未知键 KeyError('x')
      def __setattr__(self, key, value)               # 一律 AttributeError("SURFACE_DEFAULTS is read-only")
  SURFACE_DEFAULTS: Defaults
  ```
- **JS**：`export const SURFACE_DEFAULTS = Object.freeze({ … })`（camelCase）。
- **第 0 波的键**（[改]：F0-A 的三个键、`gap_wrap_eps` 与 `mic_tie` 一起在 T7 建立）：

  | Python | JS | 值 | 单位 | 用途 |
  |---|---|---|---|---|
  | `vacuum_gap_min` | `vacuumGapMin` | 5.0 | Å | U1 真空间隙门槛（不得设到 4.4 Å 以下：bcc Cs 原胞的 d110 = 4.34 Å） |
  | `surface_hint_gap_min` | `surfaceHintGapMin` | 2.0 | Å | 该轴是通过校验的 `info.surface.axis` 时的门槛 |
  | `block_gap_min` | `blockGapMin` | 3.5 | Å | 把一根轴上的原子分块的空隙下限 |
  | `small_block_fraction` | `smallBlockFraction` | 0.5 | — | 原子数 ≤ 主块此比例的块视为漂浮块 |
  | `gap_wrap_eps` | `gapWrapEps` | 1e-6 | 分数 | 真空模块的包裹：`w = f − floor(f)`，`w > 1 − eps` 时取 0（= `render/display.js:133-136` 的现行规则） |
  | `position_tolerance` | `positionTolerance` | 1e-5 | Å | 位置比较下限（C10）；间隙宽度、块范围、真空区的并列与阈值容差 |
  | `flag_tolerance` | `flagTolerance` | 1e-6 | 相对 | 约束基变换 `in_span` |
  | `overlap_distance` | `overlapDistance` | 0.5 | Å | 导出时的原子重叠检查 |
  | `mic_tie` | `micTie` | 1e-8 | Å | 最小像候选的并列容差（L-F0-20；原为 M4 的键） |

- **扩展规则**：其他模块在**自己的任务里**同时往两份源码表追加键（M2 `layers`…、M3 `layer_tolerance`、`bond_scale`、`bond_min`、`bond_max`…、M5、M6 `interface_*`），测试按命名规则逐键核对两份表。**没有 `vacuum` 键**（U4：真空没有默认值），测试断言两种语言都没有。
- **消费方**：所有模块；F0-A 显示、`surface_normal`；M3 层分析；M4 编辑坐标系。
- **已解决的冲突**：M3 要冻结 dataclass 属性访问、M2/M5 用下标访问 → 两者都支持；F0-A v1 的 JS 键 `vacuum_gap_min` → `vacuumGapMin`；M6 v1 的 `SURFACE_DEFAULTS.slab_min_gap` → 不新增，用 `vacuum_gap_min`；M2 v1 的 `SURFACE_DEFAULTS.vacuum`（`M2.md:952, 1010`）→ 不存在，`vacuum` 必填（U4）。

### L-F0-12 命名基础

- **提供方**：F0-D T1（Python）、T2（JS）。**文件**：`crystallume/core/naming.py`、`crystallume/web/js/core/naming.js`。
- **Python**：`TIMES = "×"`；`format_repeat(reps: Sequence[int]) -> str`；`add_repeat_suffix(name: str, reps: Sequence[int]) -> str`
- **JS**：`TIMES`、`formatRepeat(reps)`、`addRepeatSuffix(name, reps)`
- **语义**（F0-D §3.14）：`format_repeat((2,2,1)) → "2×2×1"`；`add_repeat_suffix`：全为 1 → 原名；Python 空名 → 空名；名字以 ` A×B×C`、旧 ` AxBxC` 或 JS 旧 ` (A×B×C)` 结尾（正则 `^(.*\S)\s+\(?(\d+)[x×](\d+)[x×](\d+)\)?$`，括号须成对）→ 逐项相乘后替换；否则追加 ` 2×2×1`。
- **消费方**：M1（追加 `rename_after_supercell`、`supercell_label`、Wood 记号）、M2（C9 的切面命名）、M5（`autoName`）、M6（界面名）。M1/M2 在这两个文件里**追加**函数。
- **已解决的冲突**：Python `repeat` 名字叠加成 `'Cu fcc 2x1x1 2x1x1'`、JS 用括号 → 统一（缺陷表 E-32）。

### L-F0-13 约束 `core/constraints`（[改]：读写函数与轴名规则并入 F0-D）

- **提供方**：F0-D T3（纯函数与轴名）、T1/T2（`Structure` 的两个薄方法）。**文件**：`crystallume/core/constraints.py`、`crystallume/web/js/core/constraints.js`（测试 `tests/test_constraints_core.py`、`tests/js/constraints-core.test.mjs`；M3 用 `tests/test_fix_free.py`）。
- **Python**：
  ```python
  MOVE_FLAGS_KEY = "selective_dynamics"
  FLAG_RE = re.compile(r"^\.?([TtFf])(?:rue|RUE|alse|ALSE)?\.?$")
  FLAG_TOL = SURFACE_DEFAULTS.flag_tolerance                         # 1e-6，相对
  def move_flags(structure) -> list[list[bool]]                      # [改] 副本；缺键时全 True
  def set_move_flags(structure, flags) -> Structure                  # [改] N 行 [bool]*3，经 set_prop 规范化（每行新列表）
  def clear_constraints(structure) -> Structure                      # [改] 删除键（"Free all"）；无键不报错
  def constraint_summary(structure) -> dict                          # {"fixed", "partial", "free", "byFlags", "present"}
  def transform_move_flags(flags, old_vectors, new_vectors, tol=FLAG_TOL) -> tuple[list[list[bool]], int]
  def lattice_to_cartesian_mask(flags, cell, tol=FLAG_TOL) -> tuple[list[list[bool]], int]
  def cartesian_to_lattice_flags(mask, cell, tol=FLAG_TOL) -> tuple[list[list[bool]], int]
  def apply_basis_change(structure, old_vectors, new_vectors) -> int  # 原位；返回收紧的原子数，> 0 时写备注
  def axis_labels(cell) -> list[str]                                 # [改] 如 ["a", "y", "z"]
  def cartesian_name(cell, flags) -> str | None                      # [改] "z" | "x, y" | "x, y, z" | None
  def next_adsorbate_id(structure) -> int                            # L-F0-14
  Structure.move_flags(self) -> list[list[bool]]                     # = move_flags(self)
  Structure.constraint_summary(self) -> dict                         # = constraint_summary(self)
  ```
- **JS**：`MOVE_FLAGS_KEY`、`FLAG_RE`、`FLAG_TOL`、`moveFlags(s) → boolean[][]`、`setMoveFlags(s, flags) → s`、`clearConstraints(s) → s`、`constraintSummary(s)`、`transformMoveFlags(flags, oldV, newV, tol) → { flags, tightened }`、`latticeToCartesianMask(flags, cell, tol) → { mask, tightened }`、`cartesianToLatticeFlags(mask, cell, tol) → { flags, tightened }`、`applyBasisChange(s, oldV, newV) → number`、`axisLabels(cell) → string[]`、`cartesianName(cell, flags) → string | null`、`nextAdsorbateId(s) → number`；`Structure.prototype.moveFlags()`、`constraintSummary()`。
- **语义**：
  - 存储（C3）：`props.selective_dynamics`，True = 沿晶格矢量 a/b/c 可动；缺键 = 全部可动；条目从不为 null；读入的全 T 数组保留；没有晶胞时三个标志指 x/y/z。
  - `constraint_summary`：`fixed` = 完全固定数，`partial` = 部分固定数，`free` = 完全可动数，`byFlags` = 每种出现过的模式（`"FFF"`、`"TTF"`……，按 a、b、c 顺序，含 `"TTT"`）的计数，键按（计数降序、模式升序）排列，`present` = 是否有键；无键时 `{fixed: 0, partial: 0, free: N, byFlags: {}, present: false}`。键名在 Python 中同样是 `byFlags`（JSON 风格）。
  - 基变换（K3，F0-D §3.8.3，照原文）：`S = span{a_k : f_k}`，`g_j = in_span(b_j, S)`；完全固定/完全可动总是精确；精确 ⇔ `count(g) == count(f)`；**只收紧不放松**；`in_span` 用夹角正弦/余弦公式，相对容差 `tol`；按 8 种模式缓存，O(N)。`lattice_to_cartesian_mask(f, cell) = transform_move_flags(f, cell 或 I, I)`；`cartesian_to_lattice_flags(m, cell) = transform_move_flags(m, I, cell 或 I)`。
  - `axis_labels(cell)`（规则按 M3 v2 §3.12.3）：对 k = 0, 1, 2，令"只固定 k 轴"的模式 `f_k`（第 k 个为 False、其余 True）；若 `lattice_to_cartesian_mask([f_k], cell)` 精确且结果恰好只有第 q 个为 False，则第 k 个标签为 `"xyz"[q]`，否则为 `"abc"[k]`。`cell is None` → `["x", "y", "z"]`。标准取向的六方 slab → `["a", "y", "z"]`。
  - `cartesian_name(cell, flags)`：`lattice_to_cartesian_mask([flags], cell)` 精确时返回被固定的笛卡尔轴名（按 x、y、z 顺序以 `", "` 连接），一个都没固定或不精确时 `None`。`[T,T,F]` → `"z"`、`[F,F,T]` → `"x, y"`、`[F,F,F]` → `"x, y, z"`（条件：Fix z only 需要 a、b ⊥ z，Fix x, y only 需要 c ∥ z）。
  - 收紧备注（`apply_basis_change`、`extend`、`concat_structures` 写）：`selective dynamics: the partial constraints of 4 atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`。
- **错误**：`set_move_flags` 行数不符 `ValueError`/`RangeError` `selective_dynamics needs one [bool, bool, bool] per atom (got 35 rows for 36 atoms)`；非法值按规范化器替换并写 L-F0-02 的备注；`new_vectors` 线性相关 `ValueError` `new cell vectors are linearly dependent`。
- **消费方**：M1（超胞、重定义、约化、原胞、`set_cell(scale_atoms=False)` 后 `apply_basis_change`）、M2（`move_flags`、改真空且改 c 方向时 `apply_basis_change`）、M3（`fix/free/fix_layers/fix_height/fixed_indices` 建在 `move_flags`/`set_move_flags`/`clear_constraints` 上；界面标签 `axis_labels`、文案 `cartesian_name`；`axes="z"` 等用 `cartesian_to_lattice_flags`）、M4（粘贴时换算）、M6（各层标志换算）、F0-D 的 extxyz 与导出检查。
- **已解决的冲突**（R6、R7）：F0-D v2 的 `get_move_mask()` → `move_flags()`（M2/M3 用的名字；晶格系叫 flags、笛卡尔叫 mask）；F0-D v2 删掉的 `set_move_flags`、`clear_constraints` 恢复（M3 v2 依赖）；M3 v2 要的 `constraint_counts` 不提供（`constraint_summary` 已含计数）；`constraint_axis_names` 不提供（"整体显示 x/y/z" = `axis_labels` 三项都是笛卡尔名）；`axis_labels`/`cartesian_name` 的归属：F0-D v2 说 M3、M3 v2 说 F0-D → F0-D T3；M3 v1 的 `cartesian_to_flags`（True = 固定）删除；M4 v1 的 `convert_constraints`、M6 v1 的 `transform_selective_dynamics(...) -> (list, list[str])` → `transform_move_flags`（返回收紧数，文案由 `apply_basis_change` 统一写）；M4 v1 的 `moveMask` → `moveFlags`。

### L-F0-14 `tags` 与 `adsorbate_id`

- **提供方**：F0-D T3（`next_adsorbate_id`）、T1/T2（重新编号）。**文件**：`core/constraints.py`、`core/constraints.js`。
- **Python**：`next_adsorbate_id(structure) -> int`。**JS**：`nextAdsorbateId(s) → number`。
- **语义**（C4，F0-D §3.9）：`props.tags` int，1 = 顶层、2 = 次层…、0 = 吸附物或未标记；`props.adsorbate_id` int，0 = 非吸附物，1…n。`next_adsorbate_id = max(adsorbate_id, default=0) + 1`。`extend`/`concat_structures` 在 `renumber_adsorbates` 为真时把后来者的非零 id 统一加上 `next_adsorbate_id(前者) − 1`。读写：extxyz `tags:I:1`、`adsorbate_id:I:1`；JSON 保留；POSCAR/CIF/PDB/XYZ 不存储且**不报警告**。
- **消费方**：M2（切面写 `tags`）、M3（层号、`promote_adsorbates`）、M4（粘贴、`adsorbate=True`）、M5（新吸附物 id）、M6（覆盖层偏移）、F0-A（按组包裹，L-F0-43）。
- **已解决的冲突**：无。

### L-F0-15 真空间隙基础：`axis_gaps`、`find_vacuum_gaps`、`find_vacuum_gap`（只读）

- **提供方**：F0-D T7。**文件**：`crystallume/analysis/vacuum.py`（加入 `crystallume.analysis.__all__`）、`crystallume/web/js/core/vacuum.js`（只从 `core/util.js`、`core/defaults.js` 导入，避免与 `core/lattice.js` 循环）。
- **Python**：
  ```python
  def axis_gaps(structure, axis: int, *, frame=None, exclude=None) -> dict | None      # [改] exclude：计算时忽略的原子（下标序列或长度 N 的布尔掩码）
      # {"axis", "height", "n", "w": ndarray（升序的包裹分数坐标）, "widths": ndarray（Å，第 t 个 = w[t] 之后的空隙）, "periodic"}
  def find_vacuum_gaps(structure, *, frame=None, periodic_only=True) -> list[dict | None]      # 三项，每轴最宽者，无阈值
  def find_vacuum_gap(structure, axis=None, *, min_width=None, frame=None, periodic_only=True) -> dict | None
  # VacuumGap = {"axis", "start", "end", "width", "center", "height", "periodic"}
  ```
- **JS**：`axisGaps(s, axis, { frame, exclude } = {})`、`findVacuumGaps(s, { frame, periodicOnly = true } = {})`、`findVacuumGap(s, axis = null, { minWidth, frame, periodicOnly = true } = {})`，返回同键对象（`w`、`widths` 为 `Float64Array`）。
- **语义**：
  - 帧：Python 缺省 0，JS 缺省当前帧；用该帧的坐标与晶胞（帧无晶胞时用基础晶胞）。
  - 基本量（**[改] R4**：整个真空模块只用这一种包裹）：`f_k` = 分数坐标第 k 列；`w = f − floor(f)`，`w > 1 − gap_wrap_eps` 时取 0；升序排序；`widths[t] = (w[t+1] − w[t])·h`（t < n−1），`widths[n−1] = (w[0] + 1 − w[n−1])·h`；`h = |det cell| / |a_i × a_j|`（i, j = k+1, k+2 循环）。无晶胞、无原子、`|det| < 1e-12` 或 `|a_i × a_j| ≤ 1e-12` → `None`。
  - `find_vacuum_gaps`：每轴取最宽空隙；宽度差 ≤ `position_tolerance` 视为并列，并列取 `start`（= `w[t]`）最小者；`periodic_only` 时非周期轴为 `None`。
  - `find_vacuum_gap`（F0-D §3.13.1，照原文）：`min_width` 缺省 `vacuum_gap_min`，`0` 表示总返回最宽；候选轴 `[axis]` 或 `[2, 1, 0]`；宽度 `< min_width − position_tolerance` 跳过；跨轴只在更宽（> `position_tolerance`）时替换，故并列时 c、b、a 先到者胜。
  - 字段：`start` = 间隙下方最后一个原子的 w（上表面），`end` = 间隙上方第一个原子的 w（下表面），`center = (start + width/(2h)) mod 1`，三者 ∈ [0, 1)；`end ≤ start` 表示跨过 f = 1；`width`、`height` 为 Å；`periodic = pbc[axis]`（**[改]** 附加字段，F0-A 的 D5 需要）。
- **错误**：`axis` 不是 0、1、2 或 `None`：`ValueError`/`RangeError` `axis must be 0, 1, 2 or None (got 3)`。
- **复杂度/预算**：每轴 O(n log n)；1 万原子三轴 JS ≤ 6 ms（含缓存，见 L-F0-16）。
- **消费方**：F0-D 导出说明 N2（`min_width=0, periodic_only=False`）与 CLI `info` 的 `Vacuum gap` 行；M2 改真空（量出当前间隙宽度）；M3 非 slab 轴的环形切口（`min_width=0` 取最宽间隙）；诊断。**判断"有没有表面、哪边是上表面、在哪里切开"一律不用本条，用 L-F0-16/17。**
- **已解决的冲突**：F0-D v1 的 `find_vacuum_gaps(s, frame=0)` 字段 `{gap, lower, upper}` → 本条字段；F0-D v2 的 `wrap_fractional` 包裹 → `gap_wrap_eps` 包裹（结果在 F0-D 的 403 个情形上 0 处不同，附录 A-2）；F0-A 原型的 `findVacuumGap` 并列规则（中心近晶胞面优先）→ 本条保留 F0-D 的"start 最小"（报告型函数）；切口用 L-F0-16 的规则（两者用途不同，各自写死）。

### L-F0-16 共用切口：`gap_cut`、`display_cuts`、`unwrap_along_gap`（只读，U1 的唯一切口）

- **提供方**：F0-D T7（算法按 F0-A §3.8.2；参考实现 `proto/f0a_v2/vacgap.mjs`/`vacgap.py`，金标 `tests/data/surface/gaps.json` 由 F0-A 提供并按本条重生成）。**文件**：同 L-F0-15。
- **Python**：
  ```python
  def gap_cut(structure, axis: int, *, frame=None, hint=False, exclude=None) -> dict | None
  # GapCut = 切口所在空隙的 VacuumGap 字段 {"axis", "start", "end", "width", "center", "height", "periodic"}
  #        + {"lo", "empty", "widest", "rule", "main": {"lower", "upper", "count"}, "blocks"}
  def display_cuts(structure, *, frame=None) -> list[dict | None]     # [改] 新增：显示与编辑坐标系用的三轴切口
  def unwrap_along_gap(frac, cut)                                      # float | ndarray → 同类型
  ```
- **JS**：`gapCut(s, axis, { frame, hint = false, exclude } = {}) → GapCut | null`、`displayCuts(s, { frame } = {}) → [GapCut | null ×3]`、`unwrapAlongGap(f, cut)`（`f` 为数 → 数；为数组/类型化数组 → 新 `Float64Array`）。
- **语义**（F0-A §3.8.2，**以下几点为准**）：
  - 记号：`G = axis_gaps(s, k)`；`center(t) = (w[t] + widths[t]/(2h)) mod 1`；`better(t, u)` = 若 `|widths[t] − widths[u]| > position_tolerance` 则宽者胜，否则中心离晶胞面更近者（`min(c, 1−c)` 更小且差 > 1e-9）胜，否则 `w[t] < w[u]` 者胜。
  - `split = {t : widths[t] ≥ block_gap_min}`。`|split| ≤ 1`：切在按 `better` 最宽的空隙，`empty = widths[tW]`，`rule = "widest"`。否则分块（块 b = 排序位置 `split[b]+1 … split[b+1]`，环绕）；主块 = 原子数最多（并列：范围更大且差 > `position_tolerance`；再并列：起点更小）；大块 = 主块或原子数 > `small_block_fraction` × 主块；相邻两个大块之间的"真空区"的 `empty` = 其中各 split 空隙宽度之和，候选切口 = 上方那个大块的下方空隙；取 `empty` 最大（差 > `position_tolerance`；并列按 `better` 比较候选空隙）；`rule = "below-main"`（只有一个大块）或 `"widest-between-big"`。
  - **[改] 阈值带容差**：`empty < (hint ? surface_hint_gap_min : vacuum_gap_min) − position_tolerance` → `None`。
  - 窗口：`c = center(cutT)`；`nA = #{w ≥ c}`、`nB = n − nA`；`lo = (nA < nB or (nA == nB and c ≥ 0.5)) ? c − 1 : c`；窗口 `[lo, lo + 1)`。`main.lower/upper` = 主块（只有一块时为全部原子）在窗口坐标中的最小/最大分数坐标，`main.count` = 其原子数；`blocks` = 块数（`|split| ≤ 1` 时为 1）；`widest` = 该轴最宽单个空隙（Å）。
  - `display_cuts`：`sn = surface_normal(s, frame=frame)`；`hint_axis = sn.axis if sn and sn.source == "info" else None`；对 k = 0, 1, 2：`pbc[k]` 为真时 `gap_cut(s, k, frame=frame, hint=(k == hint_axis))`，否则 `None`。**显示（F0-A `buildDisplayModel`）、M3 沿 slab 轴的层窗口、M4 `edit_frame`、`make_contiguous` 的缺省切口都必须用它**，不得各自重写提示轴逻辑。
  - `unwrap_along_gap(frac, cut)`：`cut` 为 `None`，或 `cut.periodic` 为假（非周期轴的切口只用于判断法向与上下表面）→ 原样返回；`cut` 为 GapCut → `lo = cut.lo`；`cut` 为数 → 直接作窗口起点 `lo`；返回 `frac − floor(frac − lo)` ∈ [lo, lo + 1)。
  - **[改] `exclude`**（R16，M5 v2 请求）：给出时这些原子不参与 `axis_gaps` 的排序与分块（`main.count`、`blocks` 也只数其余原子）；得到的窗口 `lo` 照样用于展开**全部**原子。`display_cuts` 没有 `exclude`：**显示总用全部原子**。
  - 缓存（JS）：`axisGaps`、`gapCut`、`displayCuts`、`surfaceNormal` 的结果按（结构对象、`rev`、帧）缓存（`WeakMap`），`rev` 变化即失效；给了 `exclude` 的调用不缓存；P-pos 预览期间显示冻结切口（F0-A §3.8.2）。Python 不缓存。
- **错误**：`unwrap_along_gap` 收到既无 `lo` 又不是数的对象（例如误传 VacuumGap）：`TypeError` `unwrap_along_gap: pass a cut from gap_cut() or find_surface_gap(), a window start, or None`；`axis` 非法同 L-F0-15。
- **复杂度/预算**：10k 原子三轴 ≤ 6 ms（JS，实测 5.1 ms）。
- **消费方**：F0-A 显示（L-F0-43）、P-ghost 幽灵包裹、`drawnCopies`；M2（`center_slab`、`set_vacuum` 经 `make_contiguous`）；M3（层窗口、上下表面）；M4（`edit_frame`）；M5（位点的上表面、放置面）。
- **已解决的冲突**（R1、R5）：F0-D v2 `gap_cut(gap) → float`、`unwrap_along_gap(f, gap)`（`cut = center` 映射到 (−0.5, 0.5]）→ 本条签名与算法（F0-D 的规则在 15 Å 真空 + 直立 CO 时把 slab 画到 21.79…28.58 Å、把单层石墨烯画到晶胞顶面，F0-A §3.8.2 表）；M3 v2 §3.3 与 M4 v2 §3.2.1 的"`find_vacuum_gap` 中点映射到 (−0.5, 0.5]"→ 改用 `display_cuts` 或 `surface_normal(...).cut`；原型的并列容差 1e-6 → 1e-5（F0-A 89 个情形 0 处不同，附录 A-3）；F0-A 原型字段 `cut` → `center`。

### L-F0-17 表面法向与"有没有表面"：`surface_normal`、`find_surface_gap`、`require_gap`、`vacuum_axis`、`vacuum_gap_hint`（只读）

- **提供方**：**F0-D T7**（[改] R3：原属 F0-A T7a；算法按 F0-A §3.14.2）。**文件**：同 L-F0-15；`web/js/core/lattice.js` 重新导出 `surfaceNormal`。
- **Python**：
  ```python
  def surface_normal(structure, *, frame=None, require_gap=False, exclude=None) -> dict | None
      # {"normal": [x, y, z], "axis": k, "source": "info" | "vacuum" | "pbc" | "ab-plane",
      #  "surface": bool, "vacuum_axes": [k, ...], "cut": GapCut | None}
  def find_surface_gap(structure, *, frame=None, exclude=None) -> dict | None   # = sn["cut"] if sn and sn["surface"] else None
  def require_gap(structure, *, frame=None, exclude=None) -> dict             # [改] 新增：返回 surface 为真的 surface_normal 结果，否则 ValueError
  def vacuum_axis(structure, *, frame=None, exclude=None) -> int | None       # [改] 新增（M1 v2 的定义）：surface 为真时的 axis，否则 None
  def vacuum_gap_hint(structure, *, frame=None, exclude=None) -> str | None
  ```
- **JS**：`surfaceNormal(s, { frame, requireGap = false, exclude } = {})`（键 `vacuumAxes`）、`findSurfaceGap(s, { frame, exclude } = {})`、`requireGap(s, { frame, exclude } = {})`（抛 `Error`）、`vacuumAxis(s, { frame, exclude } = {})`、`vacuumGapHint(s, { frame, exclude } = {})`。
- **语义**：
  - 没有晶胞或晶胞奇异 → `None`。`hint_axis = info.surface.axis`（0、1、2 的整数时，否则无）。`cuts[k] = gap_cut(s, k, hint=(k == hint_axis))`，k = 0, 1, 2（**周期与非周期轴都算**）；`vacuum_axes` = 有切口的轴。
  - 规则 1 `"info"`：`cuts[hint_axis]` 存在且其 `empty ≥ max_k empty − position_tolerance`（提示必须仍是最宽的真空，过期提示被拒绝）；规则 2 `"vacuum"`：按 c、b、a 顺序取 `empty` 最大者（只在更大 > 容差时替换）；规则 3 `"pbc"`：恰好一根非周期轴；规则 4 `"ab-plane"`：k = 2，`surface = False`。
  - `normal = unit(a_i × a_j)`，取 `normal · a_k > 0` 的方向（顶面 = +a_k 一侧，与 pymatgen 相同）。**不读 `info.surface.normal`**。
  - `surface = source in ("info", "pbc") or (source == "vacuum" and len(vacuum_axes) == 1)`；`cut = cuts[axis]`（`"pbc"` 且无间隙或 `"ab-plane"` 时为 `None`；`cut is None` 只发生在非周期轴或没有表面时）。
  - `require_gap=True`：`surface` 为假时返回 `None`（M3 的写法）。`vacuum_axis(s) = surface_normal(s, require_gap=True)["axis"]`（无表面为 `None`），M1/M2/M3 共用，**不得**另写规则。
  - `exclude`：传给每个 `gap_cut`（L-F0-16）；M5 传吸附物下标，使吸附物不占真空。
  - `require_gap(s)`：`surface_normal(s)` 为 `None` 或 `surface` 为假 → `ValueError(vacuum_gap_hint(s))`（JS `throw new Error(vacuumGapHint(s))`）；否则返回 `surface_normal(s)`。
  - `vacuum_gap_hint`（**[改]** 去掉 "periodic"，非周期轴上的真空也算，D5；新增多轴文案）：有表面 → `None`；没有晶胞 → `the structure has no unit cell, so it has no vacuum gap`；没有原子 → `the structure has no atoms, so it has no vacuum gap`；`len(vacuum_axes) ≥ 2` → `vacuum gaps along b and c: surface tools need a vacuum gap along one cell vector only`（轴名按 a、b、c 顺序，两项用 ` and `，三项 `a, b and c`）；否则 → `no vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first`（门槛取 `vacuum_gap_min`，以 `%g` 格式；"widest" 取三轴 `axis_gaps(s, k, exclude=exclude)` 的最宽空隙中最宽者（不论周期性），一位小数）。界面显示时首字母大写、加句号。
- **消费方**：F0-A `viewAlong('normal')`、N/Shift+N、`requireVacuumGap`、B11 表面坐标系、显示提示轴（经 `display_cuts`）；M1（双轴应变的默认平面、`keep_vacuum` 的真空轴）；M2（slab 工具的可用性、`set_vacuum` 的轴）；M3（`direction='auto'/'normal'`、上下表面、"固定底部 N 层"）；M4（`hasSurface`、`n_out`）；M5（放置面、位点）；M6（`detect_slab` 的替代）。REST/CLI 的工具在没有表面时报 `require_gap` 的文案（400）。
- **已解决的冲突**：F0-A v1 与 M1/M2 v1 的"规则 1 先读笛卡尔 `info.surface.normal`"→ 不读（转动、重定义后过期，F0-A D3/E3）；M3/M4 v1 的"非 slab 返回 null"→ 返回带 `surface` 的对象，判断看 `.surface` 或传 `require_gap=True`；M3 v2 要的 `require_gap` 参数 → 采纳，并另加同名函数（Python 的表面工具统一报同一句话）；M3 v2 的规则顺序"间隙 → 唯一非周期轴 → info"与本条的"经校验的 info → 间隙 → 非周期轴"在提示有效时结果相同，以本条为准；F0-D v2 的 `find_surface_gap`（提示轴上不设下限）→ 本条（R2）；M6 v1 的 `M2.detect_slab` 与 `{"isSlab": …}` → 不存在，用本条（U1：不做 slab 分类）。

### L-F0-18 显式编辑用的 `make_contiguous`

- **提供方**：F0-D T7。**文件**：同 L-F0-15。
- **Python**：`make_contiguous(structure, axis: int, *, cut=None, frame=None) -> int`（原位；返回被移动的原子数）；**[改]** `contiguous_shifts(structure, axis: int, *, cut=None, frame=None) -> np.ndarray[int64]`（只读：每个原子沿 `a_axis` 的整数平移，长度 N）
- **JS**：`makeContiguous(s, axis, { cut, frame } = {}) → number`；`contiguousShifts(s, axis, { cut, frame } = {}) → Int32Array`
- **语义**：`cut` 为 GapCut 或窗口起点（数），缺省为 `display_cuts(s, frame=frame)[axis]`（**[改]** 与显示同一切口；F0-D v2 用 `find_vacuum_gap(min_width=0)`）；`cut is None` 或 `pbc[axis]` 为假 → 返回 0、不移动。参考帧的 `f` = 分数坐标第 axis 列（**不包裹**的存储值）；`lo = cut.lo`（或该数）；`n0_i = −floor(f_i − lo)`；在 `m ∈ {0, −1, +1}` 中取使 `count(n0_i + m ≠ 0)` 最小者（并列按 0、−1、+1）；`shift_i = n0_i + m`；**每一帧**都加 `shift_i · a_axis`（同一组整数，轨迹不跳格）。只按整数个晶格矢量平移，周期结构物理上不变：不调用 `mark_edited`，JS `touch()`。**绝不在导入或显示时调用**（U1）。
- `contiguous_shifts` 用同一规则只算不改（`make_contiguous` 内部调用它）；`shift_i` 即 `editActive` 的 `imageShift(i)` 在 `axis` 分量上的值（其余分量 0）。
- **消费方**：M2 `center_slab`、`set_vacuum`（`imageShift = (i) => 第 axis 分量为 contiguous_shifts(...)[i] 的整数矢量`，测量保持指向同一对原子，F0-A §10.3）；M1 改真空轴矢量前（`set_cell(scale_atoms=False)`、Lattice parameters 的 Keep the vacuum gap）。
- **已解决的冲突**：M2 v1 的 `make_contiguous(structure, axis) -> int` 与 `set_pbc(..., contiguous=True)` → 前者保留（多了 `cut`、`frame`），后者不存在（U1/U2）；F0-D v2 与 M1/M2 v2 的 `gap=` 参数 → `cut=`（GapCut）；M2 v2 请求的 `return_shifts=True` → 另设 `contiguous_shifts`（返回类型不随参数变化，R17）。

### L-F0-19 分数坐标包裹与 `core/lattice` 的建立

- **提供方**：F0-D T7。**文件**：`crystallume/core/lattice.py`（追加）、`crystallume/web/js/core/lattice.js`（新建）。
- **Python**：`wrap_fractional(frac, pbc=(True, True, True), eps=1e-12) -> np.ndarray`
- **JS**：`wrapFractional(frac /* number[3] 或 Float64Array(3n) */, pbc = [true, true, true], eps = 1e-12) → 同形状的新数组`；`core/lattice.js` 重新导出 `core/util.js` 的 `cellFromParams`、`cellParams`、`fracToCart`、`cartToFrac`、`det3`、`inv3`。
- **语义**：只沿周期轴；`w = f − floor(f + eps)`，`w ≥ 1 − eps` 时取 0（Python `Structure.wrap` 的现行规则，`structure.py:515-531`；JS `wrap()` 改用它，容差从 1e-9 改为 1e-12）。**真空模块不用它**（L-F0-15 的 `gap_wrap_eps`）。
- **消费方**：`Structure.wrap`/`wrap()`；M1（"Wrap atoms into cell"、平移原点）；M3（`select_fractional`、`wrapped` 模式）；M6。F0-A T7a 与 M1 在 `core/lattice.*` 里追加函数（L-F0-46），不改上面的签名。
- **已解决的冲突**：M6 v1 `wrap_fractional(f, pbc, eps)` 一致；JS 现行 1e-9 → 1e-12。

### L-F0-20 精确最小像（[改] R11：从 M4 T1 提前到 F0-D T9）

- **提供方**：**F0-D T9**。**文件**：`crystallume/analysis/geometry.py`（替换 `minimum_image_vectors` 的实现，`:21-40`）、`crystallume/web/js/core/geometry.js`（新建，与二面角同文件）；`web/js/core/bonds.js:96`（像范围上限）。
- **Python**：
  ```python
  def mic_vector(v, cell, pbc, *, axes=None) -> tuple[np.ndarray, tuple[int, int, int]]   # 新：(最小像矢量, 加上的整数像)
  def minimum_image_vectors(vectors, cell, pbc, *, axes=None) -> np.ndarray               # 签名兼容（另加仅限关键字的 axes），逐行 = mic_vector
  ```
- **JS**：`export function micVector(v, cell, pbc, { axes = null } = {}) → { vector: [x, y, z], image: [ia, ib, ic] }`；`export function reduceBasis(A) → { B, U }`（供测试与 `findPeriodicNeighbors`）。
- **语义**（M4 v2 §3.2.2 的规则 + [改] 不依赖 M1 的约化）：
  ```text
  P = (axes ?? {0,1,2}) ∩ {k : pbc[k]}；P 为空 → (v, (0,0,0))
  A = [cell[k] for k in P]（m×3）；coords(x) = solve(A Aᵀ, A x)                  # x 在 span(P) 上正交投影的系数
  g = coords(v)；n0_k = −floor(g_k + 0.5)                                          # 两种语言都用 floor(x + 0.5)
  v0 = v + n0 @ A；R = |coords(v0) @ A|
  h_k = a_k 到 span{a_j : j ∈ P, j ≠ k} 的距离（m=3：V/|a_i×a_j|；m=2：|a_k×a_j|/|a_j|；m=1：|a_k|）
  m_k = ceil((R + mic_tie)/h_k + 0.5)                                              # 由 |(g+n)_k|·h_k ≤ |w| ≤ R 得到，保证不漏
  若 ∏(2 m_k + 1) > 125：B, U = reduce_basis(A)（逐对尺寸约化到不动点，至多 100 轮，q = floor(x + 0.5)，只在长度严格变短 1e-12 以上时替换），
      在 B 中对 v0 重做取整与界（R_B、h_B、m_k），候选 w = v0 + n @ B，原基中的像 = n0 + n @ U        # 约化只影响速度，不影响结果
  否则候选 w = v0 + n @ A，n_k ∈ [−m_k, m_k]
  L* = min |w|；并列 = {|w| ≤ L* + mic_tie}；取 key 字典序最小者，key_k = round(1e6·(g + 像)_k)       # 原基中的有效坐标
  返回 (w, 像)（像在非 P 轴上为 0）
  ```
  `Structure._vector`（`core/structure.py:481-487`，即 `get_distance/get_angle/get_dihedral(mic=True)`）与 `distance_matrix`（`geometry.py:77`）改用新实现。`mic=True` 的含义仍是"所有周期轴上的最小像"（ASE 语义）；"不跨真空"的编辑坐标系属 M4（`edit_frame`，用 `display_cuts`）。
  **JS `findPeriodicNeighbors` 的修正**（同一任务）：`bonds.js:96` 的 `Math.min(4, Math.ceil(m))` 改为 `Math.ceil(m)`；若 `∏(2·reach_k + 1) > 9261`（与 Python `MAX_IMAGES` 相同），先 `reduceBasis` 周期矢量，在约化基里搜索，偏移按 `offset = offset_red @ U` 换回原基（结果与不约化时相同）。
- **错误**：周期矢量线性相关 `ValueError`/`Error` `mic_vector: the periodic cell vectors are linearly dependent`；`v` 不是 3 个有限数 `TypeError` `mic_vector: v must be three finite numbers`。
- **复杂度**：约化后通常 9 或 27 个候选；1 万个矢量 Python 向量化 ≤ 10 ms（M4 `perf2.py` 4.7 ms）。
- **消费方**：现有 `get_distance(mic=True)` 等（修正）；M3 球形选择与 `distance` 查询；M4 `vdiff`、`set_distance/angle/dihedral(mic=True)`、复制载荷；M5 冲突检查与选区拼块；M6 面内接触距离（`axes=(0, 1)`）；JS 显示的键、配位、多面体（`findPeriodicNeighbors`）。
- **已解决的冲突**：M4 v2 T1 实现 → F0-D T9（M4 T1 直接使用，不再实现）；M4 v2 的约化依赖 M1 `gauss_reduce_2d`/`niggli_reduce`（第 1 波）→ 本条自带确定性的逐对约化（只影响速度）；ASE 只在"每个结果都短于最短晶胞长的一半"时才用取整法，Crystallume 现行实现不检查这一条（报告 07 第 13 条）。

### L-F0-21 二面角

- **提供方**：F0-D T9。**文件**：`web/js/core/geometry.js`、`crystallume/analysis/geometry.py`。
- **JS**：`dihedralFromVectors(b0, b1, b2) → number`（[0, 360)，IUPAC 符号，公式与 Python 逐项相同）、`signedAngle(deg) → number`（映射到 (−180, 180]）。
- **Python**：`dihedral_from_vectors(b0, b1, b2) -> float`（不变）；**[改]** 新增 `signed_angle(deg: float) -> float`（两种语言对称）。
- **语义**：`b0 = r_j − r_i`、`b1 = r_k − r_j`、`b2 = r_l − r_k`；查看器测量列表（`render/viewer.js:1949-1961` 的 `measureValue`）与选区卡片（`ui/selectioncard.js:54-64` 的 `geometryValue`）显示 `signedAngle(dihedralFromVectors(...))`，一位小数加 `°`。网页上的二面角符号因此翻转（更正）。
- **消费方**：F0-A 的测量数值（L-F0-44）；M4 "设定二面角"（不再另写 `dihedralDeg`）。
- **已解决的冲突**：JS 现行公式恰为 IUPAC 的相反数（两份审查独立核对）→ 改 JS。

### L-F0-22 元素半径

- **提供方**：F0-D T9。**文件**：`crystallume/data/elements.json`（加 `bondiRadius`）、`crystallume/core/elements.py`、`crystallume/web/js/core/elements.js`。
- **Python**：`covalent_radius(symbol) -> float`（**未知元素与 `X` 回退 0.5 Å**，原为 1.5）；`bondi_radius(symbol) -> float | None`（新）。
- **JS**：`element(sym).rcov`、`element(sym).rbondi`（新列，无值为 `null`）；**[改]** 薄函数 `covalentRadius(sym) → number`、`bondiRadius(sym) → number | null`（与 Python 同名，消费方不必知道表的列名）。
- **语义**：共价半径 H–Cm 两边本来相同，Bk–Lr 的 7 个值 JS 改用 `elements.json`；Bondi（1964，Mantina 等 2009 补主族元素）。**新算法只用共价半径或 Bondi 半径**；Python `vdw_radius`（Alvarez 2013）与 JS 显示半径 `rvdw` 有 21 个元素不同，各自用途不变，**不供算法使用**。
- **消费方**：M4/M5 的重叠与吸附高度、M6 层间距默认值（`bondi_radius`）、M3 键图（共价半径）。
- **已解决的冲突**：M6 v1 要两种语言一致的 `vdw_radius` → 用 `bondi_radius`（K16）。Python 的 `METALS`/`ANIONS` 不属于 F0：由 M2 T2（第 1 波）追加到 `crystallume/core/elements.py`，内容与 JS `core/elements.js:160-166` 逐项相同（测试核对）；M3、M4、M5 都从那里导入，M4 **不得**在 `analysis/fragments.py` 另定义一份（M2 v2 §10.1）。

### L-F0-23 POSCAR 读写与原子顺序

- **提供方**：F0-D T4（读写）、T1/T2（`poscar_order`、`canonical_order`、`sort_by_species`）。**文件**：`crystallume/io/poscar.py`、`web/js/io/poscar.js`、`core/structure.py`、`core/structure.js`。
- **Python**：`read_poscar(text: str) -> Structure`（多帧 XDATCAR 返回带帧的结构）；`write_poscar(structure, *, order="species") -> str`（`order="keep"` 为可选项 O-4）；`poscar_order(symbols, order=None, blocks=None) -> list[int]`；`canonical_order(symbols, layers=None, blocks=None) -> list[int]`。
- **JS**：`readPOSCAR(text, filename = '')`；`writePOSCAR(s, { order = 'species' } = {})`；`poscarOrder(symbols, order = null, blocks = null)`；`canonicalOrder(symbols, layers = null, blocks = null)`。
- **语义**（F0-D §3.10，照原文）：
  - SD 标志：`FLAG_RE` 容错（`T F t f .T. .F. TRUE FALSE .TRUE. …`，拒绝 `Ti`、`Fe`、`Si`）；附加词少于 3 个 = 没有标志 → `[T,T,T]`；非法词 → T；行内 `!`/`#` 起为注释；第 4 个起的词忽略（pymatgen 的元素名）。所有问题合并为一条备注 `selective dynamics: 4 line(s) had missing or unreadable T/F flags (first: line 14, 'Si'); those directions were read as T (free)`（首个问题为缺失时括号内写 `no flags`）。**Cartesian 模式下标志仍是晶格系**（VASP wiki），读取不换算。全 T 也保留。
  - 写出：Python 第 0 帧、JS 当前帧；按 `poscar_order(symbols, blocks=props.poscar_species)` 分块；`selective_dynamics` 键存在即写 `Selective dynamics` 行（不再要求每项都是 3 元列表）；Direct 坐标不包裹；数字格式各自维持现状。无晶胞：Python 照旧装箱（每侧 10 Å）并给 W3，JS 照旧抛 `POSCAR needs a unit cell…`（O-2 可选改为装箱）。
  - 重复元素块：物种行规范化后有重复时写 `props.poscar_species`（原始词互不相同时用原始词，否则 `H`、`H#2`……）；分块与写出按它；物种行写元素符号。
  - XDATCAR：JS 帧循环读每帧自己的晶格头并按该帧晶胞换算（今天用第一帧晶胞，坐标错）；Python 新增读取（S-4），文件名注册加 `xdatcar`。
  - `poscar_order`：块按首次出现排序（给 `order` 时先按 `order`）；块内稳定。`canonical_order`：稳定排序，键 = （块的首次出现名次，`layers[i]`），`layers` 为 M3 `find_layers` 的整数层号（0 = 最底层）。
  - 速度块（O-5，可选）：读入 `props.velocities`（Cartesian Å/fs），写回。
- **消费方**：M2/M6（**建议**按 `canonical_order` 生成，K14）、M5（放置前已按元素分块时追加后 `sort_by_species()`）；F0-D 导出说明 N1。
- **已解决的冲突**：M2 v1 K12 的"按层从下到上"→ 建议改为 `canonical_order`（不改正确性，只少一条 N1 说明）；JS 读取器丢 SD、写出器不写 SD、Python `.TRUE.` 读成固定（缺陷表 E-15、E-16）。

### L-F0-24 extxyz 读写

- **提供方**：F0-D T5。**文件**：`crystallume/io/xyz.py`、`web/js/io/xyz.js`。
- **Python**：`kv_tokenize(line: str) -> list[tuple[str, str | None]]`、`convert_value(raw: str | None) -> Any`、`format_info_value(key: str, value) -> str | None`（`None` = 跳过）、`extxyz_columns(structure) -> tuple[list, list[tuple[str, str]]]`（列、跳过的 `(key, reason)`）、`read_xyz(text) -> list[Structure]`（不变）、`write_extxyz(structure, *, constraints="exact") -> str`（`"fix-partial"` 为可选项 O-3）。
- **JS**：`kvTokenize(line)`、`convertValue(raw)`、`formatInfoValue(key, value)`、`extxyzColumns(s) → { columns, skipped }`、`readXYZ(text, filename = '')`、`writeXYZ(s, { extended = true, constraints = 'exact' } = {})`。旧的 `parseKeyValues` 删除（被 `kvTokenize` 取代）。
- **语义**（F0-D §3.11，照原文）：词法与 ASE `key_val_str_to_dict` 相同（引号、`{}`、`[]`、反斜杠转义）；`convert_value` 只认 ASCII 正则（不得用 `int()`/`float()` 试转；`inf`/`nan` 保留为字符串；|整数| > 2^53−1 按浮点；`_JSON ` 前缀解码失败时保留原串并写备注 `info 'surface': could not decode the _JSON value; kept as text`）；保留任意宽度与类型的列（JS 删掉只留宽度 1 R/I 的过滤）；`charge` 列读成 `charges`；`name` 一律字符串，JS 不再把 `config_type` 当名字。约束列：读 `move_mask`（宽度 1 → `[b,b,b]`；宽度 3 → `cartesian_to_lattice_flags`，收紧写备注 `move_mask: the Cartesian constraints of 2 atom(s) do not follow the cell vectors and were tightened`；其他宽度忽略并写 `move_mask must have 1 or 3 columns; it was ignored`；同时有旧 `selective_dynamics` 列时写 `both move_mask and selective_dynamics columns were found; move_mask was used`），旧 `selective_dynamics:L:3` 照常读；写 `move_mask:L:1`（能写宽度 1 就写 1）或 `L:3`，全部可动时不写，**不再写 `selective_dynamics`**（D5/U5）。info 写法与 ASE 互通（K15：`stress`/`virial` 9 个数，一维数值/布尔列表空格分隔，读回会变类型的字符串写成 `_JSON "…"`，嵌套与字典用 `_JSON`，转义反斜杠）；跳过 `format`、`filename`、`source`、`warnings`。多帧：结果类 props/info 只写第 1 帧（W9）。剪贴板键 `crystallume_clip=<id>` 按普通字符串往返。
- **消费方**：M2/M5/M6（`info.surface`、`info.interface` 等嵌套值经 `_JSON` 往返）、M3（`move_mask` 读写的约束语义）、M4（剪贴板）、F0-D 导出检查 W5/W6/W8/W9。
- **已解决的冲突**：v1 的 `stress="_JSON [...]"` 让 ASE 打不开文件 → K15；宽度 3 经 ASE 写 POSCAR 丢约束 → W6 警告与可选 `fix-partial`。

### L-F0-25 写出器能力表与导出检查（含 REST、客户端、CLI、网页通道）

- **提供方**：F0-D T6（库、服务器、客户端、CLI、JS 契约）、T8（网页 toast 与对话框）。**文件**：`crystallume/io/capabilities.py`（新）、`crystallume/io/__init__.py`、`web/js/io/capabilities.js`（新）、`web/js/io/index.js`、`web/js/api/extensions.js`、`server/models.py`、`server/routes/io.py`、`client.py`、`cli.py`。
- **Python**：
  ```python
  WRITER_CAPABILITIES: Mapping[str, dict]               # 下表
  def validate_capabilities(name: str, caps: dict) -> dict
  class ExportWarning(UserWarning)                      # crystallume.io 导出
  def export_report(structure, format: str, *, frame: int | None = None) -> dict    # {"warnings": [...], "notes": [...]}
  def export_warnings(structure, format: str, *, frame=None) -> list[str]
  def export_notes(structure, format: str, *, frame=None) -> list[str]
  def register_writer(name, func, extensions=(), description="", *, mimetype="text/plain", source="builtin", capabilities=None)
  def write(dest, structure, format=None) -> None       # 写完对每条警告 warnings.warn(msg, ExportWarning, stacklevel=2)；说明不发
  def to_text(structure, format) -> str                 # 不变，不发警告
  ```
- **JS**：`WRITER_CAPABILITIES`、`validateCapabilities(name, caps)`；`exportReport(s, formatId, { frame } = {}) → { warnings, notes }`；`exportStructure(s, id) → { text /* string | Promise<string>（服务器格式） */, filename, mime, warnings, notes }`（**保持同步**：`warnings`/`notes` 总是本地算出的数组）；`formats.register` 校验能力表（不合法时 `console.warn` 后忽略整个能力表）；`installServerFormats` 把 `GET /formats` 的 `capabilities` 抄进注册项。公共 API：`crystallume.exportReport(format, s = app.structure) → { warnings, notes }`（新）、`crystallume.exportText(format, s)`（不变）。
- **能力表**（两种语言内容相同）：

  | id | `label` | `frames` | `cell` | `constraints` | `occupancy` | `order` | `pbc` | `overlap` | `handedness` |
  |---|---|---|---|---|---|---|---|---|---|
  | `json` | Crystallume JSON | all | true | lattice | true | keep | stored | false | false |
  | `extxyz` | Extended XYZ | all | true | cartesian | true | keep | stored | true | false |
  | `xyz` | plain XYZ | all | false | none | false | keep | none | false | false |
  | `poscar` | POSCAR | one | required | lattice | false | species | periodic | true | true |
  | `cif` | CIF | one | required | none | true | keep | periodic | true | false |
  | `pdb` | PDB | all | true | none | false | keep | periodic | false | false |

- **检查与文案**（F0-D §3.12.2，照原文；**警告** = 影响计算或丢数据，**说明** = 不影响计算）：W1 `{F} holds one frame: wrote frame {k+1} of {n}`；W2 `plain XYZ does not store the unit cell; use Extended XYZ to keep it`；W3 `{F} needs a unit cell: the atoms were placed in a box with 10 Å of vacuum on each side (20 Å between periodic images)`；W4 `{m} atom(s) are fixed or partly fixed (selective dynamics), but {F} cannot store constraints; use POSCAR, Extended XYZ or Crystallume JSON to keep them`；W5 `Extended XYZ stores constraints along x, y and z (ASE move_mask): the partial constraints of {t} atom(s) are along cell vectors that are not x, y or z and were tightened; POSCAR keeps them exactly`；W6 `Extended XYZ stores these constraints as ASE FixCartesian masks because {p} atom(s) are only partly fixed; ASE's VASP writer ignores FixCartesian and would write every atom as free, so export POSCAR from Crystallume for VASP`；W7 `{q} site(s) are partially occupied, but {F} cannot store occupancy; they are written as full atoms`；W8 `property '{key}' was not written: {reason}`（reason ∈ `it has missing values`、`its rows have different lengths`、`its values are not all numbers, booleans or single words`、`its name is not a valid column name`）；W9 `forces, energy are known only for frame 1 and were written for that frame only`；W10 `the cell is left-handed (negative volume); VASP stops on such cells, so swap two cell vectors first`；W11 `{r} pair(s) of atoms are closer than 0.5 Å (e.g. atoms 12 and 13, 0.00 Å apart)`（序号从 1 开始）；N1 `POSCAR groups atoms by element, so the atom order in the file differs from the order in the structure; sort the atoms by species to make them match`；N2 `POSCAR is always periodic: c was not periodic and is written as a cell vector with a {w} Å gap between periodic images`。不报告 tags、`adsorbate_id`、labels、info 的丢失（K9）。
- **错误**：能力表非法 `ValueError` `writer 'myfmt': capabilities.constraints must be one of lattice, cartesian, none`；插件不声明能力时 `export_report` 返回空结果。
- **通道**：REST `POST /api/v1/io/export` 的 `ExportResponse` 加 `warnings: list[str] = []`、`notes: list[str] = []`；`GET /api/v1/formats` 写出器条目加 `capabilities`；客户端 `export_structure(...)` 不变，新增 `export_structure_with_warnings(structure, format) -> ExportResult`（`text`、`filename`、`mimetype`、`warnings`、`notes`）；CLI `convert` 与 `build … -o` 在 stderr 打印 `crystallume: warning: …` / `crystallume: note: …`（内部屏蔽 `ExportWarning` 以免重复；退出码不变）；CLI `info` 有间隙时打印中性的一行 `Vacuum gap  : 15.00 Å along c`（任何结构同样处理，U1），`--json` 加 `vacuumGap`。可选 O-6：`POST /api/v1/analysis/vacuum` + 客户端 `vacuum_gap(structure, axis=None, min_width=None)`。
- **消费方**：M3（CLI 打印约束丢失警告）、M7（REST 表）、网页导出（L-F0-28）。
- **已解决的冲突**：v1 的 `export_structure(with_warnings=True)` → 新方法（返回类型不随参数变化）；`exportStructure` 的同步契约（工程 #11）。

### L-F0-26 原子重叠检查 `close_contacts`

- **提供方**：F0-D T6。**文件**：`crystallume/analysis/contacts.py`（新）、`web/js/core/contacts.js`（新；不改现有成键代码）。
- **Python**：`close_contacts(structure, cutoff=None, *, pbc=None, limit=None) -> list[tuple[int, int, float]]`
- **JS**：`closeContacts(s, { cutoff, pbc, limit } = {}) → Array<[i, j, d]>`
- **语义**（F0-D §3.12.3）：`cutoff` 缺省 `overlap_distance`（0.5 Å）；`pbc` 缺省结构的 pbc；网格 O(N)；同一原子与自己的像也算；`(min(i,j), max(i,j), d)` 去重后按 `(i, j, d)` 排序；`limit` 截断。超过 20 万原子时导出检查跳过并写说明 `the overlap check was skipped for more than 200 000 atoms`。
- **消费方**：导出检查 W11；M4/M5 的放置冲突检查可复用（不另写邻近搜索）。

### L-F0-27 跨语言测试桥与公共用例格式（[改]：每个模块自己的 op 文件）

- **提供方**：F0-D T0。**文件**：`tests/js_bridge.py`、`tests/conftest.py`、`tests/cases.py`、`tests/test_cases.py`、`tests/test_js_unit.py`、`tests/js/helpers.mjs`、`tests/js/cases.mjs`、`tests/js/cases.test.mjs`、`tests/ops/__init__.py`（[改]）、`tests/js/ops/`（[改]）、`tests/data/surface/README.md`、`tests/data/surface/contcar_pt111.vasp`、`crystallume/web/js/package.json`（`{"type": "module"}`）、`pyproject.toml`（追加）。
- **Python**：
  ```python
  # tests/js_bridge.py
  REPO: Path; WEB_JS: Path; MIN_NODE_MAJOR = 22
  class NodeUnavailable(RuntimeError): ...
  class JSError(RuntimeError): stderr: str
  def find_node() -> tuple[str, tuple[int, int, int]]                  # $CRYSTALLUME_NODE（路径，或 0/off/false/no 关闭），再找 PATH
  def run_js(source: str, payload: Any = None, timeout: float = 30.0) -> Any
      # source 是 async function(input, web) 的函数体；web(rel) 导入 crystallume/web/js/<rel>；类型化数组转为普通数组；返回 JSON 结果
  def run_node_tests(paths: Sequence[str | Path], *, timeout: float = 300.0) -> subprocess.CompletedProcess
      # 显式文件列表交给 node --test --test-reporter=tap（不得传目录：Node 22/24 会失败）
  # tests/conftest.py：session fixture js -> run_js；Node 不可用时 pytest.skip("JS parity tests need Node.js >= 22: <原因>")，
  #   CRYSTALLUME_REQUIRE_NODE ∈ {1, true, yes} 时 pytest.fail；用到 js 的测试自动加 js 标记
  # tests/cases.py
  def load_cases(root: Path = REPO / "tests" / "data") -> list[dict]   # [改] 递归读 tests/data/**/*.json 中 schema == "crystallume.cases/1" 的文件
  def compare(expect: dict, actual: dict, tol: dict) -> None           # 失败抛 AssertionError，信息含用例 id
  OPS: dict[str, Callable]; def op(name: str) -> Callable              # 装饰器；重名注册抛 ValueError
  ```
- **JS**：`tests/js/helpers.mjs`：`repoPath(rel)`、`loadCases()`、`approx(a, b, tol)`、`compare(expect, actual, tol)`（与 `cases.py` 同一比较语义）；`tests/js/cases.mjs`：`export const OPS`、`export function op(name, fn)`。
- **用例外壳 `crystallume.cases/1`**（F0-D §7.1，照原文）：`{"schema": "crystallume.cases/1", "cases": [{id, op, args, input, expect, tol, skip}]}`；`input` 为 `{"structure": …}`、`{"text": …}` 或 `{"file": "相对 tests/data 的路径"}`；`args` 用 camelCase，Python 分派显式映射为 snake_case；比较器 `structure`、`value`、`sourceMap`、`warnings`（`equals`/`contains`/`count`）、`text`、`error`；未注册的 op 视为失败，除非写了带理由的 `skip`。
- **[改] 配方输入**（M1 v2 请求）：`input` 另可为 `{"recipe": {"name": "fcc111", "args": {…}}}`，由注册的配方构造器生成结构（大结构不存坐标）；Python `RECIPES: dict[str, Callable]` 与 `@recipe("name")`（`tests/cases.py`），JS `recipe(name, fn)`（`tests/js/cases.mjs`）；配方与 op 一样放在各模块自己的 op 文件里，重名注册报错；两种语言的同名配方必须给出同一结构（用一个 `crystallume.cases/1` 用例核对）。
- **[改] op 的归属**：每个模块把自己的 op 放在 `tests/ops/<module>.py`（例如 `f0d.py`、`f0a.py`、`m1.py`）与 `tests/js/ops/<module>.mjs`，由 `tests/ops/__init__.py` 与 `cases.test.mjs` 按文件名排序自动导入；不改 `tests/cases.py`、`tests/js/cases.mjs`。用例文件放 `tests/data/<area>/…`（F0-D 用 `tests/data/surface/f0d/`；F0-A 的 `gaps.json`、`params/coerce.json`、`lattice/directions.json`、`measure/migrate.json` 也改用此外壳）。唯一的 CONTCAR 夹具：`tests/data/surface/contcar_pt111.vasp`（Pt(111) p(3×3) 4 层 36 原子，SD 底 2 层 `F F F`，两个底层原子在 f = 0.99999，末尾有速度块）。
- **pyproject**：在现有三项上**追加** `addopts = "-q -m 'not slow'"` 与 `markers = ["js: needs Node.js >= 22 (…)", "slow: end-to-end browser tests (run with: pytest -m slow)"]`。
- **消费方**：所有模块的跨语言测试；M7 在 CI 设 `CRYSTALLUME_REQUIRE_NODE=1`。
- **已解决的冲突**：原型的 `MIN_NODE_MAJOR = 22` 保留，Node 20 不支持；`node --test 目录` → 显式文件列表（工程 #9）。

### L-F0-28 F0-D 的网页钩子（命令、备注、导出提示）

- **提供方**：F0-D T8。**文件**：`web/js/app.js`（`importFiles`/`importText`/`exportStructureFile` 三段）、`main.js`、`ui/panels/structure.js`、`ui/shell.js`（粘贴的两处 toast）、`api/public.js`。
- **命令**（经 L-F0-52 注册，参数经 `validateParams` 校验）：`edit.sortBySpecies`（Sort atoms by species，参数 `{order?: string[]}`，校验失败 toast `order must be a list of element symbols, e.g. ["Pt", "C", "O"]`；已分组时 `Atoms are already grouped by species`、不记历史；否则撤销标签 `Sort atoms by species`、toast `Sorted 38 atoms by species (Pt, C, O)` + Undo）；`edit.clearNotes`（Clear structure notes，撤销标签 `Clear notes`）；`file.exportNotes`（Show notes from the last export）。不新增快捷键。
- **公共 API**（经 L-F0-53 `defineApi`）：`crystallume.edit.sortBySpecies(order?)`、`crystallume.edit.clearNotes()`、`crystallume.analysis.vacuumGap(s = app.structure, axis = null) → VacuumGap | null`；顶层 `crystallume.exportReport(format, s)`（L-F0-25）。
- **界面**：导入 toast 只附**本步新增**的读取备注（一条放括号里，多条 `(… ; +2 more)` + `Details`）；Crystallume JSON 自带的备注不弹出；结构面板 Summary 下 `Notes (3)` 折叠列表 + `Clear notes`；导出成功后有警告时 `Saved slab.cif — <第一条警告> (+2 more)` + `Details`，含 W4/W6/W7/W10/W11 时 `timeout: 0`，否则 9000 ms；只有说明时按钮 `Notes`；对话框 `Export notes`，N1 存在时带动作 `Sort atoms by species`。**导入不加任何 slab 提示或开关（U1）**，Periodic 行保持只读。

### L-F0-29 默认参数表对齐（D7）

- **提供方**：F0-D T10。**文件**：`scripts/gen_reference_data.py`（新）、`crystallume/build/crystal.py`、`web/js/build/crystal.js`、`web/js/build/reference.js`（新，生成）、`web/js/ui/panels/build.js`、`tests/test_build.py`。
- **语义**（F0-D §3.15.2，照原文）：逐项取更准确的值（fcc/bcc/hcp 默认取 JS 室温实验值，sc 取 Python 3.359，Cr 2.884；纤锌矿 `u` 与 MX2 厚度按化合物；MoS2 `c` 两边 18；Python 加 `hbn`；fluorite/mos2 原子顺序取 Python）；参考表放 Python、生成 JS；严格逐原型 `toJSON` 对 `to_dict` 测试。名字（`Cu fcc` / `Cu (Face-centred cubic)`）本期不动（M7 定）。
- **消费方**：M2 切面金标的体相、M6 hBN 原型。

---

## 2. F0-A 提供的条目（L-F0-30 … L-F0-56）

路径相对 `crystallume/web/js/`。F0-A 只有网页侧，Python 侧只有参数 schema（L-F0-47）与晶格方向函数（L-F0-46）。

### L-F0-30 原位编辑 `editActive`

- **提供方**：F0-A T2。**文件**：`app.js`。
- **JS**：
  ```js
  app.editActive(label, fn, {
    indexMap = null,        // 旧 → 新：Int32Array | number[] | (old) => new
    src = null,             // 新 → 旧（C2-I3）：Int32Array | number[]，−1/null = 新原子
    imageShift = null,      // (oldIndex) => [ka, kb, kc] | null：存储坐标被整数格矢平移的编辑（包裹、重新居中）
    rebuild = 'full',       // 'full' | 'appearance' | 'none'
    refit = true, latticeChanged = false, singleFrame = false,
    snapshot = 'full',      // 'full' | { positions: Int32Array | number[] | null }
    toast = null,           // 成功后带绑定 Undo 的提示文案
    cameraTransform = null, // 3×3 旋转（行矢量约定 r' = r @ Rᵀ），相机随刚性重定向一起转
  } = {}) → { entry, value, map }
  ```
- **语义**（F0-A §3.2）：在当前结构上**原位**同步执行 `fn(s, { app, entry })`，一步撤销（事前快照）。`fn` 可返回 `{ select: [...] }`（提交后设为选区）。未给 `indexMap`/`src` 时用 `s.trackChanges()` 求映射（L-F0-04）。`singleFrame` 为真且多帧时先 `keepFrame()`，toast 附 `Kept frame <k> of <N> and dropped the others.`。toast 另附 `newWarnings(编辑前, 编辑后)`（本步新增的备注）。`rebuild: 'appearance'` 只允许原子数、坐标、晶胞、元素都不变的编辑（摘要核对常开，不符时退回 `'full'` 并 `console.warn`）。返回 `entry` = 本步的历史条目（嵌套在外层事务中时为 `null`）、`value` = `fn` 的返回值、`map` = `Int32Array(n0)` 旧 → 新。成功后 `markDirty()`、发 `structure`（选区或测量变化时另发 `selection`、`measure`）。
- **错误**：没有结构 `Load a structure first.`；`fn` 不是函数 `TypeError` `editActive: fn must be a function.`；`fn` 返回 Promise `editActive: fn must not be async.`；**[改]** `rebuild` 不是三者之一 `TypeError` `editActive: rebuild must be 'full', 'appearance' or 'none'.`；追踪器不可用（仅 F0-D 合入前）且删了原子未给映射 `editActive “<label>”: atoms were removed, so pass indexMap or src.`。`fn` 抛错或视图重建失败：完全回滚、不留历史、不标记未保存，错误继续抛出。
- **消费方**：M1（`latticeChanged`、`cameraTransform`、`toast`）、M2（居中、改真空：`imageShift`）、M3（固定/放开：`rebuild: 'appearance'`，配色不是 constraint 时 `'none'` + 重写光环）、M4（数值变换、加原子、粘贴）、M5（放置：`singleFrame: true`）；F0-A 自己的 `deleteSelected`（带 `indexMap`）、`replaceSelected`、P-pos/P-ghost 提交。
- **已解决的冲突**：R9（F0-D §10.1 要在克隆上运行 → 原位）；R10（M3 v1 `'props'` → `'appearance'`，`'props'` 抛错）；M3 v1 的"`fn` 修改深拷贝"拒绝；M4 v1 的 `keepCurrent`、`wrapHome` 撤回；M4 A-CR1（改写测量键）由测量引用 v2 代替（L-F0-44）。

### L-F0-31 换入新结构 `replaceActiveStructure`

- **提供方**：F0-A T2。**文件**：`app.js`（`:687-719` 重写）。
- **JS**：`app.replaceActiveStructure(s, { resetCamera = false, label = 'Edit structure', indexMap, src, imageShift, refit = true, latticeChanged = false } = {}) → { entry, value: undefined, map }`
- **语义**：与 `editActive` 同一套快照、重映射与重建（`resolveIndexMap`）。映射优先级：`indexMap` → `src`（例如 `r.sourceMap`，经 `invertSourceMap`）→ 回退规则（`n1 === n0` 恒等；`n1 > n0` 视为在末尾追加；`n1 < n0` 报错 `replaceActiveStructure “<label>”: atoms were removed, so pass indexMap or src.`）。**不会**自动读取 `s.sourceMap`（谱系可能不是当前结构）。没有活动条目时转 `addStructure`。失败回滚（不再自己弹栈顶）。
- **消费方**：P-swap 提交（L-F0-35）；M1 的超胞/重定义（`src`、`latticeChanged`）；现有"Wrap into cell""Make supercell real"（迁到 M1）。

### L-F0-32 新增结构 `addStructure`

- **提供方**：F0-A T2。**文件**：`app.js`（`:338-371`）。
- **JS**：`app.addStructure(s, { look = null, scene = null, newProject = false, replaceProject = newProject ? true : 'auto', name = null, label = null, activate = true } = {}) → { entry, historyEntry }`
- **语义**（F0-A §3.3）：`replaceProject: 'auto'`（现有行为：项目未改动时替换整个项目）只给 `importFiles`、`loadSample`、Build 面板；`false` = 总是加入当前项目、一步撤销；`true` = 替换。toast 附 `newWarnings([], getWarnings(s.info))`。公共 API `crystallume.addStructure` 仍返回条目 id。
- **必须传 `replaceProject: false` 的调用方**：Structure 面板 Duplicate（`ui/panels/structure.js:185`）、M2 切面、M6 Build Layers、M4 合并为新结构与"作为新结构粘贴"、M5"另存为新结构"。
- **已解决的冲突**：M2 v1 期望返回条目、M6 v1 期望返回 id → `{entry, historyEntry}`（id 为 `entry.id`）；报告 02 建议的 `keepCurrent: true` → `replaceProject: false`。

### L-F0-33 toast 与绑定到自己那一步的 Undo

- **提供方**：F0-A T2。**文件**：**`ui/overlays.js`**（[改]：F0-A 规格写的 `ui/toast.js` 不存在，`toast` 在 `ui/overlays.js:20`）、`app.js`。
- **JS**：
  ```js
  toast(message, { type = 'info', action, actions = [], timeout = 3800, spinner = false } = {}) → el（el.close()、el.update(message)）
  app.toastUndo(message, { entry, actions = [], timeout, type } = {}) → el
  app.undoEntry(entry) → label | null
  app.lastEdit → { entry, label, at } | null          // history.clear()/detach() 时复位
  ```
- **语义**：`actions: [{label, run}]` 多个按钮（`action` 仍可用，等价于一个元素）；悬停或键盘聚焦时暂停计时；`timeout: 0` 常驻，可用按钮或 Esc 关闭；错误 toast 至少 6.5 s（现状）。`toastUndo` 的 `entry` 省略时取 `lastEdit.entry`——只在编辑完成后的同一同步步骤里可靠，**异步调用点（粘贴、导入、服务器回调）必须显式传 `entry`**。`undoEntry`：会话中先取消预览；`entry` 是撤销栈顶 → 撤销；在重做栈 → toast `That change is already undone.`；在撤销栈但不在顶 → `Undo the later changes first (press Ctrl Z).`（按 `keyLabel('mod+z')`，Mac 上 `⌘ Z`）；已淘汰或已清空 → `That change can no longer be undone.`。
- **替换的调用点**：`app.js:666`（删除原子）、`app.js:845`（加入示例）、`ui/selectioncard.js:146`（替换元素）、`ui/shell.js:991`（粘贴，异步，用返回的 `historyEntry`）；**[改]** 另加 Structure 面板 `Replace… Apply`（今天无 Undo，报告 02 §8）。
- **消费方**：所有模块的成功提示；M4 的 "Open as new structure" 第二个动作。
- **已解决的冲突**：报告 02 的"撤销点击时的栈顶"；M6 v1 的 `toast(msg, {action: {label: 'Undo', run}})` → `toastUndo(msg, {entry})`。

### L-F0-34 `structureKey`、`notifyStructureChanged` 与脚本的 `edit.touch()`

- **提供方**：F0-A T2。**文件**：`core/analyses.js`（`:103-107`）、`app.js`。
- **JS**：`structureKey(app) → '<active>:<serial>:<length>:<frame>:<rev>:<digest>'`；`app.notifyStructureChanged()`；`crystallume.edit.touch()`（= 前者）。
- **语义**：`rev` 来自 L-F0-05，使只改 props/info 的编辑（固定原子、tags、`adsorbate_id`）也改变面板签名与分析缓存键；`structureDigest` 不变（仍兜住脚本直接改坐标）。`notifyStructureChanged`：`touch()`；与上次重建时的摘要比较（坐标、晶胞、元素或原子数变了 → `'full'`，否则 `'appearance'`）；`markDirty()`；发 `structure`；**不写历史**。F0-D 合入前 `editActive` 临时做 `s.rev = (s.rev ?? 0) + 1`。
- **消费方**：M3/M5 的面板签名与缓存（`adsorbate_id`、约束变化可见）；插件脚本。
- **已解决的冲突**：报告 02 缺陷 4（`structureKey` 不感知 props）。

### L-F0-35 预览会话 `beginStructureEdit`

- **提供方**：F0-A T3a（会话、P-swap、P-ghost）、T3b（P-pos 快速路径）。**文件**：`app.js`、`render/viewer.js`、`ui/shell.js`、`main.js`。
- **JS**：
  ```js
  app.beginStructureEdit(label, { kind = 'positions' /* 'positions' | 'structure' | 'ghost' */, owner = null, commitLabel = 'Apply',
                                  transient = false, singleFrame = kind === 'positions', onEnd = null } = {}) → EditSession
  // EditSession
  ses.preview(input, opts)   // 'positions': Float64Array(3n) | { indices, positions }（笛卡尔，当前帧）
                             // 'structure': Structure，opts { sameAtoms = false, indexMap | src, latticeChanged = false, imageShift }
                             // 'ghost':     Structure（只含新原子，晶胞与 pbc 同当前结构）| null
  ses.commit(arg, opts) → { entry, structureEntry } | null
      // P-pos：commit({ positions, label, toast, select } = {})（给了 positions 先 preview；无预览 → null）
      // P-swap：commit({ label, toast } = {}) → replaceActiveStructure（沿用最后一次 preview 的 src/indexMap/latticeChanged/imageShift）
      //         commit({ addAsNew: true, name, label, toast }) → addStructure(..., { replaceProject: false })
      // P-ghost：commit(fn, opts) → editActive(label, fn, opts)
  ses.cancel(reason = 'cancel') ; ses.active ; ses.kind ; ses.label ; ses.owner ; ses.last   // last = { input, opts }
  app.session → EditSession | null ; app.committedModel → P-swap 时暂存的已提交模型，否则 viewer.model
  ```
- **语义**（F0-A §3.6）：同一时刻只有一个会话；预览期间 `app.structure`、保存、自动保存、撤销快照、分析、面板签名都只看已提交结构，不写历史、不标记未保存、不重新取景、不更新缩略图、暂停轨迹播放；P-swap 锁住视图对原子的一切输入（点击、框选、右键、悬停，`pickAtom` 返回 −1）。`onEnd(reason)`，reason ∈ `'commit' | 'cancel' | 'undo' | 'switch' | 'replaced' | 'edit' | 'project' | 'error'`。自动取消：任何写历史的编辑、撤销/重做/`undoEntry`、切换结构或项目、删结构、`addStructure`（非本会话提交）、新会话。`transient` 为假时显示预览条（`Preview: <label>` + `<commitLabel>`/`Cancel`/Fit），会话期间 Ctrl/⌘+Z = 取消、Esc = 取消、mod+Enter = 应用（`edit.applyPreview`）。事件 `preview {state: 'start' | 'update' | 'commit' | 'cancel', label, kind, owner}`（可序列化），预览期间**不发** `structure`。守卫 `canEdit = hasS() && !app.busy && !app.session`，`editWhyNot` 文案 `Apply or cancel the preview first.`；导出、截图 API、嵌入页截图、`traj.*` 在会话中不可用。
- **错误**：`Load a structure first.`；`Preview positions must be finite numbers.`；`Preview atom index <i> is out of range (0–<n−1>).`；结构被换掉 `The structure changed during the preview.`。
- **消费方**：M1（P-swap，`sameAtoms`/`src`/`latticeChanged`，大结构用 `cellOutlineLayer` 轻量预览）、M2（P-swap 显示 slab，`commit({addAsNew: true})`，`commitLabel: 'Create'`）、M4（拖动 `{kind: 'positions', transient: true}`；Transform 分区有预览条；加原子/插入用 P-ghost）、M5（调高度/取向的 P-ghost；悬停幽灵**不开会话**，用 `ghostLayer`）、M6（P-swap，`commitLabel: 'Create'`，`commit({addAsNew: true})`）。
- **已解决的冲突**：M2/M4 v1 的 `banner` → 反义的 `transient`（缺省 `false` = 有预览条）；M6 v1 的 `app.showStructurePreview(...)` → 本会话（`fit: 'first'` = 第一次预览后调用 `viewer.fitView()`）；M4 A-CR3 的 `keepFrame` 选项 → `singleFrame`（方法名 `keepFrame` 留给 F0-D）。

### L-F0-36 撤销存储 `HistoryStore`

- **提供方**：F0-A T1。**文件**：`core/history.js`（新，纯模块）、`app.js`、`main.js:56`、`ui/shell.js:680-681`。
- **JS**：`HISTORY_DEFAULTS = { maxSteps: 80, maxBytes: 64 MiB, maxBytesSmall: 24 MiB }`；`class HistoryStore { record(e); popUndo(); pushRedo(e); popRedo(); pushUndo(e); top(); replaceTop(e); popTop(); has(e) → 'undo' | 'redo' | null; detach() → state; attach(state); clear(); get bytes(); get lastRecorded() }`；`snapStructure`、`structureFromSnap`、`applyPositionsSnap`、`patchPositions`、`snapBytes`、`packProps`、`unpackProps`；`app.history`；`app.undoStack`/`redoStack` 为只读副本（**废弃**，`docs/PLUGINS.md` 标明）。
- **语义**（F0-A §3.1）：只快照被改动的条目；二进制快照；P-pos 提交只存移动原子的位置增量；字节预算（窄屏或 `navigator.deviceMemory ≤ 4` 时 24 MiB）+ 80 步；栈顶撤销条目永不淘汰；整数打包只在 int32 范围内用 `Int32Array`，否则 `Float64Array`，再否则 JSON；`selective_dynamics` 每项都是长度 3 的布尔数组时打包为 `Uint8Array(3n)`。第一次因预算丢步时提示一次 `Undo keeps fewer steps for a structure this large.`。
- **消费方**：F0-A 内部；插件（`app.history`）；M4 经 `editActive({snapshot: {positions}})` 使用位置快照。

### L-F0-37 叠加层三层体系与导出策略

- **提供方**：F0-A T4a。**文件**：`render/overlays.js`（新）、`render/viewer.js`、`render/legend.js`、`app.js`（`exportImage`）、`ui/shell.js`（导出菜单）。
- **JS**：
  ```js
  const handle = viewer.overlays.add({
    id, owner = null,
    tier,                     // 'scene'（A，有深度）| 'top'（B，后期处理之后）| 'canvas'（C，2D 画布）| 'dom'（C，DOM）| 'legend'（图例项）
    object,                   // scene/top：THREE.Object3D
    draw,                     // canvas：(g, ctx) => void；ctx = { scale, w, h, project(x, y, z), pxPerA(point), dark, font, text(t, x, y, size, color, weight), occupancy, export, markers, model }
    items,                    // legend：() => [{ label, swatch: { kind: 'halo' | 'dot' | 'line', color, opacity } }] | null
    el,                       // dom：元素
    export = 'never',         // 'never' | 'marker' | 'always'
    pickable = false, pick,   // pick(ray, ctx) → { t, index, item } | null
    pickIn = null,            // 在哪些工具 id 下可拾取（null = 所有工具）
    onModel, beforeRender, bounds,   // onModel(model, viewer)；beforeRender(ctx)；bounds() → { center, radius } | null
    depth = 'none',           // 仅 top：'atoms' = 被原子挡住时不显示也不能拾取（B1）
    clearOnSwitch = true, order = 0, visible = true, dispose,
  }) → { set(patch), setVisible(on), remove() }
  viewer.overlays.get(id) ; viewer.overlays.removeOwner(owner) ; viewer.overlays.exportScope(kind /* 'png' | 'thumbnail' */, { selection, markers }) → restore()
  viewer.screenshot({ scale, transparent, gizmo, maxSize, selection = true, markers = false }) ; viewer.thumbnail()
  app.exportImage({ scale, transparent, selection = prefs.exportSelection !== false, markers = prefs.exportMarkers === true })
  ```
- **语义**（F0-A §3.11）：A 层挂在 `root` 下（`userData.noInk`、无阴影、`fog: false`、`frustumCulled = false`）；B 层在后期处理之后单独渲染（自带光照）；C 层在 `drawOverlay` 与图例栈中；`onModel` 在每次重建与预览重建后调用；切换活动结构时移除 `clearOnSwitch` 的层；叠加层不得自行循环渲染。光环可见性由隐藏集合控制（`render()` 不再无条件打开所有光环，修 `viewer.js:1487`）。导出：选区光环跟随 "Include selection highlight"（偏好 `exportSelection`，默认开）；悬停光环从不导出；`export: 'marker'` 的命名高亮与标记跟随 "Include markers (sites, fixed atoms)"（偏好 `exportMarkers`，默认关）；`never` 的层不导出；`always` 总导出；**缩略图不含任何光环与叠加层**；glTF 永远不含。
- **消费方**：M1（`cellOutlineLayer` 预览）、M2（晶面与厚度框）、M3（`tier: 'canvas'` 轴标、`tier: 'legend'` 图例）、M4（B 层手柄、C 层字母、A 层虚线）、M5（位点标记 `export: 'marker'`）。
- **已解决的冲突**：M3 v1 的 `addOverlayDrawer`、`addLegendItems` → `overlays.add({tier: 'canvas' | 'legend'})`；报告 03 §8-1 的"PNG 含悬停光环"。

### L-F0-38 叠加层构件

- **提供方**：F0-A T4a（`drawnCopies` 在 T5）。**文件**：`render/overlays.js`、`render/display.js`。
- **JS**：
  ```js
  markerLayer({ id, points, colors, radius = 0.32, tier = 'top', export = 'marker', pickable = true, pickIn = null })   // setPoints(points, colors)、setActive(i)
  planeLayer({ id, polygons: [{ points, color, opacity = 0.22, outline = true, dashed = false }] })                      // set({ polygons })
  cellOutlineLayer({ id, cell, origin = [0, 0, 0], color, dashed = true, width = 1.6 })
  ghostLayer({ id, structure, opacity })                                                                                // = P-ghost 的实现，不开会话也可用
  textLayer({ id, items: [{ position, text, color, size }], export = 'never' })
  drawnCopies(points, model, { repeat = true } = {}) → { positions: Float32Array, index: Int32Array, img: Int32Array }   // 按 model.wrapRule（含 U1 切口与边界副本）包裹并在显示超胞中重复
  ```
- **语义**：`markerLayer` 拾取 = 解析射线-球求交（半径取 `max(radius, 0.25)`），悬停放大 1.3×；`ghostLayer` 用已提交模型的 `cuts` 包裹（幽灵与 slab 同一切口），透明度缺省 0.45、`depthWrite: true`、不可拾取。
- **消费方**：M2（`planeLayer`、`cellOutlineLayer`）、M1（`cellOutlineLayer`）、M5（`markerLayer` + `drawnCopies`、悬停 `ghostLayer`）、M4（`textLayer`）。
- **已解决的冲突**：M5 v1 的 `drawnCopies(points, viewer, …)` → 第二个参数为 `model`。

### L-F0-39 命名高亮 `setHighlight`

- **提供方**：F0-A T4a。**文件**：`render/viewer.js`。
- **JS**：`viewer.setHighlight(name, srcIndices | null, { color, grow = 1.15, opacity = 1, strength = 1.4, contrast = true, export = 'marker' } = {})`；`viewer.clearHighlight(name)`；`viewer.highlightNames()`。公共 API `crystallume.highlight(name, indices, opts)`。
- **语义**（F0-A §3.10）：保留名 `select`、`hover`（随主题强调色）；其他名字惰性创建、**不随主题改色**（修 `viewer.js:883, 893`）；`color` 接受颜色串、`{light, dark}` 或 `'var(--token)'`（主题变化时重新解析）；双色边（深色内线 + 彩色外圈）缺省开；多个名字按 `grow` 由小到大绘制；编辑后经 `remapIndexed` 重映射；P-swap 且 `sameAtoms` 为假时隐藏；不保存。**F0-A 不规定任何名字的颜色**。
- **消费方**：M3（`fixed`、`fixed-partial`、`query`、`layer`，颜色令牌 `--constraint`，外圈亮度宜 ≥ 0.25）、M4（`m4-moving`）、M5（悬停类与吸附物列表）。
- **已解决的冲突**：F0-A v1 的 `HIGHLIGHT_COLORS` 删除，名字与颜色归调用模块；M3 的 `export: 'png'` → `'marker'`。

### L-F0-40 合并拾取、射线与几何

- **提供方**：F0-A T4b。**文件**：`render/viewer.js`。
- **JS**：
  ```js
  viewer.ray(clientX, clientY) → THREE.Ray
  viewer.pickAtomHit(clientX, clientY, ray = this.ray(clientX, clientY)) → { index, t } | null
  viewer.pickAtom(clientX, clientY) → index | −1                       // 签名不变；P-swap 时恒为 −1
  viewer.pick(clientX, clientY, { atoms = true, overlays = true } = {}) → Hit
  // Hit = { kind: 'overlay' | 'atom' | 'none', t, point, ray, atom: { index, src, t } | null, overlay: { layer, index, item, t, tier } | null }
  viewer.pointOnPlane(clientX, clientY, point, normal) → THREE.Vector3 | null      // 平行（|n·d| < 1e-6）或在相机后方时 null
  viewer.pointOnLine(clientX, clientY, origin, dir) → { point, s } | null
  viewer.worldPerPixel(point) → number                                             // 该深度处每 CSS 像素的 Å 数
  // 事件：overlayhover { layer, index, item, x, y }（离开时 index −1）、overlayclick { …, mode }、overlaydblclick、overlaycontext（加 clientX, clientY）
  ```
- **语义**（F0-A §3.12.2）：B 层命中优先（`depth: 'atoms'` 的层只保留 `t ≤ a.t + 0.05` 的命中）；否则 A 层命中在 `s.t ≤ a.t + 0.05` 时优先于原子；只考虑 `visible && pickable && (pickIn == null || pickIn 含当前工具)` 的层。点击命中可拾取的叠加层且没有工具处理时发 `overlayclick` 而不发 `atomclick`。被掩码隐藏的原子不在模型里，不会命中。`EVENTS` 加入 `overlayhover`、`overlayclick`、**[改]** `overlaydblclick`、`overlaycontext`（M5 需要）。
- **消费方**：M4（手柄、拖动平面与轴：`pointOnPlane`、`pointOnLine`、`worldPerPixel`；M4 要的 `pixelsPerAngstromAt` 即其倒数）、M5（位点点击、双击放置、右键/长按）。

### L-F0-41 工具注册表与指针接缝

- **提供方**：F0-A T6。**文件**：`render/tools/index.js`（新，纯模块）、`render/tools/select.js`、`render/tools/measure.js`、`render/viewer.js`、`app.js`、`ui/shell.js`。
- **JS**：
  ```js
  export const tools = { register(def) → dispose, get(id), list() };
  ToolDef = { id, title, icon, key = null, order = 100, toolbar = false, selects = false, cursor = '', touch = 'none' /* | 'claim' */,
              when(app), whyNot(app), hint(app, env) → string[], hud(app, env) → Node | null, mouse = [[按键, 说明]],
              activate(app, opts), deactivate(app, reason), handler(app, viewer, opts) → ToolHandler | null };
  ToolHandler = { claims(hit, e) → boolean, down(e, hit, press) → boolean, begin(e, press), move(e, press), up(e, press),
                  click(e, hit) → boolean, cancel(press, reason /* 'esc' | 'lost' | 'pointercancel' | 'switch' | 'second-finger' | 'session' */),
                  hover(hit, e), keydown(e) → boolean };
  app.setTool(id = 'select', opts = {}) → boolean ; app.tool（字符串）; app.toolDef ; viewer.toolHandler ; viewer.toolSelects ; viewer.cancelToolPress(reason = 'switch')
  crystallume.tools = { list, get, set: (id, opts) => app.setTool(id, opts) }
  ```
- **语义**（F0-A §3.13）：**延迟认领**：`down()` 返回 true 后挂起，指针移动超过点击阈值才 `begin()`；没有移动就按普通点击处理（选择、Shift 加选、Ctrl/⌘ 反选、双击选分子、触屏多选照旧，`handler.click` 返回 true 时才拦下）。右键旋转、中键/Alt 平移、滚轮与双键缩放、R+拖动缩放框在所有工具里不变。`selects` 决定点击与空白处框选是否仍选择原子（`select`、`move` 为真）。`touch: 'claim'` 时单指/笔尖按下询问 `claims(hit)`。P-swap 期间 `down` 拿不到原子命中。未知工具 `console.warn('Unknown tool “<id>”; using Select.')`；`when` 为假时 toast `whyNot` 或 `<Tool title> is not available now.`。提示栏、HUD、工具栏按钮（`toolbar: true`，`aria-pressed`）、快捷键对话框 Mouse 区由注册表生成；选区卡片在 `selects` 为假的工具下隐藏。
- **消费方**：M4 `move`（G，`toolbar: true`，`selects: true`，`cursor: 'grab'`，`touch: 'claim'`，`begin` 中开 P-pos 会话）；M5 `site-pick`（`toolbar: false`，`selects: false`，`cursor: 'crosshair'`，`touch: 'claim'`，`claims: () => false`）。插件工具 `crystallume.registerTool` 为可选 C4。
- **已解决的冲突**：M4 v2 的 `ToolHandler.selectFallback` 删除（由 `ToolDef.selects` 决定）、`hover(hit, e)` 参数顺序、新增 `begin()`；M4 A-CR4（`up()` 返回 false 走点击）由延迟认领代替；M5 v1 的 `registerTool` → `tools.register`，`cursor: 'target'` 不是合法 CSS 光标 → `'crosshair'`（图标仍为 `target`）。

### L-F0-42 逐原子可见性掩码

- **提供方**：F0-A T5。**文件**：`render/display.js`、`render/viewer.js`、`main.js`、`ui/selectioncard.js`、`ui/shell.js`。
- **JS**：`viewer.setVisibility(name, spec /* null | { hide: indices } | { show: indices } | Uint8Array(n) */)`；`viewer.hiddenCount`；`viewer.visibilityNames()`；`viewer.isVisible(i)`；`viewer.remapIndexed(map, n1)`；`buildDisplayModel(s, display, { imageCenters, visible, cuts })`；公共 API `crystallume.setVisibility(name, spec)`；视图事件 `visibility { hidden, names }`；命令 `view.showAll`。
- **语义**（F0-A §3.8.1）：多个名字取"与"；被隐藏的原子不绘制，因而不能被点击、悬停或框选；长度不符的掩码被忽略并警告；编辑后按旧 → 新映射搬移（新原子可见），不再隐藏任何原子的掩码被删除；切换结构条目时清空；不进 scene、不保存。有掩码隐藏原子时 `sel.all`（Ctrl+A）与 `sel.invert` 只作用于可见原子并提示 `Selected <n> visible atoms (<m> hidden).`；选区卡片标题 `12 selected (9 hidden)`；删除或替换含隐藏原子时确认 `<m> of the <n> selected atoms are hidden. Delete them too?`（按钮 `Delete all 12` / `Only the 3 visible` / `Cancel`）；状态栏 `216 hidden` + `Show all`。按索引的选择（API、Atom Selection）不受影响。
- **消费方**：M3"只显示顶部 N 层"（`setVisibility('layers', { show })`）。

### L-F0-43 显示模型、U1 切口的使用与"绘制 ↔ 存储"映射

- **提供方**：F0-A T5。**文件**：`render/display.js`、`render/viewer.js`、`ui/panels/appearance.js`。
- **JS**：
  ```js
  buildDisplayModel(s, display, { imageCenters, visible = null, cuts }) → model     // model 新字段：cuts, wrapRule, home, homeIndex, refs
  estimateDisplayCount(s, N, display, visible = null, { cuts } = {}) → number
  homeOffsets(structure, display, { cuts } = {}) → Int32Array(3n)                  // buildDisplayModel 内部用同一函数
  storedImage(model, d) → [a, b, c] ; refOf(model, d) → 'i:a,b,c'
  viewer.homeOffsets() → model.home ; viewer.atomInfo(d) → { display, index, symbol, name, cn, position, frac, image, drawn }
  viewer.gapCut = true                                                              // 调试属性，不进 scene、不保存
  ```
- **语义**：
  - **[改]** 切口一律取 `displayCuts(s, { frame })`（L-F0-16，带缓存），`buildDisplayModel` 不再自己判断提示轴；`display.wrap !== false` 时沿有切口的周期轴用 `unwrapAlongGap(f_k, cut_k)` 代替 [0, 1) 包裹、该轴不复制边界原子（不设 `nearMask`）；非周期轴从不包裹。P-pos 预览中不重算；P-swap 为预览结构单独计算；P-ghost 用已提交模型的 `cuts`。`model.wrapRule = { wrap, boundary, lo: [lo_0, lo_1, lo_2] }`。
  - 吸附物按组包裹（B10，应该）：`adsorbate_id > 0` 的原子按 id 分组，组内用第一个原子的整数偏移，整体画在一起、不复制边界原子。
  - `model.home`：绘制家副本 = 存储位置 + `home_i · cell`；`model.homeIndex[i]` = 原子 i 家副本的绘制下标（被隐藏时 −1）；`storedImage(model, d) = model.img[d] + model.home[src[d]]`。
  - `atomInfo(d)`：`position`/`frac` 为**已提交结构的 Float64 存储坐标**（P-pos 预览中为预览坐标），不包裹；`image` = 该绘制副本相对存储位置的格矢；`drawn` = Float32 绘制坐标。悬停卡与选区卡显示存储坐标，`image` 非零时另起一行 `Drawn image (0, 0, −1)`。
  - **[改]** 外观面板 `ui/panels/appearance.js:402` 的 `app.scene.style?.representation` 改为 `app.scene.style?.rep`（缺陷表 E-56）。
- **消费方**：M4（手柄、枢轴位置用 `model.homeIndex[i]` 的绘制坐标；`measurementImages` 解析 `refs`）、M5（位点标记对齐）、M3（悬停卡追加行，L-F0-50）。
- **已解决的冲突**：M4 A-CR2 `homeOffsets(structure, display, {gaps})` → 参数名 `cuts`；M4 v1 的 `wrapHome(f)` 不提供（U1 之后包裹依赖整根轴的切口）。

### L-F0-44 测量引用 v2

- **提供方**：F0-A T5。**文件**：`core/measure.js`（新，纯模块）、`render/viewer.js`、`app.js`、`ui/panels/structure.js`。
- **JS**：
  ```js
  // core/measure.js
  parseRef(ref) → { atom, image: [a, b, c] } ; formatRef(atom, image) → 'i:a,b,c' ; normalizeRefs(refs) → refs（首个像归一为 0,0,0）
  measurementPoints(structure, refs) → Float64Array ; migrateMeasurementKeys(structure, keys, { wrap }) → refs
  // viewer
  viewer.measurements: [{ id, type, refs, idx, points, value, drawn /* 'exact' | 'floating' | 'hidden' */ }]
  viewer.addMeasurement(type, displayIndices) → id ; viewer.removeMeasurement(id) ; viewer.clearMeasurements()
  ```
- **语义**（F0-A §3.9）：引用 `"i:a,b,c"` = 原子 i 的**存储位置**加整数格矢，与显示规则无关；项目 JSON 存 `{type, refs}`；旧 `{type, keys}` 在加载时迁移（`keys` 的像相对现行 [0, 1) 包裹的家）。数值用 Float64 存储坐标 `P_k = r_{i_k} + I_k · cell` 计算（修 `viewer.js:1013-1014` 的 Float32）。编辑后（**[改] 顺序写死**，M1 v2 请求）：① 下标按映射搬，被删原子的测量丢弃；② `latticeChanged` 时按**旧的**像丢弃像非零的测量；③ 对保留下来的按 `imageShift` 改写像（`I' = I − k`，k 为新晶胞中的整数平移）并归一；被丢的个数附在 toast（`1 measurement was removed.` / `<n> measurements were removed.`）。连续移动原子不需要 `imageShift`。**[改]** `id` 在一次会话内稳定：结构重建（`setStructure`、撤销恢复）时沿用条目记录里的 `id`，不再每次随机生成（修 `ui/selectioncard.js:222-224` 的 "Remove" toast 在编辑后失效，缺陷表 E-46）；`id` 不写入项目 JSON，加载时生成。
- **消费方**：M4（几何设定读 `refs`；提交时选择包裹才传 `imageShift`）、M2（重新居中传 `imageShift`）、M1（超胞类传 `latticeChanged: true`）。
- **已解决的冲突**：M4 A-CR1 → 本条；报告 01 I13 的"像偏移在晶胞变化后失去意义"→ `latticeChanged`。

### L-F0-45 沿任意方向观察与 N 键

- **提供方**：F0-A T7b。**文件**：`render/viewer.js`、`main.js`、`ui/shell.js`、`api/public.js`。
- **JS**：`viewer.viewAlong(target, { up = 'auto', ortho = 'auto', animate = !reducedMotion(), refit = true } = {}) → { dir, up, label }`；`target` ∈ `'a' 'b' 'c' 'x' 'y' 'z'`（可加 `-`）、`'normal'`、`'-normal'`、`[x, y, z]`、`{uvw}`、`{uvtw}`、`{hkl}`、`{hkil}`；公共 API `crystallume.view(target, opts)`（兼容旧的轴字符串）、`crystallume.viewAlong(target, opts)`；命令 `view.normal`（N）、`view.normalBelow`（Shift+N）、`view.along`（参数恰好一个：`{uvw?: vector(int), hkl?: miller, vector?: vector}`）。
- **语义**（F0-A §3.14.1）：`'normal'` = `surfaceNormal(s).normal`（L-F0-17）；侧视且有表面时屏幕"上" = 法向的垂直分量（顶面朝上）；俯视/仰视时"右" = 第一根面内晶轴（标准取向即 a）；无表面时取与方向垂直的最短格矢作"右"。方向标签按法向来源：`along the surface normal` / `from below the surface` / `along c* (normal to a and b)` / `along the widest vacuum (b)`；`along [u v w] of the current cell`、`along the normal of (h k l) of the current cell`。来源为 `'ab-plane'` 时照样转向并 toast `No vacuum gap found: looking along c* (normal to a and b).`（U1"没有间隙时给出说明"）。
- **错误**：`viewAlong: use a direction like [1, 1, 0], {uvw: [1, 1, 0]}, {hkl: [1, 1, 1]} or "normal".`；`Lattice directions and Miller indices must be whole numbers.`；`That direction has zero length.`；`Looking along a lattice direction needs a unit cell.`；`Looking along the surface normal needs a unit cell.`；`Look along: give exactly one of uvw, hkl or vector.`。
- **消费方**：M2（切面预览 `viewAlong({hkl}, {up: U})`、`fitView()`）、M3、M5（看表面）。

### L-F0-46 晶格方向辅助函数

- **提供方**：F0-A T7a（追加到 F0-D T7 建立的文件）。**文件**：`web/js/core/lattice.js`、`crystallume/core/lattice.py`（`__all__` 同步；`reciprocal_cell`/`plane_spacings` 也从 `crystallume.core` 重新导出）。
- **Python**：`miller_normal(cell, hkl) -> ndarray`（单位矢量，`n = hkl @ inv(cell)ᵀ`）、`lattice_direction(cell, uvw) -> ndarray`、`is_hexagonal_cell(cell, length_tol=1e-3, angle_tol=0.1) -> dict | None`（`{"axis": k, "gamma": 120 | 60}`）、`hkl_to_hkil(hkl) -> tuple[int, int, int, int]`、`hkil_to_hkl(hkil) -> tuple[int, int, int]`、`uvw_to_uvtw(uvw, *, integer=False) -> tuple`、`uvtw_to_uvw(uvtw) -> tuple[float, float, float]`、`centered_cell_hint(cell) -> dict | None`（`{"kind": "fcc" | "bcc", "to_conventional": 3×3 int}`）；`reciprocal_cell` 已有。
- **JS**：`reciprocalCell`、`millerNormal`、`latticeDirection`、`isHexagonalCell(cell, { lengthTol = 1e-3, angleTol = 0.1 } = {})`、`hklToHkil`、`hkilToHkl`、`uvwToUvtw(v, { integer = false } = {})`、`uvtwToUvw`、`centeredCellHint`（键 `toConventional`）、`formatIndices(v, bracket /* '(' | '[' | '{' | '<' */)`（负数用 U+0305 上划线）、`ariaIndices(v)`（"1 0 minus 1 0"）、`surfaceNormal`（重新导出）。公共 API `crystallume.lattice = { millerNormal, latticeDirection, isHexagonalCell, hklToHkil, hkilToHkl, uvwToUvtw, uvtwToUvw, centeredCellHint, surfaceNormal }`。
- **语义与错误**（F0-A §3.14.3–3.14.4）：`hkil_to_hkl` 在 `h + k + i ≠ 0` 时 `ValueError`/`Error` `in (h k i l), i must be −(h + k) = -1`（公式中的 `−` 是 U+2212，算出的数用 ASCII `-`）；`is_hexagonal_cell` 只用于 Miller 控件的四指数显示（网格类型由 M1 的 `mesh_type` 判断）；(h k l) 总是相对**当前晶胞**，指数不会被悄悄换算。
- **消费方**：M2（`isHexagonalCell`、`hklToHkil`/`hkilToHkl`、`millerNormal`、`formatIndices`）、M1（在同文件追加 `dSpacing`、`woodPresets`、`mesh_type`、`millerBasisNote`）。

### L-F0-47 参数 schema 新类型（JS、Python、CLI、REST 同一套）

- **提供方**：F0-A T8。**文件**：`web/js/core/params.js`（新）、`crystallume/core/params.py`（新）、`web/js/ui/paramform.js`、`web/js/core/analyses.js`（`defaultParams` 迁出后重新导出）、`crystallume/cli.py`（`:73-107`）、`crystallume/server/routes/build.py`（`:126-147`）、`crystallume/server/routes/analysis.py`。
- **JS**：`export class ParamError extends Error {}`；`parseIndices(text, { fractions = false } = {}) → number[] | number[][]`；`coerceParam(spec, value)`（失败抛 `ParamError`）；`validateParams(schema, values, { strict = false, title = null } = {}) → { values, errors: string[], warnings: string[] }`；`defaultParams(schema, structure = null)`。公共 API `crystallume.params = { parse, coerce, validate }`。
- **Python**：`class ParamError(ValueError)`；`parse_indices(text: str, *, fractions: bool = False) -> list`；`parse_cli_value(spec: dict, text: str) -> Any`；`coerce_param(spec: dict, value) -> Any`；`validate_params(schema, values, *, strict=False, title=None) -> tuple[dict, list[str], list[str]]`；`default_params(schema) -> dict`。
- **schema**（F0-A §3.15）：`int`/`float` 新增 `unit`（只显示）与 `required`（必填、初始为空，U4）；`vector`：`integer = false`、`nonzero = false`、`size = 3`（2 或 3）、`frame = 'cartesian'`、`frames = [frame]`、`unit = 'Å'`，值 `[x, y, z]`；`miller`：`max = 30`（硬上限）、`warnAbove = 12`、`hexagonal = 'auto'`，值总是三指数（输入四指数时换算，不约去公因子），缺省 `[1, 1, 1]`；`imatrix`：`size = 3`、`max = 50`、`maxDet = null`、`warnDet = 400`、`positive = true`、`presets = null`，缺省单位矩阵。字段可由调用方覆盖（M1 `max: 1000, maxDet: 1e6`；M2 想要硬上限 12 就写 `max: 12`）。
- **[改] 缺省值**（M1 v2 请求）：`defaultParams`（给表单用）对没有 `default` 键的参数用类型缺省（`min ?? 0`、全 0 矢量、`[1, 1, 1]`、单位矩阵）、对 `default: null` 给 `null`；`validateParams`/`validate_params`（给命令与 API 用）**不替调用方编值**：缺省的可选参数，spec 有 `default` 键（含 `null`）时取它，否则不出现在结果里；`required` 的参数缺省时报 `<Label>: enter a value.`。
- **解析**：JSON（以 `[`/`{` 开头且含逗号）或空白/逗号分隔；U+2212 与上划线负号；外层括号；`;` 分行；`fractions` 时接受 `p/q`；拒绝 NaN/Infinity。`coerce_param` 只接受 JSON 类型（字符串 `'4'` 不是整数），CLI 先 `parse_cli_value`。
- **文案**（两种语言逐字相同）：`<Label>: enter a value.`；`<Label>: enter a number.`；`<Label>: enter a whole number.`；`<Label>: use a value from <min> to <max>.`；`<Label>: enter three numbers, like 0 0 1.`；`<Label>: enter three whole numbers, like 1 1 0.`；`<Label>: enter two numbers, like 0.5 0.5.`；`<Label>: the vector cannot be zero.`；`<Label>: enter three whole numbers (h k l) or four (h k i l), like 1 1 1.`；`<Label>: in (h k i l), i must be −(h + k) = <n>.`；`<Label>: (0 0 0) is not a plane.`；`<Label>: use indices from −<max> to <max>.`；`<Label>: enter a <n>×<n> matrix of whole numbers, rows separated by ';'.`；`<Label>: every entry must be a whole number.`；`<Label>: use entries from −<max> to <max>.`；`<Label>: the matrix is singular (determinant 0).`；`<Label>: the determinant is <det>; a negative determinant mirrors the cell. Swap two rows or negate one.`；`<Label>: determinant <|det|> is too large (at most <maxDet>).`；软提示 `High-index plane; the surface cell may be large.`、`This makes <det>× the atoms.`；命令 `<Command title>: unknown parameter “<key>” (use <k1>, <k2>, …).`。命令里的前缀是去掉结尾省略号的命令标题。
- **CLI**：`--param KEY=VALUE` 经 `parse_cli_value` + `coerce_param`；缺必填参数报 `--param <key>: enter a value.`（前缀只加一次）。**REST**：插件声明了 `params` 时 `/build/custom/{name}`、`/analysis/custom/{name}` 先 `validate_params(spec.params, body, strict=False)`，失败 422（文案同上），成功把规范化后的值传给插件。
- **消费方**：M1（`imatrix`、`vector`）、M2（`miller`、`float required` 的 `vacuum`）、M3、M4（`vector`）、M5（带单位数值）、M6（`imatrix size 2`、`vector size 2`）；命令参数校验（L-F0-52）；M7 的 CLI。

### L-F0-48 输入控件

- **提供方**：F0-A T8。**文件**：`ui/inputs.js`（新）、`ui/paramform.js`、`css/app.css`。
- **JS**：
  ```js
  numberInput({ label, value, unit, min, max, step, integer, required, onChange, onCommit, key })
  vec3Input({ label, value, size = 3, labels, frame, frames, cell, integer, nonzero, unit, onChange, onCommit, key })   // frames 可含 'surface'（u, v, h，B11）
  millerInput({ label, value, cell, hexagonal = 'auto', max, warnAbove, describe, onChange, onCommit, key })
  imatrixInput({ label, size, value, presets /* 数组或 (ctx) → [{ label, value, hint, applicable, why, params }] */, positive, max, maxDet, warnDet,
                 warn /* (value) → string | null */, area /* (value) → string */, rowLabels, colLabels, onChange, onCommit, key })
  // 每个控件返回 { el, value, set(v, { silent }), validate() → string | null, setError(msg | null), focus(), valid }
  setInvalid(input, message, slot)            // paramForm 之外复用无效样式（aria-invalid + p.err-text.field-err）
  paramForm(...) → { …, valid /* getter */, onValidity(cb) }
  ```
- **语义**（F0-A §5.6）：`onChange` 只在**有效**修改时触发，`onCommit` 在 Enter 或失焦时；`required` 且值为 `null` 时显示为空、**没有占位数字**，主按钮不可用（U4）；"会话内记住用户上次填的值"由调用模块负责（模块级变量，不写偏好、不写项目），控件从不预填；数值框 `type="number"`，聚焦时屏蔽滚轮改值，`validity.badInput`（只输入了 `-`）视为输入中；粘贴 `0.5, 0.5, 0`、`1/3 2/3 0`、`1 0 -1 0`、`(1 0 1̄ 0)`、`2 1 0; -1 1 0; 0 0 1` 自动分配；六方晶胞（γ = 120°）时 Miller 控件显示四框 `h k i l`（`i` 只读），读数行 `(h k l) of the current cell` + 公因子说明 + `centeredCellHint` 的原胞提示 + `describe(value)`；矩阵读数 `det 3 · 3× the atoms`（2×2：`… the area`），`area` 回调可替换读数。**[改]**（M1 v2 请求）`presets` 为函数时收到 `ctx = { structure, cell, value }`（当前结构，供求参考网格）；`positive: false` 时不显示负行列式的文案（手性规则由调用方的 `warn` 给出）。
- **消费方**：M1（`imatrixInput` 的 `presets`/`area`/`warn`）、M2（`millerInput({describe})`、`numberInput({required: true, min: 0, unit: 'Å'})` 的真空）、M4（`vec3Input`、`setInvalid`）、M5（Å、°、ML）、M6（`vec3Input({size: 2, labels: ['u', 'v']})`）。`seg`、`toggle` 已在 `ui/dom.js:56, 65`。
- **已解决的冲突**：M6 v1 的 `inputs.number/imatrix/vector` → 本条名字；M1 v1 要的 `max: 1000`、`maxDet: 1e6` 与带参数的预设 → 采纳。

### L-F0-49 面板分区外壳、Surface 面板与 Structure 面板插槽

- **提供方**：F0-A T10。**文件**：`ui/sections.js`（新）、`ui/panels/surface.js`（新）、`ui/panels/structure.js`、`ui/shell.js`、`main.js`、`ui/icons.js`。
- **JS**：
  ```js
  registerPanelSection(panelId /* 'surface' | 'structure' */, {
    id, title, order = 100, slot = 'main' /* structure 面板：'cell' | 'transform' */, defaultOpen = true,
    available(app) → true | string, emptyActions(app) → Node[], render(app, el, shell, ctx /* { section, open } */),
    signature(app) → string, refreshOn = ['project', 'structure'], badge(app) → string | null,
  }) → dispose
  renderSections(panelId, app, el, shell, { slot = 'main' } = {}) ; refreshSections(panelId, reason)
  openSection(panelId, sectionId, { focus, tab } = {}) ; shell.openLeft(id, { section, focus, tab })
  requireCell(app) → true | string ; requireVacuumGap(app) → true | string ; requireNoPreview(app) → true | string
  crystallume.registerPanelSection(panelId, s, o)
  ```
- **语义**（F0-A §3.17、§5.2）：每个分区渲染在自己的 `<details class="sec">` 容器里、**按自己的签名单独重绘**（用户正在该分区输入时延后）；展开状态记在偏好 `sections`；渲染出错显示 `This section failed to load: <message>`；`available()` 返回字符串时主体只显示原因与 `emptyActions`。**分区总是显示，不随 slab/非 slab 改变（U1）**；`badge` 只放该工具的当前参数，**不得**放"slab""bulk"之类的分类。Surface 面板：左侧第 5 个面板（Shift+5，`panel.surface`），无结构时整面板空状态（`Load a bulk crystal first.` …），分区与顺序：

  | 面板 | 分区 id | order / slot | 注册方 |
  |---|---|---|---|
  | `surface` | `cleave` | 10 | M2 |
  | `surface` | `slab` | 20 | M2 |
  | `surface` | `layers` | 30 | M3 |
  | `surface` | `adsorbates` | 40 | M5 |
  | `surface` | `interface` | 50 | M6 |
  | `structure` | `cell` | slot `cell`（摘要之后），10 | M1 |
  | `structure` | `transform` | slot `transform`（Selection 之后），10 | M4 |
  | `structure` | `constraints` | slot `transform`，**20** | M3 |

  某分区没有模块注册时（开发期间）显示 `Not available in this build yet.`。文案：`requireCell` → `This structure has no unit cell. Surface tools work on crystals and slabs with a unit cell.`；`requireVacuumGap` → `surfaceNormal(s).surface` 为假时返回 `vacuumGapHint(s)` 首字母大写加句号（L-F0-17，含多轴文案），`emptyActions` 为 `Build vacuum slab…`（`surface.vacuum` 已注册时）；pbc T T F 的结构只要非周期轴上有真空就算有（D5）；`requireNoPreview` → `Apply or cancel the current preview first.`。
- **消费方**：M1、M2、M3、M4、M5、M6（各自注册分区，**不直接改** `ui/panels/*.js`）。
- **已解决的冲突**：M3/M6 v1 的 `registerSurfaceSection` → `registerPanelSection('surface', …)`；M3 v2 的 Constraints 分区"排在 Selection 之后" → `slot: 'transform', order: 20`（插槽名沿用 F0-A，含义 = Selection 之后）。

### L-F0-50 选区动作与原子信息行（[改]：补上 M3 v2 要的四项）

- **提供方**：F0-A T10。**文件**：`ui/selectioncard.js`（注册表）、`ui/atominfo.js`（新）、`ui/shell.js`（右键菜单与悬停卡）。
- **JS**：
  ```js
  registerSelectionAction({
    id, label /* string | (app, sel) → string */, short = label, icon /* string | (app, sel) → string */, tip, kbd, order = 100,
    card = true,
    menu = true,                 // [改] true（原子右键菜单）| 'blank'（空白处菜单）| 'both' | false
    when(app, sel) → boolean,    // 是否显示
    enabled(app, sel) → boolean, // [改] 显示但置灰（缺省总为 true）
    run(app, sel, ctx),          // [改] ctx = { source: 'card' | 'menu' | 'blank', atom /* 右键的原子或 −1 */ }
    items(app, sel) → [{ id, label, kbd, tip, icon, separator, enabled, run(app, sel, ctx) }] | null,   // [改] 分体按钮 ▾ 与子菜单
    rows(app, sel) → [{ label, value }] | null,                                                       // [改] 卡片信息行
  }) → dispose
  registerAtomInfo(fn /* (app, srcIndex, ctx: { where: 'hover' | 'card' }) → [{ label, value }] | null */, { order = 100 } = {}) → dispose
  crystallume.registerSelectionAction(a, o) ; crystallume.registerAtomInfo(fn, o)
  ```
- **语义**：
  - 现有 5 个动作改由注册表提供：Centre（10）、Same element（20）、Measure（30，1–4 个原子）、Replace…（40）、Delete（50）。
  - **[改] 目标规则**（写进契约）：原子右键菜单的 `sel` = 被点的原子在选区中且选区多于 1 个时为整个选区，否则为 `[该原子]`；空白处菜单的 `sel` = 当前选区（可为空）。
  - **[改] 配额**：桌面可见动作 ≤ 7 个时全部显示，否则前 6 个 + `More`；窄屏（触屏或 ≤ 920 px）≤ 5 个全部显示，否则前 4 个 + `More`；`when` 为假的不占位，`enabled` 为假的占位并置灰（按钮位置不随选区跳动）。顺序号是契约：Centre 10、Same element 20、Measure 30、**M3 `constraints.fix`（分体按钮 Fix ▾，含 Free）35**、Replace 40、Delete 50、M4 Move… 60、Rotate… 61、M3 `sel.markAdsorbate` 70；M1 `cell.atomToOrigin` 只进菜单（`card: false`）。于是 Fix ▾ 在桌面与手机上都在前四个可见动作之内。
  - 右键菜单在 "Measure from here"（`shell.js:829`）之后插入 `menu` 为 `true`/`'both'` 的动作；空白处菜单在 "Clear selection"（`shell.js:817`）之后插入 `'blank'`/`'both'` 的动作，有可见性掩码时另加 `Show all atoms`。
  - 会话进行中、`selects` 为假的工具下、P-swap 预览时卡片隐藏；选区含隐藏原子时 Delete/Replace 先确认（L-F0-42）。
  - `registerAtomInfo`：悬停卡在 "bonds …" 一行之后、选区卡（单原子）在坐标之后，按 `order` 追加返回的行（`label value`）；返回 `null` 不追加。
- **消费方**：M3（Fix ▾ 分体按钮、`rows`：`constraint  F F T · fixed along c (z)`、空白处 `Select fixed atoms`/`Atom Selection…`、悬停行 `layer 2/4 · fixed c (z)`）、M4（Move…/Rotate…）、M1（菜单项）、M5（`adsorbate_id` 行）。
- **已解决的冲突**：M3 v2 的 `registerHoverLine((app, index) → string | null)` → `registerAtomInfo`（返回 `[{label: 'layer', value: '2/4 · fixed c (z)'}]`）；M3 v2 申请 Fix ▾ order 15 → **35**（配额规则下同样进入前四，且不把 Fix 排到 Centre/Same element 前面）；M3 v1 的 Fix/Free 分开的 35/36 → 合并为一个分体动作，36 不再使用。

### L-F0-51 配色方案上下文（[改]：加 `extras`）与 "Property" 配色的默认属性

- **提供方**：F0-A T4a。**文件**：`render/colors.js`（`:196-215`）、`render/viewer.js`（`:600` 的 `colors` 签名）、`render/legend.js`、`app.js`。
- **JS**：
  ```js
  // computeColors 的 ctx：{ model, settings, cn, prop, srcIndex, structure, scene, extras }      // structure、scene、extras 只读
  // 配色方案可声明 dependsOn: ['display.layers', …]（scene 路径），并可返回分类图例 { kind: 'categories', items: [{ label, color }] }
  app.registerColorExtra(key, (app) → jsonValue | undefined) → dispose      // [改] 新增
  ```
- **语义**：`extras = { [key]: provider(app) }`（只含返回值不为 `undefined` 的键），每次 `applySettings` 前重算；`colors` 签名加入 `dependsOn` 路径的值与 `JSON.stringify(extras)`，因而只在它们变化时重算颜色。B14："Property" 配色未指定属性时跳过 `tags`、`adsorbate_id`（`render/colors.js:205` 今天取第一个数值 prop，切面后会变成 `tags`）。
- **消费方**：M3（Color by constraint 与按层配色：`registerColorExtra('layers', app => 当前结构条目的层参数)`）。
- **已解决的冲突**：M3 v2 §10.2 要"App 提供的 `extras`（M3 放当前结构条目的层参数）"→ 以注册 provider 的方式实现（层参数存在结构条目里，不在 scene 里，`dependsOn` 管不到）。

### L-F0-52 命令注册：参数校验、MS 别名、守卫与命令表

- **提供方**：F0-A T9（机制与 F0-A 的命令）；各模块在自己的文件里注册自己的命令。**文件**：`core/commands.js`、`ui/rank.js`（新，`rankCommands` 从 `shell.js:73-101` 移出并重新导出）、`ui/shell.js`、`main.js`、`api/public.js`（`reference()` 输出 `aliases`、`ms`、`params`）。
- **JS**：
  ```js
  commands.register({ id, title, category, key, kbd, keywords, hidden, palette, repeat, shortcutGroup,
                      run(app, params?), when(app), whyNot(app),
                      params /* schema（L-F0-47） */, aliases /* string[]，MS 名称 */, ms /* MS 菜单路径，只显示 */,
                      estimate /* (app, params) → 原子数 */, edits = false /* 为真时组合 canEdit 与 editWhyNot */ }) → dispose
  export const LIMITS = { maxAtoms: 200_000 /* 偏好 maxAtoms 可调到 2 000 000 */, confirmAtoms: 30_000 }
  ```
- **语义**（F0-A §3.16）：**校验放在 `register` 生成的包装函数里**，`commands.run`、`commands.get(id).run(...)`、嵌入页 `crystallume:call command`、插件都经过：参数不是普通对象 → `<title>: pass the parameters as an object.`；`validateParams(c.params, params, {strict: true, title})` 有错 → 抛 `{ code: 'invalid-params', message: errors[0] }`；`estimate` 超过 `LIMITS.maxAtoms` → `{ code: 'too-large', message: '<title>: this would make <n> atoms; the limit is <max>.' }`；超过 `confirmAtoms` 时交互调用先确认；不带参数调用时照旧 `run(app)`（打开对应分区，交互式）。`title` 去掉结尾的 `…`。F0-A 为 M1–M6 的命令提供"打开对应分区"的回退实现，只在该 id **尚未注册**时注册且先于模块导入，模块的真实实现总能覆盖它。命令面板按别名打分（比同类标题低 5 分）并显示灰色别名。`CATEGORY_ORDER` 在 `'Edit'` 后加 `'Cell'`、`'Surface'`。
- **命令表**（ID 固定；"守卫"列的 `edits` = 组合 `canEdit`）：

  | ID | 标题 | 别名（MS） | 键 | 类别 | 守卫 | 参数 | 归属 |
  |---|---|---|---|---|---|---|---|
  | `panel.surface` | Show Surface panel | — | Shift+5 | Window | — | — | F0-A |
  | `view.normal` | Look along the surface normal | — | N | View | 有晶胞 | — | F0-A |
  | `view.normalBelow` | Look at the bottom surface | — | Shift+N | View | 有晶胞 | — | F0-A |
  | `view.along` | Look along a direction or plane… | — | — | View | 有结构 | `{uvw?, hkl?, vector?}` 恰好一个 | F0-A |
  | `view.showAll` | Show all atoms | Unhide | — | View | 有掩码 / `No atoms are hidden.` | — | F0-A |
  | `edit.applyPreview` | Apply preview | — | mod+Enter | Edit | 有会话 / `There is no preview to apply.` | — | F0-A |
  | `edit.cancelPreview` | Cancel preview | — | （Esc 经 `sel.clear`） | Edit | 有会话 | — | F0-A |
  | `edit.sortBySpecies` | Sort atoms by species | — | — | Edit | 有结构、`edits` | `{order?: string[]}` | F0-D |
  | `edit.clearNotes` | Clear structure notes | — | — | Edit | 有备注、`edits` | — | F0-D |
  | `file.exportNotes` | Show notes from the last export | — | — | File | 本会话导出过 | — | F0-D |
  | `surface.cleave` | Cleave surface… | Cleave Surface | — | Surface | 有晶胞、`edits` | M2 定；**`miller: miller`**（[改] M2 v2：不是 `hkl`）、`layers: int`、**`vacuum: float`（`required: true`、`min: 0`、`unit: 'Å'`，总间隙，无默认值，U4）** | M2 |
  | `surface.vacuum` | Build vacuum slab… | Build Vacuum Slab | — | Surface | 有晶胞、`edits` | M2 定；`vacuum` 同上 | M2 |
  | `surface.setVacuum` | Set vacuum… | Vacuum | — | Surface | 有晶胞、`edits`；`requireVacuumGap`（T T F 放行） | M2 定；`vacuum` 同上 | M2 |
  | `surface.flip` | Flip slab | — | — | Surface | `edits`；`surfaceNormal().surface` | — | M2（[改] M2 v2 新增） |
  | `surface.center` | Centre slab | — | — | Surface | `edits`；`surfaceNormal().surface` | — | M2（[改] M2 v2 新增） |
  | `cell.supercell` | Supercell… | Supercell, Create Supercell | — | Cell | 有晶胞、`edits` | `{matrix: imatrix}` | M1 |
  | `cell.redefine` | Redefine lattice… | Redefine Lattice | — | Cell | 同上 | `{matrix: imatrix}` | M1 |
  | `cell.parameters` | Lattice parameters… | Lattice Parameters | — | Cell | 同上 | M1 定 | M1 |
  | `cell.reorient` | Re-orient to standard | Re-orient to standard | — | Cell | 同上 | — | M1 |
  | `constraints.edit` | Modify constraints… | Modify Constraints, Edit Constraints | — | Edit | 有结构、`edits` | M3 定 | M3 |
  | `sel.fix` | Fix selected atoms | Fix fractional position | — | Edit | 有选区、`edits` | M3 定 | M3 |
  | `sel.free` | Free selected atoms | — | — | Edit | 有选区、`edits` | — | M3 |
  | `sel.query` | Atom selection… | Atom Selection | — | Edit | 有结构 | M3 定 | M3 |
  | `tool.move` | Move tool | Translate, Rotate | G | Tools | 有结构 | — | M4 |
  | `adsorbate.add` | Add adsorbate… | Add Adsorbate | — | Surface | 有晶胞、`edits` | M5 定 | M5 |
  | `sites.find` | Find adsorption sites | Find Adsorption Sites | — | Surface | 有晶胞；`requireVacuumGap` | M5 定 | M5 |
  | `tool.sitePick` | Pick adsorption site | — | — | Tools | 同上 | — | M5 |
  | `build.layers` | Build layers… | Build Layers | — | Surface | 项目中至少有一个带晶胞的结构 | M6 定 | M6 |

  没有 `surface.supercell`（M2 v2：表面超胞用 M1 的 `cell.supercell`）。现有命令：`sel.delete`、`sel.delete2` 加 `canEdit`；`sel.all`、`sel.invert` 有掩码时只作用于可见原子；`sel.grow`、`sel.fragment` 在 P-swap 时不可用；`export.*`、`traj.*` 的 `when` 加 `!app.session`；`panel.*` 循环加入 `surface`。快捷键：F0-A 占 N、Shift+N、Shift+5、mod+Enter；M4 占 G；其他模块提议的键由 M7 查冲突（不得注册 Ctrl/⌘ C/V/X，不用 E、Q、Alt+字母，简报 §4）。
- **消费方**：M1–M6 全部命令；嵌入页。
- **已解决的冲突**：报告 02 的"嵌入页可带任意参数调用任意命令"→ 包装函数里校验；`commands.get(id).run(params)` 原来绕过校验（工程 E26）。

### L-F0-53 `crystallume.*` 命名空间的注册接口（[改] 新增）

- **提供方**：F0-A T2。**文件**：`web/js/api/namespaces.js`（新）、`web/js/api/public.js`（`createAPI` 合并已注册成员）。
- **JS**：
  ```js
  export const API_NAMESPACES = Object.freeze(['edit', 'build', 'analysis', 'surface', 'lattice', 'params', 'tools']);   // [改] 'surface'：M2/M5 v2
  export function defineApi(path /* 'edit.fix' | 'build.surface' | 'exportReport' */, fn, { owner = null, replace = false } = {}) → dispose
  ```
- **语义**：`path` 为 `'<namespace>.<name>'`（namespace 在 `API_NAMESPACES` 中）或单个顶层名字；在 `createAPI` 之前注册的成员在创建时并入，之后注册的立即出现在活的 `crystallume` 对象上；同名已存在且 `replace` 为假 → `Error` `defineApi: crystallume.edit.fix is already defined (by M3)`（括号里是 `owner`）；`fn` 不是函数 → `TypeError` `defineApi: expected a function for crystallume.edit.fix`。`crystallume.edit.*` 的成员**必须**经 `app.editActive`/`replaceActiveStructure` 实现（一次调用一步撤销）；返回值由各模块定义。F0-A 自己的 `crystallume.edit = { run, begin, touch, session }`：`run(label, fn, opts)` = `app.editActive`，返回 `{entry: {id, label} | null, value}`；`begin` = `app.beginStructureEdit`；`touch` = `app.notifyStructureChanged`；`session`（getter）。
- **消费方**：F0-D T8（`edit.sortBySpecies`、`edit.clearNotes`、`analysis.vacuumGap`）；M1（`edit.setCell`、`edit.makeSupercell`、`lattice.*` 追加）、M2（`build.surface`、`build.terminations`、`surface.cleave`、`edit.setVacuum/addVacuum/centerSlab/flipSlab`）、M3（`edit.fix`、`edit.free`、`analysis.layers`）、M4（`edit.translate`、`edit.rotate`…）、M5（`build.adsorbates`、`edit.addAdsorbate`、`analysis.sites`、`surface.showSites`、`surface.coverage`）、M6（`build.interface`）。各模块**不再直接修改** `api/public.js`。M5 v1/v2 的 `crystallume.registry.adsorbates.register`（可选项 L10，"留接口不实现"）不在本期命名空间内；需要时由 M7 加入 `API_NAMESPACES`。
- **已解决的冲突**：M3 T6、M4、M5 的任务表都把 `api/public.js` 列为自己的文件 → 改为调用 `defineApi`；M3 v2 §10.7-6 与 M4 的"合并 `crystallume.edit` 命名空间"→ 由本条的重名检查保证。

### L-F0-54 进度 `startTask`

- **提供方**：F0-A T2。**文件**：`app.js`（委托 `_busyStart`，`:1269-1278`）。
- **JS**：`app.startTask(label, { cancel = null } = {}) → { set(labelOrFraction), end(), get cancelled }`；`set(0.42)` 显示为 `<label> 42%`，`set('…')` 换文字；**[改]** 给了 `cancel` 回调时显示 `Cancel` 按钮，点击后调用它并使 `cancelled` 为真（M1 v2 的分块原胞搜索需要）。任务期间 `app.busy` 为真（`canEdit` 与导出不可用），只用于用户发起、需要等待的操作。
- **消费方**：M1（> 5 000 原子的原胞搜索，带 Cancel）；M2 大结构切面。M6 v2 的自动搜索不使用它（每次改参数都会触发，不应锁住编辑）。
- **已解决的冲突**：M6 v1 与 M1 v2 的 `app.busy(label) → {set, end}` → `app.busy` 已是布尔属性，改名 `startTask`。

### L-F0-55 显示的 smart 键规则（[改] 修既有缺陷）

- **提供方**：F0-A T5。**文件**：`render/display.js`（`:15-33`）、`ui/panels/appearance.js`（`:512-517`）。
- **JS**：`smartPairDefault(pair, elementsPresent) → true`（保留导出，供外观面板列出元素对；不再按"结构里有阴离子"关掉金属–金属对）；`export function smartBondFilter(bonds, model, structure, bondSettings) → bonds`（新，`buildDisplayModel` 在求键之后调用）。
- **语义**：`bonds.smart !== false` 时，先按现有规则求键（`pairOverrides[pair] === false` 的元素对照旧排除）；再按存储结构的周期邻居（`findPeriodicNeighbors`，用场景的 `tolerance` 与 `maxLength`；无晶胞时 `findBonds`）求每个原子的 `anionBonded[i]`（i ∈ `METALS` 且至少与一个 `ANIONS ∖ METALS` 的原子成键）；**删除**两端都在 `METALS`、两端都 `anionBonded`、且 `pairOverrides[pair] !== true` 的金属–金属键。结构里没有金属或没有阴离子时跳过（零开销）。与 M3 `bond_graph(metal_pairs="smart")`、M5 smart 配位数同一定义（报告 M3-domain 第 5、11 条）。外观面板对金属–金属对的复选框缺省为开，提示 `Smart bonds hide metal–metal bonds where both metals bond to a non-metal`。
- **消费方**：M5 第一个用户故事（Pt slab 放 CO 后 Pt–Pt 键不再全部消失）、M4 的选片段（显示与键图一致）、M3。
- **已解决的冲突**：今天 `ANIONS` 含 C、H（`core/elements.js:166`），任何吸附物都会关掉 slab 里所有金属–金属键（缺陷表 E-60）；M3 v2 的两个备选（"只按基底元素判断"或"按原子用 smart 规则"）→ 选后者（对导入的、没有 `adsorbate_id` 的 CONTCAR 同样有效）。

### L-F0-56 启动数据任务 `registerBootTask`（[改] 新增，M2 v2 请求）

- **提供方**：F0-A T10。**文件**：`web/js/core/boot.js`（新，纯模块）、`main.js`。
- **JS**：
  ```js
  export function registerBootTask(name, fn /* () => Promise<void> */) → void      // 模块在导入时注册（例如 M2 的 loadOxidationStates、M5 的吸附物库）
  export function bootTasks() → Promise<Array<{ name, ok, error }>>
  ```
- **语义**：`main.js` 在导入全部模块之后、发出 `crystallume` 的 ready 事件与嵌入页握手之前 `await bootTasks()`；每个任务各有 10 s 超时；失败或超时不阻止启动：`console.error` 并 toast `Some data failed to load: <name>.`，依赖它的分区用 `available()` 返回 `<Section> needs data that failed to load; reload the page.`。同名重复注册报错 `registerBootTask: “<name>” is already registered`。Node 测试中不运行 `main.js`，模块自己的数据读取函数可直接调用。
- **消费方**：M2（`web/data/oxidation_states.json`：Cleave 分区与 ready 之前需要）、M5（吸附物库 `web/data/*.json`）。M2、M5 **不直接改** `main.js` 的启动顺序。
- **已解决的冲突**：M2 v2 §10.2 的"`main.js` 在注册 Cleave 分区与发出 ready 之前 `await loadOxidationStates()`（T2 改 `main.js`）"→ 用注册接口，`main.js` 只归 F0-A。

---

## 3. U1–U6 合规检查（F0-D v2、F0-A v2）

逐条核对两份定稿规格（全文检索 `slab`、`pbc`、`vacuum`、`detect`、`15 Å`、`T, T, F`、`Treat as slab`、`toast` 与界面文案）。结论：**主体合规**；剩下的 3 处措辞/参数缺口与 1 处跨规格不一致在本账本中已改正，下面给出替换文本，修订两份规格时照抄。

| 决定 | 检查项 | F0-D v2 | F0-A v2 | 结论 |
|---|---|---|---|---|
| U1 | 导入不改 pbc、不移动原子、不改导出内容 | §2.4 删除 `detect_slab` 整条链；K5；§5.1；有 U1 验收用例（CONTCAR 读入直接导出 POSCAR 不变） | 不写结构，切口只影响绘制（§4） | 合规 |
| U1 | 没有提示、开关、徽章，slab 与非 slab 不做其他区分 | 结构面板 Periodic 行只读；CLI `info` 的 `Vacuum gap` 行对任何结构一样（中性信息，不是提示） | 分区总是显示，`badge` 禁止分类；`surface` 是内部计算字段，不是标记 | 合规；**一处措辞**见 V1 |
| U1 | 真空间隙只用于显示、上下表面、slab 工具三件事，三者同一个切口 | §3.13.3 要求共用切口 | §3.8.2 共用 `gapCut` | 两份规格的切口规则不同 → 本账本 R1 统一（L-F0-16） |
| U1 | 没有间隙时给出说明 | `vacuum_gap_hint` | `requireVacuumGap`、N 键的 toast | 合规；文案按 V2 统一 |
| U2 | 生成的 slab `pbc = [T, T, T]`；导入保留文件的 pbc；二维原型保持 T T F | K6；§10.3/§10.7 要求 M2/M6 改 | 不生成结构 | 合规（M2/M6 v1 仍写 T T F，见 §6） |
| U3 | M6 纳入本期 | §10.7 | Interface 分区（order 50）、`build.layers`、`startTask` | 合规 |
| U4 | 不设默认真空；真空 = 总间隙；API 中必填 | `SURFACE_DEFAULTS` 无 `vacuum`（有测试）；W3 文案写清"每侧 10 Å（周期像之间 20 Å）"——这是现有的分子装箱写 POSCAR，不属于切面/界面/改真空的 API | `numberInput({required})` 初始为空、主按钮不可用；`surface.cleave` 的 `vacuum: float required` | **参数缺口**见 V3 |
| U4 | `center(vacuum=)` 是单侧，新参数不得与之混淆 | §3.5.1 未注明 | — | 本账本 L-F0-07 已注明；文档写清 |
| U5 | D1 面板、D2 吸附物原位、D5 `move_mask`、D7 修缺陷 | K4（只写 `move_mask`）、M-17/M-19（二面角、默认表升为必须） | Surface 面板 + Cell/Transform 插槽；P-ghost 提交走 `editActive`（原位） | 合规；D7 的遗漏项见 §4（E-60、E-63、E-64、E-66–E-68 等由本账本补派任务） |
| U6 | 开放问题按推荐方案定案，开发不等待 | §8.2 决定记录 | §8 Q1–Q8 已定案或"按下列选择推进" | 合规 |

**需要照改的文本**：

- **V1（F0-A §5.2，`requireVacuumGap` 的多真空轴文案）**：
  原文 `有多根真空轴（线、盒中分子）时说明 \`Vacuum along b and c: this is not a slab with one surface normal.\``。
  替换为：`有多根真空轴（线、盒中分子）时显示 \`vacuumGapHint(s)\` 的多轴文案：\`Vacuum gaps along b and c: surface tools need a vacuum gap along one cell vector only.\``
  理由：原文在界面上把结构判定为"不是 slab"，是 U1 禁止的分类式表述；新文案只说明工具的前提。
- **V2（F0-D §3.13.2，`vacuum_gap_hint`）**：
  原文 `\`no vacuum gap of 5 Å or more along a periodic cell vector (the widest is 3.3 Å along c); add vacuum first\``。
  替换为：`\`no vacuum gap of 5 Å or more along a cell vector (the widest is 3.3 Å along c); add vacuum first\`；有两根及以上真空轴时为 \`vacuum gaps along b and c: surface tools need a vacuum gap along one cell vector only\`；有表面时返回 None`（L-F0-17）。
- **V3（F0-A §5.8 命令表 `surface.vacuum`、`surface.setVacuum` 两行的"参数"列）**：
  原文分别为 `M2 定（\`vacuum\` 必填，U4）` 与 `M2 定`。
  两行都替换为：`M2 定；\`vacuum: {type: 'float', unit: 'Å', min: 0, required: true}\`，含义为 slab 与下一个周期像之间的总间隙，没有默认值（U4）`。`surface.cleave` 行同样补上 `min: 0` 与"总间隙"。
- **V4（F0-D §3.5.1 `center` 一行）**：在"给了 `vacuum` …"之前加一句：`\`vacuum\` 是每侧的量（现有语义，不改）；新 API 中的 \`vacuum\` 一律指总间隙，文档与 docstring 写清两者不同（U4）。`

不构成违规、但需要知道的两点：(1) `info.surface.axis` 只在 Crystallume 生成的结构上存在，它让切口门槛从 5 Å 降到 2 Å——这是"有没有来源信息"的区别，同一规则对所有结构生效，且提示必须仍是最宽的真空才被采纳（L-F0-17），不是 slab/非 slab 的区分；(2) `surface_normal` 的返回值带 `surface: bool`，它是工具可用性的内部判据（"有且只有一根真空轴"），不显示为标记。

---

## 4. 既有缺陷表

来源：报告 01–05、07 与全部审查。"处理"一列写修在哪一节、哪个第 0 波任务；推迟的写理由。**[新派]** = 两份规格都没有派任务、由本账本派给第 0 波。

| # | 缺陷（证据） | 来源 | 处理 |
|---|---|---|---|
| E-01 | JS `clone()` 与原结构共享 `props`/`info`（`structure.js:87, 107, 129, 134`）；Duplicate（`ui/panels/structure.js:185`）复制出的结构删原子会改到原结构；撤销快照已含编辑 | 01 §0-3、02 §2-1/2、05 §6.6-2 | F0-D §3.1、§3.5.2（L-F0-01、L-F0-07），T2 |
| E-02 | JS `addAtom` 不扩展 props（`structure.js:264-271`），之后读逐原子标志会错位 | 01 §0-2、02 §2-3、03 §8-7 | F0-D §3.5.2（经 remap），T2 |
| E-03 | JS `repeat` 静默丢弃长度不符/类型化数组的 prop、内层数组在像之间共享；不校验计数（`repeat(1.5)` 得 2 个符号 4 组坐标，`repeat(0)` 得 0 原子与奇异晶胞）（`structure.js:211-231`） | 01 §3.2、I3、I17、05 §6.6-3 | F0-D §3.5.2（L-F0-07），T2 |
| E-04 | JS `wrap()`/`repeat()` 只用当前帧，`repeat` 丢掉所有帧；Python 两者都处理所有帧 | 01 §0-7、04 §6.3 | F0-D K10（JS 对齐 Python），T2；C11 的丢帧在界面层（`keepFrame`） |
| E-05 | Python `repeat` 在像之间、并与**原结构**共享嵌套 prop（`structure.py:604`） | 01 §0-9、05 §6.6-7 | F0-D §3.1（`copy_value`），T1 |
| E-06 | Python `append`/`extend` 给新原子的 props 填 `None`（`structure.py:622-626, 644-650`），一个 `None` 让 POSCAR 写出器丢掉整个 SD 块（`poscar.py:139-140`）、extxyz 丢整列（`xyz.py:239-243`） | 01 §0-10、04 §0-7、05 §6.6-6 | F0-D §3.2（默认值）T1；POSCAR 按"键存在即写"T4；extxyz W8 T5/T6 |
| E-07 | JS `fromJSON` 遇 `pbc: true` 崩溃；`fromJSON(Structure)` 返回同一对象；附加帧行数不足时补 0（原子跑到原点，`structure.js:109, 288-298`）；Python `from_dict` 遇不齐的 props 直接报错（两边结果不同） | 01 §6.3-6、工程 F0-D #14 | F0-D §3.1 修复规则（两语言相同），T1/T2 |
| E-08 | JS `toJSON` 帧晶胞不取整且按引用；类型化数组 prop 写成 `{"0": …}` | 01 I3、F0-D M-5 | F0-D §3.5.2（`toJSON({precision, copy})`），T2 |
| E-09 | JS `clone()` 回到第 0 帧并把坐标取整到 1e-10 | 01 §3.2、02 §2-5 | F0-D §3.5.2，T2 |
| E-10 | 警告键不统一：Python `info.warnings`（列表），JS `info.warning`（`"; "` 连接的字符串），网页 toast 只读 `info.warning`（`app.js:901`）；派生结构带着过期的载入警告 | 01 §0-6、I8 | F0-D §3.6（L-F0-09），T1/T2/T8；F0-A toast 只显示本步新增（L-F0-30） |
| E-11 | Python `delete` 对越界下标取模（`n+1` 静默删掉第 1 个原子） | F0-D M-5 | F0-D §3.5.1（`IndexError`），T1 |
| E-12 | 编辑后保留过期的空间群与计算结果：删原子后结构面板（`ui/panels/structure.js:112`）、`crystallume info`（`cli.py:264`）、`summary()`（`neighbors.py:318`）仍显示原空间群；extxyz 照写旧 `energy`，ASE 当成新结构的能量；`deleteSelected`/`replaceSelected` 不清空间群 | 04 §0-7、领域 F0-D F3、工程 F0-D #6、工程 F0-A #29 | F0-D §3.7 `mark_edited`（L-F0-10），T1/T2；F0-A §3.2 删除/替换时 `invalidateSymmetryInfo`，T2 |
| E-13 | 构建器写的 `info.prototype/a/c/u/thickness` 在改晶格后过期，并以 `a=3.92` 形式写进 extxyz | 01 I9、领域 F0-D F17 | F0-D `invalidate_build_info`（`mark_edited("cell")`），T1/T2；M1/M2 调用 |
| E-14 | JS `wrap` 容差 1e-9（值可略为负），Python 1e-12（`structure.js:238`） | 01 I11 | F0-D `wrap_fractional`（L-F0-19），T7/T2 |
| E-15 | **JS POSCAR 读取丢 Selective dynamics**（`io/poscar.js:58-74`，跳过 SD 行只读 3 个词），写出从不写 SD（`:92-106`） | 01 §6.3-10、02 §2、03 §8-8、04 §4、05 §3.7-1/§6.6-1 | F0-D §3.10（L-F0-23），T4 |
| E-16 | Python POSCAR 把 `.TRUE.` 读成固定，行尾标签处理错（`io/poscar.py:100`） | 05 §6.6-5、工程 F0-D 已核对 | F0-D §3.10.1（`FLAG_RE`），T4 |
| E-17 | POSCAR 物种行重复的元素块（`Ga As H H / 1 1 2 2`）两种语言都被合并成 `Ga As H / 1 1 4` | 领域 F0-D F7 | F0-D §3.10.4（`poscar_species`），T4 |
| E-18 | JS 可变晶胞 XDATCAR 用第一帧晶胞换算所有帧（`io/poscar.js:81-88`），坐标错；Python 不认 XDATCAR | 领域 F0-D F19、05 §3.7-8 | F0-D §3.10.5：JS 必须（T4），Python S-4（T4） |
| E-19 | **JS extxyz 列过滤**：读取只留宽度 1 的 R/I 列（`io/xyz.js:45`）、丢掉 info（`:79`）；写出不写任何 props 与 info（`:105-106`） | 01 §6.3-10、05 §3.7-2/§6.6-4 | F0-D §3.11（L-F0-24），T5 |
| E-20 | 注释行词法：JS `parseKeyValues` 不支持 `\"`，把 ASE 的 `_JSON` 值截成 `_JSON {\`（`io/xyz.js:7-13`）；Python `_KV_RE` 不支持 `[...]`（`io/xyz.py:25-27`） | F0-D §3.11.1 | F0-D `kv_tokenize`，T5 |
| E-21 | Python extxyz 写出静默丢掉列表与字典 info（`io/xyz.py:267-275`），`info.surface` 往返丢失 | 04 §0-7/§4、05 §6.6-9 | F0-D K15，T5 |
| E-22 | 多帧 extxyz 把第 0 帧的 props 与 info 抄到每一帧（`structure.py:326-343`、`xyz.py:276-291`），伪造数据 | 05 §6.6-8 | F0-D S-5 + W9，T5 |
| E-23 | JS extxyz 把 `config_type` 当结构名（`io/xyz.js:73`），与 Python 不同 | 工程 F0-D #13 | F0-D §3.11.2，T5 |
| E-24 | JS CIF/PDB 读取器的 prop 名与 Python 不同（`label`/`residue` vs `labels`/`residue_names`） | 05 §3.7-6 | F0-D S-6（只改读取器，不迁移旧文档），T5 |
| E-25 | 单帧写出器：Python 写第 0 帧，JS 写当前帧（`io/poscar.js:98`、`io/cif.js:268`） | 05 §3.7-4、§6.6-10 | **保留**（两边既有约定），W1 写明写的是哪一帧（F0-D §3.12.2），T6 |
| E-26 | 无晶胞时 POSCAR/CIF：Python 装箱（每侧 10 Å），JS 抛错 | 04 §4、05 §3.7-5 | **推迟**：JS 文案清楚、不丢数据；O-2 可选（与 Python 同规则装箱） |
| E-27 | JS PDB 写出器不转到标准取向（`io/pdb.js:100-104`） | 05 §3.7-7、§6.6-11 | **推迟**：表面功能不依赖 PDB；记入 M7 待办 |
| E-28 | 只有 JS 接受 ASE/pymatgen 的 JSON 回退格式；格式探测顺序两边不同 | 05 §3.7-8/9 | **推迟**：与表面功能无关 |
| E-29 | 文档：`docs/SCHEMA.md:28` 未定义 `selective_dynamics`/`tags`；`docs/PLUGINS.md:508` 宣称网页支持 POSCAR SD | 05 §6.6-12 | F0-D T11 |
| E-30 | **二面角符号**：JS `measureValue`（`viewer.js:1949-1961`）与 `geometryValue`（`selectioncard.js:54-64`）恰为 IUPAC 的相反数，Python 为 IUPAC、[0, 360) | 01 §0-11、两份 F0-D 审查 | F0-D §3.15.1（L-F0-21），T9 |
| E-31 | 元素数据：共价半径 Bk–Lr 7 个值不同；未知元素回退 Python 1.5 / JS 0.5 Å；范德华半径 21 个元素不同（Alvarez vs Bondi） | 01 §0-12、§4.3 | F0-D §3.15.3（L-F0-22），T9；范德华半径**不改**（各有用途），新算法不用 |
| E-32 | `repeat` 命名：Python 后缀叠加成 `'Cu fcc 2x1x1 2x1x1'`，JS 用 ` (2×2×2)` 括号 | 01 I10 | F0-D §3.14（L-F0-12），T1/T2 |
| E-33 | Python `repeat` 用 `info["supercell"]` 覆盖旧值，超胞历史丢失 | 01 §3.1、领域 M1 第 17 条 | **保留旧键语义**（最近一次计数）；新键 `supercellMatrix` 左乘累计（F0-D §3.5、M1 K4），T1/T2 |
| E-34 | **JS/Python 默认参数表不同**：fcc/bcc/hcp/sc 的 a、纤锌矿 u（0.382/0.375）、MoS2 c（18/15）、`hbn` 只在 JS、fluorite/mos2 原子顺序 | 04 §6.3、领域 F0-D F15、工程 F0-D #21 | F0-D §3.15.2（L-F0-29），T10 |
| E-35 | JS `new Structure({...})` 不修复奇异晶胞，之后 `fracPositions()` 抛 `Singular cell matrix` | 01 §0-5、I6 | **推迟**：新构建器必须给出有效晶胞（M1 校验矩阵 det ≠ 0，M2/M6 的晶胞由构造保证）；读取路径已修复（`fromJSON`） |
| E-36 | JS `cellFromParams` 不校验参数（γ = 180° 得到垃圾、负长度保留），Python 报错；`cellParams` 对零矢量给 NaN | 01 §4.2、04 §6.3 | M1（第 1 波）的 `checkCellpar` 在调用前校验（M1 §6.2）；`cellParams` 的 NaN **推迟**（只影响显示） |
| E-37 | `normalize_symbol`：Python 保留 `D`、`Xx`，JS 变成 `H`、`X` | 01 I12 | **推迟**：两边文档写明；跨语言金标不用 D/T/未知符号；M7 统一 |
| E-38 | 化学式顺序：C 存在而无 H 时 Python `COPt2`、JS `Pt2CO` | 01 §0-8 | **推迟**：新功能的名字在 Python 中用 `project.display_formula`（= JS `formula()` 的顺序），C9 由 M2 写死 |
| E-39 | 成键最小距离 Python 0.1 Å（`analysis/neighbors.py`）、JS 0.4 Å（`core/bonds.js:31`） | 01 §4.3 | 新功能统一用 M3 的 `bond_graph`（0.4 / 5.0 / 1.15，M3 K7，第 1 波）；现有 `neighbors` **不改**（不破坏现有分析结果） |
| E-40 | Python `repeat` 不看 pbc，会沿非周期的 c 堆叠 | 01 I7 | **推迟**：与 ASE 行为一致；M1 的 `imatrixInput` `warn` 钩子提示 `This repeats the slab along the vacuum axis; use a 2×2 surface matrix.` |
| E-41 | JS 原子量 66 个元素四舍五入、电负性缺项、30 个 VESTA 颜色不同 | 01 §4.3 | **推迟**（只影响显示）；新的 `masses` 默认值两边都取 `elements.json`（F0-D §3.2） |
| E-42 | Python `center(vacuum=)` 对跨晶胞边界的 slab 量错厚度（z = 0.5 与 9.5 Å、真空 5 → c = 19 Å） | 01 §3.1 | **推迟** `center` 本身（旧 API、单侧语义）；新的 `set_vacuum`/`center_slab`（M2，第 1 波）先 `make_contiguous`（L-F0-18） |
| E-43 | `structureDigest`/`structureKey` 不感知 props、info、name（`core/analyses.js:73-107`），只改 props 的编辑不刷新面板与缓存 | 01 I14、02 §2-4 | F0-A §3.5（`rev`，L-F0-34），T2；F0-D `rev`/`touch()` T2 |
| E-44 | **toast 的 Undo 撤销点击时的栈顶**（`app.js:599-600`），不是它自己那一步 | 02 §8 | F0-A §3.4（L-F0-33），T2 |
| E-45 | **`addStructure` 在未改动的启动示例上替换整个项目**（`app.js:339-359`），切面会丢体相、Duplicate 会丢原结构 | 02 §1.2/§2-6/§9-6 | F0-A §3.3（`replaceProject: false`，L-F0-32），T2 |
| E-46 | 测量 id 在每次重建时重新生成（`viewer.js:1039`），选区卡片 "Remove" toast（`selectioncard.js:222-224`）在编辑后失效 | 02 §9-3 | **[新派]** F0-A T5（L-F0-44 的稳定 id） |
| E-47 | 测量键在晶胞变化后保留像偏移（`app.js:787-800`），超胞/重定义后指向错误的像；"Make supercell real"同样（`ui/panels/structure.js:177-181`） | 01 I13、02 §9-3 | F0-A §3.9.4（`latticeChanged`），T5；按钮迁到 M1（`cell.bakeRepeat`） |
| E-48 | 每个结构步骤把**项目里所有结构**序列化为 JSON（80 步），撤销时重建每个结构对象，分析缓存全部失效（`app.js:571-595`） | 02 §1.3/§9-7 | F0-A §3.1（L-F0-36），T1 |
| E-49 | Structure 面板 `Replace… Apply`、`Wrap into cell`、`Make supercell` 的 toast 没有 Undo | 02 §8 | **[新派]** `Replace… Apply` 归 F0-A T2（L-F0-33）；另两个按钮迁到 M1，由 M1 用 `toastUndo` |
| E-50 | 嵌入页可带任意参数调用任何命令（`api/embed.js:21, 82-90`），`commands.get(id).run(params)` 绕过校验 | 02 §4、工程 F0-A E26 | F0-A §3.16（L-F0-52），T9 |
| E-51 | **pbc T T T 的 slab 底层在真空顶部多画一份**（12 个原子画成 31 个） | 03 §0、§2.3-1 | F0-A §3.8.2 U1 切口（L-F0-16、L-F0-43），F0-D T7 + F0-A T5 |
| E-52 | 包裹把跨晶胞面的 slab、吸附物画成两半 | 03 §2.3-2 | 同上；吸附物按组包裹 B10（应该），F0-A T5 |
| E-53 | 测量值与 `atomInfo` 用 Float32 绘制坐标（`viewer.js:1013-1014, 1394-1407`）；`atomInfo.frac` 是绘制副本的值（边界副本为 1.0）；旧测量键相对"包裹后的家"（`display.js:225-227`），U1 改包裹规则后 31% 的近邻测量静默消失 | 03 §2.3-3/4、领域 F0-A 第 1 条、工程 F0-A E9/E10 | F0-A §3.9、§3.12.3（L-F0-43、L-F0-44），T5 |
| E-54 | 只能按元素隐藏（`display.hiddenElements`），没有逐原子可见性 | 03 §2.3-5 | F0-A §3.8.1（L-F0-42），T5 |
| E-55 | PNG 与缩略图带悬停光环；`render()` 每帧把所有光环设为可见（`viewer.js:1487`），导出策略照写无效 | 03 §8-1、工程 F0-A E4 | F0-A §3.11.3（L-F0-37），T4a |
| E-56 | **`ui/panels/appearance.js:402` 检查 `app.scene.style?.representation`**（键实为 `style.rep`），"Wireframe 更轻"的提示永远不对 | 03 §8-4 | **[新派]** F0-A T5（该文件归 T5），一行修正（L-F0-43） |
| E-57 | **`_updateHalos`/`_cssTheme` 把所有光环种类改成主题强调色**（`viewer.js:883, 893`） | 03 §8-6 | F0-A §3.10（`themed` 标志，L-F0-39），T4a |
| E-58 | "Property" 配色默认取第一个数值 prop（`render/colors.js:205`），切面后变成 `tags` | 01 I14、03 §2.3-8、F0-D §10.1-6 | F0-A B14（L-F0-51），T4a |
| E-59 | 文档：`docs/PLUGINS.md:312` 对 `boxselect`/`selection` 的下标空间描述错误；`display.supercell` 文档 1–30、界面 1–20 | 03 §8-2/5 | **[新派]** F0-A T11（文档） |
| E-60 | **smart 键：结构里有任何 C/H/O/N…就关掉所有金属–金属键**（`render/display.js:16-21`，`ANIONS` 含 C、H），放第一个吸附物后 Pt–Pt 键全部消失 | 领域 M3 第 5、11 条、M3 v2 §10.2 | **[新派]** F0-A T5（L-F0-55） |
| E-61 | GLB 导出总是写 1×1×1 晶胞、跳过线框（`viewer.js:1881-1895`） | 03 §8-3 | **推迟**：与表面功能无关 |
| E-62 | "height" 配色用绘制坐标的笛卡尔 z（`colors.js:160-164`） | 03 §2.3-7 | **推迟**：C5 标准取向下 z 就是法向；按层着色由 M3 的配色方案提供 |
| E-63 | **`/build/supercell` 的原子数估算忽略帧**（`server/routes/build.py:95` 以 `len(s)` 调用 `_check_repeat`，`:32-39`），而 `repeat()` 平铺每一帧，多帧结构会远超上限 | 04 §3.2、§7-7 | **[新派]** F0-D T6：`:95` 改为 `_check_repeat(len(s) * s.n_frames, …)`；文案不变；`/build/crystal`（`:56`）新建的晶体只有一帧，不受影响 |
| E-64 | **`CRYSTALLUME_MAX_PAIRS` 注释不实**（`server/routes/analysis.py:35` 说可覆盖，实际没有代码读它，`:47` 的 `getattr(settings, "max_pairs")` 恒为缺省） | 04 §3.2 | **[新派]** F0-D T6（该文件在 T6 的 O-6 中）：删掉 `getattr` 与不实注释，`MAX_PAIRS = 50_000_000` 保持常量；可配置性无消费方，推迟 |
| E-65 | JS `toJSON` 省略空的 `frames`、`props`、`info` | 04 §6.3 | **不改**：文档等价；跨语言比较按规范化后的值（L-F0-27） |
| E-66 | **最小像先 round 再查 27 个像，斜晶胞上错**（`crystallume/analysis/geometry.py:21-40`）：极端剪切给 2.73 Å 而非 0.50 Å；真实斜 c 的 slab 晶胞 2000 个随机矢量中错 2 个；本账本复现：同一 fcc 晶格的斜基 `b' = b + 8a` 上 `get_distance(0, 1, mic=True)` 给 9.99 Å（应为 2.77 Å） | 07 第 13 条、`algo-checks/mic_check.py`、附录 A-1 | **[新派]** F0-D T9（原 M4 T1），算法见 L-F0-20 与 §5 |
| E-67 | **JS `findPeriodicNeighbors` 的像范围上限 4**（`core/bonds.js:96`），平面间距小于 `cutMax/4` 的斜基上漏键：同一 fcc 晶格 `b' = b + 8a` 时配位 11、`b + 12a` 时 4（应为 12）；显示的成键像、补全配位、多面体、配位统计都受影响 | 本账本排查（附录 A-1） | **[新派]** F0-D T9（L-F0-20） |
| E-68 | 选区卡片的距离/角度用 Float32 绘制坐标；找不到全部绘制副本时退回原始存储坐标（`ui/selectioncard.js:66-71`），不取最小像 | 本账本排查 | **[新派]** F0-A T5：找到副本时用 Float64 `r_src + storedImage(model, d)·cell`；退回路径改为以第一个原子为起点的最小像链（`P_{k+1} = P_k + micVector(r_{k+1} − r_k).vector`） |
| E-69 | 双击选分子与片段沿用显示层的键对开关，网页默认设置下设定几何会带动表面金属原子 | 领域 M4 第 1 条 | **推迟到 M4**（第 2 波，`selectMolecule` 建在 M3 的 `bond_graph` 上）；第 0 波的 E-60 修正减轻显示部分 |
| E-70 | 左手晶胞（`det < 0`）被静默接受，VASP 会拒绝 | 领域 F0-D F13、领域 M1 第 7 条、07 §1 | F0-D W10 导出警告（L-F0-25），T6；修正手性的工具归 M1 |

---

## 5. 最小像缺陷（E-66）：修法与 JavaScript 排查

### 5.1 为什么"先 round 再查 27 个像"会错

现行 `minimum_image_vectors`（`crystallume/analysis/geometry.py:21-40`）先在给定基里把分数坐标取整到 [−0.5, 0.5]，再试 ±1 的 27 个组合。只有当基是 Minkowski（或 Voronoi）约化的，最短像才保证落在这 27 个候选里；对斜基，真正的最短像可能要在某个方向平移 2、3……个格矢。例：方晶格的斜基 `[[1,0,0],[10,1,0],[0,0,1]]` 上 `v = (0.3, 0.6, 0)` 给出 2.73 Å，正确值 0.50 Å（`algo-checks/mic_check.py`）。这种基并不罕见：M1 的重定义晶格与非约化超胞矩阵、M6 的晶格匹配、导入的弛豫胞都会产生。本账本复现（附录 A-1）：同一 fcc Pt 晶格写成 `b' = b + 8a` 后 `get_distance(0, 1, mic=True)` 返回 9.99 Å（应为 2.77 Å），`b + 12a` 时 17.75 Å。

### 5.2 修法：带可证上界的精确枚举，约化只为提速（L-F0-20）

对周期轴子集 P 张成的格，记 `h_k` 为 a_k 到其余周期矢量所张子空间的距离。任一矢量 x 在 span(P) 上的投影系数 c 满足 `|c_k| · h_k ≤ |x|`（x 到"c_k = 0"那个超平面的距离不超过 |x|）。先取整得到 v0（|v0| = R 是一个上界），最短像 w 满足 |w| ≤ R，故它的系数在每个方向上 `|c_k| ≤ R/h_k`；枚举 `n_k ∈ [−m_k, m_k]`、`m_k = ceil((R + mic_tie)/h_k + 0.5)` 就**不会漏**。这一条对任何基都成立，所以结果与基无关、可证精确；约化（`reduce_basis`，确定性的逐对尺寸约化）只在候选数 > 125 时用来缩小枚举，不影响结果。并列（长度差 ≤ `mic_tie` = 1e-8 Å）按原基中有效坐标 `round(1e6·(g + 像))` 的字典序取最小，两种语言选出同一个像。

不采用的两种做法：(a) "先 LLL 或 Niggli 约化、再查 27 个像"——LLL 约化本身不保证 27 个候选足够（ASE 是在 Minkowski 约化之后才这样做，并为边界情况另加了零像，issue #772），而 Niggli 归 M1（第 1 波）、且会重定向晶胞；带上界的枚举对任何基都可证正确，约化只剩提速的作用；(b) 只修 Python——JS 的周期邻居有同类的截断问题（§5.3），P1 要求两边一致。

验证（附录 A-1）：5 种晶胞（fcc 斜基 `b+8a`、`b+12a`，极端剪切，斜 c 的六方 slab 胞，六方 p(3×3)）× 62 个矢量 × 两种轴集合（三轴、只 a/b）= 620 个矢量，与足够大的穷举 **0 处不符**；Python 与 JS 选出的像 **0 处不同**（最大长度差 7e-15 Å）。M4 v2 原型（同一规则、无约化分支）另有 1988 个矢量与穷举 0 不符、2544 个矢量两语言 0 差异。

### 5.3 JavaScript 是否有同样的问题

| 代码 | 做法 | 结论 | 处理 |
|---|---|---|---|
| `core/bonds.js` `findPeriodicNeighbors`（`:84-150`） | 按平面间距求每个方向需要的像数 `ceil(cutMax/h_k)`，在 [−margin, 1 + margin] 窗口里枚举候选——这一判据本身是精确的 | **有截断缺陷**：`:96` 把像数上限钳到 4。平面间距 < `cutMax/4`（≈ 0.8–1.25 Å）的斜基上漏邻居：fcc `b + 8a` 配位 11、`b + 12a` 配位 4（应为 12）（E-67）。去掉上限后全部为 12（附录 A-1） | F0-D T9：去掉上限；候选数 > 9261 时在 `reduceBasis` 的约化基里搜索并把偏移换回原基 |
| `render/display.js`（成键像、补全配位、多面体）与 `core/analysis.js` `coordinationStats` | 调用 `findPeriodicNeighbors` | 继承上面的截断 | 随上一行修好 |
| `core/analysis.js` `rdf`（`:9-60`） | 分数差 `v − Math.round(v)` 之后按 `ceil(rmax/h_k)` **全部枚举**，没有上限 | **正确**：取整只是起点，枚举范围由平面间距给出、覆盖所有 < rmax 的像（附录 A-1：六种基上 g(r) 之和相同） | 不改 |
| `render/viewer.js` `measureValue`（`:1949-1961`）与测量线 | 用户点的两个**绘制副本**之间的距离，不做最小像 | 不是最小像问题（测量本来就指定像）；但用 Float32 绘制坐标（E-53） | F0-A T5：测量引用 v2 用 Float64 存储坐标 + 整数像（L-F0-44） |
| `ui/selectioncard.js` `selectionPoints`/`geometryValue`（`:54-71`） | 按接近程度串起绘制副本；找不到时用原始存储坐标 | 退回路径**不取最小像**（跨晶胞面的两原子给出接近 c 的距离）；主路径用 Float32 | F0-A T5（E-68）：Float64 + `storedImage`；退回路径用 `micVector` 链 |
| `io/cif.js:161`（对称等价位置去重） | 分量逐个 `d − Math.round(d)` 与阈值比较 | 正确：只判断"差是否接近整数格矢"（距离 ≈ 0），不需要最小像 | 不改 |
| Python `analysis/neighbors.py` `neighbor_arrays`（`:110-150`） | 与 JS 相同的平面间距判据，**没有上限** | 正确（附录 A-1：斜基上配位都是 12） | 不改 |
| M1 的平移搜索（`M1.md` §3.12，"`tol < h_min/4` 保证就是最小像"） | 分数差取整 | 正确：距离 < h_min/2 时每个系数的绝对值 < 1/2，取整就是最小像 | 不改 |

结论：JavaScript 现在没有通用的最小像函数，也就没有"round + 27"的同款错误；但周期邻居搜索有像数截断（E-67），选区卡片的退回路径不取最小像（E-68）。两者都在第 0 波修。

### 5.4 测试（F0-D T9）

- 金标 `tests/data/geometry/mic.json`（`crystallume.cases/1`，op `micVector`）：上面 5 种晶胞 + Cu c(2×2) 胞 + `[[1,0,0],[7.3,0.4,0],[0,0,10]]`；半格矢组合与随机矢量；三轴与只 a/b；期望值为穷举结果与像；两种语言比较像（逐个相等）与矢量（1e-12 Å）。
- 回归：`Structure(fcc Pt, cell=[a, b + 8a, c]).get_distance(0, 1, mic=True) == 2.7719`（1e-4）；JS `findPeriodicNeighbors` 在 `b + 8a`、`b + 12a` 上配位全为 12；`distance_matrix` 与逐对 `mic_vector` 一致。
- 性能：1 万个矢量 Python ≤ 10 ms（向量化快速路径与逐个结果相同）、JS ≤ 20 ms。

---

## 6. 消费方改动说明（M1–M6 要改的名字与语义）

按定稿前复读的版本逐条列出：M1、M2、M3、M4 按 v2；M5、M6 按 v1 的 §10 加上 v2 已写出的章节（两者的 v2 仍在写）。各模块后续修订已改成下列写法的，视为完成。所有模块共同的三条：**新的公共 API 成员用 `defineApi` 注册**（L-F0-53）、**测试 op 放在 `tests/ops/<module>.py` 与 `tests/js/ops/<module>.mjs`**（L-F0-27）、**自己的 `SURFACE_DEFAULTS` 键在自己的任务里同时加进两份源码表**（L-F0-11）。

### M1（晶胞与晶格工具，按 v2）

1. M1 v2 §10 抄的 F0-D 旧签名改为本账本：`gap_cut(gap)` → `gap_cut(s, axis, *, frame, hint, exclude)` 或直接用 `display_cuts(s)`；`unwrap_along_gap(frac, gap)` → `unwrap_along_gap(frac, cut)`（`cut` 为 GapCut 或窗口起点）；`make_contiguous(..., gap=None)` → `cut=None`；`find_surface_gap` 返回 GapCut；`vacuum_gap_hint` 的文案见 L-F0-17。
2. §3.3.1 的包裹规则"`k == k_vac` 且 `find_vacuum_gap(out, k, min_width=0)` 非空 → `shift_k ← floor(f_k − gap_cut(g))`"→ `k_vac = vacuum_axis(out)`；`cut = display_cuts(out)[k_vac]`（周期轴上必有）；`shift_k ← floor(f_k − cut.lo)`，即窗口 `[cut.lo, cut.lo + 1)`，与显示同一切口（U1）。§3.10.3 Keep the vacuum gap 的展开同样传这个 GapCut（窗口按"移动原子最少"选，不是固定的"中点映射到 (−0.5, 0.5]"）。
3. **`vacuum_axis` 由 F0-D T7 提供**（L-F0-17，定义就是 M1 v2 §3.1 那一条）：M1 T3a 不再向 `analysis/vacuum.py`、`core/vacuum.js` 追加任何函数。
4. **`_adopt` 由 F0-D T1/T2 提供**：`_adopt(other, *, src=None)`，接管所有权、不复制（调用后不再用 `other`），映射取 `src ?? other.source_map`（L-F0-07）；M1 的 R7 后备实现不需要。改晶格后仍由 M1 调用 `mark_edited(s, "cell" | "rotate", rotation=R)`。
5. `app.busy(label) → {set, end}`（§3.16、T7b）→ `app.startTask(label, { cancel })`（L-F0-54），Cancel 由 `cancel` 回调提供。
6. 已按请求加入本账本：`validateParams` 不给无 `default` 的可选参数编值（L-F0-47）、`imatrixInput` 的 `presets(ctx)` 带当前结构与 `positive: false`（L-F0-48）、`latticeChanged` 与 `imageShift` 的重映射顺序（L-F0-44）、用例的 `{"recipe": …}` 输入（L-F0-27）。M1 的 R8（拆命令）不需要。
7. JS 原位方法只经 `_adopt` 或 `writeFrame` 写回，不直接写 `_base`/`_baseCell`（L-F0-06）；刚性重定向若用 `setPositions` 写坐标，传 `{ mark: null }` 再 `markEdited(s, 'rotate', { rotation })`。
8. `info.surface.normal` 乘 R 可照做（说明性字段，F0 不读）；轴置换时同步 `info.surface.axis`（F0-A §10.2，应该）。
9. "Make supercell real""Wrap atoms into cell"归 M1：成功提示用 `toastUndo`，烤入显示超胞传 `latticeChanged: true`，包裹传 `imageShift`；同一事务里复位 `display.supercell`。
10. 公共 API（`edit.setCell`、`edit.makeSupercell`、`lattice.*` 追加项）经 `defineApi`；`cell.conventional` 等新命令按 L-F0-52 的字段注册。

### M2（切面与 slab，按 v2）

M2 v2 已按 U1–U4 改好（pbc T T T、`vacuum` 必填、去掉 `banner`、`touch()`、用 `surface_normal(s).cut`、`find_surface_gap` 代替 `detect_slab`）。剩下的改动：

1. `make_contiguous(s, 2, gap=切口)`（§3.14 第 5 步）→ `make_contiguous(s, 2, cut=sn["cut"])`；每个原子的整数平移用 `contiguous_shifts(s, 2, cut=…)`（L-F0-18），不再请求 `return_shifts=True`，也不必自己用 `unwrap_along_gap(f) − f` 计算。W14 退回"最宽间隙"时把窗口起点（数）作为 `cut` 传入。
2. "没有表面"的报错（§6.1 的 `'{s.name}' has no vacuum gap or non-periodic axis; cleave a surface first`）→ 用 `require_gap(s)`，文案即 `vacuum_gap_hint`（L-F0-17：所有表面工具同一句话，界面经 `requireVacuumGap`）；需要提示"先切面"时作为第二句附在界面上。
3. 启动顺序"`main.js` 在注册 Cleave 分区与发出 ready 之前 `await loadOxidationStates()`"→ `registerBootTask('oxidation-states', loadOxidationStates)`（L-F0-56），M2 T2 不改 `main.js`。
4. 命令：`surface.cleave` 的参数名 `miller`、新增 `surface.flip`、`surface.center` 已写进命令表（L-F0-52）；`surface.supercell` 不存在。
5. 公共 API `crystallume.surface.cleave`、`build.surface/terminations`、`edit.setVacuum/addVacuum/centerSlab/flipSlab` 经 `defineApi`（`surface` 已在 `API_NAMESPACES` 中）。
6. Python `METALS`/`ANIONS` 由 M2 T2 加进 `core/elements.py`，内容与 JS 逐项相同（L-F0-22）。
7. M2 v2 R13（"F0-A 与 F0-D 对共用切口的描述还不一致"）已由本账本 L-F0-16 解决：M2 只经 `surface_normal`/`require_gap` 的 `cut` 与 `make_contiguous` 使用切口，无需再改。
8. 照旧有效、再确认一次：`addStructure` 返回 `{entry, historyEntry}`；新 slab 从新的 info 开始；`info.surface` 必须是纯 JSON 并含 `axis`（F0 只读这个键）；`apply_basis_change` + `mark_edited(s, "cell")`；`canonical_order` 等价的原子顺序（K14）。

### M3（层、几何选择与约束界面，v2）

1. 约束：`move_flags`、`set_move_flags`、`clear_constraints`、`constraint_summary`、`axis_labels`、`cartesian_name` **都由 F0-D T3 提供**（L-F0-13）；M3 T4 不再"若 F0-D 未提供则写进 `core/constraints`"；不再依赖 `constraint_counts`、`constraint_axis_names`（前者用 `constraint_summary`，后者用 `axis_labels` 三项是否都是笛卡尔名）。
2. 沿 slab 轴的切口（K2、§3.3 表的 `periodic` 行：`find_vacuum_gap(s, axis, min_width=0)` + `unwrap_along_gap(f, gap)`，"cut 为间隙中点映射到 (−0.5, 0.5]"）→ `cut = surface_normal(s, require_gap=True)["cut"]`（或 `display_cuts(s)[axis]`）+ `unwrap_along_gap(f, cut)`（L-F0-16）。slab 轴非周期时 `unwrap_along_gap` 恒等。非 slab 的周期方向"切在环上最宽的间隙"照旧，用 `find_vacuum_gap(s, k, min_width=0)` 的结果自己算窗口起点并以数值传给 `unwrap_along_gap`。
3. `surface_normal(s, require_gap=True)` 已提供；返回键 `vacuum_axes`（JS `vacuumAxes`）。
4. §10.1-8 的"修改计数名字统一为 `version`"→ `rev`（M3 不用它，无代码改动）。
5. F0-A：`registerHoverLine` → `registerAtomInfo`（返回 `[{label, value}]`）；选区动作的 `items`、`rows`、`menu: 'blank'`、`enabled`、label 函数由 F0-A T10 提供（L-F0-50）；**Fix ▾ 的 order 用 35**（不是 15）；配色 `extras` → `app.registerColorExtra('layers', …)`（L-F0-51）；Constraints 分区 `registerPanelSection('structure', { id: 'constraints', slot: 'transform', order: 20 })`；光环名字与颜色归 M3（`export: 'marker'`）；`shell.floatingCard` 不在 F0-A-core，M3 先自己实现。
6. `smartPairDefault` 的现有缺陷由 F0-A T5 修（L-F0-55，与 M3 `bond_graph(metal_pairs="smart")` 同一定义），M3 不需要改显示代码。
7. 球形选择与 `distance` 查询用 F0-D T9 的 `mic_vector`（第 0 波已修好）。
8. `crystallume.edit.fix/free`、`crystallume.analysis.layers` 用 `defineApi`；M3 T6 的文件表去掉 `api/public.js`。

### M4（原子操作，v2）

1. **`mic_vector`/`micVector`/`minimum_image_vectors` 由 F0-D T9 在第 0 波交付**（L-F0-20）：M4 T1 删去这一项，只在 `core/geometry.js`、`analysis/geometry.py` 追加 `rotation_matrix`、`align_rotation` 等；`SURFACE_DEFAULTS.mic_tie` 已在 F0 的表里，M4 不再加。
2. `edit_frame`（§3.2.1：`gaps = {k : find_vacuum_gap(s, k)}`、`cut[k] = centre > 0.5 ? centre − 1 : centre`、`shift = −floor(f − cut[k])`）→ `cuts = display_cuts(s)`，`shift_i,k = −floor(f_i,k − cuts[k].lo)`，`mic_axes` = 周期轴中 `cuts[k] is None` 的轴；与显示逐字同一切口（U1）。
3. F0-A 改名：`banner` → `transient`（拖动会话传 `transient: true`，Transform 分区不传）；`ToolHandler.selectFallback` 删除（由 `ToolDef.selects`）；`hover(hit, e)`；新增 `begin()`；A-CR1 由测量引用 v2、A-CR4 由延迟认领代替；`homeOffsets(structure, display, {cuts})`；`surfaceNormal` 看 `.surface`；P-pos 提交选项 `singleFrame`（不是 `keepFrame`）。
4. F0-D：`keep_frame(index=0)`/`keepFrame` 已提供（删去 M4 的后备实现）；**JS `extend` 由 F0-D T2 实现**，M4 往两种语言的 `extend` 追加仅限关键字的放置参数，保留 `renumber_adsorbates=True`；`_remap` 返回 `self`；读约束用 `moveFlags`/`move_flags`；移动部分原子用 `set_positions(..., mark="positions")`。
5. 扩展 `translate(vector, *, indices=None, frac=False)` 时，给了 `indices`（部分原子）必须 `mark_edited(s, "positions")`；全部原子平移不调用。
6. `crystallume.edit.translate/rotate/...` 用 `defineApi`。

### M5（吸附物，按 v1 §10 + v2 已写出的 §0–§7）

0. **v2 已有章节**：`surface_setup` 用 `surface_normal(view(s, sub), frame)` 在只含基底的视图上求法向与切口——改为 `surface_normal(s, frame=frame, exclude=吸附物下标)`（R16，L-F0-17，不必建视图），E3 文案用 `vacuum_gap_hint(s, exclude=…)`；展开 `m_t = −floor(f_t − sn.cut.lo)` 与 `unwrap_along_gap` 一致，保留。v2 已改好的：`tools.register({... cursor: 'crosshair'})`、`drawnCopies(points, model, {repeat: true})`、`registerAtomInfo`。M5 v2 §3.1 建议"显示也传 `adsorbate_id > 0` 的原子"——**不采纳**（R16）。

1. `find_vacuum_gaps(s, frame=0)`（E3/E4）→ `require_gap(s)`（没有表面时抛 `ValueError`，文案即 `vacuum_gap_hint`）；上表面、窗口用返回的 `cut` 与 `unwrap_along_gap`（L-F0-16/17）。
2. `registerTool({...})` → `tools.register(ToolDef)`；`cursor: 'target'` → `'crosshair'`（图标仍是 `target`）；`handler.hover(hit, e)`、`click(e, hit) → boolean`、`claims: () => false`。
3. `drawnCopies(points, viewer, …)` → `drawnCopies(points, model, { repeat })`；位点标记 `markerLayer({ tier: 'top', export: 'marker', pickIn: ['site-pick'] })`。
4. 悬停幽灵用 `ghostLayer`（**不开会话**）；调高度/取向时才开 P-ghost 会话；放置 `editActive(..., { singleFrame: true })`。
5. 新原子 `tags = 0`、`adsorbate_id = next_adsorbate_id(slab)` 经 `added_props` 传入；放置前 slab 已按元素分块时，同一编辑步内追加后 `sort_by_species()`（K14）。
6. smart 配位数与显示同一定义（L-F0-55、M3 `bond_graph(metal_pairs="smart")`）；吸附高度、重叠只用共价半径或 `bondi_radius`。
7. 分区 `registerPanelSection('surface', { id: 'adsorbates', order: 40 })`；`crystallume.build.adsorbates`、`edit.addAdsorbate`、`analysis.sites` 用 `defineApi`。
8. `overlaydblclick`、`overlaycontext` 已在事件表中；触屏长按属可选 C2，桌面右键是必须项。

### M6（界面与异质结，按 v1 §10 + v2 已写出的 §0–§5）

0. **v2 已有章节**：`standardize_slab` 第 1 步的"`find_vacuum_gaps` 求宽轴、≥ 2 根 → E4；`g ← find_surface_gap(s)`（≥ 5 Å 的最宽间隙，没有时退回 `info.surface.axis` 上最宽的间隙）"→ 一律 `sn = require_gap(s)`（多根真空轴时 `surface` 为假，报 `vacuum_gap_hint` 的多轴文案，即 E4）；`k = sn["axis"]`，展开 `unwrap_along_gap(f_c, sn["cut"])`（提示轴须 ≥ 2 Å 且仍是最宽真空，L-F0-17）。v2 已改好的：`registerPanelSection`、`beginStructureEdit('Build layers', …)`、`toastUndo`、`numberInput({required: true})`、`imatrixInput({size: 2})`、`concat_structures`、`mark_edited`、`bondi_radius`、在源码表中加 `interface_layer`；不用 `startTask`（符合 L-F0-54）。

1. **结果 `pbc = [T, T, T]`**（U2）；**`vacuum` 必填、无 15 Å 缺省**，含义为总间隙（U4）。
2. `registerSurfaceSection(...)` → `registerPanelSection('surface', { id: 'interface', order: 50 })`。
3. `app.showStructurePreview(...)` → `beginStructureEdit(label, { kind: 'structure', commitLabel: 'Create', onEnd })` + `preview(s)` + `commit({ addAsNew: true, name })`；`fit: 'first'` = 第一次预览后 `viewer.fitView()`。
4. `addStructure(...)` 返回 `{entry, historyEntry}`（id 为 `entry.id`）；`toast(msg, {action: {label: 'Undo', run}})` → `toastUndo(msg, { entry })`；`inputs.number/imatrix/vector` → `numberInput`、`imatrixInput({ size: 2 })`、`vec3Input({ size: 2, labels: ['u', 'v'] })`；`app.busy(label)` → `app.startTask(label)`。
5. `PROP_DEFAULTS["interface_layer"] = 0` → 在 M6 的任务里加进两份源码表；`_remap(src, defaults=PROP_DEFAULTS)` 与 `concat_structures(..., defaults=PROP_DEFAULTS)` → 不传 `defaults`（或只传覆盖值，如 `{"interface_layer": 2}`）；`concat_structures` 不返回逐部分映射，用连续区间规则（L-F0-08）。
6. `transform_selective_dynamics(...) -> (list, list[str])` → `transform_move_flags(...) -> (flags, n_tightened)`，需要备注时用 `apply_basis_change`；标志按各层**应变后**的晶胞换算到合并晶胞。
7. `invalidate_symmetry_info(info) -> None`、`add_warning(info, text) -> None` → 都返回 `info`；改用 `mark_edited`。
8. 两种语言一致的 `vdw_radius` → `bondi_radius`/`bondiRadius`（L-F0-22）。
9. `M2.detect_slab(s)` 与 `{"isSlab", "axis", "gap"}` → `require_gap(s)` / `surface_normal(s, require_gap=True)`；`SURFACE_DEFAULTS.slab_min_gap` → `vacuum_gap_min`。
10. 面内接触距离"先约化再查 9 个像"→ `mic_vector(v, cell, pbc, axes=(0, 1))`（可证精确）。
11. `crystallume.build.interface` 用 `defineApi`；`interface_*` 常量在 M6 的任务里加进两份 `SURFACE_DEFAULTS`。

---

## 7. 第 0 波任务的调整（相对 F0-D §9、F0-A §9）

| 任务 | 增加或改变的内容 | 新增/改动的文件 | 规模变化 |
|---|---|---|---|
| F0-D T0 | `tests/ops/__init__.py`（按文件名排序自动导入 `tests/ops/*.py`）、`tests/js/ops/`（`cases.test.mjs` 自动导入）；`load_cases` 递归读 `tests/data/**/*.json` 中 `schema == "crystallume.cases/1"` 的文件；配方输入 `RECIPES`/`@recipe` 与 JS `recipe()` | `tests/ops/__init__.py`、`tests/ops/f0d.py`、`tests/js/ops/f0d.mjs` | 不变（S） |
| F0-D T1/T2 | `_adopt(other, *, src=None)`（M1 v2）；`write_frame`/`writeFrame`；`set_positions(..., mark=)`；`Structure.move_flags()`/`constraint_summary()` 调用 T3 的函数（不是 `get_move_mask`）；JS `extend` | — | 不变（M） |
| F0-D T3 | 加 `move_flags`、`set_move_flags`、`clear_constraints`、模块级 `constraint_summary`、`axis_labels`、`cartesian_name`（规则 L-F0-13） | — | S → S+ |
| F0-D T6 | `server/routes/build.py:95` 的原子数估算按 `len(s) × s.n_frames`（E-63）；`server/routes/analysis.py:35, 47` 的不实注释与死代码（E-64） | `server/routes/build.py`（只改这几行；F0-A T8 改 126-147 行，先合者为准，冲突只在行段之外） | 不变（M） |
| F0-D T7 | 真空模块按 L-F0-15–18 实现，**含 `surface_normal`**（原 F0-A T7a）、`display_cuts`、`require_gap`、`vacuum_axis`、`contiguous_shifts`、分析函数的 `exclude` 参数、新 `gap_cut`/`unwrap_along_gap`/`find_surface_gap`/`vacuum_gap_hint`、`make_contiguous` 的切口来源、JS 缓存；`SURFACE_DEFAULTS` 一次建好 L-F0-11 的 9 个键；金标 `tests/data/surface/f0d/vacuum.json` + F0-A 的 `gaps.json`（按 1e-5 并列容差重生成） | — | S → M |
| F0-D T8 | 公共 API 经 `defineApi` 注册（依赖 F0-A T2 的 `api/namespaces.js`） | — | 不变 |
| F0-D T9 | **精确最小像**（Python `mic_vector`、`minimum_image_vectors` 新实现、`Structure._vector`、`distance_matrix`；JS `micVector`、`reduceBasis`）；`core/bonds.js:96` 去掉像数上限（E-67）；Python `signed_angle`；JS `covalentRadius`/`bondiRadius`；金标 `tests/data/geometry/mic.json` | `crystallume/analysis/geometry.py`、`web/js/core/bonds.js`、`tests/test_geometry_mic.py`、`tests/js/geometry.test.mjs` | S → M |
| F0-D T11 | 文档另含 E-29 | — | 不变 |
| F0-A T2 | `api/namespaces.js`（`defineApi`，L-F0-53）；`startTask(label, {cancel})`；toast 改在 **`ui/overlays.js`**；Structure 面板 `Replace… Apply` 加 `toastUndo`（E-49）；`rebuild` 取值校验 | `web/js/api/namespaces.js`（新）、`ui/overlays.js`（代替不存在的 `ui/toast.js`） | M → M+ |
| F0-A T4a | `app.registerColorExtra` 与 `ctx.extras`（L-F0-51） | — | 不变（L） |
| F0-A T4b | `EVENTS` 加 `overlaydblclick`、`overlaycontext` | — | 不变 |
| F0-A T5 | 切口一律取 `displayCuts`（不自写提示轴逻辑）；`smartBondFilter`（E-60，L-F0-55）；`appearance.js:402`（E-56）；测量稳定 id（E-46）；选区卡片 Float64 与最小像退回（E-68，`ui/selectioncard.js:54-71`） | `ui/panels/appearance.js`（`:402`、`:512-517`） | L → L+ |
| F0-A T7a | `surface_normal` 移交 F0-D T7；本任务只追加 L-F0-46 的晶格函数、`core/lattice.js` 重新导出 `surfaceNormal`；`crystallume.lattice` 经 `defineApi` | 不再改 `core/vacuum.js`、`analysis/vacuum.py` | M → S |
| F0-A T10 | `registerSelectionAction` 的扩展（label/icon 函数、`enabled`、`items`、`rows`、`menu: 'blank' \| 'both'`、`ctx`、配额规则）与 `registerAtomInfo` 的 `ctx.where`（L-F0-50）；`core/boot.js` 的 `registerBootTask` 与 `main.js` 的等待（L-F0-56） | `web/js/core/boot.js`（新） | 不变（L） |
| F0-A T8 | `defaultParams` 与 `validateParams` 的缺省值规则（L-F0-47）；`imatrixInput` 的 `presets(ctx)`、`positive: false`（L-F0-48） | — | 不变（L） |
| F0-A T9 | 命令表加 `surface.flip`、`surface.center` 的回退实现，`surface.cleave` 参数名 `miller`（L-F0-52） | — | 不变 |
| F0-A T11 | 文档另含 E-59 | — | 不变 |
| M4 T1（第 2 波） | 删去 `mic_vector`/`micVector`（已由 F0-D T9 交付） | — | L → M |

里程碑 F0-A-core（第 1 波开工条件）不变，另加：F0-D T3、T7 必须先合（M1/M2/M3 都依赖 `surface_normal`、`display_cuts`、约束函数）。

---

## 附录 A：本账本的核对脚本（`scratchpad/proto/xcheck/`，均已运行）

| # | 文件 | 内容 | 结果 |
|---|---|---|---|
| A-1 | `mic/py_mic_audit.py`、`mic/js_mic_audit.mjs`、`mic/mic_ledger.py`、`mic/mic_ledger.mjs`、`mic/cases.json`、`mic/jscopy/`（只读复制的 `core/`，去掉 `bonds.js:96` 上限后的对照） | 仓库现有最小像与周期邻居在同一 fcc 晶格的斜基（`b' = b + m·a`）上的表现；L-F0-20 规则的 Python/JS 参考实现与穷举对比 | Python `get_distance(mic=True)`：m = 8 时 9.99 Å、m = 12 时 17.75 Å（应为 2.77 Å）；Python `neighbors` 全部 12；JS `findPeriodicNeighbors`：m = 8 时 11、m = 12 时 4，去掉上限后全部 12；JS `rdf` 六种基相同；L-F0-20 规则 620 个矢量与穷举 0 处不符，Python/JS 像 0 处不同（最大长度差 7e-15 Å） |
| A-2 | `gap/wrapcmp.py` | F0-D v2 的 `find_vacuum_gap` 在 `wrap_fractional`（1e-12）与本账本的 `gap_wrap_eps`（1e-6）两种包裹下的结果 | 403 个结构（含 400 个"两个相同 slab"的任意取向晶胞、负零、吡啶场景）0 处不同 |
| A-3 | `gap/vacgap_ledger.mjs`、`gap/cmp.mjs` | F0-A 原型 `vacgap.mjs` 改为并列容差 1e-5 Å、阈值带容差后，在 F0-A 的 89 个金标结构上的切口与法向 | 0 处不同（规则、窗口、主块、来源、`surface` 全部一致） |
| A-4 | `split_sections.py` | 把各模块规格按二级标题拆开阅读（不改规格） | — |

运行：
```
cd scratchpad/proto/xcheck/mic && python3 -I py_mic_audit.py /home/user/crystallume && /opt/node22/bin/node js_mic_audit.mjs /home/user/crystallume/crystallume/web/js \
  && /opt/node22/bin/node js_mic_audit.mjs "$PWD/jscopy" && python3 -I -B mic_ledger.py cases.json && /opt/node22/bin/node mic_ledger.mjs cases.json
cd ../gap && python3 -I -B wrapcmp.py && /opt/node22/bin/node cmp.mjs ../../f0a_v2/cases.json
```
