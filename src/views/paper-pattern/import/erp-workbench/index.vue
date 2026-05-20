<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">纸格资料导入 · 智能校验</span>
      </template>

      <p class="page-desc">
        对照 <code>Bom_000.kcaa01</code> 校验即将写入 Bom_parts 的 Material 分色全码与 Accessory 全码（不含
        CUT- 编码本身）；可就地改码并自动重验。校验通过后可返回导入页执行<strong>正式导入</strong>。
      </p>

      <div class="toolbar">
        <el-button type="primary" :disabled="topBanner.type !== 'ok'" @click="goImportWithPass">
          校验通过，返回导入
        </el-button>
        <el-button type="primary" link @click="goImport">返回纸格导入</el-button>
        <el-button :loading="loadingParse" @click="reloadSource">重新加载解析数据</el-button>
        <el-button :loading="loadingCheck" @click="runCheckNow">立即校验</el-button>
      </div>

      <el-alert v-if="topBanner.type === 'ok'" type="success" show-icon :closable="false" class="banner">
        <template #title>校验通过 — 可返回正式导入</template>
        <span>全部待写入 ERP 全码已在库中存在；请点击「校验通过，返回导入」。</span>
      </el-alert>
      <el-alert v-else-if="topBanner.type === 'block'" type="error" show-icon :closable="false" class="banner">
        <template #title>存在错误 — 尚未通过智能校验</template>
        <div class="banner-lines">
          <p v-for="(line, idx) in topBanner.lines" :key="idx">{{ line }}</p>
        </div>
      </el-alert>
      <el-alert v-else type="info" show-icon :closable="false" class="banner">
        <template #title>尚未完成有效校验</template>
        <span>加载数据后将自动校验；修改编码后会自动重新校验。</span>
      </el-alert>

      <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

      <div v-if="loadingParse" class="loading-hint">正在加载解析数据…</div>

      <template v-else>
        <el-divider content-position="left">Material（分色全码）</el-divider>
        <el-table :data="materialRows" border size="small" class="data-table" empty-text="无 Material 行">
          <el-table-column prop="groupNo" label="分组" width="72" />
          <el-table-column prop="colorNo" label="颜色" width="120" show-overflow-tooltip />
          <el-table-column prop="materialName" label="Material 名称" min-width="140" show-overflow-tooltip />
          <el-table-column label="ERP 全码" min-width="200">
            <template #default="{ row }">
              <el-input v-model="row.materialCode" clearable size="small" @input="onCodeEdited" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="108" align="center">
            <template #default="{ row }">
              <span :class="statusClass(materialRowStatus(row))">{{ materialRowStatus(row).text }}</span>
            </template>
          </el-table-column>
        </el-table>

        <el-divider content-position="left">Accessory</el-divider>
        <el-table :data="accessoryRows" border size="small" class="data-table" empty-text="无 Accessory 行">
          <el-table-column prop="seqNo" label="序号" width="72" />
          <el-table-column prop="colorNo" label="颜色" width="120" show-overflow-tooltip />
          <el-table-column prop="accessoryName" label="名称" min-width="120" show-overflow-tooltip />
          <el-table-column label="ERP 全码" min-width="200">
            <template #default="{ row }">
              <el-input v-model="row.erpCode" clearable size="small" @input="onCodeEdited" />
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
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { normalizeErpCodeDisplay, erpCodeLookupKey } from '@/utils/paperPatternErpCodeNormalize.js'
import {
  buildSmartCheckFingerprint,
  expandMaterialRowsForSmartCheck,
  mergeMaterialCheckRowsIntoMaterials,
  mergeWorkbenchIntoImportPageSession,
  readWorkbenchPayload,
  resolveSmartCheckColorNos,
  saveWorkbenchPayload,
  writeSmartCheckPass,
} from '@/utils/paperPatternSmartCheck.js'

const route = useRoute()
const router = useRouter()
const fileId = computed(() => String(route.query.fileId ?? '').trim())

const loadingParse = ref(false)
const loadingCheck = ref(false)
const errorMessage = ref('')
/** @type {import('vue').ShallowRef<Set<string>>} */
const okKeySet = shallowRef(new Set())
const checkedOnce = ref(false)

/** @type {import('vue').Ref<string[]>} */
const colorNosRef = ref([])
/** @type {import('vue').Ref<any[]>} */
const sourceMaterials = ref([])
/** @type {import('vue').Ref<{ groupNo: string, colorNo: string, materialName: string, materialCode: string }[]>} */
const materialRows = ref([])
/** @type {import('vue').Ref<{ seqNo: string, colorNo: string, erpCode: string, accessoryName: string, usageQty: string, wastage: string, lineTotal: string, matching: string }[]>} */
const accessoryRows = ref([])

let hydrating = false
let debounceTimer = null

/**
 * @param {{ materialCode: string }} row
 */
function materialRowStatus(row) {
  const d = normalizeErpCodeDisplay(row.materialCode)
  if (!d) return { text: 'ERP为空', ok: false, empty: true }
  const k = erpCodeLookupKey(d)
  if (okKeySet.value.has(k)) return { text: '已存在', ok: true, empty: false }
  return { text: 'ERP不存在', ok: false, empty: false }
}

/**
 * @param {{ erpCode: string }} row
 */
function accessoryRowStatus(row) {
  const d = normalizeErpCodeDisplay(row.erpCode)
  if (!d) return { text: 'ERP为空', ok: false, empty: true }
  const k = erpCodeLookupKey(d)
  if (okKeySet.value.has(k)) return { text: '已存在', ok: true, empty: false }
  return { text: 'ERP不存在', ok: false, empty: false }
}

/** @returns {string[]} */
function collectValidationIssueLines() {
  /** @type {string[]} */
  const lines = []
  const missingCodes = new Set()

  for (const r of materialRows.value) {
    const st = materialRowStatus(r)
    if (st.ok) continue
    if (st.empty) {
      lines.push(`分组${r.groupNo}/颜色${r.colorNo}：ERP 为空，无法校验`)
    } else {
      const code = normalizeErpCodeDisplay(r.materialCode)
      if (!missingCodes.has(code)) {
        missingCodes.add(code)
        lines.push(`编码 ${code} 不存在`)
      }
    }
  }

  for (const r of accessoryRows.value) {
    const st = accessoryRowStatus(r)
    if (st.ok) continue
    if (st.empty) {
      const seq = String(r.seqNo ?? '').trim() || '—'
      lines.push(`Accessory 序号${seq}/颜色${r.colorNo}：ERP 为空，无法校验`)
    } else {
      const code = normalizeErpCodeDisplay(r.erpCode)
      if (!missingCodes.has(code)) {
        missingCodes.add(code)
        lines.push(`编码 ${code} 不存在`)
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
  if (matOk && accOk) {
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
  hydrating = true
  try {
    if (fileId.value) await loadFromFileId()
    else loadFromSession()
  } finally {
    hydrating = false
  }
  await runCheckNow()
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
  } catch (e) {
    const msg =
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '校验失败'
    errorMessage.value = String(msg)
    okKeySet.value = new Set()
    checkedOnce.value = true
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
  hydrating = true
  try {
    if (fileId.value) await loadFromFileId()
    else loadFromSession()
  } finally {
    hydrating = false
  }
  await runCheckNow()
})

onUnmounted(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
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
.err {
  margin-bottom: 12px;
}
.loading-hint {
  padding: 20px 0;
  text-align: center;
  color: var(--el-text-color-secondary);
}
.data-table {
  margin-bottom: 8px;
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
