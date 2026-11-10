# F0-A 应用、视图与界面地基（模块规格 v2）

> **范围**：`facet/web/js` 的编辑原语（原位编辑、预览会话、新增结构、绑定到自己那一步的 Undo）、撤销存储、
> 叠加层 A/B/C 与导出策略、合并拾取与工具钩子、工具注册表、高亮与逐原子可见性、位置快速更新、真空间隙显示（U1）、
> 测量引用、沿任意方向观察、输入控件与参数 schema 新类型、Surface 面板外壳与 Structure 面板分区、命令注册（MS 别名、守卫、参数校验）。
> Python 侧只有：参数 schema 的同步（新 `facet/core/params.py`、CLI `--param`、REST 插件参数规范化）、少量晶格方向函数（`core/lattice.py`）
> 和 `surface_normal`（追加到 F0-D 的 `facet/analysis/vacuum.py`）。
>
> **依据**：简报 `00-architecture.md`（U1–U6、P1–P7、C1–C12、D1–D7、§3 布局表、§4 网页约定、§9 模板）；报告 01–07；
> 接口对照用了 `specs/F0-D.md`、`M1.md`–`M6.md` 的 v1 文本（§10）。两份审查：`reviews/F0-A-domain.md`（D1–D17）、`reviews/F0-A-engineering.md`（E1–E34），
> 逐条处理见 §11 修订记录与 §12 未采纳的意见。所有 `文件:行号` 都在源码（HEAD `1bb366f`，仓库未改动）中重新核对过；
> 路径相对 `facet/web/js/`，以 `facet/`、`docs/`、`tests/` 开头的除外。
>
> **原型（都已运行）**，在 `scratchpad/proto/`：
> - v1：`undo_cost.mjs`（撤销快照）、`fastpath.mjs`/`fastpath_bonds.mjs`（位置快速路径）、`display_masked.mjs`（可见性掩码）、
>   `view_hkil.mjs`（观察方向、hkl↔hkil）、`params_proto.py`（参数解析）、`gapcut.mjs`/`display_gap.mjs`（v1 的 U1 规则）。
> - v2，在 `scratchpad/proto/f0a_v2/`：
>   - `vacgap.mjs` 与 `vacgap.py`：§3.8.2 的真空间隙与切口算法、§3.14.2 的 `surfaceNormal`，两种语言逐行对应；
>     `export_cases.mjs` + `parity.py`：89 个结构（含下表全部场景）上切口位置、窗口、规则、主块范围与法向 **0 处不一致**；
>   - `display_v2.mjs` + `scenarios.mjs`：v2 显示规则与 v1、现状的逐场景对比（§3.8.2 表）；`neb.mjs`：分子穿过真空的脱附轨迹（每 0.05 Å 一帧，15/10/20 Å 真空各 231/132/331 帧）、底面脱附、
>     `info.surface` 提示、性能；
>   - `measref.mjs`：测量引用 v2 的迁移与查找（§3.9）；`pv_fix.mjs`：P-pos 更换移动集合的修正（§3.7.1）；
>   - `parse2.py`：`parseIndices` 的边界情况（§3.15）；`miller_basis.py`：原胞上的 Miller 指数（§3.14.4）；`sideview2.mjs`：侧视的屏幕"上"（§3.14.1）；
>   - `largest_check.mjs`（与 `vacgap_largest.mjs`）：审查建议的"切在原子最多的块下方"在上层原子更多的异质结上的反例（§11）；
>   - `fixtures.mjs`：改正堆垛后的 fcc(111) 夹具（γ = 120° 网格上空位在 (2/3, 1/3)、(1/3, 2/3)）；`fastpath_bonds_fixed.mjs`、`bench1000.mjs`：用正确夹具重跑的位置快速路径与 1 000 个移动原子的基准。
>
> **与 v1 的关系**：v1 起草中途简报更新为 v2，v1 已"按用户决定 U1–U4 修改"（去掉 slab 分类与 "Treat as slab"，加入 U1 的显示切口，真空输入必填）。
> v2 保留这些，并按两份审查修订：U1 切口规则重写、测量引用改为相对存储坐标、`surfaceNormal` 改为间隙优先、
> 与 F0-D 和 M1–M6 的接口逐条对齐、工具钩子改为"延迟认领"、P-pos/P-swap 的几处实现错误修正、开发拆分重排。
> F0-D v2 与 M4 v2 在本次修订期间定稿，§10.0/§10.1 已按它们的定稿文本对齐（修改计数沿用 `rev`；F0-D 的切口三函数需按 §3.8.2 再改）。

---

## 0. 关键决定一览

| # | 决定 | 理由 |
|---|---|---|
| A-D1 | **预览期间以已提交的结构为准**：`app.structure`、项目数据、保存、自动保存、撤销快照、分析、面板签名都只看已提交结构。预览分三种：**P-pos**（同一批原子只改位置，视图原地改绘制坐标）、**P-swap**（视图临时显示另一个预览结构）、**P-ghost**（A 层叠加一个半透明幽灵结构）。P-swap 期间视图对原子的一切输入（点击、框选、右键、悬停）统一锁住，依赖 `viewer.model` 的选区命令改读 `app.committedModel`。 | 预览数据永远不会被保存、自动保存或缩略图意外写进项目；预览结构的原子编号与已提交结构不同，不锁输入就会选错、删错原子（E8）。 |
| A-D2 | **同一时刻只有一个预览会话**。开始新会话会取消旧会话；任何写历史的操作、撤销/重做、切换结构或项目先取消会话；编辑命令、导出、截图 API、轨迹播放在会话期间不可用（`Apply or cancel the preview first.`）；会话期间 Ctrl/⌘+Z = 取消预览。 | 避免"预览叠在另一个编辑上"；截图 API 与嵌入页、轨迹播放原来绕过了守卫（E28）。 |
| A-D3 | **撤销存储改为按条目的二进制快照 + 位置增量 + 字节预算**（纯模块 `core/history.js`）；整数数组只在值都在 int32 范围内时打包成 `Int32Array`；`HistoryStore` 提供栈顶替换和整体换出/换回，覆盖现有代码里所有直接读写撤销栈的地方。 | 实测：10k 原子每步 604 KB → 384 KB、快照 10 ms → 0.9 ms，拖动一步 156 字节；越界整数静默回绕（E13）；迁移清单不全会让项目切换与 View 合并失效（E12）。 |
| A-D4 | 结构修改计数用 F0-D v2 已定稿的 `Structure.rev` 与 `touch()`（所有修改方法递增，F0-D K13）；`structureKey` 加入 `rev`。 | props/info 原位编辑（固定原子、tags）原来对缓存与面板签名不可见（报告 02 §2 缺陷 4）；与 F0-D 只用一个名字（E1）。 |
| A-D5 | `addStructure(s, {replaceProject: 'auto' \| true \| false})`；表面工具（切面、界面、Duplicate、另存为新结构）一律传 `false`。 | 现在在未改动的启动示例上切面会替换整个项目、丢掉体相（`app.js:339-359`）。 |
| A-D6 | toast 上的 Undo 只撤销**它自己那一步**（`toastUndo` / `undoEntry`）；toast 可带多个动作；异步调用点必须显式传 `entry`。 | 现在撤销的是点击时的栈顶（报告 02 §8）；粘贴、导入是异步的，默认取"最近一条"会绑错（E12）。 |
| A-D7 | 叠加层由新 `render/overlays.js` 管理：A 层在 `root` 下（有深度）、B 层在后期处理之后单独渲染、C 层在 2D 画布或 DOM，另有图例项。光环可见性由一个隐藏集合控制（`render()` 不再无条件打开所有光环）。**PNG 默认保留选区光环、去掉悬停光环和所有标记**，导出菜单两个勾选项 "Include selection highlight"（默认开）与 "Include markers (sites, fixed atoms)"（默认关）；**缩略图不含任何光环和叠加层**；glTF 永远不含。 | 简报 §4；`viewer.js:1487` 每帧把所有光环设为可见，v1 的导出策略照写无效（E4）。 |
| A-D8 | 合并拾取 `viewer.pick()`：B 层命中优先（`depth: 'atoms'` 的层只有不被原子挡住时才算命中），其余按射线距离取最近，标记与原子相差 ≤ 0.05 Å 时标记优先；层可声明 `pickIn`（在哪些工具下可拾取）。 | 简报 §4；位点标记紧贴原子；显示位点时 Select 工具仍要能点中表面原子（D11）。 |
| A-D9 | 工具注册表 `render/tools/index.js`；工具钩子采用**延迟认领**：`down()` 认领后，指针移动超过点击阈值才调用 `begin()` 开始拖动；没有移动就按普通点击处理（选择、Shift 加选、双击选分子照旧）。右键旋转、中键/Alt 平移、滚轮与双键缩放、R+拖动缩放框在所有工具里不变。 | v1 的接缝会吞掉被认领按下的点击、双击和多选（E5）；"双击 CO 选中分子再拖动"必须可用。 |
| A-D10 | `viewer.viewAlong(target)`：支持 `[x,y,z]`、`{uvw}`、`{uvtw}`、`{hkl}`、`{hkil}`、`'normal'`、`'-normal'` 和原来的 `'a'…'-z'`；结构有表面且是侧视时，屏幕"上"取表面法向（顶面朝上）；俯视/仰视时"右" = 第一根面内晶轴（标准取向即 a）。**N = 沿法向俯视顶面，Shift+N = 看底面**；方向标签按法向来源给出（体相显示 "along c* (normal to a and b)"）。 | 简报 §4 预留 N；v1 的侧视有一半方向把 slab 画倒（D8）；体相按 N 时不能说"表面法向"（D13）。 |
| A-D11 | 参数 schema 新增 `vector`、`miller`、`imatrix`，`int`/`float` 增加 `unit`、`required`（必填、初始为空，U4）。解析、校验与英文报错文案在 JS（`core/params.js`）和 Python（`facet/core/params.py`）中逐字相同；`coerceParam` 只接受 JSON 类型，CLI 先把字符串转成 JSON 值；REST 插件端点按插件声明的 schema 规范化参数。 | 简报 §4"与 Python/CLI 同步"；字符串语义与三种入口要一致（E18、E25）。 |
| A-D12 | 命令新增 `params`（在 `register` 的包装函数里校验，任何调用路径都经过）、`aliases`（MS 名称）、`estimate`（预估原子数，超过上限拒绝）、`edits`（自动加编辑守卫）。 | 嵌入页能带任意参数调用任何命令（`api/embed.js:21, 82-90`）；`commands.get(id).run(params)` 原来绕过校验（E26）。 |
| A-D13 | Surface 面板和 Structure 面板的新分区通过 `registerPanelSection(panelId, section)` 由各模块填充，**每个分区渲染在自己的容器里、按自己的签名单独重绘**；面板不按 slab/非 slab 改变行为（U1）；选区动作通过 `registerSelectionAction()` 加入。 | 各模块并行开发互不改同一文件；整面板重绘会丢掉正在预览的分区里的控件状态（E27）。 |
| A-D14 | **U1 显示规则 v2**：沿每根有真空的周期轴，在"主块（原子最多的一块）正下方"的空隙中点切开（小于主块一半原子数的漂浮块并入真空），绘制窗口取"相对 [0, 1) 包裹移动原子最少"的一侧，该轴不复制边界原子。"有真空"指切口所在真空区的空隙总宽 ≥ 5 Å（结构的 `info.surface.axis` 指向该轴时 ≥ 2 Å）。切口函数 `gapCut` 两种语言同一算法，显示、`surfaceNormal`、M3 的层、M5 的位点共用。 | v1 规则在分子越过真空中点时把整块 slab 画到晶胞外、把分子翻到 slab 下方（D2）；单层 pbc T T T 的石墨烯会被画到晶胞顶面（本次核对新发现，§3.8.2 表）；v2 在全部场景中 slab 主体留在晶胞轮廓内，脱附轨迹中 slab 0 次跳动；上层原子更多的异质结也不会被拆开。 |
| A-D15 | **测量引用改为"源原子 + 相对存储坐标的整数像"**，首个原子的像归一为 0；数值用 Float64 存储坐标计算；旧项目的测量在加载时迁移；画线时在绘制副本中找一组完全对应的位置，找不到就按首个原子的家副本平移后画。 | U1 改变了包裹规则，旧键相对"包裹后的家"，31% 的近邻测量在 U1 下找不到副本而静默消失（D1、E9，`measref.mjs`）；新定义与包裹规则无关，M4 不再需要 `wrapHome`。 |
| A-D16 | **`surfaceNormal` 以真空间隙为准**：`info.surface.axis` 只作为经过校验的提示（该轴必须仍是最宽的真空），不读笛卡尔 `info.surface.normal`；顶面 = +a_k 一侧（与 pymatgen 一致）；返回 `surface: boolean` 与 `source`。 | 存储的笛卡尔法向在转动、重定义晶格、轴置换后失效，会让 M3/M5 固定错层、放错面（D3、E3）。 |
| A-D17 | 与 F0-D 的接口写成一张**联合接口表**（§10.1，已对齐同期定稿的 F0-D v2），与 M1–M6 的需求写成**消费方对照表**（§10.0，M4 一栏按 M4 v2），逐行写明采纳、改名（谁改）或拒绝。 | 两份审查的两个阻断项（E1、E2）都是接口没对上。 |
| A-D18 | 悬停卡与选区卡显示**已提交结构的 Float64 存储坐标**；绘制副本与存储位置差一个格矢时另起一行注明像。 | U1 之后绘制坐标与 CONTCAR 对不上（E10）；P5。 |
| A-D19 | 吸附物（`props.adsorbate_id > 0`）按组包裹：同一吸附物的原子用组内第一个原子的整数偏移，整体画在一起、不复制边界原子（应该）。 | 面内靠近晶胞面的 CO、甲酸根会被画成两半（领域审查"缺失内容"1）。 |
| A-D20 | 定义里程碑 **F0-A-core**（第 1 波开工条件，§9），其余任务与第 1 波并行。 | 必须项合计约 33 个代理日，不能让 M1/M2/M3 等全部完成（E15）。 |

---

## 1. 用户故事与 Materials Studio 对照

### 1.1 用户故事（每条都在 §7 有对应测试）

- **US1 拖动一步撤销。** 在 Pt(111) p(3×3) 4 层 slab 上，Move 工具（M4）下双击 top 位的 CO 选中整个分子，再把它拖到 fcc 空位：拖动中视图、选区光环、
  测量线和数值实时跟随；超出成键判据的旧键隐藏（不再拉成横跨拖动距离的长棍），≤ 200 个移动原子时新形成的三根 C–Pt 键实时出现（B9）；
  松开后历史里只有一步 "Move 2 atoms"；按 Esc 或切走窗口则恢复原位，历史和"未保存"状态都不变。
- **US2 切面不丢体相。** 打开应用（未改动的钙钛矿示例）后直接对它切 SrTiO3(001)：项目里同时保留体相与新 slab（现在体相会被整个项目替换掉）。
- **US3 原位操作的预览。** 在 Surface › Slab 把 Pt(111) slab 的真空从 15 Å 改为 25 Å（M2 的 Set vacuum，原子笛卡尔坐标不变）：视图实时显示新晶胞，面板里 Apply/Cancel；
  预览期间关闭面板，视图顶部的预览条仍可 Apply/Cancel；预览期间自动保存触发也不会把预览写进项目；点击、框选、右键都不会作用到预览结构的原子上。
- **US4 吸附物幽灵。** 在 Adsorbates 分区选 CO、启用 Pick site 工具（M5）：鼠标悬停在 hcp 位点上时出现半透明 CO 幽灵（普通叠加层，不开会话）；
  点击即放置（一步撤销）；需要先调高度、取向时，点击开启 P-ghost 会话，预览条给出 Apply/Cancel。
- **US5 大体系。** 10k 原子 slab 上连续做 50 次固定/移动编辑：每次 ≤ 60 ms，历史占用 ≤ 64 MiB；移动 1 000 个原子时每次预览更新 ≤ 3 ms（CPU 部分）；
  Pt(111) p(6×6) 6 层（216 原子）上一切操作无可感知延迟。
- **US6 看表面。** 按 N 俯视表面且 a 从左到右；Shift+N 看底面（检查固定层）；对从 VASP CONTCAR 导入的 slab（pbc T T T、c 倾斜、底层在分数 z = 0）也给出正确法向（a×b 而不是 c）；
  沿 [1 0 0]、[1 1̄ 0]、[2 1 0] 等侧视时顶面总在上方。对体相按 N 时标签为 "along c* (normal to a and b)"，并提示没有真空间隙。
- **US7 MS 名称。** 在命令面板输入 "Cleave Surface"、"Redefine Lattice"、"Build Vacuum Slab"、"Modify Constraints" 能找到对应命令，并看到匹配的 MS 名称。
- **US8 嵌入页。** 父页面 `postMessage({type:'facet:call', method:'command', args:['surface.cleave', {hkl:[1,1,1], layers:'4'}]})`
  得到可读的错误 `Cleave surface: Layers: enter a whole number.`（命令标题去掉结尾的省略号），而不是 TypeError 或静默失败。
- **US9 四指数。** 体相是 ZnO 纤锌矿时 Miller 控件自动显示 (h k i l)；输入 (1 0 1̄ 0) 存为 (1 0 0)；输入 (1 0 0 0) 时提示 `i must be −(h + k) = -1`；
  粘贴应用自己显示的 "(1 0 1̄ 0)"（带上划线）或 "1 0 −1 0"（U+2212）也能识别。
- **US10 只看上两层。** Layers 分区（M3）选择"只显示顶部 2 层"后，下面的原子不绘制、不能被点选或框选；Ctrl+A 只选可见原子；
  状态栏显示 "216 hidden · Show all"；选区里含隐藏原子时选区卡片显示 "(9 hidden)"，删除前确认。
- **US11 导入的 slab 画得对（U1）。** 打开 VASP CONTCAR（pbc T T T，底层在分数 z = 0，c = 15.6 Å）：底层不再在真空顶部多画一份；
  一个原子层跨过 c = 0 边界的 slab 画成连续的一块；从 C2DB/Materials Cloud 下载的单层 MoS2 或石墨烯 POSCAR（pbc T T T，层在 z = 0）仍画在 z = 0（v1 规则会画到晶胞顶面）；
  用户没有看到任何提示，pbc 和导出的文件都不变。
- **US12 旧项目的测量不丢（新）。** 打开 v0.3.1 保存的项目：其中一个跨 c 边界的 slab 上存着底层 Pt–Pt 与底层–次层的距离测量（用到了远面副本和补全配位的像）：
  打开后两条测量都在、数值不变、线画在对应的原子之间。
- **US13 真空中的分子（新）。** 打开一组 CO 从 Pt(111) 顶位脱附的 NEB 图像（15 Å 真空）逐帧播放：slab 始终画在晶胞轮廓内；CO 一直画在 slab 上方，
  直到它离下一个周期像的底面不足 3.5 Å 才画到像的下方（物理上已贴着像的底面）；10 Å 真空、CO 离顶面 4 Å 时仍能识别真空、正确显示。
- **US14 原胞上的指数（新）。** 打开 Materials Project 的 Pt 原胞 POSCAR（a = b = c = 2.772 Å，α = β = γ = 60°），在 Cleave 的 Miller 控件输入 (1 0 0)：
  读数行写 "(1 0 0) of the current cell"，并提示 `This is a primitive cell: (1 0 0) here is the conventional (1̄ 1 1) plane.`。

### 1.2 与 Materials Studio 的对照

| 方面 | Materials Studio | Facet（本规格） | 不同之处与理由 |
|---|---|---|---|
| 工具窗口 | 非模态对话框；Cleave Surface 点 Cleave 后不关闭，源晶体 3D 视图里画蓝色虚线框作预览（06 §2.2 [V]） | 侧边面板分区 + 实时预览 + 明确的 Create/Apply/Cancel；视图顶部有预览条 | 网页里浮动对话框会和侧面板、手机底部抽屉冲突；预览条保证面板被关掉时仍能确认或取消 |
| 切面结果 | 新文档 `<source>(h k l).xsd`（[V]） | 新结构加入同一项目，体相保留 | 简报 P4；项目相当于 MS 的文档集合 |
| 撤销 | Edit › Undo，每个操作一步（[GK]） | 每个编辑一步；预览不进历史；拖动从按下到松开一步；toast 的 Undo 只撤销自己那一步 | 简报 P3 |
| 鼠标模式 | Sketch 工具栏切换模式；选中分子用 Shift+Alt+右键拖动平移（06 §9.2 [V]） | 工具注册表 + 工具栏按钮（Select V、Measure M、Move G）；Move 工具用左键拖动选中原子，点击仍是选择；右键始终旋转 | 左键拖动更符合网页习惯；右键旋转在所有工具中保留，与 MS 的旋转习惯一致 |
| 改几何时的测量 | 监视器在操作中实时更新（DS-VIS [V]） | P-pos 快速路径让测量线和数值在拖动中实时更新；测量值用 Float64 存储坐标 | 相同 |
| 观察方向 | a/b/c 视图（[GK]）；没有"沿表面法向"的一键操作（未查到） | `viewAlong`：[uvw]、(hkl)、(h k i l)、表面法向；N / Shift+N；侧视时顶面朝上 | 表面工作流里最常用的视角 |
| 约束显示 | Display Style › Color by: Constraint，红/灰（[V]） | `setHighlight` 的双色光环（颜色由 M3 定，不随主题换色）+ 配色方案上下文（M3 可做 Color by constraint）；默认不进 PNG，可勾选 | 不覆盖用户的配色方案；双色边对任何元素色都有亮度对比 |
| 显示范围 | Lattice 显示范围，可非整数（[V]） | 现有的显示超胞 + 新的逐原子可见性掩码（如只看顶部两层） | MS 没有按层隐藏 |
| 命令发现 | 菜单路径 | 命令面板 + MS 别名 | MS 用户可直接搜 MS 的名称 |
| 六方指数 | 只输入三指数（06 §2.4 [I]） | 六方晶胞下 Miller 控件自动显示 (h k i l)；读数行注明"相对当前晶胞"，原胞时提示惯用胞指数 | 文献中纤锌矿、hcp 金属常用四指数；MP 下载的多是原胞 |

---

## 2. 功能清单

编号 `A1…` 在 §9 开发拆分和 §7 测试里引用。v2 新增的项标"（新）"，改动较大的标"（改）"。

### 2.1 必须

| 编号 | 功能 | 行为细节与默认值 |
|---|---|---|
| A1 | `app.editActive(label, fn, opts)`（改） | 原位编辑当前结构，一步撤销；`fn(s)` 同步执行、原地修改；可给 `indexMap`（旧→新）或 `src`（新→旧）；都没给时用 F0-D 的 `trackChanges()` 自动求映射；`rebuild: 'full' \| 'appearance' \| 'none'`（默认 `'full'`）；`refit`（默认 `true`）；`latticeChanged`；`imageShift(oldIndex) → [ka, kb, kc]`（存储坐标被整数格矢平移的编辑用，§3.9）；`singleFrame`（默认 `false`；为真时先只保留当前帧，C11）；`snapshot: 'full' \| {positions}`；`toast`（带绑定 Undo 的提示）；`cameraTransform`。返回 `EditResult = {entry, value, map}`；`fn` 返回 `{select: [...]}` 时提交后把选区设为它。`fn` 抛错或视图重建失败则完全回滚、不留历史。§3.2 |
| A2 | `app.addStructure(s, {replaceProject})` | `'auto'`（默认，现有行为）、`true`、`false`（总是加入当前项目，一步撤销）；`label`、`activate`（默认 `true`）、`name`；`newProject: true` 等价于 `replaceProject: true`。返回 `{entry, historyEntry}`。§3.3 |
| A3 | `app.toastUndo(msg, opts)`、`app.undoEntry(entry)`、`app.lastEdit`（改） | toast 的 Undo 绑定到产生它的那条历史；可附加其他动作（`actions: [{label, run}]`，如 M4 的 "Open as new structure"）；异步调用点必须显式传 `entry`；清空历史、切换项目时 `lastEdit` 复位。§3.4 |
| A4 | `Structure.rev` 进入 `structureKey` | F0-D 保证每个修改方法调用 `touch()` 递增 `rev`；`structureKey(app)` 加 `:${rev}`；脚本直接改 props 后调用 `facet.edit.touch()`。§3.5 |
| A5 | 撤销存储 v2（改） | 只快照被改动的结构条目；二进制快照；P-pos 提交只存移动原子的旧/新坐标；总字节预算 64 MiB（窄屏或 `navigator.deviceMemory ≤ 4` 时 24 MiB）+ 最多 80 步；整数打包范围检查；`replaceTop/popTop`（View 合并）、`detach/attach`（项目切换与回退）。§3.1 |
| A6 | `app.beginStructureEdit(label, opts)` 预览会话（改） | 三种 `kind`：`'positions'`、`'structure'`、`'ghost'`；`preview()`、`commit()`、`cancel()`；`transient`（工具拖动用，不显示预览条）；`singleFrame`（P-pos 默认 `true`）；P-swap 的 `preview(s, {sameAtoms, src, indexMap, latticeChanged})` 在 `commit()` 时沿用最后一次的选项；预览期间不写历史、不标记未保存、不自动保存、不重新取景、不更新缩略图、暂停轨迹播放。§3.6 |
| A7 | 视图预览 API（改） | `viewer.previewPositions()`（只写受影响的实例，换集合时先复原）、`viewer.previewStructure()`（完整暂存已提交的绘制对象）、`viewer.previewGhost()`、`viewer.endPreview()`；P-swap 输入锁；预览更新按 rAF 合并。§3.7 |
| A8 | 取消自动重新取景 | `setStructure(s, {resetCamera, refit})`；预览一律不取景；P-pos 提交不取景；`editActive({cameraTransform})` 让相机随刚性重定向一起转动。§3.7.4 |
| A9 | 叠加层 A/B/C 与导出策略（改） | `viewer.overlays.add(layer)`；`tier: 'scene' \| 'top' \| 'canvas' \| 'dom' \| 'legend'`、`export: 'never' \| 'marker' \| 'always'`、`pick`、`pickIn`、`onModel`、`beforeRender`、`bounds`；光环隐藏集合；`screenshot({selection, markers})`、`thumbnail()`；导出菜单两个勾选项。§3.11 |
| A10 | 合并拾取与射线工具 | `pick(x, y)`、`pickAtomHit`、`ray`、`pointOnPlane`、`pointOnLine`、`worldPerPixel`；叠加层事件 `overlayhover`、`overlayclick`、`overlaydblclick`、`overlaycontext`（新）。§3.12 |
| A11 | 工具注册表与指针钩子（改） | `tools.register({id, …, handler})`；延迟认领（`down` → `begin` → `move` → `up`，未移动 = 点击）；触摸由 `claims(hit)` 认领；`selects` 决定点击/框选是否仍选择原子；`keydown` 钩子；`cancelToolPress(reason)`；提示栏、HUD、工具栏按钮和快捷键对话框的鼠标行由注册表生成。§3.13 |
| A12 | 逐原子可见性掩码（改） | `buildDisplayModel(s, display, {visible})`；`viewer.setVisibility(name, spec)`；被隐藏的原子不绘制、不能被拾取或框选；有掩码时 Select all / Invert selection 只作用于可见原子；选区卡片显示隐藏数；删除或替换含隐藏原子时确认；状态栏 "N hidden · Show all"。§3.8.1、§5.4 |
| A13 | 命名高亮 `viewer.setHighlight(name, indices, opts)`（改） | 每个名字一个光环种类；`color` 接受颜色串、`{light, dark}` 或 `'var(--token)'`（主题变化时重新解析，不被主题强调色覆盖）；`opacity`；双色边（深色内线 + 彩色外圈）默认开；按 `grow` 由小到大绘制；固定原子用什么名字、什么颜色由 M3 决定。§3.10 |
| A14 | 沿任意方向观察（改） | `viewer.viewAlong(target, opts)`；侧视顶面朝上；命令 `view.normal`（N）、`view.normalBelow`（Shift+N）、`view.along`；按法向来源的方向标签。§3.14.1 |
| A15 | 输入控件 `ui/inputs.js`（改） | `numberInput`（`required`：初始为空，U4）、`vec3Input`（笛卡尔/分数切换；`size: 2` 的二维矢量）、`millerInput`（六方自动 hkil；读数行注明相对当前晶胞、公因子、原胞提示）、`imatrixInput`（2×2/3×3、行列式、预设可为函数、`warn` 钩子）；`setInvalid()`；全局 `aria-invalid` 样式；数字框屏蔽滚轮改值。§5.6 |
| A16 | 参数 schema 新类型（改） | `vector`、`miller`、`imatrix`、`unit`、`required`；`paramForm` 渲染与 `valid`；JS `core/params.js` 与 Python `core/params.py` 同一套解析与文案；CLI 先转成 JSON 值再校验；REST 插件端点按 schema 规范化（失败 422）。§3.15 |
| A17 | 命令扩展（改） | `params`、`aliases`、`estimate`、`edits`、`ms`；校验放在 `register` 的包装函数里；"打开分区"的回退实现不覆盖已注册的真实实现；Esc 在会话中取消预览；`edit.applyPreview` 快捷键 `mod+Enter`。§3.16 |
| A18 | Surface 面板外壳（改） | 左侧第 5 个面板（Shift+5）；分区 Cleave / Slab / Layers / Adsorbates（M6 加 Interface）由模块注册、总是显示（U1）；分区各自渲染、各自重绘；无结构时的整面板空状态；就地说明带实测数值（"The widest empty layer along c is 4.4 Å…"）。§3.17、§5.2 |
| A19 | Structure 面板分区插槽 | 摘要之后的 `cell` 插槽（M1）、选区之后的 `transform` 插槽（M4）。§5.3 |
| A20 | 选区动作注册（改） | `registerSelectionAction({id, label, short, icon, tip, when, run, order, card, menu})`；桌面最多显示 7 个、窄屏 5 个，其余进 "More"；顺序号是契约（Fix/Free 排在 Replace 之前）。§5.4 |
| A21 | 命令表 | §5.8 列出的全部新命令；F0-A 注册 `panel.surface`、`view.*`、`edit.*Preview` 与"打开分区"的回退实现。 |
| A22 | JS 公共 API（改） | `facet.edit.{run, begin, touch, session}`、`view(target)` 扩展、`viewAlong`、`highlight`、`setVisibility`、`tools.{list, get, set}`、`registerPanelSection`、`registerSelectionAction`、`EVENTS` 新事件（`preview`、`overlayhover`、`overlayclick`、`visibility`）。§6.2 |
| A23 | 真空间隙显示规则 v2（改，U1） | `buildDisplayModel` 对每根周期轴调用 `gapCut`（F0-D 的 `core/vacuum.js`，算法见 §3.8.2），沿有切口的轴用 `unwrapAlongGap` 包裹、不复制边界原子；切口结果按"结构对象 + rev + 帧"缓存；P-pos 预览中不重算；`estimateDisplayCount` 用同一缓存。 |
| A24 | 测量引用 v2（新） | 测量记录 `{type, refs}`，`refs` 为 `"i:a,b,c"`（相对存储坐标的像，首个为 0）；数值用 Float64；旧 `keys` 在加载时迁移；画线时先找完全对应的绘制副本，找不到按首个原子的家副本平移；`model.home`、`storedImage(model, d)`、`refOf(model, d)` 导出给 M4。§3.9 |
| A25 | `surfaceNormal` v2（新） | 间隙优先，`info.surface.axis` 只作校验过的提示；顶面 = +a_k 一侧；返回 `{normal, axis, source, surface, vacuumAxes, cut}`；JS 在 `core/vacuum.js`（`core/lattice.js` 重新导出），Python 在 `facet/analysis/vacuum.py`。§3.14.2 |
| A26 | 悬停卡与选区卡的存储坐标（新） | `viewer.atomInfo(d)` 返回存储坐标（Float64）、存储分数坐标与绘制副本的像；卡片按它显示，P-pos 预览中显示预览坐标。§3.12.3 |
| A27 | 会话与其他入口（新） | 会话期间：轨迹播放暂停、`traj.*` 不可用；`projectToJSON` 沿用旧缩略图；`facet.screenshot()` 与嵌入页截图报 `Apply or cancel the preview first.`；导出菜单项禁用。§3.6.3 |
| A28 | 与 F0-D 的联合接口（新） | §10.1 的表：版本号、`trackChanges`、`setPositions`、`keepFrame`、`core/vacuum.js` 的四个函数、`SURFACE_DEFAULTS` 键名、`core/lattice.js` 归属与合并顺序、撤掉导入时的 slab 识别（U1）。 |

### 2.2 应该

| 编号 | 功能 | 细节 |
|---|---|---|
| B1 | B 层深度预通道 | 层设 `depth: 'atoms'` 时，先把 `this.rep` 以 `colorWrite: false` 的覆盖材质写入默认帧缓冲深度，再画 B 层，使被原子挡住的标记不显示（拾取同样遵守，§3.12）。只有可见层需要时才做。 |
| B2 | 选区卡片实时坐标 | P-pos 预览中，选区卡片的 xyz/frac 每帧（rAF 节流）更新为预览坐标；动作按钮在会话中禁用。 |
| B3 | 减少动态效果 | `prefers-reduced-motion: reduce` 时 `viewAlong`/`setView`/`resetView` 不做 420 ms 相机动画。 |
| B4 | "Look along…" 对话框 | 输入 `[1 1 0]`、`(1 1 1)`、`(1 0 -1 0)`、`1 1 0`；实时显示解释（"the direction [1 1 0] of the current cell" / "the normal of the plane (1 1 1)"）；无效时内联报错。 |
| B5 | 命令面板显示匹配的别名 | 查询命中别名而不是标题时，结果行后附灰色的别名。 |
| B6 | 叠加层辅助构件 | `markerLayer`、`planeLayer`（多个多边形，各自颜色与虚线，`set()` 更新）、`cellOutlineLayer`、`ghostLayer`、`textLayer`（§3.11.4）。 |
| B7 | `drawnCopies(points, model, {repeat})` | 把结构坐标中的点按与原子相同的规则（含 U1 切口与边界副本）包裹并在显示超胞中重复。 |
| B8 | 历史容量提示 | 第一次因字节预算丢弃历史时提示一次 "Undo keeps fewer steps for a structure this large."。 |
| B9 | P-pos 局部重搜键（新） | 会话开始时对绘制原子建整数网格；每次更新只为移动原子按 `findBonds` 的同一判据找新键，画进单独的 `preview-bonds` 实例网格；≤ 200 个移动原子时开启。必须项里的"隐藏被拉长的键"在任何规模下都做。§3.7.1 |
| B10 | 吸附物按组包裹（新，A-D19） | `props.adsorbate_id > 0` 的原子按组用第一个原子的整数偏移，整体画在一起、不复制边界原子。§3.8.3 |
| B11 | 表面坐标系输入（新） | `vec3Input({frames: ['cartesian', 'fractional', 'surface']})`：`surface` 为（面内分数 u、v，沿法向的高度 h Å），只用于位移矢量，`cart = u·a_i + v·a_j + h·n̂`（n̂ 来自 `surfaceNormal`）；c 倾斜的 CONTCAR 上放置与平移最自然。 |
| B12 | 原子信息扩展点（新） | `registerAtomInfo(fn(app, srcIndex) → [{label, value}] \| null)`：悬停卡与选区卡（单原子）追加行，M3 填"第几层（从顶数）、离顶层平均面的 Δz、SD 标志"，M5 填 `adsorbate_id`。 |
| B13 | 配色方案上下文（新） | `computeColors` 的 `ctx` 加只读 `structure`、`scene`；方案可声明 `dependsOn: ['display.layers', …]`，这些路径的值进入 `applySettings` 的 `colors` 签名（`viewer.js:600`）；方案可返回分类图例 `{kind: 'categories', items: [{label, color}]}`。供 M3 做 MS 的 Color by: Constraint。 |
| B14 | "Property" 配色的默认属性（新，F0-D 请求） | 未指定属性时跳过 `tags`、`adsorbate_id`（`render/colors.js:205` 现在取第一个数值 prop，切面后会变成 `tags`）。 |
| B15 | 原胞指数提示（新） | `centeredCellHint(cell)`：晶胞度量为 fcc（a = b = c、α = β = γ = 60°）或 bcc（109.47°）原胞时返回已知的整数矩阵，`millerInput` 读数行给出等价的惯用胞指数；一般情形由 M1 的 `millerBasisNote` 经 `describe` 提供。§3.14.4 |
| B16 | 进度 API（新，M6 请求） | `app.startTask(label) → {set(label \| fraction), end()}`，委托现有 `_busyStart`（`app.js:1269-1278`），`set(0.42)` 显示为 `<label> 42%`。 |

### 2.3 可选

| 编号 | 功能 | 细节 |
|---|---|---|
| C1 | 着色型高亮 `style: 'tint'` | 不画光环，而是改实例颜色，用于"按层着色"；Color by constraint 的标准做法改由 B13 的配色方案实现。 |
| C2 | 触屏长按 | 长按原子打开原子菜单；长按位点标记发 `overlaycontext`（M5 请求，500 ms）。 |
| C3 | 轨迹播放走位置快速路径 | 帧之间原子数和顺序不变时，用 P-pos 的写法代替完整重建（报告 03 §7.4）。 |
| C4 | 插件工具 | `facet.registerTool(t)` 走 `registerIn('tools', …)`，与其他注册表一样可撤销注册。内置模块（M4、M5）用内部的 `tools.register`，不依赖它。 |
| C5 | slab 上用体相指数观察 | M2 在 `info.surface` 里记录体相 → slab 的整数变换后，`viewAlong` 接受 `{uvw, basis: 'bulk'}`。 |
| C6 | 浮动卡片助手（M3 请求） | `shell.floatingCard({id, title, render, onClose, anchor, draggable})`，手机上变为无遮罩的底部 sheet；M3 的 Atom Selection 可以先自己实现。 |

---

## 3. 算法

### 3.1 撤销存储 v2（`core/history.js`，App 委托）

**现状**（`app.js:483-628`）：每一个结构步骤都把**项目里所有结构**按 8 位小数序列化成一个 JSON 字符串（`_structuresSnapshot` 571-577），
`after` 在撤销时再算一次（605），上限 80 步（527）。撤销时 `_restoreStructures`（586-595）用 `Structure.fromJSON` 重建**每一个**结构对象，
于是所有结构的分析缓存（按对象序号 `serialOf` 分）都失效。撤销栈还在别处被直接读写（见下文"迁移清单"）。

**实测**（`undo_cost.mjs`，node 22，一个 3 原子体相 + 一个 fcc(111) slab，slab 带 `selective_dynamics`、`tags`、`info.surface`；大小只取决于原子数与 props，
与夹具的堆垛错误无关，D17）：

| slab 原子数 | JSON 快照大小 | 快照耗时 | 恢复耗时 | 80 步（UTF-16 估算） | 二进制快照大小 | 快照耗时 | 恢复耗时 | 80 步 |
|---|---|---|---|---|---|---|---|---|
| 36 | 3 KB | 0.06 ms | 0.07 ms | 0.4 MB | 1 KB | 0.01 ms | 0.22 ms | 0.1 MB |
| 216 | 13 KB | 0.5 ms | 0.21 ms | 2.1 MB | 8 KB | 0.02 ms | 0.22 ms | 0.7 MB |
| 10 086 | 604 KB | 10.3 ms | 5.4 ms | 94 MB | 384 KB | 0.9 ms | 3.2 ms | 30 MB |
| 99 846 | 6 105 KB | 116 ms | 94 ms | 954 MB | 3 803 KB | 3.4 ms | 57 ms | 297 MB |

拖动 3 个原子的位置增量是 156 字节。二进制快照往返后 `toJSON()` 与原结构逐字节相同（脚本内断言）。
**结论**：修复由四部分组成，缺一不可：**只快照被改动的条目**、**二进制快照**、**字节预算**、P-pos 提交用**位置增量**。

**数据结构**：

```js
// core/history.js（纯模块，node 可测）
export const HISTORY_DEFAULTS = Object.freeze({ maxSteps: 80, maxBytes: 64 * 2 ** 20, maxBytesSmall: 24 * 2 ** 20 });
StructSnap = { name, symbols: string[], positions: Float64Array /* _base */, frames: [{ positions: Float64Array, cell }],
               frame, cell: number[][] | null, pbc: boolean[], props: PackedProps, info: string /* JSON */, rev }
PackedProps = { [key]: { t: 'sd',  u: Uint8Array(3n) }     // 每个条目都是长度 3 的布尔数组时
                     | { t: 'i32', a: Int32Array }       // 每个值都满足 Number.isInteger(v) && -2**31 <= v && v < 2**31
                     | { t: 'f64', a: Float64Array }     // 每个值都是有限数（2^53 以内的整数也精确）
                     | { t: 'json', s: string } }        // 其他一切（null 混入、长度不符、嵌套值、越界整数……）
EntrySnap   = { full: StructSnap, meas: MeasurementRecord[] }                       // meas 用 §3.9 的 refs 形式
            | { positions: { frame, indices: Int32Array | null, values: Float64Array }, meas: MeasurementRecord[] }
ProjectSnap = { v: 2, active: id, order: id[], names: { [id]: string }, entries: { [id]: EntrySnap } }
HistoryEntry = { id /* 单调递增 */, kind: 'scene' | 'structure' | 'both', label,
                 before?, after?, sceneBefore?, sceneAfter?, snap?: { before: ProjectSnap, after: ProjectSnap | null }, selBefore, selAfter, bytes }
```

位置快照也保存 `meas`：位置编辑可能带 `imageShift` 改写测量（§3.9），撤销时要能还原。

**`HistoryStore` 接口**：

```js
class HistoryStore {
  constructor({ maxSteps, maxBytes });
  record(e);            // 推入撤销栈、清空重做栈、按预算淘汰；设 lastRecorded = {entry: e, label, at}
  popUndo(); pushRedo(e); popRedo(); pushUndo(e);
  top();                // 撤销栈顶
  replaceTop(e);        // View 合并：改写栈顶条目并重算字节（app.js:560-566 现在直接改 top.after）
  popTop();             // View 合并后与 before 相同时删掉栈顶（app.js:563）
  has(e) → 'undo' | 'redo' | null;
  detach() → state;     // 把整个状态（两个栈、字节数、lastRecorded）拿走，自身变空
  attach(state);        // 换回（项目切换失败、打开示例的回退）
  clear();              // 两个栈清空，lastRecorded = null
  get bytes(); get lastRecorded();
}
```

导出函数：`snapStructure(s, how)`、`structureFromSnap(snap)`、`applyPositionsSnap(s, ps)`、`patchPositions(full, ps)`、`snapBytes(x)`、`packProps(props, n)`、`unpackProps(p, n)`。

**App 中的改动**（`app.js`）：

```js
_snapBegin() {                       // 项目布局，不含任何结构
  const p = this.project;
  return { v: 2, active: p.activeStructure, order: p.structures.map((e) => e.id),
           names: Object.fromEntries(p.structures.map((e) => [e.id, e.name])), entries: Object.create(null) };
}
_snapTouch(snap, id, how = 'full') {  // 第一次碰到某条目时记下它"改动前"的样子
  const e = this.project.structures.find((x) => x.id === id);
  if (!e) return;
  const has = snap.entries[id], meas = this._measOf(e);
  if (!has) {
    snap.entries[id] = how === 'full' || e.structure.nFrames > 1   // 多帧结构一律完整快照
      ? { full: snapStructure(e.structure), meas }
      : { positions: snapPositions(e.structure, how.positions), meas };
  } else if (has.positions && how === 'full') {
    // 同一事务里先改了位置、再做别的：完整快照当前状态，再把原来的位置补回去 = 改动前的状态
    const full = snapStructure(e.structure);
    patchPositions(full, has.positions);
    snap.entries[id] = { full, meas: has.meas };
  }
}
_pushStructureHistory(label = 'Edit structure', touch = { id: this.project.activeStructure, how: 'full' }) {
  this._endSessionFor('edit');                 // §3.6：取消预览（会话自己提交时除外）
  this._commitScene.flush();
  if (this._tx) {
    this._tx.snap ??= this._snapBegin();
    this._tx.selBefore ??= this.selection;
    if (touch?.id) this._snapTouch(this._tx.snap, touch.id, touch.how);
    return;
  }
  const snap = this._snapBegin();
  if (touch?.id) this._snapTouch(snap, touch.id, touch.how);
  this.history.record({ kind: 'structure', label, snap: { before: snap, after: null }, selBefore: this.selection });
  this.emit('history');
}
_snapAfter(before) {                    // 撤销时：同样这些条目"现在"的样子 + 之后新增的条目
  const after = this._snapBegin();
  for (const [id, es] of Object.entries(before.entries)) this._snapTouch(after, id, es.positions ? { positions: es.positions.indices } : 'full');
  for (const id of after.order) if (!before.order.includes(id)) this._snapTouch(after, id, 'full');
  return after;
}
_applySnap(snap, selection = null) {
  const live = new Map(this.project.structures.map((e) => [e.id, e]));
  const list = snap.order.map((id) => {
    const es = snap.entries[id], cur = live.get(id);
    if (es?.full) return { id, name: snap.names[id], structure: structureFromSnap(es.full), measurements: cleanMeasurements(es.meas, null) };
    if (!cur) throw new Error('Undo history is inconsistent.');
    if (es?.positions) { applyPositionsSnap(cur.structure, es.positions); cur.structure.touch(); cur.measurements = cleanMeasurements(es.meas, null); }
    return { ...cur, name: snap.names[id] };
  });
  this.project.structures = list;
  this._activate(snap.active, { resetCamera: false });
  const n = this.structure?.length ?? 0;
  this.viewer.setSelection((selection ?? []).filter((i) => i >= 0 && i < n));
  this.measurePicks = [];
  this.emit('selection'); this.emit('measure'); this.emit('project');
}
```

`undo()`/`redo()`（598-628）换成 `history.popUndo()`/`popRedo()`，结构部分用 `_snapAfter` 与 `_applySnap`，其余（场景部分、`markDirty`、事件）不变。
有预览会话时，`undo()` 与 `redo()` 只取消会话（toast `Preview cancelled`）并返回 null，不动历史（A-D2）。
`transaction()`（496-521）的回滚改用 `_applySnap(tx.snap, tx.selBefore)`；`finish` 里 `tx.before` 换成 `tx.snap`。
`addStructure` 的事务调用 `_pushStructureHistory(null, null)`（只记布局）；`removeStructure`（373-381）传 `{id: sid, how: 'full'}`。
**未改动的条目保持同一个 Structure 对象**，撤销一个结构的编辑不会让其他结构的分析缓存失效。

**迁移清单**（T1 必须全部改到；E12 核对过的直接读写撤销栈的位置）：

| 位置 | 现在 | 改为 |
|---|---|---|
| `app.js:131`、`134` | 构造 `undoStack`/`redoStack`、`_lastEntry` | `this.history = new HistoryStore(budget())` |
| `app.js:260`、`280`、`288` | `loadProjectJSON`/`_switchProject`/`_restorePrevious` 保存并换回两个栈 | `const prev = { …, history: this.history.detach() }`；失败时 `this.history.attach(prev.history)` |
| `app.js:340` | `addStructure` 替换分支的 `prev` | 同上 |
| `app.js:485-488` | `undoLabel/redoLabel/canUndo/canRedo` 读栈 | 读 `history.top()` 等，公共行为不变 |
| `app.js:523-529` | `_record` | `history.record(e)` |
| `app.js:560-566` | View 合并直接改栈顶或弹栈顶 | `history.replaceTop(e)` / `history.popTop()`（重算字节） |
| `app.js:711` | `replaceActiveStructure` 失败时弹栈顶 | 由事务回滚处理（§3.2），不再弹栈 |
| `app.js:837`、`851`、`857` | `_openSample` 清空、`_openSampleAsNew` 回退换回 | `history.clear()` / `detach()` / `attach()` |
| `main.js:56` | `app.undoStack = []` | `app.history.clear()` |
| `ui/shell.js:680-681` | 回退分支读 `app.undoStack.length` | 删掉回退分支，只用 `app.canUndo()` / `canRedo()` |

`undoStack`/`redoStack` 保留为只读 getter（返回数组副本）并在 `docs/PLUGINS.md` 标为废弃，供可能读取它们的插件过渡。

**字节预算**：条目字节 = `snapBytes(before) + snapBytes(after) + 场景 JSON 长度`。`record`/`pushRedo` 后若总字节 > 预算：
先从撤销栈底部丢，再从重做栈底部丢；**栈顶的撤销条目永远保留**；若仅它一个就超出预算，保留它并（只在本次会话第一次时）提示 B8 文案。
预算：`matchMedia('(max-width: 920px)').matches || (navigator.deviceMemory ?? 8) <= 4` 时 24 MiB，否则 64 MiB。

**复杂度**：快照 O(被改动条目的原子数)；恢复 O(被恢复条目的原子数) + 一次视图重建。

**边界情况**：多帧结构的 `positions` 快照自动升级为完整快照；`props` 中长度不等于原子数的数组按 `json` 原样保存；
`selective_dynamics` 有任何条目不是长度 3 的布尔数组时整键按 `json`；`tags` 里有 `3000000001` 或 `2**40` 时按 `f64`，有 `1.5` 或 `NaN` 时按 `json`（`pack_int.mjs` 的五个值往返不变）；
`cleanMeasurements` 照旧过滤无效测量（§3.9 的新格式）。

### 3.2 原位编辑 `editActive`

```js
editActive(label, fn, opts = {}) {
  const { indexMap = null, src = null, imageShift = null, rebuild = 'full', refit = true, latticeChanged = false,
          singleFrame = false, snapshot = 'full', toast: msg = null, cameraTransform = null } = opts;
  const e = this._activeEntry();
  if (!e) throw new Error('Load a structure first.');
  if (typeof fn !== 'function') throw new TypeError('editActive: fn must be a function.');
  const s = e.structure, n0 = s.length, frames0 = s.nFrames, frame0 = s.frame, selBefore = this.selection;
  const measBefore = this._viewerMeasurements().length;
  const digest0 = rebuild === 'appearance' ? structureDigest(s) : null;
  const warn0 = getWarnings(s.info).slice();                            // F0-D 的 getWarnings / newWarnings
  let value, map;
  this.transaction(label, () => {
    this._pushStructureHistory(label, { id: e.id, how: singleFrame && frames0 > 1 ? 'full' : snapshot });
    if (singleFrame && s.nFrames > 1) s.keepFrame();                   // C11（F0-D 提供 keepFrame）
    const tracker = indexMap || src ? null : s.trackChanges();          // F0-D：组合 fn 里发生的每一次 remap
    let tracked = null;
    try { value = fn(s, { app: this, entry: e }); } finally { tracked = tracker ? tracker.stop(s) : null; }
    if (value && typeof value.then === 'function') throw new Error('editActive: fn must not be async.');   // 事务回滚
    s.touch();                                                           // rev++（F0-D）
    map = resolveIndexMap({ indexMap, src: src ?? tracked, n0, n1: s.length, label });
    const mode = rebuild === 'appearance' && structureDigest(s) !== digest0 ? 'full' : rebuild;   // R6：常开核对
    if (mode !== rebuild) console.warn(`editActive “${label}”: rebuild 'appearance' changed positions, cell or elements; rebuilt in full.`);
    this._afterEdit(e, map, { rebuild: mode, refit, latticeChanged, imageShift, selBefore, cameraTransform, select: value?.select });
  });
  const entry = this._tx ? null : this.history.lastRecorded?.entry ?? null;   // 嵌套在外层事务里时，条目在外层结束时才产生
  this.markDirty();
  this.emit('structure');
  if (!sameList(selBefore, this.selection)) this.emit('selection');
  if (map.changed || latticeChanged || imageShift || this._viewerMeasurements().length !== measBefore) this.emit('measure');
  const dropped = s.nFrames < frames0 ? `Kept frame ${frame0 + 1} of ${frames0} and dropped the others.` : null;
  const notes = newWarnings(warn0, getWarnings(s.info));                // F0-D：只显示本步新增的备注
  if (msg || dropped || notes.length) this.toastUndo([msg, dropped, ...notes].filter(Boolean).join('. '), { entry });
  return { entry, value, map: map.map };
}
```

`resolveIndexMap({indexMap, src, n0, n1, label})` → `{map: Int32Array(n0), changed}`：
- 给了 `indexMap`（Int32Array/数组/函数）：逐项取值，`≥ n1` 或非整数一律 −1。
- 给了 `src`（长度 n1，`src[j]` = 新原子 j 来自的旧原子或 −1/null，C2-I3；含追踪器的结果）：用 F0-D 的 `invertSourceMap(src, n0)`（一个旧原子对应多个新原子时取第一个）。
- 都没有（追踪器不可用，即 F0-D 合入前）：`n1 === n0` 为恒等；`n1 > n0` 视为在末尾追加；`n1 < n0` 抛 `editActive “${label}”: atoms were removed, so pass indexMap or src.`（回滚）。
- `changed` = 不是恒等映射。

`_afterEdit(e, map, opts)`：
1. 新选区：`opts.select` 是数组时用它（过滤越界下标），否则 `selBefore.map((i) => map[i]).filter((j) => j >= 0)`；在重建前写入 `viewer.selection`（`model` 监听器会读它，报告 02 §9-2）。
2. `_remapMeasurements(map, { imageShift, latticeChanged })`（§3.9.4）；被丢的个数加进 toast（`1 measurement was removed.`）。
3. `viewer.remapIndexed(map, s.length)`：可见性掩码（新原子默认可见）、命名高亮按映射平移；重映射后不再隐藏任何原子的掩码被删除。
4. 重建：
   - `'full'`：`this._measGuard++; try { viewer.setStructure(s, { resetCamera: false, refit }) } finally { this._measGuard-- }`；
   - `'appearance'`：`viewer.refreshAppearance()`：样式有 `inPlaceColors` 时原地重写 `instanceColor`（`_computeColors` 后只写颜色，不新建网格），否则 `_buildRep()`；然后 `_writeHalos()`；**不做键搜索**。只允许原子数、坐标、晶胞、元素都不变的编辑（上面的摘要核对常开，不符时退回 `'full'`）。M3 的固定/放开原子用它；
   - `'none'`：只改 info 的编辑。
5. `cameraTransform`（3×3 旋转，行矢量约定 `r' = r @ Rᵀ`）存在时 `viewer.transformCamera(R)`。
6. `_showMeasurements(e)`；`viewer.setSelection(sel)`。

`replaceActiveStructure(newS, opts)`（687-719）改为同一套实现：`_pushStructureHistory(label, {id, how: 'full'})`、`resolveIndexMap`、`_afterEdit`，
另加 `refit`、`src`、`latticeChanged`、`imageShift` 选项，返回 `EditResult`；无活动条目时转 `addStructure`（不变）。
`deleteSelected`（651-667）改为
`editActive(\`Delete ${n} atoms\`, (s) => { s.deleteAtoms(sel); invalidateSymmetryInfo(s.info); }, { indexMap: map, toast: \`Deleted ${n} atoms\` })`；
`replaceSelected`（669-680）同样调用 `invalidateSymmetryInfo`（C7，E29），`rebuild: 'full'`，提示仍由调用者给（`toastUndo`，显式传 `entry`）。
删除原子在所有帧上删除（结构方法本来如此，各帧仍然一致），不属于 C11 要丢帧的情况；C11 针对新增原子、改晶格、移动原子等让其他帧失去意义的编辑，调用方传 `singleFrame: true`。

**失败语义**：`fn` 抛错 → 事务回滚（`_applySnap(tx.snap)`）→ 错误继续抛给调用者；视图重建抛错 → 同样回滚。两种情况都不留历史、不标记未保存。

### 3.3 新增结构 `addStructure`

```js
addStructure(structure, { look = null, scene = null, newProject = false, replaceProject = newProject ? true : 'auto',
                          name = null, label = null, activate = true } = {}) {
  this._endSessionFor('edit');
  const replace = replaceProject === true || (replaceProject === 'auto' && this.pristine);
  if (replace) { …现有 339-359 分支，history 改用 detach/attach（§3.1）… }
  let entry;
  this.transaction(label ?? `Add ${structure.name || name || 'structure'}`, () => {
    this._pushStructureHistory(null, null);           // 只记布局
    entry = this._newEntry(structure);
    if (name && !structure.name) structure.name = name;
    this.project.structures.push(entry);
    if (scene) deepMerge(this.scene, deepClone(scene));
    if (activate) this._activate(entry.id);
  });
  this.markDirty(); this.emit('project');
  return { entry, historyEntry: this._tx ? null : this.history.lastRecorded?.entry ?? null };
}
```

调用方：Structure 面板 Duplicate（`ui/panels/structure.js:185`）改为 `replaceProject: false`；切面（M2）、Build Layers（M6）、
"吸附后另存为新结构"（M5，D2 备选）、合并为新结构（M4）都用 `false`；`importFiles`、`loadSample`、Build 面板保持 `'auto'`。
项目未改动时用 `false` 加入，项目随之被标记为未保存，示例的外观（`_fromSample` 的场景）保留。
返回值从"条目"改为 `{entry, historyEntry}`：仓库里读返回值的调用点只有 Duplicate 与 `api/public.js` 的 `addStructure`，T2 一并改（公共 API 仍返回条目 id，见 §6.2）。

### 3.4 绑定到自己那一步的 Undo

```js
get lastEdit() { return this.history.lastRecorded; }            // {entry, label, at} | null；history.clear()/detach() 时复位
toastUndo(message, { entry, actions = [], timeout, type } = {}) {
  // entry 省略时取 lastEdit.entry —— 只在编辑完成后的同一个同步步骤里可靠；异步调用点（粘贴、导入、服务器回调）必须显式传
  const e = entry === undefined ? this.lastEdit?.entry ?? null : entry;
  const acts = [...(e ? [{ label: 'Undo', run: () => this.undoEntry(e) }] : []), ...actions];
  return toast(message, { timeout, type, actions: acts });     // ui/toast.js 支持多个动作（现在只有一个 action）
}
undoEntry(entry) {
  if (this.session) { this.session.cancel('undo'); }
  this._commitScene.flush();                                    // 之后的场景改动成为独立的一步
  const where = this.history.has(entry);
  if (where === 'undo' && this.history.top() === entry) return this.undo();
  if (where === 'redo') { toast('That change is already undone.'); return null; }
  if (where === 'undo') { toast(`Undo the later changes first (press ${keyLabel('mod+z')}).`); return null; }
  toast('That change can no longer be undone.');               // 已被预算淘汰或历史已清空
  return null;
}
```

`keyLabel('mod+z')` 的输出是 `Ctrl Z`（Mac 上 `⌘ Z`，`ui/keys.js:30-37` 用空格连接），文案按实际输出写。
`ui/toast.js` 的 `action` 选项保留（等价于一个元素的 `actions`）；按 F0-D 的请求，toast 在悬停与键盘聚焦时暂停计时，`timeout: 0` 的 toast 可用 Esc 或按钮关闭；
`addStructure` 与导入流程同样只把本步新增的备注（`newWarnings(before, after)`）附在 toast 后。替换的调用点：`app.js:666`（删除原子）、`app.js:845`（加入示例）、
`ui/selectioncard.js:146`（替换元素）、`ui/shell.js:991`（粘贴，异步：用 `addStructure`/`importText` 返回的 `historyEntry`）。
`ui/panels/projects.js:208`（删除存储中的项目）不属于历史栈，不改。

### 3.5 版本号与缓存键

- 用 F0-D 的 `Structure.rev`（整数，构造时 0，不序列化）与 `touch()`（`rev++`，返回 `this`）：`remap`（因而 `deleteAtoms`、`addAtom`、`extend`、`sortBySpecies`）、
  `setProp`、`translate`、`wrap`、`setSymbols`、`setPbc`、`setPositions`、`keepFrame` 等修改方法都调用 `touch()`（F0-D v2 K13 与方法表，§10.1）。
  F0-D 合入前，`editActive` 自己做 `s.rev = (s.rev ?? 0) + 1`（临时实现，R12）。
- `structureKey(app)`（`core/analyses.js:103-107`）返回 `${active}:${serial}:${length}:${frame}:${rev}:${digest}`；`structureDigest`（73-95）不变，
  它仍然兜住脚本直接改坐标的情况。
- 面板签名：Structure 面板（`ui/panels/structure.js:75-85`）已含 `structureKey`；Surface 面板见 §3.17；分析缓存 `runKey` 自动受益。
- 脚本：直接改 `facet.structure.props.x` 后调用 `facet.edit.touch()` = `app.notifyStructureChanged()`：`touch()`、
  比较 `structureDigest` 与上次重建时的值——坐标、晶胞、元素或原子数变了就 `'full'`，否则 `'appearance'`——再 `markDirty()`、发 `structure`；
  **不写历史**（文档里说明，E20）。

### 3.6 预览会话

#### 3.6.1 三种预览与选择规则

| 操作（归属） | 预览方式 | 提交 |
|---|---|---|
| 拖动平移/旋转原子（M4，工具拖动） | P-pos，`transient: true` | `commit()` → 位置增量历史条目 |
| Transform 分区的数值平移/旋转、设键长/键角/二面角（M4） | P-pos（输入即预览，显示预览条） | 同上 |
| 晶胞参数、应变、重定向、平移原点、包裹、调整 slab 真空（M1/M2） | P-swap，`sameAtoms: true` | `commit()` → `replaceActiveStructure`（沿用最后一次 `preview` 的选项） |
| 矩阵超胞、重定义晶格、Niggli、原胞（M1） | P-swap，`sameAtoms: false`（带 `src`）；大结构只用 A 层虚线晶胞轮廓做轻量预览（§3.7.2） | `commit()` |
| 对体相建真空 slab（原位，M2） | P-swap | `commit()` |
| 切面（新结构，M2） | 体相上画 A 层晶面与厚度框；"Show slab" 时切到 P-swap 显示 slab | `commit({ addAsNew: true })` → `addStructure(..., {replaceProject: false})` |
| 悬停位点时的吸附物幽灵（M5） | 普通 `ghostLayer`，**不开会话** | —— |
| 放置吸附物并调高度/取向、覆盖度（M5） | P-ghost（只含新原子，带 slab 的晶胞与 pbc） | `commit((s) => …)` → `editActive` |
| Build Layers（M6） | P-swap | `commit({ addAsNew: true })` |
| 固定/放开原子（M3） | 不预览（即时、可撤销）；选择查询用 `setHighlight('query-preview')` 预览 | `editActive(..., {rebuild: 'appearance'})` |

#### 3.6.2 会话对象

```js
const ses = app.beginStructureEdit(label, {
  kind = 'positions',          // 'positions' | 'structure' | 'ghost'
  owner = null,                // 任意标识（面板 id、工具 id），面板据此知道"这是我的会话"
  commitLabel = 'Apply',       // 预览条上的按钮；新结构类操作用 'Create'
  transient = false,           // 工具拖动：由指针松开结束，不显示预览条
  singleFrame = kind === 'positions',   // C11：提交时只保留当前帧（M4 的默认）
  onEnd = null,                // (reason: 'commit' | 'cancel' | 'undo' | 'switch' | 'replaced' | 'edit' | 'project' | 'error') => void
});
ses.preview(input, opts)       // 'positions': Float64Array(3n) 或 { indices, positions: Float64Array(3·len) }（笛卡尔，当前帧）
                               // 'structure': Structure，opts { sameAtoms = false, indexMap | src, latticeChanged = false, imageShift }
                               // 'ghost':     Structure（只含新原子；晶胞/pbc 与当前结构相同）或 null
ses.commit(arg, { positions, label, toast, select })   // §3.6.4；返回 { entry, structureEntry } 或 null（无可提交内容）
ses.cancel(reason = 'cancel')
ses.active / ses.kind / ses.label / ses.owner / ses.last   // last = 最后一次 preview 的 { input, opts }
app.session                    // 当前会话或 null
app.committedModel             // P-swap 时返回暂存的已提交模型，否则 viewer.model
```

预览条的显示规则：`banner = !transient`（E19：M4 Transform 分区的 P-pos 也有预览条，关掉面板后仍能 Apply/Cancel）。

实现要点：

```js
beginStructureEdit(label, opts = {}) {
  if (!this.structure) throw new Error('Load a structure first.');
  this.session?.cancel('replaced');
  const ses = new EditSession(this, label, opts);      // 记下 base = this.structure、baseEntryId、kind…
  this.session = ses;
  this.viewer.play(false);                              // 轨迹播放暂停（E28），会话结束后不自动继续
  this.viewer.beginPreview(ses.kind);                   // 视图进入预览状态（拾取规则、无取景、P-swap 输入锁）
  this.emit('preview', { state: 'start', label, kind: ses.kind, owner: ses.owner });
  return ses;
}
// EditSession.preview
preview(x, o = {}) {
  this._assertLive();                                   // 结构被换掉就抛 'The structure changed during the preview.'
  if (this.kind === 'positions') this.app.viewer.previewPositions(normalizePositions(x, this.base));
  else if (this.kind === 'structure') this.app.viewer.previewStructureSoon(x, o);   // rAF 合并，只保留最新输入（§3.7.2）
  else this.app.viewer.previewGhost(x, o);
  this.last = { input: x, opts: o };
  this.app.emit('preview', { state: 'update', label: this.label, kind: this.kind, owner: this.owner });   // 不发 'structure'
}
```

`preview` 事件的 detail 只含可序列化的字段 `{state, label, kind, owner}`（嵌入页 `plain()` 要能序列化，E34）；需要会话对象的代码读 `app.session`。
`normalizePositions`：输入长度必须是 `3·base.length` 或 `3·indices.length`；含 NaN/Infinity 时抛 `Preview positions must be finite numbers.`；
`indices` 越界抛 `Preview atom index N is out of range (0–M).`。

#### 3.6.3 预览期间各部分看到什么

| 方面 | P-pos | P-swap | P-ghost |
|---|---|---|---|
| `app.structure`、`project.structures`、保存、自动保存、撤销快照、分析、面板签名 | 已提交（不变） | 已提交 | 已提交 |
| `viewer.structure` / `viewer.model` | 已提交对象；移动原子的绘制坐标被改写 | 预览结构与它的模型（`app.committedModel` 给出暂存的已提交模型） | 已提交 + A 层幽灵模型（独立对象） |
| 视图的原子输入：点击、双击、框选/套索、右键菜单、悬停卡 | 正常；命中预览位置；索引是已提交索引 | **全部锁住**：`_click`/`_tap` 不发 `atomclick`（也不发 `index: -1`，不清空选区）、`_leftPress` 不画选择形状、`_context` 不发 `atomcontext`、悬停不拾取原子、`pickAtom` 返回 −1；相机操作照常 | 正常（幽灵不可拾取，除非所属工具自己处理） |
| 依赖 `viewer.model` 的选区函数（`sel.grow`、`sel.fragment`、`centreSelection`、`api.selectNeighbors/selectFragment`，`selectioncard.js:83-126`、`public.js:268-296`） | 正常 | 改读 `app.committedModel`；命令的 `when` 另加 `app.session?.kind !== 'structure'` 作双保险 | 正常 |
| 选区光环、命名高亮 | 跟随移动 | `sameAtoms` 时显示，否则隐藏 | 不变 |
| 测量（线和数值） | 实时跟随（数值按预览坐标的 Float64 计算） | `sameAtoms` 时按预览坐标显示，否则隐藏 | 不变 |
| 标签、图例、比例尺 | 跟随 | 按预览模型 | 不变 |
| 信息卡、状态栏 | 已提交结构 | 已提交结构 + 状态栏药丸 "Preview · N atoms" | 已提交 + "Preview" |
| 选区卡片 | 实时坐标（B2）；动作禁用 | 隐藏 | 不变 |
| 相机 | 不取景 | 不取景（预览条提供 "Fit"） | 不取景 |
| 轨迹 | 播放暂停，`traj.*` 不可用（`viewer.setFrame` 会作用到预览结构，`viewer.js:638-643`） | 同左 | 同左 |
| 导出 PNG/GLB/结构文件、导出菜单项、`facet.screenshot()`、嵌入页 `facet:screenshot` | 不可用（拖动中不可能触发） | 不可用：命令的 `when` 加 `!app.session`；菜单项 `disabled`（`shell.js:729-750`）；API 抛 `Apply or cancel the preview first.` | 同左 |
| 缩略图 | `projectToJSON` 在有会话时一律沿用旧缩略图（含手动保存 Ctrl+S，`app.js:219-224`） | 同左 | 同左 |
| `markDirty` / 历史 | 不调用 | 不调用 | 不调用 |

事件：会话开始、每次更新、结束都发 `app` 事件 `preview`；预览期间**不发** `structure`（它会重建检查器、抽屉和选区卡片，报告 02 §9-8）。

#### 3.6.4 提交、应用、取消

- **P-pos `commit({ positions, label, toast, select } = {})`**：给了 `positions` 时先 `preview(positions)`（M4 A-CR3 的便利写法）；没有任何预览 → 结束会话、返回 null（按下没移动就是一次点击）。否则
  `editActive(label, (s) => { s.setPositions(pos, { indices }); return select ? { select } : undefined; }, { snapshot: { positions: indices }, refit: false, rebuild: 'full', singleFrame: ses.singleFrame, toast })`；
  `singleFrame` 为真且结构多帧时，`editActive` 先 `keepFrame()` 再写坐标，并给出 `Kept frame k of N and dropped the others.`（带绑定的 Undo，E14）。`setPositions` 由 F0-D 提供（§10.1）。
- **P-swap `commit({ label, toast } = {})`**：`replaceActiveStructure(previewS, { label, ...ses.last.opts（sameAtoms 除外）, refit: true })`——`src`/`indexMap`/`latticeChanged`/`imageShift`
  沿用最后一次 `preview` 的选项（M1 请求）；`commit({ addAsNew: true, name })`：`addStructure(previewS, { replaceProject: false, label })`，
  新结构成为活动结构，原来的体相留在项目列表中。
- **P-ghost `commit(fn, opts)`**：`editActive(label, fn, opts)`；`fn` 通常把幽灵原子追加到 slab（`adsorbate_id`、`tags = 0` 由 M5 写）。
- 返回值统一为 `{ entry, structureEntry }`：原位提交时 `structureEntry` 是活动条目，`addAsNew` 时是新条目（E34）。
- **`cancel()`**：`viewer.endPreview({ restore: true })`（P-pos 恢复所有碰过的实例；P-swap 挂回暂存对象或重建；P-ghost 移除幽灵层），
  发 `preview {state:'cancel'}`，调用 `onEnd(reason)`（轨迹播放不自动继续）。
- 提交时 `ses._committing = true`，使 `_pushStructureHistory` 不把自己取消；提交抛错 → 会话按 `'error'` 结束、视图恢复、错误抛给调用者。
- 顺序：提交时**先** `viewer.endPreview({ restore: false })`，**再**执行上面的 `editActive`/`replaceActiveStructure`/`addStructure`（照常做一次完整重建）；
  提交抛错时事务回滚，视图按已提交结构重建。然后发 `preview {state:'commit'}`、调用 `onEnd('commit')`、置 `app.session = null`。提交与取消都是幂等的。

**自动取消**（`app._endSessionFor(reason)`）：`_pushStructureHistory`（任何写历史的编辑，含脚本）、`undo`/`redo`/`undoEntry`、`setActiveStructure`、
`_switchProject`（新建/打开项目）、`removeStructure`、`addStructure`（非本会话提交）、`beginStructureEdit`（新会话）。
窗口失焦、指针取消只结束**工具按下**（工具自己决定是否取消它的 P-pos 会话，M4 的拖动应取消）。

**预览条**（会话 `banner` 为真时）：视口上方居中，`div.float.preview-bar[role=region][aria-label="Preview"]`：
`Preview: <label>` + 主要按钮 `<commitLabel>`（默认 "Apply"，新结构类 "Create"，tip 带 `keyLabel('mod+Enter')`）+ `Cancel`（tip `Esc`）+ 图标按钮 "Fit to screen"。
状态播报用单独的视觉隐藏 `role=status` 元素（只在会话开始、结束时更新一次），不把按钮放进 live region（E24）。
P-swap 时附一句提示 "Atoms can’t be selected during a preview."（窄屏省略）。预览条与工具 HUD 同时出现时上下堆叠：预览条在上，HUD 下移一个预览条高度
（`.measure-hud` 的 `top` 改为 `calc(60px + var(--preview-bar-h, 0px))`，app.css:373）。

**守卫**：`main.js` 增加 `const canEdit = () => hasS() && !app.busy && !app.session;` 与
`const editWhyNot = () => (app.session ? 'Apply or cancel the preview first.' : null);`，用于 `sel.delete`、`sel.delete2` 以及 §5.8 所有编辑类命令；
导出命令与 `api/extensions.js` 的 `export.` 家族（25-41）的 `when` 加 `!app.session`；`traj.*` 的 `when` 加 `!app.session`。场景设置（外观、配色、表示方式）在预览期间照常可用。

**Esc**：`sel.clear`（`main.js:108-112`）改为：有会话 → `app.session.cancel('cancel')` 并提示 `Preview cancelled`（不清空选区）；
否则维持现有逻辑。工具按下中的 Esc 仍由视图在捕获阶段处理（§3.13）。
**mod+Enter**：`edit.applyPreview`（有会话时）。分区输入框里 Enter = Apply 由各模块的表单实现。

### 3.7 视图预览的内部实现（`render/viewer.js`）

```js
beginPreview(kind)                     // this._preview = { kind, pos: null, stash: null, last: null }
previewPositions({ indices, positions })   // P-pos
previewStructure(structure, { sameAtoms = false } = {})   // P-swap（previewStructureSoon：rAF 合并）
previewGhost(structure | null, { opacity = 0.45, style = null } = {})   // P-ghost
endPreview({ restore = true } = {})
get previewing()                       // 'positions' | 'structure' | 'ghost' | null
get inputLocked()                      // this._preview?.kind === 'structure'
```

#### 3.7.1 P-pos：只改受影响的绘制副本

规则：绘制副本 d（来自结构原子 i）的位置 = **会话开始时**它的绘制位置 + 原子 i 的位移，即 `p_d' = orig_d + (r_i' − r_i)`。
每个副本相对于原子的格矢偏移（包裹 + 周期像）保持不变，所以平移和旋转都对。

```js
_pvBegin() {                                        // 会话第一次 previewPositions 时，只做一次
  const m = this.model;
  return { orig: m.positions.slice(), touched: new Uint8Array(m.n), set: null,
           grid: null /* B9 局部重搜键时惰性建立 */ };
}
_pvSet(indices) {                                   // 移动集合（第一次或变化时）
  const m = this.model, mark = new Uint8Array(this.structure.length);
  for (const i of indices) mark[i] = 1;
  const disp = []; for (let d = 0; d < m.n; d++) if (mark[m.src[d]]) disp.push(d);
  const dm = new Uint8Array(m.n); for (const d of disp) dm[d] = 1;
  const bonds = []; for (let b = 0; b < m.bonds.count; b++) if (dm[m.bonds.pairs[2 * b]] || dm[m.bonds.pairs[2 * b + 1]]) bonds.push(b);
  const slot = new Int32Array(this.structure.length).fill(-1); indices.forEach((i, k) => { slot[i] = k; });
  const base = new Float64Array(3 * indices.length); indices.forEach((i, k) => { for (let c = 0; c < 3; c++) base[3 * k + c] = this.structure.positions[3 * i + c]; });
  const limit = Float32Array.from(bonds, (b) => this._bondLimit(b));   // 同 findBonds 的判据：tolerance × (r_cov,i + r_cov,j)，并受 maxLength 限制
  return { indices: Int32Array.from(indices), mark, slot, base, disp: Int32Array.from(disp), bonds: Int32Array.from(bonds), limit };
}
previewPositions({ indices, positions }) {
  const P = this._preview; if (P?.kind !== 'positions' || !this.model) return;
  P.last = { indices, positions };
  P.pos ??= this._pvBegin();
  const X = this.model.positions, src = this.model.src, { orig, touched } = P.pos;
  if (!P.pos.set || !sameIndices(P.pos.set.indices, indices)) {
    const next = this._pvSet(indices);
    if (P.pos.set) for (const d of P.pos.set.disp) if (!next.mark[src[d]]) {        // 离开集合的原子回到原位（E6）
      X[3 * d] = orig[3 * d]; X[3 * d + 1] = orig[3 * d + 1]; X[3 * d + 2] = orig[3 * d + 2];
    }
    if (P.pos.set) this._pvWrite(P.pos.set);                                        // 把它们的实例也写回
    P.pos.set = next;
  }
  const { disp, slot, base } = P.pos.set;
  for (const d of disp) {
    const k = slot[src[d]]; touched[d] = 1;
    for (let c = 0; c < 3; c++) X[3 * d + c] = orig[3 * d + c] + (positions[3 * k + c] - base[3 * k + c]);
  }
  this._pvWrite(P.pos.set);
  this._growBounds(disp);                              // 只扩大 bounds 半径，不取景
  this._writeHalos();
  this._buildMeasurements();                           // 测量线与数值实时更新（数值按预览坐标的 Float64）
  this._dirty = true;
}
_pvWrite(set) {
  if (styles.get(this.settings.style.rep)?.inPlacePositions) {
    writeAtomMatricesAt(this._mesh('atoms'), this.model, this.radii, set.disp);               // styles.js 新函数
    writeBondMatricesAt(this._mesh('bonds'), this._bondCtx(), this._bondRadius(), set.bonds, { limit: set.limit });   // 超过 limit 的键缩放为 0
    if (this._pvBondsEnabled(set)) this._pvLocalBonds(set);                                    // B9
  } else this._pvFallbackSoon();                       // 线框、多面体、插件样式：≤ 10 Hz 用临时克隆重建（sameAtoms）
}
```

- **被拉长的键（必须，D9、E32）**：`writeBondMatricesAt` 对长度超过 `limit` 的键写零缩放矩阵（不画），回到判据以内时恢复。
  把 CO 从顶位拖向 fcc 空位时不再出现横跨拖动距离的长棍。
- **局部重搜键（B9，应该）**：移动原子数 ≤ 200 时，会话开始时为绘制原子建整数网格（10k 绘制原子 0.23 ms，`grid_int.mjs`），每次更新只为移动原子找
  判据以内的邻居（同 `findBonds` 的判据与 `disabledPairs`），不在现有键表里的写进单独的 `InstancedMesh`（叠加层 `preview-bonds`，A 层，`export: 'never'`，
  材质与半径取自键网格，颜色按两端原子分色），每个移动原子预留 12 个实例；提交时照常完整重建。
- `writeAtomMatricesAt(mesh, model, radii, displayIdx)` 与 `writeBondMatricesAt(mesh, ctx, bondRadius, bondIdx, {limit})`（`render/styles.js`，在
  `writeAtomMatrices` 52-61 与 `writeBondMatrices` 82-117 旁边）：只写给定实例（分颜色时键 t 是实例 2t 与 2t+1），用 three r170 的
  `instanceMatrix.addUpdateRange(start, count)` 只上传改动的区段（相邻合并，超过 32 段时整体上传）。**所有整体写函数**（`writeAtomMatrices`、`writeBondMatrices`、
  `_updateRadii` 的路径，`viewer.js:766-784`）先调用 `clearUpdateRanges()`，否则同一帧只会上传旧区段（E21）。
- **视锥剔除**：局部写入不更新包围球，会话期间把 atoms/bonds 网格设为 `frustumCulled = false`，结束时恢复（E21）。
- 内置的 `ballstick`、`spacefill`、`spheres`、`licorice` 加 `inPlacePositions: true` 与 `inPlaceColors: true`；`wireframe`（`'lines'`）和 `polyhedra` 没有。

**实测**（`fastpath_bonds_fixed.mjs`，改正堆垛后的夹具，node 22，CPU 部分，不含 GPU 上传；`bench1000.mjs`）：

| 结构原子 | 绘制原子 | 键 | 移动原子 | 会话开始 | 每次更新 | 全部键实例重写 | 只写受影响实例 | 完整 `buildDisplayModel` |
|---|---|---|---|---|---|---|---|---|
| 218 | 244 | 1 098 | 2 | 0.12 ms | 0.005 ms | 0.6 ms | 0.002 ms | 1.8 ms |
| 10 088 | 10 254 | 54 823 | 2 | 2.7 ms | 0.001 ms | 11.8 ms | 0.0003 ms | 29 ms |
| 60 002 | 60 404 | 328 406 | 2 | 14.8 ms | 0.001 ms | 74.6 ms | 0.0003 ms | 157 ms |
| 10 086 | 12 016 | 59 946 | 1 000（5 887 根键） | 1.5 ms | 0.85 ms（坐标 + 原子矩阵 + 键长核对） | — | — | — |

增量坐标与对移动后结构的完整重建逐坐标相差 ≤ 9.5e-7 Å（Float32 精度）。1 000 个移动原子时键矩阵的局部写入按 11.8 ms / 54 823 根键估算约 1.3 ms，
每次更新合计约 2.2 ms（§7.5 预算 ≤ 3 ms）。结论不变：**必须只写受影响的键实例**。

**更换移动集合**（`pv_fix.mjs`，E6 的用例）：先把 CO 整体上移 1 Å、再只把 O 移到 z = 4.5：v1 的写法画出 C 2.85 / O 5.5、取消后停在 2.85 / 4.0；
v2 画出 C 1.85 / O 4.5、取消后回到 1.85 / 3.0。

**越过晶胞面**：预览中副本连续移动（原型中 O 原子被拖到 x = −3.0 Å，预览画在 −3.0）；提交后完整重建按包裹规则重新放置（画到 5.316 Å，即对面）。
规格接受这一跳变；测量引用相对存储坐标（§3.9），跳变不影响测量指向同一对原子。

**预览中发生重建**（拖动中改了键设置、显示超胞等，触发 `_buildModel`）：`_buildModel` 末尾若 `this._preview?.kind === 'positions' && P.last`，
就置 `P.pos = null` 并重新 `previewPositions(P.last)`。

**`endPreview` 恢复**：对 `touched` 的所有实例 `model.positions` 写回 `orig`、再写一次矩阵、`_writeHalos()`、`_buildMeasurements()`、恢复 bounds 与 `frustumCulled`、移除 `preview-bonds`；不重建。

#### 3.7.2 P-swap：暂存已提交的绘制对象

1. 第一次 `previewStructure`：暂存
   `{structure, model, rep, atomMaterial, bondMaterial, bondAuto: this._bondAuto, colors, cn, radii, maxRadius, bounds, cellObj, measureObj, sigs: this._sigs}`，
   把 `rep`、`cellObj`、`measureObj` 从 `root` 上取下（不释放），**再把 `this.rep/cellObj/measureObj/atomMaterial/bondMaterial` 置空**，
   使接下来的 `_buildRep`、`_buildCell`、`_buildMeasurements` 不把它们推进 `_trash` 或释放（`viewer.js:729, 757-759, 899, 1004`，E7）；
   `_flushTrash`（682-691）跳过暂存中的材质。结构超过 200 000 原子时不暂存，结束时改为重建。
2. `this.structure = preview; this._sigs = {}; this._noRefit = true; this.applySettings(this.settings, { force: true })`，然后发 `model`。
   之后每次 `previewStructure` 都重建（旧的预览对象进 `_trash`）。
3. 预览中：输入锁（§3.6.3）；`sameAtoms` 为假时 `_writeHalos` 跳过选区与命名高亮，`_buildMeasurements` 跳过全部测量。
4. `endPreview`：释放预览对象；若暂存时的 `sigs` 与当前设置算出的签名相同，挂回全部暂存对象与字段，然后 `lights.setBounds(bounds.center, bounds.radius)`、
   `_updateFloor()`、阴影相机更新、`_writeHalos()`（`_buildModel` 664-665 只在重建时做这些）；否则 `setStructure(committed, { resetCamera: false, refit: false })`。
5. **节流与降级**（E16、工程审查"缺失内容"7）：`previewStructureSoon` 按 rAF 合并，同一帧只重建最新一次输入；构建耗时超过 120 ms 后改为松开输入
   （`onCommit`）时才重建并在预览条显示 `Preview updates when you finish typing.`；预览结构超过 50 000 原子时默认只画 A 层虚线晶胞轮廓（`cellOutlineLayer`），
   预览条提供 `Show atoms` 按钮手动打开完整预览。

#### 3.7.3 P-ghost：A 层幽灵

`previewGhost(g)`：`gm = buildDisplayModel(g, {...display, boundaryAtoms: false, completeBonds: false}, { cuts: 已提交模型的 model.cuts })`
（幽灵原子与 slab 用同一个切口包裹，§3.8.2）；颜色和半径与当前表示方式相同；材质为当前材质的透明副本
（`opacity` 默认 0.45，`depthWrite: true`，避免实例球体排序问题，报告 03 §5.3）；作为 `tier: 'scene'`、`export: 'never'`、
`pickable: false` 的叠加层 `preview-ghost` 加入。幽灵通常只有几个到几十个原子，每次调用整体重建（≤ 2 ms）。`g = null` 移除。
同一个实现也作为构件 `ghostLayer`（§3.11.4）供 M5 的悬停幽灵直接使用（不开会话）。

#### 3.7.4 取景与相机

- `setStructure(structure, { resetCamera = true, refit = true } = {})`（582-590）：`this._noRefit = resetCamera || !refit`。
- `_maybeRefit`（799-804）在 `this._preview` 非空时直接返回。
- `transformCamera(R)`：`R` 是 3×3 旋转（行矢量约定）；相机位置、`controls.target`、`camera.up` 都左乘 `R`，然后
  `camera.lookAt(target)`、`_syncControlsUp()`、`controls.update()`；`_camAnim` 存在时同样变换其端点。M1 的 Re-orient 通过 `editActive(..., { cameraTransform: R })` 使用。

### 3.8 逐原子可见性与真空间隙显示（`render/display.js`）

#### 3.8.1 可见性掩码

- `buildDisplayModel(s, display, { imageCenters, visible, cuts })`（101-223）：`visible` 是 `Uint8Array(n)`（1 = 绘制）或 `null`。
  改三处：`shown[i] = !hidden.has(sym) && (!visible || visible[i] === 1)`（146）；可见计数（122）；非周期分支（203）。
  周期像与补全配位的副本已经用 `shown[j]` 过滤（190），被隐藏的原子不会作为邻居副本出现。
- `estimateDisplayCount(structure, N, display, visible = null)`（70-94）按同一规则计数，并用 §3.8.2 的切口缓存。
- **实测**（`display_masked.mjs` + `fastpath.mjs`）：10k 原子 slab 隐藏底部 3 层后绘制 5 128 个原子，所有 `src` 都是可见原子，构建时间比不隐藏时少 10–16 ms。
- 视图：`setVisibility(name, spec)`，`spec` 为 `null`（删除）| `{ hide: indices }` | `{ show: indices }`（其余隐藏）| `Uint8Array(n)`。
  多个名字取"与"；`this._visRev++`；`applySettings` 的 `model` 签名（598）加入 `this._visRev`；长度与原子数不符的掩码被忽略并警告。
  发视图事件 `visibility {hidden, names}`；`hiddenCount` 为被掩码隐藏的原子数（不含按元素隐藏的）；`isVisible(i)`。
- 编辑后：`remapIndexed(map, n1)` 把每个掩码按旧→新映射搬到新长度（新原子可见），不再隐藏任何原子的掩码被删除。
- 切换到另一个结构条目时清空所有掩码（撤销恢复同一条目且原子数不变时保留）。
- 被隐藏的原子不绘制，所以不能被点击、悬停或框选。**有掩码隐藏原子时**，`sel.all`（Ctrl+A）与 `sel.invert` 只作用于可见原子，
  并提示 `Selected 120 visible atoms (216 hidden).`；按索引选择（API、Atom Selection 查询）不受影响。按元素隐藏（`hiddenElements`）的现有行为不变。
- 掩码是临时视图状态，不进 `scene`、不保存。状态栏的 "N hidden · Show all" 让它总是可见可撤（§5.5）。

#### 3.8.2 真空间隙与切口（用户决定 U1）

U1 的三个用途（显示、层与位点的上下表面、slab 工具）必须用同一个切口。下面的函数由 **F0-D 在 `web/js/core/vacuum.js` 与 `facet/analysis/vacuum.py` 实现**
（两种语言同一算法、同一常量、同一并列规则；联合接口见 §10.1），F0-A 的显示、`surfaceNormal`、M3、M5 都调用它们。
F0-D v2（§3.13，与本次修订同期定稿）已有 `find_vacuum_gap`、`find_vacuum_gaps`、`find_surface_gap`、`gap_cut`、`unwrap_along_gap`、`vacuum_gap_hint`、`make_contiguous`：
前两个与 `vacuum_gap_hint` 照原样采用；**`gap_cut`、`unwrap_along_gap`、`find_surface_gap` 按本节改**——F0-D v2 的 `gap_cut(gap)` 正是本规格 v1 的"中点映射到 (−0.5, 0.5]"规则，
领域审查与下表证明它会把整块 slab 画到晶胞外（§10.1 列出要改的四处）。
参考实现：`proto/f0a_v2/vacgap.mjs` / `vacgap.py`（89 个结构上 0 处不一致；原型里切口位置的字段名为 `cut`，规格里统一为 `center`）。常量在 `SURFACE_DEFAULTS`（JS camelCase / Python snake_case）：

| 键 | 值 | 含义 |
|---|---|---|
| `vacuumGapMin` / `vacuum_gap_min` | 5.0 Å | 没有提示时"有真空"的门槛（体相里沿晶轴最大的原子平面空隙 ≤ 3.4 Å，F0-D §3.13.1） |
| `surfaceHintGapMin` / `surface_hint_gap_min` | 2.0 Å | 该轴就是 `info.surface.axis`（且仍是最宽的真空）时的门槛 |
| `blockGapMin` / `block_gap_min` | 3.5 Å | 把一根轴上的原子分成"块"的空隙下限（化学吸附 < 3 Å，与 slab 同块） |
| `smallBlockFraction` / `small_block_fraction` | 0.5 | 原子数 ≤ 主块的这个比例的块算"漂浮块"（真空中的分子） |
| `positionTolerance` / `position_tolerance`（F0-D 已有） | 1e-5 Å | 宽度差在此以内视为相等（与 F0-D v2 的 `find_vacuum_gap` 同一个并列容差） |

**基本量**（对轴 k，用当前帧，或参数 `frame` 给出的帧及其晶胞）：

```text
wrap01(f)    = w ← f − floor(f)；w > 1 − 1e-6 时 w ← 0          （= render/display.js:133-136 的现行规则，两种语言相同）
h_k          = |det(cell)| / |a_i × a_j|                            （i, j = k+1, k+2 循环；f_k = 常数的晶面间距）
axisGaps(s, k) → null（无原子、晶胞奇异、|a_i × a_j| ≤ 1e-12） | { k, h, n, w: 升序的 wrap01(f_k), widths, periodic: pbc[k] }
    widths[t] = (w[t+1] − w[t]) · h（t < n−1）；widths[n−1] = ((w[0] + 1) − w[n−1]) · h     （环绕空隙两种语言都按这个式子算）
center(t)    = (w[t] + widths[t]/(2h)) mod 1
better(t, u) : |widths[t] − widths[u]| > positionTolerance ? widths[t] > widths[u]
             : 中心离晶胞面更近者（min(c, 1−c) 更小，差 > 1e-9）: w[t] < w[u]          （确定性；E11）
```

**公开函数**：

```text
findVacuumGap(s, axis = null, {minWidth = vacuumGapMin, frame, periodicOnly = true}) → VacuumGap | null
                                                    F0-D v2 §3.13.1，照原样采用（U1 建议的签名；轴内并列取 start 最小，跨轴按 c、b、a）
findVacuumGaps(s, {frame, periodicOnly = true}) → [VacuumGap | null] × 3      F0-D v2 §3.13.2（每轴 minWidth = 0）；F0-A 需要非周期轴时传 periodicOnly: false（D5）
VacuumGap = { axis, start, end, width, center, height }                      start、end、center ∈ [0, 1)，end ≤ start 表示跨过 f = 1（F0-D v2 的约定）
gapCut(s, axis, {frame, hint = false}) → GapCut | null                       显示、上下表面与 slab 工具用的切口（下面；替换 F0-D v2 的 gap_cut(gap)）
GapCut = 切口所在那个空隙的 VacuumGap 字段 { axis, start, end, width, center, height } + { lo, empty, widest, rule, main: {lower, upper, count}, blocks }
unwrapAlongGap(f, cut) = f − floor(f − cut.lo)                               把分数坐标放进 [lo, lo + 1)（替换 F0-D v2 的 unwrap_along_gap(f, gap)）
findSurfaceGap(s, {frame}) → GapCut | null                                   = surfaceNormal(s).surface ? surfaceNormal(s).cut : null（同一份计算，§3.14.2；替换 F0-D v2 的规则）
vacuumGapHint(s) → string                                                    F0-D v2 §3.13.2，照原样采用（把非周期轴上的真空也算进来，D5）
```

**`gapCut` 算法**：

```text
G ← axisGaps(s, k)；没有 → null
tW ← 按 better 取最宽的空隙；split ← { t : widths[t] ≥ blockGapMin }（按排序位置）
若 |split| ≤ 1：
    cutT ← tW；empty ← widths[tW]；rule ← 'widest'
否则：
    块 b：排序位置 split[b]+1 … split[b+1]（环绕），下方空隙 split[b]，上方空隙 split[b+1]；count、extent（Å）、start = 第一个原子的 w
    main ← count 最大（并列：extent 更大（差 > positionTolerance）；再并列：start 更小）
    big ← { b : b = main 或 count_b > smallBlockFraction · count_main }        （其余是漂浮块，并入真空）
    对相邻的两个大块（环绕）构成的"真空区"：empty = 其中各 split 空隙宽度之和；切口候选 = 上方那个大块的下方空隙
    选 empty 最大的真空区（并列：按 better 比较两个候选空隙）
    cutT ← 该候选；rule ← |big| = 1 ? 'below-main' : 'widest-between-big'
若 empty < (hint ? surfaceHintGapMin : vacuumGapMin) → null
c ← center(cutT)；start/end/width/height 取空隙 cutT 的值
nA ← #{w ≥ c}；nB ← n − nA                                                    （两种窗口各自要"搬"的原子数）
lo ← (nA < nB 或 (nA = nB 且 c ≥ 0.5)) ? c − 1 : c                           （窗口 [lo, lo + 1)：相对现行 [0, 1) 包裹移动原子最少的一侧）
main.lower/upper ← 主块（只有一块时为全部原子）在窗口坐标中的最小/最大分数坐标；main.count
```

复杂度：每轴一次 `Float64Array` 排序 O(n log n) + O(n)。10k 原子三轴合计 5.1 ms（JS，含分数坐标计算），`surfaceNormal` 2.6 ms；按"结构对象 + rev + 帧"缓存（WeakMap），
同一版本只算一次，显示、`surfaceNormal`、外观面板的计数共用。

**显示**（`buildDisplayModel`）：`display.wrap !== false` 时，对每根周期轴 k 调用 `gapCut(s, k, {hint: k === hintAxis})`
（`hintAxis` = `surfaceNormal` 的来源为 `'info'` 时的轴，即 `info.surface.axis` 且通过校验，§3.14.2）；有结果时：
1. 沿 k 用 `unwrapAlongGap(f_k, cut_k)` 代替 133-137 行的 [0, 1) 包裹；
2. 这根轴上不设 `nearMask` 位（139 行），即不在远端面复制边界原子；其他轴照旧；
3. 模型记录 `model.cuts[k] = GapCut`、`model.wrapRule = {wrap, boundary, lo: [lo_0, lo_1, lo_2]}`、`model.home`（§3.9.1）。

非周期轴从不包裹（现状），切口只影响周期轴；`gapCut` 对非周期轴照样可算（`surfaceNormal` 用它判断 T T F 结构的真空）。
P-pos 预览中不重算（避免拖动中切口跳动）；P-swap 为预览结构单独计算；P-ghost 用已提交模型的 `cuts`。显示超胞沿 k 大于 1 时每个像都按同一切口画。
调试开关 `viewer.gapCut = false`（视图属性，不进场景、不保存，E30）退回旧规则，只供回归对照。

**实测**（`scenarios.mjs`、`neb.mjs`；"现状" = 现在的显示，"v1" = 本规格 v1 的规则，"v2" = 本节；数字为 slab 原子的绘制 z 范围）：

| 情形 | 现状 | v1 | v2 | v2 切口规则 |
|---|---|---|---|---|
| Pt(111) 2×2 4L，底层 z = 0，15 Å 真空，pbc T T T | 35 个绘制原子，0.00…21.79（真空顶部多一层） | 26，0.00…6.79 | 26，0.00…6.79 | widest 15.0 Å |
| 同上 pbc T T F | 26，0.00…6.79 | 不变 | 不变（非周期轴不切） | — |
| slab 跨 c 边界（底层 z = 14） | 0.00…21.79（拆成两半） | 14.00…20.79 | 14.00…20.79 | widest |
| CONTCAR：p(3×3) 4L，底层弛豫 σ = 0.02 Å（部分在 0.99x） | 57，0.00…21.81 | 50，−0.02…6.79 | 50，−0.02…6.79 | widest |
| 15 Å 真空 + 直立 CO，C 离顶面 7.0 / 7.5 / 8.0 Å | — | **slab 画到 21.79…28.58（轮廓外）**，CO 在 slab 下方 | slab 0.00…6.79，CO 在上方 | below-main |
| 15 Å 真空 + CO，C 离顶面 10 Å（O 离像底面 3.85 Å） | — | CO 画到 −5.00（slab 下方） | CO 在上方 16.79 | below-main |
| 10 Å 真空 + CO，C 离顶面 4.0 Å（最宽空隙 4.85 Å < 5） | — | 不切：底层又在真空顶部多画一份 | 切开，CO 在上方 | below-main（真空区空隙和 8.85 Å） |
| 10 Å 真空 + CO，C 离顶面 6–8 Å（O 离像底面 < 3.5 Å） | — | CO 在下方 | CO 在下方（贴着像的底面，与像同块） | widest |
| 异质结：48 原子上层隔 3.6 / 4.5 / 6 Å 叠在 36 原子下层上，15 Å 真空 | — | 正确 | 正确（两块都是大块，切在真空里） | widest-between-big |
| fcc 体相惯用胞、石墨（3.35 Å 层间） | 14 / 10 | 不变 | 不变（无切口） | — |
| 10 Å 盒子里跨角的 CO | 2（拆到对角） | 画成一整个 | 画成一整个 | 三轴 widest |
| 单层石墨烯 pbc T T T，c = 15 Å，层在 z = 0 | 10，0.00…15.00 | **画到 z = 15.00（晶胞顶面）** | 画在 z = 0.00 | widest |
| 两层在 z = 5、15，c = 20（两个等宽 10 Å 空隙） | 5.00…15.00 | 5.00…15.00 | 5.00…15.00（并列规则：切口最靠近晶胞面者） | widest-between-big |
| CO 从顶位脱附的轨迹（每 0.05 Å 一帧，15 / 10 / 20 Å 真空各 231 / 132 / 331 帧） | — | slab 跳动 2 / 0 / 2 次，CO 在真空中点翻到下方 | slab 跳动 **0** 次；CO 只在离像底面 < 3.5 Å 时画到像下方（1 次跳变） | below-main → widest |
| 有 `info.surface.axis = 2`、10 Å 真空 + 直立的六原子链（最宽空隙 3.5 Å） | — | 不切 | 切开（提示门槛 2 Å） | widest |
| 同上，但 `info.surface.axis = 0`（过期的提示，指向面内轴） | — | — | 提示被拒，不切，`surfaceNormal` 落到 `'ab-plane'` | — |

已知行为（写进文档）：从**底面**脱附的分子离开底面超过 3.5 Å 后画到顶面上方的真空里（同一物理位置的另一个周期像）；
跨边界时部分原子画在晶胞轮廓之外（如 −0.02 Å），这如实反映了存储坐标与周期性，晶胞轮廓不动；绘制的 z 范围与存储坐标不同不影响测量（§3.9）与卡片坐标（§3.12.3）。

#### 3.8.3 吸附物按组包裹（B10，应该）

`props.adsorbate_id`（C4）大于 0 的原子按 id 分组：组内第一个原子（下标最小）照常包裹（含切口），得到整数偏移 `h`；组内其他原子不再各自包裹，
而是统一用 `f + h`；组内原子都不设 `nearMask`（不复制边界原子）。靠近 a、b 面的 CO、甲酸根因此画成一整个；`model.home` 如实记录这些偏移，测量与卡片不受影响。
没有 `adsorbate_id` 的结构不变。

#### 3.8.4 外观面板的计数

`estimateDisplayCount(structure, N, display, visible = null, { cuts })`：沿有切口的轴不加边界副本；`cuts` 省略时从缓存取（同一结构对象与 rev 只排序一次），
外观面板每次输入（`appearance.js:383, 449`）不再重做三轴排序（E30）。

### 3.9 测量引用（v2，新）

#### 3.9.1 定义

现在的测量键 `"src:a,b,c"` 的像偏移相对于**包裹后的家位置**（`render/display.js:225-227`；报告 03 §4），会随包裹规则变化；U1 改变了包裹规则。
v2 把像定义为**相对存储坐标**的整数格矢平移，与任何显示规则无关：

```text
引用 ref = "i:a,b,c"          原子 i 的存储位置 r_i（当前帧）加上 a·A + b·B + c·C
测量记录 = { type, refs: [ref…] }，refs[0] 的像总是 0,0,0（平移归一：测量值与整体平移无关）
model.home: Int32Array(3n)     绘制家副本 = 存储位置 + home_i·cell（包括 U1 切口与按组包裹）
storedImage(model, d) = model.img[d] + model.home[src[d]]      绘制副本 d 相对存储坐标的像
refOf(model, d) = `${src[d]}:${storedImage(model, d)}`；model.refs：ref → 绘制下标（首次使用时建立，同现在的 model.keys）
model.homeIndex: Int32Array(n) 每个原子的家副本（img = 0,0,0）的绘制下标，被隐藏时为 −1
```

`addMeasurement(type, displayIndices)`：`I_k = storedImage(model, d_k)`，减去 `I_0` 归一，存 `refs`。

#### 3.9.2 迁移旧数据

项目 JSON 与撤销快照里的旧记录 `{type, keys}`（没有 `refs`）在加载时迁移，结果写回为 `{type, refs}`（旧字段删除）：

```text
对每个 key = "i:J"：若 display.wrap（项目场景的值）为开，对每根周期轴：
    home_old(f) = floor(f) + (f − floor(f) > 1 − 1e-6 ? 1 : 0)          （现行 [0, 1) 规则，display.js:133-136）
    I = J − home_old(f_i)                                                （f_i 为该原子当前帧的分数坐标）
否则 I = J
再按 refs[0] 归一
```

迁移只需要结构本身（O(键数)），在 `loadProjectJSON` 的 `cleanMeasurements(s.measurements, structure, scene)` 中完成。
**实测**（`measref.mjs`，Pt(111) p(3×3) 4L CONTCAR 式夹具、补全配位开）：现规则下 400 个用到远面副本或补全配位像的近邻测量，
按旧键在 U1 模型里有 123 个（31%）找不到副本；迁移成 v2 引用后 400 个全部找到完全对应的绘制副本，数值与旧的 Float32 值相差 ≤ 1.2e-6 Å。
旧版本的应用读到新文件时看不到 `keys`，测量按"无效"保留（不画），不会被错误解释。

#### 3.9.3 数值与画线

- **数值**：`P_k = r_{i_k} + I_k · cell`（Float64，当前帧或 P-pos 预览坐标），`measureValue(type, P)`。修掉 `viewer.js:1013-1014` 用 Float32 绘制坐标计算的问题（P5）。
- **画线**：依次以首个原子的每个绘制副本 d（家副本在前）为锚，`T = storedImage(model, d)`，检查 `refs[k]` 平移 T 后是否都在 `model.refs` 里；
  第一组完全对应的副本就是画线位置（`ms.drawn = 'exact'`，`ms.idx` 为这些绘制下标）。
  找不到时以首个原子的家副本为锚、按 `P_k − P_0` 平移画出端点（`ms.drawn = 'floating'`，`ms.idx[k]` 对应不上的为 −1；线照画，端点处可能没有画出原子）。
  测量涉及的原子被隐藏（元素隐藏或掩码）时不画（`ms.drawn = 'hidden'`），数值照样给出。
- 结构面板（`ui/panels/structure.js:156`）：`exact`/`floating` 显示原子标签与数值；`hidden` 显示 `(hidden)` 与数值；引用的原子下标越界时显示 `(not in view)` 与 `—`。
- `drawOverlay` 的测量数值（1546-1552）用 `ms.points`（画线位置）投影，不再要求 `ms.idx` 都有效。

#### 3.9.4 编辑后的重映射

`_remapMeasurements(map, { imageShift, latticeChanged })`（787-800 改写）：
1. 原子下标：`"i:I"` → `"map[i]:I"`；任一原子被删除（`map[i] = −1`）则丢弃该测量（现状）。
2. `imageShift(oldIndex) → [ka, kb, kc]`：编辑把该原子的存储位置平移了整数格矢 k（`r' = r + k·cell`，例如 Wrap into cell、M2 的重新居中、M4 提交时可选的包裹），
   则 `I' = I − k`，再归一。**连续移动原子不需要 `imageShift`**：引用相对存储坐标，原子怎么移动都仍指同一对原子。
3. `latticeChanged`：改变晶格基的编辑（超胞、重定义晶格）之后旧的整数像不再有意义，丢弃任何像非零的测量；像全为零的保留。
   保持分数坐标的应变、改晶胞参数不改变基，调用方不传 `latticeChanged`，像照常有效。

#### 3.9.5 给 M4 的接口

`render/display.js` 导出 `storedImage(model, d)`、`refOf(model, d)` 与 `homeOffsets(structure, display, {cuts})`（M4 A-CR2，`buildDisplayModel` 内部用同一函数；视图另有 `viewer.homeOffsets()`）；`core/measure.js`（新纯模块）导出
`parseRef(ref) → {atom, image}`、`formatRef(atom, image)`、`normalizeRefs(refs)`、`measurementPoints(structure, refs) → Float64Array`、
`migrateMeasurementKeys(structure, keys, {wrap})`。M4 的 `measurementImages` 直接解析 `refs`；M4 不再需要 `wrapHome`（§10.0）。
移动手柄、枢轴的显示位置用 `model.homeIndex[i]` 的绘制坐标（与切口一致）。

### 3.10 命名高亮

```js
viewer.setHighlight(name, srcIndices | null, {
  color,                    // '#c93636' | { light, dark } | 'var(--constraint)'（CSS 令牌，主题变化时重新解析）
  grow = 1.15, opacity = 1, strength = 1.4,
  contrast = true,          // 双色边：深色内线 + color 外圈，对任何元素色都有亮度对比（D10）
  export: exp = 'marker',   // 'never' | 'marker' | 'always'（§3.11.3）
} = {})
viewer.clearHighlight(name)        // = setHighlight(name, null)
viewer.highlightNames()
```

- 保留名：`select`（grow 1.25，随主题强调色）、`hover`（1.32，随主题）。其他名字惰性创建：`_makeHalo(rimMaterial(strength, { contrast }))`（830-841），
  `userData.themed = false`。`_updateHalos`（880-885）与 `_cssTheme`（887-896）只给 `themed` 的种类改色——修掉报告 03 §8.6 的问题；
  `color` 是 `var(--token)` 时由 `_updateHalos` 重新解析该令牌（M3 请求）。
- 颜色：`{ light, dark }` 按背景明暗（`this.overlayDark`，`_applyBackground` 933 行）二选一，背景变化时重设。
  **F0-A 不规定任何名字的颜色**：固定原子用 `constraints-fixed` 等名字与 `--constraint` 令牌由 M3 决定（M3.md:642）；F0-A 只保证机制。
- 双色边的实现：`rimMaterial` 的片元着色器按 Fresnel 系数在内侧 30% 宽度混入 `edge` 颜色（浅色背景 `#14171b`、深色背景 `#000000`，alpha 0.65），外侧为 `color`。
  WCAG 亮度对比的问题（D10：`#c93636` 对 O `#FF0D0D` 只有 1.31）由深色内线解决：亮度 L ≥ 0.1 的元素色（O、N、Cl、S、多数金属）与黑色内线的对比 ≥ 3；
  更暗的元素色由外圈负责，所以外圈颜色应取 L ≥ 0.25 的亮色（由选颜色的模块核对，§10.0 对 M3 的说明）。
- 写入：`_writeHalos(kinds = null)`（868-877）对每个种类扫描一次绘制原子（`set.has(src[d])`），给每个周期像都画光环；`_setHover`（313-320）只写 `['hover']`；
  多个名字同时存在时按 `grow` 由小到大设置 `renderOrder`（M3 请求）。10k 绘制原子 × 4 种约 40k 次集合查询，< 1 ms。
- 编辑后由 `remapIndexed` 重映射；P-swap 且 `sameAtoms` 为假时隐藏。导出策略见 §3.11.3。不保存。

### 3.11 叠加层三层体系（新 `render/overlays.js`）

#### 3.11.1 层的契约

```js
const handle = viewer.overlays.add({
  id,                                   // 唯一；同 id 再加 = 替换
  owner = null,                         // 'm5-sites' 等，便于成批移除
  tier,                                 // 'scene'（A）| 'top'（B）| 'canvas'（C，2D 画布）| 'dom'（C，DOM）| 'legend'（图例项）
  object,                               // scene/top：THREE.Object3D
  draw,                                 // canvas：(g, ctx) => void；ctx = {scale, w, h, project(x,y,z), pxPerA(point), dark, font, text(t,x,y,size,color,weight), occupancy, export, markers, model}
  items,                                // legend：() => [{ label, swatch: { kind: 'halo' | 'dot' | 'line', color, opacity } }] | null，画进现有图例栈（render/legend.js）
  el,                                   // dom：元素，放进 viewer.container，位置在 beforeRender 里更新
  export = 'never',                     // 'never' | 'marker' | 'always'
  pickable = false, pick,               // pick(ray, ctx) → {t, index, item} | null
  pickIn = null,                        // 在哪些工具 id 下可拾取（null = 所有工具）；例：M5 的位点标记 ['site-pick']
  onModel, beforeRender, bounds,        // onModel(model, viewer)；beforeRender(ctx)；bounds() → {center, radius} | null
  depth = 'none',                       // 仅 top：'atoms' 时启用深度预通道（B1），拾取也只算未被原子挡住的命中
  clearOnSwitch = true,                 // 切换活动结构时自动移除
  order = 0, visible = true, dispose,
});
handle.set(patch); handle.setVisible(on); handle.remove();
viewer.overlays.get(id); viewer.overlays.removeOwner(owner);
```

`add()` 统一处理：A 层对象遍历后设 `userData.noInk = true`、`castShadow = receiveShadow = false`、材质 `fog = false`、
`InstancedMesh.frustumCulled = false`（报告 03 §5.2 生命周期规则）。`tier: 'canvas'` 的层就是 M3 要的 2D 叠加钩子（M3 的 `addOverlayDrawer` 改用它），
`tier: 'legend'` 是 M3 要的图例扩展（`addLegendItems`）。

#### 3.11.2 绘制位置

| 层 | 挂载点 | 何时画 | 深度 | 后期处理 |
|---|---|---|---|---|
| A `scene` | 新 `this.overlayGroup`，加在 `root` 下、紧跟光环（`viewer.js:181`） | 随 `scene3` | 真实深度 | 部分受影响（AO、描边透过，报告 03 §5.1）；适合晶面、幽灵、晶胞轮廓 |
| B `top` | 新 `this.topScene`（自带 `AmbientLight(1)` 与跟随相机的 `DirectionalLight(1.2)`） | `render()`（1483-1505）里在 `post.render()`/直接渲染（1490-1491）之后、轴向小部件（1492）之前：`setRenderTarget(null); autoClear = false; clearDepth();` [深度预通道] `render(topScene, camera)` | 无（总在最上），`depth: 'atoms'` 时被原子遮挡 | 不受影响；`toneMapped: false` 在默认帧缓冲里有效 |
| C `canvas` | `drawOverlay`（1521-1561） | 测量数值（1546-1552）之后、图例（1553）之前 | — | 不受影响 |
| C `legend` | `drawLegends`（`render/legend.js:133`） | 与颜色图例同一栈，排在其后 | — | — |
| C `dom` | `viewer.container` | `beforeRender` 更新位置 | — | — |

- `render()` 开头 `_updateClipping()`（1484）之后调用 `overlays.beforeRender({camera, width, height, pxPerA})`（拖动手柄保持屏幕大小不变）。
- `_updateClipping`（1455-1474）的 R 取模型与各层 `bounds()` 的并集。
- `onModel` 在 `_buildModel` 之后和每次预览重建之后调用；`clearOnSwitch` 的层在 `_activate` 切换条目时移除。
- 释放：`remove()` → `dispose?.()` 或 `_disposeObject`（674-680）。动画：叠加层不得自行循环渲染；悬停变化只 `requestRender()`。

#### 3.11.3 导出策略

`render()` 第 1487 行 `for (const k in this._halo) this._halo[k].visible = live;` 改为 `this._halo[k].visible = live && !this._haloHidden.has(k)`；
`overlays.exportScope(kind, { selection, markers }) → restore()` 只改 `_haloHidden` 和各层的 `visible`，`finally` 里恢复（E4）：

| 内容 | 策略 | PNG（默认） | PNG（勾选） | 缩略图 | glTF |
|---|---|---|---|---|---|
| 选区光环 `select` | 由 "Include selection highlight" 控制（偏好 `exportSelection`，默认开） | 有（与现在一致） | 关掉时无 | 无 | 无 |
| 悬停光环 `hover` | 从不导出 | **无**（现在有） | 无 | 无 | 无 |
| 命名高亮、位点标记 | `marker`：由 "Include markers (sites, fixed atoms)" 控制（偏好 `exportMarkers`，默认关） | 无 | 有 | 无 | 无 |
| 手柄、晶面预览、幽灵、晶胞轮廓预览 | 各层自定，默认 `never` | 按策略 | 按策略 | 无 | 无 |
| `always` 的层（例如用户加的注释文字） | 总导出 | 有 | 有 | 无 | 无 |
| 测量线与数值、标签、图例、比例尺 | 现有，不归叠加层 | 有 | 有 | 线有、文字无（同现在） | 无 |

缩略图单独一条规则：不含任何光环与叠加层（不按 `always` 判断，E34）。
- `screenshot({ scale, transparent, gizmo, maxSize, selection = true, markers = false })`（1785-1818）：在 1804 行渲染前 `const restore = this.overlays.exportScope('png', {selection, markers})`，`finally` 里恢复；
  1807 行 `drawOverlay(..., { export: true, gizmo, markers })` 让 C 层同样过滤。
- `thumbnail()`（1821-1833）：`exportScope('thumbnail')`。`exportGLB()`（1840-1902）从 `this.rep` 重建，天然不含叠加层，不改。
- App：`exportImage({ scale, transparent, selection = prefs.exportSelection !== false, markers = prefs.exportMarkers === true })`（1287-1300）；
  导出菜单（`shell.js:729-750`）在 Image 组末尾加两个勾选项。

#### 3.11.4 常用构件（B6，供 M2/M3/M5/M6 使用）

| 构件 | 层 | 说明 |
|---|---|---|
| `markerLayer({id, points, colors, radius = 0.32, tier = 'top', export = 'marker', pickable = true, pickIn = null})` | B（或 A） | 实例化小球 + 细轮廓（`MeshBasicMaterial({toneMapped:false})`）；`setPoints(points, colors)`、`setActive(i)`（悬停放大 1.3×）；拾取 = 对点的解析射线-球求交，半径取 `max(radius, 0.25)` |
| `planeLayer({id, polygons: [{points, color, opacity = 0.22, outline = true, dashed = false}]})` | A | 多个多边形各自颜色与虚线；`set({polygons})` 更新；半透明 `MeshBasicMaterial({side: DoubleSide, depthWrite: false})` + `LineSegments2` 轮廓；M2 画 (hkl) 晶面与厚度框 |
| `cellOutlineLayer({id, cell, origin = [0,0,0], color, dashed = true, width = 1.6})` | A | 与 `_buildCell`（898-923）相同的 12 条棱；M1 的超胞/重定义晶格轻量预览、P-swap 大结构降级 |
| `ghostLayer({id, structure, opacity})` | A | §3.7.3 的实现，M5 的悬停幽灵直接用（不开会话） |
| `textLayer({id, items: [{position, text, color, size}], export = 'never'})` | C canvas | 用占用网格避让原子标签 |

`drawnCopies(points, model, { repeat = true }) → { positions: Float32Array, index: Int32Array, img: Int32Array }`（B7，`render/display.js`，三处签名统一为这一个，E34）：
把结构坐标中的点按 `model.wrapRule` 包裹（含 U1 切口与边界副本规则）并在 `model.supercell` 中重复，使位点标记与画出的原子对齐。

#### 3.11.5 叠加层事件

视图发 `overlayhover {layer, index, item, x, y}`（离开时 `index: −1`）、`overlayclick {layer, index, item, x, y, mode}`、
`overlaydblclick`（同上）与 `overlaycontext`（同上，加 `clientX, clientY`；触屏长按 500 ms，C2）。
点击命中可拾取的叠加层、且没有工具处理器消费这次点击时，发 `overlayclick` **而不发** `atomclick`（A-D8）。

### 3.12 合并拾取、射线工具与原子信息

#### 3.12.1 接口

```js
ray(clientX, clientY) → THREE.Ray                                   // 世界坐标，当前相机（透视或正交）
pickAtomHit(clientX, clientY, ray = this.ray(clientX, clientY)) → { index, t } | null
pickAtom(clientX, clientY) → index | −1                             // 签名不变；P-swap 输入锁时恒为 −1
pick(clientX, clientY, { atoms = true, overlays = true } = {}) → Hit
Hit = { kind: 'overlay' | 'atom' | 'none', t, point, ray,
        atom: { index, src, t } | null, overlay: { layer, index, item, t, tier } | null }
pointOnPlane(clientX, clientY, point, normal) → THREE.Vector3 | null   // 平行（|n·d| < 1e-6）或在相机后方时为 null
pointOnLine(clientX, clientY, origin, dir) → { point, s } | null       // 直线上离射线最近的点（沿轴拖动）；平行时为 null
worldPerPixel(point) → number                                          // point 所在深度处每 CSS 像素的 Å 数（M4 要的 pixelsPerAngstromAt 是它的倒数，不另设）
```

#### 3.12.2 `pick` 的算法

```text
r = ray(x, y)
tool = 当前工具 id；可拾取的层 = visible && pickable && (pickIn == null || pickIn 含 tool)
a = (atoms && !inputLocked) ? pickAtomHit(x, y, r) : null
if overlays: top = 可拾取的 B 层各自 pick(r)；depth: 'atoms' 的层只保留 t ≤ a.t + 0.05 的命中（a 为 null 时全部保留）
             top 非空 → 返回 t 最小者（kind 'overlay'）                          // 画在最上，优先
s = 可拾取的 A 层命中中 t 最小者
if s && (!a || s.t <= a.t + 0.05)  → overlay s     // 标记紧贴原子时标记优先
else if a                          → atom a（附 src = model.src[a.index]）
else                               → none
point = r.at(t)（none 时 null）
```

`pickAtomHit` 就是现在 1381-1390 行的循环，多返回 `t`；被掩码隐藏的原子不在模型里，自然不会命中。
`worldPerPixel`：透视为 `2 · depth · tan(fov/2) / height`，正交为 `(top − bottom) / zoom / height`（同 `panBy` 1302-1304）。
复杂度 O(绘制原子 + 标记)；10k 原子约 1–2 ms（报告 03 实测 4.6k 绘制原子 2.3 ms，软件 GL）。

#### 3.12.3 原子信息（悬停卡与选区卡，A-D18）

`atomInfo(d)`（1394-1407）改为：

```js
atomInfo(d) → { display: d, index: src, symbol, name, cn,
                position: [x, y, z],        // 已提交结构的存储坐标（Float64，当前帧）；P-pos 预览中为预览坐标
                frac: [fa, fb, fc] | null,  // 存储分数坐标（与 Structure.fracPositions 同一公式），不包裹
                image: [a, b, c],           // storedImage(model, d)：这个绘制副本相对存储位置的格矢
                drawn: [x, y, z] }          // 绘制坐标（Float32）
```

悬停卡与选区卡显示 `position`/`frac`；`image` 非零时另起一行 `Drawn image (0, 0, −1)`。跨边界 slab 上存储为 z = 14.0 Å（frac 0.897）的原子，
无论 U1 把它画在哪里，卡片都显示 14.0 Å 与 0.897，与 CONTCAR 和导出文件一致（E10）。`registerAtomInfo` 的扩展行（B12）追加在后面。

### 3.13 工具注册表与指针钩子

#### 3.13.1 注册表（新 `render/tools/index.js`，纯模块，可在 node 中测试）

```js
export const tools = { register(def) → dispose, get(id), list() };
ToolDef = {
  id, title, icon, key = null, order = 100,
  toolbar = false,            // 是否在视图工具栏显示按钮（Select、Measure、Move 为 true）
  selects = false,            // 点击原子仍按 Select 的规则选择、空白处拖动仍框选（select、move 为 true）
  cursor = '',                // 进入工具时画布的 CSS 光标（move：'grab'；site-pick：'crosshair'）
  touch = 'none',             // 'claim'：单指/笔尖按下时询问 handler.claims(hit)
  when, whyNot,               // (app) => bool / string
  hint(app, env) → string[],  // 提示栏片段（HTML），env = {touch, mac, MOD, ALT}
  hud(app, env) → Node | null,// 视图上方的工具 HUD（现在的 measure HUD 位置）
  mouse = [],                 // 快捷键对话框 Mouse 区的行 [[按键, 说明]]
  activate(app, opts), deactivate(app, reason),
  handler(app, viewer, opts) → ToolHandler | null,
};
ToolHandler = {
  claims(hit, e) → boolean,   // 触摸/笔：这个按下是否归工具（M4：命中已选原子或手柄）
  down(e, hit, press) → boolean,       // 左键（或被认领的触摸）按下：true = 认领；先挂起，移动超过 CLICK_PX 才开始拖动
  begin(e, press),            // 认领的按下第一次移动超过 CLICK_PX：拖动开始（M4 在这里开 P-pos 会话、选中未选的原子）
  move(e, press),             // 拖动中
  up(e, press),               // 拖动正常结束
  click(e, hit) → boolean,    // 没有拖动的点击/轻触（不论是否认领）：true = 已处理（不再选择、不发 atomclick/overlayclick）
  cancel(press, reason),      // reason: 'esc' | 'lost' | 'pointercancel' | 'switch' | 'second-finger' | 'session'
  hover(hit, e),              // 无按键移动，rAF 节流（参数顺序 hit 在前；M4 改）
  keydown(e) → boolean,       // 画布有焦点时；true = 已处理
};
```

内置定义在 `render/tools/select.js`、`render/tools/measure.js`：

| id | 图标 | 键 | 工具栏 | selects | handler | 提示栏 / HUD |
|---|---|---|---|---|---|---|
| `select` | `pointer` | V | 是 | 是 | 无（视图内置框选/套索，`app._onAtomClick` 选择） | 现在 `shell.js:637-641` 的文案 |
| `measure` | `ruler` | M | 是（菜单） | 否 | 无（`app._onAtomClick` 729-743 的拾取逻辑不变） | 现在 631-635 的文案与 HUD |
| `move`（M4 实现） | `move` | G | 是 | 是 | M4 | §3.13.4 |
| `site-pick`（M5 实现） | `target` | 无 | 否（从 Adsorbates 分区进入） | 否 | M5 | §3.13.4 |

#### 3.13.2 `app.setTool(id, opts)`（替换 `app.js:721-726`）

```js
setTool(id = 'select', opts = {}) {
  if (typeof opts === 'string') opts = { measureType: opts };           // 兼容 setTool('measure', 'angle')
  let t = tools.get(id);
  if (!t) { console.warn(`Unknown tool “${id}”; using Select.`); t = tools.get('select'); }
  if (t.when && !t.when(this)) { toast(t.whyNot?.(this) ?? `${t.title} is not available now.`); return false; }
  const prev = this.toolDef;
  this.viewer.cancelToolPress('switch');
  if (prev && prev !== t) prev.deactivate?.(this, 'switch');
  this.tool = t.id; this.toolDef = t; this.toolOpts = opts;
  if (opts.measureType) this.measureType = opts.measureType;
  this.measurePicks = [];
  this.viewer.toolHandler = t.handler ? t.handler(this, this.viewer, opts) : null;
  this.viewer.renderer.domElement.style.cursor = t.cursor ?? '';
  t.activate?.(this, opts);
  this.emit('tool');
  return true;
}
```

`app.tool` 仍是字符串（`toolProvider`、文档、插件都依赖它）；新增 `app.toolDef`；视图新增 `toolSelects` getter（`app.toolDef.selects`，由 app 设置的 provider 给出）。
依赖 `'select'` 字符串的地方改成看 `selects`：`_leftPress`（401）、`_onAtomClick`（744-747 的选择分支）、`_onAtomDblClick`（756）、
shell 的 `boxselect` 监听（`shell.js:1049`）、触屏多选（1060、1076）。于是 Move 工具下点击、Shift 加选、Ctrl/⌘ 反选、双击选分子、触屏多选全部照旧。

#### 3.13.3 视图状态机的接缝（`render/viewer.js`）

```js
// _leftPress（395-404）：选择形状之前
const h = this.toolHandler;
if (h?.down && !this._held.has('r') && this.model?.n && !this.inputLocked) {   // R+拖动缩放框在所有工具里都有效
  const hit = this.pick(e.clientX, e.clientY);
  if (h.down(e, hit, p) === true) { p.kind = 'tool'; p.handler = h; p.started = false; return; }   // 挂起：还不是拖动
}
const select = this.toolSelects && !!this.model?.n && !this.inputLocked;                     // 替换 401 行

// _ptrDown（360-392）：触摸分支（371-373）与"笔尖无修饰键"分支（385 行的 else）
if (touch || (e.pointerType === 'pen' && button === 0)) {
  if (touch) for (const q of this._ptrs.values()) if (q.type === 'touch') {
    q.far = true; p.far = true;
    if (q.kind === 'tool') this._cancelTool(q, 'second-finger');   // 第二根手指：取消工具拖动（恢复原位）
  }
  const h = this.toolHandler;
  if (!p.far && h?.claims && this.model?.n && !this.inputLocked) {
    const hit = this.pick(e.clientX, e.clientY);
    if (h.claims(hit, e) && h.down?.(e, hit, p) === true) { e.preventDefault(); p.kind = 'tool'; p.handler = h; p.started = false; this._holdControls(p); this._capture(p); }
  }
}

// _ptrMove（444-472）：在 450 行的触摸提前返回之前
if (p.kind === 'tool') {
  if (p.cancelled || p.done) return;
  if (!p.started) { if (!p.far) return; p.started = true; p.handler.begin?.(e, p); }
  p.handler.move?.(e, p);
  return;                                                          // 工具拖动不参与左右键同按的缩放
}

// _ptrUp（475-490）：最前面
if (p.kind === 'tool') {
  p.done = true;
  this._endPress(e.pointerId);
  if (cancelled || p.cancelled) { if (!p.cancelNotified) { p.cancelNotified = true; p.handler.cancel?.(p, cancelled ? 'pointercancel' : 'esc'); } return; }
  if (!p.started) { this._tap(e); return; }                        // 没有拖动 = 普通点击：选择、双击、多选、handler.click 都走原路径
  p.handler.up?.(e, p);
  return;
}

// _endPress（493-505）：被动结束（失焦 viewer.js:291、丢失抬起）
if (p.kind === 'tool' && !p.done) { p.done = true; if (!p.cancelNotified) { p.cancelNotified = true; p.handler.cancel?.(p, 'lost'); } }

// _cancelShapes（508-512）：Esc（捕获阶段，viewer.js:294-297）
for (const p of this._ptrs.values()) if (p.kind === 'tool' && !p.done) { this._cancelTool(p, 'esc'); any = true; }

// 新私有方法
_cancelTool(p, reason) {                 // 取消一个工具按下：通知工具一次；按下本身留到指针抬起，之后的移动被忽略
  if (p.done || p.cancelled) return;
  p.cancelled = true;
  if (!p.cancelNotified) { p.cancelNotified = true; p.handler.cancel?.(p, reason); }
}

// _click（323-334）：轴向小部件判断之后
if (this.inputLocked) return null;                                // P-swap：不发 atomclick（也不发 index −1，选区不会被清空）
const h = this.toolHandler;
const hit = this.pick(e.clientX, e.clientY);
if (h?.click?.(e, hit) === true) return null;
if (hit.kind === 'overlay') { this.emit('overlayclick', { ...hit.overlay, x, y, mode }); return null; }
const i = hit.atom?.index ?? -1;   // 然后照旧 emit('atomclick', …)

// _tap（336-346）：双击时若上一次点击命中叠加层，发 overlaydblclick 而不是 atomdblclick
// _context（348-352）：inputLocked 时直接返回；命中叠加层时发 overlaycontext，否则照旧 atomcontext

// 悬停（264-268）：每帧一次 pick，同时供原子悬停、叠加层悬停和工具；inputLocked 时只做相机，不拾取原子
const hit = this.pick(ev.clientX, ev.clientY);
this.toolHandler?.hover?.(hit, ev);
this._setOverlayHover(hit.kind === 'overlay' ? hit.overlay : null, ev);
this._setHover(hit.kind === 'atom' ? hit.atom.index : -1, ev);

// 画布 keydown（298-307）：最前面
if (this.toolHandler?.keydown?.(e) === true) { e.preventDefault(); e.stopPropagation(); return; }

// 新公共方法
cancelToolPress(reason = 'switch')   // app.setTool 与会话被取消时调用：对所有 kind === 'tool' 的按下 _cancelTool(p, reason)
```

右键、中键、Alt+拖动、X/Y/Z+右键、滚轮、左右键同按缩放都不经过工具（`_ptrDown` 只把左键交给 `_leftPress`），
所以"所有工具都保留右键旋转"由结构保证。P-swap 预览时 `pick` 不返回原子，工具的 `down` 拿不到原子命中。

#### 3.13.4 四个工具的触屏与交互契约

| 工具 | 鼠标左键拖动 | 左键点击 / 双击 | 单指拖动 | 轻触 | 两指 | Esc |
|---|---|---|---|---|---|---|
| select | 框选（Q：套索；Shift 加选、Ctrl/⌘ 反选） | 选择 / 选分子 | 旋转 | 选择（多选开关照旧） | 平移/缩放 | 清空选区 |
| measure | 无（R+拖动缩放框照旧） | 拾取原子 | 旋转 | 拾取原子 | 平移/缩放 | 结束测量 |
| move（M4） | 按在原子或手柄上：移动（`begin` 时未选的原子先被选中，P-pos 会话）；按在空白处：框选（`selects`） | 选择 / 选分子（与 select 相同，经 `_tap`） | 按在已选原子或手柄上：移动（`claims`）；别处：旋转 | 选择 | 进行中的移动被取消并恢复；这次手势剩下的部分由相机按单指处理（旋转），抬起后恢复正常（R4） | 移动中：取消并恢复；否则回到 Select |
| site-pick（M5） | 无动作（R+拖动缩放框照旧） | 选位点（`click` 返回 true）；双击位点 = 直接放置（`overlaydblclick`） | 旋转 | 选位点 | 平移/缩放 | 回到 Select |

move 工具在 `begin` 中开会话 `beginStructureEdit(\`Move ${n} atoms\`, { kind: 'positions', owner: 'move-tool', transient: true })`，`move` 中 `preview`，
`up` 中 `commit()`（未移动则返回 null），`cancel` 中 `cancel()`。位移的计算（屏幕平面平移用 `worldPerPixel`，沿轴用 `pointOnLine`，绕轴旋转）属于 M4。

#### 3.13.5 提示栏、HUD、工具栏、快捷键对话框

- `updateHint()`（`shell.js:627-651`）：`select` 走现有分支；其他工具用 `app.toolDef.hint(app, env)`；HUD 槽（现在的 `measureHud`，507 行，类名保留 `measure-hud`）显示 `toolDef.hud(app, env)`，
  无 HUD 的非 Select 工具显示一个通用 HUD："<Tool title> · Esc to finish" + "Done" 按钮（回到 Select）。
- 工具栏（468-481）：Select、Measure 之后按 `order` 插入 `toolbar: true` 的工具按钮，`aria-pressed` 由 `updateHint` 同步（647-648 行的写法推广到所有工具按钮）。
- 快捷键对话框的 Mouse 区（1204-1212）追加各工具的 `mouse` 行（例如 move："Drag a selected atom — Move the selection (Move tool)"）。
- 选区卡片在 measure 下隐藏的规则（`selectioncard.js:169`）推广为"`toolDef.selects` 为假时隐藏"。
- 光标：shell 的悬停处理（`shell.js:512-516`）离开原子时恢复 `app.toolDef.cursor`，工具自己的 `hover` 可以再覆盖（move 工具在已选原子上设 `grab`，拖动中 `grabbing`）。

### 3.14 沿任意方向观察与表面法向

#### 3.14.1 `viewer.viewAlong(target, opts)`

```js
viewAlong(target, { up = 'auto', ortho = 'auto', animate = !reducedMotion(), refit = true } = {}) → { dir, up, label }
```

| `target` | 方向 `dir`（相机所在的一侧，与 `setView` 约定相同：相机在 +dir 上、朝 −dir 看） | 标签 |
|---|---|---|
| `'a' 'b' 'c' 'x' 'y' 'z'`（可加 `-`） | 交给现有 `setView`（1194-1214） | `along a` 等 |
| `'normal'` / `'-normal'` | `±surfaceNormal(structure).normal` | 按来源：`info`/`vacuum`/`pbc` → `along the surface normal` / `from below the surface`；`ab-plane` → `along c* (normal to a and b)`；多根真空轴 → `along the widest vacuum (b)` |
| `[x, y, z]`（有限数） | 笛卡尔矢量 | `along [x, y, z]`（保留 2 位小数） |
| `{ uvw }` / `{ uvtw }` | `latticeDirection(cell, uvw)`；四指数先 `uvtwToUvw` | `along [u v w] of the current cell`（四指数按最小整数显示，如 `[2 1̄ 1̄ 0]`） |
| `{ hkl }` / `{ hkil }` | `millerNormal(cell, hkl)`；四指数先 `hkilToHkl` | `along the normal of (h k l) of the current cell` |

校验与报错：其他输入 → `viewAlong: use a direction like [1, 1, 0], {uvw: [1, 1, 0]}, {hkl: [1, 1, 1]} or "normal".`；
uvw/hkl 不是整数 → `Lattice directions and Miller indices must be whole numbers.`；长度为 0 → `That direction has zero length.`；
需要晶胞而没有 → `Looking along a lattice direction needs a unit cell.`；`'normal'` 没有晶胞 → `Looking along the surface normal needs a unit cell.`。
`'normal'` 的来源是 `'ab-plane'` 时照样转向，并 toast `No vacuum gap found: looking along c* (normal to a and b).`（U1"没有间隙时给出说明"）。

**屏幕"上"向量**（`up: 'auto'`，D8 修订）：
1. 结构有表面（`surfaceNormal(s).surface` 为真）且 `|d̂ · n̂| < 0.99`（侧视）：`up` = n̂ 在垂直于 d̂ 的平面内的分量（单位化），顶面总在上方；
2. 俯视或仰视（`|d̂ · n̂| ≥ 0.99`）：屏幕"右" r = 第一根面内晶轴（i = k+1 循环，标准取向即 a）在垂直于 d̂ 方向上的分量，`up = d̂ × r̂`，于是 a 从左到右；
3. 没有表面、有晶胞：在 |u|,|v|,|w| ≤ 3 的整数组合中找与 dir 垂直（`|t̂·d̂| < 1e-6`）的最短格矢作为"右"，等长时依次取 u、v、w 较大者；找不到时退回 `setView` 的规则（c 的垂直分量，c 与 dir 平行时用 b；分子用 y/z）。

`up` 也可以直接传矢量（M2 预览切面时传表面网格的 U，使预览方向与将来的 slab 一致）。
**实测**（`sideview2.mjs`，Pt(111) p(3×3)）：v1 规则沿 [1 0 0]、[1 1̄ 0]、[2 1 0] 把 slab 画倒；v2 沿 [0 1 0]、[1 1 0]、[1 2 0]、[1 0 0]、[1 1̄ 0]、[2 1 0]、[1̄ 0 0] 顶面都朝上。

**正交相机**（`ortho: 'auto'`）：与 `setView` 1209-1212 相同。最后调用 `setViewDirection(dir, up, animate, refit)`（1167-1187）。

**方向标签**：画在轴向小部件正上方，由 C 层的 `textLayer` 实现（`viewAlong` 只设置它的内容，不改 `drawOverlay`，减少与 T4 的冲突，E15）；
在 `_leaveTempOrtho`、相机控件 `start`（228-233）、`orbitBy`、`rotateScreen` 时清除；导出时不画（`export: 'never'`，除非 `gizmo: true`）。
同时更新一个视觉隐藏的 `role=status` 元素（"Looking along the surface normal"），供读屏器。

#### 3.14.2 表面法向 `surfaceNormal`（JS `core/vacuum.js`，`core/lattice.js` 重新导出；Python `facet/analysis/vacuum.py`）

```text
surfaceNormal(s, {frame}) → { normal: [x, y, z], axis: k, source, surface: boolean, vacuumAxes: k[], cut: GapCut | null } | null
没有晶胞或晶胞奇异 → null
hintAxis ← info.surface.axis（0、1、2 的整数时），否则 null
cuts[k] ← gapCut(s, k, {frame, hint: k === hintAxis})，k = 0, 1, 2（周期轴与非周期轴都算）；vacuumAxes ← 有结果的轴
规则 1（'info'）：hintAxis 有切口，且它的 empty ≥ 所有轴中最大的 empty − positionTolerance        （提示必须仍是最宽的真空，过期的提示被拒绝）
规则 2（'vacuum'）：empty 最大的轴（并列按 c、b、a）
规则 3（'pbc'）：恰好一根非周期轴（二维原型、c 很短时）
规则 4（'ab-plane'）：k = 2，surface = false（体相沿 c* 看）
n̂ = unit(a_i × a_j)（i, j = k+1, k+2 循环），取 n̂ · a_k > 0 的方向                          （顶面 = +a_k 一侧；右手晶胞即 a×b 方向，与 pymatgen 相同）
surface = source ∈ {'info', 'pbc'}，或 source = 'vacuum' 且只有一根真空轴（线、盒中分子 surface = false）
```

- **不读笛卡尔 `info.surface.normal`**（D3、E3）：它在刚性转动、重定义晶格、轴置换后都会过期；法向一律由当前晶胞现算，转动自动正确。
  `info.surface.axis` 过期（例如 `P = [[0,0,1],[1,0,0],[0,1,0]]` 重定义后真空在 a′，`axis = 2` 指向 8.32 Å 的面内轴）时，该轴没有最宽的真空，提示被拒绝，落到规则 2。
- **c 反向**：行列式为 +2 的 `[[1,1,0],[1,-1,0],[0,0,-1]]` 等矩阵会让 c 反向，顶面随之变成另一面（+a_k 约定）。这是确定性的、与 pymatgen 相同；
  `imatrixInput` 的 `warn` 钩子在应用前提示（D15，文案由 M1 写，§10.0）。
- M3 判断顶层/底层、"固定底部 N 层"，M5 判断放在哪一面，都用这个函数与它返回的 `cut`（`cut.main.upper` 是主块的顶面、`cut.lo` 是窗口），两种语言结果一致（金标）。
  判断"有没有表面"必须看 `surface`（M3/M4 原来期望"非 slab 返回 null"，§10.0）。
- **原型核对**（`view_hkil.mjs`、`vacgap.mjs`、`parity.py`）：标准取向 slab 法向 [0, 0, 1]；c 倾斜的 CONTCAR（c = [1.5, 0.7, 21.8]）法向 [0, 0, 1]（a×b，不是 ĉ）；
  石墨烯 pbc T T F、c = 15 Å：规则 2（非周期轴上的 15 Å 间隙）；pbc T T T：同；fcc 体相、石墨：规则 4；盒中 CO：规则 2、`surface: false`。

#### 3.14.3 晶格辅助函数（`core/lattice.js` 由 F0-D 创建，F0-A 在第 0 波追加下表，M1 之后追加；Python 同在 `core/lattice.py`）

| JS | Python | 说明 |
|---|---|---|
| `reciprocalCell(cell)` | `reciprocal_cell`（已有，`core/lattice.py:93`） | 行是 a*、b*、c*，不含 2π |
| `millerNormal(cell, hkl)` | `miller_normal(cell, hkl)` | `n = hkl @ inv(cell)ᵀ`，单位化 |
| `latticeDirection(cell, uvw)` | `lattice_direction(cell, uvw)` | `uvw @ cell`，单位化 |
| `isHexagonalCell(cell, {lengthTol = 1e-3, angleTol = 0.1})` | `is_hexagonal_cell(cell, length_tol=1e-3, angle_tol=0.1)` | 某根轴 k 与另两根垂直、另两根等长且夹角 120° 或 60° → `{axis: k, gamma}`，否则 null；先试 k = 2。只用于 Miller 控件的四指数显示；表面网格类型由 M1 的二维度量判断（`mesh_type`），不用它（D6） |
| `hklToHkil([h,k,l])` / `hkilToHkl([h,k,i,l])` | `hkl_to_hkil` / `hkil_to_hkl` | 后者在 `h + k + i ≠ 0` 时抛错（文案见 §3.15） |
| `uvwToUvtw([u,v,w])` / `uvtwToUvw([U,V,T,W])` | `uvw_to_uvtw` / `uvtw_to_uvw` | `U = (2u − v)/3, V = (2v − u)/3, T = −(U + V), W = w`；反向 `u = U − T, v = V − T, w = W`；`uvwToUvtw(v, {integer: true})` 乘以 3 后约去公因子，`[1, 0, 0]` → `[2, −1, −1, 0]` |
| `centeredCellHint(cell)`（新，B15） | `centered_cell_hint(cell)` | a = b = c（相对 1e-3）且 α = β = γ = 60°（±0.1°）→ `{kind: 'fcc', toConventional: [[-1,1,1],[1,-1,1],[1,1,-1]]}`；109.47° → `{kind: 'bcc', toConventional: [[0,1,1],[1,0,1],[1,1,0]]}`；否则 null。惯用胞指数 `hkl_c = hkl_p @ toConventionalᵀ`，约成最小整数 |
| `formatIndices(v, '(' \| '[' \| '{' \| '<')` | — | 界面用："(1 0 1̄ 0)"，负数用 U+0305 上划线；`ariaIndices(v)` 给读屏用（"1 0 minus 1 0"，E23） |

四指数只用于"c 为唯一轴、γ = 120°"的设置；γ = 60° 的设置显示三指数并提示 `Four-index (h k i l) notation needs the γ = 120° setting.`。

#### 3.14.4 Miller 指数相对当前晶胞（D4）

(h k l) 总是相对**当前晶胞**的基矢（ASE、pymatgen、MS 都如此）。v1 §7.6 写的"惯用胞与原胞给出同一法向"只对 (111) 成立。`miller_basis.py` 核对：

| 晶胞 | 输入 | 实际是惯用胞的 | d | 与同名惯用胞晶面的夹角 |
|---|---|---|---|---|
| fcc Pt 原胞（α = 60°） | (1 0 0) | (1̄ 1 1) | 2.263 Å | 54.74° |
| | (1 1 0) | (0 0 1) | 1.960 Å | 90° |
| | (1 1 1) | (1 1 1) | 2.263 Å | 0° |
| | (2 1 1) | (0 1 1) | 1.386 Å | 54.74° |
| bcc Fe 原胞（α = 109.47°） | (1 0 0) | (0 1 1) | 2.027 Å | 90° |
| | (1 1 0) | (1 1 2) | 1.170 Å | 54.74° |
| | (2 1 1) | (2 3 3) | 0.611 Å | 29.50° |

因此：`millerInput` 的读数行总写 `(h k l) of the current cell`；`centeredCellHint` 识别出 fcc/bcc 原胞时追加
`This is a primitive cell: (1 0 0) here is the conventional (1̄ 1 1) plane. Use Cell › Conventional cell first, or enter indices for this cell.`（"Cell › Conventional cell" 由 M1 提供）；
其他心格（菱方、底心……）由 M1 的 `millerBasisNote(cell, hkl)` 经 `describe` 给出。指数不会被悄悄换算；`directions.json` 加上表的用例（期望值按原胞基矢）。

### 3.15 参数 schema 的新类型（JS `core/params.js`，Python `facet/core/params.py`）

**schema 字段**：

| type | 字段 | 值（JSON） | 默认值 |
|---|---|---|---|
| `int` / `float`（已有） | 新增 `unit`（只显示，如 `'Å'`、`'°'`、`'%'`、`'ML'`）、`required`（必填：无 `default` 时初始为空） | 数 | `required` 时为 `null`，否则同现在（`min ?? 0`） |
| `vector` | `integer = false`、`nonzero = false`、`size = 3`（2 或 3）、`frame = 'cartesian'`、`frames = [frame]`、`unit = 'Å'` | `[x, y, z]`（`size: 2` 时 `[u, v]`） | 全 0 |
| `miller` | `max = 30`（硬上限）、`warnAbove = 12`（软提示 `High-index plane; the surface cell may be large.`）、`hexagonal = 'auto'` | `[h, k, l]`（总是三指数；输入四指数时换算；不约去公因子） | `[1, 1, 1]` |
| `imatrix` | `size = 3`（2 或 3）、`max = 50`、`maxDet = null`（不设硬上限，原子数由命令的 `estimate` 与 `LIMITS.maxAtoms` 把关）、`warnDet = 400`（软提示）、`positive = true`、`presets = null` | `[[…], …]` | 单位矩阵 |

M1 需要更大的范围时按字段覆盖（如 `max: 1000, maxDet: 1e6`，M1 请求）；从 1×1 slab 做 p(41×41)（det 1 681）或 p(30×30) 石墨烯（det 900）不再被硬上限拦住（D12）。

**解析**（`parseIndices(text, {fractions})`，CLI 字符串和控件粘贴共用；`parse2.py` 已验证）：
1. 文本以 `[` 或 `{` 开头**且含逗号**、并且能按 JSON 解析（拒绝 `NaN`/`Infinity`）时取 JSON；否则
2. 把 U+2212 `−` 换成 `-`，把"数字 + U+0305/U+0304"（`formatIndices` 的上划线写法）换成负数；去掉一对外层括号 `()[]{}<>`；
3. 含 `;` 时按 `;` 分行（忽略末尾空行），每行按 `[\s,]+` 分词；每个词必须匹配 `^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$`，含小数点或指数的是浮点数，否则是整数；
   `fractions` 为真（非整数的 `vector`）时另接受 `p/q`；
4. 所有数必须有限；`imatrix` 收到正好 n² 个数的一行时按行填满；
5. 任何失败都映射到该类型在下表中的文案（不暴露 JSON 解析器或"not a number"的原文，两种语言才能逐字相同，E17）。

例：`[1 1 0]` → `[1, 1, 0]`；`{1 1 1}` → `[1, 1, 1]`；`(1 0 1̅ 0)` → `[1, 0, 0]`；`1 0 −1 0` → `[1, 0, 0]`；`1/3 2/3 0`（vector）→ `[0.333…, 0.667…, 0]`；
`2 1 -1 1`（2×2）→ `[[2, 1], [-1, 1]]`；`[NaN, 0, 0]` → 文案；`(1 0 0 0)` → `hkl: in (h k i l), i must be −(h + k) = -1.`。

**`coerceParam` 只接受 JSON 类型**（数、布尔、字符串按 schema；字符串 `'4'` 不是整数），CLI 先用 `parse_cli_value(spec, text)` 把命令行字符串转成 JSON 值
（`int`/`float` 用 `int()`/`float()`，新类型用 `parse_indices`），再交给 `coerce_param`；共享金标因此只描述 JSON 输入的行为（E18）。

**报错文案**（两种语言逐字相同；公式里的 `−` 是 U+2212，算出来的数字用 ASCII `-`；`<Label>` 是字段标签，命令里的前缀是去掉结尾省略号的命令标题）：

| 情形 | 文案 |
|---|---|
| 必填为空 | `<Label>: enter a value.` |
| int/float（已有） | `<Label>: enter a number.` · `<Label>: enter a whole number.` · `<Label>: use a value from <min> to <max>.` |
| vector | `<Label>: enter three numbers, like 0 0 1.` · `<Label>: enter three whole numbers, like 1 1 0.` · `<Label>: enter two numbers, like 0.5 0.5.` · `<Label>: the vector cannot be zero.` |
| miller | `<Label>: enter three whole numbers (h k l) or four (h k i l), like 1 1 1.` · `<Label>: in (h k i l), i must be −(h + k) = <n>.` · `<Label>: (0 0 0) is not a plane.` · `<Label>: use indices from −<max> to <max>.` |
| imatrix | `<Label>: enter a <n>×<n> matrix of whole numbers, rows separated by ';'.` · `<Label>: every entry must be a whole number.` · `<Label>: use entries from −<max> to <max>.` · `<Label>: the matrix is singular (determinant 0).` · `<Label>: the determinant is <det>; a negative determinant mirrors the cell. Swap two rows or negate one.` · `<Label>: determinant <\|det\|> is too large (at most <maxDet>).`（只在设了 `maxDet` 时） |
| 软提示（不阻止） | `High-index plane; the surface cell may be large.` · `This makes <det>× the atoms.` |
| 未知参数（命令） | `<Command title>: unknown parameter “<key>” (use <k1>, <k2>, …).` |

**函数**：

```js
// core/params.js（纯模块）
export class ParamError extends Error {}
export function parseIndices(text, { fractions = false } = {}) → number[] | number[][]
export function coerceParam(spec, value) → 规范化后的值（失败抛 ParamError）
export function validateParams(schema, values, { strict = false, title = null } = {}) → { values, errors: string[], warnings: string[] }
export function defaultParams(schema, structure = null)     // 从 core/analyses.js:43-55 移来，analyses.js 重新导出
```
```python
# facet/core/params.py
class ParamError(ValueError): ...
def parse_indices(text: str, *, fractions: bool = False) -> list
def parse_cli_value(spec: dict, text: str) -> Any
def coerce_param(spec: dict, value) -> Any
def validate_params(schema, values, *, strict=False, title=None) -> tuple[dict, list[str], list[str]]
def default_params(schema) -> dict
```

`paramForm`（`ui/paramform.js:27-78`）：新类型用 `ui/inputs.js` 的控件渲染；`unit` 显示为后缀；`required` 为空时 `validate()` 返回 "enter a value."；
返回对象新增 `valid`（getter）与 `onValidity(cb)`，面板据此让主按钮不可用（U4）。
CLI：`facet/cli.py` 的 `_coerce`（73-92）改为 `parse_cli_value` + `coerce_param`；`parse_params`（94-107）把整个 spec 传进去；
缺少必填参数时报 `--param <key>: enter a value.`；报错只加一次前缀（现写法会成为 `--param hkl: hkl: …`，cli.py:103-106）。
REST：插件构建器/分析声明了 `params` 时，`/build/custom/{name}`（`server/routes/build.py:126-147`）与 `/analysis/custom/{name}` 先调用
`validate_params(spec.params, body, strict=False)`：未知的类型原样放行，失败返回 422（文案同上表），成功把规范化后的值（四指数换成三指数等）传给插件（E25）。
`docs/PLUGINS.md` 参数表（97-108）加三行与 `unit`、`required`。

### 3.16 命令：参数校验、别名与守卫（`core/commands.js`）

- `register(c)` 接受新字段：`params`（schema）、`aliases`（字符串数组）、`ms`（MS 菜单路径，只显示）、`estimate(app, params) → 原子数`、
  `edits = false`（为真时把 `canEdit` 与 `editWhyNot` 组合进 `when`/`whyNot`）。
- **校验放在 `register` 生成的包装函数里**（`commands.js:29-32`）：`entry.run(params)` 收到参数对象时——不论来自 `commands.run`、`commands.get(id).run(...)`、
  嵌入页还是插件——都先：
  1. 参数必须是普通对象，否则 `<title>: pass the parameters as an object.`；
  2. `validateParams(c.params, params, { strict: true, title })`，有错误就抛 `{ code: 'invalid-params', message: errors[0] }`；
  3. `estimate` 超过 `LIMITS.maxAtoms`（默认 200 000，与服务器 `DEFAULT_MAX_ATOMS` 相同，`facet/config.py:64`；偏好 `maxAtoms` 可调到 2 000 000）时抛
     `{ code: 'too-large', message: '<title>: this would make <n> atoms; the limit is <max>.' }`；超过 30 000 时交互调用先确认（M2 请求）；
  4. 调用 `run(app, cleanParams)`。不带参数时照旧 `run(app)`，由命令打开对应面板分区（交互式）。`title` 去掉结尾的 `…`。
- 命令面板、快捷键调用 `c.run()` 不带参数，不受影响；嵌入页的 `facet:call command`（`api/embed.js:82-90`）与 `api.command` 走同一个包装，因此被校验。
- "打开分区"的回退实现（§5.8）只在该 id 还没有注册时注册（`if (!commands.get(id))`），并在 `main.js` 里先于模块导入执行，模块的真实实现总能覆盖它（E26）。
- `view.along` 的"恰好一个参数"在 `run` 中检查：`Look along: give exactly one of uvw, hkl or vector.`。
- 排序：`rankCommands`（`shell.js:73-101`）移到纯模块 `ui/rank.js`（shell.js 重新导出），别名按标题的同样规则打分（1000/900/800），比同类标题匹配低 5 分；
  返回 `{ cmd, alias }`，结果行在命中别名时显示灰色别名（B5）。`reference()`（`api/public.js`）输出 `aliases`、`ms`、`params`。
- 类别：`CATEGORY_ORDER`（`shell.js:103`）在 `'Edit'` 后加入 `'Cell'`、`'Surface'`。

### 3.17 面板分区外壳（新 `ui/sections.js`）与 Surface 面板（新 `ui/panels/surface.js`）

```js
registerPanelSection(panelId, {
  id, title, order = 100, slot = 'main', defaultOpen = true,
  available(app) → true | string,         // 字符串 = 就地显示的原因（U1：工具自己说明，不按 slab 分类）
  emptyActions(app) → Node[],              // 原因下方的按钮，例如 [Build vacuum slab…]
  render(app, el, shell, ctx),             // ctx = { section, open }
  signature(app) → string,                 // 分区自己的签名：变了才重绘这个分区
  refreshOn = ['project', 'structure'],    // 哪些 app/视图事件后检查签名
  badge(app) → string | null,              // 标题右侧的灰色短文本（如 "(1 1 1)"）；不得用来标记"是否 slab"（U1）
}) → dispose
renderSections(panelId, app, el, shell, { slot = 'main' })
refreshSections(panelId, reason)           // 由 ui/sections.js 自己订阅事件后调用
openSection(panelId, sectionId, { focus, tab } = {})   // 打开面板、展开并滚动到分区、聚焦 focus 指定的控件（data-key）
```

- 每个分区渲染为 `<details class="sec" data-sec="<panel>.<id>">` + `<summary><h3>title</h3><span class="badge"/></summary>` + **自己的主体容器**；
  展开状态记在偏好 `sections`；渲染出错时主体显示 `This section failed to load: <message>`（同 `renderDrawer` 386 行）。
- **分区单独重绘**（E27）：`ui/sections.js` 订阅所有分区 `refreshOn` 里的事件；事件发生且该面板正显示时，对每个分区比较 `signature(app)`，
  只重绘签名变了的分区（`replaceChildren` 它的主体，保留焦点与滚动位置，用户正在该分区输入时等离开输入框再重绘，同 `_deferRender`）。
  面板级签名只含 `[activeStructure, structureKey(app), 分区列表与各自 available 的结果]`，选区变化不再重绘整个面板。
- `available()` 返回字符串时主体只显示 `p.hint` 原因和 `emptyActions`。
- `shell.openLeft(id, { section, focus, tab })` 委托给 `openSection`（M3、M4 请求的深链接）。
- **Surface 面板**：`registerLeftPanel({ id: 'surface', title: 'Surface', short: 'Surface', icon: 'surface', tip: 'Cleave surfaces, set the vacuum, fix layers and place adsorbates', refreshOn: ['project', 'structure'], signature, render })`。
  - 没有结构：整面板空状态（§5.2）。
  - 有结构：按 `order` 渲染 Cleave（10）、Slab（20）、Layers（30）、Adsorbates（40）、Interface（50，M6）。某分区没有模块注册时（开发期间）显示 `Not available in this build yet.`。
- **Structure 面板插槽**（`ui/panels/structure.js`）：`render`（86 起）在摘要（117 行）之后插入 `renderSections('structure', app, el, shell, { slot: 'cell' })`，
  在 Selection（129-146）之后插入 `{ slot: 'transform' }`；分区同样单独重绘。现有 Tools 分区（170-186）不动，M1 决定是否把 "Wrap into cell"、"Make supercell real" 移进 Cell 分区。
- M3 的 `registerSurfaceSection`、M6 的同名函数就是 `registerPanelSection('surface', …)`，由它们改名（§10.0）。

---

## 4. 数据

- **props**：F0-A 不写任何 props。撤销快照把 `selective_dynamics` 打包成 `Uint8Array(3n)`（仅当每个条目都是长度 3 的布尔数组）、int32 范围内的整数数组（`tags`、`adsorbate_id`）
  打包成 `Int32Array`、有限数数组（`occupancy`、越界整数）打包成 `Float64Array`，其余按 JSON 字符串保存；恢复后与原值逐项相同（含 C3 的"全 T 数组保留"）。
  显示层读 `props.adsorbate_id`（按组包裹，B10）；"Property" 配色的默认属性跳过 `tags`、`adsorbate_id`（B14）。
- **info**：只读 `info.surface.axis`（`surfaceNormal` 的提示，经过校验，C6；字段由 M2 定）。**不读** `info.surface.normal`。F0-A 不写 info；
  `deleteSelected`、`replaceSelected` 调用 F0-D 的 `invalidateSymmetryInfo`（C7）。
- **结构对象的运行时字段**：用 F0-D 的 `Structure.rev`（不序列化，A4）。
- **pbc 与坐标**：F0-A 不改任何结构的 pbc 或坐标；U1 的切口与按组包裹只影响绘制（`model.positions`、`model.home`），导出、保存、撤销快照都与之无关。
- **测量**（新，§3.9）：项目 JSON 中每个结构条目的 `measurements: [{type, refs: ["i:a,b,c", …]}]`，像相对存储坐标、首个为 0。
  旧文件的 `{type, keys}` 在加载时迁移并以新格式写回；保存时只写 `refs`。`docs/SCHEMA.md` 记录这一格式与迁移规则。
- **源映射**：`editActive`/`replaceActiveStructure` 接受 `indexMap`（旧→新）或 `src`（新→旧，C2-I3），都没给时用 F0-D 的追踪器；
  `invertSourceMap` 用 F0-D 导出的那一个（F0-A 不再另写）。选区、测量、可见性掩码、命名高亮都按它重映射；`imageShift` 改写测量的像；`latticeChanged` 时丢弃像非零的测量。
- **偏好**（`localStorage`，不进项目）：`exportSelection`（布尔，默认 true）、`exportMarkers`（默认 false）、`sections`（分区展开状态）、
  `millerIndices`（`'auto' | 'hkl' | 'hkil'`，默认 `'auto'`）、`maxAtoms`（默认 200 000）。
- **scene**：不新增键（`display.gapCut` 改为视图属性，E30）。方向标签、可见性掩码、命名高亮、叠加层、预览都是临时状态，不保存。
- **命名**：F0-A 不产生结构名。撤销标签沿用现有约定（句首大写、动词开头、`plural()`、`×`、`Å`）：`Delete N atoms`、`Change N atoms to X`、
  `Add <name>`、`Remove <name>`、`Edit structure`；会话标签由调用模块给出（如 `Move 2 atoms`、`Set vacuum`、`Cleave Pt(111)`）。
- **多帧**（C11）：`editActive({singleFrame: true})` 与 P-pos 会话（默认 `singleFrame`）只保留当前帧并提示 `Kept frame k of N and dropped the others.`（带 Undo）；
  删除原子在所有帧上删除（各帧仍一致，不丢帧）；`editActive` 对多帧结构总做完整快照；P-pos 预览只画当前帧；会话期间轨迹播放暂停。
- **部分占位**（C12）：与本模块无关；快照照常保存 `occupancy`。

---

## 5. 界面

### 5.1 位置总览

| 内容 | 位置 |
|---|---|
| Surface 面板 | 左侧 rail 第 5 个按钮（Projects、Library、Build、Structure 之后），Shift+5 |
| Cell / Transform 分区 | Structure 面板：摘要之后 / Selection 之后（M1 / M4 填充） |
| Move 工具按钮 | 视图工具栏 Select、Measure 之后（M4 注册，`toolbar: true`） |
| 预览条 | 视图上方居中（窄屏：顶栏下方通栏）；与工具 HUD 同时出现时预览条在上 |
| 方向标签 | 轴向小部件正上方 |
| "N hidden · Show all" | 状态栏统计之后 |
| Include selection highlight / Include markers | 导出菜单 Image 组末尾的两个勾选项 |
| 视图菜单新项 | `shell.js:764-775`："Surface normal (top)" N、"Surface normal (bottom)" Shift+N、"Direction or plane…" |

### 5.2 Surface 面板

```
Surface                                                   [×]
▾ Cleave                                     (1 1 1)
    …M2…
▾ Slab
    …M2…
▸ Layers
▸ Adsorbates
▸ Interface
```

- 默认展开 Cleave 与 Slab，其余折叠；之后按用户的选择记住（`prefs.sections`）。分区不随结构类型变化（U1）。
- **没有结构时的整面板空状态**：标题 `Load a bulk crystal first.`；正文
  `Open a CIF or POSCAR file, pick a crystal in the Library, or build one. Then cleave a surface, set the vacuum, fix layers and place adsorbates here.`；
  按钮 `Open file…`（`file.open`）、`Library`（`shell.openLeft('library')`）、`Build crystal`（`shell.openLeft('build')`）。
- **分区就地说明的通用文案**（`ui/sections.js` 导出辅助函数，模块可直接用或改写）：
  - `requireCell(app)`：`This structure has no unit cell. Surface tools work on crystals and slabs with a unit cell.`
  - `requireVacuumGap(app)`：`surfaceNormal(s).surface` 为假时显示 F0-D 的 `vacuumGapHint(s)`（首字母大写、加句号，带实测值），例如
    `No vacuum gap of 5 Å or more along a cell vector (the widest is 4.4 Å along c); add vacuum first.`；`emptyActions` 为 `Build vacuum slab…`（`surface.vacuum` 已注册时）。
    pbc T T F 的结构只要非周期轴上有真空就算有（D5）；有多根真空轴（线、盒中分子）时说明 `Vacuum along b and c: this is not a slab with one surface normal.`。
  - `requireNoPreview(app)`：`Apply or cancel the current preview first.`（另一个模块的预览进行中时）。
- 分区标题右侧的 `badge` 只放该工具的当前参数（如 Cleave 的 "(1 1 1)"），**不得**放"slab""bulk"之类的分类（U1）。

### 5.3 Structure 面板插槽

Cell 插槽紧跟摘要（formula、a b c、α β γ 等）；Transform 插槽紧跟 Selection。插槽内的分区同样是可折叠的 `details.sec`，各自重绘。
没有模块注册时插槽为空，不显示任何东西。

### 5.4 选区卡片与原子右键菜单

```js
registerSelectionAction({ id, label, short = label, icon, tip, kbd, order = 100, card = true, menu = true,
                          when(app, sel) → bool, run(app, sel) }) → dispose
```

- 现有 5 个动作改由这个注册表提供：Centre（10）、Same element（20）、Measure（30，**1–4 个原子**：1 个时是现有的 "Measure from this atom"，`selectioncard.js:205`）、Replace…（40）、Delete（50）。
- 顺序号是契约：M3 的 Fix/Free 为 35/36（排在 Replace 之前，表面工作流里最常用），M4 的 Move…/Rotate… 为 60/61，M1 的 `cell.atomToOrigin` 只进菜单（`card: false`）。
- 卡片在桌面显示 `when` 为真的前 7 个动作，窄屏（触屏）显示前 5 个；还有更多时最后一个位置是 `More`（图标 `more`），`showMenu` 列出其余。
  触屏下每个按钮仍带短标签（`btn.stack`），手机竖屏放得下 6 个。
- 选区含被掩码隐藏的原子时，标题行显示 `12 selected (9 hidden)`；Delete、Replace 作用到隐藏原子时先确认（模态框只用于确认，§4 简报）：
  `9 of the 12 selected atoms are hidden. Delete them too?`，按钮 `Delete all 12` / `Only the 3 visible` / `Cancel`。Fix/Free 等非破坏性动作不确认。
- 原子右键菜单（`shell.js:807-834`）在 "Measure from here" 之后插入 `menu: true` 的已注册动作（分隔线隔开）；空白处的菜单在有可见性掩码时加 `Show all atoms`。
- 会话进行中、`selects` 为假的工具下、或 P-swap 预览时，卡片隐藏（§3.6.3）。

### 5.5 状态栏

- 有掩码时：统计之后加 `216 hidden` 与按钮 `Show all`（`view.showAll`，清空所有掩码并发 `visibility`），tip：`Atoms hidden by surface tools (Surface › Layers). Show all brings them back.`
- P-swap 预览时：`Preview · 36 atoms`（预览结构的原子数）。

### 5.6 输入控件（`ui/inputs.js`）

所有控件返回 `{ el, value, set(v, { silent }), validate() → string | null, setError(msg | null), focus(), valid }`，并接受 `key`（保持焦点，`shell.js:122`）。
`onChange(value)` 在每次**有效**修改时触发；`onCommit(value)` 在 Enter 或失焦时触发。无效时相关输入框设 `aria-invalid="true"`，
控件下方 `p.err-text.field-err`（带 id，输入框 `aria-describedby` 指向它）显示 §3.15 的文案；软提示用 `p.hint.field-warn`。

| 控件 | 外观与行为 |
|---|---|
| `numberInput({label, value, unit, min, max, step, integer, required, onChange, onCommit})` | `input.field.num` + 后缀单位；`required` 且值为 `null` 时显示为空、**没有占位数字**（U4），主按钮不可用 |
| `vec3Input({label, value, size = 3, labels, frame, frames, cell, integer, nonzero, unit})` | 三个（`size: 2` 时两个，标签默认 `u v`，M6 请求）框，标签 x y z（笛卡尔，Å）或 a b c（分数）；`frames` 有两项以上且有晶胞时右侧小切换 `Å / frac`（B11 的 `surface` 显示为 `u v h`），切换时用当前晶胞换算显示值，返回值总在 schema 的 `frame` 中；粘贴 "0.5, 0.5, 0" 或 "1/3 2/3 0" 到任一框自动分配 |
| `millerInput({label, value, cell, hexagonal = 'auto', max, warnAbove, describe})` | 三框 `h k l`；`isHexagonalCell(cell)` 为六方（γ = 120°）时四框 `h k i l`，`i` 只读（`aria-readonly`，tip "i = −(h + k)"），右侧 `hkil / hkl` 文字切换（记入 `prefs.millerIndices`）；下方读数行：`formatIndices` 结果 + ` of the current cell` + 公因子说明（`(2 2 2) = the (1 1 1) plane`，不改输入值）+ `centeredCellHint` 的原胞提示 + `describe(value)` 的附加信息（如 M2 的 "d = 2.265 Å"、M1 的 `millerBasisNote`）；粘贴 "1 0 -1 0"、"(1 0 1̄ 0)" 自动分配并换算 |
| `imatrixInput({label, size, value, presets, positive, max, maxDet, warnDet, warn, rowLabels, colLabels})` | 2×2 或 3×3 整数网格，行标签 `a′ b′ c′`（2×2 时 `U′ V′`），列标题 `a b c`（`U V`）；下方读数 `det 3 · 3× the atoms`（2×2：`det 3 · 3× the area`）；调用方可传 `area(value) → string` 替换读数（M1 用它给出相对原始表面网格的面积与 Wood 标签，D6）；`presets` 为数组或函数 `(ctx) → [{label, value, hint, applicable, why, params}]`（M1 的 `woodPresets(mesh, {primitive})`；带 `params` 的预设如 `Rectangular (n × m√3)…` 弹出两个整数框）；不适用的预设灰显并在 tip 里写 `why`；`warn(value) → string \| null` 显示软提示（M1：`This matrix turns the slab upside down (c reverses); the top and bottom surfaces swap.`、`This repeats the slab along the vacuum axis; use a 2×2 surface matrix.`）；粘贴 "2 1 0; -1 1 0; 0 0 1" 或 9 个数自动填满 |

- `setInvalid(input, message, slot)`：在 `paramForm` 之外复用同一套无效样式与提示位置（M4 的元素输入用它设 `aria-invalid`）。
- U4："会话内记住用户上次填的值"由调用模块负责（模块级变量，不写偏好、不写项目）；控件本身从不填默认值。
- CSS（`css/app.css`）：把 663 行只在 `.pf-field` 内生效的规则改成全局 `input.field[aria-invalid="true"], select.field[aria-invalid="true"] { border-color: var(--err); }`；
  新增 `.v3`、`.miller`、`.imatrix`（网格、`gap: 6px`、等宽数字）、`.num-in .unit`、`.field-err`、`.field-warn`。数值框沿用 `.triple` 的宽度规则（212-214）。
- 键盘与数字框（E23）：数值框是 `type="number"`（iOS 上给出带负号的数字键盘，`inputmode="decimal"` 没有负号）；获得焦点时屏蔽滚轮改值（`wheel` 监听 `preventDefault` 并把滚动交还给面板），
  避免滚动面板时意外改矩阵或真空并触发 P-swap 重建；`validity.badInput` 为真（只输入了 `-`）时视为"正在输入"，不报 "enter a value."；粘贴在 `paste` 事件里拦截并分配；
  Enter = `onCommit`；矩阵里 Tab 按行移动。

### 5.7 预览条与工具 HUD 文案

| 场合 | 文案 |
|---|---|
| 预览条 | `Preview: <label>` · 按钮 `<Apply \| Create>`（tip `Apply (Ctrl Enter)`）、`Cancel`（tip `Esc`）、图标按钮 tip `Fit to screen` |
| P-swap 附加说明（宽屏） | `Atoms can’t be selected during a preview.` |
| P-swap 降级 | `Preview updates when you finish typing.` · 按钮 `Show atoms`（大结构只画晶胞轮廓时） |
| 取消后的 toast | `Preview cancelled` |
| 被其他操作打断 | `Preview cancelled: <reason>`，reason 为 `another structure was opened`、`the project changed`、`another preview started` |
| 编辑命令、导出、截图 API 被守卫拦住 | `Apply or cancel the preview first.` |
| 通用工具 HUD | `<Tool title> · Esc to finish` + `Done` |

### 5.8 命令表（ID 固定；F0-A 注册标为 F0-A 的命令，其他命令由所属模块在自己的文件里注册，本表是契约）

| ID | 标题 | 别名（MS） | 键 | 类别 | 守卫（when / whyNot） | 参数 | 归属 |
|---|---|---|---|---|---|---|---|
| `panel.surface` | Show Surface panel | — | Shift+5 | Window | — | — | F0-A |
| `view.normal` | Look along the surface normal | — | N | View | 有晶胞 / `Looking along the surface normal needs a unit cell.` | — | F0-A |
| `view.normalBelow` | Look at the bottom surface | — | Shift+N | View | 同上 | — | F0-A |
| `view.along` | Look along a direction or plane… | — | — | View | 有结构 | `{uvw?: vector(int), hkl?: miller, vector?: vector}`（恰好一个，`run` 中检查） | F0-A |
| `view.showAll` | Show all atoms | Unhide | — | View | 有掩码 / `No atoms are hidden.` | — | F0-A |
| `edit.applyPreview` | Apply preview | — | mod+Enter | Edit | 有会话 / `There is no preview to apply.` | — | F0-A |
| `edit.cancelPreview` | Cancel preview | — | （Esc 经 `sel.clear`） | Edit | 有会话 | — | F0-A |
| `surface.cleave` | Cleave surface… | Cleave Surface | — | Surface | 有晶胞、`edits` | M2 定（含 `hkl: miller`、`layers: int`、`vacuum: float required`） | M2 |
| `surface.vacuum` | Build vacuum slab… | Build Vacuum Slab | — | Surface | 有晶胞、`edits` | M2 定（`vacuum` 必填，U4） | M2 |
| `surface.setVacuum` | Set vacuum… | Vacuum | — | Surface | 有晶胞、`edits`；没有真空时 `requireVacuumGap` 的文案（pbc T T F 的二维结构放行，D5） | M2 定 | M2 |
| `cell.supercell` | Supercell… | Supercell, Create Supercell | — | Cell | 有晶胞、`edits` | `{matrix: imatrix}` | M1 |
| `cell.redefine` | Redefine lattice… | Redefine Lattice | — | Cell | 同上 | `{matrix: imatrix}` | M1 |
| `cell.parameters` | Lattice parameters… | Lattice Parameters | — | Cell | 同上 | M1 定 | M1 |
| `cell.reorient` | Re-orient to standard | Re-orient to standard | — | Cell | 同上 | — | M1 |
| `constraints.edit` | Modify constraints… | Modify Constraints, Edit Constraints | — | Edit | 有结构、`edits` | M3 定 | M3 |
| `sel.fix` | Fix selected atoms | Fix fractional position | — | Edit | 有选区、`edits` | M3 定（例如可动方向 a/b/c 三个布尔，C3） | M3 |
| `sel.free` | Free selected atoms | — | — | Edit | 有选区、`edits` | — | M3 |
| `sel.query` | Atom selection… | Atom Selection | — | Edit | 有结构 | M3 定 | M3 |
| `tool.move` | Move tool | Translate, Rotate | G | Tools | 有结构 | — | M4 |
| `adsorbate.add` | Add adsorbate… | Add Adsorbate | — | Surface | 有晶胞、`edits` | M5 定 | M5 |
| `sites.find` | Find adsorption sites | Find Adsorption Sites | — | Surface | 有晶胞；`surfaceNormal().surface` 为假时 `requireVacuumGap` 的文案 | M5 定 | M5 |
| `tool.sitePick` | Pick adsorption site | — | — | Tools | 同上 | — | M5 |
| `build.layers` | Build layers… | Build Layers | — | Surface | 项目中至少有一个带晶胞的结构 | M6 定 | M6 |

F0-A 为 M1–M6 的命令提供"打开对应面板分区"的默认 `run`（`openSection(panelId, sectionId)`），只在该 id 尚未注册时注册，模块的实现总能覆盖它。
现有命令的改动：`sel.delete`、`sel.delete2` 加 `canEdit`；`sel.all`、`sel.invert` 有掩码时只作用于可见原子；`sel.grow`、`sel.fragment` 在 P-swap 时不可用；
`sel.clear` 见 §3.6.4；`export.*` 与 `traj.*` 的 `when` 加 `!app.session`；`panel.*` 循环（`main.js:133`）加入 `surface`，`shortcutGroup` 改为 `Projects, Library, Build, Structure, Surface panel`。

### 5.9 快捷键

新增 N、Shift+N、Shift+5、mod+Enter（F0-A），G（M4）。核对报告 02 §7 的占用表：五者都空闲；N 不是按住型键；Shift+5 按 `e.code` 匹配（`keys.js:48-52`），任何键盘布局都可用；
mod+Enter 只在有会话时可用（`when`），不影响输入框里的 Enter。导览第一步文案（`shell.js:1306`）改为
`Projects, the sample Library, the Builder, Structure details and Surface tools live here. Shift+1 – 5 open them.`；
README "Mouse and keys"（README.md:29-49）与快捷键对话框的 Mouse 区由 M7 汇总更新。

### 5.10 触屏

- 工具：§3.13.4 的表。
- rail：手机上为 6 个按钮（5 个面板 + Appearance），每个带短标签；Surface 的短标签 `Surface`。
- 预览条：窄屏只显示 `Preview` + `Apply/Create` + `Cancel`（标签省略）。
- 输入：数值框 `type="number"`；矩阵与 Miller 框在窄面板中保持一行（最小 3ch 宽）。
- 选区卡片：窄屏最多 5 个动作 + More（§5.4）。
- 长按：原子菜单与 `overlaycontext`（C2，可选）。

### 5.11 无障碍

- 预览条 `role="region" aria-label="Preview"`，按钮有可见文字；会话开始/结束写入单独的视觉隐藏 `role="status"` 元素（不把按钮放进 live region）。
- 输入控件：外层 `role="group"` + `aria-label`；每个框单独 `aria-label`（`h`、`k`、`i (computed)`、`l`；矩阵 `Row a′, column b`）；
  错误通过 `aria-describedby` 关联、`aria-invalid` 标记；带上划线的指数配 `aria-label`（`ariaIndices`："1 0 minus 1 0"）。
- 分区用原生 `details/summary`（键盘可展开），标题是 `h3`。
- 工具栏按钮 `aria-pressed`；工具 HUD `role="status"`；方向变化写入视觉隐藏的 `role="status"` 元素。
- 被掩码隐藏的原子数在状态栏与选区卡片以文字给出，不只靠视觉。
- 预览可完全用键盘操作：mod+Enter 应用，Esc 取消。

### 5.12 F0-A 自己的报错文案

| 场合 | 文案 |
|---|---|
| 没有结构 | `Load a structure first.` |
| `editActive` 删了原子却没给映射且追踪器不可用（开发错误） | `editActive “<label>”: atoms were removed, so pass indexMap or src.` |
| `editActive` 传了异步函数 | `editActive: fn must not be async.` |
| `'appearance'` 被误用（仅控制台） | `editActive “<label>”: rebuild 'appearance' changed positions, cell or elements; rebuilt in full.` |
| 预览坐标非法 | `Preview positions must be finite numbers.` · `Preview atom index <i> is out of range (0–<n−1>).` |
| 预览期间结构被换掉 | `The structure changed during the preview.` |
| 撤销历史不一致 | `Undo history is inconsistent.`（撤销失败，清空历史并 `console.error`） |
| 历史容量 | `Undo keeps fewer steps for a structure this large.` |
| toast Undo | `Undo the later changes first (press Ctrl Z).`（按 `keyLabel('mod+z')`） · `That change is already undone.` · `That change can no longer be undone.` |
| 多帧 | `Kept frame <k> of <N> and dropped the others.` |
| 隐藏原子 | `Selected <n> visible atoms (<m> hidden).` · `<m> of the <n> selected atoms are hidden. Delete them too?` |
| 测量 | `1 measurement was removed.` / `<n> measurements were removed.`（编辑使其失效时附在 toast 后） |
| 工具 | `Unknown tool “<id>”; using Select.`（仅控制台） · `<Tool title> is not available now.` |
| 命令参数 | §3.15 表；`<title>: pass the parameters as an object.` · `<title>: this would make <n> atoms; the limit is <max>.` · `Look along: give exactly one of uvw, hkl or vector.` |
| 观察方向 | §3.14.1；`No vacuum gap found: looking along c* (normal to a and b).` |
| 没有真空 | §5.2 `requireVacuumGap` |

---

## 6. API

### 6.1 Python

```python
# facet/core/params.py（新）
class ParamError(ValueError): ...
def parse_indices(text: str, *, fractions: bool = False) -> list     # "1,0,-1,0" | "2 1; -1 1" | "(1 0 1̅ 0)" | JSON
def parse_cli_value(spec: dict, text: str) -> Any                     # CLI 字符串 → JSON 值
def coerce_param(spec: dict, value) -> Any                            # int/float/bool/string/element/select/vector/miller/imatrix；只接受 JSON 类型
def validate_params(schema: Sequence[dict], values: dict, *, strict: bool = False, title: str | None = None) -> tuple[dict, list[str], list[str]]
def default_params(schema: Sequence[dict]) -> dict

# facet/core/lattice.py（扩展；F0-D 先加 wrap_fractional；__all__ 同步；reciprocal_cell/plane_spacings 也从 facet.core 重新导出）
def miller_normal(cell, hkl) -> np.ndarray                   # 单位矢量
def lattice_direction(cell, uvw) -> np.ndarray               # 单位矢量
def is_hexagonal_cell(cell, length_tol=1e-3, angle_tol=0.1) -> dict | None   # {"axis": k, "gamma": 120 | 60}
def hkl_to_hkil(hkl) -> tuple[int, int, int, int]
def hkil_to_hkl(hkil) -> tuple[int, int, int]                # i ≠ −(h+k) 时 ValueError（文案同 §3.15）
def uvw_to_uvtw(uvw, *, integer=False) -> tuple              # integer=True：最小整数，如 (2, -1, -1, 0)
def uvtw_to_uvw(uvtw) -> tuple[float, float, float]
def centered_cell_hint(cell) -> dict | None                  # {"kind": "fcc" | "bcc", "to_conventional": 3×3 int}

# facet/analysis/vacuum.py（F0-D 建立：find_vacuum_gap、find_vacuum_gaps、find_surface_gap、gap_cut、unwrap_along_gap、vacuum_gap_hint、make_contiguous，
#   其中 gap_cut、unwrap_along_gap、find_surface_gap 按 §3.8.2/§3.14.2 的语义；F0-A 追加 surface_normal；均从 facet.analysis 导出）
def surface_normal(structure, *, frame=None) -> dict | None  # {"normal": [x, y, z], "axis": k, "source": "info"|"vacuum"|"pbc"|"ab-plane", "surface": bool, "vacuum_axes": [...], "cut": {...} | None}
```

- CLI（`facet/cli.py`）：`_coerce`（73-92）改为 `parse_cli_value` + `coerce_param`；`parse_params(pairs, schema)`（94-107）传入完整 spec；
  例：`facet build custom my-slab --param hkl=1,0,-1,0 --param P="2 1 0; -1 1 0; 0 0 1"`。
- REST：**无新端点**。`/build/custom/{name}`、`/analysis/custom/{name}` 在插件声明了 `params` 时按 schema 规范化参数（非严格，未知类型放行），失败 422（§3.15）。客户端方法不变。

### 6.2 JavaScript

**App（`app.js`）**

```js
editActive(label, fn, { indexMap, src, imageShift, rebuild = 'full', refit = true, latticeChanged = false, singleFrame = false, snapshot = 'full', toast, cameraTransform } = {}) → { entry, value, map }
replaceActiveStructure(s, { resetCamera = false, label = 'Edit structure', indexMap, src, imageShift, refit = true, latticeChanged = false } = {}) → { entry, value: undefined, map }
addStructure(s, { look, scene, newProject = false, replaceProject = 'auto', name, label, activate = true } = {}) → { entry, historyEntry }
beginStructureEdit(label, { kind = 'positions', owner, commitLabel = 'Apply', transient = false, singleFrame, onEnd } = {}) → EditSession
get session() → EditSession | null ; get committedModel() → model
toastUndo(message, { entry, actions = [], timeout, type } = {}) → toast element
undoEntry(entry) → label | null
get lastEdit() → { entry, label, at } | null
notifyStructureChanged()                                     // facet.edit.touch()
setTool(id, opts = {}) → boolean ; get toolDef()
exportImage({ scale, transparent, selection, markers } = {})
startTask(label) → { set(label | fraction), end() }          // B16
history: HistoryStore ; get undoStack() / get redoStack()     // 后两者只读副本，已废弃
```

**EditSession**：`preview(input, opts)`、`commit(arg?, { label, toast, select })` → `{ entry, structureEntry } | null`、`cancel(reason)`、`active`、`kind`、`label`、`owner`、`last`。

**Viewer（`render/viewer.js`）**

```js
setStructure(s, { resetCamera = true, refit = true } = {})
beginPreview(kind) ; previewPositions({ indices, positions }) ; previewStructure(s, { sameAtoms }) ; previewStructureSoon(s, opts) ; previewGhost(s | null, opts) ; endPreview({ restore }) ; get previewing() ; get inputLocked()
refreshAppearance()                                   // 颜色（inPlaceColors 时原地）+ 光环，不做键搜索
transformCamera(R3x3)
setVisibility(name, spec) ; get hiddenCount ; visibilityNames() ; isVisible(i) ; homeOffsets() → model.home
setHighlight(name, indices, { color, grow, opacity, strength, contrast, export }) ; clearHighlight(name) ; highlightNames()
remapIndexed(map, n1)
viewAlong(target, { up, ortho, animate, refit }) → { dir, up, label }
pick(x, y, opts) → Hit ; pickAtomHit(x, y) ; pickAtom(x, y) ; ray(x, y) ; pointOnPlane(x, y, point, normal) ; pointOnLine(x, y, origin, dir) ; worldPerPixel(point)
atomInfo(d) → { display, index, symbol, name, cn, position, frac, image, drawn }
toolHandler (属性) ; get toolSelects() ; cancelToolPress(reason)
overlays: Overlays          // add, get, remove, removeOwner, exportScope
measurements: [{ id, type, refs, idx, points, value, drawn }] ; addMeasurement(type, displayIndices) ; removeMeasurement(id) ; clearMeasurements()
screenshot({ scale, transparent, gizmo, maxSize, selection, markers }) ; thumbnail()
gapCut (调试属性，默认 true)
// 新事件：'visibility' {hidden, names}、'overlayhover'、'overlayclick'、'overlaydblclick'、'overlaycontext'（§3.11.5）
```

**其他模块**

```js
// render/display.js
buildDisplayModel(s, display, { imageCenters, visible, cuts }) ; estimateDisplayCount(s, N, display, visible, { cuts }) ; drawnCopies(points, model, { repeat })
storedImage(model, d) ; refOf(model, d) ; homeOffsets(structure, display, { cuts }) → Int32Array(3n)   // model 新字段：home、homeIndex、cuts、wrapRule、refs
// render/styles.js
writeAtomMatricesAt(mesh, model, radii, displayIdx) ; writeBondMatricesAt(mesh, ctx, bondRadius, bondIdx, { limit }) ; 样式字段 inPlacePositions、inPlaceColors
// render/colors.js：computeColors 的 ctx 加 structure、scene；方案字段 dependsOn；分类图例
// render/overlays.js
export class Overlays ; export function markerLayer(o), planeLayer(o), cellOutlineLayer(o), ghostLayer(o), textLayer(o)
// render/tools/index.js
export const tools ; // render/tools/select.js, measure.js 注册内置工具
// core/history.js
export const HISTORY_DEFAULTS ; snapStructure, structureFromSnap, applyPositionsSnap, patchPositions, snapBytes, packProps, unpackProps ; export class HistoryStore
// core/measure.js（新）
parseRef, formatRef, normalizeRefs, measurementPoints, migrateMeasurementKeys
// core/params.js
ParamError, parseIndices, coerceParam, validateParams, defaultParams
// core/lattice.js（F0-D 建立并重新导出 util.js 的 cellFromParams、cellParams、fracToCart、cartToFrac、det3、inv3 与 wrapFractional；F0-A 追加）
reciprocalCell, millerNormal, latticeDirection, isHexagonalCell, hklToHkil, hkilToHkl, uvwToUvtw, uvtwToUvw, centeredCellHint, formatIndices, ariaIndices, surfaceNormal（重新导出）
// core/vacuum.js（F0-D 建立：findVacuumGap、findVacuumGaps、findSurfaceGap、gapCut、unwrapAlongGap、vacuumGapHint、makeContiguous、axisGaps；F0-A 追加 surfaceNormal）
// core/commands.js：register 新字段 params/aliases/ms/estimate/edits；export const LIMITS
// ui/inputs.js：numberInput, vec3Input, millerInput, imatrixInput, setInvalid
// ui/sections.js：registerPanelSection, renderSections, refreshSections, openSection, requireCell, requireVacuumGap, requireNoPreview
// ui/selectioncard.js：registerSelectionAction ; ui/atominfo.js（新）：registerAtomInfo
// ui/rank.js：rankCommands（从 shell.js 移出，shell.js 重新导出）
// ui/toast.js：toast(msg, { actions: [{label, run}] })（action 仍可用）
```

**公共 API（`api/public.js`）**

```js
facet.edit = {
  run(label, fn, opts) ,            // = app.editActive，返回 { entry, value }（entry 序列化为 { id, label }）
  begin(label, opts) ,              // = app.beginStructureEdit
  touch() ,                         // = app.notifyStructureChanged
  get session() ,
  // F0-D 注册：sortBySpecies(order?)、clearNotes()；各模块追加：fix, free, translate, rotate, setCell, makeSupercell, setVacuum, addAdsorbate …
}
facet.view(target, opts)      // 原来只接受轴字符串，现在接受 viewAlong 的全部输入（兼容）
facet.viewAlong(target, opts)
facet.highlight(name, indices, opts) ; facet.setVisibility(name, spec)
facet.tools = { list, get, set: (id, opts) => app.setTool(id, opts) }
facet.registerPanelSection(panelId, s, o) ; facet.registerSelectionAction(a, o) ; facet.registerAtomInfo(fn, o)
facet.registerTool(t, o)      // C4（可选）：registerIn('tools', …)
facet.params = { parse: parseIndices, coerce: coerceParam, validate: validateParams }
facet.lattice = { millerNormal, latticeDirection, isHexagonalCell, hklToHkil, hkilToHkl, uvwToUvtw, uvtwToUvw, centeredCellHint, surfaceNormal }
facet.screenshot(opts)        // 会话期间抛 'Apply or cancel the preview first.'
```

`EVENTS`（`api/public.js:37-65`）新增：`preview`（app，`{state, label, kind, owner}`）、`visibility`（viewer）、`overlayhover`、`overlayclick`（viewer）；
`tool` 的说明改为 `The tool changed (app.tool: select | measure | move | site-pick | plugin tools)`。嵌入页 `ALLOWED`（`api/embed.js:21`）不变（`command` 已覆盖），
`facet:view` 的 `axis` 现在也可以是 `{hkl}` 等对象，由 `viewAlong` 校验；`facet:screenshot` 在会话期间返回同一错误。

---

## 7. 测试

### 7.1 JS 单元测试（`tests/js/*.test.mjs`，`node --test`，经 F0-D 的测试桥由 pytest 调用）

| 文件 | 覆盖 |
|---|---|
| `history.test.mjs` | `packProps`/`unpackProps` 往返：`null` 混入、长度不符、嵌套值、`selective_dynamics` 中的 `null`、越界整数 `[1, 2, 3000000001, -2147483649, 2**40]`、`1.5`、`NaN`；`snapStructure`→`structureFromSnap` 后 `toJSON` 逐字节相同；位置增量的应用与反向；`HistoryStore` 的 80 步上限、字节预算淘汰顺序、栈顶永不淘汰、`has()`、`replaceTop/popTop` 重算字节、`detach/attach` 整体互换、`clear()` 复位 `lastRecorded` |
| `history_app.test.mjs` | 用不含视图的"假 App"（只装配 `_snapBegin`/`_snapTouch`/`_snapAfter`/`_applySnap` 与 `HistoryStore`，视图用桩）：编辑 B 时 A 的 Structure 对象身份不变；加结构/删结构/事务里先改位置再改别的的撤销与重做；项目切换失败后历史换回；View 合并后与 before 相同时删掉栈顶；位置快照带 `meas`，撤销还原 `imageShift` 改写过的测量 |
| `edit_active.test.mjs`（新） | 假 App：未给映射时追踪器求出删除/追加的映射；`singleFrame` 丢帧与 toast 文案；`fn` 返回 `{select}`；`'appearance'` 误用时退回 `'full'`；`deleteSelected` 清除空间群标签（C7）；返回 `{entry, value, map}`；嵌套事务中 `entry` 为 null；只改 props 的编辑（固定原子）后 `structureKey` 改变、Structure 面板签名改变（A4） |
| `params.test.mjs` | 读 `tests/data/params/coerce.json` 的全部用例（与 Python 共用）；`parse2.py` 的 25 个边界输入；`defaultParams` 新类型；`validateParams` strict 未知键与 `warnings` |
| `lattice_view.test.mjs` | 读 `tests/data/lattice/directions.json`：`millerNormal`（含 §3.14.4 原胞表）、`latticeDirection`、`isHexagonalCell`、四指数换算与报错、`uvwToUvtw({integer})`、`centeredCellHint`；`viewAlong` 的 up 规则（`sideview2.mjs` 的 7 个侧视方向顶面朝上、俯视 a 从左到右；无表面时的最短格矢规则） |
| `vacuum_gap.test.mjs`（新，与 F0-D 共用） | 读 `tests/data/surface/gaps.json`（由 `export_cases.mjs` 生成的 89 个结构 + 期望值）：`findVacuumGaps`、`findVacuumGap`、`gapCut` 的 `cut/lo/rule/empty/main`、并列规则、提示与过期提示、T T F、盒中分子、体相无切口；脱附轨迹（231 帧）中 slab 的绘制位置不变 |
| `surface_normal.test.mjs`（新） | 规则 1–4 与 `surface` 标志；c 倾斜的 CONTCAR；整体绕 x 转 90°、绕 z 转 30° 后法向跟随 a×b；`P = [[0,0,1],[1,0,0],[0,1,0]]` 重定义后过期的 `axis = 2` 被拒绝；c 反向矩阵后顶面换到另一面（+a_k 约定） |
| `display_mask.test.mjs` | 可见性掩码：绘制数、`src` 都可见、补全配位不引入隐藏原子、非周期分支、`estimateDisplayCount` 一致 |
| `display_gap.test.mjs` | U1 显示规则：§3.8.2 表全部情形的绘制数与 z 范围（含单层石墨烯 T T T 留在 z = 0、真空中的分子、10 Å 真空 + 高吸附物）；`display.wrap === false`；`viewer.gapCut = false`；显示超胞沿 c = 2；吸附物按组包裹（B10）；`model.home`/`homeIndex` 与绘制位置一致；`atomInfo` 对跨边界 slab 的原子给出存储坐标（z = 14.0 Å、frac 0.897）与非零 `image`（A26） |
| `measure_refs.test.mjs`（新） | `measref.mjs` 的用例：旧键迁移后 400 个近邻测量全部找到完全对应的副本、数值差 ≤ 2e-6 Å；`exact`/`floating`/`hidden` 三种画法；`_remapMeasurements` 的 `indexMap`、`imageShift`、`latticeChanged`；P-pos 把原子拖过切口后测量仍指同一对原子；`drawOverlay` 用 `points` 投影 |
| `preview_positions.test.mjs` | 增量坐标与完整重建逐坐标 ≤ 1e-6 Å（不跨面）；`writeAtomMatricesAt`/`writeBondMatricesAt` 与全量写法逐元素相同（three 的 `InstancedMesh`，node 中可用）；`pv_fix.mjs` 的换集合用例；被拉长的键缩放为 0、回到判据内时恢复；整体写函数先 `clearUpdateRanges()`；1 000 个移动原子的耗时 |
| `pick.test.mjs` | 在 node 中构造相机与模型：`pickAtomHit` 的 t、B 层优先、`depth: 'atoms'` 的遮挡规则、`pickIn`、A 层 0.05 Å 规则、`pointOnPlane` 平行/背后返回 null、`pointOnLine` |
| `tools.test.mjs` | 注册/注销/覆盖、`when`、`setTool` 未知 id 回退 Select（假 App） |
| `commands_params.test.mjs` | 经 `commands.run` 与 `commands.get(id).run(params)` 两条路径的校验、`invalid-params`/`too-large` 错误码、标题去掉省略号、别名排序（`ui/rank.js`）、`edits` 守卫组合、回退实现不覆盖已注册的命令 |

### 7.2 Python 单元测试

- `tests/test_params.py`：`coerce_param`/`validate_params`/`parse_indices`/`parse_cli_value`，与 JS 共用 `tests/data/params/coerce.json`。
- `tests/test_lattice.py`（扩展）：`tests/data/lattice/directions.json` 的全部用例（含原胞与 `centered_cell_hint`）。
- `tests/test_vacuum.py`（F0-D 的文件，F0-A 提供用例）：`tests/data/surface/gaps.json` 与 `surface_normal` 的用例（同 §7.1 两个新文件）。
- `tests/test_cli.py`（扩展）：`--param hkl=1,0,-1,0`、`--param P="2 1 0; -1 1 0; 0 0 1"`、必填参数缺失时的报错（前缀只出现一次）。
- `tests/test_server_build.py`（扩展）：声明了 `miller` 参数的测试插件收到 `[1, 0, 0]`（客户端传 `[1, 0, -1, 0]`）；非法值返回 422 与 §3.15 的文案；未声明 schema 的插件行为不变。

### 7.3 跨语言金标

| 文件 | 内容 | 来源 |
|---|---|---|
| `tests/data/params/coerce.json` | ≥ 50 条：§3.15 的每条报错文案至少一例；`params_proto.py` 的 13 条与 `parse2.py` 的 25 条 | 解析解 |
| `tests/data/lattice/directions.json` | Pt 惯用胞/原胞 (111)、[110]；原胞上的 (100)、(110)、(211)（fcc 与 bcc，期望按原胞基矢）；ZnO (1 0 1̄ 0)、(1 1 2̄ 0)、(0 0 0 1)；[2 1̄ 1̄ 0]↔[1 0 0]；rutile (110)；fcc(211)；`centered_cell_hint` | 解析解（`view_hkil.mjs`、`miller_basis.py` 已核对） |
| `tests/data/surface/gaps.json` | 89 个结构的 `gapCut` 三轴结果与 `surfaceNormal`；`findVacuumGap` 的期望值按 F0-D v2 §3.13.1 的约定（`end` 在 [0, 1)、轴内并列取 start 最小）另行生成 | `vacgap.mjs`/`vacgap.py` 两种实现一致后固化 |
| `tests/data/measure/migrate.json` | 旧键 → 新引用（跨边界 slab、补全配位像、`display.wrap` 关） | `measref.mjs` |

### 7.4 端到端（Playwright + 预装 Chromium，标记为慢测试，可选运行；每项保存截图供审查）

1. 启动示例上用 `facet.build.surface` 的桩（或 Duplicate）测 `replaceProject: false`：项目里两个结构，撤销一步回到一个。
2. 拖动预览：脚本开 P-pos 会话、连续 60 次 `preview`、`commit`：`app.dirty` 在提交前一直为假、历史只多一条、视图坐标与提交后重建一致；Esc 版本：历史不变。
3. P-swap：预览期间触发 `app.autosave()` → 保存的项目里是已提交结构；缩略图未更新；点击原子、框选、右键菜单 "Delete atom" 都不改变选区或结构（E8）；
   取消后截图与预览前**逐像素相同**、控制台没有 WebGL 警告（E7）。
4. N / Shift+N：对标准取向 slab 与 c 倾斜 CONTCAR，相机方向与 `surfaceNormal` 一致、`camera.up` 为 +y；沿 [1 0 0] 侧视时顶面在上。
5. 导出：有选区与命名高亮时导出 PNG 四次（两个勾选项的组合），像素差只出现在对应的光环处；悬停光环不出现（E4）。
6. U1：打开底层在 z = 0 的 pbc T T T POSCAR，`viewer.model.n` 等于 pbc T T F 时的值；单层石墨烯 T T T POSCAR 画在 z = 0；截图无多余顶层。
7. 嵌入页：父页面调用 `command surface.cleave {layers: '4'}` 得到 `invalid-params` 文案（用一个测试用的同 id 命令桩）；会话期间 `facet:screenshot` 返回守卫文案。
8. 10k 原子 slab：连续 50 次 `editActive`（交替固定与移动）后 `history.bytes ≤ 64 MiB`，每次 ≤ 60 ms（软件 GL 上放宽到 2 倍）。
9. **指针接缝**（新，E16）：页面里注册一个记录回调顺序的测试工具（`import('/js/render/tools/index.js')` 后 `tools.register`），用真实的 `pointerdown/move/up/cancel` 与触摸事件核对：
   按下-移动-松开 = `down → begin → move… → up`；不移动 = 点击（选区改变、双击选中分子、Shift 加选）；工具激活时右键拖动仍旋转、R+拖动缩放框有效；
   拖动中 Esc → `cancel('esc')`；窗口失焦 → `cancel('lost')`；第二根手指 → `cancel('second-finger')`；P-swap 期间 `down` 拿不到原子命中。
10. **旧项目的测量**（新，US12）：打开 `tests/data/projects/v031-split-slab.json`（v0.3.1 格式，跨边界 slab 上的两条测量）：两条都在、数值与文件里记录的相同（1e-5 Å）、线端点落在画出的原子上。
11. **隐藏原子**（新，US10）：只显示顶部 2 层后 Ctrl+A 只选可见原子；先全选再隐藏、按 Delete 弹出确认，选 `Only the 3 visible` 后只删可见原子。
12. **toast 的 Undo**（新）：编辑后切换项目再点旧 toast 的 Undo → `That change can no longer be undone.`；编辑 A 后再编辑 B、点 A 的 Undo → `Undo the later changes first (press Ctrl Z).`。
13. **多帧拖动**（新，E14）：在 20 帧轨迹上用 Move 工具拖动一个原子：提示 `Kept frame 5 of 20 and dropped the others.`，点 Undo 后 20 帧都回来。

### 7.5 性能预算（浏览器，硬件 GL；软件 GL 下放宽 2 倍）

| 操作 | 预算 | 参考实测 |
|---|---|---|
| P-pos 会话开始（10k 原子、55k 键） | ≤ 5 ms | 2.7 ms（node，CPU，改正后的夹具） |
| P-pos 每次更新（≤ 1 000 个移动原子，10k slab），不含 GPU 绘制 | ≤ 3 ms | 1 000 个原子 0.85 ms（坐标 + 原子矩阵 + 键长核对）+ 键矩阵局部写入约 1.3 ms（估算）；2 个原子 0.001 ms |
| 拖动提交（10k slab，一次完整重建） | ≤ 60 ms | `setStructure` 4k 原子 47 ms、16k 78 ms（报告 03，软件 GL） |
| `editActive(..., {rebuild: 'appearance'})`（10k） | 有 `inPlaceColors` ≤ 10 ms；否则 ≤ 45 ms | 换配色（新建网格）4k 29 ms、16k 55.5 ms（报告 03 §7.3），10k 约 40 ms（E20） |
| P-swap 每次预览（10k），按 rAF 合并 | ≤ 80 ms；超过 120 ms 改为松开输入时更新 | 完整 `buildDisplayModel` 10k 29 ms + 网格重建 |
| 撤销快照（10k / 100k） | ≤ 2 ms / ≤ 10 ms | 0.9 ms / 3.4 ms |
| 撤销恢复（10k，不含视图重建） | ≤ 10 ms | 3.2 ms |
| 历史内存（10k，80 步） | ≤ 64 MiB | 30 MB |
| 可见性掩码重建 | ≤ 不隐藏时的完整重建 | 隐藏一半时快 10–16 ms |
| 真空间隙与切口（10k，三轴），按结构版本缓存 | ≤ 6 ms | 5.1 ms（JS）；`surfaceNormal` 2.6 ms |
| 测量迁移（1 000 条） | ≤ 5 ms | O(键数)，每条一次分数坐标换算 |
| `pick()`（10k 原子 + 500 个标记） | ≤ 3 ms | `pickAtom` 4.6k 绘制原子 2.3 ms（报告 03） |
| Surface 面板外壳渲染 / 单个分区重绘（不含模块内容） | ≤ 5 ms / ≤ 2 ms | — |

### 7.6 场景走查（简报列出的场景中与本模块相关的部分）

| 场景 | F0-A 负责的部分 | 检查点 |
|---|---|---|
| Pt(111) p(3×3) 4 层，底 2 层固定，CO 在 fcc 与 top；导出带 SD 的 POSCAR | 切面加入不丢体相（A2）；固定用 `rebuild: 'appearance'`，固定标记（M3 的颜色）不进默认 PNG；悬停幽灵（普通层）与放置的一步撤销；Move 工具下双击选 CO 再拖（延迟认领）；拖动中键的显示（隐藏拉长的键、B9 新键）；SD 在撤销快照中打包往返；hcp/fcc 夹具用改正后的堆垛 | US1、US2、US4；e2e 2、5、9；`history.test.mjs`、`preview_positions.test.mjs` |
| Cu(100) c(2×2)-O、4 重空位；Ag(111) (√3×√3)R30° | `imatrixInput` 的预设由 M1 的 `woodPresets(mesh, {primitive})` 提供（相对原始表面网格，不适用时灰显并说明）；读数由 M1 的 `area` 回调给出相对原始网格的面积与 Wood 标签（D6） | M1 的测试；`imatrixInput` 的 `presets`/`area`/`warn` 钩子单测 |
| Ru(0001)、Co hcp(0001)；ZnO 纤锌矿 (1 0 1̄ 0) 以四指数输入 | `millerInput` 自动四框、`hkilToHkl`、错误 i 的文案、粘贴带上划线的指数；`viewAlong({hkil})`；方向标签 `[2 1̄ 1̄ 0]` 用最小整数 | US9；`lattice_view.test.mjs` |
| fcc(110) 短桥与长桥、fcc(211) 台阶、bcc Fe(110) | `viewAlong` 侧视顶面朝上（看长桥方向 [0 1 0] 不再倒置）；`markerLayer` 的拾取与 `pickIn`（位点标记只在 Pick site 工具下可点，Select 下点得中表面原子） | `lattice_view.test.mjs`、`pick.test.mjs` |
| 金红石 TiO2(110)：删桥氧做空位 | `deleteSelected` 走 `editActive`（带 `indexMap`，清除空间群）+ `toastUndo` 绑定自己那一步；O 上的固定光环有深色内线，看得见；隐藏原子不会被误删 | e2e 11、12；`edit_active.test.mjs` |
| SrTiO3(001) 对称 7 层与化学计量非对称 slab；CeO2(111)；NaCl(100)；刚玉 (0001) | 真空输入必填、初始为空、填写前 Create 不可用（U4）；顶面 = +c 一侧；c 反向矩阵前的提示（`warn` 钩子，M1 写文案） | 输入控件单测；`surface_normal.test.mjs` |
| 从惯用胞切（fcc 立方胞给 2×2 网格）与从原胞/原始 POSCAR 切 | 指数相对当前晶胞：读数行注明、fcc/bcc 原胞提示等价的惯用胞指数（v1 的"同一法向"说法已改正）；预设相对原始网格（M1） | US14；`directions.json` 的原胞用例 |
| 石墨烯、MoS2 单层：改真空、√3 或 4×4 超胞、放吸附原子 | pbc T T F：非周期轴上的真空照样识别（`requireVacuumGap`、`surface.setVacuum` 放行，D5），显示不变；pbc T T T：层留在 z = 0（v1 会画到顶面）；`imatrixInput` 2×2；P-ghost 与位点 | US11；`display_gap.test.mjs`、`surface_normal.test.mjs` |
| VASP CONTCAR slab（pbc T T T、有 SD、底层在 z = 0 或弛豫到 0.99x） | U1 显示规则（画成一整块）；`surfaceNormal` 规则 2（a×b 而不是 c）；卡片显示存储坐标（与 CONTCAR 一致）；旧项目的测量迁移；SD 快照 | US6、US11、US12；e2e 6、10 |
| 大体系：Pt(111) p(6×6) 6 层（216 原子）、10k 原子 slab | 历史 v2、P-pos 只写受影响实例（1 000 个移动原子 ≤ 3 ms）、掩码、切口缓存、`imatrix` 不设硬性行列式上限（p(41×41) 可做） | §7.5；e2e 8 |
| 脱附 / NEB 图像（分子在真空中） | U1 v2：slab 不离开轮廓、分子画在上方，直到贴近像的底面 | US13；`vacuum_gap.test.mjs` |

---

## 8. 风险与开放问题

| # | 风险或问题 | 处理 |
|---|---|---|
| R1 | 撤销存储重写可能引入撤销/重做/事务回滚的回归 | 逻辑放进纯模块 `core/history.js` 并做 node 测试；迁移清单（§3.1）逐项核对；`undo()`/`redo()`/`undoLabel()`/`canUndo()` 的公共行为不变；先合入 T1 再改调用方 |
| R2 | 预览期间被其他代码改动已提交结构 | 任何写历史的操作先取消会话（A-D2）；会话 `_assertLive()` 检查结构身份；P-swap 输入锁（A-D1） |
| R3 | P-pos 越过晶胞面时提交后跳到对面 | 与现有包裹显示一致，文档说明；测量引用相对存储坐标，不受影响 |
| R4 | 第二根手指落下时 OrbitControls 没见过第一根手指 | 取消工具拖动后，这次手势剩下的部分按单指旋转处理，抬起后恢复正常；写进 §3.13.4 表格 |
| R5 | 脚本直接改 props 不递增 `rev` | 文档要求调用 `facet.edit.touch()`；`structureDigest` 仍兜住坐标变化 |
| R6 | `rebuild: 'appearance'` 被误用于改了坐标的编辑 | 摘要核对常开（§3.2），退回 `'full'` + 警告 |
| R7 | 测量引用在编辑后指向另一副本 | v2 引用相对存储坐标：连续移动不受影响；整数格矢包裹的编辑传 `imageShift`；改晶格基的编辑丢弃像非零的测量 |
| R8 | U1 切口使跨边界的 slab 有原子画在晶胞轮廓之外 | 窗口取移动原子最少的一侧，主体总在轮廓内；少数原子（如弛豫到 −0.02 Å）出界如实反映存储坐标，不移动轮廓 |
| R9 | 5 Å 门槛：层间距大于 5 Å 的层状体相沿该轴不再复制边界原子 | 那里本来没有原子，视觉影响只是边界原子少一份；门槛集中在 `SURFACE_DEFAULTS` |
| R10 | 字节预算使超大结构可撤销的步数变少 | 一次性提示（B8）；预算可在偏好中调 |
| R11 | `core/lattice.js`、`core/vacuum.js`、`core/lattice.py` 由 F0-D 建立、F0-A 与 M1 追加，可能冲突 | §10.1 固定签名与合并顺序：F0-D T1/T2 先合，F0-A T7a 后合，M1 再追加 |
| R12 | F0-D 的 `rev`/`touch`/`trackChanges`/`setPositions`/`keepFrame`/`core/vacuum.js` 晚于 F0-A 合入 | §10.1 列出临时实现（`app.js` 与 `display.js` 内的小函数，`vacgap.mjs` 的代码），F0-D 合入后删掉；删除是 F0-D 合并清单的一项 |
| R13 | 对 2M 原子结构，悬停 `pick` 本身已经很慢（报告 03：约 300 ms） | 现状问题；可选：原子数 > 200k 时悬停拾取降到 10 Hz |
| R14 | 切口的启发式（3.5 Å 分块、主块一半的漂浮判据）对罕见结构（与 slab 相隔 > 3.5 Å 且原子更多的物理吸附膜、双 slab）可能切错位置 | 只影响绘制位置（周期性等价），不影响结构与导出；`info.surface.axis` 提示与调试开关；常量集中；§3.8.2 表固化为金标，改动要过表 |
| R15 | 测量格式改变：旧版本的应用读新文件时看不到测量 | 新字段名 `refs`，旧版本按"无效"保留而不是错误解释；`docs/SCHEMA.md` 写明 |
| R16 | F0-D v2 与 §10.1 联合接口表不一致 | 联合表是两模块的合同；在 F0-D v2 定稿前按本表实现临时代码；冲突由负责人按 U6 裁决并记录 |
| R17 | 有掩码时 Ctrl+A 只选可见原子，改变了现有行为 | 只在有掩码隐藏原子时生效（按元素隐藏不变），并用 toast 说明；状态栏总能 Show all |
| R18 | REST 插件参数的规范化改变了服务器行为 | 只对插件声明过的参数、只做类型规范化（非严格，未知类型放行）；文档与变更日志写明 |

**已定案的问题**（v1 的 ⚑ Q1–Q5；按 U6 设计完成后直接开发，均按推荐方案定案）：

- Q1 PNG 与缩略图里的光环：PNG 默认保留选区光环（现状）、去掉悬停光环，标记类默认不进 PNG；**另加 "Include selection highlight" 勾选项**（领域审查对 Q1 的补充），做论文图时可关；缩略图不含任何光环与叠加层。
- Q2 P-swap 预览期间不能点选原子（预览结构的原子编号与已提交结构不同）。两份审查都同意。
- Q3 Shift+N = 看底面（用于检查固定的底层）。
- Q4 撤销内存预算 64 MiB（窄屏或小内存设备 24 MiB）。
- Q5 预览期间 Ctrl/⌘+Z = 取消预览。

**开发按下列选择推进、用户如有异议可改的问题**（不阻塞开发）：

- Q6 从**底面**脱附的分子离开底面超过 3.5 Å 后画到顶面上方的真空里（同一物理位置的另一个周期像）；顶面一侧的分子在整个真空中都画在 slab 上方。若要底面一侧也"跟着底面"，需要引入状态（切口滞后），见 §12。
- Q7 有可见性掩码时 Ctrl+A / Invert selection 只作用于可见原子（R17）。
- Q8 旧项目的测量在第一次保存时改写为新格式（旧版本的应用不再显示它们，R15）。

---

## 9. 开发拆分

规模：S ≤ 0.5 天，M ≈ 1–2 天，L ≈ 3–4 天（一个开发代理）。所有任务都要求：不改无关文件、按 §7 写测试、更新 `docs/PLUGINS.md` 中对应的表（T11 汇总校对）。
F0-D 的依赖按 §10.1：未合入时用列出的临时实现，并在 F0-D 合入后删除。

| 任务 | 输入 | 输出 | 依赖 | 涉及文件 | 规模 | 并行 |
|---|---|---|---|---|---|---|
| **T1 撤销存储 v2** | §3.1 | `core/history.js`（含 `replaceTop/popTop/detach/attach`、整数打包规则）；App 的 `_snapBegin/_snapTouch/_snapAfter/_applySnap`、`undo/redo/transaction/_record` 改造；迁移清单全部位置；`history*.test.mjs` | F0-D 测试桥（可先用 `node --test` 直接跑） | `web/js/core/history.js`（新）、`web/js/app.js`（131-134、260-288、338-381、483-628、711、837-857）、`web/js/main.js:56`、`web/js/ui/shell.js:680-681` | L | 第 1 批 |
| **T2 编辑原语** | §3.2–3.5 | `editActive`（追踪器、`singleFrame`、`imageShift`、`EditResult`）、`resolveIndexMap`、`_afterEdit`、`replaceActiveStructure` 重写、`addStructure({replaceProject})`、`toastUndo/undoEntry/lastEdit`、`ui/toast.js` 多动作与悬停暂停、本步新增备注的 toast、`notifyStructureChanged`、`rev` 进 `structureKey`；改写 `deleteSelected`/`replaceSelected`（C7）与 4 处 toast；Duplicate 用 `replaceProject:false`；`startTask` | T1；F0-D 的 `rev/touch/trackChanges/keepFrame/invertSourceMap/invalidateSymmetryInfo`（临时实现见 §10.1） | `app.js`（651-719、338-371、1269-1278）、`core/analyses.js`（103-107）、`ui/toast.js`、`ui/selectioncard.js:146`、`ui/shell.js:991`、`ui/panels/structure.js:185`、`api/public.js`（addStructure 返回值） | M | 第 2 批 |
| **T3a 预览会话与 P-swap** | §3.6、§3.7.2–3.7.4 | `EditSession`、`beginStructureEdit`、`_endSessionFor`、`committedModel`；视图 `beginPreview/previewStructure(Soon)/previewGhost/endPreview`、完整暂存与恢复、输入锁、节流与大结构降级；预览条（region + status、堆叠）；导出、截图 API、嵌入页、轨迹、缩略图守卫；`sel.clear`、Ctrl+Z、mod+Enter 语义；`canEdit` 守卫 | T2、T4a（`ghostLayer`、`cellOutlineLayer`） | `app.js`、`render/viewer.js`（323-352、582-691、724-763、799-804、898-923、1003-1005、1785-1833）、`ui/shell.js`（459-510、607-612、729-750、1019-1040）、`main.js`（108-123、traj.*）、`api/extensions.js`（25-41）、`api/public.js`、`api/embed.js`（76-81）、`ui/selectioncard.js`（83-126）、`css/app.css` | L | 第 3 批 |
| **T3b P-pos 快速路径** | §3.7.1 | `previewPositions` v2（`orig`/`touched`、换集合）、`writeAtomMatricesAt/writeBondMatricesAt`（含 `limit`）、`inPlacePositions/inPlaceColors`、整体写函数 `clearUpdateRanges`、`frustumCulled`、B9 局部重搜键（应该）；P-pos `commit` 与 `singleFrame` | T3a、T5 | `render/viewer.js`（650-670、766-784）、`render/styles.js`（52-134、240-298） | M | 第 4 批 |
| **T4a 叠加层、高亮与导出** | §3.10、§3.11 | `render/overlays.js`（五种 tier、导出策略、构件）、`_haloHidden`、`setHighlight`（令牌颜色、双色边、`opacity`、按 grow 排序）、主题改色修复、`screenshot({selection, markers})`/`thumbnail`、导出菜单两个勾选项、图例项、B13 配色上下文、B14 Property 默认属性 | T5（`drawnCopies` 用 `model.wrapRule`）可后接 | `render/overlays.js`（新）、`render/viewer.js`（181、830-896、1455-1505、1521-1561、1785-1833）、`render/legend.js`、`render/colors.js`（196-215）、`render/settings.js`、`app.js`（1287-1300）、`ui/shell.js`（729-750） | L | 第 1 批 |
| **T4b 拾取与射线** | §3.12.1–3.12.2、§3.11.5 | `pick/pickAtomHit/ray/pointOnPlane/pointOnLine/worldPerPixel`、`pickIn`、深度遮挡规则、叠加层事件（hover/click/dblclick/context） | T4a | `render/viewer.js`（264-268、323-352、1372-1392） | M | 第 2 批 |
| **T5 显示：掩码、U1 切口、按组包裹、测量引用** | §3.8、§3.9、§3.12.3 | `buildDisplayModel({visible, cuts})`、切口缓存、`model.home/homeIndex/cuts/wrapRule/refs`、`storedImage/refOf/homeOffsets`、按组包裹（B10）、`estimateDisplayCount` 缓存、`drawnCopies`、`setVisibility/remapIndexed`、状态栏 "hidden" 药丸与 `view.showAll`、`sel.all/sel.invert` 的可见规则与删除确认；`core/measure.js`、测量迁移、Float64 数值、画线查找、`_remapMeasurements` v2、结构面板测量行；`atomInfo` 与卡片的存储坐标 | F0-D 的 `core/vacuum.js`（未合入时把 `vacgap.mjs` 的四个函数临时放在 `display.js` 内） | `render/display.js`（70-265）、`render/viewer.js`（593-670、1003-1046、1394-1407、1546-1552）、`core/measure.js`（新）、`app.js`（99-102、232-253、575-588、764-800）、`ui/panels/structure.js`（148-160）、`ui/selectioncard.js`（108、169-226）、`ui/shell.js`（593-605）、`ui/panels/appearance.js`（383、449） | L | 第 1 批 |
| **T6 工具注册表与指针钩子** | §3.13 | `render/tools/{index,select,measure}.js`、`setTool`、视图接缝（延迟认领、`_cancelTool`、keydown、输入锁）、`selects` 替换、提示栏/HUD/工具栏/快捷键对话框鼠标行 | T4b（`pick`） | `render/tools/`（新）、`render/viewer.js`（256-512）、`app.js`（721-762）、`ui/shell.js`（468-481、507-516、627-651、1049-1078、1204-1212）、`ui/selectioncard.js:169` | L | 第 3 批 |
| **T7a 晶格函数与表面法向** | §3.14.2–3.14.4 | `core/lattice.js` 的追加函数（含 `centeredCellHint`、`ariaIndices`）、`core/lattice.py` 扩展、`surfaceNormal`/`surface_normal`（追加到 `core/vacuum.js`/`analysis/vacuum.py`）、`directions.json`、`gaps.json` 的法向部分 | F0-D T1/T2（`lattice.js`、`vacuum.js` 建立后） | `web/js/core/lattice.js`、`web/js/core/vacuum.js`、`facet/core/lattice.py`、`facet/analysis/vacuum.py`、`facet/analysis/__init__.py`、`facet/core/__init__.py` | M | 第 1 批（F0-D 合入后） |
| **T7b 沿任意方向观察** | §3.14.1 | `viewAlong`（侧视 up 规则、来源标签）、方向标签（`textLayer`）、`view.normal/normalBelow/along` 命令与对话框、视图菜单、`reducedMotion`、`facet.view` 扩展 | T7a、T4a（`textLayer`） | `render/viewer.js`（1167-1214）、`main.js`、`ui/shell.js`（764-775）、`api/public.js` | M | 第 2 批 |
| **T8 参数 schema 与输入控件** | §3.15、§5.6 | `core/params.js`、`facet/core/params.py`（含 `parse_cli_value`）、`ui/inputs.js`（含 `size: 2`、`presets` 函数、`area`、`warn`、滚轮屏蔽、`badInput`、粘贴）、`paramForm` 新类型与 `valid`、`defaultParams` 迁移、CLI、REST 插件参数规范化、全局无效样式、金标 `coerce.json` | T7a（`isHexagonalCell`、`hklToHkil`、`centeredCellHint`） | `web/js/core/params.js`（新）、`web/js/ui/inputs.js`（新）、`web/js/ui/paramform.js`、`web/js/core/analyses.js`（43-55）、`facet/core/params.py`（新）、`facet/cli.py`（73-107）、`facet/server/routes/build.py`（126-147）、`facet/server/routes/analysis.py`（139-）、`css/app.css`（212-216、660-663）、`docs/PLUGINS.md`（97-108） | L | 第 1 批（T7a 的晶格函数可先以桩开发） |
| **T9 命令扩展** | §3.16、§5.8 | `params/aliases/ms/estimate/edits`、`LIMITS`、`register` 包装函数里的校验、大结构确认、`ui/rank.js` 与别名显示、`CATEGORY_ORDER`、§5.8 的 F0-A 命令与"打开分区"回退实现 | T8（`validateParams`）、T10（`openSection`） | `core/commands.js`、`ui/rank.js`（新）、`ui/shell.js`（73-103、1120-1183）、`main.js`、`api/public.js`（reference） | M | 第 2 批 |
| **T10 面板外壳** | §3.17、§5.2–5.4 | `ui/sections.js`（单独重绘、`openSection`）、`ui/panels/surface.js`、Structure 面板插槽、`shell.openLeft(id, {section, focus, tab})`、`registerSelectionAction` 与选区卡片 More 菜单、右键菜单插入点、`registerAtomInfo`、图标 `surface/move/target/lock/unlock/normal/matrix/more`、rail 第 5 个面板与 Shift+5、导览文案 | — | `ui/sections.js`（新）、`ui/panels/surface.js`（新）、`ui/atominfo.js`（新）、`ui/panels/structure.js`（70-189）、`ui/selectioncard.js`（150-226）、`ui/shell.js`（355-405、807-834、1306）、`ui/icons.js`、`main.js`（4-8、133）、`css/app.css` | L | 第 1 批 |
| **T11 文档与 API 表** | 全部 | `docs/PLUGINS.md` §4（JS API）、事件表、废弃的 `undoStack`；`docs/SCHEMA.md`（测量格式）；`EVENTS`；README 键位（与 M7 协调） | T1–T10 | `docs/PLUGINS.md`、`docs/SCHEMA.md`、`api/public.js`、`README.md` | M | 最后 |
| **T12 端到端冒烟** | §7.4 | Playwright 脚本与截图（13 项） | T3a、T3b、T4a、T5、T6、T7b、T10 | `tests/e2e/`（M7 定位置）、`tests/data/projects/v031-split-slab.json` | L | 最后 |

**里程碑 F0-A-core（第 1 波开工条件，E15）**：T1、T2、T3a、T4a（只需 `planeLayer`、`cellOutlineLayer`、`ghostLayer`、`setHighlight`）、T5、T7a、T8、T10，加上 T9 的参数校验部分。
第 1 波的 M1（P-swap、Cell 分区、`imatrixInput`）、M2（`addStructure`、P-swap、`planeLayer`、`millerInput`、`surfaceNormal`）、M3（`setHighlight`、`setVisibility`、分区、`editActive`）
所需的接口都在其中；M1/M2/M3 在 F0-A-core 合入前可以按本规格的签名用桩开发。T3b、T4b、T6、T7b、T9 其余部分、T11、T12 与第 1 波并行，在第 2 波（M4、M5）开工前完成。

**合并顺序**（`render/viewer.js` 被多个任务修改，按行段错开并按此顺序合并）：F0-D T1/T2 → T7a → T5 → T4a → T4b → T7b → T6；T1 → T2 → T3a → T3b；T10 → T9；T8 在 T7a 之后。
`ui/shell.js` 由 T1（680-681）、T4a（729-750）、T5（593-605）、T6（468-651、1049-1078、1204-1212）、T7b（764-775）、T9（73-103）、T10（355-405、807-834、1306）分段修改；
`main.js` 由 T1、T3a、T7b、T9、T10 修改；`css/app.css` 由 T3a、T8、T10 修改——这些文件的冲突在合并时按上面的顺序逐个解决。

**估算**：必须项合计约 33 个代理日；关键路径 T1 → T2 → T3a → T3b → T12 约 12 天，F0-A-core 约 8–9 天（T1 → T2 → T3a 串行，其余并行）。
A20（选区动作注册）、B5（别名显示）、命令的 `ms` 字段可推迟到 T9 之后，不阻塞 F0-A-core。

---

## 10. 对其他模块的接口

### 10.0 消费方需求对照表（E2）

M1–M6 的 v1 规格各自写了对 F0-A 的需求。下表逐条给出结论：**采纳**（本规格已提供）、**改名**（能力相同，由括号里的一方改用本规格的名字）、**拒绝**（附理由）。
各模块修订时按"改名"一栏改自己的规格。

| 需求方：期望 | 结论 | 本规格的对应 |
|---|---|---|
| M1：`replaceActiveStructure(s, {label, src, latticeChanged, refit})`；`editActive(label, fn, {latticeChanged, cameraTransform, toast})` | 采纳 | §3.2；返回 `EditResult` |
| M1：`session.preview(structure, {sameAtoms, src, latticeChanged})`，`commit()` 沿用最后一次的选项 | 采纳 | §3.6.4 |
| M1：`imatrixInput` 支持 `max: 1000`、`maxDet: 1e6`，预设带参数（`Rectangular (n × m√3)…`） | 采纳 | 默认 `max = 50`、`maxDet = null`，按字段覆盖；`presets` 可为函数、项可带 `params`（§3.15、§5.6） |
| M1：v1 §10 的"方格 c(4×2) = (2√2×√2)R45° `[[2,2],[-1,1]]`"不成立 | 采纳（更正） | c(4×2) 是 `[[2,1],[-2,1]]`，`[[2,2],[-1,1]]` 是 (2√2×√2)R45°；v2 不再在本规格列 Wood 矩阵，以 M1 的 `woodPresets` 为唯一来源 |
| M1：`registerSelectionAction({id: 'cell.atomToOrigin', menu: true, card: false})`、`requireNoPreview`、`openSection`、`cellOutlineLayer`、`commands.register({params, aliases, estimate, edits})`、`LIMITS.maxAtoms` | 采纳 | §5.4、§3.17、§3.11.4、§3.16 |
| M1：`surfaceNormal(structure)` 作双轴应变的默认平面 | 采纳 | 用返回对象的 `.normal`，先看 `.surface` |
| M2：`registerPanelSection('surface', {id: 'cleave' \| 'slab', …})`、`addStructure(s, {replaceProject: false, label, activate})`、`editActive(…)`、`toastUndo` | 采纳 | `addStructure` 的返回值改为 `{entry, historyEntry}`（M2 改读法） |
| M2：`beginStructureEdit(label, {kind: 'structure', owner, commitLabel, banner, onEnd})`、`ses.commit({addAsNew, name, label, toast})` | 改名（M2） | `banner` 改为反义的 `transient`（默认 `false` = 显示预览条），M2 去掉 `banner` |
| M2：`planeLayer` 多个多边形、各自颜色与虚线、`set()` 更新；`cellOutlineLayer`；`onModel` | 采纳 | §3.11.4 |
| M2：`viewer.viewAlong({hkl} \| [x,y,z], {up})`、`viewer.fitView()` | 采纳 | `fitView` 已有（`viewer.js:1161`） |
| M2：`millerInput`、`imatrixInput({size: 2, max, maxDet, presets: fn})`、`numberInput({unit, required})`、`seg`、`toggle` | 采纳 | `seg`、`toggle` 已在 `ui/dom.js:56, 65` |
| M2：`core/params` 的 `miller` 类型 `max = 12` | 改（M2） | 默认硬上限 30、超过 12 软提示（D12）；M2 若要硬上限 12 就在自己的 schema 里写 `max: 12` |
| M2：命令 `register({…, category: 'Surface', params, aliases, ms, estimate, edits})`、大结构确认（30 000 / 上限） | 采纳 | §3.16 |
| M2：`isHexagonalCell`、`hklToHkil`/`hkilToHkl`、`millerNormal`、`formatIndices`、`surfaceNormal`（Python 同名） | 采纳 | Python 的 `surface_normal` 在 `facet.analysis`（不在 `core.lattice`，避免 core 依赖 analysis） |
| M2：F0-A 的 `surfaceNormal` "首先读 `info.surface.normal`"（M2.md:759），旋转操作同步更新它（M2 R8） | 拒绝 | 笛卡尔法向会过期（D3、E3）；v2 只把 `info.surface.axis` 当经过校验的提示。M2 照常写 `axis`；`normal` 可保留为说明性字段，F0-A 不读 |
| M3：`editActive(label, fn, {rebuild: 'props'})`，返回撤销条目 | 改名（M3） | `'props'` 即本规格的 `'appearance'`；返回 `{entry, value, map}` |
| M3：`fn` 修改深拷贝 | 拒绝 | 原位修改 + 事前快照已能完全回滚；深拷贝每步多一次克隆（10k 原子约 1 ms），并让持有 `app.structure` 引用的面板失效；`structureKey` 已含 `rev` |
| M3：`setHighlight(name, idx, {color: 'var(--constraint)', grow = 1.2, opacity, export: 'never' \| 'png'})`，按 grow 排序；名字 `constraints-fixed` 等 | 采纳；`'png'` 改名 `'marker'`（M3） | §3.10：令牌颜色、`opacity`、按 grow 排序；`'marker'` = 跟随 "Include markers"，正是 M3.md:640 的意图；固定原子的名字与颜色归 M3，F0-A 删掉 v1 的 `HIGHLIGHT_COLORS` |
| M3：颜色令牌 `--constraint` 浅色主题 `#2563eb` | 提醒（M3） | 双色边下外圈颜色宜取亮度 L ≥ 0.25（`#2563eb` 约 0.15，对很暗的元素色对比不足；如 `#60a5fa` 约 0.36），由 M3 调整 |
| M3：`viewer.addOverlayDrawer(id, draw, {export})` | 改名（M3） | `overlays.add({tier: 'canvas', id, draw, export})` |
| M3：`viewer.addLegendItems(id, fn)` | 采纳，改名（M3） | `overlays.add({tier: 'legend', id, items})` |
| M3：配色方案 ctx 加 `structure`/`scene`、`dependsOn` 进 `colors` 签名、分类图例 | 采纳 | B13 |
| M3：`registerSurfaceSection({…})`；`shell.openLeft('surface', {section, focus})` | 改名（M3）；采纳 | `registerPanelSection('surface', …)`；`openLeft` 委托 `openSection`（§3.17） |
| M3：三维矢量与 Miller 输入、`structureKey` 感知 props | 采纳 | §5.6、§3.5 |
| M3：`shell.floatingCard(…)`（可选） | 可选 | C6，不在 F0-A-core；M3 可先自己实现 |
| M3：选区动作 Fix/Free 的顺序（v1 约定 60/61，会落进 More 菜单） | 改（M3） | 35/36，排在 Replace 之前（E31，§5.4） |
| M3/M4：`surfaceNormal` 对非 slab 返回 null | 改（M3、M4） | 返回对象带 `surface` 与 `source`；判断"有没有表面"看 `.surface`（规则 4 的 c* 方向仍可用于观察） |
| M4 v2（§10，与本次修订同期定稿）：按 F0-A v1 的接口使用 `editActive`、`beginStructureEdit({kind, owner, commitLabel, banner, onEnd})`、`addStructure({replaceProject: false})`、`toastUndo`、`tools.register`（`ToolHandler` 含 `selectFallback`）、`pick`/`ray`/`pointOnPlane`/`pointOnLine`/`worldPerPixel`、`overlays.add`、`textLayer`、`setHighlight('m4-moving')`、`surfaceNormal → {normal, axis, source}`、`registerPanelSection`、`openSection`、`requireVacuumGap`、`registerSelectionAction`、`vec3Input`、`numberInput`、`setInvalid`、命令字段 | 采纳；三处改名（M4） | `banner` → `transient`（默认 `false` = 有预览条；Move 工具的拖动会话传 `true`）；`ToolHandler.selectFallback` 删除，由 `ToolDef.selects` 决定空白处是否框选；`surfaceNormal` 多了 `surface`（M4 的 `hasSurface` 直接读它）；`ToolHandler` 新增 `begin()`（§3.13.1） |
| M4 A-CR1：`_afterEdit` 对 `latticeChanged` 为假的编辑按 `I' = I + h_before[i] − h_after[i']` 重写测量键的像 | 以测量引用 v2 代替 | 引用相对存储坐标，原子怎么移动都不用改写；只有存储坐标被整数格矢平移（包裹）时传 `imageShift`（§3.9.4）。效果相同，且不需要"编辑前视图用的偏移"这份额外状态 |
| M4 A-CR2：导出 `homeOffsets(structure, display, {gaps}) → Int32Array(3n)` 与 `viewer.homeOffsets()` | 采纳 | `render/display.js` 导出 `homeOffsets(structure, display, {cuts})`（`buildDisplayModel` 内部用同一函数，含 U1 切口与按组包裹），`viewer.homeOffsets()` 返回当前 `model.home`；另有 `model.homeIndex` 给出家副本的绘制下标（§3.9.1） |
| M4 A-CR3：P-pos `commit(positions?, {label, toast, keepFrame = true})`，多帧时完整快照并先 `keepFrame` | 采纳；选项名为 `singleFrame`（M4 改名） | `commit({positions, label, toast, select})`：给了 `positions` 时先 `preview(positions)` 再提交；会话的 `singleFrame` 默认真；多帧结构总做完整快照（§3.1、§3.6.4）。`keepFrame` 留作 F0-D 的方法名，避免选项与方法同名 |
| M4 A-CR4：`ToolHandler.up(e, press, {click})` 可返回 `false`，让视图走普通点击路径 | 以延迟认领代替 | 认领的按下没有移动就按普通点击处理（`_tap`：选择、Shift、Ctrl/⌘、双击选分子），工具无需返回值约定；需要自定义点击时实现 `click(e, hit)` 并返回 true（§3.13.3） |
| M4 v1 的 `imageShift`/`singleFrame` 选项、`wrapHome`、`viewer.setGhost`、`keepCurrent`、多动作 toast、`openSection` 的 `tab` | M4 v2 已撤回 | 本规格仍提供 `imageShift`（整数包裹用）、`singleFrame`、`ghostLayer`、`replaceProject: false`、`toastUndo` 的 `actions`、`openSection({tab})`，M4 用不用均可；`wrapHome` 不提供（由 A-CR2 代替） |
| M5：`editActive(label, fn → {select?} \| void, {indexMap})`，C11 丢帧并给带 Undo 的 toast | 采纳 | M5 传 `singleFrame: true` |
| M5：`beginStructureEdit(label, {kind: 'ghost', owner})` → `preview(ghost \| null)`、`commit(fn)`、`cancel()` | 采纳 | 悬停时的幽灵改用 `ghostLayer`、不开会话（E19）；调高度/取向时才开 P-ghost 会话 |
| M5：`overlays.add({…, tier: 'top', export: 'marker', pickable, pick, onModel, beforeRender, bounds})`、`markerLayer`、`drawnCopies(points, viewer, {repeat})` | 采纳；`drawnCopies` 第二个参数改为 `model`（M5） | 位点标记加 `pickIn: ['site-pick']`，使 Select 工具下点得中表面原子（D11） |
| M5：`overlaydblclick`、`overlaycontext`（触屏长按 500 ms） | 采纳 | §3.11.5；长按属 C2（可选），桌面右键是必须项 |
| M5：`registerTool({id: 'site-pick', cursor: 'target', handler: {hover(hit), click(e, hit) → bool, cancel()}})` | 改名（M5） | `tools.register`；CSS 光标用 `crosshair`（`target` 不是合法的 CSS 光标，图标才是 `target`） |
| M5：`registerPanelSection('surface', {id: 'adsorbates', order: 40})`、`registerSelectionAction`、`setHighlight`、`structureKey` 感知 `adsorbate_id`、带单位输入（Å、°、ML）、"Include markers" | 采纳 | — |
| M6：`registerSurfaceSection({id: 'interface', order: 50, …})` | 改名（M6） | `registerPanelSection('surface', …)` |
| M6：`app.showStructurePreview(structure, {label, fit, onCreate, onCancel}) → {update, close, active}` | 改名（M6） | 同一个会话机制：`beginStructureEdit(label, {kind: 'structure', commitLabel: 'Create', onEnd})` + `preview(s)` + `commit({addAsNew: true})`；`fit: 'first'` = 第一次预览后调用 `viewer.fitView()` |
| M6：`addStructure(s, {replaceProject: false, name})` 返回新条目 id | 改（M6） | 返回 `{entry, historyEntry}`，id 为 `entry.id` |
| M6：`toast(msg, {action: {label: 'Undo', run}})` | 改名（M6） | `app.toastUndo(msg, {entry})`（只撤销本步） |
| M6：`inputs.number/imatrix/vector({size: 2, labels: ['u', 'v']})` | 改名（M6） | `numberInput`、`imatrixInput`、`vec3Input({size: 2, labels: ['u', 'v']})` |
| M6：`app.busy(label) → {set(fraction), end()}` | 改名（M6） | `app.startTask(label)`（B16）：`app.busy` 已是布尔属性，不能再做方法 |

### 10.1 与 F0-D 的联合接口表（E1、D7）

F0-A 与 F0-D 同在第 0 波。F0-D v2（`specs/F0-D.md`）与本次修订同期定稿，已经按 U1 删除导入时的 slab 识别、采用了 U1 建议的 `find_vacuum_gap` 签名与 `rev`/`touch()`。
下表逐项对齐：**"采用"** = 照 F0-D v2 原样；**"F0-D 需改"** = 本规格要求 F0-D 再改的四处（都在真空间隙一节，起因是 F0-D v2 照搬了本规格 v1 的切口规则）。
两份规格不一致时以本表为准，由负责人按 U6 裁决并记录。

| 项 | F0-D v2 | F0-A v2 的约定 | 结论 | 实现方 |
|---|---|---|---|---|
| 修改计数 | `rev` + `touch()`（K13），所有修改方法递增 | 同 | 采用（v2 初稿曾按工程审查改名 `version`，现改回 `rev`，见 §12） | F0-D |
| 源映射 | `trackChanges()`/`stop(r)`、`invertSourceMap`、`composeSourceMaps`；§10.1 第 1 条请 `editActive` 在克隆上运行 `fn` 并由追踪器求映射 | `editActive` 原位修改（事前快照），未给 `indexMap/src` 时 `t = s.trackChanges(); fn(s); src = t.stop(s)` | 采用追踪器；"在克隆上运行"不采用（§12）。`fn` 要产生一个新结构时用 `replaceActiveStructure(r, {src: r.sourceMap})` | F0-D 实现，F0-A 使用 |
| 写坐标与丢帧 | JS `setPositions(positions \| {indices, positions}, {frame})`、`keepFrame(i = this.frame)` | 同 | 采用 | F0-D |
| 真空间隙 | `find_vacuum_gap(s, axis=None, *, min_width=None, frame=None, periodic_only=True) → {axis, start, end, width, center, height}`；`find_vacuum_gaps(s, *, frame=None, periodic_only=True)`；并列容差 1e-5 Å | 同；需要非周期轴时 F0-A 传 `periodic_only=False`（D5） | 采用 | F0-D |
| 切口 `gap_cut` | `gap_cut(gap) → float`：中点映射到 (−0.5, 0.5]（即本规格 v1 的规则） | `gap_cut(s, axis, *, frame=None, hint=False) → GapCut \| None`，§3.8.2 的算法（主块下方、漂浮块并入真空、移动最少的窗口、提示门槛 2 Å） | **F0-D 需改（1）**：签名与算法按 §3.8.2；金标 `tests/data/surface/gaps.json`（89 个结构）由 F0-A 提供 | F0-D（两种语言） |
| `unwrap_along_gap` | `unwrap_along_gap(f, gap) = f − floor(f − gap_cut(gap))` | `unwrap_along_gap(f, cut) = f − floor(f − cut.lo)`，`cut` 为 GapCut | **F0-D 需改（2）** | F0-D |
| `find_surface_gap` | 有 ≥ 5 Å 的间隙就用它；否则 `info.surface.axis` 是周期轴时取该轴最宽的间隙（不设下限） | `= surface_normal(s).surface ? surface_normal(s).cut : None`：提示轴的真空必须 ≥ 2 Å 且仍是最宽的（过期的提示被拒绝），真空区可被漂浮分子分开（§3.14.2） | **F0-D 需改（3）**：返回 GapCut，规则按 §3.14.2（F0-D 的写法会把过期提示指向的面内轴、哪怕只有 1 Å 的"间隙"当成表面） | F0-D 实现，F0-A 的 `surface_normal` 与它共用计算 |
| `make_contiguous` | 只供显式编辑；切口用 `gap_cut(gap)`，整数平移在 m ∈ {0, −1, +1} 中取移动最少者 | 切口位置改用新的 `gap_cut(s, axis)`；平移规则不变 | **F0-D 需改（4）**：只改切口来源；调用方（M2）由编辑前后分数坐标之差取整得到 `imageShift`（§3.9.4） | F0-D，M2 调用 |
| `vacuum_gap_hint` | 带实测值的说明（"no vacuum gap of 5 Å or more along a periodic cell vector (the widest is 3.3 Å along c); add vacuum first"） | `requireVacuumGap` 直接显示它（首字母大写、加句号） | 采用；措辞去掉 "periodic"（非周期轴上的真空也算，D5），作为第（3）项的一部分 | F0-D |
| 导入时识别 slab | 已全部删除（K5） | 同（U1） | 采用 | — |
| `set_pbc` / `setPbc` | 只改 pbc，不移动原子，没有界面入口 | 同 | 采用 | F0-D |
| 显示的 `noBoundaryAxes` | 已撤回 | 被 U1 的切口取代 | 采用 | — |
| 常量 | `SURFACE_DEFAULTS`：Python snake_case、JS camelCase（`vacuumGapMin` 5.0、`positionTolerance` 1e-5 …） | F0-A 追加 `surfaceHintGapMin` 2.0、`blockGapMin` 3.5、`smallBlockFraction` 0.5 | 采用并追加 | F0-D 建文件，F0-A 追加键 |
| `core/lattice.js`、`core/lattice.py` | F0-D T7 建立（`wrapFractional` 与对 `util.js` 的重新导出），F0-A 只追加 | 同 | 采用；合并顺序 F0-D → F0-A T7a → M1 | F0-D → F0-A → M1 |
| `core/vacuum.js`、`analysis/vacuum.py` | F0-D 建立 | F0-A T7a 追加 `surfaceNormal`/`surface_normal` | 采用 | F0-D → F0-A |
| toast | §10.1 第 3、4 条：编辑与导入的 toast 只显示本步新增的备注（`newWarnings(before, after)`）；悬停与聚焦时暂停计时；`timeout: 0` 的 toast 可用键盘关闭 | §3.2、§3.4 | 采用 | F0-A |
| `facet.edit` 命名空间 | F0-D 注册 `sortBySpecies(order?)`、`clearNotes()`（`setPbc`、`detectSlab` 撤回） | F0-A 建立命名空间 | 采用 | F0-A / F0-D |
| "Property" 配色 | 请排除 `tags`/`adsorbate_id` | B14 | 采用 | F0-A |
| 撤销快照 | §10.1 第 8 条：改用 `toJSON({precision: 8, copy: false})`（`app.js:575`） | 撤销快照改为二进制（§3.1），不再经过 `toJSON` | 不需要（§12） | — |
| C7、C8、props | `invalidateSymmetryInfo`、`addWarning`、`clone()` 不共享 props/info（C2-I2） | F0-A 在删除/替换原子时调用 `invalidateSymmetryInfo`；P-swap 的预览结构由各模块 `clone()` 后修改 | 采用 | F0-D 实现 |
| 测试桥 | `tests/js_bridge.py`、`js` fixture、`facet/web/js/package.json` | F0-A 的 JS 测试都经它运行；未合入前直接 `node --test` | 采用 | F0-D |

**临时实现与删除**（R12）：F0-D 合入前，F0-A 在 `app.js` 里用私有的 `bumpRev(s)`、`keepFrame(s)`、`setPositions(s, …)`，在 `render/display.js` 里内联 `vacgap.mjs` 的
`axisGaps/gapCut/unwrapAlongGap`；`editActive` 没有追踪器时按 §3.2 的回退规则。F0-D 合入的同一个合并请求里删除这些临时代码（写进 F0-D 的合并清单）。

### 10.2 M1（晶胞与晶格工具）

- 在 `core/lattice.js`/`lattice.py` 中**追加**（不改 §3.14.3 签名）：`dSpacing(cell, hkl)`（Miller 控件读数）、`woodPresets(mesh2x2, {primitive})`（预设在原始表面网格中定义，
  换算到当前网格 `P_cur = P_prim · K⁻¹`，不是整数矩阵时 `applicable: false` 并给出 `why`，D6）、`mesh_type`（二维度量判断网格类型）、`millerBasisNote(cell, hkl)`（一般心格的惯用胞指数，经 `describe`）、
  `imatrixInput` 的 `area(value)`（相对原始网格的面积倍数与 Wood 标签，C9 的结构名按原始网格命名）与 `warn(value)` 文案
  （`This matrix turns the slab upside down (c reverses); the top and bottom surfaces swap.`；`This repeats the slab along the vacuum axis; use a 2×2 surface matrix.`）。
  预设表补充矩形网格的 p(1×2) 与 p(2×1)、六方 (2×√3)rect、(√13×√13)R13.9°、p(3×3)、p(4×4)（领域审查已核对）。
- 提供命令 "Cell › Conventional cell"（`centeredCellHint` 的提示里引用）。
- Cell 分区：`registerPanelSection('structure', { id: 'cell', slot: 'cell', … })`；预览用 P-swap（`sameAtoms: true` 或带 `src`）；Re-orient 用 `editActive(..., { cameraTransform: R })`；
  超胞类编辑传 `latticeChanged: true`；有真空间隙的结构改晶胞参数时默认保持笛卡尔坐标（领域审查对 US3 的建议，M1 定）。
- 改变晶格基的操作（重定义晶格、轴置换）同步 `info.surface.axis`（应该；F0-A 会校验，过期的提示不会造成错误，只会失去 2 Å 门槛）。

### 10.3 M2（切面与 slab）

- 在 `info.surface` 中写 `axis`（真空所在轴，标准取向为 2），供 `surfaceNormal` 的提示；`normal` 可保留为说明性字段（F0-A 不读）。
- Cleave、Slab 分区（`order: 10 | 20`）；晶面预览用 `planeLayer`；"Show slab" 用 P-swap；Create 用 `session.commit({ addAsNew: true })`；
  真空输入用 `numberInput({ required: true, min: 0, unit: 'Å' })`（U4）；Miller 读数用 `millerInput({ describe })`。
- Centre slab、`set_vacuum` 用 F0-D 的显式 `make_contiguous`（切口改用新的 `gap_cut`，§10.1），并由编辑前后分数坐标之差取整得到每个原子的 `imageShift` 传给 `editActive`，测量保持指向同一对原子。
- 命令 `surface.cleave`、`surface.vacuum`、`surface.setVacuum` 的 `run`、`params`、`estimate`；`surface.setVacuum` 对 pbc T T F 的二维结构放行（D5）。

### 10.4 M3（层、几何选择与约束）

- Layers 分区（`order: 30`）；"只显示顶部 N 层"用 `setVisibility('layers', { show: indices })`；固定原子标记用 `setHighlight('constraints-fixed', …, { color: 'var(--constraint)', export: 'marker' })`；
  选择查询的实时预览用 `setHighlight('query-preview', …)`；固定/放开用 `editActive(..., { rebuild: 'appearance' })`；选区动作 Fix/Free 用 `registerSelectionAction`（order 35/36）。
- 顶层/底层、"固定底部 N 层"使用 `surfaceNormal(s)` 及其 `cut`（`cut.lo` 是窗口、`cut.main` 是主块范围），与显示同一个切口（U1-2）；判断有没有表面看 `.surface`。
- Color by constraint 用 B13 的配色方案上下文；轴标用 `tier: 'canvas'`，图例用 `tier: 'legend'`；`B12` 的 `registerAtomInfo` 填层号与 SD 标志。

### 10.5 M4（原子操作）

- Move 工具：`tools.register({ id: 'move', icon: 'move', key: 'g', toolbar: true, selects: true, cursor: 'grab', touch: 'claim', hint, mouse, handler })`；
  `down` 对原子或手柄返回 true，`begin` 中选中未选的原子并开 `{kind: 'positions', transient: true}` 会话，`claims(hit)` 仅在命中已选原子或手柄时为真（触屏）。
- 测量与几何用 `refs`（相对存储坐标）；`measurementImages` 直接解析 `refs`；不再需要 `wrapHome` 与拖动提交时的 `imageShift`；只有提交时选择把存储坐标包裹进晶胞，才传 `imageShift`。
  手柄与枢轴的显示位置用 `model.homeIndex[i]` 的绘制坐标。
- Transform 分区（`registerPanelSection('structure', { id: 'transform', slot: 'transform' })`）用 `vec3Input`/`numberInput` 与 P-pos 预览（显示预览条）；B11 的 `surface` 坐标系可选。
- 选区动作 Move…/Rotate…（order 60/61）。

### 10.6 M5（吸附物）

- Site-pick 工具：`tools.register({ id: 'site-pick', icon: 'target', toolbar: false, selects: false, cursor: 'crosshair', touch: 'claim', handler: { claims: () => false, click, hover, cancel } })`。
- 位点标记用 `markerLayer({ tier: 'top', export: 'marker', pickIn: ['site-pick'] })` 与 `drawnCopies(points, model)`；悬停幽灵用 `ghostLayer`；放置后调整用 P-ghost 会话；
  双击位点直接放置（`overlaydblclick`）；Adsorbates 分区（`order: 40`）；放置面用 `surfaceNormal(s)`（`.surface` 为假时说明原因）。

### 10.7 M6（界面与异质结）

- Interface 分区（`registerPanelSection('surface', { id: 'interface', order: 50 })`）；预览用 P-swap 会话（`commitLabel: 'Create'`），Create 用 `commit({ addAsNew: true })`；
  真空输入同 M2（U4）；长时间的晶格匹配搜索用 `app.startTask(label)` 显示进度。

### 10.8 M7（API、文档与测试总纲）

- 汇总 §5.8 命令表、§5.9 键位（N、Shift+N、G、Shift+5、mod+Enter）与各模块提议的键，查冲突；把 §6.2 的 API 与 `EVENTS` 写进 `docs/PLUGINS.md`；
  测量格式与迁移写进 `docs/SCHEMA.md`；端到端测试目录与慢测试标记；README "Mouse and keys" 更新。

---

## 11. 修订记录

**v1 → v2**（2026-11-09）。v1 已"按用户决定 U1–U4 修改"（去掉 slab 分类、"Treat as slab"按钮与常驻法向箭头；显示层以真空间隙为切口；法向以真空间隙为准；数值输入必填、初始为空；命令表含 M6），v2 保留这些。
v1 原文存档于 `specs/F0-A.v1.md`。每条审查意见都先对照源码或原型核对，再决定是否采纳；下面 D = 领域审查（`reviews/F0-A-domain.md`），E = 工程审查（`reviews/F0-A-engineering.md`）。

**阻断项**

| 意见 | 核对 | 修改 |
|---|---|---|
| D1 测量键的含义被 U1 切口改变，与 M4 的契约矛盾 | 属实：`display.js:225-227` 的像相对包裹后的家；`measref.mjs` 中 400 个用到远面副本或补全配位像的近邻测量有 123 个（31%）在 U1 模型里找不到副本 | 新 §3.9：引用改为相对存储坐标、首个归一；Float64 数值；旧键加载时迁移（迁移后 400/400 找到完全对应的副本，误差 ≤ 1.2e-6 Å）；`model.home/homeIndex`、`storedImage`、`refOf`；`imageShift` 只用于整数格矢包裹；M4 的 `wrapHome` 改为拒绝并给出替代（§10.0）；A-D15、A24、US12、`measure_refs.test.mjs`、e2e 10 |
| E1 与 F0-D 的接口在第 0 波对不上 | 属实：F0-D v1（`specs/F0-D.v1.md`:133/328/674-690/830-839/1019-1024/1315-1327）与本规格 v1 §10 逐项不同；F0-D v1 仍按旧 D3 改 pbc、搬原子 | 新 §10.1 联合接口表，已对齐同期定稿的 F0-D v2（修改计数、追踪器、`setPositions`/`keepFrame`、真空间隙函数与字段、并列容差、常量键名、`lattice.js`/`vacuum.js` 归属与合并顺序、导入时的 slab 识别已删除、`setPbc` 不搬原子、临时实现的删除），并列出 F0-D 需再改的四处；修改计数沿用 F0-D v2 定稿的 `rev`（审查建议的 `version` 未采纳，§12）；A-D4、A-D17、A28 |
| E2 M3、M4 期望的接口与本规格大量不符 | 属实（M3.md:1040-1052、M4.md:890-907），另核对了 M1、M2、M5、M6 的需求节 | 新 §10.0 消费方对照表（M1–M6 共 50 余行，逐行采纳/改名/拒绝）；补上的能力：`imageShift`（新语义）、`singleFrame`、toast 多动作、图例层、配色方案上下文、`openSection({focus, tab})` 与 `shell.openLeft` 委托、`setHighlight` 的令牌颜色与 `opacity`、`surfaceNormal` 的 `surface` 字段（代替建议的 `{requireGap}` 选项，返回形状只有一种）、`overlaydblclick/overlaycontext`、`vec3Input({size: 2})`、`startTask` |

**主要项**

| 意见 | 核对 | 修改 |
|---|---|---|
| D2 U1 切口规则不稳 | 属实，并多发现一处：v1 规则把单层石墨烯（pbc T T T，层在 z = 0）画到 z = 15（晶胞顶面），因为中点恰为 0.5 时取了 `[0.5, 1.5)` | §3.8.2 重写：窗口取移动原子最少的一侧（建议 1）；切口放在主块正下方（建议 2），但**把原子数 ≤ 主块一半的块当作漂浮块**——审查建议的"原子最多的块"在上层原子更多的异质结上会把衬底画到上层上方、隔着真空（`largest_check.mjs`：48 原子上层隔 3.6/4.5/6 Å 叠在 36 原子衬底上，三种都被拆开）；"有真空"按真空区空隙之和判断，10 Å 真空 + 离顶面 4 Å 的 CO 也能切；`info.surface.axis` 提示门槛 2 Å（建议 3）；`requireVacuumGap` 写出实测宽度（建议 5）；场景表与金标（建议 6）。两种语言 89 个结构 0 处不一致；脱附轨迹（231 帧） slab 0 次跳动。滞后（建议 4）未采纳，见 §12 |
| D3 / E3 `surfaceNormal` 以过期的笛卡尔法向为准 | 属实：规则 1 先读 `info.surface.normal`；转动、重定义晶格后失效 | §3.14.2：间隙优先；`info.surface.axis` 只作校验过的提示（必须仍是最宽的真空，过期提示被拒绝，有单测）；不读 `normal`；顶面 = +a_k 一侧；返回 `surface`、`source`、`vacuumAxes`、`cut`。D3 建议的 `info.surface.top` 倒格矢指数未采纳，见 §12 |
| D4 Miller 指数依赖晶胞基矢，v1 §7.6 的结论错 | 属实：`miller_basis.py` 复现 fcc 原胞 (100) = 惯用胞 (1̄ 1 1)、(110) = (001)，bcc 同类结果 | §3.14.4：改正说法；读数行写 `of the current cell`；`centeredCellHint` 识别 fcc/bcc 原胞并给出惯用胞指数（B15），一般心格由 M1 的 `millerBasisNote`；方向标签加 "of the current cell"；`directions.json` 加原胞用例；US14；"slab 上用体相指数"列为可选 C5 |
| D5 pbc T T F 的二维原型没有真空间隙 | 属实：v1 "只看周期轴" | `findVacuumGaps` 三轴都算并带 `periodic`；显示只在周期轴切口；`surfaceNormal` 用非周期轴上的间隙；`requireVacuumGap` 与 `surface.setVacuum` 对 T T F 放行；测试 |
| D6 Wood 预设与读数以当前网格为基准 | 属实（算法属于 M1） | F0-A 只提供接口：`presets` 可为函数并带 `applicable/why/params`，`area(value)` 回调替换读数，`warn(value)` 钩子；网格类型不用 `isHexagonalCell`（写进 §3.14.3）；`woodPresets(mesh, {primitive})`、相对原始网格的面积与命名、补充的预设交给 M1（§10.2） |
| D7 与 F0-D 的真空间隙契约不一致 | 属实（与 E1 同一组问题） | 并入 §10.1；并列规则按容差比较（宽度差 ≤ 1e-6 Å），参考实现与正文一致后固化金标；JS 常量 camelCase；撤掉导入时的 pbc 改写与坐标搬移；`make_contiguous` 只作显式编辑并改用同一个切口 |
| E4 导出策略照写实现不了 | 属实：`viewer.js:1487` 每帧把所有光环设为可见 | `_haloHidden` 集合（§3.11.3）；e2e 5 保留并扩展为四种组合 |
| E5 被工具认领的按下吞掉点击、双击和多选 | 属实：工具分支不走 `_tap`（`viewer.js:336-346`） | §3.13 改为延迟认领：`down` 认领 → 移动超过 `CLICK_PX` 才 `begin`；没移动按 `_tap` 处理（选择、双击、Shift、多选）；`_cancelTool` 写成私有方法；去掉不会出现的 `'blur'`；两指行与 R4 一致；`_onAtomDblClick` 等改看 `selects` |
| E6 P-pos 换移动集合时位移叠加、取消后不复原 | 属实：`pv_setchange.mjs` 复现 | 会话只存一次 `orig` 与 `touched`；离开集合的原子写回；`pv_fix.mjs` 验证（C 1.85 / O 4.5，取消后 1.85 / 3.0） |
| E7 P-swap 暂存清单不全 | 属实：`_buildRep` 把旧材质推进 `_trash`（`viewer.js:729, 757-759`） | §3.7.2：完整暂存清单、暂存后置空、`_flushTrash` 跳过、恢复后 `lights.setBounds`/`_updateFloor`/阴影/`_writeHalos`；e2e 3 加逐像素比较与无 WebGL 警告 |
| E8 P-swap 的输入锁不全 | 属实：`_click` 发 `index: -1`（`app.js:746` 清空选区）；框选、`_context`、选区命令都用预览模型 | `viewer.inputLocked` 统一锁住点击、框选、右键、悬停与 `pickAtom`；`app.committedModel` 给选区函数；命令 `when` 双保险；e2e 3 加右键与框选 |
| E9 旧项目里的测量静默失效 | 属实（与 D1 同） | 采用审查提出的"更彻底的做法"（相对存储坐标），见 D1 |
| E10 卡片显示绘制坐标 | 属实：`atomInfo` 用 Float32 绘制坐标（`viewer.js:1394-1407`） | §3.12.3：存储坐标、存储分数坐标与 `image`；A-D18、A26 |
| E11 间隙并列规则三者不同 | 属实：`gap_ties.mjs` 复现 | §3.8.2 的 `better`：宽度差 ≤ 1e-6 Å 视为相等 → 切口离晶胞面更近者 → start 更小；环绕空隙两种语言同一个式子；超空隙的并列同样处理；两例进金标 |
| E12 撤销存储迁移清单不全 | 属实：逐一核对了 `app.js:131-134, 260, 280, 288, 340, 560-566, 711, 837, 851, 857`、`main.js:56`、`shell.js:680-681` | §3.1 迁移清单表；`replaceTop/popTop/detach/attach`；`clear()` 复位 `lastRecorded`；异步调用点显式传 `entry`；`editActive`/`addStructure` 返回条目 |
| E13 整数打包越界静默回绕 | 属实：`pack_int.mjs` | `i32` 只用于 int32 范围内的整数，否则 `f64`，再否则 `json`；`sd` 只用于每个条目都是长度 3 的布尔数组 |
| E14 拖动提交不满足 C11 | 属实 | `singleFrame`（P-pos 默认真，`editActive` 可选）；文案用 M4 的 `Kept frame k of N and dropped the others.`（带 Undo）；e2e 13 |
| E15 规模、关键路径与并行性 | 属实：第 1 批的文件集合有重叠，T3 的行号记错文件，规模偏小 | §9 重写：里程碑 F0-A-core；T3 拆为 T3a/T3b、T4 拆为 T4a/T4b、T7 拆为 T7a/T7b；T6、T10 改为 L；合并顺序与共享文件的分段；方向标签改由 `textLayer` 画；A20、B5、`ms` 可推迟 |
| E16 风险最高的路径没有可执行的测试 | 属实 | e2e 9（真实指针事件 + 记录回调的测试工具）、3（暂存与恢复）、10–13；单测 `edit_active`、`measure_refs`、`vacuum_gap`、`surface_normal`；§7.5 加 P-swap 每次预览与 1 000 个移动原子的预算（`bench1000.mjs` 实测 0.85 ms） |

**次要项**

| 意见 | 修改 |
|---|---|
| D8 侧视有一半方向把 slab 画倒；A-D10 与 §3.13.1 矛盾 | 有表面且侧视时 up = 法向的垂直分量；俯视"右" = 第一根面内晶轴；A-D10 措辞统一；`sideview2.mjs` 验证 7 个方向 |
| D9 / E32 拖动中键拓扑冻结 | 必须：超出判据的键缩放为 0；应该：≤ 200 个移动原子时局部重搜并画新键（B9） |
| D10 新高亮颜色与元素色撞色 | 双色边（`contrast: true` 默认）；F0-A 不再规定固定原子的颜色（M3 定，§10.0 提醒外圈亮度）；MS 的 Color by constraint 由 B13 的配色方案上下文实现（代替"把 tint 提为应该"） |
| D11 B 层无条件优先、被挡住的标记仍能点中 | `pickIn`；`depth: 'atoms'` 的层只有未被挡住才算命中 |
| D12 输入上限挡住性能场景 | `imatrix` 默认 `max = 50`、不设硬性行列式上限（软提示 400）；`miller` 硬上限 30、超过 12 软提示；读数 `(2 2 2) = the (1 1 1) plane` |
| D13 体相按 N 也说"表面法向"；四指数方向是小数 | 按来源的标签；`surface` 字段；`uvwToUvtw({integer})` |
| D14 US3 的例子会把 slab 拉长 38% | US3 改用 Set vacuum（笛卡尔坐标不变）；§10.2 建议 M1 对有真空间隙的结构默认保持笛卡尔坐标 |
| D15 使 c 反向的矩阵会互换上下表面 | `imatrixInput` 的 `warn` 钩子（M1 写文案）；`info.surface.top` 同步未采纳（§12） |
| D16 隐藏原子会被全选后删除 | 两种措施都做：有掩码时 Ctrl+A/Invert 只作用于可见原子；选区卡片显示隐藏数，删除/替换含隐藏原子时确认 |
| D17 原型里的 fcc(111) 堆垛错误 | `fixtures.mjs` 改正（γ = 120° 用 (2/3, 1/3)、(1/3, 2/3)）；重跑基准：10k 原子 54 823 根键（原为 46 420）、全部键重写 11.8 ms，结论不变；撤销快照大小与堆垛无关 |
| D 缺失内容 1 吸附物按组包裹 | B10（按 `adsorbate_id`）；无 id 时按键连片段包裹未采纳（§12） |
| D 缺失内容 2、7 | Float64 测量值（§3.9.3）；测试数据（§7.3） |
| D 缺失内容 3、4 | 表面坐标系输入 B11；原子信息扩展点 B12 |
| D 对 Q1 的补充 | 导出菜单加 "Include selection highlight"（默认开） |
| E17 `parseIndices` 的边界情况 | §3.15 的解析规则；`parse2.py` 验证 25 个输入 |
| E18 文案不一致、字符串语义没写死 | 命令前缀去掉省略号；US9 的数字改用 ASCII；按 `keyLabel` 的实际输出写 `Ctrl Z`；`coerceParam` 只接受 JSON 类型，CLI 先 `parse_cli_value`；CLI 前缀只加一次 |
| E19 P-ghost 与预览条的默认行为 | 悬停幽灵用 `ghostLayer`、不开会话；`transient` 标志代替从 `owner` 推断（显式） |
| E20 `'appearance'` 预算没有依据；`touch()` 会留下旧画面 | `inPlaceColors`；预算改为 ≤ 10 ms / ≤ 45 ms；`notifyStructureChanged` 比较摘要选择重建方式；R6 的核对常开 |
| E21 局部上传与视锥剔除 | 整体写函数先 `clearUpdateRanges()`；会话期间 `frustumCulled = false` |
| E22 观察方向的几处不一致 | 同 D8、D13 |
| E23 数字框与无障碍 | 屏蔽滚轮、`badInput` 视为输入中、拦截粘贴；`ariaIndices` |
| E24 预览条 | `role="region"` + 单独的 status；`edit.applyPreview` 快捷键 mod+Enter；与 HUD 上下堆叠 |
| E25 REST 端不规范化参数 | 插件声明了 `params` 时非严格校验并规范化，失败 422 |
| E26 命令参数校验的位置与回退注册 | 校验放进 `register` 的包装函数；回退实现 `if (!commands.get(id))` 且先于模块导入；`view.along` 在 `run` 中检查 |
| E27 Surface 面板整面板重绘 | 分区各自渲染、按各自签名重绘；面板签名不含选区 |
| E28 会话与轨迹、缩略图、截图 API、嵌入页、导出菜单 | §3.6.3 表格逐项写明 |
| E29 删除和替换原子没有清空间群 | 调用 `invalidateSymmetryInfo` |
| E30 `display.gapCut` 与 `estimateDisplayCount` | 调试开关改为视图属性；计数用切口缓存 |
| E31 选区与隐藏原子、Measure 单原子、Fix/Free 顺序 | 同 D16；Measure 为 1–4 个原子；Fix/Free 35/36；桌面 7 个、窄屏 5 个 |
| E33 开放问题、报告 07、行号 | ⚑ Q1–Q5 改为已定案（U6）；报告 07 已存在并列入依据；行号改正（`structureKey` 103-107、`defaultParams` 43-55、`rankCommands` 73-101、`overlayDark` 933、`shown[j]` 190、`parse_params` 94-107） |
| E34 API 细节 | `preview` 事件只含可序列化字段；缩略图单独规则；`drawnCopies(points, model, opts)` 一个签名；内部 `tools.register` 为必须、公共 `facet.registerTool` 留在可选 C4；`commit()` 统一返回 `{entry, structureEntry}` |
| E 缺失内容 1–8 | 1 → §10.0；2 → §3.14.2（不再读 `normal`，所有权问题随之消失）与 §10.2；3 → §3.9 与 §3.8.2（P-pos 中冻结切口；滞后见 §12）；4 → §3.1；5 → §3.6.3；6 → §9 与 §10.1；7 → §3.7.2；8 → mod+Enter 与 keydown 接缝（§3.13.3） |

**与同期 v2 规格的对齐**（F0-D v2、M4 v2 在本次修订期间定稿，按它们的定稿文本核对）

| 来源 | 内容 | 处理 |
|---|---|---|
| F0-D v2 K13 | 修改计数名为 `rev`，`touch()` 递增 | 采用：本规格 v2 初稿按 E1 改成的 `version` 全部改回 `rev` |
| F0-D v2 §3.13 | `find_vacuum_gap`/`find_vacuum_gaps`（字段 `{axis, start, end, width, center, height}`，`end` 在 [0, 1)，并列容差 1e-5 Å）、`vacuum_gap_hint` | 采用；§3.8.2 的 `VacuumGap` 字段、并列容差（改用 `positionTolerance`）、`findVacuumGaps` 的默认值随之改 |
| F0-D v2 §3.13.2–3.13.4 | `find_surface_gap`、`gap_cut(gap)`（中点映射到 (−0.5, 0.5]）、`unwrap_along_gap(f, gap)`、`make_contiguous` 的切口 | 不采用其规则：它们照搬了本规格 v1 的切口，正是 D2 指出的问题；§10.1 写明 F0-D 需改的四处，金标由 F0-A 提供 |
| F0-D v2 §10.1 第 3、4、7 条 | toast 只显示本步新增的备注、悬停暂停、键盘关闭；`facet.edit` 里 `sortBySpecies`、`clearNotes` | 采用（§3.2、§3.4、§6.2） |
| F0-D v2 §10.1 第 1、8 条 | `editActive` 在克隆上运行 `fn`；撤销快照用 `toJSON({copy: false})` | 未采用（§12） |
| M4 v2 A-CR1–A-CR4 | 测量键改写、`homeOffsets`、P-pos `commit(positions, {keepFrame})`、`up()` 返回 false 走点击 | A-CR2 采纳；A-CR3 采纳（选项名 `singleFrame`）；A-CR1、A-CR4 以测量引用 v2 与延迟认领代替（效果相同，§10.0）。v2 初稿把 `commit({positions})` 列为拒绝，按 A-CR3 改为采纳 |
| M4 v2 的接口清单 | 按 F0-A v1 的名字（`banner`、`selectFallback`、`surfaceNormal → {normal, axis, source}`） | §10.0 写明三处由 M4 改名 |

**其他更正**

- M1 规格指出 v1 §10 的"方格 c(4×2) = (2√2×√2)R45° `[[2,2],[-1,1]]`"不成立（领域审查认为 8 个矩阵都对，漏了这一条）。核对：`[[2,2],[-1,1]]` 的最短格矢长 √2，
  而 c(4×2)（`[[2,1],[-2,1]]`，HNF `[[2,1],[0,2]]`）的最短格矢长 2，二者不是同一个格子，也不由衬底的对称操作联系。v2 不再在本规格列 Wood 矩阵，以 M1 的 `woodPresets` 为唯一来源。
- §3.8.2 的新规则顺带修掉 v1 的一个未被审查发现的错误：中点恰为 0.5 时（单层、单原子层的 pbc T T T 结构）v1 把整层画到晶胞顶面。
- 依据里补上报告 07；原型清单分为 v1 与 v2 两组。

---

## 12. 未采纳的意见

| 意见 | 理由 |
|---|---|
| D2 建议 4、D 缺失内容 6、E 缺失内容 3 的一部分：切口滞后（拖动提交、撤销、换帧之间沿用旧切口，间隙中点变化小于某个量时不动） | 切口必须是结构的纯函数：M3、M5 在 Python 里用同一个切口判断上下表面，P1 要求两种语言对同一结构给出同一结果，滞后会让结果依赖操作历史，也无法写成金标。v2 规则本身已经稳定：脱附轨迹（231 帧）中 slab 0 次跳动，CO 只在贴近像的底面时跳一次（物理上合理）；弛豫起伏不改变切口所在的空隙；拖动预览期间切口冻结（§3.8.2）。代价是 Q6 的已知行为（底面脱附的分子在离开底面 3.5 Å 后画到顶面上方） |
| D3：`info.surface` 存当前晶胞中顶面的倒格矢指数 `top`，所有基变换（M1、F0-D、M2、M6）按 `top′ = P · top` 同步；D15 的同步更新 | 顶面由几何确定（+a_k 一侧，右手晶胞即 a×b 方向，与 pymatgen 相同），不需要额外状态；让四个模块在每一种基变换里维护一个新字段，本身就是新的过期来源（正是 D3 指出的问题）。c 反向是用户显式选择的矩阵，在应用前由 `warn` 钩子提示（D15 的提示部分已采纳） |
| E3：在 C7 旁加一条"改变晶格基或刚性旋转的操作清除 `info.surface.normal` 并重算 `axis`" | F0-A 不再读 `normal`，它过期不再造成错误；`axis` 过期时校验会拒绝它。所以只建议 M1 同步 `axis`（应该，§10.2），不设强制规则 |
| M3（E2 表）：`editActive` 的 `fn` 修改深拷贝 | 原位修改加事前快照已能完全回滚；深拷贝每步多一次克隆，并使持有 `app.structure` 引用的面板与分析缓存失效；`structureKey` 已含 `rev`，变化总能被看见 |
| M4 v1（E2 表）：导出 `wrapHome(f) → integer` | U1 之后包裹依赖整根轴的切口（还有按组包裹），不能由单个分数坐标算出；照抄 `display.js:131-137` 会离选中原子差一个 c。M4 v2 已撤回此项，改为 A-CR2 的 `homeOffsets`（已采纳）与相对存储坐标的测量引用（§3.9.5） |
| M2：F0-A 的 `surfaceNormal` "首先读 `info.surface.normal`" | 同 D3/E3 的理由；M2 继续写 `axis` 即可 |
| D 缺失内容 1 的后半：没有 `adsorbate_id` 时，对 ≤ 20 原子的非金属键连片段按片段包裹 | 键是在包裹之后由绘制坐标求出的（`buildDisplayModel` 末尾的 `findBonds`），按片段包裹需要先在存储坐标上另求一次键图，再包裹、再求一次绘制键，`buildDisplayModel` 的代价翻倍；M5 放置的吸附物都带 `adsorbate_id`，已由 B10 覆盖。导入的、没有 id 的结构保持逐原子包裹（现状），留作以后的可选项 |
| E1 建议的修改计数名 `version` | F0-D v2 已定稿为 `rev` + `touch()`（K13），M1 也按 `rev` 写；两边只需一个名字，改用已定稿的那个，变动最少 |
| F0-D v2 §10.1 第 1 条：`editActive` 在克隆上运行 `fn`（`work = old.clone()`） | 同对 M3 深拷贝请求的理由：原位修改加事前快照已能回滚，克隆每步多一次复制并使持有 `app.structure` 的引用失效；F0-D 的追踪器原位同样可用（`t = s.trackChanges(); fn(s); t.stop(s)`）。要产生新结构时用 `replaceActiveStructure` |
| F0-D v2 §10.1 第 8 条：撤销快照改用 `toJSON({precision: 8, copy: false})` | 撤销快照改为按条目的二进制快照（§3.1），不再经过 `toJSON`，这一条没有对象 |
| D10：把 C1 的 `style: 'tint'` 提为"应该" | 目的（MS 的 Color by: Constraint）改由 B13 的配色方案上下文实现，这是 M3 自己请求的方式，复用现有的配色方案与图例机制；tint 留在可选 |
