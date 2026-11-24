package backend

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"networkai/constants"
)

// MediaStorage keeps local development independent of cloud credentials while
// retaining the existing Cloud Storage implementation for cloud deployments.
type MediaStorage interface {
	Save(context.Context, io.Reader, string, string) (string, error)
	Delete(context.Context, string) error
}

var MediaBackend MediaStorage

type cloudMediaStorage struct{}

func (cloudMediaStorage) Save(ctx context.Context, reader io.Reader, name, contentType string) (string, error) {
	return GCSBackend.SaveToGCS(ctx, reader, name, contentType)
}

// Cloud uploads keep their original lifecycle: removing a post does not remove
// the corresponding Cloud Storage object.
func (cloudMediaStorage) Delete(context.Context, string) error { return nil }

func InitMediaBackend(config constants.MediaConfig, bucket string) error {
	switch config.Storage {
	case "local":
		local, err := NewLocalMediaStorage(config.LocalDir, config.PublicBaseURL)
		if err != nil {
			return err
		}
		MediaBackend = local
		return nil
	case "gcs":
		if err := InitGCSBackend(bucket); err != nil {
			return err
		}
		MediaBackend = cloudMediaStorage{}
		return nil
	default:
		return fmt.Errorf("unsupported media storage mode")
	}
}

func SaveMedia(ctx context.Context, reader io.Reader, name, contentType string) (string, error) {
	if MediaBackend == nil {
		return "", fmt.Errorf("media storage is not initialized")
	}
	return MediaBackend.Save(ctx, reader, name, contentType)
}

func DeleteMedia(ctx context.Context, mediaURL string) error {
	if MediaBackend == nil {
		return nil
	}
	return MediaBackend.Delete(ctx, mediaURL)
}

type LocalMediaStorage struct {
	directory string
	baseURL   string
}

var mediaName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*\.(jpeg|jpg|gif|png|webp|mov|mp4|webm|avi|flv|wmv)$`)

func NewLocalMediaStorage(directory, publicBaseURL string) (*LocalMediaStorage, error) {
	if directory == "" {
		return nil, fmt.Errorf("local media directory is required")
	}
	base := strings.TrimRight(publicBaseURL, "/")
	parsed, err := url.Parse(base)
	if err != nil || base == "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.User != nil {
		return nil, fmt.Errorf("invalid local media public base URL")
	}
	if parsed.IsAbs() {
		if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return nil, fmt.Errorf("media public base URL must use HTTP or HTTPS")
		}
	} else if !strings.HasPrefix(base, "/") || strings.HasPrefix(base, "//") || parsed.Host != "" {
		return nil, fmt.Errorf("relative media public base URL must start with one slash")
	}
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, fmt.Errorf("create local media directory: %w", err)
	}
	return &LocalMediaStorage{directory: directory, baseURL: base}, nil
}

func (local *LocalMediaStorage) Save(ctx context.Context, reader io.Reader, name, _ string) (string, error) {
	if !mediaName.MatchString(name) {
		return "", fmt.Errorf("invalid media object name")
	}
	path := filepath.Join(local.directory, name)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return "", fmt.Errorf("create local media file: %w", err)
	}
	_, copyErr := io.Copy(file, contextReader{ctx, reader})
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(path)
		if copyErr != nil {
			return "", fmt.Errorf("write local media file: %w", copyErr)
		}
		return "", fmt.Errorf("close local media file: %w", closeErr)
	}
	return local.baseURL + "/" + url.PathEscape(name), nil
}

func (local *LocalMediaStorage) Delete(_ context.Context, mediaURL string) error {
	prefix := local.baseURL + "/"
	if !strings.HasPrefix(mediaURL, prefix) {
		// A restored post may refer to an older cloud object, not this local store.
		return nil
	}
	name, err := url.PathUnescape(strings.TrimPrefix(mediaURL, prefix))
	if err != nil || !mediaName.MatchString(name) {
		return fmt.Errorf("invalid media object URL")
	}
	err = os.Remove(filepath.Join(local.directory, name))
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

// LocalMediaHandler supports image/video GET and range requests without listing
// directories or allowing filenames outside the upload directory.
func LocalMediaHandler() http.Handler {
	local, ok := MediaBackend.(*LocalMediaStorage)
	if !ok {
		return http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/media/")
		if !mediaName.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		path := filepath.Join(local.directory, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		file, err := os.Open(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		w.Header().Set("Content-Type", mime.TypeByExtension(filepath.Ext(name)))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, name, info.ModTime(), file)
	})
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (reader contextReader) Read(buffer []byte) (int, error) {
	if err := reader.ctx.Err(); err != nil {
		return 0, err
	}
	return reader.reader.Read(buffer)
}
