import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

function normalizeEnv(value: string | undefined): string {
  return (value ?? '').trim()
}

const firebaseConfig = {
  apiKey: normalizeEnv(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: normalizeEnv(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: normalizeEnv(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: normalizeEnv(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: normalizeEnv(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: normalizeEnv(import.meta.env.VITE_FIREBASE_APP_ID),
  measurementId: normalizeEnv(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
}

const requiredKeys: Array<keyof typeof firebaseConfig> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
]

export const missingFirebaseKeys = requiredKeys.filter(
  (key) => firebaseConfig[key].length === 0,
)

export const isFirebaseConfigured = requiredKeys.every(
  (key) => firebaseConfig[key].length > 0,
)

const firebaseApp = isFirebaseConfigured ? initializeApp(firebaseConfig) : null

export const db = firebaseApp ? getFirestore(firebaseApp) : null
export const auth = firebaseApp ? getAuth(firebaseApp) : null
