<template>
  <div class="pi-bom-replace-panel">
    <el-alert
      type="info"
      show-icon
      :closable="false"
      class="pi-bom-replace-hint"
      title="批量替换只修改 PI-BOM 配件明细中的物料档案字段；树结构、单位用量、损耗、搭配不变。替换后请到销售订单对该 PI 执行「一键运算」重新生成物料单。"
    />

    <el-form class="pi-bom-replace-form" label-position="right" label-width="120px" @submit.prevent>
      <el-form-item label="PI号" required>
        <el-autocomplete
          v-model="form.piNo"
          :fetch-suggestions="fetchPiSuggestions"
          value-key="code"
          clearable
          placeholder="请输入 PI 号"
          style="width: 100%"
          maxlength="200"
          @select="onPickPi"
        />
      </el-form-item>
      <el-form-item label="PQ编码">
        <el-autocomplete
          v-model="form.pqCode"
          :fetch-suggestions="fetchPqSuggestions"
          value-key="code"
          clearable
          placeholder="留空则全部修改"
          style="width: 100%"
          maxlength="300"
          :disabled="!String(form.piNo ?? '').trim()"
          @select="onPickPq"
        />
      </el-form-item>
      <el-form-item label="物料源编码" required>
        <el-autocomplete
          v-model="form.sourceCode"
          :fetch-suggestions="fetchMaterialSuggestions"
          value-key="code"
          clearable
          placeholder="请输入待替换的物料编码"
          style="width: 100%"
          maxlength="300"
          :disabled="!String(form.piNo ?? '').trim()"
          @select="onPickMaterial"
        />
      </el-form-item>
      <el-form-item label="目标物料编码" required>
        <el-autocomplete
          v-model="form.targetCode"
          :fetch-suggestions="fetchMaterialSuggestions"
          value-key="code"
          clearable
          placeholder="请输入替换后的物料编码"
          style="width: 100%"
          maxlength="300"
          :disabled="!String(form.piNo ?? '').trim()"
          @select="onPickMaterial"
        />
      </el-form-item>
      <el-form-item label="搭配">
        <el-autocomplete
          v-model="form.matchDescribe"
          :fetch-suggestions="fetchMatchSuggestions"
          value-key="code"
          clearable
          placeholder="留空则仅替换搭配为空的行"
          style="width: 100%"
          maxlength="500"
          :disabled="!String(form.piNo ?? '').trim()"
          @select="onPickMatch"
        />
      </el-form-item>
      <el-form-item label=" ">
        <el-button type="primary" :loading="running" @click="onExecute">立即执行</el-button>
        <el-button :disabled="running" @click="onReset">重置</el-button>
      </el-form-item>
    </el-form>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'

const emit = defineEmits(['replaced'])

const running = ref(false)

const defaultForm = () => ({
  piNo: '',
  pqCode: '',
  sourceCode: '',
  targetCode: '',
  matchDescribe: '',
})

const form = reactive(defaultForm())

watch(
  () => String(form.piNo ?? '').trim(),
  (now, prev) => {
    if (now === prev) return
    // PI 变化后，依赖 PI 的 PQ / 搭配清空，避免误用旧值。
    form.pqCode = ''
    form.matchDescribe = ''
  },
)

function ensureSuggestionCode(item) {
  return String(item?.code ?? '').trim()
}

function onPickPi(item) {
  form.piNo = ensureSuggestionCode(item)
}

function onPickPq(item) {
  form.pqCode = ensureSuggestionCode(item)
}

function onPickMaterial(_item) {
  // 源/目标字段共用下拉服务；el-autocomplete 会自动写入对应 v-model，
  // 这里只做兜底 trim，避免后端参数多余空格。
  form.sourceCode = String(form.sourceCode ?? '').trim()
  form.targetCode = String(form.targetCode ?? '').trim()
}

function onPickMatch(item) {
  form.matchDescribe = ensureSuggestionCode(item)
}

async function fetchPiSuggestions(queryString, cb) {
  const q = String(queryString ?? '').trim()
  if (!q) {
    cb([])
    return
  }
  try {
    const res = await axios.get('/api/inventory/pi-bom-data/pi-suggest', { params: { keyword: q } })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list
        .map((r) => {
          const code = String(r?.code ?? '').trim()
          return code ? { code, value: code } : null
        })
        .filter(Boolean),
    )
  } catch {
    cb([])
  }
}

async function fetchPqSuggestions(queryString, cb) {
  const q = String(queryString ?? '').trim()
  const piNo = String(form.piNo ?? '').trim()
  if (!piNo || !q) {
    cb([])
    return
  }
  try {
    const res = await axios.get('/api/inventory/pi-bom-data/pq-suggest', { params: { piNo, keyword: q } })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list
        .map((r) => {
          const code = String(r?.code ?? '').trim()
          return code ? { code, value: code } : null
        })
        .filter(Boolean),
    )
  } catch {
    cb([])
  }
}

async function fetchMaterialSuggestions(queryString, cb) {
  const q = String(queryString ?? '').trim()
  const piNo = String(form.piNo ?? '').trim()
  if (!piNo || !q) {
    cb([])
    return
  }
  try {
    const pqCode = String(form.pqCode ?? '').trim()
    const params = { piNo, keyword: q }
    if (pqCode) params.pqCode = pqCode
    const res = await axios.get('/api/inventory/pi-bom-data/material-suggest', { params })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list
        .map((r) => {
          const code = String(r?.code ?? '').trim()
          return code ? { code, value: code } : null
        })
        .filter(Boolean),
    )
  } catch {
    cb([])
  }
}

async function fetchMatchSuggestions(queryString, cb) {
  const q = String(queryString ?? '').trim()
  const piNo = String(form.piNo ?? '').trim()
  if (!piNo || !q) {
    cb([])
    return
  }
  try {
    const pqCode = String(form.pqCode ?? '').trim()
    const params = { piNo, keyword: q }
    if (pqCode) params.pqCode = pqCode
    const res = await axios.get('/api/inventory/pi-bom-data/match-suggest', { params })
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    cb(
      list
        .map((r) => {
          const code = String(r?.code ?? '').trim()
          return code ? { code, value: code } : null
        })
        .filter(Boolean),
    )
  } catch {
    cb([])
  }
}

function buildPayload(dryRun = false) {
  return {
    piNo: String(form.piNo ?? '').trim(),
    pqCode: String(form.pqCode ?? '').trim(),
    sourceCode: String(form.sourceCode ?? '').trim(),
    targetCode: String(form.targetCode ?? '').trim(),
    matchDescribe: String(form.matchDescribe ?? '').trim(),
    dryRun,
  }
}

function validateForm() {
  if (!String(form.piNo ?? '').trim()) {
    ElMessage.warning('请填写 PI 号')
    return false
  }
  if (!String(form.sourceCode ?? '').trim()) {
    ElMessage.warning('请填写物料源编码')
    return false
  }
  if (!String(form.targetCode ?? '').trim()) {
    ElMessage.warning('请填写目标物料编码')
    return false
  }
  if (String(form.sourceCode ?? '').trim() === String(form.targetCode ?? '').trim()) {
    ElMessage.warning('物料源编码与目标物料编码不能相同')
    return false
  }
  return true
}

function onReset() {
  Object.assign(form, defaultForm())
}

async function onExecute() {
  if (!validateForm()) return
  running.value = true
  try {
    const previewRes = await axios.post('/api/inventory/pi-bom-data/replace-material', buildPayload(true))
    const previewBody = previewRes?.data
    if (previewBody?.code !== 200) {
      ElMessage.error(String(previewBody?.msg ?? '预检失败'))
      return
    }
    const preview = previewBody?.data ?? {}
    const matchedCount = Number(preview.matchedCount ?? 0)
    if (!Number.isFinite(matchedCount) || matchedCount <= 0) {
      ElMessage.warning('未找到符合条件的 PI-BOM 配件明细行')
      return
    }

    const pqHint = String(form.pqCode ?? '').trim() ? `PQ：${form.pqCode}` : 'PQ：全部款'
    const matchHint = String(form.matchDescribe ?? '').trim()
      ? `搭配：${form.matchDescribe}`
      : '搭配：（空，仅匹配无搭配行）'
    const targetName = String(preview.targetName ?? '').trim()
    const targetHint = targetName ? `${form.targetCode}（${targetName}）` : form.targetCode

    await ElMessageBox.confirm(
      `将替换 PI「${form.piNo}」下 ${matchedCount} 条明细：\n${pqHint}；${matchHint}\n源物料：${form.sourceCode}\n目标物料：${targetHint}\n\n替换后订单将标为未运算，请到销售订单重新「一键运算」。是否继续？`,
      '确认批量替换',
      { type: 'warning', confirmButtonText: '立即执行', cancelButtonText: '取消' },
    )

    const execRes = await axios.post('/api/inventory/pi-bom-data/replace-material', buildPayload(false))
    const execBody = execRes?.data
    if (execBody?.code !== 200) {
      ElMessage.error(String(execBody?.msg ?? '替换失败'))
      return
    }
    const result = execBody?.data ?? {}
    const updatedCount = Number(result.updatedCount ?? matchedCount)
    ElMessage.success(
      `已替换 ${updatedCount} 条 PI-BOM 配件明细。订单已标为未运算，请到销售订单对该 PI 执行「一键运算」重新生成物料单。`,
    )
    emit('replaced', result)
  } catch (err) {
    if (err === 'cancel' || err?.message === 'cancel') return
    ElMessage.error(String(err?.response?.data?.msg ?? err?.message ?? '替换失败'))
  } finally {
    running.value = false
  }
}
</script>

<style scoped>
.pi-bom-replace-panel {
  max-width: 720px;
}

.pi-bom-replace-hint {
  margin-bottom: 16px;
}

.pi-bom-replace-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.pi-bom-replace-form :deep(.el-input) {
  width: 100%;
}
</style>
