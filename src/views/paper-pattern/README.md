# 纸格资料（paper-pattern）

## 已完成功能

- **纸格资料导入**：上传 Excel、解析主 BOM / CUT / Material / Accessory、基础资料确认区与编码预览（不写业务表）。**解析成功后最顶为基础资料确认区**；其下提供「隐藏物料信息 / 显示物料信息」「隐藏基础信息 / 显示基础信息」切换：前者折叠 Material 表格（保留列表标题与 ERP 工作台入口），后者折叠 **CUT 预览**标题与表格（保留主 BOM 编码行）；再下为 Material 区块、编码预览、Accessory。CUT 行按 Excel 绝对列号读取第 3～13 列；导入页 CUT 预览表完整展示；数值三位小数，空为「-」。Material 展示材料单位、损耗（小数）、备注等；`POST /api/paper-pattern/material-bom-fields` 批量只读查 Bom_000。
- **预览与字段映射**：临时文件 `fileId`、列映射持久化。
- **数据校验（映射行）**：`GET /api/paper-pattern/import/validate` 按映射列校验 kcaa01/kcaa02 等（与 ERP 工作台场景不同）。
- **ERP 物料校验工作台**：对照 `Bom_000.kcaa01` 校验解析得到的 Material / Accessory ERP 编码；支持就地改码与防抖自动重验；顶部展示「允许导入 / 禁止导入」；接口 `POST /api/paper-pattern/check-material`、`GET /api/paper-pattern/import/parse-tree`（不写 Bom_000、bom_parts）。

## 数据库

- 本模块校验只读查询 `Bom_000`（或环境变量 `INV_BOM_MASTER_TABLE`）在册行 `kcaa01`（`del` 为空或 `0`）。

## 已知问题 / 下一步

- 正式导入（写 Bom_000、bom_parts）、GUID、bom_parts 生成等尚未在本阶段实现。
- ERP 比对规则：展示层对编码做首尾 trim、中间连续空白压成单空格，比对键为全小写，与库内 `kcaa01` 经 `LOWER+LTRIM+RTRIM` 后匹配（兼容大小写与多余空格）。
