/**
 * `/operateurs` — qui accède à la console, et avec quels droits.
 *
 * ## Ce que l'écran ne fait pas
 *
 * Il n'autorise rien. Chaque action repart au BFF, qui revérifie la permission et écrit sa ligne
 * d'audit (invariant c) ; ce qui se décide ici est ce qu'on **montre**. Un opérateur qui neutralise
 * la garde de rendu voit des boutons qui échouent tous.
 *
 * ## Le mot de passe initial n'apparaît qu'une fois
 *
 * Il n'existe que dans la réponse à la création : rien ne le stocke en clair, rien ne le
 * réaffichera, et aucune action « révéler » n'existe (invariant b). La modale le dit avant de le
 * montrer, parce qu'un administrateur qui ferme trop vite doit refaire une création.
 *
 * ## Les refus s'affichent en bandeau, pas en toast
 *
 * Ils nomment la clé manquante ou la règle enfreinte, donc citent entre guillemets — ce que
 * `assertToastText` refuse, et à raison : un refus se relit, un toast s'efface. Voir `notices.tsx`.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  AdminRequestError,
  type CreatedOperator,
  createOperator,
  type DirectoryOperator,
  OPERATORS_QUERY_KEY,
  operatorsQueryOptions,
  type RoleRef,
  resetOperatorMfa,
  updateOperator,
} from '~/components/admin/api'
import { PermissionRequired, RefusalNotice } from '~/components/admin/notices'
import { RoleChecklist } from '~/components/admin/role-checklist'
import { ConfirmDialog, Dialog, DropdownMenu, useToast } from '~/components/overlays'
import { usePermission } from '~/components/permission'
import { Button, StatusPill, Table, type TableColumn, TextField } from '~/components/primitives'
import { Page } from '~/components/shell'
import { Empty, ErrorState, Loading } from '~/components/states'

export const Route = createFileRoute('/_shell/operateurs')({
  component: OperateursScreen,
})

const DATE_FORMAT = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

/** « Jamais » plutôt qu'un tiret : un compte qui n'a jamais servi est ce qu'on cherche à repérer. */
function lastLogin(value: string | null): string {
  return value === null ? 'jamais' : DATE_FORMAT.format(new Date(value))
}

/**
 * Le statut d'un opérateur, dans la sémantique de la charte.
 *
 * Le libellé reste `active` / `disabled` — les valeurs de l'enum `operator_status` de ce dépôt, que
 * l'on grep dans les logs. La tonalité choisie pour `disabled` est celle du repos et non celle de la
 * panne : un compte fermé est une décision administrative, pas un incident à réparer.
 */
function StatusCell({ status }: { status: DirectoryOperator['status'] }) {
  return status === 'active' ? (
    <StatusPill kind="entity" state="active" label="active" />
  ) : (
    <StatusPill kind="entity" state="closed" label="disabled" />
  )
}

type Confirmation =
  | { readonly kind: 'status'; readonly operator: DirectoryOperator }
  | { readonly kind: 'mfa'; readonly operator: DirectoryOperator }

function OperateursScreen() {
  const { granted } = usePermission('operators:manage')
  const queryClient = useQueryClient()
  const { notify } = useToast()

  const { data, error, isPending, refetch } = useQuery({
    ...operatorsQueryOptions(),
    // Une lecture que le serveur refusera n'est pas lancée : elle peindrait une panne là où il y a
    // une permission manquante, et le rail n'affiche déjà pas l'entrée.
    enabled: granted === true,
  })

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<DirectoryOperator | undefined>(undefined)
  const [confirming, setConfirming] = useState<Confirmation | undefined>(undefined)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const roles = data?.roles ?? []

  async function refresh(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: OPERATORS_QUERY_KEY })
  }

  async function applyStatus(operator: DirectoryOperator): Promise<void> {
    setBusy(true)
    const next = operator.status === 'active' ? 'disabled' : 'active'
    const outcome = await updateOperator({ operatorId: operator.id, status: next })
    setBusy(false)
    setConfirming(undefined)

    if (!outcome.ok) {
      setRefusal(outcome.message)
      return
    }

    setRefusal(undefined)
    notify({
      title: next === 'disabled' ? 'Compte désactivé.' : 'Compte réactivé.',
      description:
        next === 'disabled'
          ? `Sessions fermées : ${outcome.data.closedSessions}.`
          : 'Le compte peut se reconnecter.',
      severity: 'success',
    })
    await refresh()
  }

  async function applyMfaReset(operator: DirectoryOperator): Promise<void> {
    setBusy(true)
    const outcome = await resetOperatorMfa(operator.id)
    setBusy(false)
    setConfirming(undefined)

    if (!outcome.ok) {
      setRefusal(outcome.message)
      return
    }

    setRefusal(undefined)
    notify({
      title: 'Second facteur effacé.',
      description: `Sessions fermées : ${outcome.data.closedSessions}. Le compte le réenrôlera à sa prochaine connexion.`,
      severity: 'success',
    })
    await refresh()
  }

  const columns: readonly TableColumn<DirectoryOperator>[] = [
    {
      key: 'identite',
      header: 'Opérateur',
      cell: (row) => (
        <span className="ui-directory__identity">
          <span className="ui-directory__name">{row.displayName}</span>
          <code className="ui-directory__email">{row.email}</code>
        </span>
      ),
    },
    {
      key: 'roles',
      header: 'Rôles',
      cell: (row) =>
        row.roles.length === 0 ? (
          <span className="ui-directory__none">aucun rôle</span>
        ) : (
          <span className="ui-directory__key">
            {row.roles.map((role) => role.name).join(' · ')}
          </span>
        ),
    },
    {
      key: 'facteur',
      header: 'Second facteur',
      cell: (row) =>
        row.mfaEnrolled ? (
          <StatusPill kind="entity" state="active" label="enrôlé" />
        ) : (
          // Un compte sans second facteur n'ouvre aucun écran (§6.9) : c'est un compte à surveiller,
          // pas un compte en panne.
          <StatusPill kind="entity" state="closed" label="aucun" />
        ),
    },
    {
      key: 'connexion',
      header: 'Dernière connexion',
      mono: true,
      cell: (row) => lastLogin(row.lastLoginAt),
    },
    { key: 'statut', header: 'Statut', cell: (row) => <StatusCell status={row.status} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (row) => (
        <DropdownMenu
          trigger="Actions"
          actions={[
            { label: 'Modifier les rôles', onSelect: () => setEditing(row) },
            {
              label: row.status === 'active' ? 'Désactiver le compte' : 'Réactiver le compte',
              destructive: row.status === 'active',
              onSelect: () => setConfirming({ kind: 'status', operator: row }),
            },
            {
              label: 'Réinitialiser le second facteur',
              onSelect: () => setConfirming({ kind: 'mfa', operator: row }),
            },
          ]}
        />
      ),
    },
  ]

  return (
    <Page
      title="Opérateurs"
      actions={
        granted === true ? (
          <Button variant="primary" onClick={() => setCreating(true)}>
            Créer un opérateur
          </Button>
        ) : null
      }
    >
      {refusal ? <RefusalNotice message={refusal} /> : null}

      <Content
        error={error}
        granted={granted}
        isPending={isPending}
        onCreate={() => setCreating(true)}
        onRetry={() => void refetch()}
        operators={data?.operators ?? []}
        columns={columns}
      />

      <CreateOperatorDialog
        open={creating}
        onOpenChange={setCreating}
        roles={roles}
        onCreated={refresh}
      />

      <EditRolesDialog
        operator={editing}
        onOpenChange={(open) => !open && setEditing(undefined)}
        roles={roles}
        onSaved={refresh}
        onRefused={setRefusal}
        notify={notify}
      />

      <ConfirmDialog
        open={confirming?.kind === 'status'}
        onOpenChange={(open) => !open && setConfirming(undefined)}
        title={
          confirming?.operator.status === 'active' ? 'Désactiver ce compte' : 'Réactiver ce compte'
        }
        consequence={
          confirming?.operator.status === 'active'
            ? // La conséquence en clair : c'est la fermeture des sessions qui surprend, pas le
              // changement de statut.
              'Ses sessions ouvertes se ferment immédiatement, sur toutes les instances. Le compte ne peut plus se connecter tant qu’il n’est pas réactivé.'
            : 'Le compte peut de nouveau se connecter, avec son second facteur existant. Ses rôles sont inchangés.'
        }
        confirmLabel={
          confirming?.operator.status === 'active' ? 'Désactiver le compte' : 'Réactiver le compte'
        }
        destructive={confirming?.operator.status === 'active'}
        onConfirm={() => confirming && void applyStatus(confirming.operator)}
      />

      <ConfirmDialog
        open={confirming?.kind === 'mfa'}
        onOpenChange={(open) => !open && setConfirming(undefined)}
        title="Réinitialiser le second facteur"
        consequence="Le facteur TOTP, les appareils enregistrés et les codes de récupération sont effacés, et les sessions ouvertes se ferment. Le compte devra enrôler un nouveau facteur à sa prochaine connexion."
        confirmLabel="Effacer le second facteur"
        onConfirm={() => confirming && void applyMfaReset(confirming.operator)}
      />

      {busy ? <span className="ui-directory__busy">Action en cours…</span> : null}
    </Page>
  )
}

/** Les cinq états de contenu, dans l'ordre où ils se décident. */
function Content({
  granted,
  isPending,
  error,
  operators,
  columns,
  onRetry,
  onCreate,
}: {
  readonly granted: boolean | undefined
  readonly isPending: boolean
  readonly error: unknown
  readonly operators: readonly DirectoryOperator[]
  readonly columns: readonly TableColumn<DirectoryOperator>[]
  readonly onRetry: () => void
  readonly onCreate: () => void
}) {
  if (granted === undefined) return <Loading label="Ouverture de l’annuaire" rows={5} />

  if (granted === false) {
    return <PermissionRequired permission="operators:manage" what="La gestion des opérateurs" />
  }

  if (error) {
    return (
      <ErrorState
        status={error instanceof AdminRequestError ? error.status : 0}
        onRetry={onRetry}
      />
    )
  }

  if (isPending) return <Loading label="Chargement des opérateurs" rows={5} />

  if (operators.length === 0) {
    return (
      <Empty
        title="Aucun opérateur"
        description="Personne n’accède encore à la console. Créez un compte, puis attribuez-lui des rôles : un compte sans rôle se connecte mais n’ouvre aucun écran."
        action={{ label: 'Créer un opérateur', onClick: onCreate }}
      />
    )
  }

  return (
    <Table
      caption="Opérateurs de la console, leurs rôles et leur dernière connexion"
      columns={columns}
      rows={operators}
      rowKey={(row) => row.id}
    />
  )
}

function CreateOperatorDialog({
  open,
  onOpenChange,
  roles,
  onCreated,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly roles: readonly RoleRef[]
  readonly onCreated: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [selected, setSelected] = useState<readonly string[]>([])
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const [created, setCreated] = useState<CreatedOperator | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  function close(): void {
    // Tout est remis à zéro à la fermeture, **y compris le secret** : rouvrir la modale ne doit pas
    // réafficher un mot de passe déjà montré (invariant b).
    setEmail('')
    setDisplayName('')
    setSelected([])
    setRefusal(undefined)
    setCreated(undefined)
    onOpenChange(false)
  }

  async function submit(): Promise<void> {
    setBusy(true)
    const outcome = await createOperator({ email, displayName, roleIds: [...selected] })
    setBusy(false)

    if (!outcome.ok) {
      setRefusal(outcome.message)
      return
    }

    setRefusal(undefined)
    setCreated(outcome.data)
    await onCreated()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={created ? 'Compte créé' : 'Créer un opérateur'}
      description={
        created
          ? 'Le mot de passe ci-dessous n’est affiché qu’une seule fois : rien ne le conserve en clair et aucune action ne le réaffichera.'
          : 'Le compte reçoit un mot de passe tiré au sort, affiché une seule fois. Il enrôlera son second facteur à sa première connexion.'
      }
      footer={
        created ? (
          <Button variant="primary" onClick={close}>
            J’ai noté le mot de passe
          </Button>
        ) : (
          <>
            <Button onClick={close}>Annuler</Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              Créer le compte
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="ui-directory__secret">
          <p className="ui-directory__secret-label">Mot de passe initial</p>
          <code className="ui-directory__secret-value">{created.temporaryPassword}</code>
          <p className="ui-directory__secret-note">
            Transmettez-le par un canal que vous jugez sûr. Si vous le perdez, créez un nouveau mot
            de passe depuis cet écran — il ne peut pas être retrouvé.
          </p>
        </div>
      ) : (
        <>
          {refusal ? <RefusalNotice message={refusal} /> : null}

          <TextField
            label="Adresse email"
            mono
            type="email"
            value={email}
            hint="Sert d’identifiant de connexion. La casse ne distingue pas deux adresses."
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label="Nom affiché"
            value={displayName}
            hint="Ce nom identifie la personne dans le journal d’audit."
            onChange={(event) => setDisplayName(event.target.value)}
          />

          <RoleChecklist
            legend="Rôles attribués"
            roles={roles}
            selected={selected}
            onToggle={(roleId) =>
              setSelected((current) =>
                current.includes(roleId)
                  ? current.filter((id) => id !== roleId)
                  : [...current, roleId],
              )
            }
          />
        </>
      )}
    </Dialog>
  )
}

function EditRolesDialog({
  operator,
  onOpenChange,
  roles,
  onSaved,
  onRefused,
  notify,
}: {
  readonly operator: DirectoryOperator | undefined
  readonly onOpenChange: (open: boolean) => void
  readonly roles: readonly RoleRef[]
  readonly onSaved: () => Promise<void>
  readonly onRefused: (message: string) => void
  readonly notify: ReturnType<typeof useToast>['notify']
}) {
  // La clé remonte l'état à l'ouverture : sans elle, la sélection du précédent opérateur resterait
  // en place, et l'on enregistrerait ses rôles sur quelqu'un d'autre.
  return operator ? (
    <EditRolesForm
      key={operator.id}
      operator={operator}
      onOpenChange={onOpenChange}
      roles={roles}
      onSaved={onSaved}
      onRefused={onRefused}
      notify={notify}
    />
  ) : null
}

function EditRolesForm({
  operator,
  onOpenChange,
  roles,
  onSaved,
  onRefused,
  notify,
}: {
  readonly operator: DirectoryOperator
  readonly onOpenChange: (open: boolean) => void
  readonly roles: readonly RoleRef[]
  readonly onSaved: () => Promise<void>
  readonly onRefused: (message: string) => void
  readonly notify: ReturnType<typeof useToast>['notify']
}) {
  const [selected, setSelected] = useState<readonly string[]>(operator.roles.map((role) => role.id))
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    const outcome = await updateOperator({ operatorId: operator.id, roleIds: [...selected] })
    setBusy(false)

    if (!outcome.ok) {
      onOpenChange(false)
      onRefused(outcome.message)
      return
    }

    notify({ title: 'Rôles enregistrés.', severity: 'success' })
    onOpenChange(false)
    await onSaved()
  }

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={`Rôles de ${operator.displayName}`}
      description="Un opérateur cumule les permissions de tous ses rôles : il n’y a ni priorité ni héritage. Retirer un rôle retire son pouvoir immédiatement, sans attendre une reconnexion."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Enregistrer les rôles
          </Button>
        </>
      }
    >
      <RoleChecklist
        legend="Rôles attribués"
        roles={roles}
        selected={selected}
        onToggle={(roleId) =>
          setSelected((current) =>
            current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
          )
        }
      />
    </Dialog>
  )
}
