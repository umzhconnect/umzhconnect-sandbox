import Keycloak from 'keycloak-js';
import { env, serviceUrl } from './env';

const keycloakConfig = {
  url: serviceUrl('VITE_KEYCLOAK_URL', 'KEYCLOAK_PORT', 8180),
  realm: env('VITE_KEYCLOAK_REALM', 'umzh-connect'),
  clientId: env('VITE_KEYCLOAK_CLIENT_ID', 'web-app'),
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;
