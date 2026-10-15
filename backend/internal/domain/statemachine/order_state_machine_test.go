package statemachine_test

import (
	"testing"

	"openmarket/backend/internal/domain/statemachine"
)

func TestOrderStateMachine_AllTransitions(t *testing.T) {
	sm := statemachine.NewOrderStateMachine()

	validCases := []struct {
		from statemachine.SubOrderStatus
		to   statemachine.SubOrderStatus
	}{
		{statemachine.StatusPaymentPending, statemachine.StatusPaid},
		{statemachine.StatusPaymentPending, statemachine.StatusCancelled},
		{statemachine.StatusPaid, statemachine.StatusPreparing},
		{statemachine.StatusPaid, statemachine.StatusCancelled},
		{statemachine.StatusPreparing, statemachine.StatusShipped},
		{statemachine.StatusPreparing, statemachine.StatusCancelled},
		{statemachine.StatusShipped, statemachine.StatusDelivered},
		{statemachine.StatusShipped, statemachine.StatusReturnRequested},
		{statemachine.StatusDelivered, statemachine.StatusPurchaseConfirm},
		{statemachine.StatusDelivered, statemachine.StatusReturnRequested},
		{statemachine.StatusReturnRequested, statemachine.StatusRefunded},
		{statemachine.StatusReturnRequested, statemachine.StatusDelivered},
	}

	for _, tc := range validCases {
		if !sm.CanTransition(tc.from, tc.to) {
			t.Errorf("expected transition %s -> %s to be allowed", tc.from, tc.to)
		}
		if err := sm.Transition(tc.from, tc.to); err != nil {
			t.Errorf("unexpected error transitioning %s -> %s: %v", tc.from, tc.to, err)
		}
	}

	invalidCases := []struct {
		from statemachine.SubOrderStatus
		to   statemachine.SubOrderStatus
	}{
		{statemachine.StatusPurchaseConfirm, statemachine.StatusRefunded},
		{statemachine.StatusCancelled, statemachine.StatusPaid},
		{statemachine.StatusRefunded, statemachine.StatusPaymentPending},
		{statemachine.StatusPaymentPending, statemachine.StatusDelivered},
	}

	for _, tc := range invalidCases {
		if sm.CanTransition(tc.from, tc.to) {
			t.Errorf("expected transition %s -> %s to be disallowed", tc.from, tc.to)
		}
		if err := sm.Transition(tc.from, tc.to); err == nil {
			t.Errorf("expected error transitioning %s -> %s, got nil", tc.from, tc.to)
		}
	}

	if !sm.IsTerminal(statemachine.StatusPurchaseConfirm) {
		t.Error("PURCHASE_CONFIRMED should be terminal")
	}
	if !sm.IsTerminal(statemachine.StatusCancelled) {
		t.Error("CANCELLED should be terminal")
	}
	if !sm.IsTerminal(statemachine.StatusRefunded) {
		t.Error("REFUNDED should be terminal")
	}
	if sm.IsTerminal(statemachine.StatusPaid) {
		t.Error("PAID should not be terminal")
	}
}
