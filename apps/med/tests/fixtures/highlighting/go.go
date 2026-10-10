//go:build ignore

package cache

import (
	"fmt"
	str "strings"
)

const (
	Limit = 1_000 // entries
	iota  = iota
)

type Entry[K comparable, V any] struct {
	key   K
	value *V
	store.Map[K, []V]
	load func(context.Context) (Repo, error)
}

func (c *Cache[K, V]) Get(key K) (V, bool) {
	if e, ok := c.items[key]; ok && len(e.value) > 0 {
		return *e.value, true
	}
	p.error = fmt.Errorf("missing %q: %v", key, toString(key))
	return c.zero, false
}
