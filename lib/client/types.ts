import type { AppSettings } from '@/lib/domain/schemas'
import type { PublicEnvironment } from '@/lib/server/control-plane'
import type { IntegrationInfo } from '@/lib/server/context'
import type { Actor } from '@/lib/engine/support'

export type Persona = Actor & { email: string; description: string }

export interface PlatformInfo {
  controlPlane: string
  controlPlanePersistent: boolean
  secretManager: string
  secretsPersistent: boolean
}

export interface SessionData {
  actor: Persona
  personas: Persona[]
  environments: PublicEnvironment[]
  integration: IntegrationInfo | null
  settings: AppSettings | null
  contextError: { code: string; message: string } | null
  platform: PlatformInfo
}

export type { PublicEnvironment, IntegrationInfo, Actor }
