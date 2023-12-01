import * as React from 'react';
import PropTypes from 'prop-types';
import clsx from 'clsx';
import {
  unstable_composeClasses as composeClasses,
  unstable_useForkRef as useForkRef,
} from '@mui/utils';
import { fastMemo } from '../utils/fastMemo';
import { GridRowEventLookup } from '../models/events';
import { GridRowId, GridRowModel } from '../models/gridRows';
import { GridEditModes, GridRowModes, GridCellModes } from '../models/gridEditRowModel';
import { useGridApiContext } from '../hooks/utils/useGridApiContext';
import { getDataGridUtilityClass, gridClasses } from '../constants/gridClasses';
import { useGridRootProps } from '../hooks/utils/useGridRootProps';
import type { DataGridProcessedProps } from '../models/props/DataGridProps';
import type { GridPinnedColumns } from '../hooks/features/columns';
import type { GridStateColDef } from '../models/colDef/gridColDef';
import { gridColumnPositionsSelector } from '../hooks/features/columns/gridColumnsSelector';
import { useGridSelector, objectShallowCompare } from '../hooks/utils/useGridSelector';
import { GridRowClassNameParams } from '../models/params/gridRowParams';
import { useGridVisibleRows } from '../hooks/utils/useGridVisibleRows';
import { findParentElementFromClassName, isEventTargetInPortal } from '../utils/domUtils';
import { GRID_CHECKBOX_SELECTION_COL_DEF } from '../colDef/gridCheckboxSelectionColDef';
import { GRID_ACTIONS_COLUMN_TYPE } from '../colDef/gridActionsColDef';
import { GRID_DETAIL_PANEL_TOGGLE_FIELD } from '../constants/gridDetailPanelToggleField';
import { type GridDimensions } from '../hooks/features/dimensions';
import { gridSortModelSelector } from '../hooks/features/sorting/gridSortingSelector';
import { gridRowMaximumTreeDepthSelector } from '../hooks/features/rows/gridRowsSelector';
import { gridColumnGroupsHeaderMaxDepthSelector } from '../hooks/features/columnGrouping/gridColumnGroupsSelector';
import { gridEditRowsStateSelector } from '../hooks/features/editing/gridEditingSelectors';
import { randomNumberBetween } from '../utils/utils';
import { PinnedPosition } from './cell/GridCell';

export interface GridRowProps extends React.HTMLAttributes<HTMLDivElement> {
  rowId: GridRowId;
  selected: boolean;
  /**
   * Index of the row in the whole sorted and filtered dataset.
   * If some rows above have expanded children, this index also take those children into account.
   */
  index: number;
  rowHeight: number | 'auto';
  dimensions: GridDimensions;
  firstColumnToRender: number;
  lastColumnToRender: number;
  visibleColumns: GridStateColDef[];
  renderedColumns: GridStateColDef[];
  pinnedColumns: GridPinnedColumns;
  /**
   * Determines which cell has focus.
   * If `null`, no cell in this row has focus.
   */
  focusedCell: string | null;
  /**
   * Determines which cell should be tabbable by having tabIndex=0.
   * If `null`, no cell in this row is in the tab sequence.
   */
  tabbableCell: string | null;
  row?: GridRowModel;
  isFirstVisible: boolean;
  isLastVisible: boolean;
  focusedCellColumnIndexNotInRange?: number;
  isNotVisible?: boolean;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  [x: string]: any; // Allow custom attributes like data-* and aria-*
}

type OwnerState = Pick<GridRowProps, 'selected'> & {
  editable: boolean;
  editing: boolean;
  isFirstVisible: boolean;
  isLastVisible: boolean;
  classes?: DataGridProcessedProps['classes'];
  rowHeight: GridRowProps['rowHeight'];
};

const useUtilityClasses = (ownerState: OwnerState) => {
  const { editable, editing, selected, isFirstVisible, isLastVisible, rowHeight, classes } =
    ownerState;
  const slots = {
    root: [
      'row',
      selected && 'selected',
      editable && 'row--editable',
      editing && 'row--editing',
      isFirstVisible && 'row--firstVisible',
      isLastVisible && 'row--lastVisible',
      rowHeight === 'auto' && 'row--dynamicHeight',
    ],
    pinnedLeft: ['pinnedLeft'],
    pinnedRight: ['pinnedRight'],
  };

  return composeClasses(slots, getDataGridUtilityClass, classes);
};

function EmptyCell({ width }: { width: number }) {
  if (!width) {
    return null;
  }

  const style = { width };

  return <div className={`${gridClasses.cell} ${gridClasses.withBorderColor}`} style={style} />; // TODO change to .MuiDataGrid-emptyCell or .MuiDataGrid-rowFiller
}

const GridRow = React.forwardRef<HTMLDivElement, GridRowProps>(function GridRow(props, refProp) {
  const {
    selected,
    rowId,
    row,
    index,
    style: styleProp,
    rowHeight,
    className,
    visibleColumns,
    renderedColumns,
    pinnedColumns,
    dimensions,
    firstColumnToRender,
    lastColumnToRender,
    isFirstVisible,
    isLastVisible,
    focusedCellColumnIndexNotInRange,
    isNotVisible,
    focusedCell,
    tabbableCell,
    onClick,
    onDoubleClick,
    onMouseEnter,
    onMouseLeave,
    onMouseOut,
    onMouseOver,
    ...other
  } = props;
  const apiRef = useGridApiContext();
  const ref = React.useRef<HTMLDivElement>(null);
  const rootProps = useGridRootProps();
  const currentPage = useGridVisibleRows(apiRef, rootProps);
  const sortModel = useGridSelector(apiRef, gridSortModelSelector);
  const treeDepth = useGridSelector(apiRef, gridRowMaximumTreeDepthSelector);
  const headerGroupingMaxDepth = useGridSelector(apiRef, gridColumnGroupsHeaderMaxDepthSelector);
  const columnPositions = useGridSelector(apiRef, gridColumnPositionsSelector);
  const editRowsState = useGridSelector(apiRef, gridEditRowsStateSelector);
  const handleRef = useForkRef(ref, refProp);
  const rowNode = apiRef.current.getRowNode(rowId);

  const ariaRowIndex = index + headerGroupingMaxDepth + 2; // 1 for the header row and 1 as it's 1-based

  const ownerState = {
    selected,
    isFirstVisible,
    isLastVisible,
    classes: rootProps.classes,
    editing: apiRef.current.getRowMode(rowId) === GridRowModes.Edit,
    editable: rootProps.editMode === GridEditModes.Row,
    rowHeight,
  };

  const classes = useUtilityClasses(ownerState);

  React.useLayoutEffect(() => {
    if (rowHeight === 'auto' && ref.current && typeof ResizeObserver === 'undefined') {
      // Fallback for IE
      apiRef.current.unstable_storeRowHeightMeasurement(rowId, ref.current.clientHeight);
    }
  }, [apiRef, rowHeight, rowId]);

  React.useLayoutEffect(() => {
    if (currentPage.range) {
      // The index prop is relative to the rows from all pages. As example, the index prop of the
      // first row is 5 if `paginationModel.pageSize=5` and `paginationModel.page=1`. However, the index used by the virtualization
      // doesn't care about pagination and considers the rows from the current page only, so the
      // first row always has index=0. We need to subtract the index of the first row to make it
      // compatible with the index used by the virtualization.
      const rowIndex = apiRef.current.getRowIndexRelativeToVisibleRows(rowId);
      // pinned rows are not part of the visible rows
      if (rowIndex != null) {
        apiRef.current.unstable_setLastMeasuredRowIndex(rowIndex);
      }
    }

    const rootElement = ref.current;
    const hasFixedHeight = rowHeight !== 'auto';
    if (!rootElement || hasFixedHeight || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries;
      const height =
        entry.borderBoxSize && entry.borderBoxSize.length > 0
          ? entry.borderBoxSize[0].blockSize
          : entry.contentRect.height;
      apiRef.current.unstable_storeRowHeightMeasurement(rowId, height);
    });

    resizeObserver.observe(rootElement);

    return () => resizeObserver.disconnect();
  }, [apiRef, currentPage.range, index, rowHeight, rowId]);

  const publish = React.useCallback(
    (
        eventName: keyof GridRowEventLookup,
        propHandler: React.MouseEventHandler<HTMLDivElement> | undefined,
      ): React.MouseEventHandler<HTMLDivElement> =>
      (event) => {
        // Ignore portal
        if (isEventTargetInPortal(event)) {
          return;
        }

        // The row might have been deleted
        if (!apiRef.current.getRow(rowId)) {
          return;
        }

        apiRef.current.publishEvent(eventName, apiRef.current.getRowParams(rowId), event);

        if (propHandler) {
          propHandler(event);
        }
      },
    [apiRef, rowId],
  );

  const publishClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const cell = findParentElementFromClassName(event.target as HTMLDivElement, gridClasses.cell);
      const field = cell?.getAttribute('data-field');

      // Check if the field is available because the cell that fills the empty
      // space of the row has no field.
      if (field) {
        // User clicked in the checkbox added by checkboxSelection
        if (field === GRID_CHECKBOX_SELECTION_COL_DEF.field) {
          return;
        }

        // User opened a detail panel
        if (field === GRID_DETAIL_PANEL_TOGGLE_FIELD) {
          return;
        }

        // User reorders a row
        if (field === '__reorder__') {
          return;
        }

        // User is editing a cell
        if (apiRef.current.getCellMode(rowId, field) === GridCellModes.Edit) {
          return;
        }

        // User clicked a button from the "actions" column type
        const column = apiRef.current.getColumn(field);
        if (column?.type === GRID_ACTIONS_COLUMN_TYPE) {
          return;
        }
      }

      publish('rowClick', onClick)(event);
    },
    [apiRef, onClick, publish, rowId],
  );

  const { slots, slotProps, disableColumnReorder } = rootProps;

  const rowReordering = (rootProps as any).rowReordering as boolean;

  const sizes = useGridSelector(
    apiRef,
    () => ({ ...apiRef.current.unstable_getRowInternalSizes(rowId) }),
    objectShallowCompare,
  );

  let minHeight = rowHeight;
  if (minHeight === 'auto' && sizes) {
    const numberOfBaseSizes = 1;
    const maximumSize = sizes.baseCenter ?? 0;

    if (maximumSize > 0 && numberOfBaseSizes > 1) {
      minHeight = maximumSize;
    }
  }

  const style = React.useMemo(() => {
    if (isNotVisible) {
      return {
        opacity: 0,
        width: 0,
        height: 0,
      };
    }

    const rowStyle = {
      ...styleProp,
      maxHeight: rowHeight === 'auto' ? 'none' : rowHeight, // max-height doesn't support "auto"
      minHeight,
    };

    if (sizes?.spacingTop) {
      const property = rootProps.rowSpacingType === 'border' ? 'borderTopWidth' : 'marginTop';
      rowStyle[property] = sizes.spacingTop;
    }

    if (sizes?.spacingBottom) {
      const property = rootProps.rowSpacingType === 'border' ? 'borderBottomWidth' : 'marginBottom';
      let propertyValue = rowStyle[property];
      // avoid overriding existing value
      if (typeof propertyValue !== 'number') {
        propertyValue = parseInt(propertyValue || '0', 10);
      }
      propertyValue += sizes.spacingBottom;
      rowStyle[property] = propertyValue;
    }

    return rowStyle;
  }, [isNotVisible, rowHeight, styleProp, minHeight, sizes, rootProps.rowSpacingType]);

  const rowClassNames = apiRef.current.unstable_applyPipeProcessors('rowClassName', [], rowId);

  if (typeof rootProps.getRowClassName === 'function') {
    const indexRelativeToCurrentPage = index - (currentPage.range?.firstRowIndex || 0);
    const rowParams: GridRowClassNameParams = {
      ...apiRef.current.getRowParams(rowId),
      isFirstVisible: indexRelativeToCurrentPage === 0,
      isLastVisible: indexRelativeToCurrentPage === currentPage.rows.length - 1,
      indexRelativeToCurrentPage,
    };

    rowClassNames.push(rootProps.getRowClassName(rowParams));
  }

  const randomNumber = randomNumberBetween(10000, 20, 80);

  const getCell = (
    column: GridStateColDef,
    indexInSection: number,
    indexRelativeToAllColumns: number,
    sectionLength: number,
    pinnedPosition = PinnedPosition.NONE,
  ) => {
    const cellColSpanInfo = apiRef.current.unstable_getCellColSpanInfo(
      rowId,
      indexRelativeToAllColumns,
    );

    if (!cellColSpanInfo || cellColSpanInfo.spannedByColSpan) {
      return null;
    }

    const pinnedOffset =
      pinnedPosition === PinnedPosition.LEFT
        ? columnPositions[indexRelativeToAllColumns]
        : pinnedPosition === PinnedPosition.RIGHT
        ? dimensions.columnsTotalWidth -
          columnPositions[indexRelativeToAllColumns] -
          column.computedWidth
        : 0;

    if (rowNode?.type === 'skeletonRow') {
      const { width } = cellColSpanInfo.cellProps;
      const contentWidth = Math.round(randomNumber());

      return (
        <slots.skeletonCell
          key={column.field}
          width={width}
          contentWidth={contentWidth}
          field={column.field}
          align={column.align}
        />
      );
    }

    const { colSpan, width } = cellColSpanInfo.cellProps;

    const editCellState = editRowsState[rowId]?.[column.field] ?? null;
    const disableDragEvents =
      (disableColumnReorder && column.disableReorder) ||
      (!rowReordering &&
        !!sortModel.length &&
        treeDepth > 1 &&
        Object.keys(editRowsState).length > 0);

    let cellIsNotVisible = false;
    if (
      focusedCellColumnIndexNotInRange !== undefined &&
      visibleColumns[focusedCellColumnIndexNotInRange].field === column.field
    ) {
      cellIsNotVisible = true;
    }

    return (
      <slots.cell
        key={column.field}
        column={column}
        width={width}
        rowId={rowId}
        height={rowHeight}
        align={column.align || 'left'}
        colIndex={indexRelativeToAllColumns}
        colSpan={colSpan}
        disableDragEvents={disableDragEvents}
        editCellState={editCellState}
        isNotVisible={cellIsNotVisible}
        {...slotProps?.cell}
        pinnedOffset={pinnedOffset}
        pinnedPosition={pinnedPosition}
        sectionIndex={indexInSection}
        sectionLength={sectionLength}
      />
    );
  };

  /* Start of rendering */

  if (!rowNode) {
    return null;
  }

  const leftCells = pinnedColumns.left.map((column, i) => {
    const indexRelativeToAllColumns = i;
    return getCell(
      column,
      i,
      indexRelativeToAllColumns,
      pinnedColumns.left.length,
      PinnedPosition.LEFT,
    );
  });

  const rightCells = pinnedColumns.right.map((column, i) => {
    const indexRelativeToAllColumns = visibleColumns.length - pinnedColumns.right.length + i;
    return getCell(
      column,
      i,
      indexRelativeToAllColumns,
      pinnedColumns.right.length,
      PinnedPosition.RIGHT,
    );
  });

  const cells = [] as React.ReactNode[];
  for (let i = 0; i < renderedColumns.length; i += 1) {
    const column = renderedColumns[i];

    let indexRelativeToAllColumns = firstColumnToRender + i;

    if (focusedCellColumnIndexNotInRange !== undefined && focusedCell) {
      if (visibleColumns[focusedCellColumnIndexNotInRange].field === column.field) {
        indexRelativeToAllColumns = focusedCellColumnIndexNotInRange;
      } else {
        indexRelativeToAllColumns -= 1;
      }
    }

    cells.push(getCell(column, i, indexRelativeToAllColumns, renderedColumns.length));
  }

  const emptyCellWidth = dimensions.viewportOuterSize.width - dimensions.columnsTotalWidth;

  const eventHandlers = row
    ? {
        onClick: publishClick,
        onDoubleClick: publish('rowDoubleClick', onDoubleClick),
        onMouseEnter: publish('rowMouseEnter', onMouseEnter),
        onMouseLeave: publish('rowMouseLeave', onMouseLeave),
        onMouseOut: publish('rowMouseOut', onMouseOut),
        onMouseOver: publish('rowMouseOver', onMouseOver),
      }
    : null;

  return (
    <div
      ref={handleRef}
      data-id={rowId}
      data-rowindex={index}
      role="row"
      className={clsx(...rowClassNames, classes.root, className)}
      aria-rowindex={ariaRowIndex}
      aria-selected={selected}
      style={style}
      {...eventHandlers}
      {...other}
    >
      {leftCells}
      {cells}
      {emptyCellWidth > 0 && <EmptyCell width={emptyCellWidth} />}
      {rightCells.length > 0 && <div role="presentation" style={{ flex: '1' }} />}
      {rightCells}
    </div>
  );
});

GridRow.propTypes = {
  // ----------------------------- Warning --------------------------------
  // | These PropTypes are generated from the TypeScript type definitions |
  // | To update them edit the TypeScript types and run "yarn proptypes"  |
  // ----------------------------------------------------------------------
  dimensions: PropTypes.shape({
    bottomContainerHeight: PropTypes.number.isRequired,
    columnsTotalWidth: PropTypes.number.isRequired,
    contentSize: PropTypes.shape({
      height: PropTypes.number.isRequired,
      width: PropTypes.number.isRequired,
    }).isRequired,
    hasScrollX: PropTypes.bool.isRequired,
    hasScrollY: PropTypes.bool.isRequired,
    headerHeight: PropTypes.number.isRequired,
    headersTotalHeight: PropTypes.number.isRequired,
    isReady: PropTypes.bool.isRequired,
    leftPinnedWidth: PropTypes.number.isRequired,
    minimumSize: PropTypes.shape({
      height: PropTypes.number.isRequired,
      width: PropTypes.number.isRequired,
    }).isRequired,
    rightPinnedWidth: PropTypes.number.isRequired,
    root: PropTypes.shape({
      height: PropTypes.number.isRequired,
      width: PropTypes.number.isRequired,
    }).isRequired,
    rowHeight: PropTypes.number.isRequired,
    rowWidth: PropTypes.number.isRequired,
    scrollbarSize: PropTypes.number.isRequired,
    topContainerHeight: PropTypes.number.isRequired,
    viewportInnerSize: PropTypes.shape({
      height: PropTypes.number.isRequired,
      width: PropTypes.number.isRequired,
    }).isRequired,
    viewportOuterSize: PropTypes.shape({
      height: PropTypes.number.isRequired,
      width: PropTypes.number.isRequired,
    }).isRequired,
  }).isRequired,
  firstColumnToRender: PropTypes.number.isRequired,
  /**
   * Determines which cell has focus.
   * If `null`, no cell in this row has focus.
   */
  focusedCell: PropTypes.string,
  focusedCellColumnIndexNotInRange: PropTypes.number,
  /**
   * Index of the row in the whole sorted and filtered dataset.
   * If some rows above have expanded children, this index also take those children into account.
   */
  index: PropTypes.number.isRequired,
  isFirstVisible: PropTypes.bool.isRequired,
  isLastVisible: PropTypes.bool.isRequired,
  isNotVisible: PropTypes.bool,
  lastColumnToRender: PropTypes.number.isRequired,
  onClick: PropTypes.func,
  onDoubleClick: PropTypes.func,
  onMouseEnter: PropTypes.func,
  onMouseLeave: PropTypes.func,
  pinnedColumns: PropTypes.shape({
    left: PropTypes.arrayOf(
      PropTypes.shape({
        align: PropTypes.oneOf(['center', 'left', 'right']),
        cellClassName: PropTypes.oneOfType([PropTypes.func, PropTypes.string]),
        colSpan: PropTypes.oneOfType([PropTypes.func, PropTypes.number]),
        computedWidth: PropTypes.number.isRequired,
        description: PropTypes.string,
        disableColumnMenu: PropTypes.bool,
        disableExport: PropTypes.bool,
        disableReorder: PropTypes.bool,
        editable: PropTypes.bool,
        field: PropTypes.string.isRequired,
        filterable: PropTypes.bool,
        filterOperators: PropTypes.arrayOf(
          PropTypes.shape({
            getApplyFilterFn: PropTypes.func.isRequired,
            getValueAsString: PropTypes.func,
            headerLabel: PropTypes.string,
            InputComponent: PropTypes.elementType,
            InputComponentProps: PropTypes.object,
            label: PropTypes.string,
            requiresFilterValue: PropTypes.bool,
            value: PropTypes.string.isRequired,
          }),
        ),
        flex: PropTypes.number,
        getApplyQuickFilterFn: PropTypes.func,
        groupable: PropTypes.bool,
        hasBeenResized: PropTypes.bool,
        headerAlign: PropTypes.oneOf(['center', 'left', 'right']),
        headerClassName: PropTypes.oneOfType([PropTypes.func, PropTypes.string]),
        headerName: PropTypes.string,
        hideable: PropTypes.bool,
        hideSortIcons: PropTypes.bool,
        maxWidth: PropTypes.number,
        minWidth: PropTypes.number,
        pinnable: PropTypes.bool,
        preProcessEditCellProps: PropTypes.func,
        renderCell: PropTypes.func,
        renderEditCell: PropTypes.func,
        renderHeader: PropTypes.func,
        resizable: PropTypes.bool,
        sortable: PropTypes.bool,
        sortComparator: PropTypes.func,
        sortingOrder: PropTypes.arrayOf(PropTypes.oneOf(['asc', 'desc'])),
        type: PropTypes.oneOfType([
          PropTypes.oneOf([
            'actions',
            'boolean',
            'date',
            'dateTime',
            'number',
            'singleSelect',
            'string',
          ]),
          PropTypes.shape({
            '__@iterator@570': PropTypes.func.isRequired,
            anchor: PropTypes.func.isRequired,
            at: PropTypes.func.isRequired,
            big: PropTypes.func.isRequired,
            blink: PropTypes.func.isRequired,
            bold: PropTypes.func.isRequired,
            charAt: PropTypes.func.isRequired,
            charCodeAt: PropTypes.func.isRequired,
            codePointAt: PropTypes.func.isRequired,
            concat: PropTypes.func.isRequired,
            endsWith: PropTypes.func.isRequired,
            fixed: PropTypes.func.isRequired,
            fontcolor: PropTypes.func.isRequired,
            fontsize: PropTypes.func.isRequired,
            includes: PropTypes.func.isRequired,
            indexOf: PropTypes.func.isRequired,
            italics: PropTypes.func.isRequired,
            lastIndexOf: PropTypes.func.isRequired,
            length: PropTypes.number.isRequired,
            link: PropTypes.func.isRequired,
            localeCompare: PropTypes.func.isRequired,
            match: PropTypes.func.isRequired,
            matchAll: PropTypes.func.isRequired,
            normalize: PropTypes.func.isRequired,
            padEnd: PropTypes.func.isRequired,
            padStart: PropTypes.func.isRequired,
            repeat: PropTypes.func.isRequired,
            replace: PropTypes.func.isRequired,
            replaceAll: PropTypes.func.isRequired,
            search: PropTypes.func.isRequired,
            slice: PropTypes.func.isRequired,
            small: PropTypes.func.isRequired,
            split: PropTypes.func.isRequired,
            startsWith: PropTypes.func.isRequired,
            strike: PropTypes.func.isRequired,
            sub: PropTypes.func.isRequired,
            substr: PropTypes.func.isRequired,
            substring: PropTypes.func.isRequired,
            sup: PropTypes.func.isRequired,
            toLocaleLowerCase: PropTypes.func.isRequired,
            toLocaleUpperCase: PropTypes.func.isRequired,
            toLowerCase: PropTypes.func.isRequired,
            toString: PropTypes.func.isRequired,
            toUpperCase: PropTypes.func.isRequired,
            trim: PropTypes.func.isRequired,
            trimEnd: PropTypes.func.isRequired,
            trimLeft: PropTypes.func.isRequired,
            trimRight: PropTypes.func.isRequired,
            trimStart: PropTypes.func.isRequired,
            valueOf: PropTypes.func.isRequired,
          }),
        ]),
        valueFormatter: PropTypes.func,
        valueGetter: PropTypes.func,
        valueParser: PropTypes.func,
        valueSetter: PropTypes.func,
        width: PropTypes.number,
      }),
    ).isRequired,
    right: PropTypes.arrayOf(
      PropTypes.shape({
        align: PropTypes.oneOf(['center', 'left', 'right']),
        cellClassName: PropTypes.oneOfType([PropTypes.func, PropTypes.string]),
        colSpan: PropTypes.oneOfType([PropTypes.func, PropTypes.number]),
        computedWidth: PropTypes.number.isRequired,
        description: PropTypes.string,
        disableColumnMenu: PropTypes.bool,
        disableExport: PropTypes.bool,
        disableReorder: PropTypes.bool,
        editable: PropTypes.bool,
        field: PropTypes.string.isRequired,
        filterable: PropTypes.bool,
        filterOperators: PropTypes.arrayOf(
          PropTypes.shape({
            getApplyFilterFn: PropTypes.func.isRequired,
            getValueAsString: PropTypes.func,
            headerLabel: PropTypes.string,
            InputComponent: PropTypes.elementType,
            InputComponentProps: PropTypes.object,
            label: PropTypes.string,
            requiresFilterValue: PropTypes.bool,
            value: PropTypes.string.isRequired,
          }),
        ),
        flex: PropTypes.number,
        getApplyQuickFilterFn: PropTypes.func,
        groupable: PropTypes.bool,
        hasBeenResized: PropTypes.bool,
        headerAlign: PropTypes.oneOf(['center', 'left', 'right']),
        headerClassName: PropTypes.oneOfType([PropTypes.func, PropTypes.string]),
        headerName: PropTypes.string,
        hideable: PropTypes.bool,
        hideSortIcons: PropTypes.bool,
        maxWidth: PropTypes.number,
        minWidth: PropTypes.number,
        pinnable: PropTypes.bool,
        preProcessEditCellProps: PropTypes.func,
        renderCell: PropTypes.func,
        renderEditCell: PropTypes.func,
        renderHeader: PropTypes.func,
        resizable: PropTypes.bool,
        sortable: PropTypes.bool,
        sortComparator: PropTypes.func,
        sortingOrder: PropTypes.arrayOf(PropTypes.oneOf(['asc', 'desc'])),
        type: PropTypes.oneOfType([
          PropTypes.oneOf([
            'actions',
            'boolean',
            'date',
            'dateTime',
            'number',
            'singleSelect',
            'string',
          ]),
          PropTypes.shape({
            '__@iterator@570': PropTypes.func.isRequired,
            anchor: PropTypes.func.isRequired,
            at: PropTypes.func.isRequired,
            big: PropTypes.func.isRequired,
            blink: PropTypes.func.isRequired,
            bold: PropTypes.func.isRequired,
            charAt: PropTypes.func.isRequired,
            charCodeAt: PropTypes.func.isRequired,
            codePointAt: PropTypes.func.isRequired,
            concat: PropTypes.func.isRequired,
            endsWith: PropTypes.func.isRequired,
            fixed: PropTypes.func.isRequired,
            fontcolor: PropTypes.func.isRequired,
            fontsize: PropTypes.func.isRequired,
            includes: PropTypes.func.isRequired,
            indexOf: PropTypes.func.isRequired,
            italics: PropTypes.func.isRequired,
            lastIndexOf: PropTypes.func.isRequired,
            length: PropTypes.number.isRequired,
            link: PropTypes.func.isRequired,
            localeCompare: PropTypes.func.isRequired,
            match: PropTypes.func.isRequired,
            matchAll: PropTypes.func.isRequired,
            normalize: PropTypes.func.isRequired,
            padEnd: PropTypes.func.isRequired,
            padStart: PropTypes.func.isRequired,
            repeat: PropTypes.func.isRequired,
            replace: PropTypes.func.isRequired,
            replaceAll: PropTypes.func.isRequired,
            search: PropTypes.func.isRequired,
            slice: PropTypes.func.isRequired,
            small: PropTypes.func.isRequired,
            split: PropTypes.func.isRequired,
            startsWith: PropTypes.func.isRequired,
            strike: PropTypes.func.isRequired,
            sub: PropTypes.func.isRequired,
            substr: PropTypes.func.isRequired,
            substring: PropTypes.func.isRequired,
            sup: PropTypes.func.isRequired,
            toLocaleLowerCase: PropTypes.func.isRequired,
            toLocaleUpperCase: PropTypes.func.isRequired,
            toLowerCase: PropTypes.func.isRequired,
            toString: PropTypes.func.isRequired,
            toUpperCase: PropTypes.func.isRequired,
            trim: PropTypes.func.isRequired,
            trimEnd: PropTypes.func.isRequired,
            trimLeft: PropTypes.func.isRequired,
            trimRight: PropTypes.func.isRequired,
            trimStart: PropTypes.func.isRequired,
            valueOf: PropTypes.func.isRequired,
          }),
        ]),
        valueFormatter: PropTypes.func,
        valueGetter: PropTypes.func,
        valueParser: PropTypes.func,
        valueSetter: PropTypes.func,
        width: PropTypes.number,
      }),
    ).isRequired,
  }).isRequired,
  renderedColumns: PropTypes.arrayOf(PropTypes.object).isRequired,
  row: PropTypes.object,
  rowHeight: PropTypes.oneOfType([PropTypes.oneOf(['auto']), PropTypes.number]).isRequired,
  rowId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  selected: PropTypes.bool.isRequired,
  /**
   * Determines which cell should be tabbable by having tabIndex=0.
   * If `null`, no cell in this row is in the tab sequence.
   */
  tabbableCell: PropTypes.string,
  visibleColumns: PropTypes.arrayOf(PropTypes.object).isRequired,
} as any;

const MemoizedGridRow = fastMemo(GridRow);

export { MemoizedGridRow as GridRow };
