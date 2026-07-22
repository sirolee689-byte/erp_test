# 装饰首页（`views/home`）v1.1.0

### 1. 这个功能是干嘛的？（大白话）
- **目的**：登录后先进一页**欢迎装饰页**，不展示库存、订单等任何 ERP 业务数据。
- **效果**：
  - 登录成功（或打开 `/`）→ 进入 `/home`
  - 显示按时段欢迎语 + `UB_ERP_User.truename`（登录缓存 `erp_user.truename`）
  - 显示本地日期时间（每秒刷新）
  - 下方快捷入口：默认前 **6** 个有权限叶子菜单；可点「编辑常用」自己勾选（最多 6 个）

### 2. 自定义常用快捷入口（v1.1.0）
- **存哪**：浏览器本机 `localStorage`，key 形如 `erp.home.quickMenus.v1.<UserCode>`（无工号则用 `UserName`），**按账号隔离、不入库**。
- **怎么改**：首页卡片下方「编辑常用」→ 勾选有权限菜单 → 保存；「恢复默认」清掉本机自定义，回到系统前 6 个。
- **规则**：
  - 未设置过 → 系统默认前 6 个有权限叶子菜单
  - 已设置 → 只显示仍有权限的勾选项；若勾选的全部已无权限 → 回退默认前 6 个
  - 不做拖拽排序（二期可选）
- **工具**：`src/utils/homeQuickMenus.js`；叶子列表仍走 `getPermittedLeafMenus`（`limit=null` 表示不截断）

### 3. 菜单与标签
- 在 `erp_structure_dump.json` 中有「首页」节点，但 **`hideInMenu: true`**，左侧栏**不显示**。
- 路由 meta：`allowLoggedIn`（只要登录可进）、`noTags`（**不进多标签栏**）。
- **不提供**顶栏 Logo 点回首页；离开后一般靠地址栏或重新登录再进。

### 4. 相关改动位置
- 页面：`src/views/home/index.vue`
- 快捷存储：`src/utils/homeQuickMenus.js`
- 路由落点：`src/router/index.js`（`/` → `/home`）
- 标签跳过：`src/store/modules/tagsView.js`（读 `meta.noTags`）
- 轻导航工具：`src/utils/menuPermission.js` → `getPermittedLeafMenus`
- 登录下发姓名：`POST /api/login` 的 `data.user.truename`（`server/index.js`）

### 5. DIY（样式）
- 在 `src/views/home/index.vue` 的 `.home-welcome` 里改 `--home-*` 变量（雾感、圆角、字号、阴影等）。

### 6. 已知说明
- 若库中 `truename` 为空，欢迎语显示「同事」。
- 改过后端登录返回后需**重新登录**才能拿到 `truename`（旧 `erp_user` 缓存可能没有该字段）。
- 清浏览器缓存会丢掉本机自定义快捷入口。
- 换电脑不会自动同步（按使用习惯：一机一账号，暂不入库）。
