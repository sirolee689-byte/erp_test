<template>
  <div class="buy-batch-window">
    <header class="buy-batch-header">
      <h1 class="buy-batch-title">采购订单批量添加明细</h1>
      <p class="buy-batch-subtitle">PI号：{{ piNo }}（已锁定）</p>
    </header>

    <section class="buy-batch-toolbar">
      <span class="buy-batch-query-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="buy-batch-query-input"
        placeholder="编码/名称/规格/单位/客户款号/组别/GUID/kcaa字段"
        @keyup.enter="reload"
      />
      <el-button class="buy-batch-toolbar-btn" type="primary" @click="reload">立即查询</el-button>
      <el-button class="buy-batch-toolbar-btn" @click="queryAll">查询全部</el-button>
      <el-button class="buy-batch-toolbar-btn" type="primary" :disabled="!selectedCount" @click="saveSelected">
        保存已选数据
      </el-button>
      <el-button class="buy-batch-toolbar-btn" @click="resetSelection">全部重选</el-button>
      <el-button class="buy-batch-toolbar-btn" :disabled="!history.length" @click="undoLast">撤销上一步</el-button>
      <span class="buy-batch-selected">已选：{{ selectedCount }}</span>
    </section>

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || '暂无可采购物料'" />
        <div v-else class="buy-batch-table-wrap">
          <table class="buy-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>编码</th>
                <th>名称(中文)</th>
                <th>供应名</th>
                <th>所属产品编码</th>
                <th class="col-num">采购量</th>
                <th>采购单位</th>
                <th class="col-num">最新单价(含税)</th>
                <th class="col-num">已采购数量</th>
                <th class="col-num">可采购数量</th>
                <th class="col-num">已入库数量</th>
                <th class="col-num">库存数量</th>
                <th class="col-num">扣数后库存数</th>
                <th>英文名</th>
                <th>规格</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'buy-batch-row--picked': isPicked(row) }">
                <td class="col-action">
                  <el-button
                    size="small"
                    :type="isPicked(row) ? 'success' : 'warning'"
                    class="buy-batch-pick-btn"
                    @click="togglePick(row)"
                  >
                    {{ isPicked(row) ? '已选择' : '选择' }}
                  </el-button>
                </td>
                <td>{{ row.kcaa01 || '-' }}</td>
                <td>{{ row.kcaa02 || '-' }}</td>
                <td>{{ row.gkcaa02 || '-' }}</td>
                <td>{{ row.topKcaa01 || '-' }}</td>
                <td class="col-num">{{ formatNum(row.sbuy) }}</td>
                <td>{{ row.purchaseUnit || row.kcaa25 || '-' }}</td>
                <td class="col-num">{{ hasPrice ? formatNum(row.cgab05) : '-' }}</td>
                <td class="col-num">{{ formatNum(row.buys) }}</td>
                <td class="col-num">{{ formatNum(row.availableQty) }}</td>
                <td class="col-num">{{ formatNum(row.buysum) }}</td>
                <td class="col-num">{{ formatNum(row.stockQty) }}</td>
                <td class="col-num">{{ formatNum(row.stockAfterDeduct) }}</td>
                <td>{{ row.kcaa02_en || '-' }}</td>
                <td>{{ row.kcaa03 || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="buy-batch-pagination">
          <span class="buy-batch-pagination-info">
            第{{ page }}页/共{{ totalPages }}页，共{{ total }}条记录
          </span>
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
  BUY_BATCH_MSG_ACCEPTED,
  BUY_BATCH_MSG_APPLY,
  BUY_BATCH_MSG_REJECTED,
  BUY_BATCH_REJECT_PI_MISMATCH,
  BUY_BATCH_REJECT_SUPPLIER_MISMATCH,
  readBuyBatchContext,
  writeBuyBatchResult,
} from '@/utils/buyOrderBatchAdd'

defineOptions({ name: 'supply-chain-daily-purchase-order-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const piNo = ref('')
const supplierCode = ref('')
const hasPrice = ref(false)
const keyword = ref('')
const loading = ref(false)
const errorMsg = ref('')
const rows = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const history = ref([])

const selectedCount = computed(() => pickedKeys.value.size)
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(pageSize.value || 10))))

function formatNum(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function isPicked(row) {
  return pickedKeys.value.has(row?.lineKey)
}

function togglePick(row) {
  const key = String(row?.lineKey ?? '').trim()
  if (!key) return
  const next = new Set(pickedKeys.value)
  const nextRows = new Map(pickedRows.value)
  const wasPicked = next.has(key)
  if (wasPicked) {
    next.delete(key)
    nextRows.delete(key)
  } else {
    next.add(key)
    nextRows.set(key, row)
  }
  history.value.push({ key, row, wasPicked })
  pickedKeys.value = next
  pickedRows.value = nextRows
}

function resetSelection() {
  pickedKeys.value = new Set()
  pickedRows.value = new Map()
  history.value = []
}

function undoLast() {
  const last = history.value.pop()
  if (!last) return
  const next = new Set(pickedKeys.value)
  const nextRows = new Map(pickedRows.value)
  if (last.wasPicked) {
    next.add(last.key)
    nextRows.set(last.key, last.row)
  } else {
    next.delete(last.key)
    nextRows.delete(last.key)
  }
  pickedKeys.value = next
  pickedRows.value = nextRows
}

function buildLine(row) {
  const out = {
    piNo: piNo.value,
    bomSystemCode: row.bomSystemCode || row.systemcode || row.GUID,
    systemcode: row.systemcode || row.bomSystemCode || row.GUID,
    quantity: Number(row.availableQty ?? 0),
    maxQty: Number(row.maxQty ?? 0),
    taxIncludedPrice: hasPrice.value ? Number(row.cgab05 ?? 0) : 0,
    taxExcludedPrice: hasPrice.value ? Number(row.cgab04 ?? 0) : 0,
    taxIncludedAmount: hasPrice.value ? Number(row.availableQty ?? 0) * Number(row.cgab05 ?? 0) : 0,
    taxExcludedAmount: hasPrice.value ? Number(row.availableQty ?? 0) * Number(row.cgab04 ?? 0) : 0,
    tax: hasPrice.value ? Number(row.tax ?? 0) : 0,
    gkcaa02: row.gkcaa02 || '',
    kcaa02En: row.kcaa02_en || '',
    kcaa02_en: row.kcaa02_en || '',
    location: row.location || '',
    salePrice: row.sale_price,
    sale_price: row.sale_price,
    costPrice: row.cost_price,
    cost_price: row.cost_price,
    Customer_Name: row.Customer_Name,
    Customer_supply: row.Customer_supply,
    remark: row.remark,
    kpname: row.kpname,
    content: row.content,
    version: 100,
    referenceNo: piNo.value,
  }
  for (let i = 1; i <= 35; i += 1) {
    const col = `kcaa${String(i).padStart(2, '0')}`
    out[col] = row[col]
  }
  return out
}

function saveSelected() {
  const lines = Array.from(pickedRows.value.values()).map(buildLine)
  if (!lines.length) {
    ElMessage.warning('请先选择物料')
    return
  }
  const sid = sessionId.value
  const payload = {
    sessionId: sid,
    openedPiNo: piNo.value,
    openedSupplierCode: supplierCode.value,
    lines,
  }
  writeBuyBatchResult(sid, payload)

  const opener = window.opener
  if (!opener || opener.closed) {
    ElMessage.error('请从采购订单页面重新打开批量添加')
    return
  }
  const origin = window.location.origin
  let settled = false
  let timeoutId = null

  function cleanup() {
    settled = true
    window.removeEventListener('message', onReply)
    clearTimeout(timeoutId)
  }

  function onReply(event) {
    if (settled || event.origin !== origin) return
    const data = event.data
    if (!data || data.sessionId !== sid) return
    if (data.type === BUY_BATCH_MSG_ACCEPTED) {
      cleanup()
      ElMessage.success(`已保存 ${Number(data.lineCount ?? lines.length)} 条选材`)
      setTimeout(() => window.close(), 300)
      return
    }
    if (data.type === BUY_BATCH_MSG_REJECTED) {
      cleanup()
      if (data.reason === BUY_BATCH_REJECT_PI_MISMATCH) ElMessage.warning('关联 PI 已变更，请重新打开批量添加')
      else if (data.reason === BUY_BATCH_REJECT_SUPPLIER_MISMATCH) ElMessage.warning('供应商已变更，请重新打开批量添加')
      else ElMessage.warning('保存失败，请重试')
    }
  }

  window.addEventListener('message', onReply)
  timeoutId = setTimeout(() => {
    if (settled) return
    cleanup()
    ElMessage.error('父页面无响应，请确认采购订单页面仍打开后重试')
  }, 3000)

  opener.postMessage(
    {
      type: BUY_BATCH_MSG_APPLY,
      sessionId: sid,
      openedPiNo: piNo.value,
      openedSupplierCode: supplierCode.value,
      lines,
    },
    origin,
  )
}

async function loadRows() {
  if (!piNo.value) {
    ElMessage.error('缺少 PI 号')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await axios.get('/api/buy-order/batch-add-lines', {
      params: {
        piNo: piNo.value,
        supplierCode: supplierCode.value,
        keyword: keyword.value,
        page: page.value,
        pageSize: pageSize.value,
      },
    })
    const body = res.data ?? {}
    if (body.code !== 200) throw new Error(body.msg || '读取批量添加明细失败')
    rows.value = Array.isArray(body.data?.list) ? body.data.list : []
    total.value = Number(body.data?.total ?? rows.value.length)
    page.value = Number(body.data?.page ?? page.value) || 1
    pageSize.value = Number(body.data?.pageSize ?? pageSize.value) || 10
    if (!rows.value.length && total.value === 0) errorMsg.value = '该 PI 下暂无可采购物料'
  } catch (err) {
    rows.value = []
    errorMsg.value = err?.response?.data?.msg || err?.message || '读取批量添加明细失败'
    ElMessage.error(errorMsg.value)
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
  page.value = 1
  loadRows()
}

function onPageSizeChange() {
  pageSize.value = Number(pageSize.value) || 10
  page.value = 1
  loadRows()
}

function initFromContext() {
  const sid = sessionId.value
  if (!sid) {
    ElMessage.error('缺少会话参数，无法打开批量添加')
    return
  }
  const ctx = readBuyBatchContext(sid)
  if (!ctx) {
    ElMessage.error('批量添加会话已失效，请从采购订单页面重新打开')
    return
  }
  piNo.value = String(ctx.piNo ?? route.query?.piNo ?? '').trim()
  supplierCode.value = String(ctx.supplierCode ?? '').trim()
  hasPrice.value = ctx.hasPrice !== false
}

onMounted(async () => {
  initFromContext()
  if (piNo.value) await loadRows()
})
</script>

<style scoped>
.buy-batch-window {
  min-height: 100vh;
  padding: 12px 14px 22px;
  background: #f4f6f8;
  color: #111827;
}

.buy-batch-header,
.buy-batch-toolbar,
.buy-batch-table-wrap {
  background: #fff;
  border: 1px solid #d8dde3;
  border-radius: 4px;
}

.buy-batch-header {
  margin-bottom: 10px;
  padding: 10px 12px;
}

.buy-batch-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.buy-batch-subtitle {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.buy-batch-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
  padding: 10px 12px;
}

.buy-batch-query-label {
  font-size: 13px;
  color: #606266;
  white-space: nowrap;
}

.buy-batch-query-input {
  width: 420px;
  max-width: 42vw;
}

.buy-batch-toolbar-btn {
  min-width: 94px;
  height: 32px;
  border-radius: 3px;
}

.buy-batch-selected {
  margin-left: 4px;
  font-size: 13px;
  font-weight: 600;
}

.buy-batch-table-wrap {
  overflow: auto;
  box-shadow: 0 1px 2px rgb(17 24 39 / 5%);
}

.buy-batch-table {
  min-width: 1540px;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.buy-batch-table th,
.buy-batch-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #e3e7ec;
  border-right: 1px solid #e8ebef;
  white-space: nowrap;
}

.buy-batch-table th {
  background: #f8fafc;
  color: #374151;
  font-weight: 600;
  text-align: left;
}

.buy-batch-table tbody tr:hover {
  background: #f7fbff;
}

.buy-batch-row--picked {
  background: #f0fdf4;
}

.col-action {
  width: 92px;
  text-align: center;
}

.col-num {
  text-align: right;
}

.buy-batch-pick-btn {
  min-width: 68px;
}

.buy-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #d8dde3;
  border-radius: 4px;
}

.buy-batch-pagination-info {
  font-size: 13px;
  color: #606266;
}
</style>
