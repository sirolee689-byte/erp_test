import { computed, ref } from 'vue'
import {
  UI_DENSITY_COMFORTABLE,
  UI_DENSITY_STANDARD,
  applyUiDensityToDocument,
  getElementPlusSizeForDensity,
  getStoredUiDensity,
  getTableSizeForDensity,
  persistUiDensity,
} from '@/utils/uiDensity'

/** 全站共享的显示密度（顶栏切换与 App ConfigProvider 共用） */
const densityRef = ref(getStoredUiDensity())

/**
 * 界面密度：舒适 / 标准
 * @returns {{
 *   density: import('vue').Ref<'comfortable' | 'standard'>,
 *   elementPlusSize: import('vue').ComputedRef<'large' | 'default'>,
 *   isComfortable: import('vue').ComputedRef<boolean>,
 *   setDensity: (next: 'comfortable' | 'standard') => void,
 *   UI_DENSITY_COMFORTABLE: 'comfortable',
 *   UI_DENSITY_STANDARD: 'standard',
 * }}
 */
export function useUiDensity() {
  const elementPlusSize = computed(() => getElementPlusSizeForDensity(densityRef.value))
  const detailTableSize = computed(() => getTableSizeForDensity(densityRef.value))
  const isComfortable = computed(() => densityRef.value === UI_DENSITY_COMFORTABLE)

  function setDensity(next) {
    const d = persistUiDensity(next)
    applyUiDensityToDocument(d)
    densityRef.value = d
  }

  return {
    density: densityRef,
    elementPlusSize,
    detailTableSize,
    isComfortable,
    setDensity,
    UI_DENSITY_COMFORTABLE,
    UI_DENSITY_STANDARD,
  }
}
