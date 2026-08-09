package handlers

import (
	"sync"

	"groceries/models"
)

// Hub is an in-process pub/sub for live events. Publishers never block:
// subscribers whose buffer is full have the event dropped (non-blocking
// send under the lock, so unsubscription can never race a send).
type Hub struct {
	mu   sync.Mutex
	subs map[chan models.Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: make(map[chan models.Event]struct{})}
}

// Subscribe registers a new subscriber and returns its event channel. The
// channel is buffered so slow readers get dropped events rather than
// stalling the publisher.
func (h *Hub) Subscribe() chan models.Event {
	ch := make(chan models.Event, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

// Unsubscribe removes a subscriber and closes its channel so a blocked
// reader can observe the stream ending. Called under the same lock as
// Publish, so a channel can never be closed while a send is in flight.
func (h *Hub) Unsubscribe(ch chan models.Event) {
	h.mu.Lock()
	if _, ok := h.subs[ch]; ok {
		delete(h.subs, ch)
		close(ch)
	}
	h.mu.Unlock()
}

// Publish delivers an event to every subscriber without blocking. A
// subscriber whose buffer is full silently misses this event.
func (h *Hub) Publish(e models.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
		}
	}
}
