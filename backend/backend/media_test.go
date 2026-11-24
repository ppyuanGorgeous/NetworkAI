package backend

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalMediaLifecycleAndRelativeURL(t *testing.T) {
	directory := t.TempDir()
	local, err := NewLocalMediaStorage(directory, "/api/backend/media/")
	if err != nil {
		t.Fatal(err)
	}
	old := MediaBackend
	MediaBackend = local
	t.Cleanup(func() { MediaBackend = old })
	contents := []byte("local media bytes")
	mediaURL, err := SaveMedia(context.Background(), bytes.NewReader(contents), "example.png", "image/png")
	if err != nil || mediaURL != "/api/backend/media/example.png" {
		t.Fatalf("url=%q error=%v", mediaURL, err)
	}
	if _, err := local.Save(context.Background(), bytes.NewReader([]byte("replacement")), "example.png", "image/png"); err == nil {
		t.Fatal("an existing media object must not be overwritten")
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		request := httptest.NewRequest(method, "/media/example.png", nil)
		response := httptest.NewRecorder()
		LocalMediaHandler().ServeHTTP(response, request)
		if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "image/png" {
			t.Fatalf("%s status=%d content-type=%s", method, response.Code, response.Header().Get("Content-Type"))
		}
		if method == http.MethodGet && !bytes.Equal(response.Body.Bytes(), contents) {
			t.Fatalf("download differs: %q", response.Body.Bytes())
		}
		if method == http.MethodHead && response.Body.Len() != 0 {
			t.Fatal("HEAD must not return file contents")
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/media/example.png", nil)
	request.Header.Set("Range", "bytes=0-4")
	response := httptest.NewRecorder()
	LocalMediaHandler().ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "local" {
		t.Fatalf("range response=%d %q", response.Code, response.Body.String())
	}
	if err := DeleteMedia(context.Background(), "https://old-cloud.example/example.png"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(directory, "example.png")); err != nil {
		t.Fatal("an unrelated cloud URL must not remove a local file")
	}
	if err := DeleteMedia(context.Background(), mediaURL); err != nil {
		t.Fatal(err)
	}
	if err := DeleteMedia(context.Background(), mediaURL); err != nil {
		t.Fatal("deleting an already-removed object should be harmless")
	}
	if _, err := os.Stat(filepath.Join(directory, "example.png")); !os.IsNotExist(err) {
		t.Fatal("deleted media still exists")
	}
}

func TestLocalMediaRejectsPathsAndSymlinks(t *testing.T) {
	local, err := NewLocalMediaStorage(t.TempDir(), "/api/backend/media")
	if err != nil {
		t.Fatal(err)
	}
	old := MediaBackend
	MediaBackend = local
	t.Cleanup(func() { MediaBackend = old })
	for _, name := range []string{"../outside.png", "sub/file.png", "..", ".private.png", "page.html", `sub\file.png`} {
		if _, err := local.Save(context.Background(), bytes.NewReader([]byte("x")), name, "image/png"); err == nil {
			t.Errorf("accepted unsafe name %q", name)
		}
	}
	outside := filepath.Join(t.TempDir(), "outside.png")
	if err := os.WriteFile(outside, []byte("must not be served"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(local.directory, "link.png")); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/media/", "/media/../outside.png", "/media/link.png"} {
		response := httptest.NewRecorder()
		LocalMediaHandler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("path %q returned %d", path, response.Code)
		}
	}
	if err := local.Delete(context.Background(), "/api/backend/media/%2e%2e%2foutside.png"); err == nil {
		t.Fatal("accepted traversal in media URL")
	}
}

type failedReader struct{}

func (failedReader) Read(buffer []byte) (int, error) {
	copy(buffer, "partial")
	return len("partial"), errors.New("interrupted upload")
}

func TestLocalMediaCleansPartialUploads(t *testing.T) {
	local, err := NewLocalMediaStorage(t.TempDir(), "/media")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	for _, test := range []struct {
		ctx    context.Context
		reader io.Reader
	}{
		{context.Background(), failedReader{}},
		{ctx, bytes.NewReader([]byte("canceled"))},
	} {
		if _, err := local.Save(test.ctx, test.reader, "incomplete.png", "image/png"); err == nil {
			t.Fatal("expected the failed upload to fail")
		}
		if _, err := os.Stat(filepath.Join(local.directory, "incomplete.png")); !os.IsNotExist(err) {
			t.Fatal("failed upload left a partial media file")
		}
	}
}

func TestMediaBaseURLValidation(t *testing.T) {
	for _, base := range []string{"", "//untrusted.example/media", "file:///tmp/media", "https://user:password@example.com/media", "/media?token=secret", "media"} {
		if _, err := NewLocalMediaStorage(t.TempDir(), base); err == nil {
			t.Errorf("accepted base URL %q", base)
		}
	}
}
