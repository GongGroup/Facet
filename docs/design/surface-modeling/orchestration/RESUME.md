# 接续说明（orchestration state）

本目录是表面建模开发的调度状态快照，用来在新会话里接着做。快照时间：2026-11-10 02:01 UTC，对应主分支提交 `a3286fb`。

## 现在到哪了

- 设计全部完成并入库（上一级目录：架构约定、两份接口账本、8 个模块规格、M7 总纲、验收场景、负责人决定 L-01…L-26）。
- 开发按依赖图推进：共 120 条链，`merged.txt` 里的 23 条已合并进本分支并通过全量测试（Python 全套 + Node 测试 2488 个，0 失败）。
- `running.txt` 是快照时正在开发的链。**它们的半成品只在当时那台机器的本地 worktree 里，没有推送**；会话丢失后，这些链按任务说明重新开工即可。
- 已合并的内容概览见 `progress.md`（按时间记录每次合并、验证和决定）。

## 文件

| 文件 | 作用 |
|---|---|
| `dag.json` | 全部链：依赖（after）、归属文件、任务说明（brief） |
| `scheduler.py` | 列出当前可开工的链：`python3 -I scheduler.py --merged merged.txt --running running.txt --slots N`；`--check`、`--critical-path` |
| `chaininfo.py` | 打印一条链或一个任务的完整说明：`python3 -I chaininfo.py <chain-id> [<task-id>]` |
| `chain-notes.json` | 负责人给各链追加的说明（审查遗留问题的分派等），`chaininfo.py` 会一并打印 |
| `prepare_batch.py` | 为一批链建 git worktree 并生成工作流参数 |
| `surface-dev-chains.js` | 开发工作流脚本：每条链"开发 → 独立核查 → 修复" |
| `dev-handbook.md` | 开发代理必读：环境、规则、提交格式、文档优先级 |
| `merged.txt` / `running.txt` | 调度状态 |
| `w0-leftovers.md` | 第 0 波里没有后续链接手的小问题，留给波末修复 |

## 怎么接着做

1. 准备环境：建一个带测试依赖的虚拟环境（`pip install fastapi uvicorn numpy python-multipart pytest httpx httpx2`），Node 22 以上。
   全量测试：`CRYSTALLUME_REQUIRE_NODE=1 python -m pytest -q -p no:cacheprovider`，以及 `node --test tests/js/*.test.mjs`。
2. 把本目录复制到一个工作目录。`dev-handbook.md` 和 `prepare_batch.py` 里写的是原会话的临时目录路径
   （`/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad`），换成新的路径；
   设计文档在仓库的 `docs/design/surface-modeling/`。
3. 清空 `running.txt`（那些链要重做），运行 `scheduler.py` 得到可开工的链。
4. 每条链：在独立 worktree 里开发 → 独立核查 → 修复 → 合并到 `claude/clever-thompson-5wtccp` → 全量测试 → 推送 → 把链名追加到 `merged.txt`。
   文档优先级：简报 U 节（用户决定）> 负责人决定 > M7 §6.8 已批准的改名 > 两份账本 > 模块规格。
5. 每合并几条界面链，就在主分支上用浏览器做一次冒烟检查（Playwright + Chromium）。

## 快照时正在运行的链

- `w0-a-t3a`
- `w1-m1-contracts`
- `w1-m1-lattice`
- `w1-m2-miller`
- `w2-m4-geometry`
- `w2-m4-fixtures`
- `w1-m3-layers`
- `w3-m5-library`
- `w4-m6-data`

## 下一步的关键路径

第 0 波剩余：`w0-a-t3a`（预览会话）→ `w0-d-t8`、`w0-a-t3b` → `w0-docs`、`w0-a-t12`。
第 1 波：`w1-m1-lattice` → 超胞与晶胞操作 → `w1-m3-layers` → M2 切面分析与组装 → 切面界面（`w1-m2-cleave-ui`）。
