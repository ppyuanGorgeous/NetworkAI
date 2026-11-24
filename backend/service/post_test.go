package service

import (
	"encoding/json"
	"testing"

	"github.com/olivere/elastic/v7"
)

func TestDecodeSearchResults(t *testing.T) {
	var result elastic.SearchResult
	if err := json.Unmarshal([]byte(`{"hits":{"hits":[{"_id":"1","_source":{"id":"1","user":"sun","message":"你好，Elasticsearch","url":"https://www.laioffer.com","type":"image"}}]}}`), &result); err != nil {
		t.Fatal(err)
	}
	posts, err := getPostFromSearchResult(&result)
	if err != nil || len(posts) != 1 || posts[0].User != "sun" || posts[0].Message != "你好，Elasticsearch" {
		t.Fatalf("unexpected decoded posts: %v, error: %v", posts, err)
	}
	result.Hits.Hits[0].Source = json.RawMessage(`{"id":123}`)
	if _, err := getPostFromSearchResult(&result); err == nil {
		t.Fatal("expected an error for a document with an invalid field type")
	}
}

func TestEmptySearchResultsAreJSONArray(t *testing.T) {
	posts, err := getPostFromSearchResult(&elastic.SearchResult{})
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(posts)
	if err != nil || string(data) != "[]" {
		t.Fatalf("empty results = %s, error = %v", data, err)
	}
}
