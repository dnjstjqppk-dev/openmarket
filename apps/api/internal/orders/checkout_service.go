package orders

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

var (
	ErrEmptyCart           = errors.New("cart cannot be empty for checkout")
	ErrInvalidAmount       = errors.New("invalid item or shipping calculation amount")
	ErrPartnerRuleNotFound = errors.New("partner shipping and commission rule not found")
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

type CheckoutService struct {
	ruleResolver PartnerRuleResolver
}

func NewCheckoutService(rr PartnerRuleResolver) *CheckoutService {
	return &CheckoutService{ruleResolver: rr}
}

func (s *CheckoutService) ProcessCheckout(ctx context.Context, req *CheckoutRequest) (*CheckoutResult, error) {
	if len(req.Items) == 0 {
		return nil, ErrEmptyCart
	}

	grouped := make(map[uuid.UUID][]CartItem)
	for _, it := range req.Items {
		if it.UnitPrice < 0 || it.Quantity <= 0 {
			return nil, ErrInvalidAmount
		}
		grouped[it.PartnerID] = append(grouped[it.PartnerID], it)
	}

	orderID := uuid.New()
	var grandTotalItem int64
	var grandTotalShipping int64
	subOrders := make([]SubOrderResult, 0, len(grouped))

	for pID, pItems := range grouped {
		var subItemTotal int64
		for _, it := range pItems {
			subItemTotal += it.UnitPrice * int64(it.Quantity)
		}

		rule, err := s.ruleResolver.GetPartnerRule(ctx, pID)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrPartnerRuleNotFound, err)
		}

		shippingFee := rule.BaseShippingFee
		if rule.FreeShippingThreshold > 0 && subItemTotal >= rule.FreeShippingThreshold {
			shippingFee = 0
		}

		subTotal := subItemTotal + shippingFee
		grandTotalItem += subItemTotal
		grandTotalShipping += shippingFee

		subOrders = append(subOrders, SubOrderResult{
			SubOrderID:            uuid.New(),
			PartnerID:             pID,
			SubItemAmount:         subItemTotal,
			ShippingFee:           shippingFee,
			SubTotalAmount:        subTotal,
			AppliedCommissionRate: rule.CommissionRate,
			ItemCount:             len(pItems),
		})
	}

	return &CheckoutResult{
		OrderID:          orderID,
		IdempotencyKey:   req.IdempotencyKey,
		TotalItemAmount:  grandTotalItem,
		TotalShippingFee: grandTotalShipping,
		TotalPayAmount:   grandTotalItem + grandTotalShipping,
		SubOrders:        subOrders,
		CreatedAt:        time.Now().UTC(),
	}, nil
}
