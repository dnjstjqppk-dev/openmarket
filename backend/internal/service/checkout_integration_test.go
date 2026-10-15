package service_test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"openmarket/backend/internal/domain/statemachine"
	"openmarket/backend/internal/service"
)

type testRuleResolver struct {
	rules map[uuid.UUID]*service.PartnerShippingRule
}

func (r *testRuleResolver) GetPartnerRule(ctx context.Context, partnerID uuid.UUID) (*service.PartnerShippingRule, error) {
	rule, ok := r.rules[partnerID]
	if !ok {
		return nil, service.ErrPartnerRuleNotFound
	}
	return rule, nil
}

func TestCheckoutService_SplitOrderAndShipping(t *testing.T) {
	ctx := context.Background()
	partner1 := uuid.New()
	partner2 := uuid.New()

	resolver := &testRuleResolver{
		rules: map[uuid.UUID]*service.PartnerShippingRule{
			partner1: {
				BaseShippingFee:       3000,
				FreeShippingThreshold: 30000,
				CommissionRate:        10.0,
			},
			partner2: {
				BaseShippingFee:       2500,
				FreeShippingThreshold: 50000,
				CommissionRate:        12.5,
			},
		},
	}

	checkoutSvc := service.NewCheckoutService(resolver, nil)

	req := &service.CheckoutRequest{
		BuyerUserID:    uuid.New(),
		IdempotencyKey: uuid.New(),
		Items: []service.CartItem{
			{
				PartnerID: partner1,
				ProductID: uuid.New(),
				SKUID:     uuid.New(),
				UnitPrice: 35000, // exceeds partner1 threshold (30,000) -> free shipping
				Quantity:  1,
			},
			{
				PartnerID: partner2,
				ProductID: uuid.New(),
				SKUID:     uuid.New(),
				UnitPrice: 15000, // below partner2 threshold (50,000) -> shipping 2,500
				Quantity:  2,     // 30,000 total
			},
		},
		PaymentMethod:   "KAKAOPAY",
		RecipientName:   "홍길동",
		RecipientPhone:  "010-1234-5678",
		ShippingAddress: "서울특별시 강남구 테헤란로 123",
	}

	res, err := checkoutSvc.ProcessCheckout(ctx, req)
	if err != nil {
		t.Fatalf("ProcessCheckout failed: %v", err)
	}

	if len(res.SubOrders) != 2 {
		t.Fatalf("expected 2 sub-orders, got %d", len(res.SubOrders))
	}

	var p1Sub, p2Sub *service.SubOrderResult
	for i := range res.SubOrders {
		if res.SubOrders[i].PartnerID == partner1 {
			p1Sub = &res.SubOrders[i]
		} else if res.SubOrders[i].PartnerID == partner2 {
			p2Sub = &res.SubOrders[i]
		}
	}

	if p1Sub == nil || p2Sub == nil {
		t.Fatal("failed to find sub-orders for each partner")
	}

	// Partner 1: 35,000 -> free shipping -> subTotal = 35,000
	if p1Sub.SubItemAmount != 35000 || p1Sub.ShippingFee != 0 || p1Sub.SubTotalAmount != 35000 {
		t.Errorf("unexpected partner1 amounts: %+v", p1Sub)
	}

	// Partner 2: 30,000 + 2,500 shipping -> subTotal = 32,500
	if p2Sub.SubItemAmount != 30000 || p2Sub.ShippingFee != 2500 || p2Sub.SubTotalAmount != 32500 {
		t.Errorf("unexpected partner2 amounts: %+v", p2Sub)
	}

	// Total: 35,000 + 30,000 = 65,000 items, 2,500 shipping -> 67,500
	expectedPay := int64(67500)
	if res.TotalPayAmount != expectedPay {
		t.Errorf("expected TotalPayAmount %d, got %d", expectedPay, res.TotalPayAmount)
	}
}

func TestOrderStateMachine_Transitions(t *testing.T) {
	sm := statemachine.NewOrderStateMachine()

	// PAYMENT_PENDING -> PAID -> PREPARING -> SHIPPED -> DELIVERED -> PURCHASE_CONFIRMED
	if err := sm.Transition(statemachine.StatusPaymentPending, statemachine.StatusPaid); err != nil {
		t.Fatalf("unexpected transition error: %v", err)
	}
	if err := sm.Transition(statemachine.StatusPaid, statemachine.StatusPreparing); err != nil {
		t.Fatalf("unexpected transition error: %v", err)
	}
	if err := sm.Transition(statemachine.StatusPreparing, statemachine.StatusShipped); err != nil {
		t.Fatalf("unexpected transition error: %v", err)
	}
	if err := sm.Transition(statemachine.StatusShipped, statemachine.StatusDelivered); err != nil {
		t.Fatalf("unexpected transition error: %v", err)
	}
	if err := sm.Transition(statemachine.StatusDelivered, statemachine.StatusPurchaseConfirm); err != nil {
		t.Fatalf("unexpected transition error: %v", err)
	}

	// Terminal state cannot transition further
	if err := sm.Transition(statemachine.StatusPurchaseConfirm, statemachine.StatusRefunded); err == nil {
		t.Fatal("expected error transitioning from terminal PURCHASE_CONFIRMED")
	}
}
