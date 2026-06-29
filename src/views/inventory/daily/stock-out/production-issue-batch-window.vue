<template>
  <div class="stock-out-pi-batch-window">
    <header class="stock-out-pi-batch-header">
      <h1 class="stock-out-pi-batch-title">{{ batchWindowTitle }}</h1>
      <p class="stock-out-pi-batch-subtitle">
        派工单号：{{ sourceOrderNo || '-' }}　生产车间：{{ workshopCode }} {{ workshopName }}　PI：{{ piNo || '-' }}　仓库：{{ warehouseName || warehouseCode || '-' }}
        <span v-if="batchMode === 'cutting'" class="stock-out-pi-batch-mode-tag">（开料部模式）</span>
      </p>
    </header>

    <section class="stock-out-pi-batch-toolbar">
      <span class="stock-out-pi-batch-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-out-pi-batch-query-input"
        placeholder="材料编码（输入即筛选）"
      />
      <el-button type="primary" :loading="loading" @click="refreshAllRows">刷新数据</el-button>
      <el-button @click="queryAll">显示全部</el-button>
      <el-button type="primary" :disabled="!selectedCount || saving || submitted" :loading="saving" @click="saveSelected">
        {{ submitted ? '已提交' : '保存已选数据' }}
      </el-button>
      <el-button @click="resetSelection">全部重选</el-button>
      <el-button @click="closeWindow">关闭</el-button>
      <span class="stock-out-pi-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert v-if="piCostHint" class="stock-out-pi-batch-close-hint" :title="piCostHint" type="info" show-icon :closable="true" />
    <el-alert v-if="closeHint" class="stock-out-pi-batch-close-hint" :title="closeHint" type="success" show-icon :closable="false" />

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!loading && !allRowsCache.length" :description="errorMsg || emptyText" />
        <el-empty v-else-if="!loading && !rows.length" description="没有匹配的材料编码" />
        <div v-else class="stock-out-pi-batch-table-wrap">
          <table class="stock-out-pi-batch-table">
            <colgroup>
              <col class="col-action" />
              <col class="col-dispatch-source" />
              <col class="col-material-code" />
              <col class="col-material-name" />
              <col class="col-material-spec" />
              <col class="col-color" />
              <col class="col-unit" />
              <col class="col-num" />
              <col class="col-num" />
              <col class="col-num" />
              <col class="col-num col-issueable" />
              <col class="col-num" />
              <col class="col-pending-out" />
            </colgroup>
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th class="col-dispatch-source">{{ batchMode === 'cutting' ? '裁片父级' : '货品/派工对应' }}</th>
                <th class="col-material-code">需要领料材料编码</th>
                <th class="col-material-name">材料名称</th>
                <th class="col-material-spec">规格</th>
                <th class="col-color">颜色</th>
                <th class="col-unit">单位</th>
                <th class="col-num">库存账存数</th>
                <th class="col-num">物料未审出库数</th>
                <th class="col-num">实际库存</th>
                <th class="col-num col-issueable">还需出库数量</th>
                <th class="col-num">需出库数量</th>
                <th class="col-pending-out">未审出库情况</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-out-pi-batch-row--picked': isPicked(row) }">
                <td class="col-action">
                  <el-button size="small" :type="buttonType(row)" :class="{ 'stock-out-pi-picked-btn': isPicked(row) }" :disabled="!row.selectable && !isPicked(row)" @click="togglePick(row)">
                    {{ buttonLabel(row) }}
                  </el-button>
                </td>
                <td class="col-dispatch-source">
                  <div v-if="batchMode === 'cutting'" class="dispatch-source-block">
                    <div>直接父编码：{{ row.t_kcaa01 || '-' }}</div>
                    <div>顶层父编码：{{ row.top_kcaa01 || '-' }}</div>
                  </div>
                  <div v-else class="dispatch-source-block">
                    <div>对应货品编码：{{ row.dispatchKcaa01 || '-' }}</div>
                    <div>派工数量：{{ formatOutboundQtyDisplay(row.dispatchQty) }}</div>
                    <div>PI号：{{ row.reference || piNo || '-' }}</div>
                  </div>
                </td>
                <td class="col-material-code"><div class="pi-batch-cell-text">{{ row.kcaa01 || '-' }}</div></td>
                <td class="col-material-name"><div class="pi-batch-cell-text">{{ row.kcaa02 || '-' }}</div></td>
                <td class="col-material-spec"><div class="pi-batch-cell-text">{{ row.kcaa03 || '-' }}</div></td>
                <td class="col-color">{{ row.kcaa11 || '-' }}</td>
                <td class="col-unit">{{ row.kcaa04 || '-' }}</td>
                <td class="col-num col-book">{{ formatNum(row.warehouseBookQty) }}</td>
                <td class="col-num col-pending">{{ formatNum(row.warehousePendingOutQty) }}</td>
                <td class="col-num" :class="actualQtyClass(row)">{{ formatNum(row.warehouseDisplayActualQty ?? row.warehouseActualQty) }}</td>
                <td class="col-num col-issueable">{{ formatOutboundQtyDisplay(row.stillNeedQty) }}</td>
                <td class="col-num">{{ formatOutboundQtyDisplay(row.sourceDemandQty) }}</td>
                <td class="col-pending-out">
                  <template v-if="pendingOutboundDisplay(row.pendingOutboundText)">
                    <div class="pending-out-line">未审数量:{{ pendingOutboundDisplay(row.pendingOutboundText).qty }}</div>
                    <div class="pending-out-line">未审单数量:{{ pendingOutboundDisplay(row.pendingOutboundText).docCount }}</div>
                    <div class="pending-out-line">未审单号:{{ pendingOutboundDisplay(row.pendingOutboundText).docNos }}</div>
                  </template>
                  <template v-else>-</template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="rows.length || total > 0" class="stock-out-pi-batch-pagination">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[5, 10, 25, 50, 100, 200]"
            :total="total"
            layout="total, sizes, prev, pager, next, jumper"
            small
            background
            @current-change="onPageChange"
            @size-change="onPageSizeChange"
          />
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import {
  STOCK_OUT_PI_BATCH_MSG_APPLY,
  STOCK_OUT_PI_BATCH_MSG_ACCEPTED,
  STOCK_OUT_PI_BATCH_MSG_REJECTED,
  readStockOutProductionIssueBatchContext,
  resolveProductionIssueBatchLineKey,
  writeStockOutProductionIssueBatchResult,
} from '@/utils/stockOutProductionIssueBatchAdd'
import { buildAssistIssueMaterialDedupKey } from '@/utils/stockOutAssistIssueLineKey'

defineOptions({ name: 'inventory-daily-stock-out-production-issue-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const sourceOrderNo = ref('')
const workshopCode = ref('')
const workshopName = ref('')
const piNo = ref('')
const warehouseCode = ref('')
const warehouseName = ref('')
const dispatchSystemcode = ref('')
const excludeOutboundNo = ref('')
const inTax = ref('1')
const selectedKeysFromParent = ref([])
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
/** 首屏从接口拉齐的全量行，搜索框仅本地筛选此缓存 */
const allRowsCache = ref([])
const page = ref(1)
const pageSize = ref(20)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const closeHint = ref('')
const piCostHint = ref('')
const batchMode = ref('dispatch')
const submitted = ref(false)

const outboundType = ref('4')
const batchWindowTitle = computed(() => {
  if (String(outboundType.value) === '7') return '生产领料（计划外）批量添加'
  if (String(outboundType.value) === '8') return '生产领料（补数）批量添加'
  return '生产领料批量添加'
})
const emptyText = '该派工单下暂无可选材料'
const selectedCount = computed(() => pickedKeys.value.size)

/** 本地按材料编码模糊筛 */
const filteredRows = computed(() => {
  const kw = String(keyword.value ?? '').trim().toLowerCase()
  const list = allRowsCache.value
  if (!kw) return list
  return list.filter((row) => String(row.kcaa01 ?? '').toLowerCase().includes(kw))
})

const total = computed(() => filteredRows.value.length)

/** 当前页展示行（本地分页） */
const rows = computed(() => {
  const list = filteredRows.value
  const start = (page.value - 1) * pageSize.value
  return list.slice(start, start + pageSize.value)
})

watch(keyword, () => {
  page.value = 1
})

function formatNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return (Math.round(n * 1000) / 1000).toFixed(3)
}

function formatOutboundQtyDisplay(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return String(Math.round(n * 1000) / 1000)
}

function roundOutboundQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 1000) / 1000
}

/** 未审出库情况列：仅展示用，把接口摘要拆成三行 */
function pendingOutboundDisplay(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw === '-') return null
  const labeledQty = raw.match(/未审数量:\s*([^\n\r]+)/)
  const labeledCount = raw.match(/未审单数量:\s*([^\n\r]+)/)
  const labeledDocs = raw.match(/未审单号:\s*([^\n\r]+)/)
  if (labeledQty || labeledCount || labeledDocs) {
    return {
      qty: String(labeledQty?.[1] ?? '-').trim(),
      docCount: String(labeledCount?.[1] ?? '-').trim(),
      docNos: String(labeledDocs?.[1] ?? '-').trim(),
    }
  }
  const parts = raw.split('/').map((s) => s.trim())
  if (parts.length >= 3) {
    return { qty: parts[0], docCount: parts[1], docNos: parts.slice(2).join(' / ') }
  }
  return { qty: raw, docCount: '-', docNos: '-' }
}

function isPicked(row) {
  const key = String(row.lineKey ?? resolveProductionIssueBatchLineKey(row) ?? '').toLowerCase()
  if (key && pickedKeys.value.has(key)) return true
  if (key && selectedKeysFromParent.value.some((k) => String(k).toLowerCase() === key)) return true
  const matKey = buildAssistIssueMaterialDedupKey(row.kcaa01)
  if (matKey && selectedKeysFromParent.value.some((k) => String(k).toLowerCase() === matKey)) return true
  return row.selectState === 'picked' || (!row.selectable && row.selectLabel === '已选择')
}

function buttonLabel(row) {
  if (isPicked(row)) return '已选择'
  return row.selectLabel || '不可选'
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
  const key = String(row.lineKey ?? resolveProductionIssueBatchLineKey(row) ?? '').toLowerCase()
  if (!key) return
  if (isPicked(row)) {
    if (!row.selectable && row.selectLabel === '已选择') return
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

async function fetchAllRowsFromServer() {
  if (!sourceOrderNo.value || !workshopCode.value || !warehouseCode.value || !piNo.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const mergedSelected = [...new Set([...selectedKeysFromParent.value, ...pickedKeys.value])]
    const { data } = await axios.get('/api/stock-out/production-issue-batch-lines', {
      params: {
        sourceOrderNo: sourceOrderNo.value,
        workshopCode: workshopCode.value,
        warehouseCode: warehouseCode.value,
        piNo: piNo.value,
        dispatchSystemcode: dispatchSystemcode.value || undefined,
        excludeOutboundNo: excludeOutboundNo.value || undefined,
        fetchAll: '1',
        selectedKeys: mergedSelected.join(','),
      },
    })
    allRowsCache.value = data?.data?.list ?? []
    piCostHint.value = String(data?.data?.piCostHint ?? '').trim()
    batchMode.value = String(data?.data?.batchMode ?? 'dispatch').trim() || 'dispatch'
    const maxPage = Math.max(1, Math.ceil(filteredRows.value.length / pageSize.value) || 1)
    if (page.value > maxPage) page.value = maxPage
  } catch (err) {
    errorMsg.value = err?.response?.data?.msg || err.message || '加载失败'
    allRowsCache.value = []
  } finally {
    loading.value = false
  }
}

function refreshAllRows() {
  fetchAllRowsFromServer()
}

function queryAll() {
  keyword.value = ''
  page.value = 1
}

function onPageChange() {
  // 本地分页，v-model 已更新 page
}

function onPageSizeChange() {
  page.value = 1
}

function closeWindow() {
  window.close()
}

function buildLinesForParent() {
  const taxMode = String(inTax.value) === '2' ? '2' : '1'
  return [...pickedRows.value.values()].map((row) => {
    const qty = roundOutboundQty(row.issueableQty ?? 0)
    const stockCap = roundOutboundQty(row.warehouseActualQty ?? row.kcaq031 ?? qty)
    const stillNeedCap = roundOutboundQty(row.stillNeedQty ?? qty)
    const sourceDemandQty = roundOutboundQty(row.sourceDemandQty ?? row.dispatchDemandQty ?? 0)
    const ex = Number(row.kcaq04 ?? 0)
    const inc = Number(row.kcaq041 ?? 0)
    const tax = taxMode === '2' ? 0 : Number(row.tax ?? 0)
    const kcaq041 = taxMode === '2' ? ex : (inc || Number((ex * (1 + tax)).toFixed(4)))
    const sourceLineCode = String(row.scak02 ?? row.sourceLineCode ?? row.kcaq02 ?? '').trim()
    return {
      ...row,
      lineKey: resolveProductionIssueBatchLineKey(row),
      sourceLineCode,
      kcaq02: sourceLineCode,
      scak02: sourceLineCode,
      kcaq03: qty,
      kcaq031: stockCap,
      sourceDemandQty,
      stillNeedQty: stillNeedCap,
      availableQty: stockCap,
      sourceAvailableQty: stillNeedCap,
      kcaq04: ex,
      kcaq041,
      tax,
      kcaq05: Number((qty * ex).toFixed(2)),
      kcaq051: Number((qty * kcaq041).toFixed(2)),
      reference: row.reference || piNo.value,
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
      type: STOCK_OUT_PI_BATCH_MSG_APPLY,
      sessionId: sessionId.value,
      openedWarehouseCode: warehouseCode.value,
      openedSourceOrderNo: sourceOrderNo.value,
      openedWorkshopCode: workshopCode.value,
      openedPiNo: piNo.value,
      lineCount: lines.length,
      lines,
    }
    writeStockOutProductionIssueBatchResult(sessionId.value, payload)

    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin)
      const onReply = (event) => {
        if (event.origin !== window.location.origin) return
        const data = event.data
        if (!data || data.sessionId !== sessionId.value) return
        if (data.type === STOCK_OUT_PI_BATCH_MSG_ACCEPTED) {
          window.removeEventListener('message', onReply)
          onSaveAccepted(data.lineCount ?? lines.length)
        }
        if (data.type === STOCK_OUT_PI_BATCH_MSG_REJECTED) {
          window.removeEventListener('message', onReply)
          ElMessage.warning('父页面未接受数据，请检查派工单/车间/仓库/PI是否已变更')
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
  const ctx = readStockOutProductionIssueBatchContext(sessionId.value)
  if (!ctx) {
    errorMsg.value = '会话已失效，请从出库单页面重新打开批量添加'
    return
  }
  outboundType.value = String(ctx.outboundType ?? '4').trim()
  sourceOrderNo.value = String(ctx.sourceOrderNo ?? '').trim()
  workshopCode.value = String(ctx.workshopCode ?? '').trim()
  workshopName.value = String(ctx.workshopName ?? '').trim()
  piNo.value = String(ctx.piNo ?? '').trim()
  warehouseCode.value = String(ctx.warehouseCode ?? '').trim()
  warehouseName.value = String(ctx.warehouseName ?? '').trim()
  dispatchSystemcode.value = String(ctx.dispatchSystemcode ?? '').trim()
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
  if (!sourceOrderNo.value || !workshopCode.value || !warehouseCode.value || !piNo.value) {
    errorMsg.value = '缺少派工单/车间/仓库/PI 信息，请从出库单页面重新打开'
    return
  }
  fetchAllRowsFromServer()
})
</script>

<style scoped>
.stock-out-pi-batch-window {
  min-height: 100vh;
  padding: 16px 20px 24px;
  background: #f5f7fa;
  box-sizing: border-box;
}
.stock-out-pi-batch-header { margin-bottom: 12px; }
.stock-out-pi-batch-title { margin: 0 0 6px; font-size: 22px; }
.stock-out-pi-batch-subtitle { margin: 0; color: #606266; font-size: 15px; }
.stock-out-pi-batch-mode-tag { color: #e6a23c; font-weight: 600; }
.stock-out-pi-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
}
.stock-out-pi-batch-label { color: #606266; }
.stock-out-pi-batch-query-input { width: 320px; }
.stock-out-pi-batch-selected { margin-left: auto; color: #409eff; }
.stock-out-pi-batch-close-hint { margin-bottom: 12px; }
.stock-out-pi-batch-table-wrap { overflow: auto; background: #fff; border-radius: 8px; }
.stock-out-pi-batch-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 14px; }
.stock-out-pi-batch-table th,
.stock-out-pi-batch-table td { border: 1px solid #ebeef5; padding: 8px 10px; vertical-align: top; }
.stock-out-pi-batch-table th { background: #f5f7fa; font-weight: 600; }
/* 仅数字/操作列不换行；名称规格等由下方 .pi-batch-cell-text 强制折行 */
.stock-out-pi-batch-table th.col-action,
.stock-out-pi-batch-table td.col-action,
.stock-out-pi-batch-table th.col-num,
.stock-out-pi-batch-table td.col-num,
.stock-out-pi-batch-table th.col-color,
.stock-out-pi-batch-table td.col-color,
.stock-out-pi-batch-table th.col-unit,
.stock-out-pi-batch-table td.col-unit { white-space: nowrap; vertical-align: middle; }
.col-action { width: 90px; text-align: center; }
.col-num { width: 72px; text-align: right; }
.col-color { width: 56px; }
.col-unit { width: 48px; }
.stock-out-pi-batch-table th.col-dispatch-source,
.stock-out-pi-batch-table td.col-dispatch-source { width: 150px; color: #606266; font-size: 13px; line-height: 1.45; }
.dispatch-source-block div + div { margin-top: 2px; }
/* DIY：格内 div 限宽折行，避免长字串溢出到邻列 — production-issue-batch-window.vue .pi-batch-cell-text */
.pi-batch-cell-text {
  display: block;
  max-width: 100%;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.4;
}
/* DIY：材料编码 120px；材料名称 100px；规格 120px — production-issue-batch-window.vue .col-material-* */
.stock-out-pi-batch-table th.col-material-code,
.stock-out-pi-batch-table td.col-material-code {
  width: 120px;
  max-width: 120px;
  overflow: hidden;
}
.stock-out-pi-batch-table td.col-material-code .pi-batch-cell-text { color: #dc2626; font-weight: 700; }
.stock-out-pi-batch-table th.col-material-name,
.stock-out-pi-batch-table td.col-material-name {
  width: 100px;
  max-width: 100px;
  overflow: hidden;
}
.stock-out-pi-batch-table th.col-material-spec,
.stock-out-pi-batch-table td.col-material-spec {
  width: 120px;
  max-width: 120px;
  overflow: hidden;
}
.col-book { color: #dc2626; font-weight: 600; }
.col-pending { color: #7e22ce; font-weight: 600; }
.col-pending-out { width: 140px; max-width: 140px; color: #7e22ce; font-size: 13px; line-height: 1.45; overflow: hidden; }
.stock-out-pi-batch-table th.col-pending-out,
.stock-out-pi-batch-table td.col-pending-out { white-space: normal; }
.pending-out-line { line-height: 1.5; }
.col-actual-ok { color: #2563eb; font-weight: 600; }
.col-actual-bad { color: #dc2626; font-weight: 700; }
.col-issueable { color: #991b1b; font-weight: 700; }
.stock-out-pi-picked-btn { color: #606266; border-color: #c0c4cc; background: #f4f4f5; }
.stock-out-pi-batch-row--picked { background: #f0f9eb; }
.stock-out-pi-batch-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 12px;
  padding: 8px 12px;
  background: #fff;
  border-radius: 8px;
}
</style>
