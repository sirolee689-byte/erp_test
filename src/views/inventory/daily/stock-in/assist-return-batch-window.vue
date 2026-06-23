<template>
  <div class="stock-return-batch-window">
    <header class="stock-return-batch-header">
      <h1 class="stock-return-batch-title">外协退料批量添加明细</h1>
      <p class="stock-return-batch-subtitle">
        外协单号：{{ sourceOrderNo }}　外协客户：{{ supplierCode }} {{ supplierName }}
      </p>
    </header>

    <section class="stock-return-batch-toolbar">
      <span class="stock-return-batch-query-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-return-batch-query-input"
        placeholder="材料编码 / 名称 / 规格 / PI / 备注"
        @keyup.enter="reload"
      />
      <el-button type="primary" @click="reload">查询</el-button>
      <el-button @click="queryAll">查询全部</el-button>
      <el-button type="primary" :disabled="!selectedCount || saving || submitted" :loading="saving" @click="saveSelected">
        {{ submitted ? '已提交' : '保存已选数据' }}
      </el-button>
      <el-button @click="resetSelection">全部重选</el-button>
      <span class="stock-return-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert
      v-if="closeHint"
      class="stock-return-batch-close-hint"
      :title="closeHint"
      type="success"
      show-icon
      :closable="false"
    />

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!parentRows.length && !loading" :description="errorMsg || '该外协单下暂无成品明细'" />
        <div v-else class="stock-return-batch-table-wrap">
          <table class="stock-return-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>材料编码</th>
                <th>材料名称</th>
                <th>规格</th>
                <th>颜色</th>
                <th>采购币别/汇率</th>
                <th>使用单位</th>
                <th class="col-num col-need">可退数量</th>
                <th v-if="hasPricePermission" class="col-num">RMB单价</th>
                <th v-if="hasPricePermission" class="col-num">RMB单价（含税）</th>
                <th v-if="hasPricePermission" class="col-num">RMB金额</th>
                <th v-if="hasPricePermission" class="col-num">RMB金额（含税）</th>
                <th v-if="hasPricePermission" class="col-num">税点</th>
                <th>PO/PI</th>
                <th>备注</th>
                <th class="col-num">外协数量</th>
                <th>未审入库情况</th>
                <th>未审出库情况</th>
                <th class="col-num">实际入库数量</th>
                <th class="col-num">实际出库数量</th>
                <th>是否存在转换数据</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in parentRows" :key="row.lineKey">
                <tr class="stock-return-batch-row stock-return-batch-row--parent">
                  <td class="col-action">
                    <el-button size="small" disabled>请展开选择</el-button>
                    <el-button size="small" link type="primary" @click="toggleExpand(row)">
                      {{ isExpanded(row) ? '−' : '+' }}
                    </el-button>
                  </td>
                  <td>{{ row.kcaa01 || '-' }}</td>
                  <td>{{ row.kcaa02 || '-' }}</td>
                  <td>{{ row.kcaa03 || '-' }}</td>
                  <td>{{ row.kcaa11 || '-' }}</td>
                  <td>{{ row.currencyDisplay || '-' }}</td>
                  <td>{{ row.kcaa04 || '-' }}</td>
                  <td class="col-num col-need">{{ formatNum(row.tempx) }}</td>
                  <td v-if="hasPricePermission" class="col-num">{{ formatNum(row.kcao04) }}</td>
                  <td v-if="hasPricePermission" class="col-num">{{ formatNum(row.kcao041) }}</td>
                  <td v-if="hasPricePermission" class="col-num">{{ formatNum(row.kcao05) }}</td>
                  <td v-if="hasPricePermission" class="col-num">{{ formatNum(row.kcao051) }}</td>
                  <td v-if="hasPricePermission" class="col-num">{{ formatNum(row.tax) }}</td>
                  <td>{{ row.reference || '-' }}</td>
                  <td>{{ row.info || '-' }}</td>
                  <td class="col-num">{{ formatNum(row.orderQty) }}</td>
                  <td class="col-pending">{{ row.pendingInboundText || '-' }}</td>
                  <td class="col-pending">{{ row.pendingOutboundText || '-' }}</td>
                  <td class="col-num">{{ formatNum(row.actualInboundQty) }}</td>
                  <td class="col-num">{{ formatNum(row.actualOutboundQty) }}</td>
                  <td>{{ row.unitConvertText || '-' }}</td>
                </tr>
                <tr v-if="isExpanded(row)" class="stock-return-batch-row stock-return-batch-row--nested">
                  <td :colspan="parentColSpan" class="stock-return-batch-nested-cell">
                    <div v-if="bomState(row).loading" class="stock-return-batch-bom-loading">正在加载 BOM 配件…</div>
                    <el-alert
                      v-else-if="bomState(row).error"
                      type="warning"
                      :title="bomState(row).error"
                      show-icon
                      :closable="false"
                    />
                    <el-empty v-else-if="!bomState(row).list.length" description="该成品暂无 BOM 配件" />
                    <table v-else class="stock-return-batch-subtable">
                      <thead>
                        <tr>
                          <th class="col-action">操作</th>
                          <th class="col-seq">序号</th>
                          <th>是否客供</th>
                          <th>材料编码</th>
                          <th>材料名称（中文）</th>
                          <th>材料名称（英文）</th>
                          <th>原始单位</th>
                          <th>换算单位</th>
                          <th class="col-num">用量</th>
                          <th class="col-num">报价损耗</th>
                          <th class="col-num">用量合计</th>
                          <th v-if="hasPricePermission" class="col-num">币别单价</th>
                          <th v-if="hasPricePermission" class="col-num">币别含税单价</th>
                          <th v-if="hasPricePermission" class="col-num">成本合计</th>
                          <th>备注</th>
                          <th>材料唯一码</th>
                          <th>币别</th>
                          <th class="col-num">汇率</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr
                          v-for="part in bomState(row).list"
                          :key="part.lineKey"
                          :class="{ 'stock-return-batch-row--picked': isPicked(part) }"
                        >
                          <td class="col-action">
                            <el-button
                              size="small"
                              :type="buttonType(part)"
                              :disabled="!part.selectable && !isPicked(part)"
                              @click="togglePick(part)"
                            >
                              {{ buttonLabel(part) }}
                            </el-button>
                          </td>
                          <td class="col-seq">{{ part.seq }}</td>
                          <td>{{ part.customerSupplyLabel || '-' }}</td>
                          <td>{{ part.kcaa01 || '-' }}</td>
                          <td>{{ part.kcaa02 || '-' }}</td>
                          <td>{{ part.kcaa02_en || '-' }}</td>
                          <td>{{ part.kcaa04 || '-' }}</td>
                          <td>{{ part.kcaa29 || '-' }}</td>
                          <td class="col-num">{{ formatNum(part.usageQty) }}</td>
                          <td class="col-num">{{ formatPercent(part.lossRate) }}</td>
                          <td class="col-num">{{ formatNum(part.usageTotal) }}</td>
                          <td v-if="hasPricePermission" class="col-num">{{ formatNum(part.unitPrice) }}</td>
                          <td v-if="hasPricePermission" class="col-num">{{ formatNum(part.unitPriceTax) }}</td>
                          <td v-if="hasPricePermission" class="col-num">{{ formatNum(part.costTotal) }}</td>
                          <td>{{ part.remark || '-' }}</td>
                          <td>{{ part.partGuid || part.systemcode || '-' }}</td>
                          <td>{{ part.currencyName || '-' }}</td>
                          <td class="col-num">{{ formatNum(part.bomRate) }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="stock-return-batch-pagination">
          <span>第{{ page }}页，共{{ totalPages }}页，共{{ total }}条</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[10, 20, 50, 100]"
            :total="total"
            layout="prev, pager, next, sizes, jumper"
            small
            background
            @current-change="loadParentRows"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import {
  STOCK_BATCH_MSG_APPLY,
  STOCK_BATCH_MSG_ACCEPTED,
  STOCK_BATCH_MSG_REJECTED,
  STOCK_BATCH_REJECT_SOURCE_MISMATCH,
  STOCK_BATCH_REJECT_SUPPLIER_MISMATCH,
  readStockBatchContext,
  writeStockBatchResult,
} from '@/utils/stockInBatchAdd'

defineOptions({ name: 'inventory-daily-stock-in-assist-return-batch-window' })

const MENU_PATH = 'inventory/daily/stock-in'
const permissionModel = ref(getPermissionModelFromStorage())
const hasPricePermission = computed(() => hasPageAction(permissionModel.value, MENU_PATH, 'price'))
const parentColSpan = computed(() => (hasPricePermission.value ? 21 : 16))

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const sourceOrderNo = ref('')
const supplierCode = ref('')
const supplierName = ref('')
const excludeReceiptNo = ref('')
const selectedKeysFromParent = ref([])

const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const parentRows = ref([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const expandedKeys = ref(new Set())
const bomPartsByProduct = reactive({})
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const closeHint = ref('')
const submitted = ref(false)

const selectedCount = computed(() => pickedKeys.value.size)
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(pageSize.value || 20))))

function formatNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 4 })
}

function formatPercent(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `${(n * 100).toLocaleString('zh-CN', { maximumFractionDigits: 4 })}%`
}

function productKey(row) {
  return String(row?.productKcaa01 ?? row?.pm ?? row?.kcaa01 ?? '').trim()
}

function isExpanded(row) {
  return expandedKeys.value.has(productKey(row))
}

function bomState(row) {
  const key = productKey(row)
  return bomPartsByProduct[key] ?? { loading: false, list: [], error: '' }
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

async function loadBomParts(row) {
  const key = productKey(row)
  if (!key) return
  bomPartsByProduct[key] = { loading: true, list: [], error: '' }
  try {
    const mergedSelected = [...new Set([...selectedKeysFromParent.value, ...pickedKeys.value])]
    const { data } = await axios.get('/api/stock-in/assist-return-bom-parts', {
      params: {
        sourceOrderNo: sourceOrderNo.value,
        productKcaa01: key,
        selectedKeys: mergedSelected.join(','),
      },
    })
    const list = data?.data?.list ?? []
    if (data?.data?.bomMissing) {
      bomPartsByProduct[key] = { loading: false, list: [], error: data?.msg || '未找到该成品的主 BOM 资料' }
      return
    }
    bomPartsByProduct[key] = { loading: false, list, error: '' }
  } catch (err) {
    bomPartsByProduct[key] = {
      loading: false,
      list: [],
      error: err.response?.data?.msg || err.message || '加载 BOM 配件失败',
    }
  }
}

async function toggleExpand(row) {
  const key = productKey(row)
  if (!key) return
  if (expandedKeys.value.has(key)) {
    expandedKeys.value.delete(key)
    expandedKeys.value = new Set(expandedKeys.value)
    return
  }
  expandedKeys.value.add(key)
  expandedKeys.value = new Set(expandedKeys.value)
  if (!bomPartsByProduct[key]?.list?.length && !bomPartsByProduct[key]?.loading) {
    await loadBomParts(row)
  }
}

async function loadParentRows() {
  if (!sourceOrderNo.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const { data } = await axios.get('/api/stock-in/assist-return-batch-lines', {
      params: {
        sourceOrderNo: sourceOrderNo.value,
        supplierCode: supplierCode.value,
        excludeReceiptNo: excludeReceiptNo.value,
        keyword: keyword.value,
        page: page.value,
        pageSize: pageSize.value,
      },
    })
    parentRows.value = data?.data?.list ?? []
    total.value = Number(data?.data?.total ?? 0)
  } catch (err) {
    errorMsg.value = err.response?.data?.msg || err.message || '加载失败'
    parentRows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  loadParentRows()
}

function queryAll() {
  keyword.value = ''
  reload()
}

function onPageSizeChange() {
  page.value = 1
  loadParentRows()
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
  if (!pickedRows.value.size) return ElMessage.warning('请先选择 BOM 配件')

  const lines = [...pickedRows.value.values()]
  const sid = sessionId.value
  const payload = JSON.parse(JSON.stringify({
    type: STOCK_BATCH_MSG_APPLY,
    sessionId: sid,
    batchType: 'assist-return',
    openedSourceOrderNo: sourceOrderNo.value,
    openedSupplierCode: supplierCode.value,
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
        ElMessage.warning('外协单号已变更，请重新打开批量添加')
      } else if (data.reason === STOCK_BATCH_REJECT_SUPPLIER_MISMATCH) {
        ElMessage.warning('外协客户已变更，请重新打开批量添加')
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
  sourceOrderNo.value = String(ctx.sourceOrderNo ?? route.query?.sourceOrderNo ?? '').trim()
  supplierCode.value = String(ctx.supplierCode ?? '').trim()
  supplierName.value = String(ctx.supplierName ?? '').trim()
  excludeReceiptNo.value = String(ctx.excludeReceiptNo ?? '').trim()
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize) > 0 ? Number(ctx.pageSize) : 20
  loadParentRows()
})
</script>

<style scoped>
.stock-return-batch-window {
  min-height: 100vh;
  padding: 16px 20px 24px;
  background: #f5f7fa;
  box-sizing: border-box;
}
.stock-return-batch-header {
  margin-bottom: 12px;
}
.stock-return-batch-title {
  margin: 0 0 6px;
  font-size: 22px;
}
.stock-return-batch-subtitle {
  margin: 0;
  color: #606266;
}
.stock-return-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
}
.stock-return-batch-query-input {
  width: 280px;
}
.stock-return-batch-selected {
  margin-left: auto;
  color: #409eff;
  font-weight: 600;
}
.stock-return-batch-close-hint {
  margin-bottom: 12px;
}
.stock-return-batch-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 220px);
  background: #fff;
  border-radius: 8px;
}
.stock-return-batch-table,
.stock-return-batch-subtable {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.stock-return-batch-table th,
.stock-return-batch-table td,
.stock-return-batch-subtable th,
.stock-return-batch-subtable td {
  border: 1px solid #ebeef5;
  padding: 8px 10px;
  white-space: nowrap;
  vertical-align: middle;
}
.stock-return-batch-table th,
.stock-return-batch-subtable th {
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
.stock-return-batch-table th.col-action,
.stock-return-batch-subtable th.col-action {
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
.col-pending {
  max-width: 220px;
  white-space: normal;
  word-break: break-all;
}
.stock-return-batch-row--picked {
  background: #f0f9eb;
}
.stock-return-batch-nested-cell {
  padding: 12px;
  background: #fafafa;
}
.stock-return-batch-bom-loading {
  padding: 16px;
  color: #909399;
}
.stock-return-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
}
</style>
