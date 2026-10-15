package main

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"openmarket/api/internal/orders"
)

func TestCheckoutServiceInAPI(t *testing.T) {
	resolver := &staticRuleResolver{}
	svc := orders.NewCheckoutService(resolver)

	pID := uuid.New()
	req := &orders.CheckoutRequest{
		BuyerUserID:    uuid.New(),
		IdempotencyKey: uuid.New(),
		Items: []orders.CartItem{
			{PartnerID: pID, ProductID: uuid.New(), SKUID: uuid.New(), UnitPrice: 55000, Quantity: 1},
		},
		PaymentMethod: "KAKAOPAY",
	}

	res, err := svc.ProcessCheckout(context.Background(), req)
	if err != nil {
		t.Fatalf("checkout failed: %v", err)
	}

	if res.TotalPayAmount != 55000 {
		t.Errorf("expected 55000 (free shipping), got %d", res.TotalPayAmount)
	}
}
