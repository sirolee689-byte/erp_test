<template>
  <div class="erp-module-page">
    <el-card shadow="never">
      <div class="pi-bom-mode-row">
        <el-button
          :type="pageMode === 'list' ? 'primary' : 'default'"
          plain
          @click="pageMode = 'list'"
        >
          管理PI-BOM资料
        </el-button>
        <el-button
          :type="pageMode === 'replace' ? 'primary' : 'default'"
          plain
          @click="pageMode = 'replace'"
        >
          PI-BOM物料批量替换
        </el-button>
      </div>

      <PiBomMaterialReplacePanel v-if="pageMode === 'replace'" @replaced="onMaterialReplaced" />

      <template v-else>
      <div class="search-row">
        <el-input
          v-model="keyword"
          clearable
          class="keyword-input"
          placeholder="搜索PI号或编码"
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />

      <div class="pagination-row pagination-row--top">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="ERP_PAGE_SIZE_OPTIONS"
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>

      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <ErpTableViewportHScroll>
            <el-table
              class="erp-list-table"
              :data="tableList"
              border
              stripe
              row-key="id"
              style="width: 100%"
              :empty-text="loading ? '加载中...' : '暂无数据'"
             @row-contextmenu="onErpListRowContextMenu">
              <el-table-column
                label="操作"
                :width="listActionsColWidth"
                fixed="left"
                align="left"
                header-align="center"
                class-name="erp-col-actions"
              >
                <template #default="{ row }">
                  <ErpTableActions>
                    <el-button
                      tag="a"
                      type="info"
                      plain
                      :href="buildPiBomStandaloneHref('view', row)"
                      target="_blank"
                      rel="noopener"
                      @click="guardPiBomStandaloneLink($event, 'view', row)"
                    >
                      查看
                    </el-button>
                    <el-button
                      tag="a"
                      type="primary"
                      plain
                      :href="buildPiBomStandaloneHref('edit', row)"
                      target="_blank"
                      rel="noopener"
                      @click="guardPiBomStandaloneLink($event, 'edit', row)"
                    >
                      编辑
                    </el-button>
                  </ErpTableActions>
                </template>
              </el-table-column>
              <el-table-column label="状态(是否审核)" width="120" align="center" header-align="center">
                <template #default="{ row }">
                  <el-tag v-if="isAudited(row)" type="success" size="small">已审核</el-tag>
                  <el-tag v-else type="warning" size="small">未审核</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="录入时间" width="154" class-name="erp-col-datetime">
                <template #default="{ row }">{{ formatDateTime(row.addtime) }}</template>
              </el-table-column>
              <el-table-column label="PI号" prop="piNo" min-width="140" />
              <el-table-column label="编码" prop="kcaa01" min-width="180" />
              <el-table-column label="是否运算" width="110" align="center" header-align="center">
                <template #default="{ row }">
                  <el-tag v-if="isCalculated(row)" type="success" size="small">已运算</el-tag>
                  <el-tag v-else type="info" size="small">未运算</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="成本用量" prop="usageCostText" min-width="190" align="right" />
              <el-table-column label="名称(中文)" prop="materialNameCn" min-width="220" />
              <el-table-column label="客户款号" prop="customerStyleNo" min-width="150" />
              <el-table-column label="组别" prop="groupName" min-width="120" />
              <el-table-column label="单位" prop="unit" width="92" />
              <el-table-column label="分类" prop="materialCategoryName" min-width="140" />
              <el-table-column label="工厂款号" prop="factoryStyleNo" min-width="150" />
            </el-table>
          </ErpTableViewportHScroll>

          <div class="pagination-row pagination-row--bottom">
            <el-pagination
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :current-page="page"
              :page-size="pageSize"
              :page-sizes="ERP_PAGE_SIZE_OPTIONS"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
      </template>
    </el-card>
  </div>
</template>

<script setup>
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { ref, computed } from 'vue'
import axios from 'axios'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import ErpTableActions from '@/components/erp/ErpTableActions.vue'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout.js'
import PiBomMaterialReplacePanel from './PiBomMaterialReplacePanel.vue'

defineOptions({ name: 'inventory-basic-pi-bom-data' })

const { onErpListRowContextMenu } = useErpListRowContextMenu()
const pageMode = ref('list')
const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)
const keyword = ref('')
/** 操作列按钮：查看/编辑均无按钮级权限限制（模板无 v-permission），文案恒定 */
// 操作区固定保留左 10px、右 5px；按钮文案变化时仍自动计算列宽。
const listActionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, getPiBomDataRowActionLabels, {
  fallbackLabels: ['查看', '编辑'],
  cellPadPx: 15,
  colGapPx: 4,
}))

function getPiBomDataRowActionLabels() {
  return ['查看', '编辑']
}

function isAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function isCalculated(row) {
  return String(row?.calcStatus ?? '').trim() === '已运算'
}

function formatDateTime(v) {
  const raw = String(v ?? '').trim()
  if (!raw) return '-'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.replace('T', ' ').slice(0, 19)
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  const h = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${da} ${h}:${mi}`
}

/** 列表「查看/编辑」：无侧栏全屏独立页（与销售订单展开明细查看同套路） */
function buildPiBomStandaloneHref(mode, row) {
  const orderId = Number(row?.orderId)
  const code = String(row?.kcaa01 ?? '').trim()
  if (!Number.isFinite(orderId) || orderId <= 0 || !code) return ''
  const url = new URL('/inventory/basic/pi-bom-data-window', window.location.origin)
  url.searchParams.set('mode', mode === 'edit' ? 'edit' : 'view')
  url.searchParams.set('orderId', String(orderId))
  url.searchParams.set('kcaa01', code)
  const piNo = String(row?.piNo ?? '').trim()
  if (piNo) url.searchParams.set('piNo', piNo)
  return `${url.pathname}${url.search}`
}

function guardPiBomStandaloneLink(ev, mode, row) {
  const href = buildPiBomStandaloneHref(mode, row)
  if (href) return
  ev?.preventDefault?.()
  ElMessage.warning(
    mode === 'edit' ? '缺少订单ID或编码，无法编辑PI-BOM' : '缺少订单ID或编码，无法查看PI-BOM',
  )
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: String(keyword.value ?? '').trim() || undefined,
    }
    const res = await axios.get('/api/inventory/pi-bom-data/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    tableList.value = Array.isArray(data.list) ? data.list : []
  } catch (e) {
    errorMessage.value = String(e?.response?.data?.msg ?? e?.message ?? '网络错误')
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  keyword.value = ''
  page.value = 1
  loadData()
}

function onPageChange(p) {
  page.value = p
  loadData()
}

function onPageSizeChange(ps) {
  pageSize.value = ps
  page.value = 1
  loadData()
}

async function onMaterialReplaced() {
  if (pageMode.value === 'list') await loadData()
}

loadData()
</script>

<style scoped>
.page-title {
  font-size: 18px;
  font-weight: 600;
}

.pi-bom-mode-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
}

.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.keyword-input {
  width: min(420px, 100%);
}

.btn-view {
  margin-left: auto;
}

.btn-icon {
  margin-right: 4px;
}

.error-alert {
  margin-bottom: 12px;
}
</style>
