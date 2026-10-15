package orders

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

type mockRuleResolver struct{}

func (m *mockRuleResolver) GetPartnerRule(ctx context.Context, partnerID uuid.UUID) (*PartnerShippingRule, error) {
	return &PartnerShippingRule{
		BaseShippingFee:       3000,
		FreeShippingThreshold: 50000,
		CommissionRate:        10.0,
	}, nil
}

func TestOrderStateMachine_Transitions(t *testing.T) {
	sm := NewOrderStateMachine()

	// Valid transition: PaymentPending -> Paid
	err := sm.Transition(StatusPaymentPending, StatusPaid)
	if err != nil {
		t.Fatalf("expected transition to Paid, got error: %v", err)
	}

	// Valid transition: Paid -> Preparing -> Shipped -> Delivered -> PurchaseConfirm
	err = sm.Transition(StatusPaid, StatusPreparing)
	if err != nil {
		t.Fatalf("expected transition to Preparing, got: %v", err)
	}

	err = sm.Transition(StatusPreparing, StatusShipped)
	if err != nil {
		t.Fatalf("expected transition to Shipped, got: %v", err)
	}

	err = sm.Transition(StatusShipped, StatusDelivered)
	if err != nil {
		t.Fatalf("expected transition to Delivered, got: %v", err)
	}

	err = sm.Transition(StatusDelivered, StatusPurchaseConfirm)
	if err != nil {
		t.Fatalf("expected transition to PurchaseConfirm, got: %v", err)
	}

	// Terminal state cannot transition
	err = sm.Transition(StatusPurchaseConfirm, StatusCancelled)
	if err == nil {
		t.Fatalf("expected error from terminal state, got nil")
	}

	// Invalid skip transition: PaymentPending cannot go directly to Shipped
	err = sm.Transition(StatusPaymentPending, StatusShipped)
	if err == nil {
		t.Fatalf("expected error on invalid skip transition, got nil")
	}
}

func TestCheckoutService_ProcessCheckout(t *testing.T) {
	svc := NewCheckoutService(&mockRuleResolver{})
	partnerA := uuid.New()
	partnerB := uuid.New()

	req := &CheckoutRequest{
		BuyerUserID:    uuid.New(),
		IdempotencyKey: uuid.New(),
		Items: []CartItem{
			{
				PartnerID: partnerA,
				ProductID: uuid.New(),
				SKUID:     uuid.New(),
				UnitPrice: 20000,
				Quantity:  2, // 40,000 < 50,000 threshold -> shipping 3,000
			},
			{
				PartnerID: partnerB,
				ProductID: uuid.New(),
				SKUID:     uuid.New(),
				UnitPrice: 60000,
				Quantity:  1, // 60,000 >= 50,000 threshold -> shipping 0 (Free)
			},
		},
	}

	result, err := svc.ProcessCheckout(context.Background(), req)
	if err != nil {
		t.Fatalf("unexpected calculation error: %v", err)
	}

	// Total goods: 40,000 + 60,000 = 100,000
	// Total shipping: 3,000 + 0 = 3,000
	// Total pay: 103,000
	if result.TotalItemAmount != 100000 {
		t.Errorf("expected goods 100000, got %d", result.TotalItemAmount)
	}
	if result.TotalShippingFee != 3000 {
		t.Errorf("expected shipping 3000, got %d", result.TotalShippingFee)
	}
	if result.TotalPayAmount != 103000 {
		t.Errorf("expected pay 103000, got %d", result.TotalPayAmount)
	}
	if len(result.SubOrders) != 2 {
		t.Errorf("expected 2 split suborders, got %d", len(result.SubOrders))
	}
}

