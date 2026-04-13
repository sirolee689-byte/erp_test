/**
 * 根据 erp_structure_dump.json 递归生成 views 目录下各模块的 index.vue
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const jsonPath = path.join(root, 'erp_structure_dump.json')
const viewsDir = path.join(root, 'src', 'views')

const menuTree = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

/** @param {string} title */
function vueContent(title) {
  const safe = title.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">当前功能：{{ pageTitle }}</p>
    </el-card>
  </div>
</template>

<script setup>
/** 页面标题（与左侧菜单一致） */
const pageTitle = '${safe}'
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0;
  color: var(--el-text-color-secondary);
}
</style>
`
}

/**
 * @param {any[]} nodes
 * @param {string} parentPath
 * @param {{ path: string, title: string }[]} acc
 */
function collect(nodes, parentPath, acc) {
  for (const node of nodes) {
    const segmentPath = parentPath ? `${parentPath}/${node.name}` : node.name
    acc.push({ path: segmentPath, title: node.title })
    if (node.children?.length) {
      collect(node.children, segmentPath, acc)
    }
  }
}

const items = []
collect(menuTree, '', items)

for (const { path: relPath, title } of items) {
  const dir = path.join(viewsDir, ...relPath.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'index.vue')
  fs.writeFileSync(file, vueContent(title), 'utf8')
}

console.log(`已生成 ${items.length} 个 index.vue，目录：src/views`)
