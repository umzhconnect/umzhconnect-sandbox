import { useState, useEffect, useCallback } from 'react'
import Keycloak from 'keycloak-js'
import { setTokenAccessor } from '../api/client'

const KC_URL = import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8180'
const KC_REALM = import.meta.env.VITE_KEYCLOAK_REALM || 'umzh-sandbox'
const KC_CLIENT = import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'frontend-client'

const keycloak = new Keycloak({
  url: KC_URL,
  realm: KC_REALM,
  clientId: KC_CLIENT,
})

export interface AuthState {
  authenticated: boolean
  loading: boolean
  user: { name?: string; email?: string; sub?: string } | null
  login: () => void
  logout: () => void
  getToken: () => Promise<string | null>
}

export function useAuth(): AuthState {
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<AuthState['user']>(null)

  useEffect(() => {
    keycloak
      .init({
        onLoad: 'check-sso',
        pkceMethod: 'S256',
        silentCheckSsoRedirectUri: window.location.origin + '/silent-check-sso.html',
      })
      .then(auth => {
        setAuthenticated(auth)
        if (auth && keycloak.tokenParsed) {
          setUser({
            name: keycloak.tokenParsed['name'] as string,
            email: keycloak.tokenParsed['email'] as string,
            sub: keycloak.tokenParsed.sub,
          })
        }
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })

    keycloak.onTokenExpired = () => {
      keycloak.updateToken(30).catch(() => {
        setAuthenticated(false)
        setUser(null)
      })
    }
  }, [])

  const getToken = useCallback(async (): Promise<string | null> => {
    if (!keycloak.authenticated) return null
    try {
      await keycloak.updateToken(30)
      return keycloak.token || null
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    setTokenAccessor(getToken)
  }, [getToken])

  const login = () => keycloak.login({ redirectUri: window.location.origin })
  const logout = () => keycloak.logout({ redirectUri: window.location.origin })

  return { authenticated, loading, user, login, logout, getToken }
}
