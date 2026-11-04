<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { API_BASE_URL } from '../config';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const fullName = ref('');
const email = ref('');
const password = ref('');
const phone = ref('');
// Consent must be an explicit, unbundled opt-in (개인정보 보호법): never pre-checked.
const agreeTerms = ref(false);
const agreePrivacy = ref(false);
const agreeAge = ref(false);
const success = ref(false);
const welcomeCredit = ref(0);
const error = ref('');
const loading = ref(false);

const pwChecks = computed(() => {
  const pw = password.value;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  return { length: pw.length >= 10, classes: classes >= 3 };
});

async function handleRegister() {
  error.value = '';
  if (!agreeTerms.value || !agreePrivacy.value || !agreeAge.value) {
    error.value = '필수 동의 항목에 모두 동의해 주세요.';
    return;
  }
  if (!pwChecks.value.length || !pwChecks.value.classes) {
    error.value = '비밀번호는 10자 이상, 영문 대/소문자·숫자·특수문자 중 3종류 이상이어야 합니다.';
    return;
  }
  loading.value = true;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value, password: password.value, full_name: fullName.value, phone: phone.value,
        agree_terms: agreeTerms.value, agree_privacy: agreePrivacy.value
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      error.value = data.error || '회원가입을 완료하지 못했습니다.';
      return;
    }
    auth.login({ id: data.user.id, name: data.user.full_name, email: data.user.email }, data.token);
    welcomeCredit.value = data.welcome_credit || 0;
    success.value = true;
    setTimeout(() => router.push('/'), 1500);
  } catch {
    error.value = '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-md mx-auto py-8 px-4">
    <div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl space-y-6">
      <div class="text-center space-y-2">
        <router-link to="/" class="inline-flex items-center gap-1.5 justify-center mb-1">
          <img src="/olmoa-symbol.svg" alt="OLMOA" class="w-10 h-10 object-contain drop-shadow" />
          <span class="text-2xl font-black tracking-tight text-slate-900"><span class="text-orange-600">O</span>LMOA</span>
        </router-link>
        <h1 class="text-lg font-bold text-slate-900">신규 회원가입</h1>
        <p class="text-xs text-slate-500">가입 시 웰컴 적립금이 지급됩니다. (운영 정책에 따라 변경될 수 있습니다)</p>
      </div>

      <div v-if="success" role="status" class="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold text-center space-y-1">
        <div>회원가입이 완료되었습니다.</div>
        <p v-if="welcomeCredit > 0" class="text-[11px] font-normal">웰컴 적립금 {{ welcomeCredit.toLocaleString() }}원이 지급되었습니다.</p>
      </div>

      <form v-else @submit.prevent="handleRegister" class="space-y-4 text-xs" novalidate>
        <div>
          <label for="reg-name" class="block font-bold text-slate-700 mb-1">이름</label>
          <input id="reg-name" v-model="fullName" type="text" autocomplete="name" placeholder="홍길동" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label for="reg-email" class="block font-bold text-slate-700 mb-1">이메일 주소</label>
          <input id="reg-email" v-model="email" type="email" autocomplete="email" placeholder="example@olmoa.com" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <div>
          <label for="reg-pw" class="block font-bold text-slate-700 mb-1">비밀번호</label>
          <input id="reg-pw" v-model="password" type="password" autocomplete="new-password" placeholder="10자 이상" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <ul class="mt-1.5 space-y-0.5 text-[11px]">
            <li :class="pwChecks.length ? 'text-emerald-600' : 'text-slate-400'">{{ pwChecks.length ? '✓' : '•' }} 10자 이상</li>
            <li :class="pwChecks.classes ? 'text-emerald-600' : 'text-slate-400'">{{ pwChecks.classes ? '✓' : '•' }} 영문 대/소문자·숫자·특수문자 중 3종류 이상</li>
          </ul>
        </div>
        <div>
          <label for="reg-phone" class="block font-bold text-slate-700 mb-1">휴대전화번호</label>
          <input id="reg-phone" v-model="phone" type="tel" autocomplete="tel" placeholder="010-0000-0000" required class="w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>

        <fieldset class="space-y-2 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
          <legend class="sr-only">약관 동의</legend>
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" v-model="agreeAge" class="mt-0.5 rounded text-orange-600 focus:ring-orange-500" />
            <span>[필수] 만 14세 이상입니다.</span>
          </label>
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" v-model="agreeTerms" class="mt-0.5 rounded text-orange-600 focus:ring-orange-500" />
            <span>[필수] <router-link to="/legal/terms" class="underline text-orange-600">이용약관</router-link>에 동의합니다.</span>
          </label>
          <label class="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" v-model="agreePrivacy" class="mt-0.5 rounded text-orange-600 focus:ring-orange-500" />
            <span>[필수] <router-link to="/legal/privacy" class="underline text-orange-600">개인정보 수집·이용</router-link>에 동의합니다.</span>
          </label>
        </fieldset>

        <div v-if="error" role="alert" class="text-rose-600 font-semibold">{{ error }}</div>

        <button type="submit" :disabled="loading" class="w-full py-3.5 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-extrabold rounded-xl transition shadow-md shadow-orange-600/30">
          {{ loading ? '가입 처리 중...' : '회원가입' }}
        </button>
      </form>

      <div class="pt-3 border-t border-slate-100 text-center text-xs text-slate-500">
        이미 계정이 있으신가요? <router-link to="/login" class="font-bold text-orange-600 hover:underline">로그인하기</router-link>
      </div>
    </div>
  </div>
</template>
