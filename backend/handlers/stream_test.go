package handlers_test

// SSE frame format
//
// GET /api/events/stream is a server-sent-events endpoint. Each event is
// delivered as one complete SSE frame consisting of a single `data:` line
// holding the event JSON, followed by a blank line:
//
//	data: {"id":"evt-1","clientId":"test-client","lamport":1,"timestamp":"...","entityId":"shop-1","type":"ShopCreated","payload":{...}}
//
// There is NO `event:` line and no multi-line `data:` continuation. The
// response Content-Type must be "text/event-stream".

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"groceries/handlers"
	"groceries/models"
)

// streamLines reads all lines from an SSE response body and forwards them on
// the returned channel, closing the channel when the body ends.
func streamLines(t *testing.T, resp *http.Response) <-chan string {
	t.Helper()
	ch := make(chan string, 32)
	go func() {
		defer close(ch)
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			ch <- sc.Text()
		}
	}()
	return ch
}

func openStream(t *testing.T, srvURL, query string) (*http.Response, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, srvURL+"/api/events/stream"+query, nil)
	require.NoError(t, err)
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() {
		cancel()
		resp.Body.Close()
	})
	require.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	return resp, cancel
}

func decodeDataLine(t *testing.T, line string) models.Event {
	t.Helper()
	require.True(t, strings.HasPrefix(line, "data: "), "SSE frame must be a single data line, got %q", line)
	var e models.Event
	require.NoError(t, json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &e))
	return e
}

func TestStream_LiveDelivery(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	resp, cancel := openStream(t, srv.URL, "")
	defer cancel()

	lines := streamLines(t, resp)

	// Give the handler time to register the subscription before publishing.
	time.Sleep(100 * time.Millisecond)

	want := makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "Corner", "color": "red"})
	doPublish(t, srv, want)

	select {
	case line, ok := <-lines:
		require.True(t, ok, "stream closed before delivering the live event")
		got := decodeDataLine(t, line)
		require.Equal(t, want.ID, got.ID)
		require.Equal(t, want.Type, got.Type)
		require.Equal(t, want.EntityID, got.EntityID)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for live event on /api/events/stream")
	}
}

func TestStream_CatchUp(t *testing.T) {
	db := newTestDB(t)
	hub := handlers.NewHub()
	srv := newTestServer(t, db, hub)

	doPublish(t, srv,
		makeEvent(t, models.EventShopCreated, "shop-1", map[string]any{"name": "A", "color": "red"}),
		makeEvent(t, models.EventShopCreated, "shop-2", map[string]any{"name": "B", "color": "blue"}),
	)

	resp, cancel := openStream(t, srv.URL, "?since=1")
	defer cancel()

	lines := streamLines(t, resp)

	// The first frame is the catch-up event (seq 2), delivered immediately.
	select {
	case line, ok := <-lines:
		require.True(t, ok, "stream closed before delivering the catch-up event")
		require.False(t, strings.HasPrefix(line, "event:"), "SSE frames must not carry an event: line, got %q", line)
		got := decodeDataLine(t, line)
		require.Equal(t, "shop-2", got.EntityID)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for catch-up event on /api/events/stream")
	}

	// Exactly one frame: no further data line may arrive once the catch-up
	// event has been delivered.
	select {
	case line := <-lines:
		t.Fatalf("unexpected extra frame after catch-up: %q", line)
	case <-time.After(250 * time.Millisecond):
	}
}
