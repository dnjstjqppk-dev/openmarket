<script setup lang="ts">
// 존재하지 않는 관리자 콘솔 경로(404). 빈 화면 대신 대시보드로 안내한다.
import { useRouter } from 'vue-router'
import { OmEmptyState, OmButton } from '@olmoa/ui'

const router = useRouter()
function goBack() {
  if (window.history.length > 1) router.back()
  else router.replace('/')
}
</script>

<template>
  <main class="mx-auto w-full max-w-2xl px-4 py-10" aria-label="페이지를 찾을 수 없음">
    <OmEmptyState
      title="페이지를 찾을 수 없습니다"
      description="주소가 바뀌었거나 삭제된 페이지입니다. 입력하신 주소를 다시 확인해 주세요."
    >
      <template #icon>
        <span class="text-2xl font-black text-ink-subtle" aria-hidden="true">404</span>
      </template>
      <OmButton to="/" size="sm">대시보드로 가기</OmButton>
      <OmButton variant="outline" size="sm" @click="goBack">이전 페이지</OmButton>
    </OmEmptyState>
  </main>
</template>
