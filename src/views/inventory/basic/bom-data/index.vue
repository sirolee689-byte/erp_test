<template>
  <!-- 库存管理侧栏「基本资料 → BOM资料」实际路由落在此文件；复用 inv/bom 列表实现 -->
  <InvBomList embedded-title="BOM资料" />
</template>

<script setup>
import InvBomList from '@/views/inv/bom/index.vue'
</script>
