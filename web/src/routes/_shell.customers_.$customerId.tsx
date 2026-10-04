import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { PageHeader } from '~/components/page-header'
import {
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
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { CustomerUpdate, SenderIdCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Customer = components['schemas']['Customer']
type SenderId = components['schemas']['SenderId']
type Pending =
  | { readonly kind: 'rename' | 'group' | 'suspend' | 'reactivate' | 'register' }
  | { readonly kind: 'delete-sender'; readonly sender: SenderId }

const NO_GROUP = 'none'
const customersQueryKey = ['gateway', 'customers'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const WRITE_REFUSAL = 'Modifier un client demande customers:write.'
const SENDER_STATUS_LABELS: Record<SenderId['status'], string> = {
  pending_carrier_approval: 'En attente d’approbation',
  active: 'Approuvé',
  disabled: 'Désactivé',
}

export const Route = createFileRoute('/_shell/customers_/$customerId')({
  component: CustomerScreen,
})

function useCustomer(customerId: string) {
  return useQuery({
    queryKey: [...customersQueryKey, 'detail', customerId],
    queryFn: () =>
      orRefusal(
        api.GET('/customers/{customerId}', { params: { path: { customerId } } }),
        'La fiche du client n’a pas pu être lue',
      ),
    retry: false,
  })
}

function CustomerScreen() {
  const { customerId } = Route.useParams()
  const customer = useCustomer(customerId)
  const [pending, setPending] = useState<Pending | null>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const canWrite = usePermission('customers:write')
  const blocked = blockedBy(canWrite ? undefined : WRITE_REFUSAL)
  const close = () => setPending(null)
  // Le bouton qui a ouvert la modale disparaît avec le statut qu'elle change : sans ceci, le focus
  // tombe sur `body`.
  const closeToTitle = () => {
    close()
    title.current?.focus()
  }

  if (customer.isPending) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: 'Clients', link: { to: '/customers' } }]} title="Client" />
        <LoadingState label="Chargement du client…">
          <Skeleton height={32} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      </div>
    )
  }

  if (customer.isError) {
    return (
      <div className="page">
        <PageHeader crumbs={[{ label: 'Clients', link: { to: '/customers' } }]} title="Client" />
        <ErrorState
          description={customer.error.message}
          onRetry={() => void customer.refetch()}
          title="La fiche du client n’a pas pu être chargée"
        />
        <Link to="/customers">Revenir à la liste des clients</Link>
      </div>
    )
  }

  const current = customer.data

  return (
    <div className="page">
      <PageHeader
        actions={
          <>
            <Button {...blocked} onClick={() => setPending({ kind: 'rename' })} size="sm">
              Renommer
            </Button>
            {current.status === 'active' ? (
              <Button
                {...blocked}
                onClick={() => setPending({ kind: 'suspend' })}
                size="sm"
                variant="danger"
              >
                Suspendre
              </Button>
            ) : null}
            {current.status === 'suspended' ? (
              <Button {...blocked} onClick={() => setPending({ kind: 'reactivate' })} size="sm">
                Réactiver
              </Button>
            ) : null}
          </>
        }
        badges={
          <>
            <StatusPill kind="entity" state={current.status} />
            <span className="page-header__meta">
              Créé le {dateFormat.format(new Date(current.createdAt))}
            </span>
          </>
        }
        crumbs={[{ label: 'Clients', link: { to: '/customers' } }]}
        title={current.name}
        titleRef={title}
      />

      <div className="card-grid">
        <CustomerGroup
          blocked={blocked}
          customer={current}
          onChange={() => setPending({ kind: 'group' })}
        />
        <CustomerAccounts customerId={current.id} />
      </div>
      <SenderIds
        blocked={blocked}
        customerId={current.id}
        onDelete={(sender) => setPending({ kind: 'delete-sender', sender })}
        onRegister={() => setPending({ kind: 'register' })}
      />

      {pending?.kind === 'rename' ? <RenameCustomer customer={current} onClose={close} /> : null}
      {pending?.kind === 'group' ? <AssignGroup customer={current} onClose={close} /> : null}
      {pending?.kind === 'suspend' ? (
        <ConfirmSuspend customer={current} onClose={close} onDone={closeToTitle} />
      ) : null}
      {pending?.kind === 'reactivate' ? (
        <ConfirmReactivate customer={current} onClose={close} onDone={closeToTitle} />
      ) : null}
      {pending?.kind === 'register' ? (
        <RegisterSender customerId={current.id} onClose={close} />
      ) : null}
      {pending?.kind === 'delete-sender' ? (
        <ConfirmDeleteSender
          customerId={current.id}
          onClose={close}
          onDone={closeToTitle}
          sender={pending.sender}
        />
      ) : null}
    </div>
  )
}

function CustomerGroup({
  customer,
  blocked,
  onChange,
}: {
  readonly customer: Customer
  readonly blocked: ReturnType<typeof blockedBy>
  readonly onChange: () => void
}) {
  const canReadGroups = usePermission('groups:read')
  const group = useQuery({
    queryKey: ['gateway', 'customer-groups', 'detail', customer.groupId],
    queryFn: () =>
      orRefusal(
        api.GET('/customer-groups/{groupId}', {
          params: { path: { groupId: customer.groupId ?? '' } },
        }),
        'Le groupe n’a pas pu être lu',
      ),
    enabled: canReadGroups && customer.groupId !== undefined,
    retry: false,
  })
  const name =
    customer.groupId === undefined ? (
      'Aucun groupe'
    ) : (
      <span className={group.data ? undefined : 'mono'}>
        {group.data?.name ?? customer.groupId}
      </span>
    )

  return (
    <Card
      actions={
        <Button
          {...(canReadGroups
            ? blocked
            : blockedBy('Changer de groupe demande groups:read, qui en donne la liste.'))}
          onClick={onChange}
          size="sm"
        >
          Changer de groupe
        </Button>
      }
      title="Groupe"
    >
      <span>{name}</span>
    </Card>
  )
}

function CustomerAccounts({ customerId }: { readonly customerId: string }) {
  return (
    <Card
      actions={
        usePermission('accounts:read') ? (
          <Link
            className="ui-button ui-button--secondary ui-button--sm"
            search={{ customerId }}
            to="/accounts"
          >
            Voir ses comptes
          </Link>
        ) : (
          <Button blockedReason="Voir les comptes d’un client demande accounts:read." size="sm">
            Voir ses comptes
          </Button>
        )
      }
      title="Comptes"
    >
      <span>
        Un compte porte les identifiants SMPP et REST, les canaux et les quotas d’un client.
      </span>
    </Card>
  )
}

function SenderIds({
  customerId,
  blocked,
  onRegister,
  onDelete,
}: {
  readonly customerId: string
  readonly blocked: ReturnType<typeof blockedBy>
  readonly onRegister: () => void
  readonly onDelete: (sender: SenderId) => void
}) {
  const senders = useQuery({
    queryKey: [...customersQueryKey, customerId, 'sender-ids'],
    queryFn: () =>
      orRefusal(
        api.GET('/customers/{customerId}/sender-ids', { params: { path: { customerId } } }),
        'Les noms d’expéditeur n’ont pas pu être lus',
      ),
    retry: false,
  })
  const register = (
    <Button {...blocked} onClick={onRegister} size="sm" variant="primary">
      Enregistrer un nom d’expéditeur
    </Button>
  )

  return (
    <Card
      actions={register}
      flush={senders.isSuccess && senders.data.length > 0}
      title="Noms d’expéditeur"
    >
      {senders.isPending ? (
        <LoadingState label="Chargement des noms d’expéditeur…">
          <Skeleton height={38} />
        </LoadingState>
      ) : senders.isError ? (
        <ErrorState
          description={senders.error.message}
          onRetry={() => void senders.refetch()}
          title="Les noms d’expéditeur n’ont pas pu être chargés"
          titleAs="h3"
        />
      ) : senders.data.length === 0 ? (
        <EmptyState
          description="Un nom d’expéditeur enregistré naît en attente d’approbation de l’opérateur télécom."
          title="Aucun nom d’expéditeur pour l’instant"
          titleAs="h3"
        />
      ) : (
        <DataTable
          caption="Noms d’expéditeur du client"
          dense
          columns={[
            {
              key: 'address',
              header: 'Nom',
              cell: (sender: SenderId) => <span className="mono">{sender.address}</span>,
            },
            {
              key: 'status',
              header: 'Statut',
              cell: (sender: SenderId) => SENDER_STATUS_LABELS[sender.status],
            },
            {
              key: 'createdAt',
              header: 'Enregistré le',
              cell: (sender: SenderId) => dateFormat.format(new Date(sender.createdAt)),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (sender: SenderId) => (
                <div className="row-actions">
                  <SenderStatusToggle blocked={blocked} customerId={customerId} sender={sender} />
                  <Button
                    {...blocked}
                    aria-label={`Supprimer ${sender.address}`}
                    onClick={() => onDelete(sender)}
                    size="sm"
                    variant="danger"
                  >
                    Supprimer
                  </Button>
                </div>
              ),
            },
          ]}
          rowKey={(sender) => sender.id}
          rows={senders.data}
        />
      )}
    </Card>
  )
}

function SenderStatusToggle({
  customerId,
  sender,
  blocked,
}: {
  readonly customerId: string
  readonly sender: SenderId
  readonly blocked: ReturnType<typeof blockedBy>
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const next = sender.status === 'active' ? 'disabled' : 'active'
  const gesture =
    next === 'disabled'
      ? 'Désactiver'
      : sender.status === 'pending_carrier_approval'
        ? 'Approuver'
        : 'Réactiver'
  const done = { Désactiver: 'désactivé', Approuver: 'approuvé', Réactiver: 'réactivé' }[gesture]
  const change = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PATCH('/customers/{customerId}/sender-ids/{senderId}', {
          params: { path: { customerId, senderId: sender.id } },
          body: { status: next },
        }),
        'Le nom d’expéditeur n’a pas été modifié',
      ),
    onSuccess: async (changed) => {
      await queryClient.invalidateQueries({ queryKey: [...customersQueryKey, customerId] })
      toast({
        title: `${changed.address} est ${done}.`,
        severity: 'success',
      })
    },
    onError: (error) => toast({ title: error.message, severity: 'warning' }),
  })

  return (
    <Button
      {...blocked}
      aria-label={`${gesture} ${sender.address}`}
      loading={change.isPending}
      onClick={() => change.mutate()}
      size="sm"
    >
      {gesture}
    </Button>
  )
}

function RenameCustomer({
  customer,
  onClose,
}: {
  readonly customer: Customer
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const form = useForm({
    resolver: formResolver(CustomerUpdate),
    defaultValues: { name: customer.name },
  })
  const rename = useMutation({
    mutationFn: (body: { name: string }) =>
      orRefusal(
        api.PATCH('/customers/{customerId}', {
          params: { path: { customerId: customer.id } },
          body,
        }),
        'Le client n’a pas été renommé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customersQueryKey })
      onClose()
    },
    onError: (error) => {
      for (const { field, message } of fieldRefusalsOf(error)) {
        if (field === 'name') form.setError(field, { message })
      }
    },
  })
  const placed = fieldRefusalsOf(rename.error).some(({ field }) => field === 'name')

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="rename-customer" loading={rename.isPending} type="submit" variant="primary">
            Renommer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Renommer ${customer.name}`}
    >
      <form
        className="form"
        id="rename-customer"
        noValidate
        onSubmit={form.handleSubmit((values) => rename.mutate(values))}
      >
        <Refusal error={placed ? null : rename.error} />
        <Field error={form.formState.errors.name?.message} label="Nom">
          <Input autoComplete="off" required {...form.register('name')} />
        </Field>
      </form>
    </Modal>
  )
}

function AssignGroup({
  customer,
  onClose,
}: {
  readonly customer: Customer
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [groupId, setGroupId] = useState(customer.groupId ?? NO_GROUP)
  const groups = useQuery({
    queryKey: ['gateway', 'customer-groups', 'active'],
    queryFn: () =>
      orRefusal(
        api.GET('/customer-groups', { params: { query: { status: 'active' } } }),
        'La liste des groupes n’a pas pu être lue',
      ),
    retry: false,
  })
  const assign = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PUT('/customers/{customerId}/group', {
          params: { path: { customerId: customer.id } },
          body: groupId === NO_GROUP ? {} : { groupId },
        }),
        'Le groupe du client n’a pas été changé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customersQueryKey })
      onClose()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            {...blockedBy(groups.isSuccess ? undefined : 'La liste des groupes n’est pas lue.')}
            loading={assign.isPending}
            onClick={() => assign.mutate()}
            variant="primary"
          >
            Enregistrer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Changer le groupe — ${customer.name}`}
    >
      <div className="form">
        <p>
          Un groupe est organisationnel : il ne porte ni solde, ni quota, ni règle de configuration.
        </p>
        <Refusal error={assign.error ?? groups.error} />
        <Select
          label="Groupe"
          onValueChange={(value) => setGroupId(value as string)}
          options={[
            { value: NO_GROUP, label: 'Aucun groupe' },
            ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name })),
          ]}
          value={groupId}
        />
      </div>
    </Modal>
  )
}

function ConfirmSuspend({
  customer,
  onClose,
  onDone,
}: {
  readonly customer: Customer
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const queryClient = useQueryClient()
  const impact = useQuery({
    queryKey: [...customersQueryKey, customer.id, 'suspension-impact'],
    queryFn: () =>
      orRefusal(
        api.GET('/customers/{customerId}/suspension-impact', {
          params: { path: { customerId: customer.id } },
        }),
        'L’impact de la suspension n’a pas pu être lu',
      ),
    retry: false,
    staleTime: 0,
  })
  const suspend = useMutation({
    mutationFn: () =>
      orRefusal(
        api.POST('/customers/{customerId}/suspend', {
          params: { path: { customerId: customer.id } },
        }),
        'Le client n’a pas été suspendu',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customersQueryKey })
      onDone()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            {...blockedBy(
              impact.isSuccess ? undefined : 'L’impact doit être lu avant de suspendre.',
            )}
            loading={suspend.isPending}
            onClick={() => suspend.mutate()}
            variant="danger"
          >
            Suspendre
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Suspendre ${customer.name} ?`}
    >
      <Refusal error={suspend.error ?? impact.error} />
      {impact.isPending ? (
        <LoadingState label="Lecture de ses comptes…">
          <Skeleton height={20} />
        </LoadingState>
      ) : impact.isSuccess ? (
        <>
          <p>{suspensionConsequence(impact.data)}</p>
          <p>
            Le client pourra être réactivé ensuite. L’action est enregistrée dans le journal
            d’audit.
          </p>
        </>
      ) : null}
    </Modal>
  )
}

function suspensionConsequence({
  accounts,
  activeAccounts,
  closedAccounts,
}: components['schemas']['SuspensionImpact']) {
  if (accounts === 0) return 'Ce client n’a aucun compte : la suspension n’interrompt aucun envoi.'
  const counted =
    accounts === 1 ? 'Son compte sera suspendu' : `Ses ${accounts} comptes seront suspendus`
  const active =
    accounts === 1 || activeAccounts === accounts
      ? ''
      : activeAccounts === 1
        ? ', dont 1 actif'
        : `, dont ${activeAccounts} actifs`
  const reopened =
    closedAccounts === 0
      ? ''
      : closedAccounts === 1
        ? ' Un compte fermé repassera suspendu, et pourra donc être réactivé.'
        : ` ${closedAccounts} comptes fermés repasseront suspendus, et pourront donc être réactivés.`
  return `${counted}${active} : plus aucun SMS ne pourra être envoyé, en SMPP comme en REST, et la passerelle tentera de couper les sessions ouvertes.${reopened}`
}

function ConfirmReactivate({
  customer,
  onClose,
  onDone,
}: {
  readonly customer: Customer
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const queryClient = useQueryClient()
  const reactivate = useMutation({
    mutationFn: () =>
      orRefusal(
        api.POST('/customers/{customerId}/reactivate', {
          params: { path: { customerId: customer.id } },
        }),
        'Le client n’a pas été réactivé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: customersQueryKey })
      onDone()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            loading={reactivate.isPending}
            onClick={() => reactivate.mutate()}
            variant="primary"
          >
            Réactiver
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Réactiver ${customer.name} ?`}
    >
      <Refusal error={reactivate.error} />
      <p>
        Le client redevient actif, mais ses comptes restent suspendus : ils ne pourront pas envoyer
        de SMS tant qu’ils ne seront pas réactivés un par un.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}

function RegisterSender({
  customerId,
  onClose,
}: {
  readonly customerId: string
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const form = useForm({ resolver: formResolver(SenderIdCreation), defaultValues: { address: '' } })
  const register = useMutation({
    mutationFn: (body: { address: string }) =>
      orRefusal(
        api.POST('/customers/{customerId}/sender-ids', { params: { path: { customerId } }, body }),
        'Le nom d’expéditeur n’a pas été enregistré',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...customersQueryKey, customerId] })
      onClose()
    },
    onError: (error) => {
      for (const { field, message } of fieldRefusalsOf(error)) {
        if (field === 'address') form.setError(field, { message })
      }
    },
  })
  const placed = fieldRefusalsOf(register.error).some(({ field }) => field === 'address')

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            form="register-sender"
            loading={register.isPending}
            type="submit"
            variant="primary"
          >
            Enregistrer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Enregistrer un nom d’expéditeur"
    >
      <form
        className="form"
        id="register-sender"
        noValidate
        onSubmit={form.handleSubmit((values) => register.mutate(values))}
      >
        <p>
          Le nom d’expéditeur naît en attente d’approbation de l’opérateur télécom. Action
          journalisée.
        </p>
        <Refusal error={placed ? null : register.error} />
        <Field
          error={form.formState.errors.address?.message}
          hint="De 2 à 11 caractères : lettres, chiffres, espaces, + et -."
          label="Nom"
        >
          <Input
            autoComplete="off"
            className="ui-input--mono"
            required
            {...form.register('address')}
          />
        </Field>
      </form>
    </Modal>
  )
}

function ConfirmDeleteSender({
  customerId,
  sender,
  onClose,
  onDone,
}: {
  readonly customerId: string
  readonly sender: SenderId
  readonly onClose: () => void
  readonly onDone: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/customers/{customerId}/sender-ids/{senderId}', {
          params: { path: { customerId, senderId: sender.id } },
        }),
        'Le nom d’expéditeur n’a pas été supprimé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [...customersQueryKey, customerId] })
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
      title={`Supprimer le nom d’expéditeur ${sender.address} ?`}
    >
      <Refusal error={remove.error} />
      <p>
        {sender.address} disparaîtra de la liste du client. Pour l’utiliser de nouveau, il faudra
        l’enregistrer et attendre une nouvelle approbation de l’opérateur télécom.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}
