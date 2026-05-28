<template>
  <div class="erp-module-page paper-pattern-smart-check-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">纸格资料导入 · 智能校验</span>
      </template>

      <div class="toolbar">
        <el-button type="primary" :disabled="topBanner.type !== 'ok'" @click="goImportWithPass">
          校验通过，返回导入
        </el-button>
        <el-button type="primary" link @click="goImport">返回纸格导入</el-button>
        <el-button :loading="loadingParse" @click="reloadSource">重新加载解析数据</el-button>
        <el-button :loading="loadingCheck" :disabled="!workbenchReady || loadingParse" @click="runCheckNow">立即校验</el-button>
      </div>

      <el-alert v-if="topBanner.type === 'ok'" type="success" show-icon :closable="false" class="banner">
        <template #title>校验通过 — 可返回正式导入</template>
        <span>全部待写入 ERP 全码已在库中存在；请点击「校验通过，返回导入」。</span>
      </el-alert>
      <el-alert v-else-if="topBanner.type === 'block'" type="error" show-icon :closable="false" class="banner">
        <template #title>存在错误 — 尚未通过智能校验</template>
        <div class="banner-lines">
          <p
            v-for="(line, idx) in topBanner.lines"
            :key="idx"
            :class="{
              'prefix-mismatch-line': line.type === 'prefix-mismatch',
              'missing-code-line': line.type === 'missing-code',
              'empty-code-line': line.type === 'empty-code',
            }"
          >
            {{ line.text }}
          </p>
        </div>
      </el-alert>
      <el-alert v-else type="info" show-icon :closable="false" class="banner">
        <template #title>尚未完成有效校验</template>
        <span>加载数据后将自动校验；修改编码后会自动重新校验。</span>
      </el-alert>

      <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

      <div v-if="!workbenchReady" class="loading-panel">
        <el-icon class="loading-icon"><Loading /></el-icon>
        <div class="loading-title">{{ workbenchLoadingText }}</div>
        <div class="loading-subtitle">资料准备完成后会一次性显示完整表格和滚动条</div>
      </div>

      <template v-else>
        <el-divider content-position="left">Material（分色全码）</el-divider>
        <div
          v-loading="loadingCheck"
          :element-loading-text="workbenchLoadingText"
          class="table-loading-wrap"
        >
          <el-table
            ref="materialTableRef"
            :data="materialGridRows"
            border
            size="small"
            class="data-table material-code-table"
            empty-text="无 Material 行"
            height="420"
            scrollbar-always-on
          >
            <el-table-column prop="groupNo" label="分组" width="72" />
            <el-table-column prop="materialName" label="Material 名称" min-width="140" show-overflow-tooltip />
            <el-table-column
              v-for="col in materialColorColumns"
              :key="col.colorNo"
              :label="col.label"
              min-width="190"
            >
              <template #default="{ row }">
                <div
                  v-if="row.cellsByColor[col.colorNo]"
                  :class="materialCodeCellClass(row, col)"
                >
                  <el-input
                    v-model="row.cellsByColor[col.colorNo].materialCode"
                    clearable
                    size="small"
                    @input="onCodeEdited"
                  />
                </div>
                <span v-else class="muted-cell">-</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="108" align="center">
              <template #default="{ row }">
                <span :class="statusClass(materialGridRowStatus(row))">{{ materialGridRowStatus(row).text }}</span>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <el-divider content-position="left">Accessory</el-divider>
        <el-table
          :data="accessoryRows"
          border
          size="small"
          class="data-table"
          empty-text="无 Accessory 行"
          max-height="320"
          scrollbar-always-on
        >
          <el-table-column prop="seqNo" label="序号" width="72" />
          <el-table-column prop="colorNo" label="颜色" width="120" show-overflow-tooltip />
          <el-table-column prop="accessoryName" label="名称" min-width="120" show-overflow-tooltip />
          <el-table-column label="ERP 全码" min-width="200">
            <template #default="{ row }">
              <div :class="accessoryCodeCellClass(row)">
                <el-input v-model="row.erpCode" clearable size="small" @input="onCodeEdited" />
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="usageQty" label="用量" width="88" align="right" />
          <el-table-column prop="wastage" label="损耗" width="88" align="right" />
          <el-table-column prop="lineTotal" label="合计" width="88" align="right" />
          <el-table-column prop="matching" label="搭配" min-width="100" show-overflow-tooltip />
          <el-table-column label="状态" width="108" align="center">
            <template #default="{ row }">
              <span :class="statusClass(accessoryRowStatus(row))">{{ accessoryRowStatus(row).text }}</span>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { normalizeErpCodeDisplay, erpCodeLookupKey } from '@/utils/paperPatternErpCodeNormalize.js'
import {
  buildSmartCheckFingerprint,
  expandMaterialRowsForSmartCheck,
  mergeMaterialCheckRowsIntoMaterials,
  mergeWorkbenchIntoImportPageSession,
  readWorkbenchPayload,
  resolveSmartCheckColorNos,
  saveWorkbenchPayload,
  validateMaterialPrefixConsistencyForSmartCheck,
  writeSmartCheckPass,
} from '@/utils/paperPatternSmartCheck.js'

const route = useRoute()
const router = useRouter()
const fileId = computed(() => String(route.query.fileId ?? '').trim())

const loadingParse = ref(false)
const loadingCheck = ref(false)
const workbenchReady = ref(false)
const errorMessage = ref('')
/** @type {import('vue').ShallowRef<Set<string>>} */
const okKeySet = shallowRef(new Set())
const checkedOnce = ref(false)
const materialTableRef = ref(null)

/** @type {import('vue').Ref<string[]>} */
const colorNosRef = ref([])
/** @type {import('vue').Ref<any[]>} */
const sourceMaterials = ref([])
/** @type {import('vue').Ref<{ groupNo: string, colorNo: string, colIndex?: number, excelCol?: string, materialName: string, materialCode: string }[]>} */
const materialRows = ref([])
/** @type {import('vue').Ref<{ seqNo: string, colorNo: string, erpCode: string, accessoryName: string, usageQty: string, wastage: string, lineTotal: string, matching: string }[]>} */
const accessoryRows = ref([])

let hydrating = false
let debounceTimer = null
let materialTableLayoutTimer = 0

function refreshMaterialTableLayout() {
  return new Promise((resolve) => {
    nextTick(() => {
      requestAnimationFrame(() => {
        materialTableRef.value?.doLayout?.()
        resolve()
      })
    })
  })
}

function scheduleMaterialTableLayout() {
  if (materialTableLayoutTimer) cancelAnimationFrame(materialTableLayoutTimer)
  nextTick(() => {
    materialTableLayoutTimer = requestAnimationFrame(() => {
      materialTableLayoutTimer = 0
      materialTableRef.value?.doLayout?.()
    })
  })
}

const workbenchLoadingText = computed(() => {
  if (loadingParse.value) return '正在加载解析资料…'
  if (loadingCheck.value) return '正在校验 ERP 编码…'
  return '正在准备智能校验表格…'
})

async function revealWorkbench() {
  workbenchReady.value = true
  await refreshMaterialTableLayout()
}

/**
 * @param {{ materialCode: string }} row
 */
function materialRowStatus(row) {
  const d = normalizeErpCodeDisplay(row.materialCode)
  if (!d) return { text: 'ERP为空', ok: false, empty: true }
  const k = erpCodeLookupKey(d)
  if (okKeySet.value.has(k)) return { text: '已存在', ok: true, empty: false }
  return { text: 'ERP不存在', ok: false, empty: false, missing: true }
}

const materialColorColumns = computed(() => {
  const byColor = new Map()
  for (const row of materialRows.value) {
    const colorNo = String(row?.colorNo ?? '').trim()
    if (!colorNo || byColor.has(colorNo)) continue
    const excelCol = String(row?.excelCol ?? '').trim()
    byColor.set(colorNo, {
      colorNo,
      excelCol,
      label: excelCol ? `${excelCol}列 ${colorNo}` : colorNo,
    })
  }
  return [...byColor.values()]
})

const materialGridRows = computed(() => {
  const byGroup = new Map()
  for (const row of materialRows.value) {
    const groupNo = String(row?.groupNo ?? '').trim()
    if (!groupNo) continue
    if (!byGroup.has(groupNo)) {
      byGroup.set(groupNo, {
        groupNo,
        materialName: String(row?.materialName ?? '').trim(),
        cellsByColor: {},
      })
    }
    byGroup.get(groupNo).cellsByColor[String(row?.colorNo ?? '').trim()] = row
  }
  return [...byGroup.values()]
})

const materialPrefixMismatchKeys = computed(() => {
  const keys = new Set()
  for (const x of validateMaterialPrefixConsistencyForSmartCheck(materialRows.value)) {
    const groupNo = String(x?.groupNo ?? '').trim()
    const colorNo = String(x?.colorNo ?? '').trim()
    if (groupNo && colorNo) keys.add(`${groupNo}\u0000${colorNo}`)
  }
  return keys
})

function materialGridRowStatus(row) {
  const cells = Object.values(row?.cellsByColor || {})
  if (cells.length === 0) return { text: 'ERP为空', ok: false, empty: true }
  if (cells.some((cell) => materialRowStatus(cell).empty)) {
    return { text: '有空编码', ok: false, empty: true }
  }
  if (cells.some((cell) => materialRowStatus(cell).missing)) {
    return { text: '编码不存在', ok: false, empty: false }
  }
  const hasMismatch = cells.some((cell) =>
    materialPrefixMismatchKeys.value.has(`${cell.groupNo}\u0000${cell.colorNo}`),
  )
  if (hasMismatch) return { text: '编码不统一', ok: false, empty: false }
  return { text: '已存在', ok: true, empty: false }
}

function materialCodeCellClass(row, col) {
  const classes = ['material-code-cell']
  const cell = row?.cellsByColor?.[col.colorNo]
  if (String(col?.excelCol ?? '').trim().toUpperCase() === 'N') {
    classes.push('material-code-cell-base')
  }
  const st = materialRowStatus(cell || {})
  if (st.empty) {
    classes.push('material-code-cell-empty')
    return classes
  }
  if (st.missing) {
    classes.push('material-code-cell-missing')
    return classes
  }
  if (materialPrefixMismatchKeys.value.has(`${row.groupNo}\u0000${col.colorNo}`)) {
    classes.push('material-code-cell-mismatch')
  }
  return classes
}

/**
 * @param {{ erpCode: string }} row
 */
function accessoryRowStatus(row) {
  const d = normalizeErpCodeDisplay(row.erpCode)
  if (!d) return { text: 'ERP为空', ok: false, empty: true }
  const k = erpCodeLookupKey(d)
  if (okKeySet.value.has(k)) return { text: '已存在', ok: true, empty: false }
  return { text: 'ERP不存在', ok: false, empty: false, missing: true }
}

function accessoryCodeCellClass(row) {
  const classes = ['accessory-code-cell']
  const st = accessoryRowStatus(row)
  if (st.empty) {
    classes.push('accessory-code-cell-empty')
  } else if (st.missing) {
    classes.push('accessory-code-cell-missing')
  }
  return classes
}

/** @returns {Array<{ text: string, type?: string }>} */
function collectValidationIssueLines() {
  /** @type {Array<{ text: string, type?: string }>} */
  const lines = []
  const missingCodes = new Set()
  const emptyMaterialGroups = new Set()
  const prefixMismatchGroups = new Set()

  const prefixMismatches = validateMaterialPrefixConsistencyForSmartCheck(materialRows.value)
  for (const x of prefixMismatches) {
    const groupNo = String(x.groupNo ?? '').trim()
    if (!groupNo || prefixMismatchGroups.has(groupNo)) continue
    prefixMismatchGroups.add(groupNo)
    lines.push({ text: `序号${groupNo} 编码存在不统一`, type: 'prefix-mismatch' })
  }

  for (const r of materialRows.value) {
    const st = materialRowStatus(r)
    if (st.ok) continue
    if (st.empty) {
      const groupNo = String(r.groupNo ?? '').trim() || '—'
      if (!emptyMaterialGroups.has(groupNo)) {
        emptyMaterialGroups.add(groupNo)
        lines.push({ text: `序号:${groupNo}，编码为空，请及时填写导入资料`, type: 'empty-code' })
      }
    } else {
      const code = normalizeErpCodeDisplay(r.materialCode)
      if (!missingCodes.has(code)) {
        missingCodes.add(code)
        lines.push({ text: `编码 ${code} 不存在系统中，请进行录入`, type: 'missing-code' })
      }
    }
  }

  for (const r of accessoryRows.value) {
    const st = accessoryRowStatus(r)
    if (st.ok) continue
    if (st.empty) {
      const seq = String(r.seqNo ?? '').trim() || '—'
      lines.push({ text: `Accessory 序号:${seq}，编码为空，请及时填写导入资料`, type: 'empty-code' })
    } else {
      const code = normalizeErpCodeDisplay(r.erpCode)
      if (!missingCodes.has(code)) {
        missingCodes.add(code)
        lines.push({ text: `编码 ${code} 不存在系统中，请进行录入`, type: 'missing-code' })
      }
    }
  }

  return lines
}

const topBanner = computed(() => {
  if (!checkedOnce.value) {
    return { type: 'wait', lines: [] }
  }
  const matOk = materialRows.value.every((r) => materialRowStatus(r).ok)
  const accOk = accessoryRows.value.every((r) => accessoryRowStatus(r).ok)
  const prefixOk = validateMaterialPrefixConsistencyForSmartCheck(materialRows.value).length === 0
  if (matOk && accOk && prefixOk) {
    return { type: 'ok', lines: [] }
  }
  return { type: 'block', lines: collectValidationIssueLines() }
})

/**
 * @param {{ ok: boolean }} s
 */
function statusClass(s) {
  return s.ok ? 'st-ok' : 'st-bad'
}

function syncMaterialRowsToSource() {
  mergeMaterialCheckRowsIntoMaterials(sourceMaterials.value, materialRows.value)
}

function persistWorkbenchPayload() {
  syncMaterialRowsToSource()
  saveWorkbenchPayload({
    materials: sourceMaterials.value,
    accessories: accessoryRows.value.map((r) => ({
      seqNo: r.seqNo,
      colorNo: r.colorNo,
      erpCode: r.erpCode,
      accessoryName: r.accessoryName,
      usageQty: r.usageQty,
      wastage: r.wastage,
      lineTotal: r.lineTotal,
      matching: r.matching,
    })),
    colorNos: colorNosRef.value,
  })
}

function importPageLocation() {
  const fid = fileId.value
  return {
    path: '/paper-pattern/import',
    query: fid ? { fileId: fid } : {},
  }
}

function goImport() {
  persistWorkbenchPayload()
  router.push(importPageLocation())
}

function goImportWithPass() {
  if (topBanner.value.type !== 'ok') {
    ElMessage.warning('请先修正全部 ERP 编码并通过校验')
    return
  }
  persistWorkbenchPayload()
  const fp = buildSmartCheckFingerprint(
    sourceMaterials.value,
    accessoryRows.value,
    colorNosRef.value,
  )
  writeSmartCheckPass(fp, fileId.value)
  mergeWorkbenchIntoImportPageSession(fileId.value)
  router.push(importPageLocation())
}

/**
 * @param {any[]} materials
 * @param {any[]} accessories
 * @param {string[]} colorNos
 */
function hydrateFromPayload(materials, accessories, colorNos) {
  const mats = Array.isArray(materials) ? materials : []
  const acc = Array.isArray(accessories) ? accessories : []
  sourceMaterials.value = JSON.parse(JSON.stringify(mats))
  colorNosRef.value = resolveSmartCheckColorNos(colorNos, mats)
  materialRows.value = expandMaterialRowsForSmartCheck(sourceMaterials.value, colorNosRef.value)
  accessoryRows.value = acc.map((x) => ({
    seqNo: String(x?.seqNo ?? '').trim(),
    colorNo: String(x?.colorNo ?? '').trim(),
    erpCode: String(x?.erpCode ?? '').trim(),
    accessoryName: String(x?.accessoryName ?? '').trim(),
    usageQty: String(x?.usageQty ?? '').trim(),
    wastage: String(x?.wastage ?? '').trim(),
    lineTotal: String(x?.lineTotal ?? '').trim(),
    matching: String(x?.matching ?? '').trim(),
  }))
  scheduleMaterialTableLayout()
}

function loadFromSession() {
  const o = readWorkbenchPayload()
  if (!o) {
    errorMessage.value = '无解析数据：请从「纸格资料导入」解析成功后点击「智能校验」。'
    sourceMaterials.value = []
    materialRows.value = []
    accessoryRows.value = []
    colorNosRef.value = []
    return
  }
  hydrateFromPayload(o.materials, o.accessories, o.colorNos)
  errorMessage.value = ''
}

async function loadFromFileId() {
  if (!fileId.value) {
    loadFromSession()
    return
  }
  loadingParse.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/paper-pattern/import/parse-tree', {
      params: { fileId: fileId.value },
    })
    const data = res?.data
    if (!data?.success) {
      errorMessage.value = String(data?.message || '加载失败')
      sourceMaterials.value = []
      materialRows.value = []
      accessoryRows.value = []
      colorNosRef.value = []
      return
    }
    const colorNos = Array.isArray(data.mainBom?.colorNos) ? data.mainBom.colorNos : []
    hydrateFromPayload(data.materials, data.accessories, colorNos)
  } catch (e) {
    const msg =
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '加载失败'
    errorMessage.value = String(msg)
    sourceMaterials.value = []
    materialRows.value = []
    accessoryRows.value = []
    colorNosRef.value = []
  } finally {
    loadingParse.value = false
  }
}

async function reloadSource() {
  workbenchReady.value = false
  checkedOnce.value = false
  hydrating = true
  try {
    if (fileId.value) await loadFromFileId()
    else loadFromSession()
  } finally {
    hydrating = false
  }
  await runCheckNow()
  await revealWorkbench()
}

function collectAllCodes() {
  const out = []
  for (const r of materialRows.value) {
    const d = normalizeErpCodeDisplay(r.materialCode)
    if (d) out.push(d)
  }
  for (const r of accessoryRows.value) {
    const d = normalizeErpCodeDisplay(r.erpCode)
    if (d) out.push(d)
  }
  return out
}

async function runCheckNow() {
  loadingCheck.value = true
  errorMessage.value = ''
  try {
    const codes = collectAllCodes()
    const res = await axios.post('/api/paper-pattern/check-material', { codes })
    const data = res?.data
    if (!data?.success) {
      errorMessage.value = String(data?.message || '校验失败')
      okKeySet.value = new Set()
      checkedOnce.value = true
      return
    }
    const ok = new Set()
    for (const s of data.check?.success || []) {
      const k = erpCodeLookupKey(normalizeErpCodeDisplay(s))
      if (k) ok.add(k)
    }
    okKeySet.value = ok
    checkedOnce.value = true
    scheduleMaterialTableLayout()
  } catch (e) {
    const msg =
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '校验失败'
    errorMessage.value = String(msg)
    okKeySet.value = new Set()
    checkedOnce.value = true
    scheduleMaterialTableLayout()
  } finally {
    loadingCheck.value = false
  }
}

function onCodeEdited() {
  if (hydrating) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    runCheckNow()
  }, 450)
}

onMounted(async () => {
  workbenchReady.value = false
  checkedOnce.value = false
  hydrating = true
  try {
    if (fileId.value) await loadFromFileId()
    else loadFromSession()
  } finally {
    hydrating = false
  }
  await runCheckNow()
  await revealWorkbench()
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (materialTableLayoutTimer) cancelAnimationFrame(materialTableLayoutTimer)
})

watch(materialRows, scheduleMaterialTableLayout, { deep: true, flush: 'post' })
watch(materialColorColumns, scheduleMaterialTableLayout, { flush: 'post' })
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
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  align-items: center;
}
.banner {
  margin-bottom: 12px;
}
.banner-lines {
  margin: 0;
}
.banner-lines p {
  margin: 4px 0 0;
  line-height: 1.5;
}
.prefix-mismatch-line {
  color: var(--el-color-success);
  font-weight: 600;
}
.missing-code-line {
  color: var(--el-color-danger);
  font-weight: 600;
}
.empty-code-line {
  color: var(--el-color-warning);
  font-weight: 600;
}
.err {
  margin-bottom: 12px;
}
.loading-panel {
  height: 420px;
  margin: 14px 0 18px;
  border: 1px solid var(--el-border-color);
  background: var(--el-fill-color-lighter);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}
.loading-icon {
  margin-bottom: 12px;
  color: var(--el-color-primary);
  font-size: 28px;
  animation: loading-spin 1s linear infinite;
}
.loading-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.loading-subtitle {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.table-loading-wrap {
  min-height: 420px;
}
.data-table {
  margin-bottom: 8px;
}
:global(.erp-layout:has(.paper-pattern-smart-check-page)) {
  height: 100vh;
  min-height: 0;
  overflow: hidden;
}
:global(.erp-main-column:has(.paper-pattern-smart-check-page)) {
  height: 100vh;
  min-height: 0;
}
:global(.erp-app-main-root:has(.paper-pattern-smart-check-page)) {
  min-height: 0;
  overflow-x: clip;
  overflow-y: auto;
}
.paper-pattern-smart-check-page {
  min-height: 100%;
  padding-bottom: 24px;
  overflow: visible;
}
.paper-pattern-smart-check-page :deep(.el-card),
.paper-pattern-smart-check-page :deep(.el-card__body) {
  overflow: visible;
}
@keyframes loading-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
.material-code-cell,
.accessory-code-cell {
  margin: -4px;
  padding: 4px;
  border-radius: 4px;
}
.material-code-cell-base {
  background: var(--el-fill-color-light);
}
.material-code-cell-missing {
  background: var(--el-color-danger);
}
.material-code-cell-missing :deep(.el-input__wrapper) {
  background: var(--el-color-danger);
  box-shadow: none;
}
.material-code-cell-missing :deep(.el-input__inner) {
  color: #fff;
  font-weight: 600;
}
.material-code-cell-mismatch {
  background: var(--el-color-success);
}
.material-code-cell-mismatch :deep(.el-input__wrapper) {
  background: var(--el-color-success);
  box-shadow: none;
}
.material-code-cell-mismatch :deep(.el-input__inner) {
  color: #fff;
  font-weight: 600;
}
.material-code-cell-empty {
  background: var(--el-color-warning);
}
.material-code-cell-empty :deep(.el-input__wrapper) {
  background: var(--el-color-warning);
  box-shadow: none;
}
.material-code-cell-empty :deep(.el-input__inner) {
  color: #fff;
  font-weight: 600;
}
.accessory-code-cell-missing {
  background: var(--el-color-danger);
}
.accessory-code-cell-missing :deep(.el-input__wrapper) {
  background: var(--el-color-danger);
  box-shadow: none;
}
.accessory-code-cell-missing :deep(.el-input__inner) {
  color: #fff;
  font-weight: 600;
}
.accessory-code-cell-empty {
  background: var(--el-color-warning);
}
.accessory-code-cell-empty :deep(.el-input__wrapper) {
  background: var(--el-color-warning);
  box-shadow: none;
}
.accessory-code-cell-empty :deep(.el-input__inner) {
  color: #fff;
  font-weight: 600;
}
.muted-cell {
  color: var(--el-text-color-placeholder);
}
.st-ok {
  color: var(--el-color-success);
  font-weight: 600;
}
.st-bad {
  color: var(--el-color-danger);
  font-weight: 600;
}
</style>
