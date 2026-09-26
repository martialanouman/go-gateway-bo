package hub

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTwoCandidatesGetASingleLease(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	first := lease{rdb: rdb, key: namespace, holder: "a", ttl: time.Minute}
	second := lease{rdb: rdb, key: namespace, holder: "b", ttl: time.Minute}

	held, err := first.acquire(t.Context())
	require.NoError(t, err)
	assert.True(t, held)

	held, err = second.acquire(t.Context())
	require.NoError(t, err)
	assert.False(t, held)
}

// Un porteur qui a perdu son bail ne doit pas prolonger celui de son successeur : les deux
// consommeraient la passerelle.
func TestRenewalFailsOnceTheLeaseChangedHands(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	former := lease{rdb: rdb, key: namespace, holder: "a", ttl: time.Minute}
	require.NoError(t, rdb.Set(t.Context(), namespace, "b", time.Minute).Err())

	renewed, err := former.renew(t.Context())
	require.NoError(t, err)
	assert.False(t, renewed)
	assert.Equal(t, "b", rdb.Get(t.Context(), namespace).Val())
}

func TestRenewalExtendsTheHoldersLease(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	holder := lease{rdb: rdb, key: namespace, holder: "a", ttl: time.Minute}
	require.NoError(t, rdb.Set(t.Context(), namespace, "a", time.Second).Err())

	renewed, err := holder.renew(t.Context())
	require.NoError(t, err)
	assert.True(t, renewed)
	assert.Greater(t, rdb.PTTL(t.Context(), namespace).Val(), 30*time.Second)
}

func TestReleaseNeverDeletesAnotherHoldersLease(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	require.NoError(t, rdb.Set(t.Context(), namespace, "b", time.Minute).Err())

	require.NoError(t, lease{rdb: rdb, key: namespace, holder: "a", ttl: time.Minute}.release(t.Context()))
	assert.Equal(t, "b", rdb.Get(t.Context(), namespace).Val())

	require.NoError(t, lease{rdb: rdb, key: namespace, holder: "b", ttl: time.Minute}.release(t.Context()))
	assert.Zero(t, rdb.Exists(t.Context(), namespace).Val())
}

// Un renouvellement appliqué mais lu comme un échec laisse le bail à son porteur : le reprendre ne
// doit pas attendre son expiration.
func TestAHolderReacquiresItsOwnLease(t *testing.T) {
	t.Parallel()

	rdb, namespace := redisFor(t)
	require.NoError(t, rdb.Set(t.Context(), namespace, "a", time.Second).Err())

	held, err := lease{rdb: rdb, key: namespace, holder: "a", ttl: time.Minute}.acquire(t.Context())
	require.NoError(t, err)
	assert.True(t, held)
	assert.Greater(t, rdb.PTTL(t.Context(), namespace).Val(), 30*time.Second)
}
