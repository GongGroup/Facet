# 第 0 波开发批次（负责人排定，依据 F0-D §9 与 F0-A §9 的任务表、依赖和合并顺序）

每个批次：开发代理并行（各自 worktree + 本地分支 `sm/<id>`）→ 每个任务一名独立核查代理 → 有阻断/重要问题时修复 → 集成代理按顺序合并到
`claude/clever-thompson-5wtccp`、跑全量测试 → 推送。整波结束后做三视角对抗审查与修复。

| 批次 | 任务（并行） | 合并顺序 | 说明 |
|---|---|---|---|
| W0.1 | `w0-d-base` = F0-D T0 测试桥 + T7 晶格包裹/真空间隙/默认值 + T3 约束核心（同一代理依次完成）；`w0-a-t1` = F0-A T1 撤销存储 v2；`w0-a-t10` = F0-A T10 面板外壳；`w0-a-t4a` = F0-A T4a 叠加层/高亮/导出 | d-base → a-t1 → a-t10 → a-t4a | 文件归属互不重叠（`app.js`、`shell.js`、`main.js` 按行段错开） |
| W0.2 | `w0-d-t1` Python 数据核心；`w0-d-t2` JS 数据核心；`w0-a-t7a` 晶格函数与表面法向；`w0-a-t5` 显示掩码、U1 切口、按组包裹、测量引用；`w0-a-t4b` 拾取与射线；`w0-d-t10` 默认参数表对齐 | d-t1 → d-t2 → a-t7a → a-t5 → a-t4b → d-t10 | `core/__init__.py` 由 d-t1 与 a-t7a 共改（小冲突，集成时合并） |
| W0.3 | `w0-d-t4` POSCAR；`w0-d-t5` extxyz 与读取器小改；`w0-a-t2` 编辑原语；`w0-a-t8` 参数 schema 与输入控件；`w0-a-t7b` 沿任意方向观察 | d-t4 → d-t5 → a-t2 → a-t8 → a-t7b | `tests/test_io.py`、`tests/js/io.test.mjs` 按段落归属，d-t4 先合 |
| W0.4 | `w0-d-t6` 导出检查与通道；`w0-a-t3a` 预览会话与 P-swap；`w0-a-t9` 命令扩展；`w0-d-t9` 二面角与元素数据 | d-t6 → a-t3a → a-t9 → d-t9 | `api/extensions.js` 由 d-t6 与 a-t3a 分段修改 |
| W0.5 | `w0-d-t8` 网页集成；`w0-a-t3b` P-pos 快速路径；`w0-a-t6` 工具注册表与指针钩子 | a-t3b → a-t6 → d-t8 | `viewer.js` 的 256-512 段只由 a-t6 改 |
| W0.6 | `w0-docs` = F0-D T11 + F0-A T11 文档；`w0-a-t12` 端到端冒烟（Playwright）；随后第 0 波整体审查与修复 | docs → t12 | |
