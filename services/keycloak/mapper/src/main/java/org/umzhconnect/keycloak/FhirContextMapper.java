package org.umzhconnect.keycloak;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.keycloak.models.ClientSessionContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.ProtocolMapperModel;
import org.keycloak.models.UserSessionModel;
import org.keycloak.protocol.oidc.mappers.AbstractOIDCProtocolMapper;
import org.keycloak.protocol.oidc.mappers.OIDCAccessTokenMapper;
import org.keycloak.provider.ProviderConfigProperty;
import org.keycloak.representations.IDToken;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Maps RFC 9396 authorization_details (type "umzh-connect-context") to a
 * SMART v2 fhirContext claim in the access token.
 *
 * Reads the raw session note directly: Keycloak 26.x does not populate
 * AuthorizationRequestContext with custom authorization_details types for the
 * client_credentials flow (only built-in SMART scope entries appear there).
 *
 * The standard RFC 9396 {@code identifier} field carries the FHIR reference
 * (e.g. "ServiceRequest/sr-123").
 */
public class FhirContextMapper extends AbstractOIDCProtocolMapper
        implements OIDCAccessTokenMapper {

    public static final String PROVIDER_ID = "umzh-fhir-context-mapper";

    private static final String[] NOTE_KEYS = {
        "authorization_details",
        "client_request_param_authorization_details",
    };

    private static final ObjectMapper JSON = new ObjectMapper();

    @Override public String getId()              { return PROVIDER_ID; }
    @Override public String getDisplayCategory() { return TOKEN_MAPPER_CATEGORY; }
    @Override public String getDisplayType()     { return "UMZH FHIR Context (RFC 9396)"; }

    @Override
    public String getHelpText() {
        return "Maps RFC 9396 authorization_details (type umzh-connect-context, identifier field) "
             + "to a SMART v2 fhirContext claim.";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return Collections.emptyList();
    }

    @Override
    protected void setClaim(IDToken token, ProtocolMapperModel model,
                            UserSessionModel userSession,
                            KeycloakSession session,
                            ClientSessionContext clientSessionCtx) {

        // Keycloak 26.x does not populate AuthorizationRequestContext with custom
        // authorization_details types for the client_credentials flow — only built-in
        // SMART scope entries appear there.  Read the raw session note instead.
        List<Map<String, String>> fhirContext = fromSessionNote(clientSessionCtx);

        if (!fhirContext.isEmpty()) {
            token.getOtherClaims().put("fhirContext", fhirContext);
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, String>> fromSessionNote(ClientSessionContext clientSessionCtx) {
        String raw = null;
        for (String key : NOTE_KEYS) {
            raw = clientSessionCtx.getClientSession().getNote(key);
            if (raw != null && !raw.isBlank()) break;
        }
        if (raw == null || raw.isBlank()) return Collections.emptyList();
        try {
            Object parsed = JSON.readValue(raw, Object.class);
            List<Map<String, Object>> details;
            if (parsed instanceof List) {
                details = (List<Map<String, Object>>) parsed;
            } else if (parsed instanceof Map) {
                Object entries = ((Map<?, ?>) parsed).get("authorizationDetailEntries");
                if (!(entries instanceof List)) return Collections.emptyList();
                details = (List<Map<String, Object>>) entries;
            } else {
                return Collections.emptyList();
            }
            return details.stream()
                .filter(d -> "umzh-connect-context".equals(d.get("type")))
                .map(d -> String.valueOf(d.getOrDefault("identifier", "")))
                .filter(id -> !id.isEmpty() && !"null".equals(id))
                .map(id -> Map.of("reference", id))
                .collect(Collectors.toList());
        } catch (Exception e) {
            return Collections.emptyList();
        }
    }
}
