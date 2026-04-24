# 操作员资料（`system/operator`）

### 1. 业务逻辑（白话版）
- **这个功能是干嘛的？**：管理系统的“操作员账号”，可列表、查看、新增、编辑；**禁用**表示**反审核**（把 `pass` 写成 0）；**软删除**表示逻辑删除（把 `del` 写成 1 并记 `deltime`）；回收站里可**恢复**（`del` 回到 0）。
- **谁会用？**：一般是管理员或人事/IT 人员（看你们公司权限怎么分）。
- **旧版库（`uid+usercode+username` 且带 `del+pass`）**：列表「姓名」来自 **`Sys_Users.truename`**（不再关联 `Hr_staff`）；角色名来自 **`Sys_Roles.RoleName`**；默认只查 **`del=0`**；`status=0` 表示回收站 **`del=1`**。

### 2. 数据库关联
- **主表**：`Sys_Users`
- **角色**：`Sys_Roles`（`Sys_Users.RoleID` → `RoleName`）
- **关键字段（旧版+v1.1.9）**
  - **`UserID`**：业务主键（列表 `row-key`、编辑/禁用/软删请求体均用此字段；表格不展示该列）。
  - **`uid`**：审计/人事关联列；与 `UserID` 并存时由后端写入**当前操作者**，不作行定位主键。
  - `usercode`：员工编码
  - `username`：登录账号（表格列「登录账号」，接口字段 `Username`）
  - `truename`：姓名（表格列「姓名」）
  - `pass`：审核（1=已审核绿色，0=未审核红色）；**已审核行锁定编辑与软删除**（与全局规则一致）
  - `del`：逻辑删除（0/空=在册，1=回收站）
  - `password`、`RoleID`、`edittime`、`deltime`、`uid`/`uname`/`utruename`（若库中存在则由后端在写入时维护）
- **角色下拉**：`GET /api/roles?page=1&pageSize=500&status=1`

### 3. 已完成的功能（CRUD 进度表）
- [x] **查**：GET `/api/users`（分页 `ROW_NUMBER`，`page`/`pageSize` 默认每页 **20**）
- [x] **看**：GET `/api/users/:id` 只读详情弹窗
- [x] **增**：POST `/api/users`（动态列插入；规则 16 录入日志）
- [x] **改**：PUT `/api/users`（写 `edittime` 与审计列；日志模版「操作员状态变更！账号…姓名…」）
- [x] **反审核（禁用）**：PUT `/api/users` body 含 `op: 'unpass'`（或兼容旧版 `Status:0`）；`pass=0`；同上日志模版
- [x] **软删除**：PUT `/api/users` body 含 `op: 'soft_delete'`；`del=1` + `deltime`；规则 16「编码删除！操作员编码…」
- [x] **恢复**：PUT `/api/users/resume`（回收站 → `del=0`）
- [x] **禁止物理删**：旧版+v2 下 DELETE `/api/users/:id` 返回 400，勿用

### 4. 模块开发标准（v1.0.4 最终版）
> 这一段是“以后开发类似模块照着做”的标准，避免你每次都从头想一遍。

#### 4.1 参数规范（前端 → 后端）
- **分页参数**（所有列表页面统一）
  - `page`：第几页（默认 1）
  - `pageSize`：每页多少条（**默认 20**，可选 10/20/50/100）
- **搜索参数**（所有列表页面统一）
  - `keyword`：模糊匹配登录账号、员工编码、人事姓名
- **视图参数**（双视图切换统一）
  - `status`：传给后端的视图开关
    - `1`：在册（`del=0`）
    - `0`：回收站（`del=1`）

#### 4.2 返回规范（后端 → 前端）
- **分页列表接口必须返回**
  - `code`：200 表示成功
  - `msg`：成功/失败的中文信息
  - `list`：本页数据数组
  - `total`：总条数（给 `el-pagination` 用）

#### 4.3 页面交互标准（前端）
- **标准搜索栏**
  - 位置：表格上方的独立区域
  - 交互：支持回车搜索 + “查询/重置”
  - 联动：搜索时必须把页码重置为 1
- **标准分页**
  - 表格下方 `el-pagination`
  - 默认每页 10 条，支持 `[10,20,50,100]`
- **标准 CRUD**
  - 新增：弹窗表单 → POST
  - 编辑：弹窗回显旧数据 → PUT
  - 删除：本模块用 **软删除**（`del=1`）与 **反审核**（`pass=0`），不提供物理删除入口

### 5. 接口说明（你可以照着 Postman/浏览器测试）
> 小白提醒：改完后端代码后，通常需要重启后端：`npm run dev:server`

#### 5.1 查询用户列表（查 + 分页 + 搜索）
- **方法/路径**：GET `/api/users`
- **返回格式（固定）**
  - `code: 200`
  - `msg: "success"`
  - `list: 用户数组（本页）`
  - `total: 总条数（给分页器用）`
- **分页参数**
  - `page`：第几页（默认 1）
  - `pageSize`：每页多少条（默认 20）
- **搜索参数**
  - `keyword`：模糊搜索（登录账号 / 员工编码 / 人事姓名）
- **双视图切换规则（v1.1.9）**
  - 前端 `selectedStatus` → 查询参数 `status`
  - `status=1` → 只查 `del=0`；`status=0` → 只查 `del=1`
  - 叠加 `keyword` 时在当前视图下 `LIKE` 过滤
- **示例**
  - 不搜索：`/api/users?page=2&pageSize=10`
  - 搜索：`/api/users?page=1&pageSize=10&keyword=张`
  - 在职视图：`/api/users?status=1&page=1&pageSize=10`
  - 回收站视图：`/api/users?status=0&page=1&pageSize=10`
- **页面怎么用的（数据从数据库到网页）**
  - 页面加载 → `axios.get('/api/users', { params: { page, pageSize, keyword } })`
  - Vite 把 `/api` 代理到后端（见 `vite.config.js`）
  - 后端查询 `Sys_Users` → 把 `list/total` 返回给前端
  - 前端把 `list` 放进 `users` → `el-table` 自动渲染
  - **分页怎么工作的（超小白解释）**
    - 你点分页器 → 前端改 `page/pageSize`
    - 前端把 `page/pageSize` 放到 URL 查询参数里发给后端
    - 后端计算 `offset = (page - 1) * pageSize`
    - 旧版+v2 列表仅使用 **`ROW_NUMBER()`** 分页（SQL Server 2008 R2）；ERP 标准列分支仍保留 OFFSET 降级逻辑（见 `server/index.js`）
  - **搜索怎么工作的（超小白解释，重点讲 LIKE）**
    - 你在输入框输入关键字，比如：`张`
    - 前端把 `keyword=张` 传给后端
    - 后端把它拼成 `@key = '%张%'`
    - SQL 写成：`usercode` / `username` / `truename` 的 `LIKE`（参数化）
    - `LIKE` 的意思是“像……一样”
      - `%` 的意思是“任意长度的任意字符”
      - 所以 `%张%` 就表示“只要中间包含 张 就算匹配”
  - **双视图切换怎么工作的（超小白解释）**
    - 你点“在职操作员/恢复操作员”
    - 前端把一个变量 `selectedStatus` 改成 1 或 0
    - 前端请求时带上 `status=1/0`
    - 后端按 `status` 切换 `del=0` 或 `del=1`
    - 这就是“一个变量控制 SQL 语句切换”的核心设计

#### 5.2 新增用户（增）
- **方法/路径**：POST `/api/users`
- **前端提交字段**
  - `UserCode`：员工编码（`usercode`）
  - `UserName`：登录账号（`username`）
  - `Truename`：姓名（`truename`；库有该列时后端必填）
  - `Password`：密码（bcrypt 入库）
  - `RoleID`：若表有该列则必填
- **后端默认（旧版+v2）**：`del='0'`、`pass='0'`（待审核）；写 `addtime`/`uid`/`uname`/`utruename`（若存在列）

#### 5.3 编辑用户（改）
- **方法/路径**：PUT `/api/users`
- **前端提交字段**
  - `UserID`：必须有
  - `UserCode` / `UserName` / `Truename` / `RoleID` / `Password`（密码可空表示不改）
- **“旧数据回显”是怎么做到的？（超小白解释）**
  - 你点击某一行的“编辑”
  - 前端拿到那一行 `row`（里面就是旧数据）
  - 把 `row.UserCode / row.UserName` 赋值到表单对象 `createForm`
  - 输入框用 `v-model="createForm.xxx"` 绑定了表单对象
  - 所以输入框就自动显示旧值（这就叫回显）

#### 5.4 反审核（原「禁用」按钮）
- **方法/路径**：PUT `/api/users`
- **Body**：`{ UserID, op: 'unpass' }`（兼容旧客户端：`{ UserID, Status: 0 }`）
- **效果**：`pass` 置 0；写审计与规则 16 日志（模版「操作员状态变更！账号…姓名…」）

#### 5.5 软删除
- **方法/路径**：PUT `/api/users`
- **Body**：`{ UserID, op: 'soft_delete' }`
- **效果**：`del=1`，写 `deltime`（若存在列）；规则 16「编码删除！操作员编码…名称…」

#### 5.6 恢复用户（回收站 → 在册）
- **方法/路径**：PUT `/api/users/resume`
- **Body**：`{ UserID }`
- **效果**：`del=0`，`deltime` 置空（若存在列）

#### 5.7 物理删除
- **旧版+v2**：接口 DELETE `/api/users/:id` 会直接 400；请使用 **软删除**。

### 6. 已知问题 / 下一步计划（大白话）
- **工号重复校验（已做后端提示）**：
  - 如果数据库已有唯一约束，新增时出现重复会被后端识别（错误号 2627 / UNIQUE KEY）
  - 前端会直接弹出：**“工号已存在，请勿重复添加”**
  - 下一步建议：数据库层面继续保持/补齐唯一索引（最可靠）
- **密码加密**：目前密码按需求先直存，后续必须改成“加盐哈希”（更安全）。