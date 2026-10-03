import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
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
  Skeleton,
  StatusPill,
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { AccountCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Account = components['schemas']['SmppAccount']
const accountsQueryKey = ['gateway', 'accounts'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

export const Route = createFileRoute('/_shell/accounts')({
  validateSearch: (search: Record<string, unknown>): { customerId?: string } => ({
    customerId:
      typeof search.customerId === 'string' && search.customerId !== ''
        ? search.customerId
        : undefined,
  }),
  component: AccountsScreen,
})

// La clé de la fiche client : une page de comptes d'un même client ne lit son nom qu'une fois.
function useCustomerName(customerId: string | undefined) {
  const query = useQuery({
    queryKey: ['gateway', 'customers', 'detail', customerId],
    queryFn: () =>
      orRefusal(
        api.GET('/customers/{customerId}', { params: { path: { customerId: customerId ?? '' } } }),
        'Le client n’a pas pu être lu',
      ),
    enabled: usePermission('customers:read') && customerId !== undefined,
    retry: false,
  })
  return query.data?.name
}

function CustomerCell({ customerId }: { readonly customerId: string }) {
  const name = useCustomerName(customerId)
  return (
    <Link params={{ customerId }} to="/customers/$customerId">
      {name ?? <span className="mono">{customerId}</span>}
    </Link>
  )
}

function AccountsScreen() {
  const { customerId } = Route.useSearch()
  const [creating, setCreating] = useState(false)
  const canWrite = usePermission('accounts:write')
  const customerName = useCustomerName(customerId)
  const accounts = useInfiniteQuery({
    queryKey: [...accountsQueryKey, customerId],
    queryFn: ({ pageParam }) =>
      orRefusal(
        api.GET('/accounts', {
          params: { query: { customerId, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
        'La liste des comptes n’a pas pu être lue',
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  })
  const rows = accounts.data?.pages.flatMap((page) => page.items) ?? []
  const create = (
    <Button
      {...blockedBy(
        !canWrite
          ? 'Créer un compte demande accounts:write.'
          : customerId === undefined
            ? 'Un compte se crée depuis les comptes d’un client : ouvrez-les depuis sa fiche.'
            : undefined,
      )}
      onClick={() => setCreating(true)}
      variant="primary"
    >
      Nouveau compte
    </Button>
  )

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">
          {customerId === undefined ? 'Comptes SMPP' : `Comptes de ${customerName ?? 'ce client'}`}
        </h1>
        {create}
      </header>

      {customerId === undefined ? null : <Link to="/accounts">Tous les comptes</Link>}

      {accounts.isPending ? (
        <LoadingState label="Chargement des comptes…">
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      ) : accounts.isError ? (
        <ErrorState
          description={accounts.error.message}
          onRetry={() => void accounts.refetch()}
          title="Les comptes n’ont pas pu être chargés"
          titleAs="h2"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          action={create}
          description="Un compte SMPP porte les identifiants, les canaux et les quotas d’un client."
          title="Aucun compte pour l’instant"
          titleAs="h2"
        />
      ) : (
        <>
          <DataTable
            caption="Comptes SMPP"
            columns={[
              { key: 'name', header: 'Nom', cell: (account: Account) => account.name },
              {
                key: 'customer',
                header: 'Client',
                cell: (account: Account) => <CustomerCell customerId={account.customerId} />,
              },
              {
                key: 'status',
                header: 'Statut',
                cell: (account: Account) => <StatusPill kind="entity" state={account.status} />,
              },
              {
                key: 'createdAt',
                header: 'Créé le',
                cell: (account: Account) => dateFormat.format(new Date(account.createdAt)),
              },
            ]}
            rowKey={(account) => account.id}
            rows={rows}
          />
          {accounts.hasNextPage ? (
            <Button
              loading={accounts.isFetchingNextPage}
              onClick={() => void accounts.fetchNextPage()}
            >
              Afficher les suivants
            </Button>
          ) : null}
        </>
      )}

      {creating && customerId !== undefined ? (
        <CreateAccount customerId={customerId} onClose={() => setCreating(false)} />
      ) : null}
    </div>
  )
}

function CreateAccount({
  customerId,
  onClose,
}: {
  readonly customerId: string
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    resolver: formResolver(AccountCreation),
    defaultValues: { customerId, name: '' },
  })
  const create = useMutation({
    mutationFn: (body: { customerId: string; name: string }) =>
      orRefusal(api.POST('/accounts', { body }), 'Le compte n’a pas été créé'),
    onSuccess: async (created) => {
      // L'impact d'une suspension compte aussi ce compte.
      await queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      await queryClient.invalidateQueries({ queryKey: ['gateway', 'customers', customerId] })
      toast({ title: `${created.name} est créé.`, severity: 'success' })
      onClose()
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
          <Button form="create-account" loading={create.isPending} type="submit" variant="primary">
            Créer le compte
          </Button>
        </>
      }
      onClose={onClose}
      open
      title="Nouveau compte SMPP"
    >
      <form
        className="form"
        id="create-account"
        noValidate
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <p>
          Le compte naît actif, ouvert en SMPP et en REST, une session au plus ; il ne peut se lier
          qu’une fois ses identifiants créés. Action journalisée.
        </p>
        <Refusal error={placed ? null : create.error} />
        <Field error={form.formState.errors.name?.message} label="Nom">
          <Input autoComplete="off" required {...form.register('name')} />
        </Field>
      </form>
    </Modal>
  )
}
