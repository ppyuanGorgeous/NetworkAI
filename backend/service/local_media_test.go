package service

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"networkai/backend"
	"networkai/constants"
	"networkai/model"
)

func TestDeletePostChecksOwnerBeforeRemovingLocalMedia(t *testing.T) {
	directory := t.TempDir()
	local, err := backend.NewLocalMediaStorage(directory, "/api/backend/media")
	if err != nil {
		t.Fatal(err)
	}
	mediaURL, err := local.Save(context.Background(), strings.NewReader("media bytes"), "post123.png", "image/png")
	if err != nil {
		t.Fatal(err)
	}
	deleted := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodHead:
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/":
			_, _ = w.Write([]byte(`{"version":{"number":"7.17.29"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/post/_doc/post123":
			_ = json.NewEncoder(w).Encode(map[string]any{"found": true, "_source": model.Post{Id: "post123", User: "owner", Url: mediaURL}})
		case r.Method == http.MethodPost && r.URL.Path == "/post/_delete_by_query":
			var query map[string]any
			if err := json.NewDecoder(r.Body).Decode(&query); err != nil {
				t.Error(err)
			}
			encoded, _ := json.Marshal(query)
			if !bytes.Contains(encoded, []byte(`"owner"`)) {
				t.Errorf("delete query lost owner filter: %s", encoded)
			}
			deleted = true
			_, _ = w.Write([]byte(`{"deleted":1,"timed_out":false,"failures":[]}`))
		default:
			t.Errorf("unexpected Elasticsearch request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
		}
	}))
	defer server.Close()
	oldES, oldMedia := backend.ESBackend, backend.MediaBackend
	t.Cleanup(func() { backend.ESBackend, backend.MediaBackend = oldES, oldMedia })
	if err := backend.InitElasticsearchBackend(constants.ElasticsearchConfig{URL: server.URL, Username: "test", Password: "test"}); err != nil {
		t.Fatal(err)
	}
	backend.MediaBackend = local
	if removed, err := DeletePost(context.Background(), "post123", "otheruser"); err != nil || removed || deleted {
		t.Fatalf("non-owner delete: removed=%v db-deleted=%v error=%v", removed, deleted, err)
	}
	if _, err := os.Stat(filepath.Join(directory, "post123.png")); err != nil {
		t.Fatal("non-owner removed media")
	}
	if removed, err := DeletePost(context.Background(), "post123", "owner"); err != nil || !removed || !deleted {
		t.Fatalf("owner delete: removed=%v db-deleted=%v error=%v", removed, deleted, err)
	}
	if _, err := os.Stat(filepath.Join(directory, "post123.png")); !os.IsNotExist(err) {
		t.Fatal("owner delete left local media")
	}
}

func TestFailedPostIndexingRemovesLocalUpload(t *testing.T) {
	directory := t.TempDir()
	local, err := backend.NewLocalMediaStorage(directory, "/media")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodHead:
			w.WriteHeader(http.StatusOK)
		case r.URL.Path == "/":
			_, _ = w.Write([]byte(`{"version":{"number":"7.17.29"}}`))
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/post/"):
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"error":{"type":"test_failure","reason":"index rejected"},"status":400}`))
		default:
			t.Errorf("unexpected Elasticsearch request: %s %s", r.Method, r.URL.Path)
			http.Error(w, "unexpected request", http.StatusBadRequest)
		}
	}))
	defer server.Close()
	oldES, oldMedia := backend.ESBackend, backend.MediaBackend
	t.Cleanup(func() { backend.ESBackend, backend.MediaBackend = oldES, oldMedia })
	if err := backend.InitElasticsearchBackend(constants.ElasticsearchConfig{URL: server.URL, Username: "test", Password: "test"}); err != nil {
		t.Fatal(err)
	}
	backend.MediaBackend = local
	post := model.Post{Id: "failed123", User: "owner", Message: "test post"}
	if err := SavePost(context.Background(), &post, strings.NewReader("image bytes"), ".png", "image/png"); err == nil {
		t.Fatal("indexing should fail")
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 0 {
		t.Fatalf("failed indexing left media files: %v, error=%v", entries, err)
	}
}
