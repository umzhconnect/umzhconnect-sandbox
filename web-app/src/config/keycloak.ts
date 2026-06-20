import Keycloak from 'keycloak-js';
import { env } from './env';

const keycloakConfig = {
  url: env.keycloakUrl,
  realm: env.keycloakRealm,
  clientId: env.keycloakClientId,
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;
