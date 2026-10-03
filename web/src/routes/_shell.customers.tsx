import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import {
  Button,
  DataTable,
  EmptyState,
  ENTITY_LABELS,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  NoResults,
  Select,
  Skeleton,
  StatusPill,
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { CustomerCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Customer = components['schemas']['Customer']
type Status = components['schemas']['CustomerStatus']

const STATUSES: readonly Status[] = ['active', 'suspended', 'closed']
const ALL = 'all'
const customersQueryKey = ['gateway', 'customers'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

export const Route = createFileRoute('/_shell/customers')({
  // Réduit avant d'atteindre l'écran : ce qui en sort est un filtre que le contrat connaît, ou rien.
  // Les deux clés sont toujours rendues : une clé omise laisserait passer la valeur brute de l'URL
  // (mesuré en 1.170.18, `?status=supprime` atteignait la requête).
  validateSearch: (search: Record<string, unknown>): { status?: Status; groupId?: string } => ({
    status: STATUSES.includes(search.status as Status) ? (search.status as Status) : undefined,
    groupId:
      typeof search.groupId === 'string' && search.groupId !== '' ? search.groupId : undefined,
  }),
  component: CustomersScreen,
})

function useActiveGroups(enabled: boolean) {
  return useQuery({
    queryKey: ['gateway', 'customer-groups', 'active'],
    queryFn: () =>
      orRefusal(
        api.GET('/customer-groups', { params: { query: { status: 'active' } } }),
        'La liste des groupes n’a pas pu être lue',
      ),
    enabled,
    retry: false,
  })
}

function CustomersScreen() {
  const { status, groupId } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [creating, setCreating] = useState(false)
  const canWrite = usePermission('customers:write')
  const canReadGroups = usePermission('groups:read')
  const groups = useActiveGroups(canReadGroups)
  const groupNames = new Map((groups.data ?? []).map((group) => [group.id, group.name]))
  const title = useRef<HTMLHeadingElement>(null)
  const customers = useInfiniteQuery({
    queryKey: [...customersQueryKey, status, groupId],
    queryFn: ({ pageParam }) =>
      orRefusal(
        api.GET('/customers', {
          params: { query: { status, groupId, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
        'La liste des clients n’a pas pu être lue',
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  })
  const rows = customers.data?.pages.flatMap((page) => page.items) ?? []
  const filtered = status !== undefined || groupId !== undefined
  const create = (
    <Button
      {...blockedBy(canWrite ? undefined : 'Créer un client demande customers:write.')}
      onClick={() => setCreating(true)}
      variant="primary"
    >
      Nouveau client
    </Button>
  )

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title" ref={title} tabIndex={-1}>
          Clients
        </h1>
        {create}
      </header>

      <div className="row-actions">
        <Select
          label="Statut"
          onValueChange={(value) =>
            void navigate({
              search: (previous) => ({
                ...previous,
                status: value === ALL ? undefined : (value as Status),
              }),
            })
          }
          options={[
            { value: ALL, label: 'Tous les statuts' },
            ...STATUSES.map((value) => ({ value, label: ENTITY_LABELS[value] })),
          ]}
          size="sm"
          value={status ?? ALL}
        />
        {canReadGroups ? (
          <Select
            label="Groupe"
            onValueChange={(value) =>
              void navigate({
                search: (previous) => ({
                  ...previous,
                  groupId: value === ALL ? undefined : (value as string),
                }),
              })
            }
            options={[
              { value: ALL, label: 'Tous les groupes' },
              ...(groups.data ?? []).map((group) => ({ value: group.id, label: group.name })),
            ]}
            size="sm"
            value={groupId ?? ALL}
          />
        ) : null}
      </div>

      {customers.isPending ? (
        <LoadingState label="Chargement des clients…">
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      ) : customers.isError ? (
        <ErrorState
          description={customers.error.message}
          onRetry={() => void customers.refetch()}
          title="Les clients n’ont pas pu être chargés"
          titleAs="h2"
        />
      ) : rows.length === 0 && filtered ? (
        <NoResults
          description="Aucun client ne correspond à ces filtres. Retirez-en un pour élargir la liste."
          onReset={() => void navigate({ search: {} })}
          title="Aucun client trouvé"
          titleAs="h2"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          action={create}
          description="Un client porte ses comptes SMPP, ses sender IDs et sa facturation."
          title="Aucun client pour l’instant"
          titleAs="h2"
        />
      ) : (
        <>
          <DataTable
            caption="Clients"
            columns={[
              {
                key: 'name',
                header: 'Nom',
                cell: (customer: Customer) => (
                  <Link params={{ customerId: customer.id }} to="/customers/$customerId">
                    {customer.name}
                  </Link>
                ),
              },
              {
                key: 'status',
                header: 'Statut',
                cell: (customer: Customer) => <StatusPill kind="entity" state={customer.status} />,
              },
              {
                key: 'group',
                header: 'Groupe',
                cell: (customer: Customer) =>
                  customer.groupId === undefined
                    ? '—'
                    : (groupNames.get(customer.groupId) ?? (
                        <span className="mono">{customer.groupId}</span>
                      )),
              },
              {
                key: 'createdAt',
                header: 'Créé le',
                cell: (customer: Customer) => dateFormat.format(new Date(customer.createdAt)),
              },
            ]}
            rowKey={(customer) => customer.id}
            rows={rows}
          />
          {customers.hasNextPage ? (
            <Button
              loading={customers.isFetchingNextPage}
              onClick={() => void customers.fetchNextPage()}
            >
              Afficher les suivants
            </Button>
          ) : null}
        </>
      )}

      {creating ? (
        <CreateCustomer
          groups={groups.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            // Le déclencheur de l'état vide disparaît avec la première ligne.
            title.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

function CreateCustomer({
  groups,
  onClose,
  onCreated,
}: {
  readonly groups: readonly components['schemas']['CustomerGroup'][]
  readonly onClose: () => void
  readonly onCreated: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    resolver: formResolver(CustomerCreation),
    defaultValues: { name: '', groupId: undefined as string | undefined },
  })
  const create = useMutation({
    mutationFn: (body: { name: string; groupId?: string }) =>
      orRefusal(api.POST('/customers', { body }), 'Le client n’a pas été créé'),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: customersQueryKey })
      toast({ title: `${created.name} est créé.`, severity: 'success' })
      onCreated()
    },
    onError: (error) => {
      for (const { field, message } of fieldRefusalsOf(error)) {
        if (field === 'name') form.setError(field, { message })
      }
    },
  })
  const placed = fieldRefusalsOf(create.error).some(({ field }) => field === 'name')

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="create-customer" loading={create.isPending} type="submit" variant="primary">
            Créer le client
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Nouveau client"
    >
      <form
        className="form"
        id="create-customer"
        noValidate
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <p>
          Le client naît actif, sans compte ni sender ID ; sa facturation et sa politique de contenu
          gardent les réglages par défaut de la passerelle. Action journalisée.
        </p>
        <Refusal error={placed ? null : create.error} />
        <Field error={form.formState.errors.name?.message} label="Nom">
          <Input autoComplete="off" required {...form.register('name')} />
        </Field>
        {groups.length > 0 ? (
          <Controller
            control={form.control}
            name="groupId"
            render={({ field }) => (
              <Select
                label="Groupe"
                onValueChange={(value) => field.onChange(value === ALL ? undefined : value)}
                options={[
                  { value: ALL, label: 'Aucun groupe' },
                  ...groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                value={field.value ?? ALL}
              />
            )}
          />
        ) : null}
      </form>
    </Modal>
  )
}
