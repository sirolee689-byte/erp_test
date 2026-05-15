<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <template #header>
        <span class="page-title">ERP 物料校验工作台</span>
      </template>

      <p class="page-desc">
        对照 <code>Bom_000.kcaa01</code> 校验 Excel 解析得到的 Material / Accessory ERP 编码；可就地修正编码并自动重验。当前阶段<strong>不写</strong>
        Bom_000、bom_parts。
      </p>

      <div class="toolbar">
        <el-button type="primary" link @click="goImport">返回纸格导入</el-button>
        <el-button v-if="fileId" type="primary" link @click="goPreview">返回预览</el-button>
        <el-button :loading="loadingParse" @click="reloadSource">重新加载解析数据</el-button>
        <el-button :loading="loadingCheck" @click="runCheckNow">立即校验</el-button>
      </div>

      <el-alert v-if="topBanner.type === 'ok'" type="success" show-icon :closable="false" class="banner">
        <template #title>校验成功 — 允许导入</template>
        <span>全部非空 ERP 编码已在库中存在；空表视为无物料待校验。</span>
      </el-alert>
      <el-alert v-else-if="topBanner.type === 'block'" type="error" show-icon :closable="false" class="banner">
        <template #title>存在错误 — 禁止导入</template>
        <span>{{ topBanner.detail }}</span>
      </el-alert>
      <el-alert v-else type="info" show-icon :closable="false" class="banner">
        <template #title>尚未完成有效校验</template>
        <span>加载数据后将自动校验；修改编码后会自动重新校验。</span>
      </el-alert>

      <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

      <div v-if="loadingParse" class="loading-hint">正在加载解析数据…</div>

      <template v-else>
        <el-divider content-position="left">Material</el-divider>
        <el-table :data="materialRows" border size="small" class="data-table" empty-text="无 Material 行">
          <el-table-column prop="groupNo" label="分组" width="88" />
          <el-table-column prop="materialName" label="Material 名称" min-width="160" />
          <el-table-column label="ERP 编码" min-width="220">
            <template #default="{ row }">
              <el-input v-model="row.materialCode" clearable size="small" @input="onCodeEdited" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120" align="center">
            <template #default="{ row }">
              <span :class="statusClass(materialRowStatus(row))">{{ materialRowStatus(row).text }}</span>
            </template>
          </el-table-column>
        </el-table>

        <el-divider content-position="left">Accessory</el-divider>
        <el-table :data="accessoryRows" border size="small" class="data-table" empty-text="无 Accessory 行">
          <el-table-column label="ERP 编码" min-width="240">
            <template #default="{ row }">
              <el-input v-model="row.erpCode" clearable size="small" @input="onCodeEdited" />
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120" align="center">
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
import { normalizeErpCodeDisplay, erpCodeLookupKey } from '@/utils/paperPatternErpCodeNormalize.js'

const ERP_WORKBENCH_STORAGE = 'paperPatternErpWorkbenchPayloadV1'

const route = useRoute()
const router = useRouter()
const fileId = computed(() => String(route.query.fileId ?? '').trim())

const loadingParse = ref(false)
const loadingCheck = ref(false)
const errorMessage = ref('')
/** @type {import('vue').ShallowRef<Set<string>>} */
const okKeySet = shallowRef(new Set())
const checkedOnce = ref(false)

/** @type {import('vue').Ref<{ groupNo: string, materialName: string, materialCode: string }[]>} */
const materialRows = ref([])
/** @type {import('vue').Ref<{ erpCode: string }[]>} */
const accessoryRows = ref([])

let hydrating = false
let debounceTimer = null

const topBanner = computed(() => {
  if (!checkedOnce.value) {
    return { type: 'wait', detail: '' }
  }
  const matOk = materialRows.value.every((r) => materialRowStatus(r).ok)
  const accOk = accessoryRows.value.every((r) => accessoryRowStatus(r).ok)
  if (matOk && accOk) {
    return { type: 'ok', detail: '' }
  }
  const parts = []
  if (!matOk) parts.push('Material 存在空编码或库中不存在')
  if (!accOk) parts.push('Accessory 存在空编码或库中不存在')
  return { type: 'block', detail: parts.join('；') }
})

/**
 * @param {{ materialCode: string }} row
 */
function materialRowStatus(row) {
  const d = normalizeErpCodeDisplay(row.materialCode)
  if (!d) return { text: 'ERP不存在', ok: false }
  const k = erpCodeLookupKey(d)
  if (okKeySet.value.has(k)) return { text: '已存在', ok: true }
  return { text: 'ERP不存在', ok: false }
}

/**
 * @param {{ erpCode: string }} row
 */
function accessoryRowStatus(row) {
  const d = normalizeErpCodeDisplay(row.erpCode)
  if (!d) return { text: 'ERP不存在', ok: false }
  const k = erpCodeLookupKey(d)
  if (okKeySet.value.has(k)) return { text: '已存在', ok: true }
  return { text: 'ERP不存在', ok: false }
}

/**
 * @param {{ ok: boolean }} s
 */
function statusClass(s) {
  return s.ok ? 'st-ok' : 'st-bad'
}

function goImport() {
  router.push({ path: '/paper-pattern/import' })
}

function goPreview() {
  if (!fileId.value) return
  router.push({ path: '/paper-pattern/import/preview', query: { fileId: fileId.value } })
}

function cloneRowsFromPayload(materials, accessories) {
  const m = Array.isArray(materials) ? materials : []
  const a = Array.isArray(accessories) ? accessories : []
  materialRows.value = m.map((x) => ({
    groupNo: String(x?.groupNo ?? '').trim(),
    materialName: String(x?.materialName ?? '').trim(),
    materialCode: String(x?.materialCode ?? '').trim(),
  }))
  accessoryRows.value = a.map((x) => ({
    erpCode: String(x?.erpCode ?? '').trim(),
  }))
}

function loadFromSession() {
  try {
    const raw = sessionStorage.getItem(ERP_WORKBENCH_STORAGE)
    if (!raw) {
      errorMessage.value = '无解析数据：请从「纸格资料导入」解析成功后进入，或使用带 fileId 的预览链接。'
      materialRows.value = []
      accessoryRows.value = []
      return
    }
    const o = JSON.parse(raw)
    cloneRowsFromPayload(o.materials, o.accessories)
    errorMessage.value = ''
  } catch {
    errorMessage.value = '本地缓存数据损坏，请返回导入页重新解析。'
    materialRows.value = []
    accessoryRows.value = []
  }
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
      materialRows.value = []
      accessoryRows.value = []
      return
    }
    cloneRowsFromPayload(data.materials, data.accessories)
  } catch (e) {
    const msg =
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '加载失败'
    errorMessage.value = String(msg)
    materialRows.value = []
    accessoryRows.value = []
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
  for (const r of materialRows.value) out.push(r.materialCode)
  for (const r of accessoryRows.value) out.push(r.erpCode)
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
