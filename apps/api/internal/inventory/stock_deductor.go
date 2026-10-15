package inventory

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const deductLua = `
if redis.call("EXISTS", KEYS[3]) == 1 then
    return 0
end
local stock = tonumber(redis.call("GET", KEYS[1]) or "-1")
if stock < 0 then
    return -1
end
local req_qty = tonumber(ARGV[2])
local per_user_limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local user_id = ARGV[1]
if stock < req_qty then
    return -2
end
if per_user_limit > 0 then
    local bought = tonumber(redis.call("HGET", KEYS[2], user_id) or "0")
    if (bought + req_qty) > per_user_limit then
        return -3
    end
    redis.call("HINCRBY", KEYS[2], user_id, req_qty)
end
redis.call("DECRBY", KEYS[1], req_qty)
redis.call("SET", KEYS[3], req_qty, "EX", ttl)
return 1
`

var (
	ErrAlreadyProcessed  = errors.New("idempotency key already processed")
	ErrSkuNotFound       = errors.New("sku stock not found in cache")
	ErrInsufficientStock = errors.New("insufficient stock")
	ErrUserLimitExceeded = errors.New("user purchase limit exceeded")
)

type StockItem struct {
	SKUID          string
	Qty            int
	Limit          int
	IdempotencyKey string
}

type StockDeductor struct {
	client redis.UniversalClient
	script *redis.Script
}

func NewStockDeductor(client redis.UniversalClient) *StockDeductor {
	return &StockDeductor{
		client: client,
		script: redis.NewScript(deductLua),
	}
}

func (s *StockDeductor) Deduct(ctx context.Context, userID string, item StockItem, ttl time.Duration) error {
	stockKey := fmt.Sprintf("stock:%s", item.SKUID)
	limitKey := fmt.Sprintf("limit:%s", item.SKUID)
	idemKey := fmt.Sprintf("idem:%s:%s", item.SKUID, item.IdempotencyKey)

	res, err := s.script.Run(ctx, s.client, []string{stockKey, limitKey, idemKey}, userID, item.Qty, item.Limit, int(ttl.Seconds())).Int()
	if err != nil {
		return err
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
		return errors.New("unexpected script code")
	}
}
