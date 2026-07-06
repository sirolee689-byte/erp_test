# 系统内核

## 已完成功能

- **ERP核心 / 系统EMAIL发送配置**：页面路径 `/system/kernel/erp-core`，维护 `UB_ERP_System_mail` 第一条全局邮件发送配置。
- **打印设定**：页面路径 `/system/kernel/print-setting`，维护 `UB_ERP_System_Head` 第一条全局打印抬头配置。
- **数据库配置**：页面路径 `/system/kernel/database-config`，维护 `UB_ERP_System_Database_Config` 中项目表名的用途和备注。
- **顶部按钮区**：ERP 内核内只保留 `BOM编码规则`、`系统EMAIL设定`、`打印设定`、`数据库配置` 四个按钮；打印设定和数据库配置在左侧栏隐藏，只通过 ERP 内核按钮进入。

## 系统EMAIL发送配置

- 读取接口：`GET /api/system/kernel/mail-config`。
- 保存接口：`PUT /api/system/kernel/mail-config`。
- 业务表：`UB_ERP_System_mail`；按 `id ASC` 读取第一条。
- `systemcode`：核心编码，只读；已有记录用库内值，空值或无记录时由后端生成。
- `code`：固定展示 `005`，不写入业务表。
- `IT_manager`：固定展示 `UB_ERP_System_mail`，不写入业务表。
- 邮箱密码不明文回显；输入新密码才覆盖，留空保存时保持原值。

## 打印设定

- 读取接口：`GET /api/system/kernel/print-config`。
- 保存接口：`PUT /api/system/kernel/print-config`。
- 业务表：`UB_ERP_System_Head`；按 `id ASC` 读取第一条。
- `systemcode`：核心编码，只读；已有记录用库内值，空值或无记录时由后端生成。
- `code`：固定展示 `002`，不写入业务表。
- `IT_manager`：固定展示 `UB_ERP_System_Head`，不写入业务表。
- 页面只显示当前要维护的打印抬头字段：企业名称、税号、地址、系统标题、单据 LOGO、单据标头和核心密钥。
- `logo` 是单据 LOGO，页面按图片预览显示，支持上传更换；兼容旧系统 `<img ...>` 标签或纯图片路径，保存时尽量保留旧 `<img>` 标签格式，只替换图片地址。
- `info` 是单据标头的 HTML 内容；页面按“单据 LOGO 在上、标头内容在下”的方式展示，标头内容用可视化编辑区维护，不把 `<img>`、`<table>` 源码直接露给用户。
- 旧表中的语言包、补充标头/版次、微信/二维码内容、首页 LOGO、首页图片、首页微信/二维码图片不再显示在本页面；接口仍保留已加载值，避免保存当前页面时误清空老数据。
- 打印设定图片上传默认保存到 `public/system-kernel-images`，可通过 `.env` 的 `ERP_PRINT_IMAGE_DIR` 指向服务器固定 LOGO 目录，通过 `ERP_PRINT_IMAGE_URL_PREFIX` 指定访问前缀。
- 更新时写真实字段 `edittime`；新增时写 `addtime` 和 `ip`。

## 数据库配置

- 读取接口：`GET /api/system/kernel/database-config`。
- 保存接口：`PUT /api/system/kernel/database-config`。
- 配置表：`UB_ERP_System_Database_Config`；首次打开时如果表不存在，后端返回内置项目表清单；首次保存时创建配置表并写入配置。
- 页面列：`数据库名称`、`用途`、`备注`；数据库名称只读，用途和备注可编辑。
- 默认清单来自项目源码、接口日志映射和数据库文档中已经使用的 ERP 表；能确定用途的表给默认用途，不能确定时由超级管理员补充。
- 本功能只维护表名说明元数据，不参与业务 SQL 表名替换；真实表名迁移需要单独做白名单、逐模块改造和验收。

## 安全与权限

- ERP 内核所有功能模块共用一个核心密钥：后端环境变量 `ERP_CORE_CONFIG_KEY`。
- 核心密钥只在保存接口里校验，前端不保存、不写死，也不写入业务表。
- 系统 EMAIL 的邮箱密码使用后端环境变量 `ERP_MAIL_CRYPTO_KEY` 做 AES-256-GCM 可逆加密，落库格式以 `enc:v1:` 开头。
- 权限路径统一走 `system/kernel/erp-core`：读取需要 `view`，保存需要 `edit`。
- 保存成功后写入 `UB_Date_ERP_Operation_log`；日志不记录核心密钥和邮箱密码。

## 已知边界

- 本模块只维护系统内核配置，不做测试发送邮件按钮。
- 打印设定只保存打印抬头配置，本次不改库存统计表、采购单、销售单、入库单、出库单等实际打印页面。
- 数据库配置不提供“运行时改表名”能力，避免全系统硬编码 SQL 读写错表。
- 修改后端接口后，需要手动重启 API 并重新登录。
