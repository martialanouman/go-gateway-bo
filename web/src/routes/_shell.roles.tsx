import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useId, useRef, useState } from 'react'
import { PermissionPicker } from '~/components/admin/permission-picker'
import {
  Button,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Skeleton,
} from '~/components/ui'
import { api, meQueryOptions } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { usePermission } from '~/lib/permissions'
import { blockedBy, orRefusal, Refusal, rolesQueryKey, useRoles } from './_shell.operators'

type Role = components['schemas']['Role']

export const Route = createFileRoute('/_shell/roles')({ component: RolesScreen })

type Pending =
  | { readonly kind: 'create' }
  | { readonly kind: 'view' | 'edit' | 'delete'; readonly role: Role }
  | undefined

function RolesScreen() {
  const roles = useRoles(true)
  const [pending, setPending] = useState<Pending>(undefined)
  const close = () => setPending(undefined)
  const canManage = usePermission('roles:manage')
  const createLockedId = useId()
  const title = useRef<HTMLHeadingElement>(null)

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title" ref={title} tabIndex={-1}>
          Rôles
        </h1>
        <Button
          {...blockedBy(canManage ? undefined : createLockedId)}
          onClick={() => setPending({ kind: 'create' })}
          variant="primary"
        >
          Nouveau rôle
        </Button>
      </header>
      {canManage ? null : (
        <p className="page__notes" id={createLockedId}>
          La composition d’un rôle demande <span className="mono">roles:manage</span>, que ce compte
          ne détient pas.
        </p>
      )}

      {roles.isPending ? (
        <LoadingState label="Chargement des rôles…">
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      ) : roles.isError ? (
        <ErrorState
          description={roles.error.message}
          onRetry={() => void roles.refetch()}
          title="Les rôles n’ont pas pu être chargés"
          titleAs="h2"
        />
      ) : (
        <RolesTable onAct={setPending} roles={roles.data} />
      )}

      {pending?.kind === 'create' ? <RoleEditor onClose={close} /> : null}
      {pending?.kind === 'edit' ? <RoleEditor onClose={close} role={pending.role} /> : null}
      {pending?.kind === 'view' ? <RoleView onClose={close} role={pending.role} /> : null}
      {pending?.kind === 'delete' ? (
        <ConfirmDelete
          onClose={close}
          onDeleted={() => {
            close()
            // La ligne du déclencheur disparaît avec le rôle : sans ceci, le focus tombe sur `body`.
            title.current?.focus()
          }}
          role={pending.role}
        />
      ) : null}
    </div>
  )
}

function RolesTable({
  roles,
  onAct,
}: {
  readonly roles: readonly Role[]
  readonly onAct: (pending: Pending) => void
}) {
  const defaultId = useId()
  const heldId = useId()

  return (
    <>
      <DataTable
        caption="Rôles du tableau de bord"
        columns={[
          { key: 'name', header: 'Nom', mono: true, cell: (role) => role.name },
          { key: 'description', header: 'Description', cell: (role) => role.description },
          {
            key: 'permissions',
            header: 'Permissions',
            align: 'end',
            cell: (role) => role.permissions.length,
          },
          {
            key: 'holders',
            header: 'Détenteurs',
            align: 'end',
            cell: (role) => role.holders.length,
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (role) => (
              <div className="row-actions">
                <Button onClick={() => onAct({ kind: 'view', role })} size="sm">
                  Voir les permissions
                </Button>
                <Button
                  {...blockedBy(role.isDefault ? defaultId : undefined)}
                  onClick={() => onAct({ kind: 'edit', role })}
                  size="sm"
                >
                  Modifier
                </Button>
                <Button
                  {...blockedBy(
                    role.isDefault
                      ? defaultId
                      : role.holders.length > 0
                        ? `${heldId}-${role.id}`
                        : undefined,
                  )}
                  onClick={() => onAct({ kind: 'delete', role })}
                  size="sm"
                  variant="danger"
                >
                  Supprimer
                </Button>
              </div>
            ),
          },
        ]}
        rowKey={(role) => role.id}
        rows={roles}
      />

      <div className="page__notes">
        <p id={defaultId}>
          Les neuf rôles par défaut ne se modifient ni ne se suppriment : livrés avec le produit,
          ils sont réécrits à chaque déploiement, et tout changement serait défait. Un rôle
          personnalisé se compose à partir de leurs permissions.
        </p>
        {roles
          .filter((role) => !role.isDefault && role.holders.length > 0)
          .map((role) => (
            <p id={`${heldId}-${role.id}`} key={role.id}>
              <span className="mono">{role.name}</span> ne se supprime pas tant qu’il est détenu par{' '}
              {role.holders.map((holder, index) => (
                <span key={holder}>
                  {index === 0 ? null : ', '}
                  <span className="mono">{holder}</span>
                </span>
              ))}
              . Il se retire d’abord à ces opérateurs, depuis l’écran Opérateurs.
            </p>
          ))}
      </div>
    </>
  )
}

/**
 * Les clés à côté de la phrase : la description d'un rôle par défaut n'est gardée que par la
 * relecture, et c'est la liste des clés, lue en base, qui dit ce que le rôle accorde réellement.
 */
function RoleView({ role, onClose }: { readonly role: Role; readonly onClose: () => void }) {
  return (
    <Modal
      footer={<Button onClick={onClose}>Fermer</Button>}
      onClose={onClose}
      open
      title={`Rôle ${role.name}`}
    >
      <p>{role.description}</p>
      <ul className="role-keys">
        {role.permissions.map((key) => (
          <li className="mono" key={key}>
            {key}
          </li>
        ))}
      </ul>
    </Modal>
  )
}

function RoleEditor({ role, onClose }: { readonly role?: Role; readonly onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState<string[]>([...(role?.permissions ?? [])])
  const save = useMutation({
    mutationFn: () =>
      role === undefined
        ? orRefusal(
            api.POST('/roles', { body: { name, description, permissions } }),
            'Le rôle n’a pas été créé',
          )
        : orRefusal(
            api.PATCH('/roles/{roleId}', {
              params: { path: { roleId: role.id } },
              body: { description, permissions },
            }),
            'Le rôle n’a pas été modifié',
          ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rolesQueryKey })
      // Un rôle détenu par la session change ses droits : même raison, et même absence de test,
      // que dans l'attribution des rôles.
      await queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey })
      onClose()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()} variant="primary">
            {role === undefined ? 'Créer le rôle' : 'Enregistrer le rôle'}
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={role === undefined ? 'Nouveau rôle' : `Modifier ${role.name}`}
      wide
    >
      <div className="form">
        <p>
          Le rôle accorde exactement les clés cochées, choisies dans tout le catalogue : la liste
          n’est pas bornée aux clés de l’auteur. Modifier un rôle détenu change aussitôt les droits
          de ses détenteurs. Action journalisée.
        </p>
        <Refusal error={save.error} />
        {role === undefined ? (
          <Field label="Nom">
            <Input
              maxLength={100}
              mono
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </Field>
        ) : null}
        <Field label="Description" optional>
          <Input
            maxLength={500}
            onChange={(event) => setDescription(event.target.value)}
            value={description}
          />
        </Field>
        <PermissionPicker onChange={setPermissions} selected={permissions} />
      </div>
    </Modal>
  )
}

function ConfirmDelete({
  role,
  onClose,
  onDeleted,
}: {
  readonly role: Role
  readonly onClose: () => void
  readonly onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/roles/{roleId}', { params: { path: { roleId: role.id } } }),
        'Le rôle n’a pas été supprimé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: rolesQueryKey })
      onDeleted()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={remove.isPending} onClick={() => remove.mutate()} variant="danger">
            Supprimer le rôle
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Supprimer ${role.name}`}
    >
      <Refusal error={remove.error} />
      <p>
        Personne ne détient ce rôle : le supprimer ne retire rien à aucun opérateur. Action
        journalisée.
      </p>
    </Modal>
  )
}
