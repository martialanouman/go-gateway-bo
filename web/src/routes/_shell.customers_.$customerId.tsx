import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { CustomerSenderIds } from '~/components/customer-sender-ids'
import { PageHeader } from '~/components/page-header'
import {
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Skeleton,
  StatusPill,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { CustomerUpdate } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Customer = components['schemas']['Customer']
type Pending = { readonly kind: 'rename' | 'group' | 'suspend' | 'reactivate' }

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
      <CustomerSenderIds blocked={blocked} customerId={current.id} onRowGone={closeToTitle} />

      {pending?.kind === 'rename' ? <RenameCustomer customer={current} onClose={close} /> : null}
      {pending?.kind === 'group' ? <AssignGroup customer={current} onClose={close} /> : null}
      {pending?.kind === 'suspend' ? (
        <ConfirmSuspend customer={current} onClose={close} onDone={closeToTitle} />
      ) : null}
      {pending?.kind === 'reactivate' ? (
        <ConfirmReactivate customer={current} onClose={close} onDone={closeToTitle} />
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
  const suspended = accounts - closedAccounts
  if (suspended === 0)
    return accounts === 1
      ? 'Son compte est fermé et le restera : la suspension n’interrompt aucun envoi.'
      : `Ses ${accounts} comptes sont fermés et le resteront : la suspension n’interrompt aucun envoi.`
  const counted =
    suspended === accounts
      ? accounts === 1
        ? 'Son compte sera suspendu'
        : `Ses ${accounts} comptes seront suspendus`
      : suspended === 1
        ? 'Un de ses comptes sera suspendu'
        : `${suspended} de ses comptes seront suspendus`
  const active =
    suspended === 1 || activeAccounts === suspended
      ? ''
      : activeAccounts === 1
        ? ', dont 1 actif'
        : `, dont ${activeAccounts} actifs`
  const closed =
    closedAccounts === 0
      ? ''
      : closedAccounts === 1
        ? ' Le compte fermé restera fermé.'
        : ` Les ${closedAccounts} comptes fermés resteront fermés.`
  return `${counted}${active} : plus aucun SMS ne pourra être envoyé, en SMPP comme en REST, et la passerelle tentera de couper les sessions ouvertes.${closed}`
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
