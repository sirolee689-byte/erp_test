# 纸格资料（paper-pattern）

## 已完成功能

- **纸格资料导入**：上传 Excel、解析主 BOM / CUT / Material / Accessory、基础资料确认区与编码预览（不写业务表）。**解析成功后最顶为基础资料确认区**；其下提供「隐藏物料信息 / 显示物料信息」「隐藏基础信息 / 显示基础信息」切换：前者折叠 Material 表格（保留列表标题与 ERP 工作台入口），后者折叠 **CUT 预览**标题与表格（保留主 BOM 编码行）；再下为 Material 区块、编码预览、Accessory。CUT 行按 Excel 绝对列号读取第 3～13 列；导入页 CUT 预览表完整展示；数值三位小数，空为「-」。Material 展示材料单位、损耗（小数）、备注等；`POST /api/paper-pattern/material-bom-fields` 批量只读查 Bom_000。
- **预览与字段映射**：临时文件 `fileId`、列映射持久化。
- **数据校验（映射行）**：`GET /api/paper-pattern/import/validate` 按映射列校验 kcaa01/kcaa02 等（与 ERP 工作台场景不同）。
- **智能校验**（原 ERP 物料校验工作台，**不在左侧菜单**，从导入页工具栏进入）：对照 `Bom_000.kcaa01` 校验 **Material 分色全码**（`codesByColor`，与 Bom_parts 写入一致）与 **Accessory 全码**（不含 CUT- 本身）；不存在时页顶逐条提示「编码 XXX 不存在」；可改码并防抖重验；**通过后方可「正式导入」**（前端门禁 + `commit-bom000` 需 `erpSmartCheckAcknowledged`）。接口 `POST /api/paper-pattern/check-material`（不写 Bom_000、bom_parts）。
- **导入页 Excel**：`POST /api/paper-pattern/import/upload` 落盘得 `fileId`，再 `GET /api/paper-pattern/import/parse-tree?fileId=` 解析；URL 与智能校验往返均带 `fileId`，返回导入页时自动重载解析树（基础资料区从 session 恢复）。

## 数据库

- 本模块校验只读查询 `Bom_000`（或环境变量 `INV_BOM_MASTER_TABLE`）在册行 `kcaa01`（`del` 为空或 `0`）。

## 已知问题 / 下一步

- 正式导入（写 Bom_000、bom_parts）、GUID、bom_parts 生成等尚未在本阶段实现。
- ERP 比对规则：展示层对编码做首尾 trim、中间连续空白压成单空格，比对键为全小写，与库内 `kcaa01` 经 `LOWER+LTRIM+RTRIM` 后匹配（兼容大小写与多余空格）。
