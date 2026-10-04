import type { ReactNode } from 'react'
import { CopyButton } from '~/components/totp-enrollment'
import { Button, Modal } from '~/components/ui'

/**
 * L'affichage unique de l'invariant (b). Le secret n'existe que dans l'état du parent qui ouvre cette
 * modale : la fermer l'efface, et rien ne permet de la rouvrir.
 */
export function SecretShown({
  title,
  secret,
  onClose,
  children,
}: {
  readonly title: string
  readonly secret: string
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  return (
    <Modal
      footer={
        <Button onClick={onClose} variant="primary">
          J’ai copié le secret
        </Button>
      }
      onClose={onClose}
      open
      title={title}
    >
      <p>{children}</p>
      <p className="mono">{secret}</p>
      <CopyButton done="Secret copié." label="Copier le secret" value={secret} />
    </Modal>
  )
}
