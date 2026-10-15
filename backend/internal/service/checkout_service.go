package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var (
	ErrEmptyCart            = errors.New("cart cannot be empty for checkout")
	ErrInvalidAmount        = errors.New("invalid item or shipping calculation amount")
	ErrPartnerRuleNotFound  = errors.New("partner shipping and commission rule not found")
)

type CartItem struct {
	PartnerID       uuid.UUID
	ProductID       uuid.UUID
	SKUID           uuid.UUID
	FlashSaleItemID *uuid.UUID
	SKUOptionJSON   string
	UnitPrice       int64
	Quantity        int
}

type PartnerShippingRule struct {
	BaseShippingFee       int64
	FreeShippingThreshold int64
	CommissionRate        float64
}

type CheckoutRequest struct {
	BuyerUserID     uuid.UUID
	IdempotencyKey  uuid.UUID
	Items           []CartItem
	PaymentMethod   string
	RecipientName   string
	RecipientPhone  string
	ShippingAddress string
}

type SubOrderResult struct {
	SubOrderID            uuid.UUID
	PartnerID             uuid.UUID
	SubItemAmount         int64
	ShippingFee           int64
	SubTotalAmount        int64
	AppliedCommissionRate float64
	ItemCount             int
}

type CheckoutResult struct {
	OrderID          uuid.UUID
	IdempotencyKey   uuid.UUID
	TotalItemAmount  int64
	TotalShippingFee int64
	TotalPayAmount   int64
	SubOrders        []SubOrderResult
	CreatedAt        time.Time
}

type PartnerRuleResolver interface {
	GetPartnerRule(ctx context.Context, partnerID uuid.UUID) (*PartnerShippingRule, error)
}

type CheckoutPersister interface {
	PersistCheckout(ctx context.Context, res *CheckoutResult, req *CheckoutRequest) error
}

type CheckoutService struct {
	ruleResolver PartnerRuleResolver
	persister    CheckoutPersister
}

func NewCheckoutService(rr PartnerRuleResolver, cp CheckoutPersister) *CheckoutService {
	return &CheckoutService{
		ruleResolver: rr,
		persister:    cp,
	}
}

func (s *CheckoutService) ProcessCheckout(ctx context.Context, req *CheckoutRequest) (*CheckoutResult, error) {
	if len(req.Items) == 0 {
		return nil, ErrEmptyCart
	}

	groupedByPartner := make(map[uuid.UUID][]CartItem)
	for _, it := range req.Items {
		if it.UnitPrice < 0 || it.Quantity <= 0 {
			return nil, ErrInvalidAmount
		}
		groupedByPartner[it.PartnerID] = append(groupedByPartner[it.PartnerID], it)
	}

	orderID := uuid.New()
	var grandTotalItemAmount int64
	var grandTotalShippingFee int64
	subOrderResults := make([]SubOrderResult, 0, len(groupedByPartner))

	for partnerID, pItems := range groupedByPartner {
		var subItemTotal int64
		for _, it := range pItems {
			lineTotal := it.UnitPrice * int64(it.Quantity)
			subItemTotal += lineTotal
		}

		rule, err := s.ruleResolver.GetPartnerRule(ctx, partnerID)
		if err != nil {
			return nil, fmt.Errorf("%w for partner %s: %v", ErrPartnerRuleNotFound, partnerID, err)
		}

		shippingFee := rule.BaseShippingFee
		if rule.FreeShippingThreshold > 0 && subItemTotal >= rule.FreeShippingThreshold {
			shippingFee = 0
		}

		subTotal := subItemTotal + shippingFee
		grandTotalItemAmount += subItemTotal
		grandTotalShippingFee += shippingFee

		subOrderResults = append(subOrderResults, SubOrderResult{
			SubOrderID:            uuid.New(),
			PartnerID:             partnerID,
			SubItemAmount:         subItemTotal,
			ShippingFee:           shippingFee,
			SubTotalAmount:        subTotal,
			AppliedCommissionRate: rule.CommissionRate,
			ItemCount:             len(pItems),
		})
	}

	res := &CheckoutResult{
		OrderID:          orderID,
		IdempotencyKey:   req.IdempotencyKey,
		TotalItemAmount:  grandTotalItemAmount,
		TotalShippingFee: grandTotalShippingFee,
		TotalPayAmount:   grandTotalItemAmount + grandTotalShippingFee,
		SubOrders:        subOrderResults,
		CreatedAt:        time.Now().UTC(),
	}

	if s.persister != nil {
		if err := s.persister.PersistCheckout(ctx, res, req); err != nil {
			return nil, fmt.Errorf("failed to persist order and ledger: %w", err)
		}
	}

	return res, nil
}

