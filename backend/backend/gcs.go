package backend

import (
	"context"
	"fmt"
	"io"
	"mime"
	"time"

	"cloud.google.com/go/storage"
)

var GCSBackend *GoogleCloudStorageBackend

type GoogleCloudStorageBackend struct {
	client *storage.Client
	bucket string
}

func InitGCSBackend(bucket string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	client, err := storage.NewClient(ctx)
	if err != nil {
		return fmt.Errorf("initialize Cloud Storage: %w", err)
	}
	attrs, err := client.Bucket(bucket).Attrs(ctx)
	if err != nil {
		client.Close()
		return fmt.Errorf("check Cloud Storage bucket %s: %w", bucket, err)
	}
	if attrs.UniformBucketLevelAccess.Enabled || attrs.PublicAccessPrevention == storage.PublicAccessPreventionEnforced {
		client.Close()
		return fmt.Errorf("Cloud Storage bucket %s must allow object-level public ACLs for Lesson33", bucket)
	}
	GCSBackend = &GoogleCloudStorageBackend{client: client, bucket: bucket}
	return nil
}

func (backend *GoogleCloudStorageBackend) SaveToGCS(ctx context.Context, r io.Reader, objectName, contentType string) (string, error) {
	if backend == nil || backend.client == nil {
		return "", fmt.Errorf("Cloud Storage backend is not initialized")
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	object := backend.client.Bucket(backend.bucket).Object(objectName).If(storage.Conditions{DoesNotExist: true})
	writer := object.NewWriter(ctx)
	writer.ChunkSize = 256 << 10
	writer.ContentType = contentType
	writer.ContentDisposition = mime.FormatMediaType("attachment", map[string]string{"filename": objectName})
	// Only this newly uploaded object is public. The bucket and its default ACL remain private.
	writer.PredefinedACL = "publicRead"
	if _, err := io.Copy(writer, r); err != nil {
		cancel()
		_ = writer.Close()
		return "", fmt.Errorf("write Cloud Storage object %s: %w", objectName, err)
	}
	if err := writer.Close(); err != nil {
		return "", fmt.Errorf("commit Cloud Storage object %s: %w", objectName, err)
	}
	return writer.Attrs().MediaLink, nil
}
