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

func (l lease) acquire(ctx context.Context) (bool, error) {
	return l.rdb.SetNX(ctx, l.key, l.holder, l.ttl).Result()
}

func (l lease) renew(ctx context.Context) (bool, error) {
	renewed, err := renewScript.Run(ctx, l.rdb, []string{l.key}, l.holder, l.ttl.Milliseconds()).Int()

	return renewed == 1, err
}

func (l lease) release(ctx context.Context) error {
	return releaseScript.Run(ctx, l.rdb, []string{l.key}, l.holder).Err()
}
