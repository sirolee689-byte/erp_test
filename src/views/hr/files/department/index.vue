<template>
  <div class="erp-module-page">
    <div class="erp-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理部门资料</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && formMode === 'create' ? 'primary' : 'default'" plain @click="openCreate">部门资料添加</el-button>
    </div>

    <el-card v-show="pageMode === 'list'" shadow="never">
      <template #header><span class="page-title">部门资料</span></template>
      <div class="search-row erp-filter-row">
        <el-input v-model="keyword" class="dept-filter-keyword" clearable placeholder="部门编码 / 部门名称 / 负责人 / 备注" @keyup.enter="onSearch" />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <div class="erp-filter-divider" aria-hidden="true" />
        <div class="erp-filter-switch"><span class="switch-label">显示未审核</span><el-switch v-model="showUnAudited" :disabled="showRecycle" /></div>
        <div class="erp-filter-divider" aria-hidden="true" />
        <div class="erp-filter-switch"><span class="switch-label">回收站</span><el-switch v-model="showRecycle" /></div>
      </div>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <div class="pagination-row pagination-row--top"><el-pagination background layout="total, sizes, prev, pager, next, jumper" :total="total" :current-page="page" :page-size="pageSize" :page-sizes="ERP_PAGE_SIZE_OPTIONS" @size-change="onPageSizeChange" @current-change="onPageChange" /></div>
      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table v-erp-list-h-scroll :data="tableList" row-key="systemcode" border stripe class="erp-list-table" :empty-text="loading ? '加载中…' : '暂无数据'" @row-contextmenu="onErpListRowContextMenu">
            <el-table-column label="操作" :width="actionsColWidth" fixed="left" class-name="erp-col-actions">
              <template #default="{ row }"><ErpTableActions>
                <el-button type="info" plain @click="openView(row)">查看</el-button>
                <el-button v-if="showRecycle" v-permission="'edit'" type="primary" plain @click="restore(row)">恢复</el-button>
                <template v-else>
                  <el-button v-if="showUnAudited" v-permission="'edit'" type="primary" plain @click="openEdit(row)">编辑</el-button>
                  <el-button v-if="showUnAudited" v-permission="'delete'" type="danger" plain @click="remove(row)">删除</el-button>
                  <el-button v-if="showUnAudited" v-permission="'audit'" type="success" plain @click="audit(row)">审核</el-button>
                  <el-button v-if="!showUnAudited" v-permission="'unaudit'" type="warning" plain @click="unaudit(row)">反审</el-button>
                </template>
              </ErpTableActions></template>
            </el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="rowIsAudited(row) ? 'success' : 'info'">{{ rowIsAudited(row) ? '已审核' : '未审核' }}</el-tag></template></el-table-column>
            <el-table-column prop="code" label="部门编码" min-width="130" show-overflow-tooltip />
            <el-table-column prop="name" label="部门名称" min-width="160" show-overflow-tooltip />
            <el-table-column prop="manager" label="负责人" min-width="120" show-overflow-tooltip />
            <el-table-column prop="remark" label="备注" min-width="200" show-overflow-tooltip />
            <el-table-column label="操作时间" min-width="160" show-overflow-tooltip><template #default="{ row }">{{ row.edittime || row.addtime || '—' }}</template></el-table-column>
          </el-table>
          <div class="pagination-row pagination-row--bottom"><el-pagination background layout="total, sizes, prev, pager, next, jumper" :total="total" :current-page="page" :page-size="pageSize" :page-sizes="ERP_PAGE_SIZE_OPTIONS" @size-change="onPageSizeChange" @current-change="onPageChange" /></div>
        </template>
      </el-skeleton>
    </el-card>

    <section v-show="pageMode === 'form'" class="erp-section dept-form-section" :class="{ 'dept-form-section--readonly': formMode === 'view' }">
      <div class="form-head"><strong class="form-head-title">{{ formTitle }}</strong><div class="form-head-actions"><el-button v-if="formMode === 'view'" @click="switchList">返回列表</el-button><template v-else><el-button @click="resetForm">重置</el-button><el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button></template></div></div>
      <el-form ref="formRef" :model="form" :rules="formRules" :disabled="formMode === 'view'" label-position="left" label-width="90px" class="dept-form">
        <div class="dept-form-row"><el-form-item label="部门编码" prop="code"><el-input v-model="form.code" maxlength="50" placeholder="请输入部门编码" /></el-form-item><el-form-item label="部门名称" prop="name"><el-input v-model="form.name" maxlength="50" placeholder="请输入部门名称" /></el-form-item></div>
        <div class="dept-form-row"><el-form-item label="负责人" prop="manager"><el-input v-model="form.manager" maxlength="50" placeholder="请输入负责人" /></el-form-item></div>
        <el-form-item label="备注" prop="remark" class="dept-form-remark"><el-input v-model="form.remark" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="请输入备注" /></el-form-item>
      </el-form>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'

const menuPath = 'hr/files/department'
const model = getPermissionModelFromStorage()
const { onErpListRowContextMenu } = useErpListRowContextMenu()
const pageMode = ref('list')
const formMode = ref('create')
const tableList = ref([])
const total = ref(0)
const loading = ref(false)
const submitting = ref(false)
const errorMessage = ref('')
const keyword = ref('')
const showUnAudited = ref(false)
const showRecycle = ref(false)
const page = ref(1)
const pageSize = ref(20)
const formRef = ref()
const emptyForm = () => ({ systemcode: '', code: '', name: '', manager: '', remark: '' })
const form = ref(emptyForm())
const formRules = { code: [{ required: true, message: '请输入部门编码', trigger: 'blur' }], name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }] }
const formTitle = computed(() => ({ create: '部门资料添加', edit: '部门资料编辑', view: '部门资料查看' }[formMode.value]))
const rowIsAudited = (row) => String(row?.pass ?? '').trim() === '1'
const actionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, (row) => {
  const labels = ['查看']
  if (showRecycle.value) { if (hasPageAction(model, menuPath, 'edit')) labels.push('恢复') }
  else if (showUnAudited.value) { if (hasPageAction(model, menuPath, 'edit')) labels.push('编辑'); if (hasPageAction(model, menuPath, 'delete')) labels.push('删除'); if (hasPageAction(model, menuPath, 'audit')) labels.push('审核') }
  else if (hasPageAction(model, menuPath, 'unaudit') && rowIsAudited(row)) labels.push('反审')
  return labels
}))

async function loadList() { loading.value = true; errorMessage.value = ''; try { const { data } = await axios.get('/api/hr/departments', { params: { page: page.value, pageSize: pageSize.value, keyword: keyword.value.trim(), pass: showUnAudited.value ? '0' : '1', recycle: showRecycle.value ? '1' : '0' } }); if (data?.code !== 200) throw new Error(data?.msg || '加载失败'); tableList.value = data.data?.list || []; total.value = Number(data.data?.total || 0) } catch (e) { tableList.value = []; total.value = 0; errorMessage.value = String(e?.response?.data?.msg || e?.message || '请求失败') } finally { loading.value = false } }
function onSearch() { page.value = 1; loadList() }
function onReset() { keyword.value = ''; page.value = 1; loadList() }
function onPageSizeChange(v) { pageSize.value = v; page.value = 1; loadList() }
function onPageChange(v) { page.value = v; loadList() }
function switchList() { pageMode.value = 'list'; loadList() }
function openCreate() { formMode.value = 'create'; form.value = emptyForm(); pageMode.value = 'form' }
function openEdit(row) { if (rowIsAudited(row)) return; formMode.value = 'edit'; form.value = { ...emptyForm(), ...row }; pageMode.value = 'form' }
function openView(row) { formMode.value = 'view'; form.value = { ...emptyForm(), ...row }; pageMode.value = 'form' }
function resetForm() { if (formMode.value === 'create') form.value = emptyForm() }
async function submitForm() { try { await formRef.value?.validate() } catch { return }; submitting.value = true; try { const payload = { systemcode: String(form.value.systemcode || '').trim(), code: String(form.value.code || '').trim(), name: String(form.value.name || '').trim(), manager: String(form.value.manager || '').trim(), remark: String(form.value.remark || '').trim() }; const { data } = formMode.value === 'edit' ? await axios.put('/api/hr/departments', payload) : await axios.post('/api/hr/departments', payload); if (data?.code !== 200) throw new Error(data?.msg || '保存失败'); ElMessage.success('保存成功'); switchList() } catch (e) { ElMessage.error(String(e?.response?.data?.msg || e?.message || '保存失败')) } finally { submitting.value = false } }
async function confirmAction(message, title, callback) { try { await ElMessageBox.confirm(message, title, { type: 'warning' }) } catch { return }; try { await callback(); await loadList() } catch (e) { ElMessage.error(String(e?.response?.data?.msg || e?.message || '操作失败')) } }
function remove(row) { confirmAction(`确定删除部门“${row.name}”吗？`, '确认删除', async () => { const { data } = await axios.delete(`/api/hr/departments/${encodeURIComponent(row.systemcode)}`); if (data?.code !== 200) throw new Error(data?.msg) }) }
function restore(row) { confirmAction(`确定恢复部门“${row.name}”吗？`, '确认恢复', async () => { const { data } = await axios.put('/api/hr/departments/restore', { systemcode: row.systemcode }); if (data?.code !== 200) throw new Error(data?.msg) }) }
function audit(row) { confirmAction(`确定审核部门“${row.name}”吗？`, '确认审核', async () => { const { data } = await axios.put('/api/hr/departments/audit', { systemcode: row.systemcode }); if (data?.code !== 200) throw new Error(data?.msg) }) }
function unaudit(row) { confirmAction(`确定反审部门“${row.name}”吗？`, '确认反审', async () => { const { data } = await axios.put('/api/hr/departments/unaudit', { systemcode: row.systemcode }); if (data?.code !== 200) throw new Error(data?.msg) }) }
watch(showUnAudited, () => { if (showUnAudited.value) showRecycle.value = false; page.value = 1; loadList() })
watch(showRecycle, () => { if (showRecycle.value) showUnAudited.value = false; page.value = 1; loadList() })
onMounted(loadList)
</script>

<style scoped>
.erp-module-page { min-height: 200px; }
.erp-mode-bar { display: flex; gap: 10px; margin-bottom: 12px; }
.page-title { font-size: 18px; font-weight: 600; }
.search-row { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; }
.dept-filter-keyword { width: 320px; }
.erp-filter-divider { width: 1px; height: 24px; background: var(--el-border-color); margin: 0 4px; }
.erp-filter-switch { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.switch-label { font-size: 13px; color: var(--el-text-color-regular); }
.error-alert { margin: 12px 0; }
.pagination-row { display: flex; margin: 12px 0; }
.pagination-row--bottom { justify-content: flex-end; }
.dept-form-section { padding: 18px 22px; background: var(--el-bg-color); border: 1px solid var(--el-border-color-lighter); }
.form-head { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 18px; border-bottom: 1px solid var(--el-border-color-lighter); }
.form-head-title { font-size: 16px; }
.form-head-actions { display: flex; gap: 8px; }
.dept-form { max-width: 700px; }
.dept-form-row { display: flex; gap: 18px; }
.dept-form-row .el-form-item { width: 250px; }
.dept-form-remark { width: 500px; }
@media (max-width: 720px) { .search-row { flex-wrap: wrap; } .dept-form-row { display: block; } .dept-filter-keyword, .dept-form-row .el-form-item, .dept-form-remark { width: 100%; } }
</style>
