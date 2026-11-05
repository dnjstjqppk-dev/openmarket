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

export {
  OmButton, OmIconButton, OmInput, OmTextarea, OmSelect, OmCheckbox, OmRadio, OmSwitch, OmModal, OmDrawer,
  OmDropdown, OmTooltip, OmPopover, OmTabs, OmBadge, OmAvatar, OmCard, OmDataTable, OmPagination, OmBreadcrumb,
  OmSidebar, OmHeader, OmNavigation, OmToast, OmAlert, OmSkeleton, OmEmptyState, OmErrorState, OmDatePicker,
  OmFileUploader, OmSearchBar, OmField, OmSpinner
}

/** The 31 components required by the PHASE 2 directive (OmField / OmSpinner are internal helpers). */
export const COMPONENT_CATALOG = [
  'OmButton', 'OmIconButton', 'OmInput', 'OmTextarea', 'OmSelect', 'OmCheckbox', 'OmRadio', 'OmSwitch', 'OmModal', 'OmDrawer',
  'OmDropdown', 'OmTooltip', 'OmPopover', 'OmTabs', 'OmBadge', 'OmAvatar', 'OmCard', 'OmDataTable', 'OmPagination', 'OmBreadcrumb',
  'OmSidebar', 'OmHeader', 'OmNavigation', 'OmToast', 'OmAlert', 'OmSkeleton', 'OmEmptyState', 'OmErrorState', 'OmDatePicker',
  'OmFileUploader', 'OmSearchBar'
] as const

export { useToast, toastState } from './composables/useToast'
export { useClickOutside } from './composables/useClickOutside'
export { useOverlay } from './composables/useOverlay'
export { createAutocomplete, normalizeQuery } from './composables/autocompleteCore'
export type { AcItem, AcGroup, AcFetcher, AcState } from './composables/autocompleteCore'
export { useTheme } from './composables/useTheme'
export { formatKrw, formatNumber, formatDate, formatDateTime, discountRate } from './format'

const all: Record<string, any> = {
  OmButton, OmIconButton, OmInput, OmTextarea, OmSelect, OmCheckbox, OmRadio, OmSwitch, OmModal, OmDrawer,
  OmDropdown, OmTooltip, OmPopover, OmTabs, OmBadge, OmAvatar, OmCard, OmDataTable, OmPagination, OmBreadcrumb,
  OmSidebar, OmHeader, OmNavigation, OmToast, OmAlert, OmSkeleton, OmEmptyState, OmErrorState, OmDatePicker,
  OmFileUploader, OmSearchBar, OmField, OmSpinner
}
export default {
  install(app: App) {
    for (const [name, c] of Object.entries(all)) app.component(name, c)
  }
}
