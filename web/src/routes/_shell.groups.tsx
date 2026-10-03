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
  NoResults,
  Skeleton,
  Tabs,
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { CustomerGroupCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Group = components['schemas']['CustomerGroup']
type Status = components['schemas']['CustomerGroupStatus']

const groupsQueryKey = ['gateway', 'customer-groups'] as const
const WRITE_REASON = 'Créer, modifier, archiver ou supprimer un groupe demande groups:write.'
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })

export const Route = createFileRoute('/_shell/groups')({ component: GroupsScreen })

type Pending =
  | { readonly kind: 'create' }
  | { readonly kind: 'edit' | 'delete'; readonly group: Group }
  | undefined

function GroupsScreen() {
  const [status, setStatus] = useState<Status>('active')
  const [pending, setPending] = useState<Pending>(undefined)
  const close = () => setPending(undefined)
  const canWrite = usePermission('groups:write')
  const blocked = blockedBy(canWrite ? undefined : WRITE_REASON)
  const title = useRef<HTMLHeadingElement>(null)
  const groups = useQuery({
    queryKey: [...groupsQueryKey, status],
    queryFn: () =>
      orRefusal(
        api.GET('/customer-groups', { params: { query: { status } } }),
        'La liste des groupes n’a pas pu être lue',
      ),
    retry: false,
  })
  const create = (
    <Button {...blocked} onClick={() => setPending({ kind: 'create' })} variant="primary">
      Nouveau groupe
    </Button>
  )

  const listing = (
    <>
      {groups.isPending ? (
        <LoadingState label="Chargement des groupes…">
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      ) : groups.isError ? (
        <ErrorState
          description={groups.error.message}
          onRetry={() => void groups.refetch()}
          title="Les groupes n’ont pas pu être chargés"
          titleAs="h2"
        />
      ) : groups.data.length === 0 && status === 'archived' ? (
        <NoResults
          description="Aucun groupe n’est archivé. Les groupes en service sont sous l’onglet Actifs."
          onReset={() => setStatus('active')}
          title="Aucun groupe archivé"
          titleAs="h2"
        />
      ) : groups.data.length === 0 ? (
        <EmptyState
          action={create}
          description="Un groupe rassemble des clients pour les retrouver ensemble ; il ne porte ni solde, ni quota, ni règle de routage."
          title="Aucun groupe pour l’instant"
          titleAs="h2"
        />
      ) : (
        <GroupsTable
          blocked={blocked}
          groups={groups.data}
          onAct={setPending}
          // La ligne change d'onglet avec son statut : sans ceci, le focus tombe sur `body`.
          onMoved={() => title.current?.focus()}
        />
      )}
    </>
  )

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title" ref={title} tabIndex={-1}>
          Groupes
        </h1>
        {create}
      </header>

      {/* Le contenu est le panneau de l'onglet actif : sans lui, l'onglet promet un panneau que le
          lecteur d'écran ne trouve pas. */}
      <Tabs
        onValueChange={(value) => setStatus(value as Status)}
        tabs={(['active', 'archived'] as const).map((value) => ({
          value,
          label: value === 'active' ? 'Actifs' : 'Archivés',
          panel: listing,
        }))}
        value={status}
      />

      {pending?.kind === 'create' ? (
        <GroupEditor
          onClose={close}
          onSaved={() => {
            close()
            // Le groupe naît actif ; et le déclencheur de l'état vide disparaît avec lui.
            setStatus('active')
            title.current?.focus()
          }}
        />
      ) : null}
      {pending?.kind === 'edit' ? (
        <GroupEditor group={pending.group} onClose={close} onSaved={close} />
      ) : null}
      {pending?.kind === 'delete' ? (
        <ConfirmDelete
          group={pending.group}
          onClose={close}
          onDeleted={() => {
            close()
            // La ligne du déclencheur disparaît avec le groupe : sans ceci, le focus tombe sur `body`.
            title.current?.focus()
          }}
        />
      ) : null}
    </div>
  )
}

function GroupsTable({
  groups,
  blocked,
  onAct,
  onMoved,
}: {
  readonly groups: readonly Group[]
  readonly blocked: ReturnType<typeof blockedBy>
  readonly onAct: (pending: Pending) => void
  readonly onMoved: () => void
}) {
  return (
    <DataTable
      caption="Groupes de clients"
      columns={[
        { key: 'name', header: 'Nom', cell: (group) => group.name },
        { key: 'description', header: 'Description', cell: (group) => group.description ?? '—' },
        { key: 'memberCount', header: 'Clients', cell: (group) => group.memberCount },
        {
          key: 'status',
          header: 'Statut',
          cell: (group) => <span className="mono">{group.status}</span>,
        },
        {
          key: 'createdAt',
          header: 'Créé le',
          cell: (group) => dateFormat.format(new Date(group.createdAt)),
        },
        {
          key: 'actions',
          header: 'Actions',
          cell: (group) => (
            <div className="row-actions">
              <GroupCustomers group={group} />
              <Button {...blocked} onClick={() => onAct({ kind: 'edit', group })} size="sm">
                Modifier
              </Button>
              <ToggleArchive blocked={blocked} group={group} onMoved={onMoved} />
              <Button
                {...blocked}
                onClick={() => onAct({ kind: 'delete', group })}
                size="sm"
                variant="danger"
              >
                Supprimer
              </Button>
            </div>
          ),
        },
      ]}
      rowKey={(group) => group.id}
      rows={groups}
    />
  )
}

function ToggleArchive({
  group,
  blocked,
  onMoved,
}: {
  readonly group: Group
  readonly blocked: ReturnType<typeof blockedBy>
  readonly onMoved: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const archiving = group.status === 'active'
  const toggle = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PATCH('/customer-groups/{groupId}', {
          params: { path: { groupId: group.id } },
          body: { status: archiving ? 'archived' : 'active' },
        }),
        archiving ? 'Le groupe n’a pas été archivé' : 'Le groupe n’a pas été désarchivé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: groupsQueryKey })
      toast({
        title: archiving
          ? `${group.name} est archivé : ses clients le gardent, et il passe sous l’onglet Archivés.`
          : `${group.name} est de nouveau actif.`,
        severity: 'success',
      })
      onMoved()
    },
    onError: (error) => toast({ title: error.message, severity: 'warning' }),
  })

  return (
    <Button {...blocked} loading={toggle.isPending} onClick={() => toggle.mutate()} size="sm">
      {archiving ? 'Archiver' : 'Désarchiver'}
    </Button>
  )
}

function GroupEditor({
  group,
  onClose,
  onSaved,
}: {
  readonly group?: Group
  readonly onClose: () => void
  readonly onSaved: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    resolver: formResolver(CustomerGroupCreation),
    defaultValues: { name: group?.name ?? '', description: group?.description ?? '' },
  })
  const save = useMutation({
    mutationFn: ({ name, description = '' }: { name: string; description?: string }) =>
      group === undefined
        ? orRefusal(
            api.POST('/customer-groups', {
              body: description === '' ? { name } : { name, description },
            }),
            'Le groupe n’a pas été créé',
          )
        : orRefusal(
            api.PATCH('/customer-groups/{groupId}', {
              params: { path: { groupId: group.id } },
              body: {
                ...(name === group.name ? {} : { name }),
                ...(description === (group.description ?? '') ? {} : { description }),
              },
            }),
            'Le groupe n’a pas été modifié',
          ),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: groupsQueryKey })
      toast({
        title: group === undefined ? `${saved.name} est créé.` : `${saved.name} est enregistré.`,
        severity: 'success',
      })
      onSaved()
    },
    onError: (error) => {
      for (const { field, message } of fieldRefusalsOf(error)) {
        if (field === 'name' || field === 'description') form.setError(field, { message })
      }
    },
  })
  const placed = fieldRefusalsOf(save.error).some(
    ({ field }) => field === 'name' || field === 'description',
  )
  const { errors } = form.formState

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button form="group-editor" loading={save.isPending} type="submit" variant="primary">
            {group === undefined ? 'Créer le groupe' : 'Enregistrer le groupe'}
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={group === undefined ? 'Nouveau groupe' : `Modifier ${group.name}`}
    >
      <form
        className="form"
        id="group-editor"
        noValidate
        onSubmit={form.handleSubmit((values) =>
          group !== undefined &&
          values.name === group.name &&
          (values.description ?? '') === (group.description ?? '')
            ? onClose()
            : save.mutate(values),
        )}
      >
        <p>
          Un groupe est organisationnel : il ne change ni solde, ni quota, ni routage. Action
          journalisée.
        </p>
        <Refusal error={placed ? null : save.error} />
        <Field error={errors.name?.message} label="Nom">
          <Input autoComplete="off" required {...form.register('name')} />
        </Field>
        <Field
          error={errors.description?.message}
          hint={
            group?.description == null
              ? undefined
              : 'Une description ne peut pas être vidée : la passerelle ne sait pas encore effacer ce champ.'
          }
          label="Description"
          optional
        >
          <Input autoComplete="off" {...form.register('description')} />
        </Field>
      </form>
    </Modal>
  )
}

function ConfirmDelete({
  group,
  onClose,
  onDeleted,
}: {
  readonly group: Group
  readonly onClose: () => void
  readonly onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/customer-groups/{groupId}', { params: { path: { groupId: group.id } } }),
        'Le groupe n’a pas été supprimé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: groupsQueryKey })
      onDeleted()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={remove.isPending} onClick={() => remove.mutate()} variant="danger">
            Supprimer le groupe
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Supprimer ${group.name}`}
    >
      <Refusal error={remove.error} />
      <p>{detachedMembers(group.memberCount)} Action journalisée.</p>
    </Modal>
  )
}

function detachedMembers(count: number) {
  if (count === 0) return 'Le groupe n’a aucun client : rien n’est détaché.'
  if (count === 1) return 'Son client est détaché du groupe ; aucun client n’est supprimé.'
  return `Ses ${count} clients sont détachés du groupe ; aucun client n’est supprimé.`
}

function GroupCustomers({ group }: { readonly group: Group }) {
  return usePermission('customers:read') ? (
    <Link
      className="ui-button ui-button--secondary ui-button--sm"
      search={{ groupId: group.id }}
      to="/customers"
    >
      Voir les clients
    </Link>
  ) : (
    <Button blockedReason="Voir les clients d’un groupe demande customers:read." size="sm">
      Voir les clients
    </Button>
  )
}
