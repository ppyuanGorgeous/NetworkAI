package handler

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"networkai/model"
	"networkai/service"

	"github.com/golang-jwt/jwt/v5"
)

const tokenIssuer = "networkai"

type usernameContextKey struct{}

type userClaims struct {
	Username string `json:"username"`
	jwt.RegisteredClaims
}

var validUsername = regexp.MustCompile(`^[a-z0-9]{1,64}$`)

func decodeUser(w http.ResponseWriter, r *http.Request) (model.User, bool) {
	var user model.User
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	if err := decoder.Decode(&user); err != nil || decoder.Decode(new(any)) != io.EOF {
		http.Error(w, "Invalid user JSON", http.StatusBadRequest)
		return user, false
	}
	if !validUsername.MatchString(user.Username) || len(user.Password) == 0 || len(user.Password) > 72 {
		http.Error(w, "Invalid username or password", http.StatusBadRequest)
		return user, false
	}
	return user, true
}

func signupHandler(w http.ResponseWriter, r *http.Request) {
	user, ok := decodeUser(w, r)
	if !ok {
		return
	}
	created, err := service.AddUser(r.Context(), user)
	if err != nil {
		// Elasticsearch error bodies can include submitted document fields.
		log.Print("Failed to create user in Elasticsearch")
		http.Error(w, "Failed to create user", http.StatusInternalServerError)
		return
	}
	if !created {
		http.Error(w, "User already exists", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func signinHandler(key []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := decodeUser(w, r)
		if !ok {
			return
		}
		verified, err := service.CheckUser(r.Context(), user.Username, user.Password)
		if err != nil {
			log.Print("Failed to read user from Elasticsearch")
			http.Error(w, "Failed to read user", http.StatusInternalServerError)
			return
		}
		if !verified {
			http.Error(w, "Invalid credentials", http.StatusUnauthorized)
			return
		}
		now := time.Now()
		claims := userClaims{Username: user.Username, RegisteredClaims: jwt.RegisteredClaims{
			Issuer: tokenIssuer, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)),
		}}
		token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(key)
		if err != nil {
			http.Error(w, "Failed to sign token", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, token)
	}
}

func requireToken(key []byte, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fields := strings.Fields(r.Header.Get("Authorization"))
		if len(fields) == 2 && strings.EqualFold(fields[0], "Bearer") {
			var claims userClaims
			token, err := jwt.ParseWithClaims(fields[1], &claims, func(*jwt.Token) (any, error) { return key, nil },
				jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired(), jwt.WithIssuer(tokenIssuer))
			if err == nil && token.Valid && validUsername.MatchString(claims.Username) {
				next(w, r.WithContext(context.WithValue(r.Context(), usernameContextKey{}, claims.Username)))
				return
			}
		}
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "Valid bearer token required", http.StatusUnauthorized)
	}
}
