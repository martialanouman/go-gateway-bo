import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Skeleton,
  StatusPill,
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { WebhookCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Account = components['schemas']['SmppAccount']
type Webhook = components['schemas']['Webhook']
type EventType = components['schemas']['WebhookEventType']
type SmppOp = 'querySm' | 'cancelSm'
type Pending =
  | { readonly kind: 'smpp-op'; readonly op: SmppOp }
  | { readonly kind: 'create-webhook' }
  | { readonly kind: 'rotate' | 'delete'; readonly webhook: Webhook }
  | { readonly kind: 'secret'; readonly secret: string }

const accountsQueryKey = ['gateway', 'accounts'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const WRITE_REFUSAL = 'Modifier un compte demande accounts:write.'
const EVENT_TYPES: readonly EventType[] = ['mo', 'dlr']
const EVENT_LABELS: Record<EventType, string> = {
  mo: 'MO — SMS entrants',
  dlr: 'DLR — accusés de réception',
}
const WEBHOOK_STATUS_LABELS: Record<Webhook['status'], string> = {
  active: 'Actif',
  disabled: 'Désactivé',
}
const SMPP_OPS: Record<SmppOp, string> = { querySm: 'query_sm', cancelSm: 'cancel_sm' }

export const Route = createFileRoute('/_shell/accounts_/$accountId')({
  component: AccountScreen,
})

function AccountScreen() {
  const { accountId } = Route.useParams()
  const [pending, setPending] = useState<Pending | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const blocked = blockedBy(usePermission('accounts:write') ? undefined : WRITE_REFUSAL)
  const close = () => setPending(null)
  const closeToTitle = () => {
    close()
    title.current?.focus()
  }
  const account = useQuery({
    queryKey: [...accountsQueryKey, 'detail', accountId],
    queryFn: () =>
      orRefusal(
        api.GET('/accounts/{accountId}', { params: { path: { accountId } } }),
        'La fiche du compte n’a pas pu être lue',
      ),
    retry: false,
  })

  if (account.isPending) {
    return (
      <div className="page">
        <LoadingState label="Chargement du compte…">
          <Skeleton height={32} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      </div>
    )
  }

  if (account.isError) {
    return (
      <div className="page">
        <ErrorState
          description={account.error.message}
          onRetry={() => void account.refetch()}
          title="La fiche du compte n’a pas pu être chargée"
        />
        <Link to="/accounts">Revenir à la liste des comptes</Link>
      </div>
    )
  }

  const current = account.data

  return (
    <div className="page">
      <header className="page__head">
        <div className="page__identity">
          <h1 className="page__title" ref={title} tabIndex={-1}>
            {current.name}
          </h1>
          <StatusPill kind="entity" state={current.status} />
        </div>
      </header>

      <p>
        <CustomerLink customerId={current.customerId} /> ·{' '}
        <Link search={{ customerId: current.customerId }} to="/accounts">
          Ses comptes
        </Link>{' '}
        · Créé le {dateFormat.format(new Date(current.createdAt))}
      </p>

      <Channels account={current} blocked={blocked} />
      <SmppOps
        account={current}
        blocked={blocked}
        onChange={(op) => setPending({ kind: 'smpp-op', op })}
      />
      <Webhooks
        accountId={current.id}
        blocked={blocked}
        onCreate={() => setPending({ kind: 'create-webhook' })}
        onDelete={(webhook) => setPending({ kind: 'delete', webhook })}
        onRotate={(webhook) => setPending({ kind: 'rotate', webhook })}
      />

      {pending?.kind === 'smpp-op' ? (
        <ConfirmSmppOp account={current} onClose={close} op={pending.op} />
      ) : null}
      {pending?.kind === 'create-webhook' ? (
        <CreateWebhook
          accountId={current.id}
          onClose={close}
          onCreated={(secret) => setPending({ kind: 'secret', secret })}
        />
      ) : null}
      {pending?.kind === 'rotate' ? (
        <ConfirmRotate
          accountId={current.id}
          onClose={close}
          onRotated={(secret) => setPending({ kind: 'secret', secret })}
          webhook={pending.webhook}
        />
      ) : null}
      {pending?.kind === 'delete' ? (
        <ConfirmDeleteWebhook
          accountId={current.id}
          onClose={close}
          onDone={closeToTitle}
          webhook={pending.webhook}
        />
      ) : null}
      {pending?.kind === 'secret' ? (
        <WebhookSecretShown onClose={closeToTitle} secret={pending.secret} />
      ) : null}
    </div>
  )
}

// La clé de la fiche client, partagée avec la liste des comptes.
function CustomerLink({ customerId }: { readonly customerId: string }) {
  const customer = useQuery({
    queryKey: ['gateway', 'customers', 'detail', customerId],
    queryFn: () =>
      orRefusal(
        api.GET('/customers/{customerId}', { params: { path: { customerId } } }),
        'Le client n’a pas pu être lu',
      ),
    enabled: usePermission('customers:read'),
    retry: false,
  })
  return (
    <Link params={{ customerId }} to="/customers/$customerId">
      {customer.data?.name ?? <span className="mono">{customerId}</span>}
    </Link>
  )
}

function useSetAccount(accountId: string) {
  const queryClient = useQueryClient()
  return (changed: Account) =>
    queryClient.setQueryData([...accountsQueryKey, 'detail', accountId], changed)
}

function Channels({
  account,
  blocked,
}: {
  readonly account: Account
  readonly blocked: ReturnType<typeof blockedBy>
}) {
  const toast = useToast()
  const setAccount = useSetAccount(account.id)
  const change = useMutation({
    mutationFn: (body: components['schemas']['AccountChannels']) =>
      orRefusal(
        api.PUT('/accounts/{accountId}/channels', {
          params: { path: { accountId: account.id } },
          body,
        }),
        'Le canal n’a pas été modifié',
      ),
    onSuccess: setAccount,
  })
  const channels = [
    { name: 'SMPP', other: 'REST', open: account.smppEnabled, field: 'smppEnabled' },
    { name: 'REST', other: 'SMPP', open: account.restEnabled, field: 'restEnabled' },
  ] as const
  const openCount = channels.filter((channel) => channel.open).length

  return (
    <section aria-labelledby="account-channels">
      <h2 id="account-channels">Canaux</h2>
      <Refusal error={change.error} />
      {channels.map((channel) => {
        const gesture = channel.open ? 'Couper' : 'Ouvrir'
        const last = channel.open && openCount === 1
        return (
          <div className="row-actions" key={channel.name}>
            <span>
              {channel.name} : {channel.open ? 'ouvert' : 'coupé'}
            </span>
            <Button
              {...(last
                ? blockedBy(
                    `Un compte garde au moins un canal : activez ${channel.other} avant de couper ${channel.name}.`,
                  )
                : blocked)}
              loading={change.isPending}
              onClick={() =>
                change.mutate(
                  {
                    smppEnabled: account.smppEnabled,
                    restEnabled: account.restEnabled,
                    [channel.field]: !channel.open,
                  },
                  {
                    onSuccess: () =>
                      toast({
                        title: `${channel.name} est ${channel.open ? 'coupé' : 'ouvert'} pour ${account.name}.`,
                        severity: 'success',
                      }),
                  },
                )
              }
              size="sm"
            >
              {`${gesture} ${channel.name}`}
            </Button>
          </div>
        )
      })}
    </section>
  )
}

function SmppOps({
  account,
  blocked,
  onChange,
}: {
  readonly account: Account
  readonly blocked: ReturnType<typeof blockedBy>
  readonly onChange: (op: SmppOp) => void
}) {
  return (
    <section aria-labelledby="account-smpp-ops">
      <h2 id="account-smpp-ops">Opérations SMPP</h2>
      {(Object.keys(SMPP_OPS) as SmppOp[]).map((op) => {
        const allowed = account[`${op}Enabled`]
        return (
          <div className="row-actions" key={op}>
            <span>
              <span className="mono">{SMPP_OPS[op]}</span> : {allowed ? 'autorisé' : 'refusé'}
            </span>
            <Button {...blocked} onClick={() => onChange(op)} size="sm">
              {`${allowed ? 'Refuser' : 'Autoriser'} ${SMPP_OPS[op]}`}
            </Button>
          </div>
        )
      })}
    </section>
  )
}

function ConfirmSmppOp({
  account,
  op,
  onClose,
}: {
  readonly account: Account
  readonly op: SmppOp
  readonly onClose: () => void
}) {
  const allowed = account[`${op}Enabled`]
  const gesture = allowed ? 'Refuser' : 'Autoriser'
  const setAccount = useSetAccount(account.id)
  const change = useMutation({
    mutationFn: (body: components['schemas']['AccountSmppOps']) =>
      orRefusal(
        api.PUT('/accounts/{accountId}/smpp-ops', {
          params: { path: { accountId: account.id } },
          body,
        }),
        'Le réglage n’a pas été modifié',
      ),
    onSuccess: setAccount,
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            loading={change.isPending}
            onClick={() =>
              change.mutate(
                {
                  querySmEnabled: account.querySmEnabled,
                  cancelSmEnabled: account.cancelSmEnabled,
                  [`${op}Enabled`]: !allowed,
                },
                { onSuccess: onClose },
              )
            }
            variant="primary"
          >
            {gesture}
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`${gesture} ${SMPP_OPS[op]} ?`}
    >
      <Refusal error={change.error} />
      <p>
        Les binds ouverts de ce compte seront coupés : ses clients devront se reconnecter, et le
        nouveau réglage s’appliquera dès leur reconnexion.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}

function Webhooks({
  accountId,
  blocked,
  onCreate,
  onRotate,
  onDelete,
}: {
  readonly accountId: string
  readonly blocked: ReturnType<typeof blockedBy>
  readonly onCreate: () => void
  readonly onRotate: (webhook: Webhook) => void
  readonly onDelete: (webhook: Webhook) => void
}) {
  const webhooks = useWebhooks(accountId)
  const full = webhooks.data?.length === EVENT_TYPES.length
  const create = (
    <Button
      {...(full
        ? blockedBy('Ce compte a déjà ses deux webhooks, MO et DLR : modifiez l’un d’eux.')
        : blocked)}
      onClick={onCreate}
      size="sm"
      variant="primary"
    >
      Nouveau webhook
    </Button>
  )

  return (
    <section aria-labelledby="account-webhooks">
      <div className="page__head">
        <h2 id="account-webhooks">Webhooks</h2>
        {create}
      </div>
      {webhooks.isPending ? (
        <LoadingState label="Chargement des webhooks…">
          <Skeleton height={38} />
        </LoadingState>
      ) : webhooks.isError ? (
        <ErrorState
          description={webhooks.error.message}
          onRetry={() => void webhooks.refetch()}
          title="Les webhooks n’ont pas pu être chargés"
          titleAs="h3"
        />
      ) : webhooks.data.length === 0 ? (
        <EmptyState
          description="Un webhook transmet au client ses SMS entrants (MO) ou ses accusés de réception (DLR)."
          title="Aucun webhook pour l’instant"
          titleAs="h3"
        />
      ) : (
        <DataTable
          caption="Webhooks du compte"
          columns={[
            {
              key: 'eventType',
              header: 'Événement',
              cell: (webhook: Webhook) => EVENT_LABELS[webhook.eventType],
            },
            {
              key: 'url',
              header: 'URL',
              cell: (webhook: Webhook) => <span className="mono">{webhook.url}</span>,
            },
            {
              key: 'status',
              header: 'Statut',
              cell: (webhook: Webhook) => WEBHOOK_STATUS_LABELS[webhook.status],
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (webhook: Webhook) => {
                const event = webhook.eventType.toUpperCase()
                return (
                  <div className="row-actions">
                    <WebhookStatusToggle
                      accountId={accountId}
                      blocked={blocked}
                      webhook={webhook}
                    />
                    <Button
                      {...blocked}
                      aria-label={`Remplacer le secret du webhook ${event}`}
                      onClick={() => onRotate(webhook)}
                      size="sm"
                    >
                      Remplacer le secret
                    </Button>
                    <Button
                      {...blocked}
                      aria-label={`Supprimer le webhook ${event}`}
                      onClick={() => onDelete(webhook)}
                      size="sm"
                      variant="danger"
                    >
                      Supprimer
                    </Button>
                  </div>
                )
              },
            },
          ]}
          rowKey={(webhook) => webhook.id}
          rows={webhooks.data}
        />
      )}
    </section>
  )
}

function useWebhooks(accountId: string) {
  return useQuery({
    queryKey: [...accountsQueryKey, accountId, 'webhooks'],
    queryFn: () =>
      orRefusal(
        api.GET('/accounts/{accountId}/webhooks', { params: { path: { accountId } } }),
        'Les webhooks n’ont pas pu être lus',
      ),
    retry: false,
  })
}

function WebhookStatusToggle({
  accountId,
  webhook,
  blocked,
}: {
  readonly accountId: string
  readonly webhook: Webhook
  readonly blocked: ReturnType<typeof blockedBy>
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const next = webhook.status === 'active' ? 'disabled' : 'active'
  const gesture = next === 'disabled' ? 'Désactiver' : 'Activer'
  const event = webhook.eventType.toUpperCase()
  const change = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PATCH('/accounts/{accountId}/webhooks/{webhookId}', {
          params: { path: { accountId, webhookId: webhook.id } },
          body: { status: next },
        }),
        'Le webhook n’a pas été modifié',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [...accountsQueryKey, accountId, 'webhooks'],
      })
      toast({
        title: `Le webhook ${event} est ${next === 'disabled' ? 'désactivé' : 'activé'}.`,
        severity: 'success',
      })
    },
    onError: (error) => toast({ title: error.message, severity: 'warning' }),
  })

  return (
    <Button
      {...blocked}
      aria-label={`${gesture} le webhook ${event}`}
      loading={change.isPending}
      onClick={() => change.mutate()}
      size="sm"
    >
      {gesture}
    </Button>
  )
}

function CreateWebhook({
  accountId,
  onClose,
  onCreated,
}: {
  readonly accountId: string
  readonly onClose: () => void
  readonly onCreated: (secret: string) => void
}) {
  const queryClient = useQueryClient()
  const webhooks = useWebhooks(accountId)
  const available = EVENT_TYPES.filter(
    (type) => !webhooks.data?.some((webhook) => webhook.eventType === type),
  )
  const form = useForm({
    resolver: formResolver(WebhookCreation),
    defaultValues: { eventType: available[0] ?? 'mo', url: '' },
  })
  const create = useMutation({
    mutationFn: (body: components['schemas']['WebhookCreation']) =>
      orRefusal(
        api.POST('/accounts/{accountId}/webhooks', { params: { path: { accountId } }, body }),
        'Le webhook n’a pas été créé',
      ),
    // Le secret ne doit pas survivre dans le cache des mutations une fois la modale fermée (invariant b).
    gcTime: 0,
    onSuccess: async ({ secret }) => {
      await queryClient.invalidateQueries({
        queryKey: [...accountsQueryKey, accountId, 'webhooks'],
      })
      onCreated(secret)
    },
    onError: (error) => {
      for (const { field, message } of fieldRefusalsOf(error)) {
        if (field === 'eventType' || field === 'url') form.setError(field, { message })
      }
    },
  })
  const placed = fieldRefusalsOf(create.error).some(
    ({ field }) => field === 'eventType' || field === 'url',
  )

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="create-webhook" loading={create.isPending} type="submit" variant="primary">
            Créer le webhook
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Nouveau webhook"
    >
      <form
        className="form"
        id="create-webhook"
        noValidate
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <p>
          Le tableau de bord créera le secret de signature et ne l’affichera qu’une fois. L’action
          est enregistrée dans le journal d’audit.
        </p>
        <Refusal error={placed ? null : create.error} />
        <Select
          label="Événement"
          onValueChange={(value) => form.setValue('eventType', value as EventType)}
          options={available.map((type) => ({ value: type, label: EVENT_LABELS[type] }))}
          value={form.watch('eventType')}
        />
        <Field error={form.formState.errors.url?.message} label="URL">
          <Input
            autoComplete="off"
            className="ui-input--mono"
            placeholder="https://"
            required
            type="url"
            {...form.register('url')}
          />
        </Field>
      </form>
    </Modal>
  )
}

function ConfirmRotate({
  accountId,
  webhook,
  onClose,
  onRotated,
}: {
  readonly accountId: string
  readonly webhook: Webhook
  readonly onClose: () => void
  readonly onRotated: (secret: string) => void
}) {
  const event = webhook.eventType.toUpperCase()
  const rotate = useMutation({
    mutationFn: () =>
      orRefusal(
        api.POST('/accounts/{accountId}/webhooks/{webhookId}/secret', {
          params: { path: { accountId, webhookId: webhook.id } },
        }),
        'Le secret n’a pas été remplacé',
      ),
    gcTime: 0,
    onSuccess: ({ secret }) => onRotated(secret),
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={rotate.isPending} onClick={() => rotate.mutate()} variant="danger">
            Remplacer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Remplacer le secret du webhook ${event} ?`}
    >
      <Refusal error={rotate.error} />
      <p>Un nouveau secret sera créé et affiché une seule fois.</p>
      <p>
        L’ancien secret cessera aussitôt de signer : le client rejettera les {event} tant qu’il
        n’aura pas installé le nouveau.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}

function WebhookSecretShown({
  secret,
  onClose,
}: {
  readonly secret: string
  readonly onClose: () => void
}) {
  return (
    <Modal
      footer={
        <Button onClick={onClose} variant="primary">
          J’ai copié le secret
        </Button>
      }
      onClose={onClose}
      open
      title="Secret de signature du webhook"
    >
      <p>
        Ce secret ne sera plus jamais affiché. Transmettez-le au client par un canal sûr : il s’en
        sert pour vérifier que chaque appel vient bien de la passerelle.
      </p>
      <p className="mono">{secret}</p>
    </Modal>
  )
}

function ConfirmDeleteWebhook({
  accountId,
  webhook,
  onClose,
  onDone,
}: {
  readonly accountId: string
  readonly webhook: Webhook
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const queryClient = useQueryClient()
  const event = webhook.eventType.toUpperCase()
  const remove = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/accounts/{accountId}/webhooks/{webhookId}', {
          params: { path: { accountId, webhookId: webhook.id } },
        }),
        'Le webhook n’a pas été supprimé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [...accountsQueryKey, accountId, 'webhooks'],
      })
      onDone()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={remove.isPending} onClick={() => remove.mutate()} variant="danger">
            Supprimer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Supprimer le webhook ${event} ?`}
    >
      <Refusal error={remove.error} />
      <p>
        La passerelle n’enverra plus les {event} de ce compte à{' '}
        <span className="mono">{webhook.url}</span>. Pour les recevoir de nouveau, il faudra créer
        un webhook, avec un nouveau secret.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}
