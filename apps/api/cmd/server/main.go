// Command server is an offline Go reference server. It is NOT in the production
// request path: all clients call the Cloudflare Workers gateway
// (apps/cloudflare-gateway) backed by D1. The canonical Go domain packages
// live in backend/ (see docs/TECH_STACK_AUDIT.md); the long-term fix is to
// delete apps/api/internal/... and point this module at backend/ with a
// `replace` directive (requires the Go toolchain to verify - kept as an
// explicit follow-up, not done blind).
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/google/uuid"
	"openmarket/api/internal/orders"
)

type staticRuleResolver struct{}

func (s *staticRuleResolver) GetPartnerRule(ctx context.Context, pID uuid.UUID) (*orders.PartnerShippingRule, error) {
	return &orders.PartnerShippingRule{
		BaseShippingFee:       3000,
		FreeShippingThreshold: 30000,
		CommissionRate:        10.0,
	}, nil
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	checkoutSvc := orders.NewCheckoutService(&staticRuleResolver{})

	mux := http.NewServeMux()

	// CORS & Health
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":    "UP",
			"engine":    "Go 1.23+ OpenMarket Standard Backend",
			"timestamp": time.Now().UTC(),
		})
	})

	// Retired demo endpoints: this server used to answer /api/v1/categories and
	// /api/v1/products with hardcoded fake rows. Production traffic is served by
	// the Cloudflare Workers gateway (apps/cloudflare-gateway) backed by D1, so
	// these paths now answer 410 Gone instead of inventing catalogue data.
	gone := func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		json.NewEncoder(w).Encode(map[string]any{
			"success": false,
			"code":    "GONE",
			"error":   "이 데모 엔드포인트는 폐기되었습니다. 프로덕션 게이트웨이(apps/cloudflare-gateway)를 사용해 주세요.",
		})
	}
	mux.HandleFunc("/api/v1/categories", gone)
	mux.HandleFunc("/api/v1/products", gone)

	// Checkout
	mux.HandleFunc("/api/v1/orders/checkout", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		var req orders.CheckoutRequest
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&req)
		}
		if req.BuyerUserID == uuid.Nil {
			req.BuyerUserID = uuid.New()
		}
		if req.IdempotencyKey == uuid.Nil {
			req.IdempotencyKey = uuid.New()
		}
		if len(req.Items) == 0 {
			http.Error(w, orders.ErrEmptyCart.Error(), http.StatusBadRequest)
			return
		}

		res, err := checkoutSvc.ProcessCheckout(r.Context(), &req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(res)
	})

	log.Printf("OpenMarket Go Backend API Server listening on port %s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Idempotency-Key")
}
