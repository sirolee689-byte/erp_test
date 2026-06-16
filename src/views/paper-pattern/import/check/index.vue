<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">纸格资料导入 · 数据校验</span>
      </template>

      <p v-if="!fileId" class="warn">缺少参数 fileId。</p>

      <template v-else>
        <div class="toolbar">
          <el-button type="primary" link @click="goPreview">返回修改映射</el-button>
          <el-button :loading="loading" @click="loadValidate">重新校验</el-button>
          <el-button
            type="primary"
            :disabled="!canStartImport"
            @click="onStartImport"
          >
            开始正式导入
          </el-button>
        </div>

        <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

        <div v-else-if="loading" class="loading-hint">正在校验数据…</div>

        <template v-else-if="result">
          <el-descriptions :column="4" border class="summary">
            <el-descriptions-item label="Excel 总行数（含表头）">
              {{ result.excelTotalRows ?? 0 }}
            </el-descriptions-item>
            <el-descriptions-item label="参与校验的数据行数">
              {{ result.dataRowCount ?? 0 }}
            </el-descriptions-item>
            <el-descriptions-item label="正常数量">
              <span class="ok-num">{{ result.okCount ?? 0 }}</span>
            </el-descriptions-item>
            <el-descriptions-item label="异常数量">
              <span class="bad-num">{{ result.errorCount ?? 0 }}</span>
            </el-descriptions-item>
          </el-descriptions>

          <p class="hint">
            第 1 行视为表头不参与校验；必填：kcaa01、kcaa02；校验项含 Excel 内编号重复、库内编号已存在（表
            <code>UB_ERP_Bom_000</code>，在册 del 为空或 0）。
          </p>

          <div v-if="tableFlatRows.length === 0" class="empty-hint">无数据行可校验</div>
          <div v-else class="table-host">
            <ElTableV2
              :columns="v2columns"
              :data="tableFlatRows"
              :width="tableWidth"
              :height="520"
              :row-height="36"
              :header-height="40"
              :row-class="rowClassGetter"
            />
          </div>
        </template>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElTableV2 } from 'element-plus'
import { ElMessage } from 'element-plus'

const route = useRoute()
const router = useRouter()
const fileId = computed(() => String(route.query.fileId ?? '').trim())

const loading = ref(false)
const errorMessage = ref('')
/** @type {import('vue').ShallowRef<any>} */
const result = shallowRef(null)

const tableWidth = ref(1100)

/** 除编号、名称外的可选列展示顺序 */
const EXTRA_ORDER = ['kcaa06', 'kcaa09', 'kcaa10', 'kcaa11']

const visibleExtras = computed(() => {
  const rows = result.value?.rows
  if (!rows?.length) return []
  const set = new Set()
  for (const r of rows) {
    for (const k of Object.keys(r.data || {})) {
      if (k !== 'kcaa01' && k !== 'kcaa02') set.add(k)
    }
  }
  return EXTRA_ORDER.filter((k) => set.has(k))
})

const extraTitle = {
  kcaa06: '规格',
  kcaa09: '单位',
  kcaa10: '备注',
  kcaa11: '分类',
}

const tableFlatRows = computed(() => {
  const rows = result.value?.rows
  if (!rows?.length) return []
  return rows.map((r) => {
    const errs = r.errors || []
    const hasErr = errs.length > 0
    const flat = {
      rowIndex: r.rowIndex,
      kcaa01: r.data?.kcaa01 ?? '',
      kcaa02: r.data?.kcaa02 ?? '',
      status: hasErr ? '异常' : '正常',
      errorText: hasErr ? errs.join('；') : '—',
      hasErr,
    }
    for (const k of visibleExtras.value) {
      flat[k] = r.data?.[k] ?? ''
    }
    return flat
  })
})

const v2columns = computed(() => {
  const w = 110
  const cols = [
    { key: 'rowIndex', dataKey: 'rowIndex', title: '行号', width: 64, align: 'center', fixed: 'left' },
    { key: 'kcaa01', dataKey: 'kcaa01', title: '编号', width: w + 20, align: 'left', fixed: 'left' },
    { key: 'kcaa02', dataKey: 'kcaa02', title: '名称', width: w + 40, align: 'left' },
  ]
  for (const k of visibleExtras.value) {
    cols.push({
      key: k,
      dataKey: k,
      title: `${k}（${extraTitle[k] || k}）`,
      width: w,
      align: 'left',
    })
  }
  cols.push(
    { key: 'status', dataKey: 'status', title: '状态', width: 72, align: 'center' },
    { key: 'errorText', dataKey: 'errorText', title: '错误原因', width: 280, align: 'left' },
  )
  return cols
})

const canStartImport = computed(() => {
  if (!result.value) return false
  const n = Number(result.value.errorCount ?? 0)
  const dr = Number(result.value.dataRowCount ?? 0)
  return dr > 0 && n === 0
})

function rowClassGetter({ rowData }) {
  return rowData?.hasErr ? 'paper-validate-bad-row' : ''
}

function goPreview() {
  router.push({ path: '/paper-pattern/import/preview', query: { fileId: fileId.value } })
}

function onStartImport() {
  if (!canStartImport.value) return
  ElMessage.info('正式导入功能开发中')
}

async function loadValidate() {
  if (!fileId.value) return
  loading.value = true
  errorMessage.value = ''
  result.value = null
  try {
    const res = await axios.get('/api/paper-pattern/import/validate', {
      params: { fileId: fileId.value },
    })
    const data = res.data
    if (!data?.success) {
      errorMessage.value = String(data?.message || '校验失败')
      return
    }
    result.value = data
    queueMicrotask(updateTableWidth)
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '校验失败'
    errorMessage.value = String(msg)
  } finally {
    loading.value = false
  }
}

watch(fileId, () => loadValidate(), { immediate: true })

function updateTableWidth() {
  const el = document.querySelector('.table-host')
  if (el && el.clientWidth > 200) {
    tableWidth.value = Math.floor(el.clientWidth)
  }
}

let ro = null
onMounted(() => {
  updateTableWidth()
  const host = document.querySelector('.table-host')
  if (host && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => updateTableWidth())
    ro.observe(host)
  }
  window.addEventListener('resize', updateTableWidth)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  window.removeEventListener('resize', updateTableWidth)
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.warn {
  color: var(--el-color-warning);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
  align-items: center;
}
.err {
  margin-bottom: 12px;
}
.loading-hint {
  padding: 24px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.summary {
  margin-bottom: 12px;
}
.ok-num {
  color: var(--el-color-success);
  font-weight: 600;
}
.bad-num {
  color: var(--el-color-danger);
  font-weight: 600;
}
.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.empty-hint {
  padding: 20px 0;
  color: var(--el-text-color-secondary);
}
.table-host {
  width: 100%;
}
:deep(.paper-validate-bad-row) {
  background-color: var(--el-color-danger-light-9) !important;
}
</style>
