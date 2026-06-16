# 纸格资料（paper-pattern）

## 已完成功能

- **纸格资料导入**：上传 Excel 后解析结果在**大弹窗**（`ErpPageDialog`）中操作；工具栏「正式导入」行最右侧 **删除解析BOM**（二次确认「是否确定删除!」，按本次解析全部主 BOM 精确物理删除，不含 systemcode 手输入口）；主页面保留上传区与「查看解析结果」；「上传并解析」右侧提供**清除解析数据**（二次确认，含清空已选文件与 session，不写库）。**正式导入全部写入成功**后居中弹框提示，点**确定**自动复位到未选文件、未解析状态。基础资料区「导入类型」旁可选**是否清仓单**（默认否；选是时主 BOM / CUT 的 `UB_ERP_Bom_000.kcaa01` 及主 BOM 下 CUT 子件 `bom_parts.kcaa01` 在颜色段末尾加 `-OUT`，其余字段与 Material/Accessory 编码不变）。**各款颜色资料**两行三格：配件编码（主 BOM）、配件名称（默认导入类型中文名，可改，正式导入写主 BOM `UB_ERP_Bom_000.kcaa02`）、颜色编码；工厂款号（默认款色路径，可改，正式导入写主 BOM `UB_ERP_Bom_000.kcaa09`，不参与 `kcaa01` 编码生成）、客款号、组别（厂款号编码源仍来自 Excel）。解析主 BOM / CUT / Material / Accessory、编码预览（不写业务表）。Material 中 **LA-/LB-/LC-** 损耗比例须填写（含 0）；未填时「正式导入」置灰，点击亦弹窗列出缺项。**解析成功后最顶为基础资料确认区**；其下提供「隐藏物料信息 / 显示物料信息」「隐藏基础信息 / 显示基础信息」切换：前者折叠 Material 表格（保留列表标题与 ERP 工作台入口），后者折叠 **CUT 预览**标题与表格（保留主 BOM 编码行）；再下为 Material 区块、编码预览、Accessory。CUT 行按 Excel 绝对列号读取第 3～13 列；导入页 CUT 预览表完整展示；数值三位小数，空为「-」。Material 展示材料单位、损耗（小数）、备注等；`POST /api/paper-pattern/material-bom-fields` 批量只读查 UB_ERP_Bom_000。
- **预览与字段映射**：临时文件 `fileId`、列映射持久化。
- **数据校验（映射行）**：`GET /api/paper-pattern/import/validate` 按映射列校验 kcaa01/kcaa02 等（与 ERP 工作台场景不同）。
- **智能校验**（原 ERP 物料校验工作台，**不在左侧菜单**，从导入页工具栏进入）：对照 `UB_ERP_Bom_000.kcaa01` 校验 **Material 分色全码**（`codesByColor`，与 UB_ERP_Bom_parts 写入一致）与 **Accessory 全码**（不含 CUT- 本身）；不存在时页顶逐条提示「编码 XXX 不存在」；Material 表格按上传 Excel 的 Material 序号横向展开 N/O/P... 分色编码，N 列为同一序号的基准列，各分色全码 `/` 前前缀必须与 N 列一致（如 `LA-0369/VE12` 混入 `LA-0368/*` 时，页顶按序号汇总提示「序号 X 编码存在不统一」，并在表格中直接绿色标出不一致单元格）；可改码并防抖重验；**通过后方可「正式导入」**（前端门禁 + `commit-bom000` 需 `erpSmartCheckAcknowledged`，且后端会再次兜底校验）。接口 `POST /api/paper-pattern/check-material`（不写 UB_ERP_Bom_000、bom_parts）。
- **导入页 Excel**：`POST /api/paper-pattern/import/upload` 落盘得 `fileId`（目录见 `.env` `PAPER_PATTERN_UPLOAD_DIR`），再 `GET /api/paper-pattern/import/parse-tree?fileId=` 解析；URL 与智能校验往返均带 `fileId`。切换顶部标签时由 **keep-alive**（组件名 `paper-pattern-import`）保留内存态；重挂载时从 session 恢复解析树快照（含基础资料区）；**正式导入进行中**不再因临时文件已归档而清空界面或误报「文件不存在」。
- **管理纸格导入资料**（`paper-pattern/import/manage`）：查询 `UB_ERP_System_uplod_file`；立即查询 / 重置 / 查询全部；列表支持按 `id` 下载 Excel（`PAPER_PATTERN_DOWNLOAD_ROOT` + 库中 `filename`/`filepath`）。

## 数据库

- 本模块校验只读查询 `UB_ERP_Bom_000`（或环境变量 `INV_BOM_MASTER_TABLE`）在册行 `kcaa01`（`del` 为空或 `0`）。

## 智能校验显示规则

- Material 智能校验表按上传 Excel 的 Material 序号横向展开 N/O/P... 分色编码，并固定表格高度；首次进入或重新加载资料时先显示固定高度加载面板，不展示半成品表格，解析、首次校验和表格布局完成后再一次性显示完整表格；列多或行多时表格滚动条常显，资料加载、分色列变化或重新校验后会刷新表格布局，页面外层也保留自然纵向滚动。
- 智能校验页本身会启用页面外层纵向滚动，Material 表内部固定高度滚动不影响继续向下查看 Accessory 区域。
- 单元格颜色含义固定为：红色表示编码不存在系统中，需要先录入；绿色表示 Material 编码存在但同一序号下与 N 列基准前缀不统一；橙色表示编码为空，需要回到导入资料及时填写。Accessory 表的 ERP 全码格同样按红色/橙色直接高亮，Accessory 不做 N 列基准不统一判断。
- 空编码会在顶部提示区按序号提示 `序号:X，编码为空，请及时填写导入资料`；空值优先级最高，不再同时标成不存在或不统一。

## 已知问题 / 下一步

- 正式导入成功会登记 `UB_ERP_System_uplod_file`（`filename` 为导入时刻时间戳， `truefilename` 为原始文件名）。
- ERP 比对规则：展示层对编码做首尾 trim、中间连续空白压成单空格，比对键为全小写，与库内 `kcaa01` 经 `LOWER+LTRIM+RTRIM` 后匹配（兼容大小写与多余空格）。
