package redis

import (
	"context"
	_ "embed"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

//go:embed scripts/deduct_stock.lua
var deductStockLua string

const rollbackStockLua = `
local req_qty = tonumber(ARGV[2])
local user_id = ARGV[1]
local per_user_limit = tonumber(ARGV[3])
if redis.call("EXISTS", KEYS[3]) == 1 then
    redis.call("INCRBY", KEYS[1], req_qty)
    if per_user_limit > 0 then
        local bought_raw = redis.call("HGET", KEYS[2], user_id)
        local bought_qty = tonumber(bought_raw or "0")
        if bought_qty >= req_qty then
            redis.call("HINCRBY", KEYS[2], user_id, -req_qty)
        else
            redis.call("HDEL", KEYS[2], user_id)
        end
    end
    redis.call("DEL", KEYS[3])
    return 1
end
return 0
`

var (
	ErrAlreadyProcessed    = errors.New("idempotency key already processed")
	ErrSkuNotFound         = errors.New("sku stock not found in cache")
	ErrInsufficientStock   = errors.New("insufficient stock")
	ErrUserLimitExceeded   = errors.New("user purchase limit exceeded")
	ErrInvalidScriptResult = errors.New("unexpected lua script result")
)

type StockReservationItem struct {
	CampaignSKUID  string
	RequestedQty   int
	PerUserLimit   int
	IdempotencyKey string
}

type StockDeductor struct {
	client       redis.UniversalClient
	deductScript *redis.Script
	rollScript   *redis.Script
}

func NewStockDeductor(client redis.UniversalClient) *StockDeductor {
	return &StockDeductor{
		client:       client,
		deductScript: redis.NewScript(deductStockLua),
		rollScript:   redis.NewScript(rollbackStockLua),
	}
}

func (s *StockDeductor) DeductStock(
	ctx context.Context,
	userID string,
	item StockReservationItem,
	ttl time.Duration,
) error {
	stockKey := fmt.Sprintf("stock:sku:%s", item.CampaignSKUID)
	userLimitKey := fmt.Sprintf("stock:limit:%s", item.CampaignSKUID)
	idemKey := fmt.Sprintf("stock:idem:%s:%s", item.CampaignSKUID, item.IdempotencyKey)

	res, err := s.deductScript.Run(
		ctx,
		s.client,
		[]string{stockKey, userLimitKey, idemKey},
		userID,
		item.RequestedQty,
		item.PerUserLimit,
		int(ttl.Seconds()),
	).Int()

	if err != nil {
		return fmt.Errorf("failed to run deduct script: %w", err)
	}

	switch res {
	case 1:
		return nil
	case 0:
		return ErrAlreadyProcessed
	case -1:
		return ErrSkuNotFound
	case -2:
		return ErrInsufficientStock
	case -3:
		return ErrUserLimitExceeded
	default:
		return ErrInvalidScriptResult
	}
}

func (s *StockDeductor) RollbackStock(
	ctx context.Context,
	userID string,
	item StockReservationItem,
) error {
	stockKey := fmt.Sprintf("stock:sku:%s", item.CampaignSKUID)
	userLimitKey := fmt.Sprintf("stock:limit:%s", item.CampaignSKUID)
	idemKey := fmt.Sprintf("stock:idem:%s:%s", item.CampaignSKUID, item.IdempotencyKey)

	_, err := s.rollScript.Run(
		ctx,
		s.client,
		[]string{stockKey, userLimitKey, idemKey},
		userID,
		item.RequestedQty,
		item.PerUserLimit,
	).Int()

	if err != nil {
		return fmt.Errorf("failed to run rollback script: %w", err)
	}
	return nil
}

func (s *StockDeductor) RollbackMultiple(
	ctx context.Context,
	userID string,
	items []StockReservationItem,
) error {
	var firstErr error
	for _, it := range items {
		if err := s.RollbackStock(ctx, userID, it); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
