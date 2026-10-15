package statemachine

import (
	"errors"
	"fmt"
)

type SubOrderStatus string

const (
	StatusPaymentPending   SubOrderStatus = "PAYMENT_PENDING"
	StatusPaid             SubOrderStatus = "PAID"
	StatusPreparing        SubOrderStatus = "PREPARING"
	StatusShipped          SubOrderStatus = "SHIPPED"
	StatusDelivered        SubOrderStatus = "DELIVERED"
	StatusPurchaseConfirm  SubOrderStatus = "PURCHASE_CONFIRMED"
	StatusCancelled        SubOrderStatus = "CANCELLED"
	StatusReturnRequested  SubOrderStatus = "RETURN_REQUESTED"
	StatusRefunded         SubOrderStatus = "REFUNDED"
)

var (
	ErrInvalidStateTransition = errors.New("invalid sub-order state transition")
	ErrTerminalState          = errors.New("cannot transition from terminal state")
)

var validTransitions = map[SubOrderStatus]map[SubOrderStatus]bool{
	StatusPaymentPending: {
		StatusPaid:      true,
		StatusCancelled: true,
	},
	StatusPaid: {
		StatusPreparing: true,
		StatusCancelled: true,
	},
	StatusPreparing: {
		StatusShipped:   true,
		StatusCancelled: true,
	},
	StatusShipped: {
		StatusDelivered:       true,
		StatusReturnRequested: true,
	},
	StatusDelivered: {
		StatusPurchaseConfirm: true,
		StatusReturnRequested: true,
	},
	StatusReturnRequested: {
		StatusRefunded:  true,
		StatusDelivered: true, // return rejected
	},
	StatusPurchaseConfirm: {}, // Terminal
	StatusCancelled:       {}, // Terminal
	StatusRefunded:        {}, // Terminal
}

type OrderStateMachine struct{}

func NewOrderStateMachine() *OrderStateMachine {
	return &OrderStateMachine{}
}

func (sm *OrderStateMachine) CanTransition(from, to SubOrderStatus) bool {
	allowed, exists := validTransitions[from]
	if !exists {
		return false
	}
	return allowed[to]
}

func (sm *OrderStateMachine) Transition(from, to SubOrderStatus) error {
	allowed, exists := validTransitions[from]
	if !exists {
		return fmt.Errorf("%w: unknown state '%s'", ErrInvalidStateTransition, from)
	}
	if len(allowed) == 0 {
		return fmt.Errorf("%w: state '%s' is terminal", ErrTerminalState, from)
	}
	if !allowed[to] {
		return fmt.Errorf("%w: cannot transition from '%s' to '%s'", ErrInvalidStateTransition, from, to)
	}
	return nil
}

func (sm *OrderStateMachine) IsTerminal(status SubOrderStatus) bool {
	allowed, exists := validTransitions[status]
	return exists && len(allowed) == 0
}
