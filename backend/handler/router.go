package handler

import (
	"net/http"

	"networkai/backend"
	"networkai/service"

	"github.com/gorilla/handlers"
	"github.com/gorilla/mux"
)

func InitRouter(key []byte) http.Handler {
	router := mux.NewRouter()
	router.HandleFunc("/signup", signupHandler).Methods(http.MethodPost)
	router.HandleFunc("/signin", signinHandler(key)).Methods(http.MethodPost)
	// The original Postman collections use these aliases.
	router.HandleFunc("/users", signupHandler).Methods(http.MethodPost)
	router.HandleFunc("/auth/login", signinHandler(key)).Methods(http.MethodPost)
	router.HandleFunc("/posts", requireToken(key, uploadHandler(service.SavePost))).Methods(http.MethodPost)
	router.HandleFunc("/posts/search", requireToken(key, searchHandler)).Methods(http.MethodGet)
	router.HandleFunc("/posts/{id}", requireToken(key, deleteHandler)).Methods(http.MethodDelete)
	router.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }).Methods(http.MethodGet)
	router.Handle("/media/{objectName}", backend.LocalMediaHandler()).Methods(http.MethodGet, http.MethodHead)
	return handlers.CORS(
		handlers.AllowedOrigins([]string{"*"}),
		handlers.AllowedHeaders([]string{"Authorization", "Content-Type"}),
		handlers.AllowedMethods([]string{http.MethodGet, http.MethodPost, http.MethodDelete}),
	)(router)
}
