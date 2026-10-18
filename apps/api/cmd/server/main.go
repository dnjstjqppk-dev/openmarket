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
		FreeShippingThreshold: 50000,
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
			"total": 33,
			"items": []map[string]string{
				{"slug": "womens-clothing", "name": "여성 패션"},
				{"slug": "mens-clothing", "name": "남성 패션"},
				{"slug": "electronics-computers", "name": "디지털 & 컴퓨터"},
				{"slug": "home-kitchen", "name": "홈 & 리빙"},
				{"slug": "sports-outdoors", "name": "스포츠 & 아웃도어"},
			},
		})
	})

	// Products
	mux.HandleFunc("/api/v1/products", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"items": []map[string]any{
				{"id": "p-1", "brand": "Anker Official", "name": "Soundcore Space Q45 ANC 헤드폰", "price": 49900, "stock": 120},
				{"id": "p-2", "brand": "Baseus Korea", "name": "블레이드 100W 초고속 보조배터리", "price": 28900, "stock": 85},
			},
		})
	})

	// Checkout
	mux.HandleFunc("/api/v1/orders/checkout", func(w http.ResponseWriter, r *http.Request) {
		enableCORS(w)
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		var req orders.CheckoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			p1 := uuid.New()
			req = orders.CheckoutRequest{
				BuyerUserID:    uuid.New(),
				IdempotencyKey: uuid.New(),
				Items: []orders.CartItem{
					{PartnerID: p1, ProductID: uuid.New(), SKUID: uuid.New(), UnitPrice: 49900, Quantity: 1},
				},
				PaymentMethod: "KAKAOPAY",
			}
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
