<template>
  <div class="stock-batch-window">
    <header class="stock-batch-header">
      <h1 class="stock-batch-title">{{ windowTitle }}</h1>
      <p class="stock-batch-subtitle">{{ sourceLabel }}：{{ sourceOrderNo }}　{{ partyLabel }}：{{ supplierCode }} {{ supplierName }}</p>
    </header>

    <section class="stock-batch-toolbar">
      <span class="stock-batch-query-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-batch-query-input"
        placeholder="材料编码 / 名称 / 规格 / 颜色"
        @keyup.enter="reload"
      />
      <el-button type="primary" @click="reload">查询</el-button>
      <el-button @click="queryAll">查询全部</el-button>
      <el-button type="primary" :disabled="!selectedCount || saving || submitted" :loading="saving" @click="saveSelected">
        {{ submitted ? '已提交' : '保存已选数据' }}
      </el-button>
      <el-button @click="resetSelection">全部重选</el-button>
      <span class="stock-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert
      v-if="closeHint"
      class="stock-batch-close-hint"
      :title="closeHint"
      type="success"
      show-icon
      :closable="false"
    />

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyText" />
        <div v-else class="stock-batch-table-wrap">
          <table class="stock-batch-table">
            <thead v-if="isProductionBatch">
              <tr>
                <th class="col-action">操作</th>
                <th>材料编码</th>
                <th>材料名称</th>
                <th>规格</th>
                <th>颜色</th>
                <th>单位</th>
                <th class="col-num col-need">可入库数量</th>
                <th class="col-num">RMB单价</th>
                <th class="col-num">RMB金额</th>
                <th class="col-num">派工数量</th>
                <th>未审入库情况</th>
                <th>未审出库情况</th>
                <th class="col-num">实际已入数量</th>
                <th class="col-num">返工数量</th>
              </tr>
            </thead>
            <thead v-else>
              <tr>
                <th class="col-action">操作</th>
                <th>材料编码</th>
                <th>材料名称</th>
                <th>规格</th>
                <th>颜色</th>
                <th>{{ currencyHeader }}</th>
                <th>使用单位</th>
                <th class="col-num col-need">{{ needQtyHeader }}</th>
                <th v-if="isPurchaseBatch" class="col-num col-overflow">可超量入库数</th>
                <th>PO/PI</th>
                <th>备注</th>
                <th class="col-num">{{ orderQtyHeader }}</th>
                <th>未审入库情况</th>
                <th>{{ pendingOutHeader }}</th>
                <th class="col-num">实际入库数量</th>
                <th class="col-num">{{ actualOutHeader }}</th>
                <th>是否存在转换数据</th>
              </tr>
            </thead>
            <tbody v-if="isProductionBatch">
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-batch-row--picked': isPicked(row) }">
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
                <td>{{ row.kcaa01 || '-' }}</td>
                <td>{{ row.kcaa02 || '-' }}</td>
                <td>{{ row.kcaa03 || '-' }}</td>
                <td>{{ row.kcaa11 || '-' }}</td>
                <td>{{ row.kcaa04 || '-' }}</td>
                <td class="col-num" :class="productionTempxClass(row)">{{ formatNum(row.tempx) }}</td>
                <td class="col-num">0</td>
                <td class="col-num">0</td>
                <td class="col-num">{{ formatNum(row.orderQty) }}</td>
                <td class="col-pending">{{ row.pendingInboundText || '-' }}</td>
                <td class="col-pending">{{ row.pendingOutboundText || '-' }}</td>
                <td class="col-num">{{ formatNum(row.actualInboundQty) }}</td>
                <td class="col-num">{{ formatNum(row.reworkQty ?? row.actualOutboundQty) }}</td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-batch-row--picked': isPicked(row) }">
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
                <td>{{ row.kcaa01 || '-' }}</td>
                <td>{{ row.kcaa02 || '-' }}</td>
                <td>{{ row.kcaa03 || '-' }}</td>
                <td>{{ row.kcaa11 || '-' }}</td>
                <td>{{ row.currencyDisplay || '-' }}</td>
                <td>{{ row.kcaa04 || '-' }}</td>
                <td class="col-num col-need">{{ formatNum(row.tempx) }}</td>
                <td v-if="isPurchaseBatch" class="col-num col-overflow">
                  {{ formatNum(row.kcao031) }}
                  <span v-if="row.floatRatePercent > 0" class="stock-batch-float">({{ row.floatRateText }})</span>
                </td>
                <td>{{ row.reference || '-' }}</td>
                <td>{{ row.info || '-' }}</td>
                <td class="col-num">{{ formatNum(row.orderQty) }}</td>
                <td class="col-pending">{{ row.pendingInboundText || '-' }}</td>
                <td class="col-pending">{{ pendingOutText(row) }}</td>
                <td class="col-num">{{ formatNum(row.actualInboundQty) }}</td>
                <td class="col-num">{{ formatNum(actualOutQty(row)) }}</td>
                <td>{{ row.unitConvertText || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="stock-batch-pagination">
          <span>第{{ page }}页，共{{ totalPages }}页，共{{ total }}条</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="total"
            layout="prev, pager, next, sizes, jumper"
            small
            background
            @current-change="loadRows"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  STOCK_BATCH_MSG_APPLY,
  STOCK_BATCH_MSG_ACCEPTED,
  STOCK_BATCH_MSG_REJECTED,
  STOCK_BATCH_REJECT_SOURCE_MISMATCH,
  STOCK_BATCH_REJECT_SUPPLIER_MISMATCH,
  readStockBatchContext,
  writeStockBatchResult,
} from '@/utils/stockInBatchAdd'

defineOptions({ name: 'inventory-daily-stock-in-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const batchType = ref('purchase')
const inboundType = ref('1')
const sourceOrderNo = ref('')
const supplierCode = ref('')
const supplierName = ref('')
const excludeReceiptNo = ref('')
const dispatchSystemcode = ref('')
const selectedKeysFromParent = ref([])
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const rows = ref([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const closeHint = ref('')
const submitted = ref(false)

const isProductionBatch = computed(() => batchType.value === 'production')
const isAssistBatch = computed(() => batchType.value === 'assist')
const isPurchaseBatch = computed(() => !isAssistBatch.value && !isProductionBatch.value)
const selectedCount = computed(() => pickedKeys.value.size)
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(pageSize.value || 20))))
const windowTitle = computed(() => {
  if (isProductionBatch.value) return '生产入库批量添加明细'
  if (isAssistBatch.value) return '外协入库批量添加明细'
  return '采购入库批量添加明细'
})
const sourceLabel = computed(() => {
  if (isProductionBatch.value) return '派工单号'
  if (isAssistBatch.value) return '外协单号'
  return '采购单号'
})
const partyLabel = computed(() => {
  if (isProductionBatch.value) return '生产车间'
  if (isAssistBatch.value) return '外协客户'
  return '供应商'
})
const emptyText = computed(() => {
  if (isProductionBatch.value) return '该派工单下暂无可选明细'
  if (isAssistBatch.value) return '该外协单下暂无可选明细'
  return '该采购单下暂无可选明细'
})
const currencyHeader = computed(() => (isAssistBatch.value ? '采购币别/汇率' : '采购币别/汇率'))
const needQtyHeader = computed(() => (isAssistBatch.value ? '可入数量' : '需入数量'))
const orderQtyHeader = computed(() => (isAssistBatch.value ? '外协数量' : '采购数量'))
const pendingOutHeader = computed(() => (isAssistBatch.value ? '未审出库情况' : '未审退货情况'))
const actualOutHeader = computed(() => (isAssistBatch.value ? '实际出库数量' : '退货数量'))

function formatNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

/** 生产入库可入库数量：正数红色；负数也红色（超入提示）；零为灰色 */
function productionTempxClass(row) {
  const n = Number(row.tempx)
  if (!Number.isFinite(n)) return 'col-need'
  if (n > 0) return 'col-need'
  if (n < 0) return 'col-need col-need--negative'
  return 'col-need col-need--zero'
}

function closeWindowAfterError(msg) {
  ElMessage.error(msg)
  setTimeout(() => {
    window.close()
    setTimeout(() => {
      closeHint.value = '校验未通过，请关闭本窗口后重新打开批量添加。'
    }, 300)
  }, 1500)
}

function isPicked(row) {
  return pickedKeys.value.has(String(row.lineKey ?? '').toLowerCase())
}

function buttonLabel(row) {
  if (isPicked(row)) return '已选择'
  return row.selectLabel || '选择'
}

function buttonType(row) {
  if (isPicked(row)) return 'success'
  if (!row.selectable) return 'info'
  return 'warning'
}

function pendingOutText(row) {
  return isAssistBatch.value ? row.pendingOutboundText || '-' : row.pendingReturnText || '-'
}

function actualOutQty(row) {
  return isAssistBatch.value ? row.actualOutboundQty : row.returnQty
}

function togglePick(row) {
  const key = String(row.lineKey ?? '').toLowerCase()
  if (!key) return
  if (isPicked(row)) {
    pickedKeys.value.delete(key)
    pickedRows.value.delete(key)
    pickedKeys.value = new Set(pickedKeys.value)
    return
  }
  if (!row.selectable) return
  pickedKeys.value.add(key)
  pickedRows.value.set(key, JSON.parse(JSON.stringify(row)))
  pickedKeys.value = new Set(pickedKeys.value)
}

function resetSelection() {
  pickedKeys.value = new Set()
  pickedRows.value = new Map()
}

async function loadRows() {
  if (!sourceOrderNo.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const selectedOnPage = [...pickedKeys.value]
    const mergedSelected = [...new Set([...selectedKeysFromParent.value, ...selectedOnPage])]
    const endpoint = isProductionBatch.value
      ? '/api/stock-in/production-batch-lines'
      : (isAssistBatch.value ? '/api/stock-in/assist-batch-lines' : '/api/stock-in/purchase-batch-lines')
    const { data } = await axios.get(endpoint, {
      params: {
        inboundType: inboundType.value,
        sourceOrderNo: sourceOrderNo.value,
        supplierCode: supplierCode.value,
        workshopCode: supplierCode.value,
        dispatchSystemcode: dispatchSystemcode.value,
        excludeReceiptNo: excludeReceiptNo.value,
        keyword: keyword.value,
        page: page.value,
        pageSize: pageSize.value,
        selectedKeys: mergedSelected.join(','),
      },
    })
    rows.value = data?.data?.list ?? []
    total.value = Number(data?.data?.total ?? 0)
  } catch (err) {
    const msg = err.response?.data?.msg || err.message || '加载失败'
    errorMsg.value = msg
    rows.value = []
    total.value = 0
    if (isProductionBatch.value && err.response?.status === 400) {
      closeWindowAfterError(msg)
    }
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  loadRows()
}

function queryAll() {
  keyword.value = ''
  reload()
}

function onPageSizeChange() {
  page.value = 1
  loadRows()
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

function saveSelected() {
  if (submitted.value || saving.value) return
  if (!pickedRows.value.size) return ElMessage.warning('请先选择明细')

  const lines = [...pickedRows.value.values()]
  const sid = sessionId.value
  const payload = JSON.parse(JSON.stringify({
    type: STOCK_BATCH_MSG_APPLY,
    sessionId: sid,
    openedSourceOrderNo: sourceOrderNo.value,
    openedSupplierCode: supplierCode.value,
    batchType: batchType.value,
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
      if (data.reason === STOCK_BATCH_REJECT_SOURCE_MISMATCH) {
        ElMessage.warning(`${sourceLabel.value}已变更，请重新打开批量添加`)
      } else if (data.reason === STOCK_BATCH_REJECT_SUPPLIER_MISMATCH) {
        ElMessage.warning(`${partyLabel.value}已变更，请重新打开批量添加`)
      } else {
        ElMessage.warning('保存失败，请重试')
      }
    }
  }

  saving.value = true
  window.addEventListener('message', onReply)
  timeoutId = setTimeout(() => {
    if (settled) return
    cleanup()
    ElMessage.warning('父页面无响应。若入库单明细已出现新行，可直接关闭本窗口；否则请确认入库单页面仍打开后重试。')
  }, 3000)

  opener.postMessage(payload, origin)
}

onMounted(() => {
  const ctx = readStockBatchContext(sessionId.value)
  if (!ctx) {
    errorMsg.value = '会话已失效，请从入库单页面重新打开批量添加'
    return
  }
  const bt = String(ctx.batchType ?? 'purchase').trim()
  if (bt === 'production') batchType.value = 'production'
  else if (bt === 'assist') batchType.value = 'assist'
  else batchType.value = 'purchase'
  inboundType.value = String(ctx.inboundType ?? (batchType.value === 'production' ? '4' : batchType.value === 'assist' ? '2' : '1')).trim()
  sourceOrderNo.value = String(ctx.sourceOrderNo ?? route.query?.sourceOrderNo ?? '').trim()
  supplierCode.value = String(ctx.supplierCode ?? '').trim()
  supplierName.value = String(ctx.supplierName ?? '').trim()
  excludeReceiptNo.value = String(ctx.excludeReceiptNo ?? '').trim()
  dispatchSystemcode.value = String(ctx.dispatchSystemcode ?? '').trim()
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize) > 0 ? Number(ctx.pageSize) : 20
  loadRows()
})
</script>

<style scoped>
.stock-batch-window {
  min-height: 100vh;
  padding: 16px 20px 24px;
  background: #f5f7fa;
  box-sizing: border-box;
}
.stock-batch-header {
  margin-bottom: 12px;
}
.stock-batch-title {
  margin: 0 0 6px;
  font-size: 22px;
}
.stock-batch-subtitle {
  margin: 0;
  color: #606266;
}
.stock-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
}
.stock-batch-query-input {
  width: 280px;
}
.stock-batch-selected {
  margin-left: auto;
  color: #409eff;
  font-weight: 600;
}
.stock-batch-close-hint {
  margin-bottom: 12px;
}
.stock-batch-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 220px);
  background: #fff;
  border-radius: 8px;
}
.stock-batch-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.stock-batch-table th,
.stock-batch-table td {
  border: 1px solid #ebeef5;
  padding: 8px 10px;
  white-space: nowrap;
  vertical-align: middle;
}
.stock-batch-table th {
  background: #f5f7fa;
  position: sticky;
  top: 0;
  z-index: 1;
}
.col-action {
  position: sticky;
  left: 0;
  z-index: 2;
  background: #fff;
}
.stock-batch-table th.col-action {
  background: #f5f7fa;
  z-index: 3;
}
.col-num {
  text-align: right;
}
.col-need {
  color: #f56c6c;
  font-weight: 600;
}
.col-need--negative {
  color: #c45656;
}
.col-need--zero {
  color: #909399;
  font-weight: 500;
}
.col-overflow {
  color: #409eff;
  font-weight: 600;
}
.stock-batch-float {
  margin-left: 4px;
  font-size: 12px;
}
.col-pending {
  max-width: 220px;
  white-space: normal;
  word-break: break-all;
}
.stock-batch-row--picked {
  background: #f0f9eb;
}
.stock-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
}
</style>
