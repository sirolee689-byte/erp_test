<template>
  <div class="stock-out-batch-window">
    <header class="stock-out-batch-header">
      <h1 class="stock-out-batch-title">其他出库批量选材</h1>
      <p class="stock-out-batch-subtitle">当前仓库：{{ warehouseName || warehouseCode || '-' }}</p>
    </header>

    <section class="stock-out-batch-toolbar">
      <span class="stock-out-batch-label">分类</span>
      <el-select v-model="categoryCode" class="stock-out-batch-category" disabled>
        <el-option label="全部" value="" />
      </el-select>
      <span class="stock-out-batch-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="stock-out-batch-query-input"
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
      <span class="stock-out-batch-selected">已选：{{ selectedCount }} 条</span>
    </section>

    <el-alert
      v-if="closeHint"
      class="stock-out-batch-close-hint"
      :title="closeHint"
      type="success"
      show-icon
      :closable="false"
    />

    <el-skeleton :loading="loading" animated :rows="8">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyText" />
        <div v-else class="stock-out-batch-table-wrap">
          <table class="stock-out-batch-table">
            <thead>
              <tr>
                <th class="col-action">操作</th>
                <th>产地</th>
                <th>材料编码</th>
                <th class="col-book">账存数量</th>
                <th>物料出库未审总数</th>
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
              <tr v-for="row in rows" :key="row.lineKey" :class="{ 'stock-out-batch-row--picked': isPicked(row) }">
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
                <td>{{ row.materialCode || '-' }}</td>
                <td class="col-num col-book">{{ formatNum(row.bookQty) }}</td>
                <td class="col-num">{{ formatNum(row.pendingOutQty) }}</td>
                <td class="col-num col-actual" :class="{ 'col-actual--zero': !row.selectable }">
                  {{ formatNum(row.displayActualQty) }}
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
        <div class="stock-out-batch-pagination">
          <span>第{{ page }}页，共{{ totalPages }}页，共{{ total }}条，每页{{ pageSize }}条</span>
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            :page-sizes="[5, 10, 25, 50, 100, 200]"
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
  STOCK_OUT_BATCH_MSG_APPLY,
  STOCK_OUT_BATCH_MSG_ACCEPTED,
  STOCK_OUT_BATCH_MSG_REJECTED,
  STOCK_OUT_BATCH_REJECT_WAREHOUSE_MISMATCH,
  readStockOutBatchContext,
  writeStockOutBatchResult,
} from '@/utils/stockOutBatchAdd'

defineOptions({ name: 'inventory-daily-stock-out-other-batch-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const warehouseCode = ref('')
const warehouseName = ref('')
const excludeOutboundNo = ref('')
const inTax = ref('1')
const selectedKeysFromParent = ref([])
const categoryCode = ref('')
const keyword = ref('')
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const rows = ref([])
const page = ref(1)
const pageSize = ref(5)
const total = ref(0)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const closeHint = ref('')
const submitted = ref(false)

const emptyText = '查询结果：没有查询到相关信息'
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1))
const selectedCount = computed(() => pickedRows.value.size)

function formatNum(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  return (Math.round(n * 100) / 100).toFixed(2)
}

function isPicked(row) {
  return pickedKeys.value.has(row.lineKey)
}

function buttonLabel(row) {
  if (isPicked(row)) return '已选择'
  return row.selectLabel || '库存不足'
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

async function loadRows() {
  if (!warehouseCode.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await axios.get('/api/stock-out/other-batch-lines', {
      params: {
        warehouseCode: warehouseCode.value,
        keyword: keyword.value.trim() || undefined,
        excludeOutboundNo: excludeOutboundNo.value || undefined,
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
  page.value = 1
  loadRows()
}

function resetKeyword() {
  keyword.value = ''
  reload()
}

function queryAll() {
  keyword.value = ''
  page.value = 1
  loadRows()
}

function onPageSizeChange() {
  page.value = 1
  loadRows()
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
      closeHint.value = '明细已带回出库单。如果浏览器未自动关闭，请直接关闭本窗口。'
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
    const priceRes = await axios.post('/api/stock-out/other-batch-prices', {
      warehouseCode: warehouseCode.value,
      materialCodes,
    })
    const priceMap = priceRes?.data?.data?.priceMap ?? {}
    const taxMode = String(inTax.value) === '2' ? '2' : '1'
    const lines = picked.map((row) => {
      const code = String(row.materialCode ?? row.kcaa01 ?? '').trim()
      const priceRow = priceMap[code] ?? null
      const qty = Number(row.actualQty ?? 0)
      const ex = Number(priceRow?.kcaq04 ?? 0)
      const inc = Number(priceRow?.kcaq041 ?? 0)
      const tax = taxMode === '2' ? 0 : Number(priceRow?.tax ?? priceRow?.Tax ?? 0)
      return {
        ...row,
        kcaa01: code,
        kcaq03: qty,
        kcaq031: qty,
        availableQty: qty,
        kcaq04: ex,
        kcaq041: inc,
        tax,
        kcaq05: Number((qty * ex).toFixed(2)),
        kcaq051: Number((qty * inc).toFixed(2)),
        Describe: '',
      }
    })

    const sid = sessionId.value
    const payload = JSON.parse(JSON.stringify({
      type: STOCK_OUT_BATCH_MSG_APPLY,
      sessionId: sid,
      openedWarehouseCode: warehouseCode.value,
      lines,
    }))
    writeStockOutBatchResult(sid, payload)

    const opener = window.opener
    if (!opener || opener.closed) {
      ElMessage.error('请从出库单页面重新打开批量添加')
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
      if (data.type === STOCK_OUT_BATCH_MSG_ACCEPTED) {
        cleanup()
        onSaveAccepted(Number(data.lineCount ?? lines.length))
        return
      }
      if (data.type === STOCK_OUT_BATCH_MSG_REJECTED) {
        cleanup()
        if (data.reason === STOCK_OUT_BATCH_REJECT_WAREHOUSE_MISMATCH) {
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
      ElMessage.warning('父页面无响应。若出库单明细已出现新行，可直接关闭本窗口；否则请确认出库单页面仍打开后重试。')
    }, 3000)

    opener.postMessage(payload, origin)
  } catch (err) {
    saving.value = false
    ElMessage.error(String(err?.response?.data?.msg ?? err?.message ?? '保存失败'))
  }
}

onMounted(() => {
  const ctx = readStockOutBatchContext(sessionId.value)
  if (!ctx) {
    errorMsg.value = '会话已失效，请从出库单页面重新打开批量添加'
    return
  }
  warehouseCode.value = String(ctx.warehouseCode ?? '').trim()
  warehouseName.value = String(ctx.warehouseName ?? '').trim()
  excludeOutboundNo.value = String(ctx.excludeOutboundNo ?? '').trim()
  inTax.value = String(ctx.inTax ?? '1')
  selectedKeysFromParent.value = Array.isArray(ctx.currentLineKeys) ? ctx.currentLineKeys : []
  pageSize.value = Number(ctx.pageSize) > 0 ? Number(ctx.pageSize) : 5

  const routeWarehouse = String(route.query?.warehouseCode ?? '').trim()
  if (routeWarehouse && warehouseCode.value && routeWarehouse !== warehouseCode.value) {
    ElMessage.error('仓库数据错误，请检查所选仓库')
    setTimeout(() => window.close(), 1200)
    return
  }
  if (!warehouseCode.value) {
    errorMsg.value = '缺少仓库信息，请从出库单页面重新打开'
    return
  }
  loadRows()
})
</script>

<style scoped>
.stock-out-batch-window {
  min-height: 100vh;
  padding: 16px 20px 24px;
  background: #f5f7fa;
  box-sizing: border-box;
}
.stock-out-batch-header {
  margin-bottom: 12px;
}
.stock-out-batch-title {
  margin: 0 0 6px;
  font-size: 22px;
}
.stock-out-batch-subtitle {
  margin: 0;
  color: #606266;
  font-size: 15px;
}
.stock-out-batch-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 12px;
  background: #fff;
  border-radius: 8px;
}
.stock-out-batch-label {
  color: #606266;
}
.stock-out-batch-category {
  width: 120px;
}
.stock-out-batch-query-input {
  width: 320px;
}
.stock-out-batch-selected {
  margin-left: auto;
  color: #409eff;
  font-weight: 600;
}
.stock-out-batch-close-hint {
  margin-bottom: 12px;
}
.stock-out-batch-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 240px);
  background: #fff;
  border-radius: 8px;
}
.stock-out-batch-table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.stock-out-batch-table th,
.stock-out-batch-table td {
  border: 1px solid #ebeef5;
  padding: 8px 10px;
  white-space: nowrap;
  vertical-align: middle;
}
.stock-out-batch-table th {
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
.stock-out-batch-table th.col-action {
  background: #f5f7fa;
  z-index: 3;
}
.col-num {
  text-align: right;
}
.col-book,
.stock-out-batch-table th.col-book {
  color: #dc2626;
}
.col-actual,
.stock-out-batch-table th.col-actual {
  color: #1d4ed8;
}
.col-actual--zero {
  color: #dc2626 !important;
}
.stock-out-batch-row--picked {
  background: #f0f9eb;
}
.stock-out-batch-pagination {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  background: #fff;
  border-radius: 8px;
}
</style>
