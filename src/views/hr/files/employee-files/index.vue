<template>
  <div class="erp-module-page">
    <!--
      v1.0.9 人事档案精简管理（UB_ERP_Hr_staff）
      - 只加载有效字段：code/name/sex/in_bm/card_number/meal_type/yn_history/intime/pass 等
      - 搜索：部门下拉（左侧，默认全部）+ 姓名/工号/卡号关键词；点「查询」才刷新
      - pass='1'：禁用编辑/删除；审核/反审互斥
      - card_number 不足 10 位：红字提示
    -->
    <div class="staff-files-mode-bar erp-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理员工档案</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && dialogMode === 'create' ? 'primary' : 'default'" plain @click="openCreate">
        员工档案添加
      </el-button>
    </div>

    <el-card v-show="pageMode === 'list'" shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>

      <div class="search-row erp-filter-row">
        <el-select
          v-model="filterDeptSystemcode"
          class="staff-filter-dept"
          clearable
          filterable
          placeholder="全部部门"
        >
          <el-option
            v-for="d in deptOptions"
            :key="String(d.systemcode ?? '')"
            :label="String(d.name ?? '')"
            :value="String(d.systemcode ?? '')"
          />
        </el-select>
        <el-input
          v-model="keyword"
          class="staff-filter-keyword"
          placeholder="姓名 / 工号 / 卡号"
          clearable
          @keyup.enter="onSearch"
        />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <div class="staff-filter-divider erp-filter-divider" aria-hidden="true" />
        <div class="staff-filter-switch erp-filter-switch">
          <span class="switch-label">显示未审核</span>
          <el-switch v-model="showUnAudited" :disabled="showLeaved" />
        </div>
        <div class="staff-filter-divider erp-filter-divider" aria-hidden="true" />
        <div class="staff-filter-switch erp-filter-switch">
          <span class="switch-label">显示离职员工</span>
          <el-switch v-model="showLeaved" title="开启后仅列出 del=1 的离职员工；关闭则只看在职（del=0）" />
        </div>
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
          <el-table
            v-erp-list-h-scroll
            :data="tableList"
            row-key="code"
            border
            stripe
            class="erp-list-table"
            :empty-text="loading ? '加载中…' : '暂无数据'"
           @row-contextmenu="onErpListRowContextMenu">
            <el-table-column label="操作" :width="staffActionsColWidth" fixed="left" class-name="erp-col-actions">
              <template #default="{ row }">
                <ErpTableActions>
                  <el-button type="info" plain @click="openView(row)">查看</el-button>
                  <el-button
                    v-permission="'edit'"
                    type="primary"
                    plain
                    v-if="showLeaved"
                    @click="confirmRestore(row)"
                  >
                    恢复在职
                  </el-button>
                  <el-button
                    v-permission="'edit'"
                    type="primary"
                    plain
                    v-if="!showLeaved && showUnAudited"
                    :disabled="rowIsAudited(row)"
                    @click="openEdit(row)"
                  >
                    编辑
                  </el-button>
                  <el-button
                    v-permission="'delete'"
                    type="danger"
                    plain
                    v-if="!showLeaved"
                    @click="confirmLeave(row)"
                  >
                    办理离职
                  </el-button>
                  <el-button
                    v-permission="'audit'"
                    type="success"
                    plain
                    v-if="!showLeaved && showUnAudited && !rowIsAudited(row)"
                    @click="doAudit(row)"
                  >
                    审核
                  </el-button>
                  <el-button
                    v-permission="'unaudit'"
                    type="warning"
                    plain
                    v-if="!showLeaved && !showUnAudited && rowIsAudited(row)"
                    @click="doUnaudit(row)"
                  >
                    反审
                  </el-button>
                </ErpTableActions>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="125" show-overflow-tooltip>
              <template #default="{ row }">{{ staffStatusText(row) }}</template>
            </el-table-column>
            <el-table-column prop="name" label="姓名" min-width="110" show-overflow-tooltip />
            <el-table-column prop="code" label="旧工号" min-width="110" show-overflow-tooltip />
            <el-table-column prop="new_code" label="新工号" min-width="110" show-overflow-tooltip />
            <el-table-column prop="card_number" label="卡号（旧）" min-width="120" show-overflow-tooltip />
            <el-table-column prop="new_card_number" label="卡号（新）" min-width="120" show-overflow-tooltip />
            <el-table-column prop="in_bm" label="部门" min-width="120" show-overflow-tooltip />
            <el-table-column prop="position" label="岗位" min-width="110" show-overflow-tooltip />
            <el-table-column label="操作时间" min-width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ staffOperationTime(row) }}</template>
            </el-table-column>
            <el-table-column prop="sfz_number" label="身份证号" min-width="180" show-overflow-tooltip />
            <el-table-column prop="birth" label="出生月日" min-width="120" show-overflow-tooltip />
            <el-table-column label="年龄" width="80">
              <template #default="{ row }">{{ staffAge(row?.birth) }}</template>
            </el-table-column>
            <el-table-column prop="intime" label="入职日期" min-width="120" show-overflow-tooltip />
            <el-table-column prop="meal_type" label="餐别" min-width="100" show-overflow-tooltip />
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

    <!-- 双列 + 分组：员工新增、编辑、查看均在独立页面完成 -->
    <section v-show="pageMode === 'form'" class="erp-section staff-form-section" :class="{ 'staff-form-section--readonly': dialogMode === 'view' }">
      <div class="form-head">
        <strong class="form-head-title">{{ dialogTitle }}</strong>
        <div class="form-head-actions">
          <!-- 与入库单一致：查看仅「返回列表」；新增/编辑为「重置」+「保存」，按钮靠右 -->
          <el-button v-if="dialogMode === 'view'" @click="switchList">返回列表</el-button>
          <template v-else>
            <el-button @click="resetCurrentForm">重置</el-button>
            <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
          </template>
        </div>
      </div>
      <el-form
        ref="formRef"
        class="staff-form-dialog"
        :model="form"
        :rules="formRules"
        :disabled="dialogMode === 'view'"
        label-position="top"
        size="small"
        require-asterisk-position="right"
      >
        <div class="staff-form-row">
          <el-form-item label="档案编码" class="staff-form-item staff-form-item--a"><el-input v-model="form.code" disabled maxlength="50" placeholder="提交后自动生成" /></el-form-item>
          <el-form-item label="新档案编码" prop="new_code" class="staff-form-item staff-form-item--a"><el-input v-model="form.new_code" maxlength="50" placeholder="可手动输入（可空）" /></el-form-item>
        </div>
        <div class="staff-form-row">
          <el-form-item label="姓名" prop="name" class="staff-form-item staff-form-item--a"><el-input v-model="form.name" maxlength="50" placeholder="请输入姓名" /></el-form-item>
          <el-form-item label="性别" prop="sex" class="staff-form-item staff-form-item--a"><el-select v-model="form.sex" clearable placeholder="请选择性别"><el-option label="男" value="男" /><el-option label="女" value="女" /></el-select></el-form-item>
          <el-form-item label="民族" prop="nation" class="staff-form-item staff-form-item--a"><el-select v-model="form.nation" filterable clearable placeholder="请选择民族"><el-option v-for="n in nationOptions" :key="n" :label="n" :value="n" /></el-select></el-form-item>
          <el-form-item label="出生日期" prop="birth" class="staff-form-item staff-form-item--a"><el-date-picker v-model="form.birth" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="选择日期" clearable /></el-form-item>
        </div>
        <div class="staff-form-row">
          <el-form-item label="卡号" prop="card_number" class="staff-form-item staff-form-item--a"><el-input v-model="form.card_number" maxlength="10" placeholder="固定 10 位数字" /></el-form-item>
          <el-form-item label="报餐密码" prop="password" class="staff-form-item staff-form-item--a"><el-input v-model="form.password" type="password" show-password maxlength="50" placeholder="请输入报餐密码" /></el-form-item>
          <el-form-item label="饭餐类型" prop="meal_type" class="staff-form-item staff-form-item--a"><el-select v-model="form.meal_type" clearable placeholder="默认员工餐"><el-option v-for="opt in mealTypeSelectOptions" :key="opt.value" :label="opt.label" :value="opt.value" /></el-select></el-form-item>
        </div>
        <div class="staff-form-row">
          <el-form-item label="入职时间" prop="intime" class="staff-form-item staff-form-item--a"><el-date-picker v-model="form.intime" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" placeholder="选择日期" /></el-form-item>
          <el-form-item label="入职部门" prop="in_bm_systemcode" class="staff-form-item staff-form-item--a"><el-select v-model="form.in_bm_systemcode" filterable clearable placeholder="仅显示已审核部门" @change="onDepartmentChange"><el-option v-for="d in deptOptions" :key="String(d.systemcode ?? '')" :label="String(d.name ?? '')" :value="String(d.systemcode ?? '')" /></el-select></el-form-item>
          <el-form-item label="岗位" prop="position" class="staff-form-item staff-form-item--a"><el-select v-model="form.position" filterable clearable placeholder="仅显示已审核岗位"><el-option v-for="p in positionOptions" :key="String(p.systemcode ?? '')" :label="String(p.name ?? '')" :value="String(p.name ?? '')" /></el-select></el-form-item>
        </div>
        <div class="staff-form-row">
          <el-form-item label="是否有亲属或朋友在我司工作" prop="yn_firend" class="staff-form-item staff-form-item--a"><el-select v-model="form.yn_firend" clearable placeholder="请选择"><el-option label="是" value="是" /><el-option label="否" value="否" /></el-select></el-form-item>
          <el-form-item label="最高文化程度" prop="highest" class="staff-form-item staff-form-item--a"><el-select v-model="form.highest" clearable placeholder="请选择"><el-option v-for="h in highestEduOptions" :key="h" :label="h" :value="h" /></el-select></el-form-item>
          <el-form-item label="是否曾在我司应聘" prop="yn_history" class="staff-form-item staff-form-item--a"><el-select v-model="form.yn_history" clearable placeholder="请选择"><el-option label="是" value="是" /><el-option label="否" value="否" /></el-select></el-form-item>
        </div>
      </el-form>
    </section>
  </div>
</template>

<script setup>
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'
import { useErpDeepLinkOpen } from '@/composables/useErpDeepLinkOpen'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import axios from 'axios'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
const { onErpListRowContextMenu } = useErpListRowContextMenu()

const menuPath = 'hr/files/employee-files'
const model = getPermissionModelFromStorage()

/** 页面标题（与左侧菜单一致） */
const pageTitle = '员工档案资料'

const tableList = ref([])
const total = ref(0)
const loading = ref(false)
const errorMessage = ref('')

/** 姓名、工号、卡号共用一个模糊检索词 */
const keyword = ref('')
/** 列表部门筛选：空=全部；值为部门 systemcode；点「查询」才生效 */
const filterDeptSystemcode = ref('')

/** list：管理员工档案；form：员工档案添加、编辑或查看 */
const pageMode = ref('list')

const page = ref(1)
/** 默认每页 20（数据量大） */
const pageSize = ref(20)

/** 是否显示未审核（pass='0'） */
const showUnAudited = ref(false)

const staffActionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, getStaffRowActionLabels))

/** 员工档案主列表操作列按钮：与模板 v-if / v-permission 保持一致，用于估算列宽 */
function getStaffRowActionLabels(row) {
  const labels = ['查看']
  if (showLeaved.value) {
    if (hasPageAction(model, menuPath, 'edit')) labels.push('恢复在职')
    return labels
  }
  if (showUnAudited.value) {
    if (hasPageAction(model, menuPath, 'edit')) labels.push('编辑')
    if (hasPageAction(model, menuPath, 'delete')) labels.push('办理离职')
    if (!rowIsAudited(row) && hasPageAction(model, menuPath, 'audit')) labels.push('审核')
    return labels
  }
  if (hasPageAction(model, menuPath, 'delete')) labels.push('办理离职')
  if (rowIsAudited(row) && hasPageAction(model, menuPath, 'unaudit')) labels.push('反审')
  return labels
}

/** 为 true 时列表仅含离职员工（del='1'）；关闭时只看在职（del='0'） */
const showLeaved = ref(false)

const dialogMode = ref('create')
const submitting = ref(false)
const formRef = ref()

/** 部门/岗位下拉（来自 UB_ERP_Hr_department） */
const deptOptions = ref([])
const positionOptions = ref([])

/** 民族下拉（与常见档案口径一致，含「其他」） */
const nationOptions = [
  '汉族',
  '壮族',
  '满族',
  '回族',
  '苗族',
  '维吾尔族',
  '土家族',
  '彝族',
  '蒙古族',
  '藏族',
  '侗族',
  '布依族',
  '瑶族',
  '白族',
  '朝鲜族',
  '哈尼族',
  '黎族',
  '哈萨克族',
  '傣族',
  '畲族',
  '傈僳族',
  '东乡族',
  '仡佬族',
  '拉祜族',
  '佤族',
  '水族',
  '纳西族',
  '羌族',
  '土族',
  '锡伯族',
  '柯尔克孜族',
  '达斡尔族',
  '景颇族',
  '毛南族',
  '布朗族',
  '撒拉族',
  '塔吉克族',
  '阿昌族',
  '普米族',
  '鄂温克族',
  '怒族',
  '京族',
  '基诺族',
  '德昂族',
  '保安族',
  '俄罗斯族',
  '裕固族',
  '乌孜别克族',
  '门巴族',
  '鄂伦春族',
  '独龙族',
  '塔塔尔族',
  '赫哲族',
  '珞巴族',
  '其他',
]

/** 最高文化程度 */
const highestEduOptions = ['小学', '初中', '高中/中专', '专科', '本科', '硕士研究生', '博士研究生', '其他']

/** 饭餐类型：默认员工餐，可选管理餐（写入 meal_type） */
const DEFAULT_MEAL_TYPE = '员工餐'
const MEAL_TYPE_STANDARD = [DEFAULT_MEAL_TYPE, '管理餐']

const form = ref({
  code: '',
  new_code: '',
  name: '',
  card_number: '',
  password: '',
  in_bm_systemcode: '',
  join_department: '',
  position: '',
  sex: '',
  nation: '',
  birth: '',
  highest: '',
  yn_firend: '',
  meal_type: DEFAULT_MEAL_TYPE,
  yn_history: '',
  intime: '',
})

/** 下拉项：标准两项 + 编辑时若库中为旧值则多一行便于展示与保留 */
const mealTypeSelectOptions = computed(() => {
  const cur = String(form.value.meal_type ?? '').trim()
  const base = MEAL_TYPE_STANDARD.map((v) => ({ label: v, value: v }))
  if (cur && !MEAL_TYPE_STANDARD.includes(cur)) {
    return [{ label: `${cur}（旧数据）`, value: cur }, ...base]
  }
  return base
})

const dialogTitle = computed(() => {
  if (dialogMode.value === 'view') return '查看员工'
  return dialogMode.value === 'edit' ? '编辑员工' : '新增员工'
})

const formRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  card_number: [
    { required: true, message: '请输入卡号', trigger: 'blur' },
    { pattern: /^\d{10}$/, message: '卡号必须是 10 位数字', trigger: 'blur' },
  ],
}

/** pass === '1' 为已审核 */
function rowIsAudited(row) {
  return String(row?.pass ?? '').trim() === '1'
}

/** del === '1' 为离职（本模块不再用 status 列） */
function rowIsDeleted(row) {
  return String(row?.del ?? '').trim() === '1'
}

/** 离职 = del='1' */
function staffIsLeaved(row) {
  return rowIsDeleted(row)
}

/** 列表状态：在职/离职 与 审核状态合并展示 */
function staffStatusText(row) {
  return `${staffIsLeaved(row) ? '离职' : '在职'}/${rowIsAudited(row) ? '已审核' : '未审核'}`
}

/** 操作时间优先显示最后修改时间；未修改的新增档案显示录入时间 */
function staffOperationTime(row) {
  return String(row?.edittime ?? '').trim() || String(row?.addtime ?? '').trim() || '—'
}

/** 按完整出生日期计算周岁；旧数据日期不完整或不合法时留空 */
function staffAge(birth) {
  const match = String(birth ?? '').trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ''
  const today = new Date()
  let age = today.getFullYear() - year
  if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1
  return age >= 0 ? String(age) : ''
}

/** 组装列表查询参数（关键词 + 可选部门名；部门空表示全部） */
function buildQueryParams() {
  const params = {}
  const value = String(keyword.value ?? '').trim()
  if (value) params.keyword = value
  // 列表按部门名称匹配（旧档 in_bm_systemcode 常空或与部门表 GUID 不一致）
  const deptSys = String(filterDeptSystemcode.value ?? '').trim()
  if (deptSys) {
    const hit = deptOptions.value.find((d) => String(d?.systemcode ?? '').trim() === deptSys)
    const deptName = String(hit?.name ?? '').trim()
    if (deptName) params.in_bm = deptName
  }
  return params
}

function todayString() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 旧库 yn_history 常见为「有/无」，表单统一为「是/否」 */
function normalizeYnHistoryForForm(v) {
  const s = String(v ?? '').trim()
  if (s === '有') return '是'
  if (s === '无') return '否'
  return s
}

async function loadDeptOptions() {
  try {
    const res = await axios.get('/api/hr/staff/department-options')
    const body = res.data
    const list = body?.data?.list
    deptOptions.value = Array.isArray(list) ? list : []
  } catch {
    deptOptions.value = []
  }
}

async function loadPositionOptions() {
  try { const { data } = await axios.get('/api/hr/staff/position-options'); positionOptions.value = Array.isArray(data?.data?.list) ? data.data.list : [] } catch { positionOptions.value = [] }
}

function onDepartmentChange(v) {
  const systemcode = String(v ?? '').trim()
  const hit = deptOptions.value.find((item) => String(item?.systemcode ?? '').trim() === systemcode)
  form.value.in_bm = String(hit?.name ?? '')
  // 保留部门编码兼容仍读取 join_department 的历史宿舍/报表接口；员工部门关联以 systemcode 为准。
  form.value.join_department = String(hit?.code ?? '')
}

async function loadList() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await axios.get('/api/hr/staff', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        pass: showUnAudited.value ? '0' : '1',
        del: showLeaved.value ? '1' : '0',
        ...buildQueryParams(),
      },
    })
    const body = res.data
    if (body?.code !== 200) {
      errorMessage.value = String(body?.msg ?? '加载失败')
      tableList.value = []
      total.value = 0
      return
    }
    tableList.value = Array.isArray(body?.data?.list) ? body.data.list : []
    total.value = Number(body?.data?.total ?? 0)
  } catch (e) {
    const msg = e?.response?.data?.msg
    errorMessage.value = String(msg ?? e?.message ?? '请求失败')
    tableList.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadList()
}

watch(showUnAudited, () => {
  page.value = 1
  loadList()
})

watch(showLeaved, () => {
  // 看离职名单时不叠「未审核」筛选，避免空列表误解
  if (showLeaved.value) {
    showUnAudited.value = false
  }
  page.value = 1
  loadList()
})

function onReset() {
  keyword.value = ''
  filterDeptSystemcode.value = ''
  page.value = 1
  loadList()
}

function switchList() {
  pageMode.value = 'list'
}

/** 新增清空表单；编辑重新拉取当前档案（对齐入库单「重置」） */
async function resetCurrentForm() {
  if (dialogMode.value === 'view') return
  if (dialogMode.value === 'edit') {
    const code = String(form.value.code ?? '').trim()
    if (!code) return
    await openEdit({ code })
    await nextTick()
    formRef.value?.clearValidate?.()
    ElMessage.success('已重置')
    return
  }
  openCreate()
  await nextTick()
  formRef.value?.clearValidate?.()
  ElMessage.success('已重置')
}

function onPageSizeChange(size) {
  pageSize.value = size
  page.value = 1
  loadList()
}

function onPageChange(p) {
  page.value = p
  loadList()
}

function openCreate() {
  dialogMode.value = 'create'
  form.value = {
    code: '',
    new_code: '',
    name: '',
    card_number: '',
      password: '',
      in_bm_systemcode: '',
    join_department: '',
    position: '',
    sex: '',
    nation: '',
    birth: '',
    highest: '',
    yn_firend: '',
    meal_type: DEFAULT_MEAL_TYPE,
    yn_history: '',
    intime: todayString(),
  }
  void loadDeptOptions()
  void loadPositionOptions()
  pageMode.value = 'form'
}

async function openEdit(row) {
  if (rowIsAudited(row)) return
  const code = String(row?.code ?? '').trim()
  if (!code) return
  dialogMode.value = 'edit'
  try {
    const res = await axios.get(`/api/hr/staff/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '读取员工资料失败'))
      return
    }
    row = body?.data ?? row
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
    return
  }
  form.value = {
    code: String(row?.code ?? ''),
    new_code: String(row?.new_code ?? ''),
    name: String(row?.name ?? ''),
    card_number: String(row?.card_number ?? ''),
    password: String(row?.password ?? ''),
    in_bm_systemcode: String(row?.in_bm_systemcode ?? ''),
    join_department: String(row?.join_department ?? ''),
    position: String(row?.position ?? ''),
    sex: String(row?.sex ?? ''),
    nation: String(row?.nation ?? ''),
    birth: String(row?.birth ?? ''),
    highest: String(row?.highest ?? ''),
    yn_firend: String(row?.yn_firend ?? ''),
    meal_type: String(row?.meal_type ?? '').trim() || DEFAULT_MEAL_TYPE,
    yn_history: normalizeYnHistoryForForm(row?.yn_history),
    intime: String(row?.intime ?? ''),
  }
  void loadDeptOptions()
  pageMode.value = 'form'
}

async function openView(row) {
  const code = String(row?.code ?? '').trim()
  if (!code) return
  dialogMode.value = 'view'
  submitting.value = false
  try {
    const res = await axios.get(`/api/hr/staff/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '读取详情失败'))
      return
    }
    const r = body?.data ?? {}
    form.value = {
      code: String(r?.code ?? ''),
      new_code: String(r?.new_code ?? ''),
      name: String(r?.name ?? ''),
      card_number: String(r?.card_number ?? ''),
      password: String(r?.password ?? ''),
      in_bm_systemcode: String(r?.in_bm_systemcode ?? ''),
      join_department: String(r?.join_department ?? ''),
      position: String(r?.position ?? ''),
      sex: String(r?.sex ?? ''),
      nation: String(r?.nation ?? ''),
      birth: String(r?.birth ?? ''),
      highest: String(r?.highest ?? ''),
      yn_firend: String(r?.yn_firend ?? ''),
      meal_type: String(r?.meal_type ?? '').trim() || DEFAULT_MEAL_TYPE,
      yn_history: normalizeYnHistoryForForm(r?.yn_history),
      intime: String(r?.intime ?? ''),
    }
    void loadDeptOptions()
    void loadPositionOptions()
    pageMode.value = 'form'
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}
useErpDeepLinkOpen({
  handlers: {
    view: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openView({ id })
    },
  },
})


async function submitForm() {
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    const payload = {
      name: String(form.value.name ?? '').trim(),
      new_code: String(form.value.new_code ?? '').trim(),
      card_number: String(form.value.card_number ?? '').trim(),
      password: String(form.value.password ?? '').trim(),
      in_bm_systemcode: String(form.value.in_bm_systemcode ?? '').trim(),
      join_department: String(form.value.join_department ?? '').trim(),
      position: String(form.value.position ?? '').trim(),
      sex: String(form.value.sex ?? '').trim(),
      nation: String(form.value.nation ?? '').trim(),
      birth: String(form.value.birth ?? '').trim(),
      highest: String(form.value.highest ?? '').trim(),
      yn_firend: String(form.value.yn_firend ?? '').trim(),
      meal_type: String(form.value.meal_type ?? '').trim() || DEFAULT_MEAL_TYPE,
      yn_history: String(form.value.yn_history ?? '').trim(),
      intime: String(form.value.intime ?? '').trim(),
    }
    if (dialogMode.value === 'edit') {
      payload.code = String(form.value.code ?? '').trim()
      const res = await axios.put('/api/hr/staff', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '保存失败'))
        return
      }
      ElMessage.success('已保存')
    } else {
      const res = await axios.post('/api/hr/staff', payload)
      const body = res.data
      if (body?.code !== 200) {
        ElMessage.error(String(body?.msg ?? '新增失败'))
        return
      }
      ElMessage.success('已新增')
    }
    switchList()
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  } finally {
    submitting.value = false
  }
}

async function confirmLeave(row) {
  if (staffIsLeaved(row)) {
    ElMessage.warning('该员工已是离职状态')
    return
  }
  const code = String(row?.code ?? '').trim()
  if (!code) return
  try {
    await ElMessageBox.confirm(
      `确定为员工「${row?.name}」（工号=${code}）办理离职吗？办理后会出现在「显示离职员工」列表中，系统账号不受影响。`,
      '确认办理离职',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const res = await axios.delete(`/api/hr/staff/${encodeURIComponent(code)}`)
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '办理离职失败'))
      return
    }
    ElMessage.success('已办理离职')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function confirmRestore(row) {
  if (!staffIsLeaved(row)) {
    ElMessage.warning('该员工不是离职状态')
    return
  }
  const code = String(row?.code ?? '').trim()
  if (!code) return
  try {
    await ElMessageBox.confirm(`确定将员工「${row?.name}」（工号=${code}）恢复为在职吗？`, '确认恢复在职', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/restore', { code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '恢复在职失败'))
      return
    }
    ElMessage.success('已恢复在职')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doAudit(row) {
  if (rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(
      `确定审核员工「${row?.name}」（工号=${row?.code}）吗？审核后将锁定编辑，需反审后再改资料。`,
      '确认审核',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/audit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '审核失败'))
      return
    }
    ElMessage.success('已审核')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

async function doUnaudit(row) {
  if (!rowIsAudited(row)) return
  try {
    await ElMessageBox.confirm(`确定反审员工「${row?.name}」吗？反审后可再编辑。`, '确认反审', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    const res = await axios.put('/api/hr/staff/unaudit', { code: row.code })
    const body = res.data
    if (body?.code !== 200) {
      ElMessage.error(String(body?.msg ?? '反审失败'))
      return
    }
    ElMessage.success('已反审')
    await loadList()
  } catch (e) {
    const msg = e?.response?.data?.msg
    ElMessage.error(String(msg ?? e?.message ?? '请求失败'))
  }
}

onMounted(() => {
  void loadDeptOptions()
  void loadPositionOptions()
  loadList()
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.staff-files-mode-bar {
  margin-bottom: 12px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.page-desc {
  margin: 0;
  color: var(--el-text-color-secondary);
}

.error-alert {
  margin: 12px 0;
}
.search-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0 12px;
}
.staff-filter-dept {
  width: 200px;
  max-width: 100%;
}
.staff-filter-keyword {
  width: 420px;
  max-width: 100%;
}
.staff-filter-divider {
  width: 1px;
  height: 22px;
  background: var(--el-border-color);
  margin: 0 4px;
}
.staff-filter-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.staff-form-section {
  overflow-x: auto;
  /* DIY：员工档案添加/编辑页字号与顶栏按钮
     标题建议 16～22；按钮高度 36～48、字号 13～16；
     字段标签（档案编码等）建议 13～18；输入框字号建议 13～18 */
  --staff-form-head-title-font-size: 18px;
  --staff-form-head-btn-height: 36px;
  --staff-form-head-btn-font-size: 16px;
  --staff-form-label-font-size: 16px;
  --staff-form-input-font-size: 16px;
}
.staff-form-section--readonly {
  opacity: 0.92;
}
/* 与入库单一致：标题在左，重置/保存在最右 */
.form-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.form-head-title {
  font-size: var(--staff-form-head-title-font-size);
}
.form-head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.form-head-actions :deep(.el-button) {
  height: var(--staff-form-head-btn-height);
  min-height: var(--staff-form-head-btn-height);
  font-size: var(--staff-form-head-btn-font-size);
}
.staff-form-dialog :deep(.el-form-item) {
  margin-bottom: 0;
}
.staff-form-dialog :deep(.el-form-item__label) {
  line-height: 1.35;
  padding-bottom: 5px;
  font-size: var(--staff-form-label-font-size);
}
.staff-form-dialog :deep(.el-input),
.staff-form-dialog :deep(.el-select),
.staff-form-dialog :deep(.el-date-editor) {
  font-size: var(--staff-form-input-font-size);
}
.staff-form-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  width: max-content;
  min-width: 100%;
  margin-bottom: 16px;
}
.staff-form-item--a {
  width: 250px;
}
.staff-form-item :deep(.el-input),
.staff-form-item :deep(.el-select),
.staff-form-item :deep(.el-date-editor) {
  width: 100%;
}
</style>
