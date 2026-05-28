<template>
  <template v-for="node in nodes" :key="node.name">
    <el-sub-menu v-if="node.children?.length" :index="'/' + segmentPath(parentPath, node)">
      <template #title>
        <el-icon class="menu-icon">
          <component :is="iconFor(node)" />
        </el-icon>
        <span>{{ node.title }}</span>
      </template>
      <ErpMenuTree :nodes="node.children" :parent-path="segmentPath(parentPath, node)" />
    </el-sub-menu>
    <el-menu-item v-else :index="'/' + segmentPath(parentPath, node)">
      <el-icon class="menu-icon">
        <component :is="iconFor(node)" />
      </el-icon>
      <span>{{ node.title }}</span>
    </el-menu-item>
  </template>
</template>

<script setup>
import ErpMenuTree from './ErpMenuTree.vue'
import {
  Box,
  Connection,
  Document,
  Key,
  Management,
  Monitor,
  OfficeBuilding,
  Setting,
  Tickets,
  User,
  Van,
} from '@element-plus/icons-vue'

defineOptions({ name: 'ErpMenuTree' })

defineProps({
  /** 菜单树节点 */
  nodes: { type: Array, required: true },
  /** 父级路径（不含前导 /） */
  parentPath: { type: String, default: '' },
})

/**
 * @param {string} parent
 * @param {{ name: string }} node
 */
function segmentPath(parent, node) {
  return parent ? `${parent}/${node.name}` : node.name
}

/**
 * 根据业务模块名返回一个稳定的图标
 * @param {{ name: string }} node
 */
function iconFor(node) {
  const map = {
    system: Setting,
    operator: User,
    role: Key,
    canteen: Tickets,
    'supply-chain': Connection,
    inventory: Box,
    inv: Document,
    'paper-pattern': Document,
    production: Management,
    hr: User,
    assets: OfficeBuilding,
    traceability: Monitor,
  }
  return map[node.name] || Document
}
</script>

<style scoped>
.menu-icon {
  margin-right: 8px;
}
</style>
