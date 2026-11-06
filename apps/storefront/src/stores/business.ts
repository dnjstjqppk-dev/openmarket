// apps/storefront/src/stores/business.ts
// The operator's legal disclosure (/api/v1/business-info), loaded once per page session and shared by the footer
// and pages that need the customer-service contact (e.g. password reset while mail delivery is not integrated).
import { defineStore } from 'pinia'
import { ref } from 'vue'
import { API_BASE_URL } from '../config'

export interface BusinessInfo {
  legal_name: string
  representative_name: string
  business_reg_number: string
  mail_order_reg_number: string
  address: string
  cs_phone: string
  cs_email: string
  hosting_provider?: string | null
  privacy_officer_name?: string | null
  escrow_service_ref?: string | null
}

export const useBusinessStore = defineStore('business', () => {
  const info = ref<BusinessInfo | null>(null)
  const loaded = ref(false)
  let inflight: Promise<void> | null = null

  function load(): Promise<void> {
    if (loaded.value) return Promise.resolve()
    if (inflight) return inflight
    inflight = fetch(`${API_BASE_URL}/api/v1/business-info`)
      .then((r) => r.json())
      .then((j) => { info.value = j && j.configured ? j.data : null })
      .catch(() => { info.value = null })
      .finally(() => { loaded.value = true; inflight = null })
    return inflight
  }

  return { info, loaded, load }
})
