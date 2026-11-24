package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestPostRoutes(t *testing.T) {
	key := []byte("test-signing-key-only-for-this-suite")
	claims := userClaims{Username: "testuser", RegisteredClaims: jwt.RegisteredClaims{
		Issuer: tokenIssuer, ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	router := InitRouter(key)
	tests := []struct {
		name, method, path, body, wantBody string
		wantStatus                         int
	}{
		{name: "upload requires multipart", method: http.MethodPost, path: "/posts", body: `{}`, wantStatus: http.StatusUnsupportedMediaType},
		{name: "GET is rejected", method: http.MethodGet, path: "/posts", wantStatus: http.StatusMethodNotAllowed},
		{name: "search only accepts GET", method: http.MethodPost, path: "/posts/search", wantStatus: http.StatusMethodNotAllowed},
		{name: "search backend unavailable", method: http.MethodGet, path: "/posts/search?user=sun", wantBody: "Failed to read post from backend\n", wantStatus: http.StatusInternalServerError},
		{name: "unknown route", method: http.MethodPost, path: "/missing", body: `{}`, wantStatus: http.StatusNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			r.RemoteAddr = "127.0.0.1:1234"
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.Header.Set("Authorization", "Bearer "+token)
			router.ServeHTTP(w, r)
			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", w.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && w.Body.String() != tt.wantBody {
				t.Fatalf("body = %q, want %q", w.Body.String(), tt.wantBody)
			}
		})
	}
	for _, bearer := range []string{"", "Bearer malformed"} {
		r := httptest.NewRequest(http.MethodGet, "/posts/search", nil)
		r.Header.Set("Authorization", bearer)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated search returned %d", w.Code)
		}
	}
}
