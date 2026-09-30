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
      <header className="page__head">
        <h1 className="page__title" ref={title} tabIndex={-1}>
          {current.name}
        </h1>
        <StatusPill kind="entity" state={current.status} />
        <div className="row-actions">
          <Button {...blocked} onClick={() => setPending({ kind: 'rename' })}>
            Renommer
          </Button>
          {current.status === 'active' ? (
            <Button {...blocked} onClick={() => setPending({ kind: 'suspend' })} variant="danger">
              Suspendre
            </Button>
          ) : null}
          {current.status === 'suspended' ? (
            <Button {...blocked} onClick={() => setPending({ kind: 'reactivate' })}>
              Réactiver
            </Button>
          ) : null}
        </div>
      </header>

      <p>
        <Link to="/customers">Tous les clients</Link> · Créé le{' '}
        {dateFormat.format(new Date(current.createdAt))}
      </p>

      <CustomerGroup
        blocked={blocked}
        customer={current}
        onChange={() => setPending({ kind: 'group' })}
      />
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
    <section aria-labelledby="customer-group">
      <h2 id="customer-group">Groupe</h2>
      <div className="row-actions">
        <p>{name}</p>
        <Button
          {...(canReadGroups
            ? blocked
            : blockedBy('Changer de groupe demande groups:read, qui en donne la liste.'))}
          onClick={onChange}
          size="sm"
        >
          Changer de groupe
        </Button>
      </div>
    </section>
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
        'Les sender IDs n’ont pas pu être lus',
      ),
    retry: false,
  })
  const register = (
    <Button {...blocked} onClick={onRegister} size="sm" variant="primary">
      Enregistrer un sender ID
    </Button>
  )

  return (
    <section aria-labelledby="customer-senders">
      <div className="page__head">
        <h2 id="customer-senders">Sender IDs</h2>
        {register}
      </div>
      {senders.isPending ? (
        <LoadingState label="Chargement des sender IDs…">
          <Skeleton height={38} />
        </LoadingState>
      ) : senders.isError ? (
        <ErrorState
          description={senders.error.message}
          onRetry={() => void senders.refetch()}
          title="Les sender IDs n’ont pas pu être chargés"
          titleAs="h3"
        />
      ) : senders.data.length === 0 ? (
        <EmptyState
          action={register}
          description="Un sender ID enregistré naît en attente d’approbation de l’opérateur télécom."
          title="Aucun sender ID pour l’instant"
          titleAs="h3"
        />
      ) : (
        <DataTable
          caption="Sender IDs du client"
          columns={[
            {
              key: 'address',
              header: 'Adresse',
              cell: (sender: SenderId) => <span className="mono">{sender.address}</span>,
            },
            {
              key: 'status',
              header: 'Statut',
              cell: (sender: SenderId) => <span className="mono">{sender.status}</span>,
            },
            {
              key: 'approvedAt',
              header: 'Approuvé le',
              cell: (sender: SenderId) =>
                sender.approvedAt === undefined
                  ? '—'
                  : dateFormat.format(new Date(sender.approvedAt)),
            },
            {
              key: 'actions',
              header: 'Actions',
              cell: (sender: SenderId) => (
                <div className="row-actions">
                  <SenderStatusToggle blocked={blocked} customerId={customerId} sender={sender} />
                  <Button {...blocked} onClick={() => onDelete(sender)} size="sm" variant="danger">
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
    </section>
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
  const change = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PATCH('/customers/{customerId}/sender-ids/{senderId}', {
          params: { path: { customerId, senderId: sender.id } },
          body: { status: next },
        }),
        'Le sender ID n’a pas été modifié',
      ),
    onSuccess: async (changed) => {
      await queryClient.invalidateQueries({ queryKey: [...customersQueryKey, customerId] })
      toast({
        title:
          changed.status === 'active'
            ? `${changed.address} est approuvé.`
            : `${changed.address} est désactivé.`,
        severity: 'success',
      })
    },
    onError: (error) => toast({ title: error.message, severity: 'warning' }),
  })

  return (
    <Button {...blocked} loading={change.isPending} onClick={() => change.mutate()} size="sm">
      {next === 'active' ? 'Approuver' : 'Désactiver'}
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
      title={`Groupe de ${customer.name}`}
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
            Suspendre le client
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Suspendre ${customer.name}`}
    >
      <Refusal error={suspend.error ?? impact.error} />
      {impact.isPending ? (
        <LoadingState label="Lecture de ses comptes…">
          <Skeleton height={20} />
        </LoadingState>
      ) : impact.isSuccess ? (
        <p>
          {suspensionConsequence(impact.data)} Aucun de ses comptes ne peut plus envoyer, en SMPP
          comme en REST. Action journalisée.
        </p>
      ) : null}
    </Modal>
  )
}

function suspensionConsequence({
  accounts,
  activeAccounts,
}: components['schemas']['SuspensionImpact']) {
  if (accounts === 0) return 'Le client n’a aucun compte SMPP.'
  const counted = accounts === 1 ? '1 compte' : `${accounts} comptes`
  const active = activeAccounts === 1 ? '1 actif' : `${activeAccounts} actifs`
  return `Ses ${counted}, dont ${active}, sont suspendus avec lui ; la passerelle coupe leurs sessions ouvertes.`
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
            Réactiver le client
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Réactiver ${customer.name}`}
    >
      <Refusal error={reactivate.error} />
      <p>
        Ses comptes restent suspendus : la passerelle ne les réactive pas avec lui. Action
        journalisée.
      </p>
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
        'Le sender ID n’a pas été enregistré',
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
      title="Enregistrer un sender ID"
    >
      <form
        className="form"
        id="register-sender"
        noValidate
        onSubmit={form.handleSubmit((values) => register.mutate(values))}
      >
        <p>
          Le sender ID naît en attente d’approbation de l’opérateur télécom. Action journalisée.
        </p>
        <Refusal error={placed ? null : register.error} />
        <Field
          error={form.formState.errors.address?.message}
          hint="Alphanumérique ou numéro, 20 caractères au plus."
          label="Adresse"
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
        'Le sender ID n’a pas été supprimé',
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
            Supprimer le sender ID
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Supprimer ${sender.address}`}
    >
      <Refusal error={remove.error} />
      <p>
        L’adresse quitte la liste du client ; la réenregistrer repart de l’approbation. Action
        journalisée.
      </p>
    </Modal>
  )
}
