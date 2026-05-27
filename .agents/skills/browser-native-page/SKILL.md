---
name: browser-native-page
description: Project workflow for opening ERP view/edit experiences as clean browser-native pages. Use when the user says "浏览器原生新页", "像 BOM 资料这样打开", "查看/编辑不要子窗口", "打开干净独立页", or asks a module's detail/edit action to open in the current browser as a new tab/page without the ERP sidebar.
---

# Browser Native Page

Use this skill in this ERP project when a detail/edit experience should open like the finalized BOM behavior: a real browser page, not an in-page dialog and not a popup-style `window.open` window.

## Required Behavior

- Use a real link for user-facing entry points: `tag="a"` / `<a>` with `target="_blank"` and `rel="noopener"`.
- Do not use `window.open(url, '_blank', 'width=...,height=...')` for normal buttons; those parameters make many browsers treat it like a popup window.
- Open a clean standalone route/page with no ERP left sidebar, no module menu, and no list page chrome.
- Keep the business content full-screen or near full-screen, focused on the record data.
- Make the URL real and refreshable, carrying enough query/path state to reload the same record.
- Preserve existing permissions by mapping the standalone page to the original module permission path, so it does not get blocked by `403`.
- Keep original data logic, save logic, audit rules, and backend APIs unchanged unless the user explicitly asks.

## Recommended Pattern

1. Add or reuse a standalone route outside `ErpLayout`.
2. Give the standalone route a permission alias to the original page, for example `meta.permissionPath`.
3. Change list/detail action buttons to native links:

```vue
<el-button
  tag="a"
  :href="standaloneHref('detail', row.code)"
  target="_blank"
  rel="noopener"
  @click="guardStandaloneLink($event, row)"
>
  查看详情
</el-button>
```

4. In the standalone page, hide the list/search UI and load the target record from route params/query.
5. Style standalone detail/edit containers to fill the browser viewport.

## Guardrails

- If the browser opens a new tab versus a new window, explain that the browser setting decides this. The code should still use native links.
- For disabled or invalid rows, prevent the link click and show the same business warning as before.
- If internal logic needs to load data in the same component, keep a separate loader function instead of reusing the link-opening function.
- For print/export/saving inside the standalone page, preserve existing behavior.
- If any `server/**` file changes, follow this project's backend restart rule. This skill usually should not need backend changes.

## Ask-Then-Execute

When the user is still deciding the interaction style, combine this skill with `ask-then-execute`: give方案 first, then implement only after "按定稿实现".
