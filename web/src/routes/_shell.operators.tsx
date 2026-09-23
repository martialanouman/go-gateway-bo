import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'
import {
  Button,
  DataTable,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Skeleton,
  useToast,
} from '~/components/ui'
import { api, meQueryOptions, refusalMessage } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { OperatorCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Operator = components['schemas']['Operator']
type Role = components['schemas']['Role']

export const Route = createFileRoute('/_shell/operators')({ component: OperatorsScreen })

export const operatorsQueryKey = ['admin', 'operators'] as const
export const rolesQueryKey = ['admin', 'roles'] as const

/** Un contrôle interdit reste rendu, et se relie à la phrase qui dit pourquoi. */
export function blockedBy(reasonId: string | undefined) {
  return reasonId === undefined
    ? { blocked: false as const }
    : { blocked: true as const, 'aria-describedby': reasonId }
}

/** Un refus du BFF devient l'erreur de la requête, avec la phrase qu'il a rédigée. */
export async function orRefusal<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
  fallback: string,
): Promise<T> {
  const { data, error, response } = await call
  if (response.ok) return data as T
  throw new Error(refusalMessage(error, `${fallback} (HTTP ${response.status}).`))
}

export function useRoles(enabled: boolean) {
  return useQuery({
    queryKey: rolesQueryKey,
    queryFn: () => orRefusal(api.GET('/roles'), 'La liste des rôles n’a pas pu être lue'),
    enabled,
    retry: false,
  })
}

function OperatorsScreen() {
  const operators = useQuery({
    queryKey: operatorsQueryKey,
    queryFn: () => orRefusal(api.GET('/operators'), 'La liste des opérateurs n’a pas pu être lue'),
    // Comme `meQueryOptions` : un 403 ne se guérit pas en réessayant, et trois reprises espacées
    // faisaient attendre sept secondes l'état d'erreur et son « Réessayer ».
    retry: false,
  })
  const [creating, setCreating] = useState(false)
  const canManage = usePermission('operators:manage')
  const createLockedId = useId()

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Opérateurs</h1>
        <Button
          {...blockedBy(canManage ? undefined : createLockedId)}
          onClick={() => setCreating(true)}
          variant="primary"
        >
          Nouvel opérateur
        </Button>
      </header>
      {canManage ? null : (
        <p className="page__notes" id={createLockedId}>
          La création d’un opérateur demande <span className="mono">operators:manage</span>, que ce
          compte ne détient pas.
        </p>
      )}

      {operators.isPending ? (
        <LoadingState label="Chargement des opérateurs…">
          <Skeleton height={38} />
          <Skeleton height={38} />
          <Skeleton height={38} />
        </LoadingState>
      ) : operators.isError ? (
        <ErrorState
          description={operators.error.message}
          onRetry={() => void operators.refetch()}
          title="Les opérateurs n’ont pas pu être chargés"
          titleAs="h2"
        />
      ) : (
        <OperatorsTable operators={operators.data} />
      )}

      <CreateOperator onClose={() => setCreating(false)} open={creating} />
    </div>
  )
}

type Pending =
  | { readonly kind: 'roles' | 'disable' | 'reset'; readonly operator: Operator }
  | undefined

function OperatorsTable({ operators }: { readonly operators: readonly Operator[] }) {
  const { data: me } = useQuery(meQueryOptions)
  const canListRoles = usePermission('roles:manage')
  const [pending, setPending] = useState<Pending>(undefined)
  const setStatus = useSetStatus()
  const selfId = useId()
  const nothingToResetId = useId()
  const rolesLockedId = useId()
  const close = () => setPending(undefined)

  return (
    <>
      <Refusal error={setStatus.error} />
      <DataTable
        caption="Opérateurs du tableau de bord"
        columns={[
          {
            key: 'operator',
            header: 'Opérateur',
            cell: (operator) => (
              <>
                {operator.displayName} <span className="mono">{operator.email}</span>
              </>
            ),
          },
          {
            key: 'status',
            header: 'Statut',
            cell: (operator) => (operator.status === 'active' ? 'Actif' : 'Désactivé'),
          },
          {
            key: 'roles',
            header: 'Rôles',
            mono: true,
            cell: (operator) =>
              operator.roles.length === 0
                ? 'Aucun rôle'
                : operator.roles.map((role) => role.name).join(', '),
          },
          {
            key: 'factor',
            header: 'Second facteur',
            cell: (operator) => (operator.secondFactorEnrolled ? 'En place' : 'Aucun'),
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (operator) => {
              const self = operator.id === me?.operator.id

              return (
                <div className="row-actions">
                  <Button
                    {...blockedBy(canListRoles ? undefined : rolesLockedId)}
                    onClick={() => setPending({ kind: 'roles', operator })}
                    size="sm"
                  >
                    Modifier les rôles
                  </Button>
                  {operator.status === 'active' ? (
                    <Button
                      {...blockedBy(self ? selfId : undefined)}
                      onClick={() => setPending({ kind: 'disable', operator })}
                      size="sm"
                      variant="danger"
                    >
                      Désactiver
                    </Button>
                  ) : (
                    <Button
                      loading={
                        setStatus.isPending && setStatus.variables?.operator.id === operator.id
                      }
                      onClick={() => setStatus.mutate({ operator, status: 'active' })}
                      size="sm"
                    >
                      Réactiver
                    </Button>
                  )}
                  <Button
                    {...blockedBy(
                      self ? selfId : operator.secondFactorEnrolled ? undefined : nothingToResetId,
                    )}
                    onClick={() => setPending({ kind: 'reset', operator })}
                    size="sm"
                    variant="danger"
                  >
                    Réinitialiser le second facteur
                  </Button>
                </div>
              )
            },
          },
        ]}
        rowKey={(operator) => operator.id}
        rows={operators}
      />

      <div className="page__notes">
        <p id={selfId}>
          Le compte de la session ne se désactive ni ne se réinitialise ici : un autre détenteur de{' '}
          <span className="mono">operators:manage</span> peut le faire. Le remplacement de son
          propre facteur n’a pas encore d’écran.
        </p>
        <p id={nothingToResetId}>
          Réinitialisation sans objet : cet opérateur n’a aucun second facteur en place. Il en
          enrôlera un à sa prochaine connexion.
        </p>
        {canListRoles ? null : (
          <p id={rolesLockedId}>
            « Modifier les rôles » reste fermé sans <span className="mono">roles:manage</span> :
            c’est la seule clé qui ouvre la liste des rôles à choisir.
          </p>
        )}
        <p>Réactiver rend l’accès sans confirmation. Action journalisée.</p>
      </div>

      {pending?.kind === 'roles' ? (
        <AssignRoles onClose={close} operator={pending.operator} />
      ) : null}
      {pending?.kind === 'disable' ? (
        <ConfirmDisable onClose={close} operator={pending.operator} />
      ) : null}
      {pending?.kind === 'reset' ? (
        <ConfirmReset onClose={close} operator={pending.operator} />
      ) : null}
    </>
  )
}

function useSetStatus() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ operator, status }: { operator: Operator; status: 'active' | 'disabled' }) =>
      orRefusal(
        api.PATCH('/operators/{operatorId}', {
          params: { path: { operatorId: operator.id } },
          body: { status },
        }),
        'Le statut n’a pas été changé',
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: operatorsQueryKey }),
  })
}

export function Refusal({ error }: { readonly error: Error | null }) {
  return error === null ? null : (
    <p className="form-refusal" role="alert">
      {error.message}
    </p>
  )
}

function CreateOperator({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const form = useForm({
    resolver: formResolver(OperatorCreation),
    defaultValues: { email: '', displayName: '', password: '' },
  })
  const create = useMutation({
    // Le mot de passe est dans les variables de la mutation : sans `gcTime: 0`, le cache le garde
    // cinq minutes après la fermeture de la fenêtre (invariant b).
    gcTime: 0,
    mutationFn: (body: z.output<typeof OperatorCreation>) =>
      orRefusal(api.POST('/operators', { body }), 'L’opérateur n’a pas été créé'),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: operatorsQueryKey })
      toast({
        title: `Compte de ${created.displayName} créé : actif, sans rôle, second facteur à enrôler`,
        severity: 'success',
      })
      dismiss()
    },
  })
  const { errors } = form.formState

  function dismiss() {
    form.reset()
    create.reset()
    onClose()
  }

  return (
    <Modal
      footer={
        <>
          <Button onClick={dismiss}>Annuler</Button>
          <Button form="create-operator" loading={create.isPending} type="submit" variant="primary">
            Créer l’opérateur
          </Button>
        </>
      }
      onClose={dismiss}
      open={open}
      title="Nouvel opérateur"
    >
      <form
        className="form"
        id="create-operator"
        noValidate
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <p>
          Le compte naît actif et sans rôle. Le mot de passe se transmet hors du tableau de bord ;
          le titulaire enrôle son second facteur à sa première connexion. Action journalisée.
        </p>
        <Refusal error={create.error} />
        <Field error={errors.email?.message} label="Adresse e-mail">
          <Input autoComplete="off" required type="email" {...form.register('email')} />
        </Field>
        <Field error={errors.displayName?.message} label="Nom affiché">
          <Input autoComplete="off" required {...form.register('displayName')} />
        </Field>
        <Field
          error={errors.password?.message}
          hint="Douze caractères au moins ; aucune composition n’est exigée."
          label="Mot de passe"
        >
          <Input
            autoComplete="new-password"
            required
            type="password"
            {...form.register('password')}
          />
        </Field>
      </form>
    </Modal>
  )
}

function AssignRoles({
  operator,
  onClose,
}: {
  readonly operator: Operator
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const roles = useRoles(true)
  const unreadId = useId()
  const [chosen, setChosen] = useState(operator.roles.map((role) => role.id))
  const assign = useMutation({
    mutationFn: () =>
      orRefusal(
        api.POST('/operators/{operatorId}/roles', {
          params: { path: { operatorId: operator.id } },
          body: { roleIds: chosen },
        }),
        'Les rôles n’ont pas été changés',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: operatorsQueryKey })
      // Ses propres rôles peuvent changer : le rail et les gardes de l'écran relisent la session.
      // Aucun test ne rougit si cette ligne disparaît, ce qui a été vérifié : le décor rend des
      // permissions de session fixes, et c'est le serveur qui fait foi à la requête suivante.
      await queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey })
      onClose()
    },
  })

  function toggle(role: Role) {
    setChosen((held) =>
      held.includes(role.id) ? held.filter((id) => id !== role.id) : [...held, role.id],
    )
  }

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            {...blockedBy(roles.isError ? unreadId : undefined)}
            loading={assign.isPending || roles.isPending}
            onClick={() => assign.mutate()}
            variant="primary"
          >
            Enregistrer les rôles
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Rôles de ${operator.displayName}`}
    >
      <Refusal error={assign.error} />
      {roles.isPending ? (
        <LoadingState label="Chargement des rôles…">
          <Skeleton height={20} />
          <Skeleton height={20} />
        </LoadingState>
      ) : roles.isError ? (
        <div id={unreadId}>
          <ErrorState
            description={roles.error.message}
            onRetry={() => void roles.refetch()}
            title="Les rôles n’ont pas pu être chargés : rien ne peut être enregistré"
          />
        </div>
      ) : (
        <fieldset className="role-choice">
          <legend>Rôles</legend>
          <p>
            Les permissions s’additionnent : l’opérateur détient l’union de ses rôles, dès sa
            prochaine requête. Action journalisée.
          </p>
          {roles.data.map((role) => (
            <label className="role-choice__option" key={role.id}>
              <input
                checked={chosen.includes(role.id)}
                onChange={() => toggle(role)}
                type="checkbox"
              />
              <span className="mono">{role.name}</span> {role.description}
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  )
}

function ConfirmDisable({
  operator,
  onClose,
}: {
  readonly operator: Operator
  readonly onClose: () => void
}) {
  const setStatus = useSetStatus()

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button
            loading={setStatus.isPending}
            onClick={() =>
              setStatus.mutate({ operator, status: 'disabled' }, { onSuccess: onClose })
            }
            variant="danger"
          >
            Désactiver le compte
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Désactiver ${operator.displayName}`}
    >
      <Refusal error={setStatus.error} />
      <p>
        Ses sessions sont fermées immédiatement, et il ne peut plus se connecter. Ses rôles et son
        second facteur restent en place ; « Réactiver » lui rend l’accès, par une nouvelle
        connexion. Action journalisée.
      </p>
    </Modal>
  )
}

function ConfirmReset({
  operator,
  onClose,
}: {
  readonly operator: Operator
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  const reset = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/operators/{operatorId}/second-factors', {
          params: { path: { operatorId: operator.id } },
        }),
        'Le second facteur n’a pas été réinitialisé',
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: operatorsQueryKey })
      onClose()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={reset.isPending} onClick={() => reset.mutate()} variant="danger">
            Réinitialiser le second facteur
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Réinitialiser le second facteur de ${operator.displayName}`}
    >
      <Refusal error={reset.error} />
      <p>
        Son application d’authentification, ses codes de récupération et ses clés d’accès sont
        retirés, et ses sessions fermées. À sa prochaine connexion, il enrôle un nouveau facteur.
        Action journalisée.
      </p>
    </Modal>
  )
}
