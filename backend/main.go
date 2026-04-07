package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"grocery/db"
	"grocery/handlers"
)

//go:embed all:frontend/dist
var staticFiles embed.FS

func main() {
	dbPath := flag.String("db", "./grocery.db", "path to SQLite database file")
	port := flag.String("port", "8080", "HTTP listen port")
	flag.Parse()

	database, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer database.Close()
	log.Printf("database opened: %s", *dbPath)

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(corsMiddleware)

	// API routes
	r.Get("/api/bootstrap", handlers.Bootstrap(database))
	r.Post("/api/sync", handlers.Sync(database))

	// SPA static files
	r.Get("/*", spaHandler())

	addr := ":" + *port
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}

func spaHandler() http.HandlerFunc {
	distFS, err := fs.Sub(staticFiles, "frontend/dist")
	if err != nil {
		return func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend not built", http.StatusServiceUnavailable)
		}
	}
	fileServer := http.FileServer(http.FS(distFS))

	return func(w http.ResponseWriter, r *http.Request) {
		// Strip leading slash to get a clean path within the FS
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else {
			path = strings.TrimPrefix(path, "/")
		}

		// Try to open the file; fall back to index.html (SPA client-side routing)
		f, openErr := distFS.Open(path)
		if openErr != nil {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		f.Close()
		fileServer.ServeHTTP(w, r)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
