<template>
  <div class="buy-batch-window">
    <header class="buy-batch-header">
      <h1 class="buy-batch-title">采购订单批量添加明细</h1>
      <p class="buy-batch-subtitle">{{ headerSubtitle }}</p>
    </header>

    <section class="buy-batch-toolbar">
      <el-select
        v-if="isRequisition"
        v-model="bomCodeId"
        clearable
        filterable
        placeholder="分类"
        class="buy-batch-category-select"
        @change="onCategoryChange"
      >
        <el-option label="全部分类" value="" />
        <el-option
          v-for="opt in bomCodeCategoryOptions"
          :key="opt.id"
          :label="opt.flag1 || `id=${opt.id}`"
          :value="String(opt.id)"
        />
      </el-select>
      <span class="buy-batch-query-label">查询条件</span>
      <el-input
        v-model="keyword"
        clearable
        class="buy-batch-query-input"
        :placeholder="queryPlaceholder"
        @keyup.enter="reload"
      />
      <el-button class="buy-batch-toolbar-btn" type="primary" @click="reload">立即查询</el-button>
      <el-button class="buy-batch-toolbar-btn" @click="queryAll">查询全部</el-button>
      <el-button class="buy-batch-toolbar-btn" type="primary" :disabled="!selectedCount || saving" :loading="saving" @click="saveSelected">
        保存已选数据
      </el-button>
      <el-button class="buy-batch-toolbar-btn" @click="resetSelection">全部重选</el-button>
      <el-button class="buy-batch-toolbar-btn" :disabled="!history.length" @click="undoLast">撤销上一步</el-button>
      <span class="buy-batch-selected">货品已选数：{{ selectedCount }}</span>
    </section>

    <el-skeleton :loading="loading" animated :rows="10">
      <template #default>
        <el-empty v-if="!rows.length && !loading" :description="errorMsg || emptyHint" />
        <div v-else class="buy-batch-table-wrap">
          <table class="buy-batch-table">
            <thead>
              <tr>
                <th class="col-action">
                  <template v-if="isRequisition">
                    <el-button size="small" class="buy-batch-select-all-btn" @click="selectAllOnPage">全选</el-button>
                  </template>
                  <template v-else>操作</template>
                </th>
                <template v-if="isRequisition">
                  <th>编码</th>
                  <th>状态</th>
                  <th>名称(中文)</th>
                  <th>名称(英文)</th>
                  <th>名称(开票名)</th>
                  <th>规格</th>
                  <th>单位</th>
                  <th>分类</th>
                  <th v-if="isMultiPiRequisition">SI</th>
                  <th class="col-num">最新单价(含税)</th>
                  <th v-for="col in requisitionTailColumns" :key="col.key" :class="col.className">{{ col.label }}</th>
                </template>
                <template v-else>
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
                  <th v-for="col in extraColumns" :key="col.key" :class="col.className">{{ col.label }}</th>
                </template>
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
                <template v-if="isRequisition">
                  <td>{{ row.kcaa01 || '-' }}</td>
                  <td>
                    <span class="buy-batch-status" :class="statusMeta(row.pass).className">
                      {{ statusMeta(row.pass).label }}
                    </span>
                  </td>
                  <td>{{ row.kcaa02 || '-' }}</td>
                  <td>{{ row.kcaa02_en || '-' }}</td>
                  <td>{{ row.kpname || '-' }}</td>
                  <td>{{ row.kcaa03 || '-' }}</td>
                  <td>{{ row.kcaa04 || '-' }}</td>
                  <td>{{ row.categoryName || row.kcaa05 || '-' }}</td>
                  <td v-if="isMultiPiRequisition">{{ row.sid || '-' }}</td>
                  <td class="col-num">{{ hasPrice ? '待带出' : '-' }}</td>
                  <td v-for="col in requisitionTailColumns" :key="col.key" :class="col.className">
                    {{ formatExtraCell(row, col) }}
                  </td>
                </template>
                <template v-else>
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
                  <td v-for="col in extraColumns" :key="col.key" :class="col.className">
                    <span v-if="col.type === 'status'" class="buy-batch-status" :class="statusMeta(row.pass).className">
                      {{ statusMeta(row.pass).label }}
                    </span>
                    <span v-else>{{ formatExtraCell(row, col) }}</span>
                  </td>
                </template>
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

const MAX_SELECT_ALL = 300

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId ?? '').trim())
const buyType = ref('1')
const piNo = ref('')
const supplierCode = ref('')
const hasPrice = ref(false)
const keyword = ref('')
const bomCodeId = ref('')
const bomCodeCategoryOptions = ref([])
const loading = ref(false)
const saving = ref(false)
const errorMsg = ref('')
const rows = ref([])
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
const pickedKeys = ref(new Set())
const pickedRows = ref(new Map())
const history = ref([])

const isRequisition = computed(() => ['0', '2'].includes(String(buyType.value)))
const isMultiPiRequisition = computed(() => isRequisition.value && String(piNo.value).includes(','))
const selectedCount = computed(() => pickedKeys.value.size)
const totalPages = computed(() => Math.max(1, Math.ceil(Number(total.value || 0) / Number(pageSize.value || 10))))
const headerSubtitle = computed(() => {
  if (isRequisition.value) {
    const typeText = String(buyType.value) === '0' ? '其他采购' : '请购采购'
    const refText = String(piNo.value || '').trim()
    if (isMultiPiRequisition.value) return `${typeText} · 多 PI 选材（${refText}）`
    if (refText) return `${typeText} · 关联单号：${refText}（BOM 物料库全量）`
    return `${typeText} · BOM 物料库全量选材`
  }
  return `PI号：${piNo.value}（已锁定）`
})
const emptyHint = computed(() => (isRequisition.value ? '暂无可选物料' : '该 PI 下暂无可采购物料'))
const queryPlaceholder = computed(() => (isRequisition.value ? '材料编码' : '编码/名称/规格/单位/客户款号/组别/GUID/kcaa字段'))

const extraColumns = [
  { key: 'kpname', label: '名称(开票名)' },
  { key: 'kcaa04', label: '单位' },
  { key: 'categoryName', label: '分类', fallbackKey: 'kcaa05' },
  { key: 'kcaa06', label: '客户款号' },
  { key: 'kcaa07', label: '最高存量', className: 'col-num' },
  { key: 'kcaa08', label: '最低存量', className: 'col-num' },
  { key: 'kcaa09', label: '工厂款号' },
  { key: 'kcaa10', label: '组别' },
  { key: 'kcaa11', label: '颜色编码/名称' },
  { key: 'kcaa12', label: '采购' },
  { key: 'kcaa13', label: '外协' },
  { key: 'kcaa14', label: '自产' },
  { key: 'kcaa15', label: '生产车间' },
  { key: 'kcaa16', label: '海关编码' },
  { key: 'kcaa17', label: '海关名称' },
  { key: 'kcaa18', label: '海关单位' },
  { key: 'kcaa19', label: '海关转换率', className: 'col-num' },
  { key: 'kcaa20', label: 'bag(cm)' },
  { key: 'kcaa21', label: 'box(cm)' },
  { key: 'kcaa22', label: 'empty(g)', className: 'col-num' },
  { key: 'kcaa23', label: 'net(g)', className: 'col-num' },
  { key: 'kcaa24', label: 'gross(g)', className: 'col-num' },
  { key: 'kcaa25', label: '采购单位' },
  { key: 'kcaa26', label: '采购转换率', className: 'col-num' },
  { key: 'kcaa27', label: '转换方式', formatter: purchaseDirectionLabel },
  { key: 'kcaa28', label: '是否保税', formatter: yesNoLabel },
  { key: 'kcaa29', label: '报价单位' },
  { key: 'kcaa30', label: '报价转换率', className: 'col-num' },
  { key: 'kcaa31', label: '报价转换方式', formatter: quoteDirectionLabel },
  { key: 'kcaa32', label: '报价损耗', className: 'col-num', formatter: fixed6Label },
  { key: 'kcaa33', label: '物料损耗', className: 'col-num', formatter: fixed6Label },
  { key: 'quoteCurrencyName', label: '报价币别', fallbackKey: 'kcaa34' },
  { key: 'purchaseCurrencyName', label: '采购币别', fallbackKey: 'kcaa35' },
  { key: 'remark', label: '备注' },
  { key: 'pass', label: '状态', type: 'status' },
  { key: 'location', label: '产地' },
  { key: 'sale_price', label: '销售价格', className: 'col-num' },
  { key: 'cost_price', label: '成本价格', className: 'col-num' },
  { key: 'Customer_supply', label: '客户供应', formatter: yesNoLabel },
  { key: 'Customer_Name', label: '客户名称' },
]

const requisitionTailColumns = [
  { key: 'kcaa06', label: '客户款号' },
  { key: 'kcaa07', label: '最高存量', className: 'col-num' },
  { key: 'kcaa08', label: '最低存量', className: 'col-num' },
  { key: 'kcaa09', label: '工厂款号' },
  { key: 'kcaa10', label: '组别' },
  { key: 'kcaa11', label: '颜色编码/名称' },
  { key: 'kcaa12', label: '采购' },
  { key: 'kcaa13', label: '外协' },
  { key: 'kcaa14', label: '自产' },
  { key: 'kcaa15', label: '生产车间' },
  { key: 'kcaa16', label: '海关编码' },
  { key: 'kcaa17', label: '海关名称' },
  { key: 'kcaa18', label: '海关单位' },
  { key: 'kcaa19', label: '海关转换率', className: 'col-num' },
  { key: 'kcaa20', label: 'bag(cm)' },
  { key: 'kcaa21', label: 'box(cm)' },
  { key: 'kcaa22', label: 'empty(g)', className: 'col-num' },
  { key: 'kcaa23', label: 'net(g)', className: 'col-num' },
  { key: 'kcaa24', label: 'gross(g)', className: 'col-num' },
  { key: 'kcaa25', label: '采购单位' },
  { key: 'kcaa26', label: '采购转换率', className: 'col-num' },
  { key: 'kcaa27', label: '转换方式', formatter: purchaseDirectionLabel },
  { key: 'kcaa28', label: '是否保税', formatter: yesNoLabel },
  { key: 'kcaa29', label: '报价单位' },
  { key: 'kcaa30', label: '报价转换率', className: 'col-num' },
  { key: 'kcaa31', label: '报价转换方式', formatter: quoteDirectionLabel },
  { key: 'kcaa32', label: '报价损耗', className: 'col-num', formatter: fixed6Label },
  { key: 'kcaa33', label: '物料损耗', className: 'col-num', formatter: fixed6Label },
  { key: 'quoteCurrencyName', label: '报价币别', fallbackKey: 'kcaa34' },
  { key: 'purchaseCurrencyName', label: '采购币别', fallbackKey: 'kcaa35' },
  { key: 'remark', label: '备注' },
  { key: 'location', label: '产地' },
  { key: 'sale_price', label: '销售价格', className: 'col-num' },
  { key: 'cost_price', label: '成本价格', className: 'col-num' },
  { key: 'Customer_supply', label: '客户供应', formatter: yesNoLabel },
  { key: 'Customer_Name', label: '客户名称' },
]

function formatNum(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '-'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
}

function displayText(value) {
  const s = String(value ?? '').trim()
  return s || '-'
}

function yesNoLabel(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '是'
  if (s === '0') return '否'
  return displayText(s)
}

function purchaseDirectionLabel(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '使用->采购'
  if (s === '0') return '采购->使用'
  return displayText(s)
}

function quoteDirectionLabel(value) {
  const s = String(value ?? '').trim()
  if (s === '1') return '报价->使用'
  if (s === '0') return '使用->报价'
  return displayText(s)
}

function fixed6Label(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return displayText(value)
  return n.toFixed(6)
}

function statusMeta(value) {
  const s = String(value ?? '').trim()
  if (s === '0') return { label: '未审核', className: 'buy-batch-status--pending' }
  if (s === '1') return { label: '已审核', className: 'buy-batch-status--passed' }
  if (s === '2') return { label: '审核不通过', className: 'buy-batch-status--rejected' }
  if (s === '3') return { label: '有效', className: 'buy-batch-status--valid' }
  return { label: displayText(s), className: 'buy-batch-status--unknown' }
}

function formatExtraCell(row, col) {
  if (typeof col.formatter === 'function') return col.formatter(row?.[col.key], row)
  const value = row?.[col.key]
  const fallback = col.fallbackKey ? row?.[col.fallbackKey] : ''
  return displayText(value || fallback)
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

function selectAllOnPage() {
  if (!isRequisition.value) return
  let hitLimit = false
  for (const row of rows.value) {
    if (pickedKeys.value.size >= MAX_SELECT_ALL) {
      hitLimit = true
      break
    }
    if (!isPicked(row)) togglePick(row)
  }
  if (hitLimit) ElMessage.warning(`一次最多全选 ${MAX_SELECT_ALL} 条`)
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
  const qty = isRequisition.value ? 0 : Number(row.availableQty ?? 0)
  const out = {
    buyType: buyType.value,
    piNo: isMultiPiRequisition.value ? String(row.sid || '').trim() : piNo.value,
    bomSystemCode: row.bomSystemCode || row.systemcode || row.GUID,
    systemcode: row.systemcode || row.bomSystemCode || row.GUID,
    quantity: qty,
    taxIncludedPrice: hasPrice.value ? Number(row.cgab05 ?? 0) : 0,
    taxExcludedPrice: hasPrice.value ? Number(row.cgab04 ?? 0) : 0,
    taxIncludedAmount: hasPrice.value ? qty * Number(row.cgab05 ?? 0) : 0,
    taxExcludedAmount: hasPrice.value ? qty * Number(row.cgab04 ?? 0) : 0,
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
    referenceNo: isMultiPiRequisition.value ? String(row.sid || '').trim() : piNo.value,
  }
  if (!isRequisition.value) out.maxQty = Number(row.maxQty ?? 0)
  for (let i = 1; i <= 35; i += 1) {
    const col = `kcaa${String(i).padStart(2, '0')}`
    out[col] = row[col]
  }
  return out
}

async function enrichRequisitionRowsWithPrices(selectedRows) {
  if (!isRequisition.value || !hasPrice.value || !selectedRows.length) return selectedRows
  const res = await axios.post('/api/buy-order/batch-add-prices', {
    supplierCode: supplierCode.value,
    lines: selectedRows,
  })
  const body = res.data ?? {}
  if (body.code !== 200) throw new Error(body.msg || '读取已选物料报价失败')
  return Array.isArray(body.data?.list) ? body.data.list : selectedRows
}

async function saveSelected() {
  const selectedRows = Array.from(pickedRows.value.values())
  if (!selectedRows.length) {
    ElMessage.warning('请先选择物料')
    return
  }
  let lines = []
  saving.value = true
  try {
    const pricedRows = await enrichRequisitionRowsWithPrices(selectedRows)
    lines = pricedRows.map(buildLine)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取已选物料报价失败')
    saving.value = false
    return
  }
  const sid = sessionId.value
  const payload = {
    sessionId: sid,
    buyType: buyType.value,
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
    saving.value = false
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
      if (data.reason === BUY_BATCH_REJECT_PI_MISMATCH) ElMessage.warning('关联单号已变更，请重新打开批量添加')
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
      buyType: buyType.value,
      openedPiNo: piNo.value,
      openedSupplierCode: supplierCode.value,
      lines,
    },
    origin,
  )
}

async function loadBomCodeCategoryOptions() {
  try {
    const res = await axios.get('/api/inv/bom/bom-code-categories')
    const list = Array.isArray(res.data?.data?.list) ? res.data.data.list : []
    bomCodeCategoryOptions.value = list
      .map((r) => ({
        id: Number(r.id),
        flag1: String(r.flag1 ?? '').trim(),
        flag5: String(r.flag5 ?? '').trim(),
      }))
      .filter((r) => Number.isFinite(r.id) && r.id > 0)
  } catch {
    bomCodeCategoryOptions.value = []
  }
}

async function loadRows() {
  if (!isRequisition.value && !piNo.value) {
    ElMessage.error('缺少 PI 号')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await axios.get('/api/buy-order/batch-add-lines', {
      params: {
        buyType: buyType.value,
        piNo: piNo.value,
        supplierCode: supplierCode.value,
        keyword: keyword.value,
        bomCodeId: bomCodeId.value || undefined,
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
    if (!rows.value.length && total.value === 0) errorMsg.value = emptyHint.value
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
  bomCodeId.value = ''
  page.value = 1
  loadRows()
}

function onCategoryChange() {
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
    return false
  }
  const ctx = readBuyBatchContext(sid)
  if (!ctx) {
    ElMessage.error('批量添加会话已失效，请从采购订单页面重新打开')
    return false
  }
  buyType.value = String(ctx.buyType ?? route.query?.buyType ?? '1')
  piNo.value = String(ctx.piNo ?? route.query?.piNo ?? '').trim()
  supplierCode.value = String(ctx.supplierCode ?? '').trim()
  hasPrice.value = ctx.hasPrice !== false
  return true
}

onMounted(async () => {
  if (!initFromContext()) return
  if (isRequisition.value) await loadBomCodeCategoryOptions()
  await loadRows()
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

.buy-batch-category-select {
  width: 160px;
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
  min-width: 5200px;
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

.buy-batch-pick-btn,
.buy-batch-select-all-btn {
  min-width: 68px;
}

.buy-batch-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 68px;
  height: 22px;
  padding: 0 8px;
  border-radius: 3px;
  font-weight: 600;
  font-size: 12px;
}

.buy-batch-status--pending {
  color: #d03050;
  background: #fff1f0;
}

.buy-batch-status--passed {
  color: #e67e22;
  background: #fff7e6;
}

.buy-batch-status--rejected {
  color: #1677ff;
  background: #eaf3ff;
}

.buy-batch-status--valid {
  color: #18a058;
  background: #f0fff4;
}

.buy-batch-status--unknown {
  color: #606266;
  background: #f4f4f5;
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
