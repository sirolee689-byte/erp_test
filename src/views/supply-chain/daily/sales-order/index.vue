<template>
  <div class="erp-module-page" :class="{ 'so-standalone-window': isSalesOrderStandaloneWindow }">
    <!-- 销售订单 issue 01：列表 + 只读详情（主表 Tab / 明细 Tab） -->
    <div v-if="!isSalesOrderStandaloneWindow" class="so-mode-bar erp-mode-bar">
      <el-button
        class="so-mode-btn erp-mode-btn"
        :type="pageMode === 'manage' ? 'primary' : 'default'"
        plain
        @click="switchToManage"
        @contextmenu.prevent="onErpModeBtnContextMenu('manage', $event)"
      >
        管理销售订单
      </el-button>
      <el-button
        v-permission="'add'"
        class="so-mode-btn erp-mode-btn"
        :type="pageMode === 'create' ? 'primary' : 'default'"
        plain
        @click="switchToCreate"
        @contextmenu.prevent="onErpModeBtnContextMenu('create', $event)"
      >
        销售订单添加
      </el-button>
      <el-button
        class="so-mode-btn erp-mode-btn"
        :type="pageMode === 'material-trace' ? 'primary' : 'default'"
        plain
        @click="switchToMaterialTrace"
        @contextmenu.prevent="onErpModeBtnContextMenu('material-trace', $event)"
      >
        转向物料查询
      </el-button>
    </div>

    <el-card v-show="!isSalesOrderStandaloneWindow && pageMode === 'manage' && !editVisible" shadow="never">
     

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
            <el-button class="so-filter-action-btn erp-filter-action-btn" type="primary" @click="onSearch">查询</el-button>
            <el-button class="so-filter-action-btn erp-filter-action-btn" @click="onReset">重置</el-button>
            <div class="so-filter-divider erp-filter-divider" aria-hidden="true" />
            <div class="audit-switch erp-filter-switch">
              <span class="switch-label">回收站</span>
              <el-switch v-model="showRecycle" @change="onRecycleChange" />
            </div>
            <template v-if="!showRecycle">
              <div class="so-filter-divider erp-filter-divider" aria-hidden="true" />
              <div class="audit-switch erp-filter-switch">
                <span class="switch-label">显示未审核</span>
                <el-switch v-model="showUnAudited" @change="onSearch" />
              </div>
            </template>
          </div>
          <div class="so-command-actions">
            <el-button class="btn-view so-filter-action-btn erp-filter-action-btn" :loading="loading" @click="loadData">
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

      <div class="pagination-row pagination-row--top">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          background
          layout="total, sizes, prev, pager, next, jumper"
          :total="total"
          :page-sizes="ERP_PAGE_SIZE_OPTIONS"
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>

      <el-skeleton :loading="loading" animated :rows="6">
        <template #default>
          <ErpTableViewportHScroll>
          <el-table
            ref="mainTableRef"
            class="erp-list-table so-main-table"
            :data="tableList"
            row-key="id"
            border
            stripe
            style="width: 100%"
            :empty-text="loading ? '加载中…' : '暂无数据'"
            @expand-change="onExpandChange"
            @row-click="onMainRowClick"
           @row-contextmenu="onErpListRowContextMenu">
            <el-table-column
              label="操作"
              :width="salesOrderActionsColWidth"
              fixed="left"
              align="left"
              header-align="center"
              class-name="erp-col-actions"
            >
              <template #default="{ row }">
                <ErpTableActions class="so-order-actions">
                  <template v-if="showRecycle">
                    <el-button
                      v-permission="'edit'"
                      type="primary"
                      plain
                      :loading="row.__opLoading === 'restore'"
                      @click.stop="restoreRow(row)"
                    >
                      恢复
                    </el-button>
                    <el-button
                      v-if="$isErpSuperAdmin()"
                      v-permission="'delete'"
                      type="danger"
                      plain
                      :loading="row.__opLoading === 'permanent'"
                      @click.stop="hardDeleteRow(row)"
                    >
                      彻底删除
                    </el-button>
                  </template>
                  <template v-else>
                    <el-button type="info" plain @click.stop="openView(row)">查看</el-button>
                    <el-button
                      v-if="!row.isPureSpareOrder"
                      v-permission="'edit'"
                      type="primary"
                      plain
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
                          :disabled="!row.canAddSpareUsage"
                          :loading="spareUsageLoading"
                          @click.stop="addSpareUsage(row)"
                        >
                          增加散件单用量
                        </el-button>
                      </span>
                    </el-tooltip>
                    <el-button
                      v-if="showUnAudited && !passIsAudited(row)"
                      v-permission="'edit'"
                      type="primary"
                      plain
                      @click.stop="openEdit(row)"
                    >
                      编辑
                    </el-button>
                    <el-button
                      v-if="showUnAudited && !passIsAudited(row)"
                      v-permission="'audit'"
                      type="success"
                      plain
                      :loading="row.__opLoading === 'audit'"
                      @click.stop="auditRow(row)"
                    >
                      审核
                    </el-button>
                    <el-button
                      v-if="!showUnAudited && passIsAudited(row)"
                      v-permission="'unaudit'"
                      type="warning"
                      plain
                      :loading="row.__opLoading === 'unaudit'"
                      @click.stop="unauditRow(row)"
                    >
                      反审
                    </el-button>
                    <el-button
                      v-if="showUnAudited"
                      v-permission="'delete'"
                      type="danger"
                      plain
                      :disabled="passIsAudited(row)"
                      :loading="row.__opLoading === 'delete'"
                      @click.stop="softDeleteRow(row)"
                    >
                      删除
                    </el-button>
                  </template>
                </ErpTableActions>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="88" align="center" header-align="center">
              <template #default="{ row }">
                <span
                  v-if="passIsAudited(row)"
                  class="so-status-badge so-status-badge--done"
                  role="status"
                >
                  <el-icon class="so-status-badge__icon" aria-hidden="true"><Check /></el-icon>
                  <span>已审</span>
                </span>
                <span v-else class="so-status-badge so-status-badge--pending" role="status">
                  <el-icon class="so-status-badge__icon" aria-hidden="true"><Close /></el-icon>
                  <span>未审</span>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="结案" width="96" align="center" header-align="center">
              <template #default="{ row }">
                <span
                  v-if="isSalesOrderClosed(row)"
                  class="so-status-badge so-status-badge--none"
                  role="status"
                >
                  已结案
                </span>
                <span v-else class="so-status-badge so-status-badge--done" role="status">
                  未结案
                </span>
              </template>
            </el-table-column>
            <el-table-column label="运算状态" width="108" align="center" header-align="center">
              <template #default="{ row }">
                <span
                  v-if="row.calcStatus === '已运算'"
                  class="so-status-badge so-status-badge--done"
                  role="status"
                >
                  <el-icon class="so-status-badge__icon" aria-hidden="true"><Check /></el-icon>
                  <span>已运算</span>
                </span>
                <span v-else class="so-status-badge so-status-badge--pending" role="status">
                  <el-icon class="so-status-badge__icon" aria-hidden="true"><Close /></el-icon>
                  <span>未运算</span>
                </span>
              </template>
            </el-table-column>
            <el-table-column label="销售单号" prop="piNo" min-width="132">
              <template #default="{ row }">
                <span class="code-bold">{{ formatCell(row.piNo) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="销售日期" width="118">
              <template #default="{ row }">{{ formatSalesOrderDate(row.salesDate) }}</template>
            </el-table-column>
            <el-table-column label="交货日期" width="118">
              <template #default="{ row }">{{ formatSalesOrderDate(row.deliveryDate) }}</template>
            </el-table-column>
            <el-table-column label="PO 号" prop="poNo" min-width="132" />
            <el-table-column label="销售数据" min-width="330">
              <template #default="{ row }">
                <div class="so-sales-data">
                  <p>
                    总项数：{{ formatSalesDataCount(row, 'lineCount') }}
                    明细总量：{{ formatSalesDataQty(row, 'lineQtyTotal') }}
                    物品总金额：{{ formatSalesDataMoney(row, 'lineAmountTotal') }} 元
                  </p>
                  <p>总出库数量：{{ formatSalesDataQty(row, 'stockOutQtyTotal') }}</p>
                  <p>关联采购订单：{{ formatSalesDataCount(row, 'buyOrderTotal') }} 张</p>
                  <p>关联外协订单：{{ formatSalesDataCount(row, 'assistOrderTotal') }} 张</p>
                  <p>关联派工单：{{ formatSalesDataCount(row, 'dispatchOrderTotal') }} 张</p>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="币别" prop="currencyName" width="88" />
            <el-table-column label="客户" prop="customerName" min-width="160" />
            <el-table-column label="备注" prop="remark" min-width="180" show-overflow-tooltip />
            <el-table-column type="expand" width="1">
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
                      <template #default="{ row: line }">
                        <ErpTableActions class="so-line-actions">
                          <el-button
                            tag="a"
                            type="info"
                            plain
                            :href="buildExpandedLinePiBomViewHref(row, line)"
                            target="_blank"
                            rel="noopener"
                            @click.stop="guardExpandedLinePiBomView($event, row, line)"
                          >
                            查看
                          </el-button>
                        </ErpTableActions>
                      </template>
                    </el-table-column>
                    <el-table-column label="客款号" prop="customerStyleNo" min-width="150" show-overflow-tooltip />
                    <el-table-column label="编码" prop="kcaa01" min-width="220" show-overflow-tooltip />
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
                      <template #default="{ row: line }">{{ formatPrice(line.unitPrice) }}</template>
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
          </el-table>
          </ErpTableViewportHScroll>

          <div class="pagination-row pagination-row--bottom">
            <el-pagination
              v-model:current-page="page"
              v-model:page-size="pageSize"
              background
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :page-sizes="ERP_PAGE_SIZE_OPTIONS"
              @size-change="onPageSizeChange"
              @current-change="onPageChange"
            />
          </div>
        </template>
      </el-skeleton>
    </el-card>

    <section v-if="!isSalesOrderStandaloneWindow && pageMode === 'material-trace'" class="so-material-trace-panel">
      <SalesOrderMaterialTracePanel />
    </section>

    <section
      v-show="editVisible"
      :class="[
        'so-edit-panel',
        { 'so-edit-panel--standalone': isSalesOrderStandaloneWindow, 'so-edit-panel--readonly': isReadonlyForm },
      ]"
    >
      <div class="so-edit-panel__header so-unified-btn-font">
        <h2 class="so-edit-panel__title">
          {{
            editMode === 'view'
              ? '查看销售订单'
              : editMode === 'create'
                ? '新增销售订单'
                : '编辑销售订单'
          }}
        </h2>
        <!-- 操作钮对齐采购订单：放在标题行右侧，不再用底栏 -->
        <div class="so-edit-panel__actions">
          <template v-if="isReadonlyForm">
            <el-button @click="switchToManage">返回列表</el-button>
          </template>
          <template v-else>
            <el-button @click="closeEditWindowOrDialog">取消</el-button>
            <el-button
              v-if="editMode === 'create'"
              v-permission="'add'"
              type="primary"
              :loading="saveLoading"
              @click="onSave"
            >
              保存
            </el-button>
            <el-button
              v-else
              v-permission="'edit'"
              type="primary"
              :loading="saveLoading"
              :disabled="editDetailLocked"
              @click="onSave"
            >
              保存
            </el-button>
          </template>
        </div>
      </div>
      <div v-loading="editLoading" class="detail-wrap">
        <el-tabs v-model="editActiveTab" @tab-change="onEditTabChange">
          <el-tab-pane label="主表" name="header">
            <el-form
              label-width="108px"
              class="so-edit-form"
              :disabled="editDetailLocked || isReadonlyForm"
              @submit.prevent
            >
              <!-- 主表布局对齐派工单：左对齐分行 + 三档固定宽度 -->
              <div class="so-header-rows">
                <div class="so-form-row so-form-row--1">
                  <el-form-item label="PI 号" required>
                    <el-input
                      v-model="headerForm.piNo"
                      :disabled="editMode !== 'create'"
                      :clearable="editMode === 'create'"
                      :placeholder="editMode === 'create' ? '如 PI-0001' : ''"
                      @blur="onPiNoBlur"
                    />
                  </el-form-item>
                </div>
                <div class="so-form-row so-form-row--2">
                  <el-form-item label="销售日期" required>
                    <el-date-picker
                      v-model="headerForm.salesDate"
                      type="date"
                      value-format="YYYY-MM-DD"
                    />
                  </el-form-item>
                  <el-form-item label="交货日期">
                    <el-date-picker
                      v-model="headerForm.deliveryDate"
                      type="date"
                      value-format="YYYY-MM-DD"
                      clearable
                    />
                  </el-form-item>
                </div>
                <div class="so-form-row so-form-row--1 so-form-row--wide">
                  <el-form-item label="销售客户" required>
                    <el-select
                      v-model="headerForm.customerCode"
                      filterable
                      remote
                      reserve-keyword
                      placeholder="搜索已审客户"
                      :remote-method="searchCustomers"
                      :loading="customerLoading"
                      clearable
                    >
                      <el-option
                        v-for="c in customerOptions"
                        :key="c.s_code"
                        :label="`${c.s_code} ${c.s_name}`"
                        :value="String(c.s_code)"
                      />
                    </el-select>
                  </el-form-item>
                </div>
                <div class="so-form-row so-form-row--3">
                  <el-form-item label="PO 号">
                    <el-input
                      v-model="headerForm.poNo"
                      clearable
                      placeholder="请输入 PO 号"
                    />
                  </el-form-item>
                  <el-form-item label="币别" required>
                    <el-select v-model="headerForm.currencyCode" placeholder="选择币别">
                      <el-option
                        v-for="c in currencyOptions"
                        :key="c.id"
                        :label="formatCurrencyOption(c)"
                        :value="String(c.id)"
                      />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="小数点配置" class="so-form-item--narrow">
                    <el-input-number
                      v-model="headerForm.decimalPlaces"
                      :min="0"
                      :max="8"
                      controls-position="right"
                    />
                  </el-form-item>
                </div>
                <div class="so-form-row so-form-row--1 so-form-row--wide">
                  <el-form-item label="备注">
                    <el-input v-model="headerForm.remark" type="textarea" :rows="2" />
                  </el-form-item>
                </div>
              </div>
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
            <p v-if="!isReadonlyForm" class="so-lines-hint">
              选材后填写订货数量；删除明细仅影响界面，点击保存后才会落库并同步 PI BOM 对齐。
            </p>
            <div v-if="!isReadonlyForm" class="lines-toolbar so-unified-btn-font">
              <el-button type="danger" plain :disabled="editDetailLocked" @click="deleteSelectedLines">
                删除选定明细
              </el-button>
              <el-button type="danger" plain :disabled="editDetailLocked" @click="deleteAllLines">
                删除全部明细
              </el-button>
              <el-button type="primary" :disabled="editDetailLocked" @click="openMaterialPicker">
                批量添加
              </el-button>
              <el-button
                v-if="editMode === 'edit' && editId"
                v-permission="'edit'"
                type="primary"
                plain
                :disabled="editDetailLocked || !syncBomSelectedCount || syncBomBatchLoading"
                :loading="syncBomBatchLoading"
                @click="batchSyncBomFromEdit"
              >
                {{
                  syncBomBatchLoading && syncBomBatchProgress.total
                    ? `同步中 (已选 ${syncBomBatchProgress.total} 款)`
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
              class="so-lines-table erp-list-table"
              :row-class-name="soLineRowClassName"
              scrollbar-always-on
              max-height="calc(80vh - 280px)"
            >
              <el-table-column
                v-if="!isReadonlyForm"
                label="选择"
                width="88"
                align="center"
                fixed="left"
              >
                <template #default="{ row }">
                  <el-button
                    size="small"
                    class="so-line-mark-btn"
                    :class="{ 'so-line-mark-btn--on': row._lineMarked }"
                    :disabled="editDetailLocked"
                    @click="toggleLineMark(row)"
                  >
                    {{ row._lineMarked ? '已选择' : '删除' }}
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column type="index" label="序号" width="58" />
              <el-table-column
                v-if="showEditLineActionsCol"
                label="操作"
                :width="editLineActionsColWidth"
                fixed="left"
                align="left"
                header-align="center"
                class-name="erp-col-actions"
              >
                <template #default="{ row }">
                  <div class="action-bar so-line-actions so-unified-btn-font">
                    <el-button
                      v-permission="'edit'"
                      class="so-sync-bom-mark-btn"
                      :class="{ 'so-sync-bom-mark-btn--on': isSyncBomSelected(row.kcaa01) }"
                      :disabled="editDetailLocked || syncBomBatchLoading"
                      @click="toggleSyncBomSelection(row)"
                    >
                      {{ isSyncBomSelected(row.kcaa01) ? '已选择' : '同步 BOM' }}
                    </el-button>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="编码" prop="kcaa01" min-width="128" show-overflow-tooltip />
              <el-table-column label="数量" width="120">
                <template #default="{ row }">
                  <template v-if="isReadonlyForm">{{ formatOrderQty(row.orderQty) }}</template>
                  <el-input-number
                    v-else
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
                  <template v-if="isReadonlyForm">{{ formatPrice(row.unitPrice) }}</template>
                  <el-input-number
                    v-else
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
            <p v-else-if="!isReadonlyForm" class="so-lines-hint">
              修改 PI 内子件用量后请点击「保存 PI BOM」；订单将标为未运算。同步主 BOM 请回明细 Tab。
            </p>
            <p v-else class="so-lines-hint">
              仅维护 PI 销售 BOM 用量，不从主 BOM 拉取（拉取请用明细「同步 BOM」）。改用量后须重新一键运算。
            </p>
            <div v-if="!(editMode === 'view' && viewId) && !editId" class="so-pi-bom-empty">
              <el-empty description="请先保存订单后再维护 PI BOM" />
            </div>
            <template v-else>
              <div class="so-pi-bom-toolbar so-unified-btn-font">
                <span class="so-pi-bom-label">成品款</span>
                <el-select
                  v-model="piBomProduct"
                  filterable
                  placeholder="选择明细款号"
                  style="min-width: 280px"
                  :loading="piBomLoading"
                  @change="onPiBomProductChange(isReadonlyForm ? 'view' : 'edit')"
                >
                  <el-option
                    v-for="p in piBomProducts"
                    :key="p.kcaa01"
                    :label="`${p.kcaa01}${p.hasBom ? '' : '（未建 BOM）'}`"
                    :value="p.kcaa01"
                  />
                </el-select>
                <el-button
                  v-if="!isReadonlyForm"
                  v-permission="'edit'"
                  type="primary"
                  plain
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
                      <template v-if="isReadonlyForm">{{ formatPiBomQty(row.kcac04) }}</template>
                      <el-input-number
                        v-else
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
                      <template v-if="isReadonlyForm">{{ formatPiBomQty(row.kcac05) }}</template>
                      <el-input-number
                        v-else
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
                      <template v-if="isReadonlyForm">{{ formatCell(row.Describe) }}</template>
                      <el-input
                        v-else
                        v-model="row.Describe"
                        :disabled="editDetailLocked"
                        clearable
                        size="small"
                      />
                    </template>
                  </el-table-column>
                </el-table>
                <el-empty v-else-if="piBomProduct" :description="isReadonlyForm ? '该款暂无 PI BOM 子件' : '该款暂无 PI BOM 子件，请先保存订单建立 BOM'" />
                <el-empty v-else description="请选择成品款" />
              </div>
            </template>
          </el-tab-pane>
        </el-tabs>
      </div>
    </section>

    <MaterialSelector v-model="materialVisible" multiple @batch-confirm="onMaterialsPicked" />
  </div>
</template>

<script setup>
import { useErpListRowContextMenu, useErpModeBtnContextMenu } from '@/composables/useErpListRowContextMenu'
import { useErpDeepLinkOpen } from '@/composables/useErpDeepLinkOpen'
import { ERP_PAGE_SIZE_OPTIONS } from '@/utils/erpPagination'
import {
  formatErpMoneyDisplay,
  formatErpPriceDisplay,
  formatErpQtyDisplay,
} from '@/utils/erpNumberDisplay'
import { refreshErpTableViewportHScroll } from '@/utils/erpTableViewportHScroll'
import ErpTableViewportHScroll from '@/components/erp/ErpTableViewportHScroll.vue'
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Close, Refresh } from '@element-plus/icons-vue'
import axios from 'axios'
import { createExpandPrefetch } from '@/utils/erpExpandPrefetch.js'
import MaterialSelector from '../purchase-quote/MaterialSelector.vue'
import SalesOrderMaterialTracePanel from './material-trace-panel.vue'
import {
  buildSalesOrderListQueryParams,
  formatCell,
  formatOrderQty,
  formatSalesOrderDate,
  passIsAudited,
} from '@/utils/salesOrderDisplay.js'

defineOptions({ name: 'supply-chain-daily-sales-order' })

const { onErpListRowContextMenu } = useErpListRowContextMenu()
const { onErpModeBtnContextMenu } = useErpModeBtnContextMenu()
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

/** 主列表加载后重算列宽并刷新视口底横滚（与 BOM 资料一致） */
watch([tableList, loading], async () => {
  if (loading.value) return
  await nextTick()
  mainTableRef.value?.doLayout?.()
  const el = mainTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
})

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
/** 主列表操作列：对齐 BOM 4 列紧凑钮，按视图估宽（含「增加散件单用量」等长文案） */
const SO_LIST_ACTIONS_COL_WIDTH_RECYCLE = 236
const SO_LIST_ACTIONS_COL_WIDTH_NORMAL = 280
const SO_LIST_ACTIONS_COL_WIDTH_UNAUDITED = 300
const salesOrderActionsColWidth = computed(() => {
  if (showRecycle.value) return SO_LIST_ACTIONS_COL_WIDTH_RECYCLE
  if (showUnAudited.value) return SO_LIST_ACTIONS_COL_WIDTH_UNAUDITED
  return SO_LIST_ACTIONS_COL_WIDTH_NORMAL
})
watch(salesOrderActionsColWidth, async () => {
  await nextTick()
  mainTableRef.value?.doLayout?.()
})
const expandedLineActionsColWidth = computed(() => getActionBarColWidth(1, { buttonWidth: 64 }))
/** 仅编辑已保存单据时显示「同步 BOM」；查看/新增无行内操作列 */
const showEditLineActionsCol = computed(() => editMode.value === 'edit' && !!editId.value)
const editLineActionsColWidth = computed(() => getActionBarColWidth(1, { buttonWidth: 84 }))

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

const expandPrefetch = createExpandPrefetch({
  fetchBatch: async (ids) => {
    const { data } = await axios.get('/api/sales-order/expand-lines/batch', { params: { ids: ids.join(',') } })
    if (data.code !== 200) throw new Error(data.msg)
    return data.data || {}
  },
  fetchSingle: async (id) => {
    const detail = await fetchOrderDetail(id)
    return { lines: detail.lines }
  },
  getRowId: (row) => Number(row?.id),
  applyToRow: (row, payload) => {
    const lines = Array.isArray(payload?.lines) ? payload.lines : []
    // 展开行只预取明细；禁止把 header:null 写入详情缓存，否则点「编辑」会读到空主表（PI 只剩占位符）
    const cacheKey = getOrderCacheKey(row)
    const existing = cacheKey ? detailCache.get(cacheKey) : null
    if (existing?.header) {
      rememberDetail(row?.id ?? cacheKey, { header: existing.header, lines })
    }
    row.__lines = lines
    row.__linesLoaded = true
    row.__linesLoading = false
  },
  resetRow: (row) => {
    row.__lines = []
    row.__linesLoaded = false
    row.__linesLoading = false
  },
  onError: (msg) => ElMessage.error(msg),
})

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

const editVisible = ref(false)
const editLoading = ref(false)
const saveLoading = ref(false)
/** @type {import('vue').Ref<'create' | 'edit' | 'view'>} */
const editMode = ref('create')
const editId = ref(null)
const viewId = ref(null)
const editActiveTab = ref('header')
const isReadonlyForm = computed(() => editMode.value === 'view')
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

/** 单价展示：最多 4 位，去尾 0 */
function formatPrice(value) {
  return formatErpPriceDisplay(value, '0')
}

/** 金额展示：最多 2 位，去尾 0 */
function formatMoney(value) {
  return formatErpMoneyDisplay(value, '0')
}

function isSalesOrderClosed(row) {
  return String(row?.closed ?? '0').trim() === '1'
}

function getSalesDataValue(row, key) {
  const data = row?.salesData
  if (!data || typeof data !== 'object') return 0
  return data[key]
}

function formatSalesDataCount(row, key) {
  const n = Number(getSalesDataValue(row, key))
  if (!Number.isFinite(n)) return '0'
  return String(Math.max(0, Math.trunc(n)))
}

function formatSalesDataQty(row, key) {
  return formatErpQtyDisplay(getSalesDataValue(row, key), '0')
}

function formatSalesDataMoney(row, key) {
  return formatErpMoneyDisplay(getSalesDataValue(row, key), '0')
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === orderId) {
      await loadOrderIntoPanel(orderId, { captureSnapshot: false })
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === orderId) {
      await loadOrderIntoPanel(orderId, { captureSnapshot: false })
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
  const orderId = mode === 'view' ? Number(viewId.value) : Number(editId.value)
  if (!orderId || !piBomProduct.value) {
    piBomTree.value = []
    return
  }
  await loadPiBomTree(orderId, piBomProduct.value)
}

/**
 * @param {'view' | 'edit'} mode
 */
async function savePiBom(mode) {
  const orderId = Number(editId.value)
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
    editHeaderCalcStatus.value = '未运算'
    await loadPiBomTree(orderId, code)
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存 PI BOM 失败'))
  } finally {
    piBomSaveLoading.value = false
  }
}

function onEditTabChange(name) {
  const orderId = editId.value || viewId.value
  if (name === 'piBom' && orderId) {
    loadPiBomProductList(Number(orderId)).then(() => {
      if (piBomProduct.value) loadPiBomTree(Number(orderId), piBomProduct.value)
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
  viewId.value = null
  pageMode.value = 'manage'
}

function switchToManage() {
  editVisible.value = false
  viewId.value = null
  pageMode.value = 'manage'
}

function switchToMaterialTrace() {
  editVisible.value = false
  viewId.value = null
  pageMode.value = 'material-trace'
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
  viewId.value = null
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

/** @param {Record<string, unknown> | null | undefined} header */
function fillHeaderFromDetail(header) {
  if (!header) return
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

/**
 * @param {number} orderId
 * @param {{ captureSnapshot?: boolean }} [options]
 */
async function loadOrderIntoPanel(orderId, options = {}) {
  // 编辑/查看必须强制拉完整详情，避免命中「仅展开明细」的残缺缓存
  const data = await fetchOrderDetail(orderId, { force: true })
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
    _lineMarked: false,
  }))
  if (headerForm.customerCode) {
    customerOptions.value = [
      {
        s_code: headerForm.customerCode,
        s_name: String(data.header?.customerName ?? ''),
      },
    ]
  }
  if (options.captureSnapshot !== false && editMode.value === 'edit') {
    captureEditSnapshot()
  }
  return data
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
  viewId.value = null
  pageMode.value = 'edit'
  editHeaderPass.value = String(row.pass ?? '0')
  clearSyncBomSelected()
  resetPiBomState()
  editActiveTab.value = 'header'
  editLoading.value = true
  editVisible.value = true
  await loadCurrencyOptions()
  try {
    await loadOrderIntoPanel(row.id)
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    editVisible.value = false
    pageMode.value = 'manage'
  } finally {
    editLoading.value = false
  }
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
      _lineMarked: false,
    })
  }
}

/**
 * @param {number} orderId
 * @param {string} lastSyncedCode
 */
async function refreshOrderAfterSyncBom(orderId, lastSyncedCode) {
  if (editVisible.value && editMode.value === 'view' && viewId.value === orderId) {
    await loadOrderIntoPanel(orderId, { captureSnapshot: false })
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
 * 批量同步 BOM：一次调服务端有限并发接口（遇错停后续）
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
  // 服务端有限并发，前端只展示「已选 N 款」等待，不做逐款假进度
  syncBomBatchProgress.value = { current: 0, total: list.length }
  try {
    const res = await axios.post(`/api/sales-order/${orderId}/sync-bom-batch`, { kcaa01: list })
    const body = res?.data
    if (body?.code !== 200) {
      throw new Error(body?.msg || '批量同步失败')
    }
    const data = body?.data ?? {}
    const succeeded = Array.isArray(data.succeeded)
      ? data.succeeded.map((c) => String(c ?? '').trim()).filter(Boolean)
      : []
    for (const code of succeeded) {
      if (!syncedSinceCalc.value.includes(code)) syncedSinceCalc.value.push(code)
    }
    forgetDetail(orderId)
    const failed = data.failed
    if (failed && String(failed.kcaa01 ?? '').trim()) {
      const failCode = String(failed.kcaa01).trim()
      const failMsg = String(failed.msg ?? body?.msg ?? '同步失败')
      ElMessage.error(`款【${failCode}】同步失败：${failMsg}`)
      if (succeeded.length) {
        ElMessage.warning(`已成功同步 ${succeeded.length} 款，后续已停止。`)
        await refreshOrderAfterSyncBom(orderId, succeeded[succeeded.length - 1])
      }
      return
    }
    ElMessage.success(String(body?.msg ?? `批量同步成功，共 ${succeeded.length} 款`))
    clearSyncBomSelected()
    if (succeeded.length) {
      await refreshOrderAfterSyncBom(orderId, succeeded[succeeded.length - 1])
    }
  } catch (e) {
    const msg = String(e?.response?.data?.msg ?? e?.message ?? '批量同步失败')
    ElMessage.error(msg)
  } finally {
    syncBomBatchLoading.value = false
    syncBomBatchProgress.value = { current: 0, total: 0 }
  }
}

async function batchSyncBomFromEdit() {
  if (!editId.value) return
  await batchSyncBom(editId.value, syncBomSelected.value)
}

/** 明细「选择」列：标记待删行（不入库） */
function toggleLineMark(row) {
  if (!row || editDetailLocked.value) return
  row._lineMarked = !row._lineMarked
}

function soLineRowClassName({ row }) {
  return row?._lineMarked ? 'so-line-row--marked' : ''
}

async function deleteSelectedLines() {
  if (editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再修改明细。')
    return
  }
  const marked = lineRows.value.filter((line) => line._lineMarked)
  if (!marked.length) {
    ElMessage.warning('请先在「选择」列点击删除标记要移除的行')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认删除已标记的 ${marked.length} 条明细吗？此操作只影响当前页面，点击保存后才会落库。`,
      '删除选定明细',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const removeSet = new Set(marked)
  const removedCodes = new Set(marked.map((line) => String(line.kcaa01 ?? '').trim()).filter(Boolean))
  lineRows.value = lineRows.value.filter((line) => !removeSet.has(line))
  if (removedCodes.size) {
    syncBomSelected.value = syncBomSelected.value.filter((c) => !removedCodes.has(c))
  }
  ElMessage.success('已删除选定明细')
}

async function deleteAllLines() {
  if (editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再修改明细。')
    return
  }
  if (!lineRows.value.length) {
    ElMessage.warning('当前没有销售明细')
    return
  }
  try {
    await ElMessageBox.confirm(
      '确认删除全部销售明细吗？此操作只影响当前页面，点击保存后才会落库。',
      '删除全部明细',
      { type: 'warning', confirmButtonText: '删除全部', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  lineRows.value = []
  clearSyncBomSelected()
  ElMessage.success('已清空全部明细')
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
    // 本会话同步过 BOM 的款；保存时后端据此整单清空 pi_cost（同步当下不删）
    syncedKcaa01: [...syncedSinceCalc.value],
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === row.id) {
      await openView({ id: row.id })
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === row.id) {
      await openView({ id: row.id })
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === row.id) {
      editVisible.value = false
      viewId.value = null
    }
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === row.id) {
      editVisible.value = false
      viewId.value = null
    }
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
    if (editVisible.value && editMode.value === 'view' && viewId.value === row.id) {
      editVisible.value = false
      viewId.value = null
    }
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
      syncedSinceCalc.value = []
      ElMessage.success(res?.data?.msg ?? '保存成功')
    } else {
      const res = await axios.put(`/api/sales-order/${editId.value}`, body)
      syncedSinceCalc.value = []
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
    expandPrefetch.prefetch(tableList.value)
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
  if (!open) {
    await nextTick()
    mainTableRef.value?.doLayout?.()
    const el = mainTableRef.value?.$el
    if (el) refreshErpTableViewportHScroll(el)
    return
  }
  if (row.__linesLoaded) {
    await nextTick()
    mainTableRef.value?.doLayout?.()
    const el = mainTableRef.value?.$el
    if (el) refreshErpTableViewportHScroll(el)
    return
  }
  await expandPrefetch.ensureLoaded(row)
  await nextTick()
  mainTableRef.value?.doLayout?.()
  const el = mainTableRef.value?.$el
  if (el) refreshErpTableViewportHScroll(el)
}

/** 展开明细「查看」：全屏新标签打开该行 PI-BOM 只读（权限挂销售订单） */
function buildExpandedLinePiBomViewHref(orderRow, line) {
  const orderId = Number(orderRow?.id)
  const code = String(line?.kcaa01 ?? '').trim()
  if (!Number.isFinite(orderId) || orderId <= 0 || !code) return ''
  const url = new URL('/supply-chain/daily/sales-order-pi-bom-window', window.location.origin)
  url.searchParams.set('mode', 'view')
  url.searchParams.set('orderId', String(orderId))
  url.searchParams.set('kcaa01', code)
  const piNo = String(orderRow?.piNo ?? '').trim()
  if (piNo) url.searchParams.set('piNo', piNo)
  return `${url.pathname}${url.search}`
}

function guardExpandedLinePiBomView(ev, orderRow, line) {
  const href = buildExpandedLinePiBomViewHref(orderRow, line)
  if (href) return
  ev?.preventDefault?.()
  ElMessage.warning('缺少订单或编码，无法查看')
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
  if (!row?.id) return
  editMode.value = 'view'
  viewId.value = Number(row.id)
  editId.value = null
  pageMode.value = 'manage'
  editActiveTab.value = 'header'
  clearSyncBomSelected()
  resetPiBomState()
  editVisible.value = true
  editLoading.value = true
  await loadCurrencyOptions()
  try {
    await loadOrderIntoPanel(row.id, { captureSnapshot: false })
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '加载失败'))
    editVisible.value = false
    viewId.value = null
  } finally {
    editLoading.value = false
  }
}

useErpDeepLinkOpen({
  handlers: {
    view: async (recordId) => {
      const id = Number(recordId)
      if (!Number.isFinite(id) || id <= 0) return
      await openView({ id })
    },
    manage: async () => switchToManage(),
    create: async () => {
      await switchToCreate()
    },
  },
})

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
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--erp-surface, #fff);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
}
/* 模式行字体：与主列表数据列统一（常规字号、非粗体） */
.so-mode-btn {
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
}
/* 查询/重置/刷新按钮字体：与列数据统一；覆盖 size=small 的默认小字号 */
.so-filter-action-btn {
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
}
/* 新增/编辑面板操作钮字号：与模式行「管理销售订单」一致 */
.so-unified-btn-font :deep(.el-button) {
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
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
/* DIY：筛选区竖线分隔（对齐 BOM bom-filter-divider）— 改间距搜 so-filter-divider */
.so-filter-divider {
  width: 1px;
  height: 22px;
  margin: 0 18px;
  background: var(--el-border-color);
  flex-shrink: 0;
}
.audit-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.switch-label {
  font-size: var(--erp-table-data-size);
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
.so-sales-data {
  line-height: 1.6;
}
.so-sales-data p {
  margin: 0;
  white-space: nowrap;
}
.so-main-table :deep(.el-table__body-wrapper .el-table__body tr) {
  cursor: pointer;
}
.detail-wrap {
  min-height: 200px;
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
  max-width: 100%;
  padding: 2px 0;
}
.so-order-actions :deep(.el-button),
.so-line-actions :deep(.el-button) {
  margin-left: 0;
  margin-right: 0;
}
/* DIY：状态/结案/运算方框徽章（对齐 BOM bom-usage-calc-badge）— 改色搜 so-status-badge-- */
.so-status-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: var(--el-border-radius-base);
  font-size: var(--erp-table-meta-size, 12px);
  font-weight: var(--erp-font-weight-body, 500);
  line-height: 1.4;
  white-space: nowrap;
}
.so-status-badge__icon {
  font-size: 14px;
  flex-shrink: 0;
}
.so-status-badge--pending {
  color: #b91c1c;
  border-color: #b91c1c;
  background: #fef2f2;
}
.so-status-badge--done {
  color: #15803d;
  border-color: #15803d;
  background: #f0fdf4;
}
.so-status-badge--none {
  color: #2563eb;
  border-color: #2563eb;
  background: #eff6ff;
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
  flex-shrink: 0;
  min-height: 42px;
  margin-bottom: 12px;
  padding: 0 2px;
  gap: 12px;
}
.so-edit-panel__title {
  margin: 0;
  font-size: var(--so-dialog-title-size, 18px);
  font-weight: 600;
}
/* DIY：标题行右侧「取消 / 保存 / 返回列表」间距，对齐采购订单 buy-form-head__actions */
.so-edit-panel__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.so-edit-form {
  max-width: 1280px;
  padding-top: 4px;
}
/* DIY：主表输入框三档宽度（对齐派工单左对齐分行）
 * --so-field-width：PI/日期/PO/币别，建议 220～280
 * --so-field-width-wide：销售客户/备注，约 2× 基准
 * --so-field-width-narrow：小数点配置，约 1/3 基准
 * --so-row-gap：同行字段间距 */
.so-header-rows {
  display: flex;
  flex-direction: column;
  --so-field-width: 250px;
  --so-field-width-wide: 500px;
  --so-field-width-narrow: 83px;
  --so-row-gap: 14px;
}
.so-form-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  column-gap: var(--so-row-gap);
  row-gap: 8px;
}
.so-form-row--1 {
  flex-direction: column;
}
.so-edit-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.so-form-row :deep(.el-form-item__content) {
  justify-content: flex-start;
}
/* DIY：主表表单字段字号与主列表列数据一致 */
.so-edit-form :deep(.el-form-item__label) {
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
}
.so-edit-form :deep(.el-input__inner),
.so-edit-form :deep(.el-select__selected-item),
.so-edit-form :deep(.el-select__placeholder),
.so-edit-form :deep(.el-textarea__inner) {
  font-size: var(--erp-table-data-size) !important;
  font-weight: var(--erp-font-weight-body) !important;
}
.so-form-row :deep(.el-input),
.so-form-row :deep(.el-select),
.so-form-row :deep(.el-date-editor) {
  width: var(--so-field-width);
  max-width: 100%;
}
.so-form-row--wide :deep(.el-input),
.so-form-row--wide :deep(.el-select),
.so-form-row--wide :deep(.el-textarea) {
  width: var(--so-field-width-wide);
  max-width: 100%;
}
.so-form-item--narrow :deep(.el-input-number) {
  width: var(--so-field-width-narrow);
  max-width: 100%;
}
.so-lines-hint {
  margin: 0 0 8px;
  font-size: var(--erp-table-data-size);
  color: var(--el-text-color-secondary);
}
.lines-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
/* DIY：明细选择列橙/灰钮 — 对齐采购 buy-line-mark-btn */
.so-line-mark-btn {
  background-color: #ff7800;
  border-color: #ff7800;
  color: #fff;
}
.so-line-mark-btn:hover {
  background-color: #e56e00;
  border-color: #e56e00;
  color: #fff;
}
.so-line-mark-btn--on {
  background-color: #ccc !important;
  border-color: #ccc !important;
  color: #333 !important;
}
.so-line-mark-btn--on:hover {
  background-color: #bbb !important;
  border-color: #bbb !important;
  color: #333 !important;
}
:deep(.so-line-row--marked) {
  --el-table-tr-bg-color: #f5f5f5;
}
.so-sync-bom-selected-hint {
  font-size: var(--erp-table-data-size);
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
  font-size: var(--erp-table-data-size);
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
  padding: 10px 12px 12px;
  border: 0;
}
.so-edit-panel--standalone .so-edit-form {
  max-width: 1180px;
}
</style>
