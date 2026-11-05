<script setup lang="ts">
// 계정 보안 (O11): 내 2단계 인증 설정 + (최고관리자) 운영자 계정·권한 관리.
import { ref, reactive, computed, onMounted } from 'vue'
import { adminApi, setAdminToken, setAdminRole, ADMIN_ROLE_LABEL } from '../config'

const me = ref<any>(null)
const setup = ref<{ secret: string; otpauth_uri: string } | null>(null)
const code = ref('')
const recovery = ref<string[]>([])
const msg = ref('')
const err = ref('')
const operators = ref<any[]>([])
const form = reactive({ email: '', full_name: '', admin_role: 'CS', password: '' })
const isSuper = computed(() => me.value?.admin?.role === 'SUPER_ADMIN')
const ROLES = Object.keys(ADMIN_ROLE_LABEL)
const groupedSecret = computed(() => (setup.value?.secret || '').replace(/(.{4})/g, '$1 ').trim())

async function load() {
  const r = await adminApi('/api/v1/auth/me')
  me.value = r.data.data
  setAdminRole(me.value?.admin?.role || '')
  if (me.value?.admin?.role === 'SUPER_ADMIN' && !me.value?.admin?.mfa_setup_required) {
    const o = await adminApi('/api/v1/admin/admin-users')
    operators.value = o.ok ? o.data.data : []
  }
}

async function startSetup() {
  err.value = ''
  const r = await adminApi('/api/v1/auth/2fa/setup', { method: 'POST', json: {} })
  if (!r.ok) { err.value = r.data.error; return }
  setup.value = r.data.data
}

async function enable() {
  err.value = ''
  const r = await adminApi('/api/v1/auth/2fa/enable', { method: 'POST', json: { code: code.value } })
  if (!r.ok) { err.value = r.data.error || '인증 코드가 올바르지 않습니다.'; return }
  setAdminToken(r.data.data.token)
  recovery.value = r.data.data.recovery_codes
  setup.value = null
  code.value = ''
  msg.value = r.data.message
  load()
}

async function createOperator() {
  err.value = ''
  const r = await adminApi('/api/v1/admin/admin-users', { method: 'POST', json: form })
  if (!r.ok) { err.value = r.data.error; return }
  msg.value = `${form.email} 계정을 만들었습니다. 첫 로그인 때 2단계 인증을 설정해야 합니다.`
  Object.assign(form, { email: '', full_name: '', admin_role: 'CS', password: '' })
  load()
}

async function updateOperator(o: any, patch: any, label: string) {
  if (!confirm(`${o.email}: ${label}. 해당 계정의 모든 세션이 종료됩니다.`)) return
  const r = await adminApi(`/api/v1/admin/admin-users/${o.id}`, { method: 'PUT', json: patch })
  if (!r.ok) { err.value = r.data.error; load(); return }
  msg.value = `${o.email}: ${label} 완료`
  load()
}
onMounted(load)
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-6 space-y-5 text-xs">
    <h1 class="text-xl font-black">계정 보안</h1>
    <p v-if="err" role="alert" class="p-3 rounded-lg bg-red-50 text-red-700 font-bold">{{ err }}</p>
    <p v-if="msg" role="status" class="p-3 rounded-lg bg-indigo-50 text-indigo-900 font-bold">{{ msg }}</p>

    <section v-if="me" class="bg-white rounded-xl border p-4 space-y-3" data-testid="mfa-section">
      <h2 class="font-black text-sm">내 계정 · 2단계 인증</h2>
      <p>{{ me.user.email }} · 권한 <b>{{ ADMIN_ROLE_LABEL[me.admin?.role] || me.admin?.role }}</b></p>
      <p v-if="me.admin?.mfa_setup_required" class="p-3 rounded-lg bg-amber-50 text-amber-900 font-bold">2단계 인증을 설정해야 관리자 기능을 쓸 수 있습니다.</p>
      <p v-if="me.admin?.mfa_enabled" class="text-emerald-700 font-bold">2단계 인증 사용 중. 재설정은 다른 최고관리자에게 요청하세요.</p>

      <template v-else>
        <button v-if="!setup" class="h-10 px-4 rounded-lg bg-slate-900 text-white font-bold" @click="startSetup">2단계 인증 설정 시작</button>
        <div v-else class="space-y-3">
          <ol class="list-decimal pl-5 space-y-1 text-slate-600">
            <li>휴대폰 인증 앱(Google Authenticator, Microsoft Authenticator 등)에서 '설정 키 입력'을 고릅니다.</li>
            <li>아래 키를 입력합니다 (시간 기준). 휴대폰에서 이 화면을 보고 있다면 <a :href="setup.otpauth_uri" class="underline text-indigo-700">인증 앱에서 바로 열기</a>.</li>
            <li>앱에 표시된 6자리 코드를 입력해 확인합니다.</li>
          </ol>
          <p class="font-mono text-base tracking-wider bg-slate-100 rounded-lg p-3 break-all select-all" data-testid="mfa-secret">{{ groupedSecret }}</p>
          <div class="flex gap-2">
            <input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6자리 코드" class="h-10 px-3 rounded-lg border w-36 font-mono tracking-widest" />
            <button class="h-10 px-4 rounded-lg bg-indigo-600 text-white font-bold disabled:opacity-40" :disabled="code.length !== 6" @click="enable">확인하고 켜기</button>
          </div>
        </div>
      </template>

      <div v-if="recovery.length" class="p-3 rounded-lg bg-amber-50 border border-amber-300 space-y-2" data-testid="recovery-codes">
        <p class="font-black text-amber-900">복구 코드 — 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요. 각 코드는 한 번만 쓸 수 있습니다.</p>
        <ul class="grid grid-cols-2 sm:grid-cols-5 gap-1 font-mono"><li v-for="c in recovery" :key="c" class="bg-white rounded px-2 py-1 text-center">{{ c }}</li></ul>
      </div>
    </section>

    <section v-if="isSuper && !me?.admin?.mfa_setup_required" class="bg-white rounded-xl border p-4 space-y-3">
      <h2 class="font-black text-sm">운영자 계정 · 권한 (최고관리자 전용)</h2>
      <p class="text-slate-500">재무: 지급·대사·환불 / 운영·MD: 상품·입점·발주·주문·마케팅 / 고객지원: 주문·클레임·환불·회원 조회 / 개인정보 보호책임: 접속기록·회원 조회. 권한 변경·비활성화·2단계 인증 초기화는 즉시 세션을 끊습니다.</p>
      <div class="overflow-x-auto"><table class="w-full min-w-[560px]">
        <thead class="text-slate-500"><tr><th class="text-left p-1">계정</th><th class="text-left p-1">권한</th><th class="text-left p-1">2단계</th><th class="text-left p-1">상태</th><th></th></tr></thead>
        <tbody><tr v-for="o in operators" :key="o.id" class="border-t">
          <td class="p-1">{{ o.email }}<div class="text-slate-400">{{ o.full_name }}</div></td>
          <td class="p-1"><select :value="o.admin_role" class="h-8 px-1 rounded border" :aria-label="`${o.email} 권한`" @change="updateOperator(o, { admin_role: ($event.target as HTMLSelectElement).value }, '권한 변경')">
            <option v-for="r in ROLES" :key="r" :value="r">{{ ADMIN_ROLE_LABEL[r] }}</option></select></td>
          <td class="p-1">{{ o.mfa_enabled ? '사용' : '미설정' }}</td>
          <td class="p-1">{{ o.is_active ? '활성' : '비활성' }}</td>
          <td class="p-1 text-right space-x-1 whitespace-nowrap">
            <button v-if="o.mfa_enabled" class="px-2 py-1 rounded border" @click="updateOperator(o, { reset_2fa: true }, '2단계 인증 초기화')">2단계 초기화</button>
            <button class="px-2 py-1 rounded border" @click="updateOperator(o, { is_active: !o.is_active }, o.is_active ? '비활성화' : '활성화')">{{ o.is_active ? '비활성화' : '활성화' }}</button>
          </td>
        </tr></tbody></table></div>

      <form class="grid sm:grid-cols-5 gap-2 items-end pt-3 border-t" @submit.prevent="createOperator">
        <label class="block sm:col-span-2"><span class="font-bold">이메일</span><input v-model="form.email" type="email" required class="w-full h-9 px-2 rounded border" /></label>
        <label class="block"><span class="font-bold">이름</span><input v-model="form.full_name" required class="w-full h-9 px-2 rounded border" /></label>
        <label class="block"><span class="font-bold">권한</span><select v-model="form.admin_role" class="w-full h-9 px-1 rounded border"><option v-for="r in ROLES" :key="r" :value="r">{{ ADMIN_ROLE_LABEL[r] }}</option></select></label>
        <label class="block"><span class="font-bold">임시 비밀번호</span><input v-model="form.password" type="password" autocomplete="new-password" required class="w-full h-9 px-2 rounded border" /></label>
        <button class="sm:col-span-5 h-10 rounded-lg bg-slate-900 text-white font-bold">운영자 계정 만들기</button>
      </form>
    </section>
  </div>
</template>
