<template>
  <div class="stock-trace-panel">
    <div class="stock-trace-toolbar">
      <span class="toolbar-label">查询条件</span>
      <el-input
        v-model="filters.keyword"
        class="toolbar-field toolbar-field--keyword"
        clearable
        placeholder="材料编码/出库单号/关联单号/备注/PO/PI..."
        @keyup.enter="onSearch"
      />
      <el-button type="primary" @click="onSearch">立即查询</el-button>
      <el-button @click="queryAll">查询全部</el-button>
    </div>

    <el-table
      ref="traceTableRef"
      v-loading="loading"
      v-erp-list-h-scroll
      :data="rows"
      border
      stripe
      class="stock-trace-table erp-list-table"
      :empty-text="loading ? '加载中' : '暂无数据'"
    >
      <el-table-column label="出库日期" width="120" fixed="left">
        <template #default="{ row }">{{ fmtDate(row.outboundDate) }}</template>
      </el-table-column>
      <el-table-column prop="outboundNo" label="出库单单号" min-width="130" fixed="left" show-overflow-tooltip />
      <el-table-column label="是否审核" width="90" align="center">
        <template #default="{ row }">{{ row.headerPass === '1' ? '已审' : '未审' }}</template>
      </el-table-column>
      <el-table-column prop="warehouseName" label="所出仓库" min-width="140" show-overflow-tooltip />
      <el-table-column prop="sourceOrderNo" label="关联单号" min-width="130" show-overflow-tooltip />
      <el-table-column prop="kcaa01" label="编码" min-width="130" show-overflow-tooltip />
      <el-table-column prop="kcaa02" label="材料名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="kcaa03" label="规格" min-width="140" show-overflow-tooltip />
      <el-table-column prop="kcaq03" label="数量" width="110" align="right">
        <template #default="{ row }">{{ formatQty(row.kcaq03) }}</template>
      </el-table-column>
      <el-table-column prop="kcaq04" label="单价" width="110" align="right">
        <template #default="{ row }">{{ formatPrice(row.kcaq04) }}</template>
      </el-table-column>
      <el-table-column prop="kcaq041" label="单价含税" width="120" align="right">
        <template #default="{ row }">{{ formatPrice(row.kcaq041) }}</template>
      </el-table-column>
      <el-table-column prop="tax" label="税点" width="90" align="right">
        <template #default="{ row }">{{ formatTax(row.tax) }}</template>
      </el-table-column>
      <el-table-column prop="reference" label="PO/PI或报关单号" min-width="140" show-overflow-tooltip />
      <el-table-column prop="product" label="客户订单号" min-width="140" show-overflow-tooltip />
      <el-table-column prop="Describe" label="备注或报关型号" min-width="180" show-overflow-tooltip />
      <el-table-column prop="kcaq08" label="报关单价" width="110" align="right">
        <template #default="{ row }">{{ formatPrice(row.kcaq08) }}</template>
      </el-table-column>
      <el-table-column prop="relatedPartyName" label="关联单位" min-width="180" show-overflow-tooltip />
      <el-table-column prop="version" label="版本" min-width="100" show-overflow-tooltip />
      <el-table-column prop="kcaa02_en" label="名称(英文)" min-width="150" show-overflow-tooltip />
      <el-table-column prop="kpname" label="名称(开票名)" min-width="150" show-overflow-tooltip />
      <el-table-column prop="remark" label="备注" min-width="150" show-overflow-tooltip />
      <el-table-column prop="location" label="产地" min-width="120" show-overflow-tooltip />
      <el-table-column prop="sale_price" label="销售价格" width="110" align="right" />
      <el-table-column prop="cost_price" label="成本价格" width="110" align="right" />
      <el-table-column prop="Customer_supply" label="客户供应" width="100" />
      <el-table-column prop="Customer_Name" label="客户名称" min-width="150" show-overflow-tooltip />
    </el-table>

    <div class="stock-trace-pagination">
      <el-pagination
        v-model:current-page="page.page"
        v-model:page-size="page.pageSize"
        background
        layout="total, sizes, prev, pager, next, jumper"
        :total="page.total"
        :page-sizes="[10, 20, 50, 100]"
        @size-change="loadList"
        @current-change="loadList"
      />
    </div>
  </div>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import {
  formatErpPriceDisplay,
  formatErpQtyDisplay,
  formatErpTrimDecimal,
} from '@/utils/erpNumberDisplay.js'

defineOptions({ name: 'StockOutMaterialTracePanel' })

const traceTableRef = ref(null)
const loading = ref(false)
const rows = ref([])
const page = reactive({ page: 1, pageSize: 10, total: 0 })
const filters = reactive({ keyword: '' })

function fmtDate(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toISOString().slice(0, 10)
}

function formatQty(v) {
  return formatErpQtyDisplay(v)
}

function formatPrice(v) {
  return formatErpPriceDisplay(v)
}

function formatTax(v) {
  return formatErpTrimDecimal(v, { maxDecimals: 2 })
}

async function refreshTraceTableHScroll() {
  await nextTick()
  traceTableRef.value?.doLayout?.()
  const el = traceTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

async function loadList(opts = {}) {
  loading.value = true
  try {
    const params = {
      page: page.page,
      pageSize: page.pageSize,
      keyword: filters.keyword,
      all: opts.all ? '1' : '0',
    }
    const { data } = await axios.get('/api/stock-out/material-trace/list', { params })
    if (data?.code !== 200) throw new Error(data?.msg || '读取出库转向物料列表失败')
    rows.value = data.data?.list || []
    page.total = Number(data.data?.total || 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取出库转向物料列表失败')
  } finally {
    loading.value = false
    await refreshTraceTableHScroll()
  }
}

function onSearch() {
  page.page = 1
  loadList()
}

function queryAll() {
  filters.keyword = ''
  page.page = 1
  loadList({ all: true })
}

onMounted(async () => {
  await loadList()
})

defineExpose({ loadList, onSearch, queryAll })
</script>

<style scoped>
.stock-trace-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.toolbar-label {
  color: #606266;
  white-space: nowrap;
}

.toolbar-field {
  width: 220px;
}

.toolbar-field--keyword {
  width: 360px;
  max-width: 100%;
}

.stock-trace-pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
