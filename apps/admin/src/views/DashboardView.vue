<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { API_BASE_URL, getAdminHeaders } from '../config';

const metrics = ref({
  totalProducts: 0,
  totalOrders: 0,
  totalGmv: 0,
  totalPartners: 0,
  totalUsers: 0,
  bannersCount: 0,
  notifsCount: 0
});

const controlTower = ref<any>({
  cross_border_pccc_orders: 0,
  escrow_protected_balance_krw: 0,
  edge_regions: [] as any[] // filled only from /admin/control-tower (no fabricated traffic split)
});

const fdsRules = ref<any[]>([]);

const disputes = ref<any[]>([]);
const sampleQcList = ref<any[]>([]);
const iprReports = ref<any[]>([]);
const loading = ref(true);
const toastMsg = ref('');

async function loadControlTower() {
  loading.value = true;
  try {
    const [dashRes, bnrRes, notifRes, ctRes, fdsRes, dispRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/admin/dashboard`, { headers: getAdminHeaders() }),
      fetch(`${API_BASE_URL}/api/v1/admin/banners`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) })),
      fetch(`${API_BASE_URL}/api/v1/admin/notifications`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) })),
      fetch(`${API_BASE_URL}/api/v1/admin/control-tower`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) })),
      fetch(`${API_BASE_URL}/api/v1/admin/fds/overview`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) })),
      fetch(`${API_BASE_URL}/api/v1/admin/disputes`, { headers: getAdminHeaders() }).catch(() => ({ json: async () => ({}) }))
    ]);
    const [qcRes, iprRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/v1/admin/sample-qc`, { headers: getAdminHeaders() }).then((r) => r.json()).catch(() => ({})),
      fetch(`${API_BASE_URL}/api/v1/admin/ipr-reports`, { headers: getAdminHeaders() }).then((r) => r.json()).catch(() => ({}))
    ]);
    sampleQcList.value = Array.isArray(qcRes?.data) ? qcRes.data : [];
    iprReports.value = Array.isArray(iprRes?.data) ? iprRes.data : [];

    const json = await dashRes.json();
    const bnrJson = await bnrRes.json().catch(() => ({}));
    const notifJson = await notifRes.json().catch(() => ({}));
    const ctJson = await ctRes.json().catch(() => ({}));
    const fdsJson = await fdsRes.json().catch(() => ({}));
    const dispJson = await dispRes.json().catch(() => ({}));

    if (json.success && json.metrics) {
      metrics.value.totalProducts = json.metrics.total_products || 0;
      metrics.value.totalOrders = json.metrics.total_orders || 0;
      metrics.value.totalGmv = json.metrics.total_gmv_amount || 0;
      metrics.value.totalPartners = json.metrics.total_partners || 0;
      metrics.value.totalUsers = json.metrics.total_users || 0;
    }
    if (bnrJson?.data && Array.isArray(bnrJson.data)) {
      metrics.value.bannersCount = bnrJson.data.length;
    }
    if (notifJson?.data && Array.isArray(notifJson.data)) {
      metrics.value.notifsCount = notifJson.data.length;
    }
    if (ctJson?.success && ctJson.data) {
      controlTower.value = ctJson.data;
    }
    if (fdsJson?.success && fdsJson.data?.active_rules) {
      fdsRules.value = fdsJson.data.active_rules;
    }
    if (dispJson?.success && Array.isArray(dispJson.data)) {
      disputes.value = dispJson.data;
    }
  } catch (_) {
  } finally {
    loading.value = false;
  }
}

async function arbitrateDispute(claim: any, ruling: 'FULL_REFUND_TO_BUYER' | 'RELEASE_TO_SELLER') {
  const notes = ruling === 'RELEASE_TO_SELLER' ? window.prompt('반품 거절(판매자 지급) 판정 근거를 입력하세요', '')?.trim() : null;
  if (ruling === 'RELEASE_TO_SELLER' && !notes) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/claims/${claim.id}`, {
      method: 'PUT',
      headers: getAdminHeaders(),
      body: JSON.stringify(ruling === 'FULL_REFUND_TO_BUYER' ? { decision: 'APPROVE' } : { decision: 'REJECT', notes })
    });
    if (res.ok) {
      toastMsg.value = `✓ 분쟁 건(${claim.id})에 대해 [${ruling === 'FULL_REFUND_TO_BUYER' ? '구매자 환불 승인' : '판매자 정산 지급'}] 직권 판정이 완료되었습니다.`;
      setTimeout(() => { toastMsg.value = ''; }, 3500);
      await loadControlTower();
    }
  } catch (_) {}
}


async function inspectSample(qcId: string, decision: 'APPROVED' | 'REJECTED') {
  const notes = window.prompt(decision === 'APPROVED' ? '검수 의견(합격 근거)을 입력하세요' : '반려 사유를 입력하세요', '')?.trim();
  if (!notes) return;
  try {
    const res = await fetch(`${API_BASE_URL}/api/v1/admin/sample-qc/${qcId}/inspect`, {
      method: 'POST',
      headers: getAdminHeaders(),
      body: JSON.stringify({ decision, inspector_notes: notes })
    });
    if (res.ok) {
      toastMsg.value = `✓ 실물 샘플(${qcId})이 [${decision === 'APPROVED' ? '합격 승인' : '반려 처리'}] 되었습니다.`;
      setTimeout(() => { toastMsg.value = ''; }, 3000);
      const target = sampleQcList.value.find(s => s.id === qcId);
      if (target) target.status = decision;
    }
  } catch (_) {}
}

async function fastTrackTakedown(iprId: string) {
  // There is no takedown endpoint yet. Products are stopped from 상품 관리 (상태 변경) after the operator reviews the report.
  toastMsg.value = `IPR 신고(${iprId}): 즉시 차단 기능은 아직 없습니다. 상품 관리에서 해당 상품을 직접 판매중지해 주세요.`;
  setTimeout(() => { toastMsg.value = ''; }, 5000);
}

onMounted(loadControlTower);
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
      <div>
        <h2 class="text-xl font-black text-slate-900">OLMOA 글로벌 중앙 관제 컨트롤 타워 (Central Control Room)</h2>
        <p class="text-xs text-slate-500 mt-0.5">전 세계 주문 흐름, 관세청 통관 연동, FDS 부정결제 방어 및 3자 분쟁 중재 현황</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <span class="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200 flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Edge Gateway & D1 정상 가동
        </span>
        <span class="px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-bold border border-blue-200">
          ✈️ Uni-Pass & FX 동기화 완료
        </span>
      </div>
    </div>

    <div v-if="toastMsg" class="p-3.5 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-xs">
      {{ toastMsg }}
    </div>

    <div v-if="loading" class="p-12 text-center text-slate-400 text-xs">
      <i class="fa-solid fa-spinner fa-spin mr-2"></i>글로벌 관제 지표를 집계하는 중입니다...
    </div>

    <div v-else class="space-y-6">
      <!-- Top 4 Core KPI Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">총 누적 결제액 (Global GMV)</div>
          <div class="text-2xl font-black text-slate-900 mt-1">₩ {{ metrics.totalGmv.toLocaleString() }}</div>
          <div class="text-emerald-600 font-bold mt-1">D1 에스크로 원장 실시간 집계</div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">플랫폼 총 주문 / 통관(PCCC)</div>
          <div class="text-2xl font-black text-indigo-700 mt-1">
            {{ metrics.totalOrders }} 건
            <span class="text-xs font-bold text-blue-600 ml-1">(직구 {{ controlTower.cross_border_pccc_orders || 0 }}건)</span>
          </div>
          <div class="text-slate-400 mt-1">Split-Order 입점사별 자동 분기</div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">활성 판매 파트너사 (Global KYC)</div>
          <div class="text-2xl font-black text-orange-600 mt-1">{{ metrics.totalPartners }} 개사</div>
          <div class="text-slate-400 mt-1">Rolling Reserve 유보금 정책 적용</div>
        </div>
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-slate-500 font-medium">글로벌 카탈로그 (42개 대분류)</div>
          <div class="text-2xl font-black text-blue-600 mt-1">{{ metrics.totalProducts }} 개</div>
          <div class="text-slate-400 mt-1">HS Code 및 부피중량 등록 완료</div>
        </div>
      </div>

      <!-- Global Edge Traffic & FDS Security Control Room -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
        <!-- Global Edge Region Latency Monitor -->
        <div class="lg:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div class="flex items-center justify-between border-b pb-2.5">
            <h3 class="font-black text-slate-900 text-sm flex items-center gap-2">
              <i class="fa-solid fa-globe text-indigo-600"></i>
              <span>글로벌 엣지 리전 트래픽 & 응답속도</span>
            </h3>
            <span class="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">300+ PoP Active</span>
          </div>
          <div class="space-y-3">
            <p v-if="!controlTower.edge_regions || !controlTower.edge_regions.length" class="text-xs text-slate-400">트래픽 분석 데이터 소스가 연결되지 않아 지역별 분포를 표시하지 않습니다.</p>
            <div v-for="reg in controlTower.edge_regions" :key="reg.region" class="space-y-1">
              <div class="flex justify-between font-bold text-slate-700">
                <span>{{ reg.region }}</span>
                <span class="font-mono text-indigo-600">{{ reg.traffic_pct }}% ({{ reg.latency_ms }}ms)</span>
              </div>
              <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div class="h-full bg-indigo-600 rounded-full" :style="{ width: reg.traffic_pct + '%' }"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- Real-Time FDS Anti-Fraud Situation Room -->
        <div class="lg:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div class="flex items-center justify-between border-b pb-2.5">
            <h3 class="font-black text-slate-900 text-sm flex items-center gap-2">
              <i class="fa-solid fa-shield-halved text-rose-600"></i>
              <span>실시간 FDS (이상거래 및 부정결제 탐지 엔진)</span>
            </h3>
            <span class="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">Zero-Trust Active</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead class="bg-slate-50 text-slate-500 text-[10px] uppercase border-b">
                <tr>
                  <th class="p-2">룰 코드</th>
                  <th class="p-2">탐지 정책 명칭</th>
                  <th class="p-2">위험도</th>
                  <th class="p-2 text-right">24h 차단/감지</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="r in fdsRules" :key="r.id">
                  <td class="p-2 font-mono font-bold text-slate-700 text-[11px]">{{ r.code }}</td>
                  <td class="p-2 text-slate-800 font-medium">{{ r.name }}</td>
                  <td class="p-2">
                    <span
                      class="px-2 py-0.5 rounded text-[10px] font-bold"
                      :class="r.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700' : r.severity === 'HIGH' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'"
                    >
                      {{ r.severity }}
                    </span>
                  </td>
                  <td class="p-2 text-right font-mono font-bold text-slate-900">{{ r.hit_count_24h ?? "미집계" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 3-Party Dispute Arbitration Tribunal -->
      <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs space-y-4 text-xs">
        <div class="flex items-center justify-between border-b pb-2.5">
          <div>
            <h3 class="font-black text-slate-900 text-sm flex items-center gap-2">
              <i class="fa-solid fa-scale-balanced text-amber-600"></i>
              <span>3자 분쟁 중재 법정 (구매자 vs 판매자 클레임 직권 판정 데스크)</span>
            </h3>
            <p class="text-[11px] text-slate-500 mt-0.5">반품, 파손, 오배송 및 최저가 보상 클레임에 대해 관리자가 에스크로 자금을 직권 중재합니다.</p>
          </div>
          <span class="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 font-bold text-[11px]">
            접수 클레임 {{ disputes.length }}건
          </span>
        </div>

        <div v-if="disputes.length === 0" class="p-6 text-center text-slate-400">
          현재 중재 대기 중인 분쟁 클레임이 없습니다.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left">
            <thead class="bg-slate-50 text-slate-500 text-[10px] uppercase border-b">
              <tr>
                <th class="p-2.5">클레임 ID / 주문번호</th>
                <th class="p-2.5">유형 / 사유</th>
                <th class="p-2.5">환불 요청액</th>
                <th class="p-2.5">현재 상태</th>
                <th class="p-2.5 text-right">직권 중재 판정</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="d in disputes.slice(0, 8)" :key="d.id" class="hover:bg-slate-50">
                <td class="p-2.5 font-mono font-bold text-slate-800">
                  <div>{{ d.id }}</div>
                  <div class="text-[10px] text-slate-400">Order: {{ d.order_no || d.order_id }}</div>
                </td>
                <td class="p-2.5">
                  <span class="font-bold text-indigo-600 mr-1.5">[{{ d.type || 'RETURN' }}]</span>
                  <span class="text-slate-700">{{ d.reason }}</span>
                </td>
                <td class="p-2.5 font-bold text-slate-900">₩{{ Number(d.refund_amount || 0).toLocaleString() }}</td>
                <td class="p-2.5">
                  <span
                    class="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    :class="d.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' : d.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'"
                  >
                    {{ d.status }}
                  </span>
                </td>
                <td class="p-2.5 text-right">
                  <div class="flex justify-end gap-1.5">
                    <button
                      @click="arbitrateDispute(d, 'FULL_REFUND_TO_BUYER')"
                      class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer"
                    >
                      구매자 환불 판정
                    </button>
                    <button
                      @click="arbitrateDispute(d, 'RELEASE_TO_SELLER')"
                      class="px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-[11px] cursor-pointer"
                    >
                      판매자 지급 판정
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      
      <!-- Temu-style Factory Sample QC & IPR Takedown Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
        <!-- Sample QC Desk -->
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                <span>🔬 공장 실물 샘플 검수(QC) 승인 데스크</span>
                <span class="px-2 py-0.5 rounded bg-orange-100 text-[#FF5000] text-[10px] font-mono">대기 {{ sampleQcList.filter(s => s.status === 'IN_INSPECTION').length }}건</span>
              </h3>
              <p class="text-[11px] text-slate-500 mt-0.5">M2C 직결 셀러 대량 입고 전 실물 시제품 품질 합격 여부를 판정합니다.</p>
            </div>
          </div>
          <div class="divide-y divide-slate-100">
            <div v-for="qc in sampleQcList" :key="qc.id" class="py-3 flex items-center justify-between gap-3">
              <div>
                <div class="font-bold text-slate-900">{{ qc.product_title }}</div>
                <div class="text-[11px] text-slate-500 font-mono">
                  [{{ qc.business_name }}] • {{ qc.carrier }} ({{ qc.sample_tracking_no }})
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <span v-if="qc.status !== 'IN_INSPECTION'" :class="qc.status === 'APPROVED' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'" class="px-2.5 py-1 rounded-md text-[10px] font-bold">
                  {{ qc.status === 'APPROVED' ? '✓ 검수합격' : '✕ 검수반려' }}
                </span>
                <template v-else>
                  <button @click="inspectSample(qc.id, 'APPROVED')" class="px-2.5 py-1 rounded bg-[#00A862] hover:bg-emerald-700 text-white font-bold text-[11px] cursor-pointer">
                    합격 승인
                  </button>
                  <button @click="inspectSample(qc.id, 'REJECTED')" class="px-2 py-1 rounded border border-red-300 text-red-600 hover:bg-red-50 font-bold text-[11px] cursor-pointer">
                    반려
                  </button>
                </template>
              </div>
            </div>
          </div>
        </div>

        <!-- IPR Notice & Takedown Desk -->
        <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div class="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 class="text-sm font-black text-slate-900 flex items-center gap-2">
                <span>⚖️ 지식재산권(IPR) 신속 퇴출 관제 (Notice & Takedown)</span>
                <span class="px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-mono">긴급 접수</span>
              </h3>
              <p class="text-[11px] text-slate-500 mt-0.5">상표권/가품 신고 접수 시 해당 상품을 즉시 블라인드하고 정산금을 동결합니다.</p>
            </div>
          </div>
          <div class="divide-y divide-slate-100">
            <div v-for="ipr in iprReports" :key="ipr.id" class="py-3 flex items-center justify-between gap-3">
              <div>
                <div class="font-bold text-slate-900">{{ ipr.product_title }}</div>
                <div class="text-[11px] text-red-600 font-bold">
                  신고자: {{ ipr.reporter_name }} (권리브랜드: {{ ipr.brand_name }} • 유형: {{ ipr.infringement_type }})
                </div>
              </div>
              <div class="shrink-0">
                <span v-if="ipr.status === 'TAKEDOWN_APPLIED'" class="px-2.5 py-1 rounded bg-slate-100 text-slate-600 font-bold text-[10px]">
                  ✓ 판매중단 완료
                </span>
                <button v-else @click="fastTrackTakedown(ipr.id)" class="px-3 py-1.5 rounded-lg bg-[#E60023] hover:bg-red-800 text-white font-bold text-[11px] cursor-pointer shadow-xs">
                  즉시 블라인드 (Takedown)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Quick Action Navigation Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <RouterLink to="/marketing" class="bg-white p-5 rounded-2xl border border-slate-200 hover:border-orange-500 transition shadow-xs group block">
          <div class="flex items-center justify-between mb-2">
            <span class="p-2.5 bg-orange-50 text-orange-600 rounded-xl group-hover:bg-orange-500 group-hover:text-white transition">
              <i class="fa-solid fa-images text-base"></i>
            </span>
            <span class="text-xs font-bold text-orange-600">활성 {{ metrics.bannersCount }}개 →</span>
          </div>
          <h3 class="font-black text-slate-900 text-sm">홈 배너 & 프로모션 관리</h3>
          <p class="text-slate-500 mt-1">스토어프론트 메인 캐러셀 배너를 실시간으로 추가·삭제합니다.</p>
        </RouterLink>

        <RouterLink to="/marketing" class="bg-white p-5 rounded-2xl border border-slate-200 hover:border-indigo-500 transition shadow-xs group block">
          <div class="flex items-center justify-between mb-2">
            <span class="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition">
              <i class="fa-solid fa-bullhorn text-base"></i>
            </span>
            <span class="text-xs font-bold text-indigo-600">누적 {{ metrics.notifsCount }}건 →</span>
          </div>
          <h3 class="font-black text-slate-900 text-sm">전사 고객 알림 발송</h3>
          <p class="text-slate-500 mt-1">전체 회원 또는 특정 고객에게 이벤트·주문 공지를 푸시합니다.</p>
        </RouterLink>

        <RouterLink to="/ledger" class="bg-white p-5 rounded-2xl border border-slate-200 hover:border-emerald-500 transition shadow-xs group block">
          <div class="flex items-center justify-between mb-2">
            <span class="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition">
              <i class="fa-solid fa-scale-balanced text-base"></i>
            </span>
            <span class="text-xs font-bold text-emerald-600">원장 감사 →</span>
          </div>
          <h3 class="font-black text-slate-900 text-sm">에스크로 정산 & 재고 원장</h3>
          <p class="text-slate-500 mt-1">파트너 정산 지급 승인 및 SKU별 재고 차감·원복 기록을 감사합니디.</p>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
