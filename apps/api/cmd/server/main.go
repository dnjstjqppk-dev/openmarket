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

	// Categories
	mux.HandleFunc("/api/v1/categories", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"total": 42,
			"items": []map[string]string{
				{"slug": "womens-clothing", "name": "여성의류"},
				{"slug": "mens-clothing", "name": "남성의류"},
				{"slug": "electronics", "name": "디지털/가전"},
				{"slug": "home-kitchen", "name": "홈/주방"},
				{"slug": "sports-outdoors", "name": "스포츠/레저"},
			},
		})
	})

	// Products
	mux.HandleFunc("/api/v1/products", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]any{
				{"id": "prod_001", "brand": "Anker Official", "name": "초경량 액티브 노이즈캔슬링 무선 이어폰 Pro 3", "price": 49900, "stock": 500},
				{"id": "prod_002", "brand": "Baseus Korea", "name": "울트라 슬림 65W GaN 고속 충전기 3포트 멀티허브", "price": 24500, "stock": 1200},
			},
		})
	})

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
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Idempotency-Key, X-Customer-Id, X-Partner-Id, X-Admin-Secret")
}
