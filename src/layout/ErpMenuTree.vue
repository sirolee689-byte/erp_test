<template>
  <template v-for="node in nodes" :key="node.name">
    <el-sub-menu v-if="node.children?.length" :index="'/' + segmentPath(parentPath, node)">
      <template #title>
        <span>{{ node.title }}</span>
      </template>
      <ErpMenuTree :nodes="node.children" :parent-path="segmentPath(parentPath, node)" />
    </el-sub-menu>
    <el-menu-item v-else :index="'/' + segmentPath(parentPath, node)">
      {{ node.title }}
    </el-menu-item>
  </template>
</template>

<script setup>
import ErpMenuTree from './ErpMenuTree.vue'

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
</script>
