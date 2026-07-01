# 系统内核

## 已完成功能

- **ERP核心 / 系统EMAIL发送配置**：页面路径 `/system/kernel/erp-core`，维护 `UB_ERP_System_mail` 第一条全局邮件发送配置。
- **打印设定**：页面路径 `/system/kernel/print-setting`，维护 `UB_ERP_System_Head` 第一条全局打印抬头配置。
- **顶部按钮区**：按旧系统按钮条展示系统内核配置项；“系统EMAIL设定”和“打印设定”是独立页面，互相跳转，其它按钮暂时只展示，不混入本次逻辑。

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

## 安全与权限

- ERP 内核所有功能模块共用一个核心密钥：后端环境变量 `ERP_CORE_CONFIG_KEY`。
- 核心密钥只在保存接口里校验，前端不保存、不写死，也不写入业务表。
- 系统 EMAIL 的邮箱密码使用后端环境变量 `ERP_MAIL_CRYPTO_KEY` 做 AES-256-GCM 可逆加密，落库格式以 `enc:v1:` 开头。
- 权限路径统一走 `system/kernel/erp-core`：读取需要 `view`，保存需要 `edit`。
- 保存成功后写入 `UB_Date_ERP_Operation_log`；日志不记录核心密钥和邮箱密码。

## 已知边界

- 本模块只维护系统内核配置，不做测试发送邮件按钮。
- 打印设定只保存打印抬头配置，本次不改库存统计表、采购单、销售单、入库单、出库单等实际打印页面。
- 修改后端接口后，需要手动重启 API 并重新登录。
