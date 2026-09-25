import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
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
import { blockedBy, operatorsQueryKey, orRefusal, Refusal, useRoles } from '~/lib/administration'
import { api, meQueryOptions } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { OperatorCreation } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'
import { usePermission } from '~/lib/permissions'

type Operator = components['schemas']['Operator']
type Role = components['schemas']['Role']

/** L'affichage porte l'état de l'envoi, jamais la validité du lien : un lien parti reste « sent ». */
function accessLinkStatus(operator: Operator): string {
  if (operator.status === 'disabled') return 'Désactivé'
  const link = operator.accessLink
  if (link === null) return 'Actif'
  if (link.state === 'failed') return 'Envoi en échec'
  if (link.state === 'sent') return 'Lien envoyé'
  return link.kind === 'activation' ? 'Activation en attente' : 'Envoi en attente'
}

const SELF_REASON =
  'Le compte de la session ne se désactive pas ici : un autre détenteur de operators:manage peut le faire.'

export const Route = createFileRoute('/_shell/operators')({ component: OperatorsScreen })

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

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Opérateurs</h1>
        <Button
          {...blockedBy(
            canManage ? undefined : 'La création d’un opérateur demande operators:manage.',
          )}
          onClick={() => setCreating(true)}
          variant="primary"
        >
          Nouvel opérateur
        </Button>
      </header>

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
  | { readonly kind: 'roles' | 'disable' | 'link'; readonly operator: Operator }
  | undefined

function OperatorsTable({ operators }: { readonly operators: readonly Operator[] }) {
  const { data: me } = useQuery(meQueryOptions)
  const canListRoles = usePermission('roles:manage')
  const [pending, setPending] = useState<Pending>(undefined)
  const setStatus = useSetStatus()
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
              <span className="operator-cell">
                <span>{operator.displayName}</span>
                <span className="operator-cell__email">{operator.email}</span>
              </span>
            ),
          },
          {
            key: 'status',
            header: 'Statut',
            cell: accessLinkStatus,
          },
          {
            key: 'roles',
            header: 'Rôles',
            cell: (operator) =>
              operator.roles.length === 0
                ? 'Aucun rôle'
                : operator.roles.map((role) => role.name).join(', '),
          },
          {
            key: 'factor',
            header: 'Second facteur',
            cell: (operator) => (operator.secondFactorEnrolled ? 'Configuré' : 'Aucun'),
          },
          {
            key: 'actions',
            header: 'Actions',
            cell: (operator) => {
              const self = operator.id === me?.operator.id

              return (
                <div className="row-actions">
                  <Button
                    {...blockedBy(
                      canListRoles
                        ? undefined
                        : 'La liste des rôles à attribuer demande roles:manage.',
                    )}
                    onClick={() => setPending({ kind: 'roles', operator })}
                    size="sm"
                  >
                    Modifier les rôles
                  </Button>
                  {operator.status === 'active' ? (
                    <Button
                      {...blockedBy(self ? SELF_REASON : undefined)}
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
                      operator.status === 'disabled'
                        ? 'Le compte est désactivé : réactivez-le avant d’envoyer un lien.'
                        : undefined,
                    )}
                    onClick={() => setPending({ kind: 'link', operator })}
                    size="sm"
                  >
                    Envoyer un lien
                  </Button>
                </div>
              )
            },
          },
        ]}
        rowKey={(operator) => operator.id}
        rows={operators}
      />

      {pending?.kind === 'roles' ? (
        <AssignRoles onClose={close} operator={pending.operator} />
      ) : null}
      {pending?.kind === 'disable' ? (
        <ConfirmDisable onClose={close} operator={pending.operator} />
      ) : null}
      {pending?.kind === 'link' ? (
        <ConfirmSendLink onClose={close} operator={pending.operator} />
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
    defaultValues: { email: '', displayName: '' },
  })
  const create = useMutation({
    mutationFn: (body: z.output<typeof OperatorCreation>) =>
      orRefusal(api.POST('/operators', { body }), 'L’opérateur n’a pas été créé'),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: operatorsQueryKey })
      toast({
        title: `Compte créé. Le lien d’activation part à ${created.email} ; il vaut 72 heures.`,
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
          Le compte naît actif, sans rôle ni mot de passe : son titulaire le définit par un lien
          d’activation reçu par e-mail, puis enrôle son second facteur. Action journalisée.
        </p>
        <Refusal error={create.error} />
        <Field error={errors.email?.message} label="Adresse e-mail">
          <Input autoComplete="off" required type="email" {...form.register('email')} />
        </Field>
        <Field error={errors.displayName?.message} label="Nom affiché">
          <Input autoComplete="off" required {...form.register('displayName')} />
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
            {...blockedBy(
              roles.isError
                ? 'Les rôles n’ont pas pu être chargés : rien ne peut être enregistré.'
                : undefined,
            )}
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
        <div>
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
              <span className="role-choice__name">{role.name}</span>{' '}
              <span className="role-choice__description">{role.description}</span>
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

function ConfirmSendLink({
  operator,
  onClose,
}: {
  readonly operator: Operator
  readonly onClose: () => void
}) {
  const queryClient = useQueryClient()
  // Un compte sans mot de passe porte toujours sa ligne d'activation : elle ne disparaît qu'à
  // l'usage, donc tout autre cas (null compris) appelle un lien de réinitialisation.
  const isActivation = operator.accessLink?.kind === 'activation'
  const send = useMutation({
    mutationFn: () =>
      orRefusal(
        api.POST('/operators/{operatorId}/access-link', {
          params: { path: { operatorId: operator.id } },
        }),
        'Le lien n’a pas été envoyé',
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
          <Button loading={send.isPending} onClick={() => send.mutate()} variant="primary">
            Envoyer le lien
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Envoyer un lien à ${operator.displayName}`}
    >
      <Refusal error={send.error} />
      <p>
        {isActivation ? (
          <>
            Un lien d’activation part à {operator.email} ; il vaut 72 heures. Un lien envoyé plus
            tôt cesse de valoir. Action journalisée.
          </>
        ) : (
          <>
            Un lien de réinitialisation part à {operator.email} ; il vaut 1 heure. Rien ne change
            avant son usage : son mot de passe, son second facteur et ses sessions restent valables
            jusque-là. À l’usage, il définit un nouveau mot de passe, son second facteur est retiré
            et ses sessions sont fermées. Action journalisée.
          </>
        )}
      </p>
    </Modal>
  )
}
