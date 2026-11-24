package constants

import (
	"os"
	"path/filepath"
	"testing"
)

func localEnvironment(t *testing.T) {
	t.Helper()
	t.Setenv("MEDIA_STORAGE", "local")
	t.Setenv("MEDIA_LOCAL_DIR", filepath.Join(t.TempDir(), "media"))
	t.Setenv("MEDIA_PUBLIC_BASE_URL", "/api/backend/media")
	t.Setenv("NETWORKAI_CONFIG_FILE", "")
	t.Setenv("NETWORKAI_CONFIG_SECRET", "")
	t.Setenv("ES_URL", "http://elasticsearch:9200")
	t.Setenv("ES_USERNAME", "local-user")
	t.Setenv("ES_PASSWORD", "test-only-password")
	t.Setenv("JWT_SECRET", "test-only-signing-key-with-at-least-32-bytes")
}

func TestLocalApplicationConfigUsesEnvironmentWithoutCloudFiles(t *testing.T) {
	localEnvironment(t)
	config, err := LoadApplicationConfig()
	if err != nil {
		t.Fatal(err)
	}
	if config.Media.Storage != "local" || config.Media.PublicBaseURL != "/api/backend/media" ||
		config.Elasticsearch.URL != "http://elasticsearch:9200" || config.Media.LocalDir != os.Getenv("MEDIA_LOCAL_DIR") {
		t.Fatalf("local configuration was not applied: %+v", config.Media)
	}
}

func TestExplicitConfigurationFileIsStillValidated(t *testing.T) {
	localEnvironment(t)
	t.Setenv("NETWORKAI_CONFIG_FILE", filepath.Join(t.TempDir(), "missing.yml"))
	if _, err := LoadApplicationConfig(); err == nil {
		t.Fatal("an explicit missing config file should fail")
	}
}

func TestLocalConfigRejectsInvalidModeAndWeakSigningKey(t *testing.T) {
	localEnvironment(t)
	t.Setenv("JWT_SECRET", "short")
	if _, err := LoadApplicationConfig(); err == nil {
		t.Fatal("a weak signing key should fail")
	}
	t.Setenv("JWT_SECRET", "test-only-signing-key-with-at-least-32-bytes")
	t.Setenv("MEDIA_STORAGE", "unknown")
	if _, err := LoadApplicationConfig(); err == nil {
		t.Fatal("an unknown storage mode should fail")
	}
}
