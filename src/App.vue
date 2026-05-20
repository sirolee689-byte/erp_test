<template>
  <el-config-provider :size="elementPlusSize">
    <router-view />
  </el-config-provider>
</template>

<script setup>
import { ElConfigProvider } from 'element-plus'
import { useUiDensity } from '@/composables/useUiDensity'

const { elementPlusSize } = useUiDensity()
</script>
