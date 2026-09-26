package hub

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// lease est le bail qui désigne l'unique instance autorisée à consommer la passerelle.
type lease struct {
	rdb    *redis.Client
	key    string
	holder string
	ttl    time.Duration
}

// Comparer puis agir en un seul script : entre un GET et un PEXPIRE séparés, le bail peut expirer et
// changer de main, et l'ancien porteur prolongerait celui de son successeur.
var (
	acquireScript = redis.NewScript(`
if redis.call("SET", KEYS[1], ARGV[1], "NX", "PX", ARGV[2]) then
	return 1
end
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0`)

	renewScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0`)

	releaseScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0`)
)

// acquire prend le bail libre, ou reprend le sien : un renouvellement appliqué mais lu comme un échec
// ne doit pas faire attendre son expiration.
func (l lease) acquire(ctx context.Context) (bool, error) {
	acquired, err := acquireScript.Run(ctx, l.rdb, []string{l.key}, l.holder, l.ttl.Milliseconds()).Int()

	return acquired == 1, err
}

func (l lease) renew(ctx context.Context) (bool, error) {
	renewed, err := renewScript.Run(ctx, l.rdb, []string{l.key}, l.holder, l.ttl.Milliseconds()).Int()

	return renewed == 1, err
}

func (l lease) release(ctx context.Context) error {
	return releaseScript.Run(ctx, l.rdb, []string{l.key}, l.holder).Err()
}
