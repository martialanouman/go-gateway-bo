/**
 * `/roles` — les paquets de permissions, et qui les porte.
 *
 * ## L'aperçu d'impact se demande au serveur
 *
 * « Ce changement retire *N* permissions à *M* opérateurs » se calcule dans le BFF, sur le nombre de
 * porteurs **au moment de décider** — pas sur la liste chargée à l'ouverture de l'écran, qui a pu
 * vieillir de plusieurs minutes pendant qu'on compose le paquet. C'est le seul chiffre de cet écran
 * qui doit faire hésiter ; le lire dans un cache serait le lire pour rien.
 *
 * ## Un rôle livré avec le produit ne se supprime ni ne se renomme
 *
 * Les deux refus viennent du serveur (`directory-write.ts`) ; l'écran les **annonce d'avance**,
 * plutôt que de laisser cliquer pour se faire refuser : l'entrée de menu est désactivée et porte sa
 * raison, et le champ de nom explique pourquoi il est inerte. Le seed réinsère ces rôles par nom, si
 * bien qu'un rôle renommé serait recréé au déploiement suivant.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  AdminRequestError,
  createRole,
  type DirectoryRole,
  deleteRole,
  impactQueryOptions,
  ROLES_QUERY_KEY,
  rolesQueryOptions,
  updateRole,
} from '~/components/admin/api'
import { PermissionRequired, RefusalNotice } from '~/components/admin/notices'
import { PermissionEditor } from '~/components/admin/permission-editor'
import { ConfirmDialog, Dialog, DropdownMenu, useToast } from '~/components/overlays'
import { usePermission } from '~/components/permission'
import { Button, Table, type TableColumn, TextField } from '~/components/primitives'
import { Page } from '~/components/shell'
import { Empty, ErrorState, Loading } from '~/components/states'
import type { PermissionKey } from '~/lib/permissions'

export const Route = createFileRoute('/_shell/roles')({
  component: RolesScreen,
})

function RolesScreen() {
  const { granted } = usePermission('roles:manage')
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const { data, error, isPending, refetch } = useQuery({
    ...rolesQueryOptions(),
    enabled: granted === true,
  })

  const [editing, setEditing] = useState<DirectoryRole | undefined>(undefined)
  const [creating, setCreating] = useState<DirectoryRole | 'vierge' | undefined>(undefined)
  const [removing, setRemoving] = useState<DirectoryRole | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)

  const roles = data?.roles ?? []
  const ready = granted === true && !error && !isPending

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY })
  }

  async function remove(role: DirectoryRole): Promise<void> {
    const outcome = await deleteRole(role.id)
    setRemoving(undefined)

    if (!outcome.ok) {
      setRefusal(outcome.message)
      return
    }

    setRefusal(undefined)
    notify({
      title: 'Rôle supprimé.',
      description: `Opérateurs qui le portaient : ${outcome.data.holders}.`,
      severity: 'success',
    })
    await refresh()
  }

  const columns: readonly TableColumn<DirectoryRole>[] = [
    {
      key: 'nom',
      header: 'Rôle',
      cell: (row) => (
        <span className="ui-directory__identity">
          <code className="ui-directory__key">{row.name}</code>
          <span className="ui-directory__email">{row.description}</span>
        </span>
      ),
    },
    {
      key: 'origine',
      header: 'Origine',
      cell: (row) => (row.isDefault ? 'Livré avec le produit' : 'Personnalisé'),
    },
    {
      key: 'permissions',
      header: 'Permissions',
      align: 'end',
      mono: true,
      cell: (row) => String(row.permissions.length),
    },
    {
      key: 'porteurs',
      header: 'Porteurs',
      align: 'end',
      mono: true,
      cell: (row) => String(row.operatorCount),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <DropdownMenu
          trigger="Actions"
          actions={[
            { label: 'Modifier le paquet', onSelect: () => setEditing(row) },
            { label: 'Dupliquer', onSelect: () => setCreating(row) },
            {
              // Désactivée **et expliquée** : un contrôle grisé sans raison envoie chercher un
              // contournement, et le refus du serveur arriverait de toute façon.
              label: row.isDefault ? 'Supprimer — rôle livré avec le produit' : 'Supprimer le rôle',
              destructive: true,
              disabled: row.isDefault,
              onSelect: () => setRemoving(row),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <Page
      title="Rôles"
      actions={
        granted === true ? (
          <Button variant="primary" onClick={() => setCreating('vierge')}>
            Créer un rôle
          </Button>
        ) : null
      }
    >
      {refusal ? <RefusalNotice message={refusal} /> : null}

      {granted === undefined ? <Loading label="Ouverture des rôles" rows={5} /> : null}

      {granted === false ? (
        <PermissionRequired permission="roles:manage" what="La composition des rôles" />
      ) : null}

      {granted === true && error ? (
        <ErrorState
          status={error instanceof AdminRequestError ? error.status : 0}
          onRetry={() => void refetch()}
        />
      ) : null}

      {granted === true && !error && isPending ? (
        <Loading label="Chargement des rôles" rows={5} />
      ) : null}

      {ready && roles.length === 0 ? (
        <Empty
          title="Aucun rôle"
          description="Le catalogue de permissions existe, mais aucun paquet ne les distribue. Créez un rôle, puis attribuez-le depuis l’écran des opérateurs."
          action={{ label: 'Créer un rôle', onClick: () => setCreating('vierge') }}
        />
      ) : null}

      {ready && roles.length > 0 ? (
        <Table
          caption="Rôles de la console, leur paquet de permissions et leur nombre de porteurs"
          columns={columns}
          rows={roles}
          rowKey={(row) => row.id}
        />
      ) : null}

      {creating ? (
        // La clé remonte l'état du formulaire : sans elle, dupliquer un second rôle rouvrirait la
        // modale avec le paquet du premier.
        <RoleDialog
          key={creating === 'vierge' ? 'vierge' : `copie-${creating.id}`}
          source={creating === 'vierge' ? undefined : creating}
          onClose={() => setCreating(undefined)}
          onDone={refresh}
          notify={notify}
        />
      ) : null}

      {editing ? (
        <RoleDialog
          key={`edition-${editing.id}`}
          role={editing}
          onClose={() => setEditing(undefined)}
          onDone={refresh}
          notify={notify}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== undefined}
        onOpenChange={(open) => !open && setRemoving(undefined)}
        title="Supprimer ce rôle"
        consequence={
          removing
            ? `Les ${removing.operatorCount} opérateur(s) qui le portent perdent immédiatement les ${removing.permissions.length} permissions de ce paquet, sans attendre une reconnexion. Les autres rôles qu’ils détiennent restent en place.`
            : ''
        }
        confirmLabel="Supprimer le rôle"
        onConfirm={() => removing && void remove(removing)}
      />
    </Page>
  )
}

/**
 * La modale d'édition, qui sert aussi à créer et à dupliquer.
 *
 * Trois usages et un seul formulaire : la duplication d'un rôle livré est une **création
 * pré-remplie**, pas une opération à part. Un point d'entrée « dupliquer » côté serveur aurait relu
 * le rôle source pour refaire ce que l'écran a déjà sous les yeux, et les deux auraient divergé le
 * jour où l'un des deux aurait changé.
 */
function RoleDialog({
  role,
  source,
  onClose,
  onDone,
  notify,
}: {
  readonly role?: DirectoryRole
  readonly source?: DirectoryRole
  readonly onClose: () => void
  readonly onDone: () => Promise<void>
  readonly notify: ReturnType<typeof useToast>['notify']
}) {
  const base = role ?? source

  const [name, setName] = useState(role ? role.name : source ? `${source.name}_copie` : '')
  const [description, setDescription] = useState(base?.description ?? '')
  const [selected, setSelected] = useState<readonly PermissionKey[]>(base?.permissions ?? [])
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  // L'aperçu ne vaut que pour un rôle **existant** : une création ne retire rien à personne.
  const impact = useQuery({
    ...impactQueryOptions(role?.id ?? '', selected),
    enabled: role !== undefined,
  })

  function toggle(key: PermissionKey): void {
    setSelected((current) =>
      current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key],
    )
  }

  async function submit(): Promise<void> {
    setBusy(true)
    const payload = { name, description, permissions: [...selected] }
    const outcome = role
      ? await updateRole({ ...payload, roleId: role.id })
      : await createRole(payload)
    setBusy(false)

    if (!outcome.ok) {
      // Le refus reste **dans la modale** : la composition en cours ne doit pas être perdue pour
      // être relue. C'est aussi ce qui permet de corriger le nom sans tout recommencer.
      setRefusal(outcome.message)
      return
    }

    notify({ title: role ? 'Rôle modifié.' : 'Rôle créé.', severity: 'success' })
    onClose()
    await onDone()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={role ? `Modifier ${role.name}` : 'Créer un rôle'}
      description="Un rôle est un paquet de permissions. Un opérateur cumule les paquets de tous ses rôles : il n’y a ni priorité ni héritage."
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {role ? 'Enregistrer le paquet' : 'Créer le rôle'}
          </Button>
        </>
      }
    >
      {refusal ? <RefusalNotice message={refusal} /> : null}

      <TextField
        label="Nom du rôle"
        mono
        value={name}
        disabled={role?.isDefault === true}
        hint={
          role?.isDefault === true
            ? 'Ce rôle est livré avec le produit : son nom l’identifie au déploiement suivant et ne peut pas changer. Sa description et son paquet, si.'
            : 'Minuscules, chiffres et tirets bas — ce nom apparaît au journal d’audit, où il se grep.'
        }
        onChange={(event) => setName(event.target.value)}
      />

      <TextField
        label="Description"
        value={description}
        hint="À qui ce rôle est destiné. Elle évite d’ouvrir le paquet pour savoir à qui le donner."
        onChange={(event) => setDescription(event.target.value)}
      />

      {role ? (
        <Impact
          removed={impact.data?.removedPermissions}
          affected={impact.data?.affectedOperators}
        />
      ) : null}

      <PermissionEditor selected={selected} onToggle={toggle} />
    </Dialog>
  )
}

/**
 * Ce que le changement coûte, avant de l'enregistrer.
 *
 * **Seuls les retraits sont annoncés.** Un ajout ne peut casser personne, et le compter noierait le
 * seul chiffre qui appelle une hésitation. Tant que rien n'est retiré, le bloc dit qu'il n'y a rien
 * à craindre plutôt que de disparaître : une absence se lirait comme un aperçu qui n'a pas chargé.
 */
function Impact({
  removed,
  affected,
}: {
  readonly removed: readonly PermissionKey[] | undefined
  readonly affected: number | undefined
}) {
  if (removed === undefined || affected === undefined) {
    return <p className="ui-directory__impact">Aperçu d’impact en cours de calcul…</p>
  }

  if (removed.length === 0) {
    return (
      <p className="ui-directory__impact">
        Ce changement ne retire aucune permission : personne ne perd de droit.
      </p>
    )
  }

  return (
    <p className="ui-directory__impact ui-directory__impact--warning" role="status">
      Ce changement retire {removed.length} permission(s) à {affected} opérateur(s) :{' '}
      <code className="ui-directory__key">{removed.join(', ')}</code>. Le retrait prend effet
      immédiatement, sans attendre leur reconnexion.
    </p>
  )
}
