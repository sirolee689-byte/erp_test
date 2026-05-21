<template>
  <el-dialog
    v-model="open"
    :title="title"
    :top="top"
    :width="pageDialogWidth"
    :destroy-on-close="destroyOnClose"
    :close-on-click-modal="closeOnClickModal"
    :class="dialogClassMerged"
    v-bind="$attrs"
    @closed="emit('closed')"
  >
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </el-dialog>
</template>

<script setup>
/**
 * 页面级弹窗（近全屏方案 A）：宽近铺满视口，正文在 dialog body 内纵向滚动。
 * 表单级小窗请继续用 el-dialog + 固定 width（480–560px），勿套用本组件。
 */
import { computed } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  title: { type: String, default: '' },
  /** 距视口顶边；全局样式配合，默认 8px */
  top: { type: String, default: '8px' },
  destroyOnClose: { type: Boolean, default: true },
  closeOnClickModal: { type: Boolean, default: true },
  /** 页面附加 class（如 bom-detail-dialog） */
  dialogClass: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'closed'])

/** 供 EP 内联 width；实际尺寸由 .erp-page-dialog 全局 CSS 覆盖 */
const pageDialogWidth = '96vw'

const open = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const dialogClassMerged = computed(() => {
  const parts = ['erp-page-dialog']
  if (props.dialogClass) parts.push(props.dialogClass)
  return parts.join(' ')
})
</script>
