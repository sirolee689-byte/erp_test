<template>
  <el-dialog
    :model-value="modelValue"
    :title="multiple ? '批量选择物料（BOM 主档）' : '选择物料（BOM 主档）'"
    :width="multiple ? '85%' : '720px'"
    top="5vh"
    :draggable="multiple"
    destroy-on-close
    :close-on-click-modal="false"
    class="pq-material-selector-dialog"
    @update:model-value="onDialogVisible"
  >
    <p class="ms-tip">
      数据来自 <code>bom_000</code> 已审在册行；关键词至少 <strong>3 个字符</strong>，同时模糊匹配编码（<code>kcaa01</code>）与名称（<code>kcaa02</code>）。
      <template v-if="multiple">
        <br />
        <span class="ms-tip-strong">批量模式：</span>勾选左侧复选框或单击数据行加入「待添加」列表；再次单击可取消。完成后点击右下角确认。
      </template>
    </p>
    <div class="ms-search">
      <el-input
        v-model="keywordKw"
        clearable
        placeholder="关键词（编码或名称）"
        class="ms-keyword-input"
        @keyup.enter="onSearch"
      />
      <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
    </div>
    <el-table
      ref="msTableRef"
      v-loading="loading"
      :data="rows"
      row-key="code"
      border
      size="small"
      class="ms-table"
      :highlight-current-row="!multiple"
      style="width: 100%; margin-top: 10px"
      :max-height="multiple ? 'calc(80vh - 260px)' : 360"
      @selection-change="onSelectionChange"
      @row-click="onRowClick"
      @row-dblclick="onRowDblclick"
    >
      <el-table-column v-if="multiple" type="selection" width="48" reserve-selection />
      <el-table-column prop="code" label="编码" min-width="120" show-overflow-tooltip />
      <el-table-column prop="name" label="名称" min-width="140" show-overflow-tooltip />
      <el-table-column prop="spec" label="规格" min-width="100" show-overflow-tooltip />
      <el-table-column prop="unit" label="单位" width="80" show-overflow-tooltip />
      <el-table-column v-if="!multiple" label="操作" width="88" fixed="right">
        <template #default="{ row }">
          <el-button type="primary" link size="small" @click.stop="onRowActivate(row)">选择</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="ms-pager">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        background
        layout="total, prev, pager, next"
        :total="total"
        :page-sizes="multiple ? [10, 20, 50] : [10, 20]"
        @current-change="loadList"
        @size-change="onSizeChange"
      />
    </div>
    <template v-if="multiple" #footer>
      <div class="ms-footer">
        <span v-if="selectedRows.length" class="ms-footer-count">已选 {{ selectedRows.length }} 项（可跨页保留）</span>
        <div class="ms-footer-actions">
          <el-button @click="closeDialog">取消</el-button>
          <el-button type="primary" :disabled="!selectedRows.length" @click="onConfirmBatch">
            确认添加 ({{ selectedRows.length }}项)
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** 批量模式：多选 + 确认添加 */
  multiple: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'picked', 'batchConfirm'])

/** 单一关键词：后端 OR 匹配 kcaa01 / kcaa02 */
const keywordKw = ref('')
const loading = ref(false)
const rows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

/** @type {import('vue').Ref<any>} */
const msTableRef = ref()
/** 多选当前勾选行（含 reserve-selection 跨页） */
const selectedRows = ref([])

function bomField(bom, name) {
  if (!bom || !name) return ''
  const t = String(name).toLowerCase()
  for (const k of Object.keys(bom)) {
    if (String(k).toLowerCase() === t) {
      const v = bom[k]
      return v == null ? '' : String(v).trim()
    }
  }
  return ''
}

function onSizeChange() {
  page.value = 1
  loadList()
}

function closeDialog() {
  emit('update:modelValue', false)
}

function onDialogVisible(v) {
  emit('update:modelValue', v)
}

function onSelectionChange(rows) {
  if (!props.multiple) return
  selectedRows.value = Array.isArray(rows) ? rows : []
}

/** 单击行切换勾选（批量）；避免与展开区重复触发时检查复选框区域 */
function onRowClick(row, column, event) {
  if (!props.multiple || !msTableRef.value || !row) return
  const el = event?.target
  if (el && typeof el.closest === 'function') {
    if (el.closest('.el-checkbox')) return
  }
  if (column?.type === 'selection') return
  msTableRef.value.toggleRowSelection(row)
}

function onRowDblclick(row) {
  if (props.multiple) return
  onRowActivate(row)
}

function clearTableSelection() {
  selectedRows.value = []
  nextTick(() => {
    msTableRef.value?.clearSelection()
  })
}

function onSearch() {
  page.value = 1
  loadList()
}

async function loadList() {
  const kw = String(keywordKw.value ?? '').trim()
  if (kw.length > 0 && kw.length < 3) {
    ElMessage.warning('关键词至少输入 3 个字符再查询')
    return
  }
  loading.value = true
  try {
    const res = await axios.get('/api/inv/bom/list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        pass: '1',
        bom_cut: '0',
        ...(kw.length >= 3 ? { keyword: kw } : {}),
      },
    })
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    rows.value = Array.isArray(data.list) ? data.list : []
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

/**
 * 拉取 BOM 详情并映射为明细行物料字段（与单笔选择一致）
 * @param {Record<string, unknown>} row 列表行
 * @param {{ silent404?: boolean }} opt
 */
async function fetchBomPayload(row, opt = {}) {
  const code = String(row?.code ?? '').trim()
  if (!code) throw new Error('无编码')
  try {
    const res = await axios.get('/api/supply-chain/purchase-quotations/bom-detail', {
      params: { kcaa01: code },
    })
    const bom = res?.data?.data?.bom ?? {}
    return {
      kcaa01: bomField(bom, 'kcaa01') || code,
      kcaa02: bomField(bom, 'kcaa02') || String(row.name ?? '').trim(),
      kcaa03: bomField(bom, 'kcaa03') || String(row.spec ?? '').trim(),
      kcaa11: bomField(bom, 'kcaa11'),
      kcaa05: bomField(bom, 'kcaa05') || String(row.unit ?? '').trim(),
    }
  } catch (e) {
    const status = e?.response?.status
    if (status === 404) {
      if (!opt.silent404) {
        ElMessage.warning(`【${code}】未查到完整 BOM 资料，已使用列表字段填充`)
      }
      return {
        kcaa01: code,
        kcaa02: String(row.name ?? '').trim(),
        kcaa03: String(row.spec ?? '').trim(),
        kcaa11: '',
        kcaa05: String(row.unit ?? '').trim(),
      }
    }
    throw e
  }
}

/** 双击 / 选择：拉取 BOM 整行补齐颜色等字段 */
async function onRowActivate(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) return
  try {
    const payload = await fetchBomPayload(row)
    emit('picked', payload)
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载物料资料失败'))
  }
}

/** 批量确认：并行拉取所选行 BOM，汇总后交给父组件写入明细 */
async function onConfirmBatch() {
  const list = selectedRows.value || []
  if (!list.length) {
    ElMessage.warning('请先勾选或点选要添加的物料')
    return
  }
  loading.value = true
  try {
    const results = await Promise.allSettled(list.map((row) => fetchBomPayload(row, { silent404: true })))
    /** @type {Record<string, unknown>[]} */
    const payloads = []
    let fail = 0
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value) {
        payloads.push(r.value)
      } else {
        fail += 1
      }
    }
    if (fail) {
      ElMessage.warning(`有 ${fail} 条物料资料加载失败，已跳过`)
    }
    if (!payloads.length) {
      ElMessage.error('没有可用的物料资料，请重试')
      return
    }
    emit('batchConfirm', payloads)
    emit('update:modelValue', false)
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '批量加载物料失败'))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      keywordKw.value = ''
      page.value = 1
      pageSize.value = props.multiple ? 20 : 10
      rows.value = []
      total.value = 0
      clearTableSelection()
    }
  },
)
</script>

<style scoped>
.ms-tip {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.ms-tip code {
  font-size: 12px;
}
.ms-search {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.ms-keyword-input {
  flex: 1;
  min-width: 220px;
  max-width: 420px;
}
.ms-pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.ms-tip-strong {
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.pq-material-selector-dialog .ms-table :deep(.el-table__row) {
  cursor: pointer;
}
.ms-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.ms-footer-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.ms-footer-actions {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-left: auto;
}
</style>
