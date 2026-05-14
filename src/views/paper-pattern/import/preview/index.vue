<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">纸格资料导入预览</span>
      </template>

      <p v-if="!fileId" class="warn">缺少参数 fileId，请从「纸格资料导入」页上传后进入。</p>

      <template v-else>
        <div class="toolbar">
          <el-button type="primary" link @click="goBackImport">返回导入页</el-button>
          <el-button :loading="loading" @click="loadPreview">重新加载</el-button>
          <el-button type="primary" :disabled="!canProceed" @click="goCheck">下一步：数据校验</el-button>
          <span v-if="metaLine" class="meta">{{ metaLine }}</span>
          <span v-if="savePending" class="save-hint">正在保存映射…</span>
        </div>

        <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

        <div v-else-if="loading" class="loading-hint">正在加载预览…</div>

        <div v-else-if="tableRows.length === 0" class="empty-hint">暂无数据</div>

        <div v-else class="preview-body">
          <p class="mapping-hint">
            为各 Excel 列选择系统字段（每个字段仅能映射一列）；须至少映射 <strong>kcaa01</strong>、<strong>kcaa02</strong> 后方可进入下一步。修改后会自动保存。
          </p>

          <div class="mapping-strip-wrap">
            <div class="mapping-strip" :style="{ minWidth: mappingStripMinWidth + 'px' }">
              <div class="map-cell map-corner">Excel列 / 映射</div>
              <div
                v-for="ci in colIndexes"
                :key="'map-' + ci"
                class="map-cell map-select-cell"
                :style="{ width: mapSelectCellWidthForCol(ci) + 'px' }"
              >
                <div class="map-col-title">{{ excelColumnLettersFromOneBased(ci) }}列</div>
                <el-select
                  :model-value="colMapping[ci] ?? ''"
                  class="map-select"
                  placeholder="不映射"
                  filterable
                  clearable
                  @update:model-value="(v) => onColFieldChange(ci, v)"
                >
                  <el-option
                    v-for="opt in systemFieldSelectOptions"
                    :key="'c' + ci + '-f-' + (opt.value === '' ? '_' : opt.value)"
                    :label="opt.label"
                    :value="opt.value"
                    :disabled="isOptionDisabledForCol(opt.value, ci)"
                  />
                </el-select>
              </div>
            </div>
          </div>

          <div class="paper-preview-table-host">
            <ElTableV2
              v-if="columns.length && tableRows.length"
              fixed
              :columns="columns"
              :data="tableRows"
              :width="tableWidth"
              :height="tableHeight"
              :row-height="rowHeight"
              :header-height="headerHeight"
            />
          </div>
        </div>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, nextTick } from 'vue'
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
const preview = shallowRef(null)

const tableWidth = ref(960)
const tableHeight = 520
const rowHeight = 34
const headerHeight = 40

/** 行号列最小宽度；内容按最大行号估算 */
const ROW_INDEX_MIN_W = 72
/** 数据列宽上下限（像素），偏保守避免超宽单元格撑爆布局 */
const DATA_COL_MIN_W = 20
const DATA_COL_MAX_W = 100
/** 映射行「列选择」单元格最大宽度：不必与下方数据列同宽，避免宽内容把映射条撑得过宽 */
const MAP_SELECT_CELL_MAX_W = 200

/**
 * 按字符粗略估算单元格所需宽度（与 13px 左右字号接近），用于列自适应。
 * @param {unknown} text
 */
function estimateCellContentWidthPx(text) {
  const s = String(text ?? '')
  if (!s.length) return DATA_COL_MIN_W
  let w = 0
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code >= 0x1100) w += 13
    else if (code > 0x00ff) w += 12
    else w += 7.2
  }
  return Math.min(DATA_COL_MAX_W, Math.max(DATA_COL_MIN_W, Math.ceil(w + 24)))
}

/** 与后端 PAPER_PATTERN_IMPORT_SYSTEM_FIELDS 保持一致 */
const SYSTEM_FIELD_META = [
  { field: 'kcaa01', label: '纸格编号' },
  { field: 'kcaa02', label: '纸格名称' },
  { field: 'kcaa06', label: '规格' },
  { field: 'kcaa09', label: '单位' },
  { field: 'kcaa10', label: '备注' },
  { field: 'kcaa11', label: '分类' },
]

const systemFieldSelectOptions = [
  { value: '', label: '不映射' },
  ...SYSTEM_FIELD_META.map((m) => ({
    value: m.field,
    label: `${m.field}（${m.label}）`,
  })),
]

/** 各 Excel 列（1-based colIndex）→ 系统字段名，空字符串表示不映射 */
const colMapping = reactive({})

/** 为 true 时跳过 watch 触发的自动保存（从服务端恢复映射） */
let hydrating = false

const savePending = ref(false)
let saveTimer = null

function excelColumnLettersFromOneBased(colIndex1) {
  let n = Math.max(1, Math.floor(Number(colIndex1) || 1))
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function goBackImport() {
  router.push({ path: '/paper-pattern/import' })
}

function goCheck() {
  if (!canProceed.value || !fileId.value) return
  router.push({ path: '/paper-pattern/import/check', query: { fileId: fileId.value } })
}

function isOptionDisabledForCol(fieldValue, currentColIndex) {
  if (!fieldValue) return false
  for (const [k, v] of Object.entries(colMapping)) {
    if (Number(k) === currentColIndex) continue
    if (String(v ?? '').trim() === fieldValue) return true
  }
  return false
}

/** @param {number} ci @param {string | null | undefined} v */
function onColFieldChange(ci, v) {
  colMapping[ci] = v == null || v === '' ? '' : String(v)
}

function resetColMappingShape(mc) {
  for (const k of Object.keys(colMapping)) {
    delete colMapping[k]
  }
  for (let i = 1; i <= mc; i++) {
    colMapping[i] = ''
  }
}

async function fillMappingFromServer(mc) {
  hydrating = true
  try {
    resetColMappingShape(mc)
    const res = await axios.get('/api/paper-pattern/import/mapping', {
      params: { fileId: fileId.value },
    })
    if (!res.data?.success) {
      return
    }
    for (const row of res.data.mapping || []) {
      const ix = Number(row.colIndex)
      const f = String(row.field ?? '').trim()
      if (ix >= 1 && ix <= mc && f) colMapping[ix] = f
    }
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '读取映射失败'
    ElMessage.warning(String(msg))
  } finally {
    await nextTick()
    hydrating = false
  }
}

async function persistMappingToServer() {
  if (!fileId.value) return
  const arr = []
  for (const [k, v] of Object.entries(colMapping)) {
    const ci = Number(k)
    const f = String(v ?? '').trim()
    if (!f) continue
    arr.push({ colIndex: ci, field: f })
  }
  savePending.value = true
  try {
    await axios.post('/api/paper-pattern/import/save-mapping', {
      fileId: fileId.value,
      mapping: arr,
    })
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '保存映射失败'
    ElMessage.error(String(msg))
  } finally {
    savePending.value = false
  }
}

function scheduleSaveMapping() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    persistMappingToServer()
  }, 400)
}

watch(
  colMapping,
  () => {
    if (hydrating || !fileId.value) return
    scheduleSaveMapping()
  },
  { deep: true },
)

/** 预留少量像素，避免虚拟表出现纵向滚动条后触发「假」横向滚动条 */
const TABLE_WIDTH_SLACK = 12

function updateTableWidth() {
  const el = document.querySelector('.paper-preview-table-host')
  if (el && el.clientWidth > 200) {
    tableWidth.value = Math.max(200, Math.floor(el.clientWidth) - TABLE_WIDTH_SLACK)
  }
}

/** @type {ResizeObserver | null} */
let ro = null

onMounted(() => {
  updateTableWidth()
  const host = document.querySelector('.paper-preview-table-host')
  if (host && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => updateTableWidth())
    ro.observe(host)
  }
  window.addEventListener('resize', updateTableWidth)
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  saveTimer = null
  if (!hydrating && fileId.value) {
    void persistMappingToServer()
  }
  ro?.disconnect()
  ro = null
  window.removeEventListener('resize', updateTableWidth)
})

async function loadPreview() {
  if (!fileId.value) return
  loading.value = true
  errorMessage.value = ''
  preview.value = null
  try {
    const res = await axios.get('/api/paper-pattern/import/preview', {
      params: { fileId: fileId.value },
    })
    const data = res.data
    if (!data?.success) {
      errorMessage.value = String(data?.message || '加载失败')
      return
    }
    preview.value = data
    const mc = (() => {
      const rows = data.rows
      if (!rows?.length) return 0
      let m = 0
      for (const row of rows) {
        for (const c of row.cells || []) {
          if (c.colIndex > m) m = c.colIndex
        }
      }
      return m
    })()
    if (mc > 0) {
      await fillMappingFromServer(mc)
    }
    queueMicrotask(updateTableWidth)
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '加载失败'
    errorMessage.value = String(msg)
  } finally {
    loading.value = false
  }
}

watch(fileId, () => loadPreview(), { immediate: true })

const metaLine = computed(() => {
  const p = preview.value
  if (!p?.sheetName && !p?.totalRows) return ''
  const sn = p.sheetName != null ? String(p.sheetName) : ''
  const tr = Number(p.totalRows ?? 0)
  return `工作表：${sn || '—'}　共 ${tr} 行（虚拟表格渲染，适合千行以上）`
})

const maxColIndex = computed(() => {
  const rows = preview.value?.rows
  if (!rows?.length) return 0
  let m = 0
  for (const row of rows) {
    for (const c of row.cells || []) {
      if (c.colIndex > m) m = c.colIndex
    }
  }
  return m
})

const colIndexes = computed(() => {
  const n = maxColIndex.value
  const arr = []
  for (let i = 1; i <= n; i++) arr.push(i)
  return arr
})

const tableRows = computed(() => {
  const rows = preview.value?.rows
  if (!rows?.length) return []
  const mc = maxColIndex.value
  const out = []
  for (const row of rows) {
    const map = new Map((row.cells || []).map((c) => [c.colIndex, String(c.value ?? '')]))
    const flat = { rowIndex: row.rowIndex }
    for (let ci = 1; ci <= mc; ci++) {
      flat[`c${ci}`] = map.has(ci) ? map.get(ci) : ''
    }
    out.push(flat)
  }
  return out
})

/** 各数据列内容最小像素宽度（按全表该列最长单元格估算） */
const dataColMinWidths = computed(() => {
  const mc = maxColIndex.value
  if (mc <= 0) return []
  const rows = tableRows.value
  const widths = []
  for (let ci = 1; ci <= mc; ci++) {
    const headLabel = `${excelColumnLettersFromOneBased(ci)}列`
    let mw = estimateCellContentWidthPx(headLabel)
    for (const row of rows) {
      mw = Math.max(mw, estimateCellContentWidthPx(row[`c${ci}`]))
    }
    widths.push(mw)
  }
  return widths
})

const rowIndexMinWidth = computed(() => {
  const rows = tableRows.value
  let maxRi = 0
  for (const row of rows) {
    const n = Number(row.rowIndex)
    if (n > maxRi) maxRi = n
  }
  const labelW = estimateCellContentWidthPx('行号')
  const numW = estimateCellContentWidthPx(String(maxRi || 0))
  return Math.max(ROW_INDEX_MIN_W, Math.min(DATA_COL_MAX_W, Math.max(labelW, numW)))
})

/**
 * 将一组「最小宽度」按比例放大到总和 = target（用于吃掉右侧空白，避免无意义的横向滚动）
 * @param {number[]} bases
 * @param {number} targetTotal
 */
function expandWidthsToFill(bases, targetTotal) {
  const sumB = bases.reduce((a, b) => a + b, 0)
  if (sumB >= targetTotal || bases.length === 0) return [...bases]
  const extra = targetTotal - sumB
  const arr = bases.map((b) => Math.floor(b + (extra * b) / sumB))
  let drift = targetTotal - arr.reduce((a, b) => a + b, 0)
  let idx = 0
  let mx = -1
  for (let i = 0; i < bases.length; i++) {
    if (bases[i] >= mx) {
      mx = bases[i]
      idx = i
    }
  }
  arr[idx] += drift
  return arr
}

/** 实际渲染列宽：容器有富余时拉满 tableWidth；内容超出时保持最小宽并允许横向滚动 */
const layoutColumnWidths = computed(() => {
  const host = Math.max(200, Math.floor(Number(tableWidth.value) || 0))
  const basesData = dataColMinWidths.value
  const ri = rowIndexMinWidth.value
  if (!basesData.length) return { rowIndex: ri, data: [] }
  const basesAll = [ri, ...basesData]
  const sumB = basesAll.reduce((a, b) => a + b, 0)
  if (sumB >= host) {
    return { rowIndex: ri, data: [...basesData] }
  }
  const expanded = expandWidthsToFill(basesAll, host)
  return { rowIndex: expanded[0], data: expanded.slice(1) }
})

const layoutRowIndexWidth = computed(() => layoutColumnWidths.value.rowIndex)

/** @param {number} ci 1-based 列号 */
function layoutDataWidthForCol(ci) {
  return layoutColumnWidths.value.data[ci - 1] ?? DATA_COL_MIN_W
}

/** 映射条单列宽度：与数据列对齐逻辑一致，但不超过 MAP_SELECT_CELL_MAX_W */
function mapSelectCellWidthForCol(ci) {
  return Math.min(layoutDataWidthForCol(ci), MAP_SELECT_CELL_MAX_W)
}

const mappingStripMinWidth = computed(() => {
  const ri = layoutRowIndexWidth.value
  const mc = maxColIndex.value
  let sum = ri
  for (let ci = 1; ci <= mc; ci++) {
    sum += mapSelectCellWidthForCol(ci)
  }
  return sum
})

const canProceed = computed(() => {
  const vals = Object.keys(colMapping).map((k) => String(colMapping[Number(k)] ?? '').trim())
  return vals.includes('kcaa01') && vals.includes('kcaa02')
})

const columns = computed(() => {
  const mc = maxColIndex.value
  if (mc <= 0) return []
  const riw = layoutRowIndexWidth.value
  const cols = [
    {
      key: 'rowIndex',
      dataKey: 'rowIndex',
      title: '行号',
      width: riw,
      align: 'center',
      fixed: 'left',
      flexShrink: 0,
    },
  ]
  for (let ci = 1; ci <= mc; ci++) {
    const L = excelColumnLettersFromOneBased(ci)
    cols.push({
      key: `c${ci}`,
      dataKey: `c${ci}`,
      title: `${L}列`,
      width: layoutDataWidthForCol(ci),
      align: 'left',
      flexShrink: 0,
    })
  }
  return cols
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
  margin: 0;
  color: var(--el-color-warning);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.meta {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.save-hint {
  font-size: 13px;
  color: var(--el-color-primary);
}
.err {
  margin-bottom: 12px;
}
.empty-hint {
  padding: 24px 0;
  color: var(--el-text-color-secondary);
}
.loading-hint {
  padding: 32px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.preview-body {
  width: 100%;
}
.mapping-hint {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.mapping-strip-wrap {
  width: 100%;
  overflow-x: auto;
  margin-bottom: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  background: var(--el-fill-color-blank);
}
.mapping-strip {
  display: flex;
  flex-direction: row;
  align-items: stretch;
}
.map-cell {
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 6px 4px;
  border-right: 1px solid var(--el-border-color-lighter);
}
.map-corner {
  width: v-bind(layoutRowIndexWidth + 'px');
  min-width: v-bind(layoutRowIndexWidth + 'px');
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
}
.map-select-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.map-col-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}
.map-select {
  width: 100%;
}
.paper-preview-table-host {
  width: 100%;
  min-height: 200px;
}

/* 避免虚拟表格在窄视口下压缩列宽后出现省略号；列宽已由内容估算 + fixed 布局保证 */
.paper-preview-table-host :deep(.el-table-v2__cell-text) {
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
}
</style>
