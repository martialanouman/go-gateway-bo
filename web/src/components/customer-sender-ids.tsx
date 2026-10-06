import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  NoResults,
  Select,
  Skeleton,
  useToast,
} from '~/components/ui'
import { blockedBy, fieldRefusalsOf, orRefusal, Refusal } from '~/lib/administration'
import { api } from '~/lib/api'
import type { components } from '~/lib/api.gen'
import { SenderIdCreation, SenderIdRateLimitSetting } from '~/lib/contract.gen'
import { formResolver } from '~/lib/form'

type SenderId = components['schemas']['SenderId']
type TrafficCategory = components['schemas']['TrafficCategory']
type Blocked = ReturnType<typeof blockedBy>
type Pending =
  | { readonly kind: 'register' }
  | { readonly kind: 'classify' | 'limit' | 'delete'; readonly sender: SenderId }

const ALL = 'all'
const customersQueryKey = ['gateway', 'customers'] as const
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const CATEGORIES: readonly TrafficCategory[] = ['otp', 'transactional', 'marketing']
const CATEGORY_LABELS: Record<TrafficCategory, string> = {
  otp: 'OTP',
  transactional: 'Transactionnel',
  marketing: 'Marketing',
}
const STATUS_LABELS: Record<SenderId['status'], string> = {
  pending_carrier_approval: 'En attente d’approbation',
  active: 'Approuvé',
  disabled: 'Désactivé',
}
const ALREADY_USED = 'Ce nom a déjà servi à envoyer : désactivez-le plutôt.'
const UNREADABLE_COUNTER = 'Compteur illisible : inconnu, pas zéro'

export function CustomerSenderIds({
  customerId,
  blocked,
  onDeleted,
}: {
  readonly customerId: string
  readonly blocked: Blocked
  readonly onDeleted: () => void
}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [category, setCategory] = useState<TrafficCategory | typeof ALL>(ALL)
  const close = () => setPending(null)
  const senders = useQuery({
    queryKey: [...customersQueryKey, customerId, 'sender-ids'],
    queryFn: () =>
      orRefusal(
        api.GET('/customers/{customerId}/sender-ids', { params: { path: { customerId } } }),
        'Les noms d’expéditeur n’ont pas pu être lus',
      ),
    retry: false,
  })
  const shown = (senders.data ?? []).filter(
    (sender) => category === ALL || sender.trafficCategory === category,
  )

  return (
    <>
      <Card
        actions={
          <>
            <Select
              label="Catégorie"
              onValueChange={(value) => setCategory(value as TrafficCategory | typeof ALL)}
              options={[
                { value: ALL, label: 'Toutes les catégories' },
                ...CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] })),
              ]}
              size="sm"
              value={category}
            />
            <Button
              {...blocked}
              onClick={() => setPending({ kind: 'register' })}
              size="sm"
              variant="primary"
            >
              Enregistrer un nom d’expéditeur
            </Button>
          </>
        }
        flush={shown.length > 0}
        title="Noms d’expéditeur"
      >
        {senders.isPending ? (
          <LoadingState label="Chargement des noms d’expéditeur…">
            <Skeleton height={38} />
          </LoadingState>
        ) : senders.isError ? (
          <ErrorState
            description={senders.error.message}
            onRetry={() => void senders.refetch()}
            title="Les noms d’expéditeur n’ont pas pu être chargés"
            titleAs="h3"
          />
        ) : senders.data.length === 0 ? (
          <EmptyState
            description="Un nom d’expéditeur enregistré naît en attente d’approbation de l’opérateur télécom."
            title="Aucun nom d’expéditeur pour l’instant"
            titleAs="h3"
          />
        ) : shown.length === 0 ? (
          <NoResults
            description="Choisissez « Toutes les catégories » pour revoir tous les noms du client."
            onReset={() => setCategory(ALL)}
            title="Aucun nom d’expéditeur dans cette catégorie"
            titleAs="h3"
          />
        ) : (
          <DataTable
            caption="Noms d’expéditeur du client"
            dense
            columns={[
              {
                key: 'address',
                header: 'Nom',
                cell: (sender: SenderId) => <span className="mono">{sender.address}</span>,
              },
              {
                key: 'trafficCategory',
                header: 'Catégorie',
                cell: (sender: SenderId) => CATEGORY_LABELS[sender.trafficCategory],
              },
              {
                key: 'rateLimit',
                header: 'Débit',
                cell: (sender: SenderId) =>
                  sender.rateLimit === null
                    ? 'Celle du compte'
                    : `${sender.rateLimit.maxPerSec}/s, rafale ${sender.rateLimit.burstCapacity}`,
              },
              {
                key: 'status',
                header: 'Statut',
                cell: (sender: SenderId) => STATUS_LABELS[sender.status],
              },
              {
                key: 'recentCategoryMismatches24h',
                header: 'Signalements 24 h',
                cell: (sender: SenderId) =>
                  sender.recentCategoryMismatches24h === null ? (
                    <>
                      <span aria-hidden title={UNREADABLE_COUNTER}>
                        —
                      </span>
                      <span className="ui-visually-hidden">{UNREADABLE_COUNTER}</span>
                    </>
                  ) : (
                    sender.recentCategoryMismatches24h
                  ),
              },
              {
                key: 'createdAt',
                header: 'Enregistré le',
                cell: (sender: SenderId) => dateFormat.format(new Date(sender.createdAt)),
              },
              {
                key: 'actions',
                header: 'Actions',
                cell: (sender: SenderId) => (
                  <div className="row-actions">
                    <SenderStatusToggle blocked={blocked} customerId={customerId} sender={sender} />
                    <Button
                      {...blocked}
                      aria-label={`Classer ${sender.address}`}
                      onClick={() => setPending({ kind: 'classify', sender })}
                      size="sm"
                    >
                      Classer
                    </Button>
                    <Button
                      {...blocked}
                      aria-label={`Limiter ${sender.address}`}
                      onClick={() => setPending({ kind: 'limit', sender })}
                      size="sm"
                    >
                      Limiter
                    </Button>
                    <Button
                      {...(sender.firstUsedAt === null ? blocked : blockedBy(ALREADY_USED))}
                      aria-label={`Supprimer ${sender.address}`}
                      onClick={() => setPending({ kind: 'delete', sender })}
                      size="sm"
                      variant="danger"
                    >
                      Supprimer
                    </Button>
                  </div>
                ),
              },
            ]}
            rowKey={(sender) => sender.id}
            rows={shown}
          />
        )}
      </Card>

      {pending?.kind === 'register' ? (
        <RegisterSender customerId={customerId} onClose={close} />
      ) : null}
      {pending?.kind === 'classify' ? (
        <ClassifySender customerId={customerId} onClose={close} sender={pending.sender} />
      ) : null}
      {pending?.kind === 'limit' ? (
        <LimitSender customerId={customerId} onClose={close} sender={pending.sender} />
      ) : null}
      {pending?.kind === 'delete' ? (
        <ConfirmDeleteSender
          customerId={customerId}
          onClose={close}
          onDone={() => {
            close()
            onDeleted()
          }}
          sender={pending.sender}
        />
      ) : null}
    </>
  )
}

function useSenderChanged(customerId: string) {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: [...customersQueryKey, customerId] })
}

function SenderStatusToggle({
  customerId,
  sender,
  blocked,
}: {
  readonly customerId: string
  readonly sender: SenderId
  readonly blocked: Blocked
}) {
  const changed = useSenderChanged(customerId)
  const toast = useToast()
  const next = sender.status === 'active' ? 'disabled' : 'active'
  const gesture =
    next === 'disabled'
      ? 'Désactiver'
      : sender.status === 'pending_carrier_approval'
        ? 'Approuver'
        : 'Réactiver'
  const done = { Désactiver: 'désactivé', Approuver: 'approuvé', Réactiver: 'réactivé' }[gesture]
  const change = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PATCH('/customers/{customerId}/sender-ids/{senderId}', {
          params: { path: { customerId, senderId: sender.id } },
          body: { status: next },
        }),
        'Le nom d’expéditeur n’a pas été modifié',
      ),
    onSuccess: async (updated) => {
      await changed()
      toast({ title: `${updated.address} est ${done}.`, severity: 'success' })
    },
    onError: (error) => toast({ title: error.message, severity: 'warning' }),
  })

  return (
    <Button
      {...blocked}
      aria-label={`${gesture} ${sender.address}`}
      loading={change.isPending}
      onClick={() => change.mutate()}
      size="sm"
    >
      {gesture}
    </Button>
  )
}

function ClassifySender({
  customerId,
  sender,
  onClose,
}: {
  readonly customerId: string
  readonly sender: SenderId
  readonly onClose: () => void
}) {
  const changed = useSenderChanged(customerId)
  const toast = useToast()
  const [target, setTarget] = useState<TrafficCategory>(
    CATEGORIES.find((candidate) => candidate !== sender.trafficCategory) ?? 'otp',
  )
  const classify = useMutation({
    mutationFn: () =>
      orRefusal(
        api.PATCH('/customers/{customerId}/sender-ids/{senderId}', {
          params: { path: { customerId, senderId: sender.id } },
          body: { trafficCategory: target },
        }),
        'Le nom d’expéditeur n’a pas été classé',
      ),
    onSuccess: async (updated) => {
      await changed()
      toast({
        title: `${updated.address} est classé en ${CATEGORY_LABELS[updated.trafficCategory]}.`,
        severity: 'success',
      })
      onClose()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={classify.isPending} onClick={() => classify.mutate()} variant="primary">
            Classer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Classer ${sender.address} en ${CATEGORY_LABELS[target]} ?`}
    >
      <Refusal error={classify.error} />
      <Select
        label="Catégorie"
        onValueChange={(value) => setTarget(value as TrafficCategory)}
        options={CATEGORIES.filter((value) => value !== sender.trafficCategory).map((value) => ({
          value,
          label: CATEGORY_LABELS[value],
        }))}
        value={target}
      />
      <p>
        {target === 'marketing'
          ? 'Ce trafic perdra sa priorité et passera après l’OTP et le transactionnel sur les connecteurs partagés.'
          : 'Ce trafic passera devant le marketing sur les connecteurs partagés.'}
      </p>
      <p>L’action est enregistrée dans le journal d’audit, avec l’ancienne catégorie.</p>
    </Modal>
  )
}

function LimitSender({
  customerId,
  sender,
  onClose,
}: {
  readonly customerId: string
  readonly sender: SenderId
  readonly onClose: () => void
}) {
  const changed = useSenderChanged(customerId)
  const optionalNumber = (value: string) => (value === '' ? undefined : Number(value))
  const form = useForm({
    resolver: formResolver(SenderIdRateLimitSetting),
    defaultValues: {
      maxPerSec: sender.rateLimit?.maxPerSec,
      burstCapacity: sender.rateLimit?.burstCapacity,
    },
  })
  const limit = useMutation({
    mutationFn: (body: { maxPerSec: number; burstCapacity?: number }) =>
      orRefusal(
        api.PUT('/customers/{customerId}/sender-ids/{senderId}/rate-limit', {
          params: { path: { customerId, senderId: sender.id } },
          body,
        }),
        'La limite n’a pas été posée',
      ),
    onSuccess: async () => {
      await changed()
      onClose()
    },
    onError: (error) => {
      for (const { field, message } of fieldRefusalsOf(error)) {
        if (field === 'maxPerSec' || field === 'burstCapacity') form.setError(field, { message })
      }
    },
  })
  const unlimit = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/customers/{customerId}/sender-ids/{senderId}/rate-limit', {
          params: { path: { customerId, senderId: sender.id } },
        }),
        'La limite n’a pas été retirée',
      ),
    onSuccess: async () => {
      await changed()
      onClose()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          {sender.rateLimit === null ? null : (
            <Button loading={unlimit.isPending} onClick={() => unlimit.mutate()}>
              Retirer la limite
            </Button>
          )}
          <Button form="limit-sender" loading={limit.isPending} type="submit" variant="primary">
            Limiter
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Limiter le débit de ${sender.address} ?`}
    >
      <form
        className="form"
        id="limit-sender"
        noValidate
        onSubmit={form.handleSubmit((values) => limit.mutate(values))}
      >
        <p>
          Au-delà, la passerelle refusera le message à l’admission (429 en REST, ESME_RTHROTTLED en
          SMPP) et n’écrira aucun CDR : le CDR Explorer ne le montrera pas.
        </p>
        <Refusal error={limit.error ?? unlimit.error} />
        <Field error={form.formState.errors.maxPerSec?.message} label="Messages par seconde">
          <Input
            inputMode="numeric"
            required
            {...form.register('maxPerSec', { setValueAs: optionalNumber })}
          />
        </Field>
        <Field
          error={form.formState.errors.burstCapacity?.message}
          hint="Vide : égale au débit."
          label="Rafale"
        >
          <Input
            inputMode="numeric"
            {...form.register('burstCapacity', { setValueAs: optionalNumber })}
          />
        </Field>
      </form>
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
  const changed = useSenderChanged(customerId)
  const form = useForm({ resolver: formResolver(SenderIdCreation), defaultValues: { address: '' } })
  const register = useMutation({
    mutationFn: (body: { address: string }) =>
      orRefusal(
        api.POST('/customers/{customerId}/sender-ids', { params: { path: { customerId } }, body }),
        'Le nom d’expéditeur n’a pas été enregistré',
      ),
    onSuccess: async () => {
      await changed()
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
      title="Enregistrer un nom d’expéditeur"
    >
      <form
        className="form"
        id="register-sender"
        noValidate
        onSubmit={form.handleSubmit((values) => register.mutate(values))}
      >
        <p>
          Le nom d’expéditeur naît en attente d’approbation de l’opérateur télécom, classé en
          marketing. Action journalisée.
        </p>
        <Refusal error={placed ? null : register.error} />
        <Field
          error={form.formState.errors.address?.message}
          hint="De 2 à 11 caractères : lettres, chiffres, espaces, + et -."
          label="Nom"
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
  const changed = useSenderChanged(customerId)
  const remove = useMutation({
    mutationFn: () =>
      orRefusal(
        api.DELETE('/customers/{customerId}/sender-ids/{senderId}', {
          params: { path: { customerId, senderId: sender.id } },
        }),
        'Le nom d’expéditeur n’a pas été supprimé',
      ),
    onSuccess: async () => {
      await changed()
      onDone()
    },
  })

  return (
    <Modal
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button loading={remove.isPending} onClick={() => remove.mutate()} variant="danger">
            Supprimer
          </Button>
        </>
      }
      onClose={onClose}
      open
      title={`Supprimer le nom d’expéditeur ${sender.address} ?`}
    >
      <Refusal error={remove.error} />
      <p>
        {sender.address} disparaîtra de la liste du client. Pour l’utiliser de nouveau, il faudra
        l’enregistrer et attendre une nouvelle approbation de l’opérateur télécom.
      </p>
      <p>L’action est enregistrée dans le journal d’audit.</p>
    </Modal>
  )
}
