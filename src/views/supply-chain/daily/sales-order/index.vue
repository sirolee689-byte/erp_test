<template>
  <div class="erp-module-page" :class="{ 'so-standalone-window': isSalesOrderStandaloneWindow }">
    <!-- 销售订单 issue 01：列表 + 只读详情（主表 Tab / 明细 Tab） -->
    <el-card v-if="!isSalesOrderStandaloneWindow" shadow="never">
      <template #header>
        <span class="page-title">{{ pageTitle }}</span>
      </template>
      <p class="page-desc">
        主表 <code>UB_ERP_Sales_order</code>（PI 号 <code>xsaj01</code>、PO 号 <code>xsaj06</code>）与明细
        <code>UB_ERP_Sales_order_list</code>（<code>xsak01</code> 关联 PI）。
      </p>

      <div class="so-toolbar">
        <div class="search-row erp-action-row">
          <el-input
            v-model="filterKeyword"
            placeholder="输入 PI 号 / 系统单号 / 客户名称"
            clearable
            class="so-keyword-input"
            @keyup.enter="onSearch"
          />
          <el-button type="primary" @click="onSearch">查询</el-button>
          <el-date-picker
            v-model="filterDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="销售日期起"
            end-placeholder="销售日期止"
            value-format="YYYY-MM-DD"
            class="so-date-range"
          />
        </div>
        <div class="search-row erp-action-row">
          <div class="audit-switch">
            <span class="switch-label">回收站</span>
            <el-switch v-model="showRecycle" @change="onRecycleChange" />
          </div>
          <div v-if="!showRecycle" class="audit-switch">
            <span class="switch-label">显示未审核</span>
            <el-switch v-model="showUnAudited" @change="onSearch" />
          </div>
          <el-button @click="onReset">重置</el-button>
          <el-button
            v-if="!showRecycle"
            v-permission="'add'"
            type="success"
            plain
            @click="openCreate"
          >
            新增销售订单
          </el-button>
          <el-button class="btn-view" :loading="loading" @click="loadData">
            <el-icon class="btn-icon"><Refresh /></el-icon>
            刷新
          </el-button>
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
          :page-sizes="[10, 20, 50, 100]"
          @size-change="onPageSizeChange"
          @current-change="onPageChange"
        />
      </div>

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
                <ErpTableActions>
                  <el-button type="info" plain @click.stop="openView(row)">查看</el-button>
                  <template v-if="!showRecycle">
                    <el-button
                      v-permission="'edit'"
                      type="warning"
                      plain
                      :loading="calculateLoading"
                      @click.stop="calculateOrder(row, false)"
                    >
                      一键运算
                    </el-button>
                    <el-button
                      v-if="!passIsAudited(row)"
                      v-permission="'edit'"
                      type="primary"
                      plain
                      @click.stop="openEdit(row)"
                    >
                      编辑
                    </el-button>
                    <el-button
                      v-if="!passIsAudited(row)"
                      v-permission="'audit'"
                      type="success"
                      plain
                      :loading="row.__opLoading === 'audit'"
                      @click.stop="auditRow(row)"
                    >
                      审核
                    </el-button>
                    <el-button
                      v-if="passIsAudited(row)"
                      v-permission="'audit'"
                      type="warning"
                      plain
                      :loading="row.__opLoading === 'unaudit'"
                      @click.stop="unauditRow(row)"
                    >
                      反审
                    </el-button>
                    <el-button
                      v-permission="'delete'"
                      type="danger"
                      plain
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
                      :loading="row.__opLoading === 'restore'"
                      @click.stop="restoreRow(row)"
                    >
                      恢复
                    </el-button>
                    <el-button
                      v-permission="'delete'"
                      type="danger"
                      plain
                      :loading="row.__opLoading === 'permanent'"
                      @click.stop="hardDeleteRow(row)"
                    >
                      彻底删除
                    </el-button>
                  </template>
                </ErpTableActions>
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
            <el-table-column label="销售日期" width="118">
              <template #default="{ row }">{{ formatSalesOrderDate(row.salesDate) }}</template>
            </el-table-column>
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
              layout="total, sizes, prev, pager, next, jumper"
              :total="total"
              :page-sizes="[10, 20, 50, 100]"
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
              <el-descriptions-item label="销售日期">{{
                formatSalesOrderDate(viewHeader.salesDate)
              }}</el-descriptions-item>
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
                width="168"
                fixed="left"
              >
                <template #default="{ row }">
                  <el-button type="primary" link size="small" @click="openPiBomTab(row, 'view')">
                    PI BOM
                  </el-button>
                  <el-button
                    v-if="!passIsAudited(viewHeader)"
                    v-permission="'edit'"
                    type="primary"
                    link
                    size="small"
                    :loading="syncBomLoading === row.kcaa01"
                    @click="syncBomLine(row, Number(viewHeader.id))"
                  >
                    同步 BOM
                  </el-button>
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
                  row-key="systemcode"
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
        <el-button @click="viewVisible = false">关闭</el-button>
        <template v-if="viewHeader">
          <template v-if="!showRecycle">
            <el-button
              v-if="!passIsAudited(viewHeader)"
              v-permission="'edit'"
              type="primary"
              @click="openEditFromView"
            >
              编辑
            </el-button>
            <el-button
              v-if="!passIsAudited(viewHeader)"
              v-permission="'audit'"
              type="success"
              @click="auditRow(viewHeader)"
            >
              审核
            </el-button>
            <el-button
              v-if="passIsAudited(viewHeader)"
              v-permission="'audit'"
              type="warning"
              @click="unauditRow(viewHeader)"
            >
              反审
            </el-button>
            <el-button v-permission="'delete'" type="danger" @click="softDeleteRow(viewHeader)">
              删除
            </el-button>
          </template>
          <template v-else>
            <el-button v-permission="'edit'" type="primary" @click="restoreRow(viewHeader)">恢复</el-button>
            <el-button v-permission="'delete'" type="danger" @click="hardDeleteRow(viewHeader)">
              彻底删除
            </el-button>
          </template>
        </template>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editVisible"
      :title="editMode === 'create' ? '新增销售订单' : '编辑销售订单'"
      width="85%"
      top="5vh"
      draggable
      destroy-on-close
      :modal="!isSalesOrderStandaloneWindow"
      :close-on-click-modal="false"
      :class="['so-edit-dialog', 'erp-page-dialog', { 'so-edit-dialog--standalone': isSalesOrderStandaloneWindow }]"
      @closed="onEditClosed"
    >
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
              <el-table-column label="操作" width="220" fixed="left">
                <template #default="{ row, $index }">
                  <el-button
                    v-if="editMode === 'edit' && editId"
                    v-permission="'edit'"
                    type="primary"
                    link
                    size="small"
                    :disabled="editDetailLocked"
                    @click="openPiBomTab(row, 'edit')"
                  >
                    PI BOM
                  </el-button>
                  <el-button
                    v-if="editMode === 'edit' && editId"
                    v-permission="'edit'"
                    type="primary"
                    link
                    size="small"
                    :disabled="editDetailLocked"
                    :loading="syncBomLoading === row.kcaa01"
                    @click="syncBomLine(row, editId)"
                  >
                    同步 BOM
                  </el-button>
                  <el-button
                    type="danger"
                    link
                    size="small"
                    :disabled="editDetailLocked"
                    @click="confirmRemoveLine($index)"
                  >
                    删行
                  </el-button>
                </template>
              </el-table-column>
              <el-table-column label="编码" prop="kcaa01" min-width="128" show-overflow-tooltip />
              <el-table-column label="数量" width="120">
                <template #default="{ row }">
                  <el-input-number
                    v-model="row.orderQty"
                    :min="0.0001"
                    :precision="4"
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
                    :precision="6"
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
                  row-key="systemcode"
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
      <template #footer>
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
    </el-dialog>

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
import { getErpTableActionsColMinWidth } from '@/utils/erpTableActionsLayout'

defineOptions({ name: 'supply-chain-daily-sales-order' })

const route = useRoute()
const pageTitle = '销售订单'
const SALES_ORDER_WINDOW_REFRESH_KEY = 'erp:sales-order:list-refresh'
const DEFAULT_CREATE_CUSTOMER_CODE = '7001'
const DEFAULT_CREATE_CUSTOMER_NAME = 'PQD'
const salesOrderWindowMode = computed(() => String(route.query?.mode ?? '').trim().toLowerCase())
const isSalesOrderStandaloneWindow = computed(() => salesOrderWindowMode.value === 'create')

const loading = ref(false)
const errorMessage = ref('')
const filterKeyword = ref('')
/** @type {import('vue').Ref<string[] | null>} */
const filterDateRange = ref(null)
const showRecycle = ref(false)
const showUnAudited = ref(false)
const tableList = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)

const mainTableRef = ref(null)
const salesOrderActionsColWidth = computed(() => getErpTableActionsColMinWidth(5))

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
/** 按款同步 BOM 加载中（kcaa01） */
const syncBomLoading = ref('')
/** 编辑弹窗主表 pass（已审锁明细） */
const editHeaderPass = ref('0')
/** 编辑弹窗运算状态（与列表 calcStatus 一致） */
const editHeaderCalcStatus = ref('未运算')
const calculateLoading = ref(false)
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
    const detail = await axios.get(`/api/sales-order/${orderId}`)
    const hdr = detail?.data?.data?.header ?? {}
    if (viewVisible.value && viewHeader.value?.id === orderId) {
      viewHeader.value = hdr
      viewLines.value = Array.isArray(detail?.data?.data?.lines) ? detail.data.data.lines : viewLines.value
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

function resetPiBomState() {
  piBomProduct.value = ''
  piBomTree.value = []
  piBomProducts.value = []
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
}

function onEditClosed() {
  if (isSalesOrderStandaloneWindow.value) closeStandaloneBrowserWindow()
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
  editHeaderPass.value = '0'
  editHeaderCalcStatus.value = '未运算'
  syncedSinceCalc.value = []
  resetPiBomState()
  editActiveTab.value = 'header'
  resetHeaderForm()
  await loadCurrencyOptions()
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
  editHeaderPass.value = String(row.pass ?? '0')
  resetPiBomState()
  editActiveTab.value = 'header'
  editLoading.value = true
  editVisible.value = true
  await loadCurrencyOptions()
  try {
    const res = await axios.get(`/api/sales-order/${row.id}`)
    const data = res?.data?.data ?? {}
    const hdr = data.header ?? {}
    fillHeaderFromDetail(hdr)
    editHeaderPass.value = String(hdr.pass ?? '0')
    editHeaderCalcStatus.value = String(hdr.calcStatus ?? '未运算')
    syncedSinceCalc.value = []
    const lines = Array.isArray(data.lines) ? data.lines : []
    lineRows.value = lines.map((ln) => ({
      kcaa01: String(ln.kcaa01 ?? '').trim(),
      orderQty: Number(ln.orderQty ?? 0) || 1,
      unitPrice: Number(ln.unitPrice ?? 0) || 0,
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
      orderQty: 1,
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
 * @param {{ kcaa01: string }} row
 * @param {number} orderId
 */
async function syncBomLine(row, orderId) {
  const code = String(row?.kcaa01 ?? '').trim()
  if (!code || !orderId) return
  if (editDetailLocked.value) {
    ElMessage.warning('该订单已审核，请先反审后再同步 BOM。')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认将款【${code}】的 PI BOM 从主 BOM 覆盖吗？将覆盖 PI 内该款全部子件用量，订单将标为「未运算」。`,
      '同步 BOM 确认',
      { type: 'warning', confirmButtonText: '同步', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  syncBomLoading.value = code
  try {
    const res = await axios.post(`/api/sales-order/${orderId}/sync-bom`, { kcaa01: code })
    ElMessage.success(res?.data?.msg ?? '同步 BOM 成功')
    if (!syncedSinceCalc.value.includes(code)) syncedSinceCalc.value.push(code)
    if (viewVisible.value && viewHeader.value?.id === orderId) {
      const detail = await axios.get(`/api/sales-order/${orderId}`)
      viewHeader.value = detail?.data?.data?.header ?? viewHeader.value
      viewLines.value = Array.isArray(detail?.data?.data?.lines) ? detail.data.data.lines : viewLines.value
    }
    if (editVisible.value && editId.value === orderId) {
      const detail = await axios.get(`/api/sales-order/${orderId}`)
      const hdr = detail?.data?.data?.header ?? {}
      editHeaderPass.value = String(hdr.pass ?? '0')
      editHeaderCalcStatus.value = String(hdr.calcStatus ?? '未运算')
      if (editActiveTab.value === 'piBom' && piBomProduct.value === code) {
        await loadPiBomTree(orderId, code)
      }
    }
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '同步失败'))
  } finally {
    syncBomLoading.value = ''
  }
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
    const body = buildSaveBody()
    if (editMode.value === 'create') {
      const res = await axios.post('/api/sales-order', body)
      ElMessage.success(res?.data?.msg ?? '保存成功')
    } else {
      const res = await axios.put(`/api/sales-order/${editId.value}`, body)
      ElMessage.success(res?.data?.msg ?? '保存成功')
    }
    if (isSalesOrderStandaloneWindow.value) {
      notifySalesOrderListRefresh()
      editVisible.value = false
      return
    }
    editVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error(String(e?.response?.data?.msg ?? e?.message ?? '保存失败'))
  } finally {
    saveLoading.value = false
  }
}

async function loadData() {
  loading.value = true
  errorMessage.value = ''
  try {
    const range = filterDateRange.value
    const params = buildSalesOrderListQueryParams({
      page: page.value,
      pageSize: pageSize.value,
      filters: {
        keyword: filterKeyword.value,
        salesDateFrom: Array.isArray(range) ? range[0] : undefined,
        salesDateTo: Array.isArray(range) ? range[1] : undefined,
        showRecycle: showRecycle.value,
        showUnAudited: showUnAudited.value,
      },
    })
    const res = await axios.get('/api/sales-order/list', { params })
    const data = res?.data?.data ?? {}
    total.value = Number(data.total ?? 0) || 0
    tableList.value = Array.isArray(data.list) ? data.list : []
  } catch (err) {
    const msg = err?.response?.data?.msg || err?.message || '加载失败'
    errorMessage.value = String(msg)
  } finally {
    loading.value = false
  }
}

function onSearch() {
  page.value = 1
  loadData()
}

function onReset() {
  filterKeyword.value = ''
  filterDateRange.value = null
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

/** @param {Record<string, unknown>} row */
function onMainRowClick(row, column, event) {
  if (!row?.id) return
  const target = event?.target
  if (target && typeof target.closest === 'function') {
    if (target.closest('.el-button') || target.closest('.el-table__expand-icon')) return
  }
  openView(row)
}

/** @param {Record<string, unknown>} row */
async function openView(row) {
  viewVisible.value = true
  viewLoading.value = true
  viewActiveTab.value = 'header'
  viewHeader.value = null
  viewLines.value = []
  resetPiBomState()
  try {
    const res = await axios.get(`/api/sales-order/${row.id}`)
    const data = res?.data?.data ?? {}
    viewHeader.value = data.header ?? null
    viewLines.value = Array.isArray(data.lines) ? data.lines : []
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
.so-toolbar {
  margin-bottom: 12px;
}
.search-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.so-toolbar .search-row:last-child {
  margin-bottom: 0;
}
.so-keyword-input {
  width: min(420px, 100%);
}
.so-date-range {
  width: min(300px, 100%);
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
/* DIY：编辑弹窗与明细工具栏字号 — index.vue .so-edit-dialog / .so-lines-hint */
.so-edit-dialog :deep(.el-dialog__title) {
  font-size: var(--so-dialog-title-size, 18px);
  font-weight: 600;
}
.so-lines-hint {
  margin: 0 0 8px;
  font-size: var(--so-lines-hint-size, 13px);
  color: var(--el-text-color-secondary);
}
.lines-toolbar {
  margin-bottom: 8px;
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
</style>

<style>
.so-edit-dialog--standalone.el-dialog {
  width: 100vw !important;
  height: 100vh;
  max-height: none;
  margin: 0 !important;
  border-radius: 0;
  box-shadow: none;
}

.so-edit-dialog--standalone.el-dialog .el-dialog__header {
  height: 0;
  min-height: 0;
  margin: 0;
  padding: 0 !important;
  border: 0;
  background: transparent;
}

.so-edit-dialog--standalone.el-dialog .el-dialog__title {
  display: none;
}

.so-edit-dialog--standalone.el-dialog .el-dialog__headerbtn {
  top: 10px !important;
  right: 14px !important;
  z-index: 5;
}

.so-edit-dialog--standalone.el-dialog .el-dialog__body {
  box-sizing: border-box;
  height: calc(100vh - 48px);
  padding: 10px 12px 12px !important;
  overflow: auto;
}

.so-edit-dialog--standalone.el-dialog .el-dialog__footer {
  box-sizing: border-box;
  height: 48px;
  padding: 8px 12px !important;
  border-top: 1px solid var(--el-border-color-light);
}
</style>
