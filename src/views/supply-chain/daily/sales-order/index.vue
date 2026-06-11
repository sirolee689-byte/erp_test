<template>
  <div class="erp-module-page" :class="{ 'so-standalone-window': isSalesOrderStandaloneWindow }">
    <!-- 销售订单 issue 01：列表 + 只读详情（主表 Tab / 明细 Tab） -->
    <div v-if="!isSalesOrderStandaloneWindow" class="so-mode-bar">
      <el-button
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
      >
        管理销售订单
      </el-button>
      <el-button
        v-permission="'add'"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
      >
        销售订单添加
      </el-button>
    </div>

    <el-card v-show="!isSalesOrderStandaloneWindow && pageMode === 'manage'" shadow="never">
     

      <div class="so-toolbar">
        <div class="so-toolbar-row">
          <div class="so-filter-actions">
            <el-input
              v-model="filterKeyword"
              placeholder="输入 PI 号 / 系统单号 / 客户名称"
              clearable
              class="so-keyword-input"
              @keyup.enter="onSearch"
            />
            <el-button type="primary" size="small" @click="onSearch">查询</el-button>
            <div class="audit-switch">
              <span class="switch-label">回收站</span>
              <el-switch v-model="showRecycle" @change="onRecycleChange" />
            </div>
            <div v-if="!showRecycle" class="audit-switch">
              <span class="switch-label">显示未审核</span>
              <el-switch v-model="showUnAudited" @change="onSearch" />
            </div>
            <el-button size="small" @click="onReset">重置</el-button>
          </div>
          <div class="so-command-actions">
            <el-button class="btn-view" size="small" :loading="loading" @click="loadData">
              <el-icon class="btn-icon"><Refresh /></el-icon>
              刷新
            </el-button>
          </div>
        </div>
      </div>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon class="error-alert" />
      <el-alert
        v-if="showRecycle"
        title="当前为回收站视图：可恢复或彻底删除（不可恢复）。"
        type="info"
        show-icon
        class="audit-alert"
      />
      <el-alert
        v-else-if="showUnAudited"
        title="当前显示：未审核销售订单"
        type="warning"
        show-icon
        class="audit-alert"
      />

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <el-table
            ref="mainTableRef"
            v-erp-list-h-scroll
            class="erp-list-table so-main-table"
            :data="tableList"
            row-key="id"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
            @expand-change="onExpandChange"
            @row-click="onMainRowClick"
          >
            <el-table-column
              label="操作"
              :width="salesOrderActionsColWidth"
              fixed="left"
              align="left"
              header-align="center"
              class-name="erp-col-actions"
            >
              <template #default="{ row }">
                <div class="action-bar so-order-actions">
                  <el-button plain size="small" @click.stop="openView(row)">查看</el-button>
                  <template v-if="!showRecycle">
                    <el-button
                      v-if="!row.isPureSpareOrder"
                      v-permission="'edit'"
                      type="primary"
                      plain
                      size="small"
                      :loading="calculateLoading"
                      @click.stop="calculateOrder(row, false)"
                    >
                      一键运算
                    </el-button>
                    <el-tooltip
                      v-if="row.hasSpareParts"
                      :disabled="row.canAddSpareUsage"
                      content="混单须先一键运算整款，再增加散件单用量"
                      placement="top"
                    >
                      <span class="erp-action-tooltip-wrap">
                        <el-button
                          v-permission="'edit'"
                          plain
                          size="small"
                          :disabled="!row.canAddSpareUsage"
                          :loading="spareUsageLoading"
                          @click.stop="addSpareUsage(row)"
                        >
                          增加散件单用量
                        </el-button>
                      </span>
                    </el-tooltip>
                    <el-button
                      v-if="!passIsAudited(row)"
                      v-permission="'edit'"
                      type="primary"
                      plain
                      size="small"
                      @click.stop="openEdit(row)"
                    >
                      编辑
                    </el-button>
                    <el-button
                      v-if="!passIsAudited(row)"
                      v-permission="'audit'"
                      plain
                      size="small"
                      :loading="row.__opLoading === 'audit'"
                      @click.stop="auditRow(row)"
                    >
                      审核
                    </el-button>
                    <el-button
                      v-if="passIsAudited(row)"
                      v-permission="'audit'"
                      plain
                      size="small"
                      :loading="row.__opLoading === 'unaudit'"
                      @click.stop="unauditRow(row)"
                    >
                      反审
                    </el-button>
                    <el-button
                      v-permission="'delete'"
                      type="danger"
                      plain
                      size="small"
                      :loading="row.__opLoading === 'delete'"
                      @click.stop="softDeleteRow(row)"
                    >
                      删除
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button
                      v-permission="'edit'"
                      type="primary"
                      plain
                      size="small"
                      :loading="row.__opLoading === 'restore'"
                      @click.stop="restoreRow(row)"
                    >
                      恢复
                    </el-button>
                    <el-button
                      v-permission="'delete'"
                      type="danger"
                      plain
                      size="small"
                      :loading="row.__opLoading === 'permanent'"
                      @click.stop="hardDeleteRow(row)"
                    >
                      彻底删除
                    </el-button>
                  </template>
                </div>
              </template>
            </el-table-column>
            <el-table-column type="expand" width="48">
              <template #default="{ row }">
                <div v-loading="row.__linesLoading" class="expand-inner">
                  <el-table
                    v-if="(row.__lines || []).length"
                    :data="row.__lines"
                    border
                    size="small"
                    class="so-lines-table so-expanded-lines-table"
                    style="width: 100%"
                    scrollbar-always-on
                  >
                    <el-table-column type="index" label="序号" width="58" />
                    <el-table-column
                      label="操作"
                      :width="expandedLineActionsColWidth"
                      fixed="left"
                      align="left"
                      header-align="center"
                      class-name="erp-col-actions"
                    >
                      <template #default>
                        <div class="action-bar so-line-actions">
                          <el-button type="info" plain size="small" @click.stop="onExpandedLineViewPlaceholder">
                            查看
                          </el-button>
                        </div>
                      </template>
                    </el-table-column>
                    <el-table-column label="客款号" prop="customerStyleNo" min-width="150" show-overflow-tooltip />
                    <el-table-column label="编码" prop="kcaa01" min-width="150" show-overflow-tooltip />
                    <el-table-column label="名称" prop="materialNameCn" min-width="220" show-overflow-tooltip />
                    <el-table-column label="规格" prop="spec" min-width="220" show-overflow-tooltip />
                    <el-table-column label="组别" prop="groupName" min-width="120" show-overflow-tooltip />
                    <el-table-column label="单位" prop="unit" width="90" show-overflow-tooltip />
                    <el-table-column label="数量" width="130" align="right">
                      <template #default="{ row: line }">{{ formatOrderQty(line.orderQty) }}</template>
                    </el-table-column>
                    <el-table-column label="用量" width="220" align="right">
                      <template #default="{ row: line }">{{ formatUsageCostText(line.usageCostText) }}</template>
                    </el-table-column>
                    <el-table-column label="单价" width="110" align="right">
                      <template #default="{ row: line }">{{ formatMoney(line.unitPrice) }}</template>
                    </el-table-column>
                    <el-table-column label="金额" width="118" align="right">
                      <template #default="{ row: line }">{{ formatMoney(getDisplayLineAmount(line)) }}</template>
                    </el-table-column>
                    <el-table-column label="备注" prop="remark" min-width="220" show-overflow-tooltip />
                  </el-table>
                  <el-empty v-else-if="!row.__linesLoading" description="暂无明细" />
                </div>
              </template>
            </el-table-column>
            <el-table-column label="PI 号" prop="piNo" min-width="132" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="code-bold">{{ formatCell(row.piNo) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="PO 号" prop="poNo" min-width="132" show-overflow-tooltip />
            <el-table-column label="客户" prop="customerName" min-width="160" show-overflow-tooltip />
            <el-table-column label="币别" prop="currencyName" width="88" show-overflow-tooltip />
            <el-table-column label="交货日期" width="118">
              <template #default="{ row }">{{ formatSalesOrderDate(row.deliveryDate) }}</template>
            </el-table-column>
            <el-table-column label="审核" width="88">
              <template #default="{ row }">
                <el-tag v-if="passIsAudited(row)" type="success" size="small">已审</el-tag>
                <el-tag v-else type="warning" size="small">未审</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="运算状态" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.calcStatus === '已运算'" type="success" size="small">已运算</el-tag>
                <el-tag v-else type="info" size="small">未运算</el-tag>
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-row pagination-row--bottom">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              background
              size="small"
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :page-sizes="[5, 10, 20, 50, 100]"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <el-dialog
      v-model="viewVisible"
      title="查看销售订单"
      width="85%"
      top="5vh"
      draggable
      destroy-on-close
      :close-on-click-modal="false"
      class="so-view-dialog erp-page-dialog"
    >
      <div v-loading="viewLoading" class="detail-wrap">
        <el-tabs v-model="viewActiveTab" @tab-change="onViewTabChange">
          <el-tab-pane label="主表" name="header">
            <el-descriptions v-if="viewHeader" :column="2" border size="small" class="so-header-desc">
              <el-descriptions-item label="PI 号">{{ formatCell(viewHeader.piNo) }}</el-descriptions-item>
              <el-descriptions-item label="PO 号">{{ formatCell(viewHeader.poNo) }}</el-descriptions-item>
              <el-descriptions-item label="客户">{{ formatCell(viewHeader.customerName) }}</el-descriptions-item>
              <el-descriptions-item label="币别">{{ formatCell(viewHeader.currencyName) }}</el-descriptions-item>
              <el-descriptions-item label="交货日期">{{
                formatSalesOrderDate(viewHeader.deliveryDate)
              }}</el-descriptions-item>
              <el-descriptions-item label="审核">
                <el-tag v-if="passIsAudited(viewHeader)" type="success" size="small">已审</el-tag>
                <el-tag v-else type="warning" size="small">未审</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="运算状态">
                <el-tag v-if="viewHeader.calcStatus === '已运算'" type="success" size="small">已运算</el-tag>
                <el-tag v-else type="info" size="small">未运算</el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="小数位数">{{
                formatCell(viewHeader.decimalPlaces)
              }}</el-descriptions-item>
              <el-descriptions-item label="备注" :span="2">{{
                formatCell(viewHeader.remark)
              }}</el-descriptions-item>
            </el-descriptions>
            <el-empty v-else description="无主表数据" />
          </el-tab-pane>
          <el-tab-pane label="明细" name="lines">
            <div
              v-if="viewHeader && !showRecycle && !passIsAudited(viewHeader) && viewLines.length"
              class="lines-toolbar"
            >
              <el-button
                v-permission="'edit'"
                type="primary"
                plain
                size="small"
                :disabled="!syncBomSelectedCount || syncBomBatchLoading"
                :loading="syncBomBatchLoading"
                @click="batchSyncBomFromView"
              >
                {{
                  syncBomBatchLoading && syncBomBatchProgress.total
                    ? `同步中 (${syncBomBatchProgress.current}/${syncBomBatchProgress.total})`
                    : '批量同步 BOM'
                }}
              </el-button>
              <span v-if="syncBomSelectedCount" class="so-sync-bom-selected-hint">
                已选 {{ syncBomSelectedCount }} 款
              </span>
            </div>
            <el-table
              v-if="viewLines.length"
              class="so-lines-table"
              :data="viewLines"
              border
              size="small"
              style="width: 100%"
              scrollbar-always-on
            >
              <el-table-column type="index" label="序号" width="58" />
              <el-table-column
                v-if="viewHeader && !showRecycle"
                label="操作"
                :width="viewLineActionsColWidth"
                fixed="left"
                align="left"
                header-align="center"
                class-name="erp-col-actions"
              >
                <template #default="{ row }">
                  <div class="action-bar so-line-actions">
                    <el-button type="info" plain size="small" @click="openPiBomTab(row, 'view')">
                      PI BOM
                    </el-button>
                    <el-button
                      v-if="!passIsAudited(viewHeader)"
                      v-permission="'edit'"
                      size="small"
                      class="so-sync-bom-mark-btn"
                      :class="{ 'so-sync-bom-mark-btn--on': isSyncBomSelected(row.kcaa01) }"
                      :disabled="syncBomBatchLoading"
                      @click="toggleSyncBomSelection(row)"
                    >
                      {{ isSyncBomSelected(row.kcaa01) ? '已选择' : '同步 BOM' }}
                    </el-button>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="编码" prop="kcaa01" min-width="128" show-overflow-tooltip />
              <el-table-column label="数量" width="100" align="right">
                <template #default="{ row }">{{ formatOrderQty(row.orderQty) }}</template>
              </el-table-column>
              <el-table-column label="单价" width="110" align="right">
                <template #default="{ row }">{{ formatMoney(row.unitPrice) }}</template>
              </el-table-column>
              <el-table-column label="金额" width="118" align="right">
                <template #default="{ row }">{{ formatMoney(getLineAmount(row)) }}</template>
              </el-table-column>
              <el-table-column label="客款号" prop="customerStyleNo" min-width="120" show-overflow-tooltip />
              <el-table-column label="备注" prop="remark" min-width="140" show-overflow-tooltip />
              <el-table-column label="用料名称(中文)" prop="materialNameCn" min-width="160" show-overflow-tooltip />
              <el-table-column label="组别" prop="groupName" min-width="100" show-overflow-tooltip />
              <el-table-column label="工厂款号" prop="factoryStyleNo" min-width="120" show-overflow-tooltip />
              <el-table-column label="版本" prop="version" width="88" show-overflow-tooltip />
            </el-table>
            <el-empty v-else description="暂无明细" />
          </el-tab-pane>
          <el-tab-pane label="PI BOM" name="piBom">
            <p class="so-lines-hint">
              仅维护 PI 销售 BOM 用量，不从主 BOM 拉取（拉取请用明细「同步 BOM」）。改用量后须重新一键运算。
            </p>
            <div v-if="!viewHeader?.id" class="so-pi-bom-empty">
              <el-empty description="请先保存订单后再查看 PI BOM" />
            </div>
            <template v-else>
              <div class="so-pi-bom-toolbar">
                <span class="so-pi-bom-label">成品款</span>
                <el-select
                  v-model="piBomProduct"
                  filterable
                  placeholder="选择明细款号"
                  style="min-width: 280px"
                  :loading="piBomLoading"
                  @change="onPiBomProductChange('view')"
                >
                  <el-option
                    v-for="p in piBomProducts"
                    :key="p.kcaa01"
                    :label="`${p.kcaa01}${p.hasBom ? '' : '（未建 BOM）'}`"
                    :value="p.kcaa01"
                  />
                </el-select>
              </div>
              <div v-loading="piBomLoading" class="so-pi-bom-table-wrap">
                <el-table
                  v-if="piBomTree.length"
                  :data="piBomTree"
                  row-key="id"
                  border
                  size="small"
                  class="so-lines-table so-pi-bom-tree-table"
                  default-expand-all
                  :tree-props="{ children: 'children' }"
                  max-height="calc(80vh - 320px)"
                  scrollbar-always-on
                >
                  <el-table-column label="子件编码" prop="kcaa01" min-width="128" show-overflow-tooltip />
                  <el-table-column label="名称" prop="kcaa02" min-width="120" show-overflow-tooltip />
                  <el-table-column label="规格" prop="kcaa03" min-width="96" show-overflow-tooltip />
                  <el-table-column label="单位用量" width="120" align="right">
                    <template #default="{ row }">{{ formatPiBomQty(row.kcac04) }}</template>
                  </el-table-column>
                  <el-table-column label="损耗" width="88" align="right">
                    <template #default="{ row }">{{ formatPiBomQty(row.kcac05) }}</template>
                  </el-table-column>
                  <el-table-column label="备注" prop="Describe" min-width="100" show-overflow-tooltip />
                </el-table>
                <el-empty v-else-if="piBomProduct" description="该款暂无 PI BOM 子件" />
                <el-empty v-else description="请选择成品款" />
              </div>
            </template>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <div class="action-bar action-bar--footer">
          <el-button size="small" @click="viewVisible = false">关闭</el-button>
          <template v-if="viewHeader">
            <template v-if="!showRecycle">
              <el-button
                v-if="!passIsAudited(viewHeader)"
                v-permission="'edit'"
                type="primary"
                size="small"
                @click="openEditFromView"
              >
                编辑
              </el-button>
              <el-button
                v-if="!passIsAudited(viewHeader)"
                v-permission="'audit'"
                type="success"
                size="small"
                @click="auditRow(viewHeader)"
              >
                审核
              </el-button>
              <el-button
                v-if="passIsAudited(viewHeader)"
                v-permission="'audit'"
                type="warning"
                size="small"
                @click="unauditRow(viewHeader)"
              >
                反审
              </el-button>
              <el-button v-permission="'delete'" type="danger" size="small" @click="softDeleteRow(viewHeader)">
                删除
              </el-button>
            </template>
            <template v-else>
              <el-button v-permission="'edit'" type="primary" size="small" @click="restoreRow(viewHeader)">恢复</el-button>
              <el-button v-permission="'delete'" type="danger" size="small" @click="hardDeleteRow(viewHeader)">
                彻底删除
              </el-button>
            </template>
          </template>
        </div>
      </template>
    </el-dialog>

    <section
      v-show="editVisible"
      :class="['so-edit-panel', { 'so-edit-panel--standalone': isSalesOrderStandaloneWindow }]"
    >
      <div class="so-edit-panel__header">
        <h2 class="so-edit-panel__title">
          {{ editMode === 'create' ? '新增销售订单' : '编辑销售订单' }}
        </h2>
      </div>
      <div v-loading="editLoading" class="detail-wrap">
        <el-tabs v-model="editActiveTab" @tab-change="onEditTabChange">
          <el-tab-pane label="主表" name="header">
            <el-form label-width="108px" class="so-edit-form" :disabled="editDetailLocked" @submit.prevent>
              <el-row :gutter="12">
                <el-col :xs="24" :sm="12">
                  <el-form-item label="PI 号" required>
                    <el-input
                      v-model="headerForm.piNo"
                      :disabled="editMode !== 'create'"
                      clearable
                      placeholder="如 PI-0001"
                      @blur="onPiNoBlur"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="PO 号">
                    <el-input
                      v-model="headerForm.poNo"
                      clearable
                      placeholder="请输入 PO 号"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="销售日期" required>
                    <el-date-picker
                      v-model="headerForm.salesDate"
                      type="date"
                      value-format="YYYY-MM-DD"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="交货日期">
                    <el-date-picker
                      v-model="headerForm.deliveryDate"
                      type="date"
                      value-format="YYYY-MM-DD"
                      clearable
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="客户" required>
                    <el-select
                      v-model="headerForm.customerCode"
                      filterable
                      remote
                      reserve-keyword
                      placeholder="搜索已审客户"
                      :remote-method="searchCustomers"
                      :loading="customerLoading"
                      clearable
                      style="width: 100%"
                    >
                      <el-option
                        v-for="c in customerOptions"
                        :key="c.s_code"
                        :label="`${c.s_code} ${c.s_name}`"
                        :value="String(c.s_code)"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="币别" required>
                    <el-select
                      v-model="headerForm.currencyCode"
                      placeholder="选择币别"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="c in currencyOptions"
                        :key="c.id"
                        :label="formatCurrencyOption(c)"
                        :value="String(c.id)"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :sm="12">
                  <el-form-item label="小数位数">
                    <el-input-number
                      v-model="headerForm.decimalPlaces"
                      :min="0"
                      :max="8"
                      controls-position="right"
                      style="width: 100%"
                    />
                  </el-form-item>
                </el-col>
                <el-col :span="24">
                  <el-form-item label="备注">
                    <el-input v-model="headerForm.remark" type="textarea" :rows="2" />
                  </el-form-item>
                </el-col>
              </el-row>
            </el-form>
          </el-tab-pane>
          <el-tab-pane label="明细" name="lines">
            <el-alert
              v-if="editDetailLocked"
              title="该订单已审核，需先反审后才能修改明细并保存。"
              type="warning"
              show-icon
              :closable="false"
              class="audit-alert"
            />
            <p class="so-lines-hint">
              选材后填写订货数量；删除行仅影响界面，点击保存后才会落库并同步 PI BOM 对齐。
            </p>
            <div class="lines-toolbar">
              <el-button
                type="primary"
                plain
                size="small"
                :disabled="editDetailLocked"
                @click="openMaterialPicker"
              >
                增行
              </el-button>
              <el-button
                v-if="editMode === 'edit' && editId"
                v-permission="'edit'"
                type="primary"
                plain
                size="small"
                :disabled="editDetailLocked || !syncBomSelectedCount || syncBomBatchLoading"
                :loading="syncBomBatchLoading"
                @click="batchSyncBomFromEdit"
              >
                {{
                  syncBomBatchLoading && syncBomBatchProgress.total
                    ? `同步中 (${syncBomBatchProgress.current}/${syncBomBatchProgress.total})`
                    : '批量同步 BOM'
                }}
              </el-button>
              <span
                v-if="editMode === 'edit' && editId && syncBomSelectedCount"
                class="so-sync-bom-selected-hint"
              >
                已选 {{ syncBomSelectedCount }} 款
              </span>
            </div>
            <el-table
              :data="lineRows"
              border
              size="small"
              class="so-lines-table"
              scrollbar-always-on
              max-height="calc(80vh - 280px)"
            >
              <el-table-column type="index" label="序号" width="58" />
              <el-table-column
                label="操作"
                :width="editLineActionsColWidth"
                fixed="left"
                align="left"
                header-align="center"
                class-name="erp-col-actions"
              >
                <template #default="{ row, $index }">
                  <div class="action-bar so-line-actions">
                    <el-button
                      v-if="editMode === 'edit' && editId"
                      v-permission="'edit'"
                      type="info"
                      plain
                      size="small"
                      :disabled="editDetailLocked"
                      @click="openPiBomTab(row, 'edit')"
                    >
                      PI BOM
                    </el-button>
                    <el-button
                      v-if="editMode === 'edit' && editId"
                      v-permission="'edit'"
                      size="small"
                      class="so-sync-bom-mark-btn"
                      :class="{ 'so-sync-bom-mark-btn--on': isSyncBomSelected(row.kcaa01) }"
                      :disabled="editDetailLocked || syncBomBatchLoading"
                      @click="toggleSyncBomSelection(row)"
                    >
                      {{ isSyncBomSelected(row.kcaa01) ? '已选择' : '同步 BOM' }}
                    </el-button>
                    <el-button
                      type="danger"
                      plain
                      size="small"
                      :disabled="editDetailLocked"
                      @click="confirmRemoveLine($index)"
                    >
                      删行
                    </el-button>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="编码" prop="kcaa01" min-width="128" show-overflow-tooltip />
              <el-table-column label="数量" width="120">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.orderQty"
                    :min="0"
                    :disabled="editDetailLocked"
                    :controls="false"
                    style="width: 100%"
                  />
                </template>
              </el-table-column>
              <el-table-column label="单价" width="126">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.unitPrice"
                    :min="0"
                    :disabled="editDetailLocked"
                    :controls="false"
                    style="width: 100%"
                  />
                </template>
              </el-table-column>
              <el-table-column label="金额" width="118" align="right">
                <template #default="{ row }">{{ formatMoney(getLineAmount(row)) }}</template>
              </el-table-column>
              <el-table-column label="客款号" prop="customerStyleNo" min-width="120" show-overflow-tooltip />
              <el-table-column label="备注" prop="remark" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">{{ formatCell(row.remark) }}</template>
              </el-table-column>
              <el-table-column label="用料名称(中文)" prop="materialNameCn" min-width="160" show-overflow-tooltip />
              <el-table-column label="组别" prop="groupName" min-width="100" show-overflow-tooltip />
              <el-table-column label="工厂款号" prop="factoryStyleNo" min-width="120" show-overflow-tooltip />
              <el-table-column label="版本" prop="version" width="88" show-overflow-tooltip />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="PI BOM" name="piBom">
            <el-alert
              v-if="editDetailLocked"
              title="该订单已审核，需先反审后才能修改 PI BOM。"
              type="warning"
              show-icon
              :closable="false"
              class="audit-alert"
            />
            <p v-else class="so-lines-hint">
              修改 PI 内子件用量后请点击「保存 PI BOM」；订单将标为未运算。同步主 BOM 请回明细 Tab。
            </p>
            <div v-if="editMode === 'create' || !editId" class="so-pi-bom-empty">
              <el-empty description="请先保存订单后再维护 PI BOM" />
            </div>
            <template v-else>
              <div class="so-pi-bom-toolbar">
                <span class="so-pi-bom-label">成品款</span>
                <el-select
                  v-model="piBomProduct"
                  filterable
                  placeholder="选择明细款号"
                  style="min-width: 280px"
                  :loading="piBomLoading"
                  @change="onPiBomProductChange('edit')"
                >
                  <el-option
                    v-for="p in piBomProducts"
                    :key="p.kcaa01"
                    :label="`${p.kcaa01}${p.hasBom ? '' : '（未建 BOM）'}`"
                    :value="p.kcaa01"
                  />
                </el-select>
                <el-button
                  v-permission="'edit'"
                  type="primary"
                  plain
                  size="small"
                  :disabled="editDetailLocked || !piBomProduct || !piBomTree.length"
                  :loading="piBomSaveLoading"
                  @click="savePiBom('edit')"
                >
                  保存 PI BOM
                </el-button>
              </div>
              <div v-loading="piBomLoading" class="so-pi-bom-table-wrap">
                <el-table
                  v-if="piBomTree.length"
                  :data="piBomTree"
                  row-key="id"
                  border
                  size="small"
                  class="so-lines-table so-pi-bom-tree-table"
                  default-expand-all
                  :tree-props="{ children: 'children' }"
                  max-height="calc(80vh - 320px)"
                  scrollbar-always-on
                >
                  <el-table-column label="子件编码" prop="kcaa01" min-width="128" show-overflow-tooltip />
                  <el-table-column label="名称" prop="kcaa02" min-width="120" show-overflow-tooltip />
                  <el-table-column label="规格" prop="kcaa03" min-width="96" show-overflow-tooltip />
                  <el-table-column label="单位用量" width="128" align="right">
                    <template #default="{ row }">
                      <el-input-number
                        v-model="row.kcac04"
                        :disabled="editDetailLocked"
                        :min="0"
                        :precision="6"
                        :step="0.000001"
                        :controls="false"
                        class="so-pi-bom-num"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="损耗" width="108" align="right">
                    <template #default="{ row }">
                      <el-input-number
                        v-model="row.kcac05"
                        :disabled="editDetailLocked"
                        :min="0"
                        :precision="6"
                        :step="0.01"
                        :controls="false"
                        class="so-pi-bom-num"
                      />
                    </template>
                  </el-table-column>
                  <el-table-column label="备注" min-width="120">
                    <template #default="{ row }">
                      <el-input
                        v-model="row.Describe"
                        :disabled="editDetailLocked"
                        clearable
                        size="small"
                      />
                    </template>
                  </el-table-column>
                </el-table>
                <el-empty v-else-if="piBomProduct" description="该款暂无 PI BOM 子件，请先保存订单建立 BOM" />
                <el-empty v-else description="请选择成品款" />
              </div>
            </template>
          </el-tab-pane>
        </el-tabs>
      </div>
      <div class="so-edit-panel__footer">
        <div class="action-bar action-bar--footer">
          <el-button size="small" @click="closeEditWindowOrDialog">取消</el-button>
          <el-button
            v-if="editMode === 'create'"
            v-permission="'add'"
            type="primary"
            size="small"
            :loading="saveLoading"
            @click="onSave"
          >
            保存
          </el-button>
          <el-button
            v-else
            v-permission="'edit'"
            type="primary"
            size="small"
            :loading="saveLoading"
            :disabled="editDetailLocked"
            @click="onSave"
          >
            保存
          </el-button>
        </div>
      </div>
    </section>

    <MaterialSelector v-model="materialVisible" multiple @batch-confirm="onMaterialsPicked" />
  </div>
</template>

<script setup>
import { computed, onUnmounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import MaterialSelector from '../purchase-quote/MaterialSelector.vue'
import {
  buildSalesOrderListQueryParams,
  formatCell,
  formatOrderQty,
  formatSalesOrderDate,
  passIsAudited,
} from '@/utils/salesOrderDisplay.js'

defineOptions({ name: 'supply-chain-daily-sales-order' })

const route = useRoute()
const SALES_ORDER_WINDOW_REFRESH_KEY = 'erp:sales-order:list-refresh'
const DEFAULT_CREATE_CUSTOMER_CODE = '7001'
const DEFAULT_CREATE_CUSTOMER_NAME = 'PQD'
const DEFAULT_CREATE_CURRENCY_CODE = '002'
const DEFAULT_CREATE_CURRENCY_NAME = '美元'
const salesOrderWindowMode = computed(() => String(route.query?.mode ?? '').trim().toLowerCase())
const isSalesOrderStandaloneWindow = computed(() => salesOrderWindowMode.value === 'create')

const loading = ref(false)
const errorMessage = ref('')
const pageMode = ref('manage')
const filterKeyword = ref('')
const showRecycle = ref(false)
const showUnAudited = ref(false)
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(5)

const mainTableRef = ref(null)
const detailCache = new Map()
const detailRequestCache = new Map()
const DETAIL_CACHE_LIMIT = 80
let listRequestSeq = 0
const ACTION_BAR_GAP = 8
const ACTION_BAR_CELL_PAD_X = 20
function getActionBarColWidth(buttonCount, options = {}) {
  const count = Math.max(1, Number(buttonCount) || 1)
  const buttonWidth = Number(options.buttonWidth ?? 88)
  const extra = Number(options.extraPx ?? 0)
  return Math.ceil(count * buttonWidth + Math.max(0, count - 1) * ACTION_BAR_GAP + ACTION_BAR_CELL_PAD_X + extra)
}
const salesOrderActionsColWidth = computed(() => 268)
const expandedLineActionsColWidth = computed(() => getActionBarColWidth(1, { buttonWidth: 64 }))
const viewLineActionsColWidth = computed(() => getActionBarColWidth(2, { buttonWidth: 84 }))
const editLineActionsColWidth = computed(() => {
  if (editMode.value === 'create' || !editId.value) {
    return getActionBarColWidth(1, { buttonWidth: 64 })
  }
  return getActionBarColWidth(3, { buttonWidth: 84 })
})

function getOrderCacheKey(rowOrId) {
  const id = typeof rowOrId === 'object' ? rowOrId?.id : rowOrId
  const n = Number(id)
  return Number.isFinite(n) && n > 0 ? String(n) : ''
}

function normalizeDetailPayload(res) {
  const data = res?.data?.data ?? {}
  return {
    header: data.header ?? null,
    lines: Array.isArray(data.lines) ? data.lines : [],
  }
}

function rememberDetail(orderId, detail) {
  const key = getOrderCacheKey(orderId)
  if (!key) return detail
  if (detailCache.has(key)) detailCache.delete(key)
  detailCache.set(key, detail)
  if (detailCache.size > DETAIL_CACHE_LIMIT) {
    const oldestKey = detailCache.keys().next().value
    if (oldestKey) detailCache.delete(oldestKey)
  }
  return detail
}

function forgetDetail(orderId) {
  const key = getOrderCacheKey(orderId)
  if (!key) return
  detailCache.delete(key)
  detailRequestCache.delete(key)
}

function attachCachedDetail(row) {
  const key = getOrderCacheKey(row)
  const cached = key ? detailCache.get(key) : null
  if (!cached) return row
  return {
    ...row,
    __lines: cached.lines,
    __linesLoaded: true,
    __linesLoading: false,
  }
}

async function fetchOrderDetail(orderId, options = {}) {
  const key = getOrderCacheKey(orderId)
  if (!key) return { header: null, lines: [] }
  if (!options.force && detailCache.has(key)) return detailCache.get(key)
  if (!options.force && detailRequestCache.has(key)) return detailRequestCache.get(key)
  const request = axios
    .get(`/api/sales-order/${key}`)
    .then((res) => rememberDetail(key, normalizeDetailPayload(res)))
    .finally(() => {
      detailRequestCache.delete(key)
    })
  detailRequestCache.set(key, request)
  return request
}

const viewVisible = ref(false)
const viewLoading = ref(false)
const viewActiveTab = ref('header')
/** @type {import('vue').Ref<Record<string, unknown> | null>} */
const viewHeader = ref(null)
const viewLines = ref([])

const editVisible = ref(false)
const editLoading = ref(false)
const saveLoading = ref(false)
/** @type {import('vue').Ref<'create' | 'edit'>} */
const editMode = ref('create')
const editId = ref(null)
const editActiveTab = ref('header')
const headerForm = reactive({
  piNo: '',
  poNo: '',
  salesDate: '',
  deliveryDate: '',
  customerCode: '',
  currencyCode: '',
  remark: '',
  decimalPlaces: 2,
})
/** @type {import('vue').Ref<{ kcaa01: string, orderQty: number, unitPrice: number, remark?: string, customerStyleNo?: string, materialNameCn?: string, groupName?: string, factoryStyleNo?: string, version?: string }[]>} */
const lineRows = ref([])
const currencyOptions = ref([])
const customerOptions = ref([])
const customerLoading = ref(false)
const materialVisible = ref(false)
/** 批量同步 BOM：待同步款号（关弹窗/重开订单清空） */
const syncBomSelected = ref([])
/** 批量同步进行中 */
const syncBomBatchLoading = ref(false)
/** 批量同步进度 */
const syncBomBatchProgress = ref({ current: 0, total: 0 })
const syncBomSelectedCount = computed(() => syncBomSelected.value.length)
/** 编辑页主表 pass（已审锁明细） */
const editHeaderPass = ref('0')
/** 编辑页运算状态（与列表 calcStatus 一致） */
const editHeaderCalcStatus = ref('未运算')
const calculateLoading = ref(false)
const spareUsageLoading = ref(false)
/** 本次会话内已同步 BOM、待部分重算的款号 */
const syncedSinceCalc = ref([])
/** 打开编辑时保存快照，用于运算前未保存拦截 */
const editSaveSnapshot = ref('')
/** PI BOM Tab：当前成品款、树、款列表 */
const piBomProduct = ref('')
const piBomTree = ref([])
const piBomProducts = ref([])
const piBomLoading = ref(false)
const piBomSaveLoading = ref(false)
const piChecking = ref(false)

const editDetailLocked = computed(() => editMode.value === 'edit' && passIsAudited({ pass: editHeaderPass.value }))

function captureEditSnapshot() {
  editSaveSnapshot.value = JSON.stringify(buildSaveBody())
}

function isEditDirty() {
  if (editMode.value !== 'edit') return false
  return editSaveSnapshot.value !== JSON.stringify(buildSaveBody())
}

function getLineAmount(row) {
  const qty = Number(row?.orderQty)
  const price = Number(row?.unitPrice)
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0
  return Number((qty * price).toFixed(6))
}

function getDisplayLineAmount(row) {
  const amount = Number(row?.amount)
  if (Number.isFinite(amount)) return amount
  return getLineAmount(row)
}

function formatUsageCostText(value) {
  const text = String(value ?? '').trim()
  return text || '-'
}

function formatMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.000000'
  return n.toFixed(6)
}

/**
 * @param {{ id: number, calcStatus?: string }} row
 * @param {boolean} fromEdit
 */
async function calculateOrder(row, fromEdit) {
  const orderId = Number(row?.id)
  if (!orderId) return
  if (fromEdit && isEditDirty()) {
    await ElMessageBox.alert('检测到未保存的主表或明细变更，请先保存后再运算。', '请先保存', {
      type: 'warning',
    })
    return
  }
  const partial = fromEdit && syncedSinceCalc.value.length > 0
  const tip = partial
    ? `将仅重算已同步 BOM 的 ${syncedSinceCalc.value.length} 款，其它款物料单不变。确认运算？`
    : '将按当前 PI BOM 重写物料单（不乘订货数量）。确认一键运算？'
  try {
    await ElMessageBox.confirm(tip, '一键运算', {
      type: 'warning',
      confirmButtonText: '运算',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  calculateLoading.value = true
  try {
    const body =
      partial && syncedSinceCalc.value.length
        ? { syncedKcaa01: [...syncedSinceCalc.value] }
        : {}
    const res = await axios.post(`/api/sales-order/${orderId}/calculate`, body)
    ElMessage.success(res?.data?.msg ?? '运算成功')
    syncedSinceCalc.value = []
    forgetDetail(orderId)
    const detail = await fetchOrderDetail(orderId, { force: true })
    const hdr = detail.header ?? {}
    if (viewVisible.value && viewHeader.value?.id === orderId) {
      viewHeader.value = hdr
      viewLines.value = detail.lines
    }
    if (editVisible.value && editId.value === orderId) {
      editHeaderPass.value = String(hdr.pass ?? '0')
      editHeaderCalcStatus.value = String(hdr.calcStatus ?? '已运算')
      captureEditSnapshot()
    }
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '运算失败'))
  } finally {
    calculateLoading.value = false
  }
}

/**
 * @param {{ id: number, hasSpareParts?: boolean }} row
 */
async function addSpareUsage(row) {
  const orderId = Number(row?.id)
  if (!orderId || !row?.hasSpareParts || !row?.canAddSpareUsage) return
  try {
    await ElMessageBox.confirm(
      '将为散件明细写入自用量（kcac04=1，不乘订货数量），仅更新 UB_ERP_Bom_pi_cost。确认继续？',
      '增加散件单用量',
      {
        type: 'warning',
        confirmButtonText: '确认',
        cancelButtonText: '取消',
      },
    )
  } catch {
    return
  }
  spareUsageLoading.value = true
  try {
    const res = await axios.post(`/api/sales-order/${orderId}/add-spare-usage`)
    ElMessage.success(res?.data?.msg ?? '散件单用量已增加')
    forgetDetail(orderId)
    if (viewVisible.value && viewHeader.value?.id === orderId) {
      const detail = await fetchOrderDetail(orderId, { force: true })
      viewHeader.value = detail.header ?? viewHeader.value
      viewLines.value = detail.lines
    }
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '增加散件单用量失败'))
  } finally {
    spareUsageLoading.value = false
  }
}

function resetPiBomState() {
  piBomProduct.value = ''
  piBomTree.value = []
  piBomProducts.value = []
}

function clearSyncBomSelected() {
  syncBomSelected.value = []
}

/** @param {string} kcaa01 */
function isSyncBomSelected(kcaa01) {
  const code = String(kcaa01 ?? '').trim()
  return Boolean(code && syncBomSelected.value.includes(code))
}

/** @param {{ kcaa01?: string }} row */
function toggleSyncBomSelection(row) {
  if (editVisible.value && editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再同步 BOM。')
    return
  }
  if (viewVisible.value && passIsAudited(viewHeader.value)) {
    ElMessage.warning('该订单已审核，请先反审后再同步 BOM。')
    return
  }
  const code = String(row?.kcaa01 ?? '').trim()
  if (!code) return
  if (isSyncBomSelected(code)) {
    syncBomSelected.value = syncBomSelected.value.filter((c) => c !== code)
  } else {
    syncBomSelected.value = [...syncBomSelected.value, code]
  }
}

function formatPiBomQty(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n * 1e6) / 1e6)
}

/**
 * @param {any[]} nodes
 * @param {any[]} [out]
 */
function flattenPiBomTreeNodes(nodes, out = []) {
  for (const n of nodes ?? []) {
    if (n?.id != null && Number(n.id) > 0) {
      out.push({
        id: Number(n.id),
        kcac04: Number(n.kcac04 ?? 0),
        kcac05: Number(n.kcac05 ?? 0),
        Describe: String(n.Describe ?? ''),
      })
    }
    if (Array.isArray(n?.children) && n.children.length) flattenPiBomTreeNodes(n.children, out)
  }
  return out
}

async function loadPiBomProductList(orderId) {
  if (!orderId) return
  piBomLoading.value = true
  try {
    const res = await axios.get(`/api/sales-order/${orderId}/pi-bom`)
    const products = Array.isArray(res?.data?.data?.products) ? res.data.data.products : []
    piBomProducts.value = products
    if (piBomProduct.value && !products.some((p) => p.kcaa01 === piBomProduct.value)) {
      piBomProduct.value = ''
      piBomTree.value = []
    }
  } catch (e) {
    piBomProducts.value = []
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载 PI BOM 款列表失败'))
  } finally {
    piBomLoading.value = false
  }
}

async function loadPiBomTree(orderId, kcaa01) {
  const code = String(kcaa01 ?? '').trim()
  if (!orderId || !code) {
    piBomTree.value = []
    return
  }
  piBomLoading.value = true
  try {
    const res = await axios.get(`/api/sales-order/${orderId}/pi-bom`, { params: { kcaa01: code } })
    piBomTree.value = Array.isArray(res?.data?.data?.tree) ? res.data.data.tree : []
    const products = Array.isArray(res?.data?.data?.products) ? res.data.data.products : []
    if (products.length) piBomProducts.value = products
  } catch (e) {
    piBomTree.value = []
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载 PI BOM 失败'))
  } finally {
    piBomLoading.value = false
  }
}

/**
 * @param {'view' | 'edit'} mode
 */
async function onPiBomProductChange(mode) {
  const orderId =
    mode === 'view' ? Number(viewHeader.value?.id) : Number(editId.value)
  if (!orderId || !piBomProduct.value) {
    piBomTree.value = []
    return
  }
  await loadPiBomTree(orderId, piBomProduct.value)
}

/**
 * @param {{ kcaa01?: string }} row
 * @param {'view' | 'edit'} mode
 */
async function openPiBomTab(row, mode) {
  const code = String(row?.kcaa01 ?? '').trim()
  if (!code) return
  piBomProduct.value = code
  if (mode === 'view') {
    viewActiveTab.value = 'piBom'
    const orderId = Number(viewHeader.value?.id)
    if (!orderId) return
    await loadPiBomProductList(orderId)
    await loadPiBomTree(orderId, code)
  } else {
    editActiveTab.value = 'piBom'
    const orderId = Number(editId.value)
    if (!orderId) return
    await loadPiBomProductList(orderId)
    await loadPiBomTree(orderId, code)
  }
}

/**
 * @param {'view' | 'edit'} mode
 */
async function savePiBom(mode) {
  const orderId =
    mode === 'view' ? Number(viewHeader.value?.id) : Number(editId.value)
  const code = String(piBomProduct.value ?? '').trim()
  if (!orderId || !code) return
  if (mode === 'edit' && editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再修改 PI BOM。')
    return
  }
  const lines = flattenPiBomTreeNodes(piBomTree.value)
  if (!lines.length) {
    ElMessage.warning('没有可保存的 PI BOM 行')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认保存款【${code}】的 PI BOM 用量吗？保存后订单将标为「未运算」，须重新一键运算物料单。`,
      '保存 PI BOM',
      { type: 'warning', confirmButtonText: '保存', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  piBomSaveLoading.value = true
  try {
    const res = await axios.put(`/api/sales-order/${orderId}/pi-bom`, { kcaa01: code, lines })
    ElMessage.success(res?.data?.msg ?? '保存 PI BOM 成功')
    if (mode === 'edit') {
      editHeaderCalcStatus.value = '未运算'
    } else if (viewHeader.value) {
      viewHeader.value = { ...viewHeader.value, calcStatus: '未运算' }
    }
    await loadPiBomTree(orderId, code)
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存 PI BOM 失败'))
  } finally {
    piBomSaveLoading.value = false
  }
}

function onViewTabChange(name) {
  if (name === 'piBom' && viewHeader.value?.id) {
    loadPiBomProductList(Number(viewHeader.value.id)).then(() => {
      if (piBomProduct.value) loadPiBomTree(Number(viewHeader.value.id), piBomProduct.value)
    })
  }
}

function onEditTabChange(name) {
  if (name === 'piBom' && editId.value) {
    loadPiBomProductList(Number(editId.value)).then(() => {
      if (piBomProduct.value) loadPiBomTree(Number(editId.value), piBomProduct.value)
    })
  }
}

function todayYmd() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function loadCurrencyOptions() {
  if (currencyOptions.value.length) return
  try {
    const res = await axios.get('/api/sales-order/currency-options')
    currencyOptions.value = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
  } catch {
    currencyOptions.value = []
  }
}

function formatCurrencyOption(c) {
  const id = Number(c?.id)
  const code = Number.isFinite(id) ? String(id).padStart(3, '0') : String(c?.id ?? '').trim()
  const name = String(c?.cn_name ?? '').trim()
  return name ? `${code},${name}` : code
}

function findCurrencyOptionByDisplay(code, name) {
  return currencyOptions.value.find((c) => {
    const id = Number(c?.id)
    const displayCode = Number.isFinite(id) ? String(id).padStart(3, '0') : String(c?.id ?? '').trim()
    const displayName = String(c?.cn_name ?? '').trim()
    return displayCode === code && displayName === name
  })
}

async function searchCustomers(keyword) {
  customerLoading.value = true
  try {
    const res = await axios.get('/api/supply-chain/customers/list', {
      params: { pass: 1, page: 1, pageSize: 50, keyword: String(keyword ?? '').trim() },
    })
    const list = Array.isArray(res?.data?.data?.list) ? res.data.data.list : []
    customerOptions.value = list
    return list
  } catch {
    customerOptions.value = []
    return []
  } finally {
    customerLoading.value = false
  }
}

async function applyDefaultCreateCustomer() {
  const list = await searchCustomers(DEFAULT_CREATE_CUSTOMER_NAME)
  const hit = list.find((c) => {
    const code = String(c?.s_code ?? '').trim()
    const name = String(c?.s_name ?? '').trim().toUpperCase()
    return code === DEFAULT_CREATE_CUSTOMER_CODE && name === DEFAULT_CREATE_CUSTOMER_NAME
  })
  if (hit) headerForm.customerCode = String(hit.s_code ?? '').trim()
}

function applyDefaultCreateCurrency() {
  const hit = findCurrencyOptionByDisplay(DEFAULT_CREATE_CURRENCY_CODE, DEFAULT_CREATE_CURRENCY_NAME)
  if (hit) headerForm.currencyCode = String(hit.id ?? '').trim()
}

function resetHeaderForm() {
  headerForm.piNo = 'PI-'
  headerForm.poNo = ''
  headerForm.salesDate = todayYmd()
  headerForm.deliveryDate = ''
  headerForm.customerCode = ''
  headerForm.currencyCode = ''
  headerForm.remark = ''
  headerForm.decimalPlaces = 6
  lineRows.value = []
}

function docLabel(row) {
  const pi = String(row?.piNo ?? '').trim()
  const sc = String(row?.systemCode ?? '').trim()
  if (pi && sc) return `${pi}（${sc}）`
  return pi || sc || `ID ${row?.id ?? ''}`
}

function notifySalesOrderListRefresh() {
  localStorage.setItem(SALES_ORDER_WINDOW_REFRESH_KEY, String(Date.now()))
}

function closeStandaloneBrowserWindow() {
  window.close()
}

function closeEditWindowOrDialog() {
  if (isSalesOrderStandaloneWindow.value) {
    closeStandaloneBrowserWindow()
    return
  }
  editVisible.value = false
  pageMode.value = 'manage'
}

function switchToManage() {
  editVisible.value = false
  pageMode.value = 'manage'
}

async function switchToCreate() {
  await openCreate()
}

function setRowLoading(row, key) {
  const x = tableList.value.find((r) => r.id === row.id)
  if (x) x.__opLoading = key
}

function normalizePiNo(v) {
  return String(v ?? '').trim()
}

async function checkPiNoDuplicate() {
  if (editMode.value !== 'create') return false
  const piNo = normalizePiNo(headerForm.piNo)
  if (!piNo || piNo === 'PI-') return false
  piChecking.value = true
  try {
    const res = await axios.get('/api/sales-order/check-pi', { params: { piNo } })
    const exists = Boolean(res?.data?.data?.exists)
    if (exists) {
      ElMessage.warning(res?.data?.data?.duplicateMessage || `PI 号「${piNo}」已存在`)
      return true
    }
    return false
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? 'PI 号校验失败'))
    return true
  } finally {
    piChecking.value = false
  }
}

async function onPiNoBlur() {
  await checkPiNoDuplicate()
}

async function openCreate() {
  editMode.value = 'create'
  editId.value = null
  pageMode.value = 'create'
  editHeaderPass.value = '0'
  editHeaderCalcStatus.value = '未运算'
  syncedSinceCalc.value = []
  clearSyncBomSelected()
  resetPiBomState()
  editActiveTab.value = 'header'
  resetHeaderForm()
  await loadCurrencyOptions()
  applyDefaultCreateCurrency()
  await applyDefaultCreateCustomer()
  editVisible.value = true
}

/** @param {Record<string, unknown>} header */
function fillHeaderFromDetail(header) {
  headerForm.piNo = String(header.piNo ?? '').trim()
  headerForm.poNo = String(header.poNo ?? '').trim()
  headerForm.salesDate = formatSalesOrderDate(header.salesDate)
  if (headerForm.salesDate === '—') headerForm.salesDate = todayYmd()
  const dd = formatSalesOrderDate(header.deliveryDate)
  headerForm.deliveryDate = dd === '—' ? '' : dd
  headerForm.customerCode = String(header.customerCode ?? '').trim()
  headerForm.remark = String(header.remark ?? '')
  headerForm.decimalPlaces = Number(header.decimalPlaces ?? 2) || 2
  const code = String(header.currencyCode ?? '').trim()
  const name = String(header.currencyName ?? '').trim()
  const hit = code
    ? currencyOptions.value.find((c) => String(c.id ?? '').trim() === code)
    : currencyOptions.value.find((c) => String(c.cn_name ?? '').trim() === name)
  headerForm.currencyCode = hit ? String(hit.id) : ''
}

/** @param {Record<string, unknown>} row */
async function openEdit(row) {
  if (!row?.id) return
  if (passIsAudited(row)) {
    await ElMessageBox.alert('该数据已审核，需先反审后才能编辑。', '提示', { type: 'warning' })
    return
  }
  editMode.value = 'edit'
  editId.value = Number(row.id)
  pageMode.value = 'edit'
  editHeaderPass.value = String(row.pass ?? '0')
  clearSyncBomSelected()
  resetPiBomState()
  editActiveTab.value = 'header'
  editLoading.value = true
  editVisible.value = true
  await loadCurrencyOptions()
  try {
    const data = await fetchOrderDetail(row.id)
    const hdr = data.header ?? {}
    fillHeaderFromDetail(hdr)
    editHeaderPass.value = String(hdr.pass ?? '0')
    editHeaderCalcStatus.value = String(hdr.calcStatus ?? '未运算')
    syncedSinceCalc.value = []
    const lines = data.lines
    lineRows.value = lines.map((ln) => ({
      kcaa01: String(ln.kcaa01 ?? '').trim(),
      orderQty: Number.isFinite(Number(ln.orderQty)) ? Number(ln.orderQty) : 0,
      unitPrice: Number.isFinite(Number(ln.unitPrice)) ? Number(ln.unitPrice) : 0,
      remark: String(ln.remark ?? ''),
      customerStyleNo: String(ln.customerStyleNo ?? ln.kcaa06 ?? ''),
      materialNameCn: String(ln.materialNameCn ?? ln.productName ?? ln.kcaa02 ?? ''),
      groupName: String(ln.groupName ?? ln.kcaa10 ?? ''),
      factoryStyleNo: String(ln.factoryStyleNo ?? ln.kcaa09 ?? ''),
      version: String(ln.version ?? ''),
    }))
    if (headerForm.customerCode) {
      customerOptions.value = [
        {
          s_code: headerForm.customerCode,
          s_name: String(data.header?.customerName ?? ''),
        },
      ]
    }
    captureEditSnapshot()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    editVisible.value = false
    pageMode.value = 'manage'
  } finally {
    editLoading.value = false
  }
}

function openEditFromView() {
  if (!viewHeader.value?.id) return
  viewVisible.value = false
  openEdit(viewHeader.value)
}

function openMaterialPicker() {
  if (editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再修改明细。')
    return
  }
  materialVisible.value = true
}

/** @param {Record<string, unknown>[]} payloads */
function onMaterialsPicked(payloads) {
  const list = Array.isArray(payloads) ? payloads : []
  for (const m of list) {
    const code = String(m.kcaa01 ?? '').trim()
    if (!code) continue
    if (lineRows.value.some((x) => x.kcaa01 === code)) continue
    lineRows.value.push({
      kcaa01: code,
      orderQty: 0,
      unitPrice: 0,
      remark: String(m.remark ?? ''),
      customerStyleNo: String(m.kcaa06 ?? ''),
      materialNameCn: String(m.kcaa02 ?? ''),
      groupName: String(m.kcaa10 ?? ''),
      factoryStyleNo: String(m.kcaa09 ?? ''),
      version: String(m.version ?? ''),
    })
  }
}

/**
 * @param {number} orderId
 * @param {string} lastSyncedCode
 */
async function refreshOrderAfterSyncBom(orderId, lastSyncedCode) {
  if (viewVisible.value && viewHeader.value?.id === orderId) {
    const detail = await fetchOrderDetail(orderId, { force: true })
    viewHeader.value = detail.header ?? viewHeader.value
    viewLines.value = detail.lines
  }
  if (editVisible.value && editId.value === orderId) {
    const detail = await fetchOrderDetail(orderId, { force: true })
    const hdr = detail.header ?? {}
    editHeaderPass.value = String(hdr.pass ?? '0')
    editHeaderCalcStatus.value = String(hdr.calcStatus ?? '未运算')
    if (editActiveTab.value === 'piBom' && piBomProduct.value === lastSyncedCode) {
      await loadPiBomTree(orderId, lastSyncedCode)
    }
  }
  await loadData()
}

/**
 * 单款同步 BOM（无确认框，供批量顺序调用）
 * @param {string} code
 * @param {number} orderId
 */
async function executeSyncBomForLine(code, orderId) {
  const res = await axios.post(`/api/sales-order/${orderId}/sync-bom`, { kcaa01: code })
  if (!syncedSinceCalc.value.includes(code)) syncedSinceCalc.value.push(code)
  forgetDetail(orderId)
  return String(res?.data?.msg ?? '同步 BOM 成功')
}

/**
 * @param {number} orderId
 * @param {string[]} codes
 */
async function batchSyncBom(orderId, codes) {
  const list = codes.map((c) => String(c ?? '').trim()).filter(Boolean)
  if (!orderId || !list.length) {
    ElMessage.warning('请先选择要同步的款。')
    return
  }
  if (editVisible.value && editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再同步 BOM。')
    return
  }
  if (viewVisible.value && passIsAudited(viewHeader.value)) {
    ElMessage.warning('该订单已审核，请先反审后再同步 BOM。')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认将以下 ${list.length} 款的 PI BOM 从主 BOM 覆盖吗？将覆盖 PI 内该款全部子件用量，订单将标为「未运算」。\n\n${list.join('\n')}`,
      '批量同步 BOM 确认',
      { type: 'warning', confirmButtonText: '同步', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  syncBomBatchLoading.value = true
  syncBomBatchProgress.value = { current: 0, total: list.length }
  const succeeded = []
  try {
    for (let i = 0; i < list.length; i++) {
      const code = list[i]
      syncBomBatchProgress.value = { current: i + 1, total: list.length }
      try {
        await executeSyncBomForLine(code, orderId)
        succeeded.push(code)
      } catch (e) {
        const msg = String(e?.response?.data?.msg ?? e?.message ?? '同步失败')
        ElMessage.error(`款【${code}】同步失败：${msg}`)
        if (succeeded.length) {
          ElMessage.warning(`已成功同步 ${succeeded.length} 款，后续已停止。`)
        }
        if (succeeded.length) {
          await refreshOrderAfterSyncBom(orderId, succeeded[succeeded.length - 1])
        }
        return
      }
    }
    ElMessage.success(`批量同步成功，共 ${succeeded.length} 款`)
    clearSyncBomSelected()
    await refreshOrderAfterSyncBom(orderId, succeeded[succeeded.length - 1])
  } finally {
    syncBomBatchLoading.value = false
    syncBomBatchProgress.value = { current: 0, total: 0 }
  }
}

async function batchSyncBomFromEdit() {
  if (!editId.value) return
  await batchSyncBom(editId.value, syncBomSelected.value)
}

async function batchSyncBomFromView() {
  const orderId = Number(viewHeader.value?.id)
  if (!orderId) return
  await batchSyncBom(orderId, syncBomSelected.value)
}

async function confirmRemoveLine(index) {
  try {
    await ElMessageBox.confirm('删行后须点击保存才会写入数据库并同步 PI BOM。', '确认删行', {
      type: 'warning',
    })
    lineRows.value.splice(index, 1)
  } catch {
    // 取消
  }
}

function buildSaveBody() {
  return {
    header: {
      piNo: headerForm.piNo,
      poNo: headerForm.poNo,
      salesDate: headerForm.salesDate,
      deliveryDate: headerForm.deliveryDate || undefined,
      customerCode: headerForm.customerCode,
      currencyCode: headerForm.currencyCode,
      remark: headerForm.remark,
      decimalPlaces: String(headerForm.decimalPlaces ?? 2),
    },
    lines: lineRows.value.map((row) => ({
      kcaa01: row.kcaa01,
      orderQty: row.orderQty,
      unitPrice: row.unitPrice,
    })),
  }
}

async function auditRow(row) {
  if (!row?.id) return
  try {
    await ElMessageBox.confirm(
      `确认要审核【${docLabel(row)}】吗？审核后将锁定主从编辑。`,
      '审核确认',
      { type: 'warning', confirmButtonText: '审核', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  setRowLoading(row, 'audit')
  try {
    await axios.post(`/api/sales-order/${row.id}/approve`)
    forgetDetail(row.id)
    ElMessage.success('已审核')
    if (viewVisible.value && viewHeader.value?.id === row.id) {
      await openView(row)
    }
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function unauditRow(row) {
  if (!row?.id) return
  try {
    await ElMessageBox.confirm(
      `确认要反审【${docLabel(row)}】吗？反审后可再编辑保存。`,
      '反审确认',
      { type: 'warning', confirmButtonText: '反审', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  setRowLoading(row, 'unaudit')
  try {
    await axios.post(`/api/sales-order/${row.id}/unapprove`)
    forgetDetail(row.id)
    ElMessage.success('已反审')
    if (viewVisible.value && viewHeader.value?.id === row.id) {
      await openView(row)
    }
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '操作失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function softDeleteRow(row) {
  if (!row?.id) return
  if (passIsAudited(row)) {
    await ElMessageBox.alert('该数据已审核，需先反审后才能删除。', '提示', { type: 'warning' })
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认要删除【${docLabel(row)}】吗？删除后将移入回收站，可在回收站恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  setRowLoading(row, 'delete')
  try {
    await axios.post(`/api/sales-order/${row.id}/soft-delete`)
    forgetDetail(row.id)
    ElMessage.success('已移入回收站')
    if (viewVisible.value) viewVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function restoreRow(row) {
  if (!row?.id) return
  try {
    await ElMessageBox.confirm(`确认要恢复【${docLabel(row)}】吗？`, '恢复确认', {
      type: 'info',
      confirmButtonText: '恢复',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  setRowLoading(row, 'restore')
  try {
    await axios.post(`/api/sales-order/${row.id}/restore`)
    forgetDetail(row.id)
    ElMessage.success('已恢复')
    if (viewVisible.value) viewVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '恢复失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function hardDeleteRow(row) {
  if (!row?.id) return
  if (passIsAudited(row)) {
    await ElMessageBox.alert('该数据已审核，需先反审后才能彻底删除。', '提示', { type: 'warning' })
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认要彻底删除【${docLabel(row)}】吗？该操作不可恢复，PI 号将可再次使用。`,
      '危险操作',
      {
        type: 'error',
        confirmButtonText: '彻底删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
      },
    )
  } catch {
    return
  }
  setRowLoading(row, 'permanent')
  try {
    await axios.post(`/api/sales-order/${row.id}/hard-delete`)
    forgetDetail(row.id)
    ElMessage.success('已彻底删除')
    if (viewVisible.value) viewVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '删除失败'))
  } finally {
    setRowLoading(row, '')
  }
}

async function onSave() {
  if (editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再保存。')
    return
  }
  saveLoading.value = true
  try {
    if (editMode.value === 'create') {
      const duplicated = await checkPiNoDuplicate()
      if (duplicated) return
    }
    const savedOrderId = editMode.value === 'edit' ? editId.value : null
    const body = buildSaveBody()
    if (editMode.value === 'create') {
      const res = await axios.post('/api/sales-order', body)
      ElMessage.success(res?.data?.msg ?? '保存成功')
    } else {
      const res = await axios.put(`/api/sales-order/${editId.value}`, body)
      forgetDetail(savedOrderId)
      ElMessage.success(res?.data?.msg ?? '保存成功')
    }
    if (isSalesOrderStandaloneWindow.value) {
      notifySalesOrderListRefresh()
      editVisible.value = false
      closeStandaloneBrowserWindow()
      return
    }
    editVisible.value = false
    pageMode.value = 'manage'
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    saveLoading.value = false
  }
}

async function loadData() {
  const requestSeq = ++listRequestSeq
  loading.value = true
  errorMessage.value = ''
  try {
    const params = buildSalesOrderListQueryParams({
      page: page.value,
      pageSize: pageSize.value,
      filters: {
        keyword: filterKeyword.value,
        showRecycle: showRecycle.value,
        showUnAudited: showUnAudited.value,
      },
    })
    const res = await axios.get('/api/sales-order/list', { params })
    if (requestSeq !== listRequestSeq) return
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    tableList.value = Array.isArray(data.list) ? data.list.map((row) => attachCachedDetail(row)) : []
  } catch (err) {
    if (requestSeq !== listRequestSeq) return
    const msg = err?.response?.data?.msg || err?.message || '加载失败'
    errorMessage.value = String(msg)
  } finally {
    if (requestSeq === listRequestSeq) loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  filterKeyword.value = ''
  showRecycle.value = false
  showUnAudited.value = false
  page.value = 1
  loadData()
}

function onRecycleChange() {
  page.value = 1
  if (showRecycle.value) {
    showUnAudited.value = false
  }
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

async function onExpandChange(row, expandedRows) {
  const open = expandedRows.some((r) => r.id === row.id)
  if (!open) return
  if (row.__linesLoaded) return
  row.__linesLoading = true
  try {
    const detail = await fetchOrderDetail(row.id)
    row.__lines = detail.lines
    row.__linesLoaded = true
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载明细失败'))
    row.__lines = []
  } finally {
    row.__linesLoading = false
  }
}

function onExpandedLineViewPlaceholder() {
  ElMessage.info('明细查看功能后续开发')
}

/** @param {Record<string, unknown>} row */
function onMainRowClick(row, column, event) {
  if (!row?.id || !mainTableRef.value) return
  const target = event?.target
  if (target && typeof target.closest === 'function') {
    if (target.closest('.el-button, button, a, input, textarea, select')) return
    if (target.closest('.el-table__expand-icon')) return
  }
  if (column?.type === 'expand') return
  mainTableRef.value.toggleRowExpansion(row)
}

/** @param {Record<string, unknown>} row */
async function openView(row) {
  viewVisible.value = true
  viewLoading.value = true
  viewActiveTab.value = 'header'
  viewHeader.value = null
  viewLines.value = []
  clearSyncBomSelected()
  resetPiBomState()
  try {
    const data = await fetchOrderDetail(row.id)
    viewHeader.value = data.header ?? null
    viewLines.value = data.lines
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    viewVisible.value = false
  } finally {
    viewLoading.value = false
  }
}

async function openSalesOrderStandaloneFromRoute() {
  if (salesOrderWindowMode.value === 'create') {
    await openCreate()
    return
  }
  ElMessage.error('新窗口缺少销售订单打开模式，无法打开')
}

function onSalesOrderListStorageRefresh(ev) {
  if (ev?.key === SALES_ORDER_WINDOW_REFRESH_KEY) loadData()
}

if (isSalesOrderStandaloneWindow.value) {
  void openSalesOrderStandaloneFromRoute()
} else {
  window.addEventListener('storage', onSalesOrderListStorageRefresh)
  loadData()
}

onUnmounted(() => {
  window.removeEventListener('storage', onSalesOrderListStorageRefresh)
})
</script>

<style scoped>
.erp-module-page {
  min-height: 200px;
}
.page-title {
  font-size: var(--so-page-title-size, 18px);
  font-weight: 600;
}
.page-desc {
  margin: 0 0 12px;
  color: var(--el-text-color-secondary);
  font-size: var(--so-page-desc-size, 13px);
}
.page-desc code {
  font-size: 12px;
}
.so-mode-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border-left: 4px solid var(--el-color-primary);
  background: var(--el-fill-color-lighter);
}
.so-toolbar {
  margin-bottom: 12px;
}
.so-toolbar-row,
.so-filter-actions,
.so-command-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.so-toolbar-row {
  justify-content: space-between;
  row-gap: 10px;
}
.so-filter-actions {
  flex: 1 1 auto;
  min-width: 0;
}
.so-command-actions {
  flex: 0 0 auto;
}
.so-keyword-input {
  flex: 0 1 420px;
  width: min(420px, 100%);
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.error-alert,
.audit-alert {
  margin-bottom: 12px;
}
.btn-view .btn-icon {
  margin-right: 4px;
}
.code-bold {
  font-weight: 600;
}
.so-main-table :deep(.el-table__body-wrapper .el-table__body tr) {
  cursor: pointer;
}
.detail-wrap {
  min-height: 200px;
}
.so-view-dialog :deep(.el-dialog__title) {
  font-size: var(--so-dialog-title-size, 18px);
  font-weight: 600;
}
.so-lines-table :deep(.el-table__body-wrapper) {
  padding-bottom: 12px;
}
.action-bar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
}
.so-order-actions {
  flex-wrap: wrap;
  align-content: center;
  column-gap: 8px;
  row-gap: 6px;
  max-width: 100%;
  padding: 2px 0;
}
.action-bar--footer {
  justify-content: flex-end;
}
.so-order-actions :deep(.el-button),
.so-line-actions :deep(.el-button) {
  margin-left: 0;
  margin-right: 0;
}
.so-edit-panel {
  box-sizing: border-box;
  min-height: 360px;
  padding: 14px 16px 12px;
  border: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.so-edit-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.so-edit-panel__title {
  margin: 0;
  font-size: var(--so-dialog-title-size, 18px);
  font-weight: 600;
}
.so-edit-panel__footer {
  position: sticky;
  bottom: 0;
  z-index: 2;
  margin: 12px -16px -12px;
  padding: 10px 16px;
  border-top: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
.so-edit-form {
  max-width: 1180px;
  margin: 0 auto;
  padding-top: 4px;
}
.so-edit-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.so-edit-form :deep(.el-input),
.so-edit-form :deep(.el-select),
.so-edit-form :deep(.el-date-editor),
.so-edit-form :deep(.el-input-number),
.so-edit-form :deep(.el-textarea) {
  width: 100%;
}
.so-lines-hint {
  margin: 0 0 8px;
  font-size: var(--so-lines-hint-size, 13px);
  color: var(--el-text-color-secondary);
}
.lines-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.so-sync-bom-selected-hint {
  font-size: var(--so-lines-hint-size, 13px);
  color: var(--el-text-color-secondary);
}
/** 明细行「同步 BOM」：未选＝主色，已选＝灰 */
.so-sync-bom-mark-btn {
  min-width: 72px;
  background-color: var(--el-color-primary);
  border-color: var(--el-color-primary);
  color: #fff;
}
.so-sync-bom-mark-btn:hover {
  background-color: var(--el-color-primary-light-3);
  border-color: var(--el-color-primary-light-3);
  color: #fff;
}
.so-sync-bom-mark-btn--on {
  background-color: #ccc !important;
  border-color: #ccc !important;
  color: #333 !important;
}
.so-sync-bom-mark-btn--on:hover {
  background-color: #bbb !important;
  border-color: #bbb !important;
  color: #333 !important;
}
/* DIY：PI BOM Tab 工具栏与用量输入 — index.vue .so-pi-bom-toolbar / .so-pi-bom-num */
.so-pi-bom-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.so-pi-bom-label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.so-pi-bom-table-wrap {
  min-height: 120px;
}
.so-pi-bom-num {
  width: 100%;
}
.so-pi-bom-num :deep(.el-input__inner) {
  text-align: right;
}
.erp-action-tooltip-wrap {
  display: inline-block;
}
.so-edit-panel--standalone {
  min-height: 100vh;
  padding: 10px 12px 60px;
  border: 0;
}
.so-edit-panel--standalone .so-edit-panel__header {
  display: none;
}
.so-edit-panel--standalone .so-edit-form {
  max-width: 1180px;
}
.so-edit-panel--standalone .so-edit-panel__footer {
  box-sizing: border-box;
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  height: 48px;
  margin: 0;
  padding: 8px 12px;
  border-top: 1px solid var(--el-border-color-light);
  background: var(--el-bg-color);
}
</style>
