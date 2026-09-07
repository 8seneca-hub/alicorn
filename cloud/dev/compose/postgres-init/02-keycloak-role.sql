-- Why: Keycloak owns its own schema, isolated from control/ledger (see 01-alicorn-app-role.sql).
CREATE ROLE keycloak LOGIN PASSWORD 'keycloak';
GRANT CONNECT ON DATABASE alicorn TO keycloak;
CREATE SCHEMA keycloak AUTHORIZATION keycloak;
