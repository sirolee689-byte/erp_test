<template>
  <div class="buy-trace-page">
    <div class="buy-trace-head">
      <h1>采购订单转向物料查询</h1>
    </div>

    <div class="buy-trace-toolbar">
      <span class="toolbar-label">查询条件</span>
      <el-input
        v-model="filters.keyword"
        class="toolbar-field toolbar-field--keyword"
        clearable
        placeholder="采购单号/物料编码/备注/供应商..."
        @keyup.enter="onSearch"
      />
      <el-button type="primary" @click="onSearch">立即查询</el-button>
      <el-button @click="queryAll">查询全部</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border stripe class="buy-trace-table">
      <el-table-column label="操作" width="88" align="center" fixed="left">
        <template #default="{ row }">
          <el-button link type="primary" @click="openSource(row)">查看</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="buyOrderNo" label="采购订单单号" min-width="130" fixed="left" show-overflow-tooltip />
      <el-table-column prop="referenceNo" label="关联单号/PI" min-width="140" show-overflow-tooltip />
      <el-table-column label="采购时间" width="120">
        <template #default="{ row }">{{ fmtDate(row.buyDate) }}</template>
      </el-table-column>
      <el-table-column prop="creator" label="下单人" min-width="100" show-overflow-tooltip />
      <el-table-column label="供应商/外协商" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ [row.supplierCode, row.supplierName].filter(Boolean).join(' / ') || '-' }}</template>
      </el-table-column>
      <el-table-column prop="kcaa01" label="物料编码" min-width="130" show-overflow-tooltip />
      <el-table-column prop="kcaa02" label="物料名称" min-width="160" show-overflow-tooltip />
      <el-table-column prop="kcak03" label="采购数量" width="110" align="right">
        <template #default="{ row }">{{ formatQty(row.kcak03) }}</template>
      </el-table-column>
      <el-table-column prop="inboundQty" label="入库数量" width="110" align="right">
        <template #default="{ row }">{{ formatQty(row.inboundQty) }}</template>
      </el-table-column>
      <el-table-column prop="kcak04" label="单价" width="110" align="right">
        <template #default="{ row }">{{ formatMoney(row.kcak04) }}</template>
      </el-table-column>
      <el-table-column prop="kcak041" label="含税单价" width="120" align="right">
        <template #default="{ row }">{{ formatMoney(row.kcak041) }}</template>
      </el-table-column>
      <el-table-column prop="kcak05" label="金额" width="110" align="right">
        <template #default="{ row }">{{ formatMoney(row.kcak05) }}</template>
      </el-table-column>
      <el-table-column prop="kcak051" label="含税金额" width="120" align="right">
        <template #default="{ row }">{{ formatMoney(row.kcak051) }}</template>
      </el-table-column>
      <el-table-column prop="tax" label="税点" width="90" align="right">
        <template #default="{ row }">{{ formatTax(row.tax) }}</template>
      </el-table-column>
      <el-table-column prop="poPi" label="PO/PI" min-width="140" show-overflow-tooltip />
      <el-table-column prop="orderNo" label="客户订单号" min-width="140" show-overflow-tooltip />
      <el-table-column prop="info" label="备注" min-width="180" show-overflow-tooltip />
      <el-table-column prop="kcaa02_en" label="名称(英文)" min-width="150" show-overflow-tooltip />
      <el-table-column prop="kpname" label="名称(开票名)" min-width="150" show-overflow-tooltip />
      <el-table-column prop="location" label="产地" min-width="120" show-overflow-tooltip />
      <el-table-column prop="sale_price" label="销售价格" width="110" align="right" />
      <el-table-column prop="cost_price" label="成本价格" width="110" align="right" />
      <el-table-column prop="Customer_supply" label="客户供应" width="100" />
      <el-table-column prop="Customer_Name" label="客户名称" min-width="150" show-overflow-tooltip />
    </el-table>

    <div class="buy-trace-pagination">
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
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import axios from 'axios'

defineOptions({ name: 'supply-chain-daily-purchase-order-material-trace-window' })

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

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function formatQty(v) {
  return num(v).toFixed(2)
}

function formatMoney(v) {
  return num(v).toFixed(4)
}

function formatTax(v) {
  return num(v).toFixed(2)
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
    const { data } = await axios.get('/api/buy-order/material-trace/list', { params })
    if (data?.code !== 200) throw new Error(data?.msg || '读取转向物料列表失败')
    rows.value = data.data?.list || []
    page.total = Number(data.data?.total || 0)
  } catch (err) {
    ElMessage.error(err?.response?.data?.msg || err?.message || '读取转向物料列表失败')
  } finally {
    loading.value = false
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

function openSource(row) {
  const systemcode = String(row?.bomSystemCode || row?.systemcode || '').trim()
  const psystemcode = String(row?.buyOrderNo || '').trim()
  if (!systemcode) {
    ElMessage.warning('当前行缺少原资料编号，无法查看')
    return
  }
  const url = `/inventory/basic/pi-bom-data-window?systemcode=${encodeURIComponent(systemcode)}&psystemcode=${encodeURIComponent(psystemcode)}`
  const opened = window.open(url, '_blank')
  if (!opened) ElMessage.error('无法打开新窗口，请检查浏览器是否拦截弹窗')
}

onMounted(async () => {
  await loadList()
})
</script>

<style scoped>
.buy-trace-page {
  padding: 12px;
}

.buy-trace-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.buy-trace-head h1 {
  margin: 0;
  font-size: 20px;
}

.buy-trace-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.toolbar-label {
  color: #606266;
  white-space: nowrap;
}

.toolbar-field {
  width: 220px;
}

.toolbar-field--keyword {
  width: 320px;
}

.buy-trace-pagination {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
</style>
