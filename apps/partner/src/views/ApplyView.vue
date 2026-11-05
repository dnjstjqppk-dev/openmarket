<script setup lang="ts">
// 입점 신청서 (O05). 제출 후 서류 업로드·심사 요청은 /application 에서 진행한다.
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { API_BASE_URL, savePartnerSession } from '../config'

const router = useRouter()
const BANKS = [
  ['004', 'KB국민은행'], ['088', '신한은행'], ['020', '우리은행'], ['081', '하나은행'], ['011', 'NH농협은행'], ['003', 'IBK기업은행'],
  ['090', '카카오뱅크'], ['092', '토스뱅크'], ['089', '케이뱅크'], ['023', 'SC제일은행'], ['071', '우체국'], ['031', 'iM뱅크(대구)'], ['032', '부산은행']
]
const f = reactive({
  email: '', password: '', password2: '', contact_name: '', phone: '',
  business_name: '', representative_name: '', business_reg_number: '', mail_order_reg_number: '', mail_order_exempt: false, mail_order_exempt_reason: '',
  bank_code: '004', bank_account_number: '', bank_account_holder: '', customer_service_phone: '', return_shipping_address: '',
  agree_seller_terms: false, agree_privacy: false
})
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  if (f.password !== f.password2) { error.value = '비밀번호 확인이 일치하지 않습니다.'; return }
  loading.value = true
  try {
    const body: any = { ...f }
    delete body.password2
    delete body.mail_order_exempt
    if (f.mail_order_exempt) body.mail_order_reg_number = ''
    else body.mail_order_exempt_reason = ''
    const res = await fetch(`${API_BASE_URL}/api/v1/partner-applications`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.success) { error.value = json.error || '신청서를 저장하지 못했습니다.'; return }
    savePartnerSession(json.data.token, json.data.partner)
    router.replace('/application')
  } catch {
    error.value = '서버에 연결할 수 없습니다.'
  } finally {
    loading.value = false
  }
}
const input = 'w-full h-11 px-3.5 rounded-xl border border-gray-300 focus:outline-none focus:border-[#FF5000]'
</script>

<template>
  <div class="min-h-screen bg-slate-100 py-8 px-4">
    <form class="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm p-6 sm:p-8 space-y-6 text-xs" data-testid="apply-form" @submit.prevent="submit">
      <div>
        <h1 class="text-xl font-black text-gray-900">OLMOA 입점 신청</h1>
        <p class="text-gray-500 mt-1">신청서를 저장한 뒤 사업자등록증·통신판매업 신고증·정산 통장 사본을 올리고 심사를 요청합니다. 심사가 끝나기 전에는 상품을 등록할 수 없습니다.</p>
      </div>

      <fieldset class="space-y-3">
        <legend class="font-black text-sm text-gray-900 mb-1">로그인 계정 · 담당자</legend>
        <div class="grid sm:grid-cols-2 gap-3">
          <label class="block"><span class="font-bold text-gray-700">이메일</span><input v-model="f.email" type="email" autocomplete="username" required :class="input" /></label>
          <label class="block"><span class="font-bold text-gray-700">담당자명</span><input v-model="f.contact_name" required :class="input" /></label>
          <label class="block"><span class="font-bold text-gray-700">비밀번호</span><input v-model="f.password" type="password" autocomplete="new-password" required :class="input" /></label>
          <label class="block"><span class="font-bold text-gray-700">비밀번호 확인</span><input v-model="f.password2" type="password" autocomplete="new-password" required :class="input" /></label>
          <label class="block sm:col-span-2"><span class="font-bold text-gray-700">담당자 연락처</span><input v-model="f.phone" placeholder="010-0000-0000" required :class="input" /></label>
        </div>
        <p class="text-gray-400">비밀번호: 10자 이상, 영문 대/소문자·숫자·특수문자 중 3종류 이상</p>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="font-black text-sm text-gray-900 mb-1">사업자 정보 (사업자등록증과 같게)</legend>
        <div class="grid sm:grid-cols-2 gap-3">
          <label class="block"><span class="font-bold text-gray-700">상호</span><input v-model="f.business_name" required :class="input" /></label>
          <label class="block"><span class="font-bold text-gray-700">대표자명</span><input v-model="f.representative_name" required :class="input" /></label>
          <label class="block sm:col-span-2"><span class="font-bold text-gray-700">사업자등록번호</span><input v-model="f.business_reg_number" inputmode="numeric" placeholder="000-00-00000" required :class="input" /></label>
        </div>
        <label class="flex items-center gap-2"><input v-model="f.mail_order_exempt" type="checkbox" /> 통신판매업 신고 면제 대상입니다</label>
        <label v-if="!f.mail_order_exempt" class="block"><span class="font-bold text-gray-700">통신판매업 신고번호</span><input v-model="f.mail_order_reg_number" placeholder="제2026-서울강남-0000호" required :class="input" /></label>
        <label v-else class="block"><span class="font-bold text-gray-700">면제 사유</span><input v-model="f.mail_order_exempt_reason" placeholder="예: 간이과세자 (직전 연도 거래 50회 미만)" required :class="input" /></label>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class="font-black text-sm text-gray-900 mb-1">정산 계좌 · 고객 응대</legend>
        <div class="grid sm:grid-cols-3 gap-3">
          <label class="block"><span class="font-bold text-gray-700">은행</span>
            <select v-model="f.bank_code" :class="input"><option v-for="b in BANKS" :key="b[0]" :value="b[0]">{{ b[1] }}</option></select></label>
          <label class="block"><span class="font-bold text-gray-700">계좌번호</span><input v-model="f.bank_account_number" inputmode="numeric" required :class="input" /></label>
          <label class="block"><span class="font-bold text-gray-700">예금주</span><input v-model="f.bank_account_holder" required :class="input" /></label>
          <label class="block"><span class="font-bold text-gray-700">고객센터 번호</span><input v-model="f.customer_service_phone" required :class="input" /></label>
          <label class="block sm:col-span-2"><span class="font-bold text-gray-700">반품 받을 주소</span><input v-model="f.return_shipping_address" required :class="input" /></label>
        </div>
        <p class="text-gray-400">정산 계좌는 심사 후 운영자가 예금주 실명을 확인해야 지급이 시작됩니다. 수수료율은 심사 결과로 안내됩니다.</p>
      </fieldset>

      <fieldset class="space-y-2">
        <label class="flex items-start gap-2"><input v-model="f.agree_seller_terms" type="checkbox" class="mt-0.5" /><span>(필수) 판매자 이용약관에 동의합니다. <span class="text-amber-700">※ 약관은 법률 검토 전 초안입니다.</span></span></label>
        <label class="flex items-start gap-2"><input v-model="f.agree_privacy" type="checkbox" class="mt-0.5" /><span>(필수) 입점 심사·정산을 위한 개인정보(담당자 이름·연락처·이메일, 대표자명, 정산 계좌) 수집·이용에 동의합니다. 신분증 사본은 받지 않습니다.</span></label>
      </fieldset>

      <p v-if="error" role="alert" class="p-3 rounded-xl bg-red-50 text-red-700 font-bold">{{ error }}</p>
      <div class="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between sm:items-center">
        <router-link to="/login" class="text-gray-500 underline text-center">이미 계정이 있어요 · 로그인</router-link>
        <button type="submit" :disabled="loading || !f.agree_seller_terms || !f.agree_privacy" class="h-12 px-6 rounded-xl bg-[#FF5000] text-white font-black text-sm disabled:opacity-40">
          {{ loading ? '저장 중...' : '신청서 저장하고 서류 올리기' }}
        </button>
      </div>
    </form>
  </div>
</template>
