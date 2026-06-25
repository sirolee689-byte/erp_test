<template>
  <div class="stock-out-ai-batch-window">
    <header class="stock-out-ai-batch-header">
      <h1 class="stock-out-ai-batch-title">外协领料批量添加</h1>
      <p class="stock-out-ai-batch-subtitle">
        外协单号：{{ sourceOrderNo || '-' }}　外协商：{{ supplierCode }} {{ supplierName }}　PI：{{ piNo || '-' }}　仓库：{{ warehouseName || warehouseCode || '-' }}
      </p>
    </header>

    <section class="stock-out-ai-batch-toolbar">
      <span class="stock-out-ai-batch-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-out-ai-batch-query-input"
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
      <span class="stock-out-ai-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert v-if="piCostHint" class="stock-out-ai-batch-close-hint" :title="piCostHint" type="info" show-icon :closable="true" />
    <el-alert v-if="closeHint" class="stock-out-ai-batch-close-hint" :title="closeHint" type="success" show-icon :closable="false" />

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyText" />
        <div v-else class="stock-out-ai-batch-table-wrap">
          <table class="stock-out-ai-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>需要外协材料编码</th>
                <th>材料名称</th>
                <th>规格</th>
                <th>颜色</th>
                <th>使用单位</th>
                <th class="col-num">库存账存数</th>
                <th class="col-num">物料未审出库数</th>
                <th class="col-num">实际库存</th>
                <th class="col-num col-issueable">还需出库数量</th>
                <th>PO/PI</th>
                <th>备注</th>
                <th class="col-num">外协数量</th>
                <th>未审出库情况</th>
                <th class="col-num">实际出库数量</th>
                <th>是否存在转换数据</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-out-ai-batch-row--picked': isPicked(row) }">
                <td class="col-action">
                  <el-button size="small" :type="buttonType(row)" :class="{ 'stock-out-ai-picked-btn': isPicked(row) }" :disabled="!row.selectable && !isPicked(row)" @click="togglePick(row)">
                    {{ buttonLabel(row) }}
                  </el-button>
                </td>
                <td class="col-material-code">
                  <div class="assist-issue-material-block">
                    <div class="assist-issue-material-block__code">{{ row.kcaa01 || '-' }}</div>
                    <div class="assist-issue-material-block__meta assist-issue-material-block__outsource">外发对应：{{ row.outsourceKcaa01 || '-' }}</div>
                    <div class="assist-issue-material-block__meta">外协数量：{{ formatQtyDisplay(row.assistOrderQty) }}</div>
                    <div class="assist-issue-material-block__meta">单用量：{{ formatUnit(row.unitUsage) }}</div>
                  </div>
                </td>
                <td>{{ row.kcaa02 || '-' }}</td>
                <td>{{ row.kcaa03 || '-' }}</td>
                <td>{{ row.kcaa11 || '-' }}</td>
                <td>{{ row.kcaa04 || '-' }}</td>
                <td class="col-num col-book">{{ formatNum(row.warehouseBookQty) }}</td>
                <td class="col-num col-pending">{{ formatNum(row.warehousePendingOutQty) }}</td>
                <td class="col-num" :class="actualQtyClass(row)">{{ formatNum(row.warehouseDisplayActualQty ?? row.warehouseActualQty) }}</td>
                <td class="col-num col-issueable">{{ formatQtyDisplay(row.stillNeedQty) }}</td>
                <td>{{ row.reference || '-' }}</td>
                <td>{{ row.Describe || row.info || '-' }}</td>
                <td class="col-num">{{ formatQtyDisplay(row.assistOrderQty) }}</td>
                <td class="col-pending-out">{{ row.pendingOutboundText || '-' }}</td>
                <td class="col-num">{{ formatQtyDisplay(row.sourceApprovedOutQty) }}</td>
                <td>{{ formatConvertText(row.unitConvertText) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="stock-out-ai-batch-pagination">
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
  STOCK_OUT_AI_BATCH_MSG_APPLY,
  STOCK_OUT_AI_BATCH_MSG_ACCEPTED,
  STOCK_OUT_AI_BATCH_MSG_REJECTED,
  readStockOutAssistIssueBatchContext,
  writeStockOutAssistIssueBatchResult,
} from '@/utils/stockOutAssistIssueBatchAdd'

defineOptions({ name: 'inventory-daily-stock-out-assist-issue-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const sourceOrderNo = ref('')
const supplierCode = ref('')
const supplierName = ref('')
const piNo = ref('')
const warehouseCode = ref('')
const warehouseName = ref('')
const excludeOutboundNo = ref('')
const inTax = ref('1')
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
const piCostHint = ref('')
const submitted = ref(false)

const emptyText = '该外协单下暂无可选明细'
const selectedCount = computed(() => pickedKeys.value.size)
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(pageSize.value || 20))))

/** 库存账存数 / 未审出库 / 实际库存：固定三位小数 */
function formatNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return (Math.round(n * 1000) / 1000).toFixed(3)
}

/** 外协数量等：整数不显示 .00 */
function formatQtyDisplay(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const rounded = Math.round(n * 10000) / 10000
  if (Number.isInteger(rounded)) return String(rounded)
  return String(rounded)
}

function formatUnit(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  const rounded = Math.round(n * 1000000) / 1000000
  return String(rounded)
}

function formatConvertText(text) {
  const v = String(text ?? '').trim()
  if (!v || v === '否') return '无转换'
  return v
}

function isPicked(row) {
  return pickedKeys.value.has(String(row.lineKey ?? '').toLowerCase())
}

function buttonLabel(row) {
  if (isPicked(row)) return '已选择'
  return row.selectLabel || '库存不足'
}

function buttonType(row) {
  if (isPicked(row)) return 'info'
  if (!row.selectable) return 'info'
  return 'warning'
}

function actualQtyClass(row) {
  return Number(row?.warehouseActualQty ?? 0) > 0 ? 'col-actual-ok' : 'col-actual-bad'
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
  if (!sourceOrderNo.value || !supplierCode.value || !warehouseCode.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const mergedSelected = [...new Set([...selectedKeysFromParent.value, ...pickedKeys.value])]
    const { data } = await axios.get('/api/stock-out/assist-issue-batch-lines', {
      params: {
        sourceOrderNo: sourceOrderNo.value,
        supplierCode: supplierCode.value,
        warehouseCode: warehouseCode.value,
        piNo: piNo.value || undefined,
        excludeOutboundNo: excludeOutboundNo.value || undefined,
        keyword: keyword.value || undefined,
        page: page.value,
        pageSize: pageSize.value,
        selectedKeys: mergedSelected.join(','),
      },
    })
    rows.value = data?.data?.list ?? []
    total.value = Number(data?.data?.total ?? 0)
    piCostHint.value = String(data?.data?.piCostHint ?? '').trim()
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
  const taxMode = String(inTax.value) === '2' ? '2' : '1'
  return [...pickedRows.value.values()].map((row) => {
    const qty = Number(row.issueableQty ?? 0)
    const stockCap = Number(row.warehouseActualQty ?? row.kcaq031 ?? qty)
    const ex = Number(row.kcaq04 ?? 0)
    const inc = Number(row.kcaq041 ?? 0)
    const tax = taxMode === '2' ? 0 : Number(row.tax ?? 0)
    const kcaq041 = taxMode === '2' ? ex : (inc || Number((ex * (1 + tax)).toFixed(4)))
    const sourceLineCode = String(row.wxak02 ?? row.sourceLineCode ?? '').trim()
    return {
      ...row,
      sourceLineCode,
      kcaq02: sourceLineCode,
      wxak02: sourceLineCode,
      kcaq03: qty,
      kcaq031: stockCap,
      availableQty: qty,
      kcaq04: ex,
      kcaq041,
      tax,
      kcaq05: Number((qty * ex).toFixed(2)),
      kcaq051: Number((qty * kcaq041).toFixed(2)),
      reference: row.reference,
      Describe: row.Describe || row.info || '',
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
      type: STOCK_OUT_AI_BATCH_MSG_APPLY,
      sessionId: sessionId.value,
      openedWarehouseCode: warehouseCode.value,
      openedSourceOrderNo: sourceOrderNo.value,
      openedSupplierCode: supplierCode.value,
      openedPiNo: piNo.value,
      lineCount: lines.length,
      lines,
    }
    writeStockOutAssistIssueBatchResult(sessionId.value, payload)

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin)
      const onReply = (event) => {
        if (event.origin !== window.location.origin) return
        const data = event.data
        if (!data || data.sessionId !== sessionId.value) return
        if (data.type === STOCK_OUT_AI_BATCH_MSG_ACCEPTED) {
          window.removeEventListener('message', onReply)
          onSaveAccepted(data.lineCount ?? lines.length)
        }
        if (data.type === STOCK_OUT_AI_BATCH_MSG_REJECTED) {
          window.removeEventListener('message', onReply)
          ElMessage.warning('父页面未接受数据，请检查外协单/仓库/PI是否已变更')
          saving.value = false
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
  const ctx = readStockOutAssistIssueBatchContext(sessionId.value)
  if (!ctx) {
    errorMsg.value = '会话已失效，请从出库单页面重新打开批量添加'
    return
  }
  sourceOrderNo.value = String(ctx.sourceOrderNo ?? '').trim()
  supplierCode.value = String(ctx.supplierCode ?? '').trim()
  supplierName.value = String(ctx.supplierName ?? '').trim()
  piNo.value = String(ctx.piNo ?? '').trim()
  warehouseCode.value = String(ctx.warehouseCode ?? '').trim()
  warehouseName.value = String(ctx.warehouseName ?? '').trim()
  excludeOutboundNo.value = String(ctx.excludeOutboundNo ?? '').trim()
  inTax.value = String(ctx.inTax ?? '1')
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize) > 0 ? Number(ctx.pageSize) : 20

  const routeWarehouse = String(route.query?.warehouseCode ?? '').trim()
  if (routeWarehouse && warehouseCode.value && routeWarehouse !== warehouseCode.value) {
    ElMessage.error('仓库数据错误，请检查所选仓库')
    setTimeout(() => window.close(), 1200)
    return
  }
  if (!sourceOrderNo.value || !supplierCode.value || !warehouseCode.value) {
    errorMsg.value = '缺少外协单/外协商/仓库信息，请从出库单页面重新打开'
    return
  }
  loadRows()
})
</script>

<style scoped>
.stock-out-ai-batch-window {
  min-height: 100vh;
  padding: 16px 20px 24px;
  background: #f5f7fa;
  box-sizing: border-box;
}
.stock-out-ai-batch-header { margin-bottom: 12px; }
.stock-out-ai-batch-title { margin: 0 0 6px; font-size: 22px; }
.stock-out-ai-batch-subtitle { margin: 0; color: #606266; font-size: 15px; }
.stock-out-ai-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
}
.stock-out-ai-batch-label { color: #606266; }
.stock-out-ai-batch-query-input { width: 320px; }
.stock-out-ai-batch-selected { margin-left: auto; color: #409eff; }
.stock-out-ai-batch-close-hint { margin-bottom: 12px; }
.stock-out-ai-batch-table-wrap { overflow: auto; background: #fff; border-radius: 8px; }
.stock-out-ai-batch-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.stock-out-ai-batch-table th,
.stock-out-ai-batch-table td { border: 1px solid #ebeef5; padding: 8px 10px; white-space: nowrap; }
.stock-out-ai-batch-table th { background: #f5f7fa; font-weight: 600; }
.col-action { width: 90px; text-align: center; }
.col-num { text-align: right; }
.col-material-code { color: #dc2626; min-width: 160px; white-space: normal; vertical-align: top; }
.assist-issue-material-block__code { color: #dc2626; font-weight: 700; font-size: 15px; line-height: 1.4; }
.assist-issue-material-block__meta { color: #606266; font-size: 13px; line-height: 1.45; font-weight: 400; }
.assist-issue-material-block__outsource { color: #0d9488; font-weight: 600; }
.col-book { color: #dc2626; font-weight: 600; }
.col-pending { color: #7e22ce; font-weight: 600; }
.col-pending-out { color: #7e22ce; font-size: 13px; white-space: normal; max-width: 200px; }
.col-actual-ok { color: #2563eb; font-weight: 600; }
.col-actual-bad { color: #dc2626; font-weight: 700; }
.col-issueable { color: #991b1b; font-weight: 700; }
.stock-out-ai-picked-btn { color: #606266; border-color: #c0c4cc; background: #f4f4f5; }
.stock-out-ai-batch-row--picked { background: #f0f9eb; }
.stock-out-ai-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
}
</style>
