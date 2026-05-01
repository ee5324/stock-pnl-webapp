import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { auth } from '../firebase'

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
}

const whitelistConfig = (
  import.meta.env.VITE_AUTH_WHITELIST_EMAILS ?? 'y.chengju@gmail.com'
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)

export const authWhitelistEnabled =
  import.meta.env.VITE_ENABLE_AUTH_WHITELIST === 'true'

export const authWhitelistEmails = [...new Set(whitelistConfig)]

export function isEmailWhitelisted(email: string | null): boolean {
  if (!email) {
    return false
  }

  return authWhitelistEmails.includes(email.trim().toLowerCase())
}

export function subscribeAuth(
  onChange: (user: AuthUser | null) => void,
  onError: (message: string) => void,
): () => void {
  if (!auth) {
    onChange(null)
    return () => undefined
  }

  return onAuthStateChanged(
    auth,
    (user) => {
      if (!user) {
        onChange(null)
        return
      }

      onChange({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
      })
    },
    (error) => {
      onError(error.message)
    },
  )
}

export async function loginWithGoogle(): Promise<void> {
  if (!auth) {
    throw new Error('Firebase 尚未設定完成，無法登入')
  }

  const provider = new GoogleAuthProvider()
  await signInWithPopup(auth, provider)
}

export async function logoutCurrentUser(): Promise<void> {
  if (!auth) {
    return
  }

  await signOut(auth)
}
