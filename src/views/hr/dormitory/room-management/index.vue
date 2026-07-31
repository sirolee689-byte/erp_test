<template>
  <div class="erp-module-page">
    <div class="erp-mode-bar">
      <el-button :type="pageMode === 'list' ? 'primary' : 'default'" plain @click="switchList">管理房间资料</el-button>
      <el-button v-permission="'add'" :type="pageMode === 'form' && formMode === 'create' ? 'primary' : 'default'" plain @click="openCreate">房间资料添加</el-button>
    </div>

    <el-card v-show="pageMode === 'list'" shadow="never">
      <template #header><span class="page-title">房间管理</span></template>
      <div class="search-row erp-filter-row">
        <el-input v-model="keyword" class="room-keyword" clearable placeholder="类型 / 房间名称 / 编码 / 楼号 / 备注" @keyup.enter="onSearch" />
        <el-button type="primary" @click="onSearch">查询</el-button>
        <el-button @click="onReset">重置</el-button>
        <div class="erp-filter-divider" aria-hidden="true" />
        <div class="erp-filter-switch"><span>显示未审核</span><el-switch v-model="showUnAudited" :disabled="showRecycle" /></div>
        <div class="erp-filter-divider" aria-hidden="true" />
        <div class="erp-filter-switch"><span>回收站</span><el-switch v-model="showRecycle" /></div>
        <el-button v-if="showUnAudited" v-permission="'audit'" type="success" plain :disabled="!selectedRows.length" @click="batchAudit">批量审核</el-button>
      </div>
      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <div class="pagination-row"><el-pagination background layout="total, sizes, prev, pager, next, jumper" :total="total" :current-page="page" :page-size="pageSize" :page-sizes="ERP_PAGE_SIZE_OPTIONS" @size-change="onPageSizeChange" @current-change="onPageChange" /></div>
      <el-skeleton :loading="loading" animated :rows="8">
        <template #default>
          <el-table v-erp-list-h-scroll :data="tableList" row-key="systemcode" border stripe class="erp-list-table" :empty-text="loading ? '加载中…' : '暂无数据'" @selection-change="selectedRows = $event" @row-contextmenu="onErpListRowContextMenu">
            <el-table-column v-if="showUnAudited && !showRecycle" type="selection" width="48" fixed="left" />
            <el-table-column label="操作" :width="actionsColWidth" fixed="left" class-name="erp-col-actions">
              <template #default="{ row }"><ErpTableActions>
                <el-button type="info" plain @click="openView(row)">查看</el-button>
                <el-button v-if="showRecycle" v-permission="'edit'" type="primary" plain @click="restore(row)">恢复</el-button>
                <template v-else>
                  <el-button v-if="showUnAudited" v-permission="'edit'" type="primary" plain @click="openEdit(row)">编辑</el-button>
                  <el-button v-if="showUnAudited" v-permission="'delete'" type="danger" plain @click="remove(row)">删除</el-button>
                  <el-button v-if="showUnAudited" v-permission="'audit'" type="success" plain @click="audit(row)">审核</el-button>
                  <el-button v-if="!showUnAudited && rowIsAudited(row)" v-permission="'unaudit'" type="warning" plain @click="unaudit(row)">反审</el-button>
                </template>
              </ErpTableActions></template>
            </el-table-column>
            <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="rowIsAudited(row) ? 'success' : 'info'">{{ rowIsAudited(row) ? '已审核' : '未审核' }}</el-tag></template></el-table-column>
            <el-table-column prop="code" label="类型" min-width="130" show-overflow-tooltip />
            <el-table-column prop="name" label="房间名称" min-width="140" show-overflow-tooltip />
            <el-table-column prop="s_code" label="编码" min-width="120" show-overflow-tooltip />
            <el-table-column prop="in_lou" label="楼号" min-width="120" show-overflow-tooltip />
            <el-table-column prop="in_sum" label="床位数" width="100" />
            <el-table-column prop="info" label="备注" min-width="200" show-overflow-tooltip />
            <el-table-column label="操作时间" min-width="165" show-overflow-tooltip><template #default="{ row }">{{ row.edittime || row.addtime || '—' }}</template></el-table-column>
          </el-table>
          <div class="pagination-row pagination-row--bottom"><el-pagination background layout="total, sizes, prev, pager, next, jumper" :total="total" :current-page="page" :page-size="pageSize" :page-sizes="ERP_PAGE_SIZE_OPTIONS" @size-change="onPageSizeChange" @current-change="onPageChange" /></div>
        </template>
      </el-skeleton>
    </el-card>

    <section v-show="pageMode === 'form'" class="room-form-section">
      <div class="form-head"><strong>{{ formTitle }}</strong><div><el-button v-if="formMode === 'view'" @click="switchList">返回列表</el-button><template v-else><el-button @click="resetForm">重置</el-button><el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button></template></div></div>
      <el-form ref="formRef" :model="form" :rules="formRules" :disabled="formMode === 'view'" label-position="left" label-width="100px" class="room-form">
        <div class="form-row"><el-form-item label="类型" prop="code"><el-input v-model="form.code" maxlength="50" /></el-form-item><el-form-item label="房间名称" prop="name"><el-input v-model="form.name" maxlength="50" /></el-form-item></div>
        <div class="form-row"><el-form-item label="编码" prop="s_code"><el-input v-model="form.s_code" maxlength="50" :disabled="formMode === 'edit' && form.s_code_locked" /><span v-if="formMode === 'edit' && form.s_code_locked" class="field-note">已有入住或费用记录，不能修改</span></el-form-item><el-form-item label="楼号" prop="in_lou"><el-input v-model="form.in_lou" maxlength="50" /></el-form-item></div>
        <div class="form-row"><el-form-item label="床位数" prop="in_sum"><el-input-number v-model="form.in_sum" :min="1" :max="999" controls-position="right" /></el-form-item><el-form-item label="损坏床位" prop="in_bad"><el-input-number v-model="form.in_bad" :min="0" :max="999" controls-position="right" /></el-form-item></div>
        <div class="form-row"><el-form-item label="水费信息"><el-input v-model="form.water" maxlength="50" /></el-form-item><el-form-item label="电费信息"><el-input v-model="form.electric" maxlength="50" /></el-form-item></div>
        <div class="form-row"><el-form-item label="电表编号"><el-input v-model="form.electric_code" maxlength="50" /></el-form-item></div>
        <el-form-item label="备注" class="remark"><el-input v-model="form.info" type="textarea" :rows="3" maxlength="500" show-word-limit /></el-form-item>
        <el-form-item v-if="formMode === 'view'" label="入住人员" class="remark"><el-input :model-value="form.in_user || '—'" type="textarea" :rows="2" readonly /></el-form-item>
      </el-form>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import axios from 'axios'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import { getPermissionModelFromStorage, hasPageAction } from '@/utils/menuPermission'
import { getErpTableActionsColWidthByRows } from '@/utils/erpTableActionsLayout'
import { useErpListRowContextMenu } from '@/composables/useErpListRowContextMenu'

const menuPath = 'hr/dormitory/room-management'
const model = getPermissionModelFromStorage()
const { onErpListRowContextMenu } = useErpListRowContextMenu()
const pageMode = ref('list'), formMode = ref('create'), tableList = ref([]), selectedRows = ref([])
const total = ref(0), loading = ref(false), submitting = ref(false), errorMessage = ref('')
const keyword = ref(''), showUnAudited = ref(false), showRecycle = ref(false), page = ref(1), pageSize = ref(20), formRef = ref()
const emptyForm = () => ({ systemcode: '', code: '', name: '', s_code: '', s_code_locked: false, in_lou: '', in_sum: 1, in_bad: 0, water: '', electric: '', electric_code: '', info: '', in_user: '' })
const form = ref(emptyForm())
const formRules = { code: [{ required: true, message: '请输入类型', trigger: 'blur' }], name: [{ required: true, message: '请输入房间名称', trigger: 'blur' }], s_code: [{ required: true, message: '请输入编码', trigger: 'blur' }], in_lou: [{ required: true, message: '请输入楼号', trigger: 'blur' }], in_sum: [{ required: true, message: '请输入床位数', trigger: 'change' }] }
const formTitle = computed(() => ({ create: '房间资料添加', edit: '房间资料编辑', view: '房间资料查看' }[formMode.value]))
const rowIsAudited = (row) => String(row?.pass ?? '').trim() === '1'
const actionsColWidth = computed(() => getErpTableActionsColWidthByRows(tableList.value, (row) => { const labels = ['查看']; if (showRecycle.value) { if (hasPageAction(model, menuPath, 'edit')) labels.push('恢复') } else if (showUnAudited.value) { if (hasPageAction(model, menuPath, 'edit')) labels.push('编辑'); if (hasPageAction(model, menuPath, 'delete')) labels.push('删除'); if (hasPageAction(model, menuPath, 'audit')) labels.push('审核') } else if (rowIsAudited(row) && hasPageAction(model, menuPath, 'unaudit')) labels.push('反审'); return labels }))
async function loadList() { loading.value = true; errorMessage.value = ''; selectedRows.value = []; try { const { data } = await axios.get('/api/hr/dormitory/rooms', { params: { page: page.value, pageSize: pageSize.value, keyword: keyword.value.trim(), pass: showUnAudited.value ? '0' : '1', recycle: showRecycle.value ? '1' : '0' } }); if (data?.code !== 200) throw new Error(data?.msg || '加载失败'); tableList.value = data.data?.list || []; total.value = Number(data.data?.total || 0) } catch (e) { tableList.value = []; total.value = 0; errorMessage.value = String(e?.response?.data?.msg || e?.message || '请求失败') } finally { loading.value = false } }
function onSearch() { page.value = 1; loadList() } function onReset() { keyword.value = ''; onSearch() } function onPageSizeChange(v) { pageSize.value = v; page.value = 1; loadList() } function onPageChange(v) { page.value = v; loadList() }
function switchList() { pageMode.value = 'list'; loadList() } function openCreate() { formMode.value = 'create'; form.value = emptyForm(); pageMode.value = 'form' } async function openEdit(row) { if (rowIsAudited(row)) return; try { const { data } = await axios.get(`/api/hr/dormitory/rooms/${encodeURIComponent(row.systemcode)}`); if (data?.code !== 200) throw new Error(data?.msg); formMode.value = 'edit'; form.value = { ...emptyForm(), ...data.data }; pageMode.value = 'form' } catch (e) { ElMessage.error(String(e?.response?.data?.msg || e?.message || '读取详情失败')) } } async function openView(row) { try { const { data } = await axios.get(`/api/hr/dormitory/rooms/${encodeURIComponent(row.systemcode)}`); if (data?.code !== 200) throw new Error(data?.msg); formMode.value = 'view'; form.value = { ...emptyForm(), ...data.data }; pageMode.value = 'form' } catch (e) { ElMessage.error(String(e?.response?.data?.msg || e?.message || '读取详情失败')) } }
function resetForm() { if (formMode.value === 'create') form.value = emptyForm() }
async function submitForm() { try { await formRef.value?.validate() } catch { return }; if (Number(form.value.in_bad) >= Number(form.value.in_sum)) return ElMessage.error('损坏床位必须小于房间容量'); submitting.value = true; try { const payload = { ...form.value, code: String(form.value.code || '').trim(), name: String(form.value.name || '').trim(), s_code: String(form.value.s_code || '').trim(), in_lou: String(form.value.in_lou || '').trim() }; const { data } = formMode.value === 'edit' ? await axios.put('/api/hr/dormitory/rooms', payload) : await axios.post('/api/hr/dormitory/rooms', payload); if (data?.code !== 200) throw new Error(data?.msg || '保存失败'); ElMessage.success('保存成功'); switchList() } catch (e) { ElMessage.error(String(e?.response?.data?.msg || e?.message || '保存失败')) } finally { submitting.value = false } }
async function confirmAction(message, callback) { try { await ElMessageBox.confirm(message, '确认操作', { type: 'warning' }) } catch { return }; try { await callback(); await loadList() } catch (e) { ElMessage.error(String(e?.response?.data?.msg || e?.message || '操作失败')) } }
function remove(row) { confirmAction(`确定删除房间“${row.name}”吗？`, async () => { const { data } = await axios.delete(`/api/hr/dormitory/rooms/${encodeURIComponent(row.systemcode)}`); if (data?.code !== 200) throw new Error(data?.msg) }) } function restore(row) { confirmAction(`确定恢复房间“${row.name}”吗？`, async () => { const { data } = await axios.put('/api/hr/dormitory/rooms/restore', { systemcode: row.systemcode }); if (data?.code !== 200) throw new Error(data?.msg) }) } function audit(row) { confirmAction(`确定审核房间“${row.name}”吗？`, async () => { const { data } = await axios.put('/api/hr/dormitory/rooms/audit', { systemcode: row.systemcode }); if (data?.code !== 200) throw new Error(data?.msg) }) } function unaudit(row) { confirmAction(`确定反审房间“${row.name}”吗？`, async () => { const { data } = await axios.put('/api/hr/dormitory/rooms/unaudit', { systemcode: row.systemcode }); if (data?.code !== 200) throw new Error(data?.msg) }) } function batchAudit() { const systemcodes = selectedRows.value.map((row) => row.systemcode).filter(Boolean); confirmAction(`确定审核已选的 ${systemcodes.length} 个房间吗？`, async () => { const { data } = await axios.put('/api/hr/dormitory/rooms/audit-batch', { systemcodes }); if (data?.code !== 200) throw new Error(data?.msg) }) }
watch(showUnAudited, () => { if (showUnAudited.value) showRecycle.value = false; onSearch() }); watch(showRecycle, () => { if (showRecycle.value) showUnAudited.value = false; onSearch() }); onMounted(loadList)
</script>

<style scoped>
.erp-module-page { min-height: 200px; }.erp-mode-bar, .search-row, .form-row, .form-head { display: flex; align-items: center; gap: 10px; }.erp-mode-bar { margin-bottom: 12px; }.page-title { font-size: 18px; font-weight: 600; }.search-row { margin: 8px 0 12px; }.room-keyword { width: 340px; }.erp-filter-divider { width: 1px; height: 24px; background: var(--el-border-color); margin: 0 4px; }.erp-filter-switch { display: inline-flex; gap: 8px; align-items: center; white-space: nowrap; }.error-alert { margin: 12px 0; }.pagination-row { display: flex; margin: 12px 0; }.pagination-row--bottom { justify-content: flex-end; }.room-form-section { padding: 18px 22px; border: 1px solid var(--el-border-color-lighter); background: var(--el-bg-color); }.form-head { justify-content: space-between; padding-bottom: 16px; margin-bottom: 18px; border-bottom: 1px solid var(--el-border-color-lighter); }.room-form { max-width: 700px; }.form-row .el-form-item { width: 250px; }.remark { width: 500px; }.field-note { display: block; font-size: 12px; line-height: 18px; color: var(--el-color-warning); }@media (max-width:720px) { .search-row { flex-wrap: wrap; }.form-row { display: block; }.room-keyword, .form-row .el-form-item, .remark { width: 100%; } }
</style>
