<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { API_BASE_URL, getPartnerHeaders } from '../config'

const products = ref<any[]>([])
const loading = ref(true)
const toast = ref('')

const showCreateModal = ref(false)
const showEditModal = ref(false)
const uploadingImage = ref(false)
const uploadingDetailImage = ref(false)

// Starting outline only. Every line must be written by the seller; the platform makes no quality, authenticity or
// compensation promise on the seller's behalf.
const defaultDescriptionTemplate = `<div class="product-detail-body space-y-4">
  <h3>상품 특징</h3>
  <p>[판매자 작성] 상품의 주요 특징과 사양을 적어 주세요.</p>
  <h3>구성 및 규격</h3>
  <p>[판매자 작성] 구성품, 크기, 무게, 소재를 적어 주세요.</p>
  <h3>주의사항</h3>
  <p>[판매자 작성] 사용·보관 시 주의사항을 적어 주세요.</p>
</div>`

// The form starts empty: every commercial fact (brand, prices, stock, image,
// origin, package) must be entered by the seller. Nothing ships pre-filled.
const newProd = ref({
  title: '',
  brand: '',
  category_id: '',
  original_price: null as number | null,
  sale_price: null as number | null,
  supply_price: null as number | null,
  custody_type: 'SEMI_MANAGED',
  stock_quantity: null as number | null,
  hs_code: '',
  country_origin: '',
  warehouse_location: '',
  package_length_cm: null as number | null,
  package_width_cm: null as number | null,
  package_height_cm: null as number | null,
  package_weight_kg: null as number | null,
  thumbnail_url: '',
  description_html: defaultDescriptionTemplate
})

const editingProd = ref<any>(null)

const handleFileUpload = async (event: Event, isEdit = false) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  uploadingImage.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', 'products')

    const res = await fetch(`${API_BASE_URL}/api/v1/storage/upload`, {
      method: 'POST',
      body: formData
    })
    const json = await res.json()
    if (json.success && json.data?.public_url) {
      if (isEdit && editingProd.value) {
        editingProd.value.thumbnail_url = json.data.public_url
      } else {
        newProd.value.thumbnail_url = json.data.public_url
      }
      toast.value = '✓ 썸네일 이미지가 R2 클라우드 스토리지에 성공적으로 업로드되었습니다.'
      setTimeout(() => { toast.value = '' }, 3000)
    }
  } catch (e) {
    console.error('File upload error:', e)
  } finally {
    uploadingImage.value = false
  }
}

const handleDetailImageUpload = async (event: Event, isEdit = false) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  uploadingDetailImage.value = true
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('folder', 'details')

    const res = await fetch(`${API_BASE_URL}/api/v1/storage/upload`, {
      method: 'POST',
      body: formData
    })
    const json = await res.json()
    if (json.success && json.data?.public_url) {
      const imgTag = `\n<div class="my-4 text-center"><img src="${json.data.public_url}" alt="상품 상세 이미지" class="w-full max-w-2xl mx-auto rounded-xl shadow-sm border border-gray-100" /></div>\n`
      if (isEdit && editingProd.value) {
        editingProd.value.description_html = (editingProd.value.description_html || '') + imgTag
      } else {
        newProd.value.description_html = (newProd.value.description_html || '') + imgTag
      }
      toast.value = '✓ 상세페이지 본문에 고화질 이미지가 추가 삽입되었습니다.'
      setTimeout(() => { toast.value = '' }, 3000)
    }
  } catch (e) {
    console.error('Detail image upload error:', e)
  } finally {
    uploadingDetailImage.value = false
  }
}

const volumetricWeightKg = computed(() => {
  const l = Number(newProd.value.package_length_cm) || 0
  const w = Number(newProd.value.package_width_cm) || 0
  const h = Number(newProd.value.package_height_cm) || 0
  return Math.round(((l * w * h) / 5000) * 100) / 100
})

const chargeableWeightKg = computed(() => {
  return Math.max(Number(newProd.value.package_weight_kg) || 0, volumetricWeightKg.value)
})

const loadProducts = async () => {
  loading.value = true
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products`, {
      headers: getPartnerHeaders()
    })
    const json = await res.json()
    // Only this seller's own products. (Previously an empty list fell back to the public catalogue — other
    // sellers' products shown as the seller's own with a made-up stock of 100.)
    products.value = json.success && Array.isArray(json.data)
      ? json.data.map((p: any) => ({ ...p, editPrice: p.sale_price ?? p.lowest_sale_price ?? 0, editStock: p.stock_quantity ?? 0 }))
      : []
    if (!res.ok || !json.success) toast.value = `상품 목록을 불러오지 못했습니다. ${json.error || ''}`
  } catch (e) {
    console.error(e)
    products.value = []
    toast.value = '상품 목록을 불러오지 못했습니다. (네트워크 오류)'
  } finally {
    loading.value = false
  }
}

const saveProductChanges = async (p: any) => {
  // Report what the server actually accepted; never show "수정 완료" for a rejected request.
  const send = async (url: string, body: any) => {
    const res = await fetch(url, { method: 'PUT', headers: getPartnerHeaders(), body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    return res.ok && json.success !== false ? null : (json.error || `요청 실패 (${res.status})`)
  }
  try {
    const [priceErr, stockErr] = await Promise.all([
      send(`${API_BASE_URL}/api/v1/partner/products/${p.id}/price`, { sale_price: Number(p.editPrice), original_price: Number(p.lowest_original_price) }),
      send(`${API_BASE_URL}/api/v1/partner/products/${p.id}/stock`, { stock_quantity: Number(p.editStock) })
    ])
    toast.value = !priceErr && !stockErr
      ? `✓ "${p.title}" 가격(₩${Number(p.editPrice).toLocaleString()}) 및 재고(${p.editStock}) 저장됨`
      : `저장 실패 — ${[priceErr && `가격: ${priceErr}`, stockErr && `재고: ${stockErr}`].filter(Boolean).join(' / ')}`
    setTimeout(() => { toast.value = '' }, 5000)
    if (!priceErr || !stockErr) await loadProducts()
  } catch (e: any) {
    toast.value = `저장 실패 — ${e?.message || '네트워크 오류'}`
  }
}

const createNewProduct = async () => {
  if (!newProd.value.title.trim()) {
    alert('상품명을 입력해 주세요.')
    return
  }
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products`, {
      method: 'POST',
      headers: getPartnerHeaders(),
      body: JSON.stringify({
        ...newProd.value,
        price: newProd.value.sale_price,
        description_html: newProd.value.description_html || defaultDescriptionTemplate
      })
    })
    const json = await res.json()
    if (json.success) {
      showCreateModal.value = false
      toast.value = `✓ 개별 상품 "${newProd.value.title}" 및 상세페이지 등록이 완료되었습니다.`
      newProd.value.title = ''
      newProd.value.description_html = defaultDescriptionTemplate
      await loadProducts()
    } else {
      alert(json.error || '상품 등록 실패')
    }
  } catch (e) {
    console.error(e)
  }
}

const openEditModal = (p: any) => {
  editingProd.value = {
    ...p,
    title: p.title,
    sale_price: p.editPrice ?? p.lowest_sale_price ?? null,
    original_price: p.lowest_original_price ?? null,
    supply_price: p.supply_price || 0,
    custody_type: p.custody_type || 'SEMI_MANAGED',
    stock_quantity: p.editStock ?? p.stock_quantity ?? 0,
    hs_code: p.hs_code || '',
    country_origin: p.country_origin || '',
    warehouse_location: p.warehouse_location || '',
    package_length_cm: p.package_length_cm ?? null,
    package_width_cm: p.package_width_cm ?? null,
    package_height_cm: p.package_height_cm ?? null,
    package_weight_kg: p.package_weight_kg ?? null,
    thumbnail_url: p.thumbnail_url,
    description_html: p.description_html || defaultDescriptionTemplate
  }
  showEditModal.value = true
}

const updateExistingProduct = async () => {
  if (!editingProd.value || !editingProd.value.id) return
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/partner/products/${editingProd.value.id}`, {
      method: 'PUT',
      headers: getPartnerHeaders(),
      body: JSON.stringify(editingProd.value)
    })
    const json = await res.json()
    if (json.success) {
      showEditModal.value = false
      toast.value = `✓ "${editingProd.value.title}" 상세페이지 및 상품 정보가 성공적으로 반영되었습니다.`
      setTimeout(() => { toast.value = '' }, 3500)
      await loadProducts()
    } else {
      alert(json.error || '상세페이지 업데이트 실패')
    }
  } catch (e) {
    console.error(e)
  }
}

const computeQualityScore = (p: any) => {
  if (!p) return 0
  let score = 0
  if (p.title && p.title.length >= 8) score += 20
  if (p.thumbnail_url && !p.thumbnail_url.includes('placeholder')) score += 20
  if (p.description_html && p.description_html.length >= 40) score += 25
  if ((p.sale_price || p.price || p.editPrice) > 0 && (p.stock_quantity || p.stock || p.editStock) > 0) score += 15
  if (p.hs_code) score += 10
  if (p.country_origin) score += 10
  return Math.min(100, score)
}

onMounted(loadProducts)
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-xl font-black text-gray-900 flex items-center gap-2">
          <span>상품 관리 &amp; 상세페이지 에디터</span>
          <span class="px-2.5 py-0.5 rounded-full bg-orange-100 text-[#FF5000] text-xs font-black">개별 등록 지원</span>
        </h2>
        <p class="text-xs text-gray-500 mt-1">
          단건 개별 상품 등록, 상세페이지(HTML/이미지) 편집, 실시간 재고/가격 조정 및 관세청 HS 코드 관리
        </p>
      </div>
      <div class="flex items-center gap-3">
        <div v-if="toast" class="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold shadow-sm animate-fade-in">
          {{ toast }}
        </div>
        <button
          @click="showCreateModal = true"
          class="px-4 py-2.5 rounded-xl bg-[#FF5000] hover:bg-[#E04600] text-white text-xs font-black cursor-pointer shadow-sm flex items-center gap-1.5 transition active:scale-95"
        >
          <i class="fa-solid fa-plus text-xs"></i>
          <span>+ 개별 상품 등록 (단건 등록)</span>
        </button>
      </div>
    </div>

    <!-- 1. 신규 개별 상품 등록 모달 -->
    <div v-if="showCreateModal" class="bg-white rounded-2xl p-6 border-2 border-[#FF5000] shadow-xl space-y-5">
      <div class="flex items-center justify-between border-b pb-3">
        <div>
          <h3 class="text-sm font-black text-gray-900">신규 개별 상품 및 상세페이지 등록 (단건 등록)</h3>
          <p class="text-[11px] text-gray-500">기본 정보, 판매 가격, 물류 스펙 및 상세페이지 내용을 작성하여 카탈로그에 즉시 반영합니다.</p>
        </div>
        <button @click="showCreateModal = false" class="text-xs text-gray-400 hover:text-gray-700 cursor-pointer font-bold">닫기 ✕</button>
      </div>

      <!-- Listing Quality Score Meter -->
      <div class="flex flex-wrap items-center justify-between p-3 rounded-xl bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 text-xs">
        <div class="flex items-center gap-2">
          <span class="font-black text-gray-800">등록 품질 점수 (Quality Score):</span>
          <span class="font-black text-sm text-[#FF5000]">{{ computeQualityScore(newProd) }}/100점</span>
          <span v-if="computeQualityScore(newProd) >= 80" class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-black">
            ✓ A+ 리치 상세페이지 최적화
          </span>
          <span v-else class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
            보완 권장 (이미지/상세설명 40자 이상 입력 시 랭킹 가산)
          </span>
        </div>
        <span class="text-[11px] text-gray-500 font-medium">HS코드 + 대표이미지 + 고시정보 입력 완료 시 상품 상세 신뢰도 및 품질점수 가점</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div class="sm:col-span-2">
          <label class="block font-bold text-gray-700 mb-1">상품명 (Product Title) *</label>
          <input v-model="newProd.title" placeholder="예: [초경량 ANC] 프리미엄 무선 노이즈캔슬링 블루투스 헤드폰 Pro" class="w-full h-9 px-3 rounded-lg border border-gray-300 focus:border-[#FF5000] focus:outline-none" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">브랜드 (Brand)</label>
          <input v-model="newProd.brand" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">입점 운영 모델 (Custody Model)</label>
          <select v-model="newProd.custody_type" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white font-bold text-[#FF5000]">
            <option value="FULL_MANAGED">전탁 모델 (Fully Managed: 공장 도매 공급가 납품)</option>
            <option value="SEMI_MANAGED">반탁 모델 (Semi-Managed: 현지 창고 자체 직배송)</option>
          </select>
        </div>
        <div v-if="newProd.custody_type === 'FULL_MANAGED'">
          <label class="block font-bold text-gray-700 mb-1">공장 도매 공급가 (Supply Price KRW)</label>
          <input v-model.number="newProd.supply_price" type="number" placeholder="공장 출고 납품가" class="w-full h-9 px-3 rounded-lg border border-[#FF5000] bg-orange-50/50 font-bold" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">정상가 (Original Price KRW)</label>
          <input v-model.number="newProd.original_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">소비자 판매가 (Sale Price KRW) *</label>
          <input v-model.number="newProd.sale_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300 font-bold text-gray-900" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">초기 입고 재고 (Stock Quantity) *</label>
          <input v-model.number="newProd.stock_quantity" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300 font-bold" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">HS Code (관세 품목분류코드)</label>
          <select v-model="newProd.hs_code" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white font-mono">
            <option value="" disabled>선택해 주세요</option>
            <option value="6109.10">6109.10 (면 티셔츠/의류)</option>
            <option value="8517.13">8517.13 (스마트폰/무선통신)</option>
            <option value="8518.30">8518.30 (헤드폰/이어폰)</option>
            <option value="3304.99">3304.99 (기초화장품/스킨케어)</option>
            <option value="6404.11">6404.11 (스포츠화/운동화)</option>
            <option value="9503.00">9503.00 (완구/취미용품)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">원산지 / 제조국</label>
          <select v-model="newProd.country_origin" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white">
            <option value="" disabled>선택해 주세요</option>
            <option value="KR">🇰🇷 대한민국 (KR)</option>
            <option value="US">🇺🇸 미국 (US)</option>
            <option value="CN">🇨🇳 중국 (CN)</option>
            <option value="JP">🇯🇵 일본 (JP)</option>
            <option value="VN">🇻🇳 베트남 (VN)</option>
            <option value="DE">🇩🇪 독일 (DE)</option>
          </select>
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">출고 물류 거점</label>
          <select v-model="newProd.warehouse_location" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white">
            <option value="" disabled>선택해 주세요</option>
            <option value="INCHEON_FBO">인천 자유무역 보세창고 (FBO)</option>
            <option value="DOMESTIC_3PL">국내 3PL 당일출고 센터</option>
            <option value="OVERSEAS_WEIHAI">중국 위해(Weihai) 글로벌 허브</option>
            <option value="OVERSEAS_LA">미국 LA 항공특송 센터</option>
            <option value="OVERSEAS_TOKYO">일본 도쿄 풀필먼트 센터</option>
          </select>
        </div>
      </div>

      <!-- 썸네일 이미지 업로드 -->
      <div class="p-4 rounded-xl bg-orange-50/60 border border-orange-200 text-xs space-y-2">
        <label class="block font-bold text-gray-800">대표 썸네일 이미지 (Cloudflare R2 스토리지 업로드)</label>
        <div class="flex items-center gap-4">
          <img v-if="newProd.thumbnail_url" :src="newProd.thumbnail_url" class="w-16 h-16 rounded-xl object-cover bg-white border border-gray-200 shrink-0" />
          <div v-else class="w-16 h-16 rounded-xl bg-white border border-dashed border-gray-300 shrink-0 flex items-center justify-center text-gray-300 text-xl">🖼</div>
          <div class="space-y-1.5 flex-1">
            <input type="file" accept="image/*" @change="(e) => handleFileUpload(e, false)" class="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#FF5000] file:text-white file:cursor-pointer text-gray-600" />
            <div class="text-[11px] text-gray-500 font-mono truncate max-w-md">URL: {{ newProd.thumbnail_url }}</div>
          </div>
          <span v-if="uploadingImage" class="text-xs font-bold text-[#FF5000] animate-pulse">R2 업로드 중...</span>
        </div>
      </div>

      <!-- 상세페이지 본문 에디터 (Description HTML) -->
      <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span class="font-black text-gray-900 text-sm">상품 상세페이지 본문 내용 (Detail Page HTML)</span>
            <span class="text-gray-500 text-[11px] ml-2">구매자 스토어프론트 상세페이지의 [상세설명] 탭에 고화질로 렌더링됩니다.</span>
          </div>
          <div class="flex items-center gap-2">
            <label class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer transition">
              <i class="fa-solid fa-image mr-1"></i>상세 이미지 업로드
              <input type="file" accept="image/*" @change="(e) => handleDetailImageUpload(e, false)" class="hidden" />
            </label>
            <button
              type="button"
              @click="newProd.description_html = defaultDescriptionTemplate"
              class="px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 font-bold text-gray-700 cursor-pointer"
            >
              기본 서식 템플릿 삽입
            </button>
          </div>
        </div>

        <textarea
          v-model="newProd.description_html"
          rows="7"
          placeholder="상세페이지 HTML, 텍스트 및 이미지 태그를 자유롭게 입력하세요."
          class="w-full p-3 rounded-lg border border-gray-300 bg-white font-mono text-xs focus:border-[#FF5000] focus:outline-none"
        ></textarea>
        <span v-if="uploadingDetailImage" class="text-xs font-bold text-indigo-600 animate-pulse block">
          고화질 상세 이미지 R2 업로드 및 본문 자동 삽입 중...
        </span>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t">
        <button @click="showCreateModal = false" class="px-4 py-2 rounded-lg border border-gray-300 text-xs font-bold cursor-pointer">취소</button>
        <button @click="createNewProduct" class="px-6 py-2 rounded-lg bg-[#FF5000] hover:bg-[#E04600] text-white text-xs font-black cursor-pointer shadow-xs">
          개별 상품 등록 완료
        </button>
      </div>
    </div>

    <!-- 2. 기존 상품 상세페이지 편집 모달 -->
    <div v-if="showEditModal && editingProd" class="bg-white rounded-2xl p-6 border-2 border-indigo-600 shadow-2xl space-y-5">
      <div class="flex items-center justify-between border-b pb-3">
        <div>
          <h3 class="text-sm font-black text-gray-900 flex items-center gap-2">
            <span>상품 상세페이지 수정 및 콘텐츠 편집</span>
            <span class="text-xs font-mono text-indigo-600 font-bold">({{ editingProd.id }})</span>
          </h3>
          <p class="text-[11px] text-gray-500">스토어프론트에 노출되는 상품명, 가격, 대표 이미지 및 상세페이지 설명(HTML/이미지)을 수정합니다.</p>
        </div>
        <button @click="showEditModal = false" class="text-xs text-gray-400 hover:text-gray-700 cursor-pointer font-bold">닫기 ✕</button>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
        <div class="sm:col-span-2">
          <label class="block font-bold text-gray-700 mb-1">상품명 (Product Title)</label>
          <input v-model="editingProd.title" class="w-full h-9 px-3 rounded-lg border border-gray-300 focus:border-indigo-600 focus:outline-none" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">판매가 (KRW)</label>
          <input v-model.number="editingProd.sale_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300 font-bold text-gray-900" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">정상가 (KRW)</label>
          <input v-model.number="editingProd.original_price" type="number" class="w-full h-9 px-3 rounded-lg border border-gray-300" />
        </div>
        <div>
          <label class="block font-bold text-gray-700 mb-1">입점 운영 모델</label>
          <select v-model="editingProd.custody_type" class="w-full h-9 px-2.5 rounded-lg border border-gray-300 bg-white">
            <option value="FULL_MANAGED">전탁 모델 (Fully Managed)</option>
            <option value="SEMI_MANAGED">반탁 모델 (Semi-Managed)</option>
          </select>
        </div>
        <div v-if="editingProd.custody_type === 'FULL_MANAGED'">
          <label class="block font-bold text-gray-700 mb-1">공장 도매 공급가 (KRW)</label>
          <input v-model.number="editingProd.supply_price" type="number" class="w-full h-9 px-3 rounded-lg border border-indigo-400 bg-indigo-50/40 font-bold" />
        </div>
      </div>

      <!-- 썸네일 수정 -->
      <div class="p-3.5 rounded-xl bg-gray-50 border border-gray-200 text-xs space-y-2">
        <label class="block font-bold text-gray-800">대표 썸네일 이미지</label>
        <div class="flex items-center gap-4">
          <img :src="editingProd.thumbnail_url" class="w-14 h-14 rounded-xl object-cover bg-white border border-gray-200 shrink-0" />
          <div class="space-y-1.5 flex-1">
            <input type="file" accept="image/*" @change="(e) => handleFileUpload(e, true)" class="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-indigo-600 file:text-white file:cursor-pointer text-gray-600" />
            <div class="text-[11px] text-gray-500 font-mono truncate max-w-md">URL: {{ editingProd.thumbnail_url }}</div>
          </div>
          <span v-if="uploadingImage" class="text-xs font-bold text-indigo-600 animate-pulse">업로드 중...</span>
        </div>
      </div>

      <!-- 상세페이지 본문 편집기 -->
      <div class="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 text-xs space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span class="font-black text-indigo-950 text-sm">상세페이지 본문 에디터 (Description HTML)</span>
            <span class="text-gray-500 text-[11px] ml-2">고객 스토어프론트에 실시간 노출되는 상세 내용입니다.</span>
          </div>
          <div class="flex items-center gap-2">
            <label class="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer transition">
              <i class="fa-solid fa-cloud-arrow-up mr-1"></i>상세 이미지 추가
              <input type="file" accept="image/*" @change="(e) => handleDetailImageUpload(e, true)" class="hidden" />
            </label>
            <button
              type="button"
              @click="editingProd.description_html = defaultDescriptionTemplate"
              class="px-2.5 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 font-bold text-gray-700 cursor-pointer"
            >
              기본 서식 복원
            </button>
          </div>
        </div>

        <textarea
          v-model="editingProd.description_html"
          rows="8"
          class="w-full p-3 rounded-lg border border-indigo-300 bg-white font-mono text-xs focus:border-indigo-600 focus:outline-none"
        ></textarea>
        <span v-if="uploadingDetailImage" class="text-xs font-bold text-indigo-600 animate-pulse block">
          고화질 상세 이미지 R2 업로드 및 본문 자동 삽입 중...
        </span>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t">
        <button @click="showEditModal = false" class="px-4 py-2 rounded-lg border border-gray-300 text-xs font-bold cursor-pointer">취소</button>
        <button @click="updateExistingProduct" class="px-6 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black cursor-pointer shadow-xs">
          상세페이지 수정 저장
        </button>
      </div>
    </div>

    <!-- 상품 목록 테이블 -->
    <div class="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-2xs">
      <table class="w-full text-left border-collapse text-xs">
        <thead>
          <tr class="bg-gray-50 text-gray-500 border-b border-gray-200 uppercase">
            <th class="py-3.5 px-5 font-bold">상품 정보</th>
            <th class="py-3.5 px-5 font-bold">원산지 / HS코드</th>
            <th class="py-3.5 px-5 font-bold">물류거점 / 부피중량</th>
            <th class="py-3.5 px-5 font-bold text-center">품질점수</th>
            <th class="py-3.5 px-5 font-bold">판매가 (KRW)</th>
            <th class="py-3.5 px-5 font-bold">재고 (SKU)</th>
            <th class="py-3.5 px-5 font-bold text-center">상세페이지 &amp; 관리</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="p in products" :key="p.id + '_' + (p.sku_id || '')" class="hover:bg-gray-50/80 transition">
            <td class="py-3 px-5">
              <div class="flex items-center gap-3">
                <img :src="p.thumbnail_url" class="w-12 h-12 rounded-xl object-cover bg-gray-100 border border-gray-200 shrink-0" />
                <div class="min-w-0">
                  <div class="font-bold text-gray-900 line-clamp-1 max-w-xs">{{ p.title }}</div>
                  <div class="text-[10px] text-gray-400 font-mono mt-0.5">ID: {{ p.id }}</div>
                  <span v-if="p.custody_type === 'FULL_MANAGED'" class="inline-block mt-1 px-1.5 py-0.2 rounded bg-orange-100 text-[#FF5000] text-[9px] font-black">
                    전탁 풀필먼트
                  </span>
                </div>
              </div>
            </td>
            <td class="py-3 px-5">
              <span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-mono font-bold text-[10px] mr-1">
                {{ p.country_origin || 'KR' }}
              </span>
              <span class="font-mono text-gray-600 text-[11px]">HS:{{ p.hs_code || '6109.10' }}</span>
            </td>
            <td class="py-3 px-5">
              <div class="font-semibold text-gray-700 text-[11px]">{{ p.warehouse_location || 'INCHEON_FBO' }}</div>
              <div class="text-[10px] text-gray-400">Vol: {{ p.volumetric_weight_kg ?? '-' }}kg</div>
            </td>
            <td class="py-3 px-5 text-center">
              <span class="px-2 py-0.5 rounded font-black text-[11px] inline-block" :class="(p.quality_score ?? computeQualityScore(p)) >= 80 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'">
                ★ {{ p.quality_score ?? computeQualityScore(p) }}점
              </span>
            </td>
            <td class="py-3 px-5">
              <input v-model.number="p.editPrice" type="number" class="w-28 h-8 px-2.5 rounded border border-gray-300 font-bold text-gray-900 focus:border-[#FF5000]" />
            </td>
            <td class="py-3 px-5">
              <input v-model.number="p.editStock" type="number" class="w-20 h-8 px-2.5 rounded border border-gray-300 font-bold text-gray-900 focus:border-[#FF5000]" />
            </td>
            <td class="py-3 px-5">
              <div class="flex items-center justify-center gap-2">
                <!-- 1. 스토어프론트 상세페이지 바로가기 미리보기 버튼 -->
                <a
                  :href="'https://openmarket.dnjstjqppk.workers.dev/products/' + p.id"
                  target="_blank"
                  rel="noopener"
                  class="px-2.5 py-1.5 rounded-lg border border-gray-300 hover:border-[#FF5000] text-gray-700 hover:text-[#FF5000] font-bold text-[11px] flex items-center gap-1 transition"
                  title="구매자 스토어프론트 상세페이지 새 창으로 열기"
                >
                  <span>미리보기</span>
                  <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>
                <!-- 2. 상세페이지 편집 모달 열기 버튼 -->
                <button
                  @click="openEditModal(p)"
                  class="px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white font-bold text-[11px] flex items-center gap-1 transition cursor-pointer"
                  title="상세페이지 설명(HTML), 이미지 및 상품 정보 편집"
                >
                  <i class="fa-solid fa-pen-to-square text-[10px]"></i>
                  <span>상세 편집</span>
                </button>
                <!-- 3. 빠른 가격/재고 적용 버튼 -->
                <button
                  @click="saveProductChanges(p)"
                  class="px-2.5 py-1.5 rounded-lg bg-gray-900 hover:bg-[#FF5000] text-white font-bold text-[11px] transition-colors cursor-pointer"
                  title="가격 및 재고 변경사항 즉시 적용"
                >
                  적용
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
