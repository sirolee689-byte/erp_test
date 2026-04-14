<template>
  <div class="page-403">
    <el-result icon="warning" title="无访问权限" sub-title="您没有权限打开该页面，或菜单已被管理员收回。请联系管理员分配角色权限。">
      <template #extra>
        <el-button type="primary" @click="goHome">返回首页</el-button>
        <el-button @click="goBack">返回上一页</el-button>
      </template>
    </el-result>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'
import { getFirstPermittedRoutePath } from '@/utils/menuPermission'
import menuStructure from '../../../../erp_structure_dump.json'

const router = useRouter()

async function goHome() {
  const path = getFirstPermittedRoutePath(menuStructure)
  await router.replace(path)
}

function goBack() {
  router.back()
}
</script>

<style scoped>
.page-403 {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 360px;
  padding: 24px;
}
</style>
