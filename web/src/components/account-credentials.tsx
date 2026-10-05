import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { SecretShown } from '~/components/secret-shown'
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Skeleton,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { CredentialCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'
import { generatedSystemId } from '~/lib/system-id'

type Credential = components['schemas']['Credential']
type CredentialType = components['schemas']['CredentialType']
type Pending =
  | { readonly kind: 'create' | 'rotate' | 'revoke'; readonly type: CredentialType }
  | { readonly kind: 'secret'; readonly type: CredentialType; readonly secret: string }

const accountsQueryKey = ['gateway', 'accounts'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
const WRITE_REFUSAL = 'Créer ou révoquer un identifiant demande credentials:write.'
const ROTATE_REFUSAL = 'Faire tourner un identifiant demande credentials:rotate.'
const TYPES: readonly CredentialType[] = ['smpp_bind', 'api_key']
const DEFAULT_GRACE = '86400'
const GRACES = [
  { value: '0', label: 'Aucune', phrase: '' },
  { value: '3600', label: '1 heure', phrase: 'une heure' },
  { value: DEFAULT_GRACE, label: '24 heures', phrase: '24 heures' },
  { value: '604800', label: '7 jours', phrase: '7 jours' },
] as const

const KINDS: Record<
  CredentialType,
  {
    readonly title: string
    readonly object: string
    readonly none: string
    readonly secretTitle: string
    readonly secretUse: string
    readonly graceKept: (duration: string) => string
    readonly cutover: string
    readonly revived: string
    readonly creation: string
    readonly statuses: Record<Credential['status'], string>
    readonly created: string
    readonly alreadyRevoked: string
  }
> = {
  smpp_bind: {
    title: 'Identifiant SMPP',
    object: 'l’identifiant SMPP',
    none: 'Aucun identifiant SMPP',
    secretTitle: 'Mot de passe de l’identifiant SMPP',
    secretUse: 'il s’en sert pour se lier en SMPP',
    graceKept: (duration) =>
      `L’ancien mot de passe restera accepté pendant ${duration}. Aucun bind ouvert ne sera coupé.`,
    cutover: 'L’ancien mot de passe sera refusé dès maintenant',
    revived:
      'Cet identifiant redeviendra actif avec un nouveau mot de passe. L’ancien restera refusé.',
    creation:
      'La passerelle créera le mot de passe, et le tableau de bord ne l’affichera qu’une fois.',
    statuses: { active: 'Actif', disabled: 'Désactivé', revoked: 'Révoqué' },
    created: 'Créé le',
    alreadyRevoked: 'Cet identifiant est déjà révoqué.',
  },
  api_key: {
    title: 'Clé API',
    object: 'la clé API',
    none: 'Aucune clé API',
    secretTitle: 'Nouvelle clé API',
    secretUse: 'il la présente à chaque appel REST',
    graceKept: (duration) => `L’ancienne clé restera acceptée pendant ${duration}.`,
    cutover: 'L’ancienne clé sera refusée dès le prochain appel REST.',
    revived: 'Cette clé redeviendra active avec une nouvelle valeur. L’ancienne restera refusée.',
    creation: 'La passerelle créera la clé, et le tableau de bord ne l’affichera qu’une fois.',
    statuses: { active: 'Active', disabled: 'Désactivée', revoked: 'Révoquée' },
    created: 'Créée le',
    alreadyRevoked: 'Cette clé est déjà révoquée.',
  },
}

export function Credentials({
  accountId,
  accountName,
  onSecretClosed,
}: {
  readonly accountId: string
  readonly accountName: string
  readonly onSecretClosed: () => void
}) {
  const readable = usePermission('credentials:read')
  const writeRefusal = usePermission('credentials:write') ? undefined : WRITE_REFUSAL
  const rotateRefusal = usePermission('credentials:rotate') ? undefined : ROTATE_REFUSAL
  const [pending, setPending] = useState<Pending | null>(null)
  const credentials = useQuery({
    queryKey: [...accountsQueryKey, accountId, 'credentials'],
    queryFn: () =>
      orRefusal(
        api.GET('/accounts/{accountId}/credentials', { params: { path: { accountId } } }),
        'Les identifiants n’ont pas pu être lus',
      ),
    enabled: readable,
    retry: false,
  })
  const close = () => setPending(null)
  const showSecret = (type: CredentialType) => (secret: string) =>
    setPending({ kind: 'secret', type, secret })

  if (!readable) {
    return (
      <EmptyState
        description="Lire les identifiants d’un compte demande credentials:read."
        title="Les identifiants ne vous sont pas accessibles"
        titleAs="h2"
      />
    )
  }

  if (credentials.isPending) {
    return (
      <LoadingState label="Chargement des identifiants…">
        <Skeleton height={160} />
      </LoadingState>
    )
  }

  if (credentials.isError) {
    return (
      <ErrorState
        description={credentials.error.message}
        onRetry={() => void credentials.refetch()}
        title="Les identifiants n’ont pas pu être chargés"
        titleAs="h2"
      />
    )
  }

  const held = (type: CredentialType) =>
    credentials.data.find((credential) => credential.type === type)
  const current = pending === null || pending.kind === 'create' ? undefined : held(pending.type)

  return (
    <>
      <div className="card-grid">
        {TYPES.map((type) => (
          <CredentialCard
            credential={held(type)}
            key={type}
            onCreate={() => setPending({ kind: 'create', type })}
            onRevoke={() => setPending({ kind: 'revoke', type })}
            onRotate={() => setPending({ kind: 'rotate', type })}
            rotateRefusal={rotateRefusal}
            type={type}
            writeRefusal={writeRefusal}
          />
        ))}
      </div>

      {pending?.kind === 'create' && pending.type === 'smpp_bind' ? (
        <CreateSmppCredential
          accountId={accountId}
          accountName={accountName}
          onClose={close}
          onCreated={showSecret('smpp_bind')}
        />
      ) : null}
      {pending?.kind === 'create' && pending.type === 'api_key' ? (
        <CreateApiKey accountId={accountId} onClose={close} onCreated={showSecret('api_key')} />
      ) : null}
      {pending?.kind === 'rotate' && current !== undefined ? (
        <ConfirmRotation
          accountId={accountId}
          credential={current}
          onClose={close}
          onRotated={showSecret(current.type)}
        />
      ) : null}
      {pending?.kind === 'revoke' && current !== undefined ? (
        <ConfirmRevocation accountId={accountId} credential={current} onClose={close} />
      ) : null}
      {pending?.kind === 'secret' ? (
        <SecretShown
          onClose={() => {
            close()
            onSecretClosed()
          }}
          secret={pending.secret}
          title={KINDS[pending.type].secretTitle}
        >
          Ce secret ne sera plus jamais affiché. Transmettez-le au client par un canal sûr :{' '}
          {KINDS[pending.type].secretUse}.
        </SecretShown>
      ) : null}
    </>
  )
}

function CredentialCard({
  type,
  credential,
  writeRefusal,
  rotateRefusal,
  onCreate,
  onRotate,
  onRevoke,
}: {
  readonly type: CredentialType
  readonly credential: Credential | undefined
  readonly writeRefusal: string | undefined
  readonly rotateRefusal: string | undefined
  readonly onCreate: () => void
  readonly onRotate: () => void
  readonly onRevoke: () => void
}) {
  const kind = KINDS[type]

  if (credential === undefined) {
    return (
      <Card title={kind.title}>
        <EmptyState
          action={
            <Button {...blockedBy(writeRefusal)} onClick={onCreate} size="sm" variant="primary">
              Créer {kind.object}
            </Button>
          }
          description="La passerelle engendrera le secret, montré une seule fois."
          inline
          title={kind.none}
        />
      </Card>
    )
  }

  const revoked = credential.status === 'revoked'

  return (
    <Card
      actions={
        <div className="row-actions">
          <Button
            {...blockedBy(rotateRefusal)}
            aria-label={`Faire tourner ${kind.object}`}
            onClick={onRotate}
            size="sm"
          >
            Faire tourner
          </Button>
          <Button
            {...blockedBy(writeRefusal ?? (revoked ? kind.alreadyRevoked : undefined))}
            aria-label={`Révoquer ${kind.object}`}
            onClick={onRevoke}
            size="sm"
            variant="danger"
          >
            Révoquer
          </Button>
        </div>
      }
      subtitle={kind.statuses[credential.status]}
      title={kind.title}
    >
      <dl className="facts">
        {credential.systemId === null ? null : (
          <div>
            <dt>System ID</dt>
            <dd className="mono">{credential.systemId}</dd>
          </div>
        )}
        <div>
          <dt>Dernière utilisation</dt>
          <dd>
            {credential.lastUsedAt === null
              ? 'jamais'
              : dateTimeFormat.format(new Date(credential.lastUsedAt))}
          </dd>
        </div>
        <div>
          <dt>{kind.created}</dt>
          <dd>{dateFormat.format(new Date(credential.createdAt))}</dd>
        </div>
        <div>
          <dt>Rotation</dt>
          <dd>
            {credential.rotatedAt === null
              ? 'aucune'
              : `le ${dateFormat.format(new Date(credential.rotatedAt))}`}
          </dd>
        </div>
        {credential.status !== 'active' ||
        credential.graceExpiresAt === null ||
        new Date(credential.graceExpiresAt).getTime() <= Date.now() ? null : (
          <div>
            <dt>Ancien secret accepté jusqu’au</dt>
            <dd>{dateTimeFormat.format(new Date(credential.graceExpiresAt))}</dd>
          </div>
        )}
      </dl>
    </Card>
  )
}

function useCredentialMutation<Variables>(
  accountId: string,
  call: (variables: Variables) => Promise<{ readonly secret: string }>,
  onSecret: (secret: string) => void,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: call,
    // Le secret ne doit pas survivre dans le cache des mutations une fois la modale fermée (invariant b).
    gcTime: 0,
    onSuccess: async ({ secret }) => {
      await queryClient.invalidateQueries({
        queryKey: [...accountsQueryKey, accountId, 'credentials'],
      })
      onSecret(secret)
    },
  })
}

const SmppCreation = CredentialCreation.required({ systemId: true })

function CreateSmppCredential({
  accountId,
  accountName,
  onClose,
  onCreated,
}: {
  readonly accountId: string
  readonly accountName: string
  readonly onClose: () => void
  readonly onCreated: (secret: string) => void
}) {
  const form = useForm({
    resolver: formResolver(SmppCreation),
    defaultValues: { type: 'smpp_bind' as const, systemId: '' },
  })
  const create = useCredentialMutation(
    accountId,
    (body: components['schemas']['CredentialCreation']) =>
      orRefusal(
        api.POST('/accounts/{accountId}/credentials', { params: { path: { accountId } }, body }),
        'L’identifiant n’a pas été créé',
      ),
    onCreated,
  )
  const placed = fieldRefusalsOf(create.error).find(({ field }) => field === 'systemId')

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            form="create-smpp-credential"
            loading={create.isPending}
            type="submit"
            variant="primary"
          >
            Créer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Nouvel identifiant SMPP"
    >
      <form
        className="form"
        id="create-smpp-credential"
        noValidate
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <p>{KINDS.smpp_bind.creation} L’action est enregistrée dans le journal d’audit.</p>
        <Refusal error={placed === undefined ? create.error : null} />
        <Field error={form.formState.errors.systemId?.message ?? placed?.message} label="System ID">
          <Input
            autoComplete="off"
            className="ui-input--mono"
            maxLength={15}
            required
            {...form.register('systemId')}
          />
        </Field>
        <Button
          onClick={() =>
            form.setValue('systemId', generatedSystemId(accountName), { shouldValidate: true })
          }
          size="sm"
        >
          Générer un System ID
        </Button>
      </form>
    </Modal>
  )
}

function CreateApiKey({
  accountId,
  onClose,
  onCreated,
}: {
  readonly accountId: string
  readonly onClose: () => void
  readonly onCreated: (secret: string) => void
}) {
  const create = useCredentialMutation(
    accountId,
    () =>
      orRefusal(
        api.POST('/accounts/{accountId}/credentials', {
          params: { path: { accountId } },
          body: { type: 'api_key' },
        }),
        'La clé API n’a pas été créée',
      ),
    onCreated,
  )

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            loading={create.isPending}
            onClick={() => create.mutate(undefined)}
            variant="primary"
          >
            Créer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Créer la clé API ?"
    >
      <Refusal error={create.error} />
      <p>{KINDS.api_key.creation}</p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}

function useOpenBinds(accountId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...accountsQueryKey, accountId, 'sessions'],
    queryFn: () =>
      orRefusal(
        api.GET('/accounts/{accountId}/sessions', { params: { path: { accountId } } }),
        'Les binds ouverts n’ont pas pu être lus',
      ),
    enabled,
    retry: false,
  })
}

/** Le sujet d'une phrase qui annonce une coupure : chiffré quand on sait compter, entier sinon. */
function bindsCut(live: ReturnType<typeof useOpenBinds>) {
  const count = live.isSuccess ? live.data.active : undefined
  if (count === undefined) return 'tous les binds ouverts de ce compte seront coupés'
  if (count === 1) return 'le bind ouvert de ce compte sera coupé'
  return `les ${count} binds ouverts de ce compte seront coupés`
}

function capitalized(sentence: string) {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

function ConfirmRotation({
  accountId,
  credential,
  onClose,
  onRotated,
}: {
  readonly accountId: string
  readonly credential: Credential
  readonly onClose: () => void
  readonly onRotated: (secret: string) => void
}) {
  const kind = KINDS[credential.type]
  const revived = credential.status === 'revoked'
  const [grace, setGrace] = useState<string>(DEFAULT_GRACE)
  const cutsBinds = credential.type === 'smpp_bind' && !revived && grace === '0'
  const live = useOpenBinds(accountId, cutsBinds)
  const rotate = useCredentialMutation(
    accountId,
    (body: components['schemas']['CredentialRotation']) =>
      orRefusal(
        api.POST('/accounts/{accountId}/credentials/{credentialId}/rotate', {
          params: { path: { accountId, credentialId: credential.id } },
          body,
        }),
        'L’identifiant n’a pas tourné',
      ),
    onRotated,
  )
  const duration = GRACES.find(({ value }) => value === grace)?.phrase ?? ''

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            loading={rotate.isPending}
            onClick={() => rotate.mutate(revived ? {} : { gracePeriodSec: Number(grace) })}
            variant="danger"
          >
            Faire tourner
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Faire tourner ${kind.object} ?`}
    >
      <Refusal error={rotate.error} />
      {revived ? (
        <p>{kind.revived}</p>
      ) : (
        <>
          <Select
            label="Fenêtre de grâce"
            onValueChange={(value) => setGrace(value as string)}
            options={GRACES}
            value={grace}
          />
          <p aria-live="polite">
            {grace !== '0'
              ? kind.graceKept(duration)
              : credential.type === 'api_key'
                ? kind.cutover
                : live.isPending
                  ? 'Lecture des binds ouverts…'
                  : live.data?.active === 0
                    ? `${kind.cutover}. Aucun bind n’est ouvert sur ce compte.`
                    : `${kind.cutover}, et ${bindsCut(live)}.`}
          </p>
        </>
      )}
      <p>Un nouveau secret sera créé et affiché une seule fois.</p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}

function ConfirmRevocation({
  accountId,
  credential,
  onClose,
}: {
  readonly accountId: string
  readonly credential: Credential
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const kind = KINDS[credential.type]
  const smpp = credential.type === 'smpp_bind'
  const live = useOpenBinds(accountId, smpp)
  const revoke = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/accounts/{accountId}/credentials/{credentialId}', {
          params: { path: { accountId, credentialId: credential.id } },
        }),
        'L’identifiant n’a pas été révoqué',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...accountsQueryKey, accountId] })
      onClose()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={revoke.isPending} onClick={() => revoke.mutate()} variant="danger">
            Révoquer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Révoquer ${kind.object} ?`}
    >
      <Refusal error={revoke.error} />
      {smpp ? (
        <p aria-live="polite">
          {live.isPending
            ? 'Lecture des binds ouverts…'
            : live.data?.active === 0
              ? 'Aucun bind n’est ouvert sur ce compte.'
              : `${capitalized(bindsCut(live))}.`}{' '}
          Le client ne pourra plus se lier en SMPP.
        </p>
      ) : (
        <p>Tout appel REST avec cette clé sera refusé. Aucun bind SMPP ne sera coupé.</p>
      )}
      <p>
        Pour rétablir l’accès, il faudra {smpp ? 'le' : 'la'} faire tourner : un nouveau secret sera
        créé.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}
