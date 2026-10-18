if redis.call("EXISTS", KEYS[3]) == 1 then
    return 0
end
local current_stock_raw = redis.call("GET", KEYS[1])
if not current_stock_raw then
    return -1
end
local current_stock = tonumber(current_stock_raw)
local req_qty = tonumber(ARGV[2])
local per_user_limit = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local user_id = ARGV[1]
if current_stock < req_qty then
    return -2
end
if per_user_limit > 0 then
    local bought_raw = redis.call("HGET", KEYS[2], user_id)
    local bought_qty = tonumber(bought_raw or "0")
    if (bought_qty + req_qty) > per_user_limit then
        return -3
    end
    redis.call("HINCRBY", KEYS[2], user_id, req_qty)
end
redis.call("DECRBY", KEYS[1], req_qty)
redis.call("SET", KEYS[3], req_qty, "EX", ttl)
return 1
