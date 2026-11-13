// @olmoa/ui — public API. Import components by name, or `app.use(OlmoaUI)` to register them all globally.
import type { App } from 'vue'

import OmButton from './components/OmButton.vue'
import OmIconButton from './components/OmIconButton.vue'
import OmInput from './components/OmInput.vue'
import OmTextarea from './components/OmTextarea.vue'
import OmSelect from './components/OmSelect.vue'
import OmCheckbox from './components/OmCheckbox.vue'
import OmRadio from './components/OmRadio.vue'
import OmSwitch from './components/OmSwitch.vue'
import OmModal from './components/OmModal.vue'
import OmDrawer from './components/OmDrawer.vue'
import OmDropdown from './components/OmDropdown.vue'
import OmTooltip from './components/OmTooltip.vue'
import OmPopover from './components/OmPopover.vue'
import OmTabs from './components/OmTabs.vue'
import OmBadge from './components/OmBadge.vue'
import OmAvatar from './components/OmAvatar.vue'
import OmCard from './components/OmCard.vue'
import OmDataTable from './components/OmDataTable.vue'
import OmPagination from './components/OmPagination.vue'
import OmBreadcrumb from './components/OmBreadcrumb.vue'
import OmSidebar from './components/OmSidebar.vue'
import OmHeader from './components/OmHeader.vue'
import OmNavigation from './components/OmNavigation.vue'
import OmToast from './components/OmToast.vue'
import OmAlert from './components/OmAlert.vue'
import OmSkeleton from './components/OmSkeleton.vue'
import OmEmptyState from './components/OmEmptyState.vue'
import OmErrorState from './components/OmErrorState.vue'
import OmDatePicker from './components/OmDatePicker.vue'
import OmFileUploader from './components/OmFileUploader.vue'
import OmSearchBar from './components/OmSearchBar.vue'
import OmField from './components/OmField.vue'
import OmSpinner from './components/OmSpinner.vue'
import OmFooter from './components/OmFooter.vue'
import OmPrice from './components/OmPrice.vue'
import OmNumber from './components/OmNumber.vue'
import OmRating from './components/OmRating.vue'
import OmCommerceBadge from './components/OmCommerceBadge.vue'
import OmCountdown from './components/OmCountdown.vue'
import OmProgress from './components/OmProgress.vue'
import OmQuantityStepper from './components/OmQuantityStepper.vue'
import OmCarousel from './components/OmCarousel.vue'
import OmImageGallery from './components/OmImageGallery.vue'
import OmBottomSheet from './components/OmBottomSheet.vue'
import OmStickyTabs from './components/OmStickyTabs.vue'
import OmFoldable from './components/OmFoldable.vue'
import OmFilterPanel from './components/OmFilterPanel.vue'
import OmFilterChips from './components/OmFilterChips.vue'
import OmViewToggle from './components/OmViewToggle.vue'
import OmProductCard from './components/OmProductCard.vue'
import OmSellerCard from './components/OmSellerCard.vue'
import OmConfirmDialog from './components/OmConfirmDialog.vue'
import OmConsoleShell from './components/OmConsoleShell.vue'
import OmKpiCard from './components/OmKpiCard.vue'
import OmStatusTabs from './components/OmStatusTabs.vue'
import OmDateRangePicker from './components/OmDateRangePicker.vue'
import OmSearchFilterBar from './components/OmSearchFilterBar.vue'
import OmAddressSearch from './components/OmAddressSearch.vue'
import OmImage from './components/OmImage.vue'

export {
  OmButton, OmIconButton, OmInput, OmTextarea, OmSelect, OmCheckbox, OmRadio, OmSwitch, OmModal, OmDrawer,
  OmDropdown, OmTooltip, OmPopover, OmTabs, OmBadge, OmAvatar, OmCard, OmDataTable, OmPagination, OmBreadcrumb,
  OmSidebar, OmHeader, OmNavigation, OmToast, OmAlert, OmSkeleton, OmEmptyState, OmErrorState, OmDatePicker,
  OmFileUploader, OmSearchBar, OmField, OmSpinner, OmFooter,
  OmPrice, OmNumber, OmRating, OmCommerceBadge, OmCountdown, OmProgress, OmQuantityStepper, OmCarousel,
  OmImageGallery, OmBottomSheet, OmStickyTabs, OmFoldable, OmFilterPanel, OmFilterChips, OmViewToggle,
  OmProductCard, OmSellerCard, OmConfirmDialog, OmConsoleShell, OmKpiCard, OmStatusTabs, OmDateRangePicker,
  OmSearchFilterBar, OmAddressSearch, OmImage
}

/** The 31 components required by the PHASE 2 directive (OmField / OmSpinner are internal helpers). */
export const COMPONENT_CATALOG = [
  'OmButton', 'OmIconButton', 'OmInput', 'OmTextarea', 'OmSelect', 'OmCheckbox', 'OmRadio', 'OmSwitch', 'OmModal', 'OmDrawer',
  'OmDropdown', 'OmTooltip', 'OmPopover', 'OmTabs', 'OmBadge', 'OmAvatar', 'OmCard', 'OmDataTable', 'OmPagination', 'OmBreadcrumb',
  'OmSidebar', 'OmHeader', 'OmNavigation', 'OmToast', 'OmAlert', 'OmSkeleton', 'OmEmptyState', 'OmErrorState', 'OmDatePicker',
  'OmFileUploader', 'OmSearchBar'
] as const

export type { ConsoleMenuItem } from './components/OmConsoleShell.vue'
export type { FooterColumn } from './components/OmFooter.vue'
export type { NavItem } from './components/OmNavigation.vue'
export type { DropdownItem } from './components/OmDropdown.vue'
export { useConfirm, confirmState } from './composables/useConfirm'
export type { ConfirmOptions } from './composables/useConfirm'
export { useToast, toastState } from './composables/useToast'
export { useClickOutside } from './composables/useClickOutside'
export { useOverlay } from './composables/useOverlay'
export { createAutocomplete, normalizeQuery, parseTrendingKeywords } from './composables/autocompleteCore'
export type { AcItem, AcGroup, AcFetcher, AcState } from './composables/autocompleteCore'
export { useTheme, nextThemeMode } from './composables/useTheme'
export type { ThemeMode } from './composables/useTheme'
export { useBreakpoint, BREAKPOINTS, BREAKPOINT_ORDER, breakpointOf, deviceOf, matches, matchesDevice } from './composables/useBreakpoint'
export type { BreakpointKey, DeviceClass, BreakpointState } from './composables/useBreakpoint'
export { formatKrw, formatNumber, formatDate, formatDateTime, discountRate } from './format'
export { priceDisplayLines, clampQuantity, countdownParts, ratingVisible, tablePages, soldoutPct } from './commerce'
export type { PriceLines, Countdown } from './commerce'

const all: Record<string, any> = {
  OmButton, OmIconButton, OmInput, OmTextarea, OmSelect, OmCheckbox, OmRadio, OmSwitch, OmModal, OmDrawer,
  OmDropdown, OmTooltip, OmPopover, OmTabs, OmBadge, OmAvatar, OmCard, OmDataTable, OmPagination, OmBreadcrumb,
  OmSidebar, OmHeader, OmNavigation, OmToast, OmAlert, OmSkeleton, OmEmptyState, OmErrorState, OmDatePicker,
  OmFileUploader, OmSearchBar, OmField, OmSpinner, OmFooter,
  OmPrice, OmNumber, OmRating, OmCommerceBadge, OmCountdown, OmProgress, OmQuantityStepper, OmCarousel,
  OmImageGallery, OmBottomSheet, OmStickyTabs, OmFoldable, OmFilterPanel, OmFilterChips, OmViewToggle,
  OmProductCard, OmSellerCard, OmConfirmDialog, OmConsoleShell, OmKpiCard, OmStatusTabs, OmDateRangePicker,
  OmSearchFilterBar, OmAddressSearch, OmImage
}
export default {
  install(app: App) {
    for (const [name, c] of Object.entries(all)) app.component(name, c)
  }
}
