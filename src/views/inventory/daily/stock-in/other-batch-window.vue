<template>
  <div class="stock-in-other-batch-window">
    <header class="stock-in-other-batch-header">
      <h1 class="stock-in-other-batch-title">其他入库批量选材</h1>
      <p class="stock-in-other-batch-subtitle">当前仓库：{{ warehouseName || warehouseCode || '-' }}</p>
    </header>

    <section class="stock-in-other-batch-toolbar">
      <span class="stock-in-other-batch-label">分类</span>
      <el-select v-model="categoryCode" class="stock-in-other-batch-category" disabled>
        <el-option label="全部" value="" />
      </el-select>
      <span class="stock-in-other-batch-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-in-other-batch-query-input"
        placeholder="材料编码 / 唯一码 / 产地 / 物料资料关键字"
        @keyup.enter="reload"
      />
      <el-button type="primary" @click="reload">立即查询</el-button>
      <el-button @click="resetKeyword">重置</el-button>
      <el-button @click="queryAll">查询全部</el-button>
      <el-button type="primary" :disabled="!selectedCount || saving || submitted" :loading="saving" @click="saveSelected">
        {{ submitted ? '已提交' : '保存已选数据' }}
      </el-button>
      <el-button @click="closeWindow">关闭</el-button>
      <span class="stock-in-other-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert
      v-if="closeHint"
      class="stock-in-other-batch-close-hint"
      :title="closeHint"
      type="success"
      show-icon
      :closable="false"
    />

    <el-skeleton :loading="loading" animated :rows="8">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyText" />
        <div v-else class="stock-in-other-batch-table-wrap">
          <table class="stock-in-other-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>产地</th>
                <th>材料编码</th>
                <th class="col-book">账存数量</th>
                <th class="col-pending">物料出库未审总数</th>
                <th class="col-actual">实际库存数量</th>
                <th>名称(中文)</th>
                <th>名称(英文)</th>
                <th>名称(开票名)</th>
                <th>规格</th>
                <th>单位</th>
                <th>分类</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-in-other-batch-row--picked': isPicked(row) }">
                <td class="col-action">
                  <el-button
                    size="small"
                    :type="buttonType(row)"
                    :disabled="!row.selectable && !isPicked(row)"
                    @click="togglePick(row)"
                  >
                    {{ buttonLabel(row) }}
                  </el-button>
                </td>
                <td>{{ row.location || '-' }}</td>
                <td>{{ row.materialCode || row.kcaa01 || '-' }}</td>
                <td class="col-num col-book">{{ formatStockNum(row.bookQty) }}</td>
                <td class="col-num col-pending">{{ formatStockNum(row.pendingOutQty) }}</td>
                <td class="col-num col-actual" :class="{ 'col-actual--zero': Number(row.actualQty) <= 0 }">
                  {{ formatStockNum(row.displayActualQty ?? row.actualQty) }}
                </td>
                <td>{{ row.kcaa02 || '-' }}</td>
                <td>{{ row.kcaa02_en || '-' }}</td>
                <td>{{ row.kpname || '-' }}</td>
                <td>{{ row.kcaa03 || '-' }}</td>
                <td>{{ row.kcaa04 || '-' }}</td>
                <td>{{ row.categoryName || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="stock-in-other-batch-pagination">
          <span>第{{ page }}页，共{{ totalPages }}页，共{{ total }}条，每页{{ pageSize }}条</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="ERP_PAGE_SIZE_OPTIONS"
            :total="total"
            layout="total, sizes, prev, pager, next, jumper"
            small
            background
            @current-change="() => loadRows({ allowEmptyKeyword })"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  STOCK_BATCH_MSG_APPLY,
  STOCK_BATCH_MSG_ACCEPTED,
  STOCK_BATCH_MSG_REJECTED,
  STOCK_BATCH_REJECT_WAREHOUSE_MISMATCH,
  readStockBatchContext,
  writeStockBatchResult,
} from '@/utils/stockInBatchAdd'

defineOptions({ name: 'inventory-daily-stock-in-other-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const warehouseCode = ref('')
const warehouseName = ref('')
const inTax = ref('1')
const selectedKeysFromParent = ref([])
const categoryCode = ref('')
const loading = ref(false)
const saving = ref(false)
const submitted = ref(false)
const keyword = ref('')
const errorMsg = ref('')
const rows = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const closeHint = ref('')
const hasSearched = ref(false)
const allowEmptyKeyword = ref(false)

const emptyText = computed(() => (hasSearched.value ? '查询结果：没有查询到相关信息' : '请输入关键字后点击查询'))
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))
const selectedCount = computed(() => pickedRows.value.size)

/** 库存三列固定两位小数，对齐其他出库批量选材 */
function formatStockNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0.00'
  return (Math.round(n * 100) / 100).toFixed(2)
}

function isPicked(row) {
  return pickedKeys.value.has(row.lineKey)
}

function buttonLabel(row) {
  if (isPicked(row)) return '已选择'
  return row.selectLabel || '选择'
}

function buttonType(row) {
  if (isPicked(row)) return 'info'
  if (row.selectable) return 'warning'
  return 'info'
}

function togglePick(row) {
  if (!row?.lineKey) return
  if (isPicked(row)) {
    pickedKeys.value.delete(row.lineKey)
    pickedRows.value.delete(row.lineKey)
    return
  }
  if (!row.selectable) return
  pickedKeys.value.add(row.lineKey)
  pickedRows.value.set(row.lineKey, { ...row })
}

async function loadRows(options = {}) {
  if (!warehouseCode.value) return
  const kw = keyword.value.trim()
  const canEmpty = !!options.allowEmptyKeyword
  if (!kw && !canEmpty) {
    hasSearched.value = false
    rows.value = []
    total.value = 0
    return
  }
  loading.value = true
  errorMsg.value = ''
  hasSearched.value = true
  try {
    const res = await axios.get('/api/stock-in/other-batch-lines', {
      params: {
        warehouseCode: warehouseCode.value,
        keyword: kw || undefined,
        requireKeyword: kw ? undefined : (canEmpty ? '0' : '1'),
        selectedKeys: [...pickedKeys.value, ...selectedKeysFromParent.value].join(','),
        page: page.value,
        pageSize: pageSize.value,
      },
    })
    const body = res?.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取批量选材失败')
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    rows.value = Array.isArray(data.list) ? data.list : []
  } catch (err) {
    rows.value = []
    total.value = 0
    errorMsg.value = String(err?.response?.data?.msg ?? err?.message ?? '读取批量选材失败')
  } finally {
    loading.value = false
  }
}

function reload() {
  allowEmptyKeyword.value = false
  page.value = 1
  loadRows()
}

function resetKeyword() {
  keyword.value = ''
  allowEmptyKeyword.value = false
  hasSearched.value = false
  rows.value = []
  total.value = 0
}

function queryAll() {
  keyword.value = ''
  allowEmptyKeyword.value = true
  page.value = 1
  loadRows({ allowEmptyKeyword: true })
}

function onPageSizeChange() {
  page.value = 1
  loadRows({ allowEmptyKeyword: allowEmptyKeyword.value })
}

function closeWindow() {
  window.close()
}

function onSaveAccepted(lineCount) {
  submitted.value = true
  const count = Number(lineCount)
  closeHint.value = `已保存 ${count} 条明细，正在关闭窗口...`
  ElMessage.success(closeHint.value)
  setTimeout(() => {
    window.close()
    setTimeout(() => {
      closeHint.value = '明细已带回入库单。如果浏览器未自动关闭，请直接关闭本窗口。'
    }, 300)
  }, 300)
}

async function saveSelected() {
  if (submitted.value || saving.value) return
  if (!pickedRows.value.size) return ElMessage.warning('请先选择明细')

  saving.value = true
  try {
    const picked = [...pickedRows.value.values()]
    const materialCodes = picked.map((row) => String(row.materialCode ?? row.kcaa01 ?? '').trim()).filter(Boolean)
    const priceRes = await axios.post('/api/stock-in/surplus-batch-prices', {
      warehouseCode: warehouseCode.value,
      materialCodes,
    })
    const priceMap = priceRes?.data?.data?.priceMap ?? {}
    const taxMode = String(inTax.value) === '2' ? '2' : '1'
    const lines = picked.map((row) => {
      const code = String(row.materialCode ?? row.kcaa01 ?? '').trim()
      const priceRow = priceMap[code] ?? null
      const ex = Number(priceRow?.kcao04 ?? 0)
      const inc = Number(priceRow?.kcao041 ?? 0)
      const tax = taxMode === '2' ? 0 : Number(priceRow?.tax ?? priceRow?.Tax ?? 0)
      return {
        ...row,
        batchType: 'other',
        kcao02: row.systemcode || row.GUID || '',
        kcao03: 1,
        kcao031: 1,
        availableQty: 1,
        needQty: 1,
        kcao04: ex,
        kcao041: inc,
        tax,
        kcao05: Number((1 * ex).toFixed(2)),
        kcao051: Number((1 * inc).toFixed(2)),
        reference: '',
        Describe: '',
        info: row.info || row.remark || '',
      }
    })

    const sid = sessionId.value
    const payload = JSON.parse(JSON.stringify({
      type: STOCK_BATCH_MSG_APPLY,
      sessionId: sid,
      batchType: 'other',
      openedWarehouseCode: warehouseCode.value,
      lines,
    }))
    writeStockBatchResult(sid, payload)

    const opener = window.opener
    if (!opener || opener.closed) {
      ElMessage.error('请从入库单页面重新打开批量添加')
      return
    }

    const origin = window.location.origin
    let settled = false
    let timeoutId = null

    function cleanup() {
      settled = true
      saving.value = false
      window.removeEventListener('message', onReply)
      clearTimeout(timeoutId)
    }

    function onReply(event) {
      if (settled || event.origin !== origin) return
      const data = event.data
      if (!data || data.sessionId !== sid) return
      if (data.type === STOCK_BATCH_MSG_ACCEPTED) {
        cleanup()
        onSaveAccepted(Number(data.lineCount ?? lines.length))
        return
      }
      if (data.type === STOCK_BATCH_MSG_REJECTED) {
        cleanup()
        if (data.reason === STOCK_BATCH_REJECT_WAREHOUSE_MISMATCH) {
          ElMessage.warning('仓库数据错误，请检查所选仓库')
        } else {
          ElMessage.warning('保存失败，请重试')
        }
      }
    }

    window.addEventListener('message', onReply)
    timeoutId = setTimeout(() => {
      if (settled) return
      cleanup()
      ElMessage.warning('父页面无响应。若入库单明细已出现新行，可直接关闭本窗口；否则请确认入库单页面仍打开后重试。')
    }, 3000)

    opener.postMessage(payload, origin)
  } catch (err) {
    saving.value = false
    ElMessage.error(String(err?.response?.data?.msg ?? err?.message ?? '保存失败'))
  }
}

onMounted(() => {
  const ctx = readStockBatchContext(sessionId.value)
  if (!ctx) {
    errorMsg.value = '会话已失效，请从入库单页面重新打开批量添加'
    return
  }
  warehouseCode.value = String(ctx.warehouseCode ?? '').trim()
  warehouseName.value = String(ctx.warehouseName ?? '').trim()
  inTax.value = String(ctx.inTax ?? '1')
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize) > 0 ? Number(ctx.pageSize) : 10

  const routeWarehouse = String(route.query?.warehouseCode ?? '').trim()
  if (routeWarehouse && warehouseCode.value && routeWarehouse !== warehouseCode.value) {
    ElMessage.error('仓库数据错误，请检查所选仓库')
    setTimeout(() => window.close(), 1200)
    return
  }
  if (!warehouseCode.value) {
    errorMsg.value = '缺少仓库信息，请从入库单页面重新打开'
  }
})
</script>

<style scoped>
.stock-in-other-batch-window { min-height: 100vh; padding: 16px 20px 24px; background: var(--erp-app-bg, #f5f7fa); box-sizing: border-box; }
.stock-in-other-batch-header { margin-bottom: 12px; }
.stock-in-other-batch-title { margin: 0 0 6px; font-size: 22px; }
.stock-in-other-batch-subtitle { margin: 0; color: var(--el-text-color-regular); font-size: 15px; }
.stock-in-other-batch-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 12px; padding: 12px; background: var(--erp-surface, #fff); border-radius: 8px; }
.stock-in-other-batch-label { color: var(--el-text-color-regular); }
.stock-in-other-batch-category { width: 120px; }
.stock-in-other-batch-query-input { width: 320px; }
.stock-in-other-batch-selected { margin-left: auto; color: #409eff; font-weight: 600; }
.stock-in-other-batch-close-hint { margin-bottom: 12px; }
.stock-in-other-batch-table-wrap { overflow: auto; max-height: calc(100vh - 240px); background: var(--erp-surface, #fff); border-radius: 8px; }
.stock-in-other-batch-table { width: max-content; min-width: 100%; border-collapse: collapse; font-size: 13px; }
.stock-in-other-batch-table th, .stock-in-other-batch-table td { border: 1px solid var(--el-border-color-lighter); padding: 8px 10px; white-space: nowrap; vertical-align: middle; }
.stock-in-other-batch-table th { background: var(--el-fill-color-light, #f5f7fa); position: sticky; top: 0; z-index: 1; }
.col-action { position: sticky; left: 0; z-index: 2; background: var(--erp-surface, #fff); }
.stock-in-other-batch-table th.col-action { background: var(--el-fill-color-light, #f5f7fa); z-index: 3; }
.col-num { text-align: right; }
.col-book,
.stock-in-other-batch-table th.col-book { color: #dc2626; }
.col-pending,
.stock-in-other-batch-table th.col-pending { color: #7e22ce; font-weight: 600; }
.col-actual,
.stock-in-other-batch-table th.col-actual { color: #1d4ed8; }
.col-actual--zero { color: #dc2626 !important; }
.stock-in-other-batch-row--picked { background: var(--el-color-success-light-9, #f0f9eb); }
.stock-in-other-batch-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; padding: 10px 12px; background: var(--erp-surface, #fff); border-radius: 8px; }
</style>
