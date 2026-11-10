# F0-D 数据与读写地基 — 模块规格 v2

作者：F0-D 设计者。依据：`design/00-architecture.md`（以下"简报"，含文首用户决定 U1–U6）、`maps/01`、`04`、`05`、`06`、`07`，
已写好的 `specs/F0-A.md` 与 `M1.md`–`M6.md` 中对 F0-D 的需求（各自 §10），两份审查 `reviews/F0-D-domain.md`（以下"领域 F*n*"）
与 `reviews/F0-D-engineering.md`（以下"工程 #*n*"），以及对仓库源码的复核（HEAD `1bb366f`，v0.3.1）。本规格不修改仓库。

- v1 原文保存在 `specs/F0-D.v1.md`。v2 的逐条修改见文末"修订记录"，未采纳的意见见"未采纳的意见"。
- **v2 最大的变化**：按用户决定 U1–U4 删除了导入时识别 slab 的整条链（改 pbc、移动原子、toast、偏好开关、`detect_slab`），
  改为只读的真空间隙原语；Facet 生成的 slab 一律 `pbc = [T, T, T]`；按消费方（F0-A、M1–M6）的期望定稿了全部接口（§10.0）。
- 原型：v1 在 `scratchpad/proto/f0d/`，v2 在 `scratchpad/proto/f0d/v2/`（附录 A）。

文中 `structure.py` = `facet/core/structure.py`，`structure.js` = `facet/web/js/core/structure.js`，行号指当前 HEAD。
标记：**[V]** 本人运行验证，**[S]** 读源码确认，**[决定]** 本规格的决定（含理由），**[U]** 按用户决定修改。

---

## 0. 摘要

### 0.1 本模块交付什么

所有表面功能共用的数据地基，分七块：

1. **props 不变量（C2）**：I1 长度恒等、I2 不共享可变值、I3 一切改变原子集合的操作走统一的 `remap`；两种语言各一份冻结的
   `PROP_DEFAULTS` 与按键规范化器；修掉 01/05 报告列出的全部 props 缺陷。
2. **源映射与修改追踪**：`source_map` 记录"自诞生以来"的累计映射；`track_changes()` 的追踪会话跟随派生结构，
   F0-A 的 `editActive` 因此在任何写法下都拿到正确的 `indexMap`；JS 的修改计数 `rev` / `touch()`、`setPositions`、`keepFrame`。
3. **编辑后的派生信息**：`info.warnings` 作为结构的持久"备注"（C8），toast 只显示本步新增的备注；
   一张表规定每种编辑清除哪些派生信息——空间群（C7）、计算结果（能量、力、应力）、构建参数——统一入口 `mark_edited`。
4. **约束与标签（C3/C4）**：`props.selective_dynamics` 的存储、规范化、基变换规则（精确算法、只收紧不放松）、
   晶格↔笛卡尔换算；`tags`、`adsorbate_id`（合并时重新编号）；`concat_structures`。
5. **读写**：两种语言的 POSCAR（容错 T/F、写 SD、保留重复元素块、XDATCAR 可变晶胞）与 extxyz（ASE `move_mask`、tags、
   与 ASE 互通的 info 写法、类型保护、JS 读写器补全）；写出器能力表与导出检查（警告与说明两级），贯通 REST / CLI / 客户端 / 网页。
6. **真空间隙（U1）**：只读的 `find_vacuum_gap` 及其共用切口 `unwrap_along_gap`，供 F0-A 显示、M3/M5 上下表面、M2 slab 工具使用；
   只有显式编辑（M2 的居中、改真空）才调用 `make_contiguous` 移动原子。导入、显示都不改结构。
7. **跨语言测试桥与公共用例格式**，以及 D7 要求的二面角符号、默认参数表、元素数据（含 Bondi 半径）对齐。

### 0.2 关键决定一览

| 编号 | 决定 | 理由（简） | v2 |
|---|---|---|---|
| K1 | 源映射统一用整数数组，`-1` = 新原子（Python `np.ndarray[int64]`，JS `Int32Array`）；输入也接受 `None`/`null` | 可直接花式索引；与 `indexMap`（`-1` = 删除）同一约定 | 不变 |
| K2 | `source_map` = 自诞生以来的累计映射（派生时相对输入、之后每次 remap 组合）；`track_changes()` 的会话跟随派生结构，`stop(result)` 给出起点到 `result` 的映射，`result` 不在会话中时返回 `None`；`compose_source_maps` 校验能否衔接 | v1 只记最近一次，"先派生再编辑"时 JS 静默给出错误映射（工程 #3）；原型 6 种写法两种语言都正确 | **改** |
| K3 | 部分约束在基变换下"只收紧不放松"：`g_j = (b_j ∈ S)`，`S = span{a_k : f_k}`；不精确时警告 | 永不让固定方向变得可动；面内变换下 `[T,T,F]`、`[F,F,T]` 精确（两份审查独立复核） | 不变 |
| K4 | extxyz 只写 ASE `move_mask`（U5/D5）；能写宽度 1 就写宽度 1；不得不写宽度 3 时给出导出警告（ASE 的 VASP 写出器忽略 `FixCartesian`，所有原子会被放开）；全部可动时省略 | 领域 F4 实测 ASE 3.29 静默丢约束 | **改** |
| K5 | **[U]** 导入不做任何 slab 识别：不改 pbc、不移动原子、不弹提示；只提供只读的 `find_vacuum_gap` / `find_surface_gap` / `unwrap_along_gap`；`make_contiguous` 只供显式编辑调用 | U1 | **改**（原"导入检测"删除） |
| K6 | **[U]** Facet 生成的 slab 一律 `pbc = [T, T, T]`；导入的文件保留文件里的 pbc；`set_pbc` 只改 pbc、无副作用 | U2 | **改**（原"断开复原"删除） |
| K7 | `info.warnings` = 结构的持久备注（唯一键，去重）；读取器与编辑照常 `add_warning`；toast 只显示本步新增的备注（差集）；extxyz 不写 `warnings`；旧 `info.warning` 整条迁入 | 工程 #7、领域 F16：v1 会把一次性的警告在每次打开文件时重新弹出 | **改** |
| K8 | 三个失效函数（空间群、计算结果、构建参数）+ 统一入口 `mark_edited(s, kind)`，一张表规定每种编辑清除什么 | 领域 F3/F17、工程 #6：编辑后陈旧的 DFT 能量会被写进导出文件，ASE 当成新结构的能量 | **改** |
| K9 | 导出检查分两级：**警告**（影响计算或丢失数据）与**说明**（不影响计算）；POSCAR 的原子顺序提示降为说明；新增左手晶胞、原子重叠、`FixCartesian` 三项检查 | 领域 F6/F13；K9 原则本身不变 | **改** |
| K10 | 现有方法的轨迹语义两种语言对齐到 Python：`wrap`、`repeat` 处理所有帧；C11"只作用于当前帧并丢弃其余帧"在**界面命令**层执行（`keep_frame`/`keepFrame`） | 保持 Python API 兼容；P1 | 补 `keepFrame` |
| K11 | 二面角统一 IUPAC 符号（改 JS），核心函数两种语言都返回 [0, 360)，界面显示 (−180°, 180°] | Python/ASE 现行约定 | 升为"必须"（U5/D7） |
| K12 | 测试桥：`tests/js_bridge.py` + `js` fixture + `tests/js/*.test.mjs`（由 Python 列出文件逐个传给 `node --test`）+ 公共用例外壳 `facet.cases/1`（所有模块共用）；**Node ≥ 22** | 工程 #9：`node --test 目录` 在 Node 22/24 上失败，Node 20 已停止维护 | **改** |
| K13 | JS 修改计数名为 `rev`，`touch()` 递增并返回 `this` | F0-A A4 与 M1 已按此写（工程 #2 建议用 `version`，未采纳，见文末） | 新 |
| K14 | 生成器的原子顺序推荐 `canonical_order`：先按元素分块（首次出现顺序），块内按层从下到上；POSCAR 物种行重复元素时用 `props.poscar_species` 保留各块 | 内存顺序 = POSCAR 顺序，CONTCAR 序号与界面一致；重复块（赝氢、反铁磁分块）往返不丢（领域 F6/F7） | 新 |
| K15 | extxyz info 的写法与 ASE 互通：`stress`/`virial` 写 9 个数，一维数值/布尔列表写空格分隔，读回会变类型的字符串写成 `_JSON "…"`，只有嵌套、字典、字符串列表等才用 `_JSON`；数字解析只认 ASCII | 领域 F5、工程 #5/#12/#13：v1 写法让 ASE 打不开文件；原型 33 个键 × 4 个方向 0 处不一致，ASE 3.29 读得回 | 新 |
| K16 | 元素数据：新增 `bondiRadius`（两种语言）；新算法只用共价半径或 Bondi 半径；`vdw_radius`（Python，Alvarez 2013）与 JS 显示半径不供算法使用 | M6 需要两种语言一致的 Bondi 半径；现有两套范德华半径有 21 个元素不同 [V] | 新 |

### 0.3 已验证的关键事实

v1 原型（`proto/f0d/`）：
- remap、默认值、约束基变换、POSCAR 标志词法、extxyz 键值词法：Python 与 JS 在 40 个随机 remap、480 个随机基变换标志、
  键值行与标志行上 **0 处不一致** [V]。
- 性能 [V]：JS `remap` 1 万原子 3.6–9 ms，标志基变换 3.3 ms；Python `_remap` 31 ms、基变换 7.3 ms（工程审查复现）。
- ASE 3.29（开发期 venv，不是依赖）[V]：FixAtoms → `move_mask:L:1`；有 FixCartesian 时 → `L:3`；**FixScaled 被静默丢弃**；
  ASE 读入我们计划写出的 `move_mask:L:3` 得到逐原子 FixCartesian，`tags:I:1` → tags。

v2 原型（`proto/f0d/v2/`，本次）：
- **真空间隙** [V]（`run_gap2.py`）：454 个情形（18 种场景 × 3 种平移 + 400 个任意取向的"两个相同 slab"晶胞）上，Python 与 JS 的
  `find_vacuum_gap`、`find_surface_gap`、`unwrap_along_gap`、`make_contiguous` 结果 **0 处不一致**。v1 的"并列取第一个"规则在同样的
  400 个晶胞上有 174 个不一致（工程 #4 复现）。各场景结果：Pt(111) p(3×3) 4L 沿 c 15.00 Å；底层被包裹到顶部的 CONTCAR 14.95 Å，
  显式 `make_contiguous` 移动 9 个原子；Cu(100) 15.00 Å；MoS2（TTT）11.83 Å；15 Å 盒子里的 CO、Au 线取 b 轴；
  石墨烯（TTF）、体相 Cu、石墨、金红石、SrTiO3、纤锌矿、bcc Cs/Rb 与 fcc Xe 原胞均无间隙；底层在 f = −1e-17 与在 0 结果相同；
  Pt(111) 10 Å 真空 + 直立吡啶：没有 ≥ 5 Å 的间隙，有 `info.surface.axis` 时退回该轴最宽的 3.30 Å（领域 F10 复现）。
- **源映射** [V]（`srcmap2.py`、`srcmap2.mjs`）：原位编辑、先删后派生、先派生后删、多级派生、派生后再改父结构、复制后排序 6 种写法，
  两种语言给出的映射都与逐原子标签一致；`fn` 返回无关的新结构时得到 `null`（要求调用方给 `indexMap`）。
- **extxyz info** [V]（`run_info2.py`）：33 个键（能量、3×3/Voigt 应力、整数 virial、偶极、`"225"`、`"T"`、`"1 2 3"`、`"false"`、含引号与
  反斜杠的字典、超过 2^53 的整数、`"1_000"`、`"inf"`、阿拉伯-印度数字……）在 Py→Py、JS→JS、Py→JS、JS→Py 四个方向 **0 处不一致**；
  ASE 3.29 读入两种语言写出的行，stress、能量正确，字符串保持为字符串。
- **ASE 互通缺陷**（审查者的原型，本人重跑确认）[V]：宽度 3 的 `move_mask` → ASE 读成 4 个 FixCartesian → `write_vasp` 输出 4 行
  `T T T`、无任何警告；v1 写法的 `stress="_JSON [...]"` → ASE `ValueError`；编辑后保留的 `energy=` 被 ASE 当作新结构的能量；
  ASE 自己写出含引号的 `_JSON` 读不回（`JSONDecodeError`），含反斜杠的被**静默改坏**（`a\b` → `a\x08`）。
- **重叠检查** [V]（`contacts2.py/.mjs`）：1 万原子 Pt slab 中两处人为重叠，两种语言找到相同的两对；JS 34–89 ms、Python 110 ms（未优化）。
- **VASP wiki**（POSCAR 页，本次下载核对）[V]：SD 标志"refer to the positions of the ions in direct coordinates, no matter whether the positions
  are entered in Cartesian or Direct coordinate modes"；`ML_LMLFF = .TRUE.` 时不允许不同的原子组同名；物种名只取前两个字符。
- **Node** [V]：Node 22.23 上 `node --test --test-reporter=tap js/` 退出码 1（`Cannot find module …/js`），显式列出文件时通过。

---

## 1. 用户故事与 Materials Studio 对照

### 1.1 用户故事（逐个走查简报场景中与本模块有关的部分）

1. **VASP CONTCAR 导入**（pbc T T T、有 Selective dynamics、底层在分数 z = 0，两个底层原子被 VASP 包裹到 0.99999）：
   - 今天：网页 POSCAR 读取器丢掉 T/F 标志；底层在真空顶部多画一份（报告 03 §2.3）。
   - F0-D 之后：标志进入 `props.selective_dynamics`；pbc 仍为 T T T，坐标与文件完全相同（U1）；toast 照旧
     `Loaded CONTCAR — 36 atoms`（只有读取器发现问题时才附上说明）。F0-A 的显示用 `find_vacuum_gap` 的切口把底层画在底部（F0-A §3.8.2）。
   - 不做任何编辑直接导出 POSCAR：原子顺序、SD 标志逐行相同，坐标差 ≤ 1e-8 Å，没有警告（U1 验收用例，§7）。
2. **Pt(111) p(3×3) 4 层、底 2 层固定、CO 放在 fcc 空位和顶位，导出带 SD 的 POSCAR**（M2/M3/M5 建模，本模块保证数据）：
   - 切面结果 `pbc = [T, T, T]`（U2），写入 `tags`（1 = 顶层…4 = 底层）；固定写 `[F,F,F]`；每放一个吸附物，新原子得到
     `selective_dynamics = [T,T,T]`、`tags = 0`、`adsorbate_id = 1, 2…`（缺省值来自 `PROP_DEFAULTS`，不再是 `None`）。
   - 导出 POSCAR：18 行 `F F F`，CO 原子 `T T T`。放第二个 CO 时 M5 保持按元素分块（§10.6），文件顺序与内存相同，没有说明；
     若用户自己打乱了顺序，Export notes 里有一条说明（不计入警告）。
3. **Cu(100) c(2×2)-O、Ag(111) (√3×√3)R30°**：先固定底层再做面内超胞（M1 的 `make_supercell`），`[T,T,F]`、`[F,F,T]`、
   完全固定、完全可动都精确保持（K3）。
4. **金红石 TiO2(110) 删除桥氧做氧空位**：删除走 `remap`，props、选区、测量一起正确重排；`info.spacegroup` 被清除；
   若结构来自带 DFT 结果的 extxyz，`energy`、`forces`、`stress` 一并删除并留一条备注，导出文件里不再有陈旧能量（K8）。
5. **SrTiO3(001)、CeO2(111)、NaCl(100)**：M2 按 `canonical_order` 生成（K14），POSCAR 导出顺序与内存一致；
   部分占位的 CIF 导出 POSCAR 时，重叠原子与"占位丢失"各有一条警告。
6. **石墨烯 / MoS2 单层**：内置二维原型保持 `pbc = [T, T, F]`，从 POSCAR 导入的单层保持文件的 T T T（U2）；改真空用 M2 的工具
   （`find_vacuum_gap(..., periodic_only=False)` 也能量出 TTF 结构 c 方向的间隙）；导出 POSCAR 时给出说明"c 不是周期方向，按 15.0 Å 的间隙写成周期"。
7. **ASE 工作流**：Facet 写出的 extxyz 被 `ase.io.read` 读成 `FixAtoms`/`FixCartesian`、`tags`、`info["surface"]`；ASE 写出的 extxyz
   （含 `move_mask`、`tags`、`_JSON`、`stress`）两种语言读回同样的 props/info，再写出后 ASE 仍能读回（K15）。有部分约束时，导出警告提醒
   "经 ASE 写 POSCAR 会丢约束，请从 Facet 导出 POSCAR"（K4）。
8. **Python 脚本**：`s = cl.read("CONTCAR")`；`s.append("O", p)` 后 SD 不再丢失；`with s.track_changes() as t: ...` 之后 `t.src` 就是新旧原子的对应关系；
   `cl.write("x.cif", s)` 发出 `ExportWarning`。
9. **服务器/插件**：插件写出器签名不变（`func(structure) -> str`），可声明能力表；`/io/export` 响应新增 `warnings`、`notes`；
   CLI 在 stderr 打印 `facet: warning: …` / `facet: note: …`。
10. **大体系**：Pt(111) p(6×6) 6 层（216 原子）与 1 万原子 slab：本模块所有操作在预算内（§7.6）。

### 1.2 与 Materials Studio 对照

| 方面 | Materials Studio | Facet（F0-D 之后） | 差异及理由 |
|---|---|---|---|
| 约束存储 | Modify › Constraints：逐原子"Fix Cartesian position"或"Fix fractional position"，可分 X/Y/Z 或 A/B/C | `props.selective_dynamics`，True = 沿 a/b/c 可动（VASP 语义） | 只存晶格系一种（与 VASP、pymatgen 一致）；笛卡尔约束只在 extxyz 交换时换算（K4） |
| 晶胞变化后的约束 | 分数约束随晶胞基变化（MS 的具体行为未核实） | K3：精确时保持，否则收紧并写备注 | 明确、可测试；永不放松 |
| 层/吸附物标记 | 无通用整数标签；靠集合（Sets） | `tags`（ASE 约定）与 `adsorbate_id` | 与 ASE 生态互通 |
| 3D 周期 slab | Build Vacuum Slab 生成三维周期晶胞（真空在 c） | **[U]** 同样三维周期加真空（与 MS、VASP 一致）；显示与工具靠只读的真空间隙检测区分上下表面 | U1/U2 |
| 导出到 VASP | 导出 POSCAR 时写约束 | POSCAR 写 SD；其余格式丢约束、左手晶胞、原子重叠时明确警告 | 不静默丢数据，不让 VASP 白跑 |
| 原子排序 | 导出时按元素分组 | 同；生成器直接按元素分块排列（K14），另有可撤销的 "Sort atoms by species" | 内存序号 = 文件序号，便于对照 CONTCAR、OUTCAR |

---

## 2. 功能清单

### 2.1 必须

| # | 功能 | 行为要点 | 默认值 |
|---|---|---|---|
| M-1 | props 不变量 I1–I3 | 构造、`set_prop`/`setProp`、`remap` 强制长度；逐元素复制；`from_dict`/`fromJSON` 两种语言都修复不齐的 props 与帧并写备注 | — |
| M-2 | `PROP_DEFAULTS` 与规范化器 | 冻结的默认值表；按形状补零的键；`masses` 取原子量；`poscar_species` 取同元素首块标签；`selective_dynamics`/`tags`/`adsorbate_id`/`occupancy` 写入时规范化 | §3.2 |
| M-3 | `remap` 原语、源映射与追踪会话 | `_remap`/`remap`（含 `new_symbols`/`new_positions`、`defaults`）；累计 `source_map`；会话式 `track_changes()`；`invert_source_map`、`compose_source_maps`（校验衔接） | — |
| M-4 | 现有操作改造与新原语 | Python `delete`/`select`/`_take`/`repeat`/`append`/`extend`/`copy`/`get_frame`/`from_dict`/`center`/`wrap`；JS 构造器/`fromJSON`/`toJSON`/`clone`/`repeat`/`wrap`/`deleteAtoms`/`addAtom`/`setSymbols`；新增 `setProp`/`removeProp`/`getFrame`/`keepFrame`/`setPositions`/`extend`/`select`、`rev`/`touch()`，Python `remove_prop`/`set_symbols`/`set_positions`/`keep_frame`/`set_pbc` | §3.5 |
| M-5 | 修现有缺陷 | JS `clone()` 共享 props；JS `addAtom` 不扩展 props；Python `repeat` 共享嵌套列表；`append`/`extend` 填 `None`；JS `fromJSON` 遇 `pbc: true` 崩溃、帧坐标不足时补 0；JS `wrap`/`repeat` 只用当前帧；JS `toJSON` 帧晶胞未取整且按引用；Python `delete` 越界取模；POSCAR `.TRUE.` 读成固定；JS 可变晶胞 XDATCAR 用第一帧晶胞换算 | — |
| M-6 | 备注 `info.warnings`（C8） | `add_warning`/`get_warnings`/`new_warnings`/`normalize_warnings`；toast 只显示本步新增的备注；extxyz 不写；结构面板 Notes 列表与 `Clear notes` | §3.6 |
| M-7 | 编辑后的派生信息失效（C7 及扩展） | `invalidate_symmetry_info`、`invalidate_results`、`invalidate_build_info`、`mark_edited(s, kind)`、`rotate_vector_props` | §3.7 |
| M-8 | 约束存储与基变换（C3） | `Structure.get_move_mask()`、`constraint_summary()`；`core/constraints`：`transform_move_flags`、晶格↔笛卡尔、`apply_basis_change`；合并时按来源晶胞换算 | tol 1e-6 |
| M-9 | tags 与 adsorbate_id（C4） | 存储、默认 0、规范化、`next_adsorbate_id`；`extend`/`concat_structures` 重新编号 | 0 |
| M-10 | `concat_structures` | 一次 remap 拼接多个结构；props 并集用默认值补齐；标志按各自晶胞换算；帧丢弃；吸附物重新编号 | §3.5.3 |
| M-11 | POSCAR 两种语言 | 容错 T/F；缺失/非法时按 T 并合并成一条备注；Cartesian 模式下标志仍是晶格系；按分组顺序写 SD；重复元素块往返；`!`/`#` 注释；JS 修可变晶胞 XDATCAR | §3.10 |
| M-12 | 原子顺序工具 | `poscar_order`（含块标签）、`canonical_order`；Python `sort_by_species(order=None)`、JS `sortBySpecies(order)`；网页命令可撤销、带 `indexMap`、参数校验 | 首次出现顺序 |
| M-13 | extxyz 两种语言（D5） | ASE 词法；ASCII 数值转换；`move_mask` 读写（宽度规则）；旧 `selective_dynamics:L:3` 读取；`charge`→`charges`；`tags`；与 ASE 互通的 info 写法（K15）；JS 读写器补齐所有列与 info；多帧结果只写第 1 帧 | §3.11 |
| M-14 | 导出检查 | 能力表（含插件声明与校验）；`export_report` → 警告与说明；左手晶胞、原子重叠、FixCartesian 提醒；`ExportResponse.warnings/notes`；网页 toast 与 Export notes；CLI stderr；Python `write()` 发 `ExportWarning`；JS `exportStructure` 的同步契约 | §3.12 |
| M-15 | 真空间隙原语（U1） | `find_vacuum_gap`、`find_vacuum_gaps`、`find_surface_gap`、`gap_cut`、`unwrap_along_gap`、`make_contiguous`（仅显式编辑）、`vacuum_gap_hint`；CLI `info` 的中性一行 | 阈值 5.0 Å |
| M-16 | 跨语言测试桥与公共用例格式 | §7.1 的文件布局、fixture、标记、环境变量；`facet.cases/1` 外壳与递归加载器，供所有模块使用 | Node ≥ 22 |
| M-17 | 二面角符号统一（D7，原 S-3） | JS 改为 IUPAC；新 `core/geometry.js` 一处实现，查看器与选区卡片共用 | (−180°, 180°] 显示 |
| M-18 | JS 修改计数（原 S-4） | `rev` 与 `touch()`，所有修改方法递增；供 F0-A 的 `structureKey` | 0 |
| M-19 | 默认参数表与元素数据对齐（D7，原 S-7） | 逐项取更准确的晶格常数；按化合物的纤锌矿 `u` 与 MX2 厚度；JS 移植参考表；Bk–Lr 共价半径；未知元素回退值；`bondiRadius` | §3.15 |

### 2.2 应该

| # | 功能 | 说明 |
|---|---|---|
| S-1 | 命名基础（C9） | `core/naming.py`/`naming.js`：`TIMES = "×"`、`format_repeat`、`add_repeat_suffix`（叠加时相乘，认得 JS 旧的 ` (A×B×C)` 后缀） |
| S-2 | 常量对象（C10） | `core/defaults.py`/`defaults.js`：`SURFACE_DEFAULTS`（Python 同时支持 `d.key` 与 `d["key"]`，JS camelCase），本模块填入 4 个键，**不含真空**（U4） |
| S-3 | 导出时的原子重叠检查 | `close_contacts`（两种语言），POSCAR、extxyz、CIF 导出时检查 < 0.5 Å 的原子对 |
| S-4 | Python 读 XDATCAR | 与 JS 对等：多帧、每帧晶胞 |
| S-5 | 多帧 extxyz 不再把第 0 帧的计算结果抄到每一帧 | 结果类 props/info 只写在第一帧，并警告 |
| S-6 | JS CIF/PDB 读取器的 props 名与 Python 一致 | `label` → `labels`、`residue` → `residue_names`（只改读取器，不迁移旧文档） |
| S-7 | 现有读取器警告的文案两种语言统一 | VASP 4 无元素名、帧原子数不同等同类警告逐字相同；JS 首字母大写带句号的改为 §3.6 的风格 |

### 2.3 可选

| # | 功能 | 说明 |
|---|---|---|
| O-1 | `/io/convert` 响应头 `X-Facet-Warnings` | URL 编码的 JSON 列表 |
| O-2 | JS POSCAR 写出无晶胞结构时装箱 | 与 Python 完全相同的规则（每侧 10 Å，§3.12.2 W3）；现在抛错，文案清楚 |
| O-3 | extxyz 写出选项 `constraints="fix-partial"` | 把部分约束收紧为完全固定，从而写宽度 1（ASE 读成 FixAtoms，经 ASE 写 POSCAR 不丢）；只收紧（K3）；默认 `exact` |
| O-4 | POSCAR 写出选项 `order="keep"` | 按内存顺序写连续的同元素块（元素名可重复，ASE `sort=False` 的写法）；提醒 VASP MLFF 不接受重复名 |
| O-5 | CONTCAR 速度块 | 读入 `props.velocities`（Cartesian，Å/fs；Direct 模式按晶格换算；不乘缩放因子，VASP wiki），写 POSCAR 时若存在则写回；预测-校正块与晶格速度块忽略 |
| O-6 | REST `/analysis/vacuum` + 客户端 `vacuum_gap` | 结构 → 数据；只做原子数上限检查（工程 #22）；U1 下没有内部消费方 |
| O-7 | PDB 读写 occupancy / B-factor 列 | 与 ASE 一致 |

### 2.4 v1 中删除的功能（按用户决定 U1/U2）

导入时检测 slab（`detect_slab`/`detectSlab`、`vacuum_axes`、`SLAB_DETECT_FORMATS`）、导入时的"断开复原"、`Treat as slab` / `Keep periodic`、
偏好 `prefs.detectSlabs` 与命令 `file.detectSlabs`、`edit.detectSlab`、`edit.setPbc`、结构面板的 a/b/c 周期按钮与"真空提示"行、
`parse_text`/`read`/REST `/io/parse`/客户端/CLI 的 `detect_slab` 参数、`kind = slab/wire/molecule` 分类、`set_pbc(contiguous=True)` 的副作用、
v1 §3.13.6 的文案表与 §3.13.7 的 `noBoundaryAxes`（显示由 F0-A §3.8.2 负责）。

---

## 3. 算法

### 3.1 props 不变量与逐值复制

- **I1**：对每个键 `k`，`len(props[k]) == natoms`。检查点：构造器与 `set_prop`/`setProp`（**严格**：长度不符抛 `ValueError` / `RangeError`
  `property 'x' has 5 values but there are 6 atoms`）、`_remap`/`remap`；反序列化 `from_dict`/`fromJSON`（**修复**，见下）。
- **I2**：任何两原子、两结构之间不共享可变值。统一的逐值复制函数（两种语言同一规则）：

  ```
  copy_value(v):
      v 是 None/null、bool、数值、字符串           → 原样返回
      v 是列表/元组（JS: Array），且元素全是上述标量 → 浅拷贝为新列表（对平坦列表即深拷贝）
      其他（嵌套列表、dict/对象）                  → 深拷贝（Python copy.deepcopy；JS structuredClone，不可用时 JSON 往返）
  ```

  复制发生在：`set_prop`/`setProp`、构造器、`_remap`/`remap`、`copy`/`clone`、`toJSON`（默认返回副本）。
  JS 构造器复制传入的 `Float64Array` 坐标与帧数组（今天按引用收下，`structure.js:82`）。
- **I3**：所有改变原子集合或顺序的操作都由源映射 `src` 定义，并调用唯一的 remap 实现（§3.3）。
- **反序列化的修复规则（两种语言相同，工程 #14）**——旧项目（0.3.1 的 JS `addAtom` 不扩展 props，存下的项目可能不齐）、插件数据不能因此打不开：
  - props 的值不是列表（或类型化数组）：删除该键，备注 `property 'x' is not a per-atom list and was removed`；
  - JS 类型化数组：`Array.from` 转为普通数组（今天 `toJSON` 会把它写成 `{"0":…}`）；
  - 长度 m ≠ n：m < n 时用默认值补齐，m > n 时截断，备注 `property 'x' had 5 values for 6 atoms and was padded with defaults` /
    `… and was truncated`；
  - 某一附加帧的坐标行数 ≠ n：丢弃该帧，备注 `frame 3 has 35 positions for 36 atoms and was dropped`（今天 JS `flatten` 补 0，
    原子静默跑到原点，`structure.js:288-298`；Python `_make_frame` 抛错）；
  - 第 0 帧坐标行数 ≠ n：两种语言都报错（`invalid structure: positions must have 36 rows to match symbols (got 35)`），不修复。
  - JS 构造器在 `positions == null` 时仍按 n 个原点建坐标（`build/crystal.js` 用 `new Structure({ symbols })` 求化学式，依赖此行为）；
    给了长度不符的坐标则抛 `RangeError`。

### 3.2 `PROP_DEFAULTS` 与按键规范化器

两种语言内容完全相同，都冻结（Python `MappingProxyType`，序列值用元组，取用时经 `copy_value` 变成新列表；JS 深冻结），
由逐键测试核对（§7.2）。新键由提出它的模块在自己的任务里**同时改两份源码表**（例如 M6 的 `interface_layer`），不允许运行时赋值。

```python
PROP_DEFAULTS = MappingProxyType({        # 新原子的默认值
    "selective_dynamics": (True, True, True),   # C3：可动
    "tags": 0,                                  # C4：0 = 吸附物或未标记
    "adsorbate_id": 0,                          # C4：0 = 不是吸附物
    "occupancy": 1.0,                           # C12
    "residue_names": "MOL", "residue_ids": 1, "chain_ids": "A",   # 与 PDB 写出器的回退值相同
    "residue": "MOL",                           # JS 旧名（S-6 之前的文档）
    "momenta": (0.0, 0.0, 0.0), "velocities": (0.0, 0.0, 0.0),
    "initial_magmoms": 0.0, "initial_charges": 0.0,
})
PROP_SYMBOL_DEFAULT = ("labels", "label", "atom_names")      # 默认值 = 新原子的元素符号
PROP_SHAPED_ZERO = ("momenta", "velocities", "initial_magmoms", "initial_charges")
RESULT_PROPS = ("energies", "forces", "stresses", "charges", "magmoms", "born_effective_charges", "dipoles")   # 逐原子计算结果
```

新原子的值按下列顺序取（`default_for(key, symbol, column)`，两种语言同一函数）：

1. 调用方给出的值（`added_props`）；
2. 本次调用的覆盖表 `defaults`（§3.3）；
3. `PROP_SYMBOL_DEFAULT` 中的键 → 新原子的元素符号；
4. `masses` → 该元素的标准原子量（`elements.json`；领域 F11，用 D 换 H 做振动分析时常用这一列）；
5. `poscar_species` → 结构中同元素第一个块的标签，没有则为元素符号（§3.10.4）；
6. `PROP_SHAPED_ZERO` 中的键 → 与该列已有行**同形状的零**：已有行是长度 w 的列表则为 w 个 `0.0`（非共线磁矩 N×3），是标量则为 `0.0`，
   该列还没有行时取 `PROP_DEFAULTS` 的值（领域 F11：v1 的固定形状会让 extxyz 判定"行宽不同"而整列丢失）；
7. `PROP_DEFAULTS` 中的其他键 → 该值的副本；
8. 其他键 → `None`/`null`（保持 0.3.1 行为，`tests/test_structure.py:107-117` 依赖 `charge` 为 `None`）。写出器把 `None` 视为缺失
   （extxyz 跳过该列并在导出检查里说明，§3.12）。

`RESULT_PROPS` 不在默认值表里：改变原子集合的操作都会调用 `mark_edited`，后者删除这些键（§3.7）。

**规范化器**（构造器、`set_prop`/`setProp`、`remap` 的 `added_props` 生效；不合法值换成默认值，合并为一条备注）：

| 键 | 接受的输入 | 规范结果 | 不合法时 |
|---|---|---|---|
| `selective_dynamics` | 长度 3 的序列，元素为 bool、0/1、或匹配 `FLAG_RE` 的字符串；或单个 bool/0/1/标志字符串（= 三个相同） | `[bool, bool, bool]`（新列表） | `[True, True, True]`，备注 `selective_dynamics: 2 invalid value(s) were replaced by T T T (free)` |
| `tags`、`adsorbate_id` | bool、整数、整数值的浮点数 | `int` | `0`，备注 `tags: 1 invalid value(s) were replaced by 0` |
| `occupancy` | 有限数值 | `float` | `1.0`，备注同上格式 |

`FLAG_RE = ^\.?([TtFf])(?:rue|RUE|alse|ALSE)?\.?$`（接受 `T F t f .T. .F. TRUE FALSE true false .TRUE. .FALSE.`，拒绝 `Ti`、`Fe`、`Si`）。
Python 构造器先设 `info` 再设 props（今天顺序相反，`structure.py:210-213`），使规范化备注能写进 `info.warnings`。

### 3.3 remap 原语

```python
def _remap(self, src, *, symbols=None, new_symbols=None, positions=None, new_positions=None,
           frames="keep", added_props=None, defaults=None) -> "Structure":      # 私有但供各模块使用
```
```js
remap(src, { symbols = null, newSymbols = null, positions = null, newPositions = null,
             frames = 'keep', addedProps = {}, defaults = null } = {})          // → this（简报 C2 名称）
```

- `src`：长度 m；元素是 `[0, n)` 的整数，或 `-1`/`None`/`null` 表示新原子。越界抛 `IndexError`/`RangeError`
  `source index 7 out of range (structure has 5 atoms)`。
- 新原子的符号与坐标二选一给出：`new_symbols`/`new_positions`（只含新原子，按 `-1` 的出现顺序；**推荐**）或 `symbols`/`positions`
  （完整的新表，m 行）。都给或都不给（且有新原子）时抛 `ValueError("new atoms need symbols and positions")`。
- `positions` 指**第 0 帧**的完整新坐标。结构有多帧、给了 `positions` 而 `frames` 仍为 `"keep"` 时抛错
  `remap: pass frames explicitly (or call keep_frame first) when the structure has several frames`（工程 #17：JS 调用方手上通常是当前帧的坐标，
  传错会静默换掉第 0 帧）。`new_positions` 没有这个问题。
- `frames`：`"keep"` = 每帧按 `src` 取行，新原子在每一帧都用 `new_positions` 的坐标（与今天 `append`/`addAtom` 相同），帧晶胞不变；
  显式列表 = 直接使用（`[]` 表示丢弃所有帧，C11）。
- `added_props`：`{key: [values for the new atoms]}`；`defaults`：本次调用的覆盖表（简报 C2 的 `_remap(src, defaults)`），作用于本次所有新原子
  （例如 M6 合并时 `defaults={"interface_layer": 2}`）。
- 结果写回 `self`（原位）；组合源映射与追踪会话（§3.4）；JS `touch()`。晶胞、pbc、info、name **不变**，派生信息的失效由调用方经
  `mark_edited` 处理（§3.7）——`_remap` 是机械原语，纯重排也用它。

```text
_remap(src, ...):
    n ← len(self); S ← int64 数组(src, None→-1); 检查 -1 ≤ S[j] < n
    new ← { j : S[j] = -1 }；按上面的规则得到 syms（m 个）与 pos0（m×3）
    frames' ← frames == "keep" ? [ 每帧 fr: 行 S[j]（新原子行 ← pos0[j]），cell 不变 ] : frames
    keys ← 有序并集(self.props 的键, added_props 的键)
    对每个 k：col[j] ← S[j] ≥ 0 ? copy_value(self.props[k][S[j]])（self 没有 k 时用 default_for）
                                  : default_for(k, syms[j], self.props.get(k))（§3.2 的顺序）
              k 有规范化器 → 规范化 col
    写回 symbols/positions/frames/props；组合 source_map 与会话；JS touch()
```

复杂度 O(m·p)，p 为键数；1 万原子实测见 §0.3。

### 3.4 源映射与追踪会话（简报 C2 要求由 F0-D 决定）

1. **`source_map`**（Python 只读属性 `np.ndarray[int64] | None`；JS getter `Int32Array | null`）：**自诞生以来的累计映射**。

   | 事件 | `source_map` |
   |---|---|
   | 构造、`from_dict`/`fromJSON` | `None`（新谱系） |
   | `copy()`/`clone()`、`get_frame`/`getFrame` | `None`（恒等，相对源结构） |
   | 派生：`repeat`、`select`、`concat_structures`、M1/M2/M6 的构建器 | 相对**输入结构在派生那一刻**的映射 |
   | 原位 `_remap(S)` | `compose(source_map, S)`（`None` 视为恒等） |

   不序列化，不参与撤销快照。构建器若不经 `copy()`/`_remap` 而从数组直接构造结果，用 `result._set_source(parent, src)`（JS `setSource(parent, src)`）
   声明谱系（设置映射并接续 `parent` 的追踪会话）。
2. **追踪会话**：`t = s.track_changes()`（JS `s.trackChanges()`）开启一个会话，起点映射为恒等。此后：
   - `s` 或会话中任何结构的原位 remap `S`：该结构的会话映射 `m ← compose(m, S)`；
   - 从会话中的结构 `x` 派生 `y`（`copy`/`clone`/`repeat`/`select`/`get_frame`/`_set_source`……，映射 `S`）：`y` 加入会话，`m_y ← compose(m_x, S)`；
   - `t.stop(result=None)` → 起点状态到 `result`（缺省为 `s`）的映射；`result` 不在会话中时返回 `None`；然后关闭会话，并把结果存为 `t.src`。
     Python 也可 `with s.track_changes() as t:`，退出时调用 `stop()`，之后读 `t.src`。一个结构可以同时属于多个会话；关闭的会话在下次 remap 时被丢弃。
   原型 [V]：原位编辑、先删后派生、先派生后删、多级派生、派生后再改父结构、复制后排序 6 种写法两种语言都与逐原子标签一致（附录 A）。
   v1 的"最近一次映射"在"先派生再删除"时 JS 得到 `[1, 2, 0, 0, 0]`（正确值 `[1, 2, 0, 1, 2]`，工程 #3）。
3. **辅助函数**（两种语言同名同义）：
   - `invert_source_map(src, n_old)` / `invertSourceMap(src, nOld)` → 旧→新（`-1` = 被删除）；一个旧原子对应多个新原子（超胞）时取**第一个**
     （即 (0,0,0) 像）。结果可直接作 `replaceActiveStructure(…, {indexMap})`。
   - `compose_source_maps(first, second)` / `composeSourceMaps(first, second)` → 先 first 后 second 的总映射；`max(second) ≥ len(first)` 时抛
     `ValueError`/`RangeError`：`source maps do not chain: the second map refers to atom 5 but the first has 3 entries`。
4. **F0-A `editActive` 的用法**（§10.1）：`work = old.clone(); t = work.trackChanges(); r = fn(work) ?? work; src = t.stop(r)`；
   `src` 非空 → `indexMap = invertSourceMap(src, old.length)`；`src` 为空（`fn` 返回了无关的新结构）且调用方没给 `indexMap` → 开发版抛错、
   发布版 `console.warn` 后退回默认规则。**不再静默组合**。
5. **为什么不用 `return_src=True`**：返回类型会随参数变化，且对多步编辑无能为力。

### 3.5 现有操作逐个改造与新原语

#### 3.5.1 Python `Structure`（`structure.py`）

| 方法（行） | 新行为 |
|---|---|
| `__slots__`（189） | 增加 `"_source_map", "_tracks"`（不序列化） |
| `__init__`（191-221） | 先设 `info = copy.deepcopy(info or {})`，再逐键 `set_prop`；`_source_map = None`、`_tracks = {}` |
| `set_prop`（232-237） | 长度检查（已有）+ 规范化器或逐值复制；`[[T,T,F]] * n` 这种共享行不再共享；**返回 `self`**（工程 #17，简报 §3） |
| `remove_prop(key)`（新） | 删除键；不存在不报错；返回 `self` |
| `copy`（248-261） | 已深拷贝；`_source_map = None`；接续会话（恒等） |
| `from_dict`（295-323） | 调构造器前 `normalize_warnings(info)`；props 与帧按 §3.1 修复并写备注（今天长度不符抛 `ValueError`） |
| `get_frame`（350-363） | 派生（恒等）；`index ≠ 0` 时对结果 `mark_edited(new, "positions")`（第 0 帧的结果与对称信息不属于其他帧） |
| `keep_frame(index=0)`（新，原位） | 第 index 帧成为第 0 帧，丢弃其余帧（C11）；`index ≠ 0` 时 `mark_edited(self, "positions")`；返回 `self` |
| `set_positions(positions, *, indices=None, frame=0)`（新） | 写某帧全部或部分原子的笛卡尔坐标（形状检查）；`mark_edited(self, "positions")`；返回 `self` |
| `delete`（653-661） | 索引须为 `-n ≤ i < n` 的整数，否则 `IndexError("atom index 7 out of range (structure has 5 atoms)")`（**行为变化**：今天 `n+1` 被取模后静默删掉索引 1）；重复索引只删一次；`_remap(keep)`；删了原子则 `mark_edited(self, "atoms")` |
| `_take`（663-668） | 改为 `self._remap(keep)` 的薄包装（保留名字） |
| `select`（670-695） | `new = self.copy(); new._remap(np.nonzero(sel)[0])`（结果的 `source_map` 相对 `self`）；严格子集时 `mark_edited(new, "atoms")` |
| `append`（611-627） | `symbol` 经 `normalize_symbol`；`_remap(range(n) + [-1], new_symbols=[symbol], new_positions=[position], added_props={k: [v]})`；SD 得 `[T,T,T]` 而非 `None`；`mark_edited(self, "atoms")` |
| `extend(other, *, renumber_adsorbates=True)`（629-651） | `_remap(range(n) + [-1]*m, new_symbols=other.symbols, new_positions=other.positions, frames=…, added_props=other.props（经下面的换算）)`；帧规则不变（帧数相同则拼接，否则丢弃 self 的帧并写备注）；**标志换算**：`other` 的晶胞（无晶胞时 I）与 `self` 的晶胞（无时 I）不同（逐元素差 > 1e-9 Å）时，`other` 的标志经 `transform_move_flags(flags, other_cell, self_cell)` 换算，收紧数 > 0 写备注；**吸附物编号**：`renumber_adsorbates` 时 `other` 的非零 `adsorbate_id` 统一加上 `next_adsorbate_id(self) − 1`（领域 F12）；`mark_edited(self, "atoms")` |
| `repeat`（575-609） | 计数须为 ≥1 的整数值（`2.0` 可，`1.5` 抛 `ValueError("repeat counts must be whole numbers >= 1 (got 1.5)")`）；位置平铺不变（像序 i 最慢、k 最快，原原子在前）；props 走 `_remap(tile(arange(n), n_img), positions=…, frames=…)`；名字用 `add_repeat_suffix`（§3.14）；`info["supercell"]` 照旧写入，另按 M1 K4 维护 `info.supercellMatrix`（存在时左乘 `diag(nx, ny, nz)`，不存在时写 `diag`）；`mark_edited(new, "repeat")` |
| `sort_by_species(order=None)`（新） | `order` 须为元素符号序列（逐个 `normalize_symbol`，字符串整体抛 `TypeError("order must be a list of element symbols, e.g. ['Pt', 'C', 'O']")`，工程 #27）；`_remap(poscar_order(self.symbols, order, blocks))`；所有帧一起重排；不调用 `mark_edited`（纯重排，逐原子结果随之重排）；返回 `self` |
| `set_symbols(indices, symbol)`（新，对齐 JS `setSymbols`） | 索引检查同 `delete`；`normalize_symbol`；这些原子的 `labels`/`atom_names` 设为新符号；`mark_edited(self, "symbols")` |
| `set_pbc(pbc)`（新，ASE 同名） | `_as_pbc` 规范化后赋值；**不移动原子、不改晶胞**（U1/U2）；pbc 确有变化时 `mark_edited(self, "pbc")`；返回 `self` |
| `get_move_mask()`（新，M3 同名） | `(N, 3)` bool 副本，缺键时全 True |
| `constraint_summary()`（新，M3 同名） | `{"fixed", "partial", "free", "byFlags": {"FFF": 18, "TTF": 4}, "present"}`（M3 §3.10.2 的定义；导出检查在第 0 波就需要它） |
| `center`（533-573） | 给了 `vacuum` 且任一晶胞矢量长度变化 > 1e-9（相对）时 `mark_edited(self, "cell")`；只平移时不调用；约束不需变换（矢量只沿自身缩放，K3 下精确） |
| `wrap`（512-531） | 改用 `wrap_fractional`（`core/lattice.py`，规则不变：`w = f − floor(f + 1e-12)`，`w ≥ 1 − 1e-12` 时取 0）；不调用 `mark_edited` |
| `translate` | 不变；不调用 `mark_edited` |

模块级新增（§6.1 列全）：`PROP_DEFAULTS`、`PROP_SYMBOL_DEFAULT`、`PROP_SHAPED_ZERO`、`RESULT_PROPS`、`RESULT_INFO`、`SYMMETRY_INFO_KEYS`、
`BUILD_INFO_KEYS`、`CARTESIAN_VECTOR_PROPS`、`copy_value`、`poscar_order`、`canonical_order`、`invert_source_map`、`compose_source_maps`、
`add_warning`、`get_warnings`、`new_warnings`、`normalize_warnings`、`invalidate_symmetry_info`、`invalidate_results`、`invalidate_build_info`、
`mark_edited`、`rotate_vector_props`、`concat_structures`、`ChangeTracker`；加入 `__all__`，并在 `facet/core/__init__.py` 再导出其中常用的
（`PROP_DEFAULTS`、`mark_edited`、`invalidate_symmetry_info`、`add_warning`、`get_warnings`、`poscar_order`、`concat_structures`）。

#### 3.5.2 JS `Structure`（`structure.js`）

| 成员（行） | 新行为 |
|---|---|
| `addWarning`（12-16） | 签名不变，改写 `info.warnings`（数组，去重）；见 §3.6 |
| 构造器（78-92） | `pbc` 经 `normalizePbc(pbc, !!cell)`（布尔→三份，长度 3 的数组→布尔，`null`→按有无晶胞，其他抛 `TypeError('pbc must be a boolean or three booleans')`）；复制坐标与帧（I2）；坐标长度检查（§3.1）；逐键 `setProp`；`info` 深拷贝；`frame = 0`、`rev = 0`、`_sourceMap = null`、`_tracks = new Map()` |
| `static fromJSON(o)`（94-111） | 传入 `Structure` 时返回 `o.clone()`（今天返回同一对象，与 Python `from_dict` 返回副本不一致）；`normalizeWarnings`；`pbc` 规范化（修 `pbc: true` 崩溃）；props 与帧按 §3.1 修复；`fixDegenerateCell` 照旧 |
| `toJSON({precision = 6, copy = true})`（113-132） | props、info 返回深拷贝（`copy: false` 时按引用，仅供立即 `JSON.stringify` 的调用方，例如撤销快照）；帧晶胞也取整并复制 |
| `clone()`（134） | 直接深拷贝（不再经 `toJSON`/`fromJSON`，不再取整到 1e-10）；保持当前帧（修"克隆回到第 0 帧"）；`sourceMap = null`，接续会话 |
| `rev`、`touch()`（新，K13） | `rev` 构造时 0、不序列化；`touch()` 递增并返回 `this`。调用 `touch()` 的方法：`remap`（因而 `deleteAtoms`、`addAtom`、`extend`、`sortBySpecies`）、`setProp`、`removeProp`、`setPositions`、`translate`、`wrap`、`setSymbols`、`setPbc`、`keepFrame`、`markEdited`、`makeContiguous`、`applyBasisChange`；M1/M2 的新方法（`setCell`、`setVacuum`……）同样调用。直接给属性赋值不计（文档写明，脚本改完调用 `touch()`） |
| `getFrame(i)`（新，对齐 Python） | 返回该帧的单帧结构（派生、深拷贝）；`i ≠ 0` 时对结果 `markEdited(r, 'positions')`（同 Python `get_frame`） |
| `keepFrame(i = this.frame)`（新） | 原位：第 i 帧成为第 0 帧，丢弃其余帧，`frame = 0`；`i ≠ 0` 时 `markEdited(this, 'positions')`；返回 `this` |
| `setPositions(positions, { frame = 'current' } = {})`（新） | `positions` 为 `Float64Array(3n)` 或 `{indices, positions: Float64Array(3·len)}`；`frame` 为 `'current'` 或帧号；写入正确的缓冲区并保持 `positions`/`_base`/`frames[i]` 的别名关系（今天 `positions === _base` 只在第 0 帧成立，`structure.js:141-146`，M1 不应直接改 `_base`）；`markEdited(this, 'positions')`；返回 `this` |
| `repeat(nx, ny, nz)`（211-231） | 计数须为 ≥1 的整数（`Number.isInteger`），否则 `RangeError('repeat counts must be whole numbers >= 1 (got 1.5)')`；**平铺所有帧**（第 0 帧用 `_baseCell`，其余帧用各自晶胞）；原子顺序与 Python 相同；props 走 `remap`；名字用 `addRepeatSuffix`；`info` 深拷贝并写 `supercell`、`supercellMatrix`（同 Python）；`markEdited(r, 'repeat')`；结果 `setFrame(this.frame)` |
| `wrap()`（234-242） | 处理**所有帧**，每帧用自己的晶胞；改用 `wrapFractional`（今天的容差是 1e-9，`:238`，改为与 Python 相同的 1e-12）；仅周期轴 |
| `deleteAtoms(indices)`（245-256） | 索引规则同 Python（负数从尾部算，越界抛 `RangeError`，数字字符串按数字处理）；`remap`；`markEdited(this, 'atoms')` |
| `setSymbols(indices, symbol)`（258-262） | 索引检查；`labels`/`label`/`atom_names` 同步为新符号；`markEdited(this, 'symbols')` |
| `addAtom(symbol, xyz, props = {})`（264-271） | `remap([...0..n-1, -1], {newSymbols: [symbol], newPositions: [xyz], addedProps})`；返回新索引（不变）；`markEdited(this, 'atoms')` |
| `extend(other, { renumberAdsorbates = true } = {})`（新） | 与 Python `extend` 相同（M4 粘贴用） |
| `setProp(key, values)` / `removeProp(key)`（新） | 同 Python，返回 `this` |
| `remap`、`sourceMap`、`trackChanges()`、`setSource(parent, src)`、`sortBySpecies(order)`、`setPbc(pbc)`、`select({elements, indices, mask})`、`getMoveMask()`、`constraintSummary()`（新） | 同 Python |

`flatten`（288-298）只在构造器的 `positions == null` 情形下补零；`fromJSON` 不再用它静默补零。

#### 3.5.3 `concat_structures`（新，M4 合并与 M6 界面共用，工程 #2）

```text
concat_structures(parts, *, cell=None, pbc=None, defaults=None, renumber_adsorbates=True) -> Structure
    parts 至少一个；result ← parts[0].copy()（派生：source_map 相对 parts[0]，接续 parts[0] 的会话）
    cell ← cell ?? parts[0].cell；pbc ← pbc ?? parts[0].pbc；result 的晶胞与 pbc 设为它们
    parts[0] 的标志：parts[0].cell 与 cell 不同时按 transform_move_flags(parts[0].cell, cell) 换算
    其余每个 part：标志按 transform_move_flags(part.cell 或 I, cell 或 I) 换算；adsorbate_id 重新编号（同 extend）
    一次 _remap(range(n0) + [-1]*Σm, new_symbols, new_positions, frames=[], added_props=各 part 的 props 拼接, defaults)
    任何 part 有多帧 → 备注 "frames were dropped when the structures were combined"（C11）
    info ← parts[0].info 的深拷贝；mark_edited(result, "atoms")；收紧数 > 0 → 备注（§3.8.3 的文案）
    第 p 个 part 的原子在结果中占连续区间 [offset_p, offset_p + len(part_p))，offset 为前面各 part 原子数之和（不另返回）
```

### 3.6 备注 `info.warnings` 的生命周期（C8，工程 #7、领域 F16）

- 唯一规范键 `info.warnings`：字符串列表，插入顺序，去重。语义是**这个结构的持久备注**——读取时发现的问题（标志缺失、晶胞修复、部分占位）、
  编辑留下的说明（约束被收紧、计算结果被删除）、M2 等写的数据注意事项（极性、非化学计量）。
- 两种语言的函数：
  - `add_warning(info, msg) -> info` / `addWarning(info, msg) -> info`：空串忽略；`info.warnings` 不是列表时视为空列表。
  - `get_warnings(info) -> list[str]` / `getWarnings(info)`：`warnings` 中的字符串，再追加旧键 `warning`（字符串，若不重复）。
  - `new_warnings(before, after) -> list[str]` / `newWarnings(before, after)`：`after` 中不在 `before` 里的项，保持顺序。
  - `normalize_warnings(info)` / `normalizeWarnings(info)`：有旧键 `warning` 时把**整条**字符串加入 `warnings` 并删除旧键（K7；旧 JS 文案本身含 `"; "`，
    不能拆分）。在 `from_dict`/`fromJSON` 中调用，0.3.1 网页保存的项目在两边都会被迁移。
- **显示规则**：
  - toast 只显示**本步新增**的备注：F0-A 的 `editActive`、`addStructure` 与导入流程取 `new_warnings(之前, 之后)`（新结构的"之前"为空）；
    Facet JSON 文件自带的备注是存档内容，打开时不弹出（§5.1）。
  - 全部备注在结构面板 Summary 下以 `Notes (3)` 折叠列表显示，带 `Clear notes` 按钮（一步撤销，§5.2）。
  - CLI `info` 照旧逐条打印 `Warning     : …`；REST `/io/parse` 的 `warnings` 照旧为解析结果的全部备注（`server/routes/io.py:48-49`）。
- **继承规则**：保持原子身份的派生（`copy`/`clone`、`repeat`、`select`、`get_frame`、`concat_structures` 取 `parts[0]`）深拷贝备注；
  生成另一种结构的构建器（M2 切面、M6 界面）从空备注开始，只写自己的说明（例如 C12 的部分占位）。
- **写出**：extxyz 不写 `warnings`（两种语言），JSON 照常保存。于是一次性的说明不会经文件在下次打开时再弹出。
- 调用点改造：JS `addWarning` 的所有调用者（`io/poscar.js:41,78`、`io/xyz.js:81,92`、`io/cif.js:213,242,261`、`io/pdb.js:85`、`structure.js:103`）无需改动；
  `app.js:901` 改为本步新增的备注（§5.1）。
- 文案风格（新备注与警告）：小写开头（数字、格式名、专有名词除外），无句末句号，数字用阿拉伯数字，格式名与界面一致（POSCAR、CIF、Extended XYZ）；
  toast 显示时首字母大写、句末加句号。所有面向用户的文案**与通道无关**（不写只在网页才有的按钮名，工程 #18）。

### 3.7 编辑后的派生信息失效（C7 及扩展，领域 F3/F14/F17、工程 #6）

三类派生信息在编辑后可能过期：

```python
SYMMETRY_INFO_KEYS = ("spacegroup", "spacegroupNumber", "formulaSum")                       # C7 + CIF 的 _chemical_formula_sum
RESULT_INFO = ("energy", "free_energy", "stress", "virial", "dipole", "magmom", "polarization", "dielectric_tensor")
#            ^ ASE per-config 结果（ase/io/extxyz.py 的 per_config_properties）加 virial；RESULT_PROPS 见 §3.2（ASE per-atom 结果加 dipoles）
BUILD_INFO_KEYS = ("prototype", "a", "c", "u", "thickness")                                 # 内置构建器写入的晶格参数（build/crystal.py:349-352）
CARTESIAN_VECTOR_PROPS = ("velocities", "momenta", "initial_magmoms")                       # 后者仅当每行是 3 矢量（非共线）时
```

- `invalidate_symmetry_info(info) -> info` / `invalidateSymmetryInfo(info)`：删除 `SYMMETRY_INFO_KEYS`（简报 C7 指定的名字）。
- `invalidate_build_info(info) -> info` / `invalidateBuildInfo(info)`：删除 `BUILD_INFO_KEYS`（`info.source` 保留，它记录来源而不是声称晶格参数）。
- `invalidate_results(structure) -> list[str]` / `invalidateResults(structure)`：删除结构中出现的 `RESULT_INFO` 与 `RESULT_PROPS` 键；删了东西时写一条备注
  `calculated results (energy, forces) were removed because the structure changed`（列出被删的键，`RESULT_INFO` 在前），返回被删的键。
  理由：ASE 读 extxyz 时把这些键放进 `SinglePointCalculator`，`get_potential_energy()` 直接返回它；原型里删一个原子、加一个 O 后 ASE 仍报告
  `E = -71.234 for OPt11`（领域 F3、工程 #6 [V]）。ASE 自己的约定也是：原子、晶胞或 pbc 一变，计算结果就作废。
- `rotate_vector_props(structure, R)` / `rotateVectorProps(structure, R)`：把 `CARTESIAN_VECTOR_PROPS` 的每行乘以旋转矩阵 R（行矢量：`v' = v @ R.T`）。
- **统一入口** `mark_edited(structure, kind, *, rotation=None) -> structure` / `markEdited(structure, kind, {rotation})`（JS 另调用 `touch()`）；
  `kind` ∈ `EDIT_KINDS = ("order", "translate", "rotate", "positions", "atoms", "symbols", "repeat", "cell", "pbc")`，其他值抛 `ValueError`/`RangeError`。
  所有编辑操作调用它，**一张表决定清除什么**（两种语言同一张表，测试逐项核对）：

| `kind` | 用于 | 空间群（C7） | 计算结果 | 构建参数 | 其他 |
|---|---|---|---|---|---|
| `"order"` | 纯重排（`sort_by_species`、任何置换） | 保留 | 保留（随 remap 重排） | 保留 | 不必调用 |
| `"translate"` | 整体平移、`wrap`、`make_contiguous`、不改晶胞的 `center()` | 保留 | 保留 | 保留 | 不必调用 |
| `"rotate"` | 原子与晶胞的刚性旋转（M1 重定向、M2 标准取向） | 保留（C7） | 删除 | 保留 | 给了 `rotation` 时 `rotate_vector_props` |
| `"positions"` | 移动部分原子（M4、`set_positions`、`keep_frame(i≠0)`） | 删除 | 删除 | 保留 | — |
| `"atoms"` | 增删原子、合并（`append`、`extend`、`delete`、严格子集的 `select`、`concat_structures`、M5 放吸附物、M4 粘贴） | 删除 | 删除 | 保留 | — |
| `"symbols"` | 换元素（`set_symbols`） | 删除 | 删除 | 保留 | — |
| `"repeat"` | 对角超胞（`repeat`） | 保留（C7） | 删除 | 保留 | — |
| `"cell"` | 改晶格：非对角超胞、`set_cell`（两种模式）、应变、改晶胞参数、约化、原胞、重定义晶格、改真空、`center(vacuum=)` | 删除 | 删除 | 删除 | 原子不动的基变换还要 `apply_basis_change`（§3.8.3） |
| `"pbc"` | `set_pbc` 改变了 pbc | 保留 | 删除 | 保留 | — |

- 对角超胞也删除逐原子 `forces`（工程 #6 建议保留；未采纳，理由见文末：与 ASE 一致、规则只有一条）。
- 改约束、tags、`adsorbate_id`、labels 等属性不调用 `mark_edited`。
- **今天**：没有任何代码清除这些键——在 CIF 体相上删一个原子后，结构面板（`ui/panels/structure.js:112`）与 `facet info`（`cli.py:264`）
  仍显示原空间群；extxyz 照样写出旧能量。
- 本模块中的调用点见 §3.5；后续模块的调用要求见 §10（M1：`"cell"`、`"rotate"`；M2：新 slab 从新的 info 开始，改真空 `"cell"`；M4：`"positions"`、
  `"atoms"`；M5：`"atoms"`；M6：`concat_structures` 已调用）。

### 3.8 约束（C3）与基变换规则

#### 3.8.1 存储

- 键 `props.selective_dynamics`：N 个 `[bool, bool, bool]`，True = 沿晶格矢量 a/b/c 可动；缺键 = 全部可动；条目从不为 null（§3.2）。
- 从文件读入的全 T 数组保留（POSCAR SD 行往返不丢）；全部放开时删除键（M3 的 `free()`）。
- 没有晶胞（分子）时，三个标志指笛卡尔 x/y/z（等价于以单位矩阵为晶格）；之后 `center(vacuum)` 生成的正交盒子沿 x/y/z，语义不变。

#### 3.8.2 分工（工程 #2：同一件事只实现一次）

| 内容 | 归属 | 名字 |
|---|---|---|
| 读取标志、只读查询 | F0-D（第 0 波，导出检查要用） | `Structure.get_move_mask()`、`Structure.constraint_summary()`（M3 §3.10.2 的定义与返回字段） |
| 基变换与换算（纯函数） | F0-D `facet/core/constraints.py`、`web/js/core/constraints.js` | `transform_move_flags`、`lattice_to_cartesian_mask`、`cartesian_to_lattice_flags`、`apply_basis_change`、`next_adsorbate_id`、`FLAG_RE`、`FLAG_TOL` |
| 编辑与界面标签 | M3（第 2 波） | `Structure.fix/free/fix_layers/fixed_indices`、`axis_labels(cell)`（逐轴规则，六方 slab 得 `['a','y','z']`）、`cartesian_to_flags(cell, fixed_xyz)`（**True = 固定**，用 `cartesian_to_lattice_flags` 实现，不精确时返回 `None`，保证界面标签与文件换算用同一判据） |

v1 的 `has_constraints`、`move_flags`、`set_move_flags`、`clear_constraints`、`constraint_counts`、`constraint_axis_names` 全部删除（由上表的函数覆盖）。
F0-D 的测试文件命名为 `tests/test_constraints_core.py`、`tests/js/constraints-core.test.mjs`，M3 使用 `test_constraints.py`（避免第 0 波与第 2 波抢同一文件）。

#### 3.8.3 基变换规则（K3）——精确算法

记旧（参考）晶格矢量为行 `a_0, a_1, a_2`，新晶格矢量为行 `b_0, b_1, b_2`，两者在**同一个笛卡尔参考系**中表达。
对一个原子的标志 `f`：可动子空间 `S = span{a_k : f_k}`。

```text
transform(f):
    c ← f 中 True 的个数
    c == 0 或 c == 3 → 返回 f，精确           （完全固定/完全可动在任何晶胞操作下都保持）
    basis ← [a_k : f_k]                       （1 或 2 个矢量）
    g_j ← in_span(b_j, basis)  (j = 0,1,2)
    精确 ⇔ count(g) == c                       （b_j 线性无关，故 span{b_j : g_j} ⊆ S 且维数相等即相等）
    返回 g（不精确时 g 仍是 S 的子空间：只收紧，从不放松）

in_span(v, basis, tol = FLAG_TOL = 1e-6):    （两种语言都用这一个公式，工程 #15：v1 的 Python 原型用 QR 残差）
    |v| == 0 → True
    1 个矢量 u：|v × u| ≤ tol · |v| · |u|          （夹角正弦）
    2 个矢量 u, w：n = u × w；|v · n| ≤ tol · |v| · |n|   （与法向夹角余弦）
```

- 对 N 个原子：按 8 种标志模式缓存结果，O(N)。
- **各操作给出的"参考系"**（`old_vectors`、`new_vectors` 由调用方给出）：

  | 操作 | old_vectors | new_vectors | 结果 |
  |---|---|---|---|
  | 整数超胞 `P`（M1） | 旧晶胞 | `P @ cell` | 面内 `[[m11,m12,0],[m21,m22,0],[0,0,n]]` 下 `[T,T,F]`、`[F,F,T]` 精确 |
  | 重定义晶格、约化、原胞（M1） | 旧晶胞 | 新晶胞（原子不动） | 一般需要检查 |
  | `set_cell(scale_atoms=False)`、改真空且改变 c 方向（M1/M2） | 旧晶胞 | 新晶胞 | 只拉长 c：精确；把倾斜 c 改成垂直：`[T,T,F]` 精确，`[F,F,T]` → `[F,F,F]` 并写备注 |
  | 合并、粘贴（`extend`、`concat_structures`、M4、M6） | 来源晶胞（无晶胞时 I） | 目标晶胞（无晶胞时 I） | 晶胞相同时不变换 |
  | 刚性旋转、`set_cell(scale_atoms=True)`、应变（原子随晶胞变） | — | — | 标志指分数坐标，**不变**，不调用 |
  | 切面（M2） | — | — | 新结构，标志由 M2 重新设定 |

- 备注（`apply_basis_change`、`extend`、`concat_structures` 写入 `info.warnings`）：
  `selective dynamics: the partial constraints of 4 atom(s) do not follow the new cell vectors and were tightened (no atom gains freedom)`
- 验证 [V]：R30（hex，`P=[[2,1,0],[-1,1,0],[0,0,1]]`）、c(2×2)（`[[1,1,0],[-1,1,0],[0,0,1]]`）、p(2×1) 下 4 种常用模式全部精确；`a' = a + b` 时
  "只沿 a 可动"收紧为 `[F,F,F]`；把倾斜 c 正交化时 `[F,F,T]` 收紧；1e-9 的浮点噪声不影响判断。领域审查独立复现：4 种晶胞 × 5 种矩阵 0 例放松。
- 边界用例（工程 #15）：夹角正弦恰为 `0.5e-6` 与 `2e-6` 的矢量（容差两侧）；弛豫 CONTCAR 常见的 c 偏差：`c = (1e-5, 0, 30)` 时 `[F,F,T]` 精确，
  `c = (1e-4, 0, 30)` 时收紧。

#### 3.8.4 晶格系 ↔ 笛卡尔（extxyz 用）

- `lattice_to_cartesian_mask(flags, cell)` = `transform_move_flags(flags, old=cell, new=I)`（`cell` 为 None 时用 I）。
- `cartesian_to_lattice_flags(mask, cell)` = `transform_move_flags(mask, old=I, new=cell)`。
- 例 [V]：六方 slab（a ∥ x，b 在 xy 面内 120°，c ∥ z）：`[T,T,F]` ↔ `[T,T,F]`、`[F,F,T]` ↔ `[F,F,T]` 精确；`[F,T,F]`（只沿 b）无法用笛卡尔表达
  → `[F,F,F]` 并计为收紧；ASE 掩码"只 y 可动" → 晶格系 `[F,F,F]`。

### 3.9 tags 与 adsorbate_id（C4）

- `props.tags`：int，ASE 约定 1 = 顶层、2 = 次层…、0 = 吸附物或未标记；默认 0；切面时由 M2 写入，之后不自动重算。
- `props.adsorbate_id`：int，0 = 不是吸附物，1…n = 第几个吸附物；默认 0。
- `next_adsorbate_id(s) -> int` / `nextAdsorbateId(s)` = `max(adsorbate_id, default=0) + 1`（M5 用）。
- 合并时重新编号（领域 F12）：`extend(other, renumber_adsorbates=True)`、`concat_structures(..., renumber_adsorbates=True)` 把后来者的非零 id
  统一加上 `next_adsorbate_id(前者) − 1`，保证两个吸附物不会共用一个 id。
- 读写：extxyz 写成 `tags:I:1`、`adsorbate_id:I:1`（ASE 读成 `tags` 与普通数组，已验证）；JSON 保留；POSCAR/CIF/PDB/XYZ 不存储且**不报警告**（K9；
  能力表与 `docs/SCHEMA.md` 写明）。

### 3.10 POSCAR（两种语言）

#### 3.10.1 读取标志（仅当存在 Selective dynamics 行时）

检测规则不变（首字符 `s`/`S` 为 SD 行；随后一行首字符 `c C k K` 为笛卡尔）。每个坐标行：

```text
tokens ← line.split()；从第一个以 '!' 或 '#' 开头的词起全部丢弃（行内注释）
coords ← tokens[0:3]（不足 3 个：沿用现有的坐标错误）
rest ← tokens[3:]
rest 少于 3 个 → 标志缺失：[T, T, T]，记一次 (line, "missing")
否则对 rest[0:3] 每个词：匹配 FLAG_RE → 'Tt' 为 True、'Ff' 为 False；不匹配 → True，记一次 (line, "invalid", 词)
rest[3:] 忽略（pymatgen 在标志后写元素名）
```

- **少于 3 个附加词时一律视为"没有标志"**，不去解释单个 `F`（可能是氟的元素标签）。
- **无论 Direct 还是 Cartesian，标志都是晶格系，读取时不做换算**（VASP wiki：标志"refer to the positions of the ions in direct coordinates, no matter whether
  the positions are entered in Cartesian or Direct coordinate modes"，已下载核对；领域 F8）。报告 06 §7 写的"VASP 按文件里的坐标表示理解"有误，已请更正。
- 所有问题合并为一条备注：
  `selective dynamics: 4 line(s) had missing or unreadable T/F flags (first: line 14, 'Si'); those directions were read as T (free)`
  （首个问题为缺失时括号内写 `no flags`）。
- 标志存为 `props.selective_dynamics`（全 T 也保留，C3）。XDATCAR 后续帧没有标志，不受影响。
- 今天 Python 用 `p.upper().startswith("T")`（`io/poscar.py:100`），把 `.TRUE.` 读成固定；JS 读取器丢掉全部标志（`io/poscar.js:58-74`）——两者都按上面改。
- 词法表（两种语言同一结果，原型 [V]）：

  | 附加词 | 结果 | 备注 |
  |---|---|---|
  | `T T F` | T T F | 否 |
  | `.TRUE. .TRUE. .FALSE.`、`.T. .F. .T.`、`true false TRUE`、`t f t` | 按首字母 | 否 |
  | `T T F Si`（pymatgen） | T T F | 否 |
  | `Si`、`F`（1 个词）、空 | T T T | 缺失 |
  | `Fe Fe Fe` | T T T | 非法 |
  | `T T F ! Pt1` | T T F | 否 |

#### 3.10.2 写出

```text
frame ← Python：第 0 帧；JS：当前帧（与今天相同，导出检查说明是哪一帧，§3.12）
order ← poscar_order(symbols, blocks = props.poscar_species)（§3.10.3–3.10.4）
物种行、计数行按 order 的分块（物种行写元素符号；块标签只决定分块）
sd ← props.selective_dynamics；selective ← (sd 存在)            （今天要求"每项都是 3 元列表"，一个 None 就整块丢失）
selective → 写 "Selective dynamics"
"Direct"
对 i ∈ order：分数坐标（不包裹） + (selective ? 三个大写 T/F，取自 sd[i]) 
```

- 数字格式各语言维持现状（Python `%20.16f` 与 `>3s` 标志；JS `toFixed(10)` 后接 `  T  T  F`）；跨语言测试比较"对方读回的结果"，不比较文本。
- 没有晶胞：Python 照旧装箱（`center(vacuum=10.0)`，即每侧 10 Å）并给出导出警告（W3）；JS 照旧抛错 `POSCAR needs a unit cell…`（O-2 可选改为同样装箱）。

#### 3.10.3 `poscar_order`、`canonical_order` 与 "Sort atoms by species"

```text
poscar_order(symbols, order=None, blocks=None) → list[int]（新→旧，可直接作 src）：
    keys ← blocks ?? symbols                       （块标签，§3.10.4）
    species ← keys 按首次出现去重
    order 给出时：species ← [元素在 order 中的块（按 order，块内按首次出现）] + [其余块（按首次出现）]
    返回 i 的稳定排序（按 species 中的名次；块内保持原顺序）

canonical_order(symbols, layers=None, blocks=None) → list[int]：
    稳定排序，键 = (块的首次出现名次, layers[i] 若给出)       （layers：M3 find_layers 的整数层号，0 = 最底层）
```

- 定义在 `core`（Python `structure.py`，JS `structure.js`），`io/poscar` 导入它们（避免 core → io 的反向依赖）。
- `canonical_order` 用整数层号而不是原始高度排序：同一层内高度只差噪声，按高度排序会让两种语言的顺序不同。
- 原型 [V]：层序输入 `Ti O O Ti O O Ti O O`（层 0 0 1 1 1 2 2 2 3）→ `Ti0 Ti1 Ti2 O0 O1 O1 O2 O2 O3`，之后 `poscar_order` 为恒等。
- **K14 的用法**：M2、M6 生成结构时直接按 `canonical_order` 排列（§10.3、§10.7），于是导出 POSCAR 时文件顺序与内存相同，固定的底层原子仍在每个元素块的前面；
  M5 放吸附物时若 slab 原来已按元素分块，追加后做一次稳定的 `sort_by_species()`（单步 remap，源映射照常组合），否则追加在末尾（§10.6）。
- `Structure.sort_by_species(order=None)` / `sortBySpecies(order)` = `remap(poscar_order(...))`，所有帧一起重排，`source_map` 即排序。

#### 3.10.4 物种行重复的元素块（领域 F7）

- 读取：物种行在规范化后出现重复元素（如 `Ga As H H / 1 1 2 2`：两种赝氢；或反铁磁氧化物把同一元素分成两块以便分别设 MAGMOM、LDAU）时，
  写逐原子属性 `props.poscar_species`：若这些重复块的原始词互不相同（`H.75`、`H1.25`）就用原始词，否则用 `H`、`H#2`、`H#3`……；物种行没有重复时不写这个键。
- `poscar_order`、`sort_by_species`、写出器在该键存在时按它分块（首次出现顺序）。物种行写元素符号（VASP 只取物种名的前两个字符，写 `H.75` 会变成 `H.`）。
- 新原子的默认值：同元素第一个块的标签（§3.2 第 5 条）。原型 [V]：`Ga As H H / 1 1 2 2` 往返不变；再加一个 H 后写成 `Ga As H H / 1 1 3 2`。
- 今天两种语言都把它写成 `Ga As H / 1 1 4`，与用户的 4 段 POTCAR 对不上。

#### 3.10.5 XDATCAR（领域 F19，S-4）

- JS：帧循环（`io/poscar.js:81-88`）跳到下一个 `configuration` 行之前，若跳过的行里有完整的晶格头（缩放、三个晶格矢量、物种、计数，即 NPT/ISIF=3 的可变晶胞 XDATCAR），
  读入该帧的晶胞（乘缩放因子）存到 `frames[i].cell`，并用它换算这一帧的分数坐标。今天用第一帧的晶胞换算所有帧，坐标是错的。
- Python（S-4）：`read_poscar` 读完第一块后继续读 `configuration` 块，规则与 JS 相同；读取器注册的文件名加上 `xdatcar`（`io/__init__.py:439` 起的 `_register_builtins`）。

#### 3.10.6 CONTCAR 速度块（O-5，可选）

坐标之后若有速度块（首行为空或以 `C c K k` 开头 = Cartesian，Å/fs；其他 = Direct，晶格矢量/时间步；不乘缩放因子；VASP wiki POSCAR 页）：
读入 `props.velocities`（统一存 Cartesian Å/fs）；写 POSCAR 时若该键存在且非全零则写回（空行 + Cartesian）。晶格速度块（`L` 开头）与预测-校正块忽略。
不做时：两种语言的读取器照旧忽略坐标之后的内容（今天即如此）。

### 3.11 extxyz（两种语言，D5）

#### 3.11.1 注释行词法（与 ASE `key_val_str_to_dict` 相同，`ase/io/extxyz.py:67-187`）

```text
逐字符：
  转义中        → 原样加入当前词，退出转义
  '\'           → 进入转义
  在定界符内    → 遇到配对的结束符则退出，否则原样加入
  ' " { [       → 进入定界符（结束符 ' " } ]）
  空白          → 结束当前词（连续空白合并）
  '='           → 当前对从"键"进入"值"
  其他          → 加入当前词
一对只有键没有 '=' → 值为 None（视为 True）；值里多余的 '=' 用 '=' 拼回
```

取代 Python 的 `_KV_RE`（`io/xyz.py:25-27`，不支持 `[...]`）与 JS 的 `parseKeyValues`（`io/xyz.js:7-13`，不支持 `\"`，会把 ASE 的 `_JSON` 值截断成 `_JSON {\`）。
`Lattice`、`Properties`、`pbc` 的键名照旧不区分大小写。

#### 3.11.2 值转换 `convert_value(raw)`（两种语言同一规则；只用于 info）

```text
raw 为 None                      → True
以 "_JSON " 开头                 → JSON 解析其后部分；失败则保留原字符串并写备注
                                    info 'surface': could not decode the _JSON value; kept as text
parts ← 按 [ \t,]+ 切分（只认 ASCII 空格、制表符与逗号），去掉空串
  全部匹配 INT   ^[+-]?[0-9]+$                                   → int（一个）或 int 列表；|值| > 2^53−1 时按浮点（两种语言一致）
  全部匹配 INT 或 FLOAT ^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eEdD][+-]?[0-9]+)?$ → float 或 float 列表（D 指数）
  全部 ∈ {t, true, f, false}（不分大小写） → bool 或 bool 列表（比 ASE 宽，兼容 0.3.1）
其他                              → 原字符串
```

- 正则只认 ASCII（Python 加 `re.ASCII`）；实现**不得**直接用 `int()`/`float()` 试转——Python 的 `int('1_000')` 得 1000、`float('inf')` 得 inf、
  `int('١٢')` 得 12，JS 结果不同（工程 #12 [V]）。`inf`/`nan` 按字符串保留（info 必须可写成 JSON）。
- **变化**：0.3.1 Python 把多个整数读成浮点列表；现在与 ASE 一致读成整数列表。
- `name` 键一律作字符串（结构名）；JS 不再拿 `config_type` 当名字（`io/xyz.js:73`，与 Python 对齐，工程 #13），`config_type` 进 info。

#### 3.11.3 列

- `Properties` 的类型字母 R/I/L/S（不分大小写），其他按 S。两种语言都保留**任意宽度、所有类型**的列（JS 今天只留宽度 1 的 R/I，`io/xyz.js:45`——删除这个过滤）。
  宽度 1 → 标量，> 1 → 列表。
- 词法：R 用上面的 FLOAT（含 D 指数），不合法报错 `XYZ: line 12: column 'forces' expects a number, found "abc"`；I 用 INT，不合法同样报错；
  L：大写后 ∈ {T, TRUE, 1} 为 True，其余 False（Python 现行为，ASE 同样把未知值当 False）；S 原样。
- 元素列名：`species`/`element`/`symbols`（不分大小写），或 `Z`/`numbers`；坐标列 `pos`/`positions`。
- 列名映射与 ASE 相同：读取时 `charge` → `charges`（ASE 把计算得到的电荷写成 `charge` 列，`PROPERTY_NAME_MAP`），写出时用 `charges`（ASE 两种都认）。
  由此 `charges` 按 ASE 语义是计算结果（`RESULT_PROPS`），编辑后被删除；输入电荷请用 `initial_charges`（文档写明）。

#### 3.11.4 约束列

读取：

```text
mm  ← 弹出列 move_mask（若有；ASE 语义：True = 可动，笛卡尔）
old ← 弹出列 selective_dynamics（若有；Facet ≤ 0.3.1 写的 L:3，晶格系）
mm 存在：
    宽度 1 → 每原子 [b, b, b]
    宽度 3 → cartesian_to_lattice_flags(mm, cell)；收紧 > 0 → 备注
             move_mask: the Cartesian constraints of 2 atom(s) do not follow the cell vectors and were tightened
    其他宽度 → 忽略并写备注 move_mask must have 1 or 3 columns; it was ignored
    old 也存在 → 备注 both move_mask and selective_dynamics columns were found; move_mask was used
mm 不存在而 old 存在 → 原样作为晶格系标志（宽度 1 时由规范化器扩成三份）
结果 → props.selective_dynamics（经规范化器）
```

- 绝不把 `fixed` 当别名（真值相反；`tests/test_io.py:43-52` 把它当普通属性）。

写出（K4）：

```text
sd ← props.selective_dynamics
若 sd 存在 且 不是全部 [T,T,T]：
    mask, t ← lattice_to_cartesian_mask(sd, cell)
    （O-3 constraints="fix-partial" 时：mask 中既有 T 又有 F 的行改为 [F,F,F]）
    width ← 1 若每行全 T 或全 F，否则 3
    写列 move_mask:L:width，紧跟在 pos 之后（ASE 的列序）
    t > 0 → 导出警告 W5；width == 3 → 导出警告 W6（§3.12.2）
全部可动 → 不写（ASE 约定）
不再写 selective_dynamics:L:3（D5）
```

- W6 的原因 [V]（领域 F4）：ASE 3.29 读宽度 3 的 `move_mask` 时为**每个**原子建 `FixCartesian`（完全固定的也是），而 ASE 的 POSCAR 写出
  （`ase/io/vasp.py` 的 `_handle_ase_constraints`）只认 `FixAtoms`、`FixScaled`、`FixedPlane`、`FixedLine`，不报任何警告——用户执行
  `ase.io.write('POSCAR', ase.io.read('slab.extxyz'))` 后，底层固定原子全部变成 `T T T`。宽度 1 时 ASE 读成 `FixAtoms`，写 POSCAR 正确。
- 代价：0.3.1 的读取器会把 `move_mask` 当成普通属性（可接受：0.3.1 本来就不懂 ASE 约束）。

#### 3.11.5 其他属性列

属性列沿用 `_prop_columns`（`io/xyz.py:214-258`）的规则：名字匹配 `[A-Za-z_]\w*`；每行宽度相同且 ≥ 1；bool→L、int→I、float→R（Python `%.8f`，JS `toFixed(8)`）、
非空无空白字符串→S；I 与 R 混合按 R。**不满足时不再静默跳过**：同一个函数 `extxyz_columns(structure) -> (columns, skipped)` 返回跳过原因，写出器忽略、
导出检查报告（W8）。原因文案：`it has missing values`、`its rows have different lengths`、`its values are not all numbers, booleans or single words`、
`its name is not a valid column name`。`tags`、`adsorbate_id`、`poscar_species` 就是普通 I/S 列。

#### 3.11.6 info 的写出（K15，取代 `io/xyz.py:266-275` 与 JS `:105`）

```text
跳过：format、filename、source、warnings（§3.6）、name（单独写）、键名不匹配 ^[A-Za-z_][A-Za-z0-9_\-.:]*$ 的、
      与 Lattice/Properties/pbc 同名（不分大小写）的、值为 None 的
bool → T / F
有限数值 → 整数写十进制；浮点写 Python repr / JS String，RESULT_INFO 的键在 JS 中整数值补 ".0"；非有限：跳过
str：不含换行 且 convert_value(s) 读回的正是这个字符串 → escape(s)
     否则 → escape("_JSON " + JSON 字符串)               （"225"、"T"、"1 2 3"、"false" 读回不变，工程 #13）
stress / virial：3×3 嵌套、9 个数、或 6 个 Voigt 分量（xx yy zz yz xz xy，按 ASE voigt_6_to_full_3x3_stress 展开）→ 带引号的 9 个数（行优先）
一维列表、长度 ≥ 2：全是 bool → "T F T"；全是有限数值 → 空格分隔（全为整数则写整数，否则全部按浮点写）
其余 list / dict（长度 0 或 1、嵌套、字符串列表、混合类型）→ escape("_JSON " + 紧凑 JSON)；含非有限数时跳过
    （Python json.dumps(separators=(",", ":"), ensure_ascii=False, allow_nan=False)；JS JSON.stringify）
escape(s) ← s 为空，或含空白、引号、=、{}、[]、\ 时：'"' + s.replace('\', '\\').replace('"', '\"') + '"'；否则 s
```

- 理由 [V]：ASE 对 `Lattice`、`stress`、`virial` 要求 9 个普通数字（`SPECIAL_3_3_KEYS`），v1 的 `stress="_JSON [...]"` 让 ASE 抛
  `ValueError: Got info item stress, expecting special 3x3 matrix`，整个文件打不开（领域 F5、工程 #5）。一维数值列表按 ASE 写 numpy 数组的方式写
  （`supercell="2 2 1"`），ASE 与我们都读回相同的值。
- 比 ASE 多转义反斜杠：ASE 不转义 `\`，它自己写出的含引号的 `_JSON` 值读不回（`JSONDecodeError`），含反斜杠的被静默改坏（`a\b` 读回 `a\x08`，工程 #25 [V]）；
  我们写出的 ASE 都能正确读回。
- 原型 [V]：33 个键四个方向 0 处不一致，ASE 3.29 读回 stress（Voigt 0.1, 0.2, 0.3）、能量与全部字符串（附录 A）。
- 注释行顺序：`Lattice`（有晶胞时）`Properties` `pbc` `name` 其余 info。无晶胞时扩展格式也写 `Properties` 与 `pbc="F F F"`（JS 今天只写名字，`io/xyz.js:105-106`）。
- 读取：所有非保留键经 `convert_value` 进 info；`name` → 结构名；剩余文字 → `info.comment`（Python 现行为，JS 补上）。文件里的 `warnings` 键当普通键读入
  （我们从不写它；外来文件若有，作为备注在导入时显示一次）。
- M4 的剪贴板键 `facet_clip=<id>` 按普通字符串往返（用例见 §7.3）。

#### 3.11.7 多帧（S-5）

- 读取：沿用"第 0 帧的 props 与 info"（`from_frames`），本期不做逐帧数据。
- 写出：`RESULT_PROPS` 列与 `RESULT_INFO` 键**只写在第 1 帧**；其余帧不写，而不是把第 1 帧的数值抄过去（今天的行为会伪造数据，05 报告 §3.2）。
  导出警告 W9：`forces, energy are known only for frame 1 and were written for that frame only`。

### 3.12 导出检查

#### 3.12.1 能力表（两种语言内容相同，Python `facet/io/capabilities.py`，JS `facet/web/js/io/capabilities.js`）

| 写出器 id | `label` | `frames` | `cell` | `constraints` | `occupancy` | `order` | `pbc` | `overlap` | `handedness` |
|---|---|---|---|---|---|---|---|---|---|
| `json` | Facet JSON | `all` | `true` | `lattice` | `true` | `keep` | `stored` | `false` | `false` |
| `extxyz` | Extended XYZ | `all` | `true` | `cartesian` | `true` | `keep` | `stored` | `true` | `false` |
| `xyz` | plain XYZ | `all` | `false` | `none` | `false` | `keep` | `none` | `false` | `false` |
| `poscar` | POSCAR | `one` | `required` | `lattice` | `false` | `species` | `periodic` | `true` | `true` |
| `cif` | CIF | `one` | `required` | `none` | `true` | `keep` | `periodic` | `true` | `false` |
| `pdb` | PDB | `all` | `true` | `none` | `false` | `keep` | `periodic` | `false` | `false` |

- `pbc`：`stored` = 文件保存 pbc；`periodic` = 读回时有晶胞即 T T T（二维原型的 T T F 写出后变成 T T T，按 K9 不报警告，POSCAR 另有说明 N2）；`none` = 不存晶胞。
  这一栏回答工程审查"规格缺失"第 7 条，同时写进 `docs/SCHEMA.md`。
- `overlap`：导出时做原子重叠检查（S-3，§3.12.3）；`handedness`：检查左手晶胞。
- Python：`WriterSpec` 增加字段 `capabilities: dict | None = None`（`io/__init__.py:95-113`），`register_writer(..., *, capabilities=None)`（新关键字参数，
  写出函数签名 `func(structure) -> str` 不变）；内置写出器在 `_register_builtins` 里带上表中的值。
- **校验**（工程 #24）：注册时检查键与取值集合，Python 不合法抛 `ValueError("writer 'myfmt': capabilities.constraints must be one of lattice, cartesian, none")`；
  JS `formats.register` 同样校验，`console.warn` 后忽略整个能力表。插件不声明能力时 `export_report` 返回空结果（不猜）。
- `formats()`（`GET /formats`）的写出器条目增加 `capabilities`（附加字段）；网页的服务器格式把它抄进注册项（§3.12.5）。

#### 3.12.2 `export_report(structure, format, *, frame=None) -> {"warnings": [...], "notes": [...]}`（JS `exportReport(structure, formatId, {frame})`）

`export_warnings(...)`、`export_notes(...)` 是它的两个薄包装。**警告** = 影响计算或丢失用户数据；**说明** = 不影响计算，只在 Export notes 与 CLI 中出现。

```text
caps ← 写出器能力；None → 空结果
F ← caps.label；k ← frame ?? (Python 0；JS structure.frame)；c ← structure.constraint_summary()
警告：
W1  frames == "one" 且 n_frames > 1        → "{F} holds one frame: wrote frame {k+1} of {n}"
W2  cell == false 且 有晶胞                 → "plain XYZ does not store the unit cell; use Extended XYZ to keep it"
W3  cell == "required" 且 无晶胞（Python；JS 仅在 O-2 后）
                                            → "{F} needs a unit cell: the atoms were placed in a box with 10 Å of vacuum on each side (20 Å between periodic images)"
W4  c.fixed + c.partial > 0 且 constraints == "none"
                                            → "{m} atom(s) are fixed or partly fixed (selective dynamics), but {F} cannot store constraints; use POSCAR, Extended XYZ or Facet JSON to keep them"
W5  constraints == "cartesian" 且 lattice_to_cartesian_mask 收紧 t > 0
                                            → "Extended XYZ stores constraints along x, y and z (ASE move_mask): the partial constraints of {t} atom(s) are along cell vectors that are not x, y or z and were tightened; POSCAR keeps them exactly"
W6  constraints == "cartesian" 且 写出的 move_mask 宽度为 3
                                            → "Extended XYZ stores these constraints as ASE FixCartesian masks because {p} atom(s) are only partly fixed; ASE's VASP writer ignores FixCartesian and would write every atom as free, so export POSCAR from Facet for VASP"
W7  occupancy == false 且 |occupancy − 1| > 1e-6 的个数 q > 0
                                            → "{q} site(s) are partially occupied, but {F} cannot store occupancy; they are written as full atoms"
W8  extxyz：extxyz_columns 的每个 skipped  → "property '{key}' was not written: {reason}"
W9  extxyz 且 n_frames > 1 且 有结果类 props/info → §3.11.7 的文案
W10 handedness 且 det(cell) < 0             → "the cell is left-handed (negative volume); VASP stops on such cells, so swap two cell vectors first"
W11 overlap 且 close_contacts 找到 r 对     → "{r} pair(s) of atoms are closer than 0.5 Å (e.g. atoms 12 and 13, 0.00 Å apart)"
                                              （序号从 1 开始，与界面一致；周期性按写出后文件的含义：pbc 一栏为 periodic 时取 T T T，stored 时取结构的 pbc）
说明：
N1  order == "species" 且 poscar_order 不是恒等
                                            → "POSCAR groups atoms by element, so the atom order in the file differs from the order in the structure; sort the atoms by species to make them match"
N2  format == poscar 且 某轴 pbc 为 F 且有晶胞
                                            → "POSCAR is always periodic: c was not periodic and is written as a cell vector with a {w} Å gap between periodic images"
                                              （w = find_vacuum_gap(s, k, min_width=0, periodic_only=False).width，一位小数）
```

- 与写出器共用判断函数（`constraint_summary`、`lattice_to_cartesian_mask`、`extxyz_columns`、`poscar_order`、`close_contacts`），避免两套逻辑。
- 不报告：tags、`adsorbate_id`、labels、info 的丢失（K9）。
- W10 的依据：VASP 对体积为负的晶胞报错退出（领域 F13 引用的 ASE 邮件列表与 sisl issue；未本地复现，属开发期核对项）。
- W3 的文案按 U4 写清"每侧"与"周期像之间"：Python 的 `center(vacuum=10)` 是每侧 10 Å（`structure.py:533-560`）。

#### 3.12.3 `close_contacts(structure, cutoff=None, *, pbc=None, limit=None)`（新，S-3）

Python `facet/analysis/contacts.py`，JS `web/js/core/contacts.js`（新文件，不改现有的成键代码：`findPeriodicNeighbors` 与 `neighbor_arrays`
会丢掉小于 0.4/0.1 Å 的原子对，正好漏掉重叠）。

```text
cutoff ← cutoff ?? SURFACE_DEFAULTS.overlap_distance（0.5 Å）；pbc ← pbc ?? structure.pbc
有晶胞且有周期轴：分数坐标沿周期轴包裹到 [0, 1)；把距周期面 cutoff 以内的原子按 ±1 个晶格矢量复制成像（沿高度 h_k 的比例 cutoff/h_k）
把家原子与像放进边长 cutoff 的网格；对每个家原子 i 查 27 个相邻格；记录 d < cutoff 的 (min(i,j), max(i,j), d)，j 为像的源原子；
  同一原子与自己的像也算（晶胞过小）；去重后按 (i, j, d) 排序；limit 给出时只返回前 limit 对
```

复杂度 O(N)（网格），原型 [V]：1 万原子两种语言找到同样的两对，JS 34–89 ms、Python 110 ms（未优化，预算见 §7.6）。

#### 3.12.4 通道

| 通道 | 行为 |
|---|---|
| Python `to_text(s, fmt)` | 不变，不发警告（纯函数，服务器与 CLI 自己取报告） |
| Python `write(dest, s, format)`（`io/__init__.py:410`） | 写完后对每条**警告** `warnings.warn(msg, ExportWarning, stacklevel=2)`；说明不发；`ExportWarning(UserWarning)` 定义在 `facet.io` 并导出 |
| REST `POST /io/export` | `ExportResponse.warnings: list[str] = []`、`notes: list[str] = []`（附加字段，`server/models.py:135-138`） |
| 客户端 | `export_structure(...)` 不变；新增 `export_structure_with_warnings(structure, format) -> ExportResult`（`text`、`filename`、`mimetype`、`warnings`、`notes`；工程 #23：不让返回类型随参数变化） |
| CLI | `convert` 与 `build … -o`（`_write_or_print`，`cli.py:131-150`）写文件后逐条 `facet: warning: …` / `facet: note: …` 到 stderr；内部用 `warnings.catch_warnings()` 屏蔽 `ExportWarning` 以免重复；退出码不变 |
| JS `exportStructure(s, id)` | 返回 `{text, filename, mime, warnings, notes}`，契约见 §3.12.5 |
| 网页 `app.exportStructureFile` | 见 §5.3 |
| 公共 JS API | `facet.exportText(format, s)` 不变；新增 `facet.exportReport(format, s = app.structure) → {warnings, notes}`（同步，所有格式） |

#### 3.12.5 JS `exportStructure` 的同步契约与服务器格式（工程 #11）

- `exportStructure` **保持同步**（`io/index.js:96-102`）。`warnings`、`notes` 总是普通数组，由本地 `exportReport` 算出；`text` 对本地格式是字符串，
  对服务器格式照旧是 Promise（今天即如此）。因此 `facet.exportText(...)`（`api/public.js:303`）与嵌入页白名单里的 `exportText`（`api/embed.js:21`）行为不变。
- `installServerFormats`（`api/extensions.js:176-195`）把 `GET /formats` 中写出器的 `capabilities` 抄进注册项，于是服务器格式的警告也在本地同步算出，
  且与服务器响应里的 `warnings` 由同一张表决定（P1）。插件契约 `write(structure) → string | Promise<string>` 不变。
- `app.exportStructureFile` 已经 `await out.text`（`app.js:1320-1321`），警告直接读 `out.warnings`。单元测试用假 store 覆盖服务器格式。

### 3.13 真空间隙（U1，K5/K6）

U1：导入时的 slab 识别"要做，但要无感"——只提供内部的真空间隙检测，供（1）显示、（2）层分析与吸附位点判断上下表面、（3）slab 工具使用；
不改 pbc、不改结构、不改导出；slab 与非 slab 不做任何其他区分。本节的函数**全部只读**，只有 §3.13.4 的 `make_contiguous` 修改坐标，且只供显式编辑调用。
Python 在新文件 `facet/analysis/vacuum.py`（加入 `analysis.__all__`），JS 在新文件 `web/js/core/vacuum.js`。

#### 3.13.1 `find_vacuum_gap`

```text
find_vacuum_gap(structure, axis=None, *, min_width=None, frame=None, periodic_only=True) -> VacuumGap | None
VacuumGap = {axis, start, end, width, center, height}
    min_width ← min_width ?? SURFACE_DEFAULTS.vacuum_gap_min（5.0 Å）；min_width = 0 表示总是返回最宽的间隙
    frame ← frame ?? (Python 0；JS structure.frame)；pos, cell ← 该帧的坐标与晶胞（帧无晶胞时用基础晶胞）
    无晶胞或无原子 → None
    轴的候选顺序 ← axis 给出时 [axis]，否则 [2, 1, 0]（c 优先）
    对每个候选轴 k（periodic_only 且 pbc[k] 为 F 时跳过）：
        f ← 分数坐标的第 k 列（Python np.linalg.solve；JS inv3）
        w ← wrap_fractional(f)，再把 < 0 的值置 0          （[0, 1)；f = −1e-17 与 f = 0 结果相同，领域 F18）
        升序排序 w；Δ_i = w_{i+1} − w_i（i < n−1），Δ_{n−1} = w_0 + 1 − w_{n−1}（跨 f = 1 的环绕间隙）
        h ← |det cell| / |a_{k+1} × a_{k+2}|               （f_k = 常数的晶面间距，对倾斜 c 同样正确）
        宽度 W_i = Δ_i · h；top ← max W_i
        j ← {i : W_i ≥ top − tol} 中 w_i 最小者             （轴内并列取 start 最小；tol = position_tolerance = 1e-5 Å）
        cand ← {axis: k, start: w_j, end: w_{(j+1) mod n}, width: W_j, center: (w_j + Δ_j/2) mod 1, height: h}
        cand.width < min_width − tol → 跳过
        best 为空 或 cand.width > best.width + tol → best ← cand    （跨轴并列时先到者胜，即 c、b、a）
    返回 best
```

- 字段：`start` = 间隙下方最后一个原子的 f（上表面），`end` = 间隙上方第一个原子的 f（下表面），`center` 为间隙中点，三者都在 [0, 1)；
  `end ≤ start` 表示间隙跨过 f = 1（slab 不跨晶胞边界；只有一个原子时 `start = end`、`width = height`）。`width`、`height` 单位 Å，`width / height` 为分数宽度。
  与 F0-A §3.8.2 / §10 的契约 `{axis, start, end, width, center}` 相同，`height` 为附加字段。
- **并列规则写死**（工程 #4）：宽度差 ≤ 1e-5 Å 视为并列。轴内取 `start` 最小者，跨轴按 c、b、a 的顺序（领域 F1 的建议；C5 的标准取向把真空放在 c）。
  原型 [V]：400 个任意取向的"两个相同 slab"晶胞上两种语言 0 处不一致；v1 的"取第一个最大值"有 174 处不一致。
- 阈值比较带容差（`≥ min_width − tol`），恰为 5 Å 的间隙两种语言判断相同。
- 复杂度 O(n log n) 每轴；1 万原子 JS 3.5–3.9 ms（三轴）。

#### 3.13.2 `find_vacuum_gaps`、`find_surface_gap`、`vacuum_gap_hint`

- `find_vacuum_gaps(structure, *, frame=None, periodic_only=True) -> [VacuumGap | None] × 3`：每轴 `find_vacuum_gap(s, k, min_width=0, ...)`，诊断用
  （M5 的 `find_vacuum_gaps(s, frame=0)` 调用继续可用，但 M5 应改用 `find_surface_gap`，§10.6）。
- `find_surface_gap(structure, *, frame=None) -> VacuumGap | None`——**表面工具与显示共用的那一个间隙**（领域 F10）：
  1. `find_vacuum_gap(s, frame=frame)` 有结果 → 返回它；
  2. 否则，若 `info.surface.axis`（M2 写入）是一个周期轴 → 返回该轴上最宽的间隙（`min_width=0`，即使低于阈值）；
  3. 否则 → `None`。
  只在没有达到阈值的间隙时才用来源信息里的轴，因此对导入的结构与生成的结构行为相同（U1 的"不区分"）；它只让"10 Å 真空 + 直立吡啶"
  （最宽 3.3 Å，原型 [V]）这类自己生成的 slab 仍能分出上下表面。
- `vacuum_gap_hint(structure) -> str`：没有间隙时各工具共用的说明（U1"没有间隙时给出说明"），带实测值：
  `no vacuum gap of 5 Å or more along a periodic cell vector (the widest is 3.3 Å along c); add vacuum first`；没有晶胞时
  `the structure has no unit cell, so it has no vacuum gap`。界面显示时首字母大写、加句号。

#### 3.13.3 共用切口 `gap_cut`、`unwrap_along_gap`（领域 F1 第 3 条）

```text
gap_cut(gap) = gap.center > 0.5 ? gap.center − 1 : gap.center           （∈ (−0.5, 0.5]）
unwrap_along_gap(f, gap) = f − floor(f − gap_cut(gap))                    （∈ [cut, cut + 1)；f 可为数组）
```

- 与 F0-A §3.8.2 的显示规则逐字相同（F0-A 应直接调用它，而不是在 `display.js` 里再写一份）；M3 的层分析、M5 的位点、M2 的 slab 工具都用它判断"哪边是上表面"，
  U1 的三个用途因此用同一个切口。切口在间隙中点，最近的原子也在半个间隙宽度之外，不需要额外容差。
- 原型 [V]：454 个情形上两种语言的展开坐标逐原子相同（差 < 1e-9）。

#### 3.13.4 `make_contiguous(structure, axis, *, gap=None, frame=None) -> int`（只供显式编辑）

```text
gap ← gap ?? find_vacuum_gap(structure, axis, min_width=0, frame=frame)；None → 返回 0
参考帧的 f ← 分数坐标第 axis 列；n0_i ← −floor(f_i − gap_cut(gap))         （精确整数）
在 m ∈ {0, −1, +1} 中取使 count(n0_i + m ≠ 0) 最小者（并列按 0、−1、+1 的顺序）；shift_i = n0_i + m
每一帧：pos_i += shift_i · a_axis（所有帧用同一组整数平移，轨迹不跳格，工程 #1 的连带问题）
返回被移动的原子数
```

- 只按整数个晶格矢量平移，周期结构在物理上不变（`mark_edited` 的 `"translate"`，不清除任何信息）；JS `touch()`。
- 调用方：M2 的 `centerSlab`、`set_vacuum`（U1 第 3 条）。**绝不在导入或显示时调用**。原型 [V]：底层被包裹到顶部的 CONTCAR 移动 9 个原子后连续；已连续的 slab 移动 0 个。
- 签名按 M2 §10.1 的 `make_contiguous(structure, axis) -> int`（原位），另加 `gap`、`frame` 关键字。

#### 3.13.5 `set_pbc`

只改 pbc（`_as_pbc`/`normalizePbc` 规范化），不移动原子、不改晶胞、没有界面入口（U1/U2）；pbc 确有变化时 `mark_edited(s, "pbc")`。保留它是因为它是
ASE 的名字、做输入校验，并在 JS 中 `touch()`（直接给 `pbc` 赋值不会递增 `rev`）。

#### 3.13.6 阈值 `vacuum_gap_min = 5.0 Å` 的依据（领域 F9 更正）

- 单原子原胞的间隙等于最大的晶面间距 d_hkl；已知元素中最大的是 bcc Cs 的 d110 = a/√2 = 4.34 Å（a = 6.14 Å），其次 bcc Rb 3.95 Å、fcc Xe 3.58 Å；
  多原子体相（石墨 3.36、2H-MoS2 2.98、简单立方 Po 3.36、Bi2Se3 六方设置 2.58 Å）更小。原型 [V]：这些都不检出。5 Å 阈值仍然安全，余量 0.66 Å。
- 实际 slab 的真空通常 ≥ 10 Å；但带直立分子或双层水时剩余间隙可能低于阈值（10 Å 真空 + 直立吡啶为 3.3 Å，12 Å 真空 + 双层水为 5.8 Å），由
  `find_surface_gap` 的第 2 条处理。
- 文档写明 `vacuum_gap_min` 不能调到 4.4 Å 以下（否则 bcc Cs 原胞会被当成有真空）。与 M3 原型的 `vacuum_gap_min` 同名同值。

### 3.14 命名基础（C9，S-1）

`facet/core/naming.py` 与 `facet/web/js/core/naming.js`：

```text
TIMES = "×"
format_repeat((2, 2, 1)) → "2×2×1"
add_repeat_suffix(name, reps):
    reps 全为 1 → name（不变）
    name == "" → ""（Python；JS 名字不会为空）
    name 以 " A×B×C"、旧的 " AxBxC" 或 JS 旧的 " (A×B×C)" 结尾
        （正则 ^(.*\S)\s+\(?(\d+)[x×](\d+)[x×](\d+)\)?$，括号须成对）→ base + " " + format_repeat(旧值 × reps，逐项相乘)
    否则 → name + " " + format_repeat(reps)
```

- Python `repeat` 名字从 `"Cu fcc 2x2x2"` 变为 `"Cu fcc 2×2×2"`，叠加 `2×1×1` 两次得到 `"Cu fcc 4×1×1"`（今天是 `'Cu fcc 2x1x1 2x1x1'`）。
- JS `repeat` 名字从 `"Cu (Face-centred cubic) (2×2×2)"` 变为 `"Cu (Face-centred cubic) 2×2×2"`（与 `build/crystal.js:99` 的格式一致）；0.3.1 项目里已有的
  `… (2×2×2)` 再做 2×1×1 得到 `… 4×2×2`（工程 #20）。
- 切面、Wood 记号、矩阵超胞的命名规则由 M2/M1 在此模块上扩展。

### 3.15 二面角、默认参数表与元素数据（D7，U5 要求修）

#### 3.15.1 二面角（M-17）

- 事实 [V，两份审查独立复核]：JS `measureValue`（`render/viewer.js:1949-1961`）与 `geometryValue`（`ui/selectioncard.js:54-64`）用
  `atan2((n1 × b̂2)·n2, n1·n2)`，恰为 IUPAC 符号的相反数；Python `dihedral_from_vectors`（`analysis/geometry.py:52-65`）为 IUPAC，[0, 360)，与 ASE 一致。
- 新 `facet/web/js/core/geometry.js` 导出 `dihedralFromVectors(b0, b1, b2)`（公式与 Python 逐项相同，返回 [0, 360)）与 `signedAngle(deg)`（映射到 (−180, 180]）；
  查看器与选区卡片都显示 `signedAngle(dihedralFromVectors(...))`。M4 的"设定二面角"用同一函数（不再另写 `dihedralDeg`）。
- 影响：网页上显示的二面角符号翻转（这是更正）。

#### 3.15.2 默认参数表（M-19；领域 F15、工程 #21）

原则：**逐项取更准确的值**，不机械地以某一种语言为准；参考表放在 Python，由脚本生成 `web/js/build/reference.js`，测试核对两边逐项相等。

| 项 | Python（`build/crystal.py`） | JS（`build/crystal.js`） | v2 定案 |
|---|---|---|---|
| 无 `a` 时的晶格常数 | 原型默认值 + 按元素的参考表（`_REF_A`、`_REF_C`、`_REF_AB`，如 Pt 3.92） | 只有原型默认值（任何 fcc 元素都是 3.615） | JS 使用参考表；Build 面板换元素时预填 a/c |
| fcc / bcc / hcp 默认 | 3.61 / 2.87 / 3.21, 5.21 | 3.615 / 2.866 / 3.209, 5.211 | 取 JS 值（室温实验值 Cu 3.615、Fe 2.866、Mg 3.209/5.211），并同步改参考表中 Cu、Fe、Mg 的值 |
| sc 默认 | 3.359 | 3.35 | 取 Python 值（Po 3.359） |
| bcc Cr 参考值 | 2.91 | — | 2.884（室温实验值） |
| 纤锌矿 `u` | 0.375（全局） | 0.382（全局） | 按化合物：ZnO 0.382、GaN 0.377、AlN 0.382、InN 0.377、CdS 0.377、ZnS 0.375；查不到时 0.375。`_REF_AB` 的值扩展为 `(a, c, params)` |
| MX2 厚度（X–X 高度） | `thickness` 参数，默认 3.17 | 无参数（固定半厚 1.585 Å） | 按化合物：MoS2 3.17、WS2 3.14、MoSe2 3.34、WSe2 3.36、MoTe2 3.60；查不到时 3.17；JS 增加 `thickness` 参数 |
| MoS2 `c` | 15 | 18 | 两边 18（与网页版一致；v1 的"接近 D6 的 15 Å"已随 U4 失效） |
| `hbn` 原型 | 无 | 有 | Python 增加 |
| 原子顺序：fluorite / mos2 | FCC, FCC+¼, FCC+¾ / Mo, S(−), S(+) | 另一种 | 取 Python 顺序 |
| 名字 | `Cu fcc` | `Cu (Face-centred cubic)` | 本期不动（M7 定） |

- 依据 [V，领域原型 `defaults_check.py`]：ZnO 用 u = 0.375 时 Zn–O 键长 1.953/1.986 Å，u = 0.382 时 1.989/1.974 Å，实验 1.992/1.973 Å；MoTe2 用 3.17 Å 时 M–X 键短 5.6%。
  各化合物的 u 与厚度在开发期按文献逐项核对（数值来自领域审查），写进生成脚本的注释。
- 代价：M（生成脚本、JS 构建器与 Build 面板、严格的逐原型 `toJSON` 对 `to_dict` 测试）。影响：网页默认几何变化 ≤ 0.3%；非默认元素（Pt、Au、Ag……）
  从"错误的 3.615"变为参考值——对 Pt(111) 场景是实质改进。

#### 3.15.3 元素数据（M-19、K16）

- 共价半径：H–Cm 两边相同；Bk–Lr 7 个值不同 → JS 表改用 `facet/data/elements.json` 的值 [V]。
- 未知元素/`X` 的共价半径：Python 1.5 Å、JS 0.5 Å → 两边 0.5 Å（Python `covalent_radius` 的回退值）。
- **Bondi 半径**（M6 层间距默认值要用，工程 #2）：`elements.json` 增加 `bondiRadius`（Bondi 1964；Mantina 等 2009 补充的主族元素；没有的为 null），
  Python `bondi_radius(symbol) -> float | None`，JS `element(sym).rbondi`（`core/elements.js` 的数据表增加一列，`-` 表示 null），测试逐元素核对。
- **范德华半径不供算法使用**：Python `vdw_radius`（Alvarez 2013，Bondi 补缺）与 JS 显示半径 `rvdw`（用于空间填充显示）有 21 个元素不同 [V]，两者各有用途，
  本期都不改；新算法（M4/M5/M6 的重叠检查、吸附高度、层间距）只用共价半径或 `bondi_radius`。
- 原子量：JS 表的值是四舍五入的（66 个元素与 `elements.json` 的 IUPAC 2016 值差 < 0.001），只影响密度显示，本期不动；新的 `masses` 默认值（§3.2）两边都取 `elements.json`。

### 3.16 容差与常量（C10，S-2）

```python
# facet/core/defaults.py（新）
SURFACE_DEFAULTS = Defaults(           # 只读：同时支持 SURFACE_DEFAULTS.vacuum_gap_min 与 SURFACE_DEFAULTS["vacuum_gap_min"]
    vacuum_gap_min=5.0,                # Å：U1 真空间隙；M3 find_layers 共用
    flag_tolerance=1e-6,               # 相对：约束基变换 in_span
    position_tolerance=1e-5,           # Å：位置比较的下限（C10）；间隙并列判断
    overlap_distance=0.5,              # Å：导出时的原子重叠检查
    # 其他模块在各自任务里追加自己的键（layer_tolerance、layers……），两份源码表同时改
)
```

```js
// facet/web/js/core/defaults.js（新）
export const SURFACE_DEFAULTS = Object.freeze({ vacuumGapMin: 5.0, flagTolerance: 1e-6, positionTolerance: 1e-5, overlapDistance: 0.5 /* … */ });
```

- `Defaults` 是十几行的只读映射类（`collections.abc.Mapping` + `__getattr__`；赋值抛 `AttributeError`），满足 M3 的属性访问与 M2/M5 的下标访问（工程 #2）。
- 键名：Python snake_case，JS 同词 camelCase（F0-A 的 `vacuum_gap_min` 改为 `vacuumGapMin`）；测试按规则互转后比较全部键与值。
- **`SURFACE_DEFAULTS` 不含真空**（U4：真空没有默认值）；测试断言两种语言都没有 `vacuum` 键（工程 #21）。
- `PROP_DEFAULTS`、`WRITER_CAPABILITIES`、`RESULT_PROPS`、`RESULT_INFO`、`SYMMETRY_INFO_KEYS`、`BUILD_INFO_KEYS`、`mark_edited` 的表同样两份、测试核对。

---

## 4. 数据

### 4.1 props（`docs/SCHEMA.md` 新增"已知属性"表）

| 键 | 类型 | 新原子默认 | 规范化 | 谁写 | 存储它的格式 |
|---|---|---|---|---|---|
| `selective_dynamics` | `[bool, bool, bool]`，True = 沿 a/b/c 可动 | `[T, T, T]` | 是 | POSCAR/extxyz 读取器、M3 固定/放开、M2（切面重设） | JSON、POSCAR、extxyz（`move_mask`，笛卡尔换算） |
| `tags` | int，1 = 顶层…，0 = 吸附物/未标记 | 0 | 是 | M2 切面、extxyz 读取器 | JSON、extxyz |
| `adsorbate_id` | int，0 = 非吸附物，1…n | 0（合并时重新编号） | 是 | M5 | JSON、extxyz |
| `occupancy` | float | 1.0 | 是 | CIF 读取器 | JSON、extxyz、CIF |
| `poscar_species` | str，POSCAR 块标签（`H`、`H#2` 或原始词） | 同元素首块的标签 | 否 | POSCAR 读取器（仅物种行重复时） | JSON、extxyz（S 列）；POSCAR 用它分块 |
| `labels` | str | 元素符号 | 否 | CIF 读取器（JS 改用此名，S-6） | JSON、extxyz（S 列）；CIF 重新生成 |
| `atom_names`、`residue_names`、`residue_ids`、`chain_ids` | PDB 列 | 符号 / `MOL` / 1 / `A` | 否 | PDB 读取器（JS 改用 `residue_names`，S-6） | JSON、extxyz、PDB |
| `masses` | float | 元素标准原子量 | 否 | extxyz 读取器 | JSON、extxyz |
| `momenta`、`velocities`、`initial_magmoms`、`initial_charges` | 输入量（标量或 3 矢量） | 同形状的 0 | 否 | extxyz 读取器、（O-5）CONTCAR 速度块 | JSON、extxyz |
| `forces`、`energies`、`stresses`、`charges`、`magmoms`、`born_effective_charges`、`dipoles` | 计算结果（`RESULT_PROPS`） | —（编辑后删除，§3.7） | 否 | extxyz 读取器（`charge` 列读成 `charges`） | JSON、extxyz（多帧只写第 1 帧） |
| 其他 | 任意 JSON 值 | `null` | 否 | 用户/插件 | JSON；extxyz 视类型 |

### 4.2 info

| 键 | 本模块的处理 |
|---|---|
| `warnings` | 结构的持久备注（列表，§3.6）；载入时迁移旧 `warning`；extxyz 不写；JSON 保存 |
| `warning` | 只读兼容，载入时并入 `warnings` 后删除 |
| `spacegroup`、`spacegroupNumber`、`formulaSum` | `invalidate_symmetry_info` 删除（§3.7 的表） |
| `energy`、`free_energy`、`stress`、`virial`、`dipole`、`magmom`、`polarization`、`dielectric_tensor` | 计算结果（`RESULT_INFO`），编辑后由 `invalidate_results` 删除；extxyz 按 ASE 写法写出（K15） |
| `prototype`、`a`、`c`、`u`、`thickness` | 构建参数（`BUILD_INFO_KEYS`），改晶格后由 `invalidate_build_info` 删除；`source` 保留 |
| `supercell`、`supercellMatrix` | `repeat` 照旧写 `supercell`，并按 M1 K4 维护 `supercellMatrix`（语义见 M1 §4.2） |
| `surface` 等嵌套值 | 本模块保证在 JSON 与 extxyz（`_JSON`）中往返；POSCAR/CIF/PDB 不存储（不报警告）；`surface.axis` 被 `find_surface_gap` 读取 |
| `format`、`filename`、`source` | 仍由读取流程设置；extxyz 写出器跳过 |
| `comment` | extxyz 剩余文字（两种语言） |

### 4.3 源映射

- 产生者：Python `_remap` 及其调用者（`delete`、`select`、`append`、`extend`、`repeat`、`sort_by_species`、`concat_structures`）；JS `remap` 及
  `deleteAtoms`、`addAtom`、`extend`、`repeat`、`select`、`sortBySpecies`、`concatStructures`。`set_symbols`、`translate`、`wrap`、`set_pbc`、`set_positions`、
  `make_contiguous` 不改变原子集合，不改变映射。后续模块的所有新变换都必须经 remap 或 `_set_source`/`setSource`。
- 表示：`-1` = 新原子；Python `np.ndarray[int64]`，JS `Int32Array`；累计语义与会话规则见 §3.4；不序列化。

### 4.4 命名、多帧、部分占位

- 命名：§3.14。
- 多帧（C11）：核心方法的帧语义见 K10 与 §3.5；"只作用于当前帧并丢弃其余帧"的命令在界面层先 `keepFrame(frame)`，并用带 Undo 的 toast 说明
  （F0-A 的 `editActive` 负责 toast；"Make supercell real"、"Wrap atoms into cell" 归 M1）。`find_vacuum_gap` 默认看第 0 帧（JS 看当前帧），
  `make_contiguous` 用参考帧求平移、作用于所有帧。
- 部分占位（C12）：`occupancy` 照常经 remap 复制；POSCAR、PDB、plain XYZ 导出时警告（W7）；重叠原子另有 W11。

### 4.5 兼容性与行为变化（写进 CHANGELOG，版本进 0.4）

- 0.3.1 保存的项目：`info.warning` 迁移；props 长度不齐的旧 JS 项目被修复并留备注；`label`/`residue` 旧键保留不动。
- 0.3.1 写出的 extxyz：`selective_dynamics:L:3` 照常读取。
- 行为变化清单：Python `delete`/JS `deleteAtoms` 越界报错；`repeat` 名字用 `×` 且叠加相乘；`repeat` 拒绝非整数；JS `repeat`/`wrap` 处理所有帧、`wrap` 容差 1e-12；
  JS `clone()` 保持当前帧且不取整；JS `fromJSON(structure)` 返回副本；JS `fromJSON` 帧坐标不足时丢帧而不是补 0；Python `from_dict` 修复不齐的 props 而不是报错；
  `set_prop` 返回 `self`；编辑后删除计算结果、构建参数与空间群（§3.7）；extxyz 多个整数读成 int 列表、`charge` 列读成 `charges`、写 `move_mask` 而不是
  `selective_dynamics`、info 的列表与类型保护写法（K15）、不再写 `warnings`/`source`；POSCAR `.TRUE.` 读成可动；POSCAR 重复元素块不再合并；
  JS 二面角符号；网页默认晶格常数（§3.15.2）；Python 未知元素共价半径 0.5 Å。

---

## 5. 界面

本模块的界面改动都很小：导入不加任何提示或开关（U1），没有 slab 专属的控件。

### 5.1 导入

- 打开任何文件都**不做** slab 检测，pbc 与坐标与文件一致（U1）。
- toast（`role="status"`，已有 aria-live）照旧 `Loaded CONTCAR — 36 atoms`；只附上**读取器本次写入**的备注（`getWarnings(structure.info)`，`app.js:901-902`
  今天读 `info.warning`）：一条时放在括号里，多条时 `Loaded CONTCAR — 36 atoms (selective dynamics: 4 line(s) had … ; +2 more)`，按钮 `Details` 打开对话框
  `Notes for CONTCAR`，逐条列出。Facet JSON 文件自带的备注是存档内容，不弹出。
- 粘贴导入（`ui/shell.js:992`、`:1012`）今天不显示读取备注，改为同样的规则（工程 #7）。

### 5.2 结构面板（`ui/panels/structure.js`）

- **Periodic** 行（`:114`）保持只读文字 `T T F`，不加切换按钮（U1）。
- **Notes**：结构有备注时，在 Summary 下显示折叠的 `Notes (3)`（默认折叠，`aria-expanded`），展开后逐条列出，末尾按钮 `Clear notes`
  （撤销标签 `Clear notes`，删除 `info.warnings`）。没有备注时不显示。
- **Wrap into cell**（`:174`）与 **Make supercell real**（`:177-182`）归 M1（按 C11 丢帧、名字与 `supercellMatrix`），本模块不改它们的界面。
- **Duplicate**（`:185`）：沿用 `clone()`；改造后不再与原结构共享 props（M-5）。
- 不加"Sort by species"按钮（v1 有）：入口改为命令与 Export notes 对话框里的动作（§5.3），避免常驻控件。

### 5.3 导出（`app.exportStructureFile`，`app.js:1316-1328`）

- 保存成功后：
  - 无警告、无说明 → 原 toast `Saved slab.vasp`；
  - 有警告 → `Saved slab.cif — <第一条警告> (+2 more)`（只有一条时不加括号），按钮 `Details`；只要有一条属于"丢失约束或占位"（W4、W6、W7）或 W10、W11，
    `timeout: 0`（保留到关闭），否则 `timeout: 9000`（工程 #19）；
  - 只有说明 → `Saved slab.vasp`，按钮 `Notes`，默认 timeout。
- `Details`/`Notes` 打开对话框 `Export notes`：先列警告，再以 `Notes` 小标题列说明；N1 存在时对话框带动作按钮 `Sort atoms by species`
  （执行 `edit.sortBySpecies`，一步撤销），其他动作只有 `OK`。
- 命令 `file.exportNotes`（`Show notes from the last export`）重新打开最近一次导出的对话框（toast 消失后仍可查看）。
- 导出菜单本身不变。

### 5.4 命令面板（`main.js` 的 `registerCommands`）

| id | title | category | keywords | when | 说明 |
|---|---|---|---|---|---|
| `edit.sortBySpecies` | Sort atoms by species | Edit | `POSCAR VASP order group elements` | 有结构 | 参数 `{order?: string[]}`，须为元素符号数组（经 `normalizeSymbol`），否则 toast `order must be a list of element symbols, e.g. ["Pt", "C", "O"]`（嵌入页可带参调用，简报 §4，工程 #27）；已分组时 toast `Atoms are already grouped by species`，不记历史；否则撤销标签 `Sort atoms by species`，toast `Sorted 38 atoms by species (Pt, C, O)` + Undo |
| `edit.clearNotes` | Clear structure notes | Edit | `warnings notes messages` | 结构有备注 | 撤销标签 `Clear notes`，toast `Cleared 3 notes` + Undo |
| `file.exportNotes` | Show notes from the last export | File | `export warnings notes` | 本会话导出过 | 打开 §5.3 的对话框 |

不新增快捷键。

### 5.5 二面角显示

查看器测量列表与选区卡片显示 `signedAngle(dihedralFromVectors(...))`，范围 (−180°, 180°]，格式与今天相同（一位小数加 `°`）。

### 5.6 其他界面约定

- **预览**：本模块没有预览；所有编辑即时生效、一步撤销（P3）。
- **右键菜单与选区卡片**：本模块不加条目（固定/放开属于 M3，移动属于 M4）。
- **错误提示**：命令参数校验失败用错误 toast；`Sort atoms by species` 在无结构时不可用（`when` 返回 false）。

### 5.7 无障碍与触屏

- Notes 折叠头与按钮最小 32×32 px（触屏），键盘可达，焦点样式沿用 `btn`；对话框沿用现有 `dialog()`（焦点陷阱、Esc 关闭）。
- 需要用户处理的导出警告 `timeout: 0`，屏幕阅读器用户不会因 9 秒超时错过按钮；toast 悬停与聚焦时暂停计时、多个动作按钮由 F0-A 的 toast 改造提供（§10.1）。
- 所有文字用英文，按简报 P7 与现有风格（句首大写、`…` 表示还需输入、`×`、`Å`）。

---

## 6. API

### 6.1 Python

```python
# facet/core/structure.py
PROP_DEFAULTS: Mapping; PROP_SYMBOL_DEFAULT: tuple; PROP_SHAPED_ZERO: tuple; RESULT_PROPS: tuple; RESULT_INFO: tuple
SYMMETRY_INFO_KEYS: tuple; BUILD_INFO_KEYS: tuple; CARTESIAN_VECTOR_PROPS: tuple; EDIT_KINDS: tuple
def copy_value(v): ...
def poscar_order(symbols, order=None, blocks=None) -> list[int]
def canonical_order(symbols, layers=None, blocks=None) -> list[int]
def invert_source_map(src, n_old: int) -> np.ndarray
def compose_source_maps(first, second) -> np.ndarray                 # 不衔接时 ValueError
def add_warning(info: dict, msg: str) -> dict
def get_warnings(info: dict) -> list[str]
def new_warnings(before: list[str], after: list[str]) -> list[str]
def normalize_warnings(info: dict) -> dict
def invalidate_symmetry_info(info: dict) -> dict
def invalidate_build_info(info: dict) -> dict
def invalidate_results(structure) -> list[str]
def mark_edited(structure, kind: str, *, rotation=None) -> Structure   # kind ∈ EDIT_KINDS（§3.7 的表）
def rotate_vector_props(structure, rotation) -> Structure
def concat_structures(parts, *, cell=None, pbc=None, defaults=None, renumber_adsorbates=True) -> Structure

class ChangeTracker:                                  # Structure.track_changes() 返回
    def stop(self, result=None) -> np.ndarray | None  # 起点 → result 的映射；result 不在会话中时 None；结果另存为 .src
    src: np.ndarray | None                            # 最近一次 stop() 的结果
    # 也是上下文管理器（退出时 stop()）

class Structure:
    source_map: np.ndarray | None                     # property：自诞生以来的累计映射
    def track_changes(self) -> ChangeTracker
    def _remap(self, src, *, symbols=None, new_symbols=None, positions=None, new_positions=None,
               frames="keep", added_props=None, defaults=None) -> Structure
    def _set_source(self, parent, src) -> Structure   # 构建器从数组构造结果时声明谱系
    def set_prop(self, key, values) -> Structure      # 变化：返回 self；规范化与复制
    def remove_prop(self, key) -> Structure
    def set_symbols(self, indices, symbol) -> Structure
    def set_positions(self, positions, *, indices=None, frame=0) -> Structure
    def keep_frame(self, index=0) -> Structure
    def set_pbc(self, pbc) -> Structure
    def sort_by_species(self, order=None) -> Structure
    def get_move_mask(self) -> np.ndarray
    def constraint_summary(self) -> dict
    def extend(self, other, *, renumber_adsorbates=True) -> Structure   # 变化
    # 变化：__init__, copy, from_dict, get_frame, delete, select, append, repeat, center, wrap（§3.5.1）

# facet/core/constraints.py（§3.8.2）
MOVE_FLAGS_KEY = "selective_dynamics"; FLAG_RE; FLAG_TOL = SURFACE_DEFAULTS.flag_tolerance
def transform_move_flags(flags, old_vectors, new_vectors, tol=FLAG_TOL) -> tuple[list[list[bool]], int]
def lattice_to_cartesian_mask(flags, cell, tol=FLAG_TOL) -> tuple[list[list[bool]], int]
def cartesian_to_lattice_flags(mask, cell, tol=FLAG_TOL) -> tuple[list[list[bool]], int]
def apply_basis_change(structure, old_vectors, new_vectors) -> int       # 原位；收紧数 > 0 时写备注
def next_adsorbate_id(structure) -> int

# facet/core/defaults.py: SURFACE_DEFAULTS（只读，属性与下标两种访问）
# facet/core/naming.py: TIMES, format_repeat(reps), add_repeat_suffix(name, reps)
# facet/core/lattice.py: wrap_fractional(frac, pbc=(True, True, True), eps=1e-12) -> ndarray   （M1 继续扩展此文件）
# facet/core/elements.py: bondi_radius(symbol) -> float | None；covalent_radius 未知元素回退 0.5

# facet/analysis/vacuum.py（新，加入 analysis.__all__）
def find_vacuum_gap(structure, axis=None, *, min_width=None, frame=None, periodic_only=True) -> dict | None
def find_vacuum_gaps(structure, *, frame=None, periodic_only=True) -> list[dict | None]
def find_surface_gap(structure, *, frame=None) -> dict | None
def gap_cut(gap) -> float
def unwrap_along_gap(frac, gap)                        # float 或 ndarray
def make_contiguous(structure, axis, *, gap=None, frame=None) -> int
def vacuum_gap_hint(structure) -> str

# facet/analysis/contacts.py（新）
def close_contacts(structure, cutoff=None, *, pbc=None, limit=None) -> list[tuple[int, int, float]]

# facet/io/__init__.py
class ExportWarning(UserWarning)
def export_report(structure, format: str, *, frame: int | None = None) -> dict    # {"warnings": [...], "notes": [...]}
def export_warnings(structure, format: str, *, frame: int | None = None) -> list[str]
def export_notes(structure, format: str, *, frame: int | None = None) -> list[str]
def register_writer(name, func, extensions=(), description="", *, mimetype="text/plain", source="builtin", capabilities=None)
def write(dest, structure, format=None) -> None                                   # + ExportWarning
# parse_text / read：签名不变（v1 的 detect_slab 删除）
# facet/io/capabilities.py: WRITER_CAPABILITIES, validate_capabilities(name, caps)
# facet/io/xyz.py: kv_tokenize(line), convert_value(raw), format_info_value(key, value), extxyz_columns(structure)
#   write_extxyz(structure, *, constraints="exact")          （O-3："fix-partial"）
# facet/io/poscar.py: read_poscar（块标签、XDATCAR 帧），write_poscar(structure, *, order="species")   （O-4："keep"）
```

### 6.2 JavaScript

```js
// core/structure.js
export const PROP_DEFAULTS, PROP_SYMBOL_DEFAULT, PROP_SHAPED_ZERO, RESULT_PROPS, RESULT_INFO, SYMMETRY_INFO_KEYS, BUILD_INFO_KEYS,
  CARTESIAN_VECTOR_PROPS, EDIT_KINDS;
export function copyValue(v), poscarOrder(symbols, order = null, blocks = null), canonicalOrder(symbols, layers = null, blocks = null),
  invertSourceMap(src, nOld), composeSourceMaps(first, second), normalizePbc(pbc, hasCell),
  addWarning(info, msg), getWarnings(info), newWarnings(before, after), normalizeWarnings(info),
  invalidateSymmetryInfo(info), invalidateBuildInfo(info), invalidateResults(s), markEdited(s, kind, { rotation } = {}),
  rotateVectorProps(s, R), concatStructures(parts, { cell, pbc, defaults, renumberAdsorbates = true } = {});
class Structure {
  rev; touch();                                                     // K13
  remap(src, { symbols, newSymbols, positions, newPositions, frames = 'keep', addedProps = {}, defaults } = {});
  get sourceMap(); trackChanges();                                  // → {stop(result = origin)}
  setSource(parent, src);
  setProp(key, values); removeProp(key); getFrame(i); keepFrame(i = this.frame);
  setPositions(positions /* Float64Array(3n) | {indices, positions} */, { frame = 'current' } = {});
  select({ elements, indices, mask } = {}); extend(other, { renumberAdsorbates = true } = {});
  sortBySpecies(order = null); setPbc(pbc); getMoveMask(); constraintSummary();
  // changed: constructor, fromJSON, toJSON({precision, copy}), clone, repeat, wrap, deleteAtoms, addAtom(symbol, xyz, props), setSymbols
}
// core/constraints.js — transformMoveFlags(flags, oldV, newV, tol) → {flags, tightened}, latticeToCartesianMask, cartesianToLatticeFlags,
//   applyBasisChange(s, oldV, newV), nextAdsorbateId(s), FLAG_RE, FLAG_TOL, MOVE_FLAGS_KEY
// core/vacuum.js — findVacuumGap(s, axis = null, { minWidth, frame, periodicOnly = true } = {}), findVacuumGaps(s, { frame, periodicOnly }),
//   findSurfaceGap(s, { frame }), gapCut(gap), unwrapAlongGap(f, gap), makeContiguous(s, axis, { gap, frame }), vacuumGapHint(s)
// core/contacts.js — closeContacts(s, { cutoff, pbc, limit } = {})
// core/defaults.js — SURFACE_DEFAULTS；core/naming.js — TIMES, formatRepeat, addRepeatSuffix；core/geometry.js — dihedralFromVectors, signedAngle
// core/lattice.js（新，F0-D 建立，F0-A 与 M1 追加）— 重新导出 util.js 的 cellFromParams, cellParams, fracToCart, cartToFrac, det3, inv3；wrapFractional
// io/capabilities.js — WRITER_CAPABILITIES, validateCapabilities；io/index.js — exportReport(s, id, { frame }), exportStructure → {text, filename, mime, warnings, notes}
// io/xyz.js — kvTokenize, convertValue, formatInfoValue, extxyzColumns
```

公共 API（`api/public.js`）：`facet.exportReport(format, s = app.structure)`、`facet.analysis.vacuumGap(s = app.structure, axis = null)`，
以及 F0-A 的 `facet.edit` 命名空间下：`sortBySpecies(order?)`、`clearNotes()`（都可撤销）。

### 6.3 REST（全部为附加改动）

| 端点 | 变化 |
|---|---|
| `POST /api/v1/io/export` | 响应 `ExportResponse` 增加 `warnings: list[str] = []`、`notes: list[str] = []` |
| `GET /api/v1/formats` | 写出器条目增加 `capabilities` |
| `POST /api/v1/analysis/vacuum`（O-6，可选） | 请求 `VacuumRequest{structure: StructureModel, axis: Optional[int] = Field(None, ge=0, le=2), minWidth: Optional[float] = Field(None, ge=0, le=1000)}`；响应 `{"gap": VacuumGap\|null, "gaps": [VacuumGap\|null]×3, "minWidth": float}`；只做原子数上限检查（`MAX_ATOMS`，不用 `_guard_work`：它为邻居搜索估算原子对数，`server/routes/analysis.py:41-67`）；云模式需登录 |

`/io/parse` 不变（v1 的 `detectSlab` 删除）。

### 6.4 客户端（`facet/client.py`）

- `export_structure(structure, format) -> str` 不变（`client.py:238`）。
- `export_structure_with_warnings(structure, format) -> ExportResult`（新数据类：`text`、`filename`、`mimetype`、`warnings`、`notes`），同一路由。
- （O-6）`vacuum_gap(structure, axis=None, min_width=None) -> dict`，`ROUTE_METHODS` 增加 `("POST", "/api/v1/analysis/vacuum"): "vacuum_gap"`。

### 6.5 CLI（`facet/cli.py`）

- `facet convert IN OUT`、`facet build … -o FILE`：写出后在 stderr 打印 `facet: warning: …` 与 `facet: note: …`。
- `facet info FILE`：有间隙时新增中性的一行 `Vacuum gap  : 15.00 Å along c`（`find_vacuum_gap` 的结果，任何结构都一样，U1）；`--json` 输出增加
  `vacuumGap`（对象或 `null`）。

---

## 7. 测试

### 7.1 跨语言测试桥：最终布局（采纳 `scratchpad/python-api/parity/` 原型，04 报告 §6）

```
facet/web/js/package.json      {"type": "module"}            （使 .js 不依赖 Node 的语法探测；对浏览器与 build_artifact.py 无影响）
tests/
  js_bridge.py        find_node() / run_js(source, payload, timeout=30) / run_node_tests(paths) / JSError / NodeUnavailable / WEB_JS
  conftest.py         + session fixture `js`；+ pytest_collection_modifyitems：用到 `js` fixture 的测试自动加 `js` 标记
  cases.py            公共用例加载与比较：load_cases()（递归读 tests/data/surface/**/*.json）、compare()、OPS 注册表与 @op("name")
  test_cases.py       对每个用例跑 Python（不需要 Node）
  test_js_parity.py   经 run_js 的直接对比（随机 remap、随机基变换、间隙并列、info 往返、构建器、常量表……），每个测试一次 Node 调用、批量传参
  test_js_unit.py     由 Python 列出 sorted(tests/js/*.test.mjs) 逐个作为参数传给 `node --test --test-reporter=tap`，断言退出码 0 且 "# fail 0"
  js/
    helpers.mjs       repoPath(), loadCases(), approx(), compare()（与 cases.py 同一比较语义）
    cases.mjs         JS 端 OPS 注册表
    cases.test.mjs    对每个用例跑 JS
    structure.test.mjs  constraints-core.test.mjs  io.test.mjs  vacuum.test.mjs  export.test.mjs   （本模块的 node:test 单元测试）
  data/surface/
    README.md         用例格式说明
    f0d/props.json  f0d/sourcemap.json  f0d/edits.json  f0d/constraints.json  f0d/poscar.json  f0d/extxyz.json  f0d/vacuum.json  f0d/export.json
    contcar_pt111.vasp          （所有模块共用的唯一 CONTCAR 夹具，工程 #26：Pt(111) p(3×3) 4 层 36 原子，SD 底 2 层 F F F，两个底层原子在 f = 0.99999，末尾有速度块）
    ase329_fixatoms.extxyz  ase329_fixcartesian.extxyz  ase329_stress.extxyz  crystallume031_sd.extxyz
```

- `js_bridge.py` 相对原型的改动：`REPO = Path(__file__).resolve().parents[1]`；`MIN_NODE_MAJOR = 22`（Node 20 已于 2026-04-30 停止维护，工程 #9）；
  `FACET_NODE`（路径，或 `0`/`off`/`false`/`no` 关闭）保留；`run_node_tests` 只接受显式文件列表（`node --test 目录` 在 Node 22/24 上失败 [V]；
  传入非测试文件会被算作一个测试）。
- 桥本身的测试：一个故意失败的样例文件交给 `run_node_tests` 必须报失败（防止桥吞掉失败）。
- `js` fixture：Node 不可用时 `pytest.skip("JS parity tests need Node.js >= 22: <原因>")`；`FACET_REQUIRE_NODE` ∈ {1, true, yes} 时 `pytest.fail`。
- `pyproject.toml`：在现有 `testpaths`、`addopts = "-q"`、`filterwarnings` 三项上**追加**（不要整段替换）：`addopts = "-q -m 'not slow'"`，以及

  ```toml
  markers = [
      "js: needs Node.js >= 22 (skipped when it is missing; FACET_REQUIRE_NODE=1 makes that a failure)",
      "slow: end-to-end browser tests (run with: pytest -m slow)",
  ]
  ```
- 已知缺陷用 `xfail(strict=True)` 记录（原型做法）；本模块修好后删除标记。

**公共用例外壳 `facet.cases/1`**（所有模块共用，M1–M6 只注册自己的 op，不再各写加载与比较代码；M7 汇总时核对；工程 #26）：

```json
{
  "schema": "facet.cases/1",
  "cases": [
    {
      "id": "poscar-read-dot-true",
      "op": "read",
      "args": {"format": "poscar"},
      "input": {"text": "…"},
      "expect": {
        "structure": {"symbols": ["Pt"], "pbc": [true, true, true], "props": {"selective_dynamics": [[true, true, false]]}},
        "warnings": {"equals": []}
      },
      "tol": {"positions": 1e-6, "cell": 1e-6},
      "skip": {"js": "reason"}
    }
  ]
}
```

- `input`：`{"structure": <facet.structure/1>}`、`{"text": …}` 或 `{"file": "相对 tests/data 的路径"}`。`args`：camelCase 键；Python 分派函数显式映射为 snake_case。
- `expect` 的内容由各 op 自定，公共比较器有：`structure`（只比较给出的键：`symbols` 精确、`positions`/`cell` 在 tol 内、`pbc` 精确、`props`/`info` 只比较列出的键、
  `nFrames`、`name`）、`value`（任意 JSON，数值按值比较，`1 == 1.0`，在 `tol.value` 内）、`sourceMap`、`warnings`（`equals`/`contains`/`count`）、
  `text`（`contains` 列表）、`error`（错误信息子串）。
- 现有读取器的同类警告两种语言措辞统一后（S-7）才用 `equals`，此前对读取器警告只用 `count`/`contains`（工程 #18）。
- 未注册的 op 视为失败，除非用例写了 `skip`；`skip` 必须给理由。期望值来源优先级（简报 §6）：解析解 > 手算 > 开发期 ASE/pymatgen 交叉核对后固化（注明版本）。

本模块注册的 op：`read`、`write`、`roundtrip`、`remap`、`delete`、`append`、`extend`、`concat`、`repeat`、`wrap`、`keepFrame`、`setPositions`、`sortBySpecies`、
`poscarOrder`、`canonicalOrder`、`trackEdit`、`markEdited`、`transformMoveFlags`、`latticeToCartesianMask`、`cartesianToLatticeFlags`、`findVacuumGap`、
`findSurfaceGap`、`unwrapAlongGap`、`makeContiguous`、`closeContacts`、`exportReport`、`kvTokenize`、`convertValue`、`formatInfoValue`、`addRepeatSuffix`。

### 7.2 单元测试（Python `tests/test_structure.py`、`test_io.py`、新 `test_constraints_core.py`、`test_vacuum.py`、`test_export.py`；JS `tests/js/*.test.mjs`）

**props 与 remap**
- `append`/`addAtom` 后 `selective_dynamics[-1] == [T,T,T]`、`tags[-1] == 0`，已知键无 `None`；未知键 `charge` 仍为 `None`（保留现有测试）。
- 形状感知的默认值：`initial_magmoms` 为 N×3 时新原子得 `[0,0,0]`；`masses` 得原子量；`poscar_species` 得同元素首块标签。
- `extend`：other 的 props 被复制而非共享；`adsorbate_id` 重新编号；other 的晶胞与 self 不同时标志被换算、收紧时有备注。
- `concat_structures`：props 并集、默认值补齐、帧丢弃并有备注、各部分的连续区间、`source_map` 相对 `parts[0]`。
- `repeat` 后修改第 0 个原子的标志不影响其像与原结构；`set_prop("selective_dynamics", [[T,T,F]] * n)` 后各行独立；`set_prop` 返回 `self`。
- JS：`clone().props !== s.props`；克隆上删原子不影响原结构；`clone()` 保持当前帧；`addAtom` 后所有 props 长度为 n+1；`new Structure({pbc: true})`、
  `fromJSON({..., pbc: true})` 不崩溃且得到 `[true, true, true]`；`wrap()`/`repeat()` 处理所有帧；`repeat(1.5)`、`repeat(0)` 抛错；`fromJSON` 修复长度不符的 props、
  丢弃坐标不足的帧并写备注；类型化数组 props 变为普通数组；多帧结构上 `remap(src, {positions})` 未给 `frames` 时抛错。
- Python `from_dict` 与 JS `fromJSON` 对同一个不齐的文档得到相同的结构与备注（工程 #14）。
- `delete`/`deleteAtoms` 越界抛错，负索引有效，重复索引只删一次。

**源映射与追踪会话**
- §3.4 的 6 种写法两种语言都与逐原子标签一致；`fn` 返回无关结构时 `stop(r)` 为 `None`/`null`；`compose_source_maps` 不衔接时抛错；`invert_source_map` 取首个像；
  `source_map` 在 `copy()` 后为 `None`、在 `select` 后相对输入。

**备注与派生信息**
- `normalize_warnings({"warning": "VASP 4 POSCAR without element names; species set to X"})` → 一条 `warnings`（不拆分）；`new_warnings` 保持顺序。
- §3.7 的表逐行：每种 `kind` 删除且只删除表中的键（空间群、结果、构建参数），`"rotate"` 给了旋转时旋转 `velocities`。
- 领域 F3 的场景：带 `energy`、`stress`、`forces` 的 Pt12 slab 删一个原子、加一个 O 后写 extxyz，文件里没有 `energy=`；`sort_by_species` 后 `forces` 随原子重排、`energy` 保留。
- extxyz 写出不含 `warnings=`；JSON 往返保留备注。

**约束**
- §3.8.3 的验证表与边界用例逐条成为测试（R30、c(2×2)、p(2×1)、`a'=a+b`、倾斜 c 正交化、1e-9 噪声、夹角正弦 0.5e-6/2e-6、c 偏差 1e-5/1e-4）。
- `lattice_to_cartesian_mask`、`cartesian_to_lattice_flags` 在六方 slab 上的四个例子（§3.8.4）；`apply_basis_change` 收紧时写一条备注，精确时不写。
- `get_move_mask`、`constraint_summary` 的返回值与 M3 §3.10.2 的定义一致。

**POSCAR**
- §3.10.1 词法表全部；合并备注的文案与首个问题行号；Cartesian 模式、倾斜 c 的 POSCAR 带 `T T F` 时 props 不变（领域 F8）。
- 写出：`append` 后仍写 SD；交错元素 `O Ti O Ti` 写成 `O O Ti Ti` 且标志跟随原子；全 T 也写 SD 行；读写往返标志不变。
- 重复元素块：`Ga As H H / 1 1 2 2` 往返不变；加一个 H 后 `1 1 3 2`。
- XDATCAR：两帧、晶胞不同的样例，第二帧坐标按自己的晶胞换算（两种语言）。
- U1 验收：`contcar_pt111.vasp` 读入后直接导出 POSCAR，pbc 为 T T T，原子顺序、SD 标志逐行相同，坐标差 ≤ 1e-8 Å（两种语言）。

**extxyz**
- 词法：`kvTokenize` 对附录 B 的 ASE 行、`[1,2,3]`、`{4 5}`、裸键、`\"` 转义、D 指数，两种语言结果相同。
- `convertValue`：`1_000`、`inf`、`nan`、`-Infinity`、`0x10`、`١٢`、`+7`、`1.5D3`、`1e5`、超过 2^53 的整数，两种语言结果相同（工程 #12）。
- info 写出与读回：附录 A 的 33 个键四个方向一致；`"225"`、`"T"`、`"1 2 3"` 往返保持为字符串；`stress` 的 3×3、9 个数与 6 个 Voigt 分量都写成 9 个数；
  固化的 `ase329_stress.extxyz` 经我们读写后，开发期用 ASE 读回数值相等（结果固化，测试运行时不依赖 ASE）。
- `move_mask`：全部 T/F 型 → `L:1`；有部分约束 → `L:3` 且导出警告 W6；全部可动 → 不写；六方 `[F,T,F]` → W5；ASE 样例 `FixAtoms`、`FixCartesian` 读成预期的晶格系标志；
  `crystallume031_sd.extxyz`（旧 `selective_dynamics:L:3`）照常读；两列都有 → `move_mask` 优先并写备注；`charge` 列读成 `charges`。
- JS 读取器保留 `forces:R:3`、`label:S:1`、`fixed:L:1`、`tags:I:1` 列与 info（`energy`、`config_type`），与 Python 相同；名字不取自 `config_type`。
- `facet_clip=<id>` 往返（M4 剪贴板，工程 #2）；多帧：结果类列只在第 1 帧出现，并有 W9。

**导出检查**：§3.12.2 每条规则一个正例一个反例（含 W10 左手晶胞、W11 两对重叠、N1、N2）；`register_writer` 不带能力 → 空结果，带非法能力 → `ValueError`；
JS 服务器格式（假 store）的 `exportStructure` 同步返回 `warnings`，`text` 为 Promise；`write()` 发出 `ExportWarning`（`pytest.warns`），说明不发。

**真空间隙**：§0.3 的全部场景与 3 种平移；400 个"两个相同 slab"晶胞的并列规则（两种语言一致）；f = −1e-17 与 0 相同；bcc Cs/Rb、fcc Xe 原胞与 Bi2Se3 两种设置
不检出（领域 F9）；吡啶场景下 `find_surface_gap` 只在有 `info.surface.axis` 时返回 3.3 Å；`make_contiguous` 对包裹到顶部的底层移动 9 个原子、已连续时 0 个、
多帧用同一组平移；`set_pbc` 不移动原子；`vacuum_gap_hint` 的两种文案。

**其他**：`add_repeat_suffix` 的 5 种情况（含 JS 旧的 ` (A×B×C)`）；JS 二面角与 Python `get_dihedral` 在 50 组随机四点上模 360 相等，顺/反式例子同
`tests/test_structure.py:92-98`；`SURFACE_DEFAULTS` 两种语言逐键相等且没有 `vacuum` 键、Python 两种访问方式都可用且只读；`PROP_DEFAULTS`、`WRITER_CAPABILITIES`、
`RESULT_PROPS`、`RESULT_INFO`、`BUILD_INFO_KEYS`、`mark_edited` 的表两种语言逐项相等；共价半径与 Bondi 半径逐元素相等；默认参数表逐原型 `toJSON` 对 `to_dict`。
JS `rev`：每个修改方法递增一次，直接赋值不递增（F0-A 的 `structureKey` 依赖它）。

### 7.3 跨语言金标（`tests/data/surface/f0d/*.json`）

| 文件 | 内容 |
|---|---|
| `props.json` | 默认值、规范化、修复规则（含不齐的旧项目文档） |
| `sourcemap.json` | 6 种编辑写法的映射；`invertSourceMap`、`composeSourceMaps` |
| `edits.json` | §3.7 的每种 `kind`；`concat`、`extend`（重编号、标志换算） |
| `constraints.json` | 基变换验证表与边界用例 |
| `poscar.json` | 词法表、Cartesian SD、重复块、XDATCAR、U1 验收 |
| `extxyz.json` | 词法、值转换边界、info 往返、ASE 样例、`move_mask`、`facet_clip` |
| `vacuum.json` | 场景、平移、并列、负零、`find_surface_gap`、`make_contiguous` |
| `export.json` | 能力表与 W1–W11、N1–N2 |

### 7.4 服务器、客户端与 CLI

- `tests/test_server.py`：`/io/export` 的 `warnings`/`notes`（CIF + 固定原子 → 1 条警告；POSCAR、已分组 → 0 条；交错元素的 POSCAR → 1 条说明）；
  `/formats` 含 `capabilities`；（O-6）`/analysis/vacuum` 成功、422（`minWidth` 越界）、云模式未登录 401。
- `tests/test_client.py`：`export_structure_with_warnings` 返回 `ExportResult`；（O-6）`ROUTE_METHODS` 增加 `vacuum_gap`。
- `tests/test_cli.py`：`convert x.vasp x.cif` 的 stderr 含 `facet: warning:`；`info` 对 slab 打印 `Vacuum gap` 行、对体相不打印；导入不改变 pbc。

### 7.5 端到端（Playwright，标记 `slow`，可选运行；截图交审查）

1. 打开 `contcar_pt111.vasp`：没有额外提示；`facet.structure.pbc` 为 `[true,true,true]`；画出的原子数等于 F0-A 切口规则的结果（底层画在底部）；截图。
2. 不做编辑导出 POSCAR：文本含 `Selective dynamics` 且 18 行带 `F F F`，坐标与原文件一致；导出 CIF：toast 含 `cannot store constraints`，toast 不自动消失。
3. 交错元素后导出 POSCAR：toast 只有 `Notes` 按钮；对话框里 `Sort atoms by species` 一步撤销，Ctrl+Z 恢复原顺序，选区跟随原子。
4. 删一个原子后 Structure 面板的 `Notes` 出现"calculated results … were removed"（用带 `energy` 的 extxyz 打开时）；`Clear notes` 一步撤销。

### 7.6 性能预算（本机 Node 22 / Python 3.13；CI 允许 ×3）

| 操作 | 216 原子 | 1 万原子 | 实测（原型） |
|---|---|---|---|
| JS `remap`（含深拷贝与会话组合） | ≤ 1 ms | ≤ 15 ms | 0.09 ms / 3.6–9 ms |
| Python `_remap`/`repeat` | ≤ 5 ms | ≤ 80 ms | — / 31 ms |
| JS `clone()` | ≤ 1 ms | ≤ 15 ms | 现状 8.2 ms（经 toJSON/fromJSON）；props 结构化复制 2.8 ms |
| JS `toJSON({copy: true})` | ≤ 2 ms | ≤ 15 ms | —（工程 #28） |
| `findVacuumGap` / `find_vacuum_gap`（三轴） | ≤ 1 ms | ≤ 15 ms | JS 3.5–3.9 ms，Python 3.7 ms |
| `transformMoveFlags` | ≤ 1 ms | ≤ 15 ms | 3.3 ms（JS），7.3 ms（Py） |
| `closeContacts` / `close_contacts` | ≤ 2 ms / ≤ 10 ms | ≤ 100 ms / ≤ 200 ms | JS 34–89 ms，Python 110 ms（未优化）；216 原子 Python 4.1 ms |
| `exportReport`（不含 `closeContacts`） | — | ≤ 对应写出器耗时 | —（工程 #28：extxyz 要完整构建列） |
| POSCAR / extxyz 读或写（JS，含标志与 props 列） | ≤ 5 ms | ≤ 60 ms | 现状基线：POSCAR 写 15.6 / 读 23.6 ms，extxyz 写 10.1 / 读 13.4 ms（10 192 原子，无 props） |
| JS 多帧 `remap`、`sortBySpecies`、`clone`（20 万原子·帧，如 1000 帧 × 200 原子的 XDATCAR） | — | ≤ 100 ms | —（工程 #28） |

### 7.7 测试运行时间

现有 169 个测试 7.3 s。新增 Python 用例与单元测试 < 2 s；Node 部分（`node --test` 全部文件 + 3–5 次 `run_js`）< 3 s。目标：`pytest` 全量 ≤ 15 s（不含 `slow`）。

---

## 8. 风险与开放问题

### 8.1 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 真空间隙检测在少数体相上误报（插层、扩层的层状材料或带平面空腔的框架） | 阈值 5 Å（单原子原胞最大 4.34 Å）；U1 下误报只影响显示切口与工具的上下表面，从不改结构或导出 |
| R2 | 带高吸附物、小真空的 slab 没有 ≥ 5 Å 的间隙 | `find_surface_gap` 用 `info.surface.axis` 兜底；工具给出带实测值的说明（`vacuum_gap_hint`） |
| R3 | 行为变化影响现有用户或插件（§4.5） | CHANGELOG 列出；版本进 0.4；大多是缺陷修复 |
| R4 | extxyz 笛卡尔语义无法表达少数部分约束；经 ASE 写 POSCAR 会丢 FixCartesian | W5、W6 导出警告并指向 POSCAR；常见 `[T,T,F]`/`[F,F,T]` 在标准取向下精确；O-3 可收紧为宽度 1；`docs/PLUGINS.md` 写一张"约束在 Facet → extxyz/POSCAR → ASE → VASP 之间如何传递、在哪一步丢失"的表（只写已核实的 ASE 3.29 行为） |
| R5 | 大结构深拷贝开销 | `copy_value` 快路径；服务器上限 20 万原子时 Python `repeat` 约 0.6 s，可接受 |
| R6 | 构建器忘记声明谱系或调用 `mark_edited` | `editActive` 在拿不到映射时开发版抛错；§7.2 的表逐项测试；§10 写明每个模块的调用要求；extxyz 写出器对含 `None` 的列给出 W8 |
| R7 | 两份常量表漂移 | §7.2 的逐键相等测试 |
| R8 | ASE 写出的含引号/反斜杠的 `_JSON` 本身不可靠 | 含引号时我们回退为字符串并写备注（两种语言相同）；含反斜杠时与 ASE 读到相同的值；我们写出的 ASE 都能读回 |
| R9 | JS `structuredClone` 不可用（极旧浏览器） | 仅在嵌套值时用到；回退 `JSON.parse(JSON.stringify(v))` |
| R10 | `charge` 列按 ASE 语义读成计算结果 `charges`，编辑后被删除 | 与 ASE 一致；文档写明输入电荷用 `initial_charges`；删除时有备注 |
| R11 | 导出时的重叠检查在大结构上变慢 | O(N) 网格；预算 1 万原子 JS ≤ 100 ms；超过 20 万原子时跳过并写说明 `the overlap check was skipped for more than 200 000 atoms` |

### 8.2 决定记录（按 U5/U6 定案，不再等待用户）

1. **D3（导入识别 slab）**：按 U1——只读检测，不改 pbc、不改坐标、不提示（K5）。
2. **D5（extxyz 约束）**：按 U5——只写 `move_mask`，全部可动时省略（K4）。
3. **默认参数表**：逐项取更准确的值；纤锌矿 `u`、MX2 厚度按化合物；MoS2 `c` 两边 18（§3.15.2）。
4. **二面角显示范围**：界面 (−180°, 180°]，核心函数 [0°, 360°)（K11）。
5. **POSCAR 顺序提示**：保留，但降为说明，不计入警告（K9）。
6. **0.4 的行为变化**：全部接受（§4.5）。
7. **`formulaSum`** 随 `invalidate_symmetry_info` 一起删除。
8. **计算结果**：任何改变原子集合、坐标、晶胞或 pbc 的编辑都删除，包括对角超胞的逐原子 `forces`（§3.7）。
9. **修改计数的名字**：`rev` + `touch()`（K13）。
10. **跨轴间隙并列**：c、b、a 的顺序（§3.13.1）。

### 8.3 仍需负责人或用户知悉的问题（按 U6 已有默认做法，开发不等待）

1. **生成结构的原子顺序（K14）**：本规格建议 M2/M6 按"先元素、后层"排列（与 POSCAR 一致），这要求 M2 改 K12（目前是"按层从下到上"）。默认按本建议；
   若负责人保留 M2 的层序，POSCAR 导出只多一条说明，不影响正确性。
2. **对角超胞删除逐原子 `forces`**：物理上 forces 对完美周期复制仍然成立，但本规格与 ASE 一样一律删除，规则只有一条。需要保留力做 ML 数据增强的用户可在 Python 里自行复制。
3. **`charge` 列按 ASE 读成计算结果**：与 ASE 一致；若用户的工作流把 `charge` 当输入（例如力场电荷），编辑后会被删除并留备注。
4. **导出时的重叠阈值 0.5 Å 与左手晶胞警告**：W10 的 VASP 行为来自文献与邮件列表，开发期应在一台装有 VASP 的机器上核对一次（本环境没有 VASP）。

---

## 9. 开发拆分

规模：S ≤ 0.5 天，M 1–2 天，L ≥ 3 天（一名熟悉仓库的工程师）。**每个文件只归一个任务**（工程 #10）；"并行"指可与哪些任务同时由不同代理实施。

### 9.1 任务表

| 任务 | 输入 | 输出 | 涉及文件（归本任务） | 依赖 | 规模 | 并行 |
|---|---|---|---|---|---|---|
| **T0 测试桥与公共用例外壳** | 原型 `scratchpad/python-api/parity/` | §7.1 的基础设施（桥、fixture、标记、递归加载器与比较器、空的 OPS 表、`package.json`、共用 CONTCAR 夹具、桥自测） | `tests/js_bridge.py`、`tests/conftest.py`、`tests/cases.py`、`tests/test_cases.py`、`tests/test_js_unit.py`、`tests/js/helpers.mjs`、`tests/js/cases.mjs`、`tests/js/cases.test.mjs`、`tests/data/surface/README.md`、`tests/data/surface/contcar_pt111.vasp`、`pyproject.toml`、`facet/web/js/package.json` | 无 | S | 第 1 批最先做 |
| **T7 晶格包裹与真空间隙（两语言）** | §3.13、§3.16 | `wrap_fractional`、`core/lattice.js`（新建并重新导出 `util.js`）、`analysis/vacuum.py`、`core/vacuum.js`、`SURFACE_DEFAULTS` 文件、`vacuum.json` 用例 | `facet/core/lattice.py`（只加 `wrap_fractional`）、新 `facet/core/defaults.py`、新 `facet/analysis/vacuum.py`、`facet/analysis/__init__.py`、新 `web/js/core/lattice.js`、新 `web/js/core/defaults.js`、新 `web/js/core/vacuum.js`、`tests/test_vacuum.py`、`tests/js/vacuum.test.mjs`、`tests/data/surface/f0d/vacuum.json` | T0 | S | 第 1 批（只读结构的 `positions`/`cell`/`pbc`/帧，不依赖 T1/T2） |
| **T3 约束核心（两语言）** | §3.8–3.9 | `core/constraints.py`/`.js` 全部函数 + 用例 | 新 `facet/core/constraints.py`、新 `web/js/core/constraints.js`、`tests/test_constraints_core.py`、`tests/js/constraints-core.test.mjs`、`tests/data/surface/f0d/constraints.json` | T0、T7（`SURFACE_DEFAULTS`） | S | 第 1 批（对普通列表编程，`apply_basis_change` 只用 props 接口） |
| **T1 Python 数据核心** | §3.1–3.7、§3.14 | `_remap`、源映射与会话、默认值与规范化器、方法改造与新原语、备注、失效表与 `mark_edited`、`concat_structures`、`poscar_order`/`canonical_order`、命名 | `facet/core/structure.py`、`facet/core/__init__.py`、新 `facet/core/naming.py`、`tests/test_structure.py`、`tests/data/surface/f0d/{props,sourcemap,edits}.json` | T0、T3、T7 | M | 第 2 批，与 T2 并行 |
| **T2 JS 数据核心** | 同上 | `structure.js` 改造（含 `rev`/`touch`、`setPositions`、`keepFrame`、`extend`、会话）、`naming.js` | `facet/web/js/core/structure.js`、新 `web/js/core/naming.js`、`tests/js/structure.test.mjs` | T0、T3、T7 | M | 第 2 批，与 T1 并行 |
| **T4 POSCAR（两语言）** | §3.10 | 容错读取、Cartesian SD、SD 写出、重复块、XDATCAR（JS 修、Python 新）、（O-5）速度块、用例 | `facet/io/poscar.py`、`web/js/io/poscar.js`、`tests/test_io.py` 的 POSCAR 部分、`tests/js/io.test.mjs` 的 POSCAR 部分、`tests/data/surface/f0d/poscar.json` | T1、T2 | M | 第 3 批，与 T5 并行 |
| **T5 extxyz 与读取器小改（两语言）** | §3.11、S-6、S-7 | 词法、值转换、全列读取（JS）、`move_mask`、`charge` 映射、info 写法、多帧结果、ASE 样例；JS CIF/PDB 的 props 名；读取器文案统一 | `facet/io/xyz.py`、`web/js/io/xyz.js`、`web/js/io/cif.js`、`web/js/io/pdb.js`、`tests/test_io.py` 的 extxyz 部分、`tests/js/io.test.mjs` 的 extxyz 部分、`tests/data/surface/f0d/extxyz.json`、`tests/data/surface/ase329_*.extxyz`、`crystallume031_sd.extxyz` | T1、T2、T3 | M | 第 3 批，与 T4 并行（`test_io.py`、`io.test.mjs` 按段落归属，T4 先合） |
| **T6 导出检查与通道（库与服务器）** | §3.12 | 能力表与校验、`export_report`、`close_contacts`（两语言）、`ExportWarning`、REST/客户端/CLI（含 `info` 的 `Vacuum gap` 行）、JS `exportStructure` 契约与服务器格式 | `facet/io/__init__.py`、新 `facet/io/capabilities.py`、新 `facet/analysis/contacts.py`、`facet/server/models.py`、`facet/server/routes/io.py`、（O-6）`facet/server/routes/analysis.py`、`facet/client.py`、`facet/cli.py`、`web/js/io/index.js`、新 `web/js/io/capabilities.js`、新 `web/js/core/contacts.js`、`web/js/api/extensions.js`、`tests/test_export.py`、`tests/js/export.test.mjs`、`tests/test_server.py`、`tests/test_client.py`、`tests/test_cli.py`、`tests/data/surface/f0d/export.json` | T3、T4、T5、T7 | M | 第 4 批 |
| **T8 网页集成** | §5 | 导入 toast 用本步备注（含粘贴）、Notes 列表与 `Clear notes`、导出 toast 与 Export notes 对话框、3 个命令、公共 API | `web/js/app.js`（只改 `importFiles`/`importText`/`exportStructureFile` 三段）、`web/js/main.js`、`web/js/ui/panels/structure.js`、`web/js/ui/shell.js`（只改粘贴的两处 toast）、`web/js/api/public.js` | T2、T6；F0-A T1（`app.js` 的撤销存储改造先合） | S | 第 5 批 |
| **T9 二面角与元素数据** | §3.15.1、§3.15.3 | `core/geometry.js`、查看器与选区卡片改用、JS 共价半径 7 个值、`bondiRadius` 两种语言、Python 回退值、测试 | 新 `web/js/core/geometry.js`、`web/js/render/viewer.js`（只改 `measureValue`，1949-1961）、`web/js/ui/selectioncard.js`、`web/js/core/elements.js`、`facet/data/elements.json`、`facet/core/elements.py`、`tests/test_js_parity.py` 的对应测试 | T0 | S | 任意批次（`viewer.js` 与 F0-A 的改动在不同行段，按"F0-A 先合"处理） |
| **T10 默认参数表对齐** | §3.15.2 | 生成脚本、`web/js/build/reference.js`、JS 构建器与 Build 面板、Python `hbn`、按化合物的 `u` 与厚度、MoS2 参数与原子顺序、严格的逐原型对比测试 | 新 `scripts/gen_reference_data.py`、`facet/build/crystal.py`、`web/js/build/crystal.js`、新 `web/js/build/reference.js`、`web/js/ui/panels/build.js`、`tests/test_build.py` | T0 | M | 任意批次 |
| **T11 文档** | 全部 | `docs/SCHEMA.md`（props 表、`info.warnings` 语义、能力表含 pbc 一栏、`supercellMatrix`）、`docs/PLUGINS.md`（写出器能力、`exportReport`、新方法、REST/客户端/CLI、约束传递表、ASE `_JSON` 反斜杠问题）、`docs/DEPLOY.md`（REST 表）、`README.md`（网页支持 SD）、CHANGELOG 的行为变化 | `docs/*`、`README.md` | T1–T8 | S | 最后 |

### 9.2 批次与关键路径

- 第 1 批：T0 → T7、T3（T9、T10 可在任何一批插入）。
- 第 2 批：T1 ∥ T2。
- 第 3 批：T4 ∥ T5。
- 第 4 批：T6。
- 第 5 批：T8，然后 T11。
- 关键路径：T0 → T7 → T1/T2 → T5 → T6 → T8（约 5–6 个工作日）。
- 与 F0-A 的文件交界：`core/lattice.js` 与 `core/lattice.py` 由本模块 T7 建立，F0-A T7 只**追加**；`app.js` 的撤销快照（575 行附近）归 F0-A T1，本模块只提供
  `toJSON({copy: false})`；`viewer.js` 与 `ui/panels/structure.js` 两边改不同行段，合并顺序"F0-A 先合"。
- 每个任务的完成标准：本任务的单元测试与用例（Python 与 JS 两侧）通过，`pytest` 全量通过，`FACET_REQUIRE_NODE=1 pytest` 通过。

### 9.3 按文件的改动索引

| 文件 | 改动（见节） | 任务 |
|---|---|---|
| `facet/core/structure.py` | §3.1–3.7、§3.10.3（`poscar_order`、`canonical_order`） | T1 |
| `facet/core/__init__.py` | 再导出（§3.5.1 末） | T1 |
| `facet/core/lattice.py` | `wrap_fractional` | T7 |
| `facet/core/defaults.py`（新） | §3.16 | T7 |
| `facet/core/naming.py`（新） | §3.14 | T1 |
| `facet/core/constraints.py`（新） | §3.8–3.9 | T3 |
| `facet/core/elements.py`、`facet/data/elements.json` | 回退值 0.5、`bondi_radius`（§3.15.3） | T9 |
| `facet/analysis/vacuum.py`（新）、`analysis/__init__.py` | §3.13 | T7 |
| `facet/analysis/contacts.py`（新） | §3.12.3 | T6 |
| `facet/io/__init__.py` | `ExportWarning`、`export_report`、`register_writer(capabilities=)`、`WriterSpec.capabilities`、`formats()`、`write()` 发警告、POSCAR 读取器的文件名加 `xdatcar`（T4 的测试直接调用 `read_poscar`/`parse_text(..., "poscar")`，不依赖它） | T6 |
| `facet/io/capabilities.py`（新） | §3.12.1 | T6 |
| `facet/io/poscar.py` | §3.10 | T4 |
| `facet/io/xyz.py` | §3.11 | T5 |
| `facet/server/models.py`、`server/routes/io.py`、`server/routes/analysis.py` | §6.3 | T6 |
| `facet/client.py`、`facet/cli.py` | §6.4、§6.5 | T6 |
| `facet/build/crystal.py`、`web/js/build/crystal.js`、`web/js/build/reference.js`（新）、`web/js/ui/panels/build.js`、`scripts/gen_reference_data.py`（新） | §3.15.2 | T10 |
| `facet/web/js/package.json`（新） | `{"type": "module"}` | T0 |
| `facet/web/js/core/structure.js` | §3.5.2 全部 | T2 |
| `facet/web/js/core/naming.js`（新） | §3.14 | T2 |
| `facet/web/js/core/defaults.js`、`lattice.js`、`vacuum.js`（新） | §3.16、§3.13 | T7 |
| `facet/web/js/core/constraints.js`（新） | §3.8 | T3 |
| `facet/web/js/core/contacts.js`（新） | §3.12.3 | T6 |
| `facet/web/js/core/geometry.js`（新）、`core/elements.js`、`render/viewer.js`、`ui/selectioncard.js` | §3.15.1、§3.15.3 | T9 |
| `facet/web/js/io/poscar.js` | §3.10 | T4 |
| `facet/web/js/io/xyz.js`、`io/cif.js`、`io/pdb.js` | §3.11、S-6、S-7 | T5 |
| `facet/web/js/io/index.js`、`io/capabilities.js`（新）、`api/extensions.js` | §3.12 | T6 |
| `facet/web/js/app.js`、`main.js`、`ui/panels/structure.js`、`ui/shell.js`、`api/public.js` | §5、§6.2 | T8 |
| `tests/…` | §7.1 布局 | T0 起各任务（见 9.1 的文件列） |
| `docs/SCHEMA.md`、`docs/PLUGINS.md`、`docs/DEPLOY.md`、`README.md` | §4、§6 | T11 |

---

## 10. 对其他模块的接口需求

### 10.0 消费方接口对照表（定稿；F0-D 是这些接口的唯一实现方，工程 #2）

| 接口 | 消费方原来的期望（出处） | 定稿（F0-D 实现，见 §6） | 对方需要改的 |
|---|---|---|---|
| 真空间隙 | F0-A §10：`findVacuumGap(structure, axis = null) → {axis, start, end, width, center} \| null`；M1 §10、M2 §10.1：`find_vacuum_gap(..., *, min_width)`，`min_width=0` 总返回最宽者；M5 §10：`find_vacuum_gaps(s, frame=0)`；M6：`M2.detect_slab(s)` | `find_vacuum_gap(structure, axis=None, *, min_width=None, frame=None, periodic_only=True)`，字段 `{axis, start, end, width, center, height}`，并列规则写死（§3.13.1）；`find_vacuum_gaps`、`find_surface_gap`、`gap_cut`、`unwrap_along_gap`、`vacuum_gap_hint` | F0-A：显示改用 `unwrapAlongGap`，`info.surface.axis` 那一轴用 `findSurfaceGap`；M5、M6：改用 `find_surface_gap`（M6 不再调用 `detect_slab`） |
| 断开复原 | M2 §10.1：`make_contiguous(structure, axis) -> int`，`set_pbc(..., contiguous=True)` 内部用同一函数 | `make_contiguous(structure, axis, *, gap=None, frame=None) -> int`，只供显式编辑；`set_pbc` 无副作用 | M2：不再依赖 `set_pbc` 的复原 |
| 修改计数 | F0-A A4/§3.5、M1：`rev` + `touch()`；M2：`version++` | `rev` + `touch()`（K13） | M2：把 `version++` 改为 `touch()` |
| 帧 | F0-A §10、M1、M4、M5：`keepFrame(i = this.frame) → this` | JS `keepFrame`，Python `keep_frame(index=0)` | — |
| 坐标写入 | F0-A §3.6.4/§10：`setPositions(Float64Array \| {indices, positions}, {frame})` | 同签名；Python `set_positions(positions, *, indices=None, frame=0)`；都调用 `mark_edited("positions")` | M1：不直接改 `_base` |
| remap | M1/M2/M5：`_remap(src, *, symbols, positions, frames, added_props, defaults)`；M4：`_remap(src, defaults) -> None`；M6：`_remap(src, defaults=PROP_DEFAULTS)` | 同 M1 的签名，另加 `new_symbols`/`new_positions`；返回 `self` | M4：返回值是 `self` |
| 源映射 | 各模块：`source_map`/`sourceMap` 只读 | 累计语义 + 追踪会话（K2）；构建器从数组构造时用 `_set_source`/`setSource` | F0-A：`editActive` 用 `t.stop(r)`（§10.1） |
| 约束基变换 | M4：`convert_constraints(flags, old_cell, new_cell) -> (list, list[str])`；M6：`transform_selective_dynamics(..., tol) -> (list, list[str])` | `transform_move_flags(flags, old, new, tol) -> (flags, n_tightened)`、`apply_basis_change(s, old, new) -> int`（写备注） | M4、M6：改用 F0-D 的名字（同一函数不能有三个名字） |
| 约束编辑与查询 | M3：`Structure.fix/free/fix_layers/fixed_indices/constraint_summary/get_move_mask`、`axis_labels(cell)`、`cartesian_to_flags(cell, fixed_xyz)`；M3 §10.1 第 5 条要求 F0-D 的 extxyz 换算用 `cartesian_to_flags` | F0-D 实现 `get_move_mask`、`constraint_summary`（第 0 波要用）与纯函数；M3 实现 `fix/free/fix_layers/fixed_indices/axis_labels/cartesian_to_flags`，后者用 `cartesian_to_lattice_flags` 实现（同一判据） | M3：测试文件与 F0-D 不同名（§3.8.2）；删去对 v1 `constraint_axis_names` 的依赖 |
| 常量对象 | M3：冻结 dataclass，属性访问；M2/M5：下标访问；F0-A：JS 键 `vacuum_gap_min` | Python 只读映射，两种访问都行；JS camelCase `vacuumGapMin` | F0-A：JS 键改为 camelCase |
| 默认属性扩展 | M6：`PROP_DEFAULTS["interface_layer"] = 0` | 由提出模块在自己的任务里同时改两份源码表；两份都冻结 | M6：在 M6 的任务里改表，而不是运行时赋值 |
| 合并 | M6：`concat_structures(parts, *, cell, pbc, defaults)`；M4：粘贴、合并 | `concat_structures(parts, *, cell=None, pbc=None, defaults=None, renumber_adsorbates=True)`；`extend(other, *, renumber_adsorbates=True)`（两种语言） | — |
| 半径 | M6：`bondi_radius`、两种语言一致的 `vdw_radius` | `bondi_radius`（两种语言，K16）；`vdw_radius` 不供算法使用 | M6：层间距用 `bondi_radius`，不用 `vdw_radius` |
| 超胞矩阵 | M1 K4：`repeat` 维护 `info.supercellMatrix`；"Make supercell real"改用 M1 的 `cell.bakeRepeat` | `repeat` 两种语言都维护 `supercellMatrix`（§3.5）；按钮归 M1 | — |
| Wrap 按钮 | M1：`Wrap atoms into cell` 按 C11 丢帧 | 归 M1；核心 `wrap()` 处理所有帧（K10） | — |
| extxyz 剪贴板 | M4：带 `facet_clip=<id>` 的 extxyz，JS 读取器与 Python 对等 | 普通字符串键往返，有用例（§7.2） | — |
| 二面角 | M4：JS 改 IUPAC 或用 M4 的 `dihedralDeg` | `core/geometry.js` 的 `dihedralFromVectors`、`signedAngle` | M4：不再另写 `dihedralDeg` |
| 派生信息失效 | M1/M4/M5/M6：`invalidate_symmetry_info(info)`；M2：清除空间群 | `mark_edited(s, kind)` 统一入口（§3.7 的表），仍导出 `invalidate_symmetry_info` | 各模块按 §3.7 的表调用 `mark_edited` |
| `METALS` | M4：若放在 `core/elements.py` 由 F0-D 加 | 不放进 F0-D（不是数据地基的需要） | M4：在自己的 `analysis/fragments.py` 定义 |

### 10.1 F0-A（应用、视图与界面地基）

1. **`editActive(label, fn, {indexMap})` 的映射**：
   ```js
   const work = old.clone(); const t = work.trackChanges();
   const r = fn(work) ?? work;
   const src = t.stop(r);                                   // fn 返回无关的新结构时为 null
   const indexMap = opts.indexMap ?? (src ? invertSourceMap(src, old.length) : null);
   if (!indexMap && r !== work) { if (DEV) throw new Error('editActive: pass indexMap'); console.warn(...); }   // 不再静默组合
   ```
2. **显示（U1）**：F0-A §3.8.2 的切口直接调用 `gapCut`/`unwrapAlongGap`（与 M3、M5 同一实现）；`info.surface.axis` 指定的那一轴用 `findSurfaceGap`
   （低于阈值也切），其他轴照 §3.8.2 用 `findVacuumGap`。v1 的 `noBoundaryAxes` 请求撤回。
3. **备注的 toast**：`editActive`、`addStructure`、导入流程 toast `newWarnings(before, after)`（本步新增的备注），不再显示全部备注（§3.6）。
4. **toast 改造**：悬停与聚焦时暂停计时；`timeout: 0` 的 toast 可用键盘关闭；Undo 只撤销自己那一步（F0-A 已有此项）。
5. **`structureKey`**：用 `structure.rev`（本模块保证所有修改方法递增它）。
6. **"Property" 配色**（`render/colors.js:205`）：现在默认取第一个数值 prop，切面后会变成 `tags`；请改为显式选择或排除 `adsorbate_id`（建议，非必须）。
7. **`facet.edit` 命名空间**：本模块注册 `sortBySpecies(order?)`、`clearNotes()`（v1 的 `setPbc`、`detectSlab` 撤回）。
8. **文件交界**：`core/lattice.js`/`.py` 由本模块 T7 建立（含 `wrapFractional` 与对 `util.js` 的重新导出），F0-A T7 只追加；`SURFACE_DEFAULTS` 的 JS 键用 camelCase；
   撤销快照改用 `toJSON({precision: 8, copy: false})`（`app.js:575`）由 F0-A T1 采用。

### 10.2 M1（晶胞与晶格工具）

- 所有改变原子集合的变换经 `_remap`/`remap`（`frames=[]` 丢帧），对角矩阵时原子顺序与 `repeat` 相同（简报 C1）；从数组构造结果时用 `_set_source`。
- 原子不动、晶格基改变的操作（`make_supercell`、重定义晶格、Niggli/LLL、原胞、`set_cell(scale_atoms=False)`）调用 `apply_basis_change(result, old_vectors, new_vectors)`；
  原子随晶胞变的（`set_cell(scale_atoms=True)`、应变、刚性重定向）不调用。
- 按 §3.7 调用 `mark_edited`：改晶格 `"cell"`，刚性重定向 `"rotate"`（带 `rotation`，旋转速度等矢量属性）。
- `info.supercellMatrix` 的语义由 M1 定义，本模块的 `repeat` 按 M1 K4 维护它；"Make supercell real"与"Wrap atoms into cell"按钮归 M1。
- 在 `core/lattice.py` 与本模块建立的 `web/js/core/lattice.js` 上扩展；保留 `wrap_fractional(frac, pbc, eps=1e-12)` 的规则；命名在 `core/naming` 上扩展。

### 10.3 M2（切面与 slab）

- **[U] `surface(...)` 的结果 `pbc = [T, T, T]`**（U2）；真空沿 c，c ⊥ 表面且 ∥ z，a ∥ x（C5）。M2.md 中 `pbc = [T, T, F]` 的各处（K12、§3、§10）请按 U2 改。
- 结果由体相经 `_remap`（或 `_set_source`）得到，`result.source_map` 指向体相原子；新 slab 从新的 info 开始（不继承体相的备注、计算结果与构建参数），写 `info.surface`
  （必须是纯 JSON 值，含 `normal` 与 `axis`）与自己的备注（C12 的部分占位等）。
- 写 `props.tags`（1 = 顶层）；约束按 M2 的设计写入（`fix_layers`）。
- **原子顺序（K14，建议）**：按 `canonical_order(symbols, layers)` 排列（先元素、块内按层从下到上），而不是 K12 的"按层从下到上"；这样 POSCAR 导出顺序与内存一致，
  固定的底层原子仍在每个元素块前面。若保留层序，导出时只多一条说明。
- 已有 slab 的真空调整：`find_vacuum_gap(..., min_width=0)` 求间隙，`make_contiguous` 显式切开（只在这些编辑里调用）；`set_vacuum` 改变 c 的方向时调用 `apply_basis_change`；
  调用 `mark_edited(s, "cell")`。真空参数一律指总间隙（U4），且没有默认值。
- "F0-D 的 D3 已识别 c 为真空轴并展开"（M2.md:153）这一前提已随 U1 失效，请改为用 `find_surface_gap` 与 `unwrap_along_gap`。
- 名字在 `core/naming.py`/`naming.js` 上扩展（`×`、Wood 记号）；部分占位按 C12 用 `add_warning`。

### 10.4 M3（层、几何选择与约束界面）

- 层分析判断上下表面用 `find_surface_gap` + `unwrap_along_gap`（与显示同一切口）；M3 §10.1 第 2 条（"D3 若把某轴改成非周期请同时切开平移"）随 U1 失效。
- 约束：`get_move_mask`、`constraint_summary` 由 F0-D 提供；`fix/free/fix_layers/fixed_indices/axis_labels/cartesian_to_flags` 由 M3 实现，`cartesian_to_flags` 用
  `cartesian_to_lattice_flags` 实现；测试文件 `test_constraints.py` 归 M3，F0-D 用 `test_constraints_core.py`。
- `SURFACE_DEFAULTS` 支持 `SURFACE_DEFAULTS.layer_tolerance`；M3 的键由 M3 在两份源码表中追加。

### 10.5 M4（原子操作）

- 添加原子用 `append`/`addAtom`（默认值自动补齐）；粘贴、合并用 `extend`（标志按来源晶胞换算、`adsorbate_id` 重新编号）或 `concat_structures`；
  部分原子的移动用 `set_positions`/`setPositions`（已调用 `mark_edited("positions")`）。
- 约束换算用 `transform_move_flags`/`apply_basis_change`（不另起 `convert_constraints`）；二面角读写用 `core/geometry.js` 与 Python `get_dihedral` 的 IUPAC 约定。
- 剪贴板 extxyz 的 `facet_clip` 键按普通字符串往返；`METALS` 由 M4 自己定义。

### 10.6 M5（吸附物）

- 新吸附物原子：`tags = 0`，`adsorbate_id = next_adsorbate_id(slab)`，`selective_dynamics` 取默认（可动）；经 `added_props` 传入；放置后 `mark_edited(s, "atoms")`
  （`append`/`extend` 已调用）。
- 上下表面与切口用 `find_surface_gap` + `unwrap_along_gap`（替代 `find_vacuum_gaps(s, frame=0)`）；没有间隙时显示 `vacuum_gap_hint`。
- **原子顺序（K14，建议）**：放置前 slab 已按元素分块时，追加后做一次稳定的 `sort_by_species()`（同一编辑步内；源映射照常组合），保持文件顺序与内存一致；否则追加在末尾。
- 吸附高度、重叠检查只用共价半径或 `bondi_radius`（K16）。

### 10.7 M6（界面）

- **[U] 界面结构 `pbc = [T, T, T]`**（U2）；M6.md 中 `pbc = [T, T, F]` 的各处请按 U2 改。
- 合并两层用 `concat_structures`：各部分的标志按其**应变后**的晶胞到合并晶胞换算（只收紧）、`adsorbate_id` 重新编号、帧丢弃；需要分层标记时在 M6 的任务里把
  `interface_layer` 加进两份 `PROP_DEFAULTS` 源码表，合并时用 `defaults=` 或 `added_props=` 给值。
- 真空间隙用 `find_surface_gap`（不再调用 v1 设想的 `M2.detect_slab`）；层间距默认用 `bondi_radius`（两种语言一致）；原子顺序建议按 `canonical_order`。
- 约束换算的名字用 `transform_move_flags`（不另起 `transform_selective_dynamics`）；`add_warning`、`invalidate_symmetry_info` 返回 `info`（不是 `None`）。

### 10.8 M7（API、文档与测试总纲）

- 汇总本模块的 REST/客户端/CLI 名称（`/io/export` 的 `warnings`/`notes`、`export_structure_with_warnings`、`Vacuum gap` 行，可选的 `/analysis/vacuum` 与 `vacuum_gap`）；
  在 CI 中设置 `FACET_REQUIRE_NODE=1`；确认 `facet.cases/1` 与 `tests/data/surface/` 的递归加载作为所有模块的统一格式，CONTCAR 夹具只留 `contcar_pt111.vasp`。
- `docs/PLUGINS.md` 收录约束传递表（R4）与 ASE `_JSON` 反斜杠问题（R8）。

---

## 附录 A：原型与验证记录

v1（`scratchpad/proto/f0d/`）：

| 文件 | 内容 |
|---|---|
| `f0d.py`、`f0d.mjs` | Python/JS 孪生原型：`copy_value`、`PROP_DEFAULTS`、规范化器、`_remap`、v1 追踪器、`invert_source_map`、`poscar_order`、警告辅助、约束基变换、晶格↔笛卡尔、POSCAR 标志词法、ASE 键值词法、info 值格式化（v1 的真空检测与断开复原已被 v2 取代） |
| `scenarios.py` | 场景：Pt(111) p(3×3) 4L、断开的 CONTCAR、Cu(100)、仓库构建器的体相与二维结构、CO 盒子、金属链 |
| `run_checks.py`、`parity.py`、`timing.mjs`、`io_timing.mjs` | 场景检查、随机输入的两语言对比（0 处不一致）、计时 |
| `ase_interop.py`、`ase_interop2.py` | 开发期 ASE 3.29 实测（scratchpad 内的独立 venv，不是依赖） |

v2（`scratchpad/proto/f0d/v2/`，本次）：

| 文件 | 内容 | 结果 |
|---|---|---|
| `gap2.py`、`gap2.mjs`、`run_gap2.py` | §3.13 的 `find_vacuum_gap`（并列规则、包裹规则、阈值容差）、`find_surface_gap`、`gap_cut`/`unwrap_along_gap`、`make_contiguous`；18 种场景 × 3 种平移 + 400 个两个相同 slab 的晶胞 | 454 个情形两语言 0 处不一致；各场景数值见 §0.3 |
| `srcmap2.py`、`srcmap2.mjs` | §3.4 的累计映射与追踪会话；6 种编辑写法 + 无关结构 + 构建器 + 衔接校验 | 全部正确，两语言相同 |
| `infofmt2.py`、`infofmt2.mjs`、`run_info2.py` | §3.11.2、§3.11.6 的值转换与 info 写法；33 个键四个方向；ASE 3.29 读两种语言写出的行 | 0 处不一致；ASE 读回 stress、能量与字符串 |
| `contacts2.py`、`contacts2.mjs` | §3.12.3 的重叠检查，1 万原子计时 | 两语言找到同样的两对；JS 34–89 ms，Python 110 ms |
| `order2.py` | §3.10.3–3.10.4 的块标签、`poscar_order`、`canonical_order` | `Ga As H H` 往返不变；层序 → 元素块 |

审查者的原型（`scratchpad/proto/review/f0d/`、`review/f0d_domain/`）本人重跑并确认：`ase_mm3_to_poscar.py`（F4）、`stale_results.py`、`ase_stale_results.py`（F3/#6）、
`roundtrip_stress.py`、`ase_special_keys.py`（F5/#5）、`ase_json_rt.py`（#25）、`convert_edge.py`（#12）、`info_types.py`（#13）、`gap_ties.py`（#4）、
`srcmap_compose.py`（#3）、`nodetest/`（#9）。

运行：`cd scratchpad/proto/f0d/v2 && python3 -B run_gap2.py && python3 -B srcmap2.py && /opt/node22/bin/node srcmap2.mjs && python3 -B run_info2.py && python3 -B contacts2.py && /opt/node22/bin/node contacts2.mjs "$PWD" && python3 -B order2.py`。

## 附录 B：ASE 3.29 实测输出（将固化为 `tests/data/surface/ase329_*.extxyz`）

ASE 写出（FixAtoms 固定前两个原子，tags，info 含字典与列表）：

```
Lattice="2.0 0.0 0.0 0.0 2.0 0.0 0.0 0.0 15.0" Properties=species:S:1:pos:R:3:move_mask:L:1:tags:I:1 surface="_JSON {\"miller\": [1, 1, 1], \"layers\": 2, \"name\": \"Pt(111) \\"test\\" \\ x\"}" supercell="_JSON [2, 2, 1]" energy_note="a b" pbc="T T F"
Pt       0.00000000       0.00000000       0.00000000  F        2
```

- 加上 `FixCartesian(2, mask=(False, False, True))` 后为 `move_mask:L:3`，该原子行 `T  T  F`；只有 `FixScaled` 时**没有** `move_mask` 列（约束被静默丢弃）。
- 上例中名字含引号与反斜杠：ASE 自己读回时**含引号的**值 `JSONDecodeError`（我们的读取器得到原字符串并写备注）；**含反斜杠的**值被静默改坏（`a\b` → `a\x08`），
  读取方无从察觉（v1 把两者都说成解码错误，已按工程 #25 更正）。
- 宽度 3 的 `move_mask` 经 ASE 读入再 `write_vasp`：4 个原子全部 `T T T`，无警告；宽度 1 时正确写出 `F F F`（领域 F4，本人重跑确认）。
- ASE 写出的带应力的行：`stress="0.1 0.0 0.0 0.0 0.2 0.0 0.0 0.0 0.3"`（9 个普通数字）；v1 写回的 `stress="_JSON [...]"` 让 ASE 抛 `ValueError`；v2 写法 ASE 读回 Voigt `[0.1, 0.2, 0.3, 0, 0, 0]`。

ASE 读入我们计划写出的格式：

```
3
Lattice="2.772 0 0 1.386 2.4006 0 0 0 20" Properties=species:S:1:pos:R:3:move_mask:L:3:tags:I:1:adsorbate_id:I:1 pbc="T T T" name="Pt(111) p(1×1)" surface="_JSON {\"miller\":[1,1,1],\"note\":\"say \\\"hi\\\"\"}"
Pt 0 0 0 F F F 2 0
Pt 1.386 0.8 2.26 T T F 1 0
O 0 0 4 T T T 0 1
```

→ `info = {'name': 'Pt(111) p(1×1)', 'surface': {'miller': [1, 1, 1], 'note': 'say "hi"'}}`，tags `[2, 1, 0]`，`arrays['adsorbate_id'] = [0, 0, 1]`，
约束为三个 `FixCartesian`（mask `[T,T,T]`、`[F,F,T]`、`[F,F,F]`，ASE 的 True = 固定）。全 T 的 `move_mask:L:1` → `FixAtoms(indices=[])`（无害，但按 ASE 约定我们不写）。
（v1 的这一样例含 `warnings="_JSON [...]"`；v2 不再写 `warnings`，§3.6。）

---

## 修订记录

v2（本版）相对 v1 的修改，逐条对应审查意见。"按用户决定 U1–U4 修改"的条目标 **[U]**。

| 意见 | 级别 | 修改 | 位置 |
|---|---|---|---|
| 领域 F1 / 工程 #1 | blocker | **[U] 按用户决定 U1–U4 修改**：删除导入检测整条链（`detect_slab`、`vacuum_axes`、`SLAB_DETECT_FORMATS`、偏好与命令、`Treat as slab`/`Keep periodic`、`detect_slab` 参数、REST `detectSlab`、CLI `--detect-slab`、`kind` 分类、文案表、R1/R2 旧版、相关测试）；只保留只读的 `find_vacuum_gap`（与 F0-A、M2 对齐的签名与字段）+ `find_vacuum_gaps`（诊断）+ `find_surface_gap`；新增共用切口 `gap_cut`/`unwrap_along_gap`；`make_contiguous` 改为只供显式编辑、原位、所有帧同一组平移；`set_pbc` 无副作用；结构面板不加周期按钮与真空提示；CLI `info` 只留中性的 `Vacuum gap` 行；新增 U1 验收用例（CONTCAR 读入直接导出 POSCAR 不变）；T7 缩为 S | K5、§2.4、§3.13、§5.1–5.2、§6.5、§7.2、§7.5、§9 |
| 领域 F2 / 工程 #1-5 | blocker | **[U] 按用户决定 U2 修改**：生成的 slab 与界面 `pbc = [T, T, T]`；导入保留文件的 pbc；用户故事 5、6、MS 对照表、测试期望改写；通知 M2、M6 | K6、§1、§10.3、§10.7 |
| 工程 #2 | blocker | 新增 §10.0 消费方接口对照表并逐项定稿：真空间隙、`make_contiguous`、`rev`/`touch()`、`keepFrame`、`setPositions`（封装帧别名）、remap 签名、约束分工（F0-D 实现 `get_move_mask`/`constraint_summary` 与纯函数，M3 实现编辑与 `axis_labels`/`cartesian_to_flags`，删 `constraint_axis_names` 等）、常量对象双访问、默认表扩展规则、`concat_structures`、Bondi 半径、`supercellMatrix`、按钮归属、`facet_clip`、二面角函数、`METALS` | §3.5、§3.8.2、§3.15.3、§3.16、§10.0 |
| 工程 #3 | major | 源映射改为累计语义 + 跟随派生结构的追踪会话（`stop(result)`），比审查建议更进一步，覆盖"派生后再改父结构"；`compose_source_maps` 校验衔接；`editActive` 拿不到映射时要求 `indexMap`；原型两语言 6 种写法正确 | K2、§3.4、§10.1 |
| 工程 #4 | major | 间隙并列规则写死：宽度差 ≤ 1e-5 Å 为并列，轴内取 start 最小，跨轴 c、b、a；阈值比较带容差；400 个并列晶胞 0 处不一致 | §3.13.1 |
| 领域 F5 / 工程 #5 | major | info 写法改为与 ASE 互通：`stress`/`virial` 写 9 个数（含 Voigt 展开），一维数值/布尔列表空格分隔，只有嵌套、字典等用 `_JSON`；ASE 3.29 读回两种语言的输出 | K15、§3.11.6 |
| 领域 F3 / 工程 #6 | major | 新增 `RESULT_INFO`、`invalidate_results`、`invalidate_build_info`、统一入口 `mark_edited` 与失效表；本模块的方法与 §10 的各模块按表调用；场景测试 | K8、§3.7、§10 |
| 工程 #7 / 领域 F16 | major | `info.warnings` 定义为持久备注；toast 只显示本步新增（`new_warnings`）；extxyz 不写 `warnings`；结构面板 Notes 列表与 `Clear notes`；粘贴导入也显示读取备注；构建新结构时不继承备注 | K7、§3.6、§5.1–5.2 |
| 工程 #8 / 领域 F20 | major | §8.2 改为决定记录（D3 → U1、D5 → U5 等）；二面角（S-3）、`rev`（S-4）、默认参数表（S-7）升为"必须"（M-17–M-19）；T10 去掉"待确认" | §2.1、§8.2、§9 |
| 工程 #9 | major | `MIN_NODE_MAJOR = 22`；`run_node_tests` 由 Python 列出文件逐个传入；桥自测；`pyproject.toml` 改为追加 | K12、§7.1 |
| 工程 #10 | major | 按文件重排任务归属（每个文件只归一个任务）：T6 负责 `io/__init__.py`、服务器、客户端、CLI；新 T8 负责全部网页 UI 文件；T7 建立 `core/lattice.*` 与 `defaults.*`；撤销快照归 F0-A T1；测试文件分段归属；批次与关键路径重写 | §9 |
| 工程 #11 | major | `exportStructure` 保持同步，`warnings`/`notes` 总是本地算出的数组，服务器格式抄入能力表，`text` 才可能是 Promise；`exportText` 与嵌入页不变 | §3.12.5 |
| 领域 F4 | major | 能写宽度 1 就写宽度 1；写宽度 3 时导出警告 W6（ASE→VASP 丢约束）；可选的 `constraints="fix-partial"`（O-3）；附录 B 与文档记录 ASE 行为 | K4、§3.11.4、§3.12.2、R4 |
| 领域 F6 | major | 新增 `canonical_order` 并建议 M2/M6 按它生成、M5 保持分块；POSCAR 顺序提示降为说明 N1，文案与通道无关；可选的 `order="keep"`（O-4） | K9、K14、§3.10.3、§10.3、§10.6 |
| 领域 F7 | minor | 物种行重复元素时用 `props.poscar_species` 保留各块，往返不再合并（原型验证） | §3.10.4 |
| 领域 F8 | minor | 写明 Cartesian 模式下标志仍是晶格系（VASP wiki 已核对），加用例 | §3.10.1 |
| 领域 F9 | minor | 阈值依据改为"单原子原胞最大 4.34 Å（bcc Cs）"；Cs/Rb/Xe 原胞与 Bi2Se3 进入不检出用例；文档写明不得低于 4.4 Å | §3.13.6 |
| 领域 F10 | minor | `min_width=0`；新增 `find_surface_gap`（用 `info.surface.axis` 兜底）与带实测值的 `vacuum_gap_hint`；原型复现 3.3 Å 场景 | §3.13.2 |
| 领域 F11 | minor | `PROP_SHAPED_ZERO`（同形状的零）、`masses` 取原子量 | §3.2 |
| 领域 F12 | minor | `extend`/`concat_structures` 重新编号 `adsorbate_id`，并按来源晶胞换算标志 | §3.5、§3.8.3、§3.9 |
| 领域 F13 | minor | 新增 W10 左手晶胞、W11 原子重叠（`close_contacts`，原型计时）、N2 非周期轴写成周期；W3 文案写清"每侧 10 Å（周期像之间 20 Å）" | §3.12.2–3.12.3 |
| 领域 F14 | minor | `CARTESIAN_VECTOR_PROPS` 与 `rotate_vector_props`，`mark_edited("rotate", rotation=R)` 调用；结果类量按 F3 删除 | §3.7 |
| 领域 F15 / 工程 #21 | minor | 默认参数逐项取更准确的值（Cu、Fe、Mg 取 JS 值，Po 取 Python 值，Cr 改 2.884）；按化合物的纤锌矿 `u` 与 MX2 厚度；MoS2 `c` 理由改写；`SURFACE_DEFAULTS` 不含真空并有测试 | §3.15.2、§3.16 |
| 领域 F17 | minor | 新增 `BUILD_INFO_KEYS` 与 `invalidate_build_info`，改晶格时删除（`source` 保留） | §3.7 |
| 领域 F18 | minor | 间隙用显式 `frame` 参数；包裹统一用 `wrap_fractional` 并把负零置 0；加 f = −1e-17 用例 | §3.13.1 |
| 领域 F19 | minor | JS 修可变晶胞 XDATCAR；Python 补 XDATCAR 读取（S-4）；两帧不同晶胞的用例 | §3.10.5 |
| 领域"缺失"第 7 条 | — | CONTCAR 速度块列为可选 O-5（VASP wiki 已核对格式） | §2.3、§3.10.6 |
| 工程 #12 | minor | `convert_value` 只认 ASCII 正则、不得用 `int()`/`float()` 试转、超过 2^53 的整数按浮点；边界词进用例 | §3.11.2 |
| 工程 #13 | minor | 读回会变类型的字符串写成 `_JSON "…"`；`name` 一律作字符串；JS 不再取 `config_type` 作名字 | §3.11.2、§3.11.6 |
| 工程 #14 | minor | 两种语言都在反序列化时修复 props 与附加帧、在构造器与 `set_prop` 处严格报错；JS 不再补 0 | §3.1 |
| 工程 #15 | minor | 两种语言都用叉积/点积公式；容差两侧与 c 偏差的边界用例 | §3.8.3 |
| 工程 #16 | minor | 表以规格为准（原型的差异修正）；Python 表用 `MappingProxyType` + 元组；extxyz `charge` → `charges` | §3.2、§3.11.3 |
| 工程 #17 | minor | §6 补上 `defaults`；多帧时 `positions` + `frames="keep"` 抛错，并新增 `new_positions`；`set_prop`/`remove_prop` 返回 `self` | §3.3、§3.5、§6 |
| 工程 #18 | minor | 文案与通道无关；读取器同类警告统一（S-7），统一前共享用例只用 `count`/`contains` | §3.6、§7.1 |
| 工程 #19 | minor | 丢约束/占位等警告 `timeout: 0`；`file.exportNotes` 命令；暂停计时交给 F0-A 的 toast 改造 | §5.3、§5.7、§10.1 |
| 工程 #20 | minor | `add_repeat_suffix` 认得 JS 旧的 ` (A×B×C)` 后缀 | §3.14 |
| 工程 #22 | minor | `/analysis/vacuum` 降为可选，只做原子数上限检查 | §6.3 |
| 工程 #23 | minor | 客户端新增 `export_structure_with_warnings`，`export_structure` 不变 | §6.4 |
| 工程 #24 | minor | 注册写出器时校验能力表 | §3.12.1 |
| 工程 #25 | minor | 改正 ASE 反斜杠问题的描述（静默损坏，不是解码错误） | §0.3、附录 B、R8 |
| 工程 #26 | minor | `facet.cases/1` 定为所有模块的公共外壳，递归加载；CONTCAR 夹具只留 `contcar_pt111.vasp` | §7.1、§10.8 |
| 工程 #27 | minor | `sortBySpecies(order)` 参数校验（两种语言与命令） | §3.5.1、§5.4 |
| 工程 #28 | minor | 补 `toJSON({copy})`、`exportReport`、多帧 20 万原子·帧的预算 | §7.6 |
| 工程"缺失"第 7 条 | — | 能力表加 `pbc` 一栏并写进 SCHEMA（不报警告，POSCAR 另有说明 N2） | §3.12.1 |
| 工程"缺失"第 8 条 | — | `rev` 的递增测试 | §7.2 |

其他随之修改：K1–K16 表重写；§1 用户故事与 §1.2 对照表按 U1/U2 重写；§4 数据表加入 `poscar_species`、`masses`、结果与构建参数键；§4.5 行为变化清单更新；
§7.6 加入重叠检查与间隙的实测；§8 风险表更新（R1、R2 改写，新增 R10、R11）。

## 未采纳的意见

| 意见 | 内容 | 不采纳（或部分采纳）的理由 |
|---|---|---|
| 工程 #2（修改计数一行） | 名字定为 `version`，F0-A、M1 改引用 | 采用 F0-A 已定的 `rev` + `touch()`（F0-A A4 与 M1 都已按此写，只有 M2 写了 `version++`）：改一处比改两处少，语义相同。 |
| 工程 #2（真空间隙一行） | 三轴宽度并列时取轴号小者 | 采用领域 F1 的 c、b、a 顺序：C5 的标准取向把真空放在 c，盒子里的分子等真正并列的情形取 c（法向沿 z）更符合用户预期；两种取法都确定，只需写死一种。 |
| 工程 #6（部分） | 对角 `repeat` 删除 info 结果但保留逐原子 `forces` | 一律删除：与 ASE（`repeat` 后不带计算结果）一致，规则只有"原子集合、坐标、晶胞或 pbc 改变就删除"一条；保留力会产生"有力没能量"的半份标签，对 ML 数据集更易出错。已在 §8.3 告知。 |
| 工程"缺失"第 9 条 | 构建器写的 `info.prototype/a/c/u` 在改晶胞后保留为来源信息 | 采用领域 F17：改晶格后删除（它们会以 `a=3.92` 的形式写进 extxyz，被当作当前晶格参数）；来源由保留的 `info.source` 记录。对角超胞不删。 |
| 工程 #1-4 / 领域 F1-5 的"或整个删掉 `set_pbc`" | `set_pbc` 若没有消费方可删除 | 保留为无副作用的设置函数：它是 ASE 的名字、做输入校验，并在 JS 中递增 `rev`（直接赋值 `pbc` 不会）；没有界面入口。 |
| 领域 F16（部分） | 载入说明不写入 `info`，或另存 `info.loadNotes` | 不另设键：载入说明作为持久备注保留（对派生的同原子结构仍然成立），用"toast 只显示本步新增的备注"与"extxyz 不写 `warnings`"解决重复弹出；少一个键、少一套继承规则。 |
| 工程 #7（部分） | 读入文件里自带的 `warnings` 键只进备注、不 toast | 对 Facet JSON 照此处理；对 extxyz，我们从不写 `warnings`，外来文件若带此键就当普通键读入并在导入时显示一次——为此给读取器加"来源标记"不值得。 |
| 领域 F11（部分） | 所有数值型键的新原子默认值都取同形状的 0 | 只对已知的输入量（`PROP_SHAPED_ZERO`）这样做；未知键保持 `None`：现有测试依赖它（`tests/test_structure.py:107-117`），而且对未知含义的数据填 0 等于编造数值。 |
| 领域 F4 第 3 条（部分） | 写出选项 `constraints="fix-partial"` | 采纳为可选（O-3）而不是必须：主要问题（静默丢约束）已由 W6 警告解决，需要走 ASE→VASP 的用户应直接从 Facet 导出 POSCAR。 |
| 领域 F6 第 4 条（部分） | 写出选项 `order="species" \| "keep"` | 采纳为可选（O-4）：生成器按 `canonical_order` 排列后，内存顺序与 POSCAR 一致，`keep` 很少需要；且重复元素名与 VASP MLFF 冲突。 |
| 领域 F13（部分） | 原子重叠检查作为必须 | 列为"应该"（S-3）：它依赖新的邻近搜索函数并有性能成本，不影响其他模块的接口；规则与预算已写定。 |
| 领域 F19（部分） | Python 补上 XDATCAR 支持（与 JS 同为必须） | JS 的错误坐标是数据缺陷，列为必须；Python 的 XDATCAR 是新增读取能力，列为"应该"（S-4）。 |
| 工程 #19（部分） | toast 在悬停/聚焦时暂停计时 | 不在本模块实现：toast 组件归 F0-A 的改造，已作为接口需求写进 §10.1；本模块只规定哪些导出警告用 `timeout: 0`。 |
