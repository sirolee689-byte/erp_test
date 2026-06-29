<template>
  <div class="stock-out-fg-batch-window">
    <header class="stock-out-fg-batch-header">
      <h1 class="stock-out-fg-batch-title">成品出库批量添加</h1>
      <p class="stock-out-fg-batch-subtitle">
        订单单号：{{ sourceOrderNo || '-' }}　客户：{{ customerCode }} {{ customerName }}　仓库：{{ warehouseName || warehouseCode || '-' }}
      </p>
    </header>

    <section class="stock-out-fg-batch-toolbar">
      <span class="stock-out-fg-batch-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-out-fg-batch-query-input"
        placeholder="材料编码 / 名称 / 规格 / 颜色 / PO/PI"
        @keyup.enter="reload"
      />
      <el-button type="primary" @click="reload">查询</el-button>
      <el-button @click="queryAll">查询全部</el-button>
      <el-button type="primary" :disabled="!selectedCount || saving || submitted" :loading="saving" @click="saveSelected">
        {{ submitted ? '已提交' : '保存已选数据' }}
      </el-button>
      <el-button @click="resetSelection">全部重选</el-button>
      <el-button @click="closeWindow">关闭</el-button>
      <span class="stock-out-fg-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert
      v-if="closeHint"
      class="stock-out-fg-batch-close-hint"
      :title="closeHint"
      type="success"
      show-icon
      :closable="false"
    />

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyText" />
        <div v-else class="stock-out-fg-batch-table-wrap">
          <table class="stock-out-fg-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>材料编码</th>
                <th>材料名称</th>
                <th>规格</th>
                <th>颜色</th>
                <th>销售币别</th>
                <th>单位</th>
                <th class="col-num">库存数</th>
                <th class="col-num col-shippable">可出货数量</th>
                <th>PO/PI</th>
                <th>备注</th>
                <th class="col-num">销售数量</th>
                <th>未审出库情况</th>
                <th class="col-num">已审出库数量</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-out-fg-batch-row--picked': isPicked(row) }">
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
                <td class="col-num">{{ formatNum(row.stockQty) }}</td>
                <td class="col-num col-shippable">{{ formatNum(row.shippableQty) }}</td>
                <td>{{ row.reference || '-' }}</td>
                <td>{{ row.info || row.remark || '-' }}</td>
                <td class="col-num">{{ formatNum(row.orderQty) }}</td>
                <td>{{ row.pendingOutboundText || '-' }}</td>
                <td class="col-num">{{ formatNum(row.approvedOutQty) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="stock-out-fg-batch-pagination">
          <span>第{{ page }}页，共{{ totalPages }}页，共{{ total }}条</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100, 200]"
            :total="total"
            layout="total, sizes, prev, pager, next, jumper"
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
  STOCK_OUT_FG_BATCH_MSG_APPLY,
  STOCK_OUT_FG_BATCH_MSG_ACCEPTED,
  STOCK_OUT_FG_BATCH_MSG_REJECTED,
  deriveFinishedGoodsCustomsModel,
  readStockOutFinishedGoodsBatchContext,
  writeStockOutFinishedGoodsBatchResult,
} from '@/utils/stockOutFinishedGoodsBatchAdd'

defineOptions({ name: 'inventory-daily-stock-out-finished-goods-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const sourceOrderNo = ref('')
const customerCode = ref('')
const customerName = ref('')
const sourceSystemcodeId = ref('')
const warehouseCode = ref('')
const warehouseName = ref('')
const excludeOutboundNo = ref('')
const inTax = ref('2')
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

const emptyText = '该销售订单下暂无可选明细'
const selectedCount = computed(() => pickedKeys.value.size)
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(pageSize.value || 20))))

function formatNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const rounded = Math.round(n * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/\.?0+$/, (m) => (m === '.' ? '' : m))
}

function isPicked(row) {
  return pickedKeys.value.has(String(row.lineKey ?? '').toLowerCase())
}

function buttonLabel(row) {
  if (isPicked(row)) return '已选择'
  return row.selectLabel || '不可选'
}

function buttonType(row) {
  if (isPicked(row)) return 'success'
  if (!row.selectable) return 'info'
  return 'warning'
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
  if (!sourceOrderNo.value || !customerCode.value || !sourceSystemcodeId.value || !warehouseCode.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const mergedSelected = [...new Set([...selectedKeysFromParent.value, ...pickedKeys.value])]
    const { data } = await axios.get('/api/stock-out/finished-goods-batch-lines', {
      params: {
        sourceOrderNo: sourceOrderNo.value,
        customerCode: customerCode.value,
        sourceSystemcodeId: sourceSystemcodeId.value,
        warehouseCode: warehouseCode.value,
        excludeOutboundNo: excludeOutboundNo.value || undefined,
        keyword: keyword.value || undefined,
        page: page.value,
        pageSize: pageSize.value,
        selectedKeys: mergedSelected.join(','),
      },
    })
    rows.value = data?.data?.list ?? []
    total.value = Number(data?.data?.total ?? 0)
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err.message || '加载失败'
    rows.value = []
    total.value = 0
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

function closeWindow() {
  window.close()
}

function buildLinesForParent() {
  // 成品出库批量添加：单价/金额/报关单价留空待手填，税点固定 0
  return [...pickedRows.value.values()].map((row) => {
    const qty = Number(row.shippableQty ?? row.tempx ?? 0)
    return {
      ...row,
      sourceLineCode: row.sourceLineCode || row.lineKey,
      kcaq02: row.sourceLineCode || row.lineKey,
      kcaq03: qty,
      kcaq031: qty,
      availableQty: qty,
      kcaq04: null,
      kcaq041: null,
      kcaq05: null,
      kcaq051: null,
      kcaq08: null,
      tax: 0,
      reference: '',
      Describe: deriveFinishedGoodsCustomsModel(row.kcaa01 || row.materialCode),
    }
  })
}

function onSaveAccepted(lineCount) {
  submitted.value = true
  closeHint.value = `已保存 ${lineCount} 条明细，正在关闭窗口...`
  ElMessage.success(closeHint.value)
  setTimeout(() => {
    window.close()
    setTimeout(() => {
      closeHint.value = '明细已带回出库单。如果浏览器未自动关闭，请直接关闭本窗口。'
    }, 300)
  }, 300)
}

async function saveSelected() {
  if (submitted.value || saving.value) return
  if (!pickedRows.value.size) return ElMessage.warning('请先选择明细')

  saving.value = true
  try {
    const lines = buildLinesForParent()
    const payload = {
      type: STOCK_OUT_FG_BATCH_MSG_APPLY,
      sessionId: sessionId.value,
      openedWarehouseCode: warehouseCode.value,
      openedSourceOrderNo: sourceOrderNo.value,
      openedCustomerCode: customerCode.value,
      openedSourceSystemcodeId: sourceSystemcodeId.value,
      lineCount: lines.length,
      lines,
    }
    writeStockOutFinishedGoodsBatchResult(sessionId.value, payload)

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin)
      const onReply = (event) => {
        if (event.origin !== window.location.origin) return
        const data = event.data
        if (!data || data.sessionId !== sessionId.value) return
        if (data.type === STOCK_OUT_FG_BATCH_MSG_ACCEPTED) {
          window.removeEventListener('message', onReply)
          onSaveAccepted(data.lineCount ?? lines.length)
        }
        if (data.type === STOCK_OUT_FG_BATCH_MSG_REJECTED) {
          window.removeEventListener('message', onReply)
          saving.value = false
          ElMessage.warning('父页面拒绝了本次带回，请检查仓库/订单/客户是否已变更')
        }
      }
      window.addEventListener('message', onReply)
      setTimeout(() => {
        window.removeEventListener('message', onReply)
        if (!submitted.value) onSaveAccepted(lines.length)
      }, 800)
      return
    }
    onSaveAccepted(lines.length)
  } finally {
    if (!submitted.value) saving.value = false
  }
}

onMounted(() => {
  const ctx = readStockOutFinishedGoodsBatchContext(sessionId.value)
  if (!ctx) {
    errorMsg.value = '会话已失效，请从出库单页面重新打开批量添加'
    return
  }
  sourceOrderNo.value = String(ctx.sourceOrderNo ?? '').trim()
  customerCode.value = String(ctx.customerCode ?? '').trim()
  customerName.value = String(ctx.customerName ?? '').trim()
  sourceSystemcodeId.value = String(ctx.sourceSystemcodeId ?? '').trim()
  warehouseCode.value = String(ctx.warehouseCode ?? '').trim()
  warehouseName.value = String(ctx.warehouseName ?? '').trim()
  excludeOutboundNo.value = String(ctx.excludeOutboundNo ?? '').trim()
  inTax.value = String(ctx.inTax ?? '2')
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize) > 0 ? Number(ctx.pageSize) : 20

  const routeWarehouse = String(route.query?.warehouseCode ?? '').trim()
  if (routeWarehouse && warehouseCode.value && routeWarehouse !== warehouseCode.value) {
    ElMessage.error('仓库数据错误，请检查所选仓库')
    setTimeout(() => window.close(), 1200)
    return
  }
  if (!sourceOrderNo.value || !customerCode.value || !sourceSystemcodeId.value || !warehouseCode.value) {
    errorMsg.value = '缺少订单/客户/仓库信息，请从出库单页面重新打开'
    return
  }
  loadRows()
})
</script>

<style scoped>
.stock-out-fg-batch-window {
  min-height: 100vh;
  padding: 16px 20px 24px;
  background: #f5f7fa;
  box-sizing: border-box;
}
.stock-out-fg-batch-header {
  margin-bottom: 12px;
}
.stock-out-fg-batch-title {
  margin: 0 0 6px;
  font-size: 22px;
}
.stock-out-fg-batch-subtitle {
  margin: 0;
  color: #606266;
  font-size: 15px;
}
.stock-out-fg-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
}
.stock-out-fg-batch-label {
  color: #606266;
}
.stock-out-fg-batch-query-input {
  width: 320px;
}
.stock-out-fg-batch-selected {
  margin-left: auto;
  color: #409eff;
  font-weight: 600;
}
.stock-out-fg-batch-close-hint {
  margin-bottom: 12px;
}
.stock-out-fg-batch-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 240px);
  background: #fff;
  border-radius: 8px;
}
.stock-out-fg-batch-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.stock-out-fg-batch-table th,
.stock-out-fg-batch-table td {
  border: 1px solid #ebeef5;
  padding: 8px 10px;
  white-space: nowrap;
  vertical-align: middle;
}
.stock-out-fg-batch-table th {
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
.stock-out-fg-batch-table th.col-action {
  background: #f5f7fa;
  z-index: 3;
}
.col-num {
  text-align: right;
}
.col-shippable,
.stock-out-fg-batch-table th.col-shippable {
  color: #f56c6c;
  font-weight: 600;
}
.stock-out-fg-batch-row--picked {
  background: #f0f9eb;
}
.stock-out-fg-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
}
</style>
