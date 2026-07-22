<template>
  <div class="erp-module-page">
    <!--
      仓库编码（UB_ERP_Stocks_warehouse）：标准件列表；未审可编辑；已审须先反审；
      回收站可恢复；无导入/打印/彻底删除。
    -->
    <el-card shadow="never">
      <div class="search-row">
        <el-input
          v-model="keyword"
          placeholder="按编码、名称、备注、参管人员编码模糊搜索"
          clearable
          style="max-width: 360px"
          @keyup.enter="onSearch"
        />
        <div class="audit-switch">
          <span class="switch-label">回收站</span>
          <el-switch v-model="showRecycle" @change="onRecycleChange" />
        </div>
        <div v-if="!showRecycle" class="audit-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" @change="onSearch" />
        </div>
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <el-button v-if="!showRecycle" v-permission="'add'" type="success" plain @click="openCreateDialog">
          新增仓库
        </el-button>
        <el-button
          v-if="!showRecycle && showUnAudited"
          v-permission="'audit'"
          type="success"
          plain
          :loading="batchAuditing"
          @click="onBatchAudit"
        >
          批量审核
        </el-button>
        <el-button
          v-if="!showRecycle"
          v-permission="'export'"
          type="warning"
          plain
          :loading="exporting"
          @click="onExport"
        >
          导出当前列表
        </el-button>
        <el-button class="btn-view" :loading="loading" @click="loadData">
          <el-icon class="btn-icon"><Refresh /></el-icon>
          刷新
        </el-button>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：仅显示已逻辑删除（del=1）的记录，可进行恢复。"
        type="info"
        show-icon
        class="audit-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核（pass=0）的仓库编码；已审核记录请关闭本开关查看。"
        type="warning"
        show-icon
        class="audit-alert"
      />

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

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            v-erp-list-h-scroll
            class="erp-list-table"
            :data="tableList"
            border
            stripe
            row-key="systemcode"
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
            @row-contextmenu="onErpListRowContextMenu"
          >
            <el-table-column prop="code" label="仓库编码" min-width="110" align="center" header-align="center">
              <template #default="{ row }">
                <span class="code-bold">{{ row.code || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="name" label="仓库名称" min-width="140" align="center" header-align="center" />
            <el-table-column prop="info2" label="库存预警" width="100" align="center" header-align="center">
              <template #default="{ row }">{{ row.info2 || '—' }}</template>
            </el-table-column>
            <el-table-column label="允许负数出仓" width="120" align="center" header-align="center">
              <template #default="{ row }">{{ yesNoText(row.negative) }}</template>
            </el-table-column>
            <el-table-column label="参与盘点" width="90" align="center" header-align="center">
              <template #default="{ row }">{{ yesNoText(row.pd) }}</template>
            </el-table-column>
            <el-table-column label="参与扣数" width="90" align="center" header-align="center">
              <template #default="{ row }">{{ yesNoText(row.ks) }}</template>
            </el-table-column>
            <el-table-column label="参管人员" min-width="160" align="center" header-align="center" show-overflow-tooltip>
              <template #default="{ row }">{{ row.managerNames || row.etname || '—' }}</template>
            </el-table-column>
            <el-table-column label="LOGO" width="90" align="center" header-align="center">
              <template #default="{ row }">
                <el-button v-if="row.logo" link type="primary" @click="openLogoPreview(row)">查看</el-button>
                <span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column prop="info" label="备注" min-width="140" align="center" header-align="center" show-overflow-tooltip />
            <el-table-column label="审核" width="100" align="center" header-align="center">
              <template #default="{ row }">
                <el-tag v-if="passLabel(row) === '已审核'" type="success" size="small">已审核</el-tag>
                <el-tag v-else-if="passLabel(row) === '未审核'" type="warning" size="small">未审核</el-tag>
                <el-tag v-else type="info" size="small">{{ passLabel(row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column
              label="操作"
              :width="actionsColWidth"
              fixed="right"
              align="center"
              class-name="erp-col-actions"
            >
              <template #default="{ row }">
                <ErpTableActions>
                  <template v-if="showRecycle">
                    <el-button
                      type="primary"
                      plain
                      :loading="busyKey === row.systemcode"
                      @click="onRestore(row)"
                    >
                      恢复
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button type="info" plain @click="openDetailDialog(row)">查看详细</el-button>
                    <el-button
                      v-if="showUnAudited"
                      v-permission="'edit'"
                      type="primary"
                      plain
                      :disabled="passIsAudited(row)"
                      :loading="busyKey === row.systemcode"
                      @click="openEditDialog(row)"
                    >
                      编辑
                    </el-button>
                    <el-button
                      v-if="showUnAudited && !passIsAudited(row)"
                      v-permission="'audit'"
                      type="success"
                      plain
                      :loading="busyKey === row.systemcode"
                      @click="onAudit(row)"
                    >
                      审核
                    </el-button>
                    <el-button
                      v-if="!showUnAudited && passIsAudited(row)"
                      v-permission="'unaudit'"
                      type="warning"
                      plain
                      :loading="busyKey === row.systemcode"
                      @click="onUnaudit(row)"
                    >
                      反审
                    </el-button>
                    <el-button
                      v-if="showUnAudited"
                      v-permission="'delete'"
                      type="danger"
                      plain
                      :disabled="passIsAudited(row)"
                      :loading="busyKey === row.systemcode"
                      @click="onSoftDelete(row)"
                    >
                      删除
                    </el-button>
                  </template>
                </ErpTableActions>
              </template>
            </el-table-column>
          </el-table>

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
    </el-card>

    <!-- 新增 / 编辑 -->
    <el-dialog
      v-model="formVisible"
      :title="formMode === 'create' ? '新增仓库编码' : '编辑仓库编码'"
      width="720px"
      destroy-on-close
      @closed="resetForm"
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="140px">
        <el-form-item v-if="formMode === 'edit'" label="系统唯一标识">
          <el-input :model-value="form.systemcode" disabled />
        </el-form-item>
        <el-form-item label="仓库编码" prop="code">
          <el-input
            v-model="form.code"
            maxlength="50"
            show-word-limit
            placeholder="必填"
            :disabled="formMode === 'edit'"
          />
        </el-form-item>
        <el-form-item label="仓库名称" prop="name">
          <el-input v-model="form.name" maxlength="50" show-word-limit placeholder="必填" />
        </el-form-item>
        <el-form-item label="库存预警值" prop="info2">
          <el-input v-model="form.info2" maxlength="50" show-word-limit placeholder="选填" />
        </el-form-item>
        <el-form-item label="允许负数出仓" prop="negative">
          <el-radio-group v-model="form.negative" @change="onNegativeChange">
            <el-radio :label="0">否</el-radio>
            <el-radio :label="1">是</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-alert
          v-if="Number(form.negative) === 1"
          type="error"
          show-icon
          :closable="false"
          class="negative-warn"
          title="警告：允许负数出仓仅适用于物料已到尚未入库、紧急出库或特殊临时处理；特殊处理结束后应改回「否」。"
        />
        <el-form-item label="参与盘点" prop="pd">
          <el-radio-group v-model="form.pd">
            <el-radio :label="0">否</el-radio>
            <el-radio :label="1">是</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="参与扣数" prop="ks">
          <el-radio-group v-model="form.ks">
            <el-radio :label="0">否</el-radio>
            <el-radio :label="1">是</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="参管人员">
          <div class="manager-row">
            <el-input :model-value="form.etname || form.ename" type="textarea" :rows="2" disabled placeholder="尚未选择" />
            <el-button type="primary" plain @click="openManagerPicker">选择人员</el-button>
            <el-button @click="clearManagers">清空</el-button>
          </div>
        </el-form-item>
        <el-form-item label="LOGO（HTML）">
          <el-input
            v-model="form.logo"
            type="textarea"
            :rows="3"
            maxlength="800"
            show-word-limit
            placeholder="选填；留空则新增时保留库默认 LOGO，编辑时不改动原 LOGO"
            @input="formLogoTouched = true"
          />
        </el-form-item>
        <el-form-item label="备注" prop="info">
          <el-input v-model="form.info" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" :loading="formSubmitting" @click="submitForm">
          {{ formMode === 'create' ? '提交' : '保存' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 查看详细 -->
    <el-dialog v-model="detailVisible" title="仓库编码详情" width="720px" destroy-on-close>
      <el-descriptions v-if="detailRow" :column="2" border>
        <el-descriptions-item label="系统唯一标识" :span="2">{{ detailRow.systemcode || '—' }}</el-descriptions-item>
        <el-descriptions-item label="仓库编码">{{ detailRow.code || '—' }}</el-descriptions-item>
        <el-descriptions-item label="仓库名称">{{ detailRow.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="库存预警">{{ detailRow.info2 || '—' }}</el-descriptions-item>
        <el-descriptions-item label="允许负数出仓">{{ yesNoText(detailRow.negative) }}</el-descriptions-item>
        <el-descriptions-item label="参与盘点">{{ yesNoText(detailRow.pd) }}</el-descriptions-item>
        <el-descriptions-item label="参与扣数">{{ yesNoText(detailRow.ks) }}</el-descriptions-item>
        <el-descriptions-item label="参管人员" :span="2">
          {{ detailRow.managerNames || detailRow.etname || '—' }}
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detailRow.info || '—' }}</el-descriptions-item>
        <el-descriptions-item label="审核状态">{{ passLabel(detailRow) }}</el-descriptions-item>
        <el-descriptions-item label="添加时间">{{ detailRow.addtime || '—' }}</el-descriptions-item>
        <el-descriptions-item label="LOGO" :span="2">
          <div v-if="detailRow.logo" class="logo-preview" v-html="detailRow.logo" />
          <span v-else>—</span>
        </el-descriptions-item>
      </el-descriptions>
      <template #footer>
        <el-button type="primary" @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- LOGO 预览 -->
    <el-dialog v-model="logoPreviewVisible" title="LOGO 预览" width="520px" destroy-on-close>
      <div class="logo-preview" v-html="logoPreviewHtml" />
    </el-dialog>

    <!-- 参管人员选择 -->
    <el-dialog v-model="managerVisible" title="选择参管人员" width="640px" destroy-on-close @open="loadManagers">
      <div class="search-row">
        <el-input
          v-model="managerKeyword"
          placeholder="按账号编码或姓名模糊搜索"
          clearable
          style="max-width: 280px"
          @keyup.enter="onManagerSearch"
        />
        <el-button type="primary" @click="onManagerSearch">查询</el-button>
      </div>
      <el-table
        ref="managerTableRef"
        v-loading="managerLoading"
        :data="managerList"
        border
        stripe
        row-key="usercode"
        height="360"
        @selection-change="onManagerSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="usercode" label="账号编码" min-width="120" />
        <el-table-column prop="truename" label="姓名" min-width="140" />
      </el-table>
      <div class="pagination-row pagination-row--bottom">
        <el-pagination
          background
          layout="total, sizes, prev, pager, next"
          :total="managerTotal"
          :current-page="managerPage"
          :page-size="managerPageSize"
          :page-sizes="ERP_PAGE_SIZE_OPTIONS"
          @size-change="onManagerPageSizeChange"
          @current-change="onManagerPageChange"
        />
      </div>
      <template #footer>
        <el-button @click="managerVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmManagers">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { ref, computed, nextTick } from 'vue'
import axios from 'axios'
import ExcelJS from 'exceljs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'

const { onErpListRowContextMenu } = useErpListRowContextMenu()

const loading = ref(false)
const errorMessage = ref('')
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const showUnAudited = ref(false)
const showRecycle = ref(false)
const busyKey = ref('')
const batchAuditing = ref(false)
const exporting = ref(false)

const MENU_PATH = 'inventory/basic/warehouse'
const permissionModel = getPermissionModelFromStorage()

const actionsColWidth = computed(() =>
  getErpTableActionsColWidthByRows(tableList.value, getRowActionLabels, { fallbackLabels: [] }),
)

function getRowActionLabels(row) {
  if (showRecycle.value) return ['恢复']
  const labels = ['查看详细']
  if (showUnAudited.value) {
    if (hasPageAction(permissionModel, MENU_PATH, 'edit')) labels.push('编辑')
    if (!passIsAudited(row) && hasPageAction(permissionModel, MENU_PATH, 'audit')) labels.push('审核')
    if (hasPageAction(permissionModel, MENU_PATH, 'delete')) labels.push('删除')
  } else if (passIsAudited(row) && hasPageAction(permissionModel, MENU_PATH, 'unaudit')) {
    labels.push('反审')
  }
  return labels
}

function passIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

function passLabel(row) {
  const p = String(row?.pass ?? '').trim()
  if (p === '1') return '已审核'
  if (p === '0' || p === '') return '未审核'
  if (p === '2') return '审核不通过'
  if (p === '3') return '有效'
  return `状态${p}`
}

function yesNoText(v) {
  return Number(v) === 1 ? '是' : '否'
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const pass = showUnAudited.value ? '0' : '1'
    const kw = String(keyword.value ?? '').trim()
    const params = {
      page: page.value,
      pageSize: pageSize.value,
      ...(showRecycle.value ? { recycled: '1' } : { pass }),
      ...(kw ? { keyword: kw } : {}),
    }
    const res = await axios.get('/api/inventory/warehouse/list', { params })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = body?.msg || '加载失败'
      tableList.value = []
      total.value = 0
      return
    }
    const data = body.data ?? {}
    total.value = Number(data.total ?? 0)
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
  showUnAudited.value = false
  showRecycle.value = false
  page.value = 1
  loadData()
}

function onRecycleChange() {
  if (showRecycle.value) showUnAudited.value = false
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

/* ---------- 表单 ---------- */
const formVisible = ref(false)
const formMode = ref('create')
const formSubmitting = ref(false)
const formRef = ref()
const form = ref(emptyForm())
const formLogoTouched = ref(false)

function emptyForm() {
  return {
    systemcode: '',
    code: '',
    name: '',
    info2: '',
    negative: 0,
    pd: 0,
    ks: 0,
    ename: '',
    etname: '',
    logo: '',
    info: '',
  }
}

const formRules = {
  code: [{ required: true, message: '请输入仓库编码', trigger: 'blur' }],
  name: [{ required: true, message: '请输入仓库名称', trigger: 'blur' }],
}

function resetForm() {
  form.value = emptyForm()
  formLogoTouched.value = false
  formRef.value?.resetFields?.()
}

function openCreateDialog() {
  formMode.value = 'create'
  resetForm()
  formVisible.value = true
}

function openEditDialog(row) {
  formMode.value = 'edit'
  form.value = {
    systemcode: String(row?.systemcode ?? '').trim(),
    code: String(row?.code ?? '').trim(),
    name: String(row?.name ?? '').trim(),
    info2: String(row?.info2 ?? '').trim(),
    negative: Number(row?.negative) === 1 ? 1 : 0,
    pd: Number(row?.pd) === 1 ? 1 : 0,
    ks: Number(row?.ks) === 1 ? 1 : 0,
    ename: String(row?.ename ?? '').trim(),
    etname: String(row?.etname ?? row?.managerNames ?? '').trim(),
    logo: String(row?.logo ?? ''),
    info: String(row?.info ?? '').trim(),
  }
  formLogoTouched.value = false
  formVisible.value = true
}

function onNegativeChange(val) {
  if (Number(val) === 1) {
    ElMessage.warning('允许负数出仓仅用于紧急/临时场景，特殊处理结束后请改回「否」。')
  }
}

async function submitForm() {
  const el = formRef.value
  if (!el) return
  try {
    await el.validate()
  } catch {
    return
  }
  formSubmitting.value = true
  try {
    const payload = {
      name: String(form.value.name ?? '').trim(),
      info2: String(form.value.info2 ?? '').trim(),
      negative: Number(form.value.negative) === 1 ? 1 : 0,
      pd: Number(form.value.pd) === 1 ? 1 : 0,
      ks: Number(form.value.ks) === 1 ? 1 : 0,
      ename: String(form.value.ename ?? '').trim(),
      etname: String(form.value.etname ?? '').trim(),
      info: String(form.value.info ?? '').trim(),
    }
    // 未提交新 LOGO 时不传 logo，避免覆盖库默认值/原值
    if (formMode.value === 'create') {
      payload.code = String(form.value.code ?? '').trim()
      if (String(form.value.logo ?? '').trim()) payload.logo = String(form.value.logo).trim()
      const res = await axios.post('/api/inventory/warehouse', payload)
      if (res.data?.code === 200) {
        ElMessage.success('新增成功')
        formVisible.value = false
        showUnAudited.value = true
        await loadData()
      } else {
        ElMessage.error(res.data?.msg || '新增失败')
      }
    } else {
      payload.systemcode = String(form.value.systemcode ?? '').trim()
      if (formLogoTouched.value) payload.logo = String(form.value.logo ?? '')
      const res = await axios.put('/api/inventory/warehouse', payload)
      if (res.data?.code === 200) {
        ElMessage.success('保存成功')
        formVisible.value = false
        await loadData()
      } else {
        ElMessage.error(res.data?.msg || '保存失败')
      }
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    formSubmitting.value = false
  }
}

/* ---------- 详情 / LOGO ---------- */
const detailVisible = ref(false)
const detailRow = ref(null)
const logoPreviewVisible = ref(false)
const logoPreviewHtml = ref('')

async function openDetailDialog(row) {
  const systemcode = String(row?.systemcode ?? '').trim()
  if (!systemcode) return
  try {
    const res = await axios.get(`/api/inventory/warehouse/${encodeURIComponent(systemcode)}`)
    if (res.data?.code === 200) {
      detailRow.value = res.data.data
      detailVisible.value = true
    } else {
      ElMessage.error(res.data?.msg || '加载详情失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载详情失败'))
  }
}

function openLogoPreview(row) {
  logoPreviewHtml.value = String(row?.logo ?? '')
  logoPreviewVisible.value = true
}

/* ---------- 参管人员 ---------- */
const managerVisible = ref(false)
const managerLoading = ref(false)
const managerList = ref([])
const managerTotal = ref(0)
const managerPage = ref(1)
const managerPageSize = ref(20)
const managerKeyword = ref('')
const managerSelected = ref([])
const managerTableRef = ref()
/** 跨页已选：usercode → truename */
const managerPickedMap = ref(new Map())

function openManagerPicker() {
  managerPickedMap.value = new Map()
  const codes = String(form.value.ename ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
  const names = String(form.value.etname ?? '')
    .split(/[,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  codes.forEach((c, i) => managerPickedMap.value.set(c, names[i] || c))
  managerKeyword.value = ''
  managerPage.value = 1
  managerVisible.value = true
}

function clearManagers() {
  form.value.ename = ''
  form.value.etname = ''
}

async function loadManagers() {
  managerLoading.value = true
  try {
    const kw = String(managerKeyword.value ?? '').trim()
    const res = await axios.get('/api/inventory/warehouse/user-options', {
      params: {
        page: managerPage.value,
        pageSize: managerPageSize.value,
        ...(kw ? { keyword: kw } : {}),
      },
    })
    if (res.data?.code !== 200) {
      ElMessage.error(res.data?.msg || '加载人员失败')
      managerList.value = []
      managerTotal.value = 0
      return
    }
    const data = res.data.data ?? {}
    managerTotal.value = Number(data.total ?? 0)
    managerList.value = Array.isArray(data.list) ? data.list : []
    await nextTick()
    const table = managerTableRef.value
    if (table) {
      table.clearSelection()
      for (const row of managerList.value) {
        if (managerPickedMap.value.has(row.usercode)) {
          table.toggleRowSelection(row, true)
        }
      }
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载人员失败'))
  } finally {
    managerLoading.value = false
  }
}

function onManagerSearch() {
  managerPage.value = 1
  loadManagers()
}

function onManagerPageChange(p) {
  managerPage.value = p
  loadManagers()
}

function onManagerPageSizeChange(ps) {
  managerPageSize.value = ps
  managerPage.value = 1
  loadManagers()
}

function onManagerSelectionChange(rows) {
  managerSelected.value = Array.isArray(rows) ? rows : []
  // 同步当前页勾选到跨页 Map：先清当前页编码，再写入勾选
  for (const row of managerList.value) {
    managerPickedMap.value.delete(row.usercode)
  }
  for (const row of managerSelected.value) {
    managerPickedMap.value.set(row.usercode, row.truename || row.usercode)
  }
}

function confirmManagers() {
  const codes = [...managerPickedMap.value.keys()]
  const names = [...managerPickedMap.value.values()]
  form.value.ename = codes.length ? `${codes.join(';')};` : ''
  form.value.etname = names.join(',')
  managerVisible.value = false
}

/* ---------- 审核 / 删除 / 恢复 ---------- */
async function onAudit(row) {
  const systemcode = String(row?.systemcode ?? '').trim()
  if (!systemcode) return
  try {
    await ElMessageBox.confirm(
      `确定审核仓库「${row.name || row.code}」吗？审核后将出现在默认（已审核）列表中。`,
      '确认审核',
      { type: 'warning' },
    )
  } catch {
    return
  }
  busyKey.value = systemcode
  try {
    const res = await axios.put('/api/inventory/warehouse/audit', { systemcode })
    if (res.data?.code === 200) {
      ElMessage.success('审核成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '审核失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '审核失败'))
  } finally {
    busyKey.value = ''
  }
}

async function onUnaudit(row) {
  const systemcode = String(row?.systemcode ?? '').trim()
  if (!systemcode) return
  try {
    await ElMessageBox.confirm(
      `确定反审仓库「${row.name || row.code}」吗？反审后可再编辑或删除。`,
      '确认反审',
      { type: 'warning' },
    )
  } catch {
    return
  }
  busyKey.value = systemcode
  try {
    const res = await axios.put('/api/inventory/warehouse/unaudit', { systemcode })
    if (res.data?.code === 200) {
      ElMessage.success('反审成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '反审失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '反审失败'))
  } finally {
    busyKey.value = ''
  }
}

async function onBatchAudit() {
  try {
    await ElMessageBox.confirm(
      '将把所有未删除且未审核的仓库编码一次性审核通过，是否继续？',
      '批量审核',
      { type: 'warning', confirmButtonText: '确定批量审核', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  batchAuditing.value = true
  try {
    const res = await axios.put('/api/inventory/warehouse/audit-batch')
    if (res.data?.code === 200) {
      const n = Number(res.data?.data?.affected ?? 0)
      ElMessage.success(`批量审核完成，实际处理 ${n} 条`)
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '批量审核失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '批量审核失败'))
  } finally {
    batchAuditing.value = false
  }
}

async function onSoftDelete(row) {
  const systemcode = String(row?.systemcode ?? '').trim()
  if (!systemcode) return
  try {
    await ElMessageBox.confirm(
      `确定逻辑删除仓库「${row.name || row.code}」吗？删除后可在「回收站」中恢复（已审核的需先反审）。`,
      '确认删除',
      { type: 'warning' },
    )
  } catch {
    return
  }
  busyKey.value = systemcode
  try {
    const res = await axios.delete(`/api/inventory/warehouse/${encodeURIComponent(systemcode)}`)
    if (res.data?.code === 200) {
      ElMessage.success('已移入回收站')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '删除失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    busyKey.value = ''
  }
}

async function onRestore(row) {
  const systemcode = String(row?.systemcode ?? '').trim()
  if (!systemcode) return
  try {
    await ElMessageBox.confirm(
      `确定恢复仓库「${row.name || row.code}」吗？恢复后将回到在册列表（按审核状态筛选）。`,
      '确认恢复',
      { type: 'warning' },
    )
  } catch {
    return
  }
  busyKey.value = systemcode
  try {
    const res = await axios.put('/api/inventory/warehouse/restore', { systemcode })
    if (res.data?.code === 200) {
      ElMessage.success('恢复成功')
      await loadData()
    } else {
      ElMessage.error(res.data?.msg || '恢复失败')
    }
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '恢复失败'))
  } finally {
    busyKey.value = ''
  }
}

/* ---------- 导出 ---------- */
async function onExport() {
  if (!tableList.value.length) {
    ElMessage.warning('当前列表无数据可导出')
    return
  }
  exporting.value = true
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('仓库编码')
    ws.addRow([
      '仓库编码',
      '仓库名称',
      '库存预警',
      '允许负数出仓',
      '参与盘点',
      '参与扣数',
      '参管人员',
      '备注',
      '审核状态',
    ])
    for (const row of tableList.value) {
      ws.addRow([
        row.code || '',
        row.name || '',
        row.info2 || '',
        yesNoText(row.negative),
        yesNoText(row.pd),
        yesNoText(row.ks),
        row.managerNames || row.etname || '',
        row.info || '',
        passLabel(row),
      ])
    }
    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `仓库编码_${new Date().toISOString().slice(0, 10)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已导出当前页列表')
  } catch (e) {
    ElMessage.error(String(e?.message ?? '导出失败'))
  } finally {
    exporting.value = false
  }
}

loadData()
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.btn-view {
  margin-left: auto;
}
.btn-icon {
  margin-right: 4px;
}
.error-alert,
.audit-alert,
.negative-warn {
  margin-bottom: 12px;
}
.code-bold {
  font-weight: 700;
}
.manager-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.logo-preview {
  max-width: 100%;
  overflow: auto;
  line-height: 1.4;
}
.logo-preview :deep(img) {
  max-width: 100%;
  height: auto;
}
.pagination-row {
  display: flex;
  justify-content: flex-end;
  margin: 8px 0;
}
</style>
