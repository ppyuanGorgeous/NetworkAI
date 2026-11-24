package main

import (
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"networkai/backend"
	"networkai/constants"
	"networkai/handler"
)

func main() {
	address := "127.0.0.1:8080"
	if port := os.Getenv("PORT"); port != "" {
		address = ":" + port
	}
	listenAddress := flag.String("listen", address, "HTTP listen address")
	flag.Parse()

	config, err := constants.LoadApplicationConfig()
	if err != nil {
		log.Fatal(err)
	}
	if err := backend.InitElasticsearchBackend(config.Elasticsearch); err != nil {
		log.Fatal(err)
	}
	if err := backend.InitMediaBackend(config.Media, config.GCS.Bucket); err != nil {
		log.Fatal(err)
	}
	server := &http.Server{
		Addr: *listenAddress, Handler: handler.InitRouter([]byte(config.Token.Secret)),
		ReadHeaderTimeout: 5 * time.Second,
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("Listening on %s", listener.Addr())
	log.Fatal(server.Serve(listener))
}
