# 负责人决定（按 U6 由负责人裁决；优先级：简报 U 节 > 本文件 > 接口账本 > 模块规格）

针对 `acceptance.md` §4.1 的待裁决缺口。账本已裁决的冲突以账本为准，除非本文件明确改写。

| ID | 缺口 | 决定 | 负责模块 |
|---|---|---|---|
| L-01 | G-11 POSCAR 写出的 `-0.0`、末位噪声、速度块 | 接受建议：写出前把绝对值小于半个末位的值写成 0；"内容逐字节等价"按 S14 的规范形定义，夹具往返两种语言都比规范形；非零速度块读入 `props.velocities` 并写回（升为"应该"），丢弃时给一条导出说明 | F0-D（T4） |
| L-02 | G-12 二维原型的 `build.crystal(..., vacuum=)` 与 CLI `--vacuum` 是每侧真空 | 保持现有含义（不破坏已有脚本）：docstring、CLI 帮助和文档写明 "vacuum on each side (Å); the gap between periodic images is twice this"，调用时发 `DeprecationWarning` 建议新代码用 `set_vacuum`（总间隙）；Build 面板二维原型的输入框改名为 `Cell height c (Å)` | F0-D（T10），M7 写文档 |
| L-03 | G-15 TiO2 空位 slab 的位点随面内原点变化 | 接受建议：桥位保留判据改用键图近邻距离；平铺与归属前把表面原子平移到规范原点；不变性测试加 (0, ½)、(¼, ½)、(½, ½) 平移与空位用例 | M5 |
| L-04 | G-17 F0-A US3 写"改真空时笛卡尔坐标不变" | 改为"选 `Keep` 时笛卡尔坐标不变"；默认 `Centre` 会移动原子 | F0-A（文档与 e2e） |
| L-05 | G-18 两条"在表面上方放原子"路径的默认键长不同 | M4 的 `Add atom › Above selection` 对吸附物库里有的元素调用 M5 的目标距离函数（M5 §3.10.3），读数注明来源；库里没有的元素用 1.0 × 共价半径之和 | M4、M5 |
| L-06 | G-19 端到端测试的语言与选择器 | 用 Node 版 Playwright（预装 Chromium，root 下加 `--no-sandbox`），由 pytest 包装，标记 `slow`；各模块 §5 控件表里的 `aria-label` 是选择器的唯一来源，改名必须同时改 e2e | M7、F0-D 测试桥 |
| L-07 | G-21 界面配位报告 | 状态行升为"必须"，并在 `info.surface.interface.registry` 记录覆盖层最下层每个原子的配位（top/bridge/fcc/hcp） | M6 |
| L-08 | G-24 表面网格倍数提示 | 用通用文案 `Using the input cell: the surface cell has N times the area of the smallest one`，能写 Wood 记号时附上 | M2 |
| L-09 | G-25 多元素表面的位点摘要 | 用与类标签相同的组成写法，如 `4 site atoms (Ti2O2)` | M5 |
| L-10 | G-28 CLI 删除原子 | 提供 `crystallume edit delete FILE --atoms SPEC -o OUT`（第 2 波，随 M4 的 `crystallume edit` 组） | M4 |
| L-11 | G-30 体相名两种语言不同 | 收尾阶段统一（M7）；在此之前跨语言比较排除 `bulk.name` | M7 |
| L-12 | G-32 自动名哨兵的键名 | 只留 `info.surface.autoName`（M2 是 `info.surface` 的属主）；M1 §3.5.4、M5 K10/§4.5/§10、M6 §4.1 改用它；M5 只删除 v1 自己的 `baseName` | M2、M1、M5、M6 |
| L-13 | G-33 已有结构 `set_vacuum(0)` | 确认 M2 的规则：0 Å 只在切面与界面构建时有定义（保持体相层间距）；对已有结构报 E12d，文案说明可改用 V = 0 切面或 `oriented_cell`。U4 的"允许填 0"指切面与界面构建 | M2 |
| L-14 | G-34 局部法向的措辞 | 以 M5 §3.5 为准："hollow 的所有边界边在键图中相连"即启用局部法向 | M5 |
| L-15 | G-35 吸附高度的数值 | 测试一律按 M5 §3.10 的式子现算（系数从 `adsorbates.json` 读），不抄数字；其他规格引用高度时注明"按 M5 §3.10" | M5、M7 |
| L-16 | G-36 表面超胞的入口 | **嵌入**：`Surface › Slab` 分区内嵌同一个超胞编辑组件（只允许面内矩阵，显示表面预设），符合 D1/U5 中"Slab 分区含表面超胞"的约定；`Structure › Cell › Supercell` 是同一组件的完整 3×3 版本。两处共用一份预设表、同一套命名和同一个测试 | M1、M2 |
| L-17 | G-37 M6 仍改写 `firstAtom` | 删去两处 `firstAtom` 改写；不复制自动名哨兵（L-12 的键），新结构的名字按 M6 §4.4 | M6 |
| L-18 | G-38 `count` 的语义 | "本次新增 N 个"，选位规则同 M5 §3.12.2（种子 = 已有吸附物，最远点，平局取位点序最小者），与 `coverage` 互斥；写进 §3.12.2 与 CLI 帮助 | M5 |
| L-20 | M7 §6.8 的账本修订提议 N-01…N-17 | **全部批准**：开发按 M7 §6.8 的名字与签名实现（覆盖两份账本里对应条目的旧名），M7 §9.2 列出落到各任务的改动；N-18…N-38 按 M7 定案执行 | 各模块对应任务 |
| L-21 | 计划 P-04：预览条与 mod+Enter，P-swap 会话无参 `commit()` 可能替换体相 | M2-T9 先核对；确有问题才给会话加 `commitArgs` 选项 | M2、F0-A |
| L-22 | 计划 P-12 / L-11：体相名统一 | 统一为 Python 现有写法（如 `Pt fcc`），收尾阶段（W5）落实 | M7 |
| L-23 | 快捷键 Shift+A、Shift+S | 按 M5 与 M7 §5.2 的登记注册；W5 复核冲突 | M5、M7 |
| L-19 | G-39 c(2×2) 等预设产生的结构名 | 自动名一律用由 `info.supercellMatrix` 计算的 Wood 标签（如 `(√2×√2)R45°`）；预设标签只出现在读数与 toast 里（`Made a c(2×2) = (√2×√2)R45° supercell: 8 atoms`）。两条路径（Slab 分区与 Cell 分区）的名字由同一个测试核对 | M1、M2 |
