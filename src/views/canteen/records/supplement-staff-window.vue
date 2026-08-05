<template>
  <div class="supplement-staff-window">
    <header class="window-header">
      <div>
        <h1>打卡消费补录批量添加</h1>
        <p>按姓名或卡号查询，可跨页选择；本张补录单最多 {{ maxStaff }} 人。保存时会按补录日期与餐别跳过已刷卡或待审补录人员。</p>
      </div>
      <el-button @click="closeWindow">关闭</el-button>
    </header>

    <el-card shadow="never" class="search-card">
      <div class="search-row">
        <el-input v-model="keywordInput" clearable placeholder="员工编码 / 姓名 / 新卡号 / 旧卡号" @keyup.enter="search" />
        <el-button type="primary" @click="search">查询</el-button>
        <el-button @click="resetSearch">重置</el-button>
        <el-button type="primary" :loading="saving" :disabled="!pickedRows.size || submitted" @click="saveSelected">保存已选人员</el-button>
        <el-button :disabled="!pickedRows.size || saving" @click="clearSelection">全部重选</el-button>
        <span class="selected-count">新选 {{ pickedRows.size }} 人，明细已有 {{ existingIds.size }} 人</span>
      </div>
    </el-card>

    <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon :closable="false" />
    <el-alert v-if="closeHint" :title="closeHint" type="success" show-icon :closable="false" />

    <el-card v-loading="loading" shadow="never">
      <el-table v-erp-list-h-scroll :data="rows" row-key="id" border stripe class="erp-list-table">
        <el-table-column label="操作" fixed="left" width="110">
          <template #default="{ row }">
            <el-button size="small" :type="buttonType(row)" :disabled="existingIds.has(row.id)" @click="togglePick(row)">
              {{ buttonLabel(row) }}
            </el-button>
          </template>
        </el-table-column>
        <el-table-column prop="employeeCode" label="员工编码" min-width="140" />
        <el-table-column prop="employeeName" label="姓名" min-width="120" />
        <el-table-column prop="cardNumber" label="显示卡号" min-width="150" />
        <el-table-column prop="newCardNumber" label="新卡号" min-width="150"><template #default="{ row }">{{ row.newCardNumber || '—' }}</template></el-table-column>
        <el-table-column prop="oldCardNumber" label="旧卡号" min-width="150"><template #default="{ row }">{{ row.oldCardNumber || '—' }}</template></el-table-column>
        <el-table-column prop="employeeMealType" label="员工餐类" min-width="110" />
      </el-table>
      <el-empty v-if="!loading && !rows.length" description="没有符合条件的员工" />
      <div class="pagination-row">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :current-page="page"
          :page-size="pageSize"
          :page-sizes="ERP_PAGE_SIZE_OPTIONS"
          @current-change="changePage"
          @size-change="changePageSize"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { checkDiningSupplementStaff, getDiningSupplementStaff } from '@/api/diningRecordsApi'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import {
  DINING_SUPPLEMENT_MSG_APPLY,
  readDiningSupplementContext,
  writeDiningSupplementResult,
} from '@/utils/diningSupplementBatch'

defineOptions({ name: 'canteen-records-supplement-staff-window' })

const route = useRoute()
const sessionId = computed(() => String(route.query?.sessionId || '').trim())
const keywordInput = ref('')
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const rows = ref([])
const loading = ref(false)
const saving = ref(false)
const submitted = ref(false)
const errorMsg = ref('')
const closeHint = ref('')
const existingIds = ref(new Set())
const pickedRows = ref(new Map())
const maxStaff = ref(500)
const supplementDate = ref('')
const supplementMealType = ref('')

function isPicked(row) { return pickedRows.value.has(Number(row.id)) }
function buttonLabel(row) {
  if (existingIds.value.has(Number(row.id))) return '已在明细'
  return isPicked(row) ? '已选择' : '选择'
}
function buttonType(row) {
  if (existingIds.value.has(Number(row.id))) return 'info'
  return isPicked(row) ? 'success' : 'warning'
}
function togglePick(row) {
  const id = Number(row.id)
  if (!id || existingIds.value.has(id)) return
  if (pickedRows.value.has(id)) pickedRows.value.delete(id)
  else {
    if (existingIds.value.size + pickedRows.value.size >= maxStaff.value) return ElMessage.warning(`一张补录单最多添加${maxStaff.value}人`)
    pickedRows.value.set(id, JSON.parse(JSON.stringify(row)))
  }
  pickedRows.value = new Map(pickedRows.value)
}
function clearSelection() { pickedRows.value = new Map() }
function closeWindow() { window.close() }

function skippedText(items) {
  return (Array.isArray(items) ? items : []).slice(0, 20).map((item) => `${item.employeeName}：${item.reason}`).join('\n')
}

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const response = await getDiningSupplementStaff({ keyword: keyword.value, page: page.value, pageSize: pageSize.value })
    const data = response.data?.data || {}
    rows.value = Array.isArray(data.list) ? data.list : []
    total.value = Number(data.total || 0)
  } catch (error) {
    errorMsg.value = String(error?.response?.data?.msg || '').trim() || '查询员工失败'
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}
function search() { keyword.value = String(keywordInput.value || '').trim(); page.value = 1; load() }
function resetSearch() { keywordInput.value = ''; keyword.value = ''; page.value = 1; load() }
function changePage(value) { page.value = value; load() }
function changePageSize(value) { pageSize.value = value; page.value = 1; load() }

async function saveSelected() {
  if (!pickedRows.value.size || submitted.value || saving.value) return
  if (!supplementDate.value || !supplementMealType.value) {
    ElMessage.error('补录日期或餐别缺失，请关闭后从打卡消费补录页重新打开批量添加')
    return
  }

  saving.value = true
  try {
    const staffIds = [...pickedRows.value.keys()]
    const response = await checkDiningSupplementStaff({
      date: supplementDate.value,
      mealType: supplementMealType.value,
      staffIds,
    })
    const data = response.data?.data || {}
    const skipped = Array.isArray(data.skipped) ? data.skipped : []
    const allowedIds = new Set((Array.isArray(data.allowed) ? data.allowed : []).map((item) => Number(item.id)).filter(Boolean))
    const allowedRows = [...pickedRows.value.values()].filter((row) => allowedIds.has(Number(row.id)))

    if (skipped.length) {
      const detail = skippedText(skipped)
      const more = skipped.length > 20 ? `\n……等共 ${skipped.length} 人` : ''
      await ElMessageBox.alert(
        `以下人员已无法补录，已自动跳过：\n${detail}${more}`,
        '部分人员已跳过',
        { type: 'warning', confirmButtonText: '知道了' },
      )
    }

    if (!allowedRows.length) {
      ElMessage.warning('所选员工均已无法补录，请重新选择')
      return
    }

    const payload = {
      type: DINING_SUPPLEMENT_MSG_APPLY,
      sessionId: sessionId.value,
      rows: allowedRows,
    }
    const resultSaved = writeDiningSupplementResult(sessionId.value, payload)
    const opener = window.opener
    if ((!opener || opener.closed) && !resultSaved) {
      ElMessage.error('无法把已选人员带回补录页面，请关闭后重新打开批量添加')
      return
    }

    submitted.value = true
    closeHint.value = `正在带回 ${allowedRows.length} 名员工...`
    if (opener && !opener.closed) opener.postMessage(payload, window.location.origin)
    // 同站点共享结果是兜底通道，即使浏览器切断父子窗口关系，补录页仍能收到人员。
    setTimeout(() => window.close(), 500)
  } catch (error) {
    ElMessage.error(String(error?.response?.data?.msg || error?.message || '').trim() || '校验已选人员失败')
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  const context = readDiningSupplementContext(sessionId.value)
  if (!context) {
    errorMsg.value = '会话已失效，请从打卡消费补录页面重新打开批量添加'
    return
  }
  const date = String(context.date || '').trim()
  const mealType = String(context.mealType || '').trim()
  if (!date || !mealType) {
    errorMsg.value = '补录日期或餐别缺失，请先在打卡消费补录页选择后再打开批量添加'
    return
  }
  supplementDate.value = date
  supplementMealType.value = mealType
  existingIds.value = new Set((context.existingIds || []).map(Number).filter(Boolean))
  maxStaff.value = Number(context.maxStaff || 500)
  load()
})
</script>

<style scoped>
.supplement-staff-window { min-height: 100vh; padding: 18px; background: #f5f7fa; box-sizing: border-box; }
.window-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.window-header h1 { margin: 0 0 6px; font-size: 22px; color: #1f2937; }
.window-header p { margin: 0; color: #64748b; }
.search-card { margin-bottom: 16px; }
.search-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.search-row .el-input { width: min(360px, 100%); }
.selected-count { color: #475569; }
.el-alert { margin-bottom: 14px; }
.pagination-row { display: flex; justify-content: flex-start; margin-top: 14px; }
@media (max-width: 760px) { .supplement-staff-window { padding: 10px; } .window-header { flex-direction: column; } .search-row .el-input { width: 100%; } .pagination-row :deep(.el-pagination) { flex-wrap: wrap; row-gap: 8px; } }
</style>
