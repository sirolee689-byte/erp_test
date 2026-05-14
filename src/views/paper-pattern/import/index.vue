<template>
  <div class="erp-module-page">
    <el-card shadow="never" class="block-card">
      <template #header>
        <span class="page-title">纸格资料导入</span>
      </template>
      <p class="page-desc">
        当前步骤：选择导入类型（Bom_code.flag5）、下载固定模板、上传 .xlsx /
        .xls；厂款号固定读取模板 N2（PQ-… 格式，编码时去横线）；前 10 行解析客款号、色号及
        Material、CUT、Accessory；服务端生成临时 BOM 结构（不写数据库）。
      </p>

      <el-divider content-position="left">导入类型</el-divider>
      <div class="section import-type-row">
        <span class="field-label">导入类型</span>
        <el-select
          v-model="importTypeFlag5"
          placeholder="请选择导入类型"
          filterable
          clearable
          class="import-type-select"
          :loading="importTypesLoading"
          @change="onImportTypeChange"
        >
          <el-option
            v-for="it in importTypeOptions"
            :key="it.id"
            :label="formatImportTypeLabel(it)"
            :value="it.flag5"
          />
        </el-select>
        <span v-if="importTypesError" class="hint err-inline">{{ importTypesError }}</span>
      </div>

      <el-divider content-position="left">模板下载</el-divider>
      <div class="section">
        <el-button type="primary" @click="downloadTemplate">下载纸格模板</el-button>
        <span class="hint">模板路径：/template/paper-pattern-template.xlsx（由管理员维护内容）</span>
      </div>

      <el-divider content-position="left">Excel 上传</el-divider>
      <div class="section">
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          @change="onFileChange"
        />
        <el-button type="primary" plain :disabled="!importTypeFlag5" @click="triggerPickFile">
          选择 Excel 文件
        </el-button>
        <span v-if="pickedLabel" class="picked-name">{{ pickedLabel }}</span>
        <span v-else class="picked-placeholder">未选择文件</span>
        <el-button
          type="primary"
          :disabled="!importTypeFlag5 || !pickedFile"
          :loading="uploading"
          @click="onUploadParse"
        >
          上传并解析
        </el-button>
      </div>

      <el-alert v-if="errorMessage" class="err" :title="errorMessage" type="error" show-icon />

      <template v-if="parseResult">
        <el-divider content-position="left">解析结果预览</el-divider>

        <el-alert
          v-if="parseResult.warnings?.length"
          type="warning"
          show-icon
          class="warn-block"
          title="解析提示"
        >
          <ul class="warn-list">
            <li v-for="(w, i) in parseResult.warnings" :key="i">{{ w }}</li>
          </ul>
        </el-alert>

        <h3 class="sub-title">主 BOM 信息</h3>
        <el-table :data="mainBomRows" border size="small" class="preview-table">
          <el-table-column prop="label" label="字段" width="160" />
          <el-table-column prop="value" label="值" min-width="240" />
        </el-table>

        <h3 class="sub-title">CUT 列表</h3>
        <el-table :data="parseResult.cuts" border size="small" class="preview-table" empty-text="无">
          <el-table-column prop="cutCode" label="CUT 编码" min-width="280" />
          <el-table-column prop="cutName" label="裁片名称" min-width="160" />
        </el-table>

        <h3 class="sub-title">Material 列表</h3>
        <el-table :data="parseResult.materials" border size="small" class="preview-table" empty-text="无">
          <el-table-column prop="groupNo" label="分组" width="100" />
          <el-table-column prop="materialName" label="Material 名称" min-width="160" />
          <el-table-column prop="materialCode" label="ERP 编码" min-width="200" />
        </el-table>

        <h3 class="sub-title">Accessory 列表</h3>
        <el-table :data="parseResult.accessories" border size="small" class="preview-table" empty-text="无">
          <el-table-column prop="erpCode" label="ERP 编码" min-width="240" />
        </el-table>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'

const templateHref = '/template/paper-pattern-template.xlsx'

function downloadTemplate() {
  const a = document.createElement('a')
  a.href = templateHref
  a.download = 'paper-pattern-template.xlsx'
  a.rel = 'noopener'
  a.click()
}

const fileInputRef = ref(null)
const pickedFile = ref(null)
const pickedLabel = ref('')
const uploading = ref(false)
const errorMessage = ref('')
/** @type {import('vue').Ref<Array<{ id: number, flag1: string, flag5: string }>>} */
const importTypeOptions = ref([])
const importTypesLoading = ref(false)
const importTypesError = ref('')
/** 导入类型：对应 Bom_code.flag5 */
const importTypeFlag5 = ref('')
/** @type {import('vue').Ref<null | { mainBom: object, cuts: any[], materials: any[], accessories: any[], warnings: string[] }>} */
const parseResult = ref(null)

function formatImportTypeLabel(it) {
  const f1 = String(it?.flag1 ?? '').trim()
  const f5 = String(it?.flag5 ?? '').trim()
  if (f1 && f5) return `${f1}(${f5})`
  return f5 || f1 || '—'
}

async function loadImportTypes() {
  importTypesError.value = ''
  importTypesLoading.value = true
  try {
    const res = await axios.get('/api/paper-pattern/import-types')
    const data = res?.data
    if (!data?.success) {
      importTypesError.value = String(data?.message || '加载导入类型失败')
      importTypeOptions.value = []
      return
    }
    importTypeOptions.value = Array.isArray(data.items) ? data.items : []
  } catch (e) {
    importTypesError.value = String(
      e?.response?.data?.message || e?.response?.data?.msg || e?.message || '加载导入类型失败',
    )
    importTypeOptions.value = []
  } finally {
    importTypesLoading.value = false
  }
}

function onImportTypeChange() {
  errorMessage.value = ''
  parseResult.value = null
}

const mainBomRows = computed(() => {
  const m = parseResult.value?.mainBom
  if (!m) return []
  return [
    { label: '导入类型', value: m.importTypeDisplay || m.importTypeFlag5 || '—' },
    { label: '厂款号（N2 原始）', value: m.styleNoRaw || '—' },
    { label: '厂款号（编码用）', value: m.styleNoNormalized || m.styleNo || '—' },
    { label: '客款号', value: m.customerStyleNo || '—' },
    { label: '色号', value: m.colorNo || '—' },
    { label: 'BOM 编码', value: m.bomCode || '—' },
  ]
})

onMounted(() => {
  loadImportTypes()
})

function triggerPickFile() {
  errorMessage.value = ''
  if (!importTypeFlag5.value) {
    errorMessage.value = '请先选择导入类型'
    return
  }
  fileInputRef.value?.click()
}

function onFileChange(ev) {
  const input = ev.target
  const file = input?.files?.[0]
  if (!file) {
    pickedFile.value = null
    pickedLabel.value = ''
    return
  }
  const name = String(file.name || '')
  const lower = name.toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    pickedFile.value = null
    pickedLabel.value = ''
    errorMessage.value = '仅允许上传 .xlsx 或 .xls 文件'
    input.value = ''
    return
  }
  pickedFile.value = file
  pickedLabel.value = name
  input.value = ''
}

async function onUploadParse() {
  if (!pickedFile.value || !importTypeFlag5.value) return
  errorMessage.value = ''
  uploading.value = true
  parseResult.value = null
  try {
    const fd = new FormData()
    fd.append('file', pickedFile.value)
    fd.append('importTypeFlag5', String(importTypeFlag5.value).trim())
    const res = await axios.post('/api/paper-pattern/upload', fd)
    const data = res?.data
    if (!data?.success) {
      errorMessage.value = String(data?.message || '解析失败')
      return
    }
    parseResult.value = {
      mainBom: data.mainBom || {},
      cuts: Array.isArray(data.cuts) ? data.cuts : [],
      materials: Array.isArray(data.materials) ? data.materials : [],
      accessories: Array.isArray(data.accessories) ? data.accessories : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    }
  } catch (e) {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.msg ||
      e?.message ||
      '上传或解析失败'
    errorMessage.value = String(msg)
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.block-card {
  max-width: 1100px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
}
.section {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.import-type-row {
  align-items: center;
}
.field-label {
  min-width: 72px;
  color: var(--el-text-color-regular);
  font-size: 14px;
}
.import-type-select {
  min-width: 260px;
  max-width: 420px;
}
.err-inline {
  color: var(--el-color-danger);
}
.hidden-file {
  display: none;
}
.picked-name {
  color: var(--el-text-color-primary);
}
.picked-placeholder {
  color: var(--el-text-color-placeholder);
}
.hint {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.warn-list {
  margin: 8px 0 0;
  padding-left: 1.2em;
}
.warn-block {
  margin-bottom: 12px;
}
.sub-title {
  margin: 16px 0 8px;
  font-size: 15px;
  font-weight: 600;
}
.preview-table {
  margin-bottom: 8px;
}
</style>
