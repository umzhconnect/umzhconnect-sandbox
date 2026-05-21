#!/bin/sh
# Local build helper — not used by docker-compose (the keycloak-mapper-build
# service handles the build automatically). Run this only if you want to
# build the mapper JAR outside of Docker:
#
#   cd services/keycloak && ./entrypoint.sh
#
# Requires Maven 3.9+ and JDK 17+ on PATH.
set -e
cd "$(dirname "$0")/mapper"
mvn -B package -DskipTests -q
mkdir -p ../providers
cp target/umzh-fhir-context-mapper-*.jar ../providers/
echo "Mapper JAR built and copied to services/keycloak/providers/"
