// Toss Payments SDK loader (P2 consolidation: was triplicated verbatim in
// CheckoutView, OrderDetailView and PaymentResultView — an SDK URL or error
// copy change needed the same edit in 3 places and one could silently lag).
// Resolves with the global TossPayments object, loading the script on demand.

export function loadTossSdk(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).TossPayments) return resolve((window as any).TossPayments)
    const s = document.createElement('script')
    s.src = 'https://js.tosspayments.com/v1/payment'
    s.onload = () => resolve((window as any).TossPayments)
    s.onerror = () => reject(new Error('결제 모듈을 불러오지 못했습니다.'))
    document.head.appendChild(s)
  })
}
