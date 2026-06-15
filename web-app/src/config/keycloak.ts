import Keycloak from 'keycloak-js';
import { env } from './env';

const keycloakConfig = {
  url: env('VITE_KEYCLOAK_URL', 'http://localhost:8180'),
  realm: env('VITE_KEYCLOAK_REALM', 'umzh-connect'),
  clientId: env('VITE_KEYCLOAK_CLIENT_ID', 'web-app'),
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;
