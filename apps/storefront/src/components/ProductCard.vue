<script setup lang="ts">
// App wiring for the shared product card (3-3): wishlist hearts backed by the
// wishlist store, quick-add that fetches the SKU set once and either adds the
// single option directly or opens the option sheet. Emits nothing; toasts here.
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { OmProductCard, useToast, userErrorMessage } from '@olmoa/ui'
import { useLocaleStore } from '../stores/locale'
import { useAuthStore } from '../stores/auth'
import { useCartStore } from '../stores/cart'
import { useWishlistStore } from '../stores/wishlist'
import { API_BASE_URL } from '../config'
import QuickOptionSheet from './QuickOptionSheet.vue'

const props = withDefaults(defineProps<{ product: any; rank?: number | null; eager?: boolean }>(), { rank: null, eager: false })
const locale = useLocaleStore()
const auth = useAuthStore()
const cart = useCartStore()
const wishlist = useWishlistStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const wished = computed(() => wishlist.ids.has(props.product?.id))
const sheetOpen = ref(false)
const sheetSkus = ref<any[]>([])
const adding = ref(false)

wishlist.load()

async function onWish() {
  if (!(await auth.ensureSession())) {
    router.push(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
    return
  }
  const next = await wishlist.toggle(props.product.id)
  if (next === null) toast.error('찜하지 못했습니다')
  else toast.success(next ? '찜 목록에 저장했습니다.' : '찜 목록에서 삭제했습니다.')
}

async function onAdd() {
  if (adding.value) return
  adding.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/products/${props.product.slug || props.product.id}`)
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.success) throw new Error(json?.error || '옵션을 불러오지 못했습니다')
    const skus = Array.isArray(json.data?.skus) ? json.data.skus : []
    const live = skus.filter((s: any) => Number(s.stock_quantity) > 0)
    if (skus.length === 1) {
      const ok = cart.addItem(json.data, skus[0], 1)
      if (ok) toast.success('장바구니에 담았습니다', { title: props.product.title })
      else toast.error('장바구니에 담지 못했습니다. 품절 여부를 확인해 주세요.')
      return
    }
    if (!live.length) {
      toast.error('품절된 상품입니다')
      return
    }
    sheetSkus.value = skus
    sheetOpen.value = true
  } catch (e: any) {
    toast.error(userErrorMessage(e, '옵션을 불러오지 못했습니다'))
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <OmProductCard
    :product="product"
    :rank="rank"
    :eager="eager"
    :wished="wished"
    :format-price="locale.formatPrice"
    @wish="onWish"
    @add="onAdd"
  />
  <QuickOptionSheet v-model:open="sheetOpen" :product="product" :skus="sheetSkus" />
</template>
