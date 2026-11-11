# 保存为 Materials Studio XSD：设计

状态：已实现（写出按本设计；读入是后来按用户要求加的，见第 11 节）。`samples/` 里的四个文件由按本设计写的原型生成，
正式实现逐字节重现了它们；这四个文件仍需在 Materials Studio 里打开验证（第 9 节），实现时没有这个软件。

## 1. 目标与范围

把当前结构保存为 Materials Studio 的三维原子文档（`.xsd`），在 Materials Studio 里直接打开，继续做 CASTEP、DMol3 等计算的建模。

本设计原先只做**写出**，读入 `.xsd` 列为后续（第 10 节）；读入后来也做了，范围与依据见第 11 节。

## 2. 用户看到什么

| 入口 | 行为 |
|---|---|
| 网页 Export 菜单 | 结构文件一组里多一项 `Materials Studio XSD  .xsd`，排在 PDB 之后 |
| 命令面板 | `Export Materials Studio XSD`，搜 `xsd`、`materials studio`、`save as` 都能找到 |
| 命令行 | `facet convert CONTCAR slab.xsd`（按扩展名识别），`facet formats` 里列出 |
| Python | `facet.io.write("slab.xsd", structure)`，`facet.io.to_text(structure, "xsd")` |
| REST / 客户端 | 现有的格式列表与转换接口自动带上，不加新接口 |
| 在 claude.ai artifact 里 | 查看器不允许直接保存 `.xsd`，文件会像 `.vasp` 一样装进一个 `.zip`（现有机制） |

文件名取结构名（与其他格式相同的规则），扩展名 `.xsd`。保存后和其他格式一样显示导出检查的警告与说明。

## 3. 写什么，不写什么

| 内容 | 处理 |
|---|---|
| 晶胞 | 写，空间群一律 P1 |
| 原子的元素与坐标 | 写；有晶胞时写分数坐标，没有晶胞时写笛卡尔坐标（Å） |
| 原子顺序 | 保持不变 |
| 原子名 | 有标签（如 CIF 的 `Fe1`）用标签；没有则按元素各自编号：`Pt1`、`Pt2`、`O1` |
| 固定原子 | 三个方向都固定的原子写成 Materials Studio 的固定原子（第 5.3 节） |
| 只固定部分方向的原子 | 写成完全固定，并给一条警告 |
| 化学键 | 不写；在 Materials Studio 里点一次 Calculate Bonds 即可（第 9 节 D3） |
| 部分占位 | 不写，警告（沿用现有的占位警告） |
| 多帧轨迹 | 只写当前帧，说明里写明是哪一帧（沿用现有规则） |
| 速度、磁矩、电荷、能量与力 | 不写 |
| 对称性 | 不写；需要时在 Materials Studio 里用 Find Symmetry |

没有另外区分 slab 与非 slab：有晶胞就是三维周期结构，真空层就是晶胞的一部分。

## 4. 文件结构

文件是 XML。下面是周期结构的骨架（N 个原子），属性的顺序与取值都固定，两种语言逐字节相同。

```xml
<?xml version="1.0" encoding="latin1"?>
<!DOCTYPE XSD []>
<XSD Version="6.0" WrittenBy="Facet">
	<AtomisticTreeRoot ID="1" NumProperties="40" NumChildren="1">
		<Property DefinedOn="ClassicalEnergyHolder" Name="AngleEnergy" Type="Double"/>
		… 共 40 行属性定义，内容固定 …
		<SymmetrySystem ID="2" Mapping="3" Children="4,…,N+3,N+4" Normalized="1" Name="SymmSys" UserID="N+1"
		                XYZ="0,0,0" OverspecificationTolerance="0.05" PeriodicDisplayType="Original">
			<MappingSet ID="N+5" SymmetryDefinition="N+4" ActiveSystem="2" NumFamilies="1"
			            OwnsTotalConstraintMapping="1" TotalConstraintMapping="3">
				<MappingFamily ID="N+6" NumImageMappings="0">
					<IdentityMapping ID="N+7" Element="1,0,0,0,0,1,0,0,0,0,1,0" Constraint="1,0,0,0,0,1,0,0,0,0,1,0"
					                 MappedObjects="4,…,N+3" DefectObjects="N+4,N+8" NumImages="N" NumDefects="2">
						<Atom3d ID="4" Mapping="N+7" Parent="2" Name="Pt1" UserID="1" DisplayStyle="Ball and Stick"
						        XYZ="0.333333333333,0.666666666667,0.000000000000" Components="Pt"
						        RestrictedProperties="FractionalXYZ"/>
						… 每个原子一行，ID 从 4 到 N+3 …
						<SpaceGroup ID="N+4" Parent="2" Children="N+8" DisplayStyle="Solid" XYZ="0,0,0" Color="0,0,0,0"
						            AVector="…" BVector="…" CVector="…" OrientationBase="C along Z, B in YZ plane"
						            Centering="3D Primitive-Centered" Lattice="3D Triclinic" GroupName="GroupName"
						            Operators="1,0,0,0,0,1,0,0,0,0,1,0" DisplayRange="0,1,0,1,0,1" LineThickness="2"
						            CylinderRadius="0.2" LabelAxes="1" ActiveSystem="2" ITNumber="1" LongName="P 1"
						            Qualifier="Origin-1" SchoenfliesName="C1-1" System="Triclinic" Class="1" Name="P1"/>
						<ReciprocalLattice3D ID="N+8" Parent="N+4"/>
					</IdentityMapping>
					<MappingRepairs NumRepairs="0"/>
				</MappingFamily>
				<InfiniteMapping ID="3" Element="1,0,0,0,0,1,0,0,0,0,1,0" MappedObjects="2"/>
			</MappingSet>
		</SymmetrySystem>
	</AtomisticTreeRoot>
</XSD>
```

没有晶胞的结构（分子、团簇）用 `Molecule` 代替 `SymmetrySystem`：

```xml
		<Molecule ID="2" NumChildren="N" Name="结构名">
			<Atom3d ID="3" Name="O1" UserID="1" DisplayStyle="Ball and Stick"
			        XYZ="-0.2947333333,-0.2182000000,0.1541666667" Components="O"/>
			… ID 从 3 到 N+2 …
		</Molecule>
```

要点：

- 每个对象的 `ID` 在文件内唯一；`Mapping`、`Parent`、`Children`、`MappedObjects`、`DefectObjects`、`SymmetryDefinition` 等引用都指向存在的 `ID`。
- `SpaceGroup` 上的 `Name="P1"` 是 ASE 写出的文件里没有的。常见的 xsd 转 POSCAR 脚本和 gchemol 靠它判断是不是 P1，加上后这些工具也能读我们的文件。
- 缩进用制表符，换行用 `\n`，文件以换行结束。

## 5. 规则

### 5.1 晶胞取向

Materials Studio 的默认取向是 c 沿 z、b 在 yz 平面内。写出时把晶胞整体转到这个取向：

```
c' = (0, 0, c)
b' = (0, b·sinα, b·cosα)
a' = (ax, ay, az)，az = a·cosβ，ay = a·(cosγ − cosα·cosβ)/sinα，ax = √(a² − ay² − az²)
```

分数坐标不变，结构只是整体转了一个角度。对本应用生成的 slab（a 沿 x、c 沿 z），这是绕 z 轴的转动，表面仍然朝 z。

- 晶胞本来就是这个取向（差别小于 1e-8 Å）：原样写，不给说明。
- 发生了转动：给一条说明。
- 左手晶胞（体积为负）：无法只靠转动得到标准取向，原样写出并给一条警告。

### 5.2 数字

- 分数坐标 12 位小数；晶胞矢量与笛卡尔坐标 10 位小数（Å）。
- 一律定点记法，不用科学记数。
- 舍入规则两种语言相同：按数的精确二进制值四舍五入（恰好一半时远离零），即 JavaScript 的 `toFixed`；Python 用 `decimal` 实现同一规则。
- 舍入后为零的数写成 `0.000…`，不带负号。
- 分数坐标用两种语言里同一个换算函数得到，不做包裹（超出 0–1 的坐标原样写，跨边界的 slab 不会被拆开）。

### 5.3 固定原子

应用内的约束是每个原子沿 a、b、c 三个方向各一个开关（`props.selective_dynamics`，真 = 可动）。

| 原子的状态 | 写出 |
|---|---|
| 三个方向都可动 | 不写约束属性 |
| 三个方向都固定 | 周期结构 `RestrictedProperties="FractionalXYZ"`；分子 `RestrictedProperties="XYZ"` |
| 只固定一两个方向 | 按完全固定写，并警告 |

Materials Studio 里单方向的约束是另一类对象（`AlongAxisSlider`），结构复杂，没有可靠的样例，本版不写。部分固定的原子收紧为完全固定，与写 extxyz 时"收紧而不是放开"的现有做法一致。

### 5.4 元素与原子名

- `Components` 写元素符号。符号不是化学元素（如占位用的 `X`）时照写，并警告 Materials Studio 可能不认识。
- 原子名、分子的 `Name` 里的 `& < > "` 和非 ASCII 字符按 XML 规则转义（非 ASCII 写成 `&#数字;`），文件本身是纯 ASCII。

### 5.5 周期性

Materials Studio 的这类文档要么三维周期，要么非周期。有晶胞就写成三维周期；某个方向在应用里标为非周期时给一条说明（沿用现有的"该格式总是周期的"说明）。

## 6. 导出检查

格式能力表（`io/capabilities`，两种语言各一份、内容相同）加一行：

| id | label | frames | cell | constraints | occupancy | order | pbc | overlap | handedness | velocities |
|---|---|---|---|---|---|---|---|---|---|---|
| xsd | Materials Studio XSD | one | true | atoms | false | keep | periodic | true | false | false |

`constraints` 增加一个取值 `atoms`：只能固定整个原子。

新增的三条消息（英文，两种语言逐字相同）：

- 警告：`3 atom(s) are fixed along some directions only; Materials Studio XSD fixes whole atoms, so they are written as fixed`
- 说明：`the cell is written in Materials Studio's orientation (c along z, b in the yz plane): the structure is turned as a whole and the fractional coordinates are unchanged`
- 警告：`the cell is left-handed (negative volume) and is written as it is; Materials Studio may show its mirror image`

其余情况（多帧、部分占位、原子重叠、非周期方向）用现有消息。

## 7. 要改的文件

| 文件 | 改动 |
|---|---|
| `facet/io/xsd.py`（新） | `write_xsd(structure) -> str` |
| `facet/io/__init__.py` | 注册写出器（扩展名 `.xsd`，类型 `application/xml`）；`export_report` 加第 6 节的三条消息 |
| `facet/io/capabilities.py` | 新取值 `atoms`，新的一行 |
| `facet/web/js/io/xsd.js`（新） | `writeXSD(s)` |
| `facet/web/js/io/index.js`、`io/capabilities.js` | 同上，JS 一侧 |
| `README.md`、`docs/SCHEMA.md` | 格式列表、能力表 |

Export 菜单、命令面板里的导出命令、命令行、REST 和客户端都从格式注册表生成，不用单独改；命令面板的搜索词取自格式的扩展名与描述，描述写成 `Materials Studio XSD (3D atomistic document; save as .xsd)`。不新增依赖。

## 8. 测试

1. **黄金文件**：`tests/data/xsd/` 下放结构（JSON）与期望的 `.xsd`。Python 与 JS 都必须写出逐字节相同的文件。覆盖：立方体相、六方 slab（带固定原子）、三斜晶胞、分子、带标签的 CIF、部分固定、左手晶胞、名字里有特殊字符、坐标超出 0–1、空结构。
2. **结构检查**：能被 XML 解析器读入；`ID` 唯一；所有引用都能找到目标；原子数、固定原子数正确。
3. **独立回读**：开发时用 ASE 读我们写的文件，把读到的晶胞参数与坐标存成参考数据；测试用自带的小解析器比对，不依赖 ASE。
4. **取向**：写出的矢量满足 c 沿 z、b 在 yz 平面；晶胞参数与原子间距不变。
5. **数字**：舍入规则的边界值（恰好一半、负零）在两种语言里一致。
6. **导出检查**：三条新消息的触发条件与文字，两种语言一致。
7. **界面**：浏览器里从 Export 菜单保存，文件名与内容正确；在 artifact 模式下装进 `.zip`。

## 9. 已验证与待验证

已验证（原型，四个样例）：

- XML 格式正确，`ID` 唯一，没有悬空引用。
- ASE 读回三个周期样例：晶胞参数、分数坐标、元素、全部原子间距与原结构一致。
- Pt(111) slab 的 18 个固定原子都带上了约束属性。

**待你在 Materials Studio 里验证**（我这里没有这个软件）：

| 样例 | 看什么 |
|---|---|
| `samples/Pt111_slab_fixed.xsd` | 能打开；a = b = 8.3156 Å，c = 21.7896 Å，γ = 120°；36 个 Pt；Modify › Constraints 里底部两层 18 个原子是固定的 |
| `samples/NaCl_bulk.xsd`、`samples/SrTiO3_bulk.xsd` | 能打开；Find Symmetry 得到 Fm-3m、Pm-3m |
| `samples/H2O_molecule.xsd` | 作为非周期结构打开；Calculate Bonds 后出现两根 O–H 键 |

本设计里靠推断、没有官方文档可查的三处，正好由这次验证覆盖：

- **D1 固定原子的属性值**。`RestrictedProperties` 这个属性名有多个开源转换脚本佐证；取值 `FractionalXYZ` / `XYZ` 来自 Materials Studio 脚本接口里的同名属性，未见到原始文件样例。
- **D2 晶胞取向**。转到 Materials Studio 默认取向是为了让矢量与文件里声明的取向一致。另一种做法是像 ASE 那样原样写矢量。
- **D3 不写键**。周期结构里跨晶胞边界的键在这个格式里要用镜像对象表示，写错会画出横穿晶胞的长键，所以先不写。

另有两处默认决定：文件头写 `WrittenBy="Facet"`（如实标明来源；Materials Studio 若因此拒绝，改为不写这个属性）；原子显示方式统一写 `Ball and Stick`。

## 10. 工作量与后续

实现量不大：两种语言各一个写出器（约 150 行）、能力表一行、三条消息、测试与文档，相当于一条中等大小的开发链。

后续可做，不在本版：

- **读入 `.xsd`**（P1 结构、固定原子）。Materials Studio 用户可以直接打开自己的模型，也能做往返测试。**已做，见第 11 节。**
- **写键**：等两种语言共用的化学键图合并后，先给分子写键。
- **单方向约束、初始自旋、电荷**：需要 Materials Studio 写出的真实文件作样例。

## 11. 实现记录

### 11.1 写出

按第 3–6 节实现：`facet/io/xsd.py` 的 `write_xsd` 与 `facet/web/js/io/xsd.js` 的 `writeXSD`，两种语言逐字节相同
（`tests/data/xsd/` 下 20 个黄金文件，含 `samples/` 的四个）。与设计正文的出入只有三处：

- **第四条消息。** 第 5.4 节要求对不是化学元素的符号给警告，第 6 节的消息表里没有列。实现加了一条警告：
  `2 atom(s) have a symbol that is not a chemical element (X); Materials Studio may not recognise them`。
- **原子名。** 有标签就用标签，同一个位点展开出的原子因此同名（CIF 的 `O1` 出现三次），与 Materials Studio 导入 CIF
  后的情形一样。`samples/` 里的 NaCl、SrTiO3 是用不带标签的结构生成的，所以是 `Na1`…`Na4`。空标签退回按元素编号。
- **名字里的空白与控制字符。** 名字首尾的空白去掉；制表符与换行写成 `&#9;`、`&#10;`、`&#13;`，XML 不允许的字符写成
  `&#65533;`。分子没有名字时写 `Untitled`。

写不出来的情况会报错而不是写出坏文件：晶胞体积为零；坐标不是有限数或不小于 1e21。

### 11.2 读入

`read_xsd` / `readXSD`，注册为 `.xsd` 的读入器，按内容也能识别（`<XSD` 或 `<!DOCTYPE XSD`）。读入的内容：

| 文件里的内容 | 读成什么 |
|---|---|
| 带晶格的文档（`SpaceGroup` 上有 `AVector`、`BVector`、`CVector`） | 三维周期结构，`XYZ` 是分数坐标，不做包裹 |
| 其他文档 | 分子，`XYZ` 是笛卡尔坐标（Å） |
| `Atom3d`，无论嵌在哪一层（`Molecule`、`RepeatUnit`、直接在根下） | 原子，按文件里的顺序；没有 `XYZ` 的在原点 |
| 带 `ImageOf` 的 `Atom3d`、`Bond`、其他对象 | 跳过 |
| `Name` | `props.labels`（没有名字的原子用元素符号；全都没有名字就不建这一列） |
| `RestrictedProperties` 含 `XYZ` 或 `FractionalXYZ` | `props.selective_dynamics` 的 `F F F` |
| 约束对象不是 `CompleteRestriction`，或只限制了别的属性 | 不固定，并给一条说明 |
| `Components` 不只是一个元素符号 | 取其中第一个元素（D、T 读成 H），并给一条说明 |
| 非 P1 的空间群 | 按文件里的对称操作展开（见下） |
| 二维周期文档（只有 `AVector`、`BVector`） | 报错，不读 |

XML 用自带的小扫描器读（两种语言同一套写法）：只认标签与属性；`DOCTYPE` 整段跳过，其中声明的实体从不展开
（只认五个预定义实体与数字字符引用）；对不规范的文件尽量宽容（多余的结束标签、没有关闭的元素、重复的属性）。

### 11.3 对照真实文件得到的结论

实现时找到三份 Materials Studio 自己写的文件（gchemol-readwrite 的测试数据：格式版本 4.4 的聚合物重复单元、
8.0 的三维周期结构、17.1 的分子），两种语言都能读，结果逐位相同。它们没有放进仓库；`tests/data/xsd/read/`
里是照它们的写法手写的小文件。由此可以确定的事：

- **D1 固定原子（部分确认）。** 8.0 的文件里，固定原子写作 `RestrictedBy="132,132"
  RestrictedProperties="XYZ,FractionalXYZ"`，另有一个 `<CompleteRestriction ID="132" RestrictsObjects="…"
  RestrictsProperties="…"/>` 对象。也就是说 `FractionalXYZ` 与 `XYZ` 这两个取值是真的，但 Materials Studio 自己还会写
  `RestrictedBy` 和约束对象；我们只写 `RestrictedProperties`。Materials Studio 是否认只有属性、没有约束对象的写法，
  仍要靠第 9 节的验证；如果不认，写出器要补上 `CompleteRestriction` 对象。
- **D2 晶胞取向（确认）。** 该文件的 `OrientationBase="C along Z, B in YZ plane"`，矢量是
  `AVector="14.918…,-0.903…,0" BVector="0,12.6365,0" CVector="0,0,20.633"`，与第 5.1 节的取向一致。
- **`SpaceGroup` 的 `Name="P1"`。** 真实文件里有这个属性（第 4 节说 ASE 写的文件没有）。
- **镜像原子。** 在 `IdentityMapping` 的兄弟元素 `ImageMapping` 里，带 `ImageOf`，没有 `XYZ`；`ImageMapping` 的
  `Element` 是 12 个数：旋转的三行，每行第四个数是平移（`1,0,0,-1,0,1,0,0,0,0,1,0` 是沿 a 平移 −1）。
- **分子文档。** 原子可以直接在 `AtomisticTreeRoot` 下（没有 `Molecule`），也可以在 `Molecule/RepeatUnit` 里；
  `Name` 可以没有；`Atom3d` 可以有子元素；ID 列表可以是压缩写法 `ci(756):127+4,629+132`（读入时用不到）。
- 文件用 CRLF 换行，声明 `encoding="latin1"`。

没能确认的事：

- **带对称性的文档。** 没有找到空间群不是 P1 的真实文件。读入器的做法是：`Operators` 每 12 个数一个操作（与上面
  `Element` 的排法相同，x′ = R·x + t），加上按 `Centering` 的名字推出的心平移，再加上 `ImageMapping` 里的镜像原子，
  包裹进晶胞后按 1e-3（分数坐标）去重。多个操作之间用什么分隔、`Operators` 里是否已含心平移、`Centering` 的各个取值
  怎么拼写，都是推测；所以展开后一定带一条说明，请用户核对。稳妥的做法是在 Materials Studio 里先
  Build › Symmetry › Make P1 再保存。
- **部分约束。** 没有真实样例；读入时这类原子不固定并给说明，写出时仍按第 5.3 节收紧为完全固定。

### 11.4 网页界面里还缺的几处文字

格式注册表之外的几处界面文字（打开文件的提示、拖放提示）列的是固定的格式名，还没有提到 XSD；功能不受影响
（文件选择框本来就允许任何扩展名）。

## 参考

- ASE 的 `ase/io/xsd.py`（读写实现；本设计的文件骨架与它一致，另修正了它带键时 `ID` 重复的问题）
- gchemol-readwrite 的 `xsd.rs`（只读；要求 `SpaceGroup` 的 `Name` 为 `P1`，有 `RestrictedProperties` 即视为固定）
- 几个 xsd 转 POSCAR 的脚本（tamaswells/VASP_script 的 `xsd2pos-v2.py` 等）：固定原子与单方向约束的写法
