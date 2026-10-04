import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { PageHeader } from '~/components/page-header'
import { CopyButton } from '~/components/totp-enrollment'
import {
  Banner,
  Button,
  Card,
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
  Switch,
  Tabs,
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { AccountSessionLimits, WebhookCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { MILESTONES } from '~/lib/navigation'
import { usePermission } from '~/lib/permissions'

type Account = components['schemas']['SmppAccount']
type Webhook = components['schemas']['Webhook']
type EventType = components['schemas']['WebhookEventType']
type BindType = components['schemas']['BindType']
type Limits = components['schemas']['AccountSessionLimits']
type OpenBind = components['schemas']['AccountSession']
type SmppOp = 'querySm' | 'cancelSm'
type Pending =
  | { readonly kind: 'smpp-op'; readonly op: SmppOp }
  | { readonly kind: 'create-webhook' }
  | { readonly kind: 'rotate' | 'delete'; readonly webhook: Webhook }
  | { readonly kind: 'secret'; readonly secret: string }

const accountsQueryKey = ['gateway', 'accounts'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })
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
const BIND_TYPES: Record<BindType, string> = {
  trx: 'émission et réception',
  tx: 'émission seule',
  rx: 'réception seule',
}

export const Route = createFileRoute('/_shell/accounts_/$accountId')({
  component: AccountScreen,
})

function AccountScreen() {
  const { accountId } = Route.useParams()
  const [pending, setPending] = useState<Pending | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const writeRefusal = usePermission('accounts:write') ? undefined : WRITE_REFUSAL
  const blocked = blockedBy(writeRefusal)
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
        <PageHeader crumbs={[{ label: 'Comptes', link: { to: '/accounts' } }]} title="Compte" />
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
        <PageHeader crumbs={[{ label: 'Comptes', link: { to: '/accounts' } }]} title="Compte" />
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
    <>
      <PageHeader
        actions={
          <Link
            className="ui-button ui-button--secondary ui-button--sm"
            search={{ customerId: current.customerId }}
            to="/accounts"
          >
            Ses comptes
          </Link>
        }
        badges={
          <>
            <StatusPill kind="entity" state={current.status} />
            <span className="page-header__meta">
              Créé le {dateFormat.format(new Date(current.createdAt))}
            </span>
          </>
        }
        crumbs={[
          { label: 'Clients', link: { to: '/customers' } },
          {
            label: <CustomerName customerId={current.customerId} />,
            link: { to: '/customers/$customerId', params: { customerId: current.customerId } },
          },
        ]}
        title={current.name}
        titleRef={title}
      />

      <Tabs
        defaultValue="settings"
        tabs={[
          {
            value: 'settings',
            label: 'Réglages',
            panel: (
              <div className="page">
                <div className="card-grid">
                  <Channels account={current} writeRefusal={writeRefusal} />
                  <SmppOps
                    account={current}
                    onChange={(op) => setPending({ kind: 'smpp-op', op })}
                    writeRefusal={writeRefusal}
                  />
                </div>
              </div>
            ),
          },
          {
            value: 'webhooks',
            label: 'Webhooks MO/DLR',
            panel: (
              <div className="page">
                <Webhooks
                  accountId={current.id}
                  blocked={blocked}
                  onCreate={() => setPending({ kind: 'create-webhook' })}
                  onDelete={(webhook) => setPending({ kind: 'delete', webhook })}
                  onRotate={(webhook) => setPending({ kind: 'rotate', webhook })}
                />
              </div>
            ),
          },
          {
            value: 'credentials',
            label: 'Identifiants',
            panel: (
              <div className="page">
                <EmptyState
                  description={`Le bind SMPP et la clé API REST arrivent avec le jalon M3 — ${MILESTONES.M3}. Tant qu’ils n’existent pas, ce compte ne peut pas se lier.`}
                  title="Les identifiants ne sont pas encore livrés"
                  titleAs="h2"
                />
              </div>
            ),
          },
          {
            value: 'quotas',
            label: 'Quotas & sessions',
            panel: (
              <div className="page">
                <Sessions account={current} writeRefusal={writeRefusal} />
              </div>
            ),
          },
        ]}
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
    </>
  )
}

// La clé de la fiche client, partagée avec la liste des comptes.
function CustomerName({ customerId }: { readonly customerId: string }) {
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
  return customer.data?.name ?? <span className="mono">{customerId}</span>
}

function useSetAccount(accountId: string) {
  const queryClient = useQueryClient()
  return (changed: Account) =>
    queryClient.setQueryData([...accountsQueryKey, 'detail', accountId], changed)
}

function Channels({
  account,
  writeRefusal,
}: {
  readonly account: Account
  readonly writeRefusal: string | undefined
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
    {
      name: 'SMPP',
      other: 'REST',
      hint: 'Les clients se lient en SMPP.',
      open: account.smppEnabled,
      field: 'smppEnabled',
    },
    {
      name: 'REST',
      other: 'SMPP',
      hint: 'Les clients envoient par l’API HTTP.',
      open: account.restEnabled,
      field: 'restEnabled',
    },
  ] as const
  const openCount = channels.filter((channel) => channel.open).length

  return (
    <Card subtitle="S’appliquent immédiatement" title="Canaux">
      <Refusal error={change.error} />
      {channels.map((channel) => (
        <Switch
          blockedReason={
            writeRefusal ??
            (channel.open && openCount === 1
              ? `Un compte garde au moins un canal : activez ${channel.other} avant de couper ${channel.name}.`
              : undefined)
          }
          checked={channel.open}
          description={channel.hint}
          key={channel.name}
          label={channel.name}
          onCheckedChange={(open) =>
            change.mutate(
              {
                smppEnabled: account.smppEnabled,
                restEnabled: account.restEnabled,
                [channel.field]: open,
              },
              {
                onSuccess: () =>
                  toast({
                    title: `${channel.name} est ${open ? 'ouvert' : 'coupé'} pour ${account.name}.`,
                    severity: 'success',
                  }),
              },
            )
          }
        />
      ))}
    </Card>
  )
}

const SMPP_OP_HINTS: Record<SmppOp, string> = {
  querySm: 'Le client interroge l’état d’un message.',
  cancelSm: 'Le client annule un message encore en attente.',
}

function SmppOps({
  account,
  writeRefusal,
  onChange,
}: {
  readonly account: Account
  readonly writeRefusal: string | undefined
  readonly onChange: (op: SmppOp) => void
}) {
  return (
    <Card
      subtitle="Tout changement coupe les binds ouverts de ce compte, après confirmation."
      title="Opérations SMPP"
    >
      {(Object.keys(SMPP_OPS) as SmppOp[]).map((op) => (
        <Switch
          blockedReason={writeRefusal}
          checked={account[`${op}Enabled`]}
          description={SMPP_OP_HINTS[op]}
          key={op}
          label={SMPP_OPS[op]}
          onCheckedChange={() => onChange(op)}
        />
      ))}
    </Card>
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

function binds(count: number) {
  return `${count} bind${count > 1 ? 's' : ''}`
}

function openBinds(count: number) {
  return `${binds(count)} ouvert${count > 1 ? 's' : ''}`
}

function Sessions({
  account,
  writeRefusal,
}: {
  readonly account: Account
  readonly writeRefusal: string | undefined
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const setAccount = useSetAccount(account.id)
  const [lowering, setLowering] = useState<Limits | null>(null)
  const sessionsKey = [...accountsQueryKey, account.id, 'sessions']
  const live = useQuery({
    queryKey: sessionsKey,
    queryFn: () =>
      orRefusal(
        api.GET('/accounts/{accountId}/sessions', { params: { path: { accountId: account.id } } }),
        'Les binds ouverts n’ont pas pu être lus',
      ),
    retry: false,
  })
  const form = useForm({
    resolver: formResolver(AccountSessionLimits),
    defaultValues: { maxSessions: account.maxSessions, allowedBindTypes: account.allowedBindTypes },
  })
  const save = useMutation({
    mutationFn: (body: Limits) =>
      orRefusal(
        api.PUT('/accounts/{accountId}/session-limits', {
          params: { path: { accountId: account.id } },
          body,
        }),
        'Les limites n’ont pas été enregistrées',
      ),
    onSuccess: async (changed) => {
      setAccount(changed)
      setLowering(null)
      await queryClient.invalidateQueries({ queryKey: sessionsKey })
      toast({
        title: `max_sessions vaut désormais ${changed.maxSessions} pour ${account.name}.`,
        severity: 'success',
      })
    },
  })
  const submit = (limits: Limits) =>
    live.isSuccess && limits.maxSessions < live.data.active
      ? setLowering(limits)
      : save.mutate(limits)

  return (
    <>
      {live.isSuccess && live.data.active > live.data.maxSessions ? (
        <Banner title={`${openBinds(live.data.active)} / limite ${live.data.maxSessions}`}>
          Le compte dépasse sa limite, mais aucun bind ouvert n’est coupé : la passerelle refusera
          tout nouveau bind tant que leur nombre ne sera pas repassé sous la limite. Pour converger
          plus tôt, il faudra déconnecter des binds depuis le moniteur de sessions, qui arrive avec
          le jalon M4 — {MILESTONES.M4}.
        </Banner>
      ) : null}
      <div className="card-grid">
        <Card subtitle="S’appliquent aux prochains binds" title="Limites">
          <form
            className="form"
            id="session-limits"
            noValidate
            onSubmit={form.handleSubmit(submit)}
          >
            <Refusal error={lowering === null ? save.error : null} />
            <Field
              error={form.formState.errors.maxSessions?.message}
              hint="Binds simultanés admis ; 0 n’en admet aucun."
              label="max_sessions"
            >
              <Input
                inputMode="numeric"
                min={0}
                mono
                step={1}
                type="number"
                {...form.register('maxSessions', { valueAsNumber: true })}
              />
            </Field>
            <Select
              label="Type de bind admis"
              onValueChange={(value) => form.setValue('allowedBindTypes', value as BindType)}
              options={(Object.keys(BIND_TYPES) as BindType[]).map((type) => ({
                value: type,
                label: `${type} — ${BIND_TYPES[type]}`,
              }))}
              value={form.watch('allowedBindTypes')}
            />
            <div>
              <Button
                {...blockedBy(writeRefusal)}
                loading={save.isPending && lowering === null}
                type="submit"
                variant="primary"
              >
                Enregistrer
              </Button>
            </div>
          </form>
        </Card>
        <Card
          flush={live.isSuccess && live.data.sessions.length > 0}
          subtitle={
            live.isSuccess
              ? `${live.data.active} ouvert${live.data.active > 1 ? 's' : ''} / limite ${live.data.maxSessions}`
              : undefined
          }
          title="Binds ouverts"
        >
          {live.isPending ? (
            <LoadingState label="Chargement des binds ouverts…">
              <Skeleton height={38} />
            </LoadingState>
          ) : live.isError ? (
            <ErrorState
              description={live.error.message}
              onRetry={() => void live.refetch()}
              title="Les binds ouverts n’ont pas pu être chargés"
              titleAs="h3"
            />
          ) : live.data.sessions.length === 0 ? (
            <EmptyState
              description="Un bind apparaît ici dès que le client se connecte en SMPP. La liste est lue à l’ouverture de l’onglet et après chaque enregistrement."
              inline
              title="Aucun bind ouvert"
              titleAs="h3"
            />
          ) : (
            <DataTable
              caption="Binds ouverts du compte"
              columns={[
                {
                  key: 'bindType',
                  header: 'Type',
                  cell: (bind: OpenBind) => <span className="mono">{bind.bindType}</span>,
                },
                {
                  key: 'remoteAddr',
                  header: 'Adresse',
                  cell: (bind: OpenBind) => <span className="mono">{bind.remoteAddr ?? '—'}</span>,
                },
                {
                  key: 'connectedAt',
                  header: 'Ouvert le',
                  cell: (bind: OpenBind) => dateTimeFormat.format(new Date(bind.connectedAt)),
                },
              ]}
              dense
              rowKey={(bind) => bind.id}
              rows={live.data.sessions}
            />
          )}
        </Card>
      </div>
      {lowering !== null && live.isSuccess ? (
        <Modal
          footer={
            <>
              <Button onClick={() => setLowering(null)}>Annuler</Button>
              <Button
                loading={save.isPending}
                onClick={() => save.mutate(lowering)}
                variant="primary"
              >
                Limiter
              </Button>
            </>
          }
          onClose={() => setLowering(null)}
          open
          title={`Limiter ce compte à ${binds(lowering.maxSessions)} ?`}
        >
          <Refusal error={save.error} />
          <p>Ce compte a {openBinds(live.data.active)} : aucun ne sera coupé.</p>
          <p>
            Il restera au-dessus de sa limite tant que des binds ne se fermeront pas, et aucun
            nouveau bind ne sera admis d’ici là.
          </p>
          <p>L’action est enregistrée dans le journal d’audit.</p>
        </Modal>
      ) : null}
    </>
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
      {...('blockedReason' in blocked || !full
        ? blocked
        : blockedBy(
            'Ce compte a déjà ses deux webhooks, MO et DLR : supprimez-en un pour le recréer.',
          ))}
      onClick={onCreate}
      size="sm"
      variant="primary"
    >
      Nouveau webhook
    </Button>
  )

  return (
    <Card
      actions={create}
      flush={webhooks.isSuccess && webhooks.data.length > 0}
      title="Webhooks MO / DLR"
    >
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
          dense
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
              cell: (webhook: Webhook) => (
                <WebhookDelivery
                  accountId={accountId}
                  webhook={webhook}
                  writeRefusal={'blockedReason' in blocked ? blocked.blockedReason : undefined}
                />
              ),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (webhook: Webhook) => {
                const event = webhook.eventType.toUpperCase()
                return (
                  <div className="row-actions">
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
    </Card>
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

function WebhookDelivery({
  accountId,
  webhook,
  writeRefusal,
}: {
  readonly accountId: string
  readonly webhook: Webhook
  readonly writeRefusal: string | undefined
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const event = webhook.eventType.toUpperCase()
  const change = useMutation({
    mutationFn: (status: Webhook['status']) =>
      orRefusal(
        api.PATCH('/accounts/{accountId}/webhooks/{webhookId}', {
          params: { path: { accountId, webhookId: webhook.id } },
          body: { status },
        }),
        'Le webhook n’a pas été modifié',
      ),
    onSuccess: async (changed) => {
      await queryClient.invalidateQueries({
        queryKey: [...accountsQueryKey, accountId, 'webhooks'],
      })
      toast({
        title: `Le webhook ${event} est ${changed.status === 'disabled' ? 'désactivé' : 'activé'}.`,
        severity: 'success',
      })
    },
    onError: (error) => toast({ title: error.message, severity: 'warning' }),
  })

  return (
    <div className="row-actions">
      <Switch
        blockedReason={writeRefusal}
        checked={webhook.status === 'active'}
        compact
        label={`Webhook ${event} actif`}
        onCheckedChange={(active) => change.mutate(active ? 'active' : 'disabled')}
      />
      <span aria-hidden="true">{WEBHOOK_STATUS_LABELS[webhook.status]}</span>
    </div>
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
        if (field === 'url') form.setError(field, { message })
      }
    },
  })
  // Le Select n'a pas de zone d'erreur : un refus sur `eventType` passe par le bandeau.
  const placed = fieldRefusalsOf(create.error).some(({ field }) => field === 'url')

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
      <CopyButton done="Secret copié." label="Copier le secret" value={secret} />
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
